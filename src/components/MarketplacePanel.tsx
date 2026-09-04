import { db } from "@/db";
import { blueprintsFor, cachedListings, cardTraderConfigured, cardTraderEnabled, externalLinks } from "@/lib/marketplace/cardtrader";
import { formatCents } from "@/lib/money";
import { refreshListingsForm } from "@/app/cards/marketplace-actions";
import { SubmitButton } from "@/components/SubmitButton";

/** CardTrader section on the card page: cached listings, refresh, deep links. */
export async function MarketplacePanel({ card, tcgUrl }: { card: { id: string; name: string; game?: string | null }; tcgUrl: string | null }) {
  const [bps, listings] = await Promise.all([blueprintsFor(db, card.id), cachedListings(db, [card.id])]);
  const links = externalLinks(card, tcgUrl, bps[0]?.cardMarketIds);
  const fetchedAt = listings[0]?.fetchedAt ?? null;

  return (
    <section>
      <h2 className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold uppercase tracking-wider text-space-300">
        Marketplace
        <span className="ml-auto flex gap-2 text-xs normal-case tracking-normal">
          <a href={links.cardtrader} target="_blank" rel="noreferrer" className="rounded border border-space-600 px-2 py-0.5 text-space-100 hover:bg-space-800">
            CardTrader ↗
          </a>
          <a href={links.cardmarket} target="_blank" rel="noreferrer" className="rounded border border-space-600 px-2 py-0.5 text-space-100 hover:bg-space-800">
            Cardmarket ↗
          </a>
          <a href={links.tcgplayer} target="_blank" rel="noreferrer" className="rounded border border-space-600 px-2 py-0.5 text-space-100 hover:bg-space-800">
            TCGplayer ↗
          </a>
        </span>
      </h2>
      {!cardTraderConfigured() ? (
        <p className="text-xs text-space-400">Add a CardTrader token to see EU listings here.</p>
      ) : bps.length === 0 ? (
        <p className="text-xs text-space-400">Not linked to a CardTrader blueprint yet — run the CardTrader catalog sync in Settings{cardTraderEnabled() ? "" : " (live calls are disabled)"}.</p>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-space-300">
            <span>
              {bps.length} blueprint{bps.length === 1 ? "" : "s"} · {listings.length} cached listing{listings.length === 1 ? "" : "s"}
              {fetchedAt ? ` · fetched ${fetchedAt.toISOString().replace("T", " ").slice(0, 16)}` : ""}
            </span>
            <form action={refreshListingsForm} className="ml-auto">
              <input type="hidden" name="cardId" value={card.id} />
              <SubmitButton disabled={!cardTraderEnabled()} pendingLabel="Refreshing…" className="tap rounded-md bg-ki-500 px-3 py-1 text-xs font-semibold text-space-950 hover:bg-ki-400">
                Refresh listings
              </SubmitButton>
            </form>
          </div>
          {listings.length ? (
            <div className="overflow-x-auto rounded-xl border border-space-700/70">
              <table className="w-full text-sm">
                <thead className="bg-space-900 text-left text-xs uppercase tracking-wide text-space-300">
                  <tr>
                    <th className="px-3 py-2">Seller</th>
                    <th className="px-3 py-2">Country</th>
                    <th className="px-3 py-2">Condition</th>
                    <th className="px-3 py-2 text-right">Price</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {listings.slice(0, 25).map((l) => (
                    <tr key={l.id} className={`border-t border-space-800 ${l.onVacation ? "opacity-50" : ""}`}>
                      <td className="px-3 py-1.5">
                        {l.seller} {l.canSellViaHub ? <span className="rounded bg-space-800 px-1 text-[10px] text-space-300">Zero</span> : null}
                        {l.onVacation ? <span className="ml-1 text-[10px] text-loss">on vacation</span> : null}
                      </td>
                      <td className="px-3 py-1.5 text-space-300">{l.countryCode}</td>
                      <td className="px-3 py-1.5 text-space-300">
                        {l.condition ?? "—"} {l.foil ? "· foil" : ""} {l.language ? `· ${l.language}` : ""}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatCents(l.priceCents, l.currency === "USD" ? "USD" : "EUR")}</td>
                      <td className="px-3 py-1.5 text-right">{l.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
