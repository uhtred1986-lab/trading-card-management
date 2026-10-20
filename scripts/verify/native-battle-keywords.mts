/** Real bare keyword texts from the production catalog; manual 22-8 and 22-9.
 * Unlike compiler-backed harness checks, these use the actual empty stored-row path. */
import assert from "node:assert/strict";
import { CTX, DEFS, fifty } from "./harness.ts";
import { recordsWithPrice } from "./records.ts";
import { RULES } from "../../src/lib/arena/vm/index.ts";
import type { CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types.ts";
import type { VmState } from "../../src/lib/arena/vm/state.ts";

const real: Record<string,CardDef>={
 "BT7-081":{...DEFS.V1,id:"BT7-081",name:"Cabba, Undisguised Rage",type:"BATTLE",power:5000,skill:"[Blocker] <br>[Revenge]"},
 "BT27-093":{...DEFS.V1,id:"BT27-093",name:"SS4 Vegito, Barrage",type:"Z-BATTLE",power:30000,skill:"[Deflect][Triple Attack]"},
};
// `CTX.scripts` is a lazy compiler-backed Proxy: spreading it copies nothing, which left the harness leader without
// its stored record (a keyword line with no typed payment, #1066). Overlay it instead and hide only the real cards,
// so they take the actual empty stored-row path while everything else keeps its compiled records.
const hidden=new Set(Object.keys(real));const own:Record<string,never>={};
const scripts=new Proxy(own as Record<string,never>,{get:(t,k)=>typeof k!=="string"?undefined:k in t?(t as Record<string,never>)[k]:hidden.has(k.split("#")[0])?undefined:CTX.scripts![k]}) as unknown as NonNullable<EngineContext["scripts"]>;
const ctx:EngineContext={...CTX,defs:{...DEFS,...real},scripts};
function atMain():VmState {
 let s=RULES.createGame(ctx,{seed:823,p1:{name:"You",leader:"L-RED",main:fifty("V1")},p2:{name:"Other",leader:"L-BLUE",main:fifty("V-BLUE")}}).state;
 const actions=[{type:"chooseFirst",player:s.chooser,first:"p1"},{type:"mulligan",player:"p1",redraw:false},{type:"mulligan",player:"p2",redraw:false},{type:"charge",player:"p1",card:null},{type:"endMain",player:"p1"},{type:"charge",player:"p2",card:null},{type:"endMain",player:"p2"},{type:"charge",player:"p1",card:null}] as const;
 for(const a of actions)s=RULES.apply(ctx,s,a).state;
 return s;
}
function stage(s:VmState,p:PlayerId,cardId:string):string {
 const id=s.sides[p].zones.deck.shift()!;s.cards[id].cardId=cardId;s.cards[id].mode="active";s.sides[p].zones.battle.push(id);return id;
}
function finish(s:VmState):VmState {
 for(let i=0;i<30 && s.battle && !s.outcome;i++) {
  const legal=RULES.legalActions(ctx,s);
  const next=legal.find(x=>x.action.type==="pass") ?? legal.find(x=>x.action.type==="block" && x.action.card===null);
  assert(next,`Expected a battle pass, got ${JSON.stringify(legal.map(x=>x.action))}`);
  s=RULES.apply(ctx,s,next.action).state;
 }
 assert(!s.outcome,"native keyword must not interrupt");assert(!s.battle);return s;
}
{
 let s=atMain();const attacker=stage(s,"p1","BT27-093");const leader=s.sides.p2.zones.leader[0];
 for(let attack=1;attack<=3;attack++) {
  s=RULES.apply(ctx,JSON.parse(JSON.stringify(s)),{type:"attack",player:"p1",attacker,target:leader}).state;
  assert(!s.outcome,"bare Triple Attack has no missing-record interruption");
  s=finish(s);assert.equal(s.cards[attacker].mode,attack<3?"active":"rest");
 }
}
{
 let s=atMain();const attacker=stage(s,"p1","V1");const guard=stage(s,"p2","BT7-081");s.cards[guard].mode="rest";
 s=RULES.apply(ctx,s,{type:"attack",player:"p1",attacker,target:guard}).state;
 assert(!s.outcome,"bare Revenge has no missing-record interruption");s=finish(JSON.parse(JSON.stringify(s)));
 assert(s.sides.p1.zones.drop.includes(attacker),"Revenge KOs the attacking Battle Card at battle end");
}
// An explicitly unread stored program must not be bypassed by the native path. Since #1071 a blocked record
// has no native keyword hooks (`vm/skill-identity.ts`: "a blocked record cannot become a native hook through its
// displayed tags"), so the displayed [Triple Attack] is inert: one attack rests the attacker, where the native
// path (above) keeps it active until the third.
{
 const scripts=ctx.scripts!;scripts["BT27-093"]={bySkill:{1:{ops:[],unsupported:["unread extension"],...recordsWithPrice()}},complete:false,unsupported:["unread extension"]};
 const s=atMain();const attacker=stage(s,"p1","BT27-093");
 const after=RULES.apply(ctx,s,{type:"attack",player:"p1",attacker,target:s.sides.p2.zones.leader[0]}).state;
 assert(!after.outcome,"an unread record is inert, not a crash");assert.equal(finish(after).cards[attacker].mode,"rest","no Triple Attack from the displayed tag of an unread record");delete scripts["BT27-093"];
}
console.log("native battle keywords: stored-row Triple Attack/Revenge, reload and unread-record inertness passed");
