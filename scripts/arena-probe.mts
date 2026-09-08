/**
 * Run the probe over stored rules.
 *
 *   npm run arena:probe -- [--card BT16-042] [--set BT16] [--all] [--limit 500] [--fill]
 *   npm run arena:reprobe -- [--write]
 *
 * The sweep tries every matching rule on its default board and reports what
 * came back — how many fired, how many played as blank, how many the engine
 * would not offer, and every one that broke, with its card id. `--fill` keeps
 * the run on rules that are confirmed and carry none, which is how the rows
 * confirmed before phase 3 join the regression suite.
 *
 * `--reprobe` is the other half: re-run the probe each row already carries and
 * list the ones whose answer moved. That is the point of storing it — after an
 * engine change, the rules that now play differently are a list rather than a
 * hope. `--write` accepts the new answers.
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { rows as rowsOf } from "../src/db/rows";
import { probe, ruleFrom, scenariosFor, type ProbeRun } from "../src/lib/arena/probe";
import { defsForCards } from "../src/lib/arena/load";
import { probedRules, programOf, setProbe, worklist, type StoredProbe, type WorklistRow } from "../src/lib/arena/rules-store";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const limit = Number(value("limit") ?? 0) || 0;

/** The rules to sweep: one card, one set, the arena's own decks, or the catalog. */
async function pick(): Promise<WorklistRow[]> {
  const card = value("card");
  const set = value("set");
  if (card) return worklist(db, [card]);
  if (set) {
    const ids = rowsOf<{ id: string }>(await db.execute(sql`select id from cards where set_code = ${set} order by id`)).map((r) => r.id);
    return worklist(db, ids);
  }
  if (flag("all")) {
    const ids = rowsOf<{ id: string }>(await db.execute(sql`select distinct card_id as id from card_rules order by 1`)).map((r) => r.id);
    return worklist(db, ids);
  }
  const ids = rowsOf<{ id: string }>(
    await db.execute(sql`select distinct c.id from cards c join deck_cards dc on dc.card_id = c.id join decks d on d.id = dc.deck_id where d.game = 'dbs'`),
  ).map((r) => r.id);
  return worklist(db, ids);
}

/** Every rule with the card it is printed on, ready to try. */
async function runnable(rules: WorklistRow[]) {
  const defs = await defsForCards(db, [...new Set(rules.map((r) => r.cardId))]);
  return rules.flatMap((row) => {
    const def = defs[row.cardId];
    if (!def) return [];
    return [{ row, rule: ruleFrom(row, def, programOf(row)) }];
  });
}

const stored = (run: ProbeRun): StoredProbe => ({
  scenario: run.scenario.key,
  outcome: run.outcome,
  digest: run.digest,
  applied: run.applied,
  result: run.result,
  assumptions: run.assumptions,
  at: new Date().toISOString(),
});

async function sweep(): Promise<number> {
  const chosen = await pick();
  const rules = (await runnable(chosen)).slice(0, limit || undefined);
  console.log(`probing ${rules.length} rule${rules.length === 1 ? "" : "s"}…`);
  const counts = new Map<string, number>();
  const families = new Map<string, number>();
  // Outcome by family: a family where nothing is ever offered is a staging
  // problem, and the totals alone would not say which one.
  const cross = new Map<string, number>();
  const broke: string[] = [];
  const unsaid: string[] = [];
  let filled = 0;
  const started = Date.now();
  for (const { row, rule } of rules) {
    const scenario = scenariosFor(rule)[0];
    const run = probe(rule, scenario);
    counts.set(run.outcome, (counts.get(run.outcome) ?? 0) + 1);
    families.set(scenario.family, (families.get(scenario.family) ?? 0) + 1);
    cross.set(`${scenario.family}\t${run.outcome}`, (cross.get(`${scenario.family}\t${run.outcome}`) ?? 0) + 1);
    // A refusal the engine cannot word is worth counting on its own: the
    // workflow spec's promise is that every move off the menu has a reason.
    if (run.outcome === "notOffered" && run.result.some((r) => /gives no reason/.test(r))) unsaid.push(`${row.cardId} [${row.kind} ${row.skillIndex}]`);
    if (run.outcome === "error") broke.push(`${row.cardId} [${row.side} ${row.skillIndex}] ${scenario.key}: ${run.result.join(" ")}`);
    if (flag("card") || rules.length <= 20) console.log(`  ${row.cardId} [${row.kind}] ${scenario.key} → ${run.outcome}: ${run.result.join(" | ") || "—"}`);
    if (flag("fill") && row.status === "confirmed" && !row.probe) {
      await setProbe(db, row.id, stored(run));
      filled++;
    }
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n${rules.length} rules in ${secs} s`);
  console.log([...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · "));
  console.log([...families.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · "));
  console.log("");
  for (const [family] of [...families.entries()].sort((a, b) => b[1] - a[1])) {
    const mine = [...cross.entries()].filter(([k]) => k.startsWith(`${family}\t`)).sort((a, b) => b[1] - a[1]);
    console.log(`  ${family.padEnd(15)} ${mine.map(([k, n]) => `${k.split("\t")[1]} ${n}`).join(" · ")}`);
  }
  if (filled) console.log(`${filled} confirmed rules now carry a probe`);
  if (unsaid.length) console.log(`\n${unsaid.length} refusals with no reason at all (the engine offers the move nowhere and explains it nowhere), e.g. ${unsaid.slice(0, 5).join(", ")}`);
  if (broke.length) {
    console.log(`\n${broke.length} broke:`);
    for (const line of broke.slice(0, 40)) console.log(`  ${line}`);
  }
  return broke.length;
}

async function reprobe(): Promise<number> {
  const rules = await runnable(await probedRules(db));
  console.log(`re-running ${rules.length} stored probe${rules.length === 1 ? "" : "s"}…`);
  const moved: string[] = [];
  for (const { row, rule } of rules) {
    const was = row.probe as StoredProbe;
    const scenario = scenariosFor(rule).find((s) => s.key === was.scenario);
    if (!scenario) {
      moved.push(`${row.cardId} [${row.skillIndex}]: the board "${was.scenario}" is not one this rule has any more`);
      continue;
    }
    const run = probe(rule, scenario);
    if (run.digest === was.digest) continue;
    moved.push(`${row.cardId} [${row.skillIndex}] ${scenario.key}: ${was.outcome} → ${run.outcome}\n    was: ${was.result.join(" | ") || "—"}\n    now: ${run.result.join(" | ") || "—"}`);
    if (flag("write")) await setProbe(db, row.id, stored(run));
  }
  console.log(moved.length ? `\n${moved.length} of ${rules.length} answer differently:\n${moved.map((m) => `  ${m}`).join("\n")}` : `\nall ${rules.length} still answer the same way`);
  if (moved.length && !flag("write")) console.log("\n(--write to accept the new answers)");
  return 0;
}

const failures = flag("reprobe") ? await reprobe() : await sweep();
// A rule the probe could not run at all is the one thing a sweep must not
// pass over quietly; everything else it reports is an answer, not a fault.
process.exit(failures ? 1 : 0);
