import Link from "next/link";
import { CardImage } from "./CardImage";
import { ColorPill, RarityBadge } from "./ColorPill";

export interface CardTileData {
  id: string;
  name: string;
  setCode: string;
  cardType: string;
  colors: string[];
  rarityCode: string;
  imageUrl: string | null;
  isBanned?: boolean;
  isLimited?: boolean;
}

/**
 * Grid tile shared by the catalog and the collection.
 *
 * The link covers the tile's content but not the top-right corner: `badge`
 * can be an interactive control (the collection's copies popover), which
 * would be invalid HTML nested inside an anchor.
 */
export function CardTile({
  card,
  priceLabel,
  ownedQty,
  foilQty,
  badge,
  footer,
  href,
}: {
  card: CardTileData;
  priceLabel?: string | null;
  ownedQty?: number;
  /** Shown as its own chip so foils are countable without opening the card. */
  foilQty?: number;
  /** Replaces the plain ×N / ✦N chips in the corner. */
  badge?: React.ReactNode;
  footer?: React.ReactNode;
  href?: string;
}) {
  return (
    <div className="group relative rounded-xl border border-space-700/70 bg-space-900/60 p-2 transition hover:border-ki-500/50 hover:bg-space-800/70">
      <Link href={href ?? `/cards/${encodeURIComponent(card.id)}`} className="flex flex-col gap-1.5">
        <div className="relative">
          <CardImage src={card.imageUrl} alt={`${card.name} (${card.id})`} />
          {card.isBanned ? (
            <span className="absolute left-1 top-1 rounded bg-dbs-red px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">Banned</span>
          ) : card.isLimited ? (
            <span className="absolute left-1 top-1 rounded bg-dbs-yellow px-1.5 py-0.5 text-[10px] font-bold uppercase text-space-950">Limited</span>
          ) : null}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-space-50 group-hover:text-ki-300">{card.name}</div>
          <div className="flex items-center justify-between gap-1 text-xs text-space-300">
            <span className="font-mono">{card.id}</span>
            <RarityBadge code={card.rarityCode} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {card.colors.map((c) => (
            <ColorPill key={c} color={c} small />
          ))}
          {priceLabel ? <span className="ml-auto text-xs font-medium text-space-100">{priceLabel}</span> : null}
        </div>
        {footer}
      </Link>

      <div className="absolute right-3 top-3 z-20 flex flex-col items-end gap-1">
        {badge ??
          (ownedQty ? (
            <>
              <span className="rounded-md bg-ki-500 px-1.5 py-0.5 text-xs font-bold text-space-950 shadow" title={`${ownedQty} owned`}>
                ×{ownedQty}
              </span>
              {foilQty ? (
                <span
                  className="rounded-md bg-gradient-to-r from-yellow-200 via-amber-300 to-yellow-400 px-1.5 py-0.5 text-[10px] font-bold text-space-950 shadow"
                  title={`${foilQty} foil of ${ownedQty}`}
                >
                  ✦{foilQty}
                </span>
              ) : null}
            </>
          ) : null)}
      </div>
    </div>
  );
}
