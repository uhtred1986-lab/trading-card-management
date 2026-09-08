import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { rows as rowsOf } from "../src/db/rows";
import { probe, ruleFrom, scenariosFor } from "../src/lib/arena/probe";
import { defsForCards } from "../src/lib/arena/load";
import { programOf, worklist } from "../src/lib/arena/rules-store";
const want = process.argv[2] ?? "activateMain";
const ids = rowsOf<{ id: string }>(await db.execute(sql`select card_id as id from card_rules group by card_id order by min(id) limit 900`)).map((r) => r.id);
const rules = await worklist(db, ids);
const defs = await defsForCards(db, [...new Set(rules.map((r) => r.cardId))]);
const seen = new Map<string, number>();
const examples: string[] = [];
for (const row of rules) {
  const def = defs[row.cardId];
  if (!def) continue;
  const rule = ruleFrom(row, def, programOf(row));
  const sc = scenariosFor(rule)[0];
  if (sc.family !== want) continue;
  const run = probe(rule, sc);
  if (run.outcome !== "notOffered") continue;
  const key = (run.result[0] ?? "—").replace(/^[^ ]+ /, "").slice(0, 60);
  seen.set(key, (seen.get(key) ?? 0) + 1);
  if (examples.length < 8) examples.push(`${row.cardId} [${row.kind}] ${row.printed.slice(0, 90)}\n      → ${run.result.join(" | ")}`);
}
console.log([...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => `${String(n).padStart(4)}  ${k}`).join("\n"));
console.log("\n" + examples.join("\n"));
process.exit(0);
