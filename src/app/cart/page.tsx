import Link from "next/link";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { cards } from "@/db/schema";
import { hasAnthropic } from "@/lib/ai/client";
import { allocationForCards, buildConflicts, decksReservingFor, type Reserver } from "@/lib/decks/reservations";
import { cardTraderConfigured, cardTraderEnabled } from "@/lib/marketplace/cardtrader";
import { cartSettings, optimiseCart } from "@/lib/marketplace/cart";
import type { Want } from "@/lib/marketplace/optimizer";
import { listWants } from "@/lib/decks/swaps";
import { WantList } from "@/components/WantList";
import { formatCents } from "@/lib/money";
import { CartTools } from "@/components/CartTools";
import { SubmitButton } from "@/components/SubmitButton";
import { saveCartSettingsForm } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v || undefined);

/** Owned/reserved breakdown behind a want, so "missing" can be told apart from "owned but tied up in another deck". */
export interface WantBreakdown {
  owned: number;
  reservedElsewhere: number;
}

/** `?deck=12` → the deck's shortfall; `?cards=BT18-020:2,BT18-021:1` → explicit. */
async function wantsFrom(sp: Params): Promise<{ wants: Want[]; source: string; breakdown: Map<string, WantBreakdown>; deckId: number | null }> {
  const deck = one(sp.deck);
  if (deck) {
    const deckId = Number(deck);
    const conflicts = await buildConflicts(db, deckId);
    const breakdown = new Map(conflicts.map((c) => [c.cardId, { owned: c.owned, reservedElsewhere: c.reservedElsewhere }]));
    return { wants: conflicts.map((c) => ({ cardId: c.cardId, quantity: c.short })), source: `deck ${deck}`, breakdown, deckId };
  }
  if (one(sp.want) !== "0") {
    // Default source: the saved shopping list, so swap suggestions you parked
    // are priced without having to build a URL.
    const wants = await listWants(db);
    if (wants.length && !one(sp.cards)) {
      const mapped = wants.map((w) => ({ cardId: w.cardId, quantity: w.quantity }));
      const breakdown = await breakdownFor(mapped);
      return { wants: mapped, source: "shopping list", breakdown, deckId: null };
    }
  }
  const list = one(sp.cards) ?? "";
  const wants = list
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [id, q] = s.split(":");
      return { cardId: id.toUpperCase(), quantity: Math.max(1, Number(q) || 1) };
    });
  const breakdown = await breakdownFor(wants);
  return { wants, source: "list", breakdown, deckId: null };
}

async function breakdownFor(wants: Want[]): Promise<Map<string, WantBreakdown>> {
  const alloc = await allocationForCards(db, wants.map((w) => w.cardId));
  const out = new Map<string, WantBreakdown>();
  for (const [id, a] of alloc) out.set(id, { owned: a.owned, reservedElsewhere: a.reserved });
  return out;
}

export default async function CartPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const { wants, source, breakdown, deckId: sourceDeckId } = await wantsFrom(sp);
  const cfg = await cartSettings(db);
  const names = wants.length ? await db.select({ id: cards.id, name: cards.name }).from(cards).where(inArray(cards.id, wants.map((w) => w.cardId))) : [];
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  const result = wants.length ? await optimiseCart(db, wants, cfg) : null;
  const tiedUpIds = wants.filter((w) => (breakdown.get(w.cardId)?.reservedElsewhere ?? 0) > 0).map((w) => w.cardId);
  const reservers = tiedUpIds.length ? await decksReservingFor(db, tiedUpIds, sourceDeckId ?? undefined) : new Map<string, Reserver[]>();
  const input = "tap w-full rounded-md border border-space-600 bg-space-900 px-2 py-1 text-sm text-space-100";
  const deckId = one(sp.deck);

  return (
    <div className="space-y-5">
      <div>
        {deckId ? (
          <Link href={`/decks/${deckId}`} className="text-xs text-space-300 hover:text-ki-300">
            ← Deck
          </Link>
        ) : null}
        <h1 className="text-xl font-semibold text-space-50">Cart optimiser</h1>
        <p className="text-sm text-space-300">
          Cheapest combination of CardTrader sellers to cover a want-list, shipping counted once per seller.{" "}
          {!cardTraderConfigured() ? <span className="text-loss">No CardTrader token configured.</span> : !cardTraderEnabled() ? <span className="text-ki-300">Live calls are disabled (CARDTRADER_ENABLED=false) — working from cached listings only.</span> : null}
        </p>
      </div>

      <WantList rows={await listWants(db)} />

      {wants.length === 0 ? (
        <div className="rounded-xl border border-dashed border-space-700 p-6 text-sm text-space-300">
          <p>Nothing wanted yet. Open a deck that can&apos;t be built and choose &ldquo;Buy missing cards&rdquo;, or build a list in the URL:</p>
          <code className="mt-2 block font-mono text-xs text-space-100">/cart?cards=BT18-020:2,BT18-021:1</code>
        </div>
      ) : (
        <>
          <section className="rounded-xl border border-space-700/70 bg-space-900/50 p-3">
            <h2 className="mb-1 text-sm font-semibold text-space-50">Want-list ({source})</h2>
            <ul className="space-y-1 text-xs">
              {wants.map((w) => {
                const b = breakdown.get(w.cardId);
                const owned = b?.owned ?? 0;
                const tiedUp = b?.reservedElsewhere ?? 0;
                const holders = reservers.get(w.cardId) ?? [];
                return (
                  <li key={w.cardId} className="rounded bg-space-800 px-2 py-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <Link href={`/cards/${encodeURIComponent(w.cardId)}`} className="hover:text-ki-300">
                        {w.quantity}× {nameOf.get(w.cardId) ?? w.cardId} <span className="font-mono text-space-400">{w.cardId}</span>
                      </Link>
                      {owned > 0 ? (
                        <span className="text-space-400">
                          {owned} owned{tiedUp > 0 ? `, ${tiedUp} used elsewhere` : ""} · buying {w.quantity}
                        </span>
                      ) : null}
                    </div>
                    {tiedUp > 0 ? (
                      <p className="mt-0.5 text-loss">
                        Reserved by {holders.map((h, i) => (
                          <span key={h.id}>
                            {i > 0 ? ", " : ""}
                            <Link href={`/decks/${h.id}`} className="underline hover:text-ki-300">
                              {h.name}
                            </Link>{" "}
                            ({h.quantity})
                          </span>
                        ))}{" "}
                        — buy more, or break one of those decks up to free copies instead.
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <CartTools wants={wants} aiEnabled={hasAnthropic()} listingsCached={result?.listings ?? 0} fetchedAt={result?.fetchedAt?.toISOString() ?? null} />
          </section>

          {result && result.listings > 0 ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <PlanCard title="Cheapest" plan={result.best} nameOf={nameOf} refined={result.refinedSellers} />
              {result.fewestSellers && result.fewestSellers.totalCents !== result.best.totalCents ? <PlanCard title="Single seller" plan={result.fewestSellers} nameOf={nameOf} refined={result.refinedSellers} /> : null}
            </div>
          ) : result ? (
            <p className="rounded-xl border border-dashed border-space-700 p-4 text-sm text-space-300">No cached listings for these cards yet — fetch them above.</p>
          ) : null}
        </>
      )}

      <details className="rounded-xl border border-space-700/70 bg-space-900/50 p-3">
        <summary className="cursor-pointer text-sm font-semibold text-space-100">Shipping estimates & preferences</summary>
        <form action={saveCartSettingsForm} className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-space-300">
            CardTrader Zero parcel (€)
            <input name="hub" defaultValue={(cfg.hubShippingCents / 100).toFixed(2)} className={input} />
          </label>
          <label className="text-xs text-space-300">
            Direct seller estimate (€) <span className="text-space-400">— replaced by real rates when live</span>
            <input name="direct" defaultValue={(cfg.directShippingCents / 100).toFixed(2)} className={input} />
          </label>
          <label className="text-xs text-space-300">
            Only sellers from (country codes, blank = any)
            <input name="countries" defaultValue={cfg.countries.join(", ")} placeholder="AT, DE, IT" className={input} />
          </label>
          <label className="text-xs text-space-300">
            Soft preferences (for the AI explanation)
            <input name="preferences" defaultValue={cfg.preferences} placeholder="Prefer fewer sellers unless it costs more than €2" className={input} />
          </label>
          <SubmitButton pendingLabel="Saving…" className="tap rounded-md bg-space-700 px-3 py-1.5 text-sm text-space-50 hover:bg-space-600 sm:col-span-2">Save</SubmitButton>
        </form>
      </details>
    </div>
  );
}

function PlanCard({ title, plan, nameOf, refined }: { title: string; plan: import("@/lib/marketplace/optimizer").Plan; nameOf: Map<string, string>; refined: string[] }) {
  return (
    <section className="rounded-xl border border-space-700/70 bg-space-900/60 p-3">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold text-space-50">{title}</h2>
        <span className="text-lg font-semibold tabular-nums text-ki-300">{formatCents(plan.totalCents)}</span>
      </div>
      <p className="text-xs text-space-300">
        items {formatCents(plan.itemsCents)} + shipping {formatCents(plan.shippingCents)} · {plan.sellers.length} seller{plan.sellers.length === 1 ? "" : "s"}
      </p>
      <ul className="mt-2 space-y-2">
        {plan.sellers.map((s) => (
          <li key={s.seller} className="rounded-lg border border-space-800 p-2 text-sm">
            <div className="flex items-center gap-2">
              <a href={`https://www.cardtrader.com/en/users/${encodeURIComponent(s.seller)}`} target="_blank" rel="noreferrer" className="font-medium text-space-50 hover:text-ki-300">
                {s.seller}
              </a>
              <span className="rounded bg-space-800 px-1 text-[10px] text-space-300">{s.country}</span>
              <span className="ml-auto text-xs text-space-300">
                {formatCents(s.itemsCents)} + {formatCents(s.shippingCents)} ship{refined.includes(s.seller) ? " (live rate)" : " (est.)"}
              </span>
            </div>
            <ul className="mt-1 text-xs text-space-200">
              {s.lines.map((l) => (
                <li key={l.listing.id}>
                  {l.quantity}× {nameOf.get(l.listing.cardId) ?? l.listing.cardId} <span className="font-mono text-space-400">{l.listing.cardId}</span> @ {formatCents(l.listing.priceCents)}
                  {l.listing.condition ? <span className="text-space-400"> · {l.listing.condition}</span> : null}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {plan.missing.length ? (
        <p className="mt-2 text-xs text-loss">
          Not available: {plan.missing.map((m) => `${m.quantity}× ${nameOf.get(m.cardId) ?? m.cardId}`).join(", ")}
        </p>
      ) : null}
    </section>
  );
}
