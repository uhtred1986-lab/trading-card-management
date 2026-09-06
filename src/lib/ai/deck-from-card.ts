/**
 * "Build a deck around this card": the reverse of the leader wizard in
 * `deck-builder.ts` — the player picks any non-Leader card they like, and
 * Claude also chooses the Leader, from a candidate pool of Leaders whose
 * colours can legally hold the seed card. Everything downstream (the card
 * pool, copy-limit sanitisation, virtual-deck persistence) reuses that
 * module so the two wizards stay in lock-step.
 */
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { and, asc, desc, eq, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { cardSets, cards, deckCards, decks, ownedCards } from "@/db/schema";
import { textArray } from "@/db/sqlx";
import { gameInfo, gameOr, type Game } from "@/lib/catalog/games";
import { currentLineFor } from "@/lib/catalog/sets";
import { rulesFor } from "@/lib/decks/cardRules";
import { MODEL, anthropic, recordRun } from "./client";
import { cardLine } from "./deck";
import { sanitiseDraft, type PoolCard } from "./deck-builder";

const DeckFromCardDraftSchema = z.object({
  leaderId: z.string().describe("Card number of the chosen Leader, from the LEADER CANDIDATES list"),
  name: z.string().describe("Short deck name, e.g. 'Yellow Launch Tournament Aggro'"),
  strategy: z.string().describe("3–5 sentences: game plan, key interactions, how it wins, and why this Leader suits the seed card"),
  main: z.array(z.object({ cardId: z.string(), quantity: z.number().int().min(1).max(4) })).describe("Exactly 50 cards in total, including the seed card"),
  zDeck: z
    .array(z.object({ cardId: z.string(), quantity: z.number().int().min(1).max(4) }))
    .max(8)
    .describe("Z-Deck cards (Z-BATTLE/Z-EXTRA/Z-UNISON/Z-LEADER), up to 8 total; empty if none fit, and ALWAYS empty for a game with no Z-Deck"),
  purchases: z.array(z.object({ cardId: z.string(), quantity: z.number().int().min(1).max(4), why: z.string() })).describe("Every card used that is NOT owned, with a one-line reason it's worth buying"),
});
type DeckFromCardDraft = z.infer<typeof DeckFromCardDraftSchema>;

interface LeaderCandidate {
  id: string;
  name: string;
  cardType: string;
  colors: string[];
  energyCost: string | null;
  power: number | null;
  skill: string | null;
  traits: string[];
  rarityCode: string;
  imageUrl: string | null;
  owned: number;
}

const OWNED_CAP = 600;
const BUY_CAP = 280;
const OWNED_LEADER_CAP = 40;
const BUY_LEADER_CAP = 60;

const cardSelect = {
  id: cards.id,
  name: cards.name,
  cardType: cards.cardType,
  colors: cards.colors,
  energyCost: cards.energyCost,
  power: cards.power,
  skill: cards.skill,
  traits: cards.traits,
  rarityCode: cards.rarityCode,
  limitedTo: cards.limitedTo,
};

const leaderSelect = {
  id: cards.id,
  name: cards.name,
  cardType: cards.cardType,
  colors: cards.colors,
  energyCost: cards.energyCost,
  power: cards.power,
  skill: cards.skill,
  traits: cards.traits,
  rarityCode: cards.rarityCode,
  imageUrl: cards.imageUrl,
};

interface CardPools {
  seed: typeof cards.$inferSelect;
  game: Game;
  owned: PoolCard[];
  buy: PoolCard[];
  leaders: LeaderCandidate[];
}

/**
 * The seed card's own colours (never a chosen Leader's — none is chosen yet)
 * scope both the non-Leader card pool and which Leaders may legally play it:
 * a Leader is only offered if its colours are a superset of the seed card's,
 * which guarantees every pool card stays legal whichever candidate is picked.
 */
export async function buildPoolsForCard(db: Db, cardId: string): Promise<CardPools> {
  const seed = await db.query.cards.findFirst({ where: eq(cards.id, cardId) });
  if (!seed) throw new Error("Card not found");
  if (seed.cardType === "LEADER") throw new Error(`${seed.name} is a Leader — use "Build a deck with Claude" on the Leaders page instead.`);
  const game = gameOr(seed.game);
  const info = gameInfo(game);
  if (info.nonDeckTypes.includes(seed.cardType) || seed.isBanned) throw new Error(`${seed.name} cannot be played in a deck.`);

  const colours = [...seed.colors, "Colorless"];
  const onColour = [eq(cards.isBanned, false), eq(cards.game, game), notInArray(cards.cardType, ["LEADER", ...info.nonDeckTypes]), sql`${cards.colors} <@ ${textArray(colours)}`];
  // A Leader may hold the seed card only if its colours are a superset of the seed's.
  const leaderOnColour = [eq(cards.isBanned, false), eq(cards.game, game), eq(cards.cardType, "LEADER"), sql`${textArray(seed.colors)} <@ ${cards.colors}`];

  const owned = await db
    .select({ ...cardSelect, owned: sql<number>`count(*)::int` })
    .from(cards)
    .innerJoin(ownedCards, eq(ownedCards.cardId, cards.id))
    .where(and(...onColour))
    .groupBy(cards.id)
    .orderBy(asc(cards.id))
    .limit(OWNED_CAP);
  const ownedIds = owned.map((c) => c.id);
  const buy = await db
    .select(cardSelect)
    .from(cards)
    .innerJoin(cardSets, eq(cardSets.code, cards.setCode))
    .where(and(...onColour, ownedIds.length ? notInArray(cards.id, ownedIds) : undefined, sql`(${cardSets.line} = ${currentLineFor(game)} or ${cards.setCode} = ${seed.setCode})`))
    .orderBy(desc(cardSets.sortKey), asc(cards.id))
    .limit(BUY_CAP);

  const ownedLeaders = await db
    .select({ ...leaderSelect, owned: sql<number>`count(*)::int` })
    .from(cards)
    .innerJoin(ownedCards, eq(ownedCards.cardId, cards.id))
    .where(and(...leaderOnColour))
    .groupBy(cards.id)
    .orderBy(asc(cards.id))
    .limit(OWNED_LEADER_CAP);
  const ownedLeaderIds = ownedLeaders.map((c) => c.id);
  const buyLeaders = await db
    .select(leaderSelect)
    .from(cards)
    .innerJoin(cardSets, eq(cardSets.code, cards.setCode))
    .where(and(...leaderOnColour, ownedLeaderIds.length ? notInArray(cards.id, ownedLeaderIds) : undefined, eq(cardSets.line, currentLineFor(game))))
    .orderBy(desc(cardSets.sortKey), asc(cards.id))
    .limit(BUY_LEADER_CAP);

  return {
    seed,
    game,
    owned,
    buy: buy.map((c) => ({ ...c, owned: 0 })),
    leaders: [...ownedLeaders, ...buyLeaders.map((c) => ({ ...c, owned: 0 }))],
  };
}

export async function suggestDeckFromCard(db: Db, cardId: string): Promise<{ deckId: number; leaderId: string; leaderName: string; draft: DeckFromCardDraft; mainCount: number; toBuy: number }> {
  const { seed, game, owned, buy, leaders } = await buildPoolsForCard(db, cardId);
  if (owned.length + buy.length < 30) throw new Error("Not enough on-colour cards in the catalog for this card.");
  if (leaders.length === 0) throw new Error("No Leader in the catalog can legally play this card's colours.");
  const pool = new Map<string, PoolCard>([...owned, ...buy].map((c) => [c.id, c]));
  const leaderPool = new Map(leaders.map((l) => [l.id, l]));
  const info = gameInfo(game);
  const rules = info.deck;
  const seedZone = seed.cardType.startsWith("Z-") ? "z" : "main";

  const poolRules = rulesFor([...owned, ...buy]);
  const cardRow = (c: PoolCard) => `${c.owned ? `OWN×${c.owned}` : "BUY"} | ${cardLine(c, 220)}`;
  const leaderRow = (l: LeaderCandidate) => `${l.owned ? "OWN" : "BUY"} | ${cardLine(l, 220)}`;
  const system = [
    `You are an expert ${info.promptName} deck builder.`,
    `A player likes one specific card and wants a whole deck built around it. First choose a Leader for it from the LEADER CANDIDATES list — every one listed is legal for this card's colours. Then build a competitive, coherent ${rules.main}-card main deck. Card text uses [brackets] for keywords, {braces} for card names, <angle brackets> for traits.`,
    `The seed card, ${seed.id} (${seed.name}), MUST appear in the deck (in the ${seedZone === "z" ? "Z-Deck" : "main deck"}) with at least 1 copy — it is the reason this deck exists.`,
    `Rules: exactly ${rules.main} main-deck cards (the legal range is ${rules.main}–${rules.mainMax}, but build ${rules.main}); at most ${rules.copies} copies of any card number (fewer if the pool row says a lower limit); ` +
      (rules.zMax > 0 ? `only Z- type cards go in the Z-Deck (max ${rules.zMax}); ` : "this game has NO Z-Deck — leave `zDeck` empty; ") +
      "all cards must come from the pool below; refer to cards by exact card number.",
    ...(rules.colorStrict ? ["Every card in the deck must share a colour with the Leader. The pool below is already filtered to legal colours, so simply do not invent cards."] : []),
    ...poolRules.map((r) =>
      r.unlimitedCopies
        ? `SPECIAL RULE — [${r.keyword}]: the 4-copy cap does NOT apply to cards with [${r.keyword}]; instead the deck may hold at most ${r.max} of them in total, in any mix of copies.`
        : `SPECIAL RULE — [${r.keyword}]: the deck may hold at most ${r.max} cards with [${r.keyword}] in total.`,
    ),
    "STRONGLY prefer OWN cards (the player already has them, up to the quantity shown) for both the Leader and the deck. Use BUY cards only where they meaningfully improve the deck, and list every BUY card used in `purchases` with a reason.",
  ].join("\n");
  const leaderBlock = `LEADER CANDIDATES (OWN = owned, BUY = would need buying):\n${leaders.map(leaderRow).join("\n")}`;
  const poolBlock = `CARD POOL (OWN×n = owned copies, BUY = would need buying):\n${[...owned, ...buy].map(cardRow).join("\n")}`;
  const ask = `SEED CARD: ${cardLine(seed, 400)}\n\nPick a Leader and draft the deck around this card.`;

  const res = await anthropic().messages.parse({
    model: MODEL,
    max_tokens: 12000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: zodOutputFormat(DeckFromCardDraftSchema) },
    system: [
      { type: "text", text: system },
      { type: "text", text: leaderBlock, cache_control: { type: "ephemeral" } },
      { type: "text", text: poolBlock, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: ask }],
  });
  const { output: draft } = await recordRun<DeckFromCardDraft>(db, "deck_wizard", { cardId, game, mode: "from-card", leaderPool: leaders.length, ownedPool: owned.length, buyPool: buy.length }, res);

  const chosenLeaderId = draft.leaderId.trim().toUpperCase().split("_")[0];
  const chosenLeader = leaderPool.get(chosenLeaderId) ?? leaders[0];

  const sanitised = sanitiseDraft(draft, pool, game);
  // The model is asked to include the seed card; enforce it rather than trust it.
  const zoneList = seedZone === "z" ? sanitised.z : sanitised.main;
  if (!zoneList.some((c) => c.cardId === seed.id)) {
    const cap = seedZone === "z" ? rules.zMax : rules.mainMax;
    if (zoneList.length >= cap) zoneList.pop();
    const owned0 = pool.get(seed.id)?.owned ?? 0;
    zoneList.unshift({ cardId: seed.id, quantity: 1, owned: owned0, needToBuy: Math.max(0, 1 - owned0) });
  }
  sanitised.mainCount = sanitised.main.reduce((n, m) => n + m.quantity, 0);

  const purchases = new Map(draft.purchases.map((p) => [p.cardId.toUpperCase().split("_")[0], p.why]));
  const shopping = [...sanitised.main, ...sanitised.z]
    .filter((c) => c.needToBuy > 0)
    .map((c) => `- ${c.needToBuy}× ${pool.get(c.cardId)?.name ?? c.cardId} (${c.cardId})${purchases.get(c.cardId) ? `: ${purchases.get(c.cardId)}` : ""}`);
  const leaderNote = chosenLeader.owned ? "you own the Leader" : `Leader to buy: ${chosenLeader.name} (${chosenLeader.id})`;
  const description = [
    draft.strategy,
    "",
    chosenLeader.owned ? "" : leaderNote,
    shopping.length ? `To buy (${shopping.length} card${shopping.length === 1 ? "" : "s"}):\n${shopping.join("\n")}` : "Built entirely from cards you own.",
    sanitised.dropped.length ? `\nIgnored (not in pool): ${sanitised.dropped.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .trim();

  const [deck] = await db.insert(decks).values({ name: `${draft.name} (Claude draft)`, game, description }).returning({ id: decks.id });
  const values = [
    { deckId: deck.id, cardId: chosenLeader.id, zone: "leader", quantity: 1 },
    ...sanitised.main.map((m) => ({ deckId: deck.id, cardId: m.cardId, zone: "main", quantity: m.quantity })),
    ...sanitised.z.map((m) => ({ deckId: deck.id, cardId: m.cardId, zone: "z", quantity: m.quantity })),
  ];
  await db.insert(deckCards).values(values);
  await db.update(decks).set({ aiSummary: draft.strategy, aiSummaryAt: new Date() }).where(eq(decks.id, deck.id));

  const toBuy = [...sanitised.main, ...sanitised.z].reduce((n, c) => n + c.needToBuy, 0) + (chosenLeader.owned ? 0 : 1);
  return { deckId: deck.id, leaderId: chosenLeader.id, leaderName: chosenLeader.name, draft, mainCount: sanitised.mainCount, toBuy };
}
