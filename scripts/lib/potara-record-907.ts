/** Exact BT2-012 v1 Potara authority and admission additions; existing programs stay exact. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import type { Db } from "../../src/db";
import { rows } from "../../src/db/rows";
import { cardDefFrom } from "../../src/lib/arena/load";
import { skillRecords } from "../../src/lib/arena/draft";
import { metadata923Hash as hash } from "./metadata-923";
import type { CardDef } from "../../src/lib/arena/types";
export { hash as potaraRecordHash };
export type RawPotaraRow = Record<string, unknown>;
const REFERENCE = "docs/arena-backlog/evidence/907/potara-identity-2026-10-19/reference-before.json";
export const potaraCatalog = (): CardDef => JSON.parse(readFileSync(REFERENCE, "utf8")).catalog.find((c: CardDef) => c.id === "BT2-012");
const referenceRow = (): RawPotaraRow => JSON.parse(readFileSync(REFERENCE, "utf8")).rows.find((r: RawPotaraRow) => r.id === 10297);
export function potaraRecordPlan(before: RawPotaraRow) {
  const original = referenceRow();
  for (const key of ["created_at", "updated_at", "explanation", "review_flag", "confirmed_at", "confirmed_by", "confirm_note", "compiler_diff", "brief", "probe", "expectations", "times_seen", "last_seen_at"])
    assert.ok(Object.hasOwn(before, key), `full private snapshot required: ${key}`);
  assert.equal(before.id, 10297); assert.equal(before.card_id, "BT2-012"); assert.equal(before.side, "front"); assert.equal(before.skill_index, 0);
  assert.equal(before.source, "compiler"); assert.equal(before.status, "draft"); assert.equal(before.version, 1);
  assert.equal(before.review_flag, null); assert.equal(before.confirmed_at, null); assert.equal(before.confirmed_by, null);
  for (const [key, value] of Object.entries(original)) if (!["updated_at", "created_at"].includes(key)) assert.equal(hash(before[key]), hash(value), `actual v1 ${key} changed; review a new snapshot`);
  const fresh = skillRecords(potaraCatalog()).find(r => r.side === "front" && r.skillIndex === 0)!;
  assert.ok(fresh); assert.deepEqual(fresh.unread, []);
  const cost = fresh.cost as unknown as Record<string, unknown>;
  assert.ok(cost?.potara, "compiler must emit explicit Potara identity");
  const withoutIdentity = { ...cost }; delete withoutIdentity.potara; delete withoutIdentity.version; delete withoutIdentity.readable;
  assert.equal(hash(withoutIdentity), hash(before.cost), "existing cost body must be byte-equivalent by canonical JSON");
  for (const key of ["printed", "kind", "trigger", "combo", "cond", "ops", "unread", "pattern", "reads"] as const)
    assert.equal(hash(fresh[key]), hash(before[key]), `fresh ${key} differs; only identity/admission metadata may change`);
  assert.equal(before.usage, null); assert.equal(before.validity, null);
  assert.deepEqual(fresh.usage, { version: 1, oncePerTurn: false, limit: null });
  assert.deepEqual(fresh.validity, { version: 1, sparking: null });
  const after = { ...before, cost, usage: fresh.usage, validity: fresh.validity };
  const preview = { format: "potara-record-907-preview-v1", key: "BT2-012/front/0", id: 10297, beforeVersion: 1, afterVersion: 2,
    source: "compiler", status: "draft", snapshotSha256: hash(before), catalogSha256: hash(potaraCatalog()),
    beforeCostSha256: hash(before.cost), afterCostSha256: hash(cost), addedIdentity: cost.potara,
    addedAdmission: { costVersion: cost.version, costReadable: cost.readable, usage: fresh.usage, validity: fresh.validity },
    allowedChangedFields: ["cost.version", "cost.readable", "cost.potara", "usage", "validity", "version", "updated_at"],
    preserved: "All legacy cost fields, effects, conditions, triggers, readings, combo, status and private review fields; only the named admission and material-identity fields are added", humanConfirmationsAdded: 0 };
  return { before, after, cost, preview, digest: hash(preview) };
}
const normalize = (record: RawPotaraRow) => Object.fromEntries(Object.entries(record).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), v])) as unknown as Parameters<typeof cardDefFrom>[0];
export function assertPotaraCatalog(record: RawPotaraRow) {
  assert.equal(hash(cardDefFrom(normalize(record))), hash(potaraCatalog()), "catalog engine identity changed");
}
/** Atomic full-row and full-catalog CAS, including edits arriving after the initial source read. */
export async function applyPotaraRecord(db: Db, before: RawPotaraRow, approvedDigest: string) {
  const plan = potaraRecordPlan(before); assert.equal(approvedDigest, plan.digest, "reviewed approval digest mismatch");
  const catalog = rows<{ record: RawPotaraRow }>(await db.execute(sql`select to_jsonb(c) record from cards c where id='BT2-012'`))[0]?.record;
  assert.ok(catalog); assertPotaraCatalog(catalog);
  const written = rows<{ id: number }>(await db.execute(sql`
    with locked_card as materialized (select c.* from cards c where id='BT2-012' for update),
    locked_rule as materialized (select r.* from card_rules r where id=10297 for update),
    valid as materialized (select 1 where
      exists(select 1 from locked_card c where to_jsonb(c)=${JSON.stringify(catalog)}::jsonb)
      and exists(select 1 from locked_rule r where to_jsonb(r)=${JSON.stringify(before)}::jsonb and r.source='compiler' and r.status='draft' and r.version=1))
    update card_rules r set cost=${JSON.stringify(plan.cost)}::jsonb,usage=${JSON.stringify(plan.after.usage)}::jsonb,validity=${JSON.stringify(plan.after.validity)}::jsonb,version=r.version+1,updated_at=now()
    where r.id=10297 and exists(select 1 from valid) returning r.id
  `));
  assert.deepEqual(written.map(r => r.id), [10297], "stale reviewed row/catalog; atomic identity write refused");
  return [10297];
}
