/**
 * #729 (22-22, 4-3-3, 5-8): a [Swap] whose printed price is more than orbs and
 * a condition — BT4-079's "{y}, choose 1 card from your hand and place it in
 * your Drop Area: ≪Goku's Lineage≫ with an energy cost of 2" — paid on the
 * strict action-price host shared with Auto (#549), [Aegis] (#595) and
 * [Counter] (#716), as a stored continuation of its own.
 *
 * The order is 5-8's: the energy is charged by `applyDeclared` as for every
 * activation, then the action is run here, each answer rechecked on an
 * isolated board before anything moves. Only once the whole price is paid is
 * the skill announced, its moments fired and the keyword's `DO` queued — the
 * reveal of 22-22-3, the return of this card to the hand, and the play of
 * 22-22-4. A price that can no longer be paid when its turn comes fails the
 * activation (5-8-4): what was paid stays paid, and nothing else happens.
 *
 * 22-22-3 is part of the proof: "if you can't choose the specified Battle
 * Card … you can't activate [Swap]". The price may itself take a card out of
 * the hand, so an offer — and every answer to the price's own question — is
 * proven with the reveal appended: after the action, one card matching the
 * printed description (`asPrinted`) and the energy cost X must still be in the
 * hand. A price that would leave none is not offered, and an answer that
 * would leave none is not a candidate.
 *
 * A price outside the strict host's verified families (P-594's "you can't
 * play a Battle Card with 40000 power or more for the turn", a restriction
 * with a description) is a typed `NotYet` naming #729: refused before it is
 * offered and before anything is paid, never a free swap.
 *
 * The legacy engine refuses every [Swap] whose printed cost is more than orbs
 * as `unread` (`costIsOrbsOnly` in its `Swap` cases); it charges none of these.
 *
 * Pure and client-safe, like the rest of `vm/`: no database, no network.
 */
import type { EngineContext, GameEvent, PlayerId, Requirement } from "../types";
import type { GameDefinition } from "../rulesets";
import { activationMoment, keywordActivationMoments, resolveActivation, swapActionPrice, type ActivationLine } from "./activate";
import { AutoPaymentFailed, automaticPriceHost, canFinishAutomaticPrice, readableAutomaticPrice } from "./auto-costs";
import { IllegalAction } from "./common";
import { NotYet, RulesetBroken } from "./errors";
import { fire, log } from "./events";
import { keywordProgram } from "./keyword-do";
import { stepScript, type Op, type ScriptFrame } from "./script";
import type { VmState } from "./state";

/** The stored continuation of the frame that pays a [Swap]'s action price. */
export interface SwapCost {
  /** The printed [Swap] line being activated; its `DO` runs once the price is paid. */
  line: ActivationLine;
}

/** The label and owner every refusal and gap of this module is filed under. */
const LABEL = "[Swap]";
const OWNER = "#729";

/** The variable the reveal check binds; never one a price or the `DO` names. */
const REVEAL_CHECK = "§swapReveal";

/**
 * 22-22-3 as one instruction: the keyword's own reveal (`keywords.rules`'
 * `choose … as: "swapIn"`, with its printed description and its cost X bound)
 * made compulsory — one card, not "up to" one — so that the strict host fails
 * a path on which the price has left nothing to reveal.
 */
function revealCheck(game: GameDefinition, line: ActivationLine): Op {
  if (!line.keyword) throw new RulesetBroken(game.id, "a [Swap] price is being proven for a line that is no keyword's move");
  const reveal = keywordProgram(game, line.keyword, line.skill).find((op): op is Extract<Op, { op: "choose" }> => op.op === "choose" && op.as === "swapIn");
  if (!reveal) throw new RulesetBroken(game.id, "DEFINE KEYWORD Swap no longer chooses the card it reveals as `swapIn`");
  return { ...reveal, sel: { ...reveal.sel, upTo: false, count: 1 }, as: REVEAL_CHECK };
}

/** The frame that pays the price, as the strict proof sees it: the price, then the reveal. */
const proving = (game: GameDefinition, frame: ScriptFrame): ScriptFrame => ({ ...frame, ops: [...frame.ops, revealCheck(game, frame.swapCost!.line)] });

/** A typed gap, said as a refusal: the price can be neither offered nor called unaffordable yet. */
const notYetWhy = (err: NotYet): Requirement => ({ kind: "other", detail: `not yet: ${err.step} (${err.issue})` });

/**
 * Why this [Swap] line cannot be offered for its action price, or nothing.
 * `charge` pays the energy half on a copy of the board, exactly as the move
 * would (`applyDeclared`'s plan); the action is then run on the strict host to
 * the end, followed by 22-22-3's reveal. Empty for a line with no action price.
 */
export function swapPriceRefusals(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, line: ActivationLine, charge: (s: VmState) => void): Requirement[] {
  const ops = swapActionPrice(line);
  if (!ops) return [];
  try {
    readableAutomaticPrice(ops, LABEL, OWNER);
    return swapPriceFinishes(ctx, game, state, player, line, ops, charge) ? [] : [{ kind: "other", detail: "its skill cost cannot be paid in full" }];
  } catch (err) {
    if (err instanceof NotYet) return [notYetWhy(err)];
    throw err;
  }
}

/** Pay the energy half with `charge` and then the whole action price, on a copy; true when every instruction and the reveal can complete. */
function swapPriceFinishes(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, line: ActivationLine, ops: Op[], charge: (s: VmState) => void): boolean {
  const clone = structuredClone(state);
  try {
    charge(clone);
  } catch (err) {
    if (err instanceof IllegalAction && !(err instanceof NotYet)) return false;
    throw err;
  }
  const frame: ScriptFrame = { ops, ip: 0, vars: {}, card: line.card, master: player, skillIndex: line.skillIndex, usage: line.skill.usage as import("./usage").UsageRecord, validity: line.skill.validity as import("./validity").ValidityRecord, swapCost: { line } };
  return canFinishAutomaticPrice(ctx, game, clone, proving(game, frame));
}

/**
 * Checked at declaration, before anything is paid: a price outside the strict
 * host stops the move here as the typed #729 gap, and a price the chosen
 * energy would leave unpayable is refused with nothing changed (5-8-3).
 */
export function assertSwapPricePayable(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, line: ActivationLine, charge: (s: VmState) => void): void {
  const ops = swapActionPrice(line);
  if (!ops) return;
  readableAutomaticPrice(ops, LABEL, OWNER);
  if (!swapPriceFinishes(ctx, game, state, player, line, ops, charge)) throw new IllegalAction("can't pay the [Swap]'s cost: its skill cost cannot be paid in full");
}

/** Queue the frame that pays the action price; the energy has just been charged. */
export function queueSwapCost(state: VmState, player: PlayerId, line: ActivationLine): void {
  const ops = swapActionPrice(line);
  if (!ops) throw new IllegalAction("this [Swap] has no action price to pay");
  state.programs.unshift({ ops, ip: 0, vars: {}, card: line.card, master: player, skillIndex: line.skillIndex, usage: line.skill.usage as import("./usage").UsageRecord, validity: line.skill.validity as import("./validity").ValidityRecord, swapCost: { line } });
}

/**
 * One step of a [Swap]'s action price on the strict host (`vm/flow.ts`).
 * Every answer is rechecked on an isolated board, reveal included, before
 * anything moves; a stale or dead-ending one is refused with nothing changed.
 * Once the price is paid in full, the skill activates: announced, the
 * keyword's `DO` queued, and its two moments fired — the order of an
 * [Aegis]'s activation after its payment.
 */
export function stepSwapCost(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], frame: ScriptFrame): "done" | "wait" {
  const cost = frame.swapCost!;
  try {
    if (!(frame.awaiting === "replaceMove" && state.lastMode !== null) && !canFinishAutomaticPrice(ctx, game, state, proving(game, frame))) {
      if (frame.awaiting) throw new IllegalAction("that [Swap] skill cost payment is no longer available");
      return failSwap(ev);
    }
    const result = stepScript(automaticPriceHost(ctx, game, state, ev), frame);
    if (result === "wait") {
      const prompt = state.prompt;
      if (prompt.kind === "chooseCards") {
        prompt.choice.candidates = prompt.choice.candidates.filter((id) => {
          const clone = structuredClone(state);
          clone.lastChoice = [id];
          return canFinishAutomaticPrice(ctx, game, clone, proving(game, frame));
        });
      }
      return "wait";
    }
  } catch (err) {
    if (err instanceof AutoPaymentFailed) return failSwap(ev);
    throw err;
  }
  const moment = activationMoment(ctx, game, state, frame.master, cost.line);
  const keywordMoments = keywordActivationMoments(state, frame.master, cost.line);
  resolveActivation(ctx, game, state, ev, frame.master, cost.line);
  fire(ctx, game, state, moment);
  for (const event of keywordMoments) fire(ctx, game, state, event);
  return "done";
}

/** 5-8-4: the price could not be paid in full. What was paid stays paid; no skill, no moment, no swap. */
function failSwap(ev: GameEvent[]): "done" {
  log(ev, { type: "note", text: "[Swap] activation failed: its skill cost could not be paid in full" });
  return "done";
}
