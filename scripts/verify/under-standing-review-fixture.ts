/** Frozen pre-R528 oracle for isolated R523/R526 mechanisms, never native admission. */
import assert from "node:assert/strict";
import before from "./fixtures/under-native-loader-before-5.json";
import { skillRecords } from "../../src/lib/arena/draft";
import type { EngineContext } from "../../src/lib/arena/types";
import type { GameDefinition } from "../../src/lib/arena/rulesets";
import type { CardScripts } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";
import { moveCard } from "../../src/lib/arena/vm/zones";
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
export function frozenUnderReviewContext(ctx: EngineContext): EngineContext {
    assert.deepEqual(plain(skillRecords(ctx.defs["BT23-070"])), before.records, "all original compiler rows remain unchanged");
    const admitted = structuredClone(before.scripts);
    admitted.bySkill["0"].unsupported = [];
    admitted.unsupported = admitted.unsupported.filter(value => value !== "Permanent negateSkills is not collected as a runtime static");
    assert.deepEqual(plain(ctx.scripts!["BT23-070"]), admitted, "only #0's known loader refusal changes; every sibling and field stays original");
    const frozen = structuredClone(ctx);
    frozen.scripts!["BT23-070"] = structuredClone(before.scripts) as unknown as CardScripts;
    return frozen;
}
/** Physical staging only. These isolated tests no longer claim current vmHost
 * execution with a deliberately unadmitted historic Script. R528 tests own the
 * actual adapter proof. Assert the absent lifetimes rather than skip cleanup. */
export function stageIsolatedUnder(state: VmState, game: GameDefinition, source: string, host?: string): boolean {
    assert.equal(state.cards[source].cardId, "BT23-070");
    assert.deepEqual(state.cards[source].under, []);
    assert.ok(!state.effects.some(effect => effect.target === source || effect.source === source && effect.until === "whileSourceInPlay"), "staged source has no effect lifetime to clean up");
    return moveCard(state, game, source, "drop", host ? { under: host } : { owner: state.cards[source].owner }).ok;
}
