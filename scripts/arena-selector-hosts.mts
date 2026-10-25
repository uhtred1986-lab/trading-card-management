/**
 * Which stored rule rows still move a card "under" a host named by a selector rather than a choice (#1123), so a
 * compiler change's production refresh has its id list. Read-only: it writes the ids, nothing to the database.
 *
 *   tsx --env-file-if-exists=.env.local scripts/arena-selector-hosts.mts [--out ids.txt] [--extra "BT4-018#0,…"]
 *
 * Before #1123 the compiler emitted `moveTo … under {sel}` for "place a card under a {Spirit Bomb}"; the VM took the
 * first match, and the activation planner refused such a price. Now a counted host is a `choose`, so these rows need
 * a rebuild. Feed the output to `npm run arena:refresh-ids -- --ids-file ids.txt` (dry run first, then `--apply`).
 * Covers the price program (`cost.program`) and the effect ops, at any depth.
 */
import fs from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { cardRules, cards as cardsTable } from "../src/db/schema";
import { DEFAULT_GAME } from "../src/lib/catalog/games";
import { hasSelectorHost, ruleIdOf } from "./lib/selector-hosts";

const args = process.argv.slice(2);
const value = (n: string) => { const i = args.indexOf(n); return i < 0 ? undefined : args[i + 1]; };

const dbsIds = new Set((await db.select({ id: cardsTable.id }).from(cardsTable).where(eq(cardsTable.game, DEFAULT_GAME))).map((r) => r.id));
const stored = (await db.select().from(cardRules)).filter((r) => dbsIds.has(r.cardId));
const hits = stored.filter((r) => hasSelectorHost(r.ops) || hasSelectorHost((r.cost as { program?: unknown } | null)?.program));

const byStatus = new Map<string, number>();
for (const r of hits) byStatus.set(`${r.source}/${r.status}`, (byStatus.get(`${r.source}/${r.status}`) ?? 0) + 1);
console.log(`${hits.length} stored row(s) with a selector host under a moveTo:`);
for (const r of hits) console.log(`  ${ruleIdOf(r).padEnd(16)} ${r.kind.padEnd(16)} ${r.source}/${r.status}`);
console.log(`by source/status: ${JSON.stringify(Object.fromEntries(byStatus))}`);

const extra = (value("--extra") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const ids = [...new Set([...hits.map(ruleIdOf), ...extra])];
const out = value("--out");
if (out) {
  fs.writeFileSync(out, ids.join("\n") + "\n");
  console.log(`wrote ${ids.length} id(s) to ${out}`);
} else console.log(ids.join(","));
process.exit(0);
