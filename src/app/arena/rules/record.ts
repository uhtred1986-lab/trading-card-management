/**
 * A `card_rules` row as the record pane needs it, and the history read off it.
 *
 * Shared by the worklist over your decks and the one over the whole catalog:
 * the two pages differ in what they *select*, never in what a record is.
 */
import type { Db } from "@/db";
import type { RecordProps } from "@/components/arena/rules/RuleRecord";
import { SKILL_LABELS } from "@/lib/arena/beats";
import { describeScript, type Op } from "@/lib/arena/engine";
import { describeCond, type Cond } from "@/lib/arena/engine/script";
import type { CostRecord } from "@/lib/arena/draft";
import { describeTrigger, mechanismNeeds, mechanismOf } from "@/lib/arena/gaps";
import { siblingsOf, type CompilerDiff, type RuleStatus, type WorklistRow } from "@/lib/arena/rules-store";

/** The parsed price as a sentence, for the COST row. */
export function costSentence(cost: CostRecord | null): string | null {
  if (!cost) return null;
  const parts: string[] = [];
  for (const [c, n] of Object.entries(cost.orbs)) parts.push(`${n} ${c === "any" ? "energy" : `${c} energy`}`);
  for (const either of cost.either) parts.push(`1 ${either.join(" or ")} energy`);
  if (cost.marker != null) parts.push(cost.marker >= 0 ? `add ${cost.marker} marker${cost.marker === 1 ? "" : "s"}` : `remove ${-cost.marker} marker${cost.marker === -1 ? "" : "s"}`);
  if (cost.burst != null) parts.push(`Burst ${cost.burst}`);
  if (cost.spiritBoost != null) parts.push(`Spirit Boost ${cost.spiritBoost}`);
  if (cost.condition) parts.push(`if ${describeCond(cost.condition)}`);
  if (cost.program) parts.push(describeScript(cost.program));
  else if (cost.text && !cost.condition) parts.push(cost.text);
  return parts.join(" · ") || null;
}

/** The right pane's History, read off the row rather than a log table. */
export function historyOf(r: WorklistRow): { when: string; what: string }[] {
  const day = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "");
  const out: { when: string; what: string }[] = [];
  const diff = r.compilerDiff as CompilerDiff | null;
  if (diff) out.push({ when: day(diff.at), what: `the compiler now reads this differently: “${describeScript(diff.ops) || "nothing"}”${diff.unread.length ? ` (unread: ${diff.unread.join(" | ")})` : ""}` });
  if (r.confirmedAt) out.push({ when: day(r.confirmedAt), what: "confirmed by you" });
  if (r.source !== "compiler" || r.status === "corrected") out.push({ when: day(r.updatedAt), what: r.source === "claude" ? `program written by Claude · v${r.version}` : `corrected by hand · v${r.version}` });
  else if (r.version > 1) out.push({ when: day(r.updatedAt), what: `re-drafted by the compiler · v${r.version}` });
  out.push({ when: day(r.createdAt), what: r.unread.length ? `drafted: ${r.unread.length} clause${r.unread.length === 1 ? "" : "s"} unread` : `drafted by the compiler${r.pattern ? ` · pattern ${r.pattern}` : ""}` });
  return out;
}

/** The WHEN line for a skill kind the engine answers to at a fixed moment. */
function triggerLine(row: WorklistRow): string {
  const said = describeTrigger(row.trigger ?? []);
  if (said) return said;
  if (row.kind === "permanent") return "while this card is where the skill is valid";
  if (row.kind.startsWith("activate")) return "when you activate it";
  if (row.kind.startsWith("counter")) return "at the counter timing the tag names";
  return "the engine knows no moment for this wording";
}

export async function buildRecord(db: Db, selected: WorklistRow, decks: string[]): Promise<RecordProps> {
  const siblings = await siblingsOf(db, selected);
  const key = selected.status === "open" ? mechanismOf(selected.unread[0] ?? "") : null;
  const mechanism = key ? { key, needs: mechanismNeeds(key) } : null;
  const diff = selected.compilerDiff as CompilerDiff | null;
  return {
    id: selected.id,
    cardId: selected.cardId,
    name: selected.name,
    setCode: selected.setCode,
    side: selected.side === "back" ? "back" : "front",
    skillIndex: selected.skillIndex,
    kind: SKILL_LABELS[selected.kind] ?? selected.kind,
    permanent: selected.kind === "permanent",
    printed: selected.printed,
    trigger: triggerLine(selected),
    cost: costSentence(selected.cost as CostRecord | null),
    cond: (selected.cond as Cond | null) ?? null,
    ops: (selected.ops as Op[]) ?? [],
    unread: selected.unread,
    status: selected.status as RuleStatus,
    source: selected.source as "compiler" | "claude" | "user",
    version: selected.version,
    explanation: selected.explanation,
    pattern: selected.pattern,
    reads: selected.reads,
    decks,
    siblings,
    compilerDiff: diff ? { reads: describeScript(diff.ops, { permanent: selected.kind === "permanent" }) || "nothing", unread: diff.unread, at: diff.at.slice(0, 10) } : null,
    mechanism,
  };
}
