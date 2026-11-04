/** R-386: stored Awaken payment alternatives retain their own complete conditions. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { condHolds } from "../../src/lib/arena/vm/program";
import { runtimeSupportOfRow } from "../../src/lib/arena/rules-store";
import { allConditions } from "../../src/lib/arena/compile/conditions";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { type ScriptFrame } from "../../src/lib/arena/vm/script";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const PRINTS = {
  "BT19-002": "[Awaken] When your life is at 4 or less, or you have 2 or more energy and 1 or more <Android 14> and <Android 15> cards—both red and with an energy cost of 1—in your Battle Area and/or Drop: You may switch this card and up to 1 of your energy to Active Mode, and add cards from your life to your hand until you have 6 life left.",
  "BT19-068": "[Awaken] When your life is at 4 or less or you have 2 or more energy and there are 5 or more Extras under this card: You may draw 1 card and switch up to 1 of your energy to Active Mode.",
  "BT22-054": "[Awaken] When your life is at 4 or less or you have 2 or more energy and you have a {Family Kamehameha, Emotions Delivered} in your Battle Area: Draw 2 cards and add cards from your life to your hand until you have 6 life left.",
  "P-434": "[Awaken] When your life is at 4 or less or 2 or more ≪Villainous≫ cards are in your energy: You may draw 2 cards, and add cards from your life to your hand until you have 6 life left.",
  "SD23-01": "[awaken] When your life is at 4 or less or you have 2 or more energy and you have a black <Mai : Future> Z-Battle Card in play: Draw 1 card, switch up to 1 of your energy to Active Mode, then add cards from your life to your  hand until you have 6 life left.",

  "BT19-100": "[Awaken] When your life is at 2 or less, or your opponent has 2 or more energy and 2 or more ≪Slug's Army≫ cards are in your Z-Energy: You may draw 2 cards, switch up to 1 of your energy to Active Mode, and add the top card of your deck to your life.",
  "BT20-055": "[Awaken] When your life is at 4 or less, or when you have 2 or more energy while 1 or more <Android 17> and <Hell Fighter 17> cards are in your Z-Energy and Battle Area: Draw 2 cards and add cards from your life to your hand until you have 6 life left.",
  "BT20-114": "[Awaken] When your life is at 4 or less, or when you have 2 or more energy while you have a <Fu> Z-Battle Card in play: Draw 1 card, switch up to 1 of your energy to Active Mode, and add cards from your life to your hand until you have 6 life left.",
  "BT29-029": "[awaken] When your life is at5 or less: Draw 2 cards.",
  "BT17-001": "[Awaken] When your life is at 4 or less or one of your Unison Cards has 7 or more markers on it: You may draw 2 cards, then add cards from your life to your hand until you have 6 life left and flip this card over.",
  "BT26-031": "[Awaken] When your life is at 4 or less, or when you have 3 or more Z-Energy: Draw 2 cards and add cards from your life to your hand until you have 6 life left.",
  "BT10-031": "[Awaken] When your life or your opponent's life is at 4 or less: You may draw 1 card, then switch up to 1 of your energy to Active Mode and flip this card over.",
  "BT20-054": "[Awaken] When your life is at 4 or less, or when you have 2 or more energy while there are 2 or more <Son Goku: GT> cards in your Warp: Draw 1 card, switch up to 1 of your energy to Active Mode, and add cards from your life to your hand until you have 6 life left.",
  "BT14-121": "[Awaken] When your life is at 4 or less or 7 or more black ≪Shadow Dragon≫ cards are in your Drop Area: You may draw 1 card, switch up to 1 of your energy to Active Mode, and flip this card over."
};
const defs:Record<string,CardDef>={
 CB4_LEADER:card("CB4_LEADER",{type:"LEADER"}), CB4_FILLER:card("CB4_FILLER",{}),
 ...Object.fromEntries(Object.entries(PRINTS).map(([id,skill])=>[id,card(id,{type:"LEADER",skill,back:{name:id+" awakened",power:15000,skill:null}})])),
 A14:card("A14",{characters:["Android 14"],colors:["Red"],energyCost:1}), A15:card("A15",{characters:["Android 15"],colors:["Red"],energyCost:1}),
 A15_BLUE:card("A15_BLUE",{characters:["Android 15"],colors:["Blue"],energyCost:1}), A14_HIGH:card("A14_HIGH",{characters:["Android 14"],colors:["Red"],energyCost:2}),
 FU:card("FU",{type:"Z-BATTLE",zEnergyCost:1,characters:["Fu"]}),
 NONZ:card("NONZ",{characters:["Fu"]}),
 GOKU:card("GOKU",{characters:["Son Goku: GT"]}),
 A17:card("A17",{characters:["Android 17"]}), H17:card("H17",{characters:["Hell Fighter 17"]}),
 SLUG:card("SLUG",{traits:["Slug's Army"]}), SHADOW:card("SHADOW",{colors:["Black"],traits:["Shadow Dragon"]}),
 WRONG:card("WRONG",{colors:["Red"],traits:["Shadow Dragon"]}), UNISON:card("UNISON",{type:"UNISON"}),
};
const records = Object.values(defs).flatMap(d => skillRecords(d));
assert.deepEqual(records.flatMap(r => r.unread), []);
for(const r of records){assert.equal(r.cost?.readable,true,r.cardId);assert.deepEqual(runtimeSupportOfRow(r).unsupported,[],r.cardId);}
assert.equal(allConditions("When your life is at 4 or less or when you have or more Z-Energy"),null,"missing bound remains unread");
const ctx: EngineContext = { defs, scripts: rulesFromRows(copy(records.map((r, id) => ({ ...r, id, source: "compiler", status: "draft" }) as unknown as RuleRow)), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const other = (p: PlayerId): PlayerId => p === "p1" ? "p2" : "p1";
const take = (s: VmState, a: Action) => RULES.apply(ctx, copy(s), a).state as VmState;
function fresh(first: PlayerId): VmState {
  let s = RULES.createGame(ctx, { seed: 404, p1: { name: "First", leader: "CB4_LEADER", main: fifty("CB4_FILLER") }, p2: { name: "Second", leader: "CB4_LEADER", main: fifty("CB4_FILLER") } }).state as VmState;
  for (const a of [{ type: "chooseFirst", player: s.chooser, first }, { type: "mulligan", player: first, redraw: false }, { type: "mulligan", player: other(first), redraw: false }, { type: "charge", player: first, card: null }] as Action[]) s = take(s, a);
  return s;
}
function stage(s: VmState, owner: PlayerId, def: string, area: string): string {
  const id = s.sides[owner].zones.deck.at(-1)!; s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner }).ok); s.pending = []; return id;
}
function setLife(s:VmState,p:PlayerId,n:number){while(s.sides[p].zones.life.length>n)assert.ok(moveCard(s,game,s.sides[p].zones.life.at(-1)!,"drop",{owner:p}).ok);}
let cases=0;
for(const owner of ["p1","p2"] as const)for(const id of Object.keys(PRINTS))for(const variant of ["life","alternate","missing","area","side","energy","color","cost"]){
 if(["color","cost"].includes(variant)&&id!=="BT19-002")continue;
 if(["BT19-068","BT22-054","P-434","SD23-01"].includes(id)&&!["life","missing"].includes(variant))continue;
 if(variant==="energy"&&!["BT19-100","BT20-114","BT20-054","BT20-055","BT19-002"].includes(id))continue;
 let s=fresh(owner);const foe=other(owner),leader=s.sides[owner].zones.leader[0];s.cards[leader].cardId=id;
 const threshold=id==="BT19-100"?2:id==="BT29-029"?5:4;
 if(variant==="life")setLife(s,owner,threshold);
 if(variant!=="life"){
  const p=variant==="side"?foe:owner;
  const area=(a:string)=>variant==="area"?"hand":a;
  const n=variant==="missing"?1:2;
  if(["BT20-114","BT20-054","BT20-055","BT19-002"].includes(id))for(let i=0;i<(variant==="energy"?1:2);i++)stage(s,p,"CB4_FILLER","energy");
  if(id==="BT20-114")stage(s,p,variant==="missing"?"NONZ":"FU",area("battle"));
  if(id==="BT20-054")for(let i=0;i<n;i++)stage(s,p,"GOKU",area("warp"));
  if(id==="BT19-002"){stage(s,p,variant==="cost"?"A14_HIGH":"A14",area("battle"));if(variant!=="missing")stage(s,p,variant==="color"?"A15_BLUE":"A15",area("drop"));}
  if(id==="BT20-055"){stage(s,p,"A17",area("battle"));if(variant!=="missing")stage(s,p,"H17",area("zEnergy"));}
  if(id==="BT19-100"){for(let i=0;i<(variant==="energy"?1:2);i++)stage(s,variant==="side"?owner:foe,"CB4_FILLER","energy");for(let i=0;i<n;i++)stage(s,p,"SLUG",area("zEnergy"));}
  if(id==="BT17-001"){const u=stage(s,p,"UNISON",area("unison"));s.cards[u].markers=variant==="missing"?6:7;}
  if(id==="BT14-121")for(let i=0;i<7;i++)stage(s,p,variant==="missing"&&i===6?"WRONG":"SHADOW",area("drop"));
  if(id==="BT26-031")for(let i=0;i<(variant==="missing"?2:3);i++)stage(s,p,"CB4_FILLER",area("zEnergy"));
  if(id==="BT10-031"&&variant==="alternate")setLife(s,foe,4);
 }
 const expected=variant==="life"||(variant==="alternate"&&id!=="BT29-029");
 const f:ScriptFrame={card:leader,master:owner,ops:[],ip:0,vars:{}};
 assert.equal(condHolds(ctx,game,s,f,ctx.scripts![id].bySkill[0].price!.condition!),expected,`${id} ${variant} stored condition`);
 const offer=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===leader);
 assert.equal(!!offer,expected,`${id} ${variant} native offer`);
 if(offer){
  const handBefore=s.sides[owner].zones.hand.length,lifeBefore=s.sides[owner].zones.life.length;
  s=take(s,offer);
  for(let i=0;i<20&&s.prompt.kind!=="main";i++){
   const opts=RULES.legalActions(ctx,s).map(x=>x.action);const pick=opts.find(a=>a.type==="counter"&&a.card===null)??opts.find(a=>a.type==="choose")??opts[0];assert.ok(pick,JSON.stringify(s.prompt));s=take(s,pick);
  }
  assert.equal(s.cards[leader].flipped,true,`${id} ${variant} resolves native Awaken`);
  const draws=id==="BT19-002"?0:["BT19-100","BT20-055","BT29-029","BT17-001","BT26-031","BT22-054","P-434"].includes(id)?2:1;
  const toSix=["BT20-055","BT20-114","BT17-001","BT20-054","BT26-031","BT22-054","P-434","SD23-01","BT19-002"].includes(id);
  assert.equal(s.sides[owner].zones.hand.length,handBefore+draws+(toSix?Math.max(0,lifeBefore-6):0),`${id} resolves printed draw and life adjustment`);
  assert.equal(s.sides[owner].zones.life.length,id==="BT19-100"?lifeBefore+1:toSix?Math.min(6,lifeBefore):lifeBefore);

 }
 cases++;
}
console.log(`awaken conditions 5: ${cases} stored-payment, native offers and resolution scenarios passed`);
