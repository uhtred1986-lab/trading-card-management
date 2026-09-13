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
 * **Where it is narrower than the rule, it says so rather than guessing.**
 * Three readings have no board to read yet and each returns the answer that
 * refuses rather than the answer that fires:
 *
 *   [Barrier] and "can't be chosen" (22-16, 20-4)   Stage 7 / Stage 5 — a
 *       keyword the card prints is read; a prohibition in force is not, so a
 *       selector is currently *wider* than the manual. Named in `NARROWER`.
 *   immunity (9-1-4)                                 #154.
 *   a battle (8-1)                                   Stage 6: `inBattle` is
 *       false and `battled` is false, which is what a game with no battle in it
 *       truthfully answers.
 *
 * Pure and client-safe: no database, no network, no `fs`.
 */
import type { EngineContext } from "../engine";
import type { Amount, AmountAttr, Cond, Ref, ScriptArea, ScriptFrame, Selector, Side } from "../engine/script";
import type { ContinuousEffect, KeywordSkill, PlayerId } from "../engine/types";
import { other } from "../engine/types";
import { powerRelOk } from "../engine/filters";
import type { GameDefinition } from "../rulesets";
import { PRINTED_BASE, attrsOf, type AttrValue, type Attrs } from "./cards";
import { permanents, valueOf, type VmStatic } from "./effects";
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
  barrier: "#153 — a granted [Barrier] is read, a printed one is read, but a prohibition in force ('can't be chosen', 20-4) is #145's",
  immune: "#154 — 9-1-4 immunity narrows what a skill may choose, and the hook group that reads choosing is Stage 7's",
  battle: "Stage 6 — there is no battle on this engine yet, so `inBattle` and `battled` are false",
  energyCost: "#148 — an amount reading a card's energy cost reads the printed total, before any reduction in force (20-21)",
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
  for (const name of Object.keys(game.attributes)) {
    if (!game.attributes[name].layers?.length) continue;
    const kind = name as ContinuousEffect["kind"];
    const value = valueOf(
      game,
      base,
      name,
      standing.filter((e) => e.kind === name && e.target === id),
      state.effects.filter((e) => e.kind === kind && e.target === id),
    );
    if (value !== undefined) out[name] = value;
  }
  return out;
}

/** One number off one card, for the `attr` and `sumOf` amounts (20-21-2 for a cost — see `NARROWER.energyCost`). */
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
    case "comboCost":
      return num(now.comboCost);
    case "energyCost":
      return num(now.energyCost);
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
    // 8-1 and 9-6: a battle and a play being resolved are Stage 6's and Stage
    // 5's. Nothing is being attacked and nothing is being played, so there is
    // no card — the same answer the legacy engine gives outside a battle.
    case "attacker":
    case "guard":
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
    // masters. The prohibition that says the same thing in words (20-4) is
    // `NARROWER.barrier`.
    if (!sel.special && !sel.ignoreBarrier && sel.side !== "you" && hasKeyword(ctx, game, state, id, "Barrier") && masterOf(game, state, id) !== frame.master && zoneOf(state, id) !== "hand") return false;
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
    // 8-1: there is no battle on this engine yet (`NARROWER.battle`), so
    // nothing is in one — which is the answer a game with no battle gives.
    case "inBattle":
      return !!c.not;
    case "battled":
      return false;
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
  }
}

function num(value: AttrValue | undefined): number {
  return typeof value === "number" ? value : 0;
}

function list(value: AttrValue | undefined): readonly string[] {
  return Array.isArray(value) ? value : [];
}
