/**
 * `npm run sync:meta` — pull regional results from deckplanet into the
 * database pointed at by DATABASE_URL. Safe to re-run; only fetches deck
 * pages for placements not already stored.
 */
import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const { db } = await import("../src/db/index.ts");
const { syncMeta } = await import("../src/lib/meta/sync.ts");
const { runSync } = await import("../src/lib/sync.ts");

console.log("Fetching deckplanet regional results…");
const started = Date.now();
const summary = await runSync(db, "meta", () => syncMeta(db));
console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s:`, summary);
process.exit(0);
