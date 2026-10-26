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
 *
 * Phrasing batch 2: the face is read as the catalog will print it after the
 * next `sync:catalog` — through this checkout's `correctSkillText` — and the
 * count of rows read from the text exactly as exported is printed beside it,
 * so a row read only thanks to a new correction says so (`corrected` in the
 * output: the owner's sync has to land before such a row is refreshed).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { skillRecords } from "../src/lib/arena/draft";
import { correctSkillText } from "../src/lib/catalog/errata";
import type { CardDef } from "../src/lib/arena/types";

interface Row { id: string; printed: string; skillIndex: number; side: "front" | "back"; unread: string[]; mechanisms: string[] }

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith("--"));
if (!input) throw new Error("usage: arena-phrasing-tally.mts <open-rules.json> [--out file]");
const outAt = args.indexOf("--out");
const rows = JSON.parse(readFileSync(input, "utf8")) as Row[];

const def = (id: string, skill: string): CardDef =>
  ({ id, name: id, type: "BATTLE", colors: ["Red"], characters: [], traits: [], specialTraits: [], power: 10000, energyCost: 1, comboPower: 5000, comboCost: 0, skill, back: null }) as unknown as CardDef;

/** The row's record compiled from `text`: read whole, its unread clauses, its reading. */
function readRow(row: Row, text: string): { read: boolean; unread: string[]; reads: string } {
  let rec;
  try {
    rec = skillRecords(def(row.id.split("#")[0], text)).find((r) => r.skillIndex === row.skillIndex);
  } catch (e) {
    return { read: false, unread: [`(compiler threw: ${(e as Error).message})`], reads: "" };
  }
  if (!rec) return { read: false, unread: ["(no record at this index)"], reads: "" };
  return { read: rec.unread.length === 0, unread: rec.unread, reads: rec.reads };
}

const out: { id: string; read: boolean; unread: string[]; reads: string; corrected?: true }[] = [];
let asExported = 0;
for (const row of rows) {
  const fixed = correctSkillText(row.id.split("#")[0], row.printed) ?? row.printed;
  const now = readRow(row, fixed);
  const plain = fixed === row.printed ? now : readRow(row, row.printed);
  if (plain.read) asExported++;
  out.push({ id: row.id, ...now, ...(now.read && !plain.read ? { corrected: true as const } : {}) });
}
const read = out.filter((r) => r.read);
console.log(`${rows.length} rows; fully read now: ${read.length} (${asExported} from the text exactly as exported, ${read.length - asExported} more once the catalog corrections are synced)`);
if (outAt >= 0) writeFileSync(args[outAt + 1], JSON.stringify(out, null, 1) + "\n");
