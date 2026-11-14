/**
 * Pokémon's card source for Claude (docs/pokemon/plan.md §7): the viewer's own stored cards first, and a
 * live search over TCGdex (`src/lib/pokemon/tcgdex.ts`) the model reaches through lookup tools. There is
 * no local catalog to list from, so nothing here is "a pool of everything".
 *
 * Everything the model sees is built here: how a Pokémon card is described (names in both languages,
 * type, HP, stage, evolves-from, attacks, legality), the three lookup tools and the read of the viewer's
 * Pokémon cards. The source is injectable (`PokemonSource`) so a check runs on recorded responses.
 */
import { and, asc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { cards, ownedCards } from "@/db/schema";
import { lotScope, type OwnerScope } from "@/lib/collection/scope";
import { getPokemonCard, PokemonSourceError, searchPokemon, type PokemonCardRecord, type PokemonSearchParams } from "@/lib/pokemon/tcgdex";
import { pokemonDetails, tcgdexIdOf, type PokemonDetails, type PokemonHit } from "@/lib/pokemon/types";
import type { LookupArgs, LookupTool, PromptCard } from "./types";

// ── The live source ──────────────────────────────────────────────────────────

/** One card that evolves from a named Pokémon: enough to load it. */
export interface EvolutionHit {
  /** TCGdex id, e.g. "sv03.5-005". */
  tcgdexId: string;
  /** English name as printed. */
  name: string;
}

export interface PokemonSource {
  search(params: PokemonSearchParams): Promise<PokemonHit[]>;
  get(tcgdexId: string): Promise<PokemonCardRecord>;
  /** Cards whose "evolves from" is this English Pokémon name (TCGdex's `evolveFrom` filter on the English list). */
  evolvesInto(englishName: string): Promise<EvolutionHit[]>;
}

const BASE = "https://api.tcgdex.net/v2";

/** `cards?evolveFrom=eq:<name>`: the one question `searchPokemon` cannot ask (it only filters by name, type, category and set). */
async function evolvesIntoLive(englishName: string): Promise<EvolutionHit[]> {
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
    .filter((c): c is { id: string; name?: string } => !!c && typeof (c as { id?: unknown }).id === "string")
    .map((c) => ({ tcgdexId: c.id, name: c.name ?? c.id }));
}

export const liveSource: PokemonSource = { search: searchPokemon, get: getPokemonCard, evolvesInto: evolvesIntoLive };

// ── Describing a card to the model ───────────────────────────────────────────

const yn = (v: boolean | undefined) => (v === true ? "yes" : v === false ? "no" : "?");
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const flat = (s: string | null | undefined) => (s ?? "").replace(/<br\s*\/?>/gi, " / ").replace(/\s+/g, " ").trim();

/**
 * One line for a Pokémon card, from `cards.details`: the card id, the name in both languages, category,
 * type, HP, stage and what it evolves from, abilities and attacks as printed (German), weakness and
 * retreat, the regulation mark, one-per-deck and legality in both formats. Trainers and Energy carry
 * their effect text instead of attacks.
 */
export function describePokemonCard(c: PromptCard, maxSkill = 320): string {
  const d: Partial<PokemonDetails> = pokemonDetails(c.details);
  const de = d.names?.de;
  const en = d.names?.en;
  const names = de && en && de !== en ? `${de} / ${en}` : c.name;
  const types = d.display?.types?.length ? d.display.types.join("/") : c.colors.join("/");
  const stage = d.stage ? (d.display?.stage && d.display.stage !== d.stage ? `${d.display.stage} (${d.stage})` : d.stage) : "";
  const attacks = (d.attacks ?? []).map((a) => `${a.name} [${a.cost.join(" ") || "-"}]${a.damage ? ` ${a.damage}` : ""}${a.effect ? `: ${flat(a.effect)}` : ""}`);
  const abilities = (d.abilities ?? []).map((a) => `Ability ${a.name}${a.effect ? `: ${flat(a.effect)}` : ""}`);
  const text = [...abilities, ...attacks].join("; ") || flat(c.skill);
  const parts = [
    c.id,
    names,
    c.cardType,
    types,
    d.hp ? `HP ${d.hp}` : "",
    stage,
    d.evolveFrom ? `evolves from ${d.evolveFrom}` : "",
    d.basicEnergy ? "basic Energy" : "",
    d.onePerDeck === "ace-spec" ? "ACE SPEC (one per deck)" : d.onePerDeck === "radiant" ? "Radiant (one per deck)" : "",
    d.weakness ? `weak ${d.weakness}` : "",
    typeof d.retreat === "number" ? `retreat ${d.retreat}` : "",
    d.regulationMark ? `mark ${d.regulationMark}` : "",
    d.legal ? `legal: Standard ${yn(d.legal.standard)}, Expanded ${yn(d.legal.expanded)}` : "",
    clip(text, maxSkill),
  ].filter(Boolean);
  return parts.join(" | ");
}

/** A search hit (brief: no HP or legality, the list endpoint does not carry them). */
export function describeHit(h: PokemonHit): string {
  return [h.id, h.altName && h.altName !== h.name ? `${h.name} / ${h.altName}` : h.name, h.category, h.types.join("/"), `${h.setName} ${h.localId}${h.setTotal ? `/${h.setTotal}` : ""}`, h.legal ? `legal: Standard ${yn(h.legal.standard)}, Expanded ${yn(h.legal.expanded)}` : ""]
    .filter(Boolean)
    .join(" | ");
}

/** A full card read, for `get_card`. */
export function describeRecord(rec: PokemonCardRecord): string {
  return describePokemonCard({ id: rec.hit.id, name: rec.hit.name, cardType: rec.category, colors: rec.hit.types, energyCost: null, power: null, skill: rec.skillText, details: rec.details }, 600);
}

// ── The lookup tools ─────────────────────────────────────────────────────────

const HIT_CAP = 12;
const DOWN = "The card search is not reachable right now. Work with the cards you already have; do not guess ids.";

/** The card id a tool argument means: "PKM-sv03.5-006", "PKM-sv03.5-006_holo" or a bare TCGdex id. */
export function tcgdexIdFromArg(id: string | null | undefined): string | null {
  const s = (id ?? "").trim();
  if (!s) return null;
  return tcgdexIdOf(s) ?? (s.startsWith("PKM-") ? null : s);
}

export function pokemonLookupTools(source: PokemonSource): LookupTool[] {
  const guard = async (fn: () => Promise<string>): Promise<string> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof PokemonSourceError) return err.kind === "not_found" ? "No such card." : DOWN;
      throw err;
    }
  };
  return [
    {
      name: "search_cards",
      description: "Search the live Pokémon card database by card name (German or English), optionally narrowed by `type` (e.g. Fire or Feuer) and `category` (POKEMON, TRAINER or ENERGY). Reads: name, type, category. Answers up to 12 cards with their ids.",
      run: (a: LookupArgs) =>
        guard(async () => {
          const hits = await source.search({ q: a.name ?? undefined, type: a.type ?? undefined, category: a.category ?? undefined });
          return hits.length ? hits.slice(0, HIT_CAP).map(describeHit).join("\n") : "No cards found.";
        }),
    },
    {
      name: "evolves_from",
      description: "Lists the cards that evolve from the Pokémon with this ENGLISH name (e.g. Charmander gives Charmeleon cards). Use it to walk an evolution line upward. Reads: name.",
      run: (a: LookupArgs) =>
        guard(async () => {
          const found = await source.evolvesInto(a.name ?? "");
          if (!found.length) return "Nothing evolves from that name.";
          const byName = new Map<string, EvolutionHit[]>();
          for (const f of found) byName.set(f.name, [...(byName.get(f.name) ?? []), f]);
          return [...byName].slice(0, HIT_CAP).map(([name, list]) => `${name}: ${list.slice(0, 4).map((f) => `PKM-${f.tcgdexId}`).join(", ")}${list.length > 4 ? ` (+${list.length - 4} more printings)` : ""}`).join("\n");
        }),
    },
    {
      name: "get_card",
      description: "Full details of one card (HP, stage, evolves from, attacks, legality in Standard and Expanded). Reads: id (a PKM-… card id as returned by the other tools).",
      run: (a: LookupArgs) =>
        guard(async () => {
          const tcgdexId = tcgdexIdFromArg(a.id);
          if (!tcgdexId) return "Give a card id such as PKM-sv03.5-006.";
          return describeRecord(await source.get(tcgdexId));
        }),
    },
  ];
}

// ── The viewer's own cards ───────────────────────────────────────────────────

export interface OwnedPokemonCard extends PromptCard {
  owned: number;
}

/**
 * Pokémon cards the owner has stored lots of, minus `exclude` (ids already in the deck). `owner` is the
 * deck owner's scope (`OwnerScope`): a player only ever sees their own copies. Pokémon first, then
 * Trainers, then Energy, by name, so a cap cuts the least interesting rows.
 */
export async function ownedPokemonCards(db: Db, owner: OwnerScope, opts: { exclude?: string[]; categories?: string[]; limit?: number } = {}): Promise<OwnedPokemonCard[]> {
  const exclude = opts.exclude ?? [];
  const rows = await db
    .select({
      id: cards.id,
      name: cards.name,
      cardType: cards.cardType,
      colors: cards.colors,
      energyCost: cards.energyCost,
      power: cards.power,
      skill: cards.skill,
      rarityCode: cards.rarityCode,
      details: cards.details,
      owned: sql<number>`count(*)::int`,
    })
    .from(cards)
    .innerJoin(ownedCards, eq(ownedCards.cardId, cards.id))
    .where(and(eq(cards.game, "pokemon"), isNull(ownedCards.archivedAt), lotScope(owner), exclude.length ? notInArray(cards.id, exclude) : undefined, opts.categories ? inArray(cards.cardType, opts.categories) : undefined))
    .groupBy(cards.id)
    .orderBy(sql`case ${cards.cardType} when 'POKEMON' then 0 when 'TRAINER' then 1 else 2 end`, asc(cards.name), asc(cards.id))
    .limit(opts.limit ?? 150);
  return rows;
}

/** The pool block's lines for the owned cards. */
export function ownedLines(list: OwnedPokemonCard[], maxSkill = 220): string[] {
  return list.map((c) => `OWN×${c.owned} | ${describePokemonCard(c, maxSkill)}`);
}
