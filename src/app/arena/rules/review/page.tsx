import { db } from "@/db";
import { RuleReview } from "@/components/arena/rules/RuleReview";
import { isArenaAdmin, requireSlPage } from "@/lib/auth";
import { deckCardSets } from "@/lib/arena/readiness";
import { recentFired, reviewQueue } from "@/lib/arena/rule-review-store";
import { listDecks } from "@/lib/decks/queries";

export const dynamic = "force-dynamic";

/**
 * Rule review on the phone (#472): the open and draft skills of one deck
 * (`?deck=<id>`, how the Arena home's locked deck links here) or of every deck
 * the arena can play, one card at a time, text first.
 *
 * Decks are read without a `viewer`, as on `/arena/rules` (owner's ruling on
 * #364): a rule belongs to its card, whoever owns the deck. A deck that is gone
 * falls back to all decks.
 *
 * A non-admin sees the queue read-only (`isArenaAdmin()`, #350); the writes
 * check it again themselves.
 */
export default async function RuleReviewPage({ searchParams }: { searchParams: Promise<{ deck?: string }> }) {
  await requireSlPage();
  const wanted = Number((await searchParams).deck);
  const decks = (await listDecks(db, { game: "dbs" })).filter((d) => d.leader && d.mainCount >= 50);
  const deckCards = await deckCardSets(
    db,
    decks.map((d) => d.id),
  );
  const decksOf = new Map<string, string[]>();
  for (const d of decks) for (const id of deckCards.get(d.id) ?? []) decksOf.set(id, [...(decksOf.get(id) ?? []), d.name]);

  const deck = decks.find((d) => d.id === wanted && deckCards.has(d.id)) ?? null;
  const cardIds = deck ? [...deckCards.get(deck.id)!] : [...decksOf.keys()];
  const recent = await recentFired(db, deck?.id ?? null);
  const [items, admin] = await Promise.all([reviewQueue(db, { cardIds, decksOf, recent }), isArenaAdmin()]);

  return <RuleReview items={items} scope={deck?.name ?? "All decks"} backHref={deck ? `/arena?deck=${deck.id}` : "/arena"} admin={admin} />;
}
