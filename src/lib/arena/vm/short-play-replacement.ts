/** R434: obsolete ordinary incoming-card moves must not replay a replaced play. */
import type { Op, Script, ScriptFrame } from "./script";
import { replaceAs, programProblem } from "./script-schema";
import { rebuildScope } from "./skill-play-scope";
export interface PlayReplacementDescriptor { version: 1; to: "drop" | "deck" | "hand"; position?: "bottom" }
function visit(value: unknown, consume: (op: Op) => void): void {
  if (Array.isArray(value)) { value.forEach(item => visit(item, consume)); return; }
  if (!value || typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  if (typeof object.op === "string") {
    const raw = object as Op;
    const op = raw.op === "replace" && raw.event === "play" && !programProblem([raw]) ? replaceAs(raw) : raw;
    consume(op);
    // A play replacement's internal move is its substitute, not a later
    // ordinary move in the skill. The macro and primitive have one meaning.
    if (op.op === "resolvingPlay") return;
  }
  Object.values(object).forEach(item => visit(item, consume));
}
function ordinary(op: Op): op is Extract<Op, { op: "moveTo" }> {
  const sel = (op as { target?: { sel?: Record<string, unknown> } }).target?.sel;
  return op.op === "moveTo" && !!sel && sel.special === "resolving" && Object.keys(sel).length === 1;
}
export function playReplacementDescriptor(ops: readonly Op[]): PlayReplacementDescriptor | undefined {
  if (programProblem(ops)) return undefined;
  const replacements: PlayReplacementDescriptor[] = []; let hasOrdinary = false;
  visit(ops, raw => {
    if (ordinary(raw)) hasOrdinary = true;
    const op = replaceAs(raw);
    if (op.op === "resolvingPlay" && (op.instead === "drop" || op.instead === "hand" || op.instead === "deck" && op.position === "bottom")) replacements.push({ version: 1, to: op.instead, ...(op.position === "bottom" ? { position: "bottom" as const } : {}) });
  });
  return !hasOrdinary && replacements.length === 1 ? replacements[0] : undefined;
}
/** Printed wording detects stale stored data only; execution uses the typed descriptor. */
export function shortPlayReplacementGap(row: { kind: string; printed: string; ops: unknown }): string | null {
  const text = row.printed.replace(/[’‘]/g, "'").toLowerCase();
  if (row.kind !== "counter:play" || !/\b(?:battle|unison|extra) card (?:being played|(?:that )?your opponent is playing)\b/.test(text) || !/\b(?:place (?:it|that card) (?:in(?:to)? its owner's drop(?: area)?|at the bottom of its owner's deck)|return (?:it|that card) to its owner's hand) instead(?=[.,]|$)/.test(text)) return null;
  let stale = false;
  visit(row.ops, op => { if (ordinary(op) && (op.to === "drop" || op.to === "hand" || op.to === "deck" && op.position === "bottom")) stale = true; });
  return stale ? "rebuild the stored short-form Counter play replacement" : null;
}
export function requirePlayReplacement(frame: ScriptFrame, source: Script | undefined): void {
  const descriptor = source?.playReplacement;
  if ((!frame.counterPlay && frame.skillKind !== "counter") || source?.kind !== "counter:play" || descriptor === undefined) return;
  if (!descriptor || typeof descriptor !== "object" || descriptor.version !== 1 || !["drop", "deck", "hand"].includes(descriptor.to) || descriptor.to === "deck" && descriptor.position !== "bottom") rebuildScope("rebuild this saved Counter replacement descriptor");
  let stale = false;
  visit(frame.ops, op => { if (ordinary(op) && op.to === descriptor.to && (op.position ?? undefined) === descriptor.position) stale = true; });
  if (stale) rebuildScope("rebuild this saved Counter play replacement");
}
