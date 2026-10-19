import { ABSORB_REBUILD } from "../../src/lib/arena/vm/absorb-procedure";
/** #923 offline source guards and real PGlite atomic metadata-only writer. No live database. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import type { Db } from "../../src/db";
import { rows } from "../../src/db/rows";
import { metadata923Plan, applyMetadata923, metadata923Hash, METADATA_923_REFERENCE, type Metadata923Row } from "../lib/metadata-923";
import { rulesFromRows } from "../../src/lib/arena/rules-store";
import type { RuleRow } from "../../src/lib/arena/rules-store";
import type { CardDef } from "../../src/lib/arena/types";
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const client = new PGlite(), db = drizzle(client) as unknown as Db;
try {
  await client.exec(`create table cards(id text primary key,name text,card_type text,colors text[],energy_cost text,z_energy_cost text,power int,combo_cost int,combo_power int,
    skill text,characters text[],traits text[],back_name text,back_power int,back_skill text,specified_cost text);
    create table card_rules(id int primary key,card_id text,side text,skill_index int,printed text,kind text,trigger jsonb,combo jsonb,usage jsonb,validity jsonb,cost jsonb,cond jsonb,ops jsonb,
    status text,source text,unread jsonb,version int,reads text,pattern text,confirmed_at timestamptz,confirmed_by text,confirm_note text,review_flag text,updated_at timestamptz,created_at timestamptz,
    explanation text,compiler_diff jsonb,brief text,probe jsonb,expectations jsonb,times_seen int,last_seen_at timestamptz)`);
  const catalog: CardDef[] = JSON.parse(readFileSync(`${METADATA_923_REFERENCE}/cards.json`, "utf8"));
  const cardRows = catalog.map(c => ({ id: c.id, name: c.name, card_type: c.type, colors: c.colors, energy_cost: c.energyCost == null ? null : String(c.energyCost), z_energy_cost: c.zEnergyCost == null ? null : String(c.zEnergyCost), power: c.power, combo_cost: c.comboCost, combo_power: c.comboPower,
    skill: c.skill, characters: c.characters, traits: c.traits, back_name: c.back?.name ?? null, back_power: c.back?.power ?? null, back_skill: c.back?.skill ?? null, specified_cost: null }));
  await db.execute(sql`insert into cards select * from jsonb_populate_recordset(null::cards,${JSON.stringify(cardRows)}::jsonb)`);
  const programs: Metadata923Row[] = JSON.parse(readFileSync(`${METADATA_923_REFERENCE}/programs.json`, "utf8"));
  const fixture = programs.map(r => ({ ...r, explanation: "private synthetic reviewer note", confirm_note: "private synthetic confirmation", confirmed_at: r.status === "confirmed" ? "2026-10-19T00:00:00Z" : null,
    confirmed_by: r.status === "confirmed" ? "synthetic-reviewer" : null, review_flag: null, created_at: "2026-10-18T00:00:00Z", updated_at: "2026-10-19T00:00:00Z",
    compiler_diff: { note: "synthetic private compiler review" }, brief: "synthetic private brief", probe: { fixture: true }, expectations: { private: true }, times_seen: 9, last_seen_at: null }));
  await db.execute(sql`insert into card_rules select * from jsonb_populate_recordset(null::card_rules,${JSON.stringify(fixture)}::jsonb)`);
  const snapshot = async () => rows<{ record: Metadata923Row }>(await db.execute(sql`select to_jsonb(r) record from card_rules r order by id`)).map(r => r.record);
  const before = await snapshot(), plan = metadata923Plan(before);
  assert.equal(plan.rules.length, 11); assert.equal(plan.preview.targets.filter(t => t.protected).length, 0);
  assert.equal(plan.preview.targets.filter(t => t.after.usage.oncePerTurn).length, 2);
  assert.ok(!JSON.stringify(plan.preview).includes("synthetic"), "public preview never contains private columns");
  assert.equal(metadata923Plan(copy(before)).digest, plan.digest, "round-tripped full snapshot has the same approval digest");
  for (const change of [
    (r: Metadata923Row[]) => { r[0].source = "user"; },
    (r: Metadata923Row[]) => { r[0].status = "confirmed"; },
    (r: Metadata923Row[]) => { r[0].version = 999; },
    (r: Metadata923Row[]) => { r[0].ops = [{ op: "draw", n: 99 }]; },
    (r: Metadata923Row[]) => { r[0].cond = { kind: "isTurnPlayer" }; },
    (r: Metadata923Row[]) => { r[0].reads = "changed reading"; },
    (r: Metadata923Row[]) => { r[0].cost = null; },
    (r: Metadata923Row[]) => { r[0].combo = { version: 999 }; },
    (r: Metadata923Row[]) => { r[0].printed = String(r[0].printed) + " altered"; },
    (r: Metadata923Row[]) => { r[0].review_flag = "needs review"; },
    (r: Metadata923Row[]) => { r[0].usage = { version: 1, oncePerTurn: true, limit: 2 }; },
    (r: Metadata923Row[]) => { delete r[0].explanation; },
    (r: Metadata923Row[]) => { r[1] = r[0]; },
  ]) { const bad = copy(before); change(bad); assert.throws(() => metadata923Plan(bad)); }
  await assert.rejects(applyMetadata923(db, before, "0".repeat(64)), /approval digest/);
  await db.execute(sql`update card_rules set explanation='concurrent private change' where id=${Number(before[7].id)}`);
  const stale = await snapshot(); await assert.rejects(applyMetadata923(db, before, plan.digest), /atomic metadata write refused/); assert.deepEqual(await snapshot(), stale);
  await db.execute(sql`update card_rules set explanation='private synthetic reviewer note' where id=${Number(before[7].id)}`); assert.deepEqual(await snapshot(), before);
  await db.execute(sql`update cards set colors=array['Yellow'] where id='BT11-013'`);
  await assert.rejects(applyMetadata923(db, before, plan.digest), /catalog engine identity changed/); assert.deepEqual(await snapshot(), before);
  await db.execute(sql`update cards set colors=array['Red'] where id='BT11-013'`);
  // A catalog source edit after its verified read must invalidate the same atomic write.
  let calls = 0;
  const race = { execute: async (query: Parameters<Db["execute"]>[0]) => { calls++; if (calls === 2) await db.execute(sql`update cards set traits=array['changed after read'] where id='BT3-070'`); return db.execute(query); } } as unknown as Db;
  await assert.rejects(applyMetadata923(race, before, plan.digest), /atomic metadata write refused/); assert.deepEqual(await snapshot(), before);
  const originalTraits = catalog.find(c => c.id === "BT3-070")!.traits;
  await db.execute(sql`update cards set traits=${sql.raw(`ARRAY[${originalTraits.map(t => `'${t.replaceAll("'", "''")}'`).join(",")}]::text[]`)} where id='BT3-070'`);
  const written = await applyMetadata923(db, before, plan.digest); assert.equal(written.length, 11);
  const after = await snapshot();
  for (let i = 0; i < before.length; i++) {
    for (const key of Object.keys(before[i]).filter(k => !["usage", "validity", "version", "updated_at"].includes(k))) assert.deepEqual(after[i][key], before[i][key], `${before[i].id}: ${key} preserved exactly`);
    assert.equal(after[i].version, Number(before[i].version) + 1);
    assert.equal(metadata923Hash(after[i].ops), metadata923Hash(before[i].ops)); assert.deepEqual(after[i].cond, before[i].cond);
  }
  assert.equal(metadata923Plan(after).rules.length, 0); assert.deepEqual(await applyMetadata923(db, after, metadata923Plan(after).digest), []);
  await assert.rejects(applyMetadata923(db, before, plan.digest), /atomic metadata write refused/); assert.deepEqual(await snapshot(), after, "replay cannot increment versions twice");
  const defs = Object.fromEntries(catalog.map(c => [c.id, c]));
  const camel = after.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), v]))) as unknown as RuleRow[];
  const loaded = rulesFromRows(camel, defs);
  for (const r of camel) assert.deepEqual(loaded[`${r.cardId}${r.side === "back" ? "#back" : ""}`].bySkill[r.skillIndex].unsupported, r.cardId === "BT3-070" && r.skillIndex === 0 ? [ABSORB_REBUILD] : [], "ten historical saved rows admit; the unchanged Absorb row explicitly requires its separate migration");
  console.log("metadata-923: eleven original programs/review records preserved, full snapshot and catalog races refused, costs/combo contracts/statuses retained, replay/idempotence and ten historical rows admit and unchanged Absorb explicitly requires rebuild PASS (PGlite only)");
} finally { await client.close(); }
