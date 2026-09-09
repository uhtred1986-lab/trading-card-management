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
import type { Cond, CostRecord } from "@/lib/arena/engine/script";
import type { Trigger } from "@/lib/arena/engine";
import { mechanismNeeds, mechanismOf } from "@/lib/arena/gaps";
import { defsForCards } from "@/lib/arena/load";
import { ruleFrom, scenariosFor } from "@/lib/arena/probe";
import { programOf, siblingsOf, type CompilerDiff, type RuleStatus, type StoredProbe, type WorklistRow } from "@/lib/arena/rules-store";

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

/**
 * The boards this rule can be tried on, for the probe pane. Reading the card
 * is what it costs: `scenariosFor` is pure, and the run itself happens in the
 * action when the button is pressed.
 */
export async function probeScenarios(db: Db, row: WorklistRow): Promise<{ ruleId: number; scenarios: { key: string; title: string }[] } | null> {
  const defs = await defsForCards(db, [row.cardId]);
  const def = defs[row.cardId];
  if (!def) return null;
  const scenarios = scenariosFor(ruleFrom(row, def, programOf(row)));
  return { ruleId: row.id, scenarios: scenarios.map((s) => ({ key: s.key, title: s.title })) };
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
    // The printed tag as the row stores it, which is what the rules language
    // writes in WHEN and refuses to let anyone change.
    tag: selected.kind,
    permanent: selected.kind === "permanent",
    printed: selected.printed,
    // WHEN and COST arrive as the record holds them, not as sentences: both
    // are editable now, so the sentences are made in the browser from whatever
    // is in the box at the time.
    trigger: (selected.trigger ?? []) as Trigger[],
    cost: (selected.cost as CostRecord | null) ?? null,
    cond: (selected.cond as Cond | null) ?? null,
    ops: (selected.ops as Op[]) ?? [],
    unread: selected.unread,
    status: selected.status as RuleStatus,
    source: selected.source as "compiler" | "claude" | "user",
    version: selected.version,
    explanation: selected.explanation,
    brief: selected.brief,
    timesSeen: selected.timesSeen,
    pattern: selected.pattern,
    reads: selected.reads,
    decks,
    siblings,
    compilerDiff: diff ? { reads: describeScript(diff.ops, { permanent: selected.kind === "permanent" }) || "nothing", unread: diff.unread, at: diff.at.slice(0, 10) } : null,
    mechanism,
  };
}
