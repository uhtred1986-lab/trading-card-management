import { notFound } from "next/navigation";
import { CardRules } from "@/components/arena/rules/CardRules";
import type { Rule } from "@/lib/arena/lang";
import { comboChips, flagNotice } from "@/lib/arena/rule-card";
import type { ReviewItem } from "@/lib/arena/rule-review-store";
import { cardHealth, ruleHealth, type RuleHealth, type RuleStatus } from "@/lib/arena/rules-store";
import { requireSlPage } from "@/lib/auth";
import { zeroCostRecord } from "@/lib/arena/vm/skill-payment";
import { unlimitedUsage } from "@/lib/arena/vm/usage";
import { noSparking } from "@/lib/arena/vm/validity";
import type { CardView, HistoryLine, SkillView } from "../types";

export const dynamic = "force-dynamic";

/**
 * Dev-only: the Card rules page on a synthetic card, with no database behind it,
 * so it can be opened and shot in a session that keeps off Neon (the way
 * `/arena/preview` shows the board). Four skills: one the engine reads nothing
 * of, one marked Wrong that has changed since, a read draft, an approved one.
 * Saving answers "preview only". Production answers 404.
 *
 * `?skill=102&edit=1` opens a skill's editor, `?walk=0` hides ‹ / ›.
 */
const NOW = Date.now();
const DAY = 86_400_000;

/** A rule with the typed records a compiled row always carries, so the fixture's health is about its own story. */
const rule = (over: Partial<Rule>): Rule => ({ kind: "auto", trigger: ["attacks"], validity: noSparking(), usage: unlimitedUsage(), cost: zeroCostRecord(), cond: null, ops: [], ...over });

interface Seed {
  id: number;
  printed: string;
  kind: string;
  status: RuleStatus;
  source: "compiler" | "claude" | "user";
  rule: Rule;
  unread?: string[];
  reads: string;
  version: number;
  ageDays: number;
  flag?: { text: string; daysAgo: number };
  combo?: Parameters<typeof comboChips>[0];
}

const SEEDS: Seed[] = [
  {
    id: 101,
    printed: "[Auto] At the end of a battle in which you combo with this card from your hand during your opponent’s turn, if your Leader Card is red, play this card in Rest Mode.",
    kind: "Auto",
    status: "draft",
    source: "compiler",
    rule: rule({ trigger: ["comboed"], combo: { version: 1, timing: "battleEnd", subject: "self", origins: ["hand"], turn: "opponent" }, ops: [{ op: "draw", n: 1 }] }),
    reads: "If your Leader is red: play this card in Rest Mode.",
    version: 6,
    ageDays: 1,
    flag: { text: "WHEN · misses a condition — only at the end of a battle you comboed in", daysAgo: 15 },
    combo: { version: 1, timing: "battleEnd", subject: "self", origins: ["hand"], turn: "opponent" },
  },
  {
    id: 102,
    printed: "[Activate: Main] Choose 1 of your opponent’s Battle Cards with an energy cost of 4 or less, and switch its position.",
    kind: "Activate: Main",
    status: "open",
    source: "compiler",
    rule: rule({ kind: "activate:main", trigger: [], ops: [] }),
    unread: ["Choose 1 of your opponent’s Battle Cards with an energy cost of 4 or less, and switch its position."],
    reads: "",
    version: 1,
    ageDays: 9,
  },
  {
    id: 103,
    printed: "[Auto] When you play this card, choose up to 1 of your opponent’s Battle Cards and it gets −5000 power for the duration of the turn.",
    kind: "Auto",
    status: "draft",
    source: "compiler",
    rule: rule({ trigger: ["played"], ops: [{ op: "draw", n: 1 }] }),
    reads: "Draw 1 card.",
    version: 2,
    ageDays: 5,
  },
  {
    id: 104,
    printed: "[Permanent] This card gets +5000 power while your Leader is red.",
    kind: "Permanent",
    status: "confirmed",
    source: "user",
    rule: rule({ kind: "permanent", trigger: [], ops: [{ op: "draw", n: 1 }] }),
    reads: "While your Leader is red: +5000 power.",
    version: 3,
    ageDays: 30,
  },
];

function skillOf(s: Seed, n: number): SkillView {
  const changedAt = new Date(NOW - s.ageDays * DAY).toISOString();
  const flagAt = s.flag ? new Date(NOW - s.flag.daysAgo * DAY) : null;
  const report = ruleHealth({ kind: s.rule.kind, unread: s.unread ?? [], ops: s.rule.ops, cost: s.rule.cost, trigger: s.rule.trigger, validity: s.rule.validity, usage: s.rule.usage, combo: s.combo, printed: s.printed, status: s.status, skillIndex: (n - 1) * 10, source: s.source, reviewFlag: s.flag ? `Wrong (phone review) · ${s.flag.text}` : null });
  const item: ReviewItem = {
    reviewVersion: `fixture-${s.id}`, id: s.id, cardId: "BT0-FIXTURE", name: "Fixture Trunks", meta: "Battle · Red · cost 3", imageUrl: null, side: "front", skillIndex: (n - 1) * 10,
    kindLabel: s.kind, tag: s.rule.kind, printed: s.printed, trigger: s.rule.trigger, cost: s.rule.cost, cond: s.rule.cond, ops: s.rule.ops, unread: s.unread ?? [], status: s.status,
    source: s.source, pattern: null, explanation: null, timesSeen: 0, probe: null, firedIn: null, decks: ["Fixture deck"], sameWording: 0,
  };
  return {
    n, side: "front", skillIndex: (n - 1) * 10, printed: s.printed, ruleId: s.id, kindLabel: s.kind, health: report.health, reasons: report.reasons, hints: report.hints,
    needsRebuild: report.needsRebuild || s.id === 101, status: s.status, source: s.source, version: s.version, changedAt, reads: s.reads, comboChips: comboChips(s.combo),
    unread: s.unread ?? [], flag: s.flag ? flagNotice(`Wrong (phone review) · ${s.flag.text}`, flagAt, changedAt) : null, compilerDiff: null, rule: s.rule, item, timesSeen: 0, focus: s.unread?.length ? "ops" : null,
  };
}

export default async function CardRulesPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireSlPage();
  if (process.env.NODE_ENV === "production") notFound();
  const sp = await searchParams;
  const skills = SEEDS.map((s, i) => skillOf(s, i + 1));
  const health: RuleHealth = cardHealth(skills.map((s) => s.health));
  const card: CardView = {
    id: "BT0-FIXTURE", name: "Fixture Trunks", setCode: "BT0", type: "BATTLE", colors: ["RED"], imageUrl: null, cost: "3", power: 10000, comboPower: 5000, traits: ["Saiyan", "Earthling"],
    decks: [{ id: 1, name: "Fixture deck" }, { id: 2, name: "[Starter] Pride of the Saiyans" }], seenIn: 0, health,
    why: "Skill 1: Marked wrong: WHEN · misses a condition. Skill 2: The engine does nothing with this text yet.", canRebuild: true,
    specifiedCost: sp.xcost ? { entered: null, words: null, unknown: true } : null,
  };
  const history: HistoryLine[] = [
    { when: "2026-10-19", what: "re-drafted by the compiler · v6", skill: "Skill 1" },
    { when: "2026-10-14", what: "drafted by the compiler", skill: "Skill 2" },
    { when: "2026-10-04", what: "you marked it Wrong (timing)", skill: "Skill 1" },
  ];
  const walk = sp.walk === "0" ? null : { label: "Incomplete · same wording", index: 1, total: 47, prevHref: null, nextHref: "/arena/rules/card/preview", nextName: "Golden Great Ape Son Goku" };
  return <CardRules card={card} skills={skills} history={history} walk={walk} backHref="/arena/rules" admin initialSkill={Number(sp.skill) || null} initialEdit={sp.edit === "1"} fixture />;
}
