import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { FullRuleBuilder } from "@/components/arena/rules/FullRuleBuilder";
import { isArenaAdmin, requireSlPage } from "@/lib/auth";
import type { Rule } from "@/lib/arena/lang";
import { openingFocus } from "@/lib/arena/lang/blocks";
import { rulesReturnHref } from "@/lib/arena/rule-review";
import { ruleById } from "@/lib/arena/rules-store";
import type { Cond, CostRecord, Op } from "@/lib/arena/vm/script";
import type { Trigger } from "@/lib/arena/types";
import { probeScenarios } from "../../record";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit interpretation" };

/**
 * The block builder for one skill (#469), full screen: `/arena/rules/build/[id]`,
 * `id` being the `card_rules` row. The record's Edit opens it, and so does an
 * open card, which arrives with its readable clauses filled and the unread
 * one empty and in focus. `?focus=ops[1]` opens on any block by its `RulePath`.
 */
export default async function BuildRulePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireSlPage();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const row = await ruleById(db, id);
  if (!row) notFound();
  const sp = await searchParams;
  const rule: Rule = {
    kind: row.kind,
    trigger: (row.trigger ?? []) as Trigger[],
    ...(row.combo != null ? { combo: row.combo as import("@/lib/arena/lang/ast").Rule["combo"] } : {}),
    cost: (row.cost as CostRecord | null) ?? null,
    cond: (row.cond as Cond | null) ?? null,
    ops: (row.ops as Op[]) ?? [],
  };
  const [probe, canSave] = await Promise.all([probeScenarios(db, row), isArenaAdmin()]);
  const focus = openingFocus(rule, typeof sp.focus === "string" ? sp.focus : null, row.status === "open" ? row.unread : []);
  const back = rulesReturnHref(sp.returnTo, `/arena/rules?rule=${id}`);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Arena rules builder" title="Edit interpretation" description={`${row.name} · skill ${Math.floor(row.skillIndex / 10) + 1}${row.side === "back" ? " · awakened side" : ""} · ${row.status}`} actions={
        <Link href={back} className="tap flex items-center rounded-lg px-2 text-sm text-space-300 hover:text-space-50" aria-label="Back to the rule">
          ←
        </Link>
      } />
      <FullRuleBuilder
        ruleId={id}
        initialRule={rule}
        focusPath={focus ?? undefined}
        card={{ cardId: row.cardId, name: row.name, printed: row.printed, unread: row.status === "open" ? row.unread : [] }}
        scenarios={probe?.scenarios}
        backHref={back}
        canSave={canSave}
      />
    </div>
  );
}
