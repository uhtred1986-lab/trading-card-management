/** R482: the ordinary 7-2-11 action owns its original, non-skill movement. */
import type { Action, EngineContext, PlayerId } from "../types";
import { rulesetFor, type ActionDef, type GameDefinition } from "../rulesets";
import type { VmState, VmFrame } from "./state";
import type { ScriptFrame } from "./script";
import { canonicalTaxValue as canonical } from "./tax-receipt";
import { energyEntrySource, possibleEnergyEntrySource } from "./energy-entry-source";
import { taxesOn } from "./program";
import { NotYet } from "./errors";

interface ChargeOrigin {
  version: 1;
  turn: number;
  player: PlayerId;
  card: string;
  cardId: string;
  epoch: number;
  flipped: boolean;
  declaration: string;
  flow: VmFrame[];
  budgetBefore: { id: number; uses: number }[];
}
export interface EnergyChargeScope extends ChargeOrigin {
  budgetSpent: true;
  budgetAfter: { id: number; uses: number }[];
}
const fail = (): never => { throw new NotYet("rebuild the original ordinary Charge Energy entry", "R482"); };
const budget = (state: VmState) => state.effects.filter(e => e.kind === "forbid" && typeof e.forbid?.uses === "number").map(e => ({id:e.id,uses:e.forbid!.uses!}));
export function ordinaryChargeDeclaration(game: VmState["game"], def: ActionDef): boolean {
  const ordinary=rulesetFor("dbs");
  return game==="dbs" && ordinary.ok && canonical(def)===canonical(ordinary.definition.actions.charge);
}
function declaration(game: GameDefinition): string {
  if (!ordinaryChargeDeclaration(game.id,game.actions.charge)) return fail();
  return canonical(game.actions.charge);
}

/** Runs before declaration, payment, or any movement. Other charge cards keep their existing path. */
export function prepareEnergyCharge(ctx: EngineContext, game: GameDefinition, state: VmState, action: Action): ChargeOrigin | undefined {
  if (action.type!=="charge" || !action.card || !possibleEnergyEntrySource(ctx,state,action.card)) return;
  if (!energyEntrySource(ctx,state,action.card)) { if (state.cards[action.card]?.hidden) fail(); return; }
  const card=state.cards[action.card],top=state.flow.at(-1);
  if (state.energyCharge || state.programs.length || state.phase!=="charge" || state.prompt.kind!=="charge" || state.prompt.player!==action.player || state.turnPlayer!==action.player ||
    !top || top.phase!=="charge" || game.phases.charge.steps[top.index]!=="chargeEnergy" || canonical(top.asking)!==canonical([action.player]) || top.skipped || top.reask ||
    !state.sides[action.player].zones.hand.includes(action.card) || card.owner!==action.player || card.hidden ||
    ["placeEnergy","energyCap"].some(what=>taxesOn(ctx,game,state,what as "placeEnergy"|"energyCap",{player:action.player,card:action.card!}).length)) return fail();
  return {version:1,turn:state.turn,player:action.player,card:action.card,cardId:card.cardId,epoch:card.zoneEpoch??0,flipped:!!card.flipped,declaration:declaration(game),flow:structuredClone(state.flow),budgetBefore:budget(state)};
}

/** Called only after applyDeclared and its one spendUses call have completed. */
export function ownEnergyCharge(game: GameDefinition, state: VmState, origin: ChargeOrigin): void {
  const frame=state.programs[0],flow=structuredClone(origin.flow);
  flow.at(-1)!.asking=[];
  if (state.programs.length!==1 || canonical(state.flow)!==canonical(flow) || !frame || frame.declaredCharge!==true || frame.card!==origin.card || frame.master!==origin.player || frame.ip!==0 || canonical(frame.ops)!==canonical(game.actions.charge.do) || canonical(frame.vars)!==canonical({card:[origin.card]})) return fail();
  const scope:EnergyChargeScope={...origin,flow,budgetSpent:true,budgetAfter:budget(state)};
  state.energyCharge=scope;
  frame.energyCharge=structuredClone(scope);
}

/** A declaration marker is provenance only with the exact ordinary action and live flow binding. */
export function requireDeclaredCharge(game: GameDefinition, state: VmState, frame: ScriptFrame): void {
  if (frame.declaredCharge===undefined) return;
  const top=state.flow.at(-1);
  declaration(game);
  if (frame.declaredCharge!==true || frame.skillIndex!==undefined || frame.trigger!==undefined || frame.master!==state.turnPlayer || state.phase!=="charge" ||
    !top || top.phase!=="charge" || game.phases.charge.steps[top.index]!=="chargeEnergy" || canonical(top.asking)!=="[]" || top.reask || top.skipped ||
    frame.moveLoop && (frame.moveLoop.kind!=="moveTo" || canonical(frame.moveLoop.ids)!==canonical([frame.card]) || ![0,1].includes(frame.moveLoop.index) || frame.moveLoop.to!=="energy" || frame.moveLoop.reason!=="charge") ||
    frame.awaiting!==undefined && frame.awaiting!=="replaceMove" ||
    frame.ip!==0 || canonical(frame.ops)!==canonical(game.actions.charge.do) || canonical(frame.vars)!==canonical({card:[frame.card]}) ||
    !(state.sides[frame.master].zones.hand.includes(frame.card) || frame.moveLoop?.kind==="moveTo" && frame.moveLoop.index===1 && canonical(frame.moveLoop.ids)===canonical([frame.card])) || state.cards[frame.card]?.owner!==frame.master ||
    frame.saveVarsAs || frame.autoCost || frame.counterCost || frame.keywordCost || frame.keywordPrice || frame.declaredPlay || frame.fieldCost || frame.fieldCleanup || frame.awakenAlternativeCost)
    return fail();
}

/** Both copies bind the saved movement to its original action rather than a shape inferred from a skill. */
export function requireEnergyCharge(game: GameDefinition, state: VmState, frame?: ScriptFrame): void {
  for (const candidate of frame?[frame]:state.programs) requireDeclaredCharge(game,state,candidate);
  const scope=state.energyCharge;
  if (!scope) {
    const frames=frame?[frame]:state.programs;
    if (frames.some(f=>f.energyCharge!==undefined || state.phase==="charge" && f.energyEntry && f.skillIndex===undefined && canonical(f.ops)===canonical(game.actions.charge.do))) fail();
    return;
  }
  const owned=frame??state.programs.find(f=>f.energyCharge!==undefined),top=state.flow.at(-1);
  if (!owned || !owned.energyCharge || canonical(owned.energyCharge)!==canonical(scope) || scope.version!==1 || scope.budgetSpent!==true || scope.declaration!==declaration(game) ||
    !top || top.phase!=="charge" || game.phases.charge.steps[top.index]!=="chargeEnergy" || canonical(top.asking)!=="[]" || top.reask || top.skipped ||
    scope.turn!==state.turn || scope.player!==state.turnPlayer || state.phase!=="charge" || canonical(scope.flow)!==canonical(state.flow) ||
    owned.declaredCharge!==true || owned.card!==scope.card || owned.master!==scope.player || owned.skillIndex!==undefined || owned.ip!==0 || canonical(owned.ops)!==canonical(game.actions.charge.do) || canonical(owned.vars)!==canonical({card:[scope.card]}) ||
    !Array.isArray(scope.budgetBefore) || !Array.isArray(scope.budgetAfter) || scope.budgetBefore.length!==scope.budgetAfter.length ||
    scope.budgetBefore.some((before,i)=>!before || !Number.isSafeInteger(before.id) || !Number.isSafeInteger(before.uses) || before.uses<0 || scope.budgetAfter[i]?.id!==before.id || ![before.uses,Math.max(0,before.uses-1)].includes(scope.budgetAfter[i]?.uses))) return fail();
  if (scope.budgetAfter.some(after=>state.effects.some(e=>e.id===after.id && e.forbid?.uses!==after.uses))) return fail();
  const card=state.cards[scope.card];
  if (!card || card.cardId!==scope.cardId || (card.zoneEpoch??0)!==scope.epoch || !!card.flipped!==scope.flipped || card.owner!==scope.player || card.hidden || !state.sides[scope.player].zones.hand.includes(scope.card)) return fail();
}
