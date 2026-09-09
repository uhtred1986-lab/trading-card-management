/**
 * State helpers: where a card is, moving it (with the "new card" rules of
 * 3-1-4 and the removal rules for tokens and Z-cards), what its face says,
 * how much power it has, and paying costs. Everything mutates the state it
 * is given; `engine.ts` clones before calling.
 */
import { hasKeyword, keywordOf, skillsOf, specifiedCostOf, isZ, baseType } from "./cards";
import { matches, powerRelOk } from "./filters";
import { NO_RULES, type Amount, type CardScripts, type Cond, type Op, type Ref, type ScriptArea, type ScriptFrame, type Selector, type Side } from "./script";
import type {
  Area,
  CardDef,
  CardFace,
  Color,
  ContinuousEffect,
  DelayedEffect,
  DelayTiming,
  EffectUntil,
  ForbiddenAction,
  FlowStep,
  Immunity,
  Permission,
  Prohibition,
  GameEvent,
  GameState,
  KeywordSkill,
  PlayerId,
  PlayerState,
  Requirement,
  Skill,
  SkillKind,
} from "./types";
import { other } from "./types";

export interface GameContext {
  defs: Record<string, CardDef>;
  /**
   * The rules the cards play by, from `card_rules`: keyed by catalog id for a
   * front and `<id>#back` for a leader's awakened side. Nothing in the engine
   * compiles text — a card with no entry here has no rules and is played as
   * blank, and the log says so.
   */
  scripts?: Record<string, CardScripts>;
}

/** The programs of one card face, as the game was given them. */
export function programsOf(ctx: GameContext, d: CardDef, side: "front" | "back"): CardScripts {
  return ctx.scripts?.[side === "back" ? `${d.id}#back` : d.id] ?? NO_RULES;
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
  /**
   * Which departures it replaces. Absent is any of them ("would leave the
   * Battle Area"); `"skill"` is only an effect putting the card out; `"ko"`
   * only the KO; `"skillOrKo"` is what BT30-016 prints — "would be removed
   * from a Battle Area by a skill **or KO'd**", which is both causes and still
   * not a card leaving for a rule.
   */
  by?: "skill" | "ko" | "skillOrKo";
  /** "Add that card to your energy in Rest Mode instead" — the mode it arrives in. */
  mode?: "active" | "rest";
}

/**
 * Where this card goes instead of where it was about to go, if a skill says so.
 *
 * 9-10-2 gives the choice to the affected player when several replacements
 * apply at once. Two on the same card is rare enough that the first one wins
 * here and the log says which; when that turns up in a real game it is one
 * prompt away.
 */
function replacementFor(ctx: GameContext, s: GameState, id: string, reason: MoveOptions["reason"]): Replacement | null {
  for (const e of staticEffects(ctx, s)) {
    if (e.kind !== "replaceLeave" || e.target !== id) continue;
    const r = e.value as Replacement;
    // "By a skill" means an effect put it out, not a battle or a rule; the
    // longer form adds the KO, which is the one other cause cards name.
    if (r.by === "skill" && reason !== "effect") continue;
    if (r.by === "ko" && reason !== "ko") continue;
    if (r.by === "skillOrKo" && reason !== "effect" && reason !== "ko") continue;
    return r;
  }
  return null;
}

/** What a card counts as, once its skills have had their say (20-1). */
export interface Gains {
  traits: string[];
  characters: string[];
  colors: Color[];
  /** "This card is also treated as {Planet M-2} in all areas" — a whole card name, not a character. */
  names: string[];
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
  const out = { ...d, traits: [...d.traits], characters: [...d.characters], colors: [...d.colors], alsoNames: [...(d.alsoNames ?? [])] };
  const add = (list: string[], more: string[]) => {
    for (const x of more) if (!list.some((y) => y.toLowerCase() === x.toLowerCase())) list.push(x);
  };
  for (const e of gains) {
    const g = e.value as Gains;
    add(out.traits, g.traits);
    add(out.characters, g.characters);
    add(out.colors, g.colors);
    // A name it is *also* treated as; the printed one is never replaced, so a
    // filter naming either finds the card (`namesOf` in `filters.ts`).
    add(out.alsoNames, g.names ?? []);
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

/**
 * The listed areas, hottest and smallest first. `areaOf` is asked about cards
 * in play far more often than about anything else, and a deck of fifty was
 * being scanned twice before the Battle Area was looked at once.
 */
const SEARCH_ORDER = ["battle", "energy", "hand", "drop", "combo", "life", "zEnergy", "warp", "zDeck", "removed", "deck"] as const;

/**
 * Where each card was last found, per state.
 *
 * Only ever a *hint*: every read checks the remembered slot still holds the
 * card before trusting it, which is O(1), so a mutation that does not go
 * through `move` — an evolve splicing an array, a card placed under another —
 * cannot make this wrong. It can only make it miss and fall back to the scan.
 * A `WeakMap` keyed on the state means a cloned state simply starts cold.
 */
const lastSeen = new WeakMap<GameState, Map<string, Location>>();

function stillThere(s: GameState, id: string, at: Location): boolean {
  const ps = s.players[at.owner];
  if (at.area === "leader") return ps.leader === id;
  if (at.area === "unison") return ps.unison === id;
  return ps[at.area][at.index] === id;
}

/** Scan both players' areas for a card. */
export function locate(s: GameState, id: string): Location | null {
  let hints = lastSeen.get(s);
  if (!hints) lastSeen.set(s, (hints = new Map()));
  const hint = hints.get(id);
  // A fresh object every time: callers get a plain value they cannot alias
  // into the cache by accident.
  if (hint && stillThere(s, id, hint)) return { ...hint };
  for (const p of ["p1", "p2"] as PlayerId[]) {
    const ps = s.players[p];
    if (ps.leader === id) return remember(hints, id, { owner: p, area: "leader", index: 0 });
    if (ps.unison === id) return remember(hints, id, { owner: p, area: "unison", index: 0 });
    for (const area of SEARCH_ORDER) {
      const i = ps[area].indexOf(id);
      if (i >= 0) return remember(hints, id, { owner: p, area, index: i });
    }
  }
  hints.delete(id);
  return null;
}

function remember(hints: Map<string, Location>, id: string, at: Location): Location {
  hints.set(id, at);
  return { ...at };
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

/**
 * 9-1-5: all of a card's skills are negated — for the rest of the game
 * (`negated: "all"`, cleared when the card leaves play) or for a duration,
 * carried as a continuous effect so it ends when the turn does.
 */
export function skillsNegated(s: GameState, id: string): boolean {
  const inst = s.cards[id];
  return inst.negated === "all" || s.effects.some((e) => e.kind === "negateSkills" && e.target === id);
}

/** One skill of a card is negated: by index for the game, or by a turn-long effect. */
export function skillNegated(s: GameState, id: string, index: number, kind?: SkillKind): boolean {
  const inst = s.cards[id];
  if (inst.negated === "all" || inst.negated.includes(index)) return true;
  if (s.effects.some((e) => e.kind === "negateSkill" && e.target === id && e.value === index)) return true;
  // 9-1-5: "negate that card's [Auto] skill for the turn" — a whole kind at
  // once. A printed "[Counter]" covers every counter kind, so the stored value
  // is a prefix of the skill kind rather than the whole of it.
  return !!kind && s.effects.some((e) => e.kind === "negateSkillKind" && e.target === id && kind.startsWith(e.value as string));
}

export function skillsOfInstance(ctx: GameContext, s: GameState, id: string): Skill[] {
  const inst = s.cards[id];
  if (inst.hidden || skillsNegated(s, id)) return [];
  const d = def(ctx, s, id);
  return skillsOf(d, inst.flipped && d.back ? "back" : "front");
}

/** Keywords in force: printed (unless negated) plus granted by continuous effects. */
export function keywordsInForce(ctx: GameContext, s: GameState, id: string): KeywordSkill[] {
  const inst = s.cards[id];
  const out: KeywordSkill[] = [];
  for (const e of staticEffects(ctx, s)) if (e.kind === "keyword" && e.target === id) out.push(e.value as KeywordSkill);
  if (!inst.hidden && !skillsNegated(s, id)) {
    const d = def(ctx, s, id);
    const side = inst.flipped && d.back ? "back" : "front";
    for (const sk of skillsOf(d, side)) {
      if (skillNegated(s, id, sk.index, sk.kind)) continue;
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
  // card. Applied last, so it beats a grant of the same keyword — and the
  // prohibition that saves it (20-14) is only worth asking about when there is
  // something to save it from. This runs for every keyword check in the game.
  const gone = new Set(
    staticEffects(ctx, s)
      .filter((e) => e.kind === "negateKeyword" && e.target === id)
      .map((e) => e.value as KeywordSkill["name"]),
  );
  if (!gone.size) return out;
  if (forbids(ctx, s, "beNegated", { card: id })) return out;
  return out.filter((k) => !gone.has(k.name));
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

/**
 * 5-7-3, 20-21: the combo cost as it stands, after any reducer — a standing
 * one from a [Permanent], or a timed one an [Auto] put in force for the turn.
 */
export function comboCostOf(ctx: GameContext, s: GameState, id: string): number {
  const base = def(ctx, s, id).comboCost ?? 0;
  let reduction = 0;
  for (const e of staticEffects(ctx, s)) if (e.kind === "comboCost" && e.target === id) reduction += e.value as number;
  for (const e of s.effects) if (e.kind === "comboCost" && e.target === id) reduction += e.value as number;
  return Math.max(0, base - reduction);
}

/**
 * 5-4, 20-21: the Z-Energy cost as it stands, after any reducer — the same
 * shape as `comboCostOf`. Every site that pays or gates a Z-Energy cost
 * (`payZEnergy`'s two call sites and the three legality gates around it in
 * `engine.ts`) has to go through this rather than read `d.zEnergyCost` raw,
 * or a "reduce the Z-Energy cost of X in your Z-Deck by N" skill compiles,
 * reads correctly and changes nothing on the board.
 */
export function zEnergyCostOf(ctx: GameContext, s: GameState, id: string): number {
  const base = def(ctx, s, id).zEnergyCost ?? 0;
  let reduction = 0;
  for (const e of staticEffects(ctx, s)) if (e.kind === "zEnergy" && e.target === id) reduction += e.value as number;
  for (const e of s.effects) if (e.kind === "zEnergy" && e.target === id) reduction += e.value as number;
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
              : sel.special === "resolving"
                ? // 9-6: the card whose play this skill is answering.
                  (s.resolving?.card ?? null)
                : sel.special === "leader"
                  ? s.players[frame.master].leader
                  : sel.special === "onTop"
                    ? // 23-2: the card whose pile holds this one. Null while
                      // the card is in no pile, which is most of the time —
                      // these skills are printed on the card that gets buried.
                      hostOf(s, frame.card)
                    : s.players[other(frame.master)].leader;
    out = pick && s.cards[pick] ? [pick] : [];
  } else if (sel.fromVar) {
    out = (frame.vars[sel.fromVar] ?? []).filter((id) => s.cards[id]);
  } else {
    // A phrase may name two areas — "your opponent's Battle Cards or Unisons".
    const areas = sel.areas?.length ? sel.areas : [sel.area ?? "battle"];
    for (const p of sideOf(frame.master, sel.side)) for (const area of areas) out.push(...areaCards(s, p, area, frame));
  }
  // "The top 2 cards of your deck" — the area's own order decides, and the
  // filter is not applied first, because the cards are not being searched for.
  if (sel.take != null) out = sel.fromEnd ? out.slice(Math.max(0, out.length - sel.take)) : out.slice(0, sel.take);
  return out.filter((id) => {
    const inst = s.cards[id];
    if (!inst) return false;
    if (sel.mode && inst.mode !== sel.mode) return false;
    // 23-5-2: a Hidden Mode selector asks *for* the very cards the rule below
    // would otherwise exclude from a filtered choice, so it is answered here,
    // ahead of `sel.filter`, and never alongside it.
    if (sel.hidden != null && inst.hidden !== sel.hidden) return false;
    // "…other than this card" / "…other than copies of this card": the one
    // card the phrase says the target is not.
    if (sel.notSelf && frame.card) {
      if (id === frame.card) return false;
      if (sel.notSelf === "copies" && s.cards[frame.card] && inst.cardId === s.cards[frame.card].cardId) return false;
    }
    // A named target that also names an area only matches while it is there.
    // A delayed effect resolves turns later, and by then "this card" may have
    // left the Battle Area — in which case it is no longer the same card (3-1-4).
    if (sel.special && sel.area && areaOf(s, id) !== (sel.area === "play" ? "battle" : sel.area)) return false;
    // 23-5-2: a Hidden Mode card has none of its front-side information.
    if (sel.filter && (inst.hidden || !matches(cardNow(ctx, s, id), sel.filter))) return false;
    // 3-9-2-1: whether a life card has been turned face up is a fact about
    // this copy, not about the card, so `matches` cannot see it.
    if (sel.filter?.faceUp && !inst.faceUp) return false;
    // "with power less than or equal to this card's power": measured against
    // the card the skill is on, as it stands now.
    if (sel.filter?.powerRel && !powerRelOk(sel.filter, powerOf(ctx, s, id), powerOf(ctx, s, frame.card))) return false;
    if (!sel.special && !sel.ignoreBarrier && sel.side !== "you" && has(ctx, s, id, "Barrier") && s.cards[id].owner !== frame.master && areaOf(s, id) !== "hand") return false;
    // 20-4: the same shape as [Barrier], but printed as a prohibition.
    if (!sel.special && s.cards[id].owner !== frame.master && forbids(ctx, s, "beChosen", { card: id })) return false;
    // 9-1-4: a card no skill may touch. Narrower than the rule — this only
    // catches an effect that *chooses* the card, not one that never does —
    // and the glossary says so; `!sel.special` keeps the card usable as an
    // attacker or a guard, which is right.
    if (!sel.special && s.cards[id].owner !== frame.master && isImmuneTo(ctx, s, id, frame.card)) return false;
    return true;
  });
}

export function resolveRef(ctx: GameContext, s: GameState, frame: ScriptFrame, ref: Ref): string[] {
  if ("var" in ref) {
    const taken = ref.minus ? new Set(frame.vars[ref.minus] ?? []) : null;
    return (frame.vars[ref.var] ?? []).filter((id) => s.cards[id] && !taken?.has(id));
  }
  return resolveSelector(ctx, s, frame, ref.sel);
}

/** The markers on the selected cards, added up (13-2) — the one sum both the `markers` condition and the `markers` amount ask for. */
function markersOn(ctx: GameContext, s: GameState, frame: ScriptFrame, sel: Selector): number {
  return resolveSelector(ctx, s, frame, sel).reduce((t, id) => t + s.cards[id].markers, 0);
}

export function amount(ctx: GameContext, s: GameState, frame: ScriptFrame, a: Amount): number {
  if (typeof a === "number") return a;
  if ("var" in a) return (frame.vars[a.var] ?? []).length;
  if ("sumPower" in a) return (frame.vars[a.sumPower.var] ?? []).reduce((t, id) => t + powerOf(ctx, s, id), 0);
  if ("handUpTo" in a) return Math.max(0, a.handUpTo - s.players[frame.master].hand.length);
  if ("markers" in a) return markersOn(ctx, s, frame, a.markers) * (a.times ?? 1);
  return resolveSelector(ctx, s, frame, a.count).length * (a.times ?? 1);
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
      if (!l) return false;
      if (c.back) {
        // "If your Leader's back side is {Name}": the other face, whichever is up.
        const back = def(ctx, s, l).back;
        return !!back && matches({ ...cardNow(ctx, s, l), name: back.name }, c.filter);
      }
      return matches(cardNow(ctx, s, l), c.filter);
    }
    case "markers": {
      const n = markersOn(ctx, s, frame, c.sel);
      return (c.atLeast == null || n >= c.atLeast) && (c.atMost == null || n <= c.atMost);
    }
    case "inBattle": {
      const b = s.battle;
      const inBattle =
        !!b && resolveSelector(ctx, s, frame, c.sel).some((id) => (c.role === "attacker" ? b.attacker === id : c.role === "guard" ? b.guard === id : b.attacker === id || b.guard === id));
      return c.not ? !inBattle : inBattle;
    }
    case "battled":
      return resolveSelector(ctx, s, frame, c.sel).some((id) => s.cards[id]?.battledThisTurn);
    case "every": {
      const ids = resolveSelector(ctx, s, frame, c.sel);
      // Nothing there is not "all of it" — see the note on the Cond.
      if (!ids.length) return false;
      const ok = new Set(resolveSelector(ctx, s, frame, c.matching));
      return ids.every((id) => ok.has(id));
    }
    case "any":
      return c.conds.some((x) => condHolds(ctx, s, frame, x));
    case "all":
      return c.conds.every((x) => condHolds(ctx, s, frame, x));
    case "leaderFlipped": {
      const l = s.players[c.side === "opponent" ? other(frame.master) : frame.master].leader;
      return !!l && s.cards[l].flipped === (c.flipped ?? true);
    }
    case "did":
      return !!frame.did?.[c.what];
    case "not":
      return !condHolds(ctx, s, frame, c.cond);
    case "power":
      return resolveSelector(ctx, s, frame, c.sel).some((id) => {
        const n = powerOf(ctx, s, id);
        return (c.atLeast == null || n >= c.atLeast) && (c.atMost == null || n <= c.atMost);
      });
    case "lifeVsOpponent": {
      const mine = s.players[frame.master].life.length;
      const theirs = s.players[other(frame.master)].life.length;
      return c.atLeast ? mine >= theirs : mine <= theirs;
    }
    case "chose":
      return (frame.vars[c.var] ?? []).length >= (c.atLeast ?? 1);
    // "If that card is a Battle Card": any of the cards the reveal or look
    // bound to the name. A name that bound nothing is not a match.
    case "varMatches":
      return (frame.vars[c.var] ?? []).some((id) => s.cards[id] && matches(cardNow(ctx, s, id), c.filter));
    case "isTurnPlayer":
      return c.who === "opponent" ? s.turnPlayer !== frame.master : s.turnPlayer === frame.master;
  }
}

// ── static effects from [Permanent] skills (9-5, 9-9) ──────────────────────

/** Another way to pay for a card's [Counter] skill (5-3). */
export interface AltCost {
  /**
   * `invoker`: rest one active Red/Blue multicolour energy instead (22-37).
   * `program`: an action the card names — "by choosing 1 other black card in
   * your hand and placing it in your Drop" — compiled by the same reader as an
   * ordinary action price (4-3-3) and charged the same way, through the flow,
   * because most of them need the player to pick a card. `energy`: a reduced
   * but still-energy price — "by paying {1} instead of its energy cost"
   * (BT18-088) — read the same way a printed cost's orbs are (`orbs`).
   */
  pay: "none" | "life" | "invoker" | "program" | "energy";
  /** Cards to add from your life to your hand, for `pay: "life"`. */
  n: number;
  /** Which cost it replaces: the [Counter] skill's, or playing the card. */
  for: "counter" | "play";
  /** The price to run, for `pay: "program"`. */
  ops?: Op[];
  /** The orbs to rest, one entry per orb, for `pay: "energy"`. */
  orbs?: (Color | "any")[];
}

export interface StaticEffect {
  source: string;
  kind: "power" | "comboPower" | "keyword" | "cost" | "comboCost" | "zEnergy" | "negateKeyword" | "gains" | "replaceLeave" | "forbid" | "permit" | "immune" | "altCost";
  /** The card it is about; empty for a rule about a player rather than a card. */
  target: string;
  value: number | KeywordSkill | KeywordSkill["name"] | Prohibition | Permission | Immunity | AltCost | Gains | Replacement;
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
        if (!inst || inst.hidden || skillsNegated(s, src)) continue;
        const d = def(ctx, s, src);
        const side = inst.flipped && d.back ? "back" : "front";
        const scripts = programsOf(ctx, d, side);
        const inPlayNow = inPlay(s, src);
        for (const sk of skillsOf(d, side)) {
          if (sk.kind !== "permanent") continue;
          if (skillNegated(s, src, sk.index, sk.kind)) continue;
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
 * Whether one [Permanent] skill of one card is doing anything right now: the
 * standing effects it emits at this moment, on this board. Empty when its
 * condition does not hold ("during your turn" on the opponent's turn), when
 * its selector finds nothing, or when the card is somewhere the skill is not
 * valid. This is what lets a client mark a [Permanent] as on or off, which
 * the compile figures cannot say. Null while the statics are already being
 * computed, and for a skill that is not a [Permanent].
 */
export function permanentStatics(ctx: GameContext, s: GameState, card: string, skillIndex: number): StaticEffect[] | null {
  if (computingStatics) return null;
  const inst = s.cards[card];
  if (!inst || inst.hidden || skillsNegated(s, card)) return [];
  const d = def(ctx, s, card);
  const side = inst.flipped && d.back ? "back" : "front";
  const sk = skillsOf(d, side).find((k) => k.index === skillIndex);
  if (!sk || sk.kind !== "permanent") return null;
  if (skillNegated(s, card, sk.index, sk.kind)) return [];
  const sc = programsOf(ctx, d, side).bySkill[sk.index];
  if (!sc || sc.unsupported.length) return [];
  // The same areas `staticEffects` reads from (9-1-3-1): anywhere else the
  // skill is not valid, so it applies nothing.
  const p = inst.owner;
  const at = areaOf(s, card);
  const master = at === "hand" || at === "zDeck" ? p : (locate(s, card)?.owner ?? p);
  if (!(inPlay(s, card) || at === "hand" || at === "zDeck")) return [];
  computingStatics = true;
  try {
    const out: StaticEffect[] = [];
    collectStatics(ctx, s, out, card, master, sc.ops, inPlay(s, card));
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

/**
 * The ops `collectStatics` below turns into a standing effect. Anything else
 * in a [Permanent] program is **inert**: the skill compiles and then does
 * nothing, which no compile figure can show. `emitsStatic` is what
 * `arena:coverage` uses so its "applied by the static layer" line means what
 * it says — keep this list beside the switch it describes.
 */
const STATIC_OPS = new Set<Op["op"]>(["power", "comboPower", "grant", "costReduction", "replaceLeave", "gains", "negateKeyword", "forbid", "permit", "immune", "altCost"]);

export function emitsStatic(ops: Op[]): boolean {
  return ops.some((o) => (o.op === "if" ? emitsStatic(o.then) || emitsStatic(o.else ?? []) : STATIC_OPS.has(o.op)));
}

function collectStatics(ctx: GameContext, s: GameState, out: StaticEffect[], source: string, master: PlayerId, ops: Op[], inPlayNow: boolean): void {
  const frame: ScriptFrame = { ops: [], ip: 0, vars: {}, card: source, master };
  for (const op of ops) {
    if (op.op === "if") {
      if (condHolds(ctx, s, frame, op.cond)) collectStatics(ctx, s, out, source, master, op.then, inPlayNow);
      else if (op.else) collectStatics(ctx, s, out, source, master, op.else, inPlayNow);
      continue;
    }
    if (op.op === "costReduction") {
      const kind = op.what === "combo" ? "comboCost" : op.what === "zEnergy" ? "zEnergy" : "cost";
      // "…by 1 for each of your blue Battle Cards" — the same count/markers
      // amounts the power statics take, and for the same reason: a
      // [Permanent] has no frame that ever bound a variable, so only those two
      // can be evaluated.
      const value = typeof op.amount === "number" ? op.amount : "count" in op.amount || "markers" in op.amount ? amount(ctx, s, frame, op.amount) : null;
      if (value == null) continue;
      for (const id of staticTargets(ctx, s, frame, op.target)) out.push({ source, kind, target: id, value });
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
      for (const id of targets) out.push({ source, kind: "replaceLeave", target: id, value: { to: dest, by: op.by, mode: op.mode } });
      continue;
    }
    // "In all areas" again: what a card counts as does not depend on where it is.
    if (op.op === "gains") {
      const targets = op.target ? staticTargets(ctx, s, frame, op.target) : [source];
      for (const id of targets) out.push({ source, kind: "gains", target: id, value: { traits: op.traits ?? [], characters: op.characters ?? [], colors: op.colors ?? [], names: op.names ?? [] } });
      continue;
    }
    if (op.op === "negateKeyword") {
      const targets = op.target ? staticTargets(ctx, s, frame, op.target) : [source];
      for (const id of targets) out.push({ source, kind: "negateKeyword", target: id, value: op.keyword });
      continue;
    }
    // Like a cost reducer, this one is about the card in hand, so it is read
    // whether or not the card is on the table. Printed on the card itself
    // this is about that card alone (no `target`); a duration (`until`) means
    // it was granted to other cards for a span instead, which holds through
    // the timed path in `exec` (script.ts) rather than here — a [Permanent]
    // never resolves, so nothing would ever expire it.
    if (op.op === "altCost") {
      if (op.until) continue;
      const targets = op.target ? staticTargets(ctx, s, frame, op.target) : [source];
      const value: AltCost = { pay: op.pay, n: op.n ?? 1, for: op.for ?? "counter", ...(op.ops ? { ops: op.ops } : {}), ...(op.orbs ? { orbs: op.orbs } : {}) };
      for (const id of targets) out.push({ source, kind: "altCost", target: id, value });
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
        for (const id of staticTargets(ctx, s, frame, op.target)) out.push({ source, kind: "forbid", target: id, value: { what: op.what, player, bySkill: op.bySkill } });
      } else {
        out.push({ source, kind: "forbid", target: "", value: { what: op.what, player, filter: op.filter, name, bySkill: op.bySkill } });
      }
      continue;
    }
    // 9-1-4: a card no skill may touch, printed as a [Permanent] on most of
    // the cards that have it — so it belongs here, stored the same way
    // `forbid` is, with `op.until` unused for the same reason.
    if (op.op === "immune") {
      if (!inPlayNow) continue;
      const player = op.from && op.from !== "both" ? sideOf(master, op.from)[0] : undefined;
      const targets = op.target ? staticTargets(ctx, s, frame, op.target) : [source];
      for (const id of targets) out.push({ source, kind: "immune", target: id, value: { from: player, fromFilter: op.fromFilter } });
      continue;
    }
    // 8-1-1 the other way round. Printed as a [Permanent] on most of the cards
    // that have it ("This card can attack Battle Cards in Active Mode"), so it
    // belongs here beside the prohibition it mirrors.
    if (op.op === "permit") {
      if (!inPlayNow) continue;
      for (const id of staticTargets(ctx, s, frame, op.target)) out.push({ source, kind: "permit", target: id, value: { what: op.what, filter: op.filter } });
      continue;
    }
    if (!inPlayNow) continue; // the rest only hold while the card is in play
    if (op.op === "power" || op.op === "comboPower") {
      // "+5000 power for each card placed under it", "+5000 power for each
      // marker on this card" — a number read off the board. Only `count` and
      // `markers` amounts: the others are named by a variable, and a
      // [Permanent] has no frame that ever bound one. `staticEffects` refuses
      // to recurse, so the count may safely ask the board about itself.
      const value = typeof op.amount === "number" ? op.amount : "count" in op.amount || "markers" in op.amount ? amount(ctx, s, frame, op.amount) : null;
      if (value == null) continue;
      for (const id of staticTargets(ctx, s, frame, op.target)) out.push({ source, kind: op.op, target: id, value });
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

/**
 * Cards under a card are in no area of their own (23-2), so `locate` cannot
 * see them and nothing that moves a card could take one out. A skill that
 * plays a card *out* of a pile — "play up to 1 card from under this card" —
 * needs this, or the card is added to its new area while still in the pile and
 * exists twice.
 */
/**
 * The card `id` is under, or null when it is not in a pile — the other half of
 * the `under` area (23-2). A pile is held as a list on the card at the top, so
 * there is exactly one answer and it is found by asking who holds this card;
 * a stack is one card with everything else beneath it (23-2-2), so "the card
 * on top of this card" is never a card halfway up.
 */
export function hostOf(s: GameState, id: string): string | null {
  for (const [host, inst] of Object.entries(s.cards)) if (inst.under.includes(id)) return host;
  return null;
}

export function liftFromPile(s: GameState, id: string): boolean {
  for (const inst of Object.values(s.cards)) {
    const i = inst.under.indexOf(id);
    if (i < 0) continue;
    inst.under.splice(i, 1);
    return true;
  }
  return false;
}

/** Take a card out of wherever it is. Returns where it was. */
export function detach(s: GameState, id: string): Location | null {
  const loc = locate(s, id);
  if (!loc) {
    liftFromPile(s, id);
    return null;
  }
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
  let insteadMode: "active" | "rest" | undefined;
  if (wasInPlay && !goesToPlay && !goesToCombo) {
    const instead = replacementFor(ctx, s, id, opts.reason);
    if (instead && instead.to !== to) {
      note(ev, `${face(ctx, s, id).name} goes to the ${instead.to} instead`);
      to = instead.to;
      insteadMode = instead.mode;
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
    // 3-1-4: a card that changes area is a new card, and a life card turned
    // face up (3-9-2-1) is not still face up once it has left the life area.
    inst.faceUp = false;
    inst.negated = [];
    inst.usedThisTurn = [];
    inst.extraAttacks = 0;
    s.effects = s.effects.filter((e) => e.target !== id);
  }
  if (goesToPlay || goesToCombo) inst.enteredTurn = s.turn;
  // 22-31: [Energy-Exhaust] enters the Energy Area rested.
  if (to === "energy" && hasKeyword(d, "Energy-Exhaust")) inst.mode = "rest";
  // "…add that card to your energy in Rest Mode instead": the replacement says
  // how the card arrives as well as where, and it is applied after the reset
  // above, which had just switched it back to Active Mode.
  if (insteadMode) inst.mode = insteadMode;

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
 * stack to the Drop when the card on top leaves play (23-2-5), and a card that
 * arrives with a pile of its own has that pile flattened into the host's, the
 * same way `stackOnto`, Potara and [Z-Awaken] do it.
 */
export function placeUnder(ctx: GameContext, s: GameState, ev: GameEvent[], id: string, host: string): boolean {
  if (id === host || !s.cards[id] || !s.cards[host]) return false;
  const from = areaOf(s, id);
  // 3-1-2: a Leader Card does not leave the Leader Area, not even downwards.
  if (from === "leader") return false;
  // Nothing can go under a card that is not on the table.
  const hostArea = areaOf(s, host);
  if (!["battle", "leader", "unison"].includes(hostArea ?? "")) return false;
  detach(s, id);
  const inst = s.cards[id];
  inst.mode = "active";
  inst.markers = 0;
  inst.flipped = false;
  inst.hidden = false;
  inst.negated = [];
  inst.usedThisTurn = [];
  // A card that already had a pile of its own — an evolved Battle Card, a
  // Z-Stack — takes it along into an area of the same name (23-2-6) and leaves
  // it in the owners' Drop Areas when the name changes (23-2-5). Either way a
  // stack stays one flat list: a pile hanging off a card that is itself in a
  // pile is in no area at all, nothing in the engine reads one, and the cards
  // in it would simply cease to exist.
  const carried = inst.under.splice(0);
  const follows = from === null || from === hostArea;
  // 23-2-3 keeps the order they were in; 23-2-4 puts them on the very bottom.
  s.cards[host].under.push(id, ...(follows ? carried : []));
  if (!follows) {
    for (const u of carried) {
      // 14-1-4: a Z-card is removed from the game rather than dropped.
      const dest: Area = isZ(ctx.defs[s.cards[u].cardId]) ? "removed" : "drop";
      s.players[s.cards[u].owner][dest].unshift(u);
      ev.push({ type: "move", card: u, from: from!, to: dest, owner: s.cards[u].owner });
    }
  }
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

export function addEffect(s: GameState, ev: GameEvent[], e: Omit<ContinuousEffect, "id" | "createdTurn" | "ownerTurn" | "master"> & { master?: PlayerId }): ContinuousEffect {
  const full: ContinuousEffect = { ...e, master: e.master ?? s.turnPlayer, id: s.nextEffectId++, createdTurn: s.turn, ownerTurn: s.turnPlayer };
  s.effects.push(full);
  ev.push({ type: "effect", effect: full });
  return full;
}

/**
 * Take effects out of force, saying so: every one that ends gets an
 * `effectEnded` event, which is the beat a client draws the number changing
 * back on. `keep` says which stay.
 */
function dropEffects(s: GameState, ev: GameEvent[], keep: (e: ContinuousEffect) => boolean): void {
  const kept: ContinuousEffect[] = [];
  for (const e of s.effects) {
    if (keep(e)) kept.push(e);
    else ev.push({ type: "effectEnded", effect: e });
  }
  s.effects = kept;
}

export function endEffects(s: GameState, ev: GameEvent[], until: ContinuousEffect["until"], forPlayer?: PlayerId): void {
  dropEffects(s, ev, (e) => !(e.until === until && (forPlayer == null || e.ownerTurn === forPlayer)));
}

/**
 * "…will not switch to Active Mode during your next Charge Phase": spent by
 * the Active Step it was written for (7-2-7), on the cards that step covered.
 */
export function endAfterChargeEffects(s: GameState, ev: GameEvent[], cards: string[]): void {
  dropEffects(s, ev, (e) => !(e.until === "afterNextCharge" && cards.includes(e.target)));
}

/**
 * The two durations written from the controller's point of view rather than
 * the turn's, expired as a turn opens (9-9):
 *
 * - **"until the end of your opponent's turn"** (`nextTurn`) ends as the
 *   controller's own next turn begins.
 * - **"until the start of your opponent's next turn"** (`opponentTurn`) ends
 *   as that opponent's next turn begins.
 *
 * Both used to be read against the turn player *at the time the effect was
 * made*, which is right only when the controller made it on their own turn. A
 * [Counter] resolves on the opponent's turn by definition, so every effect one
 * of those created outlasted its wording by a whole turn.
 */
export function endTurnRelativeEffects(s: GameState, ev: GameEvent[]): void {
  dropEffects(s, ev, (e) => {
    if (e.createdTurn >= s.turn) return true;
    if (e.until === "nextTurn") return s.turnPlayer !== e.master;
    if (e.until === "opponentTurn") return s.turnPlayer === e.master;
    return true;
  });
}

// ── prohibitions (20-14, 0-2-5) ────────────────────────────────────────────

/**
 * Whether something is forbidden right now. 0-2-5: a prohibition beats an
 * instruction, so this is the last question asked and its answer is final.
 *
 * `card` is what the action is about — the attacker, the card being played,
 * the card that would switch to Active Mode. `player` is who is acting.
 */
/**
 * A card's own [Permanent] prohibitions, read wherever the card is (9-1-3-3).
 *
 * `staticEffects` reads the areas whose skills are ordinarily valid — play, the
 * hand and the Z-Deck — and that is right for a skill about the board. The
 * cards that forbid their *own* play say "from any area" on purpose, and the
 * moment that matters is a skill reaching into the Drop or the deck for them,
 * where nothing would have read the skill at all. Rather than widen the static
 * layer to every area for every card, which would put a fifty-card deck through
 * it on each call, this reads the one card being asked about.
 */
function ownProhibitions(ctx: GameContext, s: GameState, card: string): Prohibition[] {
  const inst = s.cards[card];
  if (!inst || inst.hidden || skillsNegated(s, card)) return [];
  const d = def(ctx, s, card);
  const side = inst.flipped && d.back ? "back" : "front";
  const scripts = programsOf(ctx, d, side);
  const out: Prohibition[] = [];
  for (const sk of skillsOf(d, side)) {
    if (sk.kind !== "permanent" || skillNegated(s, card, sk.index, sk.kind)) continue;
    const sc = scripts.bySkill[sk.index];
    if (!sc || sc.unsupported.length) continue;
    for (const op of sc.ops) {
      // Only a rule the card states about itself, and only the ones it means to
      // hold everywhere: anything aimed at other cards is the static layer's.
      if (op.op !== "forbid" || op.until !== "game" || op.bySkill === undefined) continue;
      if (!op.target || !("sel" in op.target) || op.target.sel.special !== "self") continue;
      out.push({ what: op.what, bySkill: op.bySkill });
    }
  }
  return out;
}

/**
 * 9-1-4: whether `id` is immune to a skill whose source card is `source`.
 * The one place this is checked (`resolveSelector`, beside [Barrier] and
 * `forbid: "beChosen"`), so unlike `forbids` it takes no `player` — the
 * caller already only asks when someone other than the card's own owner is
 * choosing, which is exactly what a stored `from` names.
 */
function isImmuneTo(ctx: GameContext, s: GameState, id: string, source: string | undefined): boolean {
  const rules: Immunity[] = [];
  for (const e of s.effects) if (e.kind === "immune" && e.target === id && e.immune) rules.push(e.immune);
  for (const e of staticEffects(ctx, s)) if (e.kind === "immune" && e.target === id) rules.push(e.value as Immunity);
  return rules.some((im) => !im.fromFilter || (!!source && !!s.cards[source] && matches(cardNow(ctx, s, source), im.fromFilter)));
}

export function forbids(ctx: GameContext, s: GameState, what: ForbiddenAction, opts: { player?: PlayerId; card?: string; bySkill?: boolean } = {}): boolean {
  const rules: { target: string; forbid: Prohibition }[] = [];
  for (const e of s.effects) if (e.kind === "forbid" && e.forbid) rules.push({ target: e.target, forbid: e.forbid });
  // A prohibition printed as a [Permanent] skill holds while the card is in
  // play, with no duration to expire (9-5-1).
  for (const e of staticEffects(ctx, s)) if (e.kind === "forbid") rules.push({ target: e.target, forbid: e.value as Prohibition });
  // 9-1-3-3: and the card's own, wherever it is — see `ownProhibitions`.
  if (opts.card) for (const f of ownProhibitions(ctx, s, opts.card)) rules.push({ target: opts.card, forbid: f });

  for (const { target, forbid: f } of rules) {
    if (f.what !== what) continue;
    // "By skills" and "except by skills" are opposite halves of one wording,
    // and a rule that names one of them says nothing about the other.
    if (f.bySkill !== undefined && opts.bySkill !== undefined && f.bySkill !== opts.bySkill) continue;
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
 * The `why` twin of `forbids` (`docs/arena-workflow-spec.md` §3.2): the same
 * rules read in the same order, answering *which card's* rule forbids it
 * rather than only that one does. `null` when nothing forbids it; `by` is
 * null when the rule is a turn-long effect that names no card. Called only
 * from `rejectedActions`; `forbids` itself is untouched, so the two must be
 * kept adjacent and changed together.
 */
export function forbiddenBy(
  ctx: GameContext,
  s: GameState,
  what: ForbiddenAction,
  opts: { player?: PlayerId; card?: string; bySkill?: boolean } = {},
): { by: string | null; until: EffectUntil } | null {
  const rules: { target: string; source: string | null; until: EffectUntil; forbid: Prohibition }[] = [];
  for (const e of s.effects) if (e.kind === "forbid" && e.forbid) rules.push({ target: e.target, source: e.source ?? null, until: e.until, forbid: e.forbid });
  for (const e of staticEffects(ctx, s)) if (e.kind === "forbid") rules.push({ target: e.target, source: e.source, until: "permanent", forbid: e.value as Prohibition });
  if (opts.card) for (const f of ownProhibitions(ctx, s, opts.card)) rules.push({ target: opts.card, source: opts.card, until: "permanent", forbid: f });

  for (const { target, source, until, forbid: f } of rules) {
    if (f.what !== what) continue;
    if (f.bySkill !== undefined && opts.bySkill !== undefined && f.bySkill !== opts.bySkill) continue;
    if (target && target !== opts.card) continue;
    if (f.player && opts.player && f.player !== opts.player) continue;
    if (f.filter || f.name) {
      if (!opts.card || !s.cards[opts.card]) continue;
      const d = def(ctx, s, opts.card);
      if (f.filter && !matches(cardNow(ctx, s, opts.card), f.filter)) continue;
      if (f.name && d.name !== f.name) continue;
    }
    return { by: source && s.cards[source] ? face(ctx, s, source).name : null, until };
  }
  return null;
}

/**
 * The permissions one card carries — the mirror of `forbids`, and the reader
 * both `legalActions` and the measurement use, so they cannot drift apart.
 *
 * Returns one entry per rule that applies, because each carries its own
 * description of what may be attacked: "Battle Cards in Active Mode" and
 * "Battle Cards **without [Barrier]** in Active Mode" are different
 * permissions, and a card may hold both. An empty array means the ordinary
 * rule stands (8-1-1).
 */
export function permits(ctx: GameContext, s: GameState, card: string, what: Permission["what"]): Permission[] {
  const out: Permission[] = [];
  for (const e of s.effects) if (e.kind === "permit" && e.target === card && e.permit?.what === what) out.push(e.permit);
  for (const e of staticEffects(ctx, s)) if (e.kind === "permit" && e.target === card && (e.value as Permission).what === what) out.push(e.value as Permission);
  return out;
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
 * Whether the engine can actually charge an action price right now (4-3-3).
 *
 * Deliberately a whitelist: an op that is not on it means "no", so the skill
 * stays unoffered. Offering a skill whose price then half-runs would be worse
 * than the honest gap it is today — the effect would still happen.
 *
 * Lives here rather than in `engine.ts` because `altCostFor` just below has to
 * ask the same question about the alternative price a [Permanent] offers, and
 * one definition is the only way the two answers cannot drift apart.
 */
export function canPayCostProgram(ctx: GameContext, s: GameState, p: PlayerId, card: string, ops: Op[]): boolean {
  const frame: ScriptFrame = { ops: [], ip: 0, vars: {}, card, master: p };
  const inHand = s.players[p].hand.includes(card) ? 1 : 0;
  for (const op of ops) {
    switch (op.op) {
      case "choose": {
        // "Up to" can always be paid with nothing (5-2-4).
        if (op.sel.upTo) break;
        if (resolveSelector(ctx, s, frame, op.sel).length < (op.sel.count ?? 1)) return false;
        break;
      }
      case "discard":
        // The activating card leaves the hand as part of the activation, so
        // it is not also available to be discarded.
        if (typeof op.n !== "number" || s.players[p].hand.length - inHand < op.n) return false;
        break;
      case "mill":
        if (typeof op.n !== "number" || s.players[p].deck.length < op.n) return false;
        break;
      // A target named by a variable is whatever the `choose` in front of it
      // binds, and that choice has already been checked; nothing is bound yet
      // while this runs, so resolving it here would always find nothing.
      case "switchMode": {
        if ("var" in op.target) break;
        const cards = resolveRef(ctx, s, frame, op.target);
        if (!cards.length || cards.some((id) => s.cards[id].mode === op.mode)) return false;
        break;
      }
      case "moveTo":
        // "Under" needs a host and "play" is not an area (3-1); neither is a
        // price this can promise.
        if (op.to === "under" || op.to === "play") return false;
        if ("var" in op.target) break;
        if (!resolveRef(ctx, s, frame, op.target).length) return false;
        break;
      // "Pay the cost for [Spirit Boost 2]" (22-43-3) reads to this — the
      // marker count named is fixed the same way `discard`'s and `mill`'s are,
      // never a variable, so an amount that is not a plain number is refused
      // rather than assumed payable.
      case "removeMarker": {
        if (typeof op.n !== "number") return false;
        if ("var" in op.target) break;
        const cards = resolveRef(ctx, s, frame, op.target);
        if (!cards.length || cards.some((id) => s.cards[id].markers < (op.n as number))) return false;
        break;
      }
      default:
        return false;
    }
  }
  return true;
}

/**
 * The energy `pay: "energy"` orbs would cost, planned the same way a printed
 * cost's orbs are — null when the board cannot cover them (5-3-3).
 */
function orbPayment(ctx: GameContext, s: GameState, payer: PlayerId, orbs: (Color | "any")[]): Payment | null {
  const specified: Partial<Record<Color, number>> = {};
  for (const o of orbs) if (o !== "any") specified[o] = (specified[o] ?? 0) + 1;
  return planPayment(ctx, s, payer, orbs.length, specified);
}

/**
 * The other way this card's [Counter] skill may be paid for, if it has one
 * (5-3), and whether the player can actually meet it right now.
 *
 * Two sources, checked together because a card can offer the alternative
 * about itself (a [Permanent], read through `staticEffects`, `target` always
 * this card and never expiring) or have it granted by another card for a span
 * (a plain continuous effect, `s.effects`, with `target`/`until` of its own —
 * BT11-033's "until the start of your next turn, mono-blue [Counter] cards in
 * your hand …"). Either way the candidate still has to be affordable now.
 */
export function altCostFor(ctx: GameContext, s: GameState, card: string, payer: PlayerId, which: "counter" | "play" = "counter"): AltCost | null {
  const candidates: AltCost[] = [];
  for (const e of s.effects) if (e.kind === "altCost" && e.target === card && e.altCost) candidates.push(e.altCost);
  for (const e of staticEffects(ctx, s)) if (e.kind === "altCost" && e.target === card) candidates.push(e.value as AltCost);
  for (const alt of candidates) {
    // Programs stored before playing had its own waiver are about a [Counter].
    if ((alt.for ?? "counter") !== which) continue;
    if (alt.pay === "life" && s.players[payer].life.length < alt.n) continue;
    if (alt.pay === "energy" && !orbPayment(ctx, s, payer, alt.orbs ?? [])) continue;
    // 4-3-3: an action price is only an offer when the board can meet it, or
    // the skill happens and the price quietly does not. Only the [Counter]
    // path charges one — the two play sites pay inline and have nowhere to ask
    // — so a program offered for a play is refused rather than waived.
    if (alt.pay === "program" && (which !== "counter" || !alt.ops || !canPayCostProgram(ctx, s, payer, card, alt.ops))) continue;
    return alt;
  }
  // 22-37: [Invoker] on a card in play lets a Red/Blue multicolour Extra be
  // paid for by resting one active Red/Blue multicolour energy instead.
  if (baseType(def(ctx, s, card)) === "EXTRA" && isRedBlue(ctx, s, card) && cardsInPlay(s, payer).some((id) => has(ctx, s, id, "Invoker")) && invokerEnergy(ctx, s, payer)) {
    return { pay: "invoker", n: 0, for: which };
  }
  return null;
}

/** Red/Blue multicolour: those two colours and nothing else. */
function isRedBlue(ctx: GameContext, s: GameState, id: string): boolean {
  const colors = cardNow(ctx, s, id).colors;
  return colors.length === 2 && colors.includes("Red") && colors.includes("Blue");
}

/** The energy [Invoker] would rest, so a caller can leave it out of the rest of the price (22-37). */
export function invokerEnergy(ctx: GameContext, s: GameState, payer: PlayerId): string | null {
  return s.players[payer].energy.find((id) => s.cards[id].mode === "active" && isRedBlue(ctx, s, id)) ?? null;
}

/**
 * Carry out an alternative cost. Adding life to hand is not damage (1-13-2).
 *
 * A `program` price is *not* paid here: it needs the player to pick cards, and
 * this returns a boolean with nowhere to ask. The caller unshifts it onto the
 * flow instead — `altCostProgram` below is what they use — and this says "yes,
 * nothing more to do inline".
 */
export function payAltCost(ctx: GameContext, s: GameState, ev: GameEvent[], payer: PlayerId, alt: AltCost): boolean {
  if (alt.pay === "none" || alt.pay === "program") return true;
  if (alt.pay === "invoker") {
    const e = invokerEnergy(ctx, s, payer);
    if (!e) return false;
    setMode(s, ev, e, "rest", ctx);
    return true;
  }
  if (alt.pay === "energy") {
    const pm = orbPayment(ctx, s, payer, alt.orbs ?? []);
    if (!pm) return false;
    pay(s, ev, payer, pm);
    return true;
  }
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
    // No "later than the turn it was written on" here, unlike `yourNextTurn`
    // above: an effect scheduled *during* the opponent's turn — every [Counter]
    // is — means the turn now under way, and requiring a later one made it skip
    // that whole turn and wait for their next. The side test is the guard: on
    // the master's own turn this is false anyway.
    case "opponentNextTurn":
      return s.turnPlayer !== d.master;
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
  return ready.flatMap((d): FlowStep[] => [{ op: "script.step", frame: { ops: d.ops, ip: 0, vars: d.vars, card: d.card, master: d.master, subject: d.subject } }, { op: "checkpoint" }]);
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
export function planPayment(
  ctx: GameContext,
  s: GameState,
  p: PlayerId,
  total: number,
  specified: Partial<Record<Color, number>>,
  explicit?: string[],
  either?: Color[][],
  /** Energy already spoken for by another part of the price — [Invoker]'s (22-37). */
  exclude?: string[],
): Payment | null {
  // "{r}/{u}" is one orb payable with either colour (22-13 and friends). Each
  // way of settling those is an ordinary specified cost, so rather than teach
  // the planner a new kind of requirement, try each assignment and let it
  // answer the question it already knows how to answer. No printed skill has
  // more than one such orb, so this is exact and costs nothing.
  if (either?.length) {
    const assignments: Color[][] = [[]];
    for (const orb of either.slice(0, 3)) {
      const next: Color[][] = [];
      for (const so_far of assignments) for (const c of orb) next.push([...so_far, c]);
      assignments.length = 0;
      assignments.push(...next);
    }
    for (const pick of assignments) {
      const merged = { ...specified };
      for (const c of pick) merged[c] = (merged[c] ?? 0) + 1;
      const got = planPayment(ctx, s, p, total, merged, explicit, undefined, exclude);
      if (got) return got;
    }
    return null;
  }
  const active = exclude?.length ? activeEnergy(s, p).filter((id) => !exclude.includes(id)) : activeEnergy(s, p);
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
    for (const c of leader)
      while (m > 0 && (need[c] ?? 0) > 0) {
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
 * The `why` twin of `planPayment` (`docs/arena-workflow-spec.md` §3.2): what
 * the price asks for against what is active, as requirements rather than a
 * plan. Empty when the price can be paid. Called only from the rejection
 * side; `planPayment` is untouched and stays the one answer to "can I".
 *
 * The count is the honest part — `need` against active energy plus markers,
 * then each specified colour against the active energy that carries it. A
 * price the planner still cannot settle after that (multicolour energy the
 * colours fight over) is reported as `other`, so a drifted pair shows up as
 * a counted `other` in the playthrough audit rather than as silence.
 */
export function whyNotPay(ctx: GameContext, s: GameState, p: PlayerId, total: number, specified: Partial<Record<Color, number>>, either?: Color[][], exclude?: string[]): Requirement[] {
  const why: Requirement[] = [];
  const active = exclude?.length ? activeEnergy(s, p).filter((id) => !exclude.includes(id)) : activeEnergy(s, p);
  const ps = s.players[p];
  const leader = leaderColors(ctx, s, p);
  const colorsOf = (id: string) => def(ctx, s, id).colors;
  const have = active.length + ps.energyMarkers;
  if (have < total) why.push({ kind: "energy", need: total, have });
  const haveColour = (c: Color) => active.filter((id) => colorsOf(id).includes(c)).length + (leader.includes(c) ? ps.energyMarkers : 0);
  for (const c of Object.keys(specified) as Color[]) {
    const need = specified[c] ?? 0;
    if (need > 0 && haveColour(c) < need) why.push({ kind: "energyColour", colour: c, need, have: haveColour(c) });
  }
  for (const orb of either ?? []) {
    if (!orb.some((c) => haveColour(c) > 0)) why.push({ kind: "energyColour", colour: orb.join("/"), need: 1, have: 0 });
  }
  if (!why.length && !planPayment(ctx, s, p, total, specified, undefined, either, exclude)) {
    why.push({ kind: "other", detail: "the active energy cannot cover the colours of the cost" });
  }
  return why;
}

/**
 * The genuinely different ways to pay a cost (3-8-2: a player may choose any
 * energy they like). Two payments that rest the same combination of colours
 * are the same choice, so they are folded together; when only one survives,
 * the choice cannot matter and the caller pays it without asking.
 */
export function paymentOptions(ctx: GameContext, s: GameState, p: PlayerId, total: number, specified: Partial<Record<Color, number>>, limit = 8): Payment[] {
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
  // A cost reducer lowers both the total and the specified cost (20-21-2) —
  // whether it stands from a [Permanent] or was put in force for the turn by a
  // skill that resolved.
  let reduction = 0;
  for (const e of staticEffects(ctx, s)) if (e.kind === "cost" && e.target === id) reduction += e.value as number;
  for (const e of s.effects) if (e.kind === "cost" && e.target === id) reduction += e.value as number;
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
