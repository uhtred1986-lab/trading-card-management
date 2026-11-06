import { guardBattleEnergyScriptHistory } from "./energy-entry-battle";
/** R476 bounded native bridge; R507 admits exact source descriptors on proved routes. */
import type { EngineContext, PlayerId } from "../types";
import type { GameDefinition } from "../rulesets";
import { cleanupScriptPlacement } from "./script-placement-cleanup";
import { moveCard } from "./zones";
import { forbids, zoneOf } from "./program";
import { captureEnergyEntryMode } from "./energy-entry-mode";
import { beginStandingNegationMutation, finishStandingNegationMutation } from "./standing-negation-runtime";
import type { VmState } from "./state";
import type { ScriptFrame, Op } from "./script";
import type { ScriptHost } from "./script-host";
import { NotYet } from "./errors";
import { energyEntrySource, possibleEnergyEntrySource } from "./energy-entry-source";
import { guardCostEnergyEntry, guardEnergyEntryBatch } from "./energy-entry-preflight";
import { createEnergyEntryContinuation, requireEnergyEntryContinuation, runEnergyEntryContinuation, energyEntryNegationEarned } from "./energy-entry-continuation";
import type { EnergyEntryWitness } from "./energy-entry-witness";

const fail = (): never => { throw new NotYet("rebuild the original optional Energy movement", "R476"); };
const costMove = (ops: readonly Op[]): boolean => ops.some(op => op.op === "moveTo" && op.to === "energy" && op.cause === "cost"
  || op.op === "if" && (costMove(op.then) || costMove(op.else ?? [])) || op.op === "may" && costMove(op.ops)
  || op.op === "chooseMode" && op.modes.some(mode => costMove(mode.ops)));

export function guardOptionalEnergyFrame(ctx: EngineContext, state: VmState, h: ScriptHost, frame: ScriptFrame): void {
  if (frame.saveVarsAs || frame.keywordCost || frame.keywordPrice || frame.counterCost || frame.autoCost || costMove(frame.ops)) guardCostEnergyEntry(ctx,state,h,frame);
  const pending = frame.energyEntry;
  if (pending === undefined) return;
  if (!pending || typeof pending !== "object" || !pending.witness || !pending.witness.incoming) return fail();
  const source = energyEntrySource(ctx,state,pending.witness?.incoming?.card,true);
  if (!source) return fail();
  requireEnergyEntryContinuation(h,frame,pending,source.skillIndex,source.policy,pending.witness.destination);
}

export function prepareOptionalEnergyEntry(ctx: EngineContext, state: VmState, h: ScriptHost, childHost: (child: ScriptFrame) => ScriptHost, frame: ScriptFrame, id: string, destination: EnergyEntryWitness["destination"]): "ready" | "wait" | "recheck" {
  const source = energyEntrySource(ctx,state,id,!!frame.energyEntry);
  if (!source) { if (frame.energyEntry) fail(); return "ready"; }
  if (frame.declaredCharge && !frame.energyCharge) return fail();
  if (!frame.energyEntry) {
    guardEnergyEntryBatch(ctx,state,h,frame,frame.moveLoop?.ids ?? [id]);
    frame.energyEntry=createEnergyEntryContinuation(h,frame,id,source.skillIndex,source.policy,destination);
  }
  const pending=frame.energyEntry;
  requireEnergyEntryContinuation(h,frame,pending,source.skillIndex,source.policy,destination);
  if (pending.completed) return "ready";
  return runEnergyEntryContinuation(h,childHost(pending.child),frame,pending)==="suspended"?"wait":"recheck";
}

export interface OptionalEnergyArrival { card: string; epoch: number; player: PlayerId; negate: boolean }

/** This receipt is local to one synchronous native move, never a saved callback. */
export function optionalEnergyArrival(ctx: EngineContext, game: GameDefinition, state: VmState, h: ScriptHost, frame: ScriptFrame | undefined, id: string, player: PlayerId, mode?: "active" | "rest"): OptionalEnergyArrival | undefined {
  const pending=frame?.energyEntry;
  if (pending === undefined) { guardUnownedEnergyEntry(ctx,state,id); return; }
  const source=energyEntrySource(ctx,state,id,true);
  if (!source) return fail();
  requireEnergyEntryContinuation(h,frame!,pending,source.skillIndex,source.policy,{player,area:"energy",...(mode?{mode}:{})});
  if (pending.witness.incoming.card!==id) return fail();
  const earned=energyEntryNegationEarned(pending);
  let negate=false;
  if (earned) {
    const actor={card:id,player:pending.child.master,source:id};
    const protectedBefore=h.forbids("beNegated",actor);
    const modes=new Set([captureEnergyEntryMode(ctx,game,state,id,mode).mode,captureEnergyEntryMode(ctx,game,state,id,mode,true).mode]);
    // RM22-31 settles Exhaust before placement; it does not resolve a
    // protection that changes with area or mode. Compare only this bounded
    // admitted original own route, and refuse disagreement instead of ruling it.
    for(const candidateMode of modes){
      const projected=projectEnergyEntryCleanup(ctx,game,state,id,player,candidateMode);
      if(forbids(ctx,game,projected,"beNegated",actor)!==protectedBefore)throw new NotYet("optional Energy negation protection changes with its entry", "R476");
    }
    negate=!protectedBefore;
  }
  return {card:id,epoch:h.zoneEpoch(id),player,negate};
}

/** Isolated pre-stamp board projection; no movement events or pending Autos.
 * Admission and source/arrival protection agreement remain the caller's job.
 */
export function projectEnergyEntryCleanup(ctx: EngineContext, game: GameDefinition, state: VmState, id: string, player: PlayerId, mode: "active" | "rest"): VmState {
  const projected=structuredClone(state), from=zoneOf(projected,id);
  const token=beginStandingNegationMutation(ctx,projected);
  const placed=moveCard(projected,game,id,"energy",{owner:player,mode});
  if(!placed.ok || placed.move.to!=="energy")throw new NotYet("project this optional Energy protection boundary", "R476");
  cleanupScriptPlacement(projected,[],placed.move,from,false);
  finishStandingNegationMutation(ctx,projected,token);
  return projected;
}

/** Native/direct routes have no resumable original ScriptFrame yet. */
export function guardUnownedEnergyEntry(ctx: EngineContext, state: VmState, id: string): void {
  guardBattleEnergyScriptHistory(ctx,state,id);
  if (state.cards[id]?.hidden && possibleEnergyEntrySource(ctx,state,id) || energyEntrySource(ctx,state,id)) throw new NotYet("optional Energy entry without an original script movement", "R476");
}
