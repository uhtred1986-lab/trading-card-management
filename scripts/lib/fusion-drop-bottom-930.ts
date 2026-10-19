/** Exact two activation/support pairs; a reviewed compiler repair, never a catalog sweep. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import type { Db } from "../../src/db";
import { rows } from "../../src/db/rows";
import { cardDefFrom } from "../../src/lib/arena/load";
import { skillRecords } from "../../src/lib/arena/draft";
import type { CardDef } from "../../src/lib/arena/types";
import { metadata923Hash as hash } from "./metadata-923";
export { hash as fusionDropBottomHash };
export type DropBottomRow = Record<string, unknown>;
export const DROP_BOTTOM_REFERENCE = "docs/arena-backlog/evidence/930/drop-bottom-2026-10-19/reference-before.json";
export const DROP_BOTTOM_TARGETS = [
  { id: 3897, card: "EX23-36", index: 10, version: 2, status: "draft" },
  { id: 3898, card: "EX23-36", index: 20, version: 5, status: "open" },
  { id: 9887, card: "P-519", index: 10, version: 1, status: "draft" },
  { id: 9888, card: "P-519", index: 20, version: 5, status: "open" },
] as const;
const reference = (): {catalog: CardDef[]; rows: DropBottomRow[]} => JSON.parse(readFileSync(DROP_BOTTOM_REFERENCE, "utf8"));
export const dropBottomCatalog = () => reference().catalog;
const normalize = (record: DropBottomRow) => Object.fromEntries(Object.entries(record).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), v])) as unknown as Parameters<typeof cardDefFrom>[0];
export function assertDropBottomCatalog(raw: DropBottomRow[]) {
  const expected = dropBottomCatalog().slice().sort((a, b) => a.id.localeCompare(b.id));
  assert.equal(hash(raw.map(r => cardDefFrom(normalize(r))).sort((a, b) => a.id.localeCompare(b.id))), hash(expected), "catalog engine identity changed");
}
export function fusionDropBottomPlan(input: DropBottomRow[]) {
  assert.equal(input.length, 4, "exactly four reviewed activation/support rows required");
  assert.deepEqual(input.map(r => r.id).sort((a, b) => Number(a) - Number(b)), DROP_BOTTOM_TARGETS.map(t => t.id));
  const frozen = reference();
  const entries = DROP_BOTTOM_TARGETS.map(target => {
    const before = input.find(r => r.id === target.id)!;
    for (const key of ["created_at", "updated_at", "explanation", "review_flag", "confirmed_at", "confirmed_by", "confirm_note", "compiler_diff", "brief", "probe", "expectations", "times_seen", "last_seen_at"])
      assert.ok(Object.hasOwn(before, key), `full private snapshot required: ${key}`);
    assert.equal(before.card_id, target.card); assert.equal(before.side, "front"); assert.equal(before.skill_index, target.index);
    assert.equal(before.version, target.version); assert.equal(before.status, target.status); assert.equal(before.source, "compiler");
    assert.equal(before.review_flag, null); assert.equal(before.confirmed_at, null); assert.equal(before.confirmed_by, null);
    const original = frozen.rows.find(r => r.id === target.id)!; assert.ok(original);
    for (const [key, value] of Object.entries(original)) assert.equal(hash(before[key]), hash(value), `reviewed ${target.id}/${key} changed`);
    const card = frozen.catalog.find(c => c.id === target.card)!;
    const fresh = skillRecords(card).find(r => r.side === "front" && r.skillIndex === target.index)!; assert.ok(fresh);
    assert.deepEqual(fresh.unread, [], "whole selected clause must compile");
    const support = target.index === 20;
    for (const key of ["printed", "kind", "trigger", "combo"] as const) assert.equal(hash(fresh[key]), hash(before[key]), `existing ${target.id}/${key} changed`);
    const patch: DropBottomRow = { cost: fresh.cost, usage: fresh.usage, validity: fresh.validity };
    if (support) Object.assign(patch, { cond: fresh.cond, ops: fresh.ops, unread: fresh.unread, pattern: fresh.pattern, reads: fresh.reads, status: "draft" });
    else {
      for (const key of ["cond", "ops", "unread", "pattern", "reads"] as const) assert.equal(hash(fresh[key]), hash(before[key]), `activation ${target.id}/${key} must remain exact`);
      const cost = { ...(fresh.cost as unknown as DropBottomRow) };
      assert.ok(cost.fusion, "typed Fusion identity required");
      delete cost.version; delete cost.readable; delete cost.fusion;
      if (before.cost === null) assert.deepEqual(cost, { text: "", orbs: {}, either: [], marker: null, burst: null, spiritBoost: null, program: null, condition: null }, "only explicit zero cost may replace null");
      else assert.equal(hash(cost), hash(before.cost), "legacy activation cost changed");
    }
    assert.equal(before.usage, null); assert.equal(before.validity, null);
    const after = { ...before, ...patch };
    const changed = Object.keys(patch).filter(k => hash(before[k]) !== hash(after[k]));
    return { before, after, patch, target: { key: `${target.card}/front/${target.index}`, id: target.id, beforeVersion: target.version, afterVersion: target.version + 1,
      beforeStatus: before.status, afterStatus: after.status, snapshotSha256: hash(before), changedFields: [...changed, "version", "updated_at"],
      beforeProgramSha256: hash({cost: before.cost, cond: before.cond, ops: before.ops, unread: before.unread, reads: before.reads, pattern: before.pattern}),
      proposed: Object.fromEntries(Object.keys(patch).map(k => [k, after[k]])) } };
  });
  const preview = { format: "fusion-drop-bottom-930-preview-v1", catalogSha256: hash(frozen.catalog), snapshotSha256: hash(entries.map(e => e.before)), targets: entries.map(e => e.target),
    scope: "Exactly two Fusion activations plus their own conditioned Drop-to-bottom support; two open compiler support rows become draft, with new typed programs and empty unread clauses. No human confirmation.",
    preserved: "All printed sources, native triggers/kinds, combo, source ownership and private review fields; activation effects/conditions/readings and legacy prices unchanged", humanConfirmationsAdded: 0 };
  return { entries, preview, digest: hash(preview) };
}
export async function applyFusionDropBottom(db: Db, before: DropBottomRow[], approvedDigest: string) {
  const plan = fusionDropBottomPlan(before); assert.equal(approvedDigest, plan.digest, "reviewed digest mismatch");
  const catalog = rows<{record: DropBottomRow}>(await db.execute(sql`select to_jsonb(c) record from cards c where id in ('EX23-36','P-519') order by id`)).map(r => r.record); assertDropBottomCatalog(catalog);
  const payload = JSON.stringify(plan.entries.map(e => ({ before: e.before, patch: e.patch })));
  const written = rows<{id: number}>(await db.execute(sql`
    with input as (select value from jsonb_array_elements(${payload}::jsonb)),
    source as (select value from jsonb_array_elements(${JSON.stringify(catalog)}::jsonb)),
    locked_cards as materialized (select c.* from cards c join source s on c.id=s.value->>'id' order by c.id for update of c),
    locked as materialized (select r.* from card_rules r join input i on r.id=(i.value->'before'->>'id')::int order by r.id for update of r),
    valid as materialized (select 1 where
      (select count(*) from locked_cards c join source s on c.id=s.value->>'id' where to_jsonb(c)=s.value)=2
      and (select count(*) from locked r join input i on r.id=(i.value->'before'->>'id')::int where to_jsonb(r)=i.value->'before' and r.source='compiler' and r.status in ('draft','open'))=4)
    update card_rules r set cost=nullif(i.value->'patch'->'cost','null'::jsonb),usage=i.value->'patch'->'usage',validity=i.value->'patch'->'validity',
      cond=case when i.value->'patch' ? 'cond' then nullif(i.value->'patch'->'cond','null'::jsonb) else r.cond end,
      ops=case when i.value->'patch' ? 'ops' then i.value->'patch'->'ops' else r.ops end,
      unread=case when i.value->'patch' ? 'unread' then i.value->'patch'->'unread' else r.unread end,
      pattern=case when i.value->'patch' ? 'pattern' then i.value->'patch'->>'pattern' else r.pattern end,
      reads=case when i.value->'patch' ? 'reads' then i.value->'patch'->>'reads' else r.reads end,
      status=coalesce(i.value->'patch'->>'status',r.status),version=r.version+1,updated_at=now()
    from input i where r.id=(i.value->'before'->>'id')::int and exists(select 1 from valid) returning r.id
  `));
  assert.deepEqual(written.map(r => r.id).sort((a, b) => a - b), DROP_BOTTOM_TARGETS.map(t => t.id), "stale row/catalog; atomic four-row update refused");
  return written.map(r => r.id).sort((a, b) => a - b);
}
