/**
 * Stored effect programs, laid over what the compiler read.
 *
 * A card you have explained should play correctly from that moment on, not
 * from the moment I get round to teaching the compiler its wording. The engine
 * looks in `ctx.scripts` before it compiles anything, so a row in
 * `card_scripts` simply wins.
 */
import { inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { cardScripts } from "@/db/schema";
import { compileCardCached, type CardDef, type CardScripts, type Op } from "./engine";

/**
 * Build the override map the engine reads. Keys are the catalog id for a
 * card's front and `<id>#back` for a leader's awakened side, which is what
 * `scriptsOf` in the engine looks for.
 */
export async function scriptsFor(db: Db, defs: Record<string, CardDef>): Promise<Record<string, CardScripts>> {
  const ids = Object.keys(defs);
  if (!ids.length) return {};
  const rows = await db.select().from(cardScripts).where(inArray(cardScripts.cardId, ids));
  if (!rows.length) return {};

  const out: Record<string, CardScripts> = {};
  for (const row of rows) {
    const d = defs[row.cardId];
    if (!d) continue;
    const side = row.side === "back" ? "back" : "front";
    const key = side === "back" ? `${row.cardId}#back` : row.cardId;
    // Start from the compiler's own reading so the skills nobody explained
    // still work, then lay the explained ones on top.
    const base = out[key] ?? clone(compileCardCached(d, side));
    base.bySkill[row.skillIndex] = { ops: (row.ops as Op[]) ?? [], unsupported: [] };
    base.unsupported = Object.values(base.bySkill).flatMap((s) => s.unsupported);
    base.complete = base.unsupported.length === 0;
    out[key] = base;
  }
  return out;
}

function clone(s: CardScripts): CardScripts {
  return { bySkill: { ...s.bySkill }, complete: s.complete, unsupported: [...s.unsupported] };
}

export async function saveScript(
  db: Db,
  entry: { cardId: string; skillIndex: number; side?: "front" | "back"; ops: Op[]; source?: "user" | "claude" | "compiler"; explanation?: string | null; meaning?: string | null },
): Promise<void> {
  const side = entry.side ?? "front";
  await db
    .insert(cardScripts)
    .values({
      cardId: entry.cardId,
      skillIndex: entry.skillIndex,
      side,
      ops: entry.ops,
      source: entry.source ?? "claude",
      explanation: entry.explanation ?? null,
      meaning: entry.meaning ?? null,
    })
    .onConflictDoUpdate({
      target: [cardScripts.cardId, cardScripts.skillIndex, cardScripts.side],
      set: { ops: entry.ops, source: entry.source ?? "claude", explanation: entry.explanation ?? null, meaning: entry.meaning ?? null, updatedAt: new Date() },
    });
}
