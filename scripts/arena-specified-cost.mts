/**
 * The **specified** cost — the coloured half of a play's price — and the cards
 * whose baseline nobody can state.
 *
 * `specifiedCostOf` (`engine/cards.ts`) fills a fixed cost's orbs by
 * convention: one of each of the card's colours, capped by the total. An X
 * cost has no total to cap, so the convention says nothing — and the catalog
 * says nothing either. This script is that claim, checked rather than
 * asserted: it reads the deckplanet feed the catalog sync imports, proves the
 * cost field carries no orbs on any card, and lists every card left without a
 * baseline, loudest first — the ones that print a "specified cost" reducer and
 * so have a rule waiting on one (issue #96).
 *
 * Where a baseline *is* known it is hand-entered, in `cards.specified_cost`
 * (issue #255) — so with `DATABASE_URL` set the report also says, per card,
 * where its baseline stands: **entered** (the column, as `{u}{u}` and in
 * words), **ruling on file** (an explanation recorded on one of its rules
 * with `npm run arena:rule`), or **still unknown** — and lists entries that
 * have outlived what they were entered for (`staleSpecifiedCosts`). Without
 * the database it says so and reports the feed alone. Nothing is written.
 *
 * Network, like `arena:tally`; the database is optional.
 *
 * `npm run arena:specified [-- --all] [-- --game fusion]`
 */
import { fetchDeckplanet, shapeCatalog } from "../src/lib/catalog/deckplanet";
import { cardDefFrom } from "../src/lib/arena/load";
import { specifiedCostUnknown } from "../src/lib/arena/engine/cards";
import { parseSpecifiedCost, SPECIFIED_CLAUSE, specifiedCostWords, staleSpecifiedCosts } from "../src/lib/arena/specified-cost";
import type { Game } from "../src/lib/catalog/games";

const args = process.argv.slice(2);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const all = args.includes("--all");
const game = (value("game") ?? "dbs") as Game;

/** A cost field that carries orbs would have to say so somehow. These are the ways it could. */
const ORB_MARKUP = /\{[a-z0-9]\}|colorCostBall|_ball\.png|[⚫🔴🔵🟢🟡⚪]/i;

const raw = await fetchDeckplanet(game);

// ── 1. Does the feed carry the orbs at all? ────────────────────────────────
//
// The cost is one field, `card_energy_cost`, and the shaper reads it whole.
// If a single card ever spells orbs there, this stops being a refusal and
// becomes a parsing job, so it is asked of every card every run rather than
// settled once in a comment.
const costValues = new Map<string, number>();
let orbBearing = 0;
for (const c of raw) {
  const v = c.card_energy_cost == null ? "null" : String(c.card_energy_cost);
  costValues.set(v, (costValues.get(v) ?? 0) + 1);
  if (ORB_MARKUP.test(v)) orbBearing++;
}

console.log(`arena:specified — ${game}, ${raw.length} cards from deckplanet\n`);
console.log("Cost field (`card_energy_cost`), every distinct value:");
console.log(
  "  " +
    [...costValues.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([v, n]) => `${JSON.stringify(v)}×${n}`)
      .join("  "),
);
console.log(orbBearing ? `\n  ${orbBearing} of them carry orb notation — the refusal below no longer holds, read them.` : "\n  None carries orb notation: the feed states a total and never its colours.\n");

// ── 2. What has been entered, when the database is in reach ───────────────
//
// The column is the only place a baseline lives, so the defs below are made
// from the feed *plus* the column: a card entered on the workbench stops
// being "unknown" here the moment it is, and nowhere else has to be told.
const shaped = shapeCatalog(raw, game);
const entered = new Map<string, string>();
const rulings = new Map<string, string>();
let stale: string[] = [];
let dbNote: string;
if (process.env.DATABASE_URL) {
  const { db } = await import("../src/db");
  const { inArray, isNotNull, and } = await import("drizzle-orm");
  const { cardRules, cards } = await import("../src/db/schema");
  const ids = shaped.cards.map((c) => c.id);
  const rows: { id: string; energyCost: string | null; skill: string | null; specifiedCost: string | null }[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500);
    rows.push(...(await db.select({ id: cards.id, energyCost: cards.energyCost, skill: cards.skill, specifiedCost: cards.specifiedCost }).from(cards).where(and(inArray(cards.id, batch), isNotNull(cards.specifiedCost)))));
  }
  for (const r of rows) if (r.specifiedCost) entered.set(r.id, r.specifiedCost);
  stale = staleSpecifiedCosts(rows);
  const xIds = shaped.cards.filter((c) => /^x$/i.test((c.energyCost ?? "").trim())).map((c) => c.id);
  for (let i = 0; i < xIds.length; i += 500) {
    const batch = xIds.slice(i, i + 500);
    for (const r of await db.select({ cardId: cardRules.cardId, explanation: cardRules.explanation }).from(cardRules).where(and(inArray(cardRules.cardId, batch), isNotNull(cardRules.explanation)))) {
      if (r.explanation && SPECIFIED_CLAUSE.test(r.explanation)) rulings.set(r.cardId, r.explanation.replace(/\s+/g, " ").trim());
    }
  }
  dbNote = `${entered.size} baseline${entered.size === 1 ? "" : "s"} entered in cards.specified_cost, ${rulings.size} ruling${rulings.size === 1 ? "" : "s"} on file mentioning a specified cost`;
} else {
  dbNote = "no DATABASE_URL — cards.specified_cost cannot be read here, so every card below is reported from the feed alone (set it, or run with .env.local, to see what has been entered)";
}
console.log(`Baselines: ${dbNote}.\n`);

// ── 3. Who is left without a baseline ─────────────────────────────────────
const defs = shaped.cards.map((c) => cardDefFrom({ ...c, specifiedCost: entered.get(c.id) ?? null }));
const unknown = defs.filter((d) => specifiedCostUnknown(d));
const waiting = unknown.filter((d) => SPECIFIED_CLAUSE.test(d.skill ?? ""));
const unison = unknown.filter((d) => d.type.endsWith("UNISON"));
const settled = defs.filter((d) => d.energyCost === "X" && !specifiedCostUnknown(d));

console.log(`X-cost cards with no specified-cost baseline: ${unknown.length}`);
console.log(`  …of which Unison or Z-Unison:               ${unison.length}`);
console.log(`  …of which print a "specified cost" clause:  ${waiting.length}`);
console.log(`X-cost cards with a baseline entered:         ${settled.length}\n`);

const line = (d: (typeof defs)[number]) => `  ${d.id.padEnd(10)} ${d.type.padEnd(9)} ${(d.colors.join("/") || "—").padEnd(14)} ${d.name}`;
/** Where this card's baseline stands — the column first, the ruling beside it, and "unknown" said as such. */
const source = (d: (typeof defs)[number]) => {
  const raw = entered.get(d.id);
  const parsed = raw ? parseSpecifiedCost(raw) : null;
  const ruled = rulings.has(d.id) ? ` · ruling on file: “${rulings.get(d.id)}”` : "";
  if (parsed) return `entered ${raw} (${specifiedCostWords(parsed)})${ruled}`;
  if (raw) return `entered "${raw}" — not orb notation, ignored: still unknown${ruled}`;
  return `still unknown${ruled ? `${ruled} — not entered` : ""}`;
};

if (settled.length) {
  console.log("Baseline entered — the engine demands these colours:");
  for (const d of settled) console.log(`${line(d)}\n             ${source(d)}`);
  console.log("");
}

if (waiting.length) {
  console.log("Waiting on a baseline — a rule on these reads correctly and changes nothing:");
  for (const d of waiting) {
    console.log(line(d));
    console.log(`             ${source(d)}`);
    for (const clause of (d.skill ?? "").split(/<br>|\n/)) if (SPECIFIED_CLAUSE.test(clause)) console.log(`             ${clause.trim()}`);
  }
  console.log("");
}

if (stale.length) {
  console.log("Entries that have outlived what they were entered for (the catalog sync warns about these too):");
  for (const s of stale) console.log(`  ${s}`);
  console.log("");
}

// Every other card the refusal covers is only *lenient*: it demands no colour
// where the print may demand one, and no rule on it is inert because of that.
if (all) {
  console.log("Every X-cost card with no baseline:");
  for (const d of unknown) console.log(line(d));
} else if (unknown.length > waiting.length) {
  console.log(`${unknown.length - waiting.length} more X-cost cards have no baseline and no rule waiting on one — \`--all\` lists them.`);
}
