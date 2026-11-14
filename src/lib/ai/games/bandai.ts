/**
 * The adapter of Bandai's two games (`dbs`, `fusion`): what `deck.ts` always did for them, moved here
 * unchanged so the requests they send stay what they were (`scripts/verify/ai-games.mts` compares them
 * with a snapshot recorded on the base commit). The card source is the local catalog.
 */
import { and, asc, eq, isNull, notInArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { cardSets, cards, ownedCards } from "@/db/schema";
import { textArray } from "@/db/sqlx";
import { lotScope } from "@/lib/collection/scope";
import { currentLineFor } from "@/lib/catalog/sets";
import { gameInfo, type Game } from "@/lib/catalog/games";
import { hasKeyword, rulesFor } from "@/lib/decks/cardRules";
import { legality } from "@/lib/decks/legality";
import { deckToText, type DeckCardRow } from "@/lib/decks/queries";
import { answerLanguageLine } from "./language";
import { WizardSchema } from "./schemas";
import type { DeckForAi, GameAdapter, PromptCard, WizardSource } from "./types";

/**
 * The two games share a brand and nothing else, so the model is told which one
 * it is looking at before anything else — a Fusion World deck analysed as if
 * it were Masters would be confidently wrong about its own rules.
 */
function rulesText(game: Game): string {
  const r = gameInfo(game).deck;
  return (
    `Deck rules for this game: 1 Leader, ${r.main}–${r.mainMax} cards in the main deck, at most ${r.copies} copies of a card number` +
    (r.zMax > 0 ? `, and a Z-Deck of up to ${r.zMax} Z- cards.` : ", and no Z-Deck at all.") +
    (r.colorStrict ? " Every card in the deck MUST share a colour with the Leader — an off-colour card is illegal, not merely weak." : " Off-colour cards are legal but usually a mistake.")
  );
}

/** Compact one-line card row for prompts. */
export function cardLine(c: PromptCard, maxSkill = 320): string {
  const skill = (c.skill ?? "")
    .replace(/<br\s*\/?>/gi, " / ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  const parts = [
    c.id,
    c.name,
    c.cardType,
    c.colors.join("/"),
    c.energyCost ? `cost ${c.energyCost}` : "",
    c.power ? `pow ${c.power}` : "",
    c.traits?.length ? `<${c.traits.join(",")}>` : "",
    c.rarityCode ?? "",
    skill.length > maxSkill ? `${skill.slice(0, maxSkill)}…` : skill,
  ].filter(Boolean);
  return parts.join(" | ");
}

function deckBlock(rows: DeckCardRow[]): string {
  // Some keywords carry their own deck-building limit, printed on the card
  // itself — spell it out so a suggestion never breaks it.
  const rules = rulesFor(rows).map((r) => {
    const used = rows.filter((x) => x.zone !== "side" && hasKeyword(x, r.keyword)).reduce((n, x) => n + x.quantity, 0);
    return r.unlimitedCopies
      ? `[${r.keyword}]: the 4-copy cap does not apply; the deck may hold at most ${r.max} cards with [${r.keyword}] in total, in any mix of copies. Currently ${used}/${r.max}.`
      : `[${r.keyword}]: at most ${r.max} cards with [${r.keyword}] in total. Currently ${used}/${r.max}.`;
  });
  return [
    "DECKLIST:",
    deckToText(rows),
    ...(rules.length ? ["", "SPECIAL DECK-BUILDING RULES FROM THE CARD TEXT:", ...rules] : []),
    "",
    "CARD TEXT:",
    ...rows.map((r) => cardLine({ ...r, id: r.cardId })),
  ].join("\n");
}

const POOL_CAP = 450;

/** Legal, on-colour candidates. Owned-only when scoped, else current + deck's own sets, newest first. */
async function candidatePool(db: Db, deck: DeckForAi, scope: "owned" | "any") {
  const leader = deck.cards.find((c) => c.zone === "leader");
  const colours = leader ? [...leader.colors, "Colorless"] : null;
  const inDeck = deck.cards.map((c) => c.cardId);
  const base = [
    eq(cards.isBanned, false),
    // The other game's cards are not an option, and neither are game pieces.
    eq(cards.game, deck.game),
    notInArray(cards.cardType, gameInfo(deck.game).nonDeckTypes),
    inDeck.length ? notInArray(cards.id, inDeck) : undefined,
  ];
  if (colours) base.push(sql`${cards.colors} <@ ${textArray(colours)}`);

  const select = {
    id: cards.id,
    name: cards.name,
    cardType: cards.cardType,
    colors: cards.colors,
    energyCost: cards.energyCost,
    power: cards.power,
    skill: cards.skill,
    traits: cards.traits,
    rarityCode: cards.rarityCode,
  };

  if (scope === "owned") {
    return db
      .selectDistinct(select)
      .from(cards)
      .innerJoin(ownedCards, eq(ownedCards.cardId, cards.id))
      // The deck owner's own copies: a player's wizard never offers someone else's cards.
      .where(and(...base, isNull(ownedCards.archivedAt), lotScope(deck.owner)))
      .limit(POOL_CAP);
  }
  const deckSets = [...new Set(deck.cards.map((c) => c.cardId.split("-")[0]))];
  return db
    .select(select)
    .from(cards)
    .innerJoin(cardSets, eq(cardSets.code, cards.setCode))
    .where(and(...base, sql`(${cardSets.line} = ${currentLineFor(deck.game)} or ${cards.setCode} in ${deckSets.length ? deckSets : ["-"]})`))
    .orderBy(sql`${cardSets.sortKey} desc`, asc(cards.id))
    .limit(POOL_CAP);
}

export function bandaiAdapter(game: Game): GameAdapter {
  const info = gameInfo(game);
  const language = answerLanguageLine(game);
  const adapter: GameAdapter = {
    game,
    lang: info.uiLang,
    promptName: info.promptName,
    rulesText: () => rulesText(game),
    analystSystem() {
      return [
        `You are an expert ${info.promptName} deck analyst.`,
        "Reason only from the card data given to you. Card text uses [brackets] for keywords, {braces} for card names and <angle brackets> for traits.",
        "Refer to cards by their exact card number (e.g. BT18-020) as given. Be concrete and concise.",
        rulesText(game),
        ...(language ? [language] : []),
      ].join("\n");
    },
    describeCard: cardLine,
    deckBlock: (rows) => deckBlock(rows),
    swapInstruction() {
      const rules = info.deck;
      return `Propose card-for-card swaps that improve this deck. Each swap removes a card that is in the deck and adds one from the candidate pool. Keep the main deck at exactly ${rules.main} cards (outQuantity should equal inQuantity unless fixing a count problem) and respect the ${rules.copies}-copy limit.`;
    },
    wizardSchema: WizardSchema,
    async wizardSource(db, deck, scope): Promise<WizardSource> {
      const pool = await candidatePool(db, deck, scope);
      return {
        size: pool.length,
        error: pool.length === 0 ? (scope === "owned" ? "You don't own any on-colour cards outside this deck." : "No candidate cards found.") : null,
        poolBlock: `CANDIDATE POOL (${scope === "owned" ? "cards the player owns" : "legal cards"}; only suggest additions from this list):\n${pool.map((c) => cardLine(c, 240)).join("\n")}`,
        tools: [],
        materialise: async () => {},
      };
    },
    validate: (rows, format) => legality(rows, game, format),
  };
  return adapter;
}
