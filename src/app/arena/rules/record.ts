/**
 * A `card_rules` row as the record pane needs it, and the history read off it.
 *
 * Shared by the worklist over your decks and the one over the whole catalog:
 * the two pages differ in what they *select*, never in what a record is.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { cards } from "@/db/schema";
import { specifiedCostUnknown } from "@/lib/arena/text/cards";
import { defsForCards } from "@/lib/arena/load";
import { parseSpecifiedCost, specifiedCostWords } from "@/lib/arena/specified-cost";
import { describeScript } from "@/lib/arena/vm/script";
import { type CompilerDiff, type StoredProbe, type WorklistRow } from "@/lib/arena/rules-store";

/** The right pane's History, read off the row rather than a log table. */
export function historyOf(r: WorklistRow): { when: string; what: string }[] {
  const day = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "");
  const out: { when: string; what: string }[] = [];
  const diff = r.compilerDiff as CompilerDiff | null;
  if (diff) out.push({ when: day(diff.at), what: `the compiler now reads this differently: “${describeScript(diff.ops) || "nothing"}”${diff.unread.length ? ` (unread: ${diff.unread.join(" | ")})` : ""}` });
  const probed = r.probe as StoredProbe | null;
  if (probed) out.push({ when: day(probed.at), what: `probed on ${probed.scenario}: ${probed.outcome}${probed.result.length ? ` — ${probed.result[0]}` : ""}` });
  if (r.confirmedAt) out.push({ when: day(r.confirmedAt), what: "confirmed by you" });
  if (r.source !== "compiler" || r.status === "corrected") out.push({ when: day(r.updatedAt), what: r.source === "claude" ? `program written by Claude · v${r.version}` : `corrected by hand · v${r.version}` });
  else if (r.version > 1) out.push({ when: day(r.updatedAt), what: `re-drafted by the compiler · v${r.version}` });
  out.push({ when: day(r.createdAt), what: r.unread.length ? `drafted: ${r.unread.length} clause${r.unread.length === 1 ? "" : "s"} unread` : `drafted by the compiler${r.pattern ? ` · pattern ${r.pattern}` : ""}` });
  return out;
}

/** The specified-cost entry as the card page shows it. */
export type SpecifiedCostView = { entered: string | null; words: string | null; unknown: boolean } | null;

/**
 * The card's specified-cost baseline as the record shows it (issue #255):
 * only an X-cost card has one to enter — a fixed cost's orbs are filled by
 * convention — and `unknown` is `specifiedCostUnknown` read off the same def
 * the engine plays, not a second list of cards. `entered` is the column as
 * written, so a value that did not parse is shown rather than hidden.
 */
export async function specifiedCostOf(db: Db, cardId: string): Promise<SpecifiedCostView> {
  const [row] = await db.select({ energyCost: cards.energyCost, specifiedCost: cards.specifiedCost }).from(cards).where(eq(cards.id, cardId));
  const defs = await defsForCards(db, [cardId]);
  const def = defs[cardId];
  if (!row || !def || def.energyCost !== "X") return null;
  const parsed = parseSpecifiedCost(row.specifiedCost);
  return { entered: row.specifiedCost, words: parsed ? specifiedCostWords(parsed) : null, unknown: specifiedCostUnknown(def) };
}
