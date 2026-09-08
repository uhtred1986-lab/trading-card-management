/**
 * Record a ruling on a card, from the terminal rather than from the workbench.
 *
 * The workbench's "Explain to Claude" box asks Claude for a program and a
 * brief on the spot. This does not: it writes down what the owner said and
 * stops there, because the code change that follows is made deliberately, by
 * hand, against the whole set of cards that share the wording — not one card
 * at a time. The explanation is the durable part; the program is a
 * consequence of it, and `/arena/rules` is where one gets attached.
 *
 *   npm run arena:rule -- BT3-096 "when this card evolves it is played from the Combo Area"
 *   npm run arena:rule -- BT3-096 --skill 10 "…"
 *   npm run arena:rule -- BT3-096 --clause "evolve it into this card" "…"
 *   npm run arena:rule -- --list            # every rule that carries a ruling
 *
 * With no `--skill` it rules on every skill of the card, and `--clause` picks
 * the one whose unread text says that. A ruling on a card the compiler reads
 * *wrongly* is worth keeping too — that is the case no measurement can find on
 * its own — so a card with nothing unread is ruled on all the same.
 */
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "../src/db";
import { cardRules, cards as cardsTable } from "../src/db/schema";
import { loadRules } from "../src/lib/arena/rules-store";

const argv = process.argv.slice(2);

if (argv.includes("--list")) {
  const rows = await db.select().from(cardRules).where(isNotNull(cardRules.explanation)).orderBy(desc(cardRules.updatedAt));
  if (!rows.length) console.log("No rulings recorded yet.");
  for (const r of rows) {
    console.log(`\n${r.cardId} #${r.skillIndex} [${r.status}/${r.source}]  ${r.updatedAt.toISOString().slice(0, 10)}`);
    console.log(`  printed: ${r.printed.replace(/\s+/g, " ")}`);
    if (r.unread.length) console.log(`  unread:  ${r.unread.join(" | ")}`);
    console.log(`  ruling:  ${r.explanation?.replace(/\s+/g, " ")}`);
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

const card = await db.query.cards.findFirst({ where: eq(cardsTable.id, cardId) });
if (!card) {
  console.error(`No such card: ${cardId}`);
  process.exit(1);
}

const skillIndex = skillArg == null ? null : Number(skillArg);
const targets = (await loadRules(db, [cardId])).filter(
  (r) => (skillIndex == null || r.skillIndex === skillIndex) && (!clauseArg || r.unread.some((u) => u.toLowerCase().includes(clauseArg.toLowerCase())) || r.printed.toLowerCase().includes(clauseArg.toLowerCase())),
);

if (!targets.length) {
  console.error(`${cardId} has no rule${skillIndex == null ? "" : ` #${skillIndex}`}${clauseArg ? ` mentioning "${clauseArg}"` : ""} to rule on. Run \`npm run arena:draft -- --card ${cardId}\` first.`);
  process.exit(1);
}

for (const t of targets) {
  await db.update(cardRules).set({ explanation, updatedAt: new Date() }).where(and(eq(cardRules.id, t.id)));
  console.log(`${t.cardId} #${t.skillIndex} [${t.status}]  ${t.unread[0] ?? (t.reads || "reads cleanly")}`);
}
console.log(`\nRuling recorded on ${targets.length} rule${targets.length === 1 ? "" : "s"}: ${explanation}`);
console.log("The program that follows from it is attached on /arena/rules.");
process.exit(0);
