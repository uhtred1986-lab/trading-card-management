import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { cardHref } from "@/lib/arena/rule-card";
import { ruleById } from "@/lib/arena/rules-store";
import { requireSlPage } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * The full-screen builder (#469) lives on the Card rules page now: the old link,
 * `/arena/rules/build/[id]` (`id` being the `card_rules` row), opens that card on
 * the skill with its editor open. The old `?focus=` and `?returnTo=` are not
 * carried: the editor opens on the first thing to fix, and the card page has its
 * own way back to the queue.
 */
export default async function BuildRulePage({ params }: { params: Promise<{ id: string }> }) {
  await requireSlPage();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const row = await ruleById(db, id);
  if (!row) notFound();
  redirect(cardHref(row.cardId, { skill: id, edit: true }));
}
