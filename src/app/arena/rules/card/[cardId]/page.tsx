import { notFound } from "next/navigation";
import { db } from "@/db";
import { CardRules, type CardWalk } from "@/components/arena/rules/CardRules";
import { cardHref } from "@/lib/arena/rule-card";
import { isArenaAdmin, requireSlPage } from "@/lib/auth";
import { loadCardPage } from "../data";
import { walkQueue } from "../queue-cards";

export const dynamic = "force-dynamic";
export const metadata = { title: "Card rules" };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const positive = (v: string | undefined) => (v && /^\d+$/.test(v) && Number(v) > 0 ? Number(v) : null);

/**
 * `/arena/rules/card/[cardId]`: every skill of one card, with the health the whole
 * Rules area speaks (`ruleHealth`), what to do about each, and the editor opened in
 * place. `?skill=<rule id>` puts one skill in front, `?edit=1` opens its editor,
 * and `?q=` is the queue the card was opened from, so ‹ Previous and Next › walk it.
 * Reading is for any SL; every write checks `isArenaAdmin` in its own action.
 */
export default async function CardRulesPage({ params, searchParams }: { params: Promise<{ cardId: string }>; searchParams: Promise<Params> }) {
  await requireSlPage();
  const cardId = decodeURIComponent((await params).cardId);
  const sp = await searchParams;
  const [page, admin] = await Promise.all([loadCardPage(db, cardId), isArenaAdmin()]);
  if (!page) notFound();

  const q = one(sp.q);
  const found = await walkQueue(db, q, cardId);
  const walk: CardWalk | null = found && {
    label: found.label,
    index: found.index,
    total: found.total,
    prevHref: found.prev ? cardHref(found.prev.cardId, { q: found.q }) : null,
    nextHref: found.next ? cardHref(found.next.cardId, { q: found.q }) : null,
    nextName: found.next?.name ?? null,
  };

  return <CardRules card={page.card} skills={page.skills} history={page.history} walk={walk} backHref={`/arena/rules${q ? `?${q}` : ""}`} admin={admin} initialSkill={positive(one(sp.skill))} initialEdit={one(sp.edit) === "1"} />;
}
