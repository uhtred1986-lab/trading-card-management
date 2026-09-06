/**
 * Record a ruling on a card, from the terminal rather than from `/arena/backlog`.
 *
 * The backlog page's "explain a card" box asks Claude for a program and a
 * brief on the spot. This does not: it writes down what the owner said and
 * stops there, because the code change that follows is made deliberately, by
 * hand, against the whole set of cards that share the wording — not one card
 * at a time. The explanation is the durable part; the program is a
 * consequence of it, and `/arena/rules` is where one gets attached.
 *
 *   npm run arena:rule -- BT3-096 "when this card evolves it is played from the Combo Area"
 *   npm run arena:rule -- BT3-096 --skill 10 "…"
 *   npm run arena:rule -- BT3-096 --clause "evolve it into this card" "…"
 *   npm run arena:rule -- --list            # every note that carries a ruling
 *
 * With no `--clause` it rules on every clause of that card the compiler cannot
 * read; with no `--skill` it rules on every skill. A card whose text the
 * compiler now reads has no note to hang a ruling on, so one is made for the
 * whole skill line — a ruling on a card that reads *wrongly* is worth keeping
 * too, and that is the case no measure can find on its own.
 */
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "../src/db";
import { cards as cardsTable, cardTextNotes } from "../src/db/schema";
import { parseSkills } from "../src/lib/arena/engine";
import { clausePattern, noteUnreadText, unreadClausesOf } from "../src/lib/arena/ai/debug";
import { cardDefFrom } from "../src/lib/arena/load";

const argv = process.argv.slice(2);

if (argv.includes("--list")) {
  const rows = await db.select().from(cardTextNotes).where(isNotNull(cardTextNotes.explanation)).orderBy(desc(cardTextNotes.explainedAt));
  if (!rows.length) console.log("No rulings recorded yet.");
  for (const r of rows) {
    console.log(`\n${r.cardId} #${r.skillIndex} [${r.status}]  ${r.explainedAt?.toISOString().slice(0, 10) ?? ""}`);
    console.log(`  clause: ${r.clause.replace(/\s+/g, " ")}`);
    console.log(`  ruling: ${r.explanation?.replace(/\s+/g, " ")}`);
  }
  process.exit(0);
}

const flag = (name: string): string | null => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
};
const skillArg = flag("skill");
const clauseArg = flag("clause");
const positional = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));
const [cardId, ...rest] = positional;
const explanation = rest.join(" ").trim();

if (!cardId || !explanation) {
  console.error('Usage: npm run arena:rule -- <cardId> [--skill N] [--clause "…"] "<the ruling>"');
  process.exit(1);
}

const row = await db.query.cards.findFirst({ where: eq(cardsTable.id, cardId) });
if (!row) {
  console.error(`No such card: ${cardId}`);
  process.exit(1);
}

const def = cardDefFrom(row);
const skillIndex = skillArg == null ? null : Number(skillArg);

// A note per unread clause is what the backlog already holds, so a ruling
// lands on the row the page will show it on.
let targets = unreadClausesOf(def).filter((u) => (skillIndex == null || u.skillIndex === skillIndex) && (!clauseArg || u.clause.toLowerCase().includes(clauseArg.toLowerCase())));

// Nothing unread: the ruling is about text the compiler *does* read, which is
// the more valuable kind. Hang it on the skill line itself.
if (!targets.length) {
  const lines = [...parseSkills(def.skill ?? ""), ...parseSkills(def.back?.skill ?? "")].filter((sk) => sk.effect.trim() && (skillIndex == null || sk.index === skillIndex));
  if (!lines.length) {
    console.error(`${cardId} has no skill${skillIndex == null ? "" : ` #${skillIndex}`} to rule on.`);
    process.exit(1);
  }
  targets = lines.map((sk) => ({ cardId, skillIndex: sk.index, clause: clauseArg ?? sk.effect.replace(/\s+/g, " ").trim(), skillText: sk.raw }));
  console.log(`(${cardId} reads cleanly — the ruling is filed against the skill line itself.)`);
}

await noteUnreadText(db, targets, false);
for (const t of targets) {
  await db
    .update(cardTextNotes)
    .set({ explanation, explainedAt: new Date() })
    .where(and(eq(cardTextNotes.cardId, t.cardId), eq(cardTextNotes.skillIndex, t.skillIndex), eq(cardTextNotes.clause, t.clause)));
  console.log(`${t.cardId} #${t.skillIndex}  ${clausePattern(t.clause)}`);
}
console.log(`\nRuling recorded on ${targets.length} note${targets.length === 1 ? "" : "s"}: ${explanation}`);
process.exit(0);
