/** Bounded second review: 11 compiler records and one owner-condition metadata repair.
 * Read-only by default (--plan FILE). --apply FILE requires explicit owner authorization.
 * Apply after the matching interpreter is deployed; no broad redraft or confirmation. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { inArray, sql } from "drizzle-orm";
import { db } from "../src/db/index.ts";
import { cards, cardRules } from "../src/db/schema.ts";
import { rows } from "../src/db/rows.ts";
import { cardDefFrom } from "../src/lib/arena/load.ts";
import { canonical, skillRecords } from "../src/lib/arena/draft.ts";
import { runtimeSupportOfRow } from "../src/lib/arena/rules-store.ts";
import { applyReviewedRefresh, repairReviewedCondition, type ReviewedRefresh } from "./lib/reviewed-rule-refresh.ts";

const TARGETS=[
 ["BT28-102","front",10],["BT5-024","front",0],["BT10-091","front",0],
 ["BT5-119","front",0],["BT30-106","front",10],
 ["BT31-001","back",0],["BT29-040","front",0],["BT3-030","front",10],
 ["BT3-109","front",20],["BT6-062","front",10],["SD8-03","front",10],
] as const;
const [mode,file,...extra]=process.argv.slice(2);
assert((mode==="--plan"||mode==="--apply")&&file&&!extra.length,"Usage: --plan FILE | --apply FILE");
assert(process.env.DATABASE_URL,"Explicit app DATABASE_URL required");
assert.equal(rows<{name:string}>(await db.execute(sql`select to_regclass('public.card_rules')::text as name`))[0]?.name,"card_rules");
const ids=[...new Set([...TARGETS.map(t=>t[0]),"SD13-05"])];
const catalog=await db.select().from(cards).where(inArray(cards.id,ids));
const stored=await db.select().from(cardRules).where(inArray(cardRules.cardId,ids));
const raw=rows<{record:Record<string,unknown>}>(await db.execute(sql`select to_jsonb(r) as record from card_rules r where card_id in (${sql.join(ids.map(id=>sql`${id}`),sql`,`)})`)).map(r=>r.record);
const refresh:ReviewedRefresh={rules:[]};
for(const [cardId,side,skillIndex] of TARGETS) {
 const card=catalog.find(c=>c.id===cardId);assert(card);assert.equal(card.game,"dbs");
 const old=stored.find(r=>r.cardId===cardId&&r.side===side&&r.skillIndex===skillIndex);assert(old);
 assert.equal(old.source,"compiler");assert(["open","draft"].includes(old.status));
 const fresh=skillRecords(cardDefFrom(card)).find(r=>r.side===side&&r.skillIndex===skillIndex);assert(fresh);
 assert.equal(fresh.printed,old.printed);assert.deepEqual(fresh.unread,[]);
 assert.deepEqual(runtimeSupportOfRow(fresh).unsupported,[]);
 refresh.rules.push({before:raw.find(r=>r.id===old.id)!,fresh});
}
const owner=stored.find(r=>r.cardId==="SD13-05"&&r.side==="front"&&r.skillIndex===0);assert(owner);
assert.equal(owner.source,"user");assert.equal(owner.status,"corrected");assert.equal(owner.cost,null);assert(owner.cond);
const fresh=skillRecords(cardDefFrom(catalog.find(c=>c.id==="SD13-05")!)).find(r=>r.side==="front"&&r.skillIndex===0)!;
assert.equal(fresh.printed,owner.printed);assert(fresh.cost?.condition);assert.equal(fresh.cost.program,null);
assert.deepEqual(fresh.cost.orbs,{});assert.deepEqual(fresh.cost.either,[]);
const condition={before:raw.find(r=>r.id===owner.id)!,cost:{...fresh.cost,condition:owner.cond}};
const plan={refresh,condition};
if(mode==="--plan") {
 fs.writeFileSync(file,JSON.stringify(plan,null,2),{mode:0o600});fs.chmodSync(file,0o600);
 console.log(JSON.stringify({compilerRules:refresh.rules.map(r=>({card:r.fresh.cardId,side:r.fresh.side,skill:r.fresh.skillIndex,reading:r.fresh.reads})),ownerConditionOnly:"SD13-05/front/0",write:false},null,2));
} else {
 assert.deepEqual(canonical(JSON.parse(fs.readFileSync(file,"utf8"))),canonical(plan),"Review changed; regenerate and review before applying");
 const written=await applyReviewedRefresh(db,refresh);
 // Each write is compare-and-swap protected. If this separate repair races,
 // the compiler receipt is retained and the owner row remains untouched.
 console.log(JSON.stringify({compilerRulesWritten:written}));
 await repairReviewedCondition(db,condition.before,condition.cost);
 console.log(JSON.stringify({ownerConditionRepaired:owner.id,ownerProgramPreserved:true}));
}
process.exit(0);
