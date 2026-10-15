import { db } from "@/db";
import { RuleReview } from "@/components/arena/rules/RuleReview";
import { isArenaAdmin, requireSlPage } from "@/lib/auth";
import { deckCardSets } from "@/lib/arena/readiness";
import { recentFired, reviewQueue } from "@/lib/arena/rule-review-store";
import { listDecks } from "@/lib/decks/queries";
import { parseQueue, queueHref } from "@/lib/arena/queue";
import { worklistPage } from "@/lib/arena/rules-store";
import { firedInGame } from "@/lib/arena/fired";
import { PageHeader, Panel } from "@/components/ui";

export const dynamic = "force-dynamic";

/** The same scoped queue as the workbench, presented one skill at a time on either device. */
export default async function RuleReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireSlPage();
  const raw = await searchParams;
  const qu = parseQueue(raw);
  const decks = (await listDecks(db, { game: "dbs" })).filter((d) => d.leader && d.mainCount >= 50);
  const deckCards = await deckCardSets(db, decks.map((d) => d.id));
  const decksOf = new Map<string, string[]>();
  for (const d of decks) for (const id of deckCards.get(d.id) ?? []) decksOf.set(id, [...(decksOf.get(id) ?? []), d.name]);
  const deckId = qu.scope.kind === "deck" ? qu.scope.id : null;
  const deck = decks.find((d) => d.id === deckId);
  // An invalid scope is never silently widened to all decks.
  const cardIds = qu.scope.kind === "catalog" || qu.scope.kind === "game" ? undefined : qu.scope.kind === "deck" ? [...(deckCards.get(qu.scope.id) ?? [])] : [...decksOf.keys()];
  const recent = qu.scope.kind === "game" ? { gameId: qu.scope.id, fired: await firedInGame(db, qu.scope.id) } : await recentFired(db, deck?.id ?? null);
  const firedKeys = new Set(recent.fired.map((f) => `${f.cardId}\u0000${f.skillIndex}`));
  const matched = await worklistPage(db, { cardIds, status: qu.state ?? undefined, q: qu.q || undefined, setCode: qu.set || undefined, source: qu.source || undefined, pattern: qu.pattern || undefined, mechanism: qu.mech || undefined, compilerDiff: qu.reason === "diff", costUnknown: qu.reason === "cost" }, { limit: 100000, offset: 0 });
  const rows = matched.rows.filter((r) => (r.status === "open" || r.status === "draft") && (qu.scope.kind !== "game" || firedKeys.has(`${r.cardId}\u0000${r.skillIndex}`)));
  const flaggedOnly = raw.flagged === "1";
  const [items, admin] = await Promise.all([reviewQueue(db, { cardIds: [...new Set(rows.map((r) => r.cardId))], ruleIds: rows.map((r) => r.id), flaggedOnly, decksOf, recent }), isArenaAdmin()]);
  const backHref = queueHref(qu);
  const reviewHref = `/arena/rules/review${backHref.slice("/arena/rules".length)}`;
  const flagged = (await reviewQueue(db, { cardIds: [...new Set(rows.map((r) => r.cardId))], ruleIds: rows.map((r) => r.id), flaggedOnly: true, decksOf, recent })).length;
  return <div className="space-y-4"><PageHeader title="Guided rule review" eyebrow="Arena rules" description="Review one skill at a time against its printed card text." /><Panel className="p-0"><RuleReview items={items} scope={deck?.name ?? (qu.scope.kind === "catalog" ? "Whole catalog" : qu.scope.kind === "game" ? `Skills used in game ${qu.scope.id}` : qu.scope.kind === "deck" ? "Deck unavailable — choose another scope" : "All playable Masters decks (all owners)")} backHref={backHref} reviewHref={reviewHref} flagged={flagged} flaggedOnly={flaggedOnly} startId={qu.rule} admin={admin} /></Panel></div>;
}
