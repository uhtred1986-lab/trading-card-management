/** Exact eight #825 records: additive metadata only, never a compiler refresh. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "../../src/db";
import { rows } from "../../src/db/rows";
import { canonicalJson } from "../../src/lib/arena/replay-core";
import { parseSkills, skillLines } from "../../src/lib/arena/text/cards";
import { compileComboQualification } from "../../src/lib/arena/text/triggers";
import { compileUsage, usageProblem } from "../../src/lib/arena/vm/usage";
import { compileValidity, validityProblem } from "../../src/lib/arena/vm/validity";
import { comboScriptProblem } from "../../src/lib/arena/vm/combo-qualification";
import { costRecordProblem, zeroCostRecord } from "../../src/lib/arena/vm/skill-payment";
import { runtimeSupportOfRow } from "../../src/lib/arena/rules-store";
import type { RuleRow } from "../../src/lib/arena/rules-store";
import type { CardDef } from "../../src/lib/arena/types";
export const METADATA_825_REFERENCE = "docs/arena-backlog/evidence/825/metadata-2026-10-19";
export const METADATA_825_TARGETS = [
  { key: "BT29-029/back/0", id: 8932, version: 6, status: "draft" },
  { key: "BT3-090/front/0", id: 4054, version: 7, status: "draft" },
  { key: "BT3-096/front/10", id: 12431, version: 7, status: "confirmed" },
  { key: "BT3-098/front/10", id: 10565, version: 7, status: "confirmed" },
  { key: "BT3-112/front/10", id: 12988, version: 2, status: "draft" },
  { key: "BT7-040/front/10", id: 12685, version: 6, status: "draft" },
  { key: "BT7-083/front/10", id: 12960, version: 6, status: "draft" },
  { key: "BT7-086/front/10", id: 8230, version: 6, status: "draft" },
] as const;
export type Metadata825Row = Record<string, unknown>;
export const metadata825Hash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const keyOf = (r: Metadata825Row) => `${r.card_id}/${r.side}/${r.skill_index}`;
const costBody = (value: unknown) => { const { version: _v, readable: _r, ...body } = (value ?? zeroCostRecord()) as Record<string, unknown>; void _v; void _r; return body; };
export const metadata825ProgramHash = (r: Metadata825Row) => metadata825Hash({
  ...Object.fromEntries(["printed", "kind", "trigger", "cond", "ops", "unread", "reads", "pattern", "source", "status"].map(k => [k, r[k] ?? null])), cost: costBody(r.cost),
});
const REQUIRED_RAW = ["id", "card_id", "side", "skill_index", "printed", "kind", "trigger", "cost", "cond", "ops", "unread", "reads", "pattern", "source", "status", "version", "combo", "usage", "validity", "created_at", "updated_at", "explanation", "review_flag", "confirmed_at", "confirmed_by", "confirm_note", "compiler_diff", "brief", "probe", "expectations", "times_seen", "last_seen_at"];
export function metadata825Plan(input: Metadata825Row[]) {
  assert.ok(Array.isArray(input)); assert.equal(input.length, 8, "exactly eight #825 targets required");
  assert.deepEqual(input.map(keyOf).sort(), METADATA_825_TARGETS.map(t => t.key).sort(), "duplicate, missing or unrelated #825 target");
  assert.equal(new Set(input.map(r => r.id)).size, 8, "duplicate physical record");
  const reference: Metadata825Row[] = JSON.parse(readFileSync(`${METADATA_825_REFERENCE}/programs.json`, "utf8"));
  const catalog: CardDef[] = JSON.parse(readFileSync(`${METADATA_825_REFERENCE}/cards.json`, "utf8"));
  const planned = input.slice().sort((a, b) => keyOf(a).localeCompare(keyOf(b))).map(before => {
    const key = keyOf(before), target = METADATA_825_TARGETS.find(t => t.key === key)!;
    for (const field of REQUIRED_RAW) assert.ok(Object.hasOwn(before, field), `full raw snapshot required: missing ${field}`);
    assert.equal(before.id, target.id); assert.equal(before.source, "compiler"); assert.equal(before.status, target.status);
    assert.ok(before.version === target.version || before.version === target.version + 1, "unexpected rule version; review a new snapshot");
    assert.equal(before.review_flag, null, "flagged rule requires independent review"); assert.deepEqual(before.unread, []);
    const original = reference.find(r => keyOf(r) === key)!; assert.ok(original);
    assert.equal(metadata825ProgramHash(before), metadata825ProgramHash(original), "stored program, condition, trigger, reading or review changed; no metadata migration");
    const card = catalog.find(c => c.id === before.card_id)!; assert.ok(card);
    const printed = skillLines(before.side === "back" ? card.back?.skill : card.skill)[Number(before.skill_index) / 10];
    assert.equal(before.printed, printed, "current printed source identity changed");
    const parsed = parseSkills(String(before.printed)); assert.equal(parsed.length, 1); assert.equal(parsed[0].kind, before.kind);
    const usage = compileUsage(parsed[0]), validity = compileValidity(parsed[0]), combo = compileComboQualification(parsed[0]);
    assert.equal(usageProblem(usage), null); assert.equal(validityProblem(validity), null);
    if (combo) assert.equal(comboScriptProblem({ combo, trigger: before.trigger }), null);
    for (const [field, value] of Object.entries({ usage, validity, combo })) if (before[field] != null) assert.equal(metadata825Hash(before[field]), metadata825Hash(value), `existing authored ${field} differs; never overwrite`);
    const cost = before.cost == null ? zeroCostRecord() : before.cost;
    assert.equal(costRecordProblem(cost), null); assert.equal(metadata825Hash(cost), metadata825Hash(zeroCostRecord()), "only the exact zero Auto price is permitted");
    const after = { ...before, cost, usage, validity, combo };
    assert.equal(metadata825ProgramHash(after), metadata825ProgramHash(before), "program body must be preserved");
    assert.deepEqual(runtimeSupportOfRow({ kind: String(before.kind), printed: String(before.printed), trigger: before.trigger, unread: before.unread, ops: before.ops, cost, usage, validity, combo } as RuleRow).unsupported, [], "metadata does not establish runtime admission");
    const changed = ["cost", "usage", "validity", "combo"].filter(k => metadata825Hash(before[k]) !== metadata825Hash(after[k]));
    if (changed.length) assert.equal(before.version, target.version, "partially changed next-version snapshot requires new review");
    return { before, cost, usage, validity, combo, changed, publicTarget: {
      key, id: target.id, version: before.version, status: before.status, source: before.source, protected: before.status === "confirmed", programSha256: metadata825ProgramHash(before),
      snapshotSha256: metadata825Hash(before), pending: changed.length > 0, allowedChangedFields: changed,
      before: { cost: before.cost, usage: before.usage, validity: before.validity, combo: before.combo }, after: { cost, usage, validity, combo },
      preserved: "Every effect, condition, trigger, printed source, reading, pattern and review field; no human confirmation added",
    } };
  });
  const preview = { format: "metadata-825-preview-v1", referenceSha256: metadata825Hash({ reference, catalog }), snapshotSha256: metadata825Hash(planned.map(p => p.before)),
    targets: planned.map(p => p.publicTarget), programsReplaced: 0, statusesChanged: 0, humanConfirmationsAdded: 0 };
  return { digest: metadata825Hash(preview), preview, entries: planned, rules: planned.filter(p => p.changed.length > 0) };
}
/** Full raw-row lock-and-compare. Exactly metadata plus version/timestamp can change. */
export async function applyMetadata825(db: Db, before: Metadata825Row[], approvedDigest: string) {
  const plan = metadata825Plan(before); assert.equal(approvedDigest, plan.digest, "approval digest is stale or describes another full snapshot");
  if (!plan.rules.length) return [];
  const payload = JSON.stringify(plan.entries.map(({ before, cost, usage, validity, combo, changed }) => ({ before, cost, usage, validity, combo, pending: changed.length > 0 })));
  const catalog = readFileSync(`${METADATA_825_REFERENCE}/cards.json`, "utf8");
  const written = rows<{ id: number }>(await db.execute(sql`
    with input as (select value from jsonb_array_elements(${payload}::jsonb)),
    source as (select value from jsonb_array_elements(${catalog}::jsonb)),
    locked_cards as materialized (select c.* from cards c join source s on c.id=s.value->>'id' order by c.id for update of c),
    locked as materialized (select r.* from card_rules r join input i on r.id=(i.value->'before'->>'id')::int order by r.id for update of r),
    valid as materialized (select 1 where
      (select count(*) from locked_cards c join source s on c.id=s.value->>'id'
        where c.skill is not distinct from s.value->>'skill' and c.back_skill is not distinct from s.value->'back'->>'skill')=8
      and (select count(*) from locked r join input i on r.id=(i.value->'before'->>'id')::int
      where to_jsonb(r)=i.value->'before' and r.source='compiler' and r.status in ('draft','confirmed'))=8)
    update card_rules r set cost=i.value->'cost',usage=i.value->'usage',validity=i.value->'validity',combo=i.value->'combo',version=r.version+1,updated_at=now()
      from input i where r.id=(i.value->'before'->>'id')::int and (i.value->>'pending')::boolean and exists(select 1 from valid) returning r.id
  `));
  assert.equal(written.length, plan.rules.length, "full reviewed #825 rows changed; atomic metadata write refused");
  return written.map(r => r.id).sort((a, b) => a - b);
}
