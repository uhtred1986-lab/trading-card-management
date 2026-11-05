/** R-424: native replacement activation windows and original departure continuation. */
import { replacementChoices } from "../../src/lib/arena/vm/replace";
import { skillsShowing } from "../../src/lib/arena/vm/triggers";
import { prepareReplacementAuto, requireReplacementOrigin } from "../../src/lib/arena/vm/replacement-auto";
import { parseRule, printOps, validateRule } from "../../src/lib/arena/lang";
import type { Op } from "../../src/lib/arena/vm/script";
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, runtimeSupportOfRow, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { vmHost } from "../../src/lib/arena/vm/host";
import { stepScript } from "../../src/lib/arena/vm/script";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const copy=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
const PRINTS={"BT12-074": "[Unique][Blocker]<br>[Auto] If your Leader Card is a \u226aTurles Crusher Corps\u226b card and this card was used in a combo from your deck or hand: When this card would be placed in its owner's Drop Area from a Combo Area, you may play it instead.<br>[Auto] If your Leader Card is a \u226aTurles Crusher Corps\u226b card: When this card is played, play up to 1 green &lt;Lakasei&gt; card with an energy cost of 2 from your deck in Rest Mode, then shuffle your deck.", "BT12-072": "[Unique]<br>[Auto] If your Leader Card is a \u226aTurles Crusher Corps\u226b card and this card was used in a combo from your deck or hand: When this card would be placed in its owner's Drop Area from a Combo Area, you may play it in Rest Mode instead.<br>[Auto] When this card is played, look at up to 3 cards from the top of your deck, add up to 1 \u226aTurles Crusher Corps\u226b card among them to your hand, then shuffle your deck.", "BT12-071": "[unique]<br>[auto] If your Leader Card is a \u226aTurles Crusher Corps\u226b card and this card was used in a combo from your deck or hand: When this card would be placed in its owner's Drop Area from a Combo Area, you may play it in Rest Mode instead.<br>[activate: main]{g}: Send this card to its owner's Warp, then choose 1 of your opponent's Battle Cards with an energy cost of 5 or more and KO it. You can't play copies of this card for the turn.", "BT12-075": "[Unique]<br>[Auto] If your Leader Card is a \u226aTurles Crusher Corps\u226b card and this card was used in a combo from your deck or hand: When this card would be placed in its owner's Drop Area from a Combo Area, you may play it in Rest Mode instead.<br>[Auto] If your Leader Card is a \u226aTurles Crusher Corps\u226b card: When this card is played, play up to 1 green &lt;Rasin&gt; card with an energy cost of 2 from your deck, then shuffle your deck; draw 1 card, then choose 1 card in your hand and discard it."};
const defs:Record<string,CardDef>={LEADER:card("LEADER",{type:"LEADER",traits:["Turles Crusher Corps"]}),WRONG:card("WRONG",{type:"LEADER"}),FILLER:card("FILLER",{skill:null})};
for(const [id,skill] of Object.entries(PRINTS))defs[id]=card(id,{colors:["Green"],energyCost:id==="BT12-071"?3:2,skill});
defs.DROP=card("DROP",{skill:"[Activate: Battle] Choose 1 card in your Combo Area and place it in its owner's Drop Area."});
defs.HAND=card("HAND",{skill:"[Activate: Battle] Choose 1 card in your Combo Area and return it to its owner's hand."});
defs.ANSWER=card("ANSWER",{type:"EXTRA",energyCost:0,skill:"[Counter: Play] The Battle Card played is played in Rest Mode."});
defs.MAYDROP=card("MAYDROP",{skill:"[Activate: Battle] You may place 1 card from your Combo Area in its owner's Drop Area. If you do, draw 1 card."});
const records=Object.values(defs).flatMap(skillRecords);
const rows=records.map((r,id)=>({...r,id,source:"compiler",status:"confirmed"}) as unknown as RuleRow);
for(const r of rows)assert.deepEqual(runtimeSupportOfRow(r).unsupported,[],r.cardId+"#"+r.skillIndex);
const ctx:EngineContext={defs,scripts:rulesFromRows(copy(rows),defs)};
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
const history:GameEvent[]=[];
const take=(s:VmState,a:Action,engine=ctx)=>{const out=RULES.apply(engine,copy(s),a);history.push(...out.events);return out.state as VmState;};
function fresh(first:PlayerId):VmState{
 let s=RULES.createGame(ctx,{seed:393,p1:{name:"One",leader:"LEADER",main:fifty("FILLER")},p2:{name:"Two",leader:"LEADER",main:fifty("FILLER")}}).state as VmState;
 for(const a of [{type:"chooseFirst",player:s.chooser,first},{type:"mulligan",player:first,redraw:false},{type:"mulligan",player:other(first),redraw:false},{type:"charge",player:first,card:null},{type:"endMain",player:first},{type:"charge",player:other(first),card:null},{type:"endMain",player:other(first)},{type:"charge",player:first,card:null}] as Action[])s=take(s,a);
 return s;
}
function stage(s:VmState,owner:PlayerId,def:string,area:"deck"|"hand"|"battle"):string{
 const id=s.sides[owner].zones.deck.at(-1)!;s.cards[id].cardId=def;if(area!=="deck")assert.ok(moveCard(s,game,id,area,{owner}).ok);return id;
}
function advance(s:VmState,accept=true,selected?:string,engine=ctx):{state:VmState;offered:boolean}{
 let offered=false;
 for(let i=0;i<80&&s.prompt.kind!=="main";i++){
  const p=s.prompt;let a:Action|undefined;
  if(p.kind==="replaceMove"){offered=true;a={type:"chooseMode",player:p.player,index:accept?0:p.options.length-1};}
  else if(p.kind==="chooseCards")a={type:"choose",player:p.player,cards:selected&&p.choice.candidates.includes(selected)?[selected]:p.choice.candidates.slice(0,p.choice.min??0)};
  else if(p.kind==="combo")a={type:"pass",player:p.player};
  else if(p.kind==="zEnergyFromCombo")a={type:"zEnergyFromCombo",player:p.player,card:null};
  else {const legal=RULES.legalActions(engine,s).map(x=>x.action);a=legal.find(x=>x.type==="counter"&&x.card===null)??legal.find(x=>x.type==="chooseMode"&&x.index===0)??legal[0];}
  assert.ok(a,JSON.stringify(p));s=take(s,a,engine);
 }assert.equal(s.prompt.kind,"main");return {state:s,offered};
}
function pass(s:VmState):VmState {
 const legal=RULES.legalActions(ctx,s).map(x=>x.action);
 const a=legal.find(x=>x.type==="counter"&&x.card===null)??legal.find(x=>x.type==="pass")??legal.find(x=>x.type==="zEnergyFromCombo"&&x.card===null)??legal.find(x=>x.type==="chooseMode"&&x.index===0);
 assert.ok(a,JSON.stringify(s.prompt));return take(s,a);
}
function ready(owner:PlayerId,id:string,skillMove:boolean|"may"=false){
 history.length=0;
 let s=fresh(owner);const leader=s.sides[owner].zones.leader[0],combo=stage(s,owner,id,"hand"),answer=stage(s,other(owner),"ANSWER","hand"),driver=skillMove?stage(s,owner,skillMove==="may"?"MAYDROP":"DROP","battle"):undefined;
 stage(s,other(owner),"ANSWER","hand");
 s=take(s,{type:"attack",player:owner,attacker:leader,target:s.sides[other(owner)].zones.leader[0]});
 while(s.prompt.kind!=="combo")s=pass(s);
 s=take(s,{type:"combo",player:owner,card:combo});
 if(driver){const a=RULES.legalActions(ctx,s).map(x=>x.action).find(x=>x.type==="activate"&&x.card===driver);assert.ok(a);s=take(s,a);}
 for(let i=0;i<20&&s.prompt.kind!=="replaceMove";i++){
  if(s.prompt.kind==="chooseCards")s=take(s,{type:"choose",player:s.prompt.player,cards:[combo]});else s=pass(s);
 }
 assert.equal(s.prompt.kind,"replaceMove");s=take(copy(s),{type:"chooseMode",player:owner,index:0});
 assert.equal(s.resolving?.scopeWindow?.boundary,"before");assert.equal(s.prompt.kind,"counter");assert.ok(s.sides[owner].zones.combo.includes(combo));
 assert.equal(history.filter(e=>e.type==="skill"&&e.card===combo&&e.skill===10).length,1,"replacement Auto activates once");
 return {s,combo,answer};
}
let cases=0;
for(const owner of ["p1","p2"] as const)for(const id of Object.keys(PRINTS))for(const skillMove of [false,true]){
 const initial=ready(owner,id,skillMove); let s=initial.s;const {combo,answer}=initial;
 s=take(copy(s),{type:"counter",player:other(owner),card:answer});
 for(let i=0;i<15&&s.resolving?.scopeWindow?.boundary!=="after";i++){
  if(s.prompt.kind==="chooseCards")s=take(s,{type:"choose",player:s.prompt.player,cards:[combo]});else s=pass(s);
 }
 assert.equal(s.resolving?.scopeWindow?.boundary,"after");assert.ok(s.sides[owner].zones.battle.includes(combo));assert.equal(s.cards[combo].mode,"rest");
 s=advance(copy(s),true).state;assert.ok(s.sides[owner].zones.battle.includes(combo));assert.equal(s.skillPlayScopes,undefined);assert.equal(history.filter(e=>e.type==="skill"&&e.card===combo&&e.skill===10).length,1);cases++;
}
// Staged fault control at a saved Counter window: move the source away.
// This injects the state change rather than resolving a printed Counter. Saved continuation must never
// play the returned occurrence or resume its original Drop against a new one.
for(const owner of ["p1","p2"] as const)for(const reenter of [false,true]){
 const initial=ready(owner,"BT12-071");let s=initial.s;const {combo}=initial;
 assert.ok(moveCard(s,game,combo,"hand",{owner}).ok);
 if(reenter)assert.ok(moveCard(s,game,combo,"combo",{owner}).ok);
 s=advance(copy(s)).state;
 assert.ok(s.sides[owner].zones[reenter?"combo":"hand"].includes(combo));assert.ok(!s.sides[owner].zones.battle.includes(combo));cases++;
}
// Staged typed-effect injection in the response window prevents the substitute, so
// the original Combo-to-Drop event still happens once, after that scope.
for(const owner of ["p1","p2"] as const)for(const skillMove of [false,true]){
 const initial=ready(owner,"BT12-071",skillMove);let s=initial.s;const {combo}=initial;
 assert.equal(stepScript(vmHost(ctx,game,s,[]),{ops:[{op:"forbid",what:"play",side:"opponent",until:"turn"}],ip:0,vars:{},card:s.sides[other(owner)].zones.leader[0],master:other(owner)}),"done");
 s=advance(copy(s)).state;
 assert.ok(s.sides[owner].zones.drop.includes(combo));assert.ok(!s.sides[owner].zones.combo.includes(combo));assert.equal(s.skillPlayScopes,undefined);cases++;
}
for(const owner of ["p1","p2"] as const){
 const {s,combo}=ready(owner,"BT12-071");
 const scope=s.skillPlayScopes!.at(-1)!;
 const frame=copy(scope.window!.programs.find(f=>f.replacementAuto)!);assert.ok(frame);
 const original=skillsShowing(ctx,s,combo).scripts.bySkill[10];
 const legacy=copy(frame);delete legacy.replacementAuto;delete legacy.skillEffectOrigin;
 assert.throws(()=>requireReplacementOrigin(legacy,original),/rebuild.*replacement Auto/);cases++;
 const taxed=copy(s);
 assert.equal(stepScript(vmHost(ctx,game,taxed,[]),{ops:[{op:"forbid",what:"activateSkill",side:"opponent",unlessPay:[{op:"discard",n:1}],until:"turn"}],ip:0,vars:{},card:s.sides[other(owner)].zones.leader[0],master:other(owner)}),"done");
 const before=copy(taxed);
 prepareReplacementAuto(ctx,game,taxed,copy(frame),combo,"drop",{owner});
 assert.deepEqual(copy(taxed),before,"tax preparation does not move or pay before its continuation");cases++;
 const banned=copy(s);
 assert.equal(stepScript(vmHost(ctx,game,banned,[]),{ops:[{op:"forbid",what:"activateSkill",side:"opponent",until:"turn"}],ip:0,vars:{},card:s.sides[other(owner)].zones.leader[0],master:other(owner)}),"done");
 const candidate=copy(frame);delete candidate.skillEffectOrigin;
 prepareReplacementAuto(ctx,game,banned,candidate,combo,"drop",{owner});assert.equal(candidate.replacementAuto?.denied,true);cases++;
}
for(const owner of ["p1","p2"] as const)for(const accept of [false,true])for(const captured of [false,true]){
 const initial=ready(owner,"BT12-071");let s=initial.s;const {combo}=initial;
 const h=vmHost(ctx,game,s,[]), leader=s.sides[other(owner)].zones.leader[0];
 assert.equal(stepScript(h,{ops:[{op:"forbid",what:"play",side:"opponent",until:"turn"},{op:"replaceLeave",from:["combo"],requestedTo:"drop",to:"hand",optional:true,until:"turn",target:captured?{var:"target"}:{sel:{area:"combo",side:"opponent"}}}],ip:0,vars:{target:[combo]},card:leader,master:other(owner)}),"done");
 let offered=false;
 for(let n=0;n<20&&s.prompt.kind!=="main";n++){
  if(s.prompt.kind==="replaceMove"){
   assert.equal(s.prompt.options.length,2,"only the other replacement and original Drop remain");offered=true;
   s=take(copy(s),{type:"chooseMode",player:owner,index:accept?0:1});
  }else if(s.prompt.kind==="chooseCards")s=take(s,{type:"choose",player:s.prompt.player,cards:[combo]});else s=pass(s);
 }
 assert.ok(offered,"failed substitute resumes arbitration");assert.ok(s.sides[owner].zones[accept?"hand":"drop"].includes(combo));cases++;
}
for(const owner of ["p1","p2"] as const)for(const prevent of [false,true]){
 const initial=ready(owner,"BT12-071","may");let s=initial.s;const {combo}=initial;
 const before=s.sides[owner].zones.hand.length;
 if(prevent)assert.equal(stepScript(vmHost(ctx,game,s,[]),{ops:[{op:"forbid",what:"play",side:"opponent",until:"turn"}],ip:0,vars:{},card:s.sides[other(owner)].zones.leader[0],master:other(owner)}),"done");
 s=advance(copy(s)).state;
 assert.equal(s.sides[owner].zones.hand.length,before+(prevent?1:0),"only completed original Drop satisfies parent may action");
 assert.ok(s.sides[owner].zones[prevent?"drop":"battle"].includes(combo));cases++;
}
for(const owner of ["p1","p2"] as const){
 const {s,combo}=ready(owner,"BT12-075");
 const generic={ops:[],ip:0,vars:{},card:combo,master:owner,skillIndex:20};
 const before=copy(generic);prepareReplacementAuto(ctx,game,s,generic,combo,"drop",{owner});
 assert.deepEqual(generic,before,"an already-triggered ordinary Auto is not reactivated by replacement application");cases++;
}
for(const owner of ["p1","p2"] as const){
 const initial=ready(owner,"BT12-071","may");let s=initial.s;const {combo}=initial;
 const source=stage(s,other(owner),"DROP","battle"),h=vmHost(ctx,game,s,[]);
 const redirect:Op={op:"replaceLeave",from:["combo"],requestedTo:"drop",to:"hand",optional:true,until:"turn",target:{var:"target"}};
 const install=()=>stepScript(h,{ops:[redirect],ip:0,vars:{target:[combo]},card:source,master:other(owner)});
 assert.equal(install(),"done");
 const old=replacementChoices(ctx,game,s,combo,"effect",{requestedTo:"drop",actor:owner}).find(c=>c.source===source)!;assert.ok(old.occurrence?.startsWith("timed:"));
 const fallback=s.skillPlayScopes!.at(-1)!.window!.programs.find(f=>f.replacementFallback)!.replacementFallback!;
 fallback.used.push({source,skillIndex:old.skillIndex,occurrence:old.occurrence!});
 assert.ok(moveCard(s,game,source,"hand",{owner:other(owner)}).ok);assert.ok(moveCard(s,game,source,"battle",{owner:other(owner)}).ok);
 assert.equal(install(),"done");
 assert.equal(stepScript(h,{ops:[{op:"forbid",what:"play",side:"opponent",until:"turn"}],ip:0,vars:{},card:source,master:other(owner)}),"done");
 let asked=false;
 for(let n=0;n<20&&s.prompt.kind!=="main";n++){
  if(s.prompt.kind==="replaceMove"){assert.equal(s.prompt.options.length,2,"same installed effect stays used; new effect is eligible");asked=true;s=take(copy(s),{type:"chooseMode",player:owner,index:0});}
  else if(s.prompt.kind==="chooseCards")s=take(s,{type:"choose",player:s.prompt.player,cards:[combo]});else s=pass(s);
 }
 assert.ok(asked);assert.ok(s.sides[owner].zones.hand.includes(combo));cases++;
}
for(const owner of ["p1","p2"] as const){
 const initial=ready(owner,"BT12-071","may");let s=initial.s;const {combo}=initial,before=s.sides[owner].zones.hand.length;
 assert.equal(stepScript(vmHost(ctx,game,s,[]),{ops:[{op:"forbid",what:"play",side:"opponent",until:"turn"},{op:"replaceLeave",from:["combo"],requestedTo:"drop",to:"drop",optional:true,until:"turn",target:{var:"target"}}],ip:0,vars:{target:[combo]},card:s.sides[other(owner)].zones.leader[0],master:other(owner)}),"done");
 s=advance(copy(s)).state;assert.ok(s.sides[owner].zones.drop.includes(combo));assert.equal(s.sides[owner].zones.hand.length,before,"a replacement redirect to Drop is not the original voluntary action");cases++;
}
const optional:Op={op:"replaceLeave",from:["combo"],requestedTo:"drop",to:"hand",optional:true,until:"turn",target:{sel:{area:"combo",side:"opponent"}}};
const parsed=parseRule(`WHEN [Activate: Main]\nTHEN\n${printOps([optional])}`);assert.ok(parsed.ok);
assert.deepEqual(parsed.value.ops,[optional]);assert.equal(validateRule(parsed.value,parsed.value.kind),null);cases++;
console.log(`replacement-auto-5: ${cases} stored/native timing and staged fault controls passed`);
