"use server";

/**
 * The play-test sandbox's server half (Rules PR 5). The seed is read-only: a
 * Try it board staged by the probe, carrying the rule in the builder —
 * unsaved, checked with `readRule` — as the card's script. The game itself
 * runs in the browser (`lib/arena/sandbox/session.ts`) against the local AI
 * policy, so nothing is written for it: no `arena_games` row, no deck check.
 *
 * The one write is the owner's word on a board (`sandboxJudgeAction`), kept
 * the way Try it keeps it — through `saveExpectationsAction` — so
 * `arena:reprobe` holds the rule to it.
 */
import { and, eq, ilike, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { cards } from "@/db/schema";
import { isArenaAdmin, requireSl } from "@/lib/auth";
import { readRule } from "@/lib/arena/lang";
import { defsForCards } from "@/lib/arena/load";
import { sanitizeSetup, setupIds, SETUP_LIMITS, type ResolvedSetup, type SetupCardHit } from "@/lib/arena/sandbox/setup";
import { ruleFrom, type ProbeRule } from "@/lib/arena/probe";
import { programOf, ruleById, rulesFor } from "@/lib/arena/rules-store";
import { withJudgement, type Should } from "@/lib/arena/sandbox/judgement";
import { sandboxSeed } from "@/lib/arena/sandbox/seed";
import type { SandboxSeed } from "@/lib/arena/sandbox/session";
import { fixtureCard, fixtureRule, fixtureSetupDefs } from "@/lib/arena/sandbox/fixture";
import { probeRuleOf, readExpectations, tryRule } from "@/lib/arena/tryit";
import { saveExpectationsAction } from "./probe-actions";

const REFUSED = "admins only";

export interface SandboxCard {
  cardId: string;
  name: string;
  printed: string;
  side: "front" | "back";
  skillIndex: number;
}
export interface SandboxSeedResult {
  error: string | null;
  seed: SandboxSeed | null;
  card: SandboxCard | null;
}
const refused = (error: string): SandboxSeedResult => ({ error, seed: null, card: null });

const keyOf = (boardKey: unknown): string | null => (typeof boardKey === "string" && boardKey.length <= 400 ? boardKey : null);

/** The rule row's card and the rule to play: the builder's `draft`, else the saved one. */
async function resolve(ruleId: number, draft: unknown): Promise<{ error: string } | { rule: ProbeRule; card: SandboxCard; expectations: unknown }> {
  const row = await ruleById(db, ruleId);
  if (!row) return { error: "no such rule" };
  const def = (await defsForCards(db, [row.cardId]))[row.cardId];
  if (!def) return { error: "no such card" };
  const side = row.side === "back" ? "back" : "front";
  const card: SandboxCard = { cardId: row.cardId, name: row.name, printed: row.printed ?? "", side, skillIndex: row.skillIndex };
  if (draft == null) return { rule: ruleFrom(row, def, programOf(row)), card, expectations: row.expectations };
  const read = readRule(draft, row.kind);
  if ("error" in read) return { error: read.error.message };
  return { rule: probeRuleOf(read.rule, def, side, row.skillIndex), card, expectations: row.expectations };
}

/**
 * The board `boardKey` names for rule `ruleId`, with `draftRule` (the
 * builder's unsaved rule; null for the saved one) installed as the card's script.
 */
export async function sandboxSeedAction(ruleId: number, draftRule: unknown, boardKey: string | null, setup?: unknown): Promise<SandboxSeedResult> {
  await requireSl();
  if (!(await isArenaAdmin())) return refused(REFUSED);
  const made = await resolve(ruleId, draftRule);
  if ("error" in made) return refused(made.error);
  const wanted = sanitizeSetup(setup);
  const ids = [made.card.cardId, ...setupIds(wanted)];
  const rows = await db.select({ id: cards.id, game: cards.game, imageUrl: cards.imageUrl, backImageUrl: cards.backImageUrl }).from(cards).where(inArray(cards.id, ids));
  const art = Object.fromEntries(rows.map((r) => [r.id, { front: r.imageUrl, back: r.backImageUrl }]));
  // The setup's cards are read from the catalog with their stored rules, so they play as in a game. Only the original game's.
  const dbsIds = new Set(rows.filter((r) => r.game === "dbs").map((r) => r.id));
  const kept = setupIds(wanted).filter((id) => dbsIds.has(id));
  const defs = await defsForCards(db, kept);
  const resolved: ResolvedSetup = { setup: wanted, defs, scripts: kept.length ? await rulesFor(db, defs) : {} };
  const seeded = sandboxSeed(made.rule, keyOf(boardKey), art, resolved);
  return { ...seeded, card: made.card };
}

/** Search the original game's catalog by name or number, for the "Set up the board" panel. Read-only. */
export async function searchSetupCardsAction(query: string, leadersOnly: boolean): Promise<{ error: string | null; hits: SetupCardHit[] }> {
  await requireSl();
  if (!(await isArenaAdmin())) return { error: REFUSED, hits: [] };
  const q = String(query ?? "").trim().replace(/[%_\\]/g, "").slice(0, 60);
  if (q.length < 2) return { error: null, hits: [] };
  const like = `%${q}%`;
  const rows = await db
    .select({ id: cards.id, name: cards.name, type: cards.cardType, colors: cards.colors, cost: cards.energyCost })
    .from(cards)
    .where(and(eq(cards.game, "dbs"), or(ilike(cards.name, like), ilike(cards.id, like)), leadersOnly ? eq(cards.cardType, "LEADER") : undefined))
    .orderBy(cards.id)
    .limit(SETUP_LIMITS.cards);
  return { error: null, hits: rows };
}

/**
 * "Played right ✓ / wrong ✗" on a board: the Try it row of that board, run on
 * the rule that was played, kept as the owner's judgement — merged with the
 * ones already stored, through `saveExpectationsAction`.
 */
export async function sandboxJudgeAction(ruleId: number, draftRule: unknown, boardKey: string, verdict: "right" | { should: Should; note: string }): Promise<{ error: string | null; saved: number }> {
  await requireSl();
  if (!(await isArenaAdmin())) return { error: REFUSED, saved: 0 };
  const key = keyOf(boardKey);
  if (!key) return { error: "no such board", saved: 0 };
  if (verdict !== "right" && !(verdict && typeof verdict === "object" && ["fire", "notFire", "other"].includes(verdict.should))) return { error: "no such verdict", saved: 0 };
  const made = await resolve(ruleId, draftRule);
  if ("error" in made) return { error: made.error, saved: 0 };
  const row = tryRule(made.rule, [key]).rows.find((r) => r.key === key);
  if (!row) return { error: "that board can no longer be staged", saved: 0 };
  const word = verdict === "right" ? verdict : { should: verdict.should, note: String(verdict.note ?? "").slice(0, 500) };
  return saveExpectationsAction(ruleId, withJudgement(readExpectations(made.expectations), row, word));
}

/**
 * Development only, no database: the same seed for a synthetic card
 * (`/arena/rules/play-preview`), so the sandbox can be opened in a session
 * that keeps off Neon. Production answers with a refusal.
 */
export async function sandboxFixtureSeedAction(fixture: string, draftRule: unknown, boardKey: string | null, setup?: unknown): Promise<SandboxSeedResult> {
  await requireSl();
  if (process.env.NODE_ENV === "production") return refused("not available");
  const def = fixtureCard(fixture);
  const base = fixtureRule(fixture);
  const read = readRule(draftRule ?? base, base.kind);
  if ("error" in read) return refused(read.error.message);
  const wanted = sanitizeSetup(setup);
  const seeded = sandboxSeed(probeRuleOf(read.rule, def, "front", 0), keyOf(boardKey), {}, { setup: wanted, defs: fixtureSetupDefs(), scripts: {} });
  return { ...seeded, card: { cardId: def.id, name: def.name, printed: def.skill ?? "", side: "front", skillIndex: 0 } };
}
