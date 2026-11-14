/**
 * "Build a deck with Claude" for Pokémon, and Claude's path of "build around this card".
 *
 * The model gets the player's own stored cards first and the lookup tools for everything else
 * (`pokemon-source.ts`); its draft is cleaned here (unknown ids dropped, the 4-by-name rule and the
 * one-per-deck cards enforced, never more than 60), every card it chose that is not stored yet is stored
 * with `ensurePokemonCard`, and the stored deck is labelled with `legality` — a flag, never a block.
 * The deck is stamped with its owner like every deck-creating path.
 */
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { cards, deckCards, decks } from "@/db/schema";
import { gameInfo } from "@/lib/catalog/games";
import { pokemonFormatOf, pokemonNameKey } from "@/lib/decks/pokemonLegality";
import { getDeck } from "@/lib/decks/queries";
import type { DeckLegality } from "@/lib/decks/legality";
import { PokemonSourceError, type PokemonCardRecord } from "@/lib/pokemon/tcgdex";
import { pokemonCardId, pokemonDetails, tcgdexIdOf } from "@/lib/pokemon/types";
import { recordRun } from "../client";
import { generateWithLookups } from "../tools";
import { answerLanguageLine } from "./language";
import { cardForName, cardNames, nameAgrees } from "./pokemon-names";
import { describeRecord, ownedLines, ownedPokemonCards, pokemonLookupTools } from "./pokemon-source";
import { liveDeps, pokemonAdapter, pokemonRulesText, type PokemonDeps } from "./pokemon";

export const PokemonDraftSchema = z.object({
  name: z.string().describe("Short deck name, e.g. 'Glurak Feuersturm'"),
  strategy: z.string().describe("3–5 sentences: game plan, key interactions, how it wins"),
  cards: z
    .array(z.object({ cardId: z.string(), name: z.string().describe("The card's name exactly as the player's list or the lookup gave it for that id"), quantity: z.number().int().min(1).max(20) }))
    .max(60)
    .describe("The deck: exactly 60 cards in total (basic Energy counts), card ids exactly as given"),
  purchases: z
    .array(z.object({ cardId: z.string(), quantity: z.number().int().min(1).max(20), why: z.string() }))
    .describe("Every card used that the player does NOT own, with a one-line reason it is worth getting"),
});
export type PokemonDraft = z.infer<typeof PokemonDraftSchema>;

export interface PokemonBuildInput {
  /** A card the deck is built around (a PKM-… card id). */
  seedCardId?: string | null;
  /** What the player wants, in their own words. */
  wish?: string | null;
  format?: string | null;
  /** Stamped on the deck and the scope of "owned". */
  owner: string | null;
}

/** Most cards the builder adds by itself when the model's list falls short of the deck size (see `topUpEnergy`). */
export const TOP_UP_LIMIT = 6;

/**
 * A list a few cards short of the deck size gets that many more of the basic Energy it already plays
 * most of. Seen in the first live run (14 Nov 2026): a sound 59-card list. More basic Energy is the one
 * addition that needs no judgement; a list further off, or one with no basic Energy, is left short and
 * the checker says so. Returns how many were added.
 */
export function topUpEnergy(lines: { cardId: string; quantity: number }[], known: Map<string, KnownCard>, size = gameInfo("pokemon").deck.main): number {
  const total = lines.reduce((n, l) => n + l.quantity, 0);
  const gap = size - total;
  if (gap <= 0 || gap > TOP_UP_LIMIT) return 0;
  const energy = lines.filter((l) => pokemonDetails(known.get(l.cardId)?.details).basicEnergy).sort((a, b) => b.quantity - a.quantity)[0];
  if (!energy) return 0;
  energy.quantity += gap;
  return gap;
}

export interface PokemonBuildResult {
  deckId: number;
  draft: PokemonDraft;
  mainCount: number;
  /** Copies the player would still have to get. */
  toBuy: number;
  dropped: string[];
  trimmed: string[];
  /** Entries whose id was another card than the one named, put right by name. */
  corrected: number;
  /** Basic Energy added to reach the deck size. */
  toppedUp: number;
  legality: DeckLegality;
  lookups: number;
}

// ── Cleaning the draft ───────────────────────────────────────────────────────

export interface KnownCard {
  name: string;
  cardType: string;
  details: unknown;
}

/** The catalog id a model's id means: `PKM-sv03.5-006`, with a variant suffix or a bare TCGdex id tolerated; null for anything else. */
export function normaliseCardId(raw: string): string | null {
  const s = raw.trim();
  const id = s.startsWith("PKM-") ? tcgdexIdOf(s) : /^[A-Za-z0-9.]+-[A-Za-z0-9]+$/.test(s) ? s : null;
  return id ? pokemonCardId(id) : null;
}

export interface CleanedDraft {
  lines: { cardId: string; quantity: number }[];
  dropped: string[];
  trimmed: string[];
}

/**
 * The model's list as a deck list the rules can bear: ids resolved against `known` (the rest dropped), a
 * card named twice merged, at most 4 per card NAME unless it is a basic Energy, one ACE SPEC and one
 * Radiant, and no more than the deck size. Short of 60 is left short; the checker says so.
 */
export function cleanPokemonDraft(list: { cardId: string; quantity: number }[], known: Map<string, KnownCard>, rules = gameInfo("pokemon").deck): CleanedDraft {
  const dropped: string[] = [];
  const trimmed: string[] = [];
  const merged = new Map<string, number>();
  for (const e of list) {
    const id = normaliseCardId(e.cardId);
    if (!id || !known.has(id)) {
      // A card given by name only has no id to show: its name says what was left out.
      dropped.push(e.cardId.trim() || (e as { name?: string }).name?.trim() || "?");
      continue;
    }
    merged.set(id, (merged.get(id) ?? 0) + Math.max(0, Math.floor(e.quantity)));
  }
  const perName = new Map<string, number>();
  const one = { "ace-spec": 0, radiant: 0 };
  const lines: { cardId: string; quantity: number }[] = [];
  let total = 0;
  for (const [cardId, wanted] of merged) {
    const c = known.get(cardId)!;
    const d = pokemonDetails(c.details);
    let q = wanted;
    if (!d.basicEnergy) {
      const key = pokemonNameKey({ name: c.name, details: c.details });
      const left = rules.copies - (perName.get(key) ?? 0);
      q = Math.min(q, Math.max(0, left));
      perName.set(key, (perName.get(key) ?? 0) + q);
    }
    if (d.onePerDeck) {
      q = Math.min(q, 1 - one[d.onePerDeck]);
      one[d.onePerDeck] += q;
    }
    q = Math.min(q, rules.main - total);
    if (q < wanted) trimmed.push(cardId);
    if (q <= 0) continue;
    lines.push({ cardId, quantity: q });
    total += q;
  }
  return { lines, dropped, trimmed };
}

/** Which of `ids` are stored (with their data) and which only the source knows (read, a few at a time). */
async function resolveKnown(db: Db, deps: PokemonDeps, ids: string[]): Promise<{ known: Map<string, KnownCard>; records: Map<string, PokemonCardRecord> }> {
  const known = new Map<string, KnownCard>();
  const records = new Map<string, PokemonCardRecord>();
  const stored = ids.length ? await db.select({ id: cards.id, name: cards.name, cardType: cards.cardType, details: cards.details }).from(cards).where(inArray(cards.id, ids)) : [];
  for (const r of stored) known.set(r.id, { name: r.name, cardType: r.cardType, details: r.details });
  const missing = ids.filter((id) => !known.has(id));
  for (let i = 0; i < missing.length; i += 6) {
    await Promise.all(
      missing.slice(i, i + 6).map(async (id) => {
        const tcgdexId = tcgdexIdOf(id);
        if (!tcgdexId) return;
        try {
          const rec = await deps.source.get(tcgdexId);
          records.set(id, rec);
          known.set(id, { name: rec.hit.name, cardType: rec.category, details: rec.details });
        } catch (err) {
          if (!(err instanceof PokemonSourceError)) throw err;
        }
      }),
    );
  }
  return { known, records };
}

// ── The prompt ───────────────────────────────────────────────────────────────

function systemFor(format: string, seedLine: string | null): string {
  const info = gameInfo("pokemon");
  const r = info.deck;
  const language = answerLanguageLine("pokemon");
  return [
    `You are an expert ${info.promptName} deck builder.`,
    `Build a coherent, playable ${r.main}-card deck for a young player. Each card line gives the card id, the name in German and English, the category, type, HP, stage, what it evolves from, abilities and attacks as printed (in German) and its legality in Standard and Expanded.`,
    pokemonRulesText({ format }),
    `Rules: exactly ${r.main} cards in total (basic Energy counts); at most ${r.copies} cards with the same name; refer to cards by their exact card id (PKM-…).`,
    "A good deck has Basic Pokémon that can start the game, every Stage 1 and Stage 2 with its pre-evolution in the deck, about 10 to 14 basic Energy cards of the deck's type, and a few Trainers that draw cards or search the deck. Put the right number of copies of each card: usually 4 of the main attacker's Basic, 3 of its middle stage, 2 to 3 of the final one.",
    "Card source: the cards the player owns are listed below (OWN×n). Every card id you use must come from that list or from a lookup. For a well-known card you have no id for (a staple Trainer, a basic Energy), you need no lookup: give its exact official ENGLISH name (never a translation of your own: German card names often differ from what a translation would give) in `name` and an empty string as `cardId`; the app finds the printing that is legal in the format of the deck. Use lookups for cards whose text you need to read. Prefer OWN cards strongly; use other cards only where they clearly make the deck better, and list each one in `purchases` with a reason.",
    "Never more than 16 basic Energy cards. If you cannot find enough good cards, leave the deck a few cards short rather than filling it with Energy: the app says how many are missing.",
    ...(seedLine ? [`The seed card MUST be in the deck with at least 1 copy and the deck is built around it: ${seedLine}`] : []),
    ...(language ? [language] : []),
  ].join("\n");
}

// ── The build ────────────────────────────────────────────────────────────────

export async function buildPokemonDeckWithClaude(db: Db, input: PokemonBuildInput, deps: PokemonDeps = liveDeps): Promise<PokemonBuildResult> {
  const adapter = pokemonAdapter(deps);
  const format = pokemonFormatOf(input.format);
  const seedId = input.seedCardId ? normaliseCardId(input.seedCardId) : null;
  if (input.seedCardId && !seedId) throw new Error("Diese Karte ist keine Pokémon-Karte.");
  const wish = input.wish?.trim().slice(0, 500) || null;
  if (!seedId && !wish) throw new Error("Sag mir, was für ein Deck du willst, oder such dir eine Karte aus.");

  let seedLine: string | null = null;
  if (seedId) {
    try {
      seedLine = describeRecord(await deps.source.get(tcgdexIdOf(seedId)!));
    } catch (err) {
      if (err instanceof PokemonSourceError) throw new Error(err.kind === "not_found" ? "Diese Karte gibt es nicht." : "Die Kartensuche ist gerade nicht erreichbar. Versuch es gleich noch einmal.");
      throw err;
    }
  }

  const owned = await ownedPokemonCards(db, input.owner ?? undefined, { limit: 200 });
  const poolBlock = `THE PLAYER'S OWN CARDS (OWN×n = copies owned):\n${owned.length ? ownedLines(owned, 220).join("\n") : "(none yet: use the lookup tools)"}`;
  const ask = [seedLine ? `SEED CARD: ${seedLine}` : "", wish ? `THE PLAYER'S WISH: ${wish}` : "", "Build the deck."].filter(Boolean).join("\n\n");
  const task = seedId ? ("deck_from_card" as const) : ("deck_builder" as const);

  const res = await generateWithLookups(
    {
      task,
      tier: "best",
      maxTokens: 12000,
      thinking: "adaptive",
      effort: "high",
      schema: PokemonDraftSchema,
      system: [{ text: systemFor(format, seedLine) }, { text: poolBlock, cache: "short" }],
      messages: [{ role: "user", parts: [{ type: "text", text: ask }] }],
    },
    pokemonLookupTools(deps.source),
  );
  const { output: draft } = await recordRun<PokemonDraft>(db, task, { game: "pokemon", mode: seedId ? "from-card" : "build", seedCardId: seedId, wish, format, ownedPool: owned.length, lookups: res.lookupLog }, res);

  // Clean the draft against what the cards really are, then store the ones only the source knows.
  const wanted = [...new Set([...draft.cards.map((c) => normaliseCardId(c.cardId)), seedId].filter((x): x is string => !!x))];
  const { known, records } = await resolveKnown(db, deps, wanted);
  // The name check (pokemon-names.ts): an id that is another card than the one named is put right by name.
  let corrected = 0;
  const idFix = new Map<string, string>();
  for (const c of draft.cards) {
    const id = normaliseCardId(c.cardId);
    const k = id ? known.get(id) : undefined;
    if (!c.name?.trim() || (k && nameAgrees(c.name, cardNames(k)))) continue;
    const rec = await cardForName(deps.source, c.name, format);
    if (!rec) continue;
    const right = pokemonCardId(rec.tcgdexId);
    if (!known.has(right)) {
      known.set(right, { name: rec.hit.name, cardType: rec.category, details: rec.details });
      records.set(right, rec);
    }
    idFix.set(c.cardId, right);
    c.cardId = right;
    corrected++;
  }
  for (const p of draft.purchases) p.cardId = idFix.get(p.cardId) ?? p.cardId;
  const cleaned = cleanPokemonDraft(draft.cards, known);
  if (seedId && known.has(seedId) && !cleaned.lines.some((l) => l.cardId === seedId)) {
    // The model was told the seed card must be in; enforce it rather than trust it (the Dragon Ball builder does the same).
    cleaned.lines.unshift({ cardId: seedId, quantity: 1 });
    let total = cleaned.lines.reduce((n, l) => n + l.quantity, 0);
    for (let i = cleaned.lines.length - 1; total > gameInfo("pokemon").deck.main && i > 0; i--) {
      const last = cleaned.lines[i];
      if (last.quantity > 1) {
        last.quantity -= 1;
        total -= 1;
      } else {
        cleaned.lines.splice(i, 1);
        total -= 1;
      }
    }
  }
  const toppedUp = topUpEnergy(cleaned.lines, known);
  for (const l of cleaned.lines) {
    const rec = records.get(l.cardId);
    if (rec) await deps.ensure(db, rec.tcgdexId, { record: rec });
  }

  const ownedById = new Map(owned.map((o) => [o.id, o.owned]));
  const reasons = new Map(draft.purchases.map((p) => [normaliseCardId(p.cardId) ?? p.cardId, p.why]));
  const buy = cleaned.lines
    .map((l) => ({ ...l, need: Math.max(0, l.quantity - (ownedById.get(l.cardId) ?? 0)) }))
    .filter((l) => l.need > 0 && !(pokemonDetails(known.get(l.cardId)?.details).basicEnergy ?? false));
  const description = [
    draft.strategy,
    "",
    buy.length ? `Dir fehlen noch (${buy.length} Karte${buy.length === 1 ? "" : "n"}):\n${buy.map((l) => `- ${l.need}× ${known.get(l.cardId)!.name} (${l.cardId})${reasons.get(l.cardId) ? `: ${reasons.get(l.cardId)}` : ""}`).join("\n")}` : "Alles außer Energie hast du schon.",
    cleaned.dropped.length ? `\nNicht gefunden, ausgelassen: ${cleaned.dropped.join(", ")}` : "",
    toppedUp ? `\nIch habe ${toppedUp} Basis-Energie ergänzt, damit es 60 Karten sind.` : "",
  ]
    .join("\n")
    .trim();

  const [deck] = await db
    .insert(decks)
    .values({ name: `${draft.name} (Claude-Entwurf)`.slice(0, 120), game: "pokemon", format, description, owner: input.owner })
    .returning({ id: decks.id });
  if (cleaned.lines.length) await db.insert(deckCards).values(cleaned.lines.map((l) => ({ deckId: deck.id, cardId: l.cardId, zone: "main", quantity: l.quantity })));
  await db.update(decks).set({ aiSummary: draft.strategy, aiSummaryAt: new Date() }).where(eq(decks.id, deck.id));

  const stored = await getDeck(db, deck.id);
  const rows = stored?.cards ?? [];
  return {
    deckId: deck.id,
    draft,
    mainCount: rows.filter((r) => r.zone === "main").reduce((n, r) => n + r.quantity, 0),
    toBuy: buy.reduce((n, l) => n + l.need, 0),
    dropped: cleaned.dropped,
    trimmed: cleaned.trimmed,
    corrected,
    toppedUp,
    legality: adapter.validate(rows, format),
    lookups: res.lookupLog.length,
  };
}
