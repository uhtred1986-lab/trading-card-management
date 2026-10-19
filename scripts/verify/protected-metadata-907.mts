/** #907: atomic owner-metadata migration cannot alter any corrected program. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import type { Db } from "../../src/db";
import { rows } from "../../src/db/rows";
import { protectedMetadataPlan, applyProtectedMetadata, PROTECTED_KEYS } from "../lib/protected-metadata-907";
const client=new PGlite(), db=drizzle(client) as unknown as Db;
await client.exec(`create table card_rules(id int primary key,card_id text,side text,skill_index int,
 printed text,kind text,trigger jsonb,combo jsonb,usage jsonb,validity jsonb,cost jsonb,cond jsonb,ops jsonb,
 status text,source text,unread jsonb,version int,reads text,pattern text,confirmed_at timestamptz,confirmed_by text,
 confirm_note text,review_flag text,updated_at timestamptz,explanation text)`);
const frozen: Record<string,unknown>[]=JSON.parse(readFileSync("docs/arena-backlog/evidence/897/selected-pair-inputs-2026-10-19/stored-rules.json","utf8"));
const selected=frozen.filter(r=>PROTECTED_KEYS.includes(`${r.card_id}/${r.side}/${r.skill_index}`)).map(r=>({...r,updated_at:"2026-10-19T00:00:00Z",explanation:"owner note kept",usage:null,validity:null,combo:null}));
await db.execute(sql`insert into card_rules select * from jsonb_populate_recordset(null::card_rules,${JSON.stringify(selected)}::jsonb)`);
const snapshot=async()=>rows<{record:Record<string,unknown>}>(await db.execute(sql`select to_jsonb(r) record from card_rules r order by id`)).map(r=>r.record);
const before=await snapshot(), plan=protectedMetadataPlan(before);
assert.equal(plan.rules.length,4);
const malformed=structuredClone(before); malformed[0].source="compiler";
assert.throws(()=>protectedMetadataPlan(malformed),/user/);
const edited=structuredClone(before); edited[0].ops=[{op:"draw",n:99}];
assert.throws(()=>protectedMetadataPlan(edited),/program changed/);
const authored=structuredClone(before); authored[0].usage={version:1,oncePerTurn:true,limit:2};
assert.throws(()=>protectedMetadataPlan(authored),/authored usage/);
const unreadable=structuredClone(before); const paid=unreadable.find(r=>r.cost!==null)!; paid.cost={...(paid.cost as object),readable:false};
assert.throws(()=>protectedMetadataPlan(unreadable),/unreadable payment/);
await assert.rejects(applyProtectedMetadata(db,before,"0".repeat(64)),/approval is stale/);
// A concurrent owner note alone invalidates the full raw snapshot, atomically.
await db.execute(sql`update card_rules set explanation='changed while reviewed' where id=${Number(before[3].id)}`);
const changed=await snapshot();
await assert.rejects(applyProtectedMetadata(db,before,plan.digest),/reviewed rows changed/);
assert.deepEqual(await snapshot(),changed,"stale fourth row prevents every metadata write");
await db.execute(sql`update card_rules set explanation='owner note kept' where id=${Number(before[3].id)}`);
assert.deepEqual(await snapshot(),before);
assert.equal((await applyProtectedMetadata(db,before,plan.digest)).length,4);
const after=await snapshot();
for(let i=0;i<before.length;i++){
 for(const key of Object.keys(before[i]).filter(k=>!["usage","validity","cost","version","updated_at"].includes(k)))assert.deepEqual(after[i][key],before[i][key],`${before[i].id}: ${key} unchanged`);
 assert.equal(after[i].version,Number(before[i].version)+1);
 const oldCost=(before[i].cost??{}) as Record<string,unknown>, newCost=after[i].cost as Record<string,unknown>;
 for(const [k,v] of Object.entries(oldCost))assert.deepEqual(newCost[k],v,"payment program/condition and every existing cost field unchanged");
}
assert.equal(protectedMetadataPlan(after).rules.length,0,"already-current migration is a no-op");
await assert.rejects(applyProtectedMetadata(db,before,plan.digest),/reviewed rows changed/);
assert.deepEqual(await snapshot(),after,"replayed stale apply cannot increment versions again");
await client.close();
console.log("protected-metadata-907: four existing corrections preserved; wrong digest, authored override, stale full-row and replay writes refused atomically");
