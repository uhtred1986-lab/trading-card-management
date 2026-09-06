/**
 * "Build me a deck for this leader": Claude drafts a full deck from two pools —
 * the on-colour cards the player already owns (preferred) and a capped pool of
 * legal cards worth buying. The draft is validated here before it becomes a
 * (virtual) deck; owned/buy flags come from the collection, never from the model.
 */
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { and, asc, desc, eq, isNull, ne, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { cardSets, cards, deckCards, decks, ownedCards } from "@/db/schema";
import { textArray } from "@/db/sqlx";
import { deckRules, gameInfo, gameOr, type Game } from "@/lib/catalog/games";
import { currentLineFor } from "@/lib/catalog/sets";
import { hasKeyword, rulesFor, type KeywordDeckRule } from "@/lib/decks/cardRules";
import { MODEL, anthropic, recordRun } from "./client";
import { cardLine } from "./deck";

export const DeckDraftSchema = z.object({
  name: z.string().describe("Short deck name, e.g. 'Yellow Launch Tournament Aggro'"),
  strategy: z.string().describe("3–5 sentences: game plan, key interactions, how it wins"),
  main: z.array(z.object({ cardId: z.string(), quantity: z.number().int().min(1).max(4) })).describe("Exactly 50 cards in total"),
  zDeck: z
    .array(z.object({ cardId: z.string(), quantity: z.number().int().min(1).max(4) }))
    .max(8)
    .describe("Z-Deck cards (Z-BATTLE/Z-EXTRA/Z-UNISON/Z-LEADER), up to 8 total; empty if none fit, and ALWAYS empty for a game with no Z-Deck"),
  purchases: z.array(z.object({ cardId: z.string(), quantity: z.number().int().min(1).max(4), why: z.string() })).describe("Every card used that is NOT owned, with a one-line reason it's worth buying"),
});
export type DeckDraft = z.infer<typeof DeckDraftSchema>;

export interface PoolCard {
  id: string;
  name: string;
  cardType: string;
  colors: string[];
  energyCost: string | null;
  power: number | null;
  skill: string | null;
  traits: string[];
  rarityCode: string;
  limitedTo: number | null;
  owned: number;
}

const OWNED_CAP = 600;
const BUY_CAP = 280;

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
  limitedTo: cards.limitedTo,
};

export async function buildPools(db: Db, leaderId: string): Promise<{ leader: typeof cards.$inferSelect; game: Game; owned: PoolCard[]; buy: PoolCard[] }> {
  const leader = await db.query.cards.findFirst({ where: eq(cards.id, leaderId) });
  if (!leader) throw new Error("Leader not found");
  if (leader.cardType !== "LEADER") throw new Error(`${leader.name} is not a Leader card`);
  // The deck is built for the leader's own game, start to finish.
  const game = gameOr(leader.game);
  const colours = [...leader.colors, "Colorless"];
  const onColour = [
    eq(cards.isBanned, false),
    eq(cards.game, game),
    notInArray(cards.cardType, ["LEADER", ...gameInfo(game).nonDeckTypes]),
    sql`${cards.colors} <@ ${textArray(colours)}`,
  ];

  const owned = await db
    .select({ ...select, owned: sql<number>`count(*)::int` })
    .from(cards)
    .innerJoin(ownedCards, eq(ownedCards.cardId, cards.id))
    .where(and(...onColour, isNull(ownedCards.archivedAt)))
    .groupBy(cards.id)
    .orderBy(asc(cards.id))
    .limit(OWNED_CAP);

  const ownedIds = owned.map((c) => c.id);
  const buy = await db
    .select(select)
    .from(cards)
    .innerJoin(cardSets, eq(cardSets.code, cards.setCode))
    .where(
      and(
        ...onColour,
        ownedIds.length ? notInArray(cards.id, ownedIds) : undefined,
        sql`(${cardSets.line} = ${currentLineFor(game)} or ${cards.setCode} = ${leader.setCode})`,
        ne(cards.rarityCode, "PR"),
      ),
    )
    .orderBy(desc(cardSets.sortKey), asc(cards.id))
    .limit(BUY_CAP);

  return { leader, game, owned, buy: buy.map((c) => ({ ...c, owned: 0 })) };
}

export interface SanitisedDraft {
  main: { cardId: string; quantity: number; owned: number; needToBuy: number }[];
  z: { cardId: string; quantity: number; owned: number; needToBuy: number }[];
  dropped: string[];
  mainCount: number;
}

/** Enforce pool membership and copy limits; compute owned/buy from the pools. */
export function sanitiseDraft(draft: DeckDraft, pool: Map<string, PoolCard>, game: Game = "dbs"): SanitisedDraft {
  const deckLimits = deckRules(game);
  const dropped: string[] = [];
  // Keywords like [Dragon Ball] replace the 4-copy cap with a pooled total.
  const rules = rulesFor([...pool.values()]);
  const ruleFor = (c: PoolCard) => rules.find((r) => hasKeyword(c, r.keyword));
  const spent = new Map<string, number>();
  const merge = (list: { cardId: string; quantity: number }[], zOnly: boolean) => {
    const out = new Map<string, number>();
    for (const e of list) {
      const id = e.cardId.trim().toUpperCase().split("_")[0];
      const c = pool.get(id);
      if (!c || (zOnly ? !c.cardType.startsWith("Z-") : c.cardType.startsWith("Z-"))) {
        dropped.push(e.cardId);
        continue;
      }
      const rule = ruleFor(c);
      const cap = rule?.unlimitedCopies ? rule.max : (c.limitedTo ?? deckLimits.copies);
      let want = Math.min((out.get(id) ?? 0) + e.quantity, cap);
      if (rule) {
        // Trim to whatever is left of the shared allowance, first come first served.
        const used = spent.get(rule.keyword) ?? 0;
        want = Math.min(want, Math.max(0, rule.max - used + (out.get(id) ?? 0)));
        spent.set(rule.keyword, used - (out.get(id) ?? 0) + want);
      }
      if (want <= 0) { dropped.push(e.cardId); continue; }
      out.set(id, want);
    }
    return [...out].map(([cardId, quantity]) => {
      const owned = pool.get(cardId)!.owned;
      return { cardId, quantity, owned, needToBuy: Math.max(0, quantity - owned) };
    });
  };
  const main = merge(draft.main, false);
  // A game with no Z-Deck gets none, whatever the model returned.
  const z = merge(draft.zDeck, true).slice(0, deckLimits.zMax);
  return { main, z, dropped, mainCount: main.reduce((n, m) => n + m.quantity, 0) };
}

/** Pooled keyword limits spelled out for the model, only when the pool has them. */
function ruleLines(rules: KeywordDeckRule[]): string[] {
  return rules.map((r) =>
    r.unlimitedCopies
      ? `SPECIAL RULE — [${r.keyword}]: the 4-copy cap does NOT apply to cards with [${r.keyword}]; instead the deck may hold at most ${r.max} of them in total, in any mix of copies.`
      : `SPECIAL RULE — [${r.keyword}]: the deck may hold at most ${r.max} cards with [${r.keyword}] in total.`,
  );
}

export async function suggestDeck(db: Db, leaderId: string): Promise<{ deckId: number; draft: DeckDraft; sanitised: SanitisedDraft }> {
  const { leader, game, owned, buy } = await buildPools(db, leaderId);
  if (owned.length + buy.length < 30) throw new Error("Not enough on-colour cards in the catalog for this leader.");
  const pool = new Map<string, PoolCard>([...owned, ...buy].map((c) => [c.id, c]));
  const info = gameInfo(game);
  const rules = info.deck;

  const poolRules = rulesFor([...owned, ...buy]);
  const line = (c: PoolCard) => `${c.owned ? `OWN×${c.owned}` : "BUY"} | ${cardLine(c, 220)}`;
  const system = [
    `You are an expert ${info.promptName} deck builder.`,
    `Build a competitive, coherent ${rules.main}-card main deck for the given Leader. Card text uses [brackets] for keywords, {braces} for card names, <angle brackets> for traits.`,
    `Rules: exactly ${rules.main} main-deck cards (the legal range is ${rules.main}–${rules.mainMax}, but build ${rules.main}); at most ${rules.copies} copies of any card number (fewer if the pool row says a lower limit); ` +
      (rules.zMax > 0
        ? `only Z- type cards go in the Z-Deck (max ${rules.zMax}); `
        : "this game has NO Z-Deck — leave `zDeck` empty; ") +
      "all cards must come from the pool below; refer to cards by exact card number.",
    ...(rules.colorStrict ? ["Every card in the deck must share a colour with the Leader. The pool below is already filtered to legal colours, so simply do not invent cards."] : []),
    ...ruleLines(poolRules),
    "STRONGLY prefer OWN cards (the player already has them, up to the quantity shown). Use BUY cards only where they meaningfully improve the deck — a key engine piece, a finisher, or to fix a real gap — and list every BUY card used in `purchases` with a reason.",
  ].join("\n");
  const poolBlock = `CARD POOL (OWN×n = owned copies, BUY = would need buying):\n${[...owned, ...buy].map(line).join("\n")}`;
  const ask = `LEADER: ${cardLine({ ...leader, traits: leader.traits }, 400)}${leader.backName ? `\nLEADER BACK: ${leader.backName} — ${(leader.backSkill ?? "").replace(/<br\s*\/?>/gi, " / ")}` : ""}\n\nDraft the deck.`;

  const res = await anthropic().messages.parse({
    model: MODEL,
    max_tokens: 12000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: zodOutputFormat(DeckDraftSchema) },
    system: [{ type: "text", text: system }, { type: "text", text: poolBlock, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: ask }],
  });
  const { output: draft } = await recordRun<DeckDraft>(db, "deck_wizard", { leaderId, game, mode: "build", ownedPool: owned.length, buyPool: buy.length }, res);
  const sanitised = sanitiseDraft(draft, pool, game);

  const purchases = new Map(draft.purchases.map((p) => [p.cardId.toUpperCase().split("_")[0], p.why]));
  const shopping = [...sanitised.main, ...sanitised.z]
    .filter((c) => c.needToBuy > 0)
    .map((c) => `- ${c.needToBuy}× ${pool.get(c.cardId)!.name} (${c.cardId})${purchases.get(c.cardId) ? `: ${purchases.get(c.cardId)}` : ""}`);
  const description = [
    draft.strategy,
    "",
    shopping.length ? `To buy (${shopping.length} card${shopping.length === 1 ? "" : "s"}):\n${shopping.join("\n")}` : "Built entirely from cards you own.",
    sanitised.dropped.length ? `\nIgnored (not in pool): ${sanitised.dropped.join(", ")}` : "",
  ]
    .join("\n")
    .trim();

  const [deck] = await db.insert(decks).values({ name: `${draft.name} (Claude draft)`, game, description }).returning({ id: decks.id });
  const values = [
    { deckId: deck.id, cardId: leader.id, zone: "leader", quantity: 1 },
    ...sanitised.main.map((m) => ({ deckId: deck.id, cardId: m.cardId, zone: "main", quantity: m.quantity })),
    ...sanitised.z.map((m) => ({ deckId: deck.id, cardId: m.cardId, zone: "z", quantity: m.quantity })),
  ];
  await db.insert(deckCards).values(values);
  await db.update(decks).set({ aiSummary: draft.strategy, aiSummaryAt: new Date() }).where(eq(decks.id, deck.id));
  return { deckId: deck.id, draft, sanitised };
}
