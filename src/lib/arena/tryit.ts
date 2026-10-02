/**
 * Try it → fix it (#470): the rule being built, tried on every board its
 * trigger and its condition call for, on the engine games use — with the
 * owner's word on what *should* happen kept beside it, and every wrong row
 * pointing at the block that made it wrong.
 *
 * Three things, all pure (no database; the server actions in
 * `app/arena/rules/probe-actions.ts` read the card and the stored judgements
 * and hand them here):
 *
 * - `tryRule` runs each board on `DEFAULT_ENGINE` *and* `FALLBACK_ENGINE`,
 *   traced (`probe-trace.ts`). Two engines disagreeing is an engine bug and
 *   not the owner's, so the row says so and shows both. `probe()`'s own
 *   default stays `FALLBACK_ENGINE`: nothing here is stored as a digest.
 * - A run's **effect**: `probe()` calls a skill "fired" once it announced
 *   itself, which is what a stored digest has always meant — but an [Auto]
 *   whose IF is false announces itself and then does nothing, and to the
 *   person asking "does it draw on 2 blue cards?" that is *nothing*. The
 *   traced run knows whether the IF held, so the row says `didNotFire`.
 * - `judge` holds a row against an `Expectation`, and `fixPath` names the
 *   block to open: the gate that stopped a rule that should have fired (WHEN,
 *   then COST, then IF), or the block behind the first wrong beat of one that
 *   fired and should not have, or did the wrong thing.
 */
import { DEFAULT_ENGINE, FALLBACK_ENGINE, type EngineId } from "./engines";
import type { Rule } from "./lang/ast";
import type { RulePath } from "./lang/path";
import { familyOf, probe, scenarioFromKey, scenariosFor, type ProbeOutcome, type ProbeRule, type ProbeRun, type ProbeScenario } from "./probe";
import { edgeNotes, knobSpecs, ruleViewOf } from "./probe-edges";
import { judge, type Expectation, type Gate, type TryResult, type TryRow, type TryRun } from "./tryit-judge";
export { fixPath, judge, ownLines, readExpectations, type Expectation, type Gate, type JudgedStatus, type TryResult, type TryRow, type TryRun } from "./tryit-judge";
import type { CardDef } from "./types";
import { describeCond } from "./vm/script";

// ── the rule being built, as the probe takes it ─────────────────────────────

/** A `Rule` from the builder as a `ProbeRule`: the IF wrapped back around the steps, as `programOf` does for a row. */
export function probeRuleOf(rule: Rule, def: CardDef, side: "front" | "back", skillIndex: number): ProbeRule {
  const cost = rule.cost as { condition?: ProbeRule["price"]["condition"]; program?: ProbeRule["price"]["ops"]; x?: ProbeRule["price"]["x"] } | null;
  return {
    def,
    side,
    skillIndex,
    kind: rule.kind,
    trigger: rule.trigger,
    ops: rule.cond ? [{ op: "if", cond: rule.cond, then: rule.ops }] : rule.ops,
    open: false,
    unread: [],
    price: { condition: cost?.condition ?? null, ops: cost?.program ?? null, ...(cost?.x ? { x: cost.x } : {}) },
    hoisted: rule.cond != null,
  };
}

// ── one board, two engines ──────────────────────────────────────────────────

const FIRES: ProbeOutcome[] = ["fired", "inForce"];

/** `probe()`'s answer, with an IF that did not hold read as the rule doing nothing. */
export function effective(run: ProbeRun): ProbeOutcome {
  return run.outcome === "fired" && run.trace?.held === false ? "didNotFire" : run.outcome;
}

/** The result in a few words, as the row shows it. */
export function headlineOf(outcome: ProbeOutcome, result: string[]): string {
  switch (outcome) {
    case "didNotFire":
      return "nothing";
    case "notOffered":
      return "not offered";
    case "blank":
      return "blank: no steps";
    case "noScenario":
      return "no board for this";
    case "error":
      return "the probe broke";
    case "inForce":
      return result[0] ?? "in force";
    case "fired": {
      const said = result.filter((r) => r !== "nothing changed on the board").map(shorten);
      return said.length ? said.slice(0, 2).join(", ") + (said.length > 2 ? ` +${said.length - 2}` : "") : "fires, changes nothing";
    }
  }
}

function shorten(line: string): string {
  let m = /^you draw (\d+) cards?$/.exec(line);
  if (m) return `draws ${m[1]}`;
  m = /^the opponent draws (\d+) cards?$/.exec(line);
  if (m) return `opponent draws ${m[1]}`;
  m = /^(.*) is KO'd$/.exec(line);
  if (m) return `KOs ${m[1]}`;
  m = /^you take (\d+) damage$/.exec(line);
  if (m) return `you take ${m[1]}`;
  m = /^the opponent takes (\d+) damage$/.exec(line);
  if (m) return `deals ${m[1]} damage`;
  return line;
}

function tryOn(rule: ProbeRule, scenario: ProbeScenario, engine: EngineId): { run: ProbeRun; tried: TryRun } {
  const run = probe(rule, scenario, engine, { trace: true });
  const outcome = effective(run);
  return {
    run,
    tried: {
      engine,
      outcome,
      fires: FIRES.includes(outcome),
      // A fired rule is headlined by what its own steps did, not by the turn
      // running on around it; a [Permanent]'s reading is the whole result.
      headline: headlineOf(outcome, outcome === "fired" && run.trace ? run.trace.result : run.result),
      applied: run.applied,
      appliedPaths: run.trace?.appliedPaths ?? run.applied.map(() => null),
      result: run.result,
      input: run.input,
      digest: run.digest,
    },
  };
}

/** The path of the skill's own announcement: the IF decides whether an answered skill does anything; with none, the WHEN. */
export const announcedBy = (rule: ProbeRule): RulePath => (ruleViewOf(rule).cond ? "cond" : "trigger");

/**
 * Every board: the ones the rule's trigger and condition call for, then the
 * kept ones (`extra`, a judged or changed board's key) that are not among
 * them. A kept key that names no board is dropped.
 */
export function boardsFor(rule: ProbeRule, extra: string[] = []): { scenario: ProbeScenario; generated: boolean }[] {
  const generated = scenariosFor(rule);
  const out = generated.map((scenario) => ({ scenario, generated: true }));
  const seen = new Set(generated.map((s) => s.key));
  for (const key of extra) {
    if (seen.has(key)) continue;
    const scenario = scenarioFromKey(rule, key);
    if (!scenario) continue;
    seen.add(key);
    out.push({ scenario, generated: false });
  }
  return out;
}

export function tryRule(rule: ProbeRule, extra: string[] = [], engines: { main: EngineId; other: EngineId } = { main: DEFAULT_ENGINE, other: FALLBACK_ENGINE }): TryResult {
  const view = ruleViewOf(rule);
  const rows = boardsFor(rule, extra).map(({ scenario, generated }): TryRow => {
    const main = tryOn(rule, scenario, engines.main);
    const other = tryOn(rule, scenario, engines.other);
    return {
      key: scenario.key,
      title: scenario.title,
      knobs: scenario.knobs ?? {},
      generated,
      rules: main.tried,
      legacy: other.tried,
      disagree: main.tried.outcome !== other.tried.outcome || main.tried.headline !== other.tried.headline,
      gate: main.tried.fires ? null : gateOf(rule, scenario, main.run, engines.main),
      announcedBy: announcedBy(rule),
    };
  });
  return { rows, knobs: knobSpecs(view), notes: edgeNotes(view), engines };
}

// ── what stopped it ─────────────────────────────────────────────────────────

/**
 * The gate a rule that did not fire was stopped at, in the order the rule is
 * read: WHEN (the moment never came, or the move was never offered), COST
 * (the price could not be paid — the same board with the price taken off
 * fires), IF (the skill answered and its condition did not hold).
 */
export function gateOf(rule: ProbeRule, scenario: ProbeScenario, run: ProbeRun, engine: EngineId): Gate {
  const view = ruleViewOf(rule);
  const notes = run.trace?.notes ?? [];
  if (run.outcome === "blank") return { path: "ops", clause: "THEN", reasons: ["the rule has no steps, so there is nothing to do"] };
  if (run.outcome === "error") return { path: "trigger", clause: "WHEN", reasons: run.result };
  if (run.outcome === "fired" && run.trace?.held === false && view.cond) {
    return { path: "cond", clause: "IF", reasons: [`the skill answered, and its IF did not hold: ${describeCond(view.cond)}`, ...notes] };
  }
  const refusals = run.outcome === "notOffered" ? run.result : [];
  // A board of another family than the rule's (kept from before its WHEN was
  // changed) is a moment this rule does not answer to at all.
  if (familyOf(rule) !== scenario.family) {
    return {
      path: "trigger",
      clause: "WHEN",
      reasons: [...refusals, ...notes, `this rule answers to ${whenWords(rule)}, and on this board ${scenario.title.charAt(0).toLowerCase()}${scenario.title.slice(1)} — the moment never came`],
    };
  }
  const hasPrice = !!(rule.price.condition || rule.price.ops?.length);
  if (hasPrice) {
    const free = probe({ ...rule, price: { condition: null, ops: null } }, scenario, engine, { trace: true });
    if (FIRES.includes(effective(free))) {
      const condOnly = rule.price.condition ? probe({ ...rule, price: { ...rule.price, condition: null } }, scenario, engine, { trace: true }) : null;
      const byCond = !!condOnly && FIRES.includes(effective(condOnly));
      return {
        path: byCond ? "cost.condition" : "cost",
        clause: "COST",
        reasons: [...refusals, ...notes, byCond && rule.price.condition ? `the price's condition did not hold: ${describeCond(rule.price.condition)}` : "the price could not be paid — the same board with no price fires"],
      };
    }
  }
  return {
    path: "trigger",
    clause: "WHEN",
    reasons: refusals.length || notes.length ? [...refusals, ...notes] : [`this rule answers to ${whenWords(rule)}, and the moment never came on this board`],
  };
}

function whenWords(rule: ProbeRule): string {
  return rule.trigger.length ? rule.trigger.map((t) => `"${t}"`).join(" or ") : `[${rule.kind}]`;
}

// ── arena:reprobe ───────────────────────────────────────────────────────────

/**
 * The stored judgements a rule no longer meets, as `arena:reprobe` prints
 * them: "expected fired, now didNotFire". Separate from a digest moving —
 * that says a result changed; this says it is now *wrong*, by the owner's
 * own word. Each is re-run on the engine it was judged on.
 */
export function expectationMismatches(rule: ProbeRule, expectations: Expectation[]): { key: string; title: string; line: string }[] {
  const out: { key: string; title: string; line: string }[] = [];
  for (const e of expectations) {
    const scenario = scenarioFromKey(rule, e.key);
    if (!scenario) {
      out.push({ key: e.key, title: e.title, line: `the board "${e.key}" can no longer be staged` });
      continue;
    }
    const { tried } = tryOn(rule, scenario, e.engine);
    const status = judge(tried, e);
    if (status === "match") continue;
    const nowFires = tried.fires ? "fired" : tried.outcome;
    const line =
      tried.fires !== (e.expected === "fired")
        ? `expected ${e.expected}, now ${nowFires}`
        : status === "rejudge"
          ? `judged "something else" (${e.note ?? "no note"}), and it now says "${tried.headline}" — judge it again`
          : `expected "${e.headline}", now "${tried.headline}"`;
    out.push({ key: e.key, title: e.title, line });
  }
  return out;
}
