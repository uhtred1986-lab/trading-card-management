/** R527: exact primitive/macro/DSL preservation, including old look spellings. */
import assert from "node:assert/strict";
import { expandMacros } from "../../src/lib/arena/rulesets";
import { parseRule, printRule, deepEqual, type Rule } from "../../src/lib/arena/lang";
import { revealAs, validateProgram, describeScript } from "../../src/lib/arena/vm/script-schema";
import { type Op } from "../../src/lib/arena/vm/script";
import { skillRecords } from "../../src/lib/arena/draft";
import { game, fresh, begin, tap, context } from "./incremental-look-harness-5";
import { RULES } from "../../src/lib/arena/vm";
let cases = 0;
for (const side of ["you", "opponent"] as const)
    for (const from of ["top", "bottom"] as const)
        for (const optional of [false, true]) {
            const op: Op = { op: "look", n: 7, as: "seen", side, from, ...(optional ? { upTo: true as const } : {}) };
            const expanded = expandMacros([op], game);
            assert.deepEqual(expanded, [{ op: "reveal", sel: { take: 7, ...(from === "bottom" ? { fromEnd: true } : {}), side, area: "deck" }, as: "seen", audience: "you", ...(optional ? { incremental: true } : {}) }]);
            assert.deepEqual(revealAs(expanded[0]), { op: "look", n: 7, as: "seen", side, ...(optional ? { upTo: true } : {}), ...(from === "bottom" ? { from: "bottom" } : {}) });
            for (const ops of [[op], expanded]) {
                const rule: Rule = { kind: "auto", trigger: [], cost: null, cond: null, ops }, parsed = parseRule(printRule(rule));
                assert.ok(parsed.ok);
                assert.ok(deepEqual(parsed.value, rule));
            }
            if (optional)
                assert.equal(describeScript([op]), `look at up to 7 cards from the ${from} of ${side === "opponent" ? "your opponent's" : "your"} deck`);
            cases++;
        }
assert.deepEqual(expandMacros([{ op: "look", n: 99, as: "seen", area: "hand", side: "opponent" }], game), [{ op: "reveal", sel: { side: "opponent", area: "hand" }, as: "seen", audience: "you" }]);
cases++;
for (const op of [
    { op: "look", n: 7, as: "seen", area: "hand", upTo: true }, { op: "look", n: 7, as: "seen", side: "both", upTo: true },
    { op: "reveal", sel: { side: "you", area: "deck", take: 7 }, as: "seen", audience: "both", incremental: true },
    { op: "reveal", sel: { side: "you", area: "deck", take: 7, upTo: true }, as: "seen", audience: "you", incremental: true },
    { op: "reveal", sel: { side: "you", area: "hand" }, as: "seen", audience: "you", incremental: true },
]) {
    assert.equal(validateProgram([op]), false);
    cases++;
}
for (const p of ["p1", "p2"] as const) {
    const f = fresh(p);
    const script = f.ctx.scripts!["BT1-061"].bySkill[0];
    script.ops = expandMacros(script.ops, game);
    begin(f);
    tap(f, 0);
    tap(f, 1);
    f.take({ type: "choose", player: p, cards: [] });
    assert.equal(f.state.prompt.kind, "main");
    assert.equal(RULES.boardView(f.ctx, f.state, p, {}).prompt.inspection, undefined);
    cases++;
}
// A near match or altered tail does not silently enroll another look family.
for (const id of ["BT1-061", "EX02-01"] as const) {
    const original = context(id).defs[id];
    for (const [before, after] of [["up to", "exactly"], ["top of your deck", "bottom of your deck"], ["Choose up to 1", "Choose up to 2"]]) {
        const changed = { ...original, skill: original.skill!.replace(before, after) };
        for (const record of skillRecords(changed)) for (const op of record.ops) if (op.op === "look") assert.equal(op.upTo, undefined);
        cases++;
    }
}
console.log(`${cases} incremental look language/expanded-native cases`);
