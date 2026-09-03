import Link from "next/link";
import { db } from "@/db";
import { COLORS, listSets } from "@/lib/catalog/queries";
import { collectionCards, collectionCopies, summarise, valuedLots } from "@/lib/collection/queries";
import { ownerOptions } from "@/lib/collection/owners";
import { listLocations } from "@/lib/collection/locations";
import { currentOwner } from "@/lib/auth";
import { formatCents } from "@/lib/money";
import { parseViewMode } from "@/lib/view-mode";
import { CardTile } from "@/components/CardTile";
import { CollectionList } from "@/components/CollectionList";
import { CopiesPopover } from "@/components/CopiesPopover";
import { ViewToggle } from "@/components/ViewToggle";
import { LiveSearch } from "@/components/LiveSearch";
import { deckOptions } from "@/lib/decks/add";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v || undefined);
const many = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);

export default async function CollectionPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const q = one(sp.q);
  const set = one(sp.set);
  const color = one(sp.color);
  const finishParam = one(sp.finish);
  const finish = finishParam === "foil" || finishParam === "normal" ? finishParam : undefined;
  const sort = (one(sp.sort) as "value" | "name" | "number" | "recent" | undefined) ?? "recent";
  const view = parseViewMode(one(sp.view));
  const locationParam = one(sp.location);
  const location = locationParam === "none" ? ("none" as const) : locationParam ? Number(locationParam) : undefined;
  // The deck filter takes several values at once, so it arrives repeated.
  const deckParams = many(sp.deck);
  const deck = deckParams.map((d) => (d === "none" ? ("none" as const) : Number(d))).filter((d) => d === "none" || Number.isInteger(d));
  const owner = one(sp.owner);
  const filters: Parameters<typeof collectionCopies>[1] = { q, set, color, finish, sort, location, deck, owner };

  // The grid aggregates by card; the list is one row per physical copy. Only
  // the one being shown is fetched — both walk every lot.
  const [grid, list, sets, all, decks, locations] = await Promise.all([
    view === "grid" ? collectionCards(db, filters) : null,
    view === "list" ? collectionCopies(db, filters) : null,
    listSets(db),
    valuedLots(db),
    deckOptions(db),
    listLocations(db),
  ]);
  // Both views offer the same filters, so the owner list is always needed.
  const owners = await ownerOptions(db, await currentOwner());
  const s = summarise(all.lots, all.usdEur);
  const shown = grid?.rows.length ?? list?.rows.length ?? 0;
  const select = "tap rounded-md border border-space-600 bg-space-900 px-2 py-1.5 text-sm text-space-100";

  const params = { q, set, color, sort: sort === "recent" ? undefined : sort, finish, location: locationParam, deck: deckParams, owner };

  const href = (next: string | undefined) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (set) p.set("set", set);
    if (color) p.set("color", color);
    if (sort !== "recent") p.set("sort", sort);
    if (next) p.set("finish", next);
    if (view !== "grid") p.set("view", view);
    if (locationParam) p.set("location", locationParam);
    for (const d of deckParams) p.append("deck", d);
    if (owner) p.set("owner", owner);
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
        <span className="ml-auto">
          <ViewToggle path="/collection" params={params} view={view} listLabel="Copies" />
        </span>
      </div>

      <form action="/collection" className="grid grid-cols-2 gap-2 rounded-xl border border-space-700/70 bg-space-900/50 p-3 sm:grid-cols-4">
        {finish ? <input type="hidden" name="finish" value={finish} /> : null}
        {view !== "grid" ? <input type="hidden" name="view" value={view} /> : null}
        {/* The same filters in both views — a grid tile counts only the copies that match. */}
        <select name="location" defaultValue={locationParam ?? ""} className={select}>
          <option value="">Anywhere</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
          <option value="none">Not filed yet</option>
        </select>
        {/*
          Checkboxes rather than a multi-select: several decks at once, plus
          "in no deck", and it stays usable on a phone. Plain form controls,
          so the whole thing still works as a GET.
        */}
        <details className="relative rounded-md border border-space-600 bg-space-900">
          <summary className="tap cursor-pointer list-none px-2 py-1.5 text-sm text-space-100">
            {deckParams.length === 0
              ? "Any deck"
              : deckParams.length === 1
                ? (deckParams[0] === "none" ? "In no deck" : (decks.find((d) => String(d.id) === deckParams[0])?.name ?? "1 deck"))
                : `${deckParams.length} decks`}
            <span className="float-right text-space-400">▾</span>
          </summary>
          <div className="absolute left-0 z-30 mt-1 max-h-64 w-56 overflow-y-auto rounded-md border border-space-600 bg-space-950 p-2 shadow-xl">
            <label className="flex items-center gap-2 rounded px-1 py-1 text-sm text-space-200 hover:bg-space-900">
              <input type="checkbox" name="deck" value="none" defaultChecked={deckParams.includes("none")} className="h-3.5 w-3.5 accent-ki-500" />
              In no deck
            </label>
            {decks.map((d) => (
              <label key={d.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm text-space-200 hover:bg-space-900">
                <input type="checkbox" name="deck" value={d.id} defaultChecked={deckParams.includes(String(d.id))} className="h-3.5 w-3.5 accent-ki-500" />
                <span className="truncate">
                  {d.isBuilt ? "▣" : "▢"} {d.name}
                </span>
              </label>
            ))}
          </div>
        </details>
        <select name="owner" defaultValue={owner ?? ""} className={select}>
          <option value="">Anyone</option>
          {owners.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
          <option value="none">No owner set</option>
        </select>
        <LiveSearch
          defaultValue={q}
          placeholder="Filter by name or number"
          className="col-span-2"
          params={{ set, color, sort: sort === "recent" ? undefined : sort, finish, view: view === "grid" ? undefined : view, location: locationParam, deck: deckParams, owner }}
        />
        <select name="set" defaultValue={set ?? ""} className={select}>
          <option value="">All sets</option>
          {sets.map((st) => (
            <option key={st.code} value={st.code}>
              {st.code} · {st.name}
            </option>
          ))}
        </select>
        <select name="color" defaultValue={color ?? ""} className={select}>
          <option value="">Any colour</option>
          {COLORS.map((c) => (
            <option key={c} value={c}>
              {c}
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

      {shown === 0 ? (
        <p className="rounded-xl border border-dashed border-space-700 p-8 text-center text-space-300">
          {s.lots === 0 ? "Nothing here yet." : finish === "foil" ? "No foils match that filter." : "No cards match that filter."}
        </p>
      ) : list ? (
        <CollectionList rows={list.rows} owners={owners} decks={decks} locations={locations} />
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {grid!.rows.map((r) => (
            <CardTile
              key={r.card.id}
              card={r.card}
              badge={<CopiesPopover cardId={r.card.id} name={r.card.name} ownedQty={r.qty} foilQty={r.foilQty} decks={decks} locations={locations} />}
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
