/** R450 protocol prerequisites; native window/payment cases live in counter-spirit-x-5. */
import assert from "node:assert/strict";
import { fixtureBundle, FIXTURE_REVISION, FIXTURE_SEED } from "./arena-browser-fixture";
import { createPinnedMatch } from "../../src/lib/arena/browser";
import { policyTurn } from "../../src/lib/arena/policy/boundary";
import { buildDecisions, answerFor, resolveAnswer } from "../../src/lib/arena/policy/contract";
import { counterSpiritBoostX, counterXValue } from "../../src/lib/arena/vm/counter-x";
import { priceOf } from "../../src/lib/arena/wording";
import type { Action, LegalAction } from "../../src/lib/arena/types";
import type { CardView } from "../../src/lib/arena/view";
import type { XCost } from "../../src/lib/arena/vm/script";
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
async function main() {
    const { match } = await createPinnedMatch({ bundle: await fixtureBundle(), seed: FIXTURE_SEED, interpreterRevision: FIXTURE_REVISION });
    let cases = 0;
    for (const player of ["p1", "p2"] as const) {
        const source = `${player}#counter`;
        const base: Extract<Action, {
            type: "counter";
        }> = { type: "counter", player, card: source, skill: 0 };
        for (const n of [0, 1, 2, Number.MAX_SAFE_INTEGER]) {
            assert.equal(counterXValue({ ...base, x: n }, { spiritBoost: true }), n);
            cases++;
        }
        for (const x of [undefined, null, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "2"]) {
            assert.throws(() => counterXValue({ ...base, x } as unknown as typeof base, { spiritBoost: true }), /whole Spirit Boost/);
            cases++;
        }
        for (const x of [undefined, {}, { min: 0 }, { spiritBoost: true, min: 0 }, { spiritBoost: true, max: 2 }, { spiritBoost: true, energy: true }]) {
            assert.equal(counterSpiritBoostX(x as XCost | undefined), false);
            assert.throws(() => counterXValue({ ...base, x: 0 }, x as XCost | undefined), /no supported X/);
            cases++;
        }
        assert.equal(counterXValue(base, undefined), undefined);
        assert.throws(() => counterXValue({ ...base, card: null, x: 0 }, { spiritBoost: true }), /no supported X/);
        const actions: Action[] = [...([0, 1, 2].map(x => ({ ...base, x }))), { ...base, x: 2, alt: true }, { type: "counter", player, card: null }];
        const legal: LegalAction[] = actions.map(action => ({ action, label: action.type === "counter" && action.card ? `Counter with X = ${action.x}` : "Pass" }));
        // This is a protocol-only menu, using a real seat-masked observation. Native
        // affordability/Counter windows are proved separately after runtime handoff.
        const input = { seat: player, actor: player, revision: 450, observation: policyTurn(match, player, 450).input.observation, window: "counter", legal, choice: null, aliases: {} };
        const { decisions, key } = buildDecisions(input);
        assert.equal(decisions.decisions.length, actions.length, "different X/alternative choices must not collapse");
        assert.equal(new Set(decisions.decisions.map(d => d.id)).size, actions.length);
        for (const decision of decisions.decisions) {
            const result = resolveAnswer(copy(key), copy(answerFor(decisions, decision.id)));
            assert.ok(result.ok);
            assert.deepEqual(result.actions, [key.menu[decision.id]], "reload retains exact X, source, skill and route");
            cases++;
        }
        const later = buildDecisions({ ...input, revision: 451 });
        assert.equal(resolveAnswer(later.key, answerFor(decisions, decisions.decisions[0].id)).ok, false, "an X answer belongs to one position");
        const watcher = buildDecisions({ ...input, seat: player === "p1" ? "p2" : "p1" });
        assert.equal(watcher.decisions.decisions.length, 0, "opponent does not receive the private response menu");
        const printed = { cost: "2" } as CardView;
        assert.equal(priceOf({ ...base, x: 0 }, printed, ""), "2 energy + 0 Spirit Boost markers");
        assert.equal(priceOf({ ...base, x: 1 }, printed, ""), "2 energy + 1 Spirit Boost marker");
        assert.equal(priceOf({ ...base, x: 2, alt: true }, printed, ""), "alternative cost + 2 Spirit Boost markers");
        assert.equal(priceOf({ ...base, x: 2, alt: true }, printed, "", { energy: 0, describe: "alternative cost" }), "alternative cost + 2 Spirit Boost markers");
    }
    console.log(`Counter X protocol5: ${cases} cases passed`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
