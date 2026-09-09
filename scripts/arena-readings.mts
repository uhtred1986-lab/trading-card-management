/**
 * What the compiler *reads* every skill in the catalog to mean — one line per
 * skill, printed text beside the program in words.
 *
 * `arena:tally` counts what the compiler cannot read. This prints what it
 * thinks it can, which is the other half and the dangerous one: a clause that
 * compiles and reads *wrongly* moves no coverage number and breaks no test.
 * The protocol a compiler change goes through (`docs/arena-next-session-prompt.md`)
 * is to dump this file before the change, dump it after, and diff — every line
 * that moved is a reading to sign off by hand.
 *
 * No database and no network beyond the deckplanet feed the tally already uses.
 *
 * `npm run arena:readings [-- --grep "leader" --unread]  > after.txt`
 */
import { fetchDeckplanet, shapeCatalog } from "../src/lib/catalog/deckplanet";
import { cardDefFrom } from "../src/lib/arena/load";
import { parseSkills } from "../src/lib/arena/engine/cards";
import { compileSkill } from "../src/lib/arena/engine/compile";
import { describeScript } from "../src/lib/arena/engine/script";

const args = process.argv.slice(2);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
/** Only skills whose printed text matches, for reading one wording by hand. */
const grep = value("grep")?.toLowerCase();
/** Also print the clauses the compiler could not read, under each skill. */
const withUnread = args.includes("--unread");

const raw = await fetchDeckplanet("dbs");
const shaped = shapeCatalog(raw, "dbs");
// The feed does not hand the cards back in a stable order, so two dumps of the
// same corpus diff as thousands of moved lines. Sorting is what makes the
// before/after diff readable at all.
const defs = shaped.cards.map((c) => cardDefFrom(c)).sort((a, b) => a.id.localeCompare(b.id));

const flat = (s: string) => s.replace(/\s+/g, " ").trim();
let lines = 0;

for (const d of defs) {
  for (const [face, text] of [
    ["", d.skill],
    ["b", d.back?.skill],
  ] as const) {
    if (!text) continue;
    for (const sk of parseSkills(text)) {
      if (!sk.effect.trim()) continue;
      if (grep && !sk.raw.toLowerCase().includes(grep)) continue;
      const s = compileSkill(sk);
      // A [Permanent] never resolves, so its ops carry `game` and printing the
      // duration would say something the card does not — the same reason
      // `describeScript` takes the flag rather than guessing.
      const reading = describeScript(s.ops, { permanent: sk.kind === "permanent" });
      console.log(`${d.id}${face}#${sk.index} ${sk.kind}`);
      console.log(`  printed: ${flat(sk.raw).slice(0, 300)}`);
      console.log(`  reads:   ${reading || "(nothing)"}`);
      if (withUnread) for (const cl of s.unsupported) console.log(`  unread:  ${flat(cl)}`);
      lines++;
    }
  }
}

console.error(`${lines} skills printed${grep ? ` matching "${grep}"` : ""}`);
process.exit(0);
