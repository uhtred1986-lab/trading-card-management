import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import type { Db } from "../../src/db/index.ts";
import { rows } from "../../src/db/rows.ts";
import { applyReviewedRefresh, repairReviewedCondition, type ReviewedRefresh } from "../lib/reviewed-rule-refresh.ts";

const client=new PGlite();
const db=drizzle(client) as unknown as Db;
await client.exec(`create table cards(id text primary key, skill text);
 create table card_rules(id int primary key, card_id text, side text, skill_index int,
 printed text, kind text, trigger jsonb, cost jsonb, cond jsonb, ops jsonb,
 status text, source text, unread jsonb, pattern text, reads text, version int,
 updated_at timestamptz, explanation text);
 insert into cards values ('test','old catalog');
 insert into card_rules values (1,'test','front',0,'old','auto','[]',null,null,'[]',
 'draft','compiler','[]',null,'old',1,now(),'keep review'),
 (2,'test','back',0,'owner','auto','[]',null,null,'[]',
 'corrected','user','[]',null,'owner',7,now(),'keep owner');`);
const snapshot=()=>db.execute(sql`select to_jsonb(r) as record from card_rules r order by id`)
  .then(v=>rows<{record:Record<string,unknown>}>(v).map(r=>r.record));
const original=await snapshot();
const plan: ReviewedRefresh={catalog:{id:"test",before:"old catalog",after:"new catalog"},rules:[{
 before:original[0],fresh:{cardId:"test",side:"front",skillIndex:0,printed:"new",kind:"auto",
 trigger:[],cost:null,cond:null,ops:[{op:"draw",n:1}],unread:[],pattern:null,reads:"draw 1"},
}]};
// A stale owner edit refuses both catalog and rule writes, even if version stayed equal.
await db.execute(sql`update card_rules set explanation='new review' where id=1`);
await assert.rejects(applyReviewedRefresh(db,plan),/stale/);
assert.equal(rows<{skill:string}>(await db.execute(sql`select skill from cards`))[0].skill,"old catalog");
assert.equal((await snapshot())[0].reads,"old");
await db.execute(sql`update card_rules set explanation='keep review' where id=1`);
// A concurrently changed catalog also refuses all rule writes.
await db.execute(sql`update cards set skill='new owner catalog'`);
await assert.rejects(applyReviewedRefresh(db,plan),/stale/);
assert.equal((await snapshot())[0].reads,"old");
await db.execute(sql`update cards set skill='old catalog'`);
assert.deepEqual(await applyReviewedRefresh(db,plan),[1]);
const after=await snapshot();
assert.deepEqual(after[1],original[1],"the corrected reverse face is untouched");
assert.equal(after[0].version,2); assert.equal(after[0].reads,"draw 1");
assert.equal(after[0].cost,null); assert.equal(after[0].explanation,"keep review");
assert.equal(rows<{skill:string}>(await db.execute(sql`select skill from cards`))[0].skill,"new catalog");
await assert.rejects(applyReviewedRefresh(db,plan),/stale/,"a repeated apply cannot overwrite the new revision");
// A metadata-only owner repair cannot replace their program or accept a stale snapshot.
await db.execute(sql`update card_rules set cond='{"kind":"life","side":"you","atMost":4}'::jsonb where id=2`);
const owner=(await snapshot())[1];
const cost={condition:owner.cond,orbs:{},either:[],program:null};
await repairReviewedCondition(db,owner,cost);
const repaired=(await snapshot())[1];
for(const key of Object.keys(owner).filter(k=>!["cost","version","updated_at"].includes(k)))
  assert.deepEqual(repaired[key],owner[key],`owner ${key} preserved`);
assert.deepEqual(repaired.cost,cost);
await assert.rejects(repairReviewedCondition(db,owner,cost),/changed/);
// Readable compiler-owned open records can be refreshed without any catalog writer.
await db.execute(sql`update card_rules set status='open' where id=1`);
const open=(await snapshot())[0];
assert.deepEqual(await applyReviewedRefresh(db,{rules:[{before:open,fresh:plan.rules[0].fresh}]}),[1]);
assert.equal((await snapshot())[0].status,"draft");
// Printed-cost migration fills only the missing named card and is repeatable.
await client.exec("alter table cards add specified_cost text; insert into cards values ('SD13-02',null,null),('BT31-087',null,null)");
const migration=fs.readFileSync("drizzle/0051_verified_unison_specified_costs.sql","utf8");
await client.exec(migration);
assert.equal(rows<{cost:string}>(await db.execute(sql`select specified_cost as cost from cards where id='SD13-02'`))[0].cost,"{g}{g}");
await db.execute(sql`update cards set specified_cost='owner value' where id='SD13-02'`);
await client.exec(migration);
assert.equal(rows<{cost:string}>(await db.execute(sql`select specified_cost as cost from cards where id='SD13-02'`))[0].cost,"owner value");
assert.equal(rows<{cost:string}>(await db.execute(sql`select specified_cost as cost from cards where id='BT31-087'`))[0].cost,"{k}");
await client.close();
console.log("reviewed-rule-refresh: atomic stale-row/catalog refusal, owner-face preservation and repeat refusal passed");
