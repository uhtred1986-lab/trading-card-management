import { requireFusionMaterials } from "./fusion-materials";
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
 * and the [Evolve] family (22-5-3) pay it first. Fusion determines and pays
 * every remaining resource cost at that same post-material checkpoint. Its
 * permissions, reducers and available payers are read from the resulting
 * board, not frozen at declaration (#907; official ver4 §22-13-4-4/-4-1).
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
 * [Union-Absorb] shares the strict action-price host while keeping its own
 * cost-before-effect procedure (§22-13-6-1, #930).
 *
 * Pure and client-safe, like the rest of `vm/`: no database, no network.
 */
import { other, type Area, type EngineContext, type GameEvent, type PlayerId, type Requirement } from "../types";
import type { GameDefinition } from "../rulesets";
import { announce, boundFor, isFusionPayment, keywordActionPrice, scopedPayersSpent, type ActivationLine } from "./activate";
import { AutoPaymentFailed, automaticPriceHost, canFinishAutomaticPrice, readableAutomaticPrice } from "./auto-costs";
import { IllegalAction } from "./common";
import { NotYet, RulesetBroken } from "./errors";
import { fire, log, type Moment } from "./events";
import { stepScript, type Op, type ScriptFrame } from "./script";
import { chargeCost, chargesOf, planCost, priceFor, spendSkillCostUses, type Price, type VmPayment } from "./costs";
import { keywordProgram } from "./keyword-do";
import { spendUse } from "./limits";
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
  /** #907: all Fusion resource payment follows material payment, including orb-only lines. */
  fusion?: { stage: "resources" | "native" | "action"; choices?: { price: Price; payment: VmPayment; label: string }[]; payment?: VmPayment; nativeIndex?: number; poolIndex?: number };
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
  ops, ip: 0, vars: {}, card: line.card, master: player, skillIndex: line.skillIndex, usage: line.skill.usage as import("./usage").UsageRecord, validity: line.skill.validity as import("./validity").ValidityRecord, ...(cost ? { keywordCost: cost } : {}),
});

/** Pay the energy half with `charge` and then the whole action price, on a copy; true when every instruction can complete. */
function finishes(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, line: ActivationLine, ops: Op[], charge: (s: VmState) => void, x?: number): boolean {
  const clone = structuredClone(state);
  try {
    charge(clone);
  } catch (err) {
    if (err instanceof IllegalAction && !(err instanceof NotYet)) return false;
    throw err;
  }
  return canFinishAutomaticPrice(ctx, game, clone, { ...priceFrame(line, player, ops), ...(x === undefined ? {} : { x }) });
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
  if (!ops && !cost.fusion) throw new RulesetBroken(state.game, `${cost.line.card}'s keyword move carries a price its record no longer has`);
  cost.queued = true;
  state.programs.unshift({ ...priceFrame(cost.line, frame.master, ops ?? [], { key: cost.key, line: cost.line, moments: cost.moments, ...(cost.fusion ? { fusion: cost.fusion } : {}) }), ...(frame.x === undefined ? {} : { x: frame.x }) });
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
  assertCurrentFusion(cost);
  try {
    if (cost.fusion && cost.fusion.stage !== "action") {
      const result = payFusionResources(ctx, game, state, ev, frame);
      if (result !== "paid") return result;
    }
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
  if (cost.fusion) {
    if (cost.line.script?.price?.payment.marker != null) state.cards[frame.card].usedMarkerSkill = true;
    spendUse(state, frame.master, frame.card, cost.line.skill);
    spendSkillCostUses(state, ev, frame.card, cost.line.skill);
  }
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

/** Materials are a strict cost too. Their Autos pend normally; no checkpoint is
 * inserted between §22-13-4-4 and -4-1. Replacements that miss the destination
 * fail the attempt and retain only departures actually performed (§5-8-4). */
export function stepFusionMaterials(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], frame: ScriptFrame): "done" | "wait" {
  assertCurrentFusion(frame.keywordPrice!);
  const host = automaticPriceHost(ctx, game, state, ev);
  // Reject stale/forged answers before the strict host can classify a now
  // impossible set as an ordinary failed payment. Rejected actions preserve
  // the pending choice; an unanswered impossible payment still fails 5-8-4.
  const choosing = frame.ops[frame.ip];
  if (choosing?.op === "choose" && choosing.namedSet && frame.awaiting === choosing.as && state.lastChoice) {
    let picked = [...(frame.vars[choosing.as] ?? [])];
    for (const id of state.lastChoice) {
      if (!host.namedCandidates(frame, choosing.sel, picked, !choosing.anyPower).includes(id)) throw new IllegalAction("that card can no longer be chosen");
      picked = [...picked, id];
    }
  }
  try {
    const result = stepScript({ ...host, namedCandidates: (f, sel, picked, samePower) => {
      const candidates = host.namedCandidates(f, sel, picked, samePower);
      if (!candidates.length && picked.length < (sel.count ?? 2)) throw new AutoPaymentFailed("Fusion materials cannot be paid in full");
      return candidates;
    } }, frame);
    if (result === "wait" && state.prompt.kind === "chooseCards") {
      const prompt = state.prompt;
      const viable = prompt.choice.candidates.filter((id) => {
        const projected = structuredClone(state);
        projected.lastChoice = [id];
        return !fusionPaymentRefusals(ctx, game, projected, frame.master, frame.keywordPrice!.line, frame.x, frame).length;
      });
      // An already accepted payment may become impossible after a saved
      // choice. Let its attempt reach failure; do not restore paid resources.
      if (viable.length) prompt.choice.candidates = viable;
    }
    return result;
  } catch (err) {
    if (err instanceof AutoPaymentFailed) return fail(state, ev, frame.keywordPrice!);
    throw err;
  }
}

function fusionPlans(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, line: ActivationLine, x?: number) {
  const bound = boundFor(ctx, game, state, player, line);
  if (x !== undefined && bound.energy) bound.energy = { ...bound.energy, total: (bound.energy.total ?? 0) + x };
  const price = priceFor(ctx, game, state, game.actions.activate, line.card, bound);
  const plan = planCost(ctx, game, state, player, price, line.card);
  if (!plan.ok) return [];
  const plans = plan.asks && plan.options.length > 1 ? plan.options.map((option) => planCost(ctx, game, state, player, price, line.card, option.rest)) : [plan];
  return plans.flatMap((p) => p.ok ? [{ price, payment: p.payment, label: p.describe }] : []);
}

/** The resource amount is determined once, on the post-material board. The
 * saved choice and paid stage survive reload; stale answers cannot replan it. */
function payFusionResources(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], frame: ScriptFrame): "done" | "wait" | "paid" {
  const cost = frame.keywordCost!;
  const fusion = cost.fusion!;
  if (fusion.stage === "resources") {
    fusion.choices ??= fusionPlans(ctx, game, state, frame.master, cost.line, frame.x);
    if (!fusion.choices.length) return fail(state, ev, cost);
    if (fusion.choices.length > 1 && frame.awaiting !== "fusionResources") {
      frame.awaiting = "fusionResources";
      state.programs.unshift(frame);
      state.prompt = { kind: "chooseMode", player: frame.master, reason: "Pay the Union-Fusion skill cost", options: fusion.choices.map((choice) => choice.label) };
      return "wait";
    }
    const index = fusion.choices.length > 1 ? state.lastMode : 0;
    const choice = index === null ? undefined : fusion.choices[index];
    if (!choice) throw new IllegalAction("no such Fusion skill cost payment");
    const current = planCost(ctx, game, state, frame.master, choice.price, frame.card, choice.payment.rest);
    if (!current.ok || !samePayment(current.payment, choice.payment)) throw new IllegalAction("that Fusion skill cost payment is no longer available");
    delete frame.awaiting;
    state.lastMode = null;
    fusion.payment = choice.payment;
    fusion.nativeIndex = 0;
    fusion.poolIndex = 0;
    fusion.stage = "native";
    frame.ops = [];
    frame.ip = 0;
  }
  // As in Aegis, native pool departures need the interpreter's saved
  // replacement choice and exact destination check, not an inline charge.
  const costs = game.actions.activate.cost ?? [];
  const charges = chargesOf(game);
  const host = automaticPriceHost(ctx, game, state, ev);
  const payment = fusion.payment!;
  while (fusion.nativeIndex! < costs.length) {
    const name = costs[fusion.nativeIndex!];
    const charge = charges[name];
    if (!charge) throw new RulesetBroken(game.id, `there is no price called ${name}`);
    const to = (charge.does as { to?: string } | null)?.to;
    const cards = charge.consumes === "life" ? payment.life : charge.consumes === "cards" && charge.from ? payment.pooled.find((pool) => pool.cost === name)?.cards ?? [] : null;
    if (cards?.length) {
      if (!to) throw new RulesetBroken(game.id, `the price ${name} takes cards but has no destination`);
      const id = cards[fusion.poolIndex!];
      if (id) {
        const from = charge.from ?? { side: "you", area: "life" };
        const side = from.side === "opponent" ? other(frame.master) : frame.master;
        if (host.areaOf(id) !== from.area || !state.sides[side].zones[from.area]?.includes(id)) throw new IllegalAction("that Fusion pool payment is no longer available");
        const key = "§fusionNativePayment";
        if (!frame.ops.length || frame.ip > 0) {
          frame.vars[key] = [id];
          frame.ops = [{ op: "moveTo", target: { var: key }, to: to as Area, cause: "cost", ...(game.zones[from.area]?.visibility === "all" ? {} : { reveal: true }) }];
          frame.ip = 0;
        }
        const result = stepScript(host, frame);
        if (result === "wait") return "wait";
        fusion.poolIndex!++;
        frame.ops = [];
        frame.ip = 0;
        delete frame.moveLoop;
        continue;
      }
    } else if (cards === null) {
      const spent = scopedPayersSpent(ctx, game, state, frame.master, cost.line);
      const rested: string[] = [];
      try { chargeCost(ctx, game, state, ev, frame.master, payment, frame.card, [name], undefined, (id) => rested.push(id)); }
      finally { spent(rested); }
    }
    fusion.nativeIndex!++;
    fusion.poolIndex = 0;
  }
  frame.ops = keywordActionPrice(cost.line) ?? [];
  frame.ip = 0;
  delete frame.vars["§fusionNativePayment"];
  fusion.stage = "action";
  return "paid";
}

/** Prove an offer by executing only the material payment on isolated states,
 * then determining the stored cost. This admits post-material reducers and
 * refuses prices whose reducer leaves with a material; no Auto resolves here. */
export function fusionPaymentRefusals(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, line: ActivationLine, x?: number, from?: ScriptFrame): Requirement[] {
  try {
    const ops = keywordActionPrice(line) ?? [];
    readable(line, ops);
    let explored = 0;
    const visit = (board: VmState, frame: ScriptFrame): boolean => {
      if (++explored > 4096) throw new NotYet("prove this Fusion material/payment search within 4096 steps", "#907");
      let resumed: ScriptFrame | undefined;
      let checkpoint = false;
      const host = automaticPriceHost(ctx, game, board, []);
      try {
        const result = stepScript({ ...host, resume: (next) => { resumed = next; }, payKeywordPrice: () => { checkpoint = true; } }, frame);
        if (checkpoint) return fusionPlans(ctx, game, board, player, line, x).some((choice) => finishes(ctx, game, board, player, line, ops, (copy) => chargeCost(ctx, game, copy, [], player, choice.payment, line.card, game.actions.activate.cost ?? []), x));
        if (result !== "wait" || !resumed) return false;
        const prompt = board.prompt;
        if (prompt.kind === "chooseCards") return prompt.choice.candidates.some((id) => {
          const copy = structuredClone(board); copy.lastChoice = [id];
          return visit(copy, structuredClone(resumed!));
        });
        if (prompt.kind === "chooseMode" || prompt.kind === "replaceMove") return prompt.options.some((_, index) => {
          const copy = structuredClone(board); copy.lastMode = index;
          return visit(copy, structuredClone(resumed!));
        });
        return false;
      } catch (err) {
        if (err instanceof AutoPaymentFailed || (err instanceof IllegalAction && !(err instanceof NotYet))) return false;
        throw err;
      }
    };
    const frame: ScriptFrame = { ops: keywordProgram(game, line.keyword!, line.skill), ip: 0, vars: {}, card: line.card, master: player, skillIndex: line.skillIndex, usage: line.skill.usage as import("./usage").UsageRecord, validity: line.skill.validity as import("./validity").ValidityRecord, keywordPrice: { key: `${line.card}:${line.skillIndex}`, line, moments: [], fusion: { stage: "resources" } } };
    return visit(structuredClone(state), structuredClone(from ?? frame)) ? [] : [{ kind: "other", detail: "its skill cost cannot be paid in full" }];
  } catch (err) {
    if (err instanceof NotYet) return [{ kind: "other", detail: `not yet: ${err.step} (${err.issue})` }];
    throw err;
  }
}

/** JSONB can reorder object properties without changing a saved payment. */
function samePayment(a: VmPayment, b: VmPayment): boolean {
  const ids = (x: string[], y: string[]) => x.length === y.length && x.every((id, i) => id === y[i]);
  return a.energyMarkers === b.energyMarkers && a.markers === b.markers && a.restsSelf === b.restsSelf
    && ids(a.rest, b.rest) && ids(a.life, b.life)
    && a.pooled.length === b.pooled.length && a.pooled.every((p, i) => p.cost === b.pooled[i].cost && ids(p.cards, b.pooled[i].cards))
    && a.markersOff.length === b.markersOff.length && a.markersOff.every((p, i) => {
      const q = b.markersOff[i];
      return p.cost === q.cost && p.side === q.side && p.area === q.area && p.n === q.n && p.by === q.by;
    });
}

/** Old pending Fusion saves already charged energy at declaration. They cannot
 * be repaired by guessing whether a cost was paid; require a rebuilt match. */
export function assertCurrentFusion(cost: KeywordCost): void {
  if (isFusionPayment(cost.line)) {
    try { requireFusionMaterials(cost.line.script?.price); } catch { throw new NotYet("rebuild this saved match: missing or malformed typed Fusion material contract v1", "#907"); }
  }
  if (isFusionPayment(cost.line) && !cost.fusion) throw new NotYet("rebuild this saved match: obsolete Union-Fusion payment checkpoint", "#907");
}
