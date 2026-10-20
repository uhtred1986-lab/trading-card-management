/**
 * `npm run rules:batch -- --next 30 [--skip ID,...] [--owner NAME] [--out FILE] [--batch "batch 6"] [--include-listed [ID,...]]`
 *
 * READ-ONLY. Picks the next N unchecked cards of the owner's decks exactly as the rules-review receipts
 * describe (docs/arena-backlog/evidence/**), and writes a receipt skeleton (stdout, or --out FILE).
 * Needs this app's DATABASE_URL (`node scripts/card-db-env.mjs <file>`, docs/agent-brief.md) and refuses
 * any database without public.card_rules. Procedure: .claude/skills/rules-review-batch/SKILL.md.
 */
import path from "node:path";
import fs from "node:fs";
import { assertThisAppsDb, listedIds, renderReceipt, selectBatch } from "./lib/rules-batch.mts";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 || argv[i + 1] === undefined || argv[i + 1].startsWith("--") ? undefined : argv[i + 1];
};
const has = (name: string) => argv.includes(`--${name}`);

const next = Number(flag("next") ?? 30);
if (!Number.isInteger(next) || next < 1) {
  console.error('Usage: npm run rules:batch -- --next 30 [--skip ID,...] [--owner NAME] [--out FILE] [--batch "batch 6"] [--include-listed [ID,...]]');
  process.exit(1);
}
const out = flag("out");
const evidence = path.resolve("docs/arena-backlog/evidence");
const includeArg = flag("include-listed");
const includeListed = !has("include-listed") ? false : includeArg ? new Set(includeArg.split(",").map((s) => s.trim().toUpperCase())) : true;

const { db } = await import("../src/db/index.ts");
try {
  await assertThisAppsDb(db);
  const sel = await selectBatch(db, {
    owner: flag("owner"),
    next,
    skip: (flag("skip") ?? "").split(","),
    listed: listedIds(evidence, out),
    includeListed,
  });
  const text = renderReceipt(sel, { date: new Date().toISOString().slice(0, 10), batch: flag("batch") ?? "batch N", next });
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, text);
    console.error(`${sel.cardIds.length} cards, ${sel.rows.length} rows -> ${out} (${sel.skippedListed.length} skipped as listed, ${sel.queue.length} left in the queue)`);
  } else {
    console.log(text);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
}
process.exit(process.exitCode ?? 0);
