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
 * (9-9-1), and `valueOf` walks exactly that list: the printed face first, then
 * the layer each effect belongs to. A game that declared a fourth layer would
 * need a row in `LAYERS` and nothing else; a game that declared none gets the
 * printed value and nothing else, which is what `id` and `name` want.
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
import type { Op, ScriptFrame } from "../engine/script";
import type { ContinuousEffect, DelayedEffect, DelayTiming, KeywordSkill, PlayerId } from "../engine/types";
import type { GameDefinition } from "../rulesets";
import type { AttrValue, Attrs } from "./cards";
import { log } from "./events";
import { skillsShowing } from "./triggers";
import { inPlayZones } from "./zones";
import type { VmState } from "./state";

/** A continuous effect as a program asks for one: the bookkeeping is this module's (9-1-4). */
export type EffectSpec = Omit<ContinuousEffect, "id" | "createdTurn" | "ownerTurn" | "master"> & { master?: PlayerId };

/** A delayed effect as a program asks for one (20-15). */
export type DelaySpec = Omit<DelayedEffect, "id" | "createdTurn">;

/**
 * One [Permanent]'s standing change, read rather than stored (9-5-1).
 *
 * Narrower than the legacy engine's `StaticEffect` on purpose: those are the
 * three kinds a value can be read through today. Everything else a [Permanent]
 * can say — a cost reduction, a prohibition, an immunity, an alternative
 * payment — is about a *price* or a *legality*, and both are Stage 5's; naming
 * them in `DEFERRED_STATICS` is the honest version of that gap, and a static
 * quietly collected into a list nothing reads is the dishonest one.
 */
export interface VmStatic {
  /** The card whose [Permanent] says it. */
  source: string;
  /** Whose skill it is (9-1-2). */
  master: PlayerId;
  kind: "power" | "comboPower" | "keyword";
  /** The card it is about. */
  target: string;
  value: number | KeywordSkill;
}

/** The ops `permanents` reads out of a [Permanent]'s program. */
export const STATIC_OPS = ["power", "comboPower", "modifyAttr", "grant", "if"] as const;

/** Every other op a [Permanent] may carry, and the issue that reads it. A gap named is a gap that can be looked up. */
export const DEFERRED_STATICS: Record<string, string> = {
  costReduction: "#148 — prices are Stage 5's, and a reduction is a change to one",
  altCost: "#148 — another way to pay is still a way to pay",
  payWith: "#148",
  forbid: "#145 — a prohibition refuses an action, and actions are Stage 5's",
  permit: "#145",
  immune: "#147 — immunity narrows what a skill may choose, which is the activation's own question",
  negateKeyword: "#153 — keywords are Stage 7's",
  gains: "#153",
  replaceLeave: "#146 — a replacement stands in front of a move, and moves by skill are Stage 5's",
};

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
export function permanents(ctx: EngineContext, game: GameDefinition, state: VmState, targets: (frame: ScriptFrame, op: Op) => string[], holds: (frame: ScriptFrame, op: Op) => boolean): VmStatic[] {
  const out: VmStatic[] = [];
  const zones = [...inPlayZones(game), "hand", "zDeck"].filter((zone) => game.zones[zone]?.place !== false);
  for (const p of Object.keys(state.sides) as PlayerId[]) {
    for (const zone of zones) {
      for (const src of state.sides[p].zones[zone] ?? []) {
        const card = state.cards[src];
        if (!card || card.hidden) continue;
        const showing = skillsShowing(ctx, state, src);
        for (const sk of showing.skills) {
          if (sk.kind !== "permanent") continue;
          const program = showing.scripts.bySkill[sk.index];
          if (!program || program.unsupported.length) continue;
          collect(out, { ops: [], ip: 0, vars: {}, card: src, master: p }, program.ops, targets, holds);
        }
      }
    }
  }
  return out;
}

/** One [Permanent]'s program, walked for the three kinds a value can be read through. */
function collect(out: VmStatic[], frame: ScriptFrame, ops: Op[], targets: (frame: ScriptFrame, op: Op) => string[], holds: (frame: ScriptFrame, op: Op) => boolean): void {
  for (const op of ops) {
    if (op.op === "if") {
      // A [Permanent] under a condition holds only while the condition does
      // (9-5-1-1), so the branch is taken afresh on every reading.
      if (holds(frame, op)) collect(out, frame, op.then, targets, holds);
      else if (op.else) collect(out, frame, op.else, targets, holds);
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
    }
  }
}

// ── the layers a value is read through (9-9-1) ──────────────────────────────

/** Which effects belong to which declared layer. A layer no row names contributes nothing, which is what a printed-only attribute wants. */
const LAYERS: Record<string, (statics: VmStatic[], timed: ContinuousEffect[]) => (number | KeywordSkill)[]> = {
  // 9-9-1-2: the standing changes. Every one this engine makes is additive.
  rewrite: (statics) => statics.map((e) => e.value),
  // 9-9-1-3: the changes a resolved skill put in force for a duration.
  numeric: (_statics, timed) => timed.map((e) => e.value as number),
};

/**
 * One attribute of one card, through the layers its declaration names.
 *
 * `printed` is the value the catalog gave (`attrsOf`); every layer after it is
 * this module's. An attribute the game declares no `layers:` for is its printed
 * value and nothing else — which is most of them, and is why `valueOf` can be
 * asked for any attribute rather than only the two with layers.
 *
 * `statics` and `timed` are already the ones about **this card and this
 * attribute**: the filtering is the caller's because it is the caller that
 * knows how an attribute name maps onto an effect's `kind`, and a second
 * mapping table here would be a second place for the two to disagree.
 */
export function valueOf(game: GameDefinition, attrs: Attrs, name: string, statics: VmStatic[], timed: ContinuousEffect[]): AttrValue | undefined {
  const declared = game.attributes[name];
  const printed = attrs[name];
  if (!declared?.layers?.length) return printed;
  let value = printed;
  for (const layer of declared.layers) {
    if (layer === "printed") continue;
    const read = LAYERS[layer];
    if (!read) continue; // a layer this interpreter has nothing for — `reduction`/`specified` are #148's.
    for (const add of read(statics, timed)) {
      if (typeof add !== "number") continue;
      value = (typeof value === "number" ? value : 0) + add;
    }
  }
  return value;
}
