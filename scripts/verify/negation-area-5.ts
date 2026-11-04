/** R423: typed all-area protection, original-area entry checks and actor qualifiers. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { recordContractGaps, rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { validateRule } from "../../src/lib/arena/lang/validate";
import { parseRule } from "../../src/lib/arena/lang/parse";
import { printRule } from "../../src/lib/arena/lang/print";
import type { Rule } from "../../src/lib/arena/lang/ast";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { resolvePlay } from "../../src/lib/arena/vm/play";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const copy = <T,>(v:T):T => JSON.parse(JSON.stringify(v));
// Exact printed protection lines. Other lines are irrelevant to this movement checkpoint.
const defs:Record<string,CardDef> = {
 NA_LEADER:card("NA_LEADER",{type:"LEADER"}), NA_FILLER:card("NA_FILLER",{}),
 NA_GARLIC:card("NA_GARLIC",{characters:["Garlic Jr."],colors:["Red"]}),
 NA_BLUE_GARLIC:card("NA_BLUE_GARLIC",{characters:["Garlic Jr."],colors:["Blue"]}),
 "BT14-085":card("BT14-085",{skill:"[Permanent] This card's skills can't be negated in any area."}),
 "DB1-021":card("DB1-021",{skill:"[Permanent] This card's skills can't be negated in any area by your opponent's skills."}),
 "P-641":card("P-641",{skill:"[Permanent] Skills on this card in any area can't be negated by the skills of your red <Garlic Jr.> cards."}),
 NA_BATTLE:card("NA_BATTLE",{skill:"[Permanent] This card's skills can't be negated."}),
};
const records=Object.values(defs).flatMap(skillRecords);
assert.deepEqual(records.flatMap(r=>r.unread),[]);
const rows=copy(records.map((r,id)=>({...r,id,source:"compiler",status:"draft"}) as unknown as RuleRow));
for(const row of rows){
 assert.deepEqual(recordContractGaps(row),[]);
 const rule=copy({kind:row.kind,trigger:row.trigger,cost:row.cost,usage:row.usage,validity:row.validity,cond:row.cond,ops:row.ops}) as Rule;
 assert.equal(validateRule(rule,row.kind),null);const parsed=parseRule(printRule(rule));assert.ok(parsed.ok);assert.deepEqual(parsed.value,rule);
}
const ctx:EngineContext={defs,scripts:rulesFromRows(rows,defs)};
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
const take=(s:VmState,a:Action)=>copy(RULES.apply(ctx,copy(s),a).state as VmState);
function fresh(first:PlayerId):VmState{
 let s=RULES.createGame(ctx,{seed:423,p1:{name:"A",leader:"NA_LEADER",main:fifty("NA_FILLER")},p2:{name:"B",leader:"NA_LEADER",main:fifty("NA_FILLER")}}).state as VmState;
 for(const a of [{type:"chooseFirst",player:s.chooser,first},{type:"mulligan",player:first,redraw:false},{type:"mulligan",player:other(first),redraw:false},{type:"charge",player:first,card:null}] as Action[])s=take(s,a);
 return s;
}
function stage(s:VmState,p:PlayerId,def:string,area:string):string{
 const id=s.sides[p].zones.deck.at(-1)!;s.cards[id].cardId=def;assert.ok(moveCard(s,game,id,area,{owner:p}).ok);return id;
}
let cases=0;
for(const owner of ["p1","p2"] as const)for(const partial of [false,true])for(const actor of [owner,other(owner)]){
 for(const [targetDef,expected] of [["BT14-085",false],["DB1-021",actor===owner],["NA_BATTLE",true]] as const){
  const s=fresh(owner),source=stage(s,actor,"NA_FILLER","battle"),target=stage(s,owner,targetDef,"hand");
  const opts=partial?{negatedKinds:["auto","permanent","activate"] as ("auto"|"permanent"|"activate")[],negatedUntil:"turn" as const}:{negated:"turn" as const};
  assert.ok(resolvePlay(ctx,game,s,[],target,owner,{...opts,negatedBy:{player:actor,source}}));
  assert.equal(s.effects.some(e=>e.target===target&&(e.kind==="negateSkills"||e.kind==="negateSkillKind")),expected,`${owner}/${actor}/${targetDef}/${partial}`);cases++;
 }
 for(const sourceDef of ["NA_GARLIC","NA_BLUE_GARLIC","NA_FILLER"]){
  const s=fresh(owner),source=stage(s,actor,sourceDef,"battle"),target=stage(s,owner,"P-641","hand");
  const opts=partial?{negatedKinds:["auto"] as "auto"[],negatedUntil:"turn" as const}:{negated:"turn" as const};
  assert.ok(resolvePlay(ctx,game,s,[],target,owner,{...opts,negatedBy:{player:actor,source}}));
  assert.equal(s.effects.some(e=>e.target===target&&(e.kind==="negateSkills"||e.kind==="negateSkillKind")),actor!==owner||sourceDef!=="NA_GARLIC");cases++;
 }
}
for(const status of ["draft","confirmed"] as const){
 const row=copy(rows.find(r=>r.cardId==="BT14-085")!);row.status=status;
 for(const op of row.ops as {fromArea?:string}[])delete op.fromArea;
 assert.ok(recordContractGaps(row).some(g=>g.includes("negation-protection")));
 assert.ok(rulesFromRows([row],defs)[row.cardId].bySkill[row.skillIndex].unsupported.some(g=>g.includes("negation-protection")));cases++;
}
const original=skillRecords(card("P-474",{skill:"[Permanent] This card's original skills can't be negated in any area."}))[0];
assert.ok(original.unread.length);assert.deepEqual(original.ops,[],"original-only scope is not widened to acquired skills");
const onlySkill=skillRecords(card("DB3-028",{skill:"[Permanent] This skill can't be negated in any area."}))[0];
assert.ok(onlySkill.unread.length);assert.deepEqual(onlySkill.ops,[]);cases+=2;
console.log(`negation-area-5: ${cases} stored protection and native entry checks passed`);
