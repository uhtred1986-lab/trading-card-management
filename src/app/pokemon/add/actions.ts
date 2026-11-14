"use server";

import { db } from "@/db";
import { requireSignedIn } from "@/lib/auth";
import { ownedCountsFor } from "@/lib/pokemon/collection";
import { isPokemonSourceError, searchPokemon } from "@/lib/pokemon/tcgdex";
import { parseSpokenPokemon, type SpokenPokemonParse } from "@/lib/pokemon/voice";
import type { PokemonHit, PokemonLang } from "@/lib/pokemon/types";

export interface SpokenPokemonResolution {
  status: "found" | "none" | "unavailable";
  /** What was heard (the first alternative). */
  heard: string;
  /** The count she said, when she said one. */
  quantity: number | null;
  /** The interpretation that found cards, as a readable line ("Glurak-ex 6/165"); null when none did. */
  via: string | null;
  candidates: PokemonHit[];
  /** The viewer's own copies per candidate card id. */
  owned: Record<string, number>;
}

/** Searches this many interpretations at most per phrase; each one is two cached TCGdex reads. */
const MAX_TRIES = 8;
const MAX_ALTERNATIVES = 3;
const MAX_CANDIDATES = 40;

/**
 * Resolves what the browser heard into cards, in order: every interpretation of the best
 * alternative, then of the next, until one finds cards. Nothing is saved: the screen shows the cards
 * and the child taps one.
 *
 * Why a Server Function and not the existing `/api/pokemon/search` from the client: the parser is
 * pure and several interpretations may be needed, which from the client would be one round trip
 * each (a phone on weak signal); here it is one trip, the guard is in one place, and the viewer's
 * own copy counts come back with the cards. TCGdex reads stay cached for the day either way.
 */
export async function resolveSpokenPokemonAction(input: { alternatives: string[]; lang: PokemonLang }): Promise<SpokenPokemonResolution> {
  const viewer = await requireSignedIn();
  const lang: PokemonLang = input.lang === "en" ? "en" : "de";
  const heard = String(input.alternatives?.[0] ?? "").trim().slice(0, 200);
  const alternatives = (Array.isArray(input.alternatives) ? input.alternatives : []).map((a) => String(a ?? "").slice(0, 200)).filter((a) => a.trim()).slice(0, MAX_ALTERNATIVES);

  let first: SpokenPokemonParse | null = null;
  let tries = 0;
  for (const alt of alternatives) {
    const parsed = parseSpokenPokemon(alt, lang);
    first ??= parsed;
    for (const option of parsed.options) {
      if (tries++ >= MAX_TRIES) break;
      let hits: PokemonHit[];
      try {
        hits = await searchPokemon({ q: option.query });
      } catch (e) {
        if (isPokemonSourceError(e)) return { status: "unavailable", heard, quantity: parsed.quantity, via: null, candidates: [], owned: {} };
        throw e;
      }
      if (hits.length > 0) {
        const candidates = hits.slice(0, MAX_CANDIDATES);
        const owned = await ownedCountsFor(db, viewer, candidates.map((h) => h.id));
        return { status: "found", heard, quantity: parsed.quantity ?? first.quantity, via: option.query, candidates, owned };
      }
    }
  }
  return { status: "none", heard, quantity: first?.quantity ?? null, via: null, candidates: [], owned: {} };
}
