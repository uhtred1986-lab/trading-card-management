"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatCents } from "@/lib/money";
import { PK } from "@/lib/pokemon/copy";
import type { CollectionEntry } from "@/lib/pokemon/views";
import type { PokemonDeckRow } from "@/lib/pokemon/views";
import { PageTop } from "./PageTop";
import { PokemonTileCard } from "./PokemonTileCard";
import { PokemonViewer } from "./PokemonViewer";
import { useWishes } from "./useWishes";

type Filter = "all" | "deck" | "DE" | "EN";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: PK.collection.filters.all },
  { value: "deck", label: PK.collection.filters.inDeck },
  { value: "DE", label: PK.collection.filters.de },
  { value: "EN", label: PK.collection.filters.en },
];

/**
 * Sammlung: her Pokémon cards from the local database. Count and value on top, filters, a
 * 2-column grid (newest first) and the swipe viewer over whatever the filter shows. An SL sees every
 * player's lots, one section per owner.
 */
export function CollectionScreen({
  entries,
  copies,
  valueCents,
  decks,
  wishedIds,
  showOwners,
}: {
  entries: CollectionEntry[];
  copies: number;
  valueCents: number;
  decks: PokemonDeckRow[];
  wishedIds: string[];
  /** An SL looking at several owners' cards: label and group them. */
  showOwners: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<number | null>(null);
  const [ownedNow, setOwnedNow] = useState<Record<string, number>>({});
  const { wished, toggle, notice } = useWishes(wishedIds);

  const shown = useMemo(
    () =>
      entries.filter((e) => {
        if (filter === "deck") return e.inDecks > 0;
        if (filter === "DE" || filter === "EN") return e.languages.includes(filter);
        return true;
      }),
    [entries, filter],
  );

  const groups = useMemo(() => {
    if (!showOwners) return [{ owner: null as string | null, items: shown.map((e, i) => ({ e, i })), label: null as string | null }];
    const by = new Map<string, { e: CollectionEntry; i: number }[]>();
    shown.forEach((e, i) => {
      const k = e.owner ?? "";
      by.set(k, [...(by.get(k) ?? []), { e, i }]);
    });
    return [...by.entries()].map(([k, items]) => ({ owner: k || null, items, label: PK.collection.ownerLabel(k || null) }));
  }, [shown, showOwners]);

  const count = (e: CollectionEntry) => ownedNow[e.id] ?? e.quantity;

  return (
    <div className="pk-area">
      <PageTop title={showOwners ? PK.collection.titleAll : PK.collection.title} sub={entries.length ? `${PK.collection.count(copies)} · ${formatCents(valueCents)}` : undefined} />

      {entries.length === 0 ? (
        <div className="pk-panel pk-empty">
          <p>{PK.collection.empty}</p>
          <Link href="/pokemon/add" prefetch={false} className="pk-cta">
            ＋ {PK.collection.emptyAction}
          </Link>
        </div>
      ) : (
        <>
          <div className="pk-chips" role="group" aria-label={PK.collection.filterLabel}>
            {FILTERS.map((f) => (
              <button key={f.value} type="button" className="pk-chip" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
                {f.label}
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <div className="pk-panel pk-empty" role="status">
              <p>{PK.collection.emptyFilter}</p>
              <button type="button" className="pk-cta pk-cta-alt pk-cta-inline" onClick={() => setFilter("all")}>
                {PK.collection.filters.all}
              </button>
            </div>
          ) : (
            groups.map((g) => (
              <section key={g.owner ?? "own"} aria-label={g.label ?? undefined}>
                {g.label ? (
                  <h2 className="pk-lbl" style={{ color: "var(--ds-ink)" }}>
                    {g.label} · {PK.collection.count(g.items.reduce((n, x) => n + count(x.e), 0))}
                  </h2>
                ) : null}
                <div className="pk-grid">
                  {g.items.map(({ e, i }) => (
                    <PokemonTileCard
                      key={`${e.owner ?? ""}-${e.id}`}
                      tile={e}
                      onOpen={() => setOpen(i)}
                      owned={count(e)}
                      ownedLabel={PK.collection.copies}
                      deckCount={e.inDecks}
                      photo={e.hasPhoto}
                      caption={showOwners ? <span className="pk-owner">{PK.collection.ownerLabel(e.owner)}</span> : undefined}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
          <p className="pk-note">{PK.collection.valueNote}</p>
        </>
      )}

      <p role="status" aria-live="polite" className={notice ? "pk-live" : "sr-only"}>
        {notice}
      </p>

      {open !== null && shown[open] ? (
        <PokemonViewer
          tiles={shown}
          startIndex={open}
          decks={decks}
          wished={wished}
          onToggleWish={toggle}
          onOwnedChange={showOwners ? undefined : (id, n) => setOwnedNow((m) => ({ ...m, [id]: n }))}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}
