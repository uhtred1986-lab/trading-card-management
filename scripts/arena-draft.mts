/**
 * `npm run arena:draft [-- --card BT16-042] [--set BT16] [--only-open] [--review] [--budget N]`
 *
 * `--review` then asks Claude for every skill still open among the drafted
 * cards — the full-catalog backfill is `--review --budget 0` (unlimited), run
 * by hand and never by the sync, which has its own budget setting.
 *
 * Compile the catalog offline and write the drafts into `card_rules`. Rows a
 * person owns are never rewritten — the compiler's newer reading lands beside
 * them as `compiler_diff`. Prints the state of the table afterwards: per
 * status, per set, and for the cards in the owner's decks.
 */
import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const { db } = await import("../src/db/index.ts");
const { catalogIds, draftCards, reviewOpenRules } = await import("../src/lib/arena/draft.ts");
const { countRules } = await import("../src/lib/arena/rules-store.ts");
const { cardRules, decks } = await import("../src/db/schema.ts");
const { deckInputFor } = await import("../src/lib/arena/load.ts");

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? "") : null;
};
const card = flag("--card");
const set = flag("--set");
const onlyOpen = args.includes("--only-open");
const review = args.includes("--review");
const budgetArg = flag("--budget");

const ids = card ? [card] : await catalogIds(db, set ?? undefined);
console.log(`Drafting ${ids.length} card${ids.length === 1 ? "" : "s"}${set ? ` of ${set}` : ""}${onlyOpen ? ", open rows only" : ""}…`);
const started = Date.now();
const s = await draftCards(db, ids, { onlyOpen });
console.log(`${s.cards} cards · ${s.skills} skills · ${s.inserted} inserted · ${s.updated} compiler rows updated · ${s.diffed} person-owned rows now differ from the compiler · ${s.agreed} agree again · ${s.deleted} stale rows removed · ${((Date.now() - started) / 1000).toFixed(1)} s`);
if (review) {
  const r = await reviewOpenRules(db, ids, budgetArg == null ? {} : { budget: Number(budgetArg) });
  console.log(`Claude asked about ${r.asked} open skill${r.asked === 1 ? "" : "s"} · ${r.drafted} drafted · ${r.failed} failed (see arena:feedback) · ${r.stillOpen} still open`);
}

const line = (label: string, c: Record<string, number>) => {
  const total = c.open + c.draft + c.confirmed + c.corrected;
  const readable = total ? Math.round(((total - c.open) / total) * 1000) / 10 : 0;
  console.log(`${label.padEnd(28)} ${String(total).padStart(6)} rules · ${String(c.open).padStart(5)} open · ${String(c.draft).padStart(5)} draft · ${String(c.confirmed).padStart(5)} confirmed · ${String(c.corrected).padStart(5)} corrected · ${readable} % readable`);
};

console.log();
line("catalog", await countRules(db));

const all = await db.select({ cardId: cardRules.cardId, status: cardRules.status }).from(cardRules);
const bySet = new Map<string, Record<string, number>>();
for (const r of all) {
  const code = r.cardId.split("-")[0];
  const c = bySet.get(code) ?? { open: 0, draft: 0, confirmed: 0, corrected: 0 };
  c[r.status] = (c[r.status] ?? 0) + 1;
  bySet.set(code, c);
}
for (const [code, c] of [...bySet.entries()].sort((a, b) => a[0].localeCompare(b[0]))) line(`  ${code}`, c);

const inDecks = new Set<string>();
for (const d of await db.select({ id: decks.id }).from(decks)) {
  const input = await deckInputFor(db, d.id);
  if (!input || input.input.main.length < 50) continue;
  for (const id of input.cardIds) inDecks.add(id);
}
console.log();
line("the owner's decks", await countRules(db, [...inDecks]));
process.exit(0);
