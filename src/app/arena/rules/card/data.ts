import { and, desc, eq, inArray, like } from "drizzle-orm";
import type { Db } from "@/db";
import { arenaFeedback, cards } from "@/db/schema";
import { SKILL_LABELS } from "@/lib/arena/beats";
import { keywordPlays } from "@/lib/arena/glossary";
import { describeScript, type Cond, type CostRecord, type Op } from "@/lib/arena/vm/script";
import type { Rule } from "@/lib/arena/lang";
import { openingFocus } from "@/lib/arena/lang/blocks";
import { currentScope } from "@/lib/auth";
import { ownerDecks } from "@/lib/arena/queue-cards";
import { comboChips, flagNotice } from "@/lib/arena/rule-card";
import { FLAG_PREFIX } from "@/lib/arena/rule-review";
import { reviewItemById } from "@/lib/arena/rule-review-store";
import { cardHealth, currentRowsOf, expectedSkills, ruleHealth, worklist, type CompilerDiff, type RuleHealth } from "@/lib/arena/rules-store";
import type { Trigger } from "@/lib/arena/types";
import { historyOf, specifiedCostOf } from "../record";
import type { CardView, HistoryLine, SkillView } from "./types";

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

/** The rule a row holds, the way the block builder takes it. */
function ruleOfRow(row: { kind: string; trigger: unknown; validity?: unknown; usage?: unknown; combo?: unknown; cost: unknown; cond: unknown; ops: unknown }): Rule {
  return {
    kind: row.kind,
    trigger: (row.trigger ?? []) as Trigger[],
    ...(row.validity !== undefined && row.validity !== null ? { validity: row.validity as Rule["validity"] } : {}),
    ...(row.usage !== undefined && row.usage !== null ? { usage: row.usage as Rule["usage"] } : {}),
    ...(row.combo != null ? { combo: row.combo as Rule["combo"] } : {}),
    cost: (row.cost as CostRecord | null) ?? null,
    cond: (row.cond as Cond | null) ?? null,
    ops: (row.ops as Op[]) ?? [],
  };
}

const sentence = (s: string) => s.replace(/[.\s]+$/, "");

/** The card's one-line why, from its skills' reasons: the worst skills first, at most two, each with its number. */
function whyLine(skills: SkillView[], health: RuleHealth): string {
  if (health === "done" && skills.some((s) => s.category)) return "Every skill is read and checked; a deck-building rule is checked by deck legality, not played.";
  if (health === "done") return "Every skill is read and checked.";
  const bad = skills.filter((s) => s.health === health);
  const parts = bad.slice(0, 2).map((s) => `Skill ${s.n}: ${sentence(s.reasons[0] ?? (s.ruleId == null ? "no rule record yet" : "needs a look"))}.`);
  if (bad.length > 2) parts.push(`${bad.length - 2} more.`);
  return parts.join(" ");
}

/** Everything the Card rules page shows, read in one go. Null when the card is not one the arena reviews. */
export async function loadCardPage(db: Db, cardId: string): Promise<{ card: CardView; skills: SkillView[]; history: HistoryLine[] } | null> {
  const [c] = await db.select().from(cards).where(eq(cards.id, cardId));
  if (!c || c.cardType.trim().toUpperCase() === "ENERGY MARKER") return null;

  const rows = await worklist(db, [cardId]);
  const current = currentRowsOf({ skill: c.skill, backSkill: c.backSkill }, rows);
  const expected = expectedSkills(c.skill, c.backSkill);

  // The decks that run it, by the queue's own rule (`ownerDecks`: dbs, not testing, the viewer's scope, main/Z/leader
  // zones), so "in 1 deck" on the queue row and "In 1 of your decks" here are the same count. Before this the page
  // asked for decks with a leader and 50+ main cards, and said "Not in a deck you play" for a card the queue listed.
  const decks = await ownerDecks(db, await currentScope());
  const mine = decks.filter((d) => d.cardIds.includes(cardId)).map((d) => ({ id: d.id, name: d.name }));

  // When each flag was written: the in-app Wrong leaves a feedback note beside it.
  const flagged = current.filter((x) => x.row?.reviewFlag).map((x) => x.row!.id);
  const stamps = new Map<number, Date>();
  if (flagged.length) {
    const found = await db
      .select({ noteId: arenaFeedback.noteId, createdAt: arenaFeedback.createdAt })
      .from(arenaFeedback)
      .where(and(eq(arenaFeedback.kind, "rule"), inArray(arenaFeedback.noteId, flagged), like(arenaFeedback.note, `${FLAG_PREFIX}%`)))
      .orderBy(desc(arenaFeedback.id));
    for (const f of found) if (f.noteId != null && !stamps.has(f.noteId)) stamps.set(f.noteId, f.createdAt);
  }

  const skills: SkillView[] = [];
  for (const [i, e] of expected.entries()) {
    const row = current[i]?.row ?? null;
    if (!row) {
      skills.push({
        n: i + 1, side: e.side, skillIndex: e.skillIndex, printed: e.printed, ruleId: null, kindLabel: "Skill", health: "text-only", category: null, deckBuilding: [],
        reasons: ["The engine has no record of this skill yet."], hints: [], needsRebuild: true, status: null, source: null, version: 0, changedAt: null,
        reads: "", comboChips: [], unread: [], flag: null, compilerDiff: null, rule: null, item: null, timesSeen: 0, focus: null,
      });
      continue;
    }
    const report = ruleHealth(row);
    const diff = row.compilerDiff as CompilerDiff | null;
    const plays = row.pattern?.startsWith("keyword:") ? keywordPlays(row.pattern.slice("keyword:".length)) : null;
    const rule = ruleOfRow(row);
    const reads = row.reads || (plays && !(row.ops as Op[]).length ? `Played by the engine’s ${plays.tag} rule. ${plays.engine}` : "");
    skills.push({
      n: i + 1,
      side: e.side,
      skillIndex: e.skillIndex,
      printed: row.printed,
      ruleId: row.id,
      kindLabel: SKILL_LABELS[row.kind] ?? row.kind,
      health: report.health,
      category: report.category,
      deckBuilding: report.deckBuilding,
      reasons: report.reasons,
      hints: report.hints,
      needsRebuild: report.needsRebuild,
      status: row.status as SkillView["status"],
      source: row.source as SkillView["source"],
      version: row.version,
      changedAt: iso(row.updatedAt),
      reads,
      comboChips: comboChips(row.combo as Parameters<typeof comboChips>[0]),
      unread: row.unread,
      flag: flagNotice(row.reviewFlag, stamps.get(row.id), row.updatedAt),
      compilerDiff: diff ? { reads: describeScript(diff.ops, { permanent: row.kind === "permanent" }) || "nothing", unread: diff.unread, at: diff.at.slice(0, 10) } : null,
      rule,
      item: await reviewItemById(db, row.id, { decks: mine.map((d) => d.name), firedIn: null }),
      timesSeen: row.timesSeen,
      focus: openingFocus(rule, null, row.status === "open" ? row.unread : []) ?? null,
    });
  }

  const health = cardHealth(skills.map((s) => s.health));
  const history: HistoryLine[] = [];
  for (const s of skills) {
    const row = s.ruleId == null ? null : rows.find((r) => r.id === s.ruleId);
    if (row) for (const h of historyOf(row)) history.push({ ...h, skill: `Skill ${s.n}` });
  }
  history.sort((a, b) => b.when.localeCompare(a.when));

  return {
    card: {
      id: c.id,
      name: c.name,
      setCode: c.setCode,
      type: c.cardType,
      colors: c.colors,
      imageUrl: c.imageUrl,
      cost: c.energyCost,
      power: c.power,
      comboPower: c.comboPower,
      traits: c.traits,
      decks: mine,
      seenIn: skills.reduce((n, s) => n + s.timesSeen, 0),
      health,
      why: whyLine(skills, health),
      canRebuild: skills.some((s) => s.needsRebuild),
      specifiedCost: await specifiedCostOf(db, cardId),
    },
    skills,
    history,
  };
}
