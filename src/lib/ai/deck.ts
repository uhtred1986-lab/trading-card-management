/**
 * Deck analysis with Claude: archetype summary, the improvement wizard
 * (explicit replace X → Y swaps), and new-set reviews. Everything reasons
 * from catalog card text we hold — no forum scraping.
 */
import { asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { cardSets, cards, decks } from "@/db/schema";
import { gameOfSetCode } from "@/lib/catalog/sets";
import { getDeck } from "@/lib/decks/queries";
import { generateJson } from "./core";
import { recordRun } from "./client";
import { cardLine } from "./games/bandai";
import { adapterFor } from "./games/registry";
import { WizardSchema, type WizardResult } from "./games/schemas";
import { generateWithLookups } from "./tools";

// The one-line card row and the wizard's answer shape now belong to the per-game adapters (`./games`);
// they stay importable from here for the modules that always took them from this file.
export { cardLine, WizardSchema };
export type { WizardResult };

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
  const adapter = adapterFor(deck.game);
  const prompt = `${adapter.deckBlock(deck.cards, { format: deck.format })}

${deck.metaNotes ? `PLAYER'S META NOTES:\n${deck.metaNotes}\n\n` : ""}Summarise this deck.`;

  const res = await generateJson({
    task: "deck_summary",
    tier: "standard",
    maxTokens: 8000,
    thinking: "adaptive",
    effort: "medium",
    schema: DeckSummarySchema,
    system: [{ text: adapter.analystSystem({ format: deck.format }) }],
    messages: [{ role: "user", parts: [{ type: "text", text: prompt }] }],
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

/**
 * `context` is whatever you told Claude you wanted from this run ("the curve
 * feels top-heavy", "optimise for going second"). It is stored with each
 * suggestion so a week-old piece of advice still says what it was answering.
 */
export async function runWizard(db: Db, deckId: number, scope: "owned" | "any", context: string | null = null): Promise<{ runId: number; assessment: string; swaps: WizardSwap[] }> {
  const deck = await getDeck(db, deckId);
  if (!deck) throw new Error("Deck not found");
  if (deck.cards.length === 0) throw new Error("The deck is empty.");
  const adapter = adapterFor(deck.game);
  const ctx = { format: deck.format };
  const source = await adapter.wizardSource(db, deck, scope);
  if (source.error) throw new Error(source.error);

  // Banned cards are not an improvement question — the deck cannot be played
  // with them, so every one has to come out. Named explicitly, because they are
  // easy to miss in a fifty-card list.
  const banned = deck.cards.filter((c) => c.isBanned && c.zone !== "side");
  const bannedBlock = banned.length
    ? `\nBANNED CARDS IN THIS DECK — every one of these MUST get a swap, at priority "high", before any other improvement:\n${banned
        .map((c) => `${c.quantity}× ${c.cardId} ${c.name} (${c.zone})`)
        .join("\n")}\n`
    : "";
  const ask = `${adapter.deckBlock(deck.cards, ctx)}
${bannedBlock}
${deck.metaNotes ? `PLAYER'S META NOTES:\n${deck.metaNotes}\n\n` : ""}${context ? `WHAT THE PLAYER WANTS FROM THIS PASS:\n${context}\n\n` : ""}${adapter.swapInstruction()} Replace the full played count of a card you are cutting — if the deck runs 3 copies and all 3 should go, say outQuantity 3.${context ? " Weigh the player's request above over general improvements." : ""}`;

  const call = (message: string) => {
    const request = {
      task: "deck_wizard" as const,
      tier: "best" as const,
      maxTokens: 12000,
      thinking: "adaptive" as const,
      effort: "high" as const,
      schema: adapter.wizardSchema as typeof WizardSchema,
      system: [
        { text: adapter.analystSystem(ctx) },
        ...(source.poolBlock ? [{ text: source.poolBlock, cache: "short" as const }] : []),
      ],
      messages: [{ role: "user" as const, parts: [{ type: "text" as const, text: message }] }],
    };
    // A game with a live card source lets the model look cards up; the others send the one request they always did.
    return source.tools.length ? generateWithLookups(request, source.tools) : generateJson(request);
  };

  const res = await call(ask);
  const lookups = "lookupLog" in res ? { lookups: res.lookupLog } : {};
  const { id, output } = await recordRun<WizardResult>(db, "deck_wizard", { deckId, scope, context, poolSize: source.size, ...lookups }, res, deckId);

  // One focused follow-up if a banned card was still missed, rather than
  // shipping a deck that can't be played with a suggestion list that says so.
  const missed = banned.filter((c) => !output.swaps.some((s) => s.outCardId === c.cardId));
  if (missed.length) {
    const retry = await call(
      `${adapter.deckBlock(deck.cards, ctx)}\n\nThese banned cards are still in the deck and have no replacement yet. Propose exactly one swap for each, from the candidate pool, at priority "high", replacing the full played count:\n${missed
        .map((c) => `${c.quantity}× ${c.cardId} ${c.name} (${c.zone})`)
        .join("\n")}`,
    );
    const { output: extra } = await recordRun<WizardResult>(db, "deck_wizard", { deckId, scope, context, mode: "banned-retry", missed: missed.map((c) => c.cardId) }, retry, deckId);
    for (const s of extra.swaps) {
      if (missed.some((c) => c.cardId === s.outCardId) && !output.swaps.some((x) => x.outCardId === s.outCardId)) {
        output.swaps.push({ ...s, priority: "high" });
      }
    }
  }

  if (source.verify) output.swaps = await source.verify(db, output.swaps, deck.format);
  const ids = [...new Set(output.swaps.flatMap((s) => [s.outCardId, s.inCardId]))];
  // A live-catalog game stores the cards the model picked from a lookup before they are shown or saved.
  await source.materialise(db, ids);
  const meta = ids.length
    ? await db.select({ id: cards.id, name: cards.name, imageUrl: cards.imageUrl, cardType: cards.cardType, colors: cards.colors }).from(cards).where(inArray(cards.id, ids))
    : [];
  const m = new Map(meta.map((r) => [r.id, r]));
  const { allocationForCards } = await import("@/lib/decks/reservations");
  const alloc = await allocationForCards(db, ids, deck.owner);
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
  sleepers: z
    .array(z.object({ cardId: z.string(), why: z.string() }))
    .max(5)
    .describe("Underrated cards worth picking up early"),
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
      details: cards.details,
    })
    .from(cards)
    .where(eq(cards.setCode, setCode))
    .orderBy(asc(sql`${cards.id} collate "C"`));
  if (rows.length === 0) throw new Error(`No cards in set ${setCode}`);
  const set = await db.query.cardSets.findFirst({ where: eq(cardSets.code, setCode) });
  // A set is reviewed against its own game's rules and in that game's card language.
  const adapter = adapterFor(gameOfSetCode(setCode));

  const res = await generateJson({
    task: "set_review",
    tier: "best",
    maxTokens: 12000,
    thinking: "adaptive",
    effort: "high",
    schema: SetReviewSchema,
    system: [{ text: adapter.analystSystem() }],
    messages: [
      {
        role: "user",
        parts: [
          {
            type: "text",
            text: `NEW SET: ${set?.name ?? setCode} (${rows.length} cards)\n${rows.map((c) => adapter.describeCard(c, 280)).join("\n")}\n\nReview this set: standout cards, the archetypes it enables or upgrades, and sleepers.`,
          },
        ],
      },
    ],
  });
  const { id, output } = await recordRun<SetReview>(db, "set_review", { setCode }, res);
  return { runId: id, review: output };
}
