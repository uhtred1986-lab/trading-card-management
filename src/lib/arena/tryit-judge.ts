/**
 * Try it's rows and the owner's word on them (#470) — the half of
 * `tryit.ts` the browser needs, with no engine in it: the shapes a try comes
 * back in, an `Expectation`, `judge` (green, red, or look again) and
 * `fixPath` (which block a wrong row opens). Pure and client-safe.
 */
import type { EngineId } from "./engines";
import type { RulePath } from "./lang/path";
import type { KnobSpec } from "./probe-edges";
import type { BoardKnobs, ProbeOutcome } from "./probe-types";

/** What a run did, in the terms a person judges: did the rule *do* it, and what. */
export interface TryRun {
  engine: EngineId;
  /** `probe()`'s outcome, except that an [Auto] whose IF was false is `didNotFire` (`tryit.ts`). */
  outcome: ProbeOutcome;
  fires: boolean;
  /** One line: "draws 1", "nothing", "not offered". */
  headline: string;
  applied: string[];
  /** The block behind each line of `applied` (`ProbeTrace`). */
  appliedPaths: (RulePath | null)[];
  result: string[];
  input: string[];
  digest: string;
}

export interface Gate {
  /** The block that stopped it, in the order a rule is read: WHEN, COST, IF. */
  path: RulePath;
  clause: "WHEN" | "COST" | "IF" | "THEN";
  /** The engine's own sentences first (refusals, its notes), then the probe's. */
  reasons: string[];
}

export interface TryRow {
  key: string;
  title: string;
  knobs: BoardKnobs;
  /** One of the boards this rule's trigger and condition call for, rather than one kept from a judgement or a change. */
  generated: boolean;
  /** On the engine games use (`DEFAULT_ENGINE`). */
  rules: TryRun;
  /** On the legacy engine, beside it. */
  legacy: TryRun;
  /** The two engines concluded differently: an engine bug, shown as such. */
  disagree: boolean;
  /** When the rule did not fire on the engine games use: what stopped it. */
  gate: Gate | null;
  /** The block behind the rule's own announcement — `cond`, or `trigger` with no IF. */
  announcedBy: RulePath;
}

export interface TryResult {
  rows: TryRow[];
  /** What the "Change board" sheet can set, from the rule's own conditions. */
  knobs: KnobSpec[];
  /** "no edge board for leaderColor yet". */
  notes: string[];
  engines: { main: EngineId; other: EngineId };
}

/**
 * What should happen on one board, as the owner said it — kept with the rule
 * as one of its tests (`card_rules.expectations`). The board is its key: the
 * base board and the knobs (`attack|cond=3`), so it is staged again exactly.
 */
export interface Expectation {
  key: string;
  /** The board in words when it was judged, for a reader who no longer has the rule that made it. */
  title: string;
  /** Should the rule do something here. */
  expected: "fired" | "didNotFire";
  /**
   * "right": what happened was what should — `headline` and `applied` are
   * that run's, and a later run that says otherwise is wrong. "wrong": it
   * should have gone the other way (`expected`), or done something else
   * (`other`, with `note`, `headline` being the result that was rejected).
   */
  verdict: "right" | "wrong";
  other?: boolean;
  headline?: string;
  /** The rule's own lines of that run (`applied` with a path), for finding the first beat that differs later. */
  applied?: string[];
  note?: string;
  /** The engine it was judged on: `DEFAULT_ENGINE`. */
  engine: EngineId;
  at: string;
}

export type JudgedStatus = "match" | "mismatch" | "rejudge";

/** A row held against the owner's word: green, red, or changed since a "something else" and wanting a fresh look. */
export function judge(run: Pick<TryRun, "fires" | "headline">, e: Expectation): JudgedStatus {
  if (run.fires !== (e.expected === "fired")) return "mismatch";
  if (e.verdict === "right" && e.headline !== undefined && run.headline !== e.headline) return "mismatch";
  if (e.verdict === "wrong" && e.other) return run.headline === e.headline ? "mismatch" : "rejudge";
  return "match";
}

/** The rule's own lines of a run: the ones a block made, the announcement included. */
export function ownLines(run: Pick<TryRun, "applied" | "appliedPaths">): { line: string; path: RulePath }[] {
  return run.applied.flatMap((line, i) => (run.appliedPaths[i] ? [{ line, path: run.appliedPaths[i] as RulePath }] : []));
}

/**
 * The block to open for a wrong row:
 * - it should have fired and did not → the gate that stopped it;
 * - it fired and should not have → the block behind its announcement (`cond`, or `trigger`);
 * - it did the wrong thing → the block behind the first of its lines that
 *   differs from the run judged right, or the first step that did anything.
 */
export function fixPath(row: TryRow, e: Expectation | null): RulePath {
  const run = row.rules;
  const shouldFire = e ? e.expected === "fired" : !run.fires;
  if (shouldFire && !run.fires) return row.gate?.path ?? "trigger";
  if (!shouldFire && run.fires) return row.announcedBy;
  const mine = ownLines(run);
  if (e?.applied?.length) {
    for (let i = 0; i < mine.length; i++) if (mine[i].line !== e.applied[i]) return mine[i].path;
  }
  return mine.find((b) => b.path !== "cond" && b.path !== "trigger")?.path ?? "ops";
}

/** A stored `expectations` value, checked: whatever is not an expectation is dropped, and a board judged twice keeps the later word. */
export function readExpectations(raw: unknown): Expectation[] {
  if (!Array.isArray(raw)) return [];
  const byKey = new Map<string, Expectation>();
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    if (typeof o.key !== "string" || !o.key || o.key.length > 400) continue;
    if (o.expected !== "fired" && o.expected !== "didNotFire") continue;
    if (o.verdict !== "right" && o.verdict !== "wrong") continue;
    const str = (v: unknown, max = 500) => (typeof v === "string" ? v.slice(0, max) : undefined);
    const applied = Array.isArray(o.applied) ? o.applied.filter((l): l is string => typeof l === "string").slice(0, 60) : undefined;
    const headline = str(o.headline);
    const note = str(o.note, 1000);
    byKey.set(o.key, {
      key: o.key,
      title: str(o.title) ?? o.key,
      expected: o.expected,
      verdict: o.verdict,
      ...(o.other === true ? { other: true } : {}),
      ...(headline !== undefined ? { headline } : {}),
      ...(applied ? { applied } : {}),
      ...(note ? { note } : {}),
      engine: o.engine === "legacy" ? "legacy" : "rules",
      at: str(o.at, 40) ?? new Date().toISOString(),
    });
  }
  return [...byKey.values()];
}
