/**
 * `npx tsx scripts/pokemon-ct-check.mts <PKM-card-id | blueprint-id> [--name "Charizard ex"] [--number 006]`
 *
 * Proves, by hand, whether TCGdex's `thirdParty.cardtrader` number is a CardTrader blueprint id
 * (docs/pokemon/plan.md §3 step 1). READ-ONLY: one `marketplace/products?blueprint_id=` call per
 * blueprint, plus one `blueprints/export?expansion_id=` call per blueprint to read the collector
 * number (the products carry a name and an expansion, not the number). Nothing is written, nothing
 * is bought, and no stored row changes.
 *
 * Needs `CARDTRADER_API_TOKEN` and `CARDTRADER_ENABLED=true` in the environment (the owner's own
 * token; nobody else runs this). With a stored card id it also needs `DATABASE_URL` and reads the
 * card's names, collector number and the CardTrader id of each print from the database. With a bare
 * blueprint id it reports what CardTrader says, and compares to `--name` / `--number` when given.
 *
 * Exit code 0 when every blueprint checked matches, 1 when one does not (or returns nothing).
 */
import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const { blueprintsForExpansion, cardTraderEnabled, productsForBlueprint } = await import("../src/lib/marketplace/cardtrader.ts");
const { blueprintNumber, nameMatches, normalNumber, pokemonCardInfo } = await import("../src/lib/marketplace/cardtrader-pokemon.ts");

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const target = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
if (!target) {
  console.error('Usage: tsx scripts/pokemon-ct-check.mts <PKM-card-id | blueprint-id> [--name "Charizard ex"] [--number 006]');
  process.exit(2);
}
if (!cardTraderEnabled()) {
  console.error("Set CARDTRADER_API_TOKEN and CARDTRADER_ENABLED=true (your own token) to run this check.");
  process.exit(2);
}

interface Check {
  label: string;
  blueprintId: number;
  names: string[];
  number: string | null;
}
const checks: Check[] = [];

if (/^\d+$/.test(target)) {
  const name = flag("name");
  checks.push({ label: `blueprint ${target}`, blueprintId: Number(target), names: name ? [name] : [], number: normalNumber(flag("number") ?? null) });
} else {
  const { db } = await import("../src/db/index.ts");
  const { cardPrints } = await import("../src/db/schema.ts");
  const { eq } = await import("drizzle-orm");
  const info = await pokemonCardInfo(db, target);
  if (!info) {
    console.error(`${target} is not a stored Pokémon card.`);
    process.exit(2);
  }
  const prints = await db.select({ id: cardPrints.id, bp: cardPrints.ctBlueprintId }).from(cardPrints).where(eq(cardPrints.cardId, target));
  for (const p of prints) {
    if (p.bp == null) console.log(`${p.id}: no CardTrader id stored (the cart falls back to expansion and number)`);
    else checks.push({ label: p.id, blueprintId: p.bp, names: info.names, number: info.number });
  }
}

let failed = 0;
for (const c of checks) {
  console.log(`\n${c.label}  ->  CardTrader blueprint ${c.blueprintId}`);
  let products;
  try {
    products = Object.values(await productsForBlueprint(c.blueprintId)).flat();
  } catch (err) {
    console.log(`  products call failed: ${err instanceof Error ? err.message : String(err)}`);
    failed++;
    continue;
  }
  if (products.length === 0) {
    console.log("  no products listed (the id may be wrong, or nobody sells this card right now)");
    failed++;
    continue;
  }
  const first = products[0];
  const nameOk = c.names.length ? nameMatches(first.name_en, c.names) : null;
  console.log(`  ${products.length} listing(s); CardTrader names it "${first.name_en}"${first.expansion ? ` in "${first.expansion.name_en ?? first.expansion.code}" (expansion ${first.expansion.id})` : ""}`);
  console.log(`  name:   ${nameOk === null ? "not compared (no --name)" : nameOk ? `MATCH (${c.names.join(" / ")})` : `MISMATCH, expected ${c.names.join(" / ")}`}`);

  let numberOk: boolean | null = null;
  if (first.expansion) {
    const bp = (await blueprintsForExpansion(first.expansion.id)).find((b) => b.id === c.blueprintId);
    const ctNumber = bp ? blueprintNumber(bp) : null;
    if (!bp) console.log(`  number: blueprint ${c.blueprintId} is not in expansion ${first.expansion.id}'s export`);
    else if (c.number == null) console.log(`  number: CardTrader says ${ctNumber ?? "none"} (nothing to compare; pass --number)`);
    else {
      numberOk = ctNumber === c.number;
      console.log(`  number: ${numberOk ? "MATCH" : "MISMATCH"} (CardTrader ${ctNumber ?? "none"}, expected ${c.number})`);
    }
  } else console.log("  number: the products carry no expansion, so the collector number could not be read");

  if (nameOk === false || numberOk === false) failed++;
}

console.log(failed ? `\n${failed} of ${checks.length} did not match: TCGdex's id is not a usable blueprint id for them (the cart falls back to expansion and number).` : `\nAll ${checks.length} checked match.`);
process.exit(failed ? 1 : 0);
