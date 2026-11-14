"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatCents } from "@/lib/money";
import { PK } from "@/lib/pokemon/copy";
import { reasonLine } from "@/lib/pokemon/deck-logic";
import type { PokemonDeckRow, WishEntry } from "@/lib/pokemon/views";
import { PageTop } from "./PageTop";
import { PokemonTileCard } from "./PokemonTileCard";
import { PokemonViewer } from "./PokemonViewer";
import { useWishes } from "./useWishes";

/**
 * Wünsche: the cards she hearted, a price per card and a total. A tapped heart takes the card off
 * the wishes (the tile stays, empty heart, until she leaves: tap again to take it back, and the
 * total follows). A tap on the picture opens the swipe viewer.
 */
export function WishesScreen({ entries, decks }: { entries: WishEntry[]; decks: PokemonDeckRow[] }) {
  const { wished, toggle, merge, notice } = useWishes(entries.map((e) => e.id));
  const [open, setOpen] = useState<number | null>(null);

  const kept = useMemo(() => entries.filter((e) => wished.has(e.id)), [entries, wished]);
  const totalCents = kept.reduce((n, e) => n + (e.priceCents ?? 0) * e.wanted, 0);
  const unpriced = kept.filter((e) => e.priceCents == null).length;

  return (
    <div className="pk-area">
      <PageTop title={PK.wishes.title} sub={entries.length ? PK.wishes.count(kept.length) : undefined} />

      {entries.length === 0 ? (
        <div className="pk-panel pk-empty">
          <p>{PK.wishes.empty}</p>
          <Link href="/pokemon/discover" className="pk-cta">
            {PK.wishes.emptyAction}
          </Link>
        </div>
      ) : (
        <>
          <div className="pk-grid">
            {entries.map((e, i) => (
              <PokemonTileCard
                key={e.id}
                tile={e}
                onOpen={() => setOpen(i)}
                wished={wished.has(e.id)}
                onToggleWish={toggle}
                caption={
                  <>
                    {e.wanted > 1 ? <span>{PK.wishes.wantCopies(e.wanted)}</span> : null}
                    {reasonLine(e.lackingDecks) ? <span className="pk-reason">{reasonLine(e.lackingDecks)}</span> : null}
                  </>
                }
              />
            ))}
          </div>
          <div className="pk-panel" style={{ marginTop: 12 }}>
            <div className="pk-total">
              <span>{PK.wishes.total}</span>
              <span>{formatCents(totalCents)}</span>
            </div>
            <p className="pk-note">
              {PK.wishes.totalNote}
              {unpriced > 0 ? ` ${PK.common.priceUnknown}: ${unpriced}.` : ""}
            </p>
          </div>
        </>
      )}

      <p role="status" aria-live="polite" className={notice ? "pk-live" : "sr-only"}>
        {notice}
      </p>

      {open !== null && entries[open] ? <PokemonViewer tiles={entries} startIndex={open} decks={decks} wished={wished} onToggleWish={toggle} onWishKnown={(id) => merge([id])} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
