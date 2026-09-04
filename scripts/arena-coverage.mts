/**
 * How much of the catalog's card text the effect compiler can read.
 *
 * Prints the share of skills that compile, the same figure for the owner's own
 * decks (which is what actually matters for a game), and the clauses that most
 * often defeat the parser — that list is the to-do list for the next pass.
 *
 * `npm run arena:coverage [-- deckId ...]`
 */
import { db } from "../src/db";
import { cards, cardSets, decks } from "../src/db/schema";
import { compileSkill, parseSkills, type CardDef } from "../src/lib/arena/engine";
import { cardDefFrom, deckInputFor } from "../src/lib/arena/load";

const wanted = process.argv.slice(2).map(Number).filter(Number.isInteger);

interface Tally {
  /** Skills the engine resolves when they fire: [Auto], [Activate], [Counter]. */
  skills: number;
  compiled: number;
  /** [Permanent] skills, which are never "resolved" — they need the static-effect layer. */
  permanent: number;
  permanentCompiled: number;
  keywordOnly: number;
  cardsTotal: number;
  cardsFull: number;
}

/** Wordings that defeat the parser, counted separately for the catalog and for the decks. */
const catalogMisses = new Map<string, number>();
const deckMisses = new Map<string, number>();

function tally(defs: CardDef[], misses: Map<string, number>): Tally {
  const t: Tally = { skills: 0, compiled: 0, permanent: 0, permanentCompiled: 0, keywordOnly: 0, cardsTotal: 0, cardsFull: 0 };
  for (const d of defs) {
    t.cardsTotal++;
    let full = true;
    for (const side of ["front", "back"] as const) {
      const text = side === "front" ? d.skill : d.back?.skill;
      if (!text) continue;
      for (const sk of parseSkills(text)) {
        // A keyword skill with no text of its own is a rule, not something to compile.
        if (!sk.effect.trim()) {
          t.keywordOnly++;
          continue;
        }
        const isPermanent = sk.kind === "permanent";
        const script = compileSkill(sk);
        if (isPermanent) t.permanent++;
        else t.skills++;
        if (script.unsupported.length === 0) {
          if (isPermanent) t.permanentCompiled++;
          else t.compiled++;
        } else {
          full = false;
          for (const clause of script.unsupported) {
            const key = clause.toLowerCase().replace(/\d+/g, "N").replace(/<[^>]*>|\{[^}]*\}|≪[^≫]*≫/g, "…").slice(0, 60);
            misses.set(key, (misses.get(key) ?? 0) + 1);
          }
        }
      }
    }
    if (full) t.cardsFull++;
  }
  return t;
}

const pct = (a: number, b: number) => (b === 0 ? "—" : `${((a / b) * 100).toFixed(1)} %`);
const line = (label: string, t: Tally) =>
  `${label.padEnd(26)} ${String(t.cardsTotal).padStart(5)} cards   resolved skills ${String(t.skills).padStart(5)} → ${pct(t.compiled, t.skills).padStart(7)} compiled   permanent ${String(t.permanent).padStart(5)} → ${pct(t.permanentCompiled, t.permanent).padStart(7)}   keyword-only ${t.keywordOnly}`;

// Fusion World is a different game with different rules, and the arena does
// not play it. Counting its 2,000 cards would mean tuning the compiler on
// text that can never come up (see CLAUDE.md).
const fusionSets = new Set((await db.select({ code: cardSets.code, line: cardSets.line }).from(cardSets)).filter((s) => s.line === "fusion").map((s) => s.code));
const rows = (await db.select().from(cards)).filter((r) => !fusionSets.has(r.setCode));
const all = rows.map(cardDefFrom);
console.log(line("whole catalog", tally(all, catalogMisses)));

const deckRows = await db.select({ id: decks.id, name: decks.name }).from(decks);
const byId = new Map(all.map((d) => [d.id, d]));
let deckSkills = 0;
let deckCompiled = 0;
let deckPerm = 0;
let deckPermCompiled = 0;
for (const d of deckRows) {
  if (wanted.length && !wanted.includes(d.id)) continue;
  const input = await deckInputFor(db, d.id);
  if (!input || input.input.main.length < 50) continue;
  const defs = [...new Set(input.cardIds)].map((id) => byId.get(id)).filter((x): x is CardDef => !!x);
  const t = tally(defs, deckMisses);
  deckSkills += t.skills;
  deckCompiled += t.compiled;
  deckPerm += t.permanent;
  deckPermCompiled += t.permanentCompiled;
  console.log(line(`deck ${d.id} ${d.name}`.slice(0, 26), t));
}
console.log(`\ndecks combined: ${pct(deckCompiled, deckSkills)} of ${deckSkills} resolved skills compile; the rest are put to the referee at runtime.`);
console.log(`                ${pct(deckPermCompiled, deckPerm)} of ${deckPerm} [Permanent] skills compile. Those that do are applied by the static layer.`);

// The decks come first: a wording that never turns up in a game you play is
// worth less than one that turns up every game, whatever the catalog says.
const table = (title: string, misses: Map<string, number>, rows: number) => {
  console.log(`\n${title}`);
  for (const [clause, n] of [...misses.entries()].sort((a, b) => b[1] - a[1]).slice(0, rows)) console.log(`  ${String(n).padStart(5)}×  ${clause}`);
};
table("in your decks — the working list, most common first:", deckMisses, 30);
table("across the whole catalog:", catalogMisses, 25);

process.exit(0);
