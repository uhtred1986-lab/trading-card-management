"use client";

/**
 * The small pieces the Pokémon add screens share (Vorlesen, Foto machen): a candidate tile, chip
 * rows, the big stepper, the deck picker and the card detail read. Styled with the design-system
 * tokens only, so the Pokémon skin applies from whatever layout wraps them.
 */
import { useId } from "react";
import { pokemonImage, type PokemonHit, type PokemonVariant } from "@/lib/pokemon/types";
import type { PokemonVariantInfo } from "@/lib/pokemon/tcgdex";

export interface DeckChoice {
  id: number;
  name: string;
}

export interface OwnedLineLite {
  printId: string;
  variant: PokemonVariant;
  language: "DE" | "EN";
  quantity: number;
}

export interface CardDetailLite {
  hit: PokemonHit;
  variants: PokemonVariantInfo[];
  owned: OwnedLineLite[];
}

/** The card read the add screens need: its real variants and the viewer's own copies. Throws a German sentence on failure. */
export async function loadCardDetail(tcgdexId: string): Promise<CardDetailLite> {
  const res = await fetch(`/api/pokemon/card/${encodeURIComponent(tcgdexId)}`, { cache: "no-store" });
  const json = (await res.json().catch(() => null)) as (CardDetailLite & { message?: string }) | null;
  if (!res.ok || !json?.hit) throw new Error(json?.message ?? "Die Karte konnte nicht geladen werden.");
  return { hit: json.hit, variants: json.variants ?? [], owned: json.owned ?? [] };
}

/** "006/165" for a hit; the number alone when the set size is unknown. */
export function numberLabel(hit: Pick<PokemonHit, "localId" | "setTotal">): string {
  return hit.setTotal ? `${hit.localId}/${hit.setTotal}` : hit.localId;
}

export function CandidateTile({
  hit,
  owned,
  selected = false,
  onPick,
  ownLabel,
  className = "",
}: {
  hit: PokemonHit;
  owned?: number;
  selected?: boolean;
  onPick: (hit: PokemonHit) => void;
  ownLabel?: (n: number) => string;
  className?: string;
}) {
  const src = pokemonImage(hit.image, "low");
  const alt = `${hit.name}, ${hit.setName} ${numberLabel(hit)}`;
  return (
    <button
      type="button"
      onClick={() => onPick(hit)}
      aria-pressed={selected}
      className={`tap flex w-28 shrink-0 flex-col gap-1 rounded-xl border p-1.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ki-400 ${selected ? "border-ki-400 bg-ki-500/10" : "border-space-700 bg-space-900/50 hover:bg-space-800"} ${className}`}
    >
      <span className="card-aspect relative block w-full overflow-hidden rounded-lg bg-space-800">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={alt} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full items-center justify-center p-1 text-center text-xs text-space-300">{hit.name}</span>
        )}
      </span>
      <span className="truncate text-xs font-medium text-space-100">{hit.setName || hit.tcgdexId}</span>
      <span className="text-[11px] text-space-300">
        {numberLabel(hit)}
        {owned && ownLabel ? ` · ${ownLabel(owned)}` : ""}
      </span>
    </button>
  );
}

/** One choice out of a few, as big chips. `role="radiogroup"` so a screen reader says which one is on. */
export function ChipRow<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const id = useId();
  return (
    <div>
      <div id={id} className="mb-1 text-xs font-semibold uppercase tracking-wider text-space-300">
        {label}
      </div>
      <div role="radiogroup" aria-labelledby={id} className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={`tap rounded-full border px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ki-400 ${value === o.value ? "border-ki-400 bg-ki-500/20 text-space-50" : "border-space-600 text-space-200 hover:bg-space-800"}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The big minus, number and plus. 56 px buttons. */
export function Stepper({ value, onChange, min = 1, max = 99, lessLabel, moreLabel }: { value: number; onChange: (n: number) => void; min?: number; max?: number; lessLabel: string; moreLabel: string }) {
  const btn =
    "tap flex h-14 w-14 items-center justify-center rounded-xl border border-space-600 text-3xl font-semibold text-space-50 hover:bg-space-800 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ki-400";
  return (
    <div className="flex items-center justify-center gap-5">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} className={btn} aria-label={lessLabel}>
        −
      </button>
      <div className="w-16 text-center text-5xl font-semibold tabular-nums text-space-50" aria-live="polite">
        {value}
      </div>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} className={btn} aria-label={moreLabel}>
        +
      </button>
    </div>
  );
}

export function DeckSelect({ decks, value, onChange, label, none, hint }: { decks: DeckChoice[]; value: number | null; onChange: (id: number | null) => void; label: string; none: string; hint?: string }) {
  const id = useId();
  if (decks.length === 0) return null;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-semibold uppercase tracking-wider text-space-300">
        {label}
      </label>
      <select
        id={id}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        className="tap w-full rounded-lg border border-space-600 bg-space-900 px-3 py-2 text-base text-space-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ki-400"
      >
        <option value="">{none}</option>
        {decks.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      {hint ? <p className="mt-1 text-xs text-space-400">{hint}</p> : null}
    </div>
  );
}

/** The variants a card really has, as chip options. A card the source lists no variant for still offers "Normal". */
export function variantOptions(variants: PokemonVariantInfo[]): { value: PokemonVariant; label: string }[] {
  const list = variants.length ? variants : [{ variant: "normal" as PokemonVariant, label: "Normal" }];
  return list.map((v) => ({ value: v.variant, label: v.label }));
}

export const primaryButton =
  "tap flex h-14 w-full items-center justify-center rounded-xl bg-ki-500 px-4 text-base font-semibold text-space-950 hover:bg-ki-400 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ki-300";
export const secondaryButton =
  "tap flex min-h-11 items-center justify-center rounded-xl border border-space-600 px-4 py-2 text-sm text-space-200 hover:bg-space-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ki-400";
