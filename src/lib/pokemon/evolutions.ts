/**
 * The evolution line around one card, read live (docs/pokemon/design.md §3: "evolves from / into, each a
 * tappable picture"). Server code: it reads TCGdex through `tcgdex.ts` and does no database work.
 *
 * - **Evolves from** is `details.evolveFrom` (an English name). It is resolved to a card through the live
 *   search: a printing in the same set when there is one, else the newest printing with a picture.
 * - **Evolves into** is TCGdex's `evolveFrom` filter on the English list (`evolvesIntoBriefs`, which the
 *   Claude card source in `src/lib/ai/games/pokemon-source.ts` uses too, so it lives here and not there).
 *   Many cards answer, one per printing: they are grouped by name and one printing per name is picked the
 *   same way.
 *
 * The choice (`pickPrinting`, `intoCards`) is pure and checked in `scripts/verify/pokemon-polish.mts`;
 * `loadEvolutions` takes its source as an argument so that check runs on recorded answers.
 */
import { hitFromTcgdex, listPokemonSets, PokemonSourceError, searchPokemon, setIdOf, type PokemonCardRecord, type PokemonSearchParams, type PokemonSetInfo } from "./tcgdex";
import type { PokemonHit } from "./types";

const BASE = "https://api.tcgdex.net/v2";
/** At most this many different evolutions are shown (a Pokémon such as Eevee has more). */
export const MAX_EVOLUTIONS = 8;

/** One card that evolves from a named Pokémon: enough to load it, and to show it. */
export interface EvolutionBrief {
  /** TCGdex id, e.g. "sv03.5-005". */
  tcgdexId: string;
  /** English name as printed. */
  name: string;
  localId: string;
  /** Image base URL at the source, or null. */
  image: string | null;
}

/** `cards?evolveFrom=eq:<name>`: the one question `searchPokemon` cannot ask (it only filters by name, type, category and set). */
export async function evolvesIntoBriefs(englishName: string): Promise<EvolutionBrief[]> {
  const name = englishName.trim();
  if (!name) return [];
  const url = `${BASE}/en/cards?evolveFrom=${encodeURIComponent(`eq:${name}`)}&pagination:page=1&pagination:itemsPerPage=40`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000), next: { revalidate: 24 * 60 * 60 } } as RequestInit);
  } catch (err) {
    const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new PokemonSourceError(timeout ? "TCGdex did not answer in time" : "TCGdex is not reachable", timeout ? "timeout" : "unavailable");
  }
  if (res.status === 404) return [];
  if (!res.ok) throw new PokemonSourceError(`TCGdex answered ${res.status}`, "unavailable", res.status);
  const body: unknown = await res.json().catch(() => null);
  if (!Array.isArray(body)) throw new PokemonSourceError("TCGdex sent something unexpected", "bad_response", res.status);
  return body
    .filter((c): c is { id: string; name?: string; localId?: string; image?: string } => !!c && typeof (c as { id?: unknown }).id === "string")
    .map((c) => ({ tcgdexId: c.id, name: c.name ?? c.id, localId: c.localId ?? "", image: c.image ?? null }));
}

// ── Choosing a printing (pure) ───────────────────────────────────────────────

/** A name as compared: no accents, no case, no spaces at the ends ("Flabébé" equals "flabebe"). */
export function foldName(s: string | null | undefined): string {
  return (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

interface Printing {
  tcgdexId: string;
  localId: string;
  image: string | null;
}

/**
 * Which printing to show: one in the card's own set when there is one, else the newest set (`setRank`
 * lists sets newest first: a lower number is newer; a set it does not know goes last). A printing with a
 * picture beats one without, whatever its set. Ties keep the source's order. Null for an empty list.
 */
export function pickPrinting<T extends Printing>(candidates: readonly T[], preferSetId: string | null, setRank: ReadonlyMap<string, number>): T | null {
  let best: T | null = null;
  let bestKey: number[] = [];
  candidates.forEach((c, i) => {
    const set = setIdOf(c.tcgdexId, c.localId);
    const key = [c.image ? 0 : 1, preferSetId !== null && set === preferSetId ? 0 : 1, setRank.get(set) ?? Number.MAX_SAFE_INTEGER, i];
    if (best === null || lexLess(key, bestKey)) {
      best = c;
      bestKey = key;
    }
  });
  return best;
}

function lexLess(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

/** The card for the Pokémon called `englishName` among search hits (the name matches in either language, accents aside). */
export function pickByName(hits: readonly PokemonHit[], englishName: string, preferSetId: string | null, setRank: ReadonlyMap<string, number>): PokemonHit | null {
  const want = foldName(englishName);
  const named = hits.filter((h) => foldName(h.name) === want || foldName(h.altName) === want);
  return pickPrinting(named, preferSetId, setRank);
}

/** The evolutions among the cards that evolve from a name: one printing per name, in the order the names first appear, at most `max`. */
export function intoCards(briefs: readonly EvolutionBrief[], preferSetId: string | null, setRank: ReadonlyMap<string, number>, max = MAX_EVOLUTIONS): EvolutionBrief[] {
  const byName = new Map<string, EvolutionBrief[]>();
  for (const b of briefs) {
    const key = foldName(b.name);
    byName.set(key, [...(byName.get(key) ?? []), b]);
  }
  const out: EvolutionBrief[] = [];
  for (const group of byName.values()) {
    const pick = pickPrinting(group, preferSetId, setRank);
    if (pick) out.push(pick);
    if (out.length >= max) break;
  }
  return out;
}

// ── The read ─────────────────────────────────────────────────────────────────

export interface EvolutionSource {
  search(params: PokemonSearchParams): Promise<PokemonHit[]>;
  sets(): Promise<PokemonSetInfo[]>;
  evolvesInto(englishName: string): Promise<EvolutionBrief[]>;
}

export const liveEvolutionSource: EvolutionSource = { search: searchPokemon, sets: listPokemonSets, evolvesInto: evolvesIntoBriefs };

export interface Evolutions {
  /** The card this one evolves from, or null (a Basic, or not found). */
  from: PokemonHit | null;
  /** The cards it evolves into, one printing per name. */
  into: PokemonHit[];
}

/**
 * The line around a record. A half answer is fine (only "into" when "from" could not be read, and the
 * other way round); throws `PokemonSourceError` only when everything it asked failed.
 */
export async function loadEvolutions(record: Pick<PokemonCardRecord, "hit" | "details">, source: EvolutionSource = liveEvolutionSource): Promise<Evolutions> {
  const { hit, details } = record;
  if (hit.category !== null && hit.category !== "POKEMON") return { from: null, into: [] };
  const own = setIdOf(hit.tcgdexId, hit.localId);
  const englishName = details.names?.en ?? hit.name;
  const fromName = details.evolveFrom?.trim() || null;

  const rank = new Map<string, number>();
  const setInfo = new Map<string, PokemonSetInfo>();
  try {
    (await source.sets()).forEach((st, i) => {
      rank.set(st.id, i);
      setInfo.set(st.id, st);
    });
  } catch {
    // Without the set list the "newest" part of the choice falls back to the source's order.
  }

  const fromTask = fromName
    ? (async () => {
        // The same set first: a precise, cheap question; else the name over every set.
        const inSet = pickByName(await source.search({ q: fromName, setId: own }), fromName, own, rank);
        return inSet ?? pickByName(await source.search({ q: fromName, category: "POKEMON" }), fromName, own, rank);
      })()
    : Promise.resolve(null);
  const intoTask = source.evolvesInto(englishName).then((briefs) => intoCards(briefs, own, rank));

  const [fromR, intoR] = await Promise.allSettled([fromTask, intoTask]);
  if (fromR.status === "rejected" && intoR.status === "rejected") throw fromR.reason;
  const into =
    intoR.status === "fulfilled"
      ? intoR.value
          .filter((b) => b.tcgdexId !== hit.tcgdexId)
          .map((b) => {
            const st = setInfo.get(setIdOf(b.tcgdexId, b.localId));
            return hitFromTcgdex(null, { id: b.tcgdexId, localId: b.localId, name: b.name, image: b.image ?? undefined }, { lang: "en", category: "POKEMON", setName: st?.name ?? "", setTotal: st?.official ?? null });
          })
      : [];
  const from = fromR.status === "fulfilled" && fromR.value && fromR.value.tcgdexId !== hit.tcgdexId ? fromR.value : null;
  return { from, into };
}
