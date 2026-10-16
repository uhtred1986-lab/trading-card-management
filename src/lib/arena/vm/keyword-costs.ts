/**
 * #926: the printed action price of a keyword move — what [Union-Fusion],
 * [Union-Potara] and the [Evolve] family print before the colon beside their
 * orbs: "[Union-Fusion]{r}{r}{r}, draw 2 cards: Red <Son Goku: Br> and red
 * <Vegeta: Br>." (BT11-013), "[EX-Evolve]{r}{r}{r}, draw 1 card: Red <Broly :
 * Br> with an energy cost of 3." (BT13-024), "[Union-Potara]{g}, if your
 * Leader is a green <Zamasu> card, you draw 1 card, and place the top card of
 * your opponent's deck into its owner's Drop: …" (BT26-084).
 *
 * It is a **cost** (5-8): paid at activation, in full or not at all
 * (5-8-2-2), and a move whose price cannot be paid is not declared (5-8-3) —
 * so the menu offers the line only when the energy the plan pays leaves the
 * whole action payable, proven on a copy of the board on the strict
 * action-price host shared with Auto (#549), [Aegis] (#595), [Counter] (#716),
 * [Swap] (#729) and Drop activations (#920). A draw is paid only by N cards
 * actually leaving the top of the deck for the hand (5-1-1); a deck with fewer
 * than N cannot pay it. The orbs, alternative orbs ("{b}/{w}", 5-8-2-1) and
 * the condition hoisted out of the price (9-1-3) are the activation's, as for
 * every line; once/[Limit] is spent with the activation (22-11-2, 22-44-3).
 *
 * **Where it is paid is the keyword's `DO`'s to say** (`payActionPrice`):
 * [Union-Fusion] places its materials in the Drop as the skill cost and only
 * *then* determines and pays the rest (22-13-4-4, 22-13-4-4-1), so a card a
 * price draws can never be one of its materials; [Union-Potara] (22-13-5-2)
 * and the [Evolve] family (22-5-3) pay it first. The energy is charged at the
 * declaration, as for every move: it comes out of the energy area, which no
 * material choice reads, so its place in that order changes nothing a player
 * could see but the log.
 *
 * The skill is announced, and its two moments ("when you activate a [Union]
 * skill", "when using this card's [Evolve] from your hand") fired, once the
 * price is paid — the order of an [Aegis] or a [Swap] with an action price —
 * so a price that fails (5-8-4) leaves no skill announced: what was paid
 * stays paid, the rest of the `DO` is dropped and the card stays where it is.
 *
 * A price outside the strict host's verified families is a typed `NotYet`
 * naming #926: refused before it is offered and before anything is paid,
 * never a free play. A [Union-Fusion] price that could reach the cards its
 * materials come from (anything but a draw, a mill, or a choice of the
 * opponent's cards) is one, because it is proven before the materials move.
 * [Union-Absorb] is not here: its line is "cost : effect" (22-13-6-1), read as
 * a printed line's, and its action prices stay where #930 tracks them.
 *
 * The legacy engine refuses every keyword move whose printed cost is more
 * than orbs as `unread` (`costIsOrbsOnly`); it charges none of these.
 *
 * Pure and client-safe, like the rest of `vm/`: no database, no network.
 */
import type { EngineContext, GameEvent, PlayerId, Requirement } from "../types";
import type { GameDefinition } from "../rulesets";
import { announce, keywordActionPrice, type ActivationLine } from "./activate";
import { AutoPaymentFailed, automaticPriceHost, canFinishAutomaticPrice, readableAutomaticPrice } from "./auto-costs";
import { IllegalAction } from "./common";
import { NotYet, RulesetBroken } from "./errors";
import { fire, log, type Moment } from "./events";
import { stepScript, type Op, type ScriptFrame } from "./script";
import type { VmState } from "./state";

/** The price a keyword move still owes: on its `DO` frame until `payActionPrice`, then on the strict frame paying it. */
export interface KeywordCost {
  /** Which `DO` frame the price belongs to — frames are matched by this across a JSON reload, never by identity. */
  key: string;
  /** The printed line being activated. */
  line: ActivationLine;
  /** The activation's moments, read at the declaration ("from: hand") and fired once the price is paid. */
  moments: Moment[];
  /** Set on the `DO` frame once its strict frame is queued, so the price is never queued twice. */
  queued?: true;
}

/** The label and owner every refusal and gap of this module is filed under. */
const OWNER = "#926";
const labelOf = (line: Pick<ActivationLine, "skill">): string => {
  const kw = line.skill.keyword;
  return `[${kw?.name === "Union" ? `Union-${kw.variant}` : kw?.name === "Evolve" ? kw.variant : (kw?.name ?? "keyword")}]`;
};

/** Is this line a [Union-Fusion]? Its price is paid after the materials move. */
const isFusion = (line: Pick<ActivationLine, "skill">): boolean => line.skill.keyword?.name === "Union" && line.skill.keyword.variant === "Fusion";

/**
 * Can this price reach a [Union-Fusion]'s materials? Proven before they move,
 * so only a price that touches none of the areas they come from (hand,
 * Battle, Drop, Warp) is: a draw from your deck, a mill, or the opponent's
 * cards. Anything else stays a typed gap.
 */
function materialIndependent(ops: Op[]): boolean {
  const theirs = new Set<string>();
  return ops.every((op) => {
    if (op.op === "draw" || op.op === "mill") return true;
    if (op.op === "choose" && op.sel.side === "opponent" && (!op.chooser || op.chooser === "you")) {
      theirs.add(op.as);
      return true;
    }
    if (op.op === "moveTo" && "var" in op.target && theirs.has(op.target.var) && Object.keys(op.target).length === 1) return true;
    return false;
  });
}

/** Refuse what the strict host cannot charge, as a typed gap — never call it unaffordable, never let it be free. */
function readable(line: ActivationLine, ops: Op[]): void {
  readableAutomaticPrice(ops, labelOf(line), OWNER, { draw: true });
  if (isFusion(line) && !materialIndependent(ops)) throw new NotYet(`pay a ${labelOf(line)} action price that may touch its materials`, OWNER);
}

const priceFrame = (line: ActivationLine, player: PlayerId, ops: Op[], cost?: KeywordCost): ScriptFrame => ({
  ops, ip: 0, vars: {}, card: line.card, master: player, skillIndex: line.skillIndex, ...(cost ? { keywordCost: cost } : {}),
});

/** Pay the energy half with `charge` and then the whole action price, on a copy; true when every instruction can complete. */
function finishes(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, line: ActivationLine, ops: Op[], charge: (s: VmState) => void): boolean {
  const clone = structuredClone(state);
  try {
    charge(clone);
  } catch (err) {
    if (err instanceof IllegalAction && !(err instanceof NotYet)) return false;
    throw err;
  }
  return canFinishAutomaticPrice(ctx, game, clone, priceFrame(line, player, ops));
}

/**
 * Why this keyword line cannot be offered for its action price, or nothing.
 * `charge` pays the energy half on a copy of the board, exactly as the move
 * would (`applyDeclared`'s plan). Empty for a line with no action price.
 */
export function keywordPriceRefusals(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, line: ActivationLine, charge: (s: VmState) => void): Requirement[] {
  const ops = keywordActionPrice(line);
  if (!ops) return [];
  try {
    readable(line, ops);
    return finishes(ctx, game, state, player, line, ops, charge) ? [] : [{ kind: "other", detail: "its skill cost cannot be paid in full" }];
  } catch (err) {
    if (err instanceof NotYet) return [{ kind: "other", detail: `not yet: ${err.step} (${err.issue})` }];
    throw err;
  }
}

/** Checked at declaration, before anything is paid: a typed gap stops the move here, and an unpayable price is refused with nothing changed (5-8-3). */
export function assertKeywordPricePayable(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, line: ActivationLine, charge: (s: VmState) => void): void {
  const ops = keywordActionPrice(line);
  if (!ops) return;
  readable(line, ops);
  if (!finishes(ctx, game, state, player, line, ops, charge)) throw new IllegalAction(`can't pay the ${labelOf(line)}'s cost: its skill cost cannot be paid in full`);
}

/** `payActionPrice` (`ScriptHost.payKeywordPrice`): the strict frame in front of the `DO` frame, which keeps a marker of the price until it is paid. */
export function queueKeywordCost(state: VmState, frame: ScriptFrame): void {
  const cost = frame.keywordPrice;
  if (!cost || cost.queued) return;
  const ops = keywordActionPrice(cost.line);
  if (!ops) throw new RulesetBroken(state.game, `${cost.line.card}'s keyword move carries a price its record no longer has`);
  cost.queued = true;
  state.programs.unshift(priceFrame(cost.line, frame.master, ops, { key: cost.key, line: cost.line, moments: cost.moments }));
}

/**
 * One step of a keyword move's action price on the strict host (`vm/flow.ts`).
 * Every answer is rechecked on an isolated board before anything moves; a
 * stale or dead-ending one is refused with nothing changed. Once the price
 * is paid in full the skill is activated: announced, and its moments fired,
 * and the `DO` frame behind goes on to play the card.
 */
export function stepKeywordCost(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], frame: ScriptFrame): "done" | "wait" {
  const cost = frame.keywordCost!;
  try {
    if (!(frame.awaiting === "replaceMove" && state.lastMode !== null) && !canFinishAutomaticPrice(ctx, game, state, frame)) {
      if (frame.awaiting) throw new IllegalAction(`that ${labelOf(cost.line)} skill cost payment is no longer available`);
      return fail(state, ev, cost);
    }
    const result = stepScript(automaticPriceHost(ctx, game, state, ev), frame);
    if (result === "wait") {
      const prompt = state.prompt;
      if (prompt.kind === "chooseCards") {
        prompt.choice.candidates = prompt.choice.candidates.filter((id) => {
          const clone = structuredClone(state);
          clone.lastChoice = [id];
          return canFinishAutomaticPrice(ctx, game, clone, frame);
        });
      }
      return "wait";
    }
  } catch (err) {
    if (err instanceof AutoPaymentFailed) return fail(state, ev, cost);
    throw err;
  }
  const owner = state.programs.find((f) => f.keywordPrice?.key === cost.key);
  if (owner) owner.keywordPrice = undefined;
  announce(state, ev, frame.master, cost.line);
  for (const moment of cost.moments) fire(ctx, game, state, moment);
  return "done";
}

/** 5-8-4: the price could not be paid in full. What was paid stays paid; no skill, no moment, no play. */
function fail(state: VmState, ev: GameEvent[], cost: KeywordCost): "done" {
  const at = state.programs.findIndex((f) => f.keywordPrice?.key === cost.key);
  if (at >= 0) state.programs.splice(at, 1);
  log(ev, { type: "note", text: `${labelOf(cost.line)} activation failed: its skill cost could not be paid in full` });
  return "done";
}
