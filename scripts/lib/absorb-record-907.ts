/** Exact BT3-070 v9 identity addition. No effect, cost program or review refresh. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import type { Db } from "../../src/db";
import { rows } from "../../src/db/rows";
import { cardDefFrom } from "../../src/lib/arena/load";
import { skillRecords } from "../../src/lib/arena/draft";
import { metadata923Hash as hash } from "./metadata-923";
import type { CardDef } from "../../src/lib/arena/types";
export { hash as absorbRecordHash };
export type RawAbsorbRow = Record<string, unknown>;
const REFERENCE = "docs/arena-backlog/evidence/923/metadata-2026-10-19";
export const absorbCatalog = (): CardDef => JSON.parse(readFileSync(`${REFERENCE}/cards.json`, "utf8")).find((c: CardDef) => c.id === "BT3-070");
const referenceRow = (): RawAbsorbRow => JSON.parse(readFileSync(`${REFERENCE}/actual-stored-export.json`, "utf8")).find((r: RawAbsorbRow) => r.id === 6416);
export function absorbRecordPlan(before: RawAbsorbRow) {
  const original = referenceRow();
  for (const key of ["created_at", "updated_at", "explanation", "review_flag", "confirmed_at", "confirmed_by", "confirm_note", "compiler_diff", "brief", "probe", "expectations", "times_seen", "last_seen_at"])
    assert.ok(Object.hasOwn(before, key), `full private snapshot required: ${key}`);
  assert.equal(before.id, 6416); assert.equal(before.card_id, "BT3-070"); assert.equal(before.side, "front"); assert.equal(before.skill_index, 0);
  assert.equal(before.source, "compiler"); assert.equal(before.status, "draft"); assert.equal(before.version, 9);
  assert.equal(before.review_flag, null); assert.equal(before.confirmed_at, null); assert.equal(before.confirmed_by, null);
  for (const [key, value] of Object.entries(original)) if (!["updated_at", "created_at"].includes(key)) assert.equal(hash(before[key]), hash(value), `actual v9 ${key} changed; review a new snapshot`);
  const fresh = skillRecords(absorbCatalog()).find(r => r.side === "front" && r.skillIndex === 0)!;
  assert.ok(fresh); assert.deepEqual(fresh.unread, []);
  const cost = fresh.cost as unknown as Record<string, unknown>;
  assert.ok(cost?.absorb, "compiler must emit explicit Absorb identity");
  const withoutIdentity = { ...cost }; delete withoutIdentity.absorb;
  assert.equal(hash(withoutIdentity), hash(before.cost), "existing cost body must be byte-equivalent by canonical JSON");
  for (const key of ["printed", "kind", "trigger", "combo", "usage", "validity", "cond", "ops", "unread", "pattern", "reads"] as const)
    assert.equal(hash(fresh[key]), hash(before[key]), `fresh ${key} differs; this tool only adds cost.absorb`);
  const after = { ...before, cost };
  const preview = { format: "absorb-record-907-preview-v1", key: "BT3-070/front/0", id: 6416, beforeVersion: 9, afterVersion: 10,
    source: "compiler", status: "draft", snapshotSha256: hash(before), catalogSha256: hash(absorbCatalog()),
    beforeCostSha256: hash(before.cost), afterCostSha256: hash(cost), addedIdentity: cost.absorb,
    allowedChangedFields: ["cost.absorb", "version", "updated_at"],
    preserved: "All existing cost fields and material program, effects, conditions, triggers, readings, usage, validity, status and private review fields", humanConfirmationsAdded: 0 };
  return { before, after, cost, preview, digest: hash(preview) };
}
const normalize = (record: RawAbsorbRow) => Object.fromEntries(Object.entries(record).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), v])) as unknown as Parameters<typeof cardDefFrom>[0];
export function assertAbsorbCatalog(record: RawAbsorbRow) {
  assert.equal(hash(cardDefFrom(normalize(record))), hash(absorbCatalog()), "catalog engine identity changed");
}
/** Atomic full-row and full-catalog CAS, including edits arriving after the initial source read. */
export async function applyAbsorbRecord(db: Db, before: RawAbsorbRow, approvedDigest: string) {
  const plan = absorbRecordPlan(before); assert.equal(approvedDigest, plan.digest, "reviewed approval digest mismatch");
  const catalog = rows<{ record: RawAbsorbRow }>(await db.execute(sql`select to_jsonb(c) record from cards c where id='BT3-070'`))[0]?.record;
  assert.ok(catalog); assertAbsorbCatalog(catalog);
  const written = rows<{ id: number }>(await db.execute(sql`
    with locked_card as materialized (select c.* from cards c where id='BT3-070' for update),
    locked_rule as materialized (select r.* from card_rules r where id=6416 for update),
    valid as materialized (select 1 where
      exists(select 1 from locked_card c where to_jsonb(c)=${JSON.stringify(catalog)}::jsonb)
      and exists(select 1 from locked_rule r where to_jsonb(r)=${JSON.stringify(before)}::jsonb and r.source='compiler' and r.status='draft' and r.version=9))
    update card_rules r set cost=${JSON.stringify(plan.cost)}::jsonb,version=r.version+1,updated_at=now()
    where r.id=6416 and exists(select 1 from valid) returning r.id
  `));
  assert.deepEqual(written.map(r => r.id), [6416], "stale reviewed row/catalog; atomic identity write refused");
  return [6416];
}
