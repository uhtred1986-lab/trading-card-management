/**
 * The Pokémon adapter. Rules text comes from `GAME_INFO.pokemon.deck` and the checker in
 * `src/lib/decks/pokemonLegality.ts`; cards are described from `cards.details`; the card source is the
 * viewer's own stored cards plus live TCGdex lookups (`pokemon-source.ts`); a finished deck is labelled
 * by `legality(rows, "pokemon", format)`, never refused.
 */
import { inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { cards } from "@/db/schema";
import { gameInfo } from "@/lib/catalog/games";
import { legality } from "@/lib/decks/legality";
import { pokemonFormatOf } from "@/lib/decks/pokemonLegality";
import { deckToText } from "@/lib/decks/queries";
import { ensurePokemonCard } from "@/lib/pokemon/store";
import { PokemonSourceError } from "@/lib/pokemon/tcgdex";
import { isPokemonCardId, pokemonCardId, tcgdexIdOf } from "@/lib/pokemon/types";
import { answerLanguageLine } from "./language";
import { cardForName, cardNames, nameAgrees } from "./pokemon-names";
import { describePokemonCard, liveSource, ownedLines, ownedPokemonCards, pokemonLookupTools, type PokemonSource } from "./pokemon-source";
import { PokemonWizardSchema } from "./schemas";
import type { AnalysisContext, GameAdapter, WizardSource } from "./types";

const FORMAT_NAME: Record<string, string> = { standard: "Standard", expanded: "Expanded" };

/** What the adapter reaches the outside world through: the card source and the writer of stored cards. */
export interface PokemonDeps {
  source: PokemonSource;
  /** Stores a card read from the source (`ensurePokemonCard`); a check passes a stub. */
  ensure: typeof ensurePokemonCard;
}

export const liveDeps: PokemonDeps = { source: liveSource, ensure: ensurePokemonCard };

export function pokemonRulesText(ctx: AnalysisContext = {}): string {
  const info = gameInfo("pokemon");
  const r = info.deck;
  const format = pokemonFormatOf(ctx.format);
  return [
    `Deck rules for this game: exactly ${r.main} cards, no Leader and no Z-Deck; at most ${r.copies} cards with the same NAME (the limit counts the name, so two printings of one Pokémon share it; basic Energy cards are unlimited); at most one ACE SPEC card and one Radiant Pokémon per deck; at least one Basic Pokémon.`,
    `This deck's format is ${FORMAT_NAME[format] ?? format} (the game has ${r.formats.map((f) => FORMAT_NAME[f] ?? f).join(" and ")}). Every card must be legal in the format: each card line says whether it is legal in Standard and in Expanded ("?" means unknown). A deck that breaks a rule is flagged, never blocked.`,
  ].join("\n");
}

/** Cards of a deck that are not stored yet (a live game stores on reference): store them. Unknown ids are skipped. */
async function materialise(db: Db, deps: PokemonDeps, ids: string[]): Promise<void> {
  const wanted = [...new Set(ids.filter(isPokemonCardId))];
  if (!wanted.length) return;
  const have = new Set((await db.select({ id: cards.id }).from(cards).where(inArray(cards.id, wanted))).map((r) => r.id));
  for (const id of wanted) {
    if (have.has(id)) continue;
    const tcgdexId = tcgdexIdOf(id);
    if (!tcgdexId) continue;
    try {
      await deps.ensure(db, tcgdexId, { record: await deps.source.get(tcgdexId) });
    } catch (err) {
      if (!(err instanceof PokemonSourceError)) throw err;
    }
  }
}

/**
 * The name check of `pokemon-names.ts` for the wizard's swaps: an added card whose id is another card
 * than the one the model named is looked up by that name; found, the swap takes the right id; not
 * found, the swap is dropped. A swap that names no card (an old answer shape) is left alone.
 */
export async function verifySwapNames<S extends { inCardId: string }>(db: Db, deps: PokemonDeps, swaps: S[], format: string | null): Promise<S[]> {
  const fmt = pokemonFormatOf(format);
  const ids = [...new Set(swaps.map((s) => normaliseSwapId(s.inCardId)).filter((x): x is string => !!x))];
  const stored = ids.length ? await db.select({ id: cards.id, name: cards.name, details: cards.details }).from(cards).where(inArray(cards.id, ids)) : [];
  const names = new Map(stored.map((r) => [r.id, cardNames(r)]));
  const kept: S[] = [];
  for (const s of swaps) {
    const said = (s as { inName?: unknown }).inName;
    const id = normaliseSwapId(s.inCardId);
    if (typeof said !== "string" || !said.trim()) {
      kept.push(s);
      continue;
    }
    let known = id ? names.get(id) : undefined;
    if (id && !known) {
      try {
        const rec = await deps.source.get(tcgdexIdOf(id)!);
        known = cardNames({ name: rec.hit.name, details: rec.details });
        names.set(id, known);
      } catch (err) {
        if (!(err instanceof PokemonSourceError)) throw err;
      }
    }
    if (id && known && nameAgrees(said, known)) {
      kept.push({ ...s, inCardId: id });
      continue;
    }
    const rec = await cardForName(deps.source, said, fmt);
    if (rec) kept.push({ ...s, inCardId: pokemonCardId(rec.tcgdexId) });
  }
  // A deck that is far from finished draws more swaps than a page should show: the most important ten.
  const rank = (s: S) => ({ high: 0, medium: 1, low: 2 })[(s as { priority?: string }).priority ?? "low"] ?? 2;
  return kept.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i).slice(0, MAX_SWAPS).map((x) => x.s);
}

/** Most swaps one wizard run shows. */
export const MAX_SWAPS = 10;

const normaliseSwapId = (raw: string): string | null => {
  const t = raw.trim();
  const id = isPokemonCardId(t) ? tcgdexIdOf(t) : null;
  return id ? pokemonCardId(id) : null;
};

export function pokemonAdapter(deps: PokemonDeps = liveDeps): GameAdapter {
  const info = gameInfo("pokemon");
  const language = answerLanguageLine("pokemon");
  return {
    game: "pokemon",
    lang: info.uiLang,
    promptName: info.promptName,
    rulesText: (ctx) => pokemonRulesText(ctx),
    analystSystem(ctx) {
      return [
        `You are an expert ${info.promptName} deck analyst.`,
        "Reason only from the card data given to you. Each card line gives the card id, the name in German and English, the category, type, HP, stage, what it evolves from, abilities and attacks as printed (in German) and its legality in Standard and Expanded.",
        "Refer to cards by their exact card id (e.g. PKM-sv03.5-006) as given. Be concrete and concise.",
        pokemonRulesText(ctx),
        ...(language ? [language] : []),
      ].join("\n");
    },
    describeCard: describePokemonCard,
    deckBlock(rows, ctx) {
      const check = legality(rows, "pokemon", ctx?.format);
      return [
        "DECKLIST:",
        deckToText(rows),
        "",
        "CARD TEXT:",
        ...rows.map((r) => describePokemonCard({ ...r, id: r.cardId })),
        ...(check.issues.length ? ["", "RULES CHECK OF THE APP (already computed, in German):", ...check.issues.map((i) => `- ${i.message}`)] : []),
      ].join("\n");
    },
    swapInstruction() {
      const r = info.deck;
      return `Propose card-for-card swaps that improve this deck. Each swap removes a card that is in the deck and adds one from the player's own cards or one you looked up with the tools (use the PKM-… card id exactly as given). For a well-known card you have no id for (a staple Trainer, a basic Energy), you need no lookup: give its exact official ENGLISH name (never a translation of your own: German card names often differ from what a translation would give) in inName and an empty string as inCardId; the app finds the printing that is legal in the format of the deck. Use lookups for cards whose text you need to read. Keep the deck at exactly ${r.main} cards (outQuantity should equal inQuantity unless fixing a count problem) and respect the ${r.copies}-copy limit counted by card NAME (basic Energy is unlimited; one ACE SPEC, one Radiant).`;
    },
    wizardSchema: PokemonWizardSchema,
    async wizardSource(db, deck, scope): Promise<WizardSource> {
      const owned = await ownedPokemonCards(db, deck.owner, { exclude: deck.cards.map((c) => c.cardId) });
      const lookups = scope === "any";
      const head = lookups
        ? "THE PLAYER'S OWN CARDS OUTSIDE THIS DECK (OWN×n = copies owned; prefer these). For any other card use the lookup tools; the ids a lookup returns are valid additions."
        : "CANDIDATE POOL (cards the player owns; only suggest additions from this list):";
      return {
        size: owned.length,
        error: !lookups && owned.length === 0 ? "Du besitzt keine passenden Pokémon-Karten außerhalb dieses Decks." : null,
        poolBlock: `${head}\n${owned.length ? ownedLines(owned, 240).join("\n") : "(none)"}`,
        tools: lookups ? pokemonLookupTools(deps.source) : [],
        materialise: (db2, ids) => materialise(db2, deps, ids),
        verify: (db2, swaps, format) => verifySwapNames(db2, deps, swaps, format),
      };
    },
    validate: (rows, format) => legality(rows, "pokemon", format),
  };
}
