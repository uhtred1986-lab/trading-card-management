/**
 * #730 (21-11, 22-39-4): two or more cards with [Unique] and the same card
 * name in one Battle Area. "Their master chooses one of the cards to keep in
 * play, placing any remaining cards with the same card name in their Drop
 * Areas" (22-39-4); "the master of the cards causing the violation chooses the
 * maximum number of cards and places the rest in their Drop Area" (21-11-3).
 *
 * 21-11-1 makes it **interruptive** rule processing: resolved the moment the
 * violation exists, even in the middle of another action (21-1-2-1), not at
 * the next checkpoint. The rules engine looks for it in two places: after
 * every instruction of a running program (`ScriptHost.ruleInterrupt`, read by
 * `stepScript` once an instruction has finished) and whenever the runner
 * (`vm/flow.ts`'s `run`) regains control — after a step's own work, after a
 * program finishes, before any checkpoint. A violation found puts a frame of
 * its own in front of everything else; the program it interrupted resumes
 * behind it.
 *
 * The choice is the master's, asked as an ordinary `chooseCards` (exactly one
 * card, the one kept) and persisted on the frame (`uniqueKeep`), so a game
 * saved at the question resumes it. A stale answer — a card no longer in the
 * group — is refused with nothing changed. The rest are moved by the rule
 * (`reason: "rule"`), one by one, through 9-10: a single mandatory
 * replacement applies as on every rule move; several, or only optional ones,
 * are put to the departing card's master as a `replaceMove` question stored
 * on the same frame, and a substitute that asks a question runs as a frame in
 * front of this one. The departures are ordinary `moved` moments, so "when
 * this card is placed in your Drop Area" Autos pend and resolve at the next
 * checkpoint like any other.
 *
 * Only cards that have [Unique] in force count (22-39-4 "cards with [Unique]
 * and the same card name"); a Hidden Mode card shows no name or skills (23-5)
 * and is not counted. The keyword-less wording 21-11-2 also names ("only 1
 * copy of this card can be placed in your Battle Area"), the [Z-Extra] limit
 * and the Unison limit are not processed here.
 *
 * The legacy engine (`engine/engine.ts`'s `ruleProcessing`) still keeps the
 * newest copy without asking; that is its stated boundary.
 *
 * Pure and client-safe, like the rest of `vm/`: no database, no network.
 */
import { PLAYERS, type EngineContext, type GameEvent, type PlayerId, type ReplacementChoice, type ReplacementResult } from "../types";
import type { GameDefinition } from "../rulesets";
import { IllegalAction } from "./common";
import { RulesetBroken } from "./errors";
import { log } from "./events";
import { hasKeyword } from "./program";
import { replacementChoices, replacementIdentity } from "./replace";
import { asksAQuestion } from "./script-schema";
import { replacementPrompt, type ScriptFrame } from "./script";
import type { VmState } from "./state";

/** The stored continuation of one 21-11 [Unique] choice. */
export interface UniqueKeep {
  /** The Battle Area (its side) the same-named cards are in; that side is their master. */
  side: PlayerId;
  /** The card name shared, as printed on the face showing (1-9). */
  name: string;
  /** Distinguishes this processing's departures for 9-10 (`replacementIdentity`). */
  event: number;
  /** The card the master chose to keep, once answered. */
  kept?: string;
  /** A 9-10 question about one departing card, put and not yet answered. */
  awaiting?: { id: string; choices: ReplacementChoice[]; allowNone: boolean };
  /** Replacements already applied to each departing card in this processing (9-10-4). */
  used?: Record<string, string[]>;
}

/** The `chooseCards` continuation id of the 21-11 question. */
export const UNIQUE_CONTINUATION = "unique2111";

const BATTLE = "battle";

/** The name on the face a card is showing (1-9), or undefined for a card with no definition. */
function faceName(ctx: EngineContext, state: VmState, id: string): string | undefined {
  const inst = state.cards[id];
  const def = inst ? ctx.defs[inst.cardId] : undefined;
  if (!def) return undefined;
  return inst.flipped && def.back ? def.back.name : def.name;
}

/** The cards in `side`'s Battle Area that have [Unique] in force and the name `name`. */
function group(ctx: EngineContext, game: GameDefinition, state: VmState, side: PlayerId, name: string): string[] {
  return (state.sides[side]?.zones[BATTLE] ?? []).filter((id) => !state.cards[id]?.hidden && faceName(ctx, state, id) === name && hasKeyword(ctx, game, state, id, "Unique"));
}

/**
 * The first 21-11 [Unique] violation on the board, or null. Cheap when there
 * is none: names are compared first, and [Unique] is asked only of a name that
 * appears twice in one Battle Area. Sides in seat order, names alphabetically,
 * so simultaneous violations (21-1-2-1-1) are processed in a fixed order.
 */
export function uniqueViolation(ctx: EngineContext, game: GameDefinition, state: VmState): { side: PlayerId; name: string; cards: string[] } | null {
  if (state.game !== "dbs" || !game.zones[BATTLE]) return null;
  for (const side of PLAYERS) {
    const seen = new Map<string, number>();
    for (const id of state.sides[side]?.zones[BATTLE] ?? []) {
      if (state.cards[id]?.hidden) continue;
      const name = faceName(ctx, state, id);
      if (name !== undefined) seen.set(name, (seen.get(name) ?? 0) + 1);
    }
    for (const name of [...seen.keys()].filter((n) => seen.get(n)! >= 2).sort()) {
      const cards = group(ctx, game, state, side, name);
      if (cards.length >= 2) return { side, name, cards };
    }
  }
  return null;
}

/** Is this frame a 21-11 choice? */
export const isUniqueFrame = (frame: ScriptFrame | undefined): boolean => !!frame?.uniqueKeep;

/**
 * The frame that processes the first violation on the board, or null when
 * there is none — or when one is already being processed (a `uniqueKeep`
 * frame anywhere on the queue), so a question already put is never asked
 * twice.
 */
export function uniqueFrame(ctx: EngineContext, game: GameDefinition, state: VmState): ScriptFrame | null {
  if (state.programs.some(isUniqueFrame)) return null;
  const found = uniqueViolation(ctx, game, state);
  if (!found) return null;
  state.uniqueEvents = (state.uniqueEvents ?? 0) + 1;
  return { ops: [], ip: 0, vars: {}, card: found.cards[0], master: found.side, uniqueKeep: { side: found.side, name: found.name, event: state.uniqueEvents } };
}

/**
 * The runner's own look (`vm/flow.ts`'s `run`): queue the processing in front
 * of everything else, unless an answer to a question already put is waiting
 * to be read by the program that put it — the processing then waits one pass,
 * so it never takes that answer for its own.
 */
export function queueUniqueChoice(ctx: EngineContext, game: GameDefinition, state: VmState): boolean {
  if (state.lastChoice !== null || state.lastMode !== null || state.carried) return false;
  if (game.game?.overPhase && state.phase === game.game.overPhase) return false;
  const frame = uniqueFrame(ctx, game, state);
  if (!frame) return false;
  state.programs.unshift(frame);
  return true;
}

function route(choice: ReplacementChoice): ReplacementResult {
  // `vm/flow.ts`'s `replacementRoute`, the same answer shape 21-6 hands `moved`.
  return { source: choice.source, master: choice.master, skillIndex: choice.skillIndex, ...(choice.to ? { to: choice.to } : {}), ...(choice.mode ? { mode: choice.mode } : {}), ...(choice.ops ? { ops: choice.ops, ...(asksAQuestion(choice.ops) ? { deferred: true } : {}), ...(choice.optional ? { optional: true } : {}) } : {}) };
}

/** How the frame moves a card, handed in by `vm/flow.ts` (its `moved`), so this module does not import the runner. */
export type RuleMover = (id: string, opts: { owner: PlayerId; reason: "rule"; usedReplacements: Set<string>; replacementEvent: string; replaced?: ReplacementResult | null }) => void;

/**
 * One step of a 21-11 choice. Asks the master which card stays (exactly one),
 * then moves the others to the Drop Area one at a time, stopping for a 9-10
 * question where a departure has one. Returns "wait" with the question on the
 * board and this frame back at the front of the queue.
 */
export function stepUniqueKeep(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], frame: ScriptFrame, move: RuleMover): "done" | "wait" {
  const keep = frame.uniqueKeep!;
  const now = group(ctx, game, state, keep.side, keep.name);

  if (keep.kept === undefined) {
    // The violation can have gone while the question waited only through an
    // answer elsewhere; it is checked again rather than assumed.
    if (now.length < 2) {
      if (state.prompt.kind === "chooseCards" && state.prompt.choice.continuation === UNIQUE_CONTINUATION) state.lastChoice = null;
      return "done";
    }
    const answer = state.lastChoice;
    if (answer !== null && frame.awaiting === UNIQUE_CONTINUATION) {
      if (answer.length !== 1 || !now.includes(answer[0])) throw new IllegalAction("that card can no longer be chosen to stay");
      state.lastChoice = null;
      delete frame.awaiting;
      keep.kept = answer[0];
      log(ev, { type: "note", text: `[Unique] (21-11): ${keep.name} is kept in play; the other ${now.length - 1 === 1 ? "copy goes" : `${now.length - 1} copies go`} to the Drop Area` });
    } else {
      frame.awaiting = UNIQUE_CONTINUATION;
      state.programs.unshift(frame);
      state.prompt = {
        kind: "chooseCards",
        player: keep.side,
        choice: {
          // Read by the local policy (`policy/choices.ts`) by its opening words.
          reason: `[Unique] (21-11): ${now.length} cards named ${keep.name} are in one Battle Area. Choose the one that stays in play; the others go to the Drop Area`,
          candidates: [...now],
          min: 1,
          max: 1,
          continuation: UNIQUE_CONTINUATION,
        },
      };
      return "wait";
    }
  }

  const eventKey = `21-11:${keep.event}`;
  let guard = 0;
  while (true) {
    if (++guard > 1000) throw new RulesetBroken(state.game, "21-11 [Unique] processing did not finish");
    const still = group(ctx, game, state, keep.side, keep.name);
    // The kept card itself may have left meanwhile (a substitute's program
    // moved it): this processing is over, and whatever still violates is a
    // new one, found and asked afresh by the next look.
    if (!still.includes(keep.kept!)) return "done";
    const leaving = still.filter((id) => id !== keep.kept);
    if (!leaving.length) return "done";
    const id = leaving[0];
    const used = new Set(keep.used?.[id] ?? []);
    let replaced: ReplacementResult | null | undefined;
    const awaiting = keep.awaiting;
    if (awaiting && awaiting.id === id) {
      if (state.lastMode === null) {
        state.programs.unshift(frame);
        return "wait";
      }
      const index = state.lastMode;
      state.lastMode = null;
      delete keep.awaiting;
      replaced = index >= awaiting.choices.length ? null : route(awaiting.choices[index]);
    } else {
      const choices = replacementChoices(ctx, game, state, id, "rule").filter((choice) => !used.has(replacementIdentity(choice.source, choice.skillIndex, eventKey, id)));
      const allowNone = choices.length > 0 && choices.every((choice) => choice.optional);
      if (choices.length > 1 || allowNone) {
        keep.awaiting = { id, choices, allowNone };
        const prompt = replacementPrompt(state.cards[id].cardId, "drop", choices, allowNone);
        state.prompt = { kind: "replaceMove", player: keep.side, card: id, reason: prompt.reason, options: prompt.options };
        state.programs.unshift(frame);
        return "wait";
      }
      replaced = choices.length ? route(choices[0]) : null;
    }
    const before = used.size;
    move(id, { owner: state.cards[id].owner, reason: "rule", usedReplacements: used, replacementEvent: eventKey, ...(replaced === undefined ? {} : { replaced }) });
    (keep.used ??= {})[id] = [...used];
    if (state.sides[keep.side].zones[BATTLE].includes(id) && used.size === before) {
      throw new RulesetBroken(state.game, `21-11 could not move ${id} out of the Battle Area and no unused replacement was applied`);
    }
    if (replaced?.ops?.length && asksAQuestion(replaced.ops)) {
      // The substitute's own question runs first; this frame continues behind it.
      state.programs.unshift(frame);
      state.programs.unshift({
        ops: replaced.ops,
        ip: 0,
        vars: {},
        card: replaced.source ?? id,
        master: replaced.master ?? keep.side,
        subject: id,
        replacing: id,
        ...(replaced.skillIndex !== undefined ? { skillIndex: replaced.skillIndex } : {}),
        ...(replaced.optional ? { offered: true as const } : {}),
      });
      return "done";
    }
  }
}
