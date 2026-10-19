/** Explicit, reviewed metadata migration for #907's four existing owner corrections.
 * Never compiles/replaces their effect, condition, trigger, reading or review status. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import type { Db } from "../../src/db";
import { rows } from "../../src/db/rows";
import { hashOf } from "../arena-corpus-provenance.mts";
import { normPrinted } from "./refresh-ids";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { compileUsage, usageProblem } from "../../src/lib/arena/vm/usage";
import { compileValidity, validityProblem } from "../../src/lib/arena/vm/validity";
import { costRecordProblem, zeroCostRecord } from "../../src/lib/arena/vm/skill-payment";
import { validateRule } from "../../src/lib/arena/lang";
import type { Rule } from "../../src/lib/arena/lang";
export const PROTECTED_KEYS = ["BT6-001/back/10", "BT6-012/front/30", "BT6-013/front/20", "BT6-015/front/20"];
const keyOf = (r: Record<string, unknown>) => `${r.card_id}/${r.side}/${r.skill_index}`;
const referencePath = "docs/arena-backlog/evidence/897/selected-pair-inputs-2026-10-19/stored-rules.json";
const costBody = (cost: unknown) => {
  const { version: _version, readable: _readable, ...body } = (cost ?? zeroCostRecord()) as Record<string, unknown>;
  void _version; void _readable; return body;
};
const program = (r: Record<string, unknown>) => Object.fromEntries(["printed", "kind", "trigger", "combo", "cond", "ops", "unread", "reads", "pattern", "source", "status"].map(k => [k, r[k] ?? null]).concat([["cost", costBody(r.cost)]]));
export function protectedMetadataPlan(input: Record<string, unknown>[]) {
  assert.equal(input.length, 4, "exactly four protected corrections required");
  assert.deepEqual(input.map(keyOf).sort(), [...PROTECTED_KEYS].sort(), "duplicate/missing/unrelated protected target");
  const reference: Record<string, unknown>[] = JSON.parse(readFileSync(referencePath, "utf8"));
  const planned = input.slice().sort((a,b) => keyOf(a).localeCompare(keyOf(b))).map(before => {
    const key = keyOf(before), original = reference.find(r => keyOf(r) === key)!;
    assert.equal(before.source, "user"); assert.equal(before.status, "corrected");
    assert.deepEqual(before.unread, []); assert.equal(before.review_flag ?? null, null, "flagged correction needs a new review");
    assert.equal(normPrinted(String(before.printed)), normPrinted(String(original.printed)), "source changed; review again");
    assert.equal(hashOf(program(before)), hashOf(program(original)), "owner program changed; review the current correction first");
    const parsed = parseSkills(String(before.printed)); assert.equal(parsed.length, 1);
    assert.equal(parsed[0].kind, before.kind);
    const usage = compileUsage(parsed[0]), validity = compileValidity(parsed[0]);
    assert.equal(usageProblem(usage), null); assert.equal(validityProblem(validity), null);
    if (before.usage != null) assert.deepEqual(before.usage, usage, "existing authored usage is never overwritten");
    if (before.validity != null) assert.deepEqual(before.validity, validity, "existing authored validity is never overwritten");
    const cost = before.cost == null ? zeroCostRecord() : { version: 1, readable: true, ...(before.cost as object) };
    assert.equal(costRecordProblem(cost), null);
    assert.equal(cost.readable, true, "existing unreadable payment needs a new review");
    const candidate = { ...before, cost, usage, validity };
    assert.equal(hashOf(program(candidate)), hashOf(program(before)), "program/payment body must remain byte-equivalent");
    assert.equal(validateRule({ kind: before.kind, trigger: before.trigger, cost, cond: before.cond, ops: before.ops, usage, validity } as Rule, String(before.kind)), null);
    const pending = hashOf(before.usage ?? null) !== hashOf(usage) || hashOf(before.validity ?? null) !== hashOf(validity) || hashOf(before.cost) !== hashOf(cost);
    const publicTarget = { key, id: before.id, version: before.version, status: before.status, source: before.source,
      programHash: hashOf(program(before)), pending, effectsConditionsTriggersReadingsAndReviewPreserved: true,
      before: { usage: before.usage ?? null, validity: before.validity ?? null, costVersion: (before.cost as {version?:number}|null)?.version ?? null, costReadable: (before.cost as {readable?:boolean}|null)?.readable ?? null },
      after: { usage, validity, costVersion: 1, costReadable: true } };
    return { before, cost, usage, validity, publicTarget };
  });
  const preview = { referencePath, targets: planned.map(p => p.publicTarget), note: "Metadata-only proposal; no database write, program replacement or new human confirmation" };
  return { digest: hashOf(preview), preview, rules: planned.filter(p => p.publicTarget.pending) };
}
/** Atomic compare of the complete raw rows. Caller supplies the reviewed preview digest. */
export async function applyProtectedMetadata(db: Db, before: Record<string, unknown>[], approvedDigest: string) {
  const plan = protectedMetadataPlan(before);
  assert.equal(approvedDigest, plan.digest, "protected metadata approval is stale or describes different rows");
  if (!plan.rules.length) return [];
  const payload = JSON.stringify(plan.rules.map(({before,cost,usage,validity}) => ({before,cost,usage,validity})));
  const written = rows<{id:number}>(await db.execute(sql`
    with input as (select value from jsonb_array_elements(${payload}::jsonb)),
    locked as materialized (select r.* from card_rules r join input i on r.id=(i.value->'before'->>'id')::int order by r.id for update of r),
    valid as materialized (select 1 where (select count(*) from locked r join input i on r.id=(i.value->'before'->>'id')::int
      where to_jsonb(r)=i.value->'before' and r.source='user' and r.status='corrected')=${plan.rules.length})
    update card_rules r set usage=i.value->'usage',validity=i.value->'validity',cost=i.value->'cost',version=r.version+1,updated_at=now()
      from input i where r.id=(i.value->'before'->>'id')::int and exists(select 1 from valid) returning r.id
  `));
  assert.equal(written.length, plan.rules.length, "protected metadata repair refused: reviewed rows changed; no write");
  return written.map(r => r.id).sort((a,b) => a-b);
}
