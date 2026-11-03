/**
 * Moments batch 1 (2 Nov 2026): the production audit's list of 443 [Auto] skills stored read whole with an empty
 * trigger list (`fixtures/triggerless-autos-2026-11-02.md`, catalog text as `card_rules` printed it). Every line is
 * compiled again and none may come out readable with no moment: it either answers a moment, or records its moment
 * clause as unread so the referee and the worklist see it. The one exception is the [Auto] that is moment-less by
 * design — a replacement of its card's own departure from a Combo Area (BT12-071, `vm/effects.ts`'s `comboDepartures`).
 *
 * The counts are printed, and held as floors: a later batch may read more of the list, never fewer.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { card } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";

const LIST = path.join(__dirname, "fixtures", "triggerless-autos-2026-11-02.md");
const lines = readFileSync(LIST, "utf8").split("\n").map((l) => /^- ([A-Z0-9-]+)#(\d+)(b?): (.*)$/.exec(l)).filter((m): m is RegExpExecArray => !!m);
assert.equal(lines.length, 443, "the list holds 443 lines");

/** The four Turles Crusher Corps combo replacements: moment-less by design. */
const BY_DESIGN = /^(?:BT12-071|BT12-072|BT12-074|BT12-075)$/;
let fire = 0;
let unread = 0;
let byDesign = 0;
const silent: string[] = [];
for (const [, id, index, back, printed] of lines) {
  const recs = skillRecords(card(id, { skill: printed }));
  assert.equal(recs.length, 1, `${id}#${index}${back}: one record`);
  const rec = recs[0];
  assert.equal(rec.kind, "auto", `${id}#${index}${back}: an [Auto]`);
  if (rec.unread.length) unread++;
  else if (rec.trigger.length) fire++;
  else if (BY_DESIGN.test(id)) byDesign++;
  else silent.push(`${id}#${index}${back}: ${printed.slice(0, 120)}`);
}
assert.deepEqual(silent, [], `a readable [Auto] with no moment never fires and says nothing:\n${silent.join("\n")}`);
assert.equal(byDesign, 4, "the four Combo Area replacements stay read, moment-less by design");
assert.ok(fire >= 101, `at least 101 of the list now answer a moment (${fire})`);
console.log(`verify/triggerless-autos: ok (${lines.length} lines: ${fire} answer a moment, ${unread} record their moment as unread, ${byDesign} moment-less by design)`);
