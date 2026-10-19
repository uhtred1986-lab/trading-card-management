import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import type { Db } from "../../src/db/index.ts";
import type { SkillRecord } from "../../src/lib/arena/draft.ts";
import { rows } from "../../src/db/rows.ts";
import { applyReviewedRefresh, applyReviewedUnreadRefresh, repairReviewedCondition, type ReviewedRefresh } from "../lib/reviewed-rule-refresh.ts";

const client=new PGlite();
const db=drizzle(client) as unknown as Db;
await client.exec(`create table cards(id text primary key, skill text);
 create table card_rules(id int primary key, card_id text, side text, skill_index int,
 printed text, kind text, trigger jsonb, cost jsonb, cond jsonb, ops jsonb,
 status text, source text, unread jsonb, pattern text, reads text, version int,
 updated_at timestamptz, explanation text);
 ${fs.readFileSync("drizzle/0058_same_shen.sql","utf8")}
 insert into cards values ('test','old catalog');
 insert into card_rules values (1,'test','front',0,'old','auto','[]',null,null,'[]',
 'draft','compiler','[]',null,'old',1,now(),'keep review',null),
 (2,'test','back',0,'owner','auto','[]',null,null,'[]',
 'corrected','user','[]',null,'owner',7,now(),'keep owner',null);`);
const snapshot=()=>db.execute(sql`select to_jsonb(r) as record from card_rules r order by id`)
  .then(v=>rows<{record:Record<string,unknown>}>(v).map(r=>r.record));
const original=await snapshot();
const plan: ReviewedRefresh={catalog:{id:"test",before:"old catalog",after:"new catalog"},rules:[{
 before:original[0],fresh:{cardId:"test",side:"front",skillIndex:0,printed:"new",kind:"auto",
 trigger:["comboUsed"],combo:{version:1,timing:"entry",subject:"self",origins:null,turn:"controller"},cost:null,cond:null,ops:[{op:"draw",n:1}],unread:[],pattern:null,reads:"draw 1"},
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
assert.deepEqual(after[0].combo,plan.rules[0].fresh.combo,"guarded writer persists typed qualification exactly");
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
// Unread refresh: compiler-owned open/draft rows whose fresh compile still leaves text unread.
await client.exec(`insert into card_rules values
 (3,'test','front',1,'p3','auto','[]',null,null,'[]','open','compiler','[]',null,'old3',1,now(),'keep3',null),
 (4,'test','front',2,'p4','auto','[]',null,null,'[]','draft','compiler','["x"]',null,'old4',1,now(),'keep4',null)`);
const unreadFresh=(skillIndex:number,unread:string[]):SkillRecord=>({cardId:"test",side:"front",skillIndex,printed:`p${skillIndex+2}`,kind:"auto",
 trigger:["onPlay"],combo:null,cost:null,cond:null,ops:[{op:"draw",n:2}],unread,pattern:"pat",reads:"draw 2"});
const snap2=await snapshot();
const row=(id:number)=>snap2.find(r=>r.id===id)!;
const good=[{before:row(3),fresh:unreadFresh(1,["gain 3 energy"])},{before:row(4),fresh:unreadFresh(2,["y"])}];
// Stale row aborts the whole batch.
await db.execute(sql`update card_rules set explanation='edited' where id=4`);
await assert.rejects(applyReviewedUnreadRefresh(db,{rules:good}),/stale/);
assert.equal((await snapshot()).find(r=>r.id===3)!.reads,"old3","nothing written when one target is stale");
await db.execute(sql`update card_rules set explanation='keep4' where id=4`);
// An owned row is refused.
const ownedRow=(await snapshot()).find(r=>r.id===2)!;
await assert.rejects(applyReviewedUnreadRefresh(db,{rules:[{before:ownedRow,fresh:{...unreadFresh(0,["z"]),side:"back" as const}}]}),/not an open\/draft compiler row/);
assert.deepEqual((await snapshot()).find(r=>r.id===2),ownedRow);
// A clean record (unread=[]) is refused before any SQL, even with an eligible target.
await assert.rejects(applyReviewedUnreadRefresh(db,{rules:[{before:row(3),fresh:unreadFresh(1,[])}]}),/still leave text unread/);
assert.equal((await snapshot()).find(r=>r.id===3)!.reads,"old3");
// Happy path: both rows swapped, status open, version bumped, explanation kept.
assert.deepEqual(await applyReviewedUnreadRefresh(db,{rules:good}),[3,4]);
const done=await snapshot();
for(const id of [3,4]){const r=done.find(x=>x.id===id)!;
  assert.equal(r.status,"open"); assert.equal(r.version,2); assert.equal(r.reads,"draw 2");
  assert.deepEqual(r.trigger,["onPlay"]); assert.deepEqual(r.ops,[{op:"draw",n:2}]);}
assert.deepEqual(done.find(r=>r.id===3)!.unread,["gain 3 energy"]);
assert.equal(done.find(r=>r.id===3)!.explanation,"keep3");
assert.deepEqual(done.find(r=>r.id===2),ownedRow,"owned row untouched");
await assert.rejects(applyReviewedUnreadRefresh(db,{rules:good}),/stale/,"repeat apply refused");
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
