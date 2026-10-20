/**
 * Which stored [Activate] price programs the activation payment planner still refuses, and why (#1096).
 *
 * Reads `card_rules` (read-only, no writes), takes every non-open [Activate] row of a DBS card whose record carries
 * an action price (`cost.program`), and runs it through `activationPriceProblem` — the static half of
 * `canPayPriceProgram`, the one that decides whether a price is ever offered whatever the board (affordability
 * needs a board and is not asked here). Prints the count per refusal reason, the price shapes behind each, and
 * the cards of any row still refused for the place-under reason, which after #1096 should be none unless the host
 * or the moved card is not one the price chose.
 *
 * `npm run db:check` first if unsure the shell reaches this app's database. Run by the owner or coordinator
 * with this app's pooled URL (docs/agent-brief.md → "When the owner asks for live data"); an agent session
 * stays off Neon.
 *
 * `tsx --env-file-if-exists=.env.local scripts/arena-price-refusals.mts [--cards]`   (--cards lists every refused row)
 */
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { cardRules, cards as cardsTable } from "../src/db/schema";
import { DEFAULT_GAME } from "../src/lib/catalog/games";
import type { CostRecord, Op } from "../src/lib/arena/vm/script";
import { activationPriceProblem } from "../src/lib/arena/vm/activation-price-support";

const listAll = process.argv.slice(2).includes("--cards");
const dbsIds = new Set((await db.select({ id: cardsTable.id }).from(cardsTable).where(eq(cardsTable.game, DEFAULT_GAME))).map((r) => r.id));
const rows = (await db.select().from(cardRules)).filter((r) => dbsIds.has(r.cardId) && r.status !== "open" && r.kind.startsWith("activate"));

const priced = rows.flatMap((r) => {
  const program = (r.cost as CostRecord | null)?.program;
  return program?.length ? [{ row: r, program: program as Op[] }] : [];
});

/** The ops of a price, in order, as one word: "choose + moveTo(under)". */
const shape = (program: Op[]) => program.map((o) => (o.op === "moveTo" ? `moveTo(${o.to})` : o.op)).join(" + ");

type Entry = (typeof priced)[number];
const byReason = new Map<string, { shapes: Map<string, number>; rows: Entry[] }>();
let payable = 0;
let placeUnderPayable = 0;
for (const entry of priced) {
  const problem = activationPriceProblem(entry.program);
  if (!problem) {
    payable++;
    if (entry.program.some((o) => o.op === "moveTo" && o.to === "under")) placeUnderPayable++;
    continue;
  }
  const bucket = byReason.get(problem) ?? { shapes: new Map<string, number>(), rows: [] as Entry[] };
  bucket.rows.push(entry);
  const s = shape(entry.program);
  bucket.shapes.set(s, (bucket.shapes.get(s) ?? 0) + 1);
  byReason.set(problem, bucket);
}

console.log(`${rows.length} non-open [Activate] rows · ${priced.length} with an action price · ${payable} pass the static planner (${placeUnderPayable} of them place a card under another) · ${priced.length - payable} refused\n`);
for (const [reason, bucket] of [...byReason].sort((a, b) => b[1].rows.length - a[1].rows.length)) {
  console.log(`${String(bucket.rows.length).padStart(4)}  ${reason}`);
  for (const [s, n] of [...bucket.shapes].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`        ${String(n).padStart(3)} × ${s}`);
  const cards = [...new Set(bucket.rows.map((e) => `${e.row.cardId}#${e.row.skillIndex}`))];
  console.log(`        cards: ${(listAll ? cards : cards.slice(0, 12)).join(", ")}${!listAll && cards.length > 12 ? ` … (+${cards.length - 12}, --cards lists all)` : ""}\n`);
}
const stillUnder = [...byReason].filter(([reason]) => /moveTo under/.test(reason)).reduce((n, [, b]) => n + b.rows.length, 0);
console.log(stillUnder
  ? `${stillUnder} row(s) still refused for a place-under reason: their host or moved card is not one the price chose — read them above.`
  : "No row is refused for a place-under reason.");
process.exit(0);
