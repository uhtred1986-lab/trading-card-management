/**
 * What is in force, and for how long.
 *
 * Three kinds of thing outlive the step that made them, and the legacy engine
 * keeps all three on its `GameState`. They are here for the rules engine, in
 * the **same shapes** (`ContinuousEffect`, `DelayedEffect` from
 * `../engine/types.ts`), because `src/lib/arena/effects.ts` is the one place a
 * rule in force becomes a label on the board and it may not learn a second
 * spelling — the `effect` and `effectEnded` events a client draws the surge and
 * the settle from are the same events on both engines, or the board is reading
 * the engine rather than the contract.
 *
 *   **A continuous effect** (9-1-4) is a change that holds for a duration:
 *   +5000 power until the end of the turn, a granted keyword, a negation. It is
 *   stored, expires at its `until`, and says so when it does.
 *
 *   **A delayed effect** (20-15) is a program written down now for a moment
 *   later: "at the end of the turn, KO this card". It waits on `at`, one of the
 *   five `DELAY_TIMINGS`, and on `scope`, which says *which* turn.
 *
 *   **A [Permanent]'s static** (9-5-1) is neither: it is never resolved and
 *   never stored, because it holds only while its card is where its skills are
 *   valid (9-1-3-1). It is *read* every time a value is asked for, which is
 *   what `permanents` does — and the moment the card leaves play the reading
 *   stops finding it, with no expiry to run.
 *
 * **The layers are the declaration's, not this file's.** `attributes.rules`
 * says `layers: [printed, rewrite, numeric]` on `power` and `comboPower`
 * (9-9-1) and `[printed, reduction]`/`[printed, reduction, specified]` on the
 * prices (20-21), and `valueOf` walks exactly that list: the printed face
 * first, then the layer each effect belongs to. A game that declared a fifth
 * layer would need a row in `LAYERS` and nothing else; a game that declared
 * none gets the printed value and nothing else, which is what `id` and `name`
 * want. A layer is a **function** rather than a list of numbers to add,
 * because 20-21-2's floor at zero does not commute with an addition and the
 * coloured half of a price is not a number at all.
 *
 * One approximation, written down because nothing would catch it later:
 * 9-9-1-2 and 9-9-1-3 divide continuous effects by whether they **rewrite a
 * number**, not by where they came from. Every power change this engine makes
 * is an addition, so the sum is the same whichever order the two layers are
 * applied in, and the division used here — a [Permanent]'s standing change in
 * `rewrite`, a resolved skill's timed change in `numeric` — is a reading that
 * happens to give the right answer for every card that exists today. The first
 * "this card's power becomes X" effect makes the order matter, and at that
 * point the layer belongs on the effect rather than on its origin.
 *
 * Pure and client-safe: no database, no network, no `fs`.
 */
import type { EngineContext, GameEvent } from "../engine";
import { costModifierAs, modifyAttrAs, negateAs, type Amount, type Op, type ScriptFrame } from "../engine/script";
import type { Color, ContinuousEffect, DelayedEffect, DelayTiming, KeywordSkill, PlayerId, Prohibition } from "../engine/types";
import { other as otherPlayer } from "../engine/types";
import type { GameDefinition } from "../rulesets";
import type { AttrValue, Attrs } from "./cards";
import { log } from "./events";
import { skillsShowing } from "./triggers";
import { inPlayZones } from "./zones";
import type { VmState } from "./state";

/** The name on the face a card is showing (1-9): a flipped Leader answers to its awakened name, which is what a "copies of this card" prohibition is matched on. */
function faceName(ctx: EngineContext, state: VmState, id: string): string | undefined {
  const inst = state.cards[id];
  const def = inst ? ctx.defs[inst.cardId] : undefined;
  if (!def) return undefined;
  return inst.flipped && def.back ? def.back.name : def.name;
}

/**
 * 9-1-3-3: the prohibitions a card states **about itself**, read wherever it
 * sits.
 *
 * "This card can't be played from any area except by skills" has to hold in the
 * Drop Area, where no [Permanent] of that card is otherwise valid (9-1-3-1), so
 * these are read apart from `permanents` and by exactly the legacy
 * `ownProhibitions`' three tests: the rule is about `self`, it holds for the
 * game rather than for a duration, and it says which side of "by skills" it is
 * on — the shape only a card's own such sentence has.
 */
export function ownProhibitions(ctx: EngineContext, state: VmState, id: string, measure: (frame: ScriptFrame, amount: Amount) => number, master: PlayerId): Prohibition[] {
  const inst = state.cards[id];
  if (!inst || inst.hidden || skillsNegated(state, id)) return [];
  const showing = skillsShowing(ctx, state, id);
  const out: Prohibition[] = [];
  for (const sk of showing.skills) {
    if (sk.kind !== "permanent" || skillNegated(state, id, sk.index, sk.kind)) continue;
    const program = showing.scripts.bySkill[sk.index];
    if (!program || program.unsupported.length) continue;
    for (const op of program.ops) {
      if (op.op !== "forbid" || op.until !== "game" || op.bySkill === undefined) continue;
      if (!op.target || !("sel" in op.target) || op.target.sel.special !== "self") continue;
      const frame: ScriptFrame = { ops: [], ip: 0, vars: {}, card: id, master };
      out.push({
        what: op.what,
        ...(op.uses != null ? { uses: measure(frame, op.uses) } : {}),
        ...(op.unless ? { unless: op.unless, master } : {}),
        bySkill: op.bySkill,
      });
    }
  }
  return out;
}

/** A continuous effect as a program asks for one: the bookkeeping is this module's (9-1-4). */
export type EffectSpec = Omit<ContinuousEffect, "id" | "createdTurn" | "ownerTurn" | "master"> & { master?: PlayerId };

/** A delayed effect as a program asks for one (20-15). */
export type DelaySpec = Omit<DelayedEffect, "id" | "createdTurn">;

/**
 * The coloured half of a price, changed on its own (20-21-2, and the owner's
 * BT19-039 ruling of 9 Sep 2026): the orbs a `costReduction(what: "specified")`
 * relaxes (`sign: 1`) or demands (`sign: -1`). Carried as the printed orbs and
 * never as a bare count, because relaxing blue and relaxing yellow are
 * different changes — the legacy `StaticEffect`'s value shape, word for word,
 * because a continuous effect is one shape on both engines.
 */
export interface SpecifiedChange {
  colors: (Color | "any")[];
  sign: 1 | -1;
}

/**
 * One [Permanent]'s standing change, read rather than stored (9-5-1).
 *
 * Still narrower than the legacy engine's `StaticEffect`, but no longer the
 * three kinds a *number* is read through: a price is read through its declared
 * layers like any other attribute, so a cost reduction is one of these too
 * (#148). `kind` is the **attribute or effect kind** the change belongs to and
 * `LAYER_KINDS` is what pairs the two where they differ — a reducer says
 * `cost` and the attribute it discounts is called `costOf`, and the names are
 * the legacy engine's on both sides of that pairing.
 *
 * What a [Permanent] can still say and this cannot carry is a *legality* or an
 * alternative payment; `DEFERRED_STATICS` names each with the issue that reads
 * it, because a static quietly collected into a list nothing reads is the
 * dishonest version of a gap.
 */
export interface VmStatic {
  /** The card whose [Permanent] says it. */
  source: string;
  /** Whose skill it is (9-1-2). */
  master: PlayerId;
  kind: ContinuousEffect["kind"];
  /** The card it is about. */
  target: string;
  value: number | KeywordSkill | SpecifiedChange | Prohibition;
}

/** The ops `permanents` reads out of a [Permanent]'s program. */
export const STATIC_OPS = ["power", "comboPower", "modifyAttr", "grant", "costReduction", "forbid", "if"] as const;

/** Every other op a [Permanent] may carry, and the issue that reads it. A gap named is a gap that can be looked up. */
export const DEFERRED_STATICS: Record<string, string> = {
  altCost: "#149 — another way to pay is a price bound to nothing until an action can name one",
  payWith: "#149",
  permit: "#150 — 8-1-1 the other way round: a permission widens what may be *attacked*, and the battle is Stage 6's",
  immune: "#154 — immunity narrows what a skill may choose, and the hook group that reads choosing is Stage 7's",
  negateKeyword: "#153 — keywords are Stage 7's",
  gains: "#153",
  replaceLeave: "#146 — a replacement stands in front of a move, and moves by skill are Stage 5's",
};

/**
 * Which effect `kind` feeds which **layer** of which attribute (20-21).
 *
 * A layer reads the effects whose `kind` is the attribute's own name — which
 * is the whole of the rule for `power` and `comboPower`, and is why neither is
 * listed. A price is the exception, and it is an exception of *naming* rather
 * than of mechanism: the attribute a game declares is `costOf`, the effect a
 * skill puts in force says `cost`, and both names are the legacy engine's,
 * which is what lets one `card_rules` row mean one thing on both. This table is
 * that pairing and nothing else — no layer applies except the one the
 * declaration lists, and an attribute absent from here reads its own name.
 *
 * Checked against the definition at load (`assertCostLayers`), so a layer
 * renamed in `attributes.rules` fails a game rather than quietly reading
 * nothing.
 */
export const LAYER_KINDS: Record<string, Record<string, ContinuousEffect["kind"]>> = {
  costOf: { reduction: "cost" },
  comboCostOf: { reduction: "comboCost" },
  zEnergyCostOf: { reduction: "zEnergy" },
  // 20-21-2: a flat reduction lowers the coloured half as well as the total, so
  // the coloured attribute reads the *same* `cost` effects through its own
  // `reduction` layer; `specified` is the half that moves the colours alone.
  specifiedCost: { reduction: "cost", specified: "specifiedCost" },
  // `keywords` (plural, the names in force) reads `keyword` (singular, what
  // `grant` puts in force) through both layers 9-9-1 gives a non-numeric
  // change: a [Permanent]'s standing grant (rewrite) and a resolved skill's
  // own grant for a duration (numeric) — spec §2.5-1/§2.5-3, #275.
  keywords: { rewrite: "keyword", numeric: "keyword" },
};

/**
 * The attributes and layers `LAYER_KINDS` names, checked against the game that
 * is being loaded.
 *
 * `SETUP_ZONES`, `STEP_WORK` and `PLAY_ZONES` are the same discipline: a
 * constant in `vm/` that names a piece of the DBS definition says so out loud
 * and is held to it, rather than reading nothing on the day the declaration is
 * renamed.
 */
export function costLayerGaps(game: GameDefinition): string[] {
  const out: string[] = [];
  for (const [attr, layers] of Object.entries(LAYER_KINDS)) {
    const declared = game.attributes[attr];
    if (!declared) {
      out.push(`${attr} is an attribute nothing declares, and a price is read off one`);
      continue;
    }
    for (const layer of Object.keys(layers)) {
      if (!declared.layers?.includes(layer)) out.push(`${attr} does not declare the ${JSON.stringify(layer)} layer, so a cost change of that layer would be read by nothing`);
    }
  }
  return out;
}

// ── continuous effects (9-1-4) ──────────────────────────────────────────────

/** Put a continuous effect in force, and say so. The `effect` beat is what a client draws the surge from. */
export function addEffect(state: VmState, ev: GameEvent[], spec: EffectSpec): ContinuousEffect {
  const full: ContinuousEffect = { ...spec, master: spec.master ?? state.turnPlayer, id: state.nextEffect++, createdTurn: state.turn, ownerTurn: state.turnPlayer };
  state.effects.push(full);
  log(ev, { type: "effect", effect: full });
  return full;
}

/** Every effect in force on one card of one kind, in the order they were made (9-9-2). */
export function effectsOn(state: VmState, id: string, kind: ContinuousEffect["kind"]): ContinuousEffect[] {
  return state.effects.filter((e) => e.kind === kind && e.target === id);
}

/**
 * Take effects out of force, saying so.
 *
 * Every one that ends gets an `effectEnded` event — the other end of `effect`,
 * and the beat a board draws the number settling back on. `keep` says which
 * stay, exactly as the legacy `dropEffects` does.
 */
function dropEffects(state: VmState, ev: GameEvent[], keep: (e: ContinuousEffect) => boolean): ContinuousEffect[] {
  const kept: ContinuousEffect[] = [];
  const ended: ContinuousEffect[] = [];
  for (const e of state.effects) {
    if (keep(e)) kept.push(e);
    else {
      ended.push(e);
      log(ev, { type: "effectEnded", effect: e });
    }
  }
  state.effects = kept;
  return ended;
}

/** 7-4-5 / 7-3-5-1-3: every effect of this duration ends, for one player's or for both. */
export function endEffects(state: VmState, ev: GameEvent[], until: ContinuousEffect["until"], forPlayer?: PlayerId): ContinuousEffect[] {
  return dropEffects(state, ev, (e) => !(e.until === until && (forPlayer == null || e.ownerTurn === forPlayer)));
}

/**
 * 7-2-4: the two durations written from the controller's chair.
 *
 * "Until the end of your opponent's turn" and "until the start of your
 * opponent's next turn" are read against the effect's own `master`, never
 * against whose turn it happened to be made on — the legacy
 * `endTurnRelativeEffects`, word for word, because a duration that ended a turn
 * early on one engine and a turn late on the other is the kind of difference
 * `arena:diff` exists to refuse.
 */
export function endTurnRelativeEffects(state: VmState, ev: GameEvent[]): ContinuousEffect[] {
  return dropEffects(state, ev, (e) => {
    if (e.createdTurn >= state.turn) return true;
    if (e.until === "nextTurn") return state.turnPlayer !== e.master;
    if (e.until === "opponentTurn") return state.turnPlayer === e.master;
    return true;
  });
}

/** 3-1-4: a card that changed area is a new card, so nothing that was in force on it still is. */
export function dropEffectsOn(state: VmState, ev: GameEvent[], id: string): void {
  dropEffects(state, ev, (e) => e.target !== id);
}

// ── delayed effects (20-15) ─────────────────────────────────────────────────

/** Write a program down for a later moment. */
export function schedule(state: VmState, ev: GameEvent[], spec: DelaySpec): DelayedEffect {
  const full: DelayedEffect = { ...spec, id: state.nextEffect++, createdTurn: state.turn };
  state.delayed.push(full);
  log(ev, { type: "delayed", card: spec.card, label: spec.label });
  return full;
}

/** Whether the turn now under way is the one the effect was waiting for. The legacy `ripe`. */
function ripe(state: VmState, d: DelayedEffect): boolean {
  switch (d.scope) {
    case "thisTurn":
      return state.turn === d.createdTurn;
    case "nextTurn":
      return state.turn > d.createdTurn;
    case "yourNextTurn":
      return state.turn > d.createdTurn && state.turnPlayer === d.master;
    // No "later than the turn it was written on" here: an effect scheduled
    // during the opponent's turn — every [Counter] is — means the turn now
    // under way. The side test is the guard.
    case "opponentNextTurn":
      return state.turnPlayer !== d.master;
  }
}

/**
 * Take every effect waiting for this timing off the list, oldest first
 * (4-2-2-2), as the programs that carry them out.
 *
 * The frames come back rather than being run here, because running a program is
 * the runner's business and one of these can stop to ask a question.
 */
export function dueDelays(state: VmState, at: DelayTiming): ScriptFrame[] {
  const ready = state.delayed.filter((d) => d.at === at && ripe(state, d));
  if (!ready.length) return [];
  const ids = new Set(ready.map((d) => d.id));
  state.delayed = state.delayed.filter((d) => !ids.has(d.id));
  return ready.map((d) => ({ ops: d.ops, ip: 0, vars: d.vars, card: d.card, master: d.master, subject: d.subject }));
}

/** An effect scheduled for "this turn" whose moment has gone never happens. Keeps the list from growing over a long game. */
export function expireDelayed(state: VmState): void {
  state.delayed = state.delayed.filter((d) => d.scope !== "thisTurn" || d.createdTurn === state.turn);
}

// ── negation (9-1-5) ────────────────────────────────────────────────────────

/**
 * Are *all* of this card's skills switched off?
 *
 * The legacy engine keeps the for-the-game half as a mark on the instance and
 * the timed half as an effect; here both are effects, because a `VmCard` is the
 * copy on the table and nothing more. One function, and **every reader goes
 * through it** — the [Permanent] walk, the checkpoint, the moment that pends an
 * [Auto] and the host. The bug that made it one function was three readers and
 * two of them checking: a negated card's [Permanent] went on standing while its
 * [Auto]s correctly did not.
 */
export function skillsNegated(state: VmState, id: string): boolean {
  return state.effects.some((e) => e.kind === "negateSkills" && e.target === id);
}

/**
 * Is this one skill of this card switched off (9-1-5)?
 *
 * Three ways, the legacy `skillNegated`'s three: the whole card, this skill by
 * its printed index, and a whole *kind* at once — "negate that card's [Auto]
 * skill for the turn". A printed "[Counter]" covers every counter kind, so the
 * stored value is a prefix of the skill kind rather than the whole of it.
 */
export function skillNegated(state: VmState, id: string, index: number, kind?: string): boolean {
  if (skillsNegated(state, id)) return true;
  if (state.effects.some((e) => e.kind === "negateSkill" && e.target === id && e.value === index)) return true;
  return !!kind && state.effects.some((e) => e.kind === "negateSkillKind" && e.target === id && kind.startsWith(e.value as string));
}

/** The skills of this card that are off, as `stepScript` reads them: `"all"`, or the indexes. */
export function negatedSkillsOf(state: VmState, id: string): "all" | number[] {
  if (skillsNegated(state, id)) return "all";
  return state.effects.filter((e) => e.kind === "negateSkill" && e.target === id).map((e) => e.value as number);
}

// ── [Permanent] statics (9-5, 9-9) ──────────────────────────────────────────

/**
 * Every standing change a [Permanent] makes right now.
 *
 * Read, never stored: a [Permanent] is never activated and never resolves
 * (9-5-1), so the only honest way to have one is to look for it whenever a
 * value is asked for. A card in Hidden Mode is no information at all and is
 * skipped (23-5); a card whose skills are negated says nothing (9-1-5).
 *
 * `targets` is the selector resolver, handed in rather than imported, because
 * a static's target is a selector and resolving one asks for a card's value —
 * which asks for the statics again. The caller owns that recursion guard
 * (`vm/program.ts`), the way `computingStatics` owns it on the legacy engine.
 */
export function permanents(
  ctx: EngineContext,
  game: GameDefinition,
  state: VmState,
  targets: (frame: ScriptFrame, op: Op) => string[],
  holds: (frame: ScriptFrame, op: Op) => boolean,
  measure: (frame: ScriptFrame, amount: Amount) => number,
): VmStatic[] {
  const out: VmStatic[] = [];
  const inPlay = new Set(inPlayZones(game));
  const zones = [...inPlay, "hand", "zDeck"].filter((zone) => game.zones[zone]?.place !== false);
  for (const p of Object.keys(state.sides) as PlayerId[]) {
    for (const zone of zones) {
      for (const src of state.sides[p].zones[zone] ?? []) {
        const card = state.cards[src];
        if (!card || card.hidden || skillsNegated(state, src)) continue;
        const showing = skillsShowing(ctx, state, src);
        for (const sk of showing.skills) {
          if (sk.kind !== "permanent") continue;
          if (skillNegated(state, src, sk.index, sk.kind)) continue;
          const program = showing.scripts.bySkill[sk.index];
          if (!program || program.unsupported.length) continue;
          collect(ctx, state, out, { ops: [], ip: 0, vars: {}, card: src, master: p }, program.ops, inPlay.has(zone), targets, holds, measure);
        }
      }
    }
  }
  return out;
}

/** One [Permanent]'s program, walked for the standing changes a value is read through. */
function collect(
  ctx: EngineContext,
  state: VmState,
  out: VmStatic[],
  frame: ScriptFrame,
  ops: Op[],
  inPlayNow: boolean,
  targets: (frame: ScriptFrame, op: Op) => string[],
  holds: (frame: ScriptFrame, op: Op) => boolean,
  measure: (frame: ScriptFrame, amount: Amount) => number,
): void {
  // A `negate` (#276), a `costModifier` (#277) or a `modifyAttr` widening
  // (spec §2.5-1/§2.5-3, #275) is walked as the spelling it stands for, the
  // same as `collectStatics` on the legacy engine — so a `negateKeyword`
  // written as the primitive is deferred by the same name `DEFERRED_STATICS`
  // gives it, a `modifyAttr(attr: keywords, …)` reads as the `grant` case
  // below, and nothing else.
  for (const op of ops.map((o) => costModifierAs(negateAs(modifyAttrAs(o))))) {
    if (op.op === "if") {
      // A [Permanent] under a condition holds only while the condition does
      // (9-5-1-1), so the branch is taken afresh on every reading.
      if (holds(frame, op)) collect(ctx, state, out, frame, op.then, inPlayNow, targets, holds, measure);
      else if (op.else) collect(ctx, state, out, frame, op.else, inPlayNow, targets, holds, measure);
      continue;
    }
    // 20-14: a prohibition printed as a [Permanent] holds for as long as the
    // card is where its skills are valid (9-1-3-1), which for this one is the
    // table — so it is read here and never stored, with no duration to expire.
    // A rule about *cards* carries its own target; one about a *player* carries
    // no target and the filter says which cards it is about.
    if (op.op === "forbid") {
      if (!inPlayNow) continue;
      const player = op.side && op.side !== "both" ? (op.side === "opponent" ? otherPlayer(frame.master) : frame.master) : undefined;
      const uses = op.uses != null ? measure(frame, op.uses) : undefined;
      // The escape clause is a sentence of *this* card, so it records whose
      // card it is: "you" and "your opponent" in it are read from that chair
      // and not from the chair of whoever is trying to act.
      const forbid: Prohibition = { what: op.what, ...(uses != null ? { uses } : {}), ...(op.unless ? { unless: op.unless, master: frame.master } : {}), player, bySkill: op.bySkill };
      if (op.target) {
        for (const id of targets(frame, op)) out.push({ source: frame.card, master: frame.master, kind: "forbid", target: id, value: forbid });
      } else {
        const name = op.sameNameAsSelf ? faceName(ctx, state, frame.card) : undefined;
        out.push({ source: frame.card, master: frame.master, kind: "forbid", target: "", value: { ...forbid, filter: op.filter, name } });
      }
      continue;
    }
    if (op.op === "power" || op.op === "comboPower") {
      if (typeof op.amount !== "number") continue;
      for (const id of targets(frame, op)) out.push({ source: frame.card, master: frame.master, kind: op.op, target: id, value: op.amount });
      continue;
    }
    if (op.op === "modifyAttr") {
      // §2.3 of the ruleset spec: the primitive `power`/`comboPower` are
      // spellings of, so it makes the same standing change.
      if (op.attr !== "power" && op.attr !== "comboPower") continue;
      if (typeof op.amount !== "number") continue;
      for (const id of targets(frame, op)) out.push({ source: frame.card, master: frame.master, kind: op.attr, target: id, value: op.amount });
      continue;
    }
    if (op.op === "grant") {
      for (const id of targets(frame, op)) out.push({ source: frame.card, master: frame.master, kind: "keyword", target: id, value: op.keyword });
      continue;
    }
    // 20-21: the price a card is bought at, standing rather than resolved —
    // "reduce the energy cost of your <Son Goku> cards in your hand by 1". It
    // reaches the price through the attribute layers `LAYER_KINDS` pairs it
    // with, which is why nothing below names a cost field.
    if (op.op === "costReduction") {
      // The coloured half alone, kept as its own kind so the total cannot be
      // moved by it (the owner's BT19-039 ruling). Always a printed list of
      // orbs and never a "for each" count, so the sign is read off the number
      // rather than measured.
      if (op.what === "specified") {
        if (!op.colors?.length || typeof op.amount !== "number") continue;
        const sign: 1 | -1 = op.amount < 0 ? -1 : 1;
        for (const id of targets(frame, op)) out.push({ source: frame.card, master: frame.master, kind: "specifiedCost", target: id, value: { colors: op.colors, sign } });
        continue;
      }
      // 4-3-3 and 22-2: an orb price belongs to *one skill line* rather than to
      // the card, and a line's price is bound by the move that names it
      // (`BoundAmounts`, #147), so there is nothing here to change yet.
      if (op.what === "skill" || op.what === "evolve") continue;
      const kind = op.what === "combo" ? "comboCost" : op.what === "zEnergy" ? "zEnergy" : "cost";
      // "…by 1 for each of your blue Battle Cards" — the same two amounts the
      // power statics take, and for the same reason: a [Permanent] has no frame
      // that ever bound a variable, so only a count over the board can be read.
      const value = typeof op.amount === "number" ? op.amount : "count" in op.amount || "markers" in op.amount ? measure(frame, op.amount) : null;
      if (value == null) continue;
      for (const id of targets(frame, op)) out.push({ source: frame.card, master: frame.master, kind, target: id, value });
    }
  }
}


// ── the layers a value is read through (9-9-1, 20-21) ───────────────────────

/** What a layer is handed: the value so far, the standing changes of its kind, the timed ones, and the card's printed bag for the one fallback that needs it. */
type Layer = (value: AttrValue | undefined, statics: EffectValue[], timed: EffectValue[], attrs: Attrs) => AttrValue | undefined;

type EffectValue = number | KeywordSkill | SpecifiedChange | Prohibition;

/**
 * Numbers added to a number — every change 9-9-1 makes to `power` and
 * `comboPower` — or keyword names unioned into a list, once each, which is
 * every change it makes to `keywords` (spec §2.5-1/§2.5-3, #275): a grant is
 * not subtracted by this fold at all, because negating one is read where a
 * skill is negated (9-1-5), not through this layer. One function rather than
 * a branch per attribute, because both are "every change of this kind,
 * folded into the value so far" — a layer picks which by what its own
 * changes actually carry, never by the attribute's name.
 */
function added(value: AttrValue | undefined, changes: EffectValue[]): AttrValue | undefined {
  let out = value;
  for (const add of changes) {
    if (typeof add === "number") out = (typeof out === "number" ? out : 0) + add;
    else if (add && typeof add === "object" && "name" in add) {
      const names = new Set(Array.isArray(out) ? (out as readonly string[]) : []);
      names.add((add as KeywordSkill).name);
      out = [...names];
    }
  }
  return out;
}

/**
 * Which effects belong to which declared layer.
 *
 * A layer no row names contributes nothing, which is what a printed-only
 * attribute wants; a layer this interpreter has no entry for is skipped, which
 * is what an attribute declaring a layer nobody has built yet wants.
 */
const LAYERS: Record<string, Layer> = {
  // 9-9-1-2: the standing changes. Every one this engine makes is additive.
  rewrite: (value, statics) => added(value, statics),
  // 9-9-1-3: the changes a resolved skill put in force for a duration.
  numeric: (value, _statics, timed) => added(value, timed),
  /**
   * 20-21: a **discount on the price being paid**, which is not a rewrite of
   * the printed cost and is not additive — 20-21-2 floors it at zero, and a
   * floor does not commute with an addition. Reducers of both origins are read
   * together, because "reduce by 1" means the same whether a [Permanent] stands
   * it or a skill put it in force for the turn (`playCost`, which adds the two
   * lists before it subtracts either).
   *
   * It reaches a **number** and a **colour list** with one arithmetic: taking 1
   * off a total takes one orb off the coloured requirement with it, which is
   * the loop `playCost` runs and the reason both attributes name this layer.
   * Which orb goes is the first still demanded — the legacy engine's greedy
   * choice, and the same choice, because `specifiedCost` is one entry per orb
   * in the order `specifiedCostOf` filled them.
   */
  reduction: (value, statics, timed) => {
    let by = 0;
    for (const n of [...statics, ...timed]) if (typeof n === "number") by += n;
    if (!by) return value;
    if (Array.isArray(value)) return by > 0 ? (value as readonly string[]).slice(by) : value;
    if (typeof value !== "number") return value;
    return Math.max(0, value - by);
  },
  /**
   * The coloured half said on its own (owner's ruling on BT19-039, 9 Sep 2026,
   * read off 13-2-1-3 and 20-21-2): "reduce the specified cost of this card by
   * {u}" relaxes which colours are demanded and moves the total **nothing**.
   * That is why it is a layer of `specifiedCost` and of no numeric attribute —
   * a number has nothing for it to do, and declaring it on one would be a
   * reading that quietly did nothing.
   */
  specified: (value, statics, timed, attrs) => {
    if (!Array.isArray(value)) return value;
    const orbs = [...(value as readonly string[])];
    for (const change of [...statics, ...timed]) {
      if (!change || typeof change !== "object" || !("colors" in change)) continue;
      const { colors, sign } = change as SpecifiedChange;
      for (const orb of colors) {
        if (sign === 1) {
          const at = orb === "any" ? (orbs.length ? 0 : -1) : orbs.indexOf(orb);
          if (at >= 0) orbs.splice(at, 1);
        } else {
          // Tightening with no colour named demands one more of whatever is
          // already demanded, or of the card's own first colour — the legacy
          // fallback, and the one place a layer reads another attribute.
          const own = (attrs.colors as readonly string[] | undefined)?.find((c) => c !== "Colorless");
          const add = orb === "any" ? (orbs[0] ?? own) : orb;
          if (add) orbs.push(add);
        }
      }
    }
    return orbs;
  },
};

/**
 * One attribute of one card, through the layers its declaration names.
 *
 * `printed` is the value the catalog gave (`attrsOf`); every layer after it is
 * this module's. An attribute the game declares no `layers:` for is its printed
 * value and nothing else — which is most of them, and is why `valueOf` can be
 * asked for any attribute rather than only the ones with layers.
 *
 * `statics` and `timed` are every change in force **about this card**; which of
 * them a layer sees is `LAYER_KINDS`, read here so that the pairing of an
 * attribute's name with an effect's `kind` lives in exactly one place. The
 * default is the attribute's own name, which is the whole of the rule for
 * everything but a price.
 */
export function valueOf(game: GameDefinition, attrs: Attrs, name: string, statics: VmStatic[], timed: ContinuousEffect[]): AttrValue | undefined {
  const declared = game.attributes[name];
  const printed = attrs[name];
  if (!declared?.layers?.length) return printed;
  let value: AttrValue | undefined = printed;
  for (const layer of declared.layers) {
    if (layer === "printed") continue;
    const read = LAYERS[layer];
    if (!read) continue; // a layer this interpreter has nothing for.
    const kind = LAYER_KINDS[name]?.[layer] ?? name;
    value = read(
      value,
      statics.filter((e) => e.kind === kind).map((e) => e.value),
      timed.filter((e) => e.kind === kind).map((e) => e.value as EffectValue),
      attrs,
    );
  }
  return value;
}
