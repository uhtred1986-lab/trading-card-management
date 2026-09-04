/**
 * The rules of the cards you play, as they stand — and a way to set them.
 *
 * Every skill is in one of three states: the compiler read it, it is put to
 * the referee at runtime, or you have stored a program for it. This gathers
 * that for the cards in your decks, and turns a line of card text into a
 * program so you can see what the engine will make of a wording before you
 * keep it.
 *
 * The editor is deliberately built on the compiler rather than on a form: the
 * compiler is already the parser for this language, so "type it until it reads
 * correctly" needs no second implementation to fall out of step with it.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { cardScripts, cards as cardsTable } from "@/db/schema";
import { listDecks } from "@/lib/decks/queries";
import { compileCardCached, compileSkill, describeScript, parseSkills, type Op } from "./engine";
import { skillLines } from "./engine/cards";
import { cardDefFrom, deckInputFor } from "./load";

export type RuleState = "read" | "stored" | "referee";

export interface RuleRow {
  cardId: string;
  name: string;
  side: "front" | "back";
  skillIndex: number;
  kind: string;
  /** The line as printed, which is also what the editor starts from. */
  printed: string;
  /** What the engine will do, in plain words. Empty when it does nothing. */
  reads: string;
  /** The clauses the compiler could not read. */
  unsupported: string[];
  state: RuleState;
  /** Your stored program, when there is one. */
  stored: { ops: Op[]; source: string; explanation: string | null; meaning: string | null } | null;
  /** Which of your decks it turns up in. */
  decks: string[];
}

/** Every skill of every card in a deck the arena can play. */
export async function rulesForDecks(db: Db): Promise<RuleRow[]> {
  const decks = (await listDecks(db, { game: "dbs" })).filter((d) => d.leader && d.mainCount >= 50);
  const inDecks = new Map<string, string[]>();
  for (const d of decks) {
    const input = await deckInputFor(db, d.id);
    if (!input) continue;
    for (const id of new Set(input.cardIds)) inDecks.set(id, [...(inDecks.get(id) ?? []), d.name]);
  }
  if (!inDecks.size) return [];

  const rows = await db.select().from(cardsTable).where(inArray(cardsTable.id, [...inDecks.keys()]));
  const stored = await db.select().from(cardScripts).where(inArray(cardScripts.cardId, [...inDecks.keys()]));
  const storedBy = new Map(stored.map((s) => [`${s.cardId}#${s.side}#${s.skillIndex}`, s]));

  const out: RuleRow[] = [];
  for (const row of rows) {
    const d = cardDefFrom(row);
    for (const side of ["front", "back"] as const) {
      const text = side === "front" ? d.skill : d.back?.skill;
      if (!text) continue;
      const lines = skillLines(text);
      const scripts = compileCardCached(d, side);
      for (const sk of parseSkills(text)) {
        // A keyword with no text of its own is a rule, not something to write.
        if (!sk.effect.trim()) continue;
        const script = scripts.bySkill[sk.index];
        const mine = storedBy.get(`${d.id}#${side}#${sk.index}`);
        const ops = mine ? ((mine.ops as Op[]) ?? []) : (script?.ops ?? []);
        out.push({
          cardId: d.id,
          name: side === "back" ? `${d.back?.name ?? d.name} (awakened)` : d.name,
          side,
          skillIndex: sk.index,
          kind: sk.kind,
          printed: lines[Math.floor(sk.index / 10)] ?? sk.raw,
          reads: describeScript(ops),
          unsupported: mine ? [] : (script?.unsupported ?? []),
          state: mine ? "stored" : script && script.unsupported.length === 0 ? "read" : "referee",
          stored: mine ? { ops: (mine.ops as Op[]) ?? [], source: mine.source, explanation: mine.explanation, meaning: mine.meaning } : null,
          decks: inDecks.get(d.id) ?? [],
        });
      }
    }
  }
  out.sort((a, b) => {
    const rank = (r: RuleRow) => (r.state === "referee" ? 0 : r.state === "stored" ? 1 : 2);
    return rank(a) - rank(b) || a.name.localeCompare(b.name) || a.skillIndex - b.skillIndex;
  });
  return out;
}

export interface RulePreview {
  reads: string;
  unsupported: string[];
  ops: Op[];
  /** The skill type the tags say, so a wrong tag is visible before saving. */
  kind: string | null;
}

/**
 * Compile one line of card text exactly as the engine compiles a card, so what
 * you see here is what the game will do. The whole line is taken, tags and
 * all: the tags decide when the skill happens, and getting them wrong is one
 * of the easier mistakes to make.
 */
export function previewRule(line: string): RulePreview {
  const skills = parseSkills(line);
  const sk = skills[0];
  if (!sk) return { reads: "", unsupported: [], ops: [], kind: null };
  const script = compileSkill(sk);
  return { reads: describeScript(script.ops), unsupported: script.unsupported, ops: script.ops, kind: sk.kind };
}

export async function removeRule(db: Db, cardId: string, skillIndex: number, side: "front" | "back"): Promise<void> {
  await db.delete(cardScripts).where(and(eq(cardScripts.cardId, cardId), eq(cardScripts.skillIndex, skillIndex), eq(cardScripts.side, side)));
}
