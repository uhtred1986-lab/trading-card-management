/**
 * `npm run rules:snapshot -- save <file> <card ids...>` and `npm run rules:snapshot -- diff <file> [--expect ops,reads,source,version,explanation]`
 *
 * READ-ONLY. `save` writes the `card_rules` rows of the given cards to a JSON file (keep it in the session
 * scratchpad, not the repo); `diff` re-reads the same cards and lists, per row, which fields changed.
 * With `--expect`, any changed field outside that list (`updatedAt` is always allowed) fails the run, so the
 * check after a `saveRule` is one command. Refuses a database without public.card_rules.
 */
import fs from "node:fs";
import { assertThisAppsDb } from "./lib/rules-batch.mts";
import { diffSnapshots, takeSnapshot, unexpectedFields, type Snapshot } from "./lib/rules-snapshot.mts";

const [cmd, file, ...rest] = process.argv.slice(2);
const usage = () => {
  console.error("Usage: npm run rules:snapshot -- save <file> <card ids...>\n       npm run rules:snapshot -- diff <file> [--expect ops,reads,source,version,explanation]");
  process.exit(1);
};
if ((cmd !== "save" && cmd !== "diff") || !file) usage();

const { db } = await import("../src/db/index.ts");
try {
  await assertThisAppsDb(db);
  if (cmd === "save") {
    const ids = rest.filter((a) => !a.startsWith("--")).flatMap((a) => a.split(","));
    if (!ids.length) usage();
    const snap = await takeSnapshot(db, ids);
    fs.writeFileSync(file, JSON.stringify(snap, null, 1));
    console.log(`saved ${Object.keys(snap.rows).length} rows of ${snap.cards.length} cards -> ${file}`);
  } else {
    const before = JSON.parse(fs.readFileSync(file, "utf8")) as Snapshot;
    const diff = diffSnapshots(before, await takeSnapshot(db, before.cards));
    const i = rest.indexOf("--expect");
    const expected = i >= 0 && rest[i + 1] ? rest[i + 1].split(",").map((s) => s.trim()).filter(Boolean) : null;
    for (const c of diff.changed) console.log(`changed  ${c.key}: ${c.fields.join(", ")}`);
    for (const k of diff.added) console.log(`added    ${k}`);
    for (const k of diff.removed) console.log(`removed  ${k}`);
    if (!diff.changed.length && !diff.added.length && !diff.removed.length) console.log("no differences");
    else console.log(`fields changed: ${diff.fields.join(", ") || "(none)"}`);
    if (expected) {
      const bad = unexpectedFields(diff, expected);
      if (bad.length || diff.added.length || diff.removed.length) {
        for (const b of bad) console.error(`UNEXPECTED ${b.key}: ${b.fields.join(", ")}`);
        console.error(`not within --expect ${expected.join(",")}`);
        process.exitCode = 1;
      } else console.log(`ok: only ${expected.join(", ")} (and updatedAt) differ`);
    }
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
}
process.exit(process.exitCode ?? 0);
