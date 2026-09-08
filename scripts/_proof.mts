/** Scratch: is the row's price what the engine now charges? */
import { probe, ruleFrom, scenariosFor } from "../src/lib/arena/probe";
import { defsForCards } from "../src/lib/arena/load";
import { programOf, worklist } from "../src/lib/arena/rules-store";
import { db } from "../src/db";

const rules = await worklist(db, ["BT20-087", "BT21-090"]);
const defs = await defsForCards(db, ["BT20-087", "BT21-090"]);
for (const row of rules.filter((r) => r.kind.startsWith("activate"))) {
  const withRow = ruleFrom(row, defs[row.cardId], programOf(row));
  if (!withRow.price.ops && !withRow.price.condition) continue;
  const blank = { ...withRow, price: { condition: null, ops: null } };
  const sc = scenariosFor(withRow)[0];
  console.log(`${row.cardId} [${row.kind} ${row.skillIndex}]`);
  console.log(`  with the row's price : ${probe(withRow, sc).outcome} — ${probe(withRow, sc).result[0]?.slice(0, 90)}`);
  console.log(`  with the price blank : ${probe(blank, sc).outcome} — ${probe(blank, sc).result[0]?.slice(0, 90)}`);
}
process.exit(0);
