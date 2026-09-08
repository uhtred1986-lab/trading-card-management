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

// `--no-review` keeps Claude out of it; `--budget N` caps the calls (0 = unlimited).
const args = process.argv.slice(2);
const budgetArg = args.indexOf("--budget");
const opts = { review: !args.includes("--no-review"), ...(budgetArg >= 0 ? { budget: Number(args[budgetArg + 1]) } : {}) };

console.log("Fetching deckplanet catalog…");
const started = Date.now();
const summary = await runSync(db, "catalog", () => syncCatalog(db, opts));
console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s:`, summary);
console.log(`${summary.cardsNew ?? 0} cards new · ${summary.cardsChanged ?? 0} text changed · ${summary.drafted ?? 0} drafted · ${summary.reviewed ?? 0} reviewed by Claude · ${summary.stillOpen ?? 0} still open`);
process.exit(0);
