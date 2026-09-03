import Link from "next/link";
import { db } from "@/db";
import { listSets } from "@/lib/catalog/queries";
import { collectionCards, summarise, valuedLots } from "@/lib/collection/queries";
import { formatCents } from "@/lib/money";
import { CardTile } from "@/components/CardTile";
import { CopiesPopover } from "@/components/CopiesPopover";
import { deckOptions } from "@/lib/decks/add";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v || undefined);

export default async function CollectionPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const q = one(sp.q);
  const set = one(sp.set);
  const finishParam = one(sp.finish);
  const finish = finishParam === "foil" || finishParam === "normal" ? finishParam : undefined;
  const sort = (one(sp.sort) as "value" | "name" | "number" | "recent" | undefined) ?? "recent";

  const [{ rows }, sets, all, decks] = await Promise.all([collectionCards(db, { q, set, finish, sort }), listSets(db), valuedLots(db), deckOptions(db)]);
  const s = summarise(all.lots, all.usdEur);
  const select = "tap rounded-md border border-space-600 bg-space-900 px-2 py-1.5 text-sm text-space-100";

  const href = (next: string | undefined) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (set) p.set("set", set);
    if (sort !== "recent") p.set("sort", sort);
    if (next) p.set("finish", next);
    const qs = p.toString();
    return qs ? `/collection?${qs}` : "/collection";
  };

  /** Doubles as the finish filter — the number you are looking at is the button. */
  const chip = (key: "foil" | "normal" | undefined, label: string, copies: number, value: number, tone: string) => {
    const active = finish === key;
    return (
      <Link
        href={href(key)}
        className={`flex items-baseline gap-1.5 rounded-lg border px-2.5 py-1 transition-colors ${active ? "border-ki-500 bg-ki-500/10" : "border-space-700 hover:border-space-500"}`}
      >
        <span className={`text-sm font-semibold tabular-nums ${tone}`}>{copies}</span>
        <span className="text-xs text-space-300">{label}</span>
        <span className="text-[11px] text-space-400">{formatCents(value)}</span>
      </Link>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-space-50">My collection</h1>
          <p className="text-sm text-space-300">
            {s.copies} copies · {s.uniqueCards} unique · worth {formatCents(s.valueEurCents)}
          </p>
        </div>
        <Link href="/add" className="tap rounded-md bg-ki-500 px-3 py-1.5 text-sm font-semibold text-space-950 hover:bg-ki-400">
          + Add cards
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {chip(undefined, "all copies", s.copies, s.valueEurCents, "text-space-50")}
        {chip("normal", "non-foil", s.normalCopies, s.normalValueEurCents, "text-space-50")}
        {chip("foil", "✦ foil", s.foilCopies, s.foilValueEurCents, "text-amber-300")}
      </div>

      <form action="/collection" className="grid grid-cols-2 gap-2 rounded-xl border border-space-700/70 bg-space-900/50 p-3 sm:grid-cols-5">
        {finish ? <input type="hidden" name="finish" value={finish} /> : null}
        <input type="search" name="q" defaultValue={q ?? ""} placeholder="Filter by name or number" className={`${select} col-span-2`} />
        <select name="set" defaultValue={set ?? ""} className={select}>
          <option value="">All sets</option>
          {sets.map((st) => (
            <option key={st.code} value={st.code}>
              {st.code} · {st.name}
            </option>
          ))}
        </select>
        <select name="sort" defaultValue={sort} className={select}>
          <option value="recent">Recently added</option>
          <option value="value">Highest value</option>
          <option value="name">Name</option>
          <option value="number">Set / number</option>
        </select>
        <button className="tap rounded-md border border-space-600 px-3 py-1.5 text-sm text-space-100 hover:bg-space-800">Apply</button>
      </form>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-space-700 p-8 text-center text-space-300">
          {s.lots === 0 ? "Nothing here yet." : finish === "foil" ? "No foils match that filter." : "No cards match that filter."}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {rows.map((r) => (
            <CardTile
              key={r.card.id}
              card={r.card}
              badge={<CopiesPopover cardId={r.card.id} name={r.card.name} ownedQty={r.qty} foilQty={r.foilQty} decks={decks} />}
              priceLabel={r.valueEur ? formatCents(r.valueEur) : r.unpriced ? "unpriced" : null}
              footer={
                r.spentEur ? (
                  <div className={`text-right text-[11px] ${r.valueEur - r.spentEur >= 0 ? "text-gain" : "text-loss"}`}>
                    {r.valueEur - r.spentEur >= 0 ? "+" : "−"}
                    {formatCents(Math.abs(r.valueEur - r.spentEur))}
                  </div>
                ) : null
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
