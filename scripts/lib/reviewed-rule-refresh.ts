import { sql } from "drizzle-orm";
import type { Db } from "../../src/db/index";
import { rows } from "../../src/db/rows";
import type { SkillRecord } from "../../src/lib/arena/draft";

export interface ReviewedRefresh {
  rules: { before: Record<string, unknown>; fresh: SkillRecord }[];
  catalog?: { id: string; before: string | null; after: string };
}

/** One atomic statement, including on Neon HTTP. Any stale review aborts the whole batch.
 * Locks precede comparison, so a concurrent owner edit cannot be overwritten. */
export async function applyReviewedRefresh(db: Db, plan: ReviewedRefresh): Promise<number[]> {
  if (!plan.rules.length || new Set(plan.rules.map(r => r.before.id)).size !== plan.rules.length)
    throw new Error("Empty or duplicate refresh targets");
  const payload = JSON.stringify(plan.rules);
  const result = rows<{ id: number }>(await db.execute(sql`
    with input as (select value->'before' as old, value->'fresh' as fresh
      from jsonb_array_elements(${payload}::jsonb)),
    locked as materialized (select r.* from card_rules r join input i
      on r.id = (i.old->>'id')::int order by r.id for update of r),
    catalog_locked as materialized (select id, skill from cards where id=${plan.catalog?.id ?? null} for update),
    valid as materialized (select 1 where
      (select count(*) from locked r join input i on r.id=(i.old->>'id')::int
        where to_jsonb(r)=i.old and r.source='compiler' and r.status in ('draft','open')
        and r.card_id=i.fresh->>'cardId' and r.side=i.fresh->>'side'
        and r.skill_index=(i.fresh->>'skillIndex')::int
        and i.fresh->'unread'='[]'::jsonb)=${plan.rules.length}
      and (${!plan.catalog} or exists(select 1 from catalog_locked where skill is not distinct from ${plan.catalog?.before ?? null}))),
    catalog_write as (update cards set skill=${plan.catalog?.after ?? null}
      where id=${plan.catalog?.id ?? null} and exists(select 1 from valid) returning id),
    rule_write as (update card_rules r set
      printed=i.fresh->>'printed', kind=i.fresh->>'kind', trigger=i.fresh->'trigger', combo=nullif(i.fresh->'combo','null'::jsonb),
      cost=nullif(i.fresh->'cost','null'::jsonb), cond=nullif(i.fresh->'cond','null'::jsonb),
      ops=i.fresh->'ops', unread=i.fresh->'unread', pattern=i.fresh->>'pattern',
      reads=i.fresh->>'reads', status='draft', version=r.version+1, updated_at=now()
      from input i where r.id=(i.old->>'id')::int and exists(select 1 from valid)
      and (${!plan.catalog} or exists(select 1 from catalog_write)) returning r.id)
    select id from rule_write order by id
  `));
  if (result.length !== plan.rules.length) throw new Error("Refresh refused: review is stale or target is no longer a readable compiler draft; no rows written");
  return result.map(r => r.id);
}

export interface ReviewedUnreadRefresh {
  rules: { before: Record<string, unknown>; fresh: SkillRecord }[];
}

/** Refresh compiler-owned rows whose fresh compile still leaves text unread (docs/handoff-2026-10-17-db-refresh.md).
 * Unlike applyReviewedRefresh it accepts ONLY fresh records with a non-empty `unread`, and sets status `open`
 * (an unread rule is a gap the owner must see, not a draft to approve). Same shape: one statement that locks,
 * compares the whole row, then swaps. Any stale or ineligible target aborts the whole batch with nothing written. */
export async function applyReviewedUnreadRefresh(db: Db, plan: ReviewedUnreadRefresh): Promise<number[]> {
  if (!plan.rules.length || new Set(plan.rules.map(r => r.before.id)).size !== plan.rules.length)
    throw new Error("Empty or duplicate refresh targets");
  if (plan.rules.some(r => !Array.isArray(r.fresh.unread) || !r.fresh.unread.length))
    throw new Error("Unread refresh accepts only records that still leave text unread");
  const payload = JSON.stringify(plan.rules);
  const result = rows<{ id: number }>(await db.execute(sql`
    with input as (select value->'before' as old, value->'fresh' as fresh
      from jsonb_array_elements(${payload}::jsonb)),
    locked as materialized (select r.* from card_rules r join input i
      on r.id = (i.old->>'id')::int order by r.id for update of r),
    valid as materialized (select 1 where
      (select count(*) from locked r join input i on r.id=(i.old->>'id')::int
        where to_jsonb(r)=i.old and r.source='compiler' and r.status in ('open','draft')
        and r.card_id=i.fresh->>'cardId' and r.side=i.fresh->>'side'
        and r.skill_index=(i.fresh->>'skillIndex')::int
        and jsonb_typeof(i.fresh->'unread')='array' and i.fresh->'unread'<>'[]'::jsonb)=${plan.rules.length}),
    rule_write as (update card_rules r set
      printed=i.fresh->>'printed', kind=i.fresh->>'kind', trigger=i.fresh->'trigger', combo=nullif(i.fresh->'combo','null'::jsonb),
      cost=nullif(i.fresh->'cost','null'::jsonb), cond=nullif(i.fresh->'cond','null'::jsonb),
      ops=i.fresh->'ops', unread=i.fresh->'unread', pattern=i.fresh->>'pattern',
      reads=i.fresh->>'reads', status='open', version=r.version+1, updated_at=now()
      from input i where r.id=(i.old->>'id')::int and exists(select 1 from valid) returning r.id)
    select id from rule_write order by id
  `));
  if (result.length !== plan.rules.length) throw new Error("Unread refresh refused: review is stale or target is not an open/draft compiler row; no rows written");
  return result.map(r => r.id);
}

/** Repair only condition metadata on an explicitly reviewed owner correction.
 * The owner program, trigger, status, source and explanation are never updated. */
export async function repairReviewedCondition(db: Db, before: Record<string, unknown>, cost: Record<string, unknown>): Promise<void> {
  if (before.source !== "user" || before.status !== "corrected" || before.cost !== null || !before.cond
    || JSON.stringify(cost.condition) !== JSON.stringify(before.cond)) throw new Error("Not a missing owner-condition metadata repair");
  const result=rows<{id:number}>(await db.execute(sql`
    with locked as materialized (select * from card_rules where id=${Number(before.id)} for update)
    update card_rules r set cost=${JSON.stringify(cost)}::jsonb,version=r.version+1,updated_at=now()
    where r.id=${Number(before.id)} and exists(select 1 from locked l where to_jsonb(l)=${JSON.stringify(before)}::jsonb)
    returning r.id
  `));
  if(result.length!==1) throw new Error("Owner condition repair refused: reviewed row changed; no write");
}
