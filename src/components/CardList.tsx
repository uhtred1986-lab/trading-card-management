import Link from "next/link";
import { CardImage } from "./CardImage";
import { ColorPill, RarityBadge, TypeBadge } from "./ColorPill";
import type { CardTileData } from "./CardTile";

export interface CardListRow {
  card: CardTileData;
  priceLabel?: string | null;
  ownedQty?: number;
}

/**
 * The catalog as rows. Read-only on purpose: a catalog card is not a thing you
 * own, so there is nothing here to select and edit — that lives on the
 * collection's list, which is per-copy.
 */
export function CardList({ rows }: { rows: CardListRow[] }) {
  const cell = "px-2 py-1.5 align-middle";
  const head = "px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-space-400";

  return (
    <div className="overflow-x-auto rounded-xl border border-space-700/70 bg-space-900/40">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <thead className="border-b border-space-700 bg-space-900/80">
          <tr>
            <th className={`${head} w-10`} />
            <th className={head}>Card</th>
            <th className={`${head} hidden sm:table-cell`}>Set</th>
            <th className={`${head} hidden md:table-cell`}>Type</th>
            <th className={head}>Colours</th>
            <th className={`${head} w-14 text-right`}>Owned</th>
            <th className={`${head} text-right`}>Price</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ card, priceLabel, ownedQty }) => (
            <tr key={card.id} className="border-b border-space-800/70 last:border-0 hover:bg-space-800/40">
              <td className={cell}>
                <Link href={`/cards/${encodeURIComponent(card.id)}`} className="block w-9">
                  <CardImage src={card.imageUrl} alt={card.name} sizes="36px" />
                </Link>
              </td>
              <td className={cell}>
                <Link href={`/cards/${encodeURIComponent(card.id)}`} className="block min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-medium text-space-50 hover:text-ki-300">{card.name}</span>
                    {card.isBanned ? (
                      <span className="shrink-0 rounded bg-dbs-red px-1 text-[10px] font-bold uppercase text-white">Banned</span>
                    ) : card.isLimited ? (
                      <span className="shrink-0 rounded bg-dbs-yellow px-1 text-[10px] font-bold uppercase text-space-950">Limited</span>
                    ) : null}
                  </span>
                  <span className="font-mono text-[11px] text-space-400">{card.id}</span>
                </Link>
              </td>
              <td className={`${cell} hidden sm:table-cell`}>
                <span className="flex items-center gap-1.5 text-xs text-space-300">
                  <span className="font-mono">{card.setCode}</span>
                  <RarityBadge code={card.rarityCode} />
                </span>
              </td>
              <td className={`${cell} hidden md:table-cell`}>
                <TypeBadge type={card.cardType} />
              </td>
              <td className={cell}>
                <span className="flex flex-wrap items-center gap-1">
                  {card.colors.map((c) => (
                    <ColorPill key={c} color={c} small />
                  ))}
                </span>
              </td>
              <td className={`${cell} text-right`}>
                {ownedQty ? (
                  <span className="rounded-md bg-ki-500 px-1.5 py-0.5 text-xs font-bold text-space-950">×{ownedQty}</span>
                ) : (
                  <span className="text-xs text-space-600">—</span>
                )}
              </td>
              <td className={`${cell} text-right text-xs`}>
                {priceLabel ? <span className="font-medium text-space-100">{priceLabel}</span> : <span className="text-space-500">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
