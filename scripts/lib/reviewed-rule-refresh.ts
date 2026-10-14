import { sql } from "drizzle-orm";
import type { Db } from "../../src/db/index";
import { rows } from "../../src/db/rows";
import type { SkillRecord } from "../../src/lib/arena/draft";

export interface ReviewedRefresh {
  rules: { before: Record<string, unknown>; fresh: SkillRecord }[];
  catalog: { id: string; before: string | null; after: string };
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
    catalog_locked as materialized (select id, skill from cards where id=${plan.catalog.id} for update),
    valid as materialized (select 1 where
      (select count(*) from locked r join input i on r.id=(i.old->>'id')::int
        where to_jsonb(r)=i.old and r.source='compiler' and r.status='draft'
        and r.card_id=i.fresh->>'cardId' and r.side=i.fresh->>'side'
        and r.skill_index=(i.fresh->>'skillIndex')::int
        and i.fresh->'unread'='[]'::jsonb)=${plan.rules.length}
      and exists(select 1 from catalog_locked where skill is not distinct from ${plan.catalog.before})),
    catalog_write as (update cards set skill=${plan.catalog.after}
      where id=${plan.catalog.id} and exists(select 1 from valid) returning id),
    rule_write as (update card_rules r set
      printed=i.fresh->>'printed', kind=i.fresh->>'kind', trigger=i.fresh->'trigger',
      cost=nullif(i.fresh->'cost','null'::jsonb), cond=nullif(i.fresh->'cond','null'::jsonb),
      ops=i.fresh->'ops', unread=i.fresh->'unread', pattern=i.fresh->>'pattern',
      reads=i.fresh->>'reads', version=r.version+1, updated_at=now()
      from input i where r.id=(i.old->>'id')::int and exists(select 1 from valid)
      and exists(select 1 from catalog_write) returning r.id)
    select id from rule_write order by id
  `));
  if (result.length !== plan.rules.length) throw new Error("Refresh refused: review is stale or target is no longer a readable compiler draft; no rows written");
  return result.map(r => r.id);
}
