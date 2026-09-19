/**
 * `/arena/rules/game` (issue #163): every `.rules` declaration, printed by
 * the language's own printer and grouped back by the file it came from.
 *
 * No Playwright here — this is the check that stands in for rendering the
 * page: `printedByFile` must account for every declaration exactly once,
 * print the same text `printDefinitions` would for the whole set, and hand
 * out an anchor id no two declarations share (the WHEN/COST chip links this
 * issue also adds point at these ids).
 *
 * Part of `npm test`; run from `scripts/verify-arena.ts`.
 */
import assert from "node:assert/strict";
import { DBS_FILES, loadDbs } from "../../src/lib/arena/rulesets";
import { printDefinitions } from "../../src/lib/arena/lang";
import { leadingComment, printedByFile, printedFile } from "../../src/lib/arena/rulesets/print-by-file";
import { KEYWORDS } from "../../src/lib/arena/glossary";

const dbs = loadDbs();
assert.ok(dbs.ok, `the DBS ruleset did not load: ${dbs.ok ? "" : JSON.stringify(dbs.errors, null, 2)}`);
if (!dbs.ok) throw new Error("unreachable");
const def = dbs.definition;

const grouped = printedByFile(def);

// Every declaration accounted for exactly once, across every file.
const total = grouped.reduce((n, g) => n + g.declarations.length, 0);
assert.equal(total, def.definitions.length, "printedByFile dropped or duplicated a declaration");

// The issue's own acceptance line: the printed definition equals
// printDefinitions(loadRuleset(...)) — grouping by file changes nothing
// about what is printed, only how it is sectioned; each file's declarations,
// printed together, are exactly `printedFile` for that file.
for (const g of grouped) {
  const byOne = g.declarations.map((d) => d.text).join("\n\n");
  assert.equal(byOne, printedFile(def, g.file), `${g.file}: printing its declarations one at a time does not equal printing them together`);
}
// …and every file together is the whole ruleset, in the order `printDefinitions(def.definitions)` gives it — declarations may interleave files in the source order, so this compares the *sets*, not a concatenation order the page does not promise either.
const wholeSorted = [...printDefinitions(def.definitions).split("\n\n")].sort();
const byFileSorted = grouped
  .flatMap((g) => g.declarations.map((d) => d.text))
  .sort();
assert.deepEqual(byFileSorted, wholeSorted, "the whole ruleset, printed by file, is not the same set of declarations printDefinitions(def.definitions) gives");

// Anchor ids: unique, so a WHEN/COST chip's link always lands on one declaration.
const ids = grouped.flatMap((g) => g.declarations.map((d) => d.id));
assert.deepEqual(
  ids.filter((id, i) => ids.indexOf(id) !== i),
  [],
  "two declarations share an anchor id",
);

// The leading-comment extraction: every real DBS file has one (they all open
// with a prose header, `docs/arena-ruleset-spec.md` §3's own convention),
// and it never swallows the first declaration.
for (const g of grouped) {
  const rawLines = (DBS_FILES[g.file] ?? "").split("\n");
  const note = leadingComment(DBS_FILES[g.file] ?? "");
  assert.ok(note.length > 0, `${g.file} has no leading comment to show as a note`);
  // The extraction stops at the first line that is not blank and not a `--`
  // comment — checked against the raw lines directly, since the note's own
  // text (comment markers stripped) can legitimately contain the word
  // "DEFINE" in prose (`battle.rules` explains why `attack` is not one).
  const firstDeclLine = rawLines.findIndex((l) => l.trim().startsWith("DEFINE "));
  assert.ok(firstDeclLine > 0, `${g.file} has no DEFINE line at all`);
  const leading = rawLines.slice(0, firstDeclLine);
  assert.ok(
    leading.every((l) => l.trim() === "" || l.trim().startsWith("--")),
    `${g.file}: a non-comment line sits between the header and its first DEFINE`,
  );
}

// #163's own keywords-page claim: `/arena/rules/keywords` now shows
// `keywords.rules`'s own `text:`, not `glossary.ts`'s `meaning` — the two
// were copied equal at Stage 3 (`s3-05-dbs-keywords-words-prompts.md`) and
// must stay that way, or the page and the record it explains quietly start
// saying different things about the same keyword.
for (const [name, doc] of Object.entries(KEYWORDS)) {
  const declared = def.keywords[name];
  assert.ok(declared, `glossary.ts describes "${name}", which keywords.rules no longer declares`);
  assert.equal(declared.text, doc.meaning, `"${name}": keywords.rules's text: has drifted from glossary.ts's meaning`);
}
assert.deepEqual(
  Object.keys(def.keywords).filter((name) => !(name in KEYWORDS)),
  [],
  "keywords.rules declares a keyword glossary.ts does not describe",
);

console.log("  game-page: printedByFile accounts for every declaration once, matches printDefinitions, and hands out unique anchor ids");
console.log("  game-page: every keyword's meaning agrees between glossary.ts and keywords.rules");
