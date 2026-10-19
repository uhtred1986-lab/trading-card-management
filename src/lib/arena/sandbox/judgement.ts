/**
 * "Played right / wrong" in the sandbox: the same `Expectation` Try it keeps
 * for a board (`TryItPanel`'s ✓ and ✗), built from the Try it row of the
 * board that was played — so `arena:reprobe` holds the rule to it exactly as
 * it does a judgement made on the panel.
 */
import { ownLines, type Expectation, type TryRow } from "../tryit-judge";

export type Should = "fire" | "notFire" | "other";

/** Keep (or replace) the judgement on one board among the stored ones. */
export function withJudgement(stored: Expectation[], row: TryRow, verdict: "right" | { should: Should; note: string }, at = new Date().toISOString()): Expectation[] {
  const next: Expectation =
    verdict === "right"
      ? {
          key: row.key,
          title: row.title,
          expected: row.rules.fires ? "fired" : "didNotFire",
          verdict: "right",
          headline: row.rules.headline,
          applied: ownLines(row.rules).map((b) => b.line),
          engine: row.rules.engine,
          at,
        }
      : {
          key: row.key,
          title: row.title,
          expected: verdict.should === "notFire" ? "didNotFire" : "fired",
          verdict: "wrong",
          ...(verdict.should === "other" ? { other: true, headline: row.rules.headline } : {}),
          ...(verdict.note.trim() ? { note: verdict.note.trim() } : {}),
          engine: row.rules.engine,
          at,
        };
  return [...stored.filter((e) => e.key !== row.key), next];
}
