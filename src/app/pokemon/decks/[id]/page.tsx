import { inArray, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { cardSets, cards } from "@/db/schema";
import { currentScope, requireSignedInPage } from "@/lib/auth";
import { hasAnthropic } from "@/lib/ai/client";
import { cardGroupsFor, getDeck } from "@/lib/decks/queries";
import { copyLimit } from "@/lib/decks/legality";
import { pokemonFormatOf } from "@/lib/decks/pokemonLegality";
import { suggestionsForDeck } from "@/lib/decks/swaps";
import { PK } from "@/lib/pokemon/copy";
import { wishedAmong } from "@/lib/pokemon/collection";
import { lowImage, type PokemonTile } from "@/lib/pokemon/client";
import { wishedCopies } from "@/lib/pokemon/deck-data";
import { missingCopies, summariseIssues } from "@/lib/pokemon/deck-logic";
import { pokemonDecks } from "@/lib/pokemon/views";
import { pokemonDetails, tcgdexIdOf } from "@/lib/pokemon/types";
import { DeckScreen, type DeckRowData } from "@/components/pokemon/DeckScreen";

export const dynamic = "force-dynamic";

/**
 * Ein Deck: the legality panel, the cards by group with what she owns, and the verbs (search, wish what is
 * missing, build, Claude). A deck that is not the viewer's answers not found, as everywhere.
 */
export default async function PokemonDeckPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireSignedInPage();
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const scope = await currentScope();
  const deck = await getDeck(db, id, scope);
  if (!deck) notFound();
  // A Dragon Ball deck has its own page.
  if (deck.game !== "pokemon") redirect(`/decks/${id}`);

  const cardIds = [...new Set(deck.cards.map((c) => c.cardId))];
  const [setRows, wishes, viewerWishes, decks, suggestions] = await Promise.all([
    cardIds.length ? db.select({ id: cards.id, setName: cardSets.name }).from(cards).innerJoin(cardSets, eq(cardSets.code, cards.setCode)).where(inArray(cards.id, cardIds)) : Promise.resolve([]),
    wishedCopies(db, deck.owner, cardIds),
    wishedAmong(db, viewer, cardIds),
    pokemonDecks(db, scope),
    suggestionsForDeck(db, id),
  ]);
  const setNames = new Map(setRows.map((r) => [r.id, r.setName]));
  const missing = missingCopies(deck.cards.map((c) => ({ cardId: c.cardId, quantity: c.quantity, owned: c.alloc.owned })));
  const missingBy = new Map(missing.lines.map((l) => [l.cardId, l.missing]));
  const groups = cardGroupsFor("pokemon") ?? [];

  const rows: DeckRowData[] = deck.cards.map((c) => {
    const d = pokemonDetails(c.details);
    const tile: PokemonTile = {
      id: c.cardId,
      tcgdexId: d.tcgdexId ?? tcgdexIdOf(c.cardId) ?? c.cardId,
      name: c.name,
      altName: d.names?.en && d.names.en !== c.name ? d.names.en : d.names?.de && d.names.de !== c.name ? d.names.de : null,
      setName: setNames.get(c.cardId) ?? "",
      localId: d.localId ?? "",
      setTotal: d.setTotal ?? null,
      imageLow: lowImage(c.imageUrl),
      imageHigh: c.imageUrl,
    };
    const flag = deck.legality.flags[`${c.zone}:${c.cardId}`] ?? null;
    return {
      key: `${c.zone}:${c.cardId}`,
      cardId: c.cardId,
      zone: c.zone,
      quantity: c.quantity,
      group: c.zone === "main" && groups.includes(c.cardType) ? c.cardType : "OTHER",
      tile,
      owned: c.alloc.owned,
      missing: missingBy.get(c.cardId) ?? 0,
      wishedQty: wishes[c.cardId] ?? 0,
      limit: Number.isFinite(copyLimit(c, "pokemon")) ? copyLimit(c, "pokemon") : 99,
      flag: flag ? { severity: flag.severity, label: flag.label } : null,
    };
  });

  const issues = summariseIssues(deck.legality.issues);
  return (
    <DeckScreen
      deck={{ id: deck.id, name: deck.name, format: pokemonFormatOf(deck.format), isBuilt: deck.isBuilt, count: deck.legality.mainCount, status: deck.legality.status, ownerLabel: viewer.kind === "sl" && deck.owner !== viewer.owner ? PK.decks.ownerLabel(deck.owner) : null }}
      issues={issues}
      rows={rows}
      groupOrder={groups}
      missingTotal={missing.total}
      viewerDecks={decks}
      viewerWishedIds={viewerWishes}
      claude={{ enabled: hasAnthropic(), aiSummary: deck.aiSummary, aiSummaryAt: deck.aiSummaryAt?.toISOString() ?? null, openSuggestions: [...suggestions.values()].reduce((n, l) => n + l.length, 0) }}
    />
  );
}
