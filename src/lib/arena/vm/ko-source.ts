/** Bounded source and continuation shape for the original-KO final-cost follow-up. */
import {completeFilter} from "./script-schema";
import {canonicalTaxValue} from "./tax-receipt";
import {completedKoCost,koResultRebuild,requireKoResult,type KoBinding,type KoResult} from "./ko-result";
import type {Script,ScriptFrame,Op} from "./script";
import type {VmState} from "./state";
import type {PlayerId} from "../types";
const canonical=(value:unknown)=>value===undefined?"<undefined>":canonicalTaxValue(JSON.parse(JSON.stringify(value, (key,v)=>key==="reason"||key==="upTo"&&v===false?undefined:v)));
export function koResultScript(script:Script|undefined):boolean {
  return Array.isArray(script?.ops)&&script.ops.some(op=>op?.op==="ko"&&op.completedAs!==undefined);
}
export function requireKoShape(script:Script|undefined):string {
  const ops=script?.ops,choice=ops?.[0];
  if(!choice||choice.op!=="choose"||typeof choice.as!=="string"||!choice.as.trim()||choice.as!==choice.as.trim())koResultRebuild("missing exact chooser");
  const name=choice.as;
  const expected:Op[]=[{op:"choose",sel:{side:"opponent",area:"battle",filter:completeFilter({type:"BATTLE"}),count:1},chooser:"opponent",as:name},
    {op:"ko",target:{var:name},completedAs:name},{op:"if",cond:{kind:"koedByThisSkill",var:name,costMax:3},then:[{op:"draw",n:1}]}];
  if(script?.kind!=="auto"||canonical(script.trigger)!==canonical(["played"])||canonical(ops)!==canonical(expected)
      ||canonical(script.price?.ops??[])!=="[]")koResultRebuild("unreviewed original KO source body");
  return name;
}
export function captureKoBinding(state:VmState,card:string,master:PlayerId,skillIndex:number,script:Script):KoBinding {
  const name=requireKoShape(script),sourceEpoch=state.cards[card]?.zoneEpoch??0;
  const result={card,master,skillIndex,sourceEpoch,name};requireKoBinding(state,script,result,card,master,skillIndex);return result;
}
export function requireKoBinding(state:VmState,script:Script|undefined,value:KoBinding|undefined,card:string,master:PlayerId,skillIndex:number|undefined):asserts value is KoBinding {
  const name=requireKoShape(script),current=state.cards[card]?.zoneEpoch;
  if(!value||value.card!==card||value.master!==master||value.skillIndex!==skillIndex||value.name!==name
      ||!Number.isSafeInteger(value.sourceEpoch)||value.sourceEpoch<0||!Number.isSafeInteger(current)||current!<value.sourceEpoch)koResultRebuild("missing original source occurrence");
}
function requireKoChronology(state:VmState,result:KoResult):void {
  for(const selected of result.selected){const current=state.cards[selected.card]?.zoneEpoch;if(state.cards[selected.card]&&(!Number.isSafeInteger(current)||current!<selected.epoch))koResultRebuild("selected KO history is ahead of the card");}
  for(const outcome of result.outcomes){const current=state.cards[outcome.card]?.zoneEpoch;if(state.cards[outcome.card]&&(!Number.isSafeInteger(current)||current!<outcome.toEpoch))koResultRebuild("KO result history is ahead of the card");}
}
export function requireKoFrame(state:VmState,source:Script|undefined,frame:ScriptFrame):void {
  if(!koResultScript(source)&&!frame.koBinding&&!frame.koResults)return;
  requireKoBinding(state,source,frame.koBinding,frame.card,frame.master,frame.skillIndex);
  const binding=frame.koBinding,name=binding.name,ops=source!.ops;
  if(frame.autoCost){
    const cost=frame.autoCost;
    if(canonical(cost.effect)!==canonical(ops)||canonical(frame.ops)!=="[]"||frame.ip!==0||canonical(frame.vars)!=="{}"
        ||frame.koResults||!cost.skill||cost.skill.index!==frame.skillIndex||cost.skill.kind!=="auto"
        ||!["offer","pools","action"].includes(cost.stage)||frame.awaiting!==undefined&&frame.awaiting!=="autoCost")koResultRebuild("changed Auto price continuation");
    return;
  }
  // Tax children are owned by the existing tax-gate contract; their saved parent must retain this body.
  if(frame.taxGate)koResultRebuild("unreviewed nested tax continuation");
  if(!Number.isSafeInteger(frame.ip)||frame.ip<0||frame.ip>3||!Array.isArray(frame.ops)||!frame.vars)koResultRebuild("invalid effect cursor");
  const result=frame.koResults?.[name];
  if(frame.koResults&&Object.keys(frame.koResults).some(key=>key!==name))koResultRebuild("unknown result binding");
  if(frame.ip<2&&canonical(frame.ops)!==canonical(ops))koResultRebuild("changed original KO body");
  if(frame.ip===0){if(result||frame.moveLoop)koResultRebuild("premature KO history");return;}
  const selected=frame.vars[name];
  if(!Array.isArray(selected)||selected.length>1||selected.some(id=>typeof id!=="string")||Object.keys(frame.vars).some(key=>key!==name))koResultRebuild("changed KO choice linkage");
  if(frame.ip===1){
    if(frame.moveLoop){
      if(frame.moveLoop.kind!=="ko"||canonical(frame.moveLoop.ids)!==canonical(selected))koResultRebuild("changed KO loop");
      requireKoResult(result,binding,frame.moveLoop.index);requireKoChronology(state,result);
      if(canonical(result.selected.map(x=>x.card))!==canonical(selected))koResultRebuild("changed active KO selection");
    }else koResultRebuild("missing active KO cursor");
    return;
  }
  requireKoResult(result,binding,selected.length);requireKoChronology(state,result);
  if(canonical(result.selected.map(x=>x.card))!==canonical(selected))koResultRebuild("changed completed KO selection");
  const draw=completedKoCost(result,binding,selected.length,3);
  const expanded=[...ops.slice(0,2),...(draw?[{op:"draw",n:1}]:[])];
  if(canonical(frame.ops)!==canonical(ops)&&canonical(frame.ops)!==canonical(expanded))koResultRebuild("changed completed KO branch");
}
