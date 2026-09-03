import Link from "next/link";
import { db } from "@/db";
import { CARD_TYPES, COLORS, listRarities, listSets, searchCards, type CardSearch } from "@/lib/catalog/queries";
import { allocationForCards } from "@/lib/decks/reservations";
import { latestUsdEur } from "@/lib/pricing/fx";
import { basePricesForCards, priceForFinish } from "@/lib/pricing/queries";
import { formatCents } from "@/lib/money";
import { CardTile } from "@/components/CardTile";
import { CardList } from "@/components/CardList";
import { ViewToggle } from "@/components/ViewToggle";
import { parseViewMode } from "@/lib/view-mode";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v || undefined;
}

export default async function CardsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const view = parseViewMode(one(sp.view));
  const search: CardSearch = {
    q: one(sp.q),
    set: one(sp.set),
    type: one(sp.type),
    color: one(sp.color),
    rarity: one(sp.rarity),
    owned: one(sp.owned) as CardSearch["owned"],
    sort: (one(sp.sort) as CardSearch["sort"]) ?? "newest",
    page: Number(one(sp.page) ?? 1),
  };

  const [result, sets, rarities, usdEur] = await Promise.all([
    searchCards(db, search),
    listSets(db),
    listRarities(db),
    latestUsdEur(db),
  ]);
  const ids = result.rows.map((r) => r.id);
  const [prices, alloc] = await Promise.all([basePricesForCards(db, ids), allocationForCards(db, ids)]);

  const qs = (overrides: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const merged = { ...search, view: view === "grid" ? undefined : view, ...overrides } as Record<string, unknown>;
    for (const [k, v] of Object.entries(merged)) if (v != null && v !== "" && !(k === "page" && v === 1)) p.set(k, String(v));
    const s = p.toString();
    return s ? `/cards?${s}` : "/cards";
  };

  const label = (id: string) => {
    // SR+ cards only exist as foils on TCGplayer, so `priceForFinish` falls back to the foil price.
    const usd = priceForFinish(prices.get(id), "normal");
    return usd == null ? null : usdEur != null ? formatCents(Math.round(usd * usdEur), "EUR") : formatCents(usd, "USD");
  };

  const select = "tap rounded-md border border-space-600 bg-space-900 px-2 py-1.5 text-sm text-space-100";
  // Switching view keeps every filter and the page you are on.
  const viewParams: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(search)) if (v != null && v !== "" && !(k === "page" && v === 1)) viewParams[k] = String(v);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-xl font-semibold text-space-50">Card catalog</h1>
        <p className="flex flex-wrap items-center gap-3 text-sm text-space-300">
          {result.total.toLocaleString()} card{result.total === 1 ? "" : "s"}
          {search.set ? (
            <Link href={`/sets/${search.set}/review`} className="rounded-md border border-space-600 px-2 py-1 text-xs text-space-100 hover:bg-space-800">
              AI set review
            </Link>
          ) : null}
          <ViewToggle path="/cards" params={viewParams} view={view} />
        </p>
      </div>

      <form className="grid grid-cols-2 gap-2 rounded-xl border border-space-700/70 bg-space-900/50 p-3 sm:grid-cols-4 lg:grid-cols-8" action="/cards">
        {view !== "grid" ? <input type="hidden" name="view" value={view} /> : null}
        <input
          type="search"
          name="q"
          defaultValue={search.q ?? ""}
          placeholder="Name, number (BT18-020), character…"
          className={`${select} col-span-2 lg:col-span-3`}
          autoComplete="off"
        />
        <select name="set" defaultValue={search.set ?? ""} className={select}>
          <option value="">All sets</option>
          {sets.map((s) => (
            <option key={s.code} value={s.code}>
              {s.code} · {s.name}
            </option>
          ))}
        </select>
        <select name="type" defaultValue={search.type ?? ""} className={select}>
          <option value="">Any type</option>
          {CARD_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select name="color" defaultValue={search.color ?? ""} className={select}>
          <option value="">Any colour</option>
          {COLORS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select name="rarity" defaultValue={search.rarity ?? ""} className={select}>
          <option value="">Any rarity</option>
          {rarities.map((r) => (
            <option key={r.code} value={r.code}>
              {r.label}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <select name="owned" defaultValue={search.owned ?? ""} className={`${select} flex-1`}>
            <option value="">Owned or not</option>
            <option value="yes">Owned</option>
            <option value="no">Not owned</option>
          </select>
          <select name="sort" defaultValue={search.sort} className={`${select} flex-1`}>
            <option value="newest">Newest</option>
            <option value="number">Oldest</option>
            <option value="name">Name</option>
          </select>
        </div>
        <button className="tap col-span-2 rounded-md bg-ki-500 px-3 py-1.5 text-sm font-semibold text-space-950 hover:bg-ki-400 sm:col-span-4 lg:col-span-8">
          Search
        </button>
      </form>

      {result.rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-space-700 p-8 text-center text-space-300">
          No cards match. {sets.length === 0 ? "The catalog looks empty — run the catalog sync from Settings." : ""}
        </p>
      ) : view === "list" ? (
        <CardList rows={result.rows.map((c) => ({ card: c, priceLabel: label(c.id), ownedQty: alloc.get(c.id)?.owned }))} />
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {result.rows.map((c) => (
            <CardTile key={c.id} card={c} priceLabel={label(c.id)} ownedQty={alloc.get(c.id)?.owned} />
          ))}
        </div>
      )}

      {result.pages > 1 ? (
        <nav className="flex items-center justify-center gap-2 text-sm">
          <Link
            aria-disabled={result.page <= 1}
            className={`tap rounded-md border border-space-600 px-3 py-1.5 ${result.page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-space-800"}`}
            href={qs({ page: result.page - 1 })}
          >
            ← Prev
          </Link>
          <span className="text-space-300">
            Page {result.page} / {result.pages}
          </span>
          <Link
            aria-disabled={result.page >= result.pages}
            className={`tap rounded-md border border-space-600 px-3 py-1.5 ${result.page >= result.pages ? "pointer-events-none opacity-40" : "hover:bg-space-800"}`}
            href={qs({ page: result.page + 1 })}
          >
            Next →
          </Link>
        </nav>
      ) : null}
    </div>
  );
}
