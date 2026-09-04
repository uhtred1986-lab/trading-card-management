/**
 * State helpers: where a card is, moving it (with the "new card" rules of
 * 3-1-4 and the removal rules for tokens and Z-cards), what its face says,
 * how much power it has, and paying costs. Everything mutates the state it
 * is given; `engine.ts` clones before calling.
 */
import { canCombo, hasKeyword, keywordOf, skillsOf, specifiedCostOf, isZ, baseType } from "./cards";
import { compileCardCached } from "./compile";
import { matches } from "./filters";
import type { Amount, Cond, Op, Ref, ScriptArea, ScriptFrame, Selector, Side } from "./script";
import type { Area, CardDef, CardFace, Color, ContinuousEffect, DelayedEffect, DelayTiming, ForbiddenAction, FlowStep, Prohibition, GameEvent, GameState, KeywordSkill, PlayerId, PlayerState, Skill } from "./types";
import { other } from "./types";

export interface GameContext {
  defs: Record<string, CardDef>;
}

export const LIFE_AT_START = 8;
export const OPENING_HAND = 6;

/**
 * Tokens (19) are made by effects and have no catalog row, so their whole
 * definition lives in the card id. Encoding it there rather than in a context
 * that only lives for one request keeps a saved game reloadable.
 */
export function tokenCardId(name: string, power: number, comboCost: number | null, comboPower: number | null, colors: Color[]): string {
  return `TOKEN:${encodeURIComponent(name)}:${power}:${comboCost ?? ""}:${comboPower ?? ""}:${colors.join(",")}`;
}

export function tokenDefOf(cardId: string): CardDef {
  const [, name, power, comboCost, comboPower, colors] = cardId.split(":");
  const num = (x: string) => (x === "" ? null : Number(x));
  return {
    id: cardId,
    name: decodeURIComponent(name ?? "Token"),
    type: "TOKEN",
    colors: (colors ? colors.split(",") : []).filter(Boolean) as Color[],
    energyCost: null,
    zEnergyCost: null,
    power: num(power ?? "") ?? 0,
    comboCost: num(comboCost ?? ""),
    comboPower: num(comboPower ?? ""),
    skill: null,
    characters: [],
    traits: [],
  };
}

export function def(ctx: GameContext, s: GameState, id: string): CardDef {
  const inst = s.cards[id];
  if (!inst) throw new Error(`unknown card instance ${id}`);
  if (inst.cardId.startsWith("TOKEN:")) return tokenDefOf(inst.cardId);
  const d = ctx.defs[inst.cardId];
  if (!d) throw new Error(`no definition for ${inst.cardId}`);
  return d;
}

/**
 * A replacement effect on a card leaving the Battle Area (9-10): where it goes
 * instead. `by` narrows it to departures caused by a skill.
 */
export interface Replacement {
  to: Area;
  by?: "skill";
}

/**
 * Where this card goes instead of where it was about to go, if a skill says so.
 *
 * 9-10-2 gives the choice to the affected player when several replacements
 * apply at once. Two on the same card is rare enough that the first one wins
 * here and the log says which; when that turns up in a real game it is one
 * prompt away.
 */
function replacementFor(ctx: GameContext, s: GameState, id: string, reason: MoveOptions["reason"]): Area | null {
  for (const e of staticEffects(ctx, s)) {
    if (e.kind !== "replaceLeave" || e.target !== id) continue;
    const r = e.value as Replacement;
    // "By a skill" means an effect put it out, not a battle or a rule.
    if (r.by === "skill" && reason !== "effect") continue;
    return r.to;
  }
  return null;
}

/** What a card counts as, once its skills have had their say (20-1). */
export interface Gains {
  traits: string[];
  characters: string[];
  colors: Color[];
}

/**
 * The card as the rules now read it: printed, plus anything it "gains in all
 * areas". Every check of what a card *is* — a selector's filter, a Leader
 * condition, an [Evolve] target — goes through this rather than `def`, so a
 * card that gained ≪Saiyan≫ is a Saiyan to all of them.
 */
export function cardNow(ctx: GameContext, s: GameState, id: string): CardDef {
  const d = def(ctx, s, id);
  const gains = staticEffects(ctx, s).filter((e) => e.kind === "gains" && e.target === id);
  if (!gains.length) return d;
  const out = { ...d, traits: [...d.traits], characters: [...d.characters], colors: [...d.colors] };
  const add = (list: string[], more: string[]) => {
    for (const x of more) if (!list.some((y) => y.toLowerCase() === x.toLowerCase())) list.push(x);
  };
  for (const e of gains) {
    const g = e.value as Gains;
    add(out.traits, g.traits);
    add(out.characters, g.characters);
    add(out.colors, g.colors);
  }
  return out;
}

export function player(s: GameState, p: PlayerId): PlayerState {
  return s.players[p];
}

export interface Location {
  owner: PlayerId;
  area: Area;
  index: number;
}

/** Scan both players' areas for a card. Areas are small; a scan is fine. */
export function locate(s: GameState, id: string): Location | null {
  for (const p of ["p1", "p2"] as PlayerId[]) {
    const ps = s.players[p];
    if (ps.leader === id) return { owner: p, area: "leader", index: 0 };
    if (ps.unison === id) return { owner: p, area: "unison", index: 0 };
    for (const area of ["deck", "hand", "drop", "warp", "life", "battle", "combo", "energy", "zDeck", "zEnergy", "removed"] as const) {
      const i = ps[area].indexOf(id);
      if (i >= 0) return { owner: p, area, index: i };
    }
  }
  return null;
}

export function areaOf(s: GameState, id: string): Area | null {
  return locate(s, id)?.area ?? null;
}

export function inPlay(s: GameState, id: string): boolean {
  const a = areaOf(s, id);
  return a === "leader" || a === "battle" || a === "unison";
}

/** The side of a card that is up (10-1-3): a flipped leader shows its back. */
export function face(ctx: GameContext, s: GameState, id: string): CardFace {
  const inst = s.cards[id];
  const d = def(ctx, s, id);
  if (inst.hidden) return { name: "Hidden card", power: null, skill: null };
  if (inst.flipped && d.back) return { name: d.back.name, power: d.back.power, skill: d.back.skill };
  return { name: d.name, power: d.power, skill: d.skill };
}

export function skillsOfInstance(ctx: GameContext, s: GameState, id: string): Skill[] {
  const inst = s.cards[id];
  if (inst.hidden) return [];
  const d = def(ctx, s, id);
  return skillsOf(d, inst.flipped && d.back ? "back" : "front");
}

/** Keywords in force: printed (unless negated) plus granted by continuous effects. */
export function keywordsInForce(ctx: GameContext, s: GameState, id: string): KeywordSkill[] {
  const inst = s.cards[id];
  const out: KeywordSkill[] = [];
  for (const e of staticEffects(ctx, s)) if (e.kind === "keyword" && e.target === id) out.push(e.value as KeywordSkill);
  if (!inst.hidden && inst.negated !== "all") {
    const d = def(ctx, s, id);
    const side = inst.flipped && d.back ? "back" : "front";
    for (const sk of skillsOf(d, side)) {
      if (inst.negated.includes(sk.index)) continue;
      if (sk.keyword) out.push(sk.keyword);
      // Keywords sharing the line with a typed skill ("[Auto][Blocker]") belong to that line.
      for (const tag of sk.tags) {
        const k = keywordOf(tag);
        if (k && k.name !== sk.keyword?.name && !out.some((o) => o.name === k.name)) out.push(k);
      }
    }
  }
  for (const e of s.effects) if (e.kind === "keyword" && e.target === id) out.push(e.value as KeywordSkill);
  // 9-1-5: a skill may name one keyword to negate rather than silencing the
  // card. Applied last, so it beats a grant of the same keyword.
  const gone = new Set(staticEffects(ctx, s).filter((e) => e.kind === "negateKeyword" && e.target === id).map((e) => e.value as KeywordSkill["name"]));
  return gone.size ? out.filter((k) => !gone.has(k.name)) : out;
}

export function has(ctx: GameContext, s: GameState, id: string, name: KeywordSkill["name"]): boolean {
  return keywordsInForce(ctx, s, id).some((k) => k.name === name);
}

export function keyword<N extends KeywordSkill["name"]>(ctx: GameContext, s: GameState, id: string, name: N): Extract<KeywordSkill, { name: N }> | null {
  return (keywordsInForce(ctx, s, id).find((k) => k.name === name) as Extract<KeywordSkill, { name: N }> | undefined) ?? null;
}

/**
 * Power as 9-9 computes it: printed face value, then non-numeric-rewrite
 * effects, then numeric ones. Combo power is added only in the Damage Step by
 * the battle code. Hidden cards and cards with no printed power count 0.
 */
export function powerOf(ctx: GameContext, s: GameState, id: string): number {
  const f = face(ctx, s, id);
  let p = f.power ?? 0;
  if (has(ctx, s, id, "Servant")) p += 10000;
  for (const e of staticEffects(ctx, s)) if (e.kind === "power" && e.target === id) p += e.value as number;
  for (const e of s.effects) if (e.kind === "power" && e.target === id) p += e.value as number;
  return p;
}

/** 5-7-3, 20-21: the combo cost as it stands, after any [Permanent] reducer. */
export function comboCostOf(ctx: GameContext, s: GameState, id: string): number {
  const base = def(ctx, s, id).comboCost ?? 0;
  let reduction = 0;
  for (const e of staticEffects(ctx, s)) if (e.kind === "comboCost" && e.target === id) reduction += e.value as number;
  return Math.max(0, base - reduction);
}

export function comboPowerOf(ctx: GameContext, s: GameState, id: string): number {
  const d = def(ctx, s, id);
  let p = d.comboPower ?? 0;
  for (const e of staticEffects(ctx, s)) if (e.kind === "comboPower" && e.target === id) p += e.value as number;
  for (const e of s.effects) if (e.kind === "comboPower" && e.target === id) p += e.value as number;
  return p;
}

// ── selectors ──────────────────────────────────────────────────────────────

export function sideOf(master: PlayerId, side: Side | undefined): PlayerId[] {
  if (side === "opponent") return [other(master)];
  if (side === "both") return [master, other(master)];
  return [master];
}

function areaCards(s: GameState, p: PlayerId, area: ScriptArea, frame: ScriptFrame): string[] {
  const ps = s.players[p];
  switch (area) {
    case "leader":
      return ps.leader ? [ps.leader] : [];
    case "unison":
      return ps.unison ? [ps.unison] : [];
    case "play":
      return cardsInPlay(s, p);
    case "under":
      return s.cards[frame.card]?.under.slice() ?? [];
    default:
      return ps[area].slice();
  }
}

/**
 * Cards a selector can pick. 22-16 [Barrier] removes a card from the choices
 * of a skill mastered by its opponent; 20-4 does the same for "unaffected by
 * skills", which the compiler never emits.
 */
export function resolveSelector(ctx: GameContext, s: GameState, frame: ScriptFrame, sel: Selector): string[] {
  let out: string[] = [];
  if (sel.special) {
    const b = s.battle;
    const pick =
      sel.special === "self"
        ? frame.card
        : sel.special === "attacker"
          ? b?.attacker
          : sel.special === "guard"
            ? b?.guard
            : sel.special === "subject"
              ? frame.subject
              : sel.special === "leader"
                ? s.players[frame.master].leader
                : s.players[other(frame.master)].leader;
    out = pick && s.cards[pick] ? [pick] : [];
  } else if (sel.fromVar) {
    out = (frame.vars[sel.fromVar] ?? []).filter((id) => s.cards[id]);
  } else {
    const area = sel.area ?? "battle";
    for (const p of sideOf(frame.master, sel.side)) out.push(...areaCards(s, p, area, frame));
  }
  return out.filter((id) => {
    const inst = s.cards[id];
    if (!inst) return false;
    if (sel.mode && inst.mode !== sel.mode) return false;
    // A named target that also names an area only matches while it is there.
    // A delayed effect resolves turns later, and by then "this card" may have
    // left the Battle Area — in which case it is no longer the same card (3-1-4).
    if (sel.special && sel.area && areaOf(s, id) !== (sel.area === "play" ? "battle" : sel.area)) return false;
    // 23-5-2: a Hidden Mode card has none of its front-side information.
    if (sel.filter && (inst.hidden || !matches(cardNow(ctx, s, id), sel.filter))) return false;
    if (!sel.special && !sel.ignoreBarrier && sel.side !== "you" && has(ctx, s, id, "Barrier") && s.cards[id].owner !== frame.master && areaOf(s, id) !== "hand") return false;
    // 20-4: the same shape as [Barrier], but printed as a prohibition.
    if (!sel.special && s.cards[id].owner !== frame.master && forbids(ctx, s, "beChosen", { card: id })) return false;
    return true;
  });
}

export function resolveRef(ctx: GameContext, s: GameState, frame: ScriptFrame, ref: Ref): string[] {
  if ("var" in ref) return (frame.vars[ref.var] ?? []).filter((id) => s.cards[id]);
  return resolveSelector(ctx, s, frame, ref.sel);
}

export function amount(ctx: GameContext, s: GameState, frame: ScriptFrame, a: Amount): number {
  if (typeof a === "number") return a;
  if ("var" in a) return (frame.vars[a.var] ?? []).length;
  return resolveSelector(ctx, s, frame, a.count).length;
}

export function condHolds(ctx: GameContext, s: GameState, frame: ScriptFrame, c: Cond): boolean {
  switch (c.kind) {
    case "count": {
      const n = resolveSelector(ctx, s, frame, c.sel).length;
      return (c.atLeast == null || n >= c.atLeast) && (c.atMost == null || n <= c.atMost);
    }
    case "life": {
      const n = sideOf(frame.master, c.side).reduce((t, p) => t + s.players[p].life.length, 0);
      return (c.atLeast == null || n >= c.atLeast) && (c.atMost == null || n <= c.atMost);
    }
    case "leaderColor": {
      const l = s.players[frame.master].leader;
      return !!l && def(ctx, s, l).colors.includes(c.color);
    }
    case "leaderMatches": {
      const l = s.players[c.side === "opponent" ? other(frame.master) : frame.master].leader;
      return !!l && matches(cardNow(ctx, s, l), c.filter);
    }
    case "lifeVsOpponent": {
      const mine = s.players[frame.master].life.length;
      const theirs = s.players[other(frame.master)].life.length;
      return c.atLeast ? mine >= theirs : mine <= theirs;
    }
    case "chose":
      return (frame.vars[c.var] ?? []).length > 0;
    case "isTurnPlayer":
      return c.who === "opponent" ? s.turnPlayer !== frame.master : s.turnPlayer === frame.master;
  }
}


// ── static effects from [Permanent] skills (9-5, 9-9) ──────────────────────

/** Another way to pay for a card's [Counter] skill (5-3). */
export interface AltCost {
  pay: "none" | "life";
  /** Cards to add from your life to your hand, for `pay: "life"`. */
  n: number;
}

export interface StaticEffect {
  source: string;
  kind: "power" | "comboPower" | "keyword" | "cost" | "comboCost" | "negateKeyword" | "gains" | "replaceLeave" | "forbid" | "altCost";
  /** The card it is about; empty for a rule about a player rather than a card. */
  target: string;
  value: number | KeywordSkill | KeywordSkill["name"] | Prohibition | AltCost | Gains | Replacement;
}

/**
 * [Permanent] skills are never activated; they simply hold while they are
 * valid (9-5-1). So rather than being resolved once, they are read whenever a
 * card's power, keywords or cost is asked for.
 *
 * Only the shapes the compiler understands take effect: power and combo-power
 * changes, keyword grants, and cost reductions. A permanent skill it cannot
 * read does nothing, which the coverage report says out loud — the referee
 * cannot help here, because there is no moment at which to ask.
 */
export function staticEffects(ctx: GameContext, s: GameState): StaticEffect[] {
  if (computingStatics) return []; // one level only; see the note below
  computingStatics = true;
  try {
    const out: StaticEffect[] = [];
    for (const p of ["p1", "p2"] as PlayerId[]) {
      const ps = s.players[p];
      // 9-1-3-1: a card's skills are valid in its own area. Cards in hand are
      // included only for the skills that name the hand, such as cost reducers.
      for (const src of [...cardsInPlay(s, p), ...ps.hand, ...ps.zDeck]) {
        const inst = s.cards[src];
        if (!inst || inst.hidden || inst.negated === "all") continue;
        const d = def(ctx, s, src);
        const side = inst.flipped && d.back ? "back" : "front";
        const scripts = compileCardCached(d, side);
        const inPlayNow = inPlay(s, src);
        for (const sk of skillsOf(d, side)) {
          if (sk.kind !== "permanent") continue;
          if (inst.negated.includes(sk.index)) continue;
          const sc = scripts.bySkill[sk.index];
          if (!sc || sc.unsupported.length) continue;
          collectStatics(ctx, s, out, src, p, sc.ops, inPlayNow);
        }
      }
    }
    return out;
  } finally {
    computingStatics = false;
  }
}

/**
 * Guards against a loop: resolving a selector can ask whether a card has
 * [Barrier], which asks for its keywords, which would ask for the static
 * effects again. Static selectors therefore ignore [Barrier] — it governs
 * being *chosen* by a skill (22-16), not being covered by a permanent one —
 * and this flag catches anything else.
 */
let computingStatics = false;

function collectStatics(ctx: GameContext, s: GameState, out: StaticEffect[], source: string, master: PlayerId, ops: Op[], inPlayNow: boolean): void {
  const frame: ScriptFrame = { ops: [], ip: 0, vars: {}, card: source, master };
  for (const op of ops) {
    if (op.op === "if") {
      if (condHolds(ctx, s, frame, op.cond)) collectStatics(ctx, s, out, source, master, op.then, inPlayNow);
      else if (op.else) collectStatics(ctx, s, out, source, master, op.else, inPlayNow);
      continue;
    }
    if (op.op === "costReduction") {
      const kind = op.what === "combo" ? "comboCost" : "cost";
      for (const id of staticTargets(ctx, s, frame, op.target)) out.push({ source, kind, target: id, value: op.amount });
      continue;
    }
    // "In all areas", so it is read wherever the card is — which is the point
    // of negating [Energy-Exhaust], a skill that only matters outside play.
    // 9-10: only while the card is where its skill is valid — a replacement
    // effect on a card in your hand has nothing to replace.
    if (op.op === "replaceLeave") {
      if (!inPlayNow) continue;
      const dest = op.to === "play" ? "battle" : op.to === "under" ? "drop" : (op.to as Area);
      const targets = op.target ? staticTargets(ctx, s, frame, op.target) : [source];
      for (const id of targets) out.push({ source, kind: "replaceLeave", target: id, value: { to: dest, by: op.by } });
      continue;
    }
    // "In all areas" again: what a card counts as does not depend on where it is.
    if (op.op === "gains") {
      const targets = op.target ? staticTargets(ctx, s, frame, op.target) : [source];
      for (const id of targets) out.push({ source, kind: "gains", target: id, value: { traits: op.traits ?? [], characters: op.characters ?? [], colors: op.colors ?? [] } });
      continue;
    }
    if (op.op === "negateKeyword") {
      const targets = op.target ? staticTargets(ctx, s, frame, op.target) : [source];
      for (const id of targets) out.push({ source, kind: "negateKeyword", target: id, value: op.keyword });
      continue;
    }
    // Like a cost reducer, this one is about the card in hand, so it is read
    // whether or not the card is on the table.
    if (op.op === "altCost") {
      out.push({ source, kind: "altCost", target: source, value: { pay: op.pay, n: op.n ?? 1 } });
      continue;
    }
    // 20-14: a prohibition printed as a [Permanent] skill holds for as long as
    // the card is where the skill is valid, so it belongs here rather than in
    // the list of effects with a duration.
    if (op.op === "forbid") {
      if (!inPlayNow) continue;
      const player = op.side && op.side !== "both" ? sideOf(master, op.side)[0] : undefined;
      const name = op.sameNameAsSelf ? face(ctx, s, source).name : undefined;
      if (op.target) {
        for (const id of staticTargets(ctx, s, frame, op.target)) out.push({ source, kind: "forbid", target: id, value: { what: op.what, player } });
      } else {
        out.push({ source, kind: "forbid", target: "", value: { what: op.what, player, filter: op.filter, name } });
      }
      continue;
    }
    if (!inPlayNow) continue; // the rest only hold while the card is in play
    if (op.op === "power" || op.op === "comboPower") {
      if (typeof op.amount !== "number") continue;
      for (const id of staticTargets(ctx, s, frame, op.target)) out.push({ source, kind: op.op, target: id, value: op.amount });
    } else if (op.op === "grant") {
      for (const id of staticTargets(ctx, s, frame, op.target)) out.push({ source, kind: "keyword", target: id, value: op.keyword });
    }
  }
}

function staticTargets(ctx: GameContext, s: GameState, frame: ScriptFrame, ref: Ref): string[] {
  if ("var" in ref) return [];
  return resolveSelector(ctx, s, frame, { ...ref.sel, ignoreBarrier: true });
}

// ── moving cards ───────────────────────────────────────────────────────────

function list(ps: PlayerState, area: Area): string[] | null {
  if (area === "leader" || area === "unison") return null;
  return ps[area];
}

/** Take a card out of wherever it is. Returns where it was. */
export function detach(s: GameState, id: string): Location | null {
  const loc = locate(s, id);
  if (!loc) return null;
  const ps = s.players[loc.owner];
  if (loc.area === "leader") ps.leader = "";
  else if (loc.area === "unison") ps.unison = null;
  else {
    const l = list(ps, loc.area)!;
    l.splice(l.indexOf(id), 1);
  }
  return loc;
}

export interface MoveOptions {
  /** "top" is the default: new cards go on top of Drop/Warp/Life (3-4-3, 3-9-2, 3-10-2). Deck bottom is used by some skills. */
  position?: "top" | "bottom";
  /** Entering an open area from a secret one shows the card. */
  reveal?: boolean;
  /** Keep mode/markers/effects (3-1-4-1: battle→combo, combo→battle, gaining control). */
  carry?: boolean;
  /** A rule- or effect-caused move whose cause matters for triggers (KO). */
  reason?: "ko" | "effect" | "rule" | "cost" | "play" | "combo" | "damage" | "draw" | "charge";
}

/**
 * Move a card to an area. Applies: the card is new in its new area (3-1-4),
 * cards under it go to Drop when it leaves play (23-2-5), tokens leaving play
 * are removed (19-1-7), Z-cards leaving play are removed (14-1-4),
 * [Energy-Exhaust] enters energy in Rest Mode (22-31), [Ultimate] leaving
 * play is removed (22-14-3), and markers are dropped (5-13-3).
 * Returns the area the card actually ended in.
 */
export function move(ctx: GameContext, s: GameState, ev: GameEvent[], id: string, to: Area, toOwner: PlayerId, opts: MoveOptions = {}): Area {
  const inst = s.cards[id];
  const d = def(ctx, s, id);
  const from = locate(s, id);
  const wasInPlay = from?.area === "leader" || from?.area === "battle" || from?.area === "unison";
  const wasCombo = from?.area === "combo";
  const goesToPlay = to === "leader" || to === "battle" || to === "unison";
  const goesToCombo = to === "combo";

  // 9-10: a replacement effect changes where the card goes before it goes
  // there, and the move that was about to happen is treated as never having
  // happened (9-10-1-1). Read before the rules below, because a rule about
  // what a card *is* — a token, a Z-card — outranks an effect (0-2-5).
  if (wasInPlay && !goesToPlay && !goesToCombo) {
    const instead = replacementFor(ctx, s, id, opts.reason);
    if (instead && instead !== to) {
      note(ev, `${face(ctx, s, id).name} goes to the ${instead} instead`);
      to = instead;
    }
  }

  // 19-1-7: tokens leaving battle/combo for anywhere else are removed.
  if (inst.isToken && (wasInPlay || wasCombo) && !goesToPlay && !goesToCombo) to = "removed";
  // 14-1-4 / 22-14-3: Z-cards and [Ultimate] cards leaving play are removed instead.
  if ((isZ(d) || hasKeyword(d, "Ultimate")) && (wasInPlay || wasCombo) && to !== "removed" && !goesToCombo && !goesToPlay) {
    to = "removed";
  }
  if (to === "removed") toOwner = inst.owner;
  // 3-1-6-1: only leader/battle/unison/combo may belong to the opponent.
  if (toOwner !== inst.owner && !goesToPlay && !goesToCombo) toOwner = inst.owner;

  detach(s, id);

  // 23-2-5: leaving play for a differently named area drops the cards underneath.
  if ((wasInPlay || wasCombo) && !goesToPlay && !goesToCombo && inst.under.length) {
    const under = inst.under.splice(0);
    for (const u of under) {
      const ud = ctx.defs[s.cards[u].cardId];
      const dest: Area = isZ(ud) ? "removed" : "drop";
      s.players[s.cards[u].owner][dest].unshift(u);
      ev.push({ type: "move", card: u, from: from!.area, to: dest, owner: s.cards[u].owner });
    }
  }

  const carry = !!opts.carry || ((wasInPlay || wasCombo) && (goesToPlay || goesToCombo));
  if (!carry) {
    inst.mode = "active";
    inst.markers = 0;
    inst.flipped = false;
    inst.hidden = false;
    inst.negated = [];
    inst.usedThisTurn = [];
    inst.extraAttacks = 0;
    s.effects = s.effects.filter((e) => e.target !== id);
  }
  if (goesToPlay || goesToCombo) inst.enteredTurn = s.turn;
  // 22-31: [Energy-Exhaust] enters the Energy Area rested.
  if (to === "energy" && hasKeyword(d, "Energy-Exhaust")) inst.mode = "rest";

  const ps = s.players[toOwner];
  if (to === "leader") ps.leader = id;
  else if (to === "unison") ps.unison = id;
  else {
    const l = list(ps, to)!;
    if (opts.position === "bottom") l.push(id);
    else if (to === "deck" || to === "drop" || to === "warp" || to === "life" || to === "removed") l.unshift(id);
    else l.push(id);
  }
  ev.push({ type: "move", card: id, from: from?.area ?? "removed", to, owner: toOwner, reveal: opts.reveal });
  return to;
}

export function draw(ctx: GameContext, s: GameState, ev: GameEvent[], p: PlayerId, n = 1): number {
  const ps = s.players[p];
  let drawn = 0;
  for (let i = 0; i < n; i++) {
    const id = ps.deck[0];
    if (!id) break;
    move(ctx, s, ev, id, "hand", p, { reason: "draw" });
    ev.push({ type: "draw", player: p, card: id });
    drawn++;
  }
  return drawn;
}

/**
 * Put one card under another (23-2). The stack is already modelled — Evolve,
 * Union and Z-Stack build one — but until now no effect could say it, so the
 * compiler sent the card to the Drop instead, which is a different game.
 *
 * A card under another is not in any area of its own, so it leaves the one it
 * was in and takes no state with it (3-1-4). `move` already returns the whole
 * stack to the Drop when the card on top leaves play (23-2-5).
 */
export function placeUnder(ctx: GameContext, s: GameState, ev: GameEvent[], id: string, host: string): boolean {
  if (id === host || !s.cards[id] || !s.cards[host]) return false;
  // 3-1-2: a Leader Card does not leave the Leader Area, not even downwards.
  if (areaOf(s, id) === "leader") return false;
  // Nothing can go under a card that is not on the table.
  if (!["battle", "leader", "unison"].includes(areaOf(s, host) ?? "")) return false;
  detach(s, id);
  const inst = s.cards[id];
  inst.mode = "active";
  inst.markers = 0;
  inst.flipped = false;
  inst.hidden = false;
  inst.negated = [];
  inst.usedThisTurn = [];
  s.cards[host].under.push(id);
  ev.push({ type: "stack", top: host, under: s.cards[host].under.slice() });
  return true;
}

export function setMode(s: GameState, ev: GameEvent[], id: string, mode: "active" | "rest", ctx?: GameContext): boolean {
  const inst = s.cards[id];
  if (inst.mode === mode) return false; // 0-2-4-1: already in that state
  // 20-14: "it can't switch to Active Mode" holds against every path that
  // would switch it, including the Charge Phase (7-2-7). `ctx` is passed by
  // the callers that can switch a card to Active Mode; without it only the
  // effects with a duration are read, which is all that resting needs.
  if (mode === "active" && forbiddenForCard(s, "switchToActive", id, ctx)) return false;
  inst.mode = mode;
  ev.push({ type: "mode", card: id, mode });
  return true;
}

export function addEffect(s: GameState, ev: GameEvent[], e: Omit<ContinuousEffect, "id" | "createdTurn" | "ownerTurn">): ContinuousEffect {
  const full: ContinuousEffect = { ...e, id: s.nextEffectId++, createdTurn: s.turn, ownerTurn: s.turnPlayer };
  s.effects.push(full);
  ev.push({ type: "effect", effect: full });
  return full;
}

export function endEffects(s: GameState, until: ContinuousEffect["until"], forPlayer?: PlayerId): void {
  s.effects = s.effects.filter((e) => !(e.until === until && (forPlayer == null || e.ownerTurn === forPlayer)));
}

// ── prohibitions (20-14, 0-2-5) ────────────────────────────────────────────

/**
 * Whether something is forbidden right now. 0-2-5: a prohibition beats an
 * instruction, so this is the last question asked and its answer is final.
 *
 * `card` is what the action is about — the attacker, the card being played,
 * the card that would switch to Active Mode. `player` is who is acting.
 */
export function forbids(ctx: GameContext, s: GameState, what: ForbiddenAction, opts: { player?: PlayerId; card?: string } = {}): boolean {
  const rules: { target: string; forbid: Prohibition }[] = [];
  for (const e of s.effects) if (e.kind === "forbid" && e.forbid) rules.push({ target: e.target, forbid: e.forbid });
  // A prohibition printed as a [Permanent] skill holds while the card is in
  // play, with no duration to expire (9-5-1).
  for (const e of staticEffects(ctx, s)) if (e.kind === "forbid") rules.push({ target: e.target, forbid: e.value as Prohibition });

  for (const { target, forbid: f } of rules) {
    if (f.what !== what) continue;
    // A rule about one card only applies to that card.
    if (target && target !== opts.card) continue;
    if (f.player && opts.player && f.player !== opts.player) continue;
    if (f.filter || f.name) {
      if (!opts.card || !s.cards[opts.card]) continue;
      const d = def(ctx, s, opts.card);
      if (f.filter && !matches(cardNow(ctx, s, opts.card), f.filter)) continue;
      if (f.name && d.name !== f.name) continue;
    }
    return true;
  }
  return false;
}

/**
 * The card-only half of the same question, for the places that have a state
 * but no card definitions — `setMode` is called from everywhere, including
 * paths that must not need a context.
 */
export function forbiddenForCard(s: GameState, what: ForbiddenAction, card: string, ctx?: GameContext): boolean {
  if (s.effects.some((e) => e.kind === "forbid" && e.target === card && e.forbid?.what === what)) return true;
  // The [Permanent] half needs the card definitions, so it is only asked when
  // the caller has them.
  return !!ctx && staticEffects(ctx, s).some((e) => e.kind === "forbid" && e.target === card && (e.value as Prohibition).what === what);
}

/**
 * The other way this card's [Counter] skill may be paid for, if it has one
 * (5-3), and whether the player can actually meet it right now.
 */
export function altCostFor(ctx: GameContext, s: GameState, card: string, payer: PlayerId): AltCost | null {
  for (const e of staticEffects(ctx, s)) {
    if (e.kind !== "altCost" || e.target !== card) continue;
    const alt = e.value as AltCost;
    if (alt.pay === "life" && s.players[payer].life.length < alt.n) continue;
    return alt;
  }
  return null;
}

/** Carry out an alternative cost. Adding life to hand is not damage (1-13-2). */
export function payAltCost(ctx: GameContext, s: GameState, ev: GameEvent[], payer: PlayerId, alt: AltCost): boolean {
  if (alt.pay === "none") return true;
  if (s.players[payer].life.length < alt.n) return false;
  for (let i = 0; i < alt.n; i++) {
    const life = s.players[payer].life[0];
    if (!life) return false;
    move(ctx, s, ev, life, "hand", payer, { reason: "cost" });
  }
  return true;
}

// ── delayed effects (1-7-2-1-1) ────────────────────────────────────────────

/** Write an effect down for a later timing. */
export function schedule(s: GameState, ev: GameEvent[], e: Omit<DelayedEffect, "id" | "createdTurn">): DelayedEffect {
  const full: DelayedEffect = { ...e, id: s.nextDelayedId++, createdTurn: s.turn };
  s.delayed.push(full);
  ev.push({ type: "delayed", card: e.card, label: e.label });
  return full;
}

/** Whether the turn now under way is the one the effect was waiting for. */
function ripe(s: GameState, d: DelayedEffect): boolean {
  switch (d.scope) {
    case "thisTurn":
      return s.turn === d.createdTurn;
    case "nextTurn":
      return s.turn > d.createdTurn;
    case "yourNextTurn":
      return s.turn > d.createdTurn && s.turnPlayer === d.master;
    case "opponentNextTurn":
      return s.turn > d.createdTurn && s.turnPlayer !== d.master;
  }
}

/**
 * Take every effect waiting for this timing off the list and return the flow
 * steps that carry them out, oldest first (4-2-2-2 order). A checkpoint
 * follows each one, because a delayed effect can KO a card like any other.
 */
export function fireDelayed(s: GameState, at: DelayTiming): FlowStep[] {
  const ready = s.delayed.filter((d) => d.at === at && ripe(s, d));
  if (!ready.length) return [];
  const ids = new Set(ready.map((d) => d.id));
  s.delayed = s.delayed.filter((d) => !ids.has(d.id));
  return ready.flatMap((d): FlowStep[] => [
    { op: "script.step", frame: { ops: d.ops, ip: 0, vars: d.vars, card: d.card, master: d.master, subject: d.subject } },
    { op: "checkpoint" },
  ]);
}

/**
 * An effect scheduled for "this turn" whose moment has gone never happens —
 * the card that scheduled it may have left play before the timing came round,
 * or the timing may simply have passed. Dropping it keeps the list from
 * growing over a long game.
 */
export function expireDelayed(s: GameState): void {
  s.delayed = s.delayed.filter((d) => d.scope !== "thisTurn" || d.createdTurn === s.turn);
}

// ── costs (5-3, 5-4, 5-6) ──────────────────────────────────────────────────

export function activeEnergy(s: GameState, p: PlayerId): string[] {
  return s.players[p].energy.filter((id) => s.cards[id].mode === "active");
}

export function leaderColors(ctx: GameContext, s: GameState, p: PlayerId): Color[] {
  const l = s.players[p].leader;
  return l ? def(ctx, s, l).colors : [];
}

export interface Payment {
  /** Energy cards to switch to Rest Mode. */
  rest: string[];
  /** Energy markers to remove (1-14-2). */
  markers: number;
}

/**
 * Find energy to pay `total` with the coloured orbs in `specified`. Explicit
 * choices are validated; otherwise the engine picks: specified colours from
 * mono-colour matches first, then the rest from whatever is most plentiful,
 * then energy markers. Returns null when the cost can't be paid (5-3-3).
 */
export function planPayment(ctx: GameContext, s: GameState, p: PlayerId, total: number, specified: Partial<Record<Color, number>>, explicit?: string[]): Payment | null {
  const active = activeEnergy(s, p);
  const ps = s.players[p];
  const leader = leaderColors(ctx, s, p);
  const colorsOf = (id: string) => def(ctx, s, id).colors;

  if (explicit) {
    if (explicit.some((id) => !active.includes(id))) return null;
    const markers = Math.max(0, total - explicit.length);
    if (markers > ps.energyMarkers) return null;
    if (explicit.length + markers !== total) return null;
    // Check the specified colours are covered by the chosen cards (+ markers as leader colour).
    const need = { ...specified };
    for (const id of explicit) {
      for (const c of colorsOf(id)) {
        if ((need[c] ?? 0) > 0) {
          need[c]!--;
          break;
        }
      }
    }
    let m = markers;
    for (const c of leader) while (m > 0 && (need[c] ?? 0) > 0) {
      need[c]!--;
      m--;
    }
    if (Object.values(need).some((n) => (n ?? 0) > 0)) return null;
    return { rest: explicit, markers };
  }

  const chosen: string[] = [];
  const pool = active.slice();
  const need = { ...specified };
  // Specified orbs: prefer a mono-colour card of that colour, then any card with it.
  for (const c of Object.keys(need) as Color[]) {
    for (let n = need[c] ?? 0; n > 0; n--) {
      let pick = pool.find((id) => colorsOf(id).length === 1 && colorsOf(id)[0] === c) ?? pool.find((id) => colorsOf(id).includes(c));
      if (!pick && leader.includes(c) && ps.energyMarkers > chosen.filter((x) => x === "#marker").length) pick = "#marker";
      if (!pick) return null;
      chosen.push(pick);
      if (pick !== "#marker") pool.splice(pool.indexOf(pick), 1);
    }
  }
  // Remaining generic cost: spend the colour we have most of, keep scarce colours.
  while (chosen.length < total) {
    if (pool.length === 0) {
      const markersUsed = chosen.filter((x) => x === "#marker").length;
      if (ps.energyMarkers > markersUsed) {
        chosen.push("#marker");
        continue;
      }
      return null;
    }
    const counts = new Map<string, number>();
    for (const id of pool) counts.set(colorsOf(id).join("/"), (counts.get(colorsOf(id).join("/")) ?? 0) + 1);
    let best = pool[0];
    for (const id of pool) if ((counts.get(colorsOf(id).join("/")) ?? 0) > (counts.get(colorsOf(best).join("/")) ?? 0)) best = id;
    chosen.push(best);
    pool.splice(pool.indexOf(best), 1);
  }
  return { rest: chosen.filter((x) => x !== "#marker"), markers: chosen.filter((x) => x === "#marker").length };
}

/**
 * The genuinely different ways to pay a cost (3-8-2: a player may choose any
 * energy they like). Two payments that rest the same combination of colours
 * are the same choice, so they are folded together; when only one survives,
 * the choice cannot matter and the caller pays it without asking.
 */
export function paymentOptions(
  ctx: GameContext,
  s: GameState,
  p: PlayerId,
  total: number,
  specified: Partial<Record<Color, number>>,
  limit = 8,
): Payment[] {
  const ps = s.players[p];
  const leader = leaderColors(ctx, s, p);
  const colorsOf = (id: string) => def(ctx, s, id).colors;
  const byColors = new Map<string, string[]>();
  for (const id of activeEnergy(s, p)) {
    const k = colorsOf(id).join("/");
    byColors.set(k, [...(byColors.get(k) ?? []), id]);
  }
  const keys = [...byColors.keys()].sort();
  const out: Payment[] = [];
  const seen = new Set<string>();

  const covers = (picked: string[], markers: number): boolean => {
    const need = { ...specified };
    for (const id of picked) {
      for (const c of colorsOf(id)) {
        if ((need[c] ?? 0) > 0) {
          need[c]!--;
          break;
        }
      }
    }
    let m = markers;
    for (const c of leader) {
      while (m > 0 && (need[c] ?? 0) > 0) {
        need[c]!--;
        m--;
      }
    }
    return !Object.values(need).some((n) => (n ?? 0) > 0);
  };

  const take = (i: number, left: number, picked: string[], counts: number[]) => {
    if (out.length >= limit) return;
    if (left === 0) {
      if (!covers(picked, 0)) return;
      const sig = counts.join(",");
      if (seen.has(sig)) return;
      seen.add(sig);
      out.push({ rest: picked.slice(), markers: 0 });
      return;
    }
    if (i >= keys.length) {
      // Energy markers stand in for energy of the leader's colour (1-14-2).
      if (left <= ps.energyMarkers && covers(picked, left)) {
        const sig = [...counts, `m${left}`].join(",");
        if (!seen.has(sig)) {
          seen.add(sig);
          out.push({ rest: picked.slice(), markers: left });
        }
      }
      return;
    }
    const pool = byColors.get(keys[i])!;
    for (let n = Math.min(pool.length, left); n >= 0; n--) take(i + 1, left - n, [...picked, ...pool.slice(0, n)], [...counts, n]);
  };
  take(0, total, [], []);
  return out;
}

/** A short label for one payment, for the prompt: "2 Red, 1 Blue". */
export function describePayment(ctx: GameContext, s: GameState, payment: Payment): string {
  const counts = new Map<string, number>();
  for (const id of payment.rest) {
    const k = def(ctx, s, id).colors.join("/") || "Colourless";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const parts = [...counts.entries()].map(([k, n]) => `${n} ${k}`);
  if (payment.markers) parts.push(`${payment.markers} energy marker${payment.markers === 1 ? "" : "s"}`);
  return parts.join(", ") || "nothing";
}

export function pay(s: GameState, ev: GameEvent[], p: PlayerId, payment: Payment): void {
  for (const id of payment.rest) setMode(s, ev, id, "rest");
  if (payment.markers) {
    s.players[p].energyMarkers -= payment.markers;
    ev.push({ type: "energyMarker", player: p, delta: -payment.markers });
  }
}

/** 5-4: Z-Energy costs are paid by moving that many Z-Energy cards to Drop. */
export function payZEnergy(ctx: GameContext, s: GameState, ev: GameEvent[], p: PlayerId, n: number): boolean {
  const ps = s.players[p];
  if (ps.zEnergy.length < n) return false;
  for (let i = 0; i < n; i++) move(ctx, s, ev, ps.zEnergy[ps.zEnergy.length - 1], "drop", p, { reason: "cost" });
  return true;
}

/** Total + specified cost of playing a card from hand, after cost-reducing effects (none modelled yet). */
export function playCost(ctx: GameContext, s: GameState, id: string, x = 0): { total: number; specified: Partial<Record<Color, number>> } {
  const d = def(ctx, s, id);
  const total = d.energyCost === "X" ? x : (d.energyCost ?? 0);
  const specified = d.energyCost === "X" ? {} : specifiedCostOf(d);
  const owner = s.cards[id].owner;
  // A [Permanent] cost reducer lowers both the total and the specified cost (20-21-2).
  let reduction = 0;
  for (const e of staticEffects(ctx, s)) if (e.kind === "cost" && e.target === id) reduction += e.value as number;
  let cut = { total: Math.max(0, total - reduction), specified: { ...specified } };
  for (let left = reduction; left > 0; left--) {
    const c = (Object.keys(cut.specified) as Color[]).find((k) => (cut.specified[k] ?? 0) > 0);
    if (!c) break;
    cut.specified[c] = cut.specified[c]! - 1;
    if (!cut.specified[c]) delete cut.specified[c];
  }
  // 22-19: [Warrior of Universe 7] on a card the player controls removes specified costs of Universe 7 cards.
  if (d.traits.some((t) => /universe 7/i.test(t)) && [s.players[owner].leader, ...s.players[owner].battle].some((c) => c && has(ctx, s, c, "Warrior of Universe 7"))) {
    cut = { total: cut.total, specified: {} };
  }
  return cut;
}

export function canAffordPlay(ctx: GameContext, s: GameState, p: PlayerId, id: string, x = 0): boolean {
  const c = playCost(ctx, s, id, x);
  const d = def(ctx, s, id);
  if (d.zEnergyCost != null && s.players[p].zEnergy.length < d.zEnergyCost) return false;
  return planPayment(ctx, s, p, c.total, c.specified) !== null;
}

export function canAffordCombo(ctx: GameContext, s: GameState, p: PlayerId, id: string): boolean {
  const d = def(ctx, s, id);
  if (!canCombo(d)) return false;
  return planPayment(ctx, s, p, d.comboCost ?? 0, {}) !== null;
}

// ── misc ───────────────────────────────────────────────────────────────────

export function opponent(s: GameState, p: PlayerId): PlayerId {
  return other(p);
}

export function isLeader(ctx: GameContext, s: GameState, id: string): boolean {
  return baseType(def(ctx, s, id)) === "LEADER" || areaOf(s, id) === "leader";
}

export function cardsInPlay(s: GameState, p: PlayerId): string[] {
  const ps = s.players[p];
  return [ps.leader, ...(ps.unison ? [ps.unison] : []), ...ps.battle].filter(Boolean);
}

export function note(ev: GameEvent[], text: string): void {
  ev.push({ type: "note", text });
}
