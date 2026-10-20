import { notFound } from "next/navigation";
import { CardFlagBadge, DeckStatusBadge } from "@/components/DeckStatusBadge";
import { DeckIssues } from "@/components/decks/DeckIssues";
import { requireSignedInPage } from "@/lib/auth";
import { legality, type LegalityCard } from "@/lib/decks/legality";

export const dynamic = "force-dynamic";

/**
 * Dev-only: a deck's legality panel on a synthetic deck, with no database behind it, so the flags the
 * deck-building clauses raise (#1146) can be opened and shot in a session that keeps off Neon. The rows
 * run through the real `legality()`; only the cards are made up. Production answers 404.
 */
const LEADER_TEXT = "[Permanent] You can't include non-white Extra in your deck.";
const ONE_Z = "[Permanent] You can only include 1 copy of this card in your Z-Deck.";
const FREE = "[Permanent] You can include as many copies of this card in your deck as you like.";

const row = (cardId: string, zone: string, quantity: number, over: Partial<LegalityCard> = {}): LegalityCard => ({
  cardId, zone, quantity, name: cardId, cardType: zone === "z" ? "Z-BATTLE" : "BATTLE", colors: ["White"], limitedTo: null, isBanned: false, game: "dbs", ...over,
});

const ROWS: LegalityCard[] = [
  row("BT0-LEADER", "leader", 1, { name: "Fixture Cell", cardType: "LEADER", skill: LEADER_TEXT }),
  ...Array.from({ length: 6 }, (_, i) => row(`BT0-${String(i + 1).padStart(3, "0")}`, "main", 4, { name: `Fixture Battle ${i + 1}` })),
  row("BT0-100", "main", 4, { name: "Fixture White Extra", cardType: "EXTRA" }),
  row("BT0-101", "main", 4, { name: "Fixture Red Extra", cardType: "EXTRA", colors: ["Red"] }),
  row("BT0-102", "main", 4, { name: "Fixture Blue Extra", cardType: "EXTRA", colors: ["Blue"] }),
  row("BT0-103", "main", 9, { name: "Fixture Free Card", skill: FREE }),
  row("BT0-104", "main", 5, { name: "Fixture Plain Card" }),
  row("BT0-Z01", "z", 2, { name: "Fixture One-Copy Z", skill: ONE_Z }),
];

export default async function DeckLegalityPreviewPage() {
  await requireSignedInPage();
  if (process.env.NODE_ENV === "production") notFound();
  const result = legality(ROWS, "dbs");
  return (
    <div className="ds-panel mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-extrabold text-space-50">Fixture deck</h1>
        <DeckStatusBadge status={result.status} />
      </div>
      <DeckIssues legality={result} game="dbs" />
      <ul className="divide-y divide-space-700/70 rounded-xl border border-space-700 text-sm">
        {ROWS.map((r) => {
          const flag = result.flags[`${r.zone}:${r.cardId}`];
          return (
            <li key={`${r.zone}:${r.cardId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <span className="w-10 shrink-0 text-xs font-bold uppercase text-space-400">{r.zone}</span>
              <span className="min-w-0 flex-1 truncate text-space-100">
                {r.quantity}× {r.name}
              </span>
              {flag ? <CardFlagBadge {...flag} /> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
