/** R513 compatibility: actual paid BT3-075 play under dormant mixed history. */
import assert from "node:assert/strict";
import tokenSource from "./fixtures/combo-standing-token-source.json";
import mixedSource from "./fixtures/combo-standing-source.json";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { vmHost } from "../../src/lib/arena/vm/host";
import { withTokens } from "../../src/lib/arena/vm/cards";
import type { Action, Area, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const other = (p: PlayerId): PlayerId => p === "p1" ? "p2" : "p1";
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const defs: EngineContext["defs"] = { L: card("L", { type: "LEADER", colors: ["Green"] }), F: card("F", { colors: ["Green"] }),
    "BT3-075": card("BT3-075", { ...tokenSource["BT3-075"].card as Parameters<typeof card>[1], energyCost: 3 }),
    "BT20-086": card("BT20-086", mixedSource["BT20-086"].card as Parameters<typeof card>[1]) };
const records = Object.values(defs).flatMap(skillRecords);
assert.equal(records.find(row => row.cardId === "BT3-075")!.unread.length, 0);
const ctx: EngineContext = { defs, scripts: rulesFromRows(records.map((row, id) => ({ ...row, id, source: "compiler",
    status: row.unread.length ? "open" : "confirmed" }) as RuleRow), defs) };
for (const p of ["p1", "p2"] as const) {
    let state = RULES.createGame(ctx, { seed: 513, p1: { name: "One", leader: "L", main: fifty("F"), z: ["BT20-086"] },
        p2: { name: "Two", leader: "L", main: fifty("F"), z: ["BT20-086"] } }).state as VmState;
    const events: ReturnType<typeof RULES.apply>["events"] = [];
    function take(action: Action) {
        const saved = clone(state), before = JSON.stringify(saved), result = RULES.apply(ctx, saved, action);
        assert.equal(JSON.stringify(saved), before); state = result.state as VmState; events.push(...result.events);
        assert.equal(state.outcome, undefined, JSON.stringify(state.outcome));
        for (const player of ["p1", "p2"] as const) RULES.boardView(ctx, clone(state), player, {});
    }
    for (const action of [{ type: "chooseFirst", player: state.chooser, first: p },
        { type: "mulligan", player: p, redraw: false }, { type: "mulligan", player: other(p), redraw: false },
        { type: "charge", player: p, card: null }] as Action[]) take(action);
    const stage = (area: Area, def = "F") => {
        const id = state.sides[p].zones.deck.at(-1)!; state.cards[id].cardId = def;
        assert.ok(vmHost(withTokens(ctx), game, state, events).move(id, area, p)); return id;
    };
    for (let i = 0; i < 3; i++) stage("energy");
    const source = stage("hand", "BT3-075");
    const play = RULES.legalActions(ctx, state).map(row => row.action).find(action => action.type === "play" && action.card === source);
    assert.ok(play); take(play);
    for (let i = 0; i < 60 && state.prompt.kind !== "main"; i++) {
        const prompt = state.prompt;
        const action: Action | undefined = prompt.kind === "chooseCards" ? { type: "choose", player: prompt.player,
            cards: prompt.choice.candidates.slice(0, prompt.choice.min ?? 0) }
            : prompt.kind === "orderPending" ? { type: "orderPending", player: prompt.player, index: state.pendingOrder!.candidates[0] }
            : RULES.legalActions(ctx, state).map(row => row.action).find(a => a.type === "counter" && a.card === null || a.type === "payCost");
        assert.ok(action, JSON.stringify(prompt)); take(action);
    }
    assert.equal(state.prompt.kind, "main");
    assert.equal(state.sides[p].zones.energy.filter(id => state.cards[id].mode === "rest").length, 3);
    assert.equal(events.filter(event => event.type === "token").length, 2);
    assert.equal(state.sides[p].zones.battle.filter(id => state.cards[id].cardId.startsWith("TOKEN:")).length, 2);
    assert.ok(state.mixedStandingNegationHistory); assert.equal(state.mixedStandingNegationHistory.active.length, 0);
    console.log(`PASS ${p} actual paid BT3-075 creates two Tokens in a dormant mixed match`);
}
console.log("combo-standing-token-5: 2 native paid-play scenarios PASS");
