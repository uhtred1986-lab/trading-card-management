/** R514: hand-equivalent permission keeps its real under-card origin. */
import type { EngineContext, PlayerId, Skill } from '../types';
import type { GameDefinition } from '../rulesets';
import type { VmState } from './state';
import type { Script } from './script';
import { activateUnderPrinted, activateUnderScript, type ActivateUnderPolicy } from './activate-under-contract';
import { canonicalTaxValue as canonical } from './tax-receipt';
import { findCard, hostOf } from './zones';
import { skillsShowing, captureCopiedSkill } from './triggers';
import { attrsNow, standingKindNegated } from './program';
import { predicateOf } from './filters';
import { emptyFilter } from '../text/filters';
import { skillNegated, skillsNegated } from './effects';
import { IllegalAction } from './illegal-action';
import { activationTaxes, usableFrom, type ActivationLine } from './activate';
import {activateUnderModifierProblem} from './activate-under-modifiers';
import {cardPrice} from './costs';
import { replacementChoices } from './replace';
export interface ActivateUnderOrigin {
 version:1; card:string; cardId:string; epoch:number; owner:PlayerId; host:string; hostEpoch:number; area:string; master:PlayerId;
 sourceFace:{hiddenCount:number;faceUp:boolean;flipped:boolean}; hostCardId:string; hostOwner:PlayerId; hostFace:{hiddenCount:number;faceUp:boolean;flipped:boolean};
 cardPrice:ReturnType<typeof cardPrice>; permissionSkill:number; policy:ActivateUnderPolicy; permission:Script; skillIndex:number; skill:Skill; script:Script;
}
const face=(c:VmState["cards"][string])=>({hiddenCount:c.hiddenCount??0,faceUp:c.faceUp,flipped:c.flipped});
const validFace=(f:ActivateUnderOrigin["sourceFace"])=>!!f&&safe(f.hiddenCount)&&typeof f.faceUp==='boolean'&&typeof f.flipped==='boolean';
const holders=(state:VmState,card:string)=>Object.values(state.cards).flatMap(c=>c.under.filter(id=>id===card).map(()=>c.id));
const safe=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>=0;
export function activateUnderPermission(ctx:EngineContext,game:GameDefinition,state:VmState,master:PlayerId,card:string): {index:number;policy:ActivateUnderPolicy;script:Script;host:string;area:string}|null {
 const inst=state.cards[card],host=hostOf(state,card),top=host?state.cards[host]:null,at=host?findCard(state,host):null;
 if(!inst||inst.hidden||inst.under.length||findCard(state,card)||holders(state,card).length!==1||!host||!top||top.hidden||!at||at.owner!==master||!['leader','battle','unison','combo'].includes(at.zone)||ctx.defs[inst.cardId]?.type!=='EXTRA'||skillsNegated(state,card)||standingKindNegated(ctx,game,state,card,'permanent'))return null;
 if(!predicateOf({...emptyFilter(),characters:['broly: br']},game)(attrsNow(ctx,game,state,host)))return null;
 const shown=skillsShowing(ctx,state,card);
 for(const sk of shown.skills){
  const script=shown.scripts.bySkill[sk.index],policy=activateUnderScript(script);
  if(!policy||activateUnderPrinted(sk)!==policy||skillNegated(state,card,sk.index,sk.kind)||captureCopiedSkill(state,card,sk,script)||canonical(script)!==canonical(ctx.scripts?.[inst.cardId]?.bySkill[sk.index]))continue;
  if(policy==='asHandGreenBrolyLeaderV1'&&!state.sides[master].zones.leader.some(id=>predicateOf({...emptyFilter(),colors:['Green'],characters:['broly: br']},game)(attrsNow(ctx,game,state,id))))continue;
  return {index:sk.index,policy,script:script!,host,area:at.zone};
 }
 return null;
}
export function activateUnderCards(ctx:EngineContext,game:GameDefinition,state:VmState,master:PlayerId):string[]{
 return ['leader','battle','unison','combo'].flatMap(area=>(state.sides[master].zones[area]??[]).flatMap(host=>(state.cards[host]?.under??[]).filter(card=>activateUnderPermission(ctx,game,state,master,card))));
}
export function activateUnderOrigin(ctx:EngineContext,game:GameDefinition,state:VmState,line:ActivationLine):ActivateUnderOrigin|null {
 const host=hostOf(state,line.card),master=host?findCard(state,host)?.owner:null;
 if(!master||line.keyword||!line.kind.startsWith('activate:')||!line.script||line.script.unsupported.length||usableFrom(line.script).length||captureCopiedSkill(state,line.card,line.skill,line.script))return null;
 const permit=activateUnderPermission(ctx,game,state,master,line.card),inst=state.cards[line.card];
 if(!permit||canonical(line.script)!==canonical(ctx.scripts?.[inst.cardId]?.bySkill[line.skillIndex]))return null;
 return {version:1,card:line.card,cardId:inst.cardId,epoch:inst.zoneEpoch??0,owner:inst.owner,host:permit.host,hostEpoch:state.cards[permit.host].zoneEpoch??0,area:permit.area,master,sourceFace:face(inst),hostCardId:state.cards[permit.host].cardId,hostOwner:state.cards[permit.host].owner,hostFace:face(state.cards[permit.host]),cardPrice:cardPrice(ctx,game,state,line.card,line.skill),permissionSkill:permit.index,policy:permit.policy,permission:structuredClone(permit.script),skillIndex:line.skillIndex,skill:structuredClone(line.skill),script:structuredClone(line.script)};
}
/** Canonical saved declaration is validated even after its source was legitimately staged. */
export function requireActivateUnderRecord(ctx:EngineContext,state:VmState,origin:ActivateUnderOrigin|undefined,card:string,master:PlayerId,skillIndex:number):asserts origin is ActivateUnderOrigin {
 const inst=state.cards[card];
 if(!origin||origin.version!==1||origin.card!==card||origin.master!==master||origin.skillIndex!==skillIndex||!inst||inst.cardId!==origin.cardId||inst.owner!==origin.owner||!safe(origin.epoch)||!safe(origin.hostEpoch)||!safe(inst.zoneEpoch??0)||(inst.zoneEpoch??0)<origin.epoch||!state.sides[origin.owner]||typeof origin.host!=='string'||!origin.host||typeof origin.hostCardId!=='string'||!origin.hostCardId||!state.sides[origin.hostOwner]||!validFace(origin.sourceFace)||!validFace(origin.hostFace)||!['leader','battle','unison','combo'].includes(origin.area)||!origin.cardPrice||!safe(origin.cardPrice.total)||!origin.cardPrice.orbs||!safe(origin.permissionSkill)||!activateUnderScript(origin.permission)||activateUnderScript(origin.permission)!==origin.policy||canonical(origin.permission)!==canonical(ctx.scripts?.[inst.cardId]?.bySkill[origin.permissionSkill])||canonical(origin.script)!==canonical(ctx.scripts?.[inst.cardId]?.bySkill[skillIndex])||!origin.script||origin.script.unsupported.length||usableFrom(origin.script).length||canonical(origin.skill)!==canonical(skillsShowing(ctx,state,card).skills.find(s=>s.index===skillIndex)))throw new IllegalAction('rebuild the saved original under-card Activate declaration');
}
export function requireActivateUnderSource(ctx:EngineContext,game:GameDefinition,state:VmState,origin:ActivateUnderOrigin|undefined,card:string,master:PlayerId,skillIndex:number):void {
 requireActivateUnderRecord(ctx,state,origin,card,master,skillIndex);
 const permit=activateUnderPermission(ctx,game,state,master,card),at=findCard(state,origin.host);
 if(!permit||permit.index!==origin.permissionSkill||permit.policy!==origin.policy||permit.host!==origin.host||at?.zone!==origin.area||at.owner!==master||canonical(origin.cardPrice)!==canonical(cardPrice(ctx,game,state,card,origin.skill))||state.cards[origin.host].cardId!==origin.hostCardId||state.cards[origin.host].owner!==origin.hostOwner||canonical(face(state.cards[origin.host]))!==canonical(origin.hostFace)||canonical(face(state.cards[card]))!==canonical(origin.sourceFace)||(state.cards[card].zoneEpoch??0)!==origin.epoch||(state.cards[origin.host].zoneEpoch??0)!==origin.hostEpoch)throw new IllegalAction('the original under-card Activate source or controlling host is no longer available');
}
export function activateUnderProblem(ctx:EngineContext,game:GameDefinition,state:VmState,line:ActivationLine):string|null {
 const o=line.activateUnderOrigin;if(!o)return null;
 try{requireActivateUnderSource(ctx,game,state,o,line.card,o.master,line.skillIndex);}catch(e){return e instanceof Error?e.message:String(e);}
 if(['under','hand'].some(from=>[false,true].some(counted=>activationTaxes(ctx,game,state,o.master,line.card,line.kind,from,counted).length)))return 'additional activation taxes on under-card Extras require a reviewed payment contract (R514)';
 const modifier=activateUnderModifierProblem(ctx,game,state,line);if(modifier)return `under-card Activate modifier: ${modifier} (R514)`;
 if(replacementChoices(ctx,game,state,line.card,undefined,{requestedTo:'drop'}).length)return 'under-card Extra staging replacements require a reviewed continuation (R514)';
 const p=line.script?.price?.payment;
 if(!p||Object.keys(p.orbs).length||p.either.length||p.marker!=null||p.burst!=null||p.spiritBoost!=null||line.script?.price?.x||line.script?.price?.payWith?.length)return 'compound under-card Extra skill resources require a reviewed continuation (R514)';
 return null;
}
