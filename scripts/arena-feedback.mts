/**
 * Everything the owner told the arena, printed for whoever is going to act on
 * it. Three kinds land here and they are one kind of thing — a person noticing
 * what the coverage scripts cannot:
 *
 *   bug   something went wrong in a game, reported from the board
 *   card  a card explained in their own words, from the backlog
 *   rule  a rule set by hand, from the rules page
 *
 * Whatever the kind, this prints what the compiler makes of the card that was
 * named. On the reports so far that has been the answer every time.
 *
 * `npm run arena:feedback`            open items
 * `npm run arena:feedback -- all`     including the settled ones
 * `npm run arena:feedback -- 7`       one item, with its board
 */
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "./../src/db";
import { arenaFeedback, cards as cardsTable } from "../src/db/schema";
import { compileCard, parseSkills, type GameState } from "../src/lib/arena/engine";
import { skillLines } from "../src/lib/arena/engine/cards";
import { cardDefFrom } from "../src/lib/arena/load";

const arg = process.argv[2] ?? "open";
const one = Number.isInteger(Number(arg)) ? Number(arg) : null;

const rows = await db
  .select()
  .from(arenaFeedback)
  .where(one ? eq(arenaFeedback.id, one) : arg === "all" ? undefined : eq(arenaFeedback.status, "open"))
  .orderBy(desc(arenaFeedback.createdAt))
  .limit(one ? 1 : 30);

if (!rows.length) {
  console.log("nothing said yet");
  process.exit(0);
}

const ids = [...new Set(rows.map((r) => r.cardId).filter((x): x is string => !!x))];
const cards = ids.length ? await db.select().from(cardsTable).where(inArray(cardsTable.id, ids)) : [];
const byId = new Map(cards.map((c) => [c.id, c]));

for (const r of rows) {
  console.log(`\n${"─".repeat(72)}`);
  const where = r.kind === "bug" ? `game ${r.gameId ?? "—"}  turn ${r.turn} ${r.phase ?? ""}` : r.kind === "card" ? "explained on the backlog" : "rule set by hand";
  console.log(`#${r.id}  [${r.kind}/${r.status}]  ${r.createdAt.toISOString().slice(0, 16).replace("T", " ")}  ${where}`);
  console.log(`\n  "${r.note}"\n`);

  const card = r.cardId ? byId.get(r.cardId) : null;
  if (r.cardId && !card) console.log(`  card: ${r.cardId} (not in the catalog)`);
  if (card) {
    const d = cardDefFrom(card);
    console.log(`  card: ${d.id} ${d.name} — cost ${d.energyCost ?? "—"}, ${d.type}`);
    for (const line of skillLines(card.skill)) console.log(`    | ${line}`);
    // What the compiler makes of it is usually where the answer is.
    const sc = compileCard(d);
    for (const sk of parseSkills(card.skill)) {
      if (!sk.effect.trim()) continue;
      const script = sc.bySkill[sk.index];
      if (!script) continue;
      const verdict = script.unsupported.length ? `unread: ${JSON.stringify(script.unsupported)}` : JSON.stringify(script.ops);
      console.log(`    skill ${sk.index} [${sk.kind}] ${verdict.slice(0, 400)}`);
    }
  }

  if (r.resolution) console.log(`\n  read as: ${r.resolution}`);
  if (r.kind === "bug") {
    console.log(`\n  waiting on: ${r.prompt ?? "—"}`);
    console.log(`  on offer: ${((r.legal as string[]) ?? []).join(" · ") || "nothing"}`);
  }
  const log = (r.log as string[]) ?? [];
  if (log.length) {
    console.log("\n  the last of the log:");
    for (const line of log.slice(-12)) console.log(`    ${line}`);
  }
  if (one) {
    const st = r.state as GameState | null;
    if (st) {
      console.log(`\n  seed ${st.seed}, ${(r.actions as unknown[])?.length ?? 0} actions — replay with those two.`);
      for (const p of ["p1", "p2"] as const) {
        const ps = st.players[p];
        const nameOf = (id: string) => st.cards[id]?.cardId ?? id;
        console.log(`  ${ps.name}: life ${ps.life.length}, hand ${ps.hand.length}, energy ${ps.energy.length} (${ps.energy.filter((i) => st.cards[i]?.mode === "active").length} active)`);
        console.log(`     leader ${nameOf(ps.leader)}  battle [${ps.battle.map(nameOf).join(", ")}]`);
      }
    }
  }
}
console.log(`\n${rows.length} item${rows.length === 1 ? "" : "s"}. \`npm run arena:feedback -- <id>\` for the board of one.`);
process.exit(0);
