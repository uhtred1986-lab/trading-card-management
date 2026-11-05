/** R456: keyword-referred Drop cost precedes printed orbs/actions (1-6-3). */
import type { Action, CardOccurrence, EngineContext, GameEvent, PlayerId, Requirement } from "../types";
import type { GameDefinition } from "../rulesets";
import { boundFor, scopedPayersSpent, type ActivationLine } from "./activate";
import { automaticPriceHost, AutoPaymentFailed, canFinishAutomaticPrice } from "./auto-costs";
import { IllegalAction } from "./common";
import { chargeCost, planCost, priceFor, type Price, type VmPayment } from "./costs";
import { NotYet } from "./errors";
import { stepScript, type Op, type ScriptFrame } from "./script";
import type { VmState } from "./state";
import { attrsNow, taxesOn, type TaxInForce } from "./program";
import { findCard } from "./zones";
import { canonicalTaxValue as canonical } from "./tax-receipt";
export interface OverRealmSource { version: 1; card: string; cardId: string; epoch: number; area: "hand" | "warp"; player: PlayerId }
type Choice = { price: Price; payment: VmPayment; label: string; payers: CardOccurrence[] };
export interface OverRealmCost {
  source: OverRealmSource;
  drop: CardOccurrence[];
  stage: "taxes" | "drop" | "resources" | "action";
  paidTaxes: string[];
  tax?: { identity: string; ops: Op[]; accepted: boolean; payers: (CardOccurrence & { paid?: true })[] };
  requestedEnergy?: CardOccurrence[];
  choices?: Choice[];
  selected?: number;
}
export const isOverRealmPayment = (line: Pick<ActivationLine,"keyword">): boolean => line.keyword?.name === "Over Realm";
export function overRealmAction(line: Pick<ActivationLine,"keyword"|"script"|"skill">): Op[] {
  const ops=line.script?.price?.ops ?? [];
  if (!ops.length) return [];
  if (line.skill.keyword?.name === "Over Realm" && line.skill.keyword.dark && ops.length===1 && ops[0].op==="draw" && ops[0].n===1 && (!ops[0].side || ops[0].side==="you")) return ops;
  throw new NotYet("pay this Over Realm action-price shape", "R456");
}
export function overRealmCost(state:VmState, player:PlayerId, line:ActivationLine):OverRealmCost {
  const at=findCard(state,line.card), inst=state.cards[line.card];
  if(!inst||!at||at.owner!==player||(at.zone!=="hand"&&at.zone!=="warp"))throw new IllegalAction("Over Realm source is not in its declared area");
  return {source:{version:1,card:line.card,cardId:inst.cardId,epoch:inst.zoneEpoch??0,area:at.zone,player},drop:[],paidTaxes:[],stage:"taxes"};
}
export function overRealmSourceProblem(state:VmState, source:OverRealmSource|undefined, card:string):string|null {
  if(!source||source.version!==1||source.card!==card||typeof source.cardId!=="string"||!Number.isSafeInteger(source.epoch)||source.epoch<0||!["hand","warp"].includes(source.area)||!["p1","p2"].includes(source.player))return "missing or malformed Over Realm source contract; rebuild saved match (R456)";
  const at=findCard(state,card),inst=state.cards[card];
  return !inst||inst.cardId!==source.cardId||(inst.zoneEpoch??0)!==source.epoch||at?.owner!==source.player||at.zone!==source.area?"Over Realm source left its declared occurrence":null;
}
export function retainOverRealmSelection(state:VmState,cost:OverRealmCost,action:Action):void {
  if("pay" in action&&action.pay!==undefined){if(!Array.isArray(action.pay)||new Set(action.pay).size!==action.pay.length)throw new IllegalAction("invalid Over Realm energy selection");cost.requestedEnergy=action.pay.map(card=>({card,epoch:state.cards[card]?.zoneEpoch??0}));}
  if("payPools" in action&&action.payPools!==undefined)throw new IllegalAction("Over Realm has no declared choice pool");
}
function dropFrame(frame:ScriptFrame,cost:OverRealmCost):ScriptFrame {
  const vars={...frame.vars};
  const ops:Op[]=cost.drop.map((item,i)=>{const key=`§overRealmDrop${i}`;vars[key]=[item.card];return {op:"moveTo",target:{var:key},to:"warp",cause:"cost"};});
  return {...frame,ops,ip:0,vars};
}
function plans(ctx:EngineContext,game:GameDefinition,state:VmState,player:PlayerId,line:ActivationLine,cost?:OverRealmCost):Choice[] {
  if(cost?.requestedEnergy?.some(i=>(state.cards[i.card]?.zoneEpoch??0)!==i.epoch))return [];
  const price=priceFor(ctx,game,state,game.actions.activate,line.card,boundFor(ctx,game,state,player,line));
  if(price.markers||price.markersOff.some(p=>p.n)||price.life||price.rest||price.pooled.some(p=>p.n))throw new NotYet("pay supplementary native resources on Over Realm", "R456");
  const plan=planCost(ctx,game,state,player,price,line.card,cost?.requestedEnergy?.map(i=>i.card));
  if(!plan.ok)return [];
  const options=cost?.requestedEnergy||!plan.asks||plan.options.length<2?[plan]:plan.options.map(o=>planCost(ctx,game,state,player,price,line.card,o.rest));
  return options.flatMap(p=>p.ok?[{price,payment:p.payment,label:p.describe,payers:p.payment.rest.map(card=>({card,epoch:state.cards[card].zoneEpoch??0}))}]:[]);
}
function finishAfterResources(ctx:EngineContext,game:GameDefinition,state:VmState,frame:ScriptFrame,line:ActivationLine,choice:Choice):boolean {
  const copy=structuredClone(state);
  try { chargeCost(ctx,game,copy,[],frame.master,choice.payment,frame.card,game.actions.activate.cost??[]); }
  catch(error){if(error instanceof IllegalAction && !(error instanceof NotYet))return false;throw error;}
  return canFinishAutomaticPrice(ctx,game,copy,{...frame,ops:overRealmAction(line),ip:0,vars:{}});
}
function currentTaxes(ctx:EngineContext,game:GameDefinition,state:VmState,frame:ScriptFrame):TaxInForce[] {
  return taxesOn(ctx,game,state,"play",{player:frame.master,card:frame.card,source:frame.card,bySkill:true,keyword:"Over Realm",withIdentity:true});
}
function threshold(ctx:EngineContext,game:GameDefinition,state:VmState,player:PlayerId,line:ActivationLine):boolean {
  const kw=line.skill.keyword;if(kw?.name!=="Over Realm")return false;
  return state.sides[player].zones.drop.filter(id=>!kw.dark||(attrsNow(ctx,game,state,id).colors as string[]).includes("Black")).length>=kw.x;
}
function captureDrop(state:VmState,player:PlayerId,cost:OverRealmCost):void {
  cost.drop=state.sides[player].zones.drop.map(card=>({card,epoch:state.cards[card].zoneEpoch??0}));cost.stage="drop";
}
export function overRealmPaymentRefusals(ctx:EngineContext,game:GameDefinition,state:VmState,player:PlayerId,line:ActivationLine,action?:Action):Requirement[] {
  const cost=overRealmCost(state,player,line);if(action)retainOverRealmSelection(state,cost,action);
  const frame:ScriptFrame={card:line.card,master:player,skillIndex:line.skillIndex,ops:[],ip:0,vars:{}};
  const prove=(board:VmState,paid:string[]):boolean=>{
    if(overRealmSourceProblem(board,cost.source,line.card))return false;
    const tax=currentTaxes(ctx,game,board,frame).find(t=>!paid.includes(t.identity!));
    if(tax)return canFinishAutomaticPrice(ctx,game,board,{...frame,ops:tax.ops},{symmetry:false,complete:s=>prove(s,[...paid,tax.identity!])});
    if(!threshold(ctx,game,board,player,line))return false;
    const next=structuredClone(cost);captureDrop(board,player,next);
    return canFinishAutomaticPrice(ctx,game,board,dropFrame(frame,next),{symmetry:false,complete:(s,f)=>plans(ctx,game,s,player,line,next).some(c=>finishAfterResources(ctx,game,s,f,line,c))});
  };
  return prove(state,[])?[]:[{kind:"other",detail:"the complete Over Realm skill cost cannot be paid"}];
}
function stepTaxes(ctx:EngineContext,game:GameDefinition,state:VmState,ev:GameEvent[],frame:ScriptFrame,cost:OverRealmCost,line:ActivationLine):"wait"|"done" {
  while(cost.stage==="taxes") {
    const live=currentTaxes(ctx,game,state,frame);
    if(cost.tax && (typeof cost.tax.identity!=="string"||!Array.isArray(cost.tax.ops)||typeof cost.tax.accepted!=="boolean"||!Array.isArray(cost.tax.payers)||cost.tax.payers.some(p=>!p||typeof p.card!=="string"||!Number.isSafeInteger(p.epoch)||p.epoch<0)))throw new NotYet("rebuild malformed Over Realm tax payment", "R456");
    const current=cost.tax&&live.find(t=>t.identity===cost.tax!.identity);
    if(current&&canonical(current.ops)!==canonical(cost.tax!.ops))throw new NotYet("rebuild changed Over Realm tax instructions", "R456");
    if(cost.tax&&!live.some(t=>t.identity===cost.tax!.identity)){
      delete cost.tax;frame.ops=[];frame.ip=0;delete frame.moveLoop;delete frame.awaiting;state.lastMode=null;state.lastChoice=null;
    }
    const next=live.find(t=>!cost.paidTaxes.includes(t.identity!));
    if(!cost.tax&&!next){if(!threshold(ctx,game,state,frame.master,line))throw new AutoPaymentFailed("the post-tax Over Realm Drop threshold is not met");captureDrop(state,frame.master,cost);return "done";}
    if(!cost.tax) {
      cost.tax={identity:next!.identity!,ops:structuredClone(next!.ops),accepted:false,payers:[]};
      frame.awaiting="overRealmTax";state.programs.unshift(frame);
      state.prompt={kind:"chooseMode",player:frame.master,reason:"Pay the additional Over Realm play cost",options:["Pay the additional cost","Do not activate"]};return "wait";
    }
    const tax=cost.tax;
    if(!tax.accepted){const answer=state.lastMode;if(answer!==0&&answer!==1)throw new IllegalAction("answer the additional Over Realm cost");state.lastMode=null;delete frame.awaiting;if(answer===1)throw new AutoPaymentFailed("the additional Over Realm cost was declined");tax.accepted=true;frame.ops=structuredClone(tax.ops);frame.ip=0;frame.vars={};}
    for(const payer of tax.payers)if(!payer.paid&&(state.cards[payer.card]?.zoneEpoch??0)!==payer.epoch)throw new AutoPaymentFailed("an unpaid additional-cost card left its occurrence");
    const host=automaticPriceHost(ctx,game,state,ev);
    const result=stepScript({...host,move:(id,to,owner,options)=>host.move(id,to,owner,{...options,onResult:outcome=>{options?.onResult?.(outcome);if(outcome.completed){const payer=tax.payers.find(p=>p.card===id&&!p.paid);if(payer)payer.paid=true;}}})},frame);
    if(result==="wait")return "wait";
    cost.paidTaxes.push(tax.identity);delete cost.tax;frame.ops=[];frame.ip=0;frame.vars={};delete frame.moveLoop;
    if(overRealmSourceProblem(state,cost.source,frame.card))throw new AutoPaymentFailed("the source left while paying its additional cost");
  }
  return "done";
}
/** The original whole Drop is paid once, then resource choice is made on that board. */
export function stepOverRealmCost(ctx:EngineContext,game:GameDefinition,state:VmState,ev:GameEvent[],frame:ScriptFrame,cost:OverRealmCost,line:ActivationLine):"wait"|"paid" {
  const problem=overRealmSourceProblem(state,cost.source,frame.card);
  if(problem){if(problem.includes("rebuild"))throw new NotYet(problem,"R456");throw new AutoPaymentFailed(problem);}
  if(!["taxes","drop","resources","action"].includes(cost.stage)||!Array.isArray(cost.paidTaxes)||cost.paidTaxes.some(i=>typeof i!=="string")||new Set(cost.paidTaxes).size!==cost.paidTaxes.length||!Array.isArray(cost.drop)||cost.drop.some(i=>!i||typeof i!=="object"||typeof i.card!=="string"||!Number.isSafeInteger(i.epoch)||i.epoch<0)||new Set(cost.drop.map(i=>i.card)).size!==cost.drop.length)throw new NotYet("rebuild malformed Over Realm payment stages", "R456");
  if(cost.stage==="taxes"&&stepTaxes(ctx,game,state,ev,frame,cost,line)==="wait")return "wait";
  if(cost.stage==="drop") {
    if(!frame.ops.length){const next=dropFrame(frame,cost);frame.ops=next.ops;frame.vars=next.vars;frame.ip=0;}
    for(const item of cost.drop.slice(frame.ip)){const at=findCard(state,item.card);if(at?.zone!=="drop"||at.owner!==frame.master||(state.cards[item.card]?.zoneEpoch??0)!==item.epoch)throw new AutoPaymentFailed("an unpaid Over Realm Drop card left its occurrence");}
    if(stepScript(automaticPriceHost(ctx,game,state,ev),frame)==="wait")return "wait";
    cost.stage="resources";frame.ops=[];frame.ip=0;delete frame.moveLoop;
  }
  if(cost.stage==="resources") {
    if(overRealmSourceProblem(state,cost.source,frame.card))throw new AutoPaymentFailed("Over Realm source left during its Drop cost");
    cost.choices??=plans(ctx,game,state,frame.master,line,cost).filter(c=>finishAfterResources(ctx,game,state,frame,line,c));
    if(!cost.choices.length)throw new AutoPaymentFailed("the remaining Over Realm cost cannot be paid");
    if(cost.selected===undefined&&cost.choices.length>1&&frame.awaiting!=="overRealmResources") {frame.awaiting="overRealmResources";state.programs.unshift(frame);state.prompt={kind:"chooseMode",player:frame.master,reason:"Pay the remaining Over Realm skill cost",options:cost.choices.map(c=>c.label)};return "wait";}
    const index=cost.selected??(cost.choices.length>1?state.lastMode:0),choice=index===null?undefined:cost.choices[index];
    if(!choice)throw new IllegalAction("choose an offered Over Realm payment");
    if(!Array.isArray(choice.payers)||choice.payers.length!==choice.payment.rest.length||choice.payers.some((i,n)=>!i||typeof i!=="object"||i.card!==choice.payment.rest[n]||!Number.isSafeInteger(i.epoch)||i.epoch<0||(state.cards[i.card]?.zoneEpoch??0)!==i.epoch))throw new IllegalAction("that saved Over Realm energy occurrence is no longer available");
    const livePrice=priceFor(ctx,game,state,game.actions.activate,line.card,boundFor(ctx,game,state,frame.master,line));
    const current=planCost(ctx,game,state,frame.master,livePrice,frame.card,choice.payment.rest);
    if(!current.ok||canonical(current.payment)!==canonical(choice.payment)||!finishAfterResources(ctx,game,state,frame,line,{...choice,price:livePrice,payment:current.payment}))throw new IllegalAction("that Over Realm payment is no longer available");
    cost.selected=index!;state.lastMode=null;delete frame.awaiting;
    const spent=scopedPayersSpent(ctx,game,state,frame.master,line);
    chargeCost(ctx,game,state,ev,frame.master,choice.payment,frame.card,game.actions.activate.cost??[]);spent(choice.payment.rest);
    cost.stage="action";frame.ops=overRealmAction(line);frame.ip=0;
  }
  return "paid";
}

/** A tax which appeared after the native skill paid/activated still has to
 * complete before its one play. It never spends that activation a second time. */
export interface OverRealmLateTax {
  version: 1;
  source: OverRealmSource;
  ownerIp: number;
  payers: (CardOccurrence & { paid?: true })[];
  identities?: string[];
}
export function stepOverRealmLateTax(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], frame: ScriptFrame): "done" | "wait" {
  const tax = frame.overRealmLateTax!;
  if (tax.version !== 1 || !Number.isSafeInteger(tax.ownerIp) || tax.ownerIp < 0 || !Array.isArray(tax.payers) || tax.payers.some(p => !p || typeof p.card !== "string" || !Number.isSafeInteger(p.epoch) || p.epoch < 0)) throw new NotYet("rebuild malformed late Over Realm tax payment", "R456");
  const owner = state.programs.find(f => f.viaKeyword === "Over Realm" && f.card === frame.card && f.ip === tax.ownerIp && canonical(f.overRealmSource) === canonical(tax.source));
  if (!owner || owner.master !== frame.master || frame.master !== tax.source?.player || !Array.isArray(owner.overRealmPaidTaxes)) throw new NotYet("rebuild late Over Realm tax owner", "R456");
  const fail = () => {
    state.lastChoice = null;
    state.lastMode = null;
    state.programs = state.programs.filter(f => f !== owner);
    if (state.resolving?.card === frame.card && !state.resolving.landed) state.resolving = null;
    return "done" as const;
  };
  const problem = overRealmSourceProblem(state, tax.source, frame.card);
  if (problem?.includes("rebuild")) throw new NotYet(problem, "R456");
  if (problem) return fail();
  const current = currentTaxes(ctx, game, state, owner).filter(t => !owner.overRealmPaidTaxes!.includes(t.identity!));
  if (!tax.identities) {
    if (frame.ip !== 0 || canonical(current.flatMap(t => t.ops)) !== canonical(frame.ops)) throw new NotYet("rebuild late Over Realm tax instructions", "R456");
    tax.identities = current.map(t => t.identity!);
  } else if (!Array.isArray(tax.identities) || tax.identities.some(i => typeof i !== "string") || new Set(tax.identities).size !== tax.identities.length) throw new NotYet("rebuild late Over Realm tax identities", "R456");
  // A changed rule is a new price, not permission to continue old instructions.
  if (tax.identities.some(identity => !current.some(rule => rule.identity === identity))) return fail();
  if (tax.payers.some(p => !p.paid && (state.cards[p.card]?.zoneEpoch ?? 0) !== p.epoch)) return fail();
  const host = automaticPriceHost(ctx, game, state, ev);
  try {
    const result = stepScript({ ...host, move: (id, to, player, options) => host.move(id, to, player, { ...options, onResult: outcome => {
      options?.onResult?.(outcome);
      if (outcome.completed) { const payer = tax.payers.find(p => p.card === id && !p.paid); if (payer) payer.paid = true; }
    } }) }, frame);
    if (result === "wait") return "wait";
    owner.overRealmPaidTaxes.push(...tax.identities.filter(i => !owner.overRealmPaidTaxes!.includes(i)));
    // The immutable receipts settle these rules, never every future tax on the card.
    owner.vars["§playTaxPaid"] = (owner.vars["§playTaxPaid"] ?? []).filter(id => id !== frame.card);
    return "done";
  } catch (error) {
    if (error instanceof AutoPaymentFailed || error instanceof IllegalAction && !(error instanceof NotYet)) return fail();
    throw error;
  }
}

/** End-turn OR cleanup follows effect-carry moves but never a fresh arrival. */
export function overRealmReturnCurrent(state: VmState, frame: ScriptFrame): boolean {
  const witness = frame.overRealmReturn;
  if (!witness || witness.version !== 1 || witness.card !== frame.card || !Number.isSafeInteger(witness.token) || witness.token < 0) throw new NotYet("rebuild saved Over Realm arrival cleanup", "R456");
  const at = findCard(state, frame.card);
  return at?.zone === "battle" && canonical(state.cards[frame.card]?.overRealmReturn) === canonical(witness);
}
