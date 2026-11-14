/**
 * Matching what the model read off a Pokémon photo against live TCGdex search hits, with an honest
 * confidence. Pure and I/O free; covered by scripts/verify/pokemon-input.mts.
 *
 * Order of trust: the collector number with the set size printed at the bottom ("006/165"), then the
 * name. Every `PokemonHit` carries the German and the English name, so a German card read against an
 * English record (or the reverse) still agrees.
 *
 *  - exact:  exactly one hit agrees on number, set size and name, and the model read it clearly;
 *  - likely: one hit is clearly the best, but something is missing or off (no size, a wrong size,
 *            the name only, a hesitant read);
 *  - unsure: several hits fit, or none fits well. Shown amber, "Bitte prüfen", and never saved
 *            without a tap;
 *  - none:   nothing came back.
 */
import { nameSimilarity } from "@/lib/ai/scan-match";
import type { Box } from "@/lib/ai/scan-match";
import { displayName, foldName, splitNameSuffix } from "./names";
import type { PokemonHit, PokemonVariant } from "./types";

export type PokemonMatchConfidence = "exact" | "likely" | "unsure" | "none";

/** One card as the model read it (the parts matching needs). */
export interface PokemonDetection {
  /** Name as printed, in the card's own language. */
  name: string;
  /** Language of the card, when the model could tell. */
  language: "DE" | "EN" | null;
  /** The number as printed at the bottom: "006/165", "006" or a promo code such as "SWSH062". */
  number: string | null;
  setCode: string | null;
  /** 0..1, how sure the model is about the number AND the name. */
  confidence: number;
}

export interface PrintedNumber {
  /** The collector number in the form `localId` is compared in: digits without zeros, or a promo prefix plus digits. */
  localId: string;
  /** The numeric part, for the search query. Null for a promo code. */
  number: number | null;
  /** The set size after the slash, when it is a plain number. */
  size: number | null;
}

/** "006/165", "6 / 165", "SWSH062", "TG05/TG30", "#6". Null when no number can be made of it. */
export function parsePrintedNumber(text: string | null | undefined): PrintedNumber | null {
  const s = (text ?? "").trim().toUpperCase().replace(/^#/, "").replace(/\s+/g, "");
  const m = /^([A-Z]{0,5})0*(\d{1,4})(?:\/([A-Z]{0,5})0*(\d{1,4}))?$/.exec(s);
  if (!m) return null;
  const prefix = m[1];
  const n = parseInt(m[2], 10);
  if (!prefix && (n < 1 || n > 999)) return null;
  return { localId: `${prefix}${n}`, number: prefix ? null : n, size: m[4] && !m[3] ? parseInt(m[4], 10) : null };
}

/** A hit's `localId` in the same comparable form ("006" and "6" are the same card, "SWSH062" stays). */
export function canonicalLocalId(localId: string): string {
  const m = /^([A-Za-z]*)0*(\d+)$/.exec(localId.trim());
  return m ? `${m[1].toUpperCase()}${parseInt(m[2], 10)}` : localId.trim().toUpperCase();
}

export interface PokemonCandidate {
  hit: PokemonHit;
  score: number;
  numberMatch: boolean;
  sizeMatch: boolean;
  /** 0..1 name agreement with the better of the German and English names. */
  nameSim: number;
  /** The rule-box suffix (ex, V, ...) agrees, or neither has one. */
  suffixMatch: boolean;
}

export interface PokemonMatch {
  confidence: PokemonMatchConfidence;
  /** The card to preselect: set for exact and likely, null for unsure and none. */
  best: PokemonHit | null;
  /** Everything worth tapping, best first, at most `MAX_CANDIDATES`. */
  candidates: PokemonCandidate[];
  /** Plain German reason, for the amber badge. */
  reason: string;
}

export const MAX_CANDIDATES = 8;
/** A name this close counts as the same name. */
const NAME_SAME = 0.8;
/** A name this close counts as "agrees, but check". */
const NAME_NEAR = 0.5;
/** Below this the model's own doubt keeps a full agreement at "likely". */
const CLEAR_READ = 0.6;

const suffixOf = (name: string) => splitNameSuffix(name).suffix;

function assess(detection: PokemonDetection, printed: PrintedNumber | null, hit: PokemonHit): PokemonCandidate {
  const detName = foldName(detection.name);
  const names = [hit.name, hit.altName].filter((n): n is string => !!n);
  const nameSim = detName ? Math.max(0, ...names.map((n) => nameSimilarity(detName, foldName(n)))) : 0;
  const detSuffix = suffixOf(detection.name);
  const suffixMatch = !detName || names.some((n) => suffixOf(n) === detSuffix);
  const numberMatch = !!printed && canonicalLocalId(hit.localId) === printed.localId;
  const sizeMatch = !!printed && printed.size !== null && hit.setTotal === printed.size;
  const code = detection.setCode?.trim().toLowerCase();
  const codeMatch = !!code && (hit.tcgdexId.toLowerCase().startsWith(`${code}-`) || hit.setName.toLowerCase() === code);
  const score = (numberMatch ? 4 : 0) + (sizeMatch ? 2 : 0) + nameSim * 2 + (suffixMatch ? 0.25 : 0) + (codeMatch ? 0.5 : 0);
  return { hit, score, numberMatch, sizeMatch, nameSim, suffixMatch };
}

/**
 * Decide which hit the photo shows. `hits` are what `searchPokemon` returned for the detection's
 * queries (`pokemonScanQueries`), merged and de-duplicated by the caller or not (duplicates are removed here).
 */
export function matchPokemon(detection: PokemonDetection, hits: PokemonHit[]): PokemonMatch {
  const printed = parsePrintedNumber(detection.number);
  const unique = [...new Map(hits.map((h) => [h.tcgdexId, h])).values()];
  const all = unique.map((h) => assess(detection, printed, h)).sort((a, b) => b.score - a.score);
  if (all.length === 0) return { confidence: "none", best: null, candidates: [], reason: "Keine Karte gefunden." };
  // What is worth showing: anything that agrees on the number or the name; failing that, the best few.
  const relevant = all.filter((c) => c.numberMatch || c.nameSim >= NAME_NEAR);
  const candidates = (relevant.length ? relevant : all).slice(0, MAX_CANDIDATES);
  const read = Math.min(1, Math.max(0, detection.confidence));
  const one = (c: PokemonCandidate, confidence: "exact" | "likely", reason: string): PokemonMatch => ({ confidence, best: c.hit, candidates, reason });
  const unsure = (reason: string): PokemonMatch => ({ confidence: "unsure", best: null, candidates, reason });

  if (printed) {
    const sameName = (c: PokemonCandidate) => c.nameSim >= NAME_SAME && c.suffixMatch;
    const full = all.filter((c) => c.numberMatch && c.sizeMatch && sameName(c));
    if (full.length === 1) {
      return read >= CLEAR_READ ? one(full[0], "exact", "Nummer, Setgröße und Name passen.") : one(full[0], "likely", "Passt, aber das Foto war nicht klar.");
    }
    if (full.length > 1) return unsure("Mehrere Karten haben dieselbe Nummer und denselben Namen.");

    const byNumber = all.filter((c) => c.numberMatch);
    // The name read nothing (blur): the number and size alone, when they single out one card.
    if (!foldName(detection.name)) {
      const sized = byNumber.filter((c) => c.sizeMatch);
      if (sized.length === 1) return one(sized[0], "likely", "Nur die Nummer war lesbar.");
      return unsure("Der Name war nicht lesbar.");
    }
    const near = byNumber.filter((c) => c.nameSim >= NAME_NEAR);
    if (near.length === 1) {
      const c = near[0];
      return one(c, "likely", c.sizeMatch ? "Die Schreibweise des Namens weicht ab." : printed.size === null ? "Die Setgröße fehlt." : "Die Setgröße passt nicht.");
    }
    if (near.length > 1) return unsure("Mehrere Karten passen zur Nummer.");
    // The number alone fits cards with other names: a digit was probably misread. Fall through to the name.
  }

  const byName = all.filter((c) => c.nameSim >= NAME_SAME && c.suffixMatch);
  if (byName.length === 1 && !printed) return one(byName[0], "likely", "Nur der Name war lesbar.");
  if (byName.length > 1) return unsure("Der Name gehört zu mehreren Karten.");
  if (byName.length === 1) return unsure("Die Nummer passt nicht zum Namen.");
  return unsure(printed ? "Nummer und Name passen zu keiner Karte genau." : "Kein klarer Treffer.");
}

/** The `searchPokemon` queries for a detection, most precise first: the printed number with its size, then the name. */
export function pokemonScanQueries(detection: Pick<PokemonDetection, "name" | "language" | "number">): string[] {
  const printed = parsePrintedNumber(detection.number);
  const name = detection.name.trim().replace(/\s+/g, " ");
  const { base, suffix } = splitNameSuffix(name);
  const full = [displayName(base, suffix, detection.language === "EN" ? "space" : "hyphen")];
  const out: string[] = [];
  const hasSize = !!printed && printed.size !== null;
  const numberText = printed && printed.number !== null ? (hasSize ? `${printed.number}/${printed.size}` : String(printed.number)) : null;
  if (numberText && hasSize) out.push(numberText);
  if (base) {
    if (numberText) out.push(`${base} ${numberText}`);
    if (suffix) out.push(full[0]);
    out.push(base);
  } else if (numberText && !hasSize) {
    out.push(numberText);
  }
  return [...new Set(out.filter((q) => q.trim().length >= 1))];
}

/** The finish the model saw, as the variant to preselect. Holo and reverse only when the card has them. */
export function variantFromFinish(finish: string | null | undefined, available: PokemonVariant[]): PokemonVariant {
  const want: PokemonVariant | null = finish === "holo" ? "holo" : finish === "reverse" ? "reverse" : null;
  if (want && available.includes(want)) return want;
  return available.includes("normal") ? "normal" : (available[0] ?? "normal");
}

/**
 * Where each detection sits on a 3×3 binder page, row by row. By the middle of its box when every
 * detection has one; otherwise in reading order. A cell taken twice pushes the later card to the
 * next free one; a tenth card does not fit and is returned in `extra`.
 */
export function gridCells<T extends { box: Box | null }>(items: T[], size = 9, cols = 3): { cells: (T | null)[]; extra: T[] } {
  const cells: (T | null)[] = Array.from({ length: size }, () => null);
  const extra: T[] = [];
  const rows = size / cols;
  const placeable = items.every((i) => i.box);
  const ordered = placeable ? [...items].sort((a, b) => a.box!.y + a.box!.h / 2 - (b.box!.y + b.box!.h / 2) || a.box!.x - b.box!.x) : items;
  for (const item of ordered) {
    let want = cells.findIndex((c) => c === null);
    if (placeable && item.box) {
      const col = Math.min(cols - 1, Math.max(0, Math.floor((item.box.x + item.box.w / 2) * cols)));
      const row = Math.min(rows - 1, Math.max(0, Math.floor((item.box.y + item.box.h / 2) * rows)));
      want = row * cols + col;
    }
    let at = want;
    while (at < size && cells[at] !== null) at++;
    if (at >= size) at = cells.findIndex((c) => c === null);
    if (at < 0) extra.push(item);
    else cells[at] = item;
  }
  return { cells, extra };
}
