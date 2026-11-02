/**
 * The rulings ledger (`src/lib/arena/rulings.ts`) is well-formed, and every `R-nnn` a verify
 * suite or the glossary cites exists there. Pure; no database.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { RULINGS } from "../../src/lib/arena/rulings";

const BASES = new Set(["manual", "official-qa", "errata", "same-wording", "owner", "intent"]);
const OFFICIAL = new Set(["manual", "official-qa", "errata", "same-wording"]);
const ids = new Set<string>();
let previous = 0;
for (const r of RULINGS) {
  assert.match(r.id, /^R-\d{3,}$/, `${r.id}: id is R-nnn`);
  assert.ok(!ids.has(r.id), `${r.id}: id is unique`);
  ids.add(r.id);
  const n = Number(r.id.slice(2));
  assert.ok(n > previous, `${r.id}: ids ascend (a new ruling takes the next number; none is reused)`);
  previous = n;
  assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/, `${r.id}: date`);
  assert.ok(r.ruling.trim().length > 20, `${r.id}: says what it rules`);
  assert.ok(r.basis.length > 0 && r.basis.every((b) => BASES.has(b)), `${r.id}: basis`);
  assert.ok(["official", "owner", "best-guess"].includes(r.confidence), `${r.id}: confidence`);
  assert.ok(["active", "pending", "superseded"].includes(r.status), `${r.id}: status`);
  if (r.confidence === "official") assert.ok(r.basis.some((b) => OFFICIAL.has(b)), `${r.id}: an official ruling names an official basis`);
  if (r.status === "pending") assert.equal(r.confidence, "best-guess", `${r.id}: a pending ruling is a best guess until the owner confirms it`);
  if (r.basis.length === 1 && r.basis[0] === "intent") assert.notEqual(r.confidence, "official", `${r.id}: intent alone is never official`);
  for (const c of r.cards) assert.match(c, /^[A-Z]+\d*-\d{2,3}$/, `${r.id}: card id ${c}`);
  if (r.wording) assert.doesNotThrow(() => new RegExp(r.wording!, "i"), `${r.id}: wording compiles`);
}
for (const r of RULINGS.filter((r) => r.status === "superseded")) {
  assert.ok(r.supersededBy && ids.has(r.supersededBy), `${r.id}: supersededBy names a ruling`);
  assert.notEqual(RULINGS.find((x) => x.id === r.supersededBy)!.status, "superseded", `${r.id}: superseded by a live ruling`);
}
for (const r of RULINGS.filter((r) => r.status !== "superseded")) assert.equal(r.supersededBy, undefined, `${r.id}: only a superseded ruling names a successor`);

// Every citation resolves: a suite or the glossary may cite R-nnn, and it must exist.
const cited = new Map<string, string>();
const scan = (file: string) => { for (const m of fs.readFileSync(file, "utf8").matchAll(/\bR-\d{3,}\b/g)) cited.set(m[0], file); };
scan(path.resolve("src/lib/arena/glossary.ts"));
for (const f of fs.readdirSync(path.resolve("scripts/verify"))) if (/\.(ts|mts)$/.test(f) && f !== "rulings.ts") scan(path.resolve("scripts/verify", f));
for (const [id, file] of cited) assert.ok(ids.has(id), `${path.relative(process.cwd(), file)} cites ${id}, which the ledger does not have`);

console.log(`verify/rulings: ${RULINGS.length} rulings (${RULINGS.filter((r) => r.status === "pending").length} pending), ${cited.size} cited`);
