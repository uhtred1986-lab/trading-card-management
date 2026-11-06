/** R514: original under occurrence -> card energy -> owner Drop -> strict skill price. */
import type {EngineContext,GameEvent,PlayerId,Requirement,Color} from '../types';
import type {GameDefinition} from '../rulesets';
import type {VmState} from './state';
import {activationMoment,resolveActivation,type ActivationLine} from './activate';
import {activateUnderProblem,requireActivateUnderRecord,requireActivateUnderSource,type ActivateUnderOrigin} from './activate-under';
import {AutoPaymentFailed,automaticPriceHost,canFinishAutomaticPrice} from './auto-costs';
import {stepScript,type ScriptFrame} from './script';
import {moved} from './flow';
import {findCard} from './zones';
import {fire,log} from './events';
import {IllegalAction} from './illegal-action';
import {NotYet} from './errors';
import {canonicalTaxValue as canonical} from './tax-receipt';
import {emptyFilter} from '../text/filters';
import type {ScriptHost} from './script-host';
import type {MovementOutcome} from './movement-result';
import {cardPrice,type Price,type VmPayment} from './costs';
import {attrsNow} from './program';
import {predicateOf} from './filters';
import type {Attrs} from './cards';
import {coversColors} from '../text/cards';
import {freshAppliedEffectRoot} from './applied-effect-receipt';
export interface ActivateUnderEnergy {version:1; sourceEpoch:number; price:{total:number;orbs:Partial<Record<Color,number>>}; payers:{card:string;epoch:number;colors:Color[]}[]}
export interface ActivateUnderCost {version:1;energy:ActivateUnderEnergy;origin:ActivateUnderOrigin;movement:MovementOutcome;stagedFace:{hiddenCount:number;hidden:boolean;faceUp:boolean;flipped:boolean};negatedPayer?:{card:string;epoch:number;effect:number;attributes:Attrs;area:string;holder:PlayerId};moment:ReturnType<typeof activationMoment>}
export function captureActivateUnderEnergy(ctx:EngineContext,game:GameDefinition,state:VmState,line:ActivationLine,price:Price,payment:VmPayment):ActivateUnderEnergy {
 const o=line.activateUnderOrigin!,expected=cardPrice(ctx,game,state,line.card,line.skill);
 if(price.energy!==expected.total||canonical(price.orbs)!==canonical(expected.orbs)||price.either.length||price.markers||price.markersOff.length||price.life||price.rest||price.pooled.length||price.payers.length||payment.rest.length!==expected.total||new Set(payment.rest).size!==payment.rest.length)throw new NotYet('nonordinary under-card Extra resource payment','R514');
 const payers=payment.rest.map(card=>{
  const at=findCard(state,card),c=state.cards[card];if(!c||at?.zone!=='energy'||at.owner!==o.master||c.mode!=='active')throw new IllegalAction('under-card Extra payment needs original Active Energy');
  return {card,epoch:c.zoneEpoch??0,colors:attrsNow(ctx,game,state,card).colors as Color[]};
 });
 return {version:1,sourceEpoch:o.epoch,price:structuredClone(expected),payers};
}
export function completeActivateUnderEnergy(state:VmState,origin:ActivateUnderOrigin,energy:ActivateUnderEnergy):void{
 if(energy.payers.some(p=>findCard(state,p.card)?.zone!=='energy'||findCard(state,p.card)?.owner!==origin.master||(state.cards[p.card]?.zoneEpoch??0)!==p.epoch||state.cards[p.card]?.mode!=='rest'))throw new IllegalAction('under-card Extra energy payment did not complete');
}
const face=(s:VmState,id:string)=>({hiddenCount:s.cards[id].hiddenCount??0,hidden:s.cards[id].hidden,faceUp:s.cards[id].faceUp,flipped:s.cards[id].flipped});
function requireEnergy(o:ActivateUnderOrigin,e:ActivateUnderEnergy):void{
 if(!e||canonical(e.price)!==canonical(o.cardPrice)||e.version!==1||e.sourceEpoch!==o.epoch||!e.price||!Number.isSafeInteger(e.price.total)||e.price.total<0||!e.price.orbs||!Array.isArray(e.payers)||e.payers.length!==e.price.total||e.payers.some(p=>!p||typeof p.card!=='string'||!Number.isSafeInteger(p.epoch)||p.epoch<0||!Array.isArray(p.colors)||p.colors.some(c=>!['Red','Blue','Green','Yellow','Black','White','Colorless'].includes(c)))||new Set(e.payers.map(p=>p.card)).size!==e.payers.length||Object.entries(e.price.orbs).some(([c,n])=>!['Red','Blue','Green','Yellow','Black'].includes(c)||!Number.isSafeInteger(n)||n!<0)||Object.values(e.price.orbs).some(n=>n!>e.price.total)||Object.values(e.price.orbs).reduce((a,n)=>a+(n??0),0)>e.price.total||!coversColors(e.payers.map(p=>p.colors),Object.entries(e.price.orbs).flatMap(([c,n])=>Array(Number(n)).fill(c))))throw new IllegalAction('rebuild the saved under-card Extra card-energy receipt');
}
function requirePrintedPrice(ops:ScriptFrame['ops']):void {
 if(!ops.length)return;
 const choose=ops[0];
 if(choose?.op!=='choose'||typeof choose.as!=='string'||!/^\w+$/.test(choose.as)||typeof choose.reason!=='string')throw new NotYet('this under-card Extra printed skill price','R514');
 const expected=[{op:'choose',sel:{side:'you',area:'play',filter:{...emptyFilter(),colors:['Green'],characters:['Paragus: Br']},count:1,upTo:false},as:choose.as,reason:choose.reason},{op:'negateSkills',target:{var:choose.as},until:'turn'},{op:'moveTo',target:{var:choose.as},to:'drop',reveal:true}];
 if(canonical(ops)!==canonical(expected))throw new NotYet('this under-card Extra printed skill price','R514');
}
/** Unlike an effect, a prevented negation cannot be skipped as a paid cost. */
function priceHost(ctx:EngineContext,game:GameDefinition,state:VmState,ev:GameEvent[],frame:ScriptFrame):ScriptHost {
 const h=automaticPriceHost(ctx,game,state,ev,frame);
 return {...h,forbids:(what,opts)=>{const blocked=h.forbids(what,opts);if(what==='beNegated'&&blocked)throw new AutoPaymentFailed();return blocked;},
  addEffect:e=>{
   const before=e.kind==='negateSkills'?{attributes:structuredClone(attrsNow(ctx,game,state,e.target)),area:findCard(state,e.target)?.zone??'',holder:findCard(state,e.target)?.owner}:null;
   const made=h.addEffect(e);
   if(e.kind==='negateSkills'){
    if(!made||made.kind!=='negateSkills'||made.target!==e.target||made.source!==frame.card||made.master!==frame.master||made.until!=='turn')throw new AutoPaymentFailed();
    frame.activateUnderCost!.negatedPayer={card:e.target,epoch:state.cards[e.target].zoneEpoch??0,effect:made.id,attributes:before!.attributes,area:before!.area,holder:before!.holder!};
   }
   return made;
  },move:(id,to,owner,opts)=>{
   const n=frame.activateUnderCost?.negatedPayer;
   if(!n||n.card!==id||n.epoch!==(state.cards[id]?.zoneEpoch??0)||!state.effects.some(e=>e.id===n.effect&&e.kind==='negateSkills'&&e.target===id&&e.source===frame.card&&e.master===frame.master))throw new AutoPaymentFailed();
   return h.move(id,to,owner,opts);
  }};
}
function capturedPayerMatches(game:GameDefinition,choice:Extract<ScriptFrame['ops'][number],{op:'choose'}>,attributes:Attrs):boolean {
 try {return Array.isArray(attributes.colors)&&attributes.colors.every(c=>typeof c==='string')&&Array.isArray(attributes.characters)&&attributes.characters.every(c=>typeof c==='string')&&predicateOf(choice.sel.filter!,game)(attributes);}catch{return false;}
}
function canFinish(ctx:EngineContext,game:GameDefinition,state:VmState,frame:ScriptFrame):boolean {
 return canFinishAutomaticPrice(ctx,game,state,frame,{hostForProof:(s,f)=>priceHost(ctx,game,s,[],f)});
}
function staged(ctx:EngineContext,game:GameDefinition,state:VmState,ev:GameEvent[],line:ActivationLine,energy?:ActivateUnderEnergy):ScriptFrame {
 const o=line.activateUnderOrigin!;if(energy)requireEnergy(o,energy);requireActivateUnderSource(ctx,game,state,o,line.card,o.master,line.skillIndex);
 let result:MovementOutcome|undefined;
 moved(ctx,game,state,ev,line.card,'drop',{owner:o.owner,reveal:true,onResult:r=>{result=structuredClone(r);}});
 if(!result||!result.completed||result.card!==o.card||result.from!==null||result.fromEpoch!==o.epoch||result.to!=='drop'||result.toEpoch!==o.epoch+1||findCard(state,o.card)?.owner!==o.owner)throw new NotYet('original under-card Extra staging did not complete; rebuild before this unsupported staging route','R514');
 const frame:ScriptFrame={card:line.card,master:o.master,skillIndex:line.skillIndex,usage:line.script!.usage!,validity:line.script!.validity!,ops:structuredClone(line.script?.price?.ops??[]),ip:0,vars:{},activateUnderPayment:true,activateUnderCost:{version:1,energy:structuredClone(energy!) ,origin:structuredClone(o),movement:result,stagedFace:face(state,o.card),moment:{event:'skillActivated',card:o.card,controller:o.master,args:{kind:'activate',from:'under',paid:true,extra:true,cardActivation:true}}}};
 return freshAppliedEffectRoot(state,frame,'tax');
}
export function activateUnderPriceRefusals(ctx:EngineContext,game:GameDefinition,state:VmState,player:PlayerId,line:ActivationLine,charge:(s:VmState)=>void,price?:Price,payment?:VmPayment):Requirement[]{
 if(!line.activateUnderOrigin)return [];
 try{
  const problem=activateUnderProblem(ctx,game,state,line);if(problem)return [{kind:'other',detail:problem}];
  if(line.activateUnderOrigin.master!==player)return [{kind:'other',detail:'under-card activation belongs to its controlling host'}];
  requirePrintedPrice(line.script?.price?.ops??[]);
  if(price&&payment)captureActivateUnderEnergy(ctx,game,state,line,price,payment);
  const copy=structuredClone(state);charge(copy);const frame=staged(ctx,game,copy,[],line);
  return canFinish(ctx,game,copy,frame)?[]:[{kind:'other',detail:'the under-card Extra skill cost cannot be paid in full'}];
 }catch(e){if(e instanceof NotYet||e instanceof IllegalAction)return [{kind:'other',detail:e.message}];throw e;}
}
export function queueActivateUnderCost(ctx:EngineContext,game:GameDefinition,state:VmState,ev:GameEvent[],line:ActivationLine,energy:ActivateUnderEnergy):void{
 completeActivateUnderEnergy(state,line.activateUnderOrigin!,energy);
 state.programs.unshift(staged(ctx,game,state,ev,line,energy));
}
export function stepActivateUnderCost(ctx:EngineContext,game:GameDefinition,state:VmState,ev:GameEvent[],frame:ScriptFrame):'done'|'wait'{
 const saved=frame.activateUnderCost;
 if(frame.activateUnderPayment!==true||!saved||saved.version!==1||frame.skillIndex===undefined)throw new IllegalAction('rebuild the saved under-card Extra payment');
 const o=saved.origin;requireActivateUnderRecord(ctx,state,o,frame.card,frame.master,frame.skillIndex);requireEnergy(o,saved.energy);
 if(!Array.isArray(frame.ops)||!frame.vars||typeof frame.vars!=='object'||Array.isArray(frame.vars)||Object.values(frame.vars).some(v=>!Array.isArray(v)||v.some(x=>typeof x!=='string'))||!Number.isSafeInteger(frame.ip)||frame.ip<0||frame.ip>frame.ops.length)throw new IllegalAction('rebuild the saved under-card price cursor and variables');
 requirePrintedPrice(frame.ops);
 if(frame.ops.length&&(frame.ip!==0&&frame.ip!==2))throw new IllegalAction('rebuild the saved Paragus payment phase');
 if(frame.ip===2||saved.negatedPayer!==undefined){
  const n=saved.negatedPayer,choice=frame.ops[0];
  if(!n||typeof n.card!=='string'||!Number.isSafeInteger(n.epoch)||n.epoch<0||!Number.isSafeInteger(n.effect)||n.effect<0||!n.attributes||typeof n.attributes!=='object'||Array.isArray(n.attributes)||n.holder!==frame.master||!['leader','battle','unison'].includes(n.area)||choice?.op!=='choose'||frame.vars[choice.as]?.length!==1||frame.vars[choice.as][0]!==n.card||!capturedPayerMatches(game,choice,n.attributes))throw new IllegalAction('rebuild the saved Paragus negation payment');
 }
 const expected={event:'skillActivated',card:o.card,controller:o.master,args:{kind:'activate',from:'under',paid:true,extra:true,cardActivation:true}};
 const r=saved.movement,at=findCard(state,o.card);
 if(!r||r.card!==o.card||r.completed!==true||r.from!==null||r.fromEpoch!==o.epoch||r.to!=='drop'||r.toEpoch!==o.epoch+1||at?.zone!=='drop'||at.owner!==o.owner||(state.cards[o.card].zoneEpoch??0)!==r.toEpoch||canonical(saved.stagedFace)!==canonical(face(state,o.card))||canonical(frame.ops)!==canonical(o.script.price?.ops??[])||canonical(saved.moment)!==canonical(expected)||canonical(frame.usage)!==canonical(o.script.usage)||canonical(frame.validity)!==canonical(o.script.validity))throw new IllegalAction('rebuild the saved under-card staging occurrence and complete price');
 try{
  if(!(frame.awaiting==='replaceMove'&&state.lastMode!==null)&&!canFinish(ctx,game,state,frame)){
   if(frame.awaiting)throw new IllegalAction('that choice cannot pay the complete under-card Extra skill cost');
   log(ev,{type:'note',text:'Under-card Extra activation failed: its skill cost could not be paid in full'});return 'done';
  }
  if(stepScript(priceHost(ctx,game,state,ev,frame),frame)==='wait'){
   if(state.prompt.kind==='chooseCards')state.prompt.choice.candidates=state.prompt.choice.candidates.filter(id=>{const copy=structuredClone(state);copy.lastChoice=[id];return canFinish(ctx,game,copy,frame);});
   return 'wait';
  }
 }catch(e){if(e instanceof AutoPaymentFailed){log(ev,{type:'note',text:'Under-card Extra activation failed: its skill cost could not be paid in full'});return 'done';}throw e;}
 const line:ActivationLine={card:o.card,skillIndex:o.skillIndex,skill:o.skill,script:o.script,kind:o.skill.kind};
 resolveActivation(ctx,game,state,ev,o.master,line,undefined,undefined,{ops:o.script.ops,vars:frame.vars,paidCardInfo:frame.paidCardInfo,paidMarkers:frame.paidMarkers},true);
 fire(ctx,game,state,saved.moment);return 'done';
}
