/**
 * Which block of a rule made which beat of a probe (#470).
 *
 * The probe's words stay what they were — `applied` is the board's own
 * narration — but a beat on its own does not say whether the IF, the price or
 * the third step of the THEN put it there, and "Fix" has to open one block.
 * This is how a traced probe knows, without the engine knowing anything about
 * it: the program handed to the engine is the rule's own, with a **marker** — a
 * `note` op carrying a path — after every step. A `note` is the one op that
 * does nothing but log (`stepScript`'s `case "note"`), on both engines, through
 * the one interpreter they share; so the events between two markers are the
 * step the second one names, and a run with markers concludes exactly what
 * the same run without them does (`scripts/verify/tryit.ts` holds every probe
 * fixture to that, digest for digest).
 *
 * Markers go *after* a step rather than before it so that every list still
 * starts with its own first step — the shapes the engines read structurally
 * (`redirectOf`, `replaceResolvingPlay`, `chooseMode`'s empty second option)
 * are all about a list's head or its length, never its tail — and only into
 * the lists that run as steps of this skill: `if`'s two branches, `may`,
 * `delay` and the modes of `chooseMode`. A `replace`'s substitute and an
 * `altCost`'s price are read as shapes before they ever run, and are left as
 * written; their beats belong to the step that holds them. The two-step
 * spellings `stepScript` folds back into one (`discardAs`, `comboFromAs`) get
 * one marker after the pair, never one between.
 *
 * Paths are `RulePath`s (`lang/path.ts`): relative to the rule as the
 * language holds it, not to the program the engine runs — the hoisted IF is
 * `cond` and its steps are `ops[i]`, though the engine sees them wrapped back
 * into one `if`.
 *
 * Pure. Only `probe.ts` calls `instrument`; only the probe reads the markers.
 */
import type { Op } from "./vm/script";
import { comboFromAs, discardAs } from "./vm/script-schema";
import { childPath, formatPath, type PathStep, type RulePath } from "./lang/path";

/** What a marker's text starts with. Never a word a card prints. */
export const MARKER = "\u0000probe-path:";

export const isMarker = (text: string): boolean => text.startsWith(MARKER);
export const markerPath = (text: string): RulePath => text.slice(MARKER.length);

const mark = (path: RulePath): Op => ({ op: "note", text: `${MARKER}${path}` });

/**
 * A program with a marker after each step. `base` is the rule path of the
 * list itself (`ops`, `ops[2].then`, `cost.program`).
 */
export function instrument(ops: Op[], base: RulePath): Op[] {
  const out: Op[] = [];
  for (let i = 0; i < ops.length; ) {
    const span = Math.max(discardAs(ops, i)?.span ?? 1, comboFromAs(ops, i)?.span ?? 1);
    for (let k = 0; k < span; k++) out.push(nested(ops[i + k], childPath(base, i + k)));
    out.push(mark(childPath(base, i)));
    i += span;
  }
  return out;
}

function nested(op: Op, at: RulePath): Op {
  switch (op.op) {
    case "if":
      return { ...op, then: instrument(op.then, childPath(at, "then")), ...(op.else ? { else: instrument(op.else, childPath(at, "else")) } : {}) };
    case "may":
    case "delay":
      return { ...op, ops: instrument(op.ops, childPath(at, "ops")) };
    case "chooseMode":
      return { ...op, modes: op.modes.map((m, k) => ({ ...m, ops: instrument(m.ops, childPath(at, "modes", k, "ops")) })) };
    default:
      return op;
  }
}

/**
 * The rule's effect as the engine runs it, instrumented. A hoisted rule's
 * program is `[if cond then ops]`: the `if` is the rule's `cond` and its
 * branch is the rule's `ops`, so the branch is marked as `ops[i]` and the
 * wrapper gets no marker of its own — once its branch is spliced in, the
 * last step's marker is where the rule ends.
 */
export function instrumentProgram(program: Op[], hoisted: boolean): Op[] {
  if (hoisted && program.length === 1 && program[0].op === "if" && !program[0].else) {
    return [{ ...program[0], then: instrument(program[0].then, "ops") }];
  }
  return instrument(program, "ops");
}

/** Whether the program the probe was handed is the hoisted shape: one `if`, no `else`. */
export function looksHoisted(program: Op[]): boolean {
  return program.length === 1 && program[0].op === "if" && !program[0].else;
}

/**
 * Was the rule's IF true on this board? Read off the markers: any step of
 * the branch ran. Null when the rule has no hoisted condition, or when the
 * branch is empty and there is nothing to read.
 */
export function heldFrom(reached: RulePath[], hasCond: boolean, branchLength: number): boolean | null {
  if (!hasCond || branchLength === 0) return null;
  return reached.some((p) => p.startsWith("ops["));
}

/** `["ops", 2]` style steps for a path built by hand. */
export const pathOf = (...steps: PathStep[]): RulePath => formatPath(steps);
