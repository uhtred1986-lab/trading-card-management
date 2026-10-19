/** Exact one-row cost identity migration: private-field/source races and replay refusal (PGlite). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import type { Db } from "../../src/db";
import { rows } from "../../src/db/rows";
import { absorbRecordPlan, applyAbsorbRecord, absorbCatalog, type RawAbsorbRow } from "../lib/absorb-record-907";
const client = new PGlite(), db = drizzle(client) as unknown as Db;
try {
  for (const flags of [
    ["--snapshot", "/tmp/absorb-input-guard.json", "--out", "/tmp/absorb-input-guard.json"],
    ["--snapshot", "/tmp/absorb-input-guard.json", "--private-out", "/tmp/absorb-input-guard.json"],
    ["--out", "/tmp/absorb-output-guard.json", "--private-out", "/tmp/absorb-output-guard.json"],
    ["--snapshot", "/tmp/absorb-input-guard.json", "--apply", "--approved-digest", "0".repeat(64)],
  ]) {
    const env = { ...process.env }; delete env.DATABASE_URL;
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/arena-absorb-record-907.mts", ...flags], { env, encoding: "utf8" });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /output must not overwrite|public and private outputs|offline mode never writes/);
  }
  await client.exec(`create table cards(id text primary key,name text,card_type text,colors text[],energy_cost text,z_energy_cost text,power int,combo_cost int,combo_power int,
    skill text,characters text[],traits text[],back_name text,back_power int,back_skill text,specified_cost text);
    create table card_rules(id int primary key,card_id text,side text,skill_index int,printed text,kind text,trigger jsonb,combo jsonb,usage jsonb,validity jsonb,cost jsonb,cond jsonb,ops jsonb,
    status text,source text,unread jsonb,version int,reads text,pattern text,confirmed_at timestamptz,confirmed_by text,confirm_note text,review_flag text,updated_at timestamptz,created_at timestamptz,
    explanation text,compiler_diff jsonb,brief text,probe jsonb,expectations jsonb,times_seen int,last_seen_at timestamptz)`);
  const c = absorbCatalog();
  const card = { id: c.id, name: c.name, card_type: c.type, colors: c.colors, energy_cost: String(c.energyCost), z_energy_cost: null, power: c.power,
    combo_cost: c.comboCost, combo_power: c.comboPower, skill: c.skill, characters: c.characters, traits: c.traits, back_name: null, back_power: null, back_skill: null, specified_cost: null };
  await db.execute(sql`insert into cards select * from jsonb_populate_record(null::cards,${JSON.stringify(card)}::jsonb)`);
  const original = JSON.parse(readFileSync("docs/arena-backlog/evidence/923/metadata-2026-10-19/actual-stored-export.json", "utf8")).find((r: RawAbsorbRow) => r.id === 6416);
  const fixture = { ...original, explanation: "synthetic private ruling", confirm_note: "synthetic private note", confirmed_at: null, confirmed_by: null,
    review_flag: null, created_at: "2026-10-18T00:00:00Z", updated_at: "2026-10-19T00:00:00Z", compiler_diff: { private: true }, brief: "synthetic private brief",
    probe: { private: true }, expectations: { private: true }, times_seen: 9, last_seen_at: null };
  await db.execute(sql`insert into card_rules select * from jsonb_populate_record(null::card_rules,${JSON.stringify(fixture)}::jsonb)`);
  const read = async () => rows<{ record: RawAbsorbRow }>(await db.execute(sql`select to_jsonb(r) record from card_rules r where id=6416`))[0].record;
  const before = await read(), plan = absorbRecordPlan(before);
  assert.deepEqual(plan.preview.allowedChangedFields, ["cost.absorb", "version", "updated_at"]);
  assert.ok(!JSON.stringify(plan.preview).includes("synthetic"));
  for (const patch of [{ status: "confirmed" }, { source: "user" }, { version: 10 }, { ops: [] }, { review_flag: "private pending review" }])
    assert.throws(() => absorbRecordPlan({ ...before, ...patch }));
  const missing = { ...before }; delete missing.explanation; assert.throws(() => absorbRecordPlan(missing));
  await assert.rejects(applyAbsorbRecord(db, before, "0".repeat(64)), /approval digest/);
  await db.execute(sql`update card_rules set explanation='concurrent private edit' where id=6416`);
  const edited = await read(); await assert.rejects(applyAbsorbRecord(db, before, plan.digest), /atomic identity write refused/); assert.deepEqual(await read(), edited);
  await db.execute(sql`update card_rules set explanation='synthetic private ruling' where id=6416`);
  await db.execute(sql`update cards set colors=array['Yellow'] where id='BT3-070'`);
  await assert.rejects(applyAbsorbRecord(db, before, plan.digest), /catalog engine identity changed/); assert.deepEqual(await read(), before);
  await db.execute(sql`update cards set colors=array['Green'] where id='BT3-070'`);
  let calls = 0;
  const race = { execute: async (query: Parameters<Db["execute"]>[0]) => {
    if (++calls === 2) await db.execute(sql`update cards set traits=array['concurrent source edit'] where id='BT3-070'`);
    return db.execute(query);
  } } as unknown as Db;
  await assert.rejects(applyAbsorbRecord(race, before, plan.digest), /atomic identity write refused/); assert.deepEqual(await read(), before);
  await db.execute(sql`update cards set traits=${sql.raw(`ARRAY[${c.traits.map(t => `'${t.replaceAll("'", "''")}'`).join(",")}]::text[]`)} where id='BT3-070'`);
  assert.deepEqual(await applyAbsorbRecord(db, before, plan.digest), [6416]);
  const after = await read();
  for (const key of Object.keys(before).filter(k => !["cost", "version", "updated_at"].includes(k))) assert.deepEqual(after[key], before[key], `${key} preserved`);
  const oldCost = { ...(after.cost as Record<string, unknown>) }; delete oldCost.absorb; assert.deepEqual(oldCost, before.cost);
  assert.equal(after.version, 10);
  await assert.rejects(applyAbsorbRecord(db, before, plan.digest), /atomic identity write refused/); assert.deepEqual(await read(), after);
  assert.throws(() => absorbRecordPlan(after), /9/);
  console.log("absorb-record-907: exact cost.absorb addition, private fields preserved, wrong digest/stale row/catalog and source race/replay refused PASS (PGlite only)");
} finally { await client.close(); }
