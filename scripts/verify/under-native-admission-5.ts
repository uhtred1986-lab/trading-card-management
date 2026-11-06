/** R528 complete descriptor admission across review statuses; no compiler change. */
import assert from "node:assert/strict";
import fixture from "./fixtures/under-standing-observer-5.json";
import before from "./fixtures/under-native-loader-before-5.json";
import { card } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, runtimeSupportOfRow, type RuleRow } from "../../src/lib/arena/rules-store";
import { nativeUnderDefinitions } from "../../src/lib/arena/vm/under-native-policy";
import { NotYet } from "../../src/lib/arena/vm/errors";
import { parseRule, printRule, type Rule } from "../../src/lib/arena/lang";
const c=fixture["BT23-070"].card,def=card(c.id,{...c,type:"EXTRA",colors:["Blue"],energyCost:Number(c.cost)}),defs={[def.id]:def};
const records=skillRecords(def),original=records.find(row=>row.skillIndex===0)!;
const clone=<T,>(value:T):T=>JSON.parse(JSON.stringify(value));
assert.deepEqual(clone(records),before.records);
const alterations:Record<string,(row:typeof original)=>void>={
    missingBan:row=>{row.ops.pop();}, extraOperation:row=>{row.ops.push({op:"draw",n:1});},
    price:row=>{row.cost!.text="1";}, marker:row=>{row.cost!.marker=1;},
    usage:row=>{row.usage.oncePerTurn=true;}, validity:row=>{row.validity.sparking=1;},
    trigger:row=>{row.trigger=["played"];}, condition:row=>{row.cond={kind:"count",sel:{side:"you",area:"combo"},atLeast:1};},
    unread:row=>{row.unread.push("another unresolved clause");},
    qualifiedPrinted:row=>{row.printed=row.printed.replace(/permanent/i,"Permanent][Once per turn");},
};
let cases=0;
for(const status of ["draft","confirmed","corrected","open"] as const){
    const loaded=rulesFromRows(records.map((row,id)=>({...row,id,source:"compiler",status:row.skillIndex===0?status:"open"}) as RuleRow),defs);
    if(status==="open")assert.throws(()=>nativeUnderDefinitions({defs,scripts:loaded},def.id,"front"),NotYet);
    else assert.equal(nativeUnderDefinitions({defs,scripts:loaded},def.id,"front").length,1);
    cases++;
    for(const [label,alter] of Object.entries(alterations)){
        const near=clone(original);alter(near);assert.ok(runtimeSupportOfRow(near).unsupported.length,`${status} ${label}`);
        const scripts=rulesFromRows([{...near,id:0,source:"compiler",status} as RuleRow],defs);
        assert.throws(()=>nativeUnderDefinitions({defs,scripts},def.id,"front"),NotYet,`${status} ${label} cannot become native authority`);cases++;
    }
}
const rule=clone({kind:original.kind,trigger:original.trigger,cost:original.cost,usage:original.usage,validity:original.validity,cond:original.cond,ops:original.ops}) as Rule;
const parsed=parseRule(printRule(rule));assert.ok(parsed.ok);assert.equal(printRule(parsed.value),printRule(rule));
assert.deepEqual(runtimeSupportOfRow({...original,...parsed.value}).unsupported,[]);cases++;
console.log(`under-native-admission-5: ${cases} exact loader/near-miss cases PASS`);
