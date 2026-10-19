/** Exact eleven #923 records: additive metadata only, never a compiler refresh. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "../../src/db";
import { rows } from "../../src/db/rows";
import { canonicalJson } from "../../src/lib/arena/replay-core";
import { parseSkills, skillLines } from "../../src/lib/arena/text/cards";
import { compileUsage, usageProblem } from "../../src/lib/arena/vm/usage";
import { compileValidity, validityProblem } from "../../src/lib/arena/vm/validity";
import { runtimeSupportOfRow } from "../../src/lib/arena/rules-store";
import { cardDefFrom } from "../../src/lib/arena/load";
import type { CardDef } from "../../src/lib/arena/types";
export const METADATA_923_REFERENCE = "docs/arena-backlog/evidence/923/metadata-2026-10-19";
export const METADATA_923_TARGETS = [
  { key: "BT11-013/front/10", id: 6545, version: 4, status: "draft" },
  { key: "BT11-013/front/20", id: 6546, version: 3, status: "draft" },
  { key: "BT11-013/front/30", id: 6547, version: 6, status: "draft" },
  { key: "BT3-070/front/0", id: 6416, version: 8, status: "draft" },
  { key: "BT3-070/front/10", id: 6417, version: 7, status: "draft" },
  { key: "P-360/back/0", id: 12065, version: 4, status: "draft" },
  { key: "P-360/back/10", id: 12066, version: 2, status: "draft" },
  { key: "P-360/back/20", id: 12067, version: 7, status: "draft" },
  { key: "P-360/front/0", id: 12062, version: 2, status: "draft" },
  { key: "P-360/front/10", id: 12063, version: 8, status: "draft" },
  { key: "P-360/front/20", id: 12064, version: 4, status: "draft" },
] as const;
export type Metadata923Row = Record<string, unknown>;
export const metadata923Hash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const keyOf = (r: Metadata923Row) => `${r.card_id}/${r.side}/${r.skill_index}`;
export const metadata923ProgramHash = (r: Metadata923Row) => metadata923Hash({
  ...Object.fromEntries(["printed", "kind", "trigger", "cond", "ops", "unread", "reads", "pattern", "source", "status", "cost", "combo"].map(k => [k, r[k] ?? null])),
});
const REQUIRED_RAW = ["id", "card_id", "side", "skill_index", "printed", "kind", "trigger", "cost", "cond", "ops", "unread", "reads", "pattern", "source", "status", "version", "combo", "usage", "validity", "created_at", "updated_at", "explanation", "review_flag", "confirmed_at", "confirmed_by", "confirm_note", "compiler_diff", "brief", "probe", "expectations", "times_seen", "last_seen_at"];
export function metadata923Plan(input: Metadata923Row[]) {
  assert.ok(Array.isArray(input)); assert.equal(input.length, 11, "exactly eleven #923 targets required");
  assert.deepEqual(input.map(keyOf).sort(), METADATA_923_TARGETS.map(t => t.key).sort(), "duplicate, missing or unrelated #923 target");
  assert.equal(new Set(input.map(r => r.id)).size, 11, "duplicate physical record");
  const reference: Metadata923Row[] = JSON.parse(readFileSync(`${METADATA_923_REFERENCE}/programs.json`, "utf8"));
  const catalog: CardDef[] = JSON.parse(readFileSync(`${METADATA_923_REFERENCE}/cards.json`, "utf8"));
  const planned = input.slice().sort((a, b) => keyOf(a).localeCompare(keyOf(b))).map(before => {
    const key = keyOf(before), target = METADATA_923_TARGETS.find(t => t.key === key)!;
    for (const field of REQUIRED_RAW) assert.ok(Object.hasOwn(before, field), `full raw snapshot required: missing ${field}`);
    assert.equal(before.id, target.id); assert.equal(before.source, "compiler"); assert.equal(before.status, target.status);
    assert.ok(before.version === target.version || before.version === target.version + 1, "unexpected rule version; review a new snapshot");
    assert.equal(before.review_flag, null, "flagged rule requires independent review"); assert.deepEqual(before.unread, []);
    const original = reference.find(r => keyOf(r) === key)!; assert.ok(original);
    assert.equal(metadata923ProgramHash(before), metadata923ProgramHash(original), "stored program, condition, trigger, reading or review changed; no metadata migration");
    const card = catalog.find(c => c.id === before.card_id)!; assert.ok(card);
    const printed = skillLines(before.side === "back" ? card.back?.skill : card.skill)[Number(before.skill_index) / 10];
    assert.equal(before.printed, printed, "current printed source identity changed");
    const parsed = parseSkills(String(before.printed)); assert.equal(parsed.length, 1); assert.equal(parsed[0].kind, before.kind);
    const usage = compileUsage(parsed[0]), validity = compileValidity(parsed[0]);
    assert.equal(usageProblem(usage), null); assert.equal(validityProblem(validity), null);
    for (const [field, value] of Object.entries({ usage, validity })) if (before[field] != null) assert.equal(metadata923Hash(before[field]), metadata923Hash(value), `existing authored ${field} differs; never overwrite`);
    const after: Metadata923Row = { ...before, usage, validity };
    assert.equal(metadata923ProgramHash(after), metadata923ProgramHash(before), "program body must be preserved");
    assert.deepEqual(runtimeSupportOfRow({ kind: String(before.kind), printed: String(before.printed), trigger: before.trigger, unread: before.unread, ops: before.ops, cost: before.cost, usage, validity, combo: before.combo } as Parameters<typeof runtimeSupportOfRow>[0]).unsupported, [], "metadata does not establish runtime admission");
    const changed = ["usage", "validity"].filter(k => metadata923Hash(before[k]) !== metadata923Hash(after[k]));
    if (changed.length) assert.equal(before.version, target.version, "partially changed next-version snapshot requires new review");
    return { before, usage, validity, changed, publicTarget: {
      key, id: target.id, version: before.version, status: before.status, source: before.source, protected: false, programSha256: metadata923ProgramHash(before),
      snapshotSha256: metadata923Hash(before), pending: changed.length > 0, allowedChangedFields: changed,
      before: { usage: before.usage, validity: before.validity }, after: { usage, validity },
      preserved: "Every cost, combo contract, effect, condition, trigger, printed source, reading, pattern and review field; no human confirmation added",
    } };
  });
  const preview = { format: "metadata-923-preview-v1", referenceSha256: metadata923Hash({ reference, catalog }), snapshotSha256: metadata923Hash(planned.map(p => p.before)),
    targets: planned.map(p => p.publicTarget), authorityResiduals: ["BT3-070/front/0 still uses native Union-Absorb identity; metadata admission does not remove that separate text-authority residual"], programsReplaced: 0, statusesChanged: 0, humanConfirmationsAdded: 0 };
  return { digest: metadata923Hash(preview), preview, entries: planned, rules: planned.filter(p => p.changed.length > 0) };
}
/** Full raw-row lock-and-compare. Exactly metadata plus version/timestamp can change. */
export async function applyMetadata923(db: Db, before: Metadata923Row[], approvedDigest: string) {
  const plan = metadata923Plan(before); assert.equal(approvedDigest, plan.digest, "approval digest is stale or describes another full snapshot");
  if (!plan.rules.length) return [];
  const payload = JSON.stringify(plan.entries.map(({ before, usage, validity, changed }) => ({ before, usage, validity, pending: changed.length > 0 })));
  const expectedCatalog: CardDef[] = JSON.parse(readFileSync(`${METADATA_923_REFERENCE}/cards.json`, "utf8"));
  const currentCatalog = rows<{ record: Metadata923Row }>(await db.execute(sql`select to_jsonb(c) record from cards c where c.id in (${sql.join(expectedCatalog.map(c => sql`${c.id}`), sql`, `)}) order by c.id`)).map(r => r.record);
  const normalize = (r: Metadata923Row) => Object.fromEntries(Object.entries(r).map(([key, value]) => [key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), value])) as unknown as Parameters<typeof cardDefFrom>[0];
  assert.equal(metadata923Hash(currentCatalog.map(r => cardDefFrom(normalize(r)))), metadata923Hash(expectedCatalog.slice().sort((a, b) => a.id.localeCompare(b.id))), "current full catalog engine identity changed");
  const catalog = JSON.stringify(currentCatalog);
  const written = rows<{ id: number }>(await db.execute(sql`
    with input as (select value from jsonb_array_elements(${payload}::jsonb)),
    source as (select value from jsonb_array_elements(${catalog}::jsonb)),
    locked_cards as materialized (select c.* from cards c join source s on c.id=s.value->>'id' order by c.id for update of c),
    locked as materialized (select r.* from card_rules r join input i on r.id=(i.value->'before'->>'id')::int order by r.id for update of r),
    valid as materialized (select 1 where
      (select count(*) from locked_cards c join source s on c.id=s.value->>'id'
        where to_jsonb(c)=s.value)=3
      and (select count(*) from locked r join input i on r.id=(i.value->'before'->>'id')::int
      where to_jsonb(r)=i.value->'before' and r.source='compiler' and r.status='draft')=11)
    update card_rules r set usage=i.value->'usage',validity=i.value->'validity',version=r.version+1,updated_at=now()
      from input i where r.id=(i.value->'before'->>'id')::int and (i.value->>'pending')::boolean and exists(select 1 from valid) returning r.id
  `));
  assert.equal(written.length, plan.rules.length, "full reviewed #923 rows changed; atomic metadata write refused");
  return written.map(r => r.id).sort((a, b) => a - b);
}
