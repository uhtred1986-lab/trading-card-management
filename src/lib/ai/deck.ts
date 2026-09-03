/**
 * Deck analysis with Claude: archetype summary, the improvement wizard
 * (explicit replace X → Y swaps), and new-set reviews. Everything reasons
 * from catalog card text we hold — no forum scraping.
 */
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { and, asc, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { cardSets, cards, decks, ownedCards } from "@/db/schema";
import { textArray } from "@/db/sqlx";
import { deckToText, getDeck, type DeckCardRow } from "@/lib/decks/queries";
import { MODEL, anthropic, recordRun } from "./client";

const SYSTEM = `You are an expert Dragon Ball Super Card Game (Bandai; legacy sets BT1–BT25 and the current Masters line) deck analyst.
Reason only from the card data given to you. Card text uses [brackets] for keywords, {braces} for card names and <angle brackets> for traits.
Refer to cards by their exact card number (e.g. BT18-020) as given. Be concrete and concise.`;

/** Compact one-line card row for prompts. */
export function cardLine(c: {
  id: string;
  name: string;
  cardType: string;
  colors: string[];
  energyCost: string | null;
  power: number | null;
  skill: string | null;
  characters?: string[];
  traits?: string[];
  rarityCode?: string;
}, maxSkill = 320): string {
  const skill = (c.skill ?? "").replace(/<br\s*\/?>/gi, " / ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
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
  return ["DECKLIST:", deckToText(rows), "", "CARD TEXT:", ...rows.map((r) => cardLine({ ...r, id: r.cardId }))].join("\n");
}

// ── Summary ────────────────────────────────────────────────────────────────

export const DeckSummarySchema = z.object({
  archetype: z.string().describe("Short archetype name, e.g. 'Yellow Vegeta aggro'"),
  gamePlan: z.string().describe("2–4 sentences on how the deck wins"),
  strengths: z.array(z.string()).max(5),
  weaknesses: z.array(z.string()).max(5),
  goodAgainst: z.array(z.string()).max(4).describe("Archetypes or strategies it beats"),
  badAgainst: z.array(z.string()).max(4),
  keyCards: z.array(z.object({ cardId: z.string(), why: z.string() })).max(6),
  legalityNotes: z.array(z.string()).describe("Rule problems you notice: banned cards, wrong counts, colour clashes"),
});
export type DeckSummary = z.infer<typeof DeckSummarySchema>;

export async function summariseDeck(db: Db, deckId: number): Promise<{ runId: number; summary: DeckSummary }> {
  const deck = await getDeck(db, deckId);
  if (!deck) throw new Error("Deck not found");
  if (deck.cards.length === 0) throw new Error("The deck is empty.");
  const prompt = `${deckBlock(deck.cards)}

${deck.metaNotes ? `PLAYER'S META NOTES:\n${deck.metaNotes}\n\n` : ""}Summarise this deck.`;

  const res = await anthropic().messages.parse({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: zodOutputFormat(DeckSummarySchema) },
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });
  const { id, output } = await recordRun<DeckSummary>(db, "deck_summary", { deckId }, res, deckId);
  const text = [
    `**${output.archetype}** — ${output.gamePlan}`,
    output.strengths.length ? `Strong: ${output.strengths.join("; ")}` : "",
    output.weaknesses.length ? `Weak: ${output.weaknesses.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  await db.update(decks).set({ aiSummary: text, aiSummaryAt: new Date() }).where(eq(decks.id, deckId));
  return { runId: id, summary: output };
}

// ── Improvement wizard ─────────────────────────────────────────────────────

export const WizardSchema = z.object({
  assessment: z.string().describe("One paragraph on the deck's biggest gaps"),
  swaps: z
    .array(
      z.object({
        outCardId: z.string().describe("Card number currently in the deck to remove"),
        outQuantity: z.number().int().min(1).max(4),
        inCardId: z.string().describe("Card number from the CANDIDATE POOL to add"),
        inQuantity: z.number().int().min(1).max(4),
        rationale: z.string(),
        priority: z.enum(["high", "medium", "low"]),
      }),
    )
    .max(10),
});
export type WizardResult = z.infer<typeof WizardSchema>;

export type WizardSwap = WizardResult["swaps"][number] & {
  outName: string;
  inName: string;
  inImageUrl: string | null;
  outImageUrl: string | null;
  inOwned: number;
  inAvailable: number;
  inCardType: string;
  inColors: string[];
};

const POOL_CAP = 450;

/** Legal, on-colour candidates. Owned-only when scoped, else current + deck's own sets, newest first. */
async function candidatePool(db: Db, deck: NonNullable<Awaited<ReturnType<typeof getDeck>>>, scope: "owned" | "any") {
  const leader = deck.cards.find((c) => c.zone === "leader");
  const colours = leader ? [...leader.colors, "Colorless"] : null;
  const inDeck = deck.cards.map((c) => c.cardId);
  const base = [eq(cards.isBanned, false), ne(cards.cardType, "TOKEN"), inDeck.length ? notInArray(cards.id, inDeck) : undefined];
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
      .where(and(...base))
      .limit(POOL_CAP);
  }
  const deckSets = [...new Set(deck.cards.map((c) => c.cardId.split("-")[0]))];
  return db
    .select(select)
    .from(cards)
    .innerJoin(cardSets, eq(cardSets.code, cards.setCode))
    .where(and(...base, sql`(${cardSets.line} = 'masters' or ${cards.setCode} in ${deckSets.length ? deckSets : ["-"]})`))
    .orderBy(sql`${cardSets.sortKey} desc`, asc(cards.id))
    .limit(POOL_CAP);
}

/**
 * `context` is whatever you told Claude you wanted from this run ("the curve
 * feels top-heavy", "optimise for going second"). It is stored with each
 * suggestion so a week-old piece of advice still says what it was answering.
 */
export async function runWizard(
  db: Db,
  deckId: number,
  scope: "owned" | "any",
  context: string | null = null,
): Promise<{ runId: number; assessment: string; swaps: WizardSwap[] }> {
  const deck = await getDeck(db, deckId);
  if (!deck) throw new Error("Deck not found");
  if (deck.cards.length === 0) throw new Error("The deck is empty.");
  const pool = await candidatePool(db, deck, scope);
  if (pool.length === 0) throw new Error(scope === "owned" ? "You don't own any on-colour cards outside this deck." : "No candidate cards found.");

  const poolBlock = `CANDIDATE POOL (${scope === "owned" ? "cards the player owns" : "legal cards"}; only suggest additions from this list):\n${pool.map((c) => cardLine(c, 240)).join("\n")}`;
  const ask = `${deckBlock(deck.cards)}

${deck.metaNotes ? `PLAYER'S META NOTES:\n${deck.metaNotes}\n\n` : ""}${context ? `WHAT THE PLAYER WANTS FROM THIS PASS:\n${context}\n\n` : ""}Propose card-for-card swaps that improve this deck. Each swap removes a card that is in the deck and adds one from the candidate pool. Keep the main deck at exactly 50 cards (outQuantity should equal inQuantity unless fixing a count problem) and respect the 4-copy limit.${context ? " Weigh the player's request above over general improvements." : ""}`;

  const res = await anthropic().messages.parse({
    model: MODEL,
    max_tokens: 12000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: zodOutputFormat(WizardSchema) },
    system: [{ type: "text", text: SYSTEM }, { type: "text", text: poolBlock, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: ask }],
  });
  const { id, output } = await recordRun<WizardResult>(db, "deck_wizard", { deckId, scope, context, poolSize: pool.length }, res, deckId);

  const ids = [...new Set(output.swaps.flatMap((s) => [s.outCardId, s.inCardId]))];
  const meta = ids.length ? await db.select({ id: cards.id, name: cards.name, imageUrl: cards.imageUrl, cardType: cards.cardType, colors: cards.colors }).from(cards).where(inArray(cards.id, ids)) : [];
  const m = new Map(meta.map((r) => [r.id, r]));
  const { allocationForCards } = await import("@/lib/decks/reservations");
  const alloc = await allocationForCards(db, ids);
  const swaps: WizardSwap[] = output.swaps
    .filter((s) => m.has(s.inCardId) && m.has(s.outCardId))
    .map((s) => ({
      ...s,
      outName: m.get(s.outCardId)!.name,
      outImageUrl: m.get(s.outCardId)!.imageUrl,
      inName: m.get(s.inCardId)!.name,
      inImageUrl: m.get(s.inCardId)!.imageUrl,
      inCardType: m.get(s.inCardId)!.cardType,
      inColors: m.get(s.inCardId)!.colors,
      inOwned: alloc.get(s.inCardId)?.owned ?? 0,
      inAvailable: alloc.get(s.inCardId)?.available ?? 0,
    }));
  // Kept so the deck page can show them inline later without paying again.
  const { saveSuggestions } = await import("@/lib/decks/swaps");
  await saveSuggestions(
    db,
    deckId,
    id,
    context,
    swaps.map((s) => ({
      outCardId: s.outCardId,
      inCardId: s.inCardId,
      outQuantity: s.outQuantity,
      inQuantity: s.inQuantity,
      rationale: s.rationale,
      priority: s.priority,
    })),
  );
  return { runId: id, assessment: output.assessment, swaps };
}

// ── New set review ─────────────────────────────────────────────────────────

export const SetReviewSchema = z.object({
  overview: z.string().describe("2–4 sentences: what the set is about and its overall power level"),
  standouts: z.array(z.object({ cardId: z.string(), why: z.string(), rating: z.number().int().min(1).max(5) })).max(15),
  archetypes: z.array(z.object({ name: z.string(), colors: z.array(z.string()), impact: z.string(), keyCards: z.array(z.string()).max(6) })).max(8),
  sleepers: z.array(z.object({ cardId: z.string(), why: z.string() })).max(5).describe("Underrated cards worth picking up early"),
});
export type SetReview = z.infer<typeof SetReviewSchema>;

export async function reviewSet(db: Db, setCode: string): Promise<{ runId: number; review: SetReview }> {
  const rows = await db
    .select({
      id: cards.id,
      name: cards.name,
      cardType: cards.cardType,
      colors: cards.colors,
      energyCost: cards.energyCost,
      power: cards.power,
      skill: cards.skill,
      traits: cards.traits,
      rarityCode: cards.rarityCode,
    })
    .from(cards)
    .where(eq(cards.setCode, setCode))
    .orderBy(asc(sql`${cards.id} collate "C"`));
  if (rows.length === 0) throw new Error(`No cards in set ${setCode}`);
  const set = await db.query.cardSets.findFirst({ where: eq(cardSets.code, setCode) });

  const res = await anthropic().messages.parse({
    model: MODEL,
    max_tokens: 12000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: zodOutputFormat(SetReviewSchema) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `NEW SET: ${set?.name ?? setCode} (${rows.length} cards)\n${rows.map((c) => cardLine(c, 280)).join("\n")}\n\nReview this set: standout cards, the archetypes it enables or upgrades, and sleepers.`,
      },
    ],
  });
  const { id, output } = await recordRun<SetReview>(db, "set_review", { setCode }, res);
  return { runId: id, review: output };
}
