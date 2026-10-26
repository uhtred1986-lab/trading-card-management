"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { filterDecks, emptyDeckFilters, type DiscoveryDeck } from "@/lib/decks/discovery";
import { CardImage } from "./CardImage";
import { ColorPill } from "./ColorPill";
import { GameMark } from "./GameMark";
import { FilterBar } from "@/components/ui";

export function DeckDescription({ text, missing = "No description yet. Add strategy notes in Deck details & notes." }: { text: string | null; missing?: string }) {
  const description = text?.trim();
  if (!description) return <p className="text-sm text-space-400">{missing}</p>;
  if (description.length <= 180) return <p className="whitespace-pre-wrap break-words text-sm text-space-200">{description}</p>;
  return <details className="text-sm text-space-200">
    <summary className="tap cursor-pointer break-words py-1">{description.slice(0, 180).trimEnd()}… <span className="text-ki-300">Read full description</span></summary>
    <p className="mt-2 whitespace-pre-wrap break-words">{description}</p>
  </details>;
}

export function DeckFacts({ deck, missingDescription }: { deck: DiscoveryDeck; missingDescription?: string }) {
  return <div className="min-w-0 space-y-2" data-deck-facts={deck.id}>
    <div className="flex items-start gap-3">
      <div className="w-16 shrink-0"><CardImage src={deck.leaderImage} alt="" sizes="64px" /></div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="break-words text-base font-semibold text-space-50">{deck.name}{deck.game && <> <GameMark game={deck.game} /></>}</p>
        <p className="break-words text-sm text-space-300">{deck.leaderName ?? "No leader yet"}{deck.leaderId ? ` · ${deck.leaderId}` : ""}</p>
        <p className="flex flex-wrap gap-1 text-xs text-space-300"><span>{deck.group} · {deck.mainCount} main cards{deck.status ? ` · ${deck.status}` : ""}</span>{deck.colors.map((c) => <ColorPill key={c} color={c} small />)}</p>
        {deck.locked && <p className="text-xs font-semibold text-loss">Locked — open rules need review</p>}
      </div>
    </div>
    <DeckDescription text={deck.description} missing={missingDescription} />
    {deck.note && <p className="break-words text-xs text-space-300">{deck.note}</p>}
  </div>;
}

/** Filters precede a bounded list. A hidden selection remains explicit and is never replaced. */
export function DeckDiscovery({ decks, label, value, onChange, readyOnly = false, disableLocked = false, disabled = false, missingDescription }: {
  decks: DiscoveryDeck[]; label: string; value?: string; onChange?: (id: string) => void;
  readyOnly?: boolean; disableLocked?: boolean; disabled?: boolean; missingDescription?: string;
}) {
  const id = useId();
  const [filters, setFilters] = useState(() => emptyDeckFilters(readyOnly));
  const [limit, setLimit] = useState(6);
  const selected = decks.find((d) => d.id === value);
  const filtered = filterDecks(decks, filters);
  const colors = [...new Set(decks.flatMap((d) => d.colors))].sort();
  const groups = [...new Set(decks.map((d) => d.group))].sort();
  const leaders = [...new Map(decks.filter((d) => d.leaderName).map((d) => [d.leaderId || d.leaderName!, { value: d.leaderId || d.leaderName!, name: `${d.leaderName}${d.leaderId ? ` · ${d.leaderId}` : ""}` }])).values()].sort((a,b) => a.name.localeCompare(b.name));
  const update = (patch: Partial<typeof filters>) => { setFilters({ ...filters, ...patch }); setLimit(6); };
  const selectClass = "tap min-w-0 w-full rounded-lg border border-space-600 bg-space-900 px-2 py-2 text-sm text-space-100";
  return <fieldset disabled={disabled} aria-label={label} className="min-w-0 space-y-3 rounded-xl border border-space-700 bg-space-900/50 p-3" data-deck-discovery={label}>
    <legend className="px-1 text-sm font-semibold text-space-100">{label}</legend>
    {selected && <DeckFacts deck={selected} missingDescription={missingDescription} />}
    <details open={value === undefined ? true : undefined} className="space-y-3">
      <summary className="tap cursor-pointer py-2 text-sm font-semibold text-ki-300">{value === undefined ? "Find a deck" : "Change deck"} · {decks.length} available</summary>
      <FilterBar summary={`${filtered.length} of ${decks.length} decks · showing ${Math.min(limit,filtered.length)}`} active={<>{filters.leader && <button type="button" onClick={() => update({leader:""})}>Leader: {filters.leader} ×</button>}{filters.group && <button type="button" onClick={() => update({group:""})}>Type: {filters.group} ×</button>}{filters.readyOnly && <button type="button" onClick={() => update({readyOnly:false})}>Rules ready only ×</button>}</>}>
      <div className="space-y-2">
        <label className="block text-xs text-space-300" htmlFor={`${id}-search`}>Search deck, leader or description</label>
        <input id={`${id}-search`} type="search" value={filters.q} onChange={(e) => update({q:e.target.value})} placeholder="Name, card number, strategy…" className={selectClass} />
        <label className="block text-xs text-space-300">Colour<select value={filters.color} onChange={(e) => update({color:e.target.value})} className={selectClass}><option value="">Any colour</option>{colors.map((c) => <option key={c}>{c}</option>)}</select></label>
        <details className="ds-more-filters"><summary className="tap ds-button-secondary">More filters</summary><div className="grid grid-cols-2 gap-2">
          <label className="min-w-0 text-xs text-space-300">Leader<select value={filters.leader} onChange={(e) => update({leader:e.target.value})} className={selectClass}><option value="">Any leader</option>{leaders.map((l) => <option key={l.value} value={l.value}>{l.name}</option>)}</select></label>
          <label className="min-w-0 text-xs text-space-300">Deck type<select value={filters.group} onChange={(e) => update({group:e.target.value})} className={selectClass}><option value="">Any type</option>{groups.map((g) => <option key={g}>{g}</option>)}</select></label>
          {decks.some((d) => d.locked !== undefined) && <label className="tap flex items-center gap-2 text-sm text-space-200"><input type="checkbox" checked={filters.readyOnly} onChange={(e) => update({readyOnly:e.target.checked})} />Ready rules only</label>}
        </div></details>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className="tap px-2 text-sm text-ki-300" onClick={() => { setFilters(emptyDeckFilters(readyOnly)); setLimit(6); }}>Reset filters</button>
        </div>
        {selected && !filtered.some((d) => d.id === selected.id) && <p className="text-xs text-ki-300">Your selected deck stays selected; it is outside these filters.</p>}
      </div>
      </FilterBar>
      {filtered.length === 0 && <p className="rounded-lg border border-dashed border-space-600 p-4 text-sm text-space-300">No decks match. Try another search or reset filters.</p>}
      <ul className={`grid gap-2 ${value === undefined ? "lg:grid-cols-2" : ""}`}>
        {filtered.slice(0,limit).map((d) => <li key={d.id} className="min-w-0 rounded-lg border border-space-600 bg-space-950/60 p-3">
          {d.href ? <>
            <div className="flex items-start gap-3">
              <div className="w-14 shrink-0"><CardImage src={d.leaderImage} alt="" sizes="56px" /></div>
              <div className="min-w-0 flex-1">
                <Link href={d.href} className="tap block break-words text-base font-semibold text-ki-300">{d.name}</Link>
                <p className="break-words text-sm text-space-300">{d.leaderName ?? "No leader yet"}{d.leaderId ? ` · ${d.leaderId}` : ""}</p>
                <p className="text-xs text-space-300">{d.group} · {d.colors.join(" / ")} · {d.mainCount} main cards · {d.status}</p>
              </div>
            </div>
            <DeckDescription text={d.description} />
            {d.note && <p className="text-xs text-space-300">{d.note}</p>}
          </> : <>
            <button type="button" data-deck-choice={d.id} aria-pressed={d.id === value} disabled={disabled || (disableLocked && d.locked)} onClick={() => onChange?.(d.id)} className="tap block w-full space-y-1 text-left disabled:opacity-50">
              <span className="block break-words text-sm font-semibold text-space-50">{d.id === value ? "✓ " : ""}{d.name}{d.game && <> <GameMark game={d.game} /></>}</span>
              <span className="block break-words text-xs text-space-300">{d.leaderName ?? "No leader yet"} · {d.leaderId} · {d.colors.join(" / ")} · {d.group} · {d.mainCount} cards{d.locked ? " · Locked" : ""}</span>
              <span className="block break-words text-xs text-space-300">{d.description?.trim() ? `${d.description.trim().slice(0,120)}${d.description.trim().length > 120 ? "…" : ""}` : missingDescription ?? "No description yet."}</span>
            </button>
          </>}
        </li>)}
      </ul>
      {filtered.length > limit && <button data-more-decks type="button" className="tap w-full rounded-lg border border-space-600 px-3 py-2 text-sm text-ki-300" onClick={() => setLimit(limit+6)}>Show more decks ({filtered.length-limit} remaining)</button>}
    </details>
  </fieldset>;
}
