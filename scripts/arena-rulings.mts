/**
 * `npm run arena:rulings -- [--pending | --basis intent | <cardId> | <words>]` — read the rulings
 * ledger (`src/lib/arena/rulings.ts`). A card id lists the rulings that name it or whose
 * wording pattern its text would match only if given with `--text "<printed line>"`.
 */
import { RULINGS, type Ruling } from "../src/lib/arena/rulings";

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? (args[i + 1] ?? "") : null; };
let hits: Ruling[] = RULINGS;
if (args.includes("--pending")) hits = hits.filter((r) => r.status === "pending");
const basis = flag("basis");
if (basis) hits = hits.filter((r) => r.basis.includes(basis as Ruling["basis"][number]));
const text = flag("text");
if (text) hits = hits.filter((r) => r.wording && new RegExp(r.wording, "i").test(text));
const free = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && ["--basis", "--text"].includes(args[i - 1])));
for (const q of free) {
  hits = /^[A-Z]+\d*-\d{2,3}$/.test(q)
    ? hits.filter((r) => r.cards.includes(q))
    : hits.filter((r) => `${r.ruling} ${r.wording ?? ""} ${(r.refs ?? []).join(" ")}`.toLowerCase().includes(q.toLowerCase()));
}
for (const r of hits) {
  console.log(`${r.id} [${r.status}, ${r.confidence}, ${r.basis.join("+")}] ${r.date}${r.cards.length ? ` — ${r.cards.join(", ")}` : ""}`);
  console.log(`  ${r.ruling}`);
  if (r.wording) console.log(`  wording: /${r.wording}/i`);
  if (r.refs?.length) console.log(`  refs: ${r.refs.join(", ")}`);
  if (r.supersededBy) console.log(`  superseded by ${r.supersededBy}`);
}
console.log(`\n${hits.length} of ${RULINGS.length} rulings`);
