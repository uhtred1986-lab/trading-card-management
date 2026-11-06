/** R510 native adapter: synchronous original cost movement and pending evidence. */
import type { EngineContext, GameEvent } from "../types";
import type { GameDefinition } from "../rulesets";
import type { Op, ScriptFrame } from "./script";
import type { ScriptHost } from "./script-host";
import type { VmState } from "./state";
import { NotYet } from "./errors";
import { IllegalAction, programsOf } from "./common";
import { executionReceipt, paymentEffectFrame } from "./applied-effect-receipt";
import { findCard, hostOf } from "./zones";
import { resolvePlay } from "./play";
import { expandedBodyMatches, validateScopeStack } from "./skill-play-scope";
import type { MovementOutcome } from "./movement-result";
import { autoPlayEnvelopeProblem, autoPlayRebuild, equal, keys, sameCard, underOpponentPlayPrice, requireAutoPlayCost, type PlayCostCard, type AutoPlayCostReceipt } from "./auto-play-cost";
const natural = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
function cardAt(state: VmState, id: string): PlayCostCard {
  const c = state.cards[id];
  if (!c) return autoPlayRebuild();
  return { card: id, cardId: c.cardId, owner: c.owner, epoch: c.zoneEpoch ?? 0, hiddenCount: c.hiddenCount ?? 0, flipped: c.flipped };
}

export function prepareAutoPlayCost(ctx: EngineContext, state: VmState, frame: ScriptFrame, ops: Op[], host: ScriptHost): void {
  const pick = underOpponentPlayPrice(ops);
  if (!pick) return;
  if (frame.autoPlayCost || frame.skillEffectOrigin?.version !== 2 || frame.skillEffectOrigin.kind !== "auto"
    || frame.copiedSkillCapture || frame.grantEffectId !== undefined || frame.standingGrantId !== undefined
    || !natural(frame.skillIndex)) autoPlayRebuild();
  const root = executionReceipt(state, paymentEffectFrame(frame));
  if (!root || root.root.kind !== "tax") autoPlayRebuild();
  const source = cardAt(state, frame.card);
  const sourceAt = findCard(state, frame.card);
  if (root.root.source.cardId !== source.cardId || root.root.source.epoch !== source.epoch
    || root.root.source.hiddenCount !== source.hiddenCount || sourceAt?.owner !== root.root.source.holder
    || sourceAt.zone !== root.root.source.area) throw new IllegalAction("the Auto play-cost source occurrence changed");
  const printed = programsOf(ctx, ctx.defs[source.cardId], source.flipped ? "back" : "front").bySkill[frame.skillIndex!];
  if (!printed || !equal(printed.price?.ops, ops) || !equal(printed.ops, frame.ops)) autoPlayRebuild();
  const problem = autoPlayEnvelopeProblem(printed);
  if (problem) throw new NotYet(problem, "R510");
  frame.autoPlayCost = {
    version: 1, master: frame.master, skillIndex: frame.skillIndex!, source,
    paymentRoot: structuredClone(root.root), declaration: structuredClone(printed), price: structuredClone(ops), body: structuredClone(frame.ops),
    playIp: 1, alias: pick.as, offered: host.resolveSelector(frame, pick.sel).map(id => cardAt(state, id)), phase: "offered",
  };
}


export function requireAutoPlayProgram(ctx: EngineContext, frame: ScriptFrame, body = false): AutoPlayCostReceipt {
  const r = requireAutoPlayCost(frame), def = ctx.defs[r.source.cardId];
  const script = def && programsOf(ctx, def, r.source.flipped ? "back" : "front").bySkill[r.skillIndex];
  if (!script || !equal(script, r.declaration)
    || !equal(frame.usage, r.declaration.usage) || !equal(frame.validity, r.declaration.validity)
    || !(body ? equal(r.body, frame.ops) || expandedBodyMatches(r.body, frame.ops, equal) : equal(frame.ops, r.price))
    || frame.autoCost && (!equal(frame.autoCost.effect, r.body) || frame.autoCost.skill.kind !== "auto"
      || frame.autoCost.skill.index !== r.skillIndex || !equal(frame.autoCost.skill.usage, r.declaration.usage)
      || !equal(frame.autoCost.skill.validity, r.declaration.validity))) autoPlayRebuild();
  return r;
}

/** Validate an already-open serialized window before its Counter can pay or
 * change anything. Lifecycle boundary and arrival state are independent. */
export function requireCounterArrivalTiming(ctx: EngineContext, state: VmState): void {
  const window = state.resolving?.scopeWindow;
  if (!window) return;
  validateScopeStack(state);
  const scope = state.skillPlayScopes?.find(s => s.id === window.scope);
  if (!scope?.window || !["before", "after"].includes(window.boundary) || scope.phase !== window.boundary
    || state.resolving!.player !== scope.master || state.resolving!.card !== null
    || !!state.resolving!.landed !== (window.boundary === "after" || !!scope.paidCost)) autoPlayRebuild();
  const paid = scope.paidCost;
  if (!paid) return;
  const def = ctx.defs[paid.source.cardId];
  const script = def && programsOf(ctx, def, paid.source.flipped ? "back" : "front").bySkill[paid.skillIndex];
  if (!script || !equal(script, paid.declaration)) autoPlayRebuild();
  const current = state.cards[paid.arrival!.card];
  if (current && (!natural(current.zoneEpoch ?? 0) || (current.zoneEpoch ?? 0) < paid.arrival!.epoch)) autoPlayRebuild();
  const held = scope.window.programs[0];
  if (!held) autoPlayRebuild();
  if (window.boundary === "before") {
    if (!equal(requireAutoPlayProgram(ctx, held, true), paid)) autoPlayRebuild();
  } else if (held.skillPlayFinish?.version !== 1 || held.skillPlayFinish.scope !== scope.id) autoPlayRebuild();
}


/** The strict caller supplies its ordinary failed-payment exception. A legal
 * replacement's completed changes remain, while the parent never activates. */
export function payUnderOpponentPlay(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], host: ScriptHost,
  cards: string[], opts: Parameters<ScriptHost["playThen"]>[1], frame: ScriptFrame, unpaid: () => never): void {
  const pick = underOpponentPlayPrice(frame.ops), r = requireAutoPlayProgram(ctx, frame);
  if (frame.replacing || frame.replacementMove || frame.replacementAuto || frame.moveLoop) {
    throw new NotYet("resume a replacement or batch inside an Auto play cost", "R510");
  }
  if (!pick || pick.as !== r.alias || frame.ip !== 2 || r.phase !== "offered" || cards.length !== 1
    || !keys(opts, ["player", "toOpponent", "playPermission"]) || opts.player !== r.master || opts.toOpponent !== true) autoPlayRebuild();
  const price = programsOf(ctx, ctx.defs[r.source.cardId], r.source.flipped ? "back" : "front").bySkill[r.skillIndex].price!;
  if (price.condition && !host.condHolds(frame, price.condition)) unpaid();
  if (!sameCard(cardAt(state, frame.card), r.source)) throw new IllegalAction("the Auto play-cost source occurrence changed");
  const sourceAt = findCard(state, frame.card);
  if (sourceAt?.owner !== r.paymentRoot.source.holder || sourceAt.zone !== r.paymentRoot.source.area) {
    throw new IllegalAction("the Auto play-cost source area changed");
  }
  const id = cards[0], original = r.offered.find(c => c.card === id);
  if (!original || !state.cards[id] || !sameCard(original, cardAt(state, id)) || hostOf(state, id) !== frame.card
    || Object.values(state.cards).filter(c => c.under.includes(id)).length !== 1
    || findCard(state, id) || !host.resolveSelector(frame, pick.sel).includes(id)) throw new IllegalAction("that under-card is no longer a payable occurrence");
  if (state.cards[id].under.length || state.cards[id].hidden || state.cards[id].zCard || host.defOf(id).type !== "BATTLE") {
    throw new NotYet("pay this specialized under-card play as an Auto cost", "R510");
  }
  if (host.replacementsFor(id, "cost", { requestedTo: "battle" }).length) {
    throw new NotYet("replace this under-card Auto play cost", "R510");
  }
  const destination = r.master === "p1" ? "p2" : "p1";
  const before = new Set(state.pending);
  let result: MovementOutcome | undefined;
  resolvePlay(ctx, game, state, ev, id, destination, {
    appliedEffects: executionReceipt(state, paymentEffectFrame(frame)),
    costResult: outcome => { if (result) autoPlayRebuild(); result = outcome; },
  });
  const actual = findCard(state, id);
  if (!result || !result.completed || result.card !== id || result.fromEpoch !== original.epoch
    || result.to !== "battle" || actual?.zone !== "battle" || actual.owner !== destination
    || result.toEpoch !== (state.cards[id].zoneEpoch ?? 0)) unpaid();
  r.phase = "paid";
  r.arrival = { original, card: id, epoch: result!.toEpoch, controller: destination };
  // Only objects produced synchronously by this play receive historical
  // activation evidence. A later queue scan cannot adopt an unrelated Auto.
  for (const pending of state.pending) {
    if (before.has(pending) || pending.kind === "hook" || !state.cards[pending.card]) continue;
    pending.paidArrivalWitness = {
      version: 1, payment: { master: r.master, skillIndex: r.skillIndex, source: structuredClone(r.source), playIp: 1, paymentRoot: structuredClone(r.paymentRoot) },
      arrival: { card: id, epoch: result!.toEpoch }, source: { card: pending.card, epoch: state.cards[pending.card].zoneEpoch ?? 0 }, skillIndex: pending.skillIndex,
    };
  }
}
