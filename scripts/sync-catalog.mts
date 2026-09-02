/**
 * `npm run sync:catalog` — pull the full card catalog from deckplanet into the
 * database pointed at by DATABASE_URL. Safe to re-run; upserts everything.
 */
import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const { db } = await import("../src/db/index.ts");
const { syncCatalog } = await import("../src/lib/catalog/deckplanet.ts");
const { runSync } = await import("../src/lib/sync.ts");

console.log("Fetching deckplanet catalog…");
const started = Date.now();
const summary = await runSync(db, "catalog", () => syncCatalog(db));
console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s:`, summary);
process.exit(0);
