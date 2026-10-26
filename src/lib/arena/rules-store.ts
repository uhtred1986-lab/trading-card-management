import { isPotaraSkill } from "./vm/potara-materials";
import { isAbsorbSkill } from "./vm/absorb-procedure";
import { needsEvolutionContract } from "./vm/evolution-base";
import { fusionIdentityProblem, evolutionIdentityProblem, absorbIdentityProblem, potaraIdentityProblem } from "./vm/skill-identity";
import { validityProblem, type ValidityRecord } from "./vm/validity";
import { usageProblem, type UsageRecord } from "./vm/usage";
/**
 * `card_rules`, read and written. The only module that touches the table.
 *
 * A rule is a record the engine plays from, the workbench shows and a person
 * confirms or corrects — never something recomputed at game time. Everything
 * that changes a row goes through here so the reading (`reads`) and the
 * version stay honest.
 */
import { and, asc, eq, ilike, inArray, isNotNull, ne, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { cardRules, cards } from "@/db/schema";
import { completeFilters, describeScript, type CardScripts, type Op } from "./vm/script";
import { costModifierAs, modifyAttrAs, negateAs, replaceAs } from "./vm/script-schema";
import { DEFERRED_STATICS, STATIC_OPS } from "./vm/effects";
import { readableAutomaticPrice } from "./vm/auto-costs";
import { NotYet } from "./vm/errors";
import { validateRule } from "./lang/validate";
import { type CardDef } from "./types";
import type { Cond, CostRecord, SkillPrice, XCost } from "./vm/script";
import type { Trigger } from "./types";
import { clauseShape, mechanismOf, PHRASING_ONLY } from "./gaps";
import type { EngineId } from "./engines";
import { parseSkills, skillLines } from "./text/cards";
import { needsPaymentRecord, priceFromCostRecord, costRecordProblem, zeroCostRecord, zeroSkillPrice } from "./vm/skill-payment";
import { reviewVersion } from "./rule-review-version";
import type { Rule } from "./lang/ast";
import { fusionMaterialsProblem, isFusionSkill } from "./vm/fusion-materials";
import { programProblem } from "./vm/script-schema";
import { deckBuildingOfSkill, emptyOnPurpose, isDeckBuildingLine, readsAsNothingSilently } from "./compile/silent";
import { ARENA_GAMES, DEFAULT_GAME } from "@/lib/catalog/games";
import { FLAG_PREFIX } from "./rule-review";

import { comboScriptProblem, type ComboQualification } from "./vm/combo-qualification";
import { compileComboQualification } from "./text/triggers";

export type RuleRow = typeof cardRules.$inferSelect;
export type RuleStatus = "open" | "draft" | "confirmed" | "corrected";
export type RuleSource = "compiler" | "claude" | "user";
export type Side = "front" | "back";

/** Reminder accessories remain in the catalog/history, outside skill review.
 * Their behavior lives in game.rules setup and costs.rules (1-14, 6-2-1-11).
 */
export const REVIEWABLE_CARD = sql<boolean>`upper(trim(${cards.cardType})) <> 'ENERGY MARKER'`;

export interface RuntimeSupport {
  /** Known reasons a record cannot be fully carried out by the rules engine. */
  unsupported: string[];
  /** Runtime depends on a play target or board context that readiness cannot know. */
  unknown: string[];
}
export interface CompilerDiff {
  ops: Op[];
  unread: string[];
  at: string;
}

/** The program the engine runs: the hoisted condition, if any, wrapped back around the steps. */
export function programOf(row: Pick<RuleRow, "ops"> & { cond?: unknown }): Op[] {
  const ops = (row.ops as Op[]) ?? [];
  return row.cond ? [{ op: "if", cond: row.cond as Cond, then: ops }] : ops;
}

/**
 * The price the engine charges, off the row (4-3-3). Until 8 Sep 2026 the
 * engine rebuilt this from the card's text on every activation, against the
 * rule that it never compiles card text at game time; the drafter has written
 * both halves to `card_rules.cost` since phase 2, and this hands them over.
 *
 * Every current row carries payment v1, including an explicit zero price.
 * Obsolete or malformed contracts become a refused price with a keyed support
 * diagnostic; they never fall back to catalog text or a free activation.
 */
function priceOfRow(row: Pick<RuleRow, "cost">): SkillPrice {
  return costRecordProblem(row.cost) ? zeroSkillPrice(false) : priceFromCostRecord(row.cost as CostRecord);
}

/** What a printed line says about the typed records it needs: a function of the text alone, so it is kept per text. */
interface PrintedFacts { combo: boolean; fusion: boolean; evolution: boolean; absorb: boolean; potara: boolean }
const PRINTED_FACTS_LIMIT = 20_000;
const printedFactsByText = new Map<string, PrintedFacts>();
export function printedFactsUncached(printed: string): PrintedFacts {
  const skills = parseSkills(printed);
  return {
    combo: skills.some((sk) => compileComboQualification(sk)),
    fusion: skills.some(isFusionSkill),
    evolution: skills.some(needsEvolutionContract),
    absorb: skills.some(isAbsorbSkill),
    potara: skills.some(isPotaraSkill),
  };
}
export function printedFacts(printed: string): PrintedFacts {
  let hit = printedFactsByText.get(printed);
  if (!hit) {
    if (printedFactsByText.size >= PRINTED_FACTS_LIMIT) printedFactsByText.clear();
    hit = printedFactsUncached(printed);
    printedFactsByText.set(printed, hit);
  }
  return hit;
}

/** Structural material/grant failures always block drafts too. Other support
 * diagnostics retain the loader's existing draft/review policy. */
function materialContractGaps(row: Pick<RuleRow, "printed" | "kind" | "cost" | "ops"> & { cond?: unknown }): string[] {
  const unsupported: string[] = [];
  const facts = printedFacts(row.printed);
  if ((row.cost as CostRecord | null)?.fusion !== undefined || facts.fusion) {
    const gap = fusionIdentityProblem({ kind: row.kind as import("./types").Skill["kind"], price: priceOfRow(row) }, true);
    if (gap) unsupported.push(gap);
  }
  if ((row.cost as CostRecord | null)?.evolution !== undefined || facts.evolution) {
    const gap = evolutionIdentityProblem({ kind: row.kind as import("./types").Skill["kind"], price: priceOfRow(row) }, true);
    if (gap) unsupported.push(gap);
  }
  if ((row.cost as CostRecord | null)?.absorb !== undefined || facts.absorb) {
    const gap = absorbIdentityProblem({ kind: row.kind as import("./types").Skill["kind"], price: priceOfRow(row), ops: programOf(row) }, true);
    if (gap) unsupported.push(gap);
  }
  if ((row.cost as CostRecord | null)?.potara !== undefined || facts.potara) {
    const gap = potaraIdentityProblem({ kind: row.kind as import("./types").Skill["kind"], price: priceOfRow(row), ops: programOf(row) }, true);
    if (gap) unsupported.push(gap);
  }
  const grantGaps = (value: unknown): string[] => {
    if (Array.isArray(value)) return value.flatMap(grantGaps);
    if (!value || typeof value !== "object") return [];
    const op = value as Record<string, unknown>;
    if (op.op === "permit" && op.what === "unionLine") return [programProblem([op])].filter((s): s is string => !!s);
    return Object.values(op).flatMap(grantGaps);
  };
  unsupported.push(...grantGaps(row.ops));
  return unsupported;
}

/** Printed wording establishes only whether migration is required; never reconstruct the executable qualification. */
function comboContractGap(row: { printed: string; trigger?: unknown; combo?: unknown }): string | null {
  const triggers = Array.isArray(row.trigger) ? row.trigger : [];
  const required = row.combo != null || triggers.some((t) => t === "comboUsed" || t === "comboed")
    || printedFacts(row.printed).combo;
  if (!required) return null;
  return comboScriptProblem(row);
}

/**
 * The typed records a row must carry before the engine will run it — Sparking
 * validity, skill usage, combo qualification, payment (#1066) and Fusion/Union
 * material (#907) — each in its own validator's words, or nothing. A gap here is
 * an out-of-date record that rebuilding the rule writes, not a clause the engine
 * cannot do: `ruleHealth` reports it as `needsRebuild`, never as a health.
 */
export function recordContractGaps(row: Pick<RuleRow, "kind" | "cost" | "ops" | "printed"> & { trigger?: unknown; combo?: unknown; usage?: unknown; validity?: unknown; cond?: unknown }): string[] {
  const gaps: string[] = [];
  const validityGap = validityProblem(row.validity);
  if (validityGap) gaps.push(validityGap);
  const usageGap = usageProblem(row.usage);
  if (usageGap) gaps.push(usageGap);
  const comboGap = comboContractGap(row);
  if (comboGap) gaps.push(comboGap);
  const paymentGap = costRecordProblem(row.cost);
  if (paymentGap) gaps.push(paymentGap);
  else if ((row.cost as CostRecord).readable === false) gaps.push("the stored skill payment is unreadable");
  gaps.push(...materialContractGaps(row));
  return gaps;
}

/**
 * The rule record's review status does not answer what the rules engine can
 * execute. Keep this check bounded to gaps the runtime already names. The
 * interpreter remains authoritative for contextual questions during a game.
 */
export function runtimeSupportOfRow(row: Pick<RuleRow, "kind" | "unread" | "ops" | "cost" | "trigger" | "printed"> & { combo?: unknown; usage?: unknown; validity?: unknown; cond?: unknown }): RuntimeSupport {
  const unsupported = [...(row.unread ?? []), ...recordContractGaps(row)];
  const unknown: string[] = [];
  const kind = row.kind.toLowerCase();
  const cost = row.cost as { program?: Op[] | null; x?: XCost } | null;

  // An Auto's action or X price is paid by the VM's own planner (#549,
  // `vm/auto-costs.ts`); refuse only what that planner refuses statically, in
  // its own words (#804). Activate and Counter lines have their own payment
  // paths and are intentionally not inferred from this Auto-only check.
  if (kind === "auto") {
    const gap = autoPriceGap(cost);
    if (gap) unsupported.push(gap);
  }
  if (kind === "auto" && (!Array.isArray(row.trigger) || row.trigger.length === 0)) {
    unsupported.push("the Auto rule has no readable WHEN trigger");
  }
  const triggers = Array.isArray(row.trigger) ? row.trigger : [];
  if (triggers.includes("flippedFaceUp")) {
    unsupported.push("the rules engine does not emit flippedFaceUp yet (LIFEWATCH; vm/host.ts)");
  }
  // Counter: Counter uses the native counter-motion chain (#552). Its
  // affordability is checked on the live board, like the other Counters.

  if (kind === "permanent") {
    for (const op of row.ops as Op[]) {
      const gap = permanentOpGap(op);
      if (gap) unsupported.push(gap);
    }
    // Before #553, an explicit 20-1 "in all areas" source qualifier was
    // dropped from compiled identity operations. Those rows still load, but
    // their static gains are now correctly play-scoped; don't advertise a
    // confirmed legacy row as executable until its owner rebuilds it.
    if (/\bin (?:all|any) areas?\b/i.test(row.printed ?? "")
      && (row.ops as Op[]).some((op) => missingAllAreasIdentityScope(op))) {
      unsupported.push("compiled all-area identity row is missing its source-validity marker; rebuild this rule record (#553)");
    }
  }

  // `play` can be implemented as an operation while still refusing a target
  // whose card type has no destination. The deck snapshot cannot always know
  // which card a selector will name, so don't call such a record verified.
  if (hasOp(row.ops as Op[], "play")) unknown.push("play target support depends on the card and board at resolution");

  return { unsupported: [...new Set(unsupported)], unknown: [...new Set(unknown)] };
}

/**
 * Why the VM's Auto price planner would refuse this record's price before
 * asking anyone, or null when it plans it. The same static checks
 * `prepareAutomaticCost` runs at the checkpoint (`vm/auto-costs.ts`): the
 * action program through `readableAutomaticPrice`, and the X bounds. Whether a
 * readable price is affordable is a question of the board, answered in game.
 */
function autoPriceGap(cost: { program?: Op[] | null; x?: XCost } | null): string | null {
  try {
    if (cost?.program?.length) readableAutomaticPrice(cost.program);
    const x = cost?.x;
    if (x) {
      const min = x.min ?? 0;
      if (!Number.isInteger(min) || min < 0 || (x.max !== undefined && (!Number.isInteger(x.max) || x.max < min)))
        throw new NotYet("read the bounds of this Auto's X cost", "#549");
    }
  } catch (err) {
    if (err instanceof NotYet) return err.message;
    throw err;
  }
  return null;
}

const IDENTITY_LIST_ATTRS = new Set(["traits", "characters", "colors", "alsoNames"]);

function missingAllAreasIdentityScope(op: Op): boolean {
  if (op.op === "if") return [...op.then, ...(op.else ?? [])].some(missingAllAreasIdentityScope);
  if (op.op !== "gains" && op.op !== "modifyAttr") return false;
  const selfTarget = !op.target || ("sel" in op.target && op.target.sel.special === "self");
  if (!selfTarget || op.allAreas === true) return false;
  return op.op === "gains" || IDENTITY_LIST_ATTRS.has(op.attr);
}

function permanentOpGap(op: Op): string | null {
  if (op.op === "if") {
    for (const child of [...op.then, ...(op.else ?? [])]) {
      const gap = permanentOpGap(child);
      if (gap) return gap;
    }
    return null;
  }
  const normalized = replaceAs(costModifierAs(negateAs(modifyAttrAs(op))));
  const deferred = DEFERRED_STATICS[normalized.op];
  if (deferred) return `Permanent ${normalized.op} is deferred to ${deferred}`;
  if (!(STATIC_OPS as readonly string[]).includes(normalized.op)) {
    return `Permanent ${normalized.op} is not collected as a runtime static`;
  }
  return null;
}

function hasOp(ops: Op[], name: string): boolean {
  return ops.some((op) => op.op === name || (op.op === "if" && (hasOp(op.then, name) || hasOp(op.else ?? [], name))));
}

/** The key `ctx.scripts` is read by: the catalog id for a front, `<id>#back` for a leader's awakened side. */
function scriptsKey(cardId: string, side: Side): string {
  return side === "back" ? `${cardId}#back` : cardId;
}

export async function loadRules(db: Db, cardIds: string[]): Promise<RuleRow[]> {
  const ids = [...new Set(cardIds)];
  if (!ids.length) return [];
  return db.select().from(cardRules).where(inArray(cardRules.cardId, ids));
}

/**
 * The programs the engine reads, from rows and nothing else. A skill with no
 * row has no program: the engine plays it as blank and says so in the log,
 * which is what `arena:draft` is for.
 */
export async function rulesFor(db: Db, defs: Record<string, CardDef>): Promise<Record<string, CardScripts>> {
  return rulesFromRows(await loadRules(db, Object.keys(defs)), defs);
}

/**
 * The skills a card's printed text needs a `card_rules` row for, one per skill
 * line. A native keyword line needs none. The single definition: `rulesFromRows`
 * (what games load) and `cardHealthOf` (what the screens show) both read it.
 */
export function expectedSkills(front: string | null | undefined, back: string | null | undefined): { side: Side; skillIndex: number; printed: string; effect: string }[] {
  // A card's text always yields the same skills, and the catalog queue asks for ~6,000 cards on every cache fill:
  // keep the answer per text pair and hand each caller its own copy.
  const key = `${front ?? ""}\u0000${back ?? ""}`;
  let hit = expectedByText.get(key);
  if (!hit) {
    if (expectedByText.size >= EXPECTED_BY_TEXT_LIMIT) expectedByText.clear();
    hit = expectedSkillsUncached(front, back);
    expectedByText.set(key, hit);
  }
  return hit.map((e) => ({ ...e }));
}
const EXPECTED_BY_TEXT_LIMIT = 20_000;
const expectedByText = new Map<string, ReturnType<typeof expectedSkillsUncached>>();

/** `expectedSkills` without the memo: the definition, and what `scripts/verify/rule-health-memo.ts` holds the memo to. */
export function expectedSkillsUncached(front: string | null | undefined, back: string | null | undefined): { side: Side; skillIndex: number; printed: string; effect: string }[] {
  const out: { side: Side; skillIndex: number; printed: string; effect: string }[] = [];
  for (const [side, text] of [["front", front], ["back", back]] as const) {
    const lines = skillLines(text);
    for (const skill of parseSkills(text)) {
      if (!skill.effect.trim() && !needsPaymentRecord(skill)) continue; // native keyword lines need no compiler row
      out.push({ side, skillIndex: skill.index, printed: lines[Math.floor(skill.index / 10)] ?? skill.raw, effect: skill.effect });
    }
  }
  return out;
}

/** `rulesFor`'s reading of rows already fetched — for a caller that fetches them beside the cards rather than after (`games.ts`'s `loadGame`). */
export function rulesFromRows(rows: RuleRow[], defs: Record<string, CardDef>): Record<string, CardScripts> {
  const out: Record<string, CardScripts> = {};
  const expected = new Map<string, { cardId: string; side: Side; skillIndex: number; printed: string; effect: string }>();
  for (const [cardId, def] of Object.entries(defs)) {
    for (const e of expectedSkills(def.skill, def.back?.skill)) expected.set(`${cardId}#${e.side}#${e.skillIndex}`, { cardId, ...e });
  }
  const seen = new Set<string>();
  for (const row of rows) {
    const d = defs[row.cardId];
    if (!d) continue;
    const side: Side = row.side === "back" ? "back" : "front";
    const expectedKey = `${row.cardId}#${side}#${row.skillIndex}`;
    const printed = expected.get(expectedKey);
    // Catalog text can change between a draft and a later match load. An old
    // row with a reused index is not the rule for the newly printed skill.
    if (!printed || printed.printed !== row.printed) continue;
    seen.add(expectedKey);
    const key = scriptsKey(row.cardId, side);
    const base = out[key] ?? { bySkill: {}, complete: true, unsupported: [] };
    // An open row has no program: the skill is played as blank, and the
    // unread clauses stay on it so the log and the referee can say why.
    const price = priceOfRow(row);
    // The WHEN comes off the row too, for the same reason the price does: the
    // workbench can edit it, and a trigger the engine did not read would make
    // that edit a label and nothing more (`skillAnswersTo` in `triggers.ts`).
    const trigger = (row.trigger ?? []) as Trigger[];
    const support = runtimeSupportOfRow(row);
    const blocksExecution = row.status === "open" || !!validityProblem(row.validity) || !!usageProblem(row.usage) || !!costRecordProblem(row.cost) || (row.cost as CostRecord)?.readable === false || materialContractGaps(row).length > 0 || !!comboContractGap(row) || ((row.status === "confirmed" || row.status === "corrected") && support.unsupported.length > 0);
    base.bySkill[row.skillIndex] = row.status === "open"
      ? { kind: row.kind as import("./types").Skill["kind"], ops: [], unsupported: support.unsupported, price, trigger, usage: row.usage as UsageRecord, validity: row.validity as ValidityRecord, ...(row.combo != null ? { combo: row.combo as ComboQualification } : {}) }
      : { kind: row.kind as import("./types").Skill["kind"], ops: programOf(row), unsupported: blocksExecution ? support.unsupported : [], price, trigger, usage: row.usage as UsageRecord, validity: row.validity as ValidityRecord, ...(row.combo != null ? { combo: row.combo as ComboQualification } : {}) };
    base.unsupported.push(...support.unsupported);
    base.complete = base.unsupported.length === 0;
    out[key] = base;
  }
  for (const [expectedKey, skill] of expected) {
    if (seen.has(expectedKey)) continue;
    const key = scriptsKey(skill.cardId, skill.side);
    const base = out[key] ?? { bySkill: {}, complete: false, unsupported: [] };
    base.bySkill[skill.skillIndex] = { ops: [], unsupported: ["no current rule record; regenerate rules and rebuild the match"], price: zeroSkillPrice(false), trigger: [] };
    base.complete = false;
    base.unsupported.push(`no current rule record for printed skill ${skill.skillIndex}: ${skill.effect}`);
    out[key] = base;
  }
  return out;
}

// ── rule health: the one answer to "is this skill done?" ────────────────────

/** Worst first. What the screens, the header counts and the progress page all speak. */
export const RULE_HEALTHS = ["text-only", "incomplete", "unchecked", "done"] as const;
export type RuleHealth = (typeof RULE_HEALTHS)[number];

/** The columns `ruleHealth` reads. A row from `card_rules` has all of them. */
export type HealthRow = Pick<RuleRow, "kind" | "unread" | "ops" | "cost" | "trigger" | "printed" | "status" | "skillIndex">
  & { source?: string | null; cond?: unknown; combo?: unknown; usage?: unknown; validity?: unknown; reviewFlag?: string | null; compilerDiff?: unknown };

export interface RuleHealthReport {
  health: RuleHealth;
  /** Why, in plain words. Empty when there is nothing to say. */
  reasons: string[];
  /** Things worth knowing that do not change the health ("try it in play"). */
  hints: string[];
  /**
   * An out-of-date typed record (`recordContractGaps`: validity, usage, combo
   * qualification, payment or material), so the engine refuses the skill until the
   * rule is rebuilt. Reported beside the health and never as one: on the owner's
   * decks every card needs a rebuild today, and counting it would make every card
   * incomplete.
   */
  needsRebuild: boolean;
  /**
   * "deck-building" when the whole line is a deck-building clause (a Leader's "You can't include …",
   * a card's own copy limit, a pooled limit; #1146): it is a rule of deck construction, not of play,
   * so it is read and empty on purpose. It is `done` for the counts and never Text only, Incomplete
   * or unchecked, and the screens label it with its own name. Null for every other line.
   */
  category: "deck-building" | null;
  /** The deck-building clauses the line carries, in words. Also set for a mixed line, whose game half has its own health. */
  deckBuilding: string[];
}

const flatLine = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * One skill row, classified. Order matters:
 *
 * 0. A line that is nothing but deck-building clauses → `done`, category `deck-building` (#1146).
 * 1. `open`, or a program that reads as nothing without saying so → `text-only`
 *    (the engine does nothing with the text; keyword lines, bracketed reminders
 *    and deck-building restrictions are empty on purpose and are not silent).
 * 2. A `review_flag`, a `compiler_diff`, or anything `runtimeSupportOfRow` says the
 *    engine cannot carry out (leaving out the out-of-date typed records,
 *    `recordContractGaps`, which are `needsRebuild`) → `incomplete`.
 * 3. A keyword or deck-building line with no program → `done`.
 * 4. `draft` → `unchecked`; `confirmed`/`corrected` → `done`.
 *
 * `runtimeSupportOfRow(...).unknown` ("play target depends on the board") is a
 * hint, not a gap.
 */
export function ruleHealth(row: HealthRow): RuleHealthReport {
  const records = new Set(recordContractGaps(row));
  const needsRebuild = records.size > 0;
  const support = runtimeSupportOfRow(row);
  const gaps = support.unsupported.filter((g) => !records.has(g));
  const hints = support.unknown.length ? ["Try it in play: whether it can play its target depends on the board."] : [];
  const unread = (row.unread ?? []).slice(0, 3).map((c) => `Not read: ${flatLine(String(c)).slice(0, 140)}`);
  const program = programOf(row);
  const skill = parseSkills(row.printed).find((s) => s.index === row.skillIndex % 10);
  const deck = skill ? deckBuildingOfSkill(skill) : null;
  const deckBuilding = deck ? deck.rules.filter((r) => r.kind !== "keyword").map((r) => r.words) : [];
  const report = (health: RuleHealth, reasons: string[], category: RuleHealthReport["category"] = null): RuleHealthReport => ({ health, reasons, hints, needsRebuild, category, deckBuilding });

  // A deck-building line is read from its printed text, whatever the stored status says. A person's Wrong flag
  // or a compiler difference on it is still shown through the normal path below.
  if (deck && isDeckBuildingLine(deck) && program.length === 0 && !row.reviewFlag && !row.compilerDiff) {
    return report("done", ["A deck-building rule: it says what a deck may hold, so the engine plays nothing for it. Deck legality checks it."], "deck-building");
  }

  if (row.status === "open") return report("text-only", ["The engine does nothing with this text yet.", ...unread]);

  // "This skill does nothing" is a person's answer (`blankRule`), not a silent blank.
  const ownerBlanked = row.status === "corrected" && row.source === "user";
  if (skill && !ownerBlanked && readsAsNothingSilently(skill, { ops: program, unsupported: row.unread ?? [] })) {
    return report("text-only", ["The rule reads as nothing, so the engine does nothing with this text."]);
  }

  const reasons: string[] = [];
  if (row.reviewFlag) reasons.push(`Marked wrong: ${flatLine(row.reviewFlag.split("\n")[0]).slice(0, 160)}`);
  if (row.compilerDiff) reasons.push("The compiler now reads this differently from the saved rule.");
  const unreadSet = new Set(row.unread ?? []);
  for (const g of gaps) reasons.push(unreadSet.has(g) ? `Not read: ${flatLine(g).slice(0, 140)}` : `The engine cannot carry this out: ${flatLine(g).slice(0, 160)}`);
  if (reasons.length) return report("incomplete", reasons);

  const onPurpose = row.kind.toLowerCase() === "keyword" || (!!skill && emptyOnPurpose(skill));
  if (onPurpose && program.length === 0) return report("done", ["The engine plays this line itself."]);
  if (row.status === "draft") return report("unchecked", ["Read by the compiler; nobody has checked it yet."]);
  return report("done", []);
}

/** A card takes its worst skill; a card with nothing to check is done. */
export function cardHealth(skills: readonly RuleHealth[]): RuleHealth {
  let worst = RULE_HEALTHS.length - 1;
  for (const h of skills) worst = Math.min(worst, RULE_HEALTHS.indexOf(h));
  return RULE_HEALTHS[worst];
}

/**
 * A card's printed skills against its rule rows: for each skill the card prints, the row that
 * answers it, or null when there is none (no row, or one whose stored `printed` line is no
 * longer the printed line, as `rulesFromRows` decides). Rows that answer no printed skill are
 * ignored, as games ignore them.
 */
export function currentRowsOf<T extends { side: string; skillIndex: number; printed: string }>(
  card: { skill: string | null | undefined; backSkill: string | null | undefined },
  rows: T[],
): { row: T | null }[] {
  const byKey = new Map(rows.map((r) => [`${r.side === "back" ? "back" : "front"}#${r.skillIndex}`, r]));
  return expectedSkills(card.skill, card.backSkill).map((e) => {
    const row = byKey.get(`${e.side}#${e.skillIndex}`);
    return { row: row && row.printed === e.printed ? row : null };
  });
}

/**
 * A card from its printed text and its rule rows. A printed skill with no current row is
 * `text-only`: the engine has nothing to play.
 */
export function cardHealthOf(
  card: { skill: string | null | undefined; backSkill: string | null | undefined },
  rows: (HealthRow & { side: string })[],
): { health: RuleHealth; missing: number; skills: RuleHealth[] } {
  const skills: RuleHealth[] = [];
  let missing = 0;
  for (const { row } of currentRowsOf(card, rows)) {
    if (!row) { missing++; skills.push("text-only"); continue; }
    skills.push(ruleHealth(row).health);
  }
  return { health: cardHealth(skills), missing, skills };
}

/**
 * The health of each given card, for a badge on the card page and the deck view: two queries
 * however many cards, the same classifier as the queue (`cardHealthOf`). Only original-game
 * cards the arena reads (no Fusion World, no energy markers) get an entry.
 */
export async function cardHealthsFor(db: Db, cardIds: string[]): Promise<Map<string, RuleHealth>> {
  const out = new Map<string, RuleHealth>();
  const ids = [...new Set(cardIds)];
  if (!ids.length) return out;
  const [cs, found] = await Promise.all([
    db.select({ id: cards.id, skill: cards.skill, backSkill: cards.backSkill }).from(cards).where(and(inArray(cards.id, ids), inArray(cards.game, ARENA_GAMES), REVIEWABLE_CARD)),
    db
      .select({
        cardId: cardRules.cardId, side: cardRules.side,
        kind: cardRules.kind, unread: cardRules.unread, ops: cardRules.ops, cost: cardRules.cost, trigger: cardRules.trigger, printed: cardRules.printed,
        status: cardRules.status, skillIndex: cardRules.skillIndex, source: cardRules.source, cond: cardRules.cond, combo: cardRules.combo,
        usage: cardRules.usage, validity: cardRules.validity, reviewFlag: cardRules.reviewFlag, compilerDiff: cardRules.compilerDiff,
      })
      .from(cardRules)
      .where(inArray(cardRules.cardId, ids)),
  ]);
  const byCard = new Map<string, typeof found>();
  for (const r of found) (byCard.get(r.cardId) ?? byCard.set(r.cardId, []).get(r.cardId)!).push(r);
  for (const c of cs) out.set(c.id, cardHealthOf(c, byCard.get(c.id) ?? []).health);
  return out;
}

export type HealthCounts = Record<RuleHealth, number> & { needsRebuild: number };
export const emptyHealthCounts = (): HealthCounts => ({ "text-only": 0, incomplete: 0, unchecked: 0, done: 0, needsRebuild: 0 });

/** Skills per health, over the whole table or over some cards (the header's numbers). */
export async function healthCounts(db: Db, cardIds?: string[]): Promise<HealthCounts> {
  const out = emptyHealthCounts();
  if (cardIds && !cardIds.length) return out;
  const found = await db
    .select({
      kind: cardRules.kind, unread: cardRules.unread, ops: cardRules.ops, cost: cardRules.cost, trigger: cardRules.trigger, printed: cardRules.printed,
      status: cardRules.status, skillIndex: cardRules.skillIndex, source: cardRules.source, cond: cardRules.cond, combo: cardRules.combo,
      usage: cardRules.usage, validity: cardRules.validity, reviewFlag: cardRules.reviewFlag, compilerDiff: cardRules.compilerDiff,
    })
    .from(cardRules)
    .innerJoin(cards, eq(cards.id, cardRules.cardId))
    .where(and(REVIEWABLE_CARD, cardIds ? inArray(cardRules.cardId, [...new Set(cardIds)]) : undefined));
  for (const r of found) {
    const h = ruleHealth(r);
    out[h.health]++;
    if (h.needsRebuild) out.needsRebuild++;
  }
  return out;
}

export interface RuleWrite {
  cardId: string;
  side: Side;
  skillIndex: number;
  ops: Op[];
  source: RuleSource;
  status: RuleStatus;
  explanation?: string | null;
  /**
   * The rest of the record, when the caller edited it — the text view on the
   * workbench does, the JSON view and "does nothing" do not. Left out, each
   * keeps what the row has; `cost: null` is a price being *removed* and is not
   * the same as leaving it out, so the three are read with `!== undefined`.
   */
  trigger?: string[];
  combo?: unknown;
  usage?: unknown;
  validity?: unknown;
  cost?: unknown;
  cond?: Cond | null;
  /** Needed when the row does not exist yet; a row that exists keeps its own. */
  printed?: string;
  kind?: string;
}

/**
 * Write a record against a skill. A person's or Claude's program replaces
 * whatever was there and bumps the version; `reads` is regenerated so the row
 * never says one thing and does another.
 */
export async function saveRule(db: Db, given: RuleWrite): Promise<RuleRow> {
  const existing = await db.query.cardRules.findFirst({ where: and(eq(cardRules.cardId, given.cardId), eq(cardRules.side, given.side), eq(cardRules.skillIndex, given.skillIndex)) });
  if (!existing && given.cost === undefined) {
    throw new Error(`${given.cardId} [${given.skillIndex}]: a new rule requires explicit typed payment; provide payment v1 or cost:null for intentional zero`);
  }
  const kind = existing?.kind ?? given.kind ?? "";
  // Every writer of a person's or Claude's program comes through here — the
  // workbench (after `readRule`), Explain to Claude (`clarify`) and the
  // referee's drafts (`ai/run`) — so this is the one gate none of them can
  // skip (3 Oct 2026, BT31-132). The WHEN is not re-read: a write that leaves
  // it out keeps the row's, and `readRule` has already checked one that is
  // handed in; nor is a price the write leaves out (the two writers that leave
  // it out check their program with no X bound, as this does). Filters are
  // stored whole (`completeFilters`).
  const w: RuleWrite = { ...given, ops: completeFilters(given.ops), cond: given.cond ? completeFilters(given.cond) : given.cond, ...(given.cost !== undefined ? { cost: completeFilters(given.cost === null ? zeroCostRecord() : given.cost) } : {}) };
  if (((w.cost ?? existing?.cost) as CostRecord | undefined)?.fusion !== undefined || parseSkills(existing?.printed ?? w.printed ?? "").some(isFusionSkill)) {
    const effectiveCost = (w.cost ?? existing?.cost) as CostRecord | undefined;
    const problem = kind !== "keyword" ? "contradictory recorded Union-Fusion identity (#907)" : fusionMaterialsProblem(effectiveCost?.fusion);
    if (problem) throw new Error(`${w.cardId} [${w.skillIndex}]: ${problem}`);
  }
  const evolveCost = (w.cost ?? existing?.cost) as CostRecord | undefined;
  if (evolveCost?.evolution !== undefined || parseSkills(existing?.printed ?? w.printed ?? "").some(needsEvolutionContract)) {
    const gap = evolutionIdentityProblem({ kind: kind as import("./types").Skill["kind"], price: costRecordProblem(evolveCost) ? undefined : priceFromCostRecord(evolveCost!) }, true);
    if (gap) throw new Error(`${w.cardId} [${w.skillIndex}]: ${gap}`);
  }
  const absorbCost = (w.cost ?? existing?.cost) as CostRecord | undefined;
  if (absorbCost?.absorb !== undefined || parseSkills(existing?.printed ?? w.printed ?? "").some(isAbsorbSkill)) {
    const gap = absorbIdentityProblem({ kind: kind as import("./types").Skill["kind"], price: costRecordProblem(absorbCost) ? undefined : priceFromCostRecord(absorbCost!), ops: programOf({ops: w.ops, cond: w.cond}) }, true);
    if (gap) throw new Error(`${w.cardId} [${w.skillIndex}]: ${gap}`);
  }
  const potaraCost = (w.cost ?? existing?.cost) as CostRecord | undefined;
  if (potaraCost?.potara !== undefined || parseSkills(existing?.printed ?? w.printed ?? "").some(isPotaraSkill)) {
    const gap = potaraIdentityProblem({kind: kind as import("./types").Skill["kind"], price: costRecordProblem(potaraCost) ? undefined : priceFromCostRecord(potaraCost!), ops: programOf({ops: w.ops, cond: w.cond})}, true);
    if (gap) throw new Error(`${w.cardId} [${w.skillIndex}]: ${gap}`);
  }
  const validity = w.validity !== undefined ? w.validity : existing?.validity;
  const validityGap = validityProblem(validity);
  if (validityGap) throw new Error(`${w.cardId} [${w.skillIndex}]: ${validityGap}`);
  const usage = w.usage !== undefined ? w.usage : existing?.usage;
  const usageGap = usageProblem(usage);
  if (usageGap) throw new Error(`${w.cardId} [${w.skillIndex}]: ${usageGap}`);
  const combo = w.combo !== undefined ? w.combo : existing?.combo;
  const comboGap = comboContractGap({ printed: existing?.printed ?? w.printed ?? "", trigger: w.trigger ?? existing?.trigger, combo });
  if (comboGap) throw new Error(`${w.cardId} [${w.skillIndex}]: ${comboGap}`);
  const bad = validateRule({ kind, trigger: w.trigger ?? existing?.trigger ?? [], combo, usage, validity, cost: w.cost ?? null, cond: w.cond ?? null, ops: w.ops }, kind);
  if (bad) throw new Error(`${w.cardId} [${w.skillIndex}]: refused to store a rule the engine cannot run — ${bad.message}`);
  // The hoisted condition is part of the program, so the reading has to be of
  // the whole thing; describing the steps alone dropped the IF from the line
  // the workbench shows back.
  const reads = describeScript(programOf({ ops: w.ops, cond: w.cond ?? null }), { permanent: kind.toLowerCase() === "permanent" });
  if (existing) {
    const [row] = await db
      .update(cardRules)
      .set({
        ops: w.ops,
        cond: w.cond ?? null,
        ...(w.trigger !== undefined ? { trigger: w.trigger } : {}),
      ...(w.combo !== undefined ? { combo: w.combo } : {}),
      ...(w.usage !== undefined ? { usage: w.usage } : {}),
        ...(w.validity !== undefined ? { validity: w.validity } : {}),
        ...(w.cost !== undefined ? { cost: w.cost } : {}),
        source: w.source,
        status: w.status,
        explanation: w.explanation ?? existing.explanation,
        reads,
        unread: [],
        compilerDiff: null,
        version: sql`${cardRules.version} + 1`,
        // A rule edited back to open/draft is no longer approved (it used to keep its stamp, and Progress counted it confirmed).
        confirmedAt: w.status === "confirmed" ? new Date() : w.status === "corrected" ? existing.confirmedAt : null,
        updatedAt: new Date(),
      })
      .where(and(eq(cardRules.id, existing.id), w.source === "claude" ? inArray(cardRules.status, ["open", "draft"]) : undefined))
      .returning();
    if (!row) throw new Error("An approved or corrected interpretation cannot be overwritten by a Claude draft. Reopen it first.");
    return row;
  }
  if (w.printed == null || w.kind == null) throw new Error(`no rule row for ${w.cardId} ${w.side} [${w.skillIndex}] and no printed line to create one from`);
  const [row] = await db
    .insert(cardRules)
    .values({
      cardId: w.cardId,
      side: w.side,
      skillIndex: w.skillIndex,
      printed: w.printed,
      kind: w.kind,
      ops: w.ops,
      cond: w.cond ?? null,
      ...(w.trigger !== undefined ? { trigger: w.trigger } : {}),
      ...(w.combo !== undefined ? { combo: w.combo } : {}),
      ...(w.usage !== undefined ? { usage: w.usage } : {}),
        ...(w.validity !== undefined ? { validity: w.validity } : {}),
      ...(w.cost !== undefined ? { cost: w.cost } : {}),
      source: w.source,
      status: w.status,
      explanation: w.explanation ?? null,
      reads,
    })
    .returning();
  return row;
}

/**
 * The work item for teaching the compiler this wording, and the owner's or
 * Claude's words about the card. Written beside the program rather than into
 * it: the program fixes this card, the brief fixes every card phrased the
 * same way, and only the second ends the problem.
 */
export async function setBrief(db: Db, id: number, brief: { brief?: string | null; explanation?: string | null }): Promise<void> {
  await db
    .update(cardRules)
    .set({ ...(brief.brief !== undefined ? { brief: brief.brief } : {}), ...(brief.explanation !== undefined ? { explanation: brief.explanation } : {}), updatedAt: new Date() })
    .where(eq(cardRules.id, id));
}

/**
 * This skill came up in a game and the referee had to rule on it. The count is
 * what sorts the same-wording groups: a wording that has actually been played is
 * worth teaching the compiler before one that has not.
 */
export async function markRuleSeen(db: Db, cardId: string, side: Side, skillIndex: number): Promise<void> {
  await db
    .update(cardRules)
    .set({ timesSeen: sql`${cardRules.timesSeen} + 1`, lastSeenAt: new Date() })
    .where(and(eq(cardRules.cardId, cardId), eq(cardRules.side, side), eq(cardRules.skillIndex, skillIndex)));
}

/**
 * A person accepted the draft as it stands. That also settles a "Wrong" they
 * marked earlier: the flag is cleared, or an approved rule would stay
 * `incomplete` for a mark its own approver has just answered.
 */
export async function confirmRule(db: Db, id: number): Promise<void> {
  const reviewable = db.select({ id: cards.id }).from(cards).where(REVIEWABLE_CARD);
  await db.update(cardRules).set({ status: "confirmed", confirmedAt: new Date(), reviewFlag: null, updatedAt: new Date() }).where(and(eq(cardRules.id, id), inArray(cardRules.cardId, reviewable)));
}

/** "Yes, it plays right now": the owner answers a flag on a rule that is already approved or corrected, without changing the rule. */
export async function clearReviewFlag(db: Db, id: number): Promise<void> {
  await db.update(cardRules).set({ reviewFlag: null, updatedAt: new Date() }).where(eq(cardRules.id, id));
}

/** Guided review uses the exact displayed record, including edits that do not bump version. */
export async function confirmReviewedRule(db: Db, id: number, expected: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [found] = await tx.select({ rule: cardRules }).from(cardRules).innerJoin(cards, eq(cards.id, cardRules.cardId)).where(and(REVIEWABLE_CARD, eq(cardRules.id, id))).for("update", { of: cardRules });
    const row = found?.rule;
    if (!row || !expected || reviewVersion(row) !== expected) throw new Error("This skill changed. Reload it and review the current interpretation before approving.");
    if (row.status !== "draft" || row.unread.length) throw new Error("Only a complete unapproved draft can be approved.");
    await confirmRule(tx as unknown as Db, id);
  });
}

/** Caller holds the proposal lock; this locks the rule against all normal saveRule UPDATEs. */
export async function saveReviewedExplanation(db: Db, id: number, expected: string, rule: Rule, explanation: string): Promise<RuleRow> {
  const [found] = await db.select({ rule: cardRules }).from(cardRules).innerJoin(cards, eq(cards.id, cardRules.cardId)).where(and(REVIEWABLE_CARD, eq(cardRules.id, id))).for("update", { of: cardRules });
  const row = found?.rule;
  if (!row || !expected || reviewVersion(row) !== expected) throw new Error("This skill changed. Request a new draft and review it before approving.");
  if (row.status === "confirmed" || row.status === "corrected") throw new Error("Reopen the approved interpretation before replacing it.");
  return saveRule(db, { cardId: row.cardId, side: row.side as Side, skillIndex: row.skillIndex,
    ...rule, source: "claude", status: "confirmed", explanation });
}

/**
 * Put a confirmed or corrected rule back in front of a person (issue #361, *Reopen for review*):
 * the same write `undoConfirmed` makes — status `draft`, the program and its version untouched — for one rule.
 */
export async function reopenRule(db: Db, id: number): Promise<void> {
  await db.update(cardRules).set({ status: "draft", confirmedAt: null, updatedAt: new Date() }).where(and(eq(cardRules.id, id), inArray(cardRules.status, ["confirmed", "corrected"])));
}

/** The skill does nothing the engine should carry out — an empty program, owned by the person. */
export async function blankRule(db: Db, id: number, explanation: string | null): Promise<void> {
  await db
    .update(cardRules)
    .set({ ops: [], reads: "", unread: [], status: "corrected", source: "user", explanation, compilerDiff: null, version: sql`${cardRules.version} + 1`, updatedAt: new Date() })
    .where(eq(cardRules.id, id));
}

/** The drafter's note on a row it may not change: what the compiler reads now. Null clears it. */
export async function setCompilerDiff(db: Db, id: number, diff: CompilerDiff | null): Promise<void> {
  await db.update(cardRules).set({ compilerDiff: diff, updatedAt: new Date() }).where(eq(cardRules.id, id));
}

/** The person yields to the compiler's newer reading: the row becomes the compiler's draft again. */
export async function takeCompilerDiff(db: Db, id: number): Promise<void> {
  const row = await db.query.cardRules.findFirst({ where: eq(cardRules.id, id) });
  const diff = row?.compilerDiff as CompilerDiff | null | undefined;
  if (!row || !diff) return;
  await db
    .update(cardRules)
    .set({
      ops: diff.ops,
      cond: null,
      unread: diff.unread,
      reads: describeScript(diff.ops, { permanent: row.kind.toLowerCase() === "permanent" }),
      status: diff.unread.length ? "open" : "draft",
      source: "compiler",
      compilerDiff: null,
      confirmedAt: null,
      version: sql`${cardRules.version} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(cardRules.id, id));
}

export type RuleCounts = Record<RuleStatus, number>;

/** How many rules stand in each state, over the whole table or over some cards. */
export async function countRules(db: Db, cardIds?: string[]): Promise<RuleCounts> {
  const out: RuleCounts = { open: 0, draft: 0, confirmed: 0, corrected: 0 };
  if (cardIds && !cardIds.length) return out;
  const rows = await db
    .select({ status: cardRules.status, n: sql<number>`count(*)::int` })
    .from(cardRules)
    .innerJoin(cards, eq(cards.id, cardRules.cardId))
    .where(and(REVIEWABLE_CARD, cardIds ? inArray(cardRules.cardId, [...new Set(cardIds)]) : undefined))
    .groupBy(cardRules.status);
  for (const r of rows) if (r.status in out) out[r.status as RuleStatus] = r.n;
  return out;
}

// ── reads for the workbench ─────────────────────────────────────────────────

export type WorklistRow = RuleRow & {
  name: string;
  setCode: string;
  /** The card is an X-cost one whose specified cost nobody entered (`specifiedCostUnknown`). Filled by `worklistPage`. */
  costUnknown?: boolean;
};

/** Every rule of the given cards, with the card's name and set beside it. */
export async function worklist(db: Db, cardIds: string[]): Promise<WorklistRow[]> {
  const ids = [...new Set(cardIds)];
  if (!ids.length) return [];
  const rows = await db
    .select({ rule: cardRules, name: cards.name, setCode: cards.setCode })
    .from(cardRules)
    .innerJoin(cards, eq(cards.id, cardRules.cardId))
    .where(and(REVIEWABLE_CARD, inArray(cardRules.cardId, ids)));
  return rows.map((r) => ({ ...r.rule, name: r.name, setCode: r.setCode }));
}

export async function ruleById(db: Db, id: number): Promise<WorklistRow | null> {
  const [r] = await db
    .select({ rule: cardRules, name: cards.name, setCode: cards.setCode })
    .from(cardRules)
    .innerJoin(cards, eq(cards.id, cardRules.cardId))
    .where(and(REVIEWABLE_CARD, eq(cardRules.id, id)));
  return r ? { ...r.rule, name: r.name, setCode: r.setCode } : null;
}

/** The other rules that share a pattern key: how many, and five to look at. */
export async function siblingsOf(db: Db, row: Pick<RuleRow, "id" | "pattern">): Promise<{ count: number; ids: string[] }> {
  if (!row.pattern) return { count: 0, ids: [] };
  const rows = await db
    .select({ cardId: cardRules.cardId })
    .from(cardRules)
    .innerJoin(cards, eq(cards.id, cardRules.cardId))
    .where(and(REVIEWABLE_CARD, eq(cardRules.pattern, row.pattern), ne(cardRules.id, row.id)));
  const ids = [...new Set(rows.map((r) => r.cardId))];
  return { count: ids.length, ids: ids.slice(0, 5) };
}


// ── the worklist over the whole catalog ─────────────────────────────────────

/**
 * Which rules a page is looking at. Everything here is a column except
 * `mechanism`, which is read off the first unread clause of an open row and
 * so is applied in TypeScript — over the 2,183 open rows, not the 13,563.
 */
export interface RuleFilter {
  /** Only these cards. Absent is the whole catalog; empty matches nothing. */
  cardIds?: string[];
  status?: RuleStatus;
  setCode?: string;
  source?: RuleSource;
  pattern?: string;
  mechanism?: string;
  /** Card name, card id or printed text. */
  q?: string;
  /** Exactly these rules: the scope "fired in game X" (`firedInGame`). */
  ruleIds?: number[];
  /** Only rules whose card the compiler now reads differently from what is stored (`compiler_diff`). */
  compilerDiff?: boolean;
  /** Only rules of an X-cost card with no specified cost entered. */
  costUnknown?: boolean;
}

/** `specifiedCostUnknown` in SQL: `def.energyCost === "X" && !def.specifiedCost`. */
const COST_UNKNOWN = sql<boolean>`(${cards.energyCost} = 'X' and coalesce(${cards.specifiedCost}, '') = '')`;

/** The filter as SQL, minus the parts that are not columns. `ignoreStatus` is for the segment counts. */
function rulePredicate(f: RuleFilter, ignoreStatus = false): SQL | undefined {
  const cs: (SQL | undefined)[] = [REVIEWABLE_CARD];
  if (f.cardIds) cs.push(f.cardIds.length ? inArray(cardRules.cardId, [...new Set(f.cardIds)]) : sql`false`);
  // A mechanism is a property of an open row, so asking for one asks for open rows.
  if (f.mechanism) cs.push(eq(cardRules.status, "open"));
  else if (f.status && !ignoreStatus) cs.push(eq(cardRules.status, f.status));
  if (f.setCode) cs.push(eq(cards.setCode, f.setCode));
  if (f.source) cs.push(eq(cardRules.source, f.source));
  if (f.ruleIds) cs.push(f.ruleIds.length ? inArray(cardRules.id, [...new Set(f.ruleIds)]) : sql`false`);
  if (f.compilerDiff) cs.push(isNotNull(cardRules.compilerDiff));
  if (f.costUnknown) cs.push(COST_UNKNOWN);
  if (f.pattern) cs.push(eq(cardRules.pattern, f.pattern));
  if (f.q?.trim()) {
    const like = `%${f.q.trim()}%`;
    cs.push(or(ilike(cards.name, like), ilike(cardRules.cardId, like), ilike(cardRules.printed, like)));
  }
  return cs.length ? and(...cs) : undefined;
}

/** Open first — those are the ones the engine plays as blank — then drafts, corrections, confirmed. */
const STATUS_ORDER = sql`case ${cardRules.status} when 'open' then 0 when 'draft' then 1 when 'corrected' then 2 else 3 end`;

export interface WorklistPage {
  rows: WorklistRow[];
  /** How many the filter matches, not how many are on this page. */
  total: number;
}

/**
 * One page of the worklist. The catalog is 13,563 rules, so the page asks the
 * database for the rows it shows and counts the rest.
 */
export async function worklistPage(db: Db, f: RuleFilter, page: { limit: number; offset: number }): Promise<WorklistPage> {
  const base = db
    .select({ rule: cardRules, name: cards.name, setCode: cards.setCode, costUnknown: COST_UNKNOWN })
    .from(cardRules)
    .innerJoin(cards, eq(cards.id, cardRules.cardId))
    .where(rulePredicate(f))
    .$dynamic();

  // A mechanism cannot be asked of the database: it is read off the clause the
  // compiler could not read. Open rows are few enough to sort here.
  if (f.mechanism) {
    const all = (await base.orderBy(STATUS_ORDER, asc(cardRules.cardId), asc(cardRules.skillIndex))).map((r) => ({ ...r.rule, name: r.name, setCode: r.setCode, costUnknown: r.costUnknown }));
    const mine = all.filter((r) => mechanismOf(r.unread[0] ?? "") === f.mechanism);
    return { rows: mine.slice(page.offset, page.offset + page.limit), total: mine.length };
  }

  const [rows, counted] = await Promise.all([
    base.orderBy(STATUS_ORDER, asc(cardRules.cardId), asc(cardRules.skillIndex)).limit(page.limit).offset(page.offset),
    db.select({ n: sql<number>`count(*)::int` }).from(cardRules).innerJoin(cards, eq(cards.id, cardRules.cardId)).where(rulePredicate(f)),
  ]);
  return { rows: rows.map((r) => ({ ...r.rule, name: r.name, setCode: r.setCode, costUnknown: r.costUnknown })), total: counted[0]?.n ?? 0 };
}

/** The segment row's numbers: the same filter, counted per status, with the status itself ignored. */
export async function statusCounts(db: Db, f: RuleFilter): Promise<RuleCounts> {
  const out: RuleCounts = { open: 0, draft: 0, confirmed: 0, corrected: 0 };
  if (f.mechanism) {
    const { total } = await worklistPage(db, f, { limit: 0, offset: 0 });
    out.open = total;
    return out;
  }
  const rows = await db
    .select({ status: cardRules.status, n: sql<number>`count(*)::int` })
    .from(cardRules)
    .innerJoin(cards, eq(cards.id, cardRules.cardId))
    .where(rulePredicate(f, true))
    .groupBy(cardRules.status);
  for (const r of rows) if (r.status in out) out[r.status as RuleStatus] = r.n;
  return out;
}

/** Every set that has rules, for the All-cards filter. */
export async function setsWithRules(db: Db): Promise<{ setCode: string; n: number }[]> {
  const rows = await db
    .select({ setCode: cards.setCode, n: sql<number>`count(*)::int` })
    .from(cardRules)
    .innerJoin(cards, eq(cards.id, cardRules.cardId))
    .where(REVIEWABLE_CARD)
    .groupBy(cards.setCode);
  return rows.sort((a, b) => a.setCode.localeCompare(b.setCode));
}

// ── confirming in bulk, and taking it back ──────────────────────────────────

/**
 * What one bulk confirm changed. Kept whole rather than as a filter, because
 * Undo has to put back exactly the rows it moved: re-running the filter would
 * also catch drafts confirmed since, and miss rows the filter no longer
 * matches. The version is what tells "still as I left it" from "edited since".
 */
export interface ConfirmBatch {
  at: string;
  rules: { id: number; version: number }[];
}

/**
 * Confirm every draft the filter matches — the page's "Confirm all drafts in
 * view", and the same-wording groups's "Confirm the pattern", which is the same
 * thing keyed by `pattern`.
 */
export async function confirmMatching(db: Db, f: RuleFilter): Promise<ConfirmBatch> {
  // An open row is not a draft, so a mechanism filter never confirms anything.
  if (f.mechanism) return { at: new Date().toISOString(), rules: [] };
  const matching = db
    .select({ id: cardRules.id })
    .from(cardRules)
    .innerJoin(cards, eq(cards.id, cardRules.cardId))
    .where(and(rulePredicate(f, true), eq(cardRules.status, "draft"), sql`jsonb_array_length(${cardRules.unread}) = 0`, sql`coalesce(${cardRules.explanation}, '') not like 'Wrong (phone review)%'`, sql`${cardRules.reviewFlag} is null`));
  const rules = await db
    .update(cardRules)
    .set({ status: "confirmed", confirmedAt: new Date(), updatedAt: new Date() })
    .where(inArray(cardRules.id, matching))
    .returning({ id: cardRules.id, version: cardRules.version });
  return { at: new Date().toISOString(), rules };
}

/**
 * Put a bulk confirm back. A row edited since — its version has moved, or it
 * is no longer confirmed — is left exactly as it is and counted, because the
 * undo of a mistake must not undo the work that followed it.
 */
export async function undoConfirmed(db: Db, batch: ConfirmBatch): Promise<{ reverted: number; kept: number }> {
  let reverted = 0;
  const byVersion = new Map<number, number[]>();
  for (const r of batch.rules) byVersion.set(r.version, [...(byVersion.get(r.version) ?? []), r.id]);
  for (const [version, ids] of byVersion) {
    for (let i = 0; i < ids.length; i += 500) {
      const back = await db
        .update(cardRules)
        .set({ status: "draft", confirmedAt: null, updatedAt: new Date() })
        .where(and(inArray(cardRules.id, ids.slice(i, i + 500)), eq(cardRules.status, "confirmed"), eq(cardRules.version, version)))
        .returning({ id: cardRules.id });
      reverted += back.length;
    }
  }
  return { reverted, kept: batch.rules.length - reverted };
}

// ── the same rules, grouped by the wording that produced them ───────────────

/**
 * One group of the same-wording groups: rules that came out of the compiler the same
 * way, or open rules whose text defeats it the same way.
 *
 * Two groupings, because the two halves are worked down differently. A draft
 * group is one compiler reading over many cards, and the question is whether
 * that reading is right — answered once for all of them. An open group is one
 * wording the compiler cannot read, and the question is what it would take;
 * grouping those by clause shape alone gives 1,654 groups for 2,183 rows, so
 * they are gathered by mechanism first and shape within it.
 */
export interface PatternGroup {
  /** What a link filters on: the pattern key, or the mechanism. */
  key: string;
  kind: "draft" | "open";
  /** The wording, or the shape of it. */
  label: string;
  mechanism?: string;
  rules: number;
  cards: number;
  /** What is on file about the wording: the work item, the owner's words, and whether a game has met it. */
  brief: string | null;
  explanation: string | null;
  timesSeen: number;
  examples: { id: number; cardId: string; name: string; printed: string; reads: string; unread: string[] }[];
}

/** Five examples a group shows, in card order. */
const EXAMPLES = 5;

/** What the groups below are made from: the columns a group and its examples show, never the program. */
interface LightRow {
  id: number;
  cardId: string;
  name: string;
  setCode: string;
  printed: string;
  reads: string;
  unread: string[];
  status: RuleStatus;
  source: RuleSource;
  pattern: string | null;
  skillIndex: number;
  hasDiff: boolean;
  costUnknown: boolean;
  timesSeen: number;
  brief: string | null;
  explanation: string | null;
}

async function lightRows(db: Db, f: RuleFilter): Promise<LightRow[]> {
  const rows = await db
    .select({
      id: cardRules.id,
      cardId: cardRules.cardId,
      name: cards.name,
      setCode: cards.setCode,
      printed: cardRules.printed,
      reads: cardRules.reads,
      unread: cardRules.unread,
      status: cardRules.status,
      source: cardRules.source,
      pattern: cardRules.pattern,
      skillIndex: cardRules.skillIndex,
      hasDiff: isNotNull(cardRules.compilerDiff),
      costUnknown: COST_UNKNOWN,
      timesSeen: cardRules.timesSeen,
      brief: cardRules.brief,
      explanation: cardRules.explanation,
    })
    .from(cardRules)
    .innerJoin(cards, eq(cards.id, cardRules.cardId))
    .where(rulePredicate(f))
    .orderBy(asc(cardRules.cardId), asc(cardRules.skillIndex));
  const mine = f.mechanism ? rows.filter((r) => mechanismOf(r.unread[0] ?? "") === f.mechanism) : rows;
  return mine as LightRow[];
}

const exampleOf = (r: LightRow): PatternGroup["examples"][number] => ({ id: r.id, cardId: r.cardId, name: r.name, printed: r.printed, reads: r.reads, unread: r.unread ?? [] });

/**
 * Rules grouped by the reading they came out as. Drafts by default, since one
 * reading covers 400 cards and confirming it once is how 11,375 drafts are
 * ever reviewed; a filter narrows it to a scope, a set or a state.
 */
export async function draftPatterns(db: Db, limit = 60, f: RuleFilter = {}): Promise<PatternGroup[]> {
  const filter: RuleFilter = { ...f, status: f.status ?? "draft" };
  const rows = (await lightRows(db, filter)).filter((r) => r.pattern);
  const byPattern = new Map<string, LightRow[]>();
  for (const r of rows) byPattern.set(r.pattern!, [...(byPattern.get(r.pattern!) ?? []), r]);
  return [...byPattern.entries()]
    .map(([pattern, rs]) => ({
      key: pattern,
      kind: "draft" as const,
      label: pattern,
      rules: rs.length,
      cards: new Set(rs.map((r) => r.cardId)).size,
      brief: rs.find((r) => r.brief)?.brief ?? null,
      explanation: rs.find((r) => r.explanation)?.explanation ?? null,
      timesSeen: rs.reduce((n, r) => n + r.timesSeen, 0),
      examples: rs.slice(0, EXAMPLES).map(exampleOf),
    }))
    .sort((a, b) => b.timesSeen - a.timesSeen || b.rules - a.rules || a.label.localeCompare(b.label))
    .slice(0, limit);
}

/** Open rules, grouped by what their first unread clause would need, then by its shape. */
export async function openPatterns(db: Db, f: RuleFilter = {}): Promise<PatternGroup[]> {
  const open = await lightRows(db, { ...f, status: "open" });
  const groups = new Map<string, PatternGroup & { cardIds: Set<string> }>();
  for (const r of open) {
    const clause = r.unread[0] ?? "";
    const mechanism = mechanismOf(clause);
    const label = clauseShape(clause);
    const key = `${mechanism}\u0000${label}`;
    const g = groups.get(key) ?? { key: mechanism, kind: "open" as const, label, mechanism, rules: 0, cards: 0, brief: null, explanation: null, timesSeen: 0, examples: [], cardIds: new Set<string>() };
    g.rules++;
    g.cardIds.add(r.cardId);
    g.timesSeen += r.timesSeen;
    g.brief ??= r.brief;
    g.explanation ??= r.explanation;
    if (g.examples.length < EXAMPLES) g.examples.push(exampleOf(r));
    groups.set(key, g);
  }
  return [...groups.values()]
    .map(({ cardIds, ...g }) => ({ ...g, cards: cardIds.size }))
    // A wording a game has actually met is the one worth teaching the compiler first.
    .sort((a, b) => b.timesSeen - a.timesSeen || b.rules - a.rules || a.label.localeCompare(b.label));
}

/**
 * The queue's *Group by reason* and *Group by set*. A group is exactly the
 * filter it links to, which is what lets "Confirm all in view" mean the same
 * thing on a group as on a list — so a rule with two reasons is in two groups.
 * `patch` is the query-string change that turns a group into that filter.
 */
export interface QueueGroup extends PatternGroup {
  patch: Record<string, string>;
  /** The filter a Confirm on this group is aimed at, beyond the page's own; null when a group must be looked at rather than waved through. */
  confirm: Partial<RuleFilter> | null;
}

export async function reasonGroups(db: Db, f: RuleFilter): Promise<QueueGroup[]> {
  const rows = await lightRows(db, f);
  const make = (key: string, label: string, hit: LightRow[], patch: Record<string, string>, confirm: Partial<RuleFilter> | null, mechanism?: string): QueueGroup | null =>
    hit.length
      ? {
          key,
          kind: "open",
          label,
          mechanism,
          rules: hit.length,
          cards: new Set(hit.map((r) => r.cardId)).size,
          brief: null,
          explanation: null,
          timesSeen: hit.reduce((n, r) => n + r.timesSeen, 0),
          examples: hit.slice(0, 3).map(exampleOf),
          patch,
          confirm,
        }
      : null;
  const out: (QueueGroup | null)[] = [
    // A compiler disagreement is a decision (take its reading or keep yours), not something to confirm in bulk.
    make("diff", "The compiler reads it differently now", rows.filter((r) => r.hasDiff), { reason: "diff" }, null),
    make("claude", "Claude drafted, not yet confirmed", rows.filter((r) => r.source === "claude" && r.status === "draft"), { source: "claude", state: "draft" }, { source: "claude" }),
    make("cost", "Specified cost unknown", rows.filter((r) => r.costUnknown), { reason: "cost" }, { costUnknown: true }),
  ];
  const byMech = new Map<string, LightRow[]>();
  for (const r of rows) {
    if (r.status !== "open") continue;
    const m = mechanismOf(r.unread[0] ?? "");
    byMech.set(m, [...(byMech.get(m) ?? []), r]);
  }
  for (const [key, hit] of [...byMech.entries()].sort((a, b) => b[1].length - a[1].length)) {
    out.push(make(`mech:${key}`, key === PHRASING_ONLY ? "Unread: phrasing only" : `Unread: ${key}`, hit, { mech: key, state: "open" }, null, key));
  }
  return out.filter((g): g is QueueGroup => g !== null);
}

/** *Group by set*: one group per set the filter reaches, in set order. */
export async function setGroups(db: Db, f: RuleFilter): Promise<QueueGroup[]> {
  const rows = await lightRows(db, f);
  const bySet = new Map<string, LightRow[]>();
  for (const r of rows) bySet.set(r.setCode, [...(bySet.get(r.setCode) ?? []), r]);
  return [...bySet.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([setCode, hit]) => ({
      key: `set:${setCode}`,
      kind: "open" as const,
      label: setCode,
      rules: hit.length,
      cards: new Set(hit.map((r) => r.cardId)).size,
      brief: null,
      explanation: null,
      timesSeen: 0,
      examples: hit.slice(0, 3).map(exampleOf),
      patch: { set: setCode },
      confirm: { setCode },
    }));
}

/** The rules behind some fired skills: `{ cardId, skillIndex }`, on either side of the card. */
export async function ruleIdsFor(db: Db, skills: { cardId: string; skillIndex: number }[]): Promise<number[]> {
  if (!skills.length) return [];
  const rows = await db
    .select({ id: cardRules.id, cardId: cardRules.cardId, skillIndex: cardRules.skillIndex })
    .from(cardRules)
    .where(inArray(cardRules.cardId, [...new Set(skills.map((s) => s.cardId))]));
  const want = new Set(skills.map((s) => `${s.cardId}\u0000${s.skillIndex}`));
  return rows.filter((r) => want.has(`${r.cardId}\u0000${r.skillIndex}`)).map((r) => r.id);
}

/**
 * The last probe of a rule, as the row keeps it: what was tried, what it
 * concluded, and the digest a re-probe compares. Written when a person
 * confirms the rule — that is the moment the answer is worth keeping — and by
 * `arena:probe --fill` for the rows confirmed before there were probes.
 */
export interface StoredProbe {
  scenario: string;
  outcome: string;
  digest: string;
  applied: string[];
  result: string[];
  assumptions: string[];
  /** ISO day, so the record can say when the answer was taken. */
  at: string;
  /**
   * Which engine this probe was run on. Always `rules` since #118; a probe
   * stored before that may say `legacy`, and `npm run arena:reprobe` (the
   * owner runs it) re-answers it on the rules engine.
   */
  engine: EngineId | "legacy";
}

export async function setProbe(db: Db, id: number, probe: StoredProbe): Promise<void> {
  await db.update(cardRules).set({ probe, updatedAt: new Date() }).where(eq(cardRules.id, id));
}

/**
 * The owner's word on what should happen, board by board (#470) — the
 * rule's own tests, written from Try it as each board is judged. A judgement
 * is about the card rather than one version of its rule, which is why it is
 * kept as it is made and survives the rule being edited: a row whose new
 * result no longer matches is how Try it turns red. `[]` clears them.
 */
export async function setExpectations(db: Db, id: number, expectations: unknown[]): Promise<void> {
  await db
    .update(cardRules)
    .set({ expectations: expectations.length ? expectations : null, updatedAt: new Date() })
    .where(eq(cardRules.id, id));
}

/** Every rule that carries a judgement, for `arena:reprobe`'s "expected X, now Y". */
export async function expectedRules(db: Db): Promise<WorklistRow[]> {
  const rows = await db
    .select({ rule: cardRules, name: cards.name, setCode: cards.setCode })
    .from(cardRules)
    .innerJoin(cards, eq(cards.id, cardRules.cardId))
    .where(isNotNull(cardRules.expectations));
  return rows.map((r) => ({ ...r.rule, name: r.name, setCode: r.setCode }));
}

/** Every rule that carries a probe, for `arena:reprobe`. */
export async function probedRules(db: Db): Promise<WorklistRow[]> {
  const rows = await db
    .select({ rule: cardRules, name: cards.name, setCode: cards.setCode })
    .from(cardRules)
    .innerJoin(cards, eq(cards.id, cardRules.cardId))
    .where(isNotNull(cardRules.probe));
  return rows.map((r) => ({ ...r.rule, name: r.name, setCode: r.setCode }));
}

// ── the Rules queue: cards, not rows ────────────────────────────────────────

/** Why an Incomplete card is incomplete, as a family the queue groups by (queue.ts `FAMILIES`). */
export type ReasonFamily = "wrong" | "combo" | "diff" | "fusion" | "review" | "other";
const FAMILY_ORDER: ReasonFamily[] = ["wrong", "combo", "diff", "fusion", "review", "other"];

/** One skill of a card in the queue: a dot. */
export interface QueueSkill {
  health: RuleHealth;
  /** The `card_rules` row; null where the card prints a skill that has no current row. */
  ruleId: number | null;
  family: ReasonFamily | null;
  /** "deck-building" for a line that is only a deck-building clause (`RuleHealthReport.category`). */
  category: RuleHealthReport["category"];
}

/** A card as the queue lists it: the card, its dots, and the reason of its worst skill. */
export interface QueueCard {
  cardId: string;
  name: string;
  setCode: string;
  cardType: string;
  colors: string[];
  imageUrl: string | null;
  health: RuleHealth;
  /** One per printed skill, front then back. */
  skills: QueueSkill[];
  /** The worst skill's reasons in plain words, then its hints; empty when there is nothing to say. */
  reasons: string[];
  family: ReasonFamily | null;
  /** "deck-building" for a card whose skills are done and at least one is a deck-building clause (#1146): its own label in the queue. */
  category: RuleHealthReport["category"];
  /** Every deck-building clause the card prints, in words (a mixed line's too). */
  deckBuilding: string[];
  /** The worst skill's row: where *Open ›* lands. */
  ruleId: number | null;
  source: RuleSource | null;
  wording: string | null;
  mechanism: string | null;
  /** Printed skills with no current row (the engine plays them as blank). */
  missing: number;
  /** Rows whose payment record predates #1066: `compiler` the compiler can rebuild, `protectedRows` a person approved, `other` a Claude or person draft. */
  rebuild: { rows: number; compiler: number; protectedRows: number; other: number };
  /** Skills holding a Claude draft the owner has not approved yet (`source = 'claude'`, `status = 'draft'`): the card is waiting on the owner, not on the compiler. */
  claudeFix: number;
}

/** The reason line a card with a waiting Claude fix leads with: it outranks an older audit flag or compiler note. */
export const CLAUDE_FIX_REASON = "Claude has proposed a fix: approve it or edit it.";

function familyOfRow(row: HealthRow, report: RuleHealthReport): ReasonFamily | null {
  if (report.health !== "incomplete") return null;
  const flag = row.reviewFlag ?? "";
  if (flag.startsWith(FLAG_PREFIX)) return "wrong";
  const gaps = report.reasons.join(" | ").toLowerCase();
  if (/combo/.test(gaps)) return "combo";
  if (row.compilerDiff) return "diff";
  if (/fusion/.test(gaps)) return "fusion";
  if (flag) return "review";
  return "other";
}

/** The key *Same wording* groups a row under: its compiler pattern, else the shape of its first unread clause. */
const wordingKey = (r: { pattern?: string | null; unread?: string[] | null }): string | null => r.pattern || (r.unread?.[0] ? clauseShape(r.unread[0]) : null);

/** A card from its catalog row and its `card_rules` rows (the light columns, plus `id`, `side` and `pattern`). Null for a card that prints nothing to check. */
export function classifyQueueCard(
  card: { id: string; name: string; setCode: string; cardType: string; colors: string[]; imageUrl: string | null; skill: string | null; backSkill: string | null },
  rows: (HealthRow & { id: number; side: string; pattern?: string | null })[],
): QueueCard | null {
  const matched = currentRowsOf(card, rows);
  if (matched.length === 0) return null;
  const rank = (h: RuleHealth) => RULE_HEALTHS.indexOf(h);
  const skills: QueueSkill[] = [];
  const rebuild = { rows: 0, compiler: 0, protectedRows: 0, other: 0 };
  let worst: { row: (typeof rows)[number]; report: RuleHealthReport } | null = null;
  let missing = 0;
  let claudeFix = 0;
  const deckBuilding: string[] = [];
  for (const { row } of matched) {
    if (row && row.source === "claude" && row.status === "draft") claudeFix++;
    if (!row) { missing++; skills.push({ health: "text-only", ruleId: null, family: null, category: null }); continue; }
    const report = ruleHealth(row);
    skills.push({ health: report.health, ruleId: row.id, family: familyOfRow(row, report), category: report.category });
    for (const w of report.deckBuilding) if (!deckBuilding.includes(w)) deckBuilding.push(w);
    if (report.needsRebuild) {
      rebuild.rows++;
      if (row.source === "compiler" && (row.status === "open" || row.status === "draft")) rebuild.compiler++;
      else if (row.status === "confirmed" || row.status === "corrected") rebuild.protectedRows++;
      else rebuild.other++;
    }
    if (!worst || rank(report.health) < rank(worst.report.health)) worst = { row, report };
  }
  const health = cardHealth(skills.map((s) => s.health));
  // A card's incomplete skills may have different reasons; the one that comes first in the queue's order names the card.
  const family = health === "incomplete" ? (FAMILY_ORDER.find((f) => skills.some((s) => s.health === "incomplete" && s.family === f)) ?? "other") : null;
  const w = worst?.row ?? null;
  const category: RuleHealthReport["category"] = health === "done" && skills.some((x) => x.category) ? "deck-building" : null;
  const base = worst ? [...worst.report.reasons.filter(Boolean), ...worst.report.hints] : ["No rule record for this skill yet."];
  const reasons = claudeFix > 0 && health !== "done" ? [CLAUDE_FIX_REASON, ...base] : base;
  return {
    cardId: card.id, name: card.name, setCode: card.setCode, cardType: card.cardType, colors: card.colors, imageUrl: card.imageUrl,
    health, skills,
    reasons: category ? [`Deck-building: ${deckBuilding.join("; ")}.`] : health === "done" && !worst?.report.hints.length ? [] : reasons,
    family,
    category,
    deckBuilding,
    ruleId: w?.id ?? null,
    source: (w?.source as RuleSource | undefined) ?? null,
    wording: w && health !== "done" ? wordingKey(w) : null,
    mechanism: w && w.status === "open" ? mechanismOf(w.unread?.[0] ?? "") : null,
    missing, rebuild, claudeFix,
  };
}

export interface CardQueueFilter {
  /** Only these cards. Absent is the whole catalog; empty matches nothing. */
  cardIds?: string[];
  setCode?: string;
  /** Card name, id or printed text. */
  q?: string;
}

/**
 * Every card the filter reaches, classified by `ruleHealth` in JS from the light columns. The
 * catalog scope loads all ~13,500 rule rows once per request, as `healthCounts(db)` does; the page
 * narrows and pages *after* classifying.
 */
export async function loadQueueCards(db: Db, f: CardQueueFilter = {}): Promise<QueueCard[]> {
  if (f.cardIds && !f.cardIds.length) return [];
  const q = f.q?.trim();
  const like = q ? `%${q}%` : null;
  const where = and(
    REVIEWABLE_CARD,
    eq(cards.game, DEFAULT_GAME),
    f.cardIds ? inArray(cards.id, [...new Set(f.cardIds)]) : undefined,
    f.setCode ? eq(cards.setCode, f.setCode) : undefined,
    like ? or(ilike(cards.name, like), ilike(cards.id, like), ilike(cards.skill, like), ilike(cards.backSkill, like)) : undefined,
  );
  const [cardRows, ruleRows] = await Promise.all([
    db
      .select({ id: cards.id, name: cards.name, setCode: cards.setCode, cardType: cards.cardType, colors: cards.colors, imageUrl: cards.imageUrl, skill: cards.skill, backSkill: cards.backSkill })
      .from(cards)
      .where(where),
    db
      .select({
        id: cardRules.id, cardId: cardRules.cardId, side: cardRules.side, pattern: cardRules.pattern,
        kind: cardRules.kind, unread: cardRules.unread, ops: cardRules.ops, cost: cardRules.cost, trigger: cardRules.trigger, printed: cardRules.printed,
        status: cardRules.status, skillIndex: cardRules.skillIndex, source: cardRules.source, cond: cardRules.cond, combo: cardRules.combo,
        usage: cardRules.usage, validity: cardRules.validity, reviewFlag: cardRules.reviewFlag, compilerDiff: cardRules.compilerDiff,
      })
      .from(cardRules)
      .innerJoin(cards, eq(cards.id, cardRules.cardId))
      .where(where),
  ]);
  const byCard = new Map<string, typeof ruleRows>();
  for (const r of ruleRows) (byCard.get(r.cardId) ?? byCard.set(r.cardId, []).get(r.cardId)!).push(r);
  const out: QueueCard[] = [];
  for (const c of cardRows) {
    const qc = classifyQueueCard(c, byCard.get(c.id) ?? []);
    if (qc) out.push(qc);
  }
  return out;
}

export interface CardQueueView extends CardQueueFilter {
  health?: RuleHealth | null;
  family?: ReasonFamily | "";
  source?: RuleSource | "";
  pattern?: string;
  mech?: string;
  /** How many decks run a card (or how early a game fired it): more first. */
  weight?: (cardId: string) => number;
}
export interface CardQueuePage {
  /** The page. */
  cards: QueueCard[];
  /** How many the view matches. */
  total: number;
  /** Every card in the scope (find and set applied), by health: the tabs' numbers. */
  counts: Record<RuleHealth, number>;
  /** Every card the view matches, in queue order: what Next and Previous walk. */
  matched: QueueCard[];
  /** The scope's cards, before the health and family narrowing: for the summary strip and the rebuild banner. */
  scope: QueueCard[];
}

/** The pure half of `cardQueuePage`: what a view keeps of classified cards, in queue order. */
export function viewOfQueue(cs: readonly QueueCard[], v: CardQueueView): QueueCard[] {
  const weight = v.weight ?? (() => 0);
  return cs
    .filter(
      (c) =>
        (!v.health || c.health === v.health) &&
        (!v.family || c.family === v.family) &&
        (!v.source || c.source === v.source) &&
        (!v.pattern || c.wording === v.pattern) &&
        (!v.mech || c.mechanism === v.mech),
    )
    .sort((a, b) => weight(b.cardId) - weight(a.cardId) || a.name.localeCompare(b.name) || a.cardId.localeCompare(b.cardId));
}

/** One page of the queue by card: load, classify, then narrow, order and page. */
export async function cardQueuePage(db: Db, view: CardQueueView, page: { limit: number; offset: number }): Promise<CardQueuePage> {
  const scope = await loadQueueCards(db, view);
  const counts: Record<RuleHealth, number> = { "text-only": 0, incomplete: 0, unchecked: 0, done: 0 };
  for (const c of scope) counts[c.health]++;
  const matched = viewOfQueue(scope, view);
  return { cards: matched.slice(page.offset, page.offset + page.limit), total: matched.length, counts, matched, scope };
}
