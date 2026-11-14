import Link from "next/link";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { cardPrints, cards } from "@/db/schema";
import { hasAnthropic } from "@/lib/ai/client";
import { allocationForCards, buildConflicts, decksReservingFor, type Reserver } from "@/lib/decks/reservations";
import { cardTraderConfigured, cardTraderEnabled } from "@/lib/marketplace/cardtrader";
import { cartSettings, listingFilterFrom, optimiseCart } from "@/lib/marketplace/cart";
import type { Want } from "@/lib/marketplace/optimizer";
import { wishLabel, wishSources, wishesOf } from "@/lib/marketplace/wishes";
import { isPokemonCardId } from "@/lib/pokemon/types";
import { MarkBought, type MarkBoughtPrint } from "@/components/cart/MarkBought";
import { listWants } from "@/lib/decks/swaps";
import { WantList } from "@/components/WantList";
import { formatCents } from "@/lib/money";
import { CartTools } from "@/components/CartTools";
import { SubmitButton } from "@/components/SubmitButton";
import { saveCartSettingsForm } from "./actions";
import { requireSignedInPage, type Viewer } from "@/lib/auth";
import { assertOwnDeck } from "@/lib/auth/ownership";
import { PageHeader, SectionTabs } from "@/components/ui";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v || undefined);

/** Owned/reserved breakdown behind a want, so "missing" can be told apart from "owned but tied up in another deck". */
export interface WantBreakdown {
  owned: number;
  reservedElsewhere: number;
}

/**
 * `?deck=12` → the deck's shortfall; `?for=<owner>` → that player's wishes (an SL's source; a player
 * naming anyone but themselves gets an empty list); `?cards=BT18-020:2,BT18-021:1` → explicit.
 */
async function wantsFrom(sp: Params, viewer: Viewer): Promise<{ wants: Want[]; source: string; breakdown: Map<string, WantBreakdown>; deckId: number | null; wishOwner: string | null }> {
  const deck = one(sp.deck);
  if (deck) {
    const deckId = Number(deck);
    await assertOwnDeck(viewer, deckId);
    const conflicts = await buildConflicts(db, deckId);
    const breakdown = new Map(conflicts.map((c) => [c.cardId, { owned: c.owned, reservedElsewhere: c.reservedElsewhere }]));
    return { wants: conflicts.map((c) => ({ cardId: c.cardId, quantity: c.short })), source: `deck ${deck}`, breakdown, deckId, wishOwner: null };
  }
  const forOwner = one(sp.for);
  if (forOwner) {
    const rows = await wishesOf(db, viewer, forOwner);
    const wants = rows.map((w) => ({ cardId: w.cardId, quantity: w.quantity }));
    // What the wishing player owns and has tied up, not the looker's.
    const alloc = await allocationForCards(db, wants.map((w) => w.cardId), forOwner);
    const breakdown = new Map<string, WantBreakdown>();
    for (const [id, a] of alloc) breakdown.set(id, { owned: a.owned, reservedElsewhere: a.reserved });
    return { wants, source: "wishes", breakdown, deckId: null, wishOwner: rows.length || viewer.kind === "sl" ? forOwner : null };
  }
  if (one(sp.want) !== "0") {
    // Default source: the saved shopping list, so swap suggestions you parked
    // are priced without having to build a URL.
    const wants = await listWants(db, viewer.owner, viewer.kind === "sl");
    if (wants.length && !one(sp.cards)) {
      const mapped = wants.map((w) => ({ cardId: w.cardId, quantity: w.quantity }));
      const breakdown = await breakdownFor(mapped, viewer);
      return { wants: mapped, source: "shopping list", breakdown, deckId: null, wishOwner: null };
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
  const breakdown = await breakdownFor(wants, viewer);
  return { wants, source: "list", breakdown, deckId: null, wishOwner: null };
}

/** What the looker owns and has tied up: their own copies and built decks (everyone's in local dev, where nobody has a name). */
async function breakdownFor(wants: Want[], viewer: Viewer): Promise<Map<string, WantBreakdown>> {
  const alloc = await allocationForCards(
    db,
    wants.map((w) => w.cardId),
    viewer.owner ?? undefined,
  );
  const out = new Map<string, WantBreakdown>();
  for (const [id, a] of alloc) out.set(id, { owned: a.owned, reservedElsewhere: a.reserved });
  return out;
}

export default async function CartPage({ searchParams }: { searchParams: Promise<Params> }) {
  const viewer = await requireSignedInPage();
  const sp = await searchParams;
  const { wants, source, breakdown, deckId: sourceDeckId, wishOwner } = await wantsFrom(sp, viewer);
  const cfg = await cartSettings(db);
  const filter = listingFilterFrom(one(sp.lang), one(sp.cond));
  const sources = await wishSources(db, viewer);
  const wishName = wishOwner ? (sources.find((s) => s.owner === wishOwner)?.name ?? wishOwner) : null;
  const hasPokemon = wants.some((w) => isPokemonCardId(w.cardId));
  // Variants of each wished Pokémon card, for "Mark as bought" (a Dragon Ball card has one print: the base).
  const pokemonIds = wishOwner && viewer.kind === "sl" ? wants.filter((w) => isPokemonCardId(w.cardId)).map((w) => w.cardId) : [];
  const printRows = pokemonIds.length ? await db.select({ id: cardPrints.id, cardId: cardPrints.cardId, label: cardPrints.label }).from(cardPrints).where(inArray(cardPrints.cardId, pokemonIds)).orderBy(cardPrints.id) : [];
  const printsOf = new Map<string, MarkBoughtPrint[]>();
  for (const p of printRows) printsOf.set(p.cardId, [...(printsOf.get(p.cardId) ?? []), { id: p.id, label: p.label }]);
  /** Keep the chosen source and filter when a chip changes one of them. */
  const href = (over: { for?: string | null; lang?: string; cond?: string }) => {
    const q = new URLSearchParams();
    const f = over.for === undefined ? one(sp.for) : over.for;
    if (f) q.set("for", f);
    else if (over.for === undefined && one(sp.deck)) q.set("deck", one(sp.deck)!);
    const lang = over.lang ?? filter.language;
    const cond = over.cond ?? filter.condition;
    if (lang !== "any") q.set("lang", lang);
    if (cond !== "nm") q.set("cond", cond);
    const s = q.toString();
    return s ? `/cart?${s}` : "/cart";
  };
  const chip = (active: boolean) => `tap rounded-full border px-3 py-1 text-xs ${active ? "border-ki-500 bg-ki-500/15 text-ki-300" : "border-space-600 text-space-200 hover:bg-space-800"}`;
  const names = wants.length
    ? await db
        .select({ id: cards.id, name: cards.name })
        .from(cards)
        .where(
          inArray(
            cards.id,
            wants.map((w) => w.cardId),
          ),
        )
    : [];
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  const result = wants.length ? await optimiseCart(db, wants, cfg, filter) : null;
  const tiedUpIds = wants.filter((w) => (breakdown.get(w.cardId)?.reservedElsewhere ?? 0) > 0).map((w) => w.cardId);
  const reservers = tiedUpIds.length ? await decksReservingFor(db, tiedUpIds, sourceDeckId ?? undefined, viewer.owner ?? undefined) : new Map<string, Reserver[]>();
  const input = "tap w-full rounded-md border border-space-600 bg-space-900 px-2 py-1 text-sm text-space-100";
  const deckId = one(sp.deck);

  return (
    <div className="space-y-5">
      <PageHeader title="Cart optimiser" eyebrow={deckId ? <Link href={`/decks/${deckId}`}>Deck</Link> : "Shopping"} description={<>Cheapest combination of CardTrader sellers to cover a want-list, shipping counted once per seller. {" "}
          {!cardTraderConfigured() ? (
            <span className="text-loss">No CardTrader token configured.</span>
          ) : !cardTraderEnabled() ? (
            <span className="text-ki-300">Live calls are disabled (CARDTRADER_ENABLED=false) — working from cached listings only.</span>
          ) : null}
        </>} />
      <SectionTabs items={[{href:"/collection",label:"Collection"},{href:"/decks",label:"Decks"},{href:"/cart",label:"Cart",active:true}]} />

      {/* Where the list comes from: an SL's own list, a player's wishes, or a deck's shortfall. A player has only their own. */}
      {sources.length > 0 || sourceDeckId ? (
        <nav aria-label="Cart source" className="flex flex-wrap gap-2">
          <Link href={href({ for: null })} className={chip(!wishOwner && !sourceDeckId)}>
            My list
          </Link>
          {sources.map((s) => (
            <Link key={s.owner} href={href({ for: s.owner })} className={chip(wishOwner === s.owner)}>
              {wishLabel(s.name)} <span className="text-space-400">({s.cards})</span>
            </Link>
          ))}
          {sourceDeckId ? (
            <Link href={`/cart?deck=${sourceDeckId}`} className={chip(true)}>
              Deck {sourceDeckId}
            </Link>
          ) : null}
        </nav>
      ) : null}

      {hasPokemon ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-space-300" aria-label="Pokémon listing filters">
          <span className="flex items-center gap-1.5">
            Card language
            {(["any", "de", "en"] as const).map((l) => (
              <Link key={l} href={href({ lang: l })} className={chip(filter.language === l)}>
                {l === "any" ? "Any" : l.toUpperCase()}
              </Link>
            ))}
          </span>
          <span className="flex items-center gap-1.5">
            Condition
            {(["nm", "any"] as const).map((c) => (
              <Link key={c} href={href({ cond: c })} className={chip(filter.condition === c)}>
                {c === "nm" ? "Near Mint" : "Any"}
              </Link>
            ))}
          </span>
        </div>
      ) : null}

      {wishOwner ? null : <WantList rows={await listWants(db, viewer.owner, viewer.kind === "sl")} />}

      {wants.length === 0 ? (
        <div className="rounded-xl border border-dashed border-space-700 p-6 text-sm text-space-300">
          <p>Nothing wanted yet. Open a deck that can&apos;t be built and choose &ldquo;Buy missing cards&rdquo;, or build a list in the URL:</p>
          <code className="mt-2 block font-mono text-xs text-space-100">/cart?cards=BT18-020:2,BT18-021:1</code>
        </div>
      ) : (
        <>
          <section className="rounded-xl border border-space-700/70 bg-space-900/50 p-3">
            <h2 className="mb-1 text-sm font-semibold text-space-50">{wishName ? wishLabel(wishName) : `Want-list (${source})`}</h2>
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
                    {wishOwner && wishName && viewer.kind === "sl" ? (
                      <MarkBought owner={wishOwner} playerName={wishName} cardId={w.cardId} name={nameOf.get(w.cardId) ?? w.cardId} quantity={w.quantity} prints={printsOf.get(w.cardId) ?? []} filter={filter} />
                    ) : null}
                    {tiedUp > 0 ? (
                      <p className="mt-0.5 text-loss">
                        Reserved by{" "}
                        {holders.map((h, i) => (
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
            <CartTools wants={wants} aiEnabled={hasAnthropic()} listingsCached={result?.listings ?? 0} fetchedAt={result?.fetchedAt?.toISOString() ?? null} filter={filter} />
          </section>

          {result && result.listings > 0 ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <PlanCard title="Cheapest" plan={result.best} nameOf={nameOf} refined={result.refinedSellers} />
              {result.fewestSellers && result.fewestSellers.totalCents !== result.best.totalCents ? (
                <PlanCard title="Single seller" plan={result.fewestSellers} nameOf={nameOf} refined={result.refinedSellers} />
              ) : null}
            </div>
          ) : result ? (
            <p className="rounded-xl border border-dashed border-space-700 p-4 text-sm text-space-300">No cached listings for these cards yet — fetch them above.</p>
          ) : null}
        </>
      )}

      {/* One settings row for the whole app, so an SL's to change. */}
      {viewer.kind === "sl" ? (
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
            <SubmitButton pendingLabel="Saving…" className="tap rounded-md bg-space-700 px-3 py-1.5 text-sm text-space-50 hover:bg-space-600 sm:col-span-2">
              Save
            </SubmitButton>
          </form>
        </details>
      ) : null}
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
                  {l.listing.language && isPokemonCardId(l.listing.cardId) ? <span className="text-space-400"> · {l.listing.language.toUpperCase()}</span> : null}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {plan.missing.length ? <p className="mt-2 text-xs text-loss">Not available: {plan.missing.map((m) => `${m.quantity}× ${nameOf.get(m.cardId) ?? m.cardId}`).join(", ")}</p> : null}
    </section>
  );
}
