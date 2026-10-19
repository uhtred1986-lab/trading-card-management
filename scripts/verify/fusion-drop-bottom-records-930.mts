/** Atomic four-record compiler repair: exact snapshots, private preservation, races and replay. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import type { Db } from "../../src/db";
import { rows } from "../../src/db/rows";
import { DROP_BOTTOM_REFERENCE, DROP_BOTTOM_TARGETS, dropBottomCatalog, fusionDropBottomPlan, applyFusionDropBottom, type DropBottomRow } from "../lib/fusion-drop-bottom-930";
const client = new PGlite(), db = drizzle(client) as unknown as Db;
try {
  for (const flags of [
    ["--snapshot", "/tmp/drop-bottom-input-guard.json", "--out", "/tmp/drop-bottom-input-guard.json"],
    ["--snapshot", "/tmp/drop-bottom-input-guard.json", "--private-out", "/tmp/drop-bottom-input-guard.json"],
    ["--out", "/tmp/drop-bottom-output-guard.json", "--private-out", "/tmp/drop-bottom-output-guard.json"],
    ["--snapshot", "/tmp/drop-bottom-input-guard.json", "--apply", "--approved-digest", "0".repeat(64)],
  ]) {
    const env = { ...process.env }; delete env.DATABASE_URL;
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/arena-fusion-drop-bottom-930.mts", ...flags], { env, encoding: "utf8" });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /output must not overwrite|public and private outputs|offline mode never writes/);
  }
  await client.exec(`create table cards(id text primary key,name text,card_type text,colors text[],energy_cost text,z_energy_cost text,power int,combo_cost int,combo_power int,
    skill text,characters text[],traits text[],back_name text,back_power int,back_skill text,specified_cost text);
    create table card_rules(id int primary key,card_id text,side text,skill_index int,printed text,kind text,trigger jsonb,combo jsonb,usage jsonb,validity jsonb,cost jsonb,cond jsonb,ops jsonb,
    status text,source text,unread jsonb,version int,reads text,pattern text,confirmed_at timestamptz,confirmed_by text,confirm_note text,review_flag text,updated_at timestamptz,created_at timestamptz,
    explanation text,compiler_diff jsonb,brief text,probe jsonb,expectations jsonb,times_seen int,last_seen_at timestamptz)`);
  const catalog = dropBottomCatalog();
  for (const c of catalog) {
    const card = { id: c.id, name: c.name, card_type: c.type, colors: c.colors, energy_cost: String(c.energyCost), z_energy_cost: null, power: c.power,
      combo_cost: c.comboCost, combo_power: c.comboPower, skill: c.skill, characters: c.characters, traits: c.traits, back_name: null, back_power: null, back_skill: null, specified_cost: null };
    await db.execute(sql`insert into cards select * from jsonb_populate_record(null::cards,${JSON.stringify(card)}::jsonb)`);
  }
  const originals: DropBottomRow[] = JSON.parse(readFileSync(DROP_BOTTOM_REFERENCE, "utf8")).rows;
  for (const original of originals) {
    const fixture = { ...original, explanation: "synthetic private ruling", confirm_note: "synthetic private note", confirmed_at: null, confirmed_by: null,
      review_flag: null, created_at: "2026-10-18T00:00:00Z", updated_at: "2026-10-19T00:00:00Z", compiler_diff: { private: true }, brief: "synthetic private brief",
      probe: { private: true }, expectations: { private: true }, times_seen: 9, last_seen_at: null };
    await db.execute(sql`insert into card_rules select * from jsonb_populate_record(null::card_rules,${JSON.stringify(fixture)}::jsonb)`);
  }
  const read = async () => rows<{record: DropBottomRow}>(await db.execute(sql`select to_jsonb(r) record from card_rules r order by id`)).map(r => r.record);
  const before = await read(), plan = fusionDropBottomPlan(before);
  assert.ok(!JSON.stringify(plan.preview).includes("synthetic"));
  assert.deepEqual(plan.preview.targets.map(t => [t.id,t.beforeStatus,t.afterStatus]), [[3897,"draft","draft"],[3898,"open","draft"],[9887,"draft","draft"],[9888,"open","draft"]]);
  for (const patch of [{ source: "user" }, { status: "confirmed" }, { version: 99 }, { ops: [{ op: "draw", n: 99 }] }, { review_flag: "pending" }, { usage: {} }])
    assert.throws(() => fusionDropBottomPlan(before.map((r, i) => i === 0 ? { ...r, ...patch } : r)));
  assert.throws(() => fusionDropBottomPlan(before.slice(1)));
  assert.throws(() => fusionDropBottomPlan([before[0],before[0],...before.slice(2)]));
  const missing = before.map(r => ({...r})); delete missing[0].explanation; assert.throws(() => fusionDropBottomPlan(missing));
  await assert.rejects(applyFusionDropBottom(db,before,"0".repeat(64)),/digest mismatch/);
  await db.execute(sql`update card_rules set explanation='concurrent private edit' where id=9888`);
  const edited = await read(); await assert.rejects(applyFusionDropBottom(db,before,plan.digest),/atomic four-row update refused/); assert.deepEqual(await read(),edited);
  await db.execute(sql`update card_rules set explanation='synthetic private ruling' where id=9888`);
  await db.execute(sql`update cards set colors=array['Red'] where id='EX23-36'`);
  await assert.rejects(applyFusionDropBottom(db,before,plan.digest),/catalog engine identity changed/); assert.deepEqual(await read(),before);
  await db.execute(sql`update cards set colors=array['Yellow'] where id='EX23-36'`);
  let calls = 0;
  const race = {execute: async (query: Parameters<Db["execute"]>[0]) => {if (++calls === 2) await db.execute(sql`update cards set traits=array['concurrent source edit'] where id='P-519'`); return db.execute(query);}} as unknown as Db;
  await assert.rejects(applyFusionDropBottom(race,before,plan.digest),/atomic four-row update refused/); assert.deepEqual(await read(),before);
  await db.execute(sql`update cards set traits=${sql.raw(`ARRAY[${catalog.find(c => c.id === "P-519")!.traits.map(t => `'${t.replaceAll("'", "''")}'`).join(",")}]::text[]`)} where id='P-519'`);
  assert.deepEqual(await applyFusionDropBottom(db,before,plan.digest),DROP_BOTTOM_TARGETS.map(t => t.id));
  const after = await read();
  for (const entry of plan.entries) {
    const stored = after.find(r => r.id === entry.before.id)!;
    for (const key of Object.keys(entry.before).filter(k => ![...Object.keys(entry.patch),"version","updated_at"].includes(k))) assert.deepEqual(stored[key],entry.before[key],`${entry.before.id}/${key} preserved`);
    for (const [key,value] of Object.entries(entry.patch)) assert.deepEqual(stored[key],value,`${entry.before.id}/${key} applied`);
    assert.equal(stored.version,Number(entry.before.version)+1);
  }
  await assert.rejects(applyFusionDropBottom(db,before,plan.digest),/atomic four-row update refused/); assert.deepEqual(await read(),after);
  assert.throws(() => fusionDropBottomPlan(after));
  console.log("fusion-drop-bottom-records-930: exact four-row compiler repair, full private preservation, stale/digest/catalog/race/replay refusal PASS (PGlite only)");
} finally { await client.close(); }
