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
 * **Where it is narrower than the rule, it says so rather than guessing** —
 * and where it has stopped being narrower, it stops saying so. `battled`
 * (8-1-2-2, BT3-103) was that entry from #150 until #152 gave `VmCard` the
 * `battledThisTurn` field the legacy engine has always had, and the condition
 * has read it ever since; `vm/zones.ts`, `vm/state.ts` and `vm/battle.ts` each
 * say so in their own comments, and `NARROWER` below went on claiming the
 * opposite until #166's pre-flip review read the four together. A claim about
 * a gap is worse than no claim once it is untrue — the same reason
 * `glossary.ts`'s `engine` line is a convention rather than a test.
 *
 * 20-14's prohibitions were a third until #145: `forbids` and `forbiddenBy`
 * below read them off the board — a [Permanent] in play, a skill's turn-long
 * effect, and a card's own rule about itself wherever it sits (9-1-3-3) — so a
 * selector honours "can't be chosen" (20-4) as well as [Barrier] (22-16, #154:
 * `forbid(what: beChosen)`, one of the hook contract's `chooseable`/
 * `koByEffect` query hooks folded into `prohibitions()` alongside a card's own
 * printed rules), and a `REFUSE` can gate a move on one. [Indestructible]
 * (22-12)'s "or as a result of battle" half is `vm/battle.ts`'s own KO path,
 * not a prohibition — 9-1-4 immunity from a *skill*, `koByEffect`'s own case,
 * has had a real caller since #146: a skill's `ko` resolves (`vm/host.ts`), and
 * the shared interpreter asks `forbids("beKOdBySkill")` before it does.
 *
 * Pure and client-safe: no database, no network, no `fs`.
 */
import type { EngineContext } from "../types";
import { backCharactersOf, baseType, coversColors, namedSetCandidates, keywordsInSkills, parseSkills, printedDescription, printedNames, sumReachable } from "../text/cards";
import { costModifierAs, negateAs, perStep, selectedCount, type Amount, type AmountAttr, type CardAttr, type Cond, type Op, type Ref, type ScriptArea, type ScriptFrame, type Selector, type Side } from "./script";
import type { CardIdentityGain, Color, EffectUntil, ForbiddenAction, Immunity, KeywordSkill, Permission, PlayerId, Prohibition, Skill } from "../types";
import { counterKindOf, other } from "../types";
import { emptyFilter, nameInSkillText, parseFilter, powerRelOk, type CardFilter } from "../text/filters";
import { bindKeywordParams, type GameDefinition, type HookPoint } from "../rulesets";
import { PRINTED_BASE, attrsOf, type AttrValue, type Attrs } from "./cards";
import { describeCond as sayCond } from "./script-schema";
import { mirrorSides } from "./common";
import { HOOK_CONTRACT } from "./hook-contract";
import { grantedSkillNegated, keywordStatics, ownProhibitions, permanents, skillNegated, skillsNegated, valueOf, type VmStatic } from "./effects";
import { predicateOf } from "./filters";
import { masterOf, skillsShowing } from "./triggers";
import { SETUP_ZONES, findCard, hostOf, inPlayZones } from "./zones";
import type { VmState } from "./state";

/** The zone words this module names, and why each is unavoidable. Asserted against the declarations by `verify/rulesets.ts`. */
export const NAMED_ZONES = {
  leader: "the `leader` special target names a zone, and only the game knows which (3-5-1)",
  play: "`play` is the language's word for every in-play area at once (9-1-3-1); the zones it stands for are read off `inPlay:`",
  under: "`under` is the pile hanging off a card (23-2), which is not a zone at all",
  hand: "the `handUpTo` amount counts a hand (5-4-2)",
} as const;

/**
 * Where a reading is narrower or wider than the manual, and the issue that
 * closes it.
 *
 * Empty today. `battled` left this list at #152 (see the module doc), and
 * `immune` at #154: a [Permanent]'s `immune` op is collected
 * (`immunityStatics` below) and every selector asks it (`immunityRefusing`),
 * the legacy reading. What 9-1-4 still covers and neither engine catches — an
 * effect that names no card at all — is the glossary's own "A card no skill
 * may touch" entry, the same on both, so it is no difference between them.
 */
export const NARROWER: Record<string, string> = {};

/**
 * The one recursion guard, the legacy `computingStatics` by another name.
 *
 * A [Permanent]'s target is a selector, resolving a selector asks for a card's
 * power, and a card's power asks for the [Permanent]s. One level is enough:
 * reading a static's own selector must not ask for the statics again.
 */
let readingStatics = false;

/**
 * The second guard, the legacy `computingImmunities`: immunity is the one
 * static kind that must be readable *while* the statics are being read,
 * because it decides whether another [Permanent]'s change lands at all — a
 * card unaffected by the opponent's skills is not powered down by the
 * opponent's [Permanent] either (9-1-4). One level is enough here too:
 * granting a card immunity is not an effect any immunity is meant to stop.
 */
let readingImmunities = false;

/** 1-12 and 5-2: which players a `Side` word means, from the point of view of the skill's master. */
export function sideOf(master: PlayerId, side: Side | undefined): PlayerId[] {
  if (side === "opponent") return [other(master)];
  if (side === "both") return [master, other(master)];
  return [master];
}

// ── what a card is, right now ───────────────────────────────────────────────

/** The keywords of the game that hang a body on `altPayment`, lower-cased — worked out once per definition. */
export function hasPossibleReplacement(ops: Op[]): boolean {
  return ops.some((op) => op.op === "replace" || op.op === "replaceLeave"
    || (op.op === "if" && (hasPossibleReplacement(op.then) || hasPossibleReplacement(op.else ?? []))));
}

const ALT_PAYMENT = new WeakMap<GameDefinition, { names: string[]; possibleReplacement: boolean }>();
function altPaymentConfig(game: GameDefinition): { names: string[]; possibleReplacement: boolean } {
  let known = ALT_PAYMENT.get(game);
  if (known === undefined) {
    const hooks = Object.values(game.keywords).map((keyword) => ({ name: keyword.name.toLowerCase(), bodies: keyword.hooks?.filter((hook) => hook.at === "altPayment") ?? [] }));
    known = { names: hooks.filter((keyword) => keyword.bodies.length).map((keyword) => keyword.name), possibleReplacement: hooks.some((keyword) => keyword.bodies.some((hook) => hasPossibleReplacement(hook.ops))) };
    ALT_PAYMENT.set(game, known);
  }
  return known;
}
function altPaymentKeywords(game: GameDefinition): string[] {
  return altPaymentConfig(game).names;
}

/** A dormant keyword standing body may begin replacing moves after the first cost departure. */
export function possibleAltPaymentReplacement(game: GameDefinition): boolean {
  return altPaymentConfig(game).possibleReplacement;
}

/**
 * Whether this card could carry one of `names` at all: its text prints the
 * name, on either face, or a resolved effect grants it a keyword. A test on
 * words rather than a reading, so the statics — asked on every value read —
 * parse no skills for the cards that cannot answer; `hookBodiesFor` then
 * reads the ones that can properly.
 */
function mayCarry(ctx: EngineContext, state: VmState, id: string, names: string[]): boolean {
  const def = ctx.defs[state.cards[id]?.cardId ?? ""];
  const text = `${def?.skill ?? ""} ${def?.back?.skill ?? ""}`.toLowerCase();
  return names.some((n) => text.includes(n)) || state.effects.some((e) => e.kind === "keyword" && e.target === id);
}

/**
 * One read-only question about one board — `legalActions`, `rejectedActions`,
 * `boardView` (`./index.ts`) — and the statics it has already worked out.
 *
 * The statics are a function of the board, and nothing in those three changes
 * the board they were handed: a move is tried on a copy (`restedAlready`,
 * `apply`'s clone), which is a different object and so never reads this. Yet
 * every value read inside one of them asked for every [Permanent] again —
 * hundreds of walks of the same programs per menu. Held only for the length
 * of the call, because outside one a caller may change the state in place (a
 * test staging a board does), and only for a reading made with neither guard
 * up, since a reading made under one answers a narrower question.
 */
interface StaticsScope {
  state: VmState;
  ctx: EngineContext;
  game: GameDefinition;
  standing: VmStatic[] | null;
}
let staticsScope: StaticsScope | null = null;

/** Run one read-only question about `state` with its statics read once. The state must not be changed in place while `read` runs. */
export function readingBoard<T>(ctx: EngineContext, game: GameDefinition, state: VmState, read: () => T): T {
  const outer = staticsScope;
  // Already inside a reading of this very board: its statics are this one's.
  if (outer && outer.state === state && outer.ctx === ctx && outer.game === game) return read();
  staticsScope = { state, ctx, game, standing: null };
  try {
    return read();
  } finally {
    staticsScope = outer;
  }
}

/** Every [Permanent] standing right now — and every keyword's `altPayment` body — or nothing while one is being read (see `readingStatics`). */
function statics(ctx: EngineContext, game: GameDefinition, state: VmState): VmStatic[] {
  if (readingStatics) return [];
  const scope = staticsScope && !readingImmunities && staticsScope.state === state && staticsScope.ctx === ctx && staticsScope.game === game ? staticsScope : null;
  if (scope?.standing) return scope.standing;
  const standing = readStatics(ctx, game, state);
  if (scope) scope.standing = standing;
  return standing;
}

function readStatics(ctx: EngineContext, game: GameDefinition, state: VmState): VmStatic[] {
  readingStatics = true;
  try {
    const targets = (frame: ScriptFrame, op: Op) => resolveRef(ctx, game, state, frame, ("target" in op && op.target ? op.target : { sel: { special: "self" } }) as Ref);
    const holds = (frame: ScriptFrame, op: Op) => (op.op === "if" ? condHolds(ctx, game, state, frame, op.cond) : false);
    // "…by 1 for each of your blue Battle Cards": the one amount a standing
    // change can carry, counted over the board. `readingStatics` is already
    // true here, so the count reads printed values and cannot recur.
    const measure = (frame: ScriptFrame, a: Amount) => amount(ctx, game, state, frame, a);
    const standing = permanents(ctx, game, state, targets, holds, measure);
    // #154: a keyword's `altPayment` body is a standing change of the same
    // kinds, read off the cards in play that carry it ([Warrior of Universe
    // 7]'s ≪Universe 7≫ cards with no specified cost, 22-19). Only looked for
    // when the game declares one, since this runs on every value read. The
    // keywords found here are the printed and resolved ones: a keyword a
    // [Permanent] grants is itself a static, and one level is the guard.
    const names = altPaymentKeywords(game);
    if (!names.length) return standing;
    const bodies: { card: string; master: PlayerId; ops: Op[] }[] = [];
    for (const p of Object.keys(state.sides) as PlayerId[])
      for (const zone of inPlayZones(game))
        for (const id of state.sides[p].zones[zone] ?? [])
          if (mayCarry(ctx, state, id, names)) for (const b of hookBodiesFor(ctx, game, state, id, "altPayment")) bodies.push({ card: id, master: p, ops: b.ops });
    return bodies.length ? [...standing, ...keywordStatics(ctx, state, bodies, targets, holds, measure)] : standing;
  } finally {
    readingStatics = false;
  }
}

/**
 * Every [Permanent]'s standing change right now — the same reading `attrsNow`
 * makes, for the two that are not a card attribute (#148): a payer for every
 * energy price (20-19) and another price for a card (5-3), which `vm/costs.ts`
 * reads where a price is planned. One reading, so the recursion guard above is
 * the one guard either path goes through. `vm/view.ts` reads it too, for the
 * board's own picture of the rules in force on a player (#152).
 */
export function staticsNow(ctx: EngineContext, game: GameDefinition, state: VmState): VmStatic[] {
  return statics(ctx, game, state);
}

/**
 * What one [Permanent] line of one card is putting on the board right now —
 * the legacy `permanentStatics`, which the board reads to say whether the line
 * is `on` or `off`. Null while the statics are already being read (the one
 * level of recursion the guard allows); an empty list when the line is
 * unreadable, negated, or the card is not in an area where its skills count.
 * The line is found by its record's identity, so two [Permanent]s on one card
 * are told apart even though a standing change carries no skill index.
 */
export function permanentStaticsOf(ctx: EngineContext, game: GameDefinition, state: VmState, id: string, skillIndex: number): VmStatic[] | null {
  if (readingStatics) return null;
  const card = state.cards[id];
  if (!card || card.hidden || skillsNegated(state, id)) return [];
  const showing = skillsShowing(ctx, state, id);
  const sk = showing.skills.find((k) => k.index === skillIndex);
  if (!sk || sk.kind !== "permanent" || skillNegated(state, id, sk.index, sk.kind)) return [];
  const program = showing.scripts.bySkill[skillIndex];
  if (!program || program.unsupported.length) return [];
  readingStatics = true;
  try {
    return permanents(
      ctx,
      game,
      state,
      (frame, op) => resolveRef(ctx, game, state, frame, ("target" in op && op.target ? op.target : { sel: { special: "self" } }) as Ref),
      (frame, op) => (op.op === "if" ? condHolds(ctx, game, state, frame, op.cond) : false),
      (frame, a) => amount(ctx, game, state, frame, a),
      (ops) => ops === program.ops,
    ).filter((e) => e.source === id);
  } finally {
    readingStatics = false;
  }
}

/** Does this [Permanent] program grant an immunity anywhere in it, `if` branches included? The legacy `grantsImmunity`. */
function grantsImmunity(ops: Op[]): boolean {
  return ops.some((o) => (o.op === "if" ? grantsImmunity(o.then) || grantsImmunity(o.else ?? []) : o.op === "immune"));
}

/**
 * The [Permanent] immunities alone (9-1-4), readable while `statics` is
 * running — see `readingImmunities`. Only the programs that grant one are
 * walked, because this is asked once per candidate of every selector.
 */
function immunityStatics(ctx: EngineContext, game: GameDefinition, state: VmState): VmStatic[] {
  if (readingImmunities) return [];
  readingImmunities = true;
  try {
    return permanents(
      ctx,
      game,
      state,
      (frame, op) => resolveRef(ctx, game, state, frame, ("target" in op && op.target ? op.target : { sel: { special: "self" } }) as Ref),
      (frame, op) => (op.op === "if" ? condHolds(ctx, game, state, frame, op.cond) : false),
      (frame, a) => amount(ctx, game, state, frame, a),
      grantsImmunity,
    ).filter((e) => e.kind === "immune");
  } finally {
    readingImmunities = false;
  }
}

/** An immunity in force on a card, and where it comes from — what a refusal names. */
export interface ImmunityInForce {
  rule: Immunity;
  source: string | null;
  until: EffectUntil;
}

/**
 * 9-1-4: the immunity that refuses a skill whose source card is `source` and
 * whose master is `chooser`, or null when none does — the legacy
 * `immunityRefusing`, read for read. Asked of every chooser, the card's own
 * controller included, because whose skills are blocked is written on the
 * rule: "your opponent's skills" stores that player, "non-<Gogeta: GT>
 * skills" names no side and blocks every skill, and a `fromFilter` needs a
 * source card to match, so a skill with no card behind it gets through. A
 * skill's timed immunity (`state.effects`, the shared interpreter's `immune`
 * case) and a [Permanent]'s are one list.
 */
export function immunityRefusing(ctx: EngineContext, game: GameDefinition, state: VmState, id: string, source: string | undefined, chooser: PlayerId): ImmunityInForce | null {
  const rules: ImmunityInForce[] = [];
  for (const e of state.effects) if (e.kind === "immune" && e.target === id && e.immune) rules.push({ rule: e.immune, source: e.source ?? null, until: e.until });
  for (const e of immunityStatics(ctx, game, state)) if (e.target === id) rules.push({ rule: e.value as Immunity, source: e.source, until: "permanent" });
  return (
    rules.find(
      (im) =>
        (im.rule.from === undefined || im.rule.from === chooser) &&
        (!im.rule.fromFilter || (!!source && !!state.cards[source] && predicateOf(im.rule.fromFilter, game)(attrsNow(ctx, game, state, source)))),
    ) ?? null
  );
}

/** Every name a card answers to in `attrs` (20-1): its printed one and any a skill gave it "in all areas". */
function namesNow(attrs: Attrs): string[] {
  const own = attrs.name;
  const also = attrs.alsoNames;
  return [...(typeof own === "string" ? [own] : []), ...(Array.isArray(also) ? (also as readonly string[]) : [])];
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
  // 20-21: a board-filled price has no printed face of its own — its `printed`
  // layer is the number beside it, and `PRINTED_BASE` is that pairing. Seeded
  // before the layers are walked, so a reduction adds to the printed cost
  // rather than to nothing. Absent stays absent: an X cost has no total until
  // someone names one (1-2-2-2), and 0 would be a price nobody chose.
  const base: Record<string, AttrValue> = { ...printed };
  // 1-9, 10-1-3, 23-5: every declared attribute the owner's face-showing
  // ruling of 20 Sep 2026 names (issue #327) is read off the **face showing**,
  // not off the catalog row unconditionally — `attrsOf` stays that catalog
  // (front) reading, and `face: true` on the declaration is what tells this
  // function which ones to overlay. `faceOf` is the one place either engine
  // reads the shown face from (the legacy `face()` is its counterpart): blank
  // while the card is in Hidden Mode (23-5-2, no front-side information at
  // all), the back's own value once a flipped card has one recorded
  // (`CardDef.back`'s `name`, `power`, `skill`), and the printed value
  // otherwise. `power` is the measure that could not wait for the rest of this
  // ruling (8-4-6, #166's pre-flip review), so it keeps its own read below
  // rather than going through `FACE_FIELD`'s generic one.
  const shownFace = faceOf(ctx, state, id);
  const shown = shownFace?.power;
  if (shown === undefined) delete base.power;
  else base.power = shown;
  // 20-3-1: "an original power of 5000" is that same printed face value,
  // *before* any layer — which is why it is an attribute of its own and not a
  // second reading of `power`, whose declared layers 9-9-1 applies. Reading
  // both off one attribute is what made a 5000-power card pumped to 15000 stop
  // answering to it, and one printed 15000 start (the same review).
  if (game.attributes.originalPower && shown !== undefined) base.originalPower = shown;
  // Every other `face: true` attribute (`name`, `skill`, `colors`, `traits`,
  // every cost): hidden deletes it, same as `power` above. A flipped card
  // substitutes it only when `CardDef.back` actually carries a value of its
  // own — `name` and `skill` are the two that do; colours, traits and every
  // cost have no distinct back-side value the catalog has ever recorded, so
  // 10-1-3 is satisfied by the printed value already sitting in `base` — the
  // feed simply never gave this adapter a second number to prefer.
  const plan = attrPlanOf(game);
  for (const name of plan.face) {
    if (!shownFace) {
      delete base[name];
      continue;
    }
    const field = FACE_FIELD[name];
    if (!field) continue;
    const value = shownFace[field];
    if (value === undefined || value === null) delete base[name];
    else base[name] = value;
  }
  // Explicit original-colour requirements read the shown face before identity
  // effects are applied, just as originalPower does. Hidden Mode has no face.
  if (game.attributes.originalColors && shownFace) base.originalColors = [...list(base.colors)];
  // 1-9, 2-10: a flipped Leader is the character its back side names, not the
  // front's — BT31-001's back is <Gogeta>, not <Son Goku> and <Vegeta>. The
  // catalog records characters off the front only, so the back's are read off
  // its name (`backCharactersOf`), once per definition. Not a `face: true`
  // overlay: that would also blank a Hidden Mode card's characters, which no
  // reading has done before and is not this issue's (#464).
  if (card?.flipped && def.back && game.attributes.characters && shownFace) base.characters = backCharactersOf(def);
  for (const [derived, face] of Object.entries(PRINTED_BASE)) {
    if (!game.attributes[derived] || base[face] === undefined) continue;
    base[derived] = base[face];
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
  // `base.skill`, not `printed.skill`: keywords come off the face showing the
  // same as the rest of a card's text (1-9, 10-1-3, issue #327) — a flipped
  // Leader's awakened side is what `keywordsInForce`/`hasKeyword` (both read
  // through this attribute) must find [Blocker] and friends in, and a Hidden
  // Mode card grants none at all (23-5-2), which `base.skill` being absent
  // there already gives for free.
  if (game.attributes.keywords) base.keywords = skillsNegated(state, id) ? [] : printedKeywordNames(typeof base.skill === "string" ? base.skill : null);
  // 1-5-9, 9-1-4: a filter's bare "skill-less" — the legacy `skillLessNow`.
  if (game.attributes.skillLess) base.skillLess = skillLessNow(ctx, game, state, id, standing);
  // The value every layer is applied *to*, so an attribute the base left out —
  // a hidden card's power — stays out rather than falling back to the catalog
  // row the spread above would have carried.
  const out: Record<string, AttrValue> = { ...base };
  // Every change in force **about this card**, of every kind: which of them a
  // layer reads is `LAYER_KINDS`, and keeping that pairing in one place is the
  // whole reason this no longer filters by the attribute's name (#148).
  const mine = standing.filter((e) => e.target === id);
  const timed = state.effects.filter((e) => e.target === id);
  // 20-1: list identity changes add to the effective card in every area, but
  // do not rewrite what is printed. Generic selectors keep reading effective
  // attributes; rules that explicitly ask for original colours must use the
  // declared originalColors attribute separately.
  const identity = [
    ...mine.filter((e) => e.kind === "gains").map((e) => e.value),
    ...timed.filter((e) => e.kind === "gains").map((e) => e.value),
  ] as CardIdentityGain[];
  for (const [attr, field] of [["traits", "traits"], ["characters", "characters"], ["colors", "colors"], ["alsoNames", "names"]] as const) {
    const current = out[attr];
    if (!Array.isArray(current)) continue;
    const values = [...current];
    for (const gain of identity) {
      for (const value of gain[field]) if (!values.some((existing) => existing.toLowerCase() === value.toLowerCase())) values.push(value);
    }
    out[attr] = values;
  }
  for (const name of plan.layered) {
    const refusedNegation = name === "keywords" && keywordNegationRefused(ctx, game, state, id, standing);
    const layerStatics = name === "keywords" && skillsNegated(state, id)
      ? mine.filter((e) => e.kind !== "keyword")
      : refusedNegation
        ? mine.filter((e) => e.kind !== "negateKeyword")
        : mine;
    const layerTimed = name === "keywords" ? timed.filter((e) => e.kind !== "keyword" || (!skillsNegated(state, id) && !grantedSkillNegated(state, id, e.id))) : timed;
    const value = valueOf(game, base, name, name === "keywords" ? layerStatics.filter((e) => e.kind !== "keyword" || e.standingGrantId === undefined || !grantedSkillNegated(state, id, e.standingGrantId)) : layerStatics, layerTimed);
    if (value !== undefined) out[name] = value;
  }
  // #154: a keyword's `attrBonus` hook is a further layer, read after the
  // declared ones and added to whatever they left — [Servant]'s flat +10000
  // power (22-40) is the worked example. Read here rather than folded into
  // `valueOf`'s own layers because it is not a `state.effects`/[Permanent]
  // change at all: a keyword's own body, granted for as long as the card
  // shows the keyword, the same standing `queryHookStatics` already is for
  // `chooseable`/`koByEffect` above `prohibitions()`.
  for (const fact of queryHookStatics(ctx, game, state, id, "attrBonus")) {
    if (fact.op !== "modifyAttr") continue;
    const current = out[fact.attr];
    if (typeof current === "number") out[fact.attr] = current + fact.delta;
  }
  return out;
}

/**
 * 1-5-9, 9-1-4: the card has no skill in force — every line its face shows
 * (copies included, 20-18) is negated or there is none, and no keyword is
 * granted to it by an effect or a [Permanent] in force (`standing`, which
 * `attrsNow` has already read). A Hidden Mode card has no text to read at
 * all (23-5-2). The legacy engine's `skillLessNow`, over this engine's state.
 */
function skillLessNow(ctx: EngineContext, game: GameDefinition, state: VmState, id: string, standing: readonly VmStatic[]): boolean {
  const card = state.cards[id];
  if (!card || card.hidden) return true;
  // 9-1-5 silences every kind of skill, including keywords granted by an
  // effect or a standing [Permanent]. Keep the selector aligned with the
  // keyword readers below, which apply the same all-skills negation.
  if (skillsNegated(state, id)) return true;
  if (skillsShowing(ctx, state, id).skills.some((sk) => !skillNegated(state, id, sk.index, sk.kind))) return false;
  const granted = (e: { kind: string; target?: string; value?: unknown }) => e.kind === "keyword" && e.target === id && !keywordNegatedFor(ctx, game, state, id, (e.value as KeywordSkill)?.name, standing);
  return !state.effects.some((e) => granted(e) && !grantedSkillNegated(state, id, e.id)) && !standing.some((e) => granted(e) && (e.standingGrantId === undefined || !grantedSkillNegated(state, id, e.standingGrantId)));
}

/**
 * Which of a game's declared attributes `attrsNow` overlays from the face
 * showing, and which have layers to apply — in declaration order, worked out
 * once per definition rather than on every value read. A definition is never
 * changed once `loadRuleset` has built it.
 */
const ATTR_PLAN = new WeakMap<GameDefinition, { face: string[]; layered: string[] }>();
const CHECKING_STATIC_NEGATION = new WeakMap<VmState, Set<string>>();
function attrPlanOf(game: GameDefinition): { face: string[]; layered: string[] } {
  let plan = ATTR_PLAN.get(game);
  if (!plan) {
    const entries = Object.entries(game.attributes);
    plan = {
      face: entries.filter(([name, decl]) => decl.face && name !== "power" && name !== "originalPower").map(([name]) => name),
      layered: entries.filter(([, decl]) => decl.layers?.length).map(([name]) => name),
    };
    ATTR_PLAN.set(game, plan);
  }
  return plan;
}

/**
 * The keyword names a skill text prints — `keywordsInSkills(parseSkills(…))`,
 * the one way a keyword is read, kept per text the way `parseSkills` is. Asked
 * on every value read; frozen, because every caller shares it.
 */
const KEYWORD_NAMES = new Map<string, readonly string[]>();
const NO_KEYWORDS: readonly string[] = Object.freeze([]);
function printedKeywordNames(text: string | null): readonly string[] {
  if (!text) return NO_KEYWORDS;
  let names = KEYWORD_NAMES.get(text);
  if (!names) {
    if (KEYWORD_NAMES.size >= 20_000) KEYWORD_NAMES.clear();
    names = Object.freeze(keywordsInSkills(parseSkills(text)).map((k) => k.name));
    KEYWORD_NAMES.set(text, names);
  }
  return names;
}

/** What `CardDef.back` carries a value of its own for — the two `attrsNow`'s generic `face: true` overlay substitutes on a flip, `power` (read separately, below) beside them. */
interface FaceValues {
  name: string;
  power: number | undefined;
  skill: string | null | undefined;
}

/** Which declared-attribute name each `FaceValues` field answers to, for `attrsNow`'s generic overlay. */
const FACE_FIELD: Partial<Record<string, keyof FaceValues>> = { name: "name", skill: "skill" };

/**
 * The face a card is showing right now, or nothing at all while it is hidden.
 *
 * The legacy `face(ctx, s, id)`, exactly: a Hidden Mode card shows no
 * front-side information (23-5-2) and so has none, a flipped Leader shows its
 * awakened side's `name`/`power`/`skill` (1-9), and every other card shows the
 * catalog row's. `undefined` rather than a blank face for the first, because
 * "this card has no face to read" and "this card's face reads as nothing" are
 * different claims, and every reader below already treats an absent card the
 * same way it treats a hidden one.
 */
function faceOf(ctx: EngineContext, state: VmState, id: string): FaceValues | undefined {
  const card = state.cards[id];
  const def = card ? ctx.defs[card.cardId] : undefined;
  if (!card || !def || card.hidden) return undefined;
  if (card.flipped && def.back) return { name: def.back.name, power: def.back.power ?? undefined, skill: def.back.skill ?? undefined };
  return { name: def.name, power: def.power ?? undefined, skill: def.skill ?? undefined };
}

/** One number off one card, for the `attr` and `sumOf` amounts — a cost read through its reduction layer (20-21-2), as the legacy `measure` reads it. */
function measureOf(ctx: EngineContext, game: GameDefinition, state: VmState, id: string, name: AmountAttr, information?: Attrs): number {
  const now = information ?? attrsNow(ctx, game, state, id);
  switch (name) {
    case "power":
      return num(now.power);
    case "originalPower":
      if (information) return num(information.originalPower);
      // 20-3-1: the printed face value, before any layer — the same number
      // `attrsNow` seeds the `originalPower` attribute from, read through the
      // one helper so the amount and the filter cannot answer differently.
      // 23-5-2-4: a skill naming a Hidden Mode card reads its front side —
      // "the original power on the front of the card that was switched to
      // Hidden Mode by this skill" (BT28-105) — where every other reader
      // finds nothing at all.
      if (state.cards[id]?.hidden) return ctx.defs[state.cards[id].cardId]?.power ?? 0;
      return faceOf(ctx, state, id)?.power ?? 0;
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
    // 1-2-3: the number of orbs the specified cost asks for, as it stands (or
    // as it stood, for a card read from a movement's captured information);
    // a card with no specified cost to read has none.
    case "specifiedCost":
      return Array.isArray(now.specifiedCost) ? now.specifiedCost.length : 0;
  }
}

/**
 * Every rule of the game lifted right now (8-1-1, 5-7): a resolved skill's
 * `permit` effect for its span, and a [Permanent]'s standing one. Each says
 * which card it is about (`target` — the attacker for `attackActive`, the
 * card granting it for `comboRest`), whose rule it is, and which cards it
 * lets in.
 */
export function permissions(ctx: EngineContext, game: GameDefinition, state: VmState, what: Permission["what"]): { target: string; master: PlayerId; filter?: CardFilter }[] {
  const out: { target: string; master: PlayerId; filter?: CardFilter }[] = [];
  for (const e of state.effects) {
    const p = e.kind === "permit" ? e.permit : undefined;
    if (p?.what === what) out.push({ target: e.target, master: e.master, ...(p.filter ? { filter: p.filter } : {}) });
  }
  for (const e of staticsNow(ctx, game, state)) {
    const p = e.value as Permission;
    if (e.kind === "permit" && p.what === what) out.push({ target: e.target, master: e.master, ...(p.filter ? { filter: p.filter } : {}) });
  }
  return out;
}

/** Does this card answer a permission's description? None means any card. A Hidden Mode card answers none (23-5-2). */
export function permitted(ctx: EngineContext, game: GameDefinition, state: VmState, filter: CardFilter | undefined, id: string): boolean {
  if (state.cards[id]?.hidden) return false;
  return !filter || predicateOf(filter, game)(attrsNow(ctx, game, state, id));
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
  // 23-5-2-1: a skill a Hidden Mode card gains is ignored, so a granted
  // [Blocker] or [Barrier] is no more in force than a printed one.
  if (!card || card.hidden || skillsNegated(state, id)) return false;
  const standing = statics(ctx, game, state);
  if (keywordNegatedFor(ctx, game, state, id, name, standing)) return false;
  for (const k of printedKeywords(ctx, state, id)) if (k.name === name) return true;
  for (const e of state.effects) if (e.kind === "keyword" && e.target === id && (e.value as KeywordSkill)?.name === name && !grantedSkillNegated(state, id, e.id)) return true;
  for (const e of standing) if (e.kind === "keyword" && e.target === id && (e.value as KeywordSkill)?.name === name && (e.standingGrantId === undefined || !grantedSkillNegated(state, id, e.standingGrantId))) return true;
  return false;
}

/**
 * The keywords a card's own printed face carries right now: none while it is
 * in Hidden Mode or has its skills negated, and not the lines negated one at a
 * time or by kind (9-1-5) — the legacy `keywordsInForce`'s printed half, which
 * is why "negate its skills for the turn" takes [Blocker] off a card here too
 * (#439). Grants are collected separately, then named keyword negation is
 * applied to printed and granted skills alike.
 */
function printedKeywords(ctx: EngineContext, state: VmState, id: string): KeywordSkill[] {
  if (state.cards[id].hidden || skillsNegated(state, id)) return [];
  return skillsShowing(ctx, state, id)
    .skills.filter((sk) => sk.keyword && !skillNegated(state, id, sk.index, sk.kind))
    .map((sk) => sk.keyword!);
}

/**
 * Every keyword skill this card has in force right now — `hasKeyword`'s own
 * three sources (printed, granted by an effect, granted by a [Permanent] in
 * force), collected rather than tested against one name. `vm/hooks.ts` reads
 * this to find which `DEFINE KEYWORD` hook bodies a card's own keywords may
 * hang at a given moment (#153); nothing else needs every keyword at once.
 */
export function keywordsInForce(ctx: EngineContext, game: GameDefinition, state: VmState, id: string): KeywordSkill[] {
  return keywordInstancesInForce(ctx, game, state, id).map((instance) => instance.keyword);
}

/** Keep each timed grant's persisted effect ID beside its keyword for hooks. */
function keywordInstancesInForce(ctx: EngineContext, game: GameDefinition, state: VmState, id: string): { keyword: KeywordSkill; grantEffectId?: number; standingGrantId?: string }[] {
  const card = state.cards[id];
  // 23-5-2-1, as in `hasKeyword`.
  if (!card || card.hidden || skillsNegated(state, id)) return [];
  const standing = statics(ctx, game, state);
  const out: { keyword: KeywordSkill; grantEffectId?: number; standingGrantId?: string }[] = printedKeywords(ctx, state, id).map((keyword) => ({ keyword }));
  for (const e of state.effects) if (e.kind === "keyword" && e.target === id && !grantedSkillNegated(state, id, e.id)) out.push({ keyword: e.value as KeywordSkill, grantEffectId: e.id });
  for (const e of standing) if (e.kind === "keyword" && e.target === id && (e.standingGrantId === undefined || !grantedSkillNegated(state, id, e.standingGrantId))) out.push({ keyword: e.value as KeywordSkill, ...(e.standingGrantId === undefined ? {} : { standingGrantId: e.standingGrantId }) });
  return out.filter(({ keyword }) => !keywordNegatedFor(ctx, game, state, id, keyword.name, standing));
}

/**
 * 9-1-5: one keyword skill of this card negated for a span — the one a
 * `negateChosenKeyword` step had its master pick. Read last by both
 * `hasKeyword` and `keywordsInForce`, so it beats a grant of the same keyword,
 * the way the legacy `keywordsInForce` applies it.
 */
function keywordNegatedFor(ctx: EngineContext, game: GameDefinition, state: VmState, id: string, name: KeywordSkill["name"] | undefined, standing: readonly VmStatic[] = []): boolean {
  if (!name) return false;
  if (state.effects.some((e) => e.kind === "negateKeyword" && e.target === id && e.value === name)) return true;
  return !keywordNegationRefused(ctx, game, state, id, standing) && standing.some((e) => e.kind === "negateKeyword" && e.target === id && e.value === name);
}

/** A standing negation is still subject to 20-14's `beNegated` prohibition. */
function keywordNegationRefused(ctx: EngineContext, game: GameDefinition, state: VmState, id: string, standing: readonly VmStatic[]): boolean {
  if (!standing.some((e) => e.kind === "negateKeyword" && e.target === id)) return false;
  let active = CHECKING_STATIC_NEGATION.get(state);
  if (!active) CHECKING_STATIC_NEGATION.set(state, active = new Set());
  if (active.has(id)) return false;
  active.add(id);
  try {
    return forbids(ctx, game, state, "beNegated", { card: id });
  } finally {
    active.delete(id);
  }
}

// ── the hook contract's own reading (#153, `vm/hook-contract.ts`) ──────────
//
// A fifth reading beside `resolveSelector`/`resolveRef`/`amount`/`condHolds`:
// what a keyword's `HOOK` body means. Lives here rather than in `vm/hooks.ts`
// (which already imports this module for the query half) specifically so
// `vm/hooks.ts` can import *this* file without a cycle — `queryHookStatics`
// needs exactly the recursion-guarded `condHolds`/`amount` above, the same
// reason `vm/effects.ts`'s `permanents()` takes them as callbacks instead of
// importing this module. `vm/hooks.ts` re-exports everything here as the
// contract's public surface; nothing outside this file and `vm/hooks.ts`
// should read `game.keywords[...].hooks` directly (`scripts/verify/
// rulesets.ts` asserts it).

/** One keyword's body at one hook point, with the keyword instance that carries it; the body's `$name` parameters are already filled in from it. */
export interface HookBody {
  keyword: KeywordSkill;
  ops: Op[];
  /** Printed keyword skill being resolved; needed by `negateOwnSkill` (9-1-5). */
  skillIndex?: number;
  /** Identity of an effect-granted keyword; distinct from printed indexes. */
  grantEffectId?: number;
  /** Identity of a [Permanent] grant recomputed from the same source entry. */
  standingGrantId?: string;
}

/**
 * Every body among `subject`'s keywords in force that hangs on `point` —
 * `keywordsInForce`'s own list above, narrowed to the ones whose
 * `DEFINE KEYWORD` declares a `HOOK` there. The one place either runner
 * (this file's `queryHookStatics`, `vm/hooks.ts`'s `fireHook`) looks a body
 * up, so a second lookup written into a call site instead of here would be
 * exactly the special case the contract exists to rule out.
 */
export function hookBodiesFor(ctx: EngineContext, game: GameDefinition, state: VmState, subject: string, point: HookPoint): HookBody[] {
  const out: HookBody[] = [];
  // `keywordsInForce` starts with printed skills, then appends effect/static
  // grants. Consume printed identities in that same order so a grant of a
  // keyword already printed on the card cannot borrow its skillIndex.
  const printed = new Map<string, number[]>();
  if (!state.cards[subject]?.hidden && !skillsNegated(state, subject)) {
    for (const skill of skillsShowing(ctx, state, subject).skills) {
      if (skill.keyword && !skillNegated(state, subject, skill.index, skill.kind)) {
        const indexes = printed.get(skill.keyword.name) ?? [];
        indexes.push(skill.index);
        printed.set(skill.keyword.name, indexes);
      }
    }
  }
  for (const instance of keywordInstancesInForce(ctx, game, state, subject)) {
    const kw = instance.keyword;
    const def = game.keywords[kw.name];
    const hooks = def?.hooks?.filter((hook) => hook.at === point) ?? [];
    const skillIndex = hooks.length && instance.grantEffectId === undefined && instance.standingGrantId === undefined ? printed.get(kw.name)?.shift() : undefined;
    // #156: a body names its keyword's parameters the way a `DO` does —
    // [Strike]'s `$x` is 2 on a [Double Strike] — bound from the instance in
    // force, granted or printed.
    for (const hook of hooks) {
      out.push({ keyword: kw, ops: bindKeywordParams(hook.ops, def.takes, kw as unknown as Record<string, unknown>, game), ...(skillIndex === undefined ? {} : { skillIndex }), ...(instance.grantEffectId === undefined ? {} : { grantEffectId: instance.grantEffectId }), ...(instance.standingGrantId === undefined ? {} : { standingGrantId: instance.standingGrantId }) });
    }
  }
  return out;
}

/** A minimal frame for a hook body: the language's own shape, `self` bound the way every program already reads its own card, plus whatever this hook's `vars` name. Exported for `vm/hooks.ts`'s `fireHook`. */
export function hookFrame(game: GameDefinition, state: VmState, subject: string, ops: Op[], vars: Record<string, string[]>, skillIndex?: number, grantEffectId?: number, standingGrantId?: string): ScriptFrame {
  return { ops, ip: 0, vars: { self: [subject], ...vars }, card: subject, master: masterOf(game, state, subject), pendingHookSkill: true, ...(skillIndex === undefined ? {} : { skillIndex }), ...(grantEffectId === undefined ? {} : { grantEffectId }), ...(standingGrantId === undefined ? {} : { standingGrantId }) };
}

export type QueryFact =
  | { keyword: KeywordSkill; op: "forbid"; forbid: Prohibition }
  | { keyword: KeywordSkill; op: "modifyAttr"; attr: CardAttr | "energyMarkers" | "guard"; delta: number }
  | { keyword: KeywordSkill; op: "battleDamage"; atLeast?: number; to?: "drop"; allMarkers?: boolean; wins?: boolean }
  | { keyword: KeywordSkill; op: "carryMarkers"; upTo: number; color: Color | null }
  | { keyword: KeywordSkill; op: "replace"; event: string; with: Op[] };

/**
 * Every fact a query hook's bodies are in force to state right now — read
 * fresh, applying nothing, the way `permanents()` reads a [Permanent]. Walks
 * `if` to its taken branch and reads the leaf op every query hook is
 * documented to end in (`forbid`, `modifyAttr`) — `forbid`'s own
 * `ForbiddenAction` vocabulary already names every query hook's refusal
 * (`beChosen` for `chooseable`, `beKOdBySkill`/`beMovedBySkill` for
 * `koByEffect`, `play` for `playRefused`, `activateCounter` for
 * `counterWindow`), so a query hook never needed a second "nothing may touch
 * this card" primitive beside the 20-14 prohibitions `prohibitions()` already
 * reads (#154 found this while wiring [Barrier] — #153's own `immune`-shaped
 * example for `chooseable`/`koByEffect` was illustrative and wrong; `forbid`
 * is what actually reaches the rejection machinery a candidate's "why not"
 * reads, `vm/actions.ts`'s `forbiddenBy`). A body that ends in anything else
 * is a ruleset the loader should have refused and this throws rather than
 * silently reading nothing — `docs/arena-tooling.md` §6.2's "prefer unread to
 * wrongly read" applies to a hook body exactly as it does to a card's.
 */
export function queryHookStatics(ctx: EngineContext, game: GameDefinition, state: VmState, subject: string, point: HookPoint): QueryFact[] {
  const spec = HOOK_CONTRACT[point];
  if (spec.answer !== "query") throw new Error(`vm/program.ts: "${point}" is an effect hook — use fireHook, not queryHookStatics`);
  const out: QueryFact[] = [];
  for (const body of hookBodiesFor(ctx, game, state, subject, point)) {
    const frame = hookFrame(game, state, subject, body.ops, {});
    readHookLeaf(ctx, game, state, frame, body.ops, body.keyword, out);
  }
  return out;
}

function readHookLeaf(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame, ops: Op[], keyword: KeywordSkill, out: QueryFact[]): void {
  for (const raw of ops) {
    // Only `negate`/`costModifier`'s own short spellings are normalised here
    // — deliberately *not* `modifyAttrAs`, which lowers `modifyAttr` to the
    // primitive it stands for (`switchMode`, `addMarker`, `grant`, …) the way
    // `vm/effects.ts`'s `collect()` wants it. A query hook's body is
    // documented to end in `modifyAttr` itself (§4.1/§4.2), so lowering it
    // here would make the very shape the contract promises unreadable.
    const op = costModifierAs(negateAs(raw));
    if (op.op === "if") {
      if (condHolds(ctx, game, state, frame, op.cond)) readHookLeaf(ctx, game, state, frame, op.then, keyword, out);
      else if (op.else) readHookLeaf(ctx, game, state, frame, op.else, keyword, out);
      continue;
    }
    if (op.op === "forbid") {
      const player = op.side === "opponent" ? other(frame.master) : op.side === "you" ? frame.master : undefined;
      out.push({
        keyword,
        op: "forbid",
        forbid: {
          what: op.what,
          attackTarget: op.attackTarget,
          filter: op.filter,
          player,
          unless: op.unless,
          uses: op.uses !== undefined ? amount(ctx, game, state, frame, op.uses) : undefined,
          master: frame.master,
          // [Unique]'s "a card with the same name" (22-39) and a declared
          // play's "except by skills" — the two fields a `forbid` leaf names
          // that a [Permanent]'s own reading (`vm/effects.ts`) already keeps.
          ...(op.sameNameAsSelf ? { name: nameShowing(ctx, state, frame.card) } : {}),
          ...(op.bySkill !== undefined ? { bySkill: op.bySkill } : {}),
        },
      });
      continue;
    }
    if (op.op === "modifyAttr" && op.attr) {
      out.push({ keyword, op: "modifyAttr", attr: op.attr, delta: op.amount !== undefined ? amount(ctx, game, state, frame, op.amount) : 0 });
      continue;
    }
    // #156: `beforeDamage`'s leaf — how this card's battle damage lands.
    if (op.op === "battleDamage") {
      out.push({
        keyword,
        op: "battleDamage",
        ...(op.atLeast !== undefined ? { atLeast: amount(ctx, game, state, frame, op.atLeast) } : {}),
        ...(op.to ? { to: op.to } : {}),
        ...(op.allMarkers ? { allMarkers: true } : {}),
        ...(op.wins ? { wins: true } : {}),
      });
      continue;
    }
    // #157: `markerCarry`'s leaf — how many markers may come across, and from
    // a Unison of which colour.
    if (op.op === "carryMarkers") {
      out.push({ keyword, op: "carryMarkers", upTo: amount(ctx, game, state, frame, op.upTo), color: op.color ?? null });
      continue;
    }
    // `wouldLeave`'s leaf — what the card does instead of leaving play
    // ([Ultimate], 22-14-3), read by `vm/replace.ts`'s `leaveRoute` as the
    // redirect a [Permanent]'s `replace` is.
    if (op.op === "replace") {
      out.push({ keyword, op: "replace", event: op.event, with: op.with });
      continue;
    }
    throw new Error(`vm/program.ts: [${keyword.name}]'s body is a query hook and ends in "${op.op}", which none of the contract's query hooks document`);
  }
}

// ── prohibitions (20-14) ────────────────────────────────────────────────────

/** One rule in force that forbids something, with where it came from — a refusal has to name both. */
interface RuleInForce {
  /** The card it is about; empty for a rule about a player rather than a card. */
  target: string;
  /** The card whose skill made the rule; null for a turn-long effect that names none. */
  source: string | null;
  until: EffectUntil;
  /** The source controller of a timed rule; absent on standing/own rules. */
  master?: PlayerId;
  forbid: Prohibition;
  /**
   * #677: which rule this is, stable across a save — a timed effect's id, a
   * standing rule's source card and its place among that card's rules — so a
   * price already charged for one activation is never charged again, and one
   * whose rule has gone is not charged at all.
   */
  key: string;
}

/**
 * Every prohibition on the board, in the order the legacy `forbids` reads
 * them: the timed ones, the standing ones, then the card's own (9-1-3-3).
 *
 * `hooks: false` leaves the fourth source (below) out — `resolveSelector`'s
 * own 20-4 check uses it, because [Barrier]'s `chooseable` hook fact carries
 * exemptions ([Barrier]-flavoured wording, 22-16-2's "ignoring [Barrier]",
 * and the hand carve-out) that are read separately, directly off the hook,
 * and must not be re-applied to `ownProhibitions`/`state.effects`/a
 * [Permanent] by this function folding every source into one boolean.
 */
function prohibitions(ctx: EngineContext, game: GameDefinition, state: VmState, card?: string, opts: { hooks?: boolean } = {}): RuleInForce[] {
  const out: RuleInForce[] = [];
  for (const e of state.effects) if (e.kind === "forbid" && e.forbid) out.push({ target: e.target, source: e.source ?? null, until: e.until, master: e.master, forbid: e.forbid, key: `effect:${e.id}` });
  const ordinal: Record<string, number> = {};
  for (const e of statics(ctx, game, state)) {
    if (e.kind !== "forbid") continue;
    const n = (ordinal[e.source] = (ordinal[e.source] ?? -1) + 1);
    out.push({ target: e.target, source: e.source, until: "permanent", forbid: e.value as Prohibition, key: `static:${e.source}:${n}` });
  }
  if (card) {
    const master = masterOf(game, state, card);
    for (const [i, f] of ownProhibitions(ctx, state, card, (frame, a) => amount(ctx, game, state, frame, a), master).entries()) out.push({ target: card, source: card, until: "permanent", forbid: f, key: `own:${card}:${i}` });
    // #154: a keyword's own `chooseable`/`koByEffect` hook is a fourth source,
    // read fresh alongside the card's other own rules ([Barrier], 22-16, is
    // the worked example) — `until: "permanent"` for the same reason
    // `ownProhibitions` above is: a granted or printed keyword holds for as
    // long as the card shows it, not for a stored span.
    if (opts.hooks !== false) {
      for (const point of ["chooseable", "koByEffect"] as const)
        for (const [i, fact] of queryHookStatics(ctx, game, state, card, point).entries()) if (fact.op === "forbid") out.push({ target: card, source: card, until: "permanent", forbid: fact.forbid, key: `hook:${card}:${point}:${i}` });
    }
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
  opts: { player?: PlayerId; card?: string; bySkill?: boolean; source?: string; attackTarget?: string; skillKind?: string; evolution?: boolean; from?: string },
): boolean {
  const f = rule.forbid;
  if (f.what !== what) return false;
  // A missing/stale defender cannot prove that a qualified declaration is legal.
  // Only declaration callers supply this context; Blocker redirects do not.
  if (f.attackTarget && opts.attackTarget && state.cards[opts.attackTarget] &&
      !predicateOf(f.attackTarget, game)(attrsNow(ctx, game, state, opts.attackTarget))) return false;
  // #677, 12-1-3: "activating an Extra Card" is an [Activate] or [Counter]
  // skill of one used from the hand (BT10-097) — the area it was used from,
  // which the caller names once the card has gone on to the Drop (12-2-2-2).
  if (f.extraCardActivation) {
    if (opts.skillKind !== undefined && !/^(?:activate|counter)\b/.test(opts.skillKind)) return false;
    const from = opts.from ?? (opts.card ? findCard(state, opts.card)?.zone : undefined);
    if (from !== undefined && from !== "hand") return false;
  }
  // #716: "[Counter: Play] skills of other cards" (BT10-008) — only that kind
  // of line, and never the card whose rule it is. Asked without a line, the
  // kind cannot exclude anything, so the rule is read as applying.
  if (f.counterKind && opts.skillKind !== undefined && counterKindOf(opts.skillKind) !== f.counterKind) return false;
  if (f.otherCards && rule.source && rule.source === opts.card) return false;
  // "By skills" and "except by skills" are opposite halves of one wording, and
  // a rule that names one of them says nothing about the other.
  if (f.bySkill !== undefined && opts.bySkill !== undefined && f.bySkill !== opts.bySkill) return false;
  // #933: "…with non-[Evolve] skills" — a skill play that is an evolution is
  // the one thing the rule lets through. Asked without saying what kind of
  // play it is, the rule is read as applying (nothing proves it an evolution).
  if (f.exceptEvolve && opts.evolution === true) return false;
  if (rule.target && rule.target !== opts.card) return false;
  if (f.player && opts.player && f.player !== opts.player) return false;
  // BT8-051: "if the turn player would use the skill of a Battle Card or Extra
  // Card to …" — only an action that skill takes, and only the turn player's.
  if (f.byTypes?.length) {
    const by = opts.source ? state.cards[opts.source] : undefined;
    const printed = by ? ctx.defs[by.cardId] : undefined;
    if (!printed || !f.byTypes.includes(baseType(printed))) return false;
  }
  if (f.turnPlayer && opts.player !== state.turnPlayer) return false;
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
export function forbids(ctx: EngineContext, game: GameDefinition, state: VmState, what: ForbiddenAction, opts: { player?: PlayerId; card?: string; bySkill?: boolean; source?: string; hooks?: boolean; attackTarget?: string; skillKind?: string; evolution?: boolean } = {}): boolean {
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
  opts: { player?: PlayerId; card?: string; bySkill?: boolean; source?: string; hooks?: boolean; attackTarget?: string; skillKind?: string; evolution?: boolean } = {},
): { by: string | null; until?: EffectUntil; unless?: string } | null {
  for (const rule of prohibitions(ctx, game, state, opts.card, { hooks: opts.hooks })) {
    if (!ruleApplies(ctx, game, state, what, rule, opts)) continue;
    if ((rule.forbid.uses ?? 0) > 0) continue;
    // A rule with a price is a tax, not a ban: `taxesOn` below is what reads it.
    if (rule.forbid.pay) continue;
    const viewer = opts.player ?? (opts.card && state.cards[opts.card] ? masterOf(game, state, opts.card) : undefined);
    const master = rule.forbid.master;
    return {
      by: rule.source && state.cards[rule.source] ? (nameShowing(ctx, state, rule.source) ?? null) : null,
      until: rule.until,
      ...(rule.forbid.unless ? { unless: sayCond(master && viewer && master !== viewer ? mirrorSides(rule.forbid.unless) : rule.forbid.unless) } : {}),
    };
  }
  // 22-39 (#157): a play is refused by a keyword of a card already in play —
  // [Unique]'s `playRefused` hook, asked of every card in play when a play is
  // checked, since the rule is the in-play card's ("while a card with [Unique]
  // is in play you can't play another card with the same name"). The keyword
  // is the game's own rule rather than an effect, so it names no duration —
  // the legacy `whyNotPlay`'s own refusal, `{ kind: "forbidden", by }`.
  if (what === "play" && opts.hooks !== false) {
    for (const side of [state.sides.p1, state.sides.p2]) {
      for (const source of inPlayZones(game).flatMap((zone) => side.zones[zone] ?? [])) {
        for (const fact of queryHookStatics(ctx, game, state, source, "playRefused")) {
          if (fact.op !== "forbid") continue;
          if (!ruleApplies(ctx, game, state, what, { target: "", source, until: "permanent", forbid: fact.forbid, key: `hook:${source}:playRefused` }, opts)) continue;
          return { by: nameShowing(ctx, state, source) ?? null };
        }
      }
    }
  }
  return null;
}

/** One price a rule in force charges for an action (20-14-1), with the words a refusal names it by. */
export interface TaxInForce {
  ops: Op[];
  by: string | null;
  until: EffectUntil;
  /** #677: the rule's stable identity (`RuleInForce.key`). */
  key: string;
}

/**
 * 20-14-1, "you can't do A unless you do B … each time": every rule in force
 * that lets this action happen **only after** a price is paid (`Prohibition.pay`).
 *
 * The same rules and matcher `forbiddenBy` reads, which skips these — a tax is
 * not a ban. Each applies to every action of its kind, so the caller charges
 * all of them, in this order, every time; whether they *can* be paid is the
 * caller's question (`canPayPriceProgram`), asked of the acting player.
 */
export function taxesOn(ctx: EngineContext, game: GameDefinition, state: VmState, what: ForbiddenAction, opts: { player?: PlayerId; card?: string; bySkill?: boolean; source?: string; attackTarget?: string; skillKind?: string; evolution?: boolean; from?: string; counted?: boolean } = {}): TaxInForce[] {
  const out: TaxInForce[] = [];
  for (const rule of prohibitions(ctx, game, state, opts.card)) {
    // `counted` asks the other half (#677): the priced rules whose free uses
    // are not spent yet, so the activation that spends one is not charged
    // once the use is gone.
    if (!rule.forbid.pay?.length || ((rule.forbid.uses ?? 0) > 0) !== !!opts.counted) continue;
    if (!ruleApplies(ctx, game, state, what, rule, opts)) continue;
    out.push({ ops: rule.forbid.pay, by: rule.source && state.cards[rule.source] ? (nameShowing(ctx, state, rule.source) ?? null) : null, until: rule.until, key: rule.key });
  }
  return out;
}

/**
 * The card-only half of 20-14: a rule in force that names **this card** as its
 * target. The legacy `forbiddenForCard`, test for test — no filter, no player,
 * a spent-down budget and an escape clause read the same way — and asked by
 * the one refusal that needs it: a rested card whose "can't switch to Active
 * Mode" lock (7-2-7 lifted by 20-14) makes the `mode` requirement `locked`.
 */
export function forbiddenForCard(ctx: EngineContext, game: GameDefinition, state: VmState, what: ForbiddenAction, card: string): boolean {
  for (const rule of prohibitions(ctx, game, state, card, { hooks: false })) {
    if (rule.target !== card || rule.forbid.what !== what || (rule.forbid.uses ?? 0) > 0 || rule.forbid.pay) continue;
    if (what === "switchToActiveInCharge" && rule.until === "afterOpponentCharge" && rule.master === state.turnPlayer) continue;
    if (escapeHolds(ctx, game, state, rule.forbid, { card }, rule.source)) continue;
    return true;
  }
  return false;
}

/**
 * 20-14: a counted prohibition ("…can't attack more than once", `uses`) spends
 * one of its uses on each action of the kind it names that it applies to.
 *
 * The legacy `spendProhibitionUse`, test for test: only the timed effects carry
 * a budget to spend (a [Permanent]'s is re-read fresh each time, so there is
 * nothing on it to count down), `ruleApplies` is the same matcher `forbiddenBy`
 * reads, and the budget never goes below zero. `forbiddenBy` above skips a rule
 * whose budget is still unspent, so the action that spends the last use is the
 * one that turns the rule on.
 */
export function spendProhibitionUse(ctx: EngineContext, game: GameDefinition, state: VmState, what: ForbiddenAction, opts: { player?: PlayerId; card?: string; bySkill?: boolean; source?: string } = {}): void {
  for (const e of state.effects) {
    if (e.kind !== "forbid" || !e.forbid || (e.forbid.uses ?? 0) <= 0) continue;
    if (!ruleApplies(ctx, game, state, what, { target: e.target, source: e.source ?? null, until: e.until, forbid: e.forbid, key: `effect:${e.id}` }, opts)) continue;
    e.forbid.uses = Math.max(0, (e.forbid.uses ?? 0) - 1);
  }
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
    // 9-6: the card whose play a [Counter: Play] window is open over (#150),
    // off `state.resolving` — null outside the window and once a counter has
    // replaced the play, the legacy `s.resolving?.card` reading. The legacy
    // engine also names an activated skill's own card here while it resolves;
    // no rule reads `resolving` outside a [Counter: Play], so this engine
    // does not keep that half.
    case "resolving":
      return state.resolving && !state.resolving.replaced ? state.resolving.card : null;
  }
}

/** A filter whose one measure is a card type ruled out ("non-Extra"): the only description a typeless Hidden Mode card fits (23-5-2). */
function onlyRulesOutTypes(f: CardFilter): boolean {
  return f.notType != null && f.type == null && narrowsBy(f).every((k) => k === "notType");
}

/** The measures a filter actually sets — every field that differs from "says nothing". */
function narrowsBy(f: CardFilter): string[] {
  return Object.entries(f).filter(([k, v]) => k !== "unreadable" && v !== null && v !== false && !(Array.isArray(v) && v.length === 0)).map(([k]) => k);
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
  // `asPrinted` (Stage 7): the description printed on the line this program
  // belongs to, read as the legacy keyword sites read it — `parseFilter` over
  // `sk.effect || sk.cost`. A frame with no line finds nothing.
  let matchesPrinted: ((id: string) => boolean) | null = null;
  if (sel.printed) {
    const sk = lineOf(ctx, state, frame);
    if (!sk) return [];
    const printed = predicateOf(parseFilter(printedDescription(sk)), game);
    matchesPrinted = (id) => printed(sel.special === "subject" && id === frame.subject && frame.subjectInfo ? frame.subjectInfo : attrsNow(ctx, game, state, id));
  }
  // #970: cards an earlier choice of this program bound are not on offer again.
  const chosenBefore = sel.notIn?.length ? new Set(sel.notIn.flatMap((v) => frame.vars[v] ?? [])) : null;
  return out.filter((id) => {
    if (matchesPrinted && !matchesPrinted(id)) return false;
    if (chosenBefore?.has(id)) return false;
    const card = state.cards[id];
    if (!card) return false;
    const movementInfo = sel.special === "subject" && id === frame.subject ? frame.subjectInfo : undefined;
    if (sel.mode && (movementInfo?.mode ?? card.mode) !== sel.mode) return false;
    // 23-5-2: a Hidden Mode selector asks *for* the very cards the rule below
    // would exclude from a filtered choice, so it is answered ahead of it.
    if (sel.hidden != null && (movementInfo?.hidden ?? card.hidden) !== sel.hidden) return false;
    // "…that's not in a battle" (8-1-2, #537).
    if (sel.notInBattle && state.battle && (state.battle.attacker === id || state.battle.guard === id)) return false;
    // "…whose owner is your opponent" (EX24-10): owned by the other player.
    if (sel.ownedByOpponent && card.owner === frame.master) return false;
    if (sel.notSelf && frame.card) {
      if (id === frame.card) return false;
      if (sel.notSelf === "copies" && state.cards[frame.card] && card.cardId === state.cards[frame.card].cardId) return false;
      if (sel.notSelf === "name" && state.cards[frame.card] && ctx.defs[card.cardId]?.name === ctx.defs[state.cards[frame.card].cardId]?.name) return false;
    }
    // A named target that also names an area only matches while it is there: a
    // delayed effect resolves turns later, and by then "this card" may have
    // left the Battle Area, in which case it is no longer the same card (3-1-4).
    // "From your hand or Warp" names two (9-1-3-2, #464), either of which will do.
    if ((sel.special || sel.fromVar) && (sel.area || sel.areas?.length)) {
      const wanted = (sel.areas?.length ? sel.areas : [sel.area as string]).flatMap((a) => (a === "play" ? inPlayZones(game) : [a as string]));
      if (!wanted.includes(zoneOf(state, id) ?? "")) return false;
    }
    if (sel.fromVar && sel.side && !sideOf(frame.master, sel.side).includes(masterOf(game, state, id))) return false;
    // 23-5-2 again: a Hidden Mode card has none of its front-side information
    // — so it answers no measure, except one that only says what type a card
    // is *not*: having no card type at all, it is a "non-Extra card" (BT28-150).
    if (matchesFilter && ((movementInfo ? false : card.hidden) ? !onlyRulesOutTypes(sel.filter!) : !matchesFilter(movementInfo ?? attrsNow(ctx, game, state, id)))) return false;
    // 3-9-2-1: whether a life card has been turned face up is a fact about this
    // copy rather than about the card, so no attribute can carry it.
    if (sel.filter?.faceUp && !(movementInfo?.faceUp ?? card.faceUp)) return false;
    if (sel.filter?.powerRel) {
      const against = sel.filter.powerRel.of === "chosen" ? (sel.filter.powerRel.var ? (frame.vars[sel.filter.powerRel.var]?.[0] ?? null) : null) : frame.card;
      if (!against || !powerRelOk(sel.filter, measureOf(ctx, game, state, id, "power", movementInfo), measureOf(ctx, game, state, against, "power"))) return false;
    }
    // "…with an energy cost less than or equal to your current energy" (#979):
    // what the card costs now against the energy cards its master has now. The
    // master's own count, whoever's cards are on offer (EX03-12 aims at the
    // opponent's). A card with no energy total of its own counts as zero, as in every other cost bound.
    if (sel.filter?.costAtMostEnergy) {
      if (measureOf(ctx, game, state, id, "energyCost", movementInfo) > countSelected(ctx, game, state, frame, { side: "you", area: "energy" })) return false;
    }
    // 2-3-2: "whose card name is in the text of a skill on the chosen card"
    // (BT30-084, #542) — read off the printed skills of the card the price
    // chose (`$cN`, #550). Nothing bound is nothing to match (ground rule 5).
    if (sel.filter?.nameInSkillTextOf) {
      const against = frame.vars[sel.filter.nameInSkillTextOf]?.[0] ?? null;
      const host = against ? ctx.defs[state.cards[against]?.cardId] : undefined;
      if (!host || !nameInSkillText(namesNow(attrsNow(ctx, game, state, id)), host.skill)) return false;
    }
    // 22-16: [Barrier]'s own `chooseable` hook fact (#154's `forbid(what:
    // beChosen)`), checked on its own rather than through `forbids()`'s wider
    // net — `ignoreBarrier` and the hand exemption are [Barrier]-flavoured
    // wording (22-16-2's "ignoring [Barrier]" is the only place either phrase
    // is printed: a clause marked `ignoreBarrier` is compiled that way only
    // when the card text says so), and belong to this fact alone. Folding
    // them into the generic 20-4 check below once wrongly lifted a card's own
    // "can't be chosen" rule about itself the moment it sat in a hand — that
    // rule is `ownProhibitions`' own doc claim, "wherever it sits" (9-1-3-3),
    // and has nothing to do with [Barrier].
    if (!sel.special && !sel.ignoreBarrier && sel.side !== "you" && zoneOf(state, id) !== "hand" && masterOf(game, state, id) !== frame.master && queryHookStatics(ctx, game, state, id, "chooseable").some((f) => f.op === "forbid"))
      return false;
    // 20-4: every other "can't be chosen" prohibition — `state.effects`, a
    // [Permanent], or the card's own rule about itself — wherever the card
    // sits. `hooks: false` leaves the fact just checked above out, so it is
    // not re-applied here without its own exemptions.
    if (!sel.special && masterOf(game, state, id) !== frame.master && forbids(ctx, game, state, "beChosen", { card: id, hooks: false }))
      return false;
    // 9-1-4: a card no skill may touch (#154). The one place immunity is
    // enforced, as on the legacy engine — every op reaches a card through a
    // selector, a [Permanent]'s board-wide change included, so a new op
    // inherits the check. Which skills it refuses is the stored rule's
    // business (`immunityRefusing`), and `self` is kept out: a card's own
    // skill naming itself is the skill working, not a skill touching it.
    if (sel.special !== "self" && immunityRefusing(ctx, game, state, id, frame.card, frame.master)) return false;
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
  if ("life" in a) return perStep(lifeCount(game, state, frame.master, a.life), a.per) * (a.times ?? 1);
  if ("sumOf" in a) return resolveSelector(ctx, game, state, frame, a.sumOf).reduce((t, id) => t + measureOf(ctx, game, state, id, a.attr, a.sumOf.special === "subject" && id === frame.subject ? frame.subjectInfo : undefined), 0) * (a.times ?? 1);
  if ("attr" in a) {
    // A ref that found none is nothing rather than an error, and one that found
    // several is read off the first: no printed wording says "each of their
    // energy costs" — that is `sumOf`.
    const ids = resolveRef(ctx, game, state, frame, a.attr);
    return ids.length ? measureOf(ctx, game, state, ids[0], a.name, "sel" in a.attr && a.attr.sel.special === "subject" && ids[0] === frame.subject ? frame.subjectInfo : undefined) * (a.times ?? 1) : 0;
  }
  if ("markers" in a) return perStep(markersOn(ctx, game, state, frame, a.markers), a.per) * (a.times ?? 1);
  return perStep(countSelected(ctx, game, state, frame, a.count), a.per) * (a.times ?? 1);
}

/** The cards a selector finds, counted as it says — by name under `differentNames` (BT18-104). */
export function countSelected(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame, sel: Selector): number {
  return selectedCount(sel, resolveSelector(ctx, game, state, frame, sel), (id) => String(attrsNow(ctx, game, state, id).name ?? id), (id) => list(attrsNow(ctx, game, state, id).colors).map(String), (id) => list(attrsNow(ctx, game, state, id).characters).map(String));
}

// ── conditions (9-4) ────────────────────────────────────────────────────────

/** Does this condition hold? The legacy `condHolds`, case for case. */
export function condHolds(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame, c: Cond): boolean {
  const between = (n: number, atLeast?: number, atMost?: number) => (atLeast == null || n >= atLeast) && (atMost == null || n <= atMost);
  const leaderOf = (side: Side | undefined) => state.sides[side === "opponent" ? other(frame.master) : frame.master].zones[SETUP_ZONES.leader]?.[0] ?? null;
  switch (c.kind) {
    case "count":
      return between(countSelected(ctx, game, state, frame, c.sel), c.atLeast, c.atMost);
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
        // The back side's own name and characters (1-9, 2-10): "a red <Gogeta>
        // card" asks the characters, which the front's never answer (#464).
        const def = ctx.defs[state.cards[l].cardId];
        const back = def?.back;
        return !!back && predicateOf(c.filter, game)({ ...now, name: back.name, characters: backCharactersOf(def) });
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
    // P-048's "during the turn you played it with [Over Realm]": the card's
    // memory of the play (`VmCard.playedUsing`), set by `resolvePlay` and gone
    // with the turn or a change of area.
    case "playedUsing":
      return resolveSelector(ctx, game, state, frame, c.sel).some((id) => state.cards[id]?.playedUsing === c.what);
    // BT15-118's "a turn in which this card was placed in a Battle Area"
    // (5-5-4): the card's memory of arriving (`VmCard.placedThisTurn`).
    case "placedThisTurn":
      return resolveSelector(ctx, game, state, frame, c.sel).some((id) => !!state.cards[id]?.placedThisTurn);
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
      return resolveSelector(ctx, game, state, frame, c.sel).some((id) => between(measureOf(ctx, game, state, id, "power", c.sel.special === "subject" && id === frame.subject ? frame.subjectInfo : undefined), c.atLeast, c.atMost));
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
    case "playerAttr": {
      const value = state.sides[c.side === "opponent" ? other(frame.master) : frame.master].attrs[c.name];
      // #157: a counted fact, read against its threshold.
      return c.atLeast !== undefined ? Number(value ?? 0) >= c.atLeast : !!value;
    }
    case "flag":
      return c.value === true;
    case "sameCard": {
      const a = resolveSelector(ctx, game, state, frame, c.a);
      const b = resolveSelector(ctx, game, state, frame, c.b);
      return a.length === 1 && b.length === 1 && state.cards[a[0]].cardId === state.cards[b[0]].cardId;
    }
    // Two words of a `DEFINE KEYWORD` body (Stage 7): a bound parameter
    // against the words it may be, and [Union]'s named characters (22-13),
    // read off the line the program belongs to.
    case "oneOf":
      return c.of.includes(c.value);
    case "eachNamed":
      return namedCandidates(ctx, game, state, frame, c.sel, [], !!c.samePower).length > 0;
    // BT31-001 (22-13-4-2-1): a `permit` of `unionFusionAreas` whose filter the
    // card using this line answers, under the same master.
    case "permits": {
      const card = frame.card;
      // This permission belongs to this hand copy, not every Evolve card its
      // master holds. It grants no activation-source extension (22-5-4).
      if (c.what === "evolveEnergyBases") return !!card && findCard(state, card)?.zone === "hand"
        && permissions(ctx, game, state, c.what).some((p) => p.master === frame.master && p.target === card);
      // BT22-035 / BT22-140: another way to pay this card's [Aegis] that can be paid now.
      if (c.what === "aegisAlt") return aegisAlternatives(ctx, game, state, frame).length > 0;
      return !!card && permissions(ctx, game, state, c.what).some((p) => {
        if (p.master !== frame.master) return false;
        // A hand Permanent about “this card's” Fusion never widens another
        // card's skill, nor the granting card's skill from another area.
        if (c.what === "unionFusionWarp" && (p.target !== card || findCard(state, card)?.zone !== "hand")) return false;
        return permitted(ctx, game, state, p.filter, card);
      });
    }
    // #155: [Arrival]/[Revive]'s colours and [Successor]'s exact sum, read
    // through the shared readings `text/cards.ts` gives both engines.
    case "covers":
      return coversColors(
        resolveSelector(ctx, game, state, frame, c.sel).map((id) => list(attrsNow(ctx, game, state, id)[c.original ? "originalColors" : "colors"])),
        c.colors,
      );
    case "sumsTo": {
      const each = (id: string) => amount(ctx, game, state, { ...frame, vars: { ...frame.vars, [ONE_CARD]: [id] } }, { attr: { var: ONE_CARD }, name: c.attr });
      return sumReachable(resolveSelector(ctx, game, state, frame, c.sel).map(each), amount(ctx, game, state, frame, c.total));
    }
    // #156: `VmCard.attacksThisTurn`, counted by `declareAttack` and cleared
    // with the turn and with a change of area (3-1-4) — [Dual Attack]'s
    // "X−1 times a turn".
    case "attacked": {
      const n = amount(ctx, game, state, frame, c.atLeast);
      return resolveSelector(ctx, game, state, frame, c.sel).some((id) => (state.cards[id]?.attacksThisTurn ?? 0) >= n);
    }
    // #155: 13-4-2's lock, `VmCard.usedMarkerSkill`, set when a marker skill
    // is used and cleared with the turn.
    case "markerSkillUsed":
      return resolveSelector(ctx, game, state, frame, c.sel).some((id) => !!state.cards[id]?.usedMarkerSkill);
  }
}

/**
 * [Union]'s named characters (22-13): the cards among `sel` that can still be
 * part of a full set of the characters the frame's line prints — one card per
 * name, `samePower` all of one *printed* power (22-13-4-2; the owner's ruling
 * of 13 Oct 2026 for BT31-001: printed, so a buffed card still qualifies) —
 * given the cards already `picked`. With nothing picked, none at all means the
 * line cannot be paid.
 */
export function namedCandidates(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame, sel: Selector, picked: string[], samePower = true): string[] {
  const sk = lineOf(ctx, state, frame);
  if (!sk) return [];
  const pool = resolveSelector(ctx, game, state, frame, sel).map((id) => {
    const def = ctx.defs[state.cards[id].cardId];
    return { id, characters: def?.characters ?? [], power: def?.power ?? 0 };
  });
  return namedSetCandidates(printedNames(sk), pool, picked, samePower);
}

/** An alternative way to pay an [Aegis] skill instead of its hand cards (22-30-3), already known to be payable. */
export type AegisAlt = { kind: "aegisAltDrop"; colors: Color[] } | { kind: "aegisAltOpponentHand" };

/**
 * BT22-035 / BT22-140: the alternative [Aegis] payments a [Permanent] of the
 * frame's master offers for the frame's card, each one only if the board can
 * pay it now. "Instead of" (20-1-11: the substitute applies only when it is
 * fulfilled) leaves the hand payment to the caller. `aegisAltDrop` is the
 * master's own for any of their [Aegis] skills and needs two different Drop
 * cards, one of each colour; `aegisAltOpponentHand` is the granting card's
 * own [Aegis] only ("this card's") and needs a card in the opponent's hand.
 */
export function aegisAlternatives(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame): AegisAlt[] {
  const out: AegisAlt[] = [];
  const mine = (what: Permission["what"]) => permissions(ctx, game, state, what).filter((p) => p.master === frame.master);
  for (const p of mine("aegisAltDrop")) {
    const colors = [...(p.filter?.colors ?? [])];
    if (colors.length !== 2 || out.some((a) => a.kind === "aegisAltDrop" && a.colors.join() === colors.join())) continue;
    const [first, second] = colors.map((color) => resolveSelector(ctx, game, state, frame, { side: "you", area: "drop", filter: { ...emptyFilter(), colors: [color] }, count: 1, upTo: false }));
    if (first.some((a) => second.some((b) => a !== b))) out.push({ kind: "aegisAltDrop", colors });
  }
  if (mine("aegisAltOpponentHand").some((p) => p.target === frame.card) && (state.sides[other(frame.master)].zones.hand ?? []).length) out.push({ kind: "aegisAltOpponentHand" });
  return out;
}

/** The name `sumsTo` binds one card to while it reads that card's measure through `amount`. */
const ONE_CARD = "__one";

/** The skill line a frame belongs to — the one `asPrinted` and `eachNamed` read their description off. Undefined for a frame that carries no line (a hook body, an action's `DO`). */
function lineOf(ctx: EngineContext, state: VmState, frame: ScriptFrame): Skill | undefined {
  if (frame.skillIndex === undefined || !frame.card) return undefined;
  return skillsShowing(ctx, state, frame.card).skills.find((k) => k.index === frame.skillIndex);
}

function num(value: AttrValue | undefined): number {
  return typeof value === "number" ? value : 0;
}

function list(value: AttrValue | undefined): readonly string[] {
  return Array.isArray(value) ? value : [];
}
