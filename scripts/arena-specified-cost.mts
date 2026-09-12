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
 * No database, no writes. Network only, like `arena:tally`.
 *
 * `npm run arena:specified [-- --all] [-- --game fusion]`
 */
import { fetchDeckplanet, shapeCatalog } from "../src/lib/catalog/deckplanet";
import { cardDefFrom } from "../src/lib/arena/load";
import { specifiedCostUnknown } from "../src/lib/arena/engine/cards";
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
/** What the engine's own reducer looks for: "reduce the specified cost of … by {u}". */
const SPECIFIED_CLAUSE = /specified\s+costs?/i;

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

// ── 2. Who is left without a baseline ─────────────────────────────────────
const defs = shapeCatalog(raw, game).cards.map((c) => cardDefFrom(c));
const unknown = defs.filter((d) => specifiedCostUnknown(d));
const waiting = unknown.filter((d) => SPECIFIED_CLAUSE.test(d.skill ?? ""));
const unison = unknown.filter((d) => d.type.endsWith("UNISON"));

console.log(`X-cost cards with no specified-cost baseline: ${unknown.length}`);
console.log(`  …of which Unison or Z-Unison:               ${unison.length}`);
console.log(`  …of which print a "specified cost" clause:  ${waiting.length}\n`);

const line = (d: (typeof defs)[number]) => `  ${d.id.padEnd(10)} ${d.type.padEnd(9)} ${(d.colors.join("/") || "—").padEnd(14)} ${d.name}`;

if (waiting.length) {
  console.log("Waiting on a baseline — a rule on these reads correctly and changes nothing:");
  for (const d of waiting) {
    console.log(line(d));
    for (const clause of (d.skill ?? "").split(/<br>|\n/)) if (SPECIFIED_CLAUSE.test(clause)) console.log(`             ${clause.trim()}`);
  }
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
