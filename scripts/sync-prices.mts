/**
 * `npm run sync:prices` — pull TCGplayer products + today's prices from
 * tcgcsv.com, plus the USD→EUR rate. Run the catalog sync first so products
 * have cards to match against.
 */
import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const { db } = await import("../src/db/index.ts");
const { syncPrices } = await import("../src/lib/pricing/tcgcsv.ts");
const { syncFx } = await import("../src/lib/pricing/fx.ts");
const { runSync } = await import("../src/lib/sync.ts");

const started = Date.now();
const fx = await runSync(db, "fx", () => syncFx(db));
console.log("FX:", fx);

const summary = await runSync(db, "prices", () =>
  syncPrices(db, {
    onProgress: (done, total, name) => console.log(`  [${done}/${total}] ${name}`),
  }),
);
console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s:`, summary);
process.exit(0);
