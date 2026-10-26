/**
 * Phrasing tally: compiles every row of an exported open-rules list with the
 * current compiler and says which skills now read fully.
 *
 *   npx tsx scripts/arena-phrasing-tally.mts <open-rules.json> [--out result.json]
 *
 * Input: an array of `{ id, printed, skillIndex, side, unread[], mechanisms[] }`
 * (one open production row each; `printed` is the whole face's text). Each face
 * is compiled from its printed text alone (`skillRecords`), the record matched
 * by skill index. Offline: no database, no network.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { skillRecords } from "../src/lib/arena/draft";
import type { CardDef } from "../src/lib/arena/types";

interface Row { id: string; printed: string; skillIndex: number; side: "front" | "back"; unread: string[]; mechanisms: string[] }

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith("--"));
if (!input) throw new Error("usage: arena-phrasing-tally.mts <open-rules.json> [--out file]");
const outAt = args.indexOf("--out");
const rows = JSON.parse(readFileSync(input, "utf8")) as Row[];

const def = (id: string, skill: string): CardDef =>
  ({ id, name: id, type: "BATTLE", colors: ["Red"], characters: [], traits: [], specialTraits: [], power: 10000, energyCost: 1, comboPower: 5000, comboCost: 0, skill, back: null }) as unknown as CardDef;

const out: { id: string; read: boolean; unread: string[]; reads: string }[] = [];
for (const row of rows) {
  let rec;
  try {
    rec = skillRecords(def(row.id.split("#")[0], row.printed)).find((r) => r.skillIndex === row.skillIndex);
  } catch (e) {
    out.push({ id: row.id, read: false, unread: [`(compiler threw: ${(e as Error).message})`], reads: "" });
    continue;
  }
  if (!rec) {
    out.push({ id: row.id, read: false, unread: ["(no record at this index)"], reads: "" });
    continue;
  }
  out.push({ id: row.id, read: rec.unread.length === 0, unread: rec.unread, reads: rec.reads });
}
const read = out.filter((r) => r.read);
console.log(`${rows.length} rows; fully read now: ${read.length}`);
if (outAt >= 0) writeFileSync(args[outAt + 1], JSON.stringify(out, null, 1) + "\n");
