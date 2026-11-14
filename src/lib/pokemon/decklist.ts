/**
 * Pasting a Pokémon deck list (docs/pokemon/plan.md §7): the text format of the official app and of
 * the community sites,
 *
 *     Pokémon: 12
 *     4 Charizard ex OBF 125
 *     Trainer: 30
 *     4 Boss's Orders PAL 172
 *     Energy: 18
 *     12 Basic {R} Energy SVE 2
 *
 * with German section names too ("Energie"), a count first ("4", "4x"), the card name, the set code
 * (upper case, "OBF", "PR-SV") and the collector number ("125", "125/197") last. Set code and number
 * are optional: a bare "4 Glurak-ex" is a name.
 *
 * `parseDeckListPokemon` is pure: it reads lines and reports what it could not read. `resolveDeckList`
 * turns the lines into TCGdex cards through an injected search (`searchPokemon` in production), so the
 * tests need no network. Nothing is dropped silently: a line that cannot be read or found is returned
 * in `unresolved`, and a line that matched several prints but was settled by a guess in `guessed`.
 */
import type { PokemonHit } from "./types";
import { foldName, splitNameSuffix } from "./names";

export type DeckListSection = "POKEMON" | "TRAINER" | "ENERGY";

export interface DeckListLine {
  /** The line as pasted (trimmed). */
  raw: string;
  /** 1-based line number in the pasted text. */
  at: number;
  count: number;
  /** The card name as written, with "{R}" spelled out ("Basic Fire Energy"). */
  name: string;
  /** "OBF", or null. */
  setCode: string | null;
  /** The collector number as read ("125" gives 125), or null. */
  number: number | null;
  /** The section the line sat under, or null before any header. */
  section: DeckListSection | null;
}

export interface UnreadLine {
  raw: string;
  at: number;
}

export interface ParsedDeckList {
  lines: DeckListLine[];
  /** Lines that are neither a header, a total nor a card (they are reported, never dropped). */
  unreadable: UnreadLine[];
  /** The counts the section headers declare ("Pokémon: 12"), for the caller to compare with what was read. */
  declared: Partial<Record<DeckListSection, number>>;
  /** The "Total Cards: 60" figure, when the text has one. */
  declaredTotal: number | null;
  /** Sum of the counts read. */
  total: number;
}

/** The energy symbols exports write in braces. */
const ENERGY_SYMBOLS: Record<string, string> = { G: "Grass", R: "Fire", W: "Water", L: "Lightning", P: "Psychic", F: "Fighting", D: "Darkness", M: "Metal", Y: "Fairy", N: "Dragon", C: "Colorless" };

const SECTION_WORDS: Record<string, DeckListSection> = {
  pokemon: "POKEMON",
  pokémon: "POKEMON",
  trainer: "TRAINER",
  trainers: "TRAINER",
  energy: "ENERGY",
  energies: "ENERGY",
  energie: "ENERGY",
  energien: "ENERGY",
};

const TOTAL_WORDS = /^(?:total(?: cards)?|gesamt|karten gesamt|insgesamt|summe|total de cartes|karten)\s*[:=]?\s*(\d{1,3})\s*$/i;
const HEADER = /^(?:[#*>\-–—=\s]*)(pok[eé]mon|trainers?|energy|energies|energie|energien)(?:\s+(?:cards?|karten))?\s*[:\-–]?\s*\(?\s*(\d{1,3})?\s*\)?\s*[:=*#]*\s*$/i;
const COMMENT = /^(?:\/\/|#\s|#$|\*\*|---|===)/;
const COUNTED = /^(\d{1,2})\s*[x×]?\s+(\S.*)$/i;
/** `name SET number` (the set code is upper case; two to six characters, an optional "-XX" part). */
const WITH_SET = /^(.+?)\s+([A-Z][A-Z0-9]{1,5}(?:-[A-Z0-9]{1,4})?)\s+(\d{1,3})(?:\s*\/\s*\d{1,3})?$/;
const WITH_NUMBER = /^(.+?)\s+(\d{1,3})(?:\s*\/\s*\d{1,3})?$/;

/** Rule-box suffixes look like set codes ("Pikachu VMAX 20"): they are part of the name. */
const SUFFIX_WORDS = new Set(["EX", "GX", "V", "VMAX", "VSTAR", "BREAK", "LV"]);

/** "Basic {R} Energy" to "Basic Fire Energy". */
export function spellOutEnergy(name: string): string {
  return name.replace(/\{([A-Za-z])\}/g, (m, k: string) => ENERGY_SYMBOLS[k.toUpperCase()] ?? m).replace(/\s+/g, " ").trim();
}

export function parseDeckListPokemon(text: string): ParsedDeckList {
  const lines: DeckListLine[] = [];
  const unreadable: UnreadLine[] = [];
  const declared: Partial<Record<DeckListSection, number>> = {};
  let declaredTotal: number | null = null;
  let section: DeckListSection | null = null;

  const rows = String(text ?? "").replace(/^﻿/, "").split(/\r?\n/);
  rows.forEach((rawLine, index) => {
    const raw = rawLine.replace(/ /g, " ").trim();
    const at = index + 1;
    if (!raw || COMMENT.test(raw)) return;

    const total = TOTAL_WORDS.exec(raw);
    if (total) {
      declaredTotal = Number(total[1]);
      return;
    }
    const header = HEADER.exec(raw);
    if (header) {
      section = SECTION_WORDS[header[1].toLowerCase()] ?? SECTION_WORDS[header[1].toLowerCase().replace("é", "e")] ?? null;
      if (section && header[2] !== undefined) declared[section] = Number(header[2]);
      return;
    }

    const counted = COUNTED.exec(raw);
    // No count in front means one copy ("Charizard ex OBF 125"), but only when something else says it is a card.
    const count = counted ? Number(counted[1]) : 1;
    const rest = spellOutEnergy((counted ? counted[2] : raw).replace(/\s*\((?:standard|expanded|regulation \w)\)\s*$/i, ""));
    if (count < 1 || !rest) {
      unreadable.push({ raw, at });
      return;
    }
    if (!counted && !(WITH_SET.test(rest) && !SUFFIX_WORDS.has(WITH_SET.exec(rest)![2]))) {
      // A line with neither a count nor a set and number is a heading we do not know, not a card.
      unreadable.push({ raw, at });
      return;
    }

    let name = rest;
    let setCode: string | null = null;
    let number: number | null = null;
    const withSet = WITH_SET.exec(rest);
    if (withSet && !SUFFIX_WORDS.has(withSet[2])) {
      name = withSet[1];
      setCode = withSet[2];
      number = parseInt(withSet[3], 10);
    } else {
      const withNumber = WITH_NUMBER.exec(rest);
      if (withNumber) {
        name = withNumber[1];
        number = parseInt(withNumber[2], 10);
      }
    }
    lines.push({ raw, at, count, name: name.trim(), setCode, number, section });
  });

  return { lines, unreadable, declared, declaredTotal, total: lines.reduce((n, l) => n + l.count, 0) };
}

// ── Resolving ────────────────────────────────────────────────────────────────

/** What the resolver needs of the card source: `searchPokemon` in production, a stub in the test. `setId` limits the search to one set. */
export type DeckListSearch = (params: { q: string; category?: DeckListSection; setId?: string }) => Promise<PokemonHit[]>;

/** The source's set id for a printed set code ("OBF" gives "sv03"), or null when it does not know the code. */
export type SetIdForCode = (code: string) => Promise<string | null>;

export interface ResolvedCard {
  tcgdexId: string;
  cardId: string;
  name: string;
  /** Copies over every line that resolved to this card. */
  count: number;
  /** The lines (their `at`) that gave this card. */
  at: number[];
}

export interface UnresolvedLine {
  raw: string;
  at: number;
  reason: "unreadable" | "notFound";
}

export interface DeckListResolution {
  cards: ResolvedCard[];
  unresolved: UnresolvedLine[];
  /** Lines that matched several prints and were settled by taking the newest (or the first with a picture). */
  guessed: { raw: string; at: number; took: string }[];
}

/** The names to try, best first: as written, the German "-ex" spelling, and without the suffix. */
export function nameVariants(name: string): string[] {
  const out = [name.trim()];
  const { base, suffix } = splitNameSuffix(name);
  if (suffix) out.push(`${base}-${suffix}`, `${base} ${suffix}`, base);
  // "Basic Fire Energy" is "Fire Energy" on some cards.
  if (/^basic\s+/i.test(name)) out.push(name.replace(/^basic\s+/i, ""));
  return [...new Set(out)];
}

const sameName = (hitName: string, variant: string) => foldName(hitName) === foldName(variant);

/**
 * Looks every line up. A line with a set code and a number is asked of that set (the set code becomes the
 * source's set id) and accepted when the name agrees: that names one print. Otherwise by name and number
 * across all sets, where several prints are settled by taking the newest and said out loud in `guessed`;
 * then by name alone. Lines run four at a time. A source that cannot be reached throws (the caller says so);
 * a line with no match is `unresolved`.
 */
export async function resolveDeckList(parsed: ParsedDeckList, search: DeckListSearch, setIdForCode: SetIdForCode = async () => null, concurrency = 4): Promise<DeckListResolution> {
  const unresolved: UnresolvedLine[] = parsed.unreadable.map((u) => ({ raw: u.raw, at: u.at, reason: "unreadable" }));
  const guessed: DeckListResolution["guessed"] = [];
  const found = new Map<string, ResolvedCard>();
  // One lookup per set code, however many lines use it.
  const setIds = new Map<string, Promise<string | null>>();
  const setIdOf = (code: string) => {
    const key = code.toUpperCase();
    if (!setIds.has(key)) setIds.set(key, setIdForCode(key).catch(() => null));
    return setIds.get(key)!;
  };
  const named = (h: PokemonHit, variants: string[]) => variants.some((v) => sameName(h.name, v) || (h.altName !== null && sameName(h.altName, v)));

  const settle = async (line: DeckListLine): Promise<{ hit: PokemonHit; guess: boolean } | null> => {
    const variants = nameVariants(line.name);
    const category = line.section ?? undefined;

    if (line.number !== null) {
      // The set and the number name one card; the name has to agree (a reprint can sit under another number).
      if (line.setCode) {
        const setId = await setIdOf(line.setCode);
        if (setId) {
          const inSet = (await search({ q: String(line.number), category, setId })).filter((h) => named(h, variants));
          if (inSet.length === 1) return { hit: inSet[0], guess: false };
        }
      }
      for (const v of variants) {
        const hits = await search({ q: `${v} ${line.number}`, category });
        if (hits.length === 1) return { hit: hits[0], guess: false };
        // Several sets print this number for this name and the set code did not settle it: the newest.
        if (hits.length > 1) return { hit: hits[0], guess: true };
      }
    }

    // Name only: an exact name, preferring a card with a picture (the source orders newest set first).
    for (const v of variants) {
      const hits = await search({ q: v, category });
      const exact = hits.filter((h) => named(h, [v]));
      if (exact.length === 0) continue;
      const withPicture = exact.find((h) => h.image) ?? exact[0];
      // A number was given but no print had it: the name alone settled it, which is a guess. A bare name is just the newest print.
      return { hit: withPicture, guess: line.number !== null };
    }
    return null;
  };

  let next = 0;
  const work = async () => {
    while (next < parsed.lines.length) {
      const line = parsed.lines[next++];
      const r = await settle(line);
      if (!r) {
        unresolved.push({ raw: line.raw, at: line.at, reason: "notFound" });
        continue;
      }
      const e = found.get(r.hit.tcgdexId) ?? { tcgdexId: r.hit.tcgdexId, cardId: r.hit.id, name: r.hit.name, count: 0, at: [] };
      e.count += line.count;
      e.at.push(line.at);
      found.set(r.hit.tcgdexId, e);
      if (r.guess) guessed.push({ raw: line.raw, at: line.at, took: `${r.hit.name} ${r.hit.setName} ${r.hit.localId}`.trim() });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, 8)) }, work));

  const order = (a: { at: number }, b: { at: number }) => a.at - b.at;
  return {
    cards: [...found.values()].map((c) => ({ ...c, at: c.at.sort((x, y) => x - y) })).sort((a, b) => a.at[0] - b.at[0]),
    unresolved: unresolved.sort(order),
    guessed: guessed.sort(order),
  };
}
