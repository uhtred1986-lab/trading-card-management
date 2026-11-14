"use client";

import Link from "next/link";
import { createContext, useContext, useMemo, useState } from "react";
import { CardSwipeViewer, type SwipeItem } from "./CardSwipeViewer";

/**
 * The swipe viewer on the Dragon Ball grids (docs/pokemon/plan.md §10 item 10). `/collection` and
 * `/cards` wrap their grid in `CardViewerProvider` and give it the cards of the list that is on screen
 * (one page, as filtered); a tile marked `viewable` puts a button over its picture (`OpenInViewer`)
 * that opens the viewer at that card. The tile's name, number and price stay a link to `/cards/<id>`,
 * and the viewer's footer has the same link, so the card page is one tap away from either side.
 *
 * English labels (the component's defaults). The facts are the tile's (number, rarity, colours, price,
 * owned copies, banned / limited) in the info row and footer, and the card page's stat list
 * (`cardStats`, worked out on the server) in the Details sheet.
 */
export interface ViewerCard {
  id: string;
  name: string;
  setCode: string;
  cardType: string;
  colors: string[];
  rarityCode: string;
  imageUrl: string | null;
  photoId?: number | null;
  isBanned?: boolean;
  isLimited?: boolean;
  priceLabel?: string | null;
  ownedQty?: number;
  foilQty?: number;
  /** `cardStats(card)` of the shared card page: label / value pairs. */
  stats: { label: string; value: string }[];
}

interface ViewerItem extends SwipeItem {
  card: ViewerCard;
}

const Open = createContext<((id: string) => void) | null>(null);

export function CardViewerProvider({ cards, children }: { cards: ViewerCard[]; children: React.ReactNode }) {
  const [open, setOpen] = useState<number | null>(null);
  const items = useMemo<ViewerItem[]>(
    () =>
      cards.map((card) => ({
        id: card.id,
        card,
        image: card.photoId ? `/api/card-photo/${card.photoId}` : card.imageUrl,
        alt: `${card.name} (${card.id})`,
        title: card.name,
        subtitle: [[card.id, card.rarityCode, card.cardType].filter(Boolean).join(" · "), card.colors.join(", ")].filter(Boolean),
        side: card.priceLabel ? <strong>{card.priceLabel}</strong> : undefined,
      })),
    [cards],
  );
  const openById = useMemo(() => {
    const index = new Map(cards.map((c, i) => [c.id, i]));
    return (id: string) => {
      const i = index.get(id);
      if (i !== undefined) setOpen(i);
    };
  }, [cards]);

  return (
    <Open.Provider value={openById}>
      {children}
      {open !== null && items[open] ? (
        <CardSwipeViewer
          items={items}
          startIndex={open}
          onClose={() => setOpen(null)}
          renderFooter={({ item }) => <CardFooter card={item.card} />}
          renderDetail={({ item }) => <CardFacts card={item.card} />}
          detailColumn
        />
      ) : null}
    </Open.Provider>
  );
}

/** The button over a tile's picture. Outside a provider it renders its children alone. */
export function OpenInViewer({ cardId, label, children }: { cardId: string; label: string; children: React.ReactNode }) {
  const open = useContext(Open);
  if (!open) return <>{children}</>;
  return (
    <button type="button" className="block w-full text-left" onClick={() => open(cardId)} aria-label={label} aria-haspopup="dialog">
      {children}
    </button>
  );
}

function CardFooter({ card }: { card: ViewerCard }) {
  const marks = [card.isBanned ? "Banned" : card.isLimited ? "Limited" : null, card.ownedQty ? `${card.ownedQty} owned${card.foilQty ? `, ${card.foilQty} foil` : ""}` : null].filter(Boolean);
  return (
    <div className="space-y-2">
      {marks.length ? <p className="text-center text-sm text-white/80">{marks.join(" · ")}</p> : null}
      <Link href={`/cards/${encodeURIComponent(card.id)}`} className="csv-big" style={{ textDecoration: "none" }}>
        Open card page
      </Link>
    </div>
  );
}

function CardFacts({ card }: { card: ViewerCard }) {
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {card.stats.map((s) => (
          <div key={s.label} className="contents">
            <dt className="font-semibold">{s.label}</dt>
            <dd>{s.value}</dd>
          </div>
        ))}
      </dl>
      <Link href={`/cards/${encodeURIComponent(card.id)}`} className="inline-block min-h-11 py-2 font-semibold underline">
        Open card page
      </Link>
    </div>
  );
}
