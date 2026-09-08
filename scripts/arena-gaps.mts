/**
 * What the rules engine is still missing, counted rather than guessed.
 *
 * Read off `card_rules`, so it is the same picture the workbench shows: every
 * open row is a skill the compiler could not read, sorted into the *mechanism*
 * it would need (a queue of delayed effects is a different problem from a
 * missing phrase pattern, and only the first is a feature), plus the three
 * blind spots that read cleanly and do nothing — [Auto] skills no trigger ever
 * fires, [Activate]/[Counter] skills whose price the engine cannot charge, and
 * [Permanent] skills that emit no standing effect.
 *
 * `npm run arena:gaps [-- --decks]`   (run `arena:draft` first; this reads rows)
 */
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { cardRules, cards as cardsTable, decks } from "../src/db/schema";
import { DEFAULT_GAME } from "../src/lib/catalog/games";
import type { CostRecord } from "../src/lib/arena/draft";
import { emitsStatic } from "../src/lib/arena/engine/state";
import { MECHANISMS, PHRASING_ONLY, clauseShape, mechanismNeeds, mechanismOf } from "../src/lib/arena/gaps";
import { deckInputFor } from "../src/lib/arena/load";
import { programOf, type RuleRow } from "../src/lib/arena/rules-store";

const dbsIds = new Set((await db.select({ id: cardsTable.id }).from(cardsTable).where(eq(cardsTable.game, DEFAULT_GAME))).map((r) => r.id));
let rows: RuleRow[] = (await db.select().from(cardRules)).filter((r) => dbsIds.has(r.cardId));

/**
 * `--decks` narrows every count to the cards in the owner's own decks. The
 * catalog-wide list ranks by how often a wording appears, which buries anything
 * that happens once per card; ranked over the decks, the same data has found
 * bugs the wide list never would.
 */
if (process.argv.slice(2).includes("--decks")) {
  const inDecks = new Set<string>();
  for (const row of await db.select({ id: decks.id }).from(decks)) {
    const input = await deckInputFor(db, row.id);
    if (!input || input.input.main.length < 50) continue;
    for (const id of input.cardIds) inDecks.add(id);
  }
  rows = rows.filter((r) => inDecks.has(r.cardId));
  console.log(`Restricted to the ${inDecks.size} distinct cards in the owner's decks.\n`);
}
if (!rows.length) {
  console.log("No rule rows yet — run `npm run arena:draft` first.");
  process.exit(0);
}

const cards = new Set(rows.map((r) => r.cardId)).size;
const open = rows.filter((r) => r.status === "open");
const readable = rows.length - open.length;
console.log(`${cards} cards · ${rows.length} skills with text · ${readable} readable (${((readable / rows.length) * 100).toFixed(1)} %) · ${open.length} open on ${new Set(open.map((r) => r.cardId)).size} cards\n`);
const byStatus = rows.reduce<Record<string, number>>((acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {});
console.log(`open ${byStatus.open ?? 0} · draft ${byStatus.draft ?? 0} · confirmed ${byStatus.confirmed ?? 0} · corrected ${byStatus.corrected ?? 0}\n`);

// ── what each unread clause would need ───────────────────────────────────────
interface Bucket {
  clauses: number;
  cards: Set<string>;
  examples: { cardId: string; clause: string }[];
}
const buckets = new Map<string, Bucket>();
let unreadClauses = 0;
for (const r of open) {
  for (const clause of r.unread) {
    unreadClauses++;
    const key = mechanismOf(clause);
    const b = buckets.get(key) ?? { clauses: 0, cards: new Set<string>(), examples: [] };
    b.clauses++;
    b.cards.add(r.cardId);
    if (b.examples.length < 3 && clause.length < 110) b.examples.push({ cardId: r.cardId, clause });
    buckets.set(key, b);
  }
}
console.log(`${unreadClauses} unread clauses. What each would actually need:\n`);
for (const [key, b] of [...buckets.entries()].sort((a, b) => b[1].cards.size - a[1].cards.size)) {
  console.log(`${String(b.cards.size).padStart(5)} cards  ${String(b.clauses).padStart(5)} clauses   ${key}`);
  console.log(`                              → ${mechanismNeeds(key)}`);
  for (const e of b.examples) console.log(`                                 e.g. ${e.cardId}: "${e.clause}"`);
  console.log();
}
console.log(`${buckets.get(PHRASING_ONLY)?.clauses ?? 0} clauses need no new mechanism at all — only a pattern the compiler does not have yet.\n`);

// "Mentions it" and "is blocked only by it" are different numbers, and the
// second is the one worth ranking by.
const blockers = new Map<string, Set<string>>();
const byCard = new Map<string, Set<string>>();
for (const r of open) for (const clause of r.unread) {
  const key = mechanismOf(clause);
  if (key !== PHRASING_ONLY) byCard.set(r.cardId, (byCard.get(r.cardId) ?? new Set()).add(key));
}
for (const [cardId, mine] of byCard) if (mine.size === 1) blockers.set([...mine][0], (blockers.get([...mine][0]) ?? new Set()).add(cardId));
console.log("Cards whose *only* missing mechanism is this one — what building it unlocks:\n");
for (const [key, set] of [...blockers.entries()].sort((a, b) => b[1].size - a[1].size)) console.log(`${String(set.size).padStart(5)} cards   ${key}`);
void MECHANISMS;

// ── how far each open skill is from reading ──────────────────────────────────
const distance = new Map<number, number>();
const lastInTheWay = new Map<string, { skills: number; cards: Set<string>; example: string }>();
for (const r of rows) {
  if (r.kind === "permanent") continue; // never resolved; counted below
  distance.set(r.unread.length, (distance.get(r.unread.length) ?? 0) + 1);
  if (r.unread.length !== 1) continue;
  const key = clauseShape(r.unread[0]).slice(0, 70);
  const e = lastInTheWay.get(key) ?? { skills: 0, cards: new Set<string>(), example: `${r.cardId}: ${r.unread[0].replace(/\s+/g, " ")}` };
  e.skills++;
  e.cards.add(r.cardId);
  lastInTheWay.set(key, e);
}
console.log(`\n\nResolvable skills, by how far they are from reading:\n`);
for (const n of [...distance.keys()].sort((a, b) => a - b)) console.log(`${String(distance.get(n)).padStart(6)}  ${n === 0 ? "read" : `${n} clause${n === 1 ? "" : "s"} in the way`}`);
console.log("\nThe wordings that are the *only* thing holding a skill back — fix these first:\n");
for (const [, e] of [...lastInTheWay.entries()].sort((a, b) => b[1].skills - a[1].skills).slice(0, 25)) {
  console.log(`${String(e.skills).padStart(5)} skills on ${String(e.cards.size).padStart(4)} cards`);
  console.log(`        e.g. ${e.example.slice(0, 110)}`);
}

// ── the three blind spots: rows that read and do nothing ─────────────────────
const group = (label: string, picked: RuleRow[], keyOf: (r: RuleRow) => string, limit: number) => {
  const m = new Map<string, { skills: number; cards: Set<string>; example: string }>();
  for (const r of picked) {
    const key = keyOf(r);
    const e = m.get(key) ?? { skills: 0, cards: new Set<string>(), example: `${r.cardId}: ${r.printed.replace(/\s+/g, " ").slice(0, 60)}` };
    e.skills++;
    e.cards.add(r.cardId);
    m.set(key, e);
  }
  console.log(`\n\n${picked.length} ${label}\n`);
  for (const [key, e] of [...m.entries()].sort((a, b) => b[1].skills - a[1].skills).slice(0, limit)) console.log(`${String(e.skills).padStart(5)} skills on ${String(e.cards.size).padStart(4)} cards   ${key}\n        e.g. ${e.example}`);
};

// [Auto] skills that read and can never happen: no trigger the engine knows matches the moment they name.
const orphans = rows.filter((r) => r.kind === "auto" && r.status !== "open" && !(r.trigger ?? []).length);
group("[Auto] skills read but no trigger ever fires them — the engine waits for a moment it does not know about:", orphans, (r) => clauseShape(/\b(?:when|at the (?:end|beginning|start))\b[^,.]*/i.exec(r.printed)?.[0] ?? "(names no moment)").slice(0, 70), 20);

// [Activate]/[Counter] skills that read but are never offered: the price before the colon is not something the engine can charge.
const costReadable = (c: CostRecord | null) => !c || !c.text || !!c.condition || !!c.program;
const unpayable = rows.filter((r) => (r.kind.startsWith("activate") || r.kind.startsWith("counter")) && r.status !== "open" && !costReadable(r.cost as CostRecord | null));
group("[Activate]/[Counter] skills read but are never offered, because the engine cannot read the price and will not waive one:", unpayable, (r) => clauseShape((r.cost as CostRecord).text).slice(0, 70), 20);

// [Permanent] skills that read but emit no standing effect: the static layer has no kind for what they say.
const inert = rows.filter((r) => r.kind === "permanent" && r.status !== "open" && programOf(r).length > 0 && !emitsStatic(programOf(r)));
group("[Permanent] skills read but emit no standing effect — the static layer has no kind for what they say:", inert, (r) => programOf(r).map((o) => o.op).join(" + "), 15);
process.exit(0);
