/** Guarded stored-rule refresh for an explicit id list, so a compiler PR's production refresh needs no throwaway script.
 *
 *   npm run arena:refresh-ids -- [--apply] [--unread-ok | --describe-only] (--ids "BT12-003#10,P-274#0" | --ids-file path | --pr 123)
 *
 * --describe-only regenerates only the stored reading TEXT (card_rules.reads) from the program the row already holds: no recompile, no
 * other column, allowed for any source (owner/user and confirmed rows included). The dry run prints old and new text.
 *
 * Ids are `CARD#SKILL` (front) or `CARD#SKILLb` / `CARD#SKILL#back` (back). A bare `CARD` (or `CARDb`, the back) expands to every stored skill row of the card. Default is a dry run. See docs/arena-tooling.md. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { applyDescribeOnly, applyPending, classifyDescribeOnly, classifyIds, formatDescribeVerdict, formatVerdict, idsFromPrBody, parseIdList, summarize, summarizeDescribe, type IdSpec } from "./lib/refresh-ids.ts";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const value = (n: string) => { const i = args.indexOf(n); return i < 0 ? undefined : args[i + 1]; };
const apply = flag("--apply"), unreadOk = flag("--unread-ok"), describeOnly = flag("--describe-only");
assert(!(describeOnly && unreadOk), "--describe-only never compiles, so --unread-ok does not apply");
const sources = ["--ids", "--ids-file", "--pr"].filter(flag);
assert(sources.length === 1, 'Usage: arena:refresh-ids -- [--apply] [--unread-ok] (--ids "A#0,B#10b" | --ids-file path | --pr N)');

let specs: IdSpec[] = [];
if (flag("--ids")) {
  const r = parseIdList(value("--ids") ?? "");
  assert(!r.bad.length, `Unreadable ids: ${r.bad.join(", ")}`);
  specs = r.specs;
} else if (flag("--ids-file")) {
  const r = parseIdList(fs.readFileSync(value("--ids-file")!, "utf8"));
  assert(!r.bad.length, `Unreadable ids: ${r.bad.join(", ")}`);
  specs = r.specs;
} else {
  const n = value("--pr");
  assert(n && /^\d+$/.test(n), "--pr needs a PR number");
  const body = execFileSync("gh", ["pr", "view", n, "--json", "body", "-q", ".body"], { encoding: "utf8" });
  const found = idsFromPrBody(body);
  console.log(found.section ? `PR #${n} refresh section:\n${found.section}\n` : `PR #${n}: no "Refresh:" line in the body.`);
  console.log(`Found ${found.specs.length} id(s): ${found.specs.map((s) => s.raw + (s.unreadOk ? " (unread-ok)" : "")).join(", ") || "(none)"}\n`);
  specs = found.specs;
}
assert(specs.length, "No ids to refresh");
assert(process.env.DATABASE_URL, "DATABASE_URL required (the app's pooled URL; see docs/agent-brief.md)");
const { db } = await import("../src/db/index.ts");

if (describeOnly) {
  const dv = await classifyDescribeOnly(db, specs);
  for (const v of dv) console.log(formatDescribeVerdict(v));
  console.log("\n" + JSON.stringify({ ...summarizeDescribe(dv), mode: apply ? "apply (describe-only)" : "dry-run (describe-only)" }));
  if (apply) {
    const written = await applyDescribeOnly(db, dv);
    console.log(JSON.stringify({ written }));
    const after = summarizeDescribe(await classifyDescribeOnly(db, specs));
    assert.equal(after.pending, 0, `${after.pending} id(s) still pending after apply`);
    console.log("Re-check: 0 pending.");
  }
  process.exit(0);
}

const verdicts = await classifyIds(db, specs, { unreadOk });
for (const v of verdicts) console.log(formatVerdict(v));
console.log("\n" + JSON.stringify({ ...summarize(verdicts), unreadOk, mode: apply ? "apply" : "dry-run" }));

if (apply) {
  const written = await applyPending(db, verdicts);
  console.log(JSON.stringify({ written }));
  const after = summarize(await classifyIds(db, specs, { unreadOk }));
  assert.equal(after.pending, 0, `${after.pending} id(s) still pending after apply`);
  console.log("Re-check: 0 pending.");
}
process.exit(0);
