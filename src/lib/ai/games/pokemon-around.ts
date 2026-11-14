/**
 * "Neues Deck mit dieser Karte", the free path (docs/pokemon/plan.md §7): a deterministic draft built
 * around one Pokémon card. No model is called; it reads the card source and the viewer's cards.
 *
 * - **The line**: the card's evolution line. Down from the card (`details.evolveFrom`, an English name,
 *   searched live) to its Basic, and up from the card (`evolveFrom` filter on the English list) while it
 *   is a Basic or Stage 1. Quantities follow the usual shape of a deck: 4-3-2 from the Basic upward.
 * - **Energy**: 12 to 16 basic Energy of the card's type, more for lines whose attacks cost more.
 * - **Trainers**: only ones the viewer owns, legal in the deck's format, most owned first, filling what is
 *   left up to 60. Never padded with cards she does not have.
 * - **Owned cards first**: a card of the line the viewer owns (any printing) is used instead of searching.
 *
 * The result is a draft deck she edits: flagged by `legality` like any deck, and it never claims to be
 * complete (the description says so; a draft short of 60 shows "Noch n Karten").
 */
import { inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { cards, deckCards, decks } from "@/db/schema";
import { gameInfo } from "@/lib/catalog/games";
import type { DeckLegality } from "@/lib/decks/legality";
import { pokemonFormatOf, pokemonNameKey } from "@/lib/decks/pokemonLegality";
import { getDeck } from "@/lib/decks/queries";
import { PokemonSourceError, pokemonTypeOf, type PokemonCardRecord } from "@/lib/pokemon/tcgdex";
import { pokemonDetails, tcgdexIdOf, type PokemonDetails } from "@/lib/pokemon/types";
import { normaliseCardId } from "./pokemon-build";
import { liveDeps, pokemonAdapter, type PokemonDeps } from "./pokemon";
import { ownedPokemonCards, type OwnedPokemonCard } from "./pokemon-source";

export interface PokemonAroundOptions {
  owner: string | null;
  format?: string | null;
}

export interface PokemonAroundResult {
  deckId: number;
  mainCount: number;
  /** Copies of the line and the Trainers the viewer would still have to get (basic Energy is not counted). */
  toBuy: number;
  legality: DeckLegality;
  /** What was done and what was not found, in German, as shown on the deck. */
  notes: string[];
  line: { cardId: string; name: string; quantity: number }[];
  energy: { cardId: string; name: string; quantity: number } | null;
}

interface Pick {
  cardId: string;
  tcgdexId: string;
  name: string;
  en: string;
  cardType: string;
  details: Partial<PokemonDetails>;
  owned: number;
  record: PokemonCardRecord | null;
}

const FRIENDLY_DOWN = "Die Kartensuche ist gerade nicht erreichbar. Versuch es gleich noch einmal.";

function fromRecord(rec: PokemonCardRecord, owned: Map<string, number>): Pick {
  return { cardId: rec.hit.id, tcgdexId: rec.tcgdexId, name: rec.hit.name, en: rec.details.names.en ?? rec.hit.name, cardType: rec.category, details: rec.details, owned: owned.get(rec.hit.id) ?? 0, record: rec };
}

function fromOwned(o: OwnedPokemonCard): Pick {
  const d = pokemonDetails(o.details);
  return { cardId: o.id, tcgdexId: tcgdexIdOf(o.id) ?? o.id, name: o.name, en: d.names?.en ?? o.name, cardType: o.cardType, details: d, owned: o.owned, record: null };
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export async function draftAroundPokemonCard(db: Db, seedCardId: string, opts: PokemonAroundOptions, deps: PokemonDeps = liveDeps): Promise<PokemonAroundResult> {
  const rules = gameInfo("pokemon").deck;
  const format = pokemonFormatOf(opts.format);
  const seedId = normaliseCardId(seedCardId);
  if (!seedId) throw new Error("Diese Karte ist keine Pokémon-Karte.");
  const notes: string[] = [];

  const ownedList = await ownedPokemonCards(db, opts.owner ?? undefined, { limit: 500 });
  const ownedById = new Map(ownedList.map((o) => [o.id, o.owned]));
  const ownedByEn = new Map<string, Pick[]>();
  for (const o of ownedList) {
    const p = fromOwned(o);
    const key = p.en.trim().toLowerCase();
    ownedByEn.set(key, [...(ownedByEn.get(key) ?? []), p]);
  }

  /** Legal in the format ranks first, then owned, then the newest regulation mark, then HP. */
  const legalScore = (p: Pick) => (p.details.legal?.[format as "standard" | "expanded"] === true ? 2 : p.details.legal?.[format as "standard" | "expanded"] === false ? 0 : 1);
  const best = (picks: Pick[]): Pick | null =>
    [...picks].sort((a, b) => legalScore(b) - legalScore(a) || Number(b.owned > 0) - Number(a.owned > 0) || (b.details.regulationMark ?? "").localeCompare(a.details.regulationMark ?? "") || (b.details.hp ?? 0) - (a.details.hp ?? 0))[0] ?? null;

  const records = async (ids: string[], cap: number): Promise<Pick[]> => {
    const out: Pick[] = [];
    const list = ids.slice(0, cap);
    for (let i = 0; i < list.length; i += 6) {
      const got = await Promise.all(
        list.slice(i, i + 6).map(async (id) => {
          try {
            return fromRecord(await deps.source.get(id), ownedById);
          } catch (err) {
            if (err instanceof PokemonSourceError) return null;
            throw err;
          }
        }),
      );
      out.push(...got.filter((g): g is Pick => !!g));
    }
    return out;
  };

  // The card itself, read live.
  let seed: Pick;
  try {
    seed = fromRecord(await deps.source.get(tcgdexIdOf(seedId)!), ownedById);
  } catch (err) {
    if (err instanceof PokemonSourceError) throw new Error(err.kind === "not_found" ? "Diese Karte gibt es nicht." : FRIENDLY_DOWN);
    throw err;
  }
  if (seed.cardType !== "POKEMON") throw new Error("Aus Trainer- und Energiekarten baue ich keinen Entwurf. Such dir ein Pokémon aus.");

  /** A printing of the Pokémon with this English name: one the viewer owns, else the best the source has. */
  const printingOf = async (englishName: string): Promise<Pick | null> => {
    const mine = best(ownedByEn.get(englishName.trim().toLowerCase()) ?? []);
    if (mine && legalScore(mine) >= 1) return mine;
    let found: Pick[] = [];
    try {
      const hits = await deps.source.search({ q: englishName, category: "POKEMON" });
      const ids = hits.filter((h) => sameName(h.name, englishName) || (h.altName !== null && sameName(h.altName, englishName))).map((h) => tcgdexIdOf(h.id) ?? h.id);
      found = (await records(ids, 8)).filter((p) => sameName(p.en, englishName));
    } catch (err) {
      if (!(err instanceof PokemonSourceError)) throw err;
    }
    const live = best(found);
    return live && (!mine || legalScore(live) > legalScore(mine)) ? live : (mine ?? live);
  };

  /** The best card that evolves from this English name, or null. */
  const evolutionOf = async (englishName: string): Promise<Pick | null> => {
    let evolves;
    try {
      evolves = await deps.source.evolvesInto(englishName);
    } catch (err) {
      if (err instanceof PokemonSourceError) return null;
      throw err;
    }
    // A couple of printings per name, so one common name does not use up every read.
    const perName = new Map<string, string[]>();
    for (const e of evolves) perName.set(e.name, [...(perName.get(e.name) ?? []), e.tcgdexId]);
    const ids = [...perName.values()].flatMap((l) => l.slice(0, 2));
    const mine = [...ownedByEn.values()].flat().filter((p) => sameName(p.details.evolveFrom ?? "", englishName));
    const live = (await records(ids, 10)).filter((p) => sameName(p.details.evolveFrom ?? "", englishName));
    return best([...mine, ...live]);
  };

  // The line: down to the Basic, then up while there is something above.
  const chain: Pick[] = [seed];
  for (let guard = 0; guard < 3 && chain[0].details.evolveFrom; guard++) {
    const below = await printingOf(chain[0].details.evolveFrom!);
    if (!below) {
      notes.push(`Die Vorstufe ${chain[0].details.evolveFrom} habe ich nicht gefunden.`);
      break;
    }
    chain.unshift(below);
  }
  for (let guard = 0; guard < 2 && chain.length < 3; guard++) {
    const top = chain[chain.length - 1];
    if (top.details.stage !== "Basic" && top.details.stage !== "Stage1") break;
    const above = await evolutionOf(top.en);
    if (!above) break;
    chain.push(above);
  }
  if (chain[0].details.stage !== "Basic") notes.push("Die Linie beginnt nicht bei einem Basis-Pokémon. Du brauchst noch eins, das das Spiel starten kann.");

  // Quantities: 4-3-2 from the Basic up; two cards sharing a name share the limit.
  const shape = chain.length >= 3 ? [4, 3, 2] : chain.length === 2 ? [4, 3] : [4];
  const planned = new Map<string, { pick: Pick; quantity: number }>();
  const nameLeft = new Map<string, number>();
  chain.forEach((p, i) => {
    const key = pokemonNameKey({ name: p.name, details: p.details });
    const left = rules.copies - (nameLeft.get(key) ?? 0);
    const q = Math.min(shape[i] ?? 2, left, p.details.onePerDeck ? 1 : 4);
    if (q <= 0) return;
    nameLeft.set(key, (nameLeft.get(key) ?? 0) + q);
    planned.set(p.cardId, { pick: p, quantity: (planned.get(p.cardId)?.quantity ?? 0) + q });
  });
  if (!planned.has(seed.cardId)) planned.set(seed.cardId, { pick: seed, quantity: 1 });

  // Energy: the seed's type, else the type its attacks ask for most.
  const typeOf = (p: Pick) => pokemonTypeOf(p.details.display?.types?.[0] ?? null);
  let type = typeOf(seed);
  if (!type || type.en === "Colorless") {
    const counts = new Map<string, number>();
    for (const p of chain) for (const a of p.details.attacks ?? []) for (const c of a.cost) counts.set(c, (counts.get(c) ?? 0) + 1);
    const top = [...counts].map(([name, n]) => ({ t: pokemonTypeOf(name), n })).filter((x) => x.t && x.t.en !== "Colorless").sort((a, b) => b.n - a.n)[0];
    type = top?.t ?? null;
  }
  const avgCost = chain.reduce((n, p) => n + Math.max(0, ...(p.details.attacks ?? []).map((a) => a.cost.length)), 0) / chain.length;
  const energyCount = Math.max(12, Math.min(16, Math.round(9 + 2 * avgCost)));
  let energy: { pick: Pick; quantity: number } | null = null;
  if (!type) notes.push("Welche Energie zu dieser Karte passt, konnte ich nicht erkennen. Such die Energie selbst aus.");
  else {
    // A basic Energy card carries its type only in its name ("Fire Energy", "Basic Fire Energy"), not in a `types` field.
    const named = new RegExp(`^(basic )?${type.en} energy$`, "i");
    const isMine = (p: Pick) => p.details.basicEnergy === true && named.test(p.en.trim());
    let pick = best([...ownedByEn.values()].flat().filter(isMine)) ?? [...ownedList.map(fromOwned)].find(isMine) ?? null;
    if (!pick) {
      try {
        const hits = await deps.source.search({ q: `${type.en} Energy`, category: "ENERGY", type: type.en });
        const found = (await records(hits.map((h) => tcgdexIdOf(h.id) ?? h.id), 6)).filter(isMine);
        pick = best(found) ?? null;
      } catch (err) {
        if (!(err instanceof PokemonSourceError)) throw err;
      }
    }
    if (pick) energy = { pick, quantity: energyCount };
    else notes.push(`Eine einfache ${type.de}-Energie habe ich nicht gefunden. Such sie selbst aus.`);
  }

  // Trainers the viewer owns, legal in the format, most owned first, up to what is left.
  const lineTotal = [...planned.values()].reduce((n, p) => n + p.quantity, 0);
  let left = rules.main - lineTotal - (energy?.quantity ?? 0);
  const trainers: { pick: Pick; quantity: number }[] = [];
  const byName = new Map<string, Pick[]>();
  for (const o of ownedList.filter((c) => c.cardType === "TRAINER")) {
    const p = fromOwned(o);
    if (p.details.legal?.[format as "standard" | "expanded"] === false) continue;
    const key = pokemonNameKey({ name: p.name, details: p.details });
    byName.set(key, [...(byName.get(key) ?? []), p]);
  }
  let aceSpec = 0;
  for (const group of [...byName.values()].sort((a, b) => b.reduce((n, p) => n + p.owned, 0) - a.reduce((n, p) => n + p.owned, 0) || a[0].name.localeCompare(b[0].name))) {
    if (left <= 0) break;
    const p = best(group)!;
    const total = group.reduce((n, g) => n + g.owned, 0);
    let q = Math.min(total, rules.copies, left);
    if (p.details.onePerDeck) q = Math.min(q, 1 - aceSpec);
    if (q <= 0) continue;
    if (p.details.onePerDeck === "ace-spec") aceSpec += q;
    trainers.push({ pick: p, quantity: q });
    left -= q;
  }
  if (!trainers.length) notes.push("Du hast noch keine passenden Trainerkarten. Such dir welche zum Ziehen und Suchen dazu.");

  // Store what only the source knows, then the deck.
  const all = [...planned.values(), ...(energy ? [energy] : []), ...trainers];
  const have = new Set((await db.select({ id: cards.id }).from(cards).where(inArray(cards.id, all.map((a) => a.pick.cardId)))).map((r) => r.id));
  for (const { pick } of all) if (pick.record && !have.has(pick.cardId)) await deps.ensure(db, pick.tcgdexId, { record: pick.record });
  const mainTotal = all.reduce((n, p) => n + p.quantity, 0);
  const toBuy = [...planned.values(), ...trainers].reduce((n, { pick, quantity }) => n + Math.max(0, quantity - pick.owned), 0);
  const description = [
    "Das ist ein Entwurf zum Anpassen, kein fertiges Deck.",
    `Entwicklungslinie: ${chain.map((p) => p.name).join(" → ")}.`,
    energy ? `${energy.quantity} × ${energy.pick.name} als Energie.` : "",
    trainers.length ? `Trainer aus deiner Sammlung: ${trainers.map((t) => `${t.quantity}× ${t.pick.name}`).join(", ")}.` : "",
    mainTotal < rules.main ? `Es fehlen noch ${rules.main - mainTotal} Karten bis ${rules.main}.` : "",
    toBuy > 0 ? `Von der Linie und den Trainern fehlen dir noch ${toBuy} Karten.` : "",
    ...notes,
  ]
    .filter(Boolean)
    .join("\n");

  const [deck] = await db
    .insert(decks)
    .values({ name: `Deck um ${seed.name}`.slice(0, 120), game: "pokemon", format, description, owner: opts.owner })
    .returning({ id: decks.id });
  await db.insert(deckCards).values(all.map(({ pick, quantity }) => ({ deckId: deck.id, cardId: pick.cardId, zone: "main", quantity })));

  const stored = await getDeck(db, deck.id);
  const rows = stored?.cards ?? [];
  return {
    deckId: deck.id,
    mainCount: rows.filter((r) => r.zone === "main").reduce((n, r) => n + r.quantity, 0),
    toBuy,
    legality: pokemonAdapter(deps).validate(rows, format),
    notes,
    line: [...planned.values()].map(({ pick, quantity }) => ({ cardId: pick.cardId, name: pick.name, quantity })),
    energy: energy ? { cardId: energy.pick.cardId, name: energy.pick.name, quantity: energy.quantity } : null,
  };
}
