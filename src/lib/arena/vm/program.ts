/**
 * What a program *means*, read against a `VmState`.
 *
 * `stepScript` decides what happens; this decides what the words in it point
 * at. Four readings, and they are the same four the legacy engine's `state.ts`
 * has — `resolveSelector`, `resolveRef`, `amount`, `condHolds` — because they
 * are readings of one shared language (`OP_SCHEMA`, `COND_SCHEMA`) off one
 * shared `card_rules` row. A selector that found different cards on the two
 * engines would make the record mean two things, which is the whole failure
 * #142 exists to prevent.
 *
 * Everything a reading needs about a card comes off the **declared
 * attributes** (`vm/cards.ts`) through the **declared layers**
 * (`vm/effects.ts`), and every filter goes through the one adapter in
 * `vm/filters.ts`. So this module names four zone words and no card fields:
 * `leader` (because `SpecialTarget` says "leader" and a game has to say which
 * zone that is — the same word `SETUP_ZONES` already names), and `play`,
 * `under` and `hand`, each of which the language itself names.
 *
 * **Where it is narrower than the rule, it says so rather than guessing.** Two
 * readings have no board to read yet and each returns the answer that refuses
 * rather than the answer that fires:
 *
 *   immunity (9-1-4)                                 #154.
 *   `battled` (8-1-2-2, BT3-103)                     #150 built the battle
 *       itself and `inBattle`/the `attacker`/`guard` specials with it —
 *       `battled` is the one piece left: a per-copy memory of having fought
 *       that outlives the battle, and `VmCard` carries no field for it yet.
 *
 * 20-14's prohibitions were a third until #145: `forbids` and `forbiddenBy`
 * below read them off the board — a [Permanent] in play, a skill's turn-long
 * effect, and a card's own rule about itself wherever it sits (9-1-3-3) — so a
 * selector honours "can't be chosen" (20-4) as well as [Barrier], and a
 * `REFUSE` can gate a move on one.
 *
 * Pure and client-safe: no database, no network, no `fs`.
 */
import type { EngineContext } from "../engine";
import { keywordsInSkills, parseSkills } from "../engine/cards";
import type { Amount, AmountAttr, Cond, Ref, ScriptArea, ScriptFrame, Selector, Side } from "../engine/script";
import type { EffectUntil, ForbiddenAction, KeywordSkill, PlayerId, Prohibition } from "../engine/types";
import { other } from "../engine/types";
import { powerRelOk } from "../engine/filters";
import type { GameDefinition } from "../rulesets";
import { PRINTED_BASE, attrsOf, type AttrValue, type Attrs } from "./cards";
import { describeCond as sayCond } from "../engine/script-schema";
import { mirrorSides } from "../engine/state";
import { ownProhibitions, permanents, valueOf, type VmStatic } from "./effects";
import { predicateOf } from "./filters";
import { masterOf, skillsShowing } from "./triggers";
import { SETUP_ZONES, hostOf, inPlayZones } from "./zones";
import type { VmState } from "./state";

/** The zone words this module names, and why each is unavoidable. Asserted against the declarations by `verify/rulesets.ts`. */
export const NAMED_ZONES = {
  leader: "the `leader` special target names a zone, and only the game knows which (3-5-1)",
  play: "`play` is the language's word for every in-play area at once (9-1-3-1); the zones it stands for are read off `inPlay:`",
  under: "`under` is the pile hanging off a card (23-2), which is not a zone at all",
  hand: "the `handUpTo` amount counts a hand (5-4-2)",
} as const;

/** Where a reading is narrower or wider than the manual, and the issue that closes it. */
export const NARROWER: Record<string, string> = {
  immune: "#154 — 9-1-4 immunity narrows what a skill may choose, and the hook group that reads choosing is Stage 7's",
  battled: "#150 built the battle and `inBattle`; `battled` (8-1-2-2) still reads false, since `VmCard` has no memory of a fight that outlived it",
};

/**
 * The one recursion guard, the legacy `computingStatics` by another name.
 *
 * A [Permanent]'s target is a selector, resolving a selector asks for a card's
 * power, and a card's power asks for the [Permanent]s. One level is enough:
 * reading a static's own selector must not ask for the statics again.
 */
let readingStatics = false;

/** 1-12 and 5-2: which players a `Side` word means, from the point of view of the skill's master. */
export function sideOf(master: PlayerId, side: Side | undefined): PlayerId[] {
  if (side === "opponent") return [other(master)];
  if (side === "both") return [master, other(master)];
  return [master];
}

// ── what a card is, right now ───────────────────────────────────────────────

/** Every [Permanent] standing right now, or nothing while one is being read (see `readingStatics`). */
function statics(ctx: EngineContext, game: GameDefinition, state: VmState): VmStatic[] {
  if (readingStatics) return [];
  readingStatics = true;
  try {
    return permanents(
      ctx,
      game,
      state,
      (frame, op) => resolveRef(ctx, game, state, frame, ("target" in op && op.target ? op.target : { sel: { special: "self" } }) as Ref),
      (frame, op) => (op.op === "if" ? condHolds(ctx, game, state, frame, op.cond) : false),
      // "…by 1 for each of your blue Battle Cards": the one amount a standing
      // change can carry, counted over the board. `readingStatics` is already
      // true here, so the count reads printed values and cannot recur.
      (frame, a) => amount(ctx, game, state, frame, a),
    );
  } finally {
    readingStatics = false;
  }
}

/**
 * One card's attributes as they stand: the printed values, and every layer the
 * declaration puts over them (9-9-1).
 *
 * The only place a value is read, so a filter, an amount and a condition all
 * see the same number — the property `verify/vm.ts` asserts against the legacy
 * engine's `matches`.
 */
export function attrsNow(ctx: EngineContext, game: GameDefinition, state: VmState, id: string): Attrs {
  const card = state.cards[id];
  const def = card ? ctx.defs[card.cardId] : undefined;
  if (!def) return {};
  const printed = attrsOf(def, game).attrs;
  const standing = statics(ctx, game, state);
  const out: Record<string, AttrValue> = { ...printed };
  // 20-21: a board-filled price has no printed face of its own — its `printed`
  // layer is the number beside it, and `PRINTED_BASE` is that pairing. Seeded
  // before the layers are walked, so a reduction adds to the printed cost
  // rather than to nothing. Absent stays absent: an X cost has no total until
  // someone names one (1-2-2-2), and 0 would be a price nobody chose.
  const base: Record<string, AttrValue> = { ...printed };
  for (const [derived, face] of Object.entries(PRINTED_BASE)) {
    if (!game.attributes[derived] || printed[face] === undefined) continue;
    base[derived] = printed[face];
  }
  // The six card-state attributes have no catalog face at all (spec
  // §2.5-1/§2.5-3, #275): five read live off the card sitting on the table,
  // seeded fresh on every call rather than cached, so a mutation by
  // `setMode`/`changeMarkers`/`setHidden`/`setFaceUp`/`flip` reaches here at
  // once. `keywords`' printed half is read the one way this codebase reads a
  // keyword at all — `keywordsInSkills(parseSkills(…))`, the same call
  // `matchesAttrs` (`vm/filters.ts`) makes off the same `skill` attribute —
  // so a card's own tags are never parsed twice.
  if (game.attributes.mode && card.mode != null) base.mode = card.mode;
  if (game.attributes.markers) base.markers = card.markers;
  if (game.attributes.hidden) base.hidden = card.hidden;
  if (game.attributes.faceUp) base.faceUp = card.faceUp;
  if (game.attributes.flipped) base.flipped = card.flipped;
  if (game.attributes.keywords) base.keywords = keywordsInSkills(parseSkills(typeof printed.skill === "string" ? printed.skill : null)).map((k) => k.name);
  // Every change in force **about this card**, of every kind: which of them a
  // layer reads is `LAYER_KINDS`, and keeping that pairing in one place is the
  // whole reason this no longer filters by the attribute's name (#148).
  const mine = standing.filter((e) => e.target === id);
  const timed = state.effects.filter((e) => e.target === id);
  for (const name of Object.keys(game.attributes)) {
    if (!game.attributes[name].layers?.length) continue;
    const value = valueOf(game, base, name, mine, timed);
    if (value !== undefined) out[name] = value;
  }
  return out;
}

/** One number off one card, for the `attr` and `sumOf` amounts — a cost read through its reduction layer (20-21-2), as the legacy `measure` reads it. */
function measureOf(ctx: EngineContext, game: GameDefinition, state: VmState, id: string, name: AmountAttr): number {
  const now = attrsNow(ctx, game, state, id);
  switch (name) {
    case "power":
      return num(now.power);
    case "originalPower": {
      // 20-3-1: the printed face value, before any layer — the current face's
      // own number, which is the printed attribute rather than the read one.
      const card = state.cards[id];
      const def = card ? ctx.defs[card.cardId] : undefined;
      if (!def) return 0;
      if (card.flipped && def.back) return def.back.power ?? 0;
      return def.power ?? 0;
    }
    case "comboPower":
      return num(now.comboPower);
    // 20-21-2: "a card with an energy cost of 2 or less" asks what it costs
    // *now*, which is the derived attribute rather than the printed number —
    // the legacy `measure` reads `comboCostOf`/`playCost().total` for exactly
    // these two. A card with no total of its own (an X cost, 1-2-2-2) has none
    // to read and counts as zero, which is that same reading.
    case "comboCost":
      return num(now.comboCostOf);
    case "energyCost":
      return num(now.costOf);
  }
}

/**
 * 22: does this card have this keyword skill?
 *
 * The printed ones off the face showing, and the granted ones off the effects
 * and [Permanent]s in force (20-18-1). What a keyword then *does* is Stage 7's
 * (#153); this is only whether the card has it, which [Barrier] needs here.
 */
export function hasKeyword(ctx: EngineContext, game: GameDefinition, state: VmState, id: string, name: KeywordSkill["name"]): boolean {
  const card = state.cards[id];
  if (!card) return false;
  for (const sk of skillsShowing(ctx, state, id).skills) if (sk.keyword?.name === name) return true;
  for (const e of state.effects) if (e.kind === "keyword" && e.target === id && (e.value as KeywordSkill)?.name === name) return true;
  for (const e of statics(ctx, game, state)) if (e.kind === "keyword" && e.target === id && (e.value as KeywordSkill)?.name === name) return true;
  return false;
}

/**
 * Every keyword skill this card has in force right now — `hasKeyword`'s own
 * three sources (printed, granted by an effect, granted by a [Permanent] in
 * force), collected rather than tested against one name. `vm/hooks.ts` reads
 * this to find which `DEFINE KEYWORD` hook bodies a card's own keywords may
 * hang at a given moment (#153); nothing else needs every keyword at once.
 */
export function keywordsInForce(ctx: EngineContext, game: GameDefinition, state: VmState, id: string): KeywordSkill[] {
  const card = state.cards[id];
  if (!card) return [];
  const out: KeywordSkill[] = [];
  for (const sk of skillsShowing(ctx, state, id).skills) if (sk.keyword) out.push(sk.keyword);
  for (const e of state.effects) if (e.kind === "keyword" && e.target === id) out.push(e.value as KeywordSkill);
  for (const e of statics(ctx, game, state)) if (e.kind === "keyword" && e.target === id) out.push(e.value as KeywordSkill);
  return out;
}

// ── prohibitions (20-14) ────────────────────────────────────────────────────

/** One rule in force that forbids something, with where it came from — a refusal has to name both. */
interface RuleInForce {
  /** The card it is about; empty for a rule about a player rather than a card. */
  target: string;
  /** The card whose skill made the rule; null for a turn-long effect that names none. */
  source: string | null;
  until: EffectUntil;
  forbid: Prohibition;
}

/** Every prohibition on the board, in the order the legacy `forbids` reads them: the timed ones, the standing ones, then the card's own (9-1-3-3). */
function prohibitions(ctx: EngineContext, game: GameDefinition, state: VmState, card?: string): RuleInForce[] {
  const out: RuleInForce[] = [];
  for (const e of state.effects) if (e.kind === "forbid" && e.forbid) out.push({ target: e.target, source: e.source ?? null, until: e.until, forbid: e.forbid });
  for (const e of statics(ctx, game, state)) if (e.kind === "forbid") out.push({ target: e.target, source: e.source, until: "permanent", forbid: e.value as Prohibition });
  if (card) {
    const master = masterOf(game, state, card);
    for (const f of ownProhibitions(ctx, state, card, (frame, a) => amount(ctx, game, state, frame, a), master)) out.push({ target: card, source: card, until: "permanent", forbid: f });
  }
  return out;
}

/**
 * Is the prohibition's escape clause satisfied right now?
 *
 * The clause is part of the **source card's** text, so it is asked in that
 * card's frame — its controller and the card itself — and not in the frame of
 * whoever is trying to act. Reading "your opponent" from the acting player's
 * chair would invert every such card, which is the legacy `unlessHolds`' own
 * note and the reason a `Prohibition` records its `master` at all.
 */
function escapeHolds(ctx: EngineContext, game: GameDefinition, state: VmState, f: Prohibition, opts: { player?: PlayerId; card?: string }, source: string | null): boolean {
  if (!f.unless) return false;
  const card = source && state.cards[source] ? source : opts.card && state.cards[opts.card] ? opts.card : "";
  const master = f.master ?? (card ? masterOf(game, state, card) : undefined) ?? opts.player ?? "p1";
  return condHolds(ctx, game, state, { ops: [], ip: 0, vars: {}, card, master }, f.unless);
}

/** Does this rule apply to what is being asked about? The legacy `matchesProhibition`, test for test. */
function ruleApplies(
  ctx: EngineContext,
  game: GameDefinition,
  state: VmState,
  what: ForbiddenAction,
  rule: RuleInForce,
  opts: { player?: PlayerId; card?: string; bySkill?: boolean },
): boolean {
  const f = rule.forbid;
  if (f.what !== what) return false;
  // "By skills" and "except by skills" are opposite halves of one wording, and
  // a rule that names one of them says nothing about the other.
  if (f.bySkill !== undefined && opts.bySkill !== undefined && f.bySkill !== opts.bySkill) return false;
  if (rule.target && rule.target !== opts.card) return false;
  if (f.player && opts.player && f.player !== opts.player) return false;
  if (f.filter || f.name) {
    if (!opts.card || !state.cards[opts.card]) return false;
    if (f.filter && !predicateOf(f.filter, game)(attrsNow(ctx, game, state, opts.card))) return false;
    if (f.name && nameShowing(ctx, state, opts.card) !== f.name) return false;
  }
  return !escapeHolds(ctx, game, state, f, opts, rule.source);
}

/** The name on the face a card is showing (1-9). */
function nameShowing(ctx: EngineContext, state: VmState, id: string): string | undefined {
  const inst = state.cards[id];
  const def = inst ? ctx.defs[inst.cardId] : undefined;
  if (!def) return undefined;
  return inst.flipped && def.back ? def.back.name : def.name;
}

/**
 * 20-14: does a rule in force forbid this right now?
 *
 * The legacy `forbids`, over this engine's board — the one predicate, so the
 * menu and the refusal below cannot disagree, and the two engines cannot
 * either. A budget still to spend (`uses`) means the rule forbids nothing yet.
 */
export function forbids(ctx: EngineContext, game: GameDefinition, state: VmState, what: ForbiddenAction, opts: { player?: PlayerId; card?: string; bySkill?: boolean } = {}): boolean {
  return forbiddenBy(ctx, game, state, what, opts) !== null;
}

/**
 * The `why` twin of `forbids`: **which** card's rule forbids it, how long it
 * holds, and the escape clause in the words of the player being refused.
 *
 * Said in that player's words is the one place the engine mirrors "you" and
 * "your opponent" rather than printing them as the script wrote them, and it is
 * `mirrorSides` — imported from the legacy engine rather than copied, because a
 * refusal worded two ways is a refusal worded wrongly once.
 */
export function forbiddenBy(
  ctx: EngineContext,
  game: GameDefinition,
  state: VmState,
  what: ForbiddenAction,
  opts: { player?: PlayerId; card?: string; bySkill?: boolean } = {},
): { by: string | null; until: EffectUntil; unless?: string } | null {
  for (const rule of prohibitions(ctx, game, state, opts.card)) {
    if (!ruleApplies(ctx, game, state, what, rule, opts)) continue;
    if ((rule.forbid.uses ?? 0) > 0) continue;
    const viewer = opts.player ?? (opts.card && state.cards[opts.card] ? masterOf(game, state, opts.card) : undefined);
    const master = rule.forbid.master;
    return {
      by: rule.source && state.cards[rule.source] ? (nameShowing(ctx, state, rule.source) ?? null) : null,
      until: rule.until,
      ...(rule.forbid.unless ? { unless: sayCond(master && viewer && master !== viewer ? mirrorSides(rule.forbid.unless) : rule.forbid.unless) } : {}),
    };
  }
  return null;
}

// ── selectors (5-2) ─────────────────────────────────────────────────────────

/** The zones a `ScriptArea` word stands for on this board. `play` is every in-play zone at once (9-1-3-1). */
function zonesFor(game: GameDefinition, area: ScriptArea): string[] {
  if (area === "play") return inPlayZones(game);
  return game.zones[area]?.place === false ? [] : [area];
}

/** Every card one side has in the areas an `ScriptArea` word names. */
function areaCards(game: GameDefinition, state: VmState, p: PlayerId, area: ScriptArea, frame: ScriptFrame): string[] {
  if (area === "under") return state.cards[frame.card]?.under.slice() ?? [];
  const out: string[] = [];
  for (const zone of zonesFor(game, area)) out.push(...(state.sides[p].zones[zone] ?? []));
  return out;
}

/** Which zone a card stands in, or null for a card under another (23-2) or out of the game. */
export function zoneOf(state: VmState, id: string): string | null {
  for (const p of Object.keys(state.sides) as PlayerId[]) {
    for (const [zone, ids] of Object.entries(state.sides[p].zones)) if (ids.includes(id)) return zone;
  }
  return null;
}

/** The card a `SpecialTarget` names, or null when there is none right now. */
function specialCard(state: VmState, frame: ScriptFrame, special: NonNullable<Selector["special"]>): string | null {
  const single = (p: PlayerId, zone: string) => state.sides[p].zones[zone]?.[0] ?? null;
  switch (special) {
    case "self":
      return frame.card;
    case "subject":
      return frame.subject ?? null;
    case "leader":
      return single(frame.master, SETUP_ZONES.leader);
    case "opponentLeader":
      return single(other(frame.master), SETUP_ZONES.leader);
    case "onTop":
      // 23-2-2-2: the card whose pile holds this one. Null while it is in none,
      // which is most of the time — these skills print on the buried card.
      return hostOf(state, frame.card);
    // 8-1: the two roles of the battle in progress (#150), read off the same
    // `state.battle` `vm/battle.ts` writes — null outside one, exactly the
    // legacy engine's own `s.battle?.attacker ?? null` reading.
    case "attacker":
      return state.battle?.attacker ?? null;
    case "guard":
      return state.battle?.guard ?? null;
    // 9-6: a play being resolved is a moment this engine does not have — a
    // play resolves inside the op that makes it (`vm/play.ts`'s own
    // docstring), so there is no separate "resolving" card to name. Stage 5's.
    case "resolving":
      return null;
  }
}

/**
 * The cards a selector picks, right now.
 *
 * The order of the tests is the legacy `resolveSelector`'s, test for test, and
 * the comments that explain *why* an order matters are carried with them: a
 * `take` before the filter because the top card of a deck is not searched for,
 * `hidden` before `filter` because a face-down card has no front-side
 * information to filter on (23-5-2).
 */
export function resolveSelector(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame, sel: Selector): string[] {
  let out: string[] = [];
  if (sel.special) {
    const pick = specialCard(state, frame, sel.special);
    out = pick && state.cards[pick] ? [pick] : [];
  } else if (sel.fromVar) {
    out = (frame.vars[sel.fromVar] ?? []).filter((id) => state.cards[id]);
  } else {
    // A phrase may name two areas — "your opponent's Battle Cards or Unisons".
    const areas = sel.areas?.length ? sel.areas : [sel.area ?? "battle"];
    for (const area of areas) {
      if (area === "under" && sel.underHost) {
        for (const host of resolveSelector(ctx, game, state, frame, sel.underHost)) out.push(...(state.cards[host]?.under ?? []));
        continue;
      }
      for (const p of sideOf(frame.master, sel.side)) out.push(...areaCards(game, state, p, area, frame));
    }
  }
  // "The top 2 cards of your deck" — the area's own order decides, and the
  // filter is not applied first, because the cards are not being searched for.
  if (sel.take != null) out = sel.fromEnd ? out.slice(Math.max(0, out.length - sel.take)) : out.slice(0, sel.take);

  const matchesFilter = sel.filter ? predicateOf(sel.filter, game) : null;
  return out.filter((id) => {
    const card = state.cards[id];
    if (!card) return false;
    if (sel.mode && card.mode !== sel.mode) return false;
    // 23-5-2: a Hidden Mode selector asks *for* the very cards the rule below
    // would exclude from a filtered choice, so it is answered ahead of it.
    if (sel.hidden != null && card.hidden !== sel.hidden) return false;
    if (sel.notSelf && frame.card) {
      if (id === frame.card) return false;
      if (sel.notSelf === "copies" && state.cards[frame.card] && card.cardId === state.cards[frame.card].cardId) return false;
    }
    // A named target that also names an area only matches while it is there: a
    // delayed effect resolves turns later, and by then "this card" may have
    // left the Battle Area, in which case it is no longer the same card (3-1-4).
    if (sel.special && sel.area) {
      const wanted = sel.area === "play" ? inPlayZones(game) : [sel.area as string];
      if (!wanted.includes(zoneOf(state, id) ?? "")) return false;
    }
    // 23-5-2 again: a Hidden Mode card has none of its front-side information.
    if (matchesFilter && (card.hidden || !matchesFilter(attrsNow(ctx, game, state, id)))) return false;
    // 3-9-2-1: whether a life card has been turned face up is a fact about this
    // copy rather than about the card, so no attribute can carry it.
    if (sel.filter?.faceUp && !card.faceUp) return false;
    if (sel.filter?.powerRel) {
      const against = sel.filter.powerRel.of === "chosen" ? (sel.filter.powerRel.var ? (frame.vars[sel.filter.powerRel.var]?.[0] ?? null) : null) : frame.card;
      if (!against || !powerRelOk(sel.filter, measureOf(ctx, game, state, id, "power"), measureOf(ctx, game, state, against, "power"))) return false;
    }
    // 22-16: [Barrier] takes a card out of the choices of a skill its opponent
    // masters.
    if (!sel.special && !sel.ignoreBarrier && sel.side !== "you" && hasKeyword(ctx, game, state, id, "Barrier") && masterOf(game, state, id) !== frame.master && zoneOf(state, id) !== "hand") return false;
    // 20-4: the same shape as [Barrier], but printed as a prohibition — and a
    // prohibition is a thing this engine can now read (#145), so a selector is
    // no longer wider than the manual here.
    if (!sel.special && masterOf(game, state, id) !== frame.master && forbids(ctx, game, state, "beChosen", { card: id })) return false;
    return true;
  });
}

export function resolveRef(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame, ref: Ref): string[] {
  if ("var" in ref) {
    const taken = ref.minus ? new Set(frame.vars[ref.minus] ?? []) : null;
    return (frame.vars[ref.var] ?? []).filter((id) => state.cards[id] && !taken?.has(id));
  }
  return resolveSelector(ctx, game, state, frame, ref.sel);
}

// ── amounts (20-5) ──────────────────────────────────────────────────────────

/** The markers on the selected cards, added up (13-2) — the one sum the `markers` condition and the `markers` amount both ask for. */
function markersOn(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame, sel: Selector): number {
  return resolveSelector(ctx, game, state, frame, sel).reduce((t, id) => t + (state.cards[id]?.markers ?? 0), 0);
}

/** One side's life, counted (3-9). */
function lifeCount(game: GameDefinition, state: VmState, master: PlayerId, side: Side | undefined): number {
  return sideOf(master, side).reduce((t, p) => t + (state.sides[p].zones.life?.length ?? 0), 0);
}

/**
 * An amount, as a number. The **one** place an `Amount` is read, so a new shape
 * is a case here and nowhere else — and the order of the `in` tests is the
 * order the union is written, for the same reason it is on the legacy engine:
 * `sumOf` before `attr`, because both carry an `attr` key.
 */
export function amount(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame, a: Amount): number {
  if (typeof a === "number") return a;
  if ("plus" in a) return amount(ctx, game, state, frame, a.plus[0]) + a.plus[1];
  if ("var" in a) return (frame.vars[a.var] ?? []).length;
  if ("sumPower" in a) return (frame.vars[a.sumPower.var] ?? []).reduce((t, id) => t + measureOf(ctx, game, state, id, "power"), 0);
  if ("handUpTo" in a) return Math.max(0, a.handUpTo - (state.sides[frame.master].zones[SETUP_ZONES.hand]?.length ?? 0));
  if ("x" in a) {
    // 20-5: read as zero, "draw X cards" would silently be "draw nothing".
    if (frame.x === undefined) throw new Error("this program reads X, but nothing bound it");
    return frame.x * (a.times ?? 1);
  }
  if ("life" in a) return lifeCount(game, state, frame.master, a.life) * (a.times ?? 1);
  if ("sumOf" in a) return resolveSelector(ctx, game, state, frame, a.sumOf).reduce((t, id) => t + measureOf(ctx, game, state, id, a.attr), 0) * (a.times ?? 1);
  if ("attr" in a) {
    // A ref that found none is nothing rather than an error, and one that found
    // several is read off the first: no printed wording says "each of their
    // energy costs" — that is `sumOf`.
    const ids = resolveRef(ctx, game, state, frame, a.attr);
    return ids.length ? measureOf(ctx, game, state, ids[0], a.name) * (a.times ?? 1) : 0;
  }
  if ("markers" in a) return markersOn(ctx, game, state, frame, a.markers) * (a.times ?? 1);
  return resolveSelector(ctx, game, state, frame, a.count).length * (a.times ?? 1);
}

// ── conditions (9-4) ────────────────────────────────────────────────────────

/** Does this condition hold? The legacy `condHolds`, case for case. */
export function condHolds(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame, c: Cond): boolean {
  const between = (n: number, atLeast?: number, atMost?: number) => (atLeast == null || n >= atLeast) && (atMost == null || n <= atMost);
  const leaderOf = (side: Side | undefined) => state.sides[side === "opponent" ? other(frame.master) : frame.master].zones[SETUP_ZONES.leader]?.[0] ?? null;
  switch (c.kind) {
    case "count":
      return between(resolveSelector(ctx, game, state, frame, c.sel).length, c.atLeast, c.atMost);
    case "life":
      return between(lifeCount(game, state, frame.master, c.side), c.atLeast, c.atMost);
    case "leaderColor": {
      const l = leaderOf("you");
      return !!l && list(attrsNow(ctx, game, state, l).colors).includes(c.color);
    }
    case "leaderMatches": {
      const l = leaderOf(c.side);
      if (!l) return false;
      const now = attrsNow(ctx, game, state, l);
      if (c.back) {
        // "If your Leader's back side is {Name}": the other face, whichever is up.
        const back = ctx.defs[state.cards[l].cardId]?.back;
        return !!back && predicateOf(c.filter, game)({ ...now, name: back.name });
      }
      return predicateOf(c.filter, game)(now);
    }
    case "markers":
      return between(markersOn(ctx, game, state, frame, c.sel), c.atLeast, c.atMost);
    // 8-1: the battle in progress (#150), read off `state.battle` the same
    // way the legacy `inBattle` reads `s.battle` — `role` narrows to one end
    // of it ("if this card is the attacker/guard"), left off for "if this
    // card is in a battle" either way.
    case "inBattle": {
      const b = state.battle;
      const inBattle =
        !!b && resolveSelector(ctx, game, state, frame, c.sel).some((id) => (c.role === "attacker" ? b.attacker === id : c.role === "guard" ? b.guard === id : b.attacker === id || b.guard === id));
      return c.not ? !inBattle : inBattle;
    }
    // BT3-103's "if this card participated in a battle during your opponent's
    // turn": `VmCard.battledThisTurn` (#152) is the legacy engine's own
    // per-copy memory that outlives the battle itself (8-1-2-2) —
    // `vm/battle.ts`'s `joinsBattle` sets it, `endTurn` clears it.
    case "battled":
      return resolveSelector(ctx, game, state, frame, c.sel).some((id) => !!state.cards[id]?.battledThisTurn);
    case "every": {
      const ids = resolveSelector(ctx, game, state, frame, c.sel);
      // Nothing there is not "all of it" (0-2-4-1).
      if (!ids.length) return false;
      const ok = new Set(resolveSelector(ctx, game, state, frame, c.matching));
      return ids.every((id) => ok.has(id));
    }
    case "any":
      return c.conds.some((x) => condHolds(ctx, game, state, frame, x));
    case "all":
      return c.conds.every((x) => condHolds(ctx, game, state, frame, x));
    case "leaderFlipped": {
      const l = leaderOf(c.side);
      return !!l && state.cards[l].flipped === (c.flipped ?? true);
    }
    case "did":
      return !!frame.did?.[c.what];
    case "not":
      return !condHolds(ctx, game, state, frame, c.cond);
    case "power":
      return resolveSelector(ctx, game, state, frame, c.sel).some((id) => between(measureOf(ctx, game, state, id, "power"), c.atLeast, c.atMost));
    case "lifeVsOpponent": {
      const mine = state.sides[frame.master].zones.life?.length ?? 0;
      const theirs = state.sides[other(frame.master)].zones.life?.length ?? 0;
      return c.atLeast ? mine >= theirs : mine <= theirs;
    }
    case "chose":
      return (frame.vars[c.var] ?? []).length >= (c.atLeast ?? 1);
    case "varMatches":
      return (frame.vars[c.var] ?? []).some((id) => state.cards[id] && predicateOf(c.filter, game)(attrsNow(ctx, game, state, id)));
    case "isTurnPlayer":
      return c.who === "opponent" ? state.turnPlayer !== frame.master : state.turnPlayer === frame.master;
    // The question on the table, read off the one place this engine keeps it.
    // A program is never written in this word — it is a `REFUSE`'s (#145) — but
    // the evaluator is shared, so reading it here is what keeps "shared" true.
    case "asking":
      return state.prompt.kind === c.prompt;
    // 20-14, asked of the frame's own card and master — the same reading
    // `vm/actions.ts` asks of a candidate, so a `REFUSE` and a program mean one
    // thing by the word.
    case "forbidden":
      return forbids(ctx, game, state, c.what, { player: frame.master, ...(frame.card ? { card: frame.card } : {}), ...(c.bySkill === undefined ? {} : { bySkill: c.bySkill }) });
    case "playerAttr":
      return !!state.sides[c.side === "opponent" ? other(frame.master) : frame.master].attrs[c.name];
    case "sameCard": {
      const a = resolveSelector(ctx, game, state, frame, c.a);
      const b = resolveSelector(ctx, game, state, frame, c.b);
      return a.length === 1 && b.length === 1 && state.cards[a[0]].cardId === state.cards[b[0]].cardId;
    }
  }
}

function num(value: AttrValue | undefined): number {
  return typeof value === "number" ? value : 0;
}

function list(value: AttrValue | undefined): readonly string[] {
  return Array.isArray(value) ? value : [];
}
