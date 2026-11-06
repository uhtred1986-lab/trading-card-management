/** R513: RM10-1-3-1 normal Awaken preserves a participating Leader. */
import assert from "node:assert/strict";
import fixture from "./fixtures/combo-standing-source.json";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { vmHost } from "../../src/lib/arena/vm/host";
import { mixedStandingObservationFromHistory } from "../../src/lib/arena/vm/standing-negation-mixed-history";
import { beginStandingNegationMutation, finishStandingNegationMutation } from "../../src/lib/arena/vm/standing-negation-runtime";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const other = (p: PlayerId): PlayerId => p === "p1" ? "p2" : "p1";
const source = fixture["BT1-001"].card;
const defs: EngineContext["defs"] = { L: card("L", { type: "LEADER" }), F: card("F", {}),
    "BT1-001": card("BT1-001", { ...source, type: source.type as CardDef["type"], colors: source.colors as CardDef["colors"],
        back: { name: source.backName!, skill: source.backSkill!, power: 15000 } }),
    "BT20-086": card("BT20-086", fixture["BT20-086"].card as Parameters<typeof card>[1]) };
// Frozen catalog omits back power. Its irrelevant 15000 fixture value is not
// used as an independent combat expectation; the full skills remain unchanged.
const ctx: EngineContext = { defs, scripts: rulesFromRows(Object.values(defs).flatMap(skillRecords).map((row, id) =>
    ({ ...row, id, status: row.unread.length ? "open" : "confirmed", source: "compiler" }) as RuleRow), defs) };
let cases = 0;
for (const p of ["p1", "p2"] as const) {
    const q = other(p);
    let state = RULES.createGame(ctx, { seed: 513, p1: { name: "One", leader: p === "p1" ? "BT1-001" : "L", main: fifty("F"), z: ["BT20-086"] },
        p2: { name: "Two", leader: p === "p2" ? "BT1-001" : "L", main: fifty("F"), z: ["BT20-086"] } }).state as VmState;
    function take(action: Action) {
        const saved = clone(state), before = JSON.stringify(saved), result = RULES.apply(ctx, saved, action);
        assert.equal(JSON.stringify(saved), before); state = result.state as VmState;
        assert.equal(state.outcome, undefined, JSON.stringify(state.outcome));
        for (const viewer of ["p1", "p2"] as const) RULES.boardView(ctx, clone(state), viewer, {});
    }
    const actions = () => RULES.legalActions(ctx, state).map(row => row.action);
    function advance() {
        for (let i = 0; i < 40 && state.prompt.kind !== "combo"; i++) {
            const action = actions().find(a => a.type === "counter" && a.card === null || a.type === "block" && a.card === null || a.type === "payCost");
            assert.ok(action, JSON.stringify(state.prompt)); take(action);
        }
    }
    for (const action of [{ type: "chooseFirst", player: state.chooser, first: q },
        { type: "mulligan", player: q, redraw: false }, { type: "mulligan", player: p, redraw: false },
        { type: "charge", player: q, card: null }, { type: "endMain", player: q },
        { type: "charge", player: p, card: null }, { type: "endMain", player: p },
        { type: "charge", player: q, card: null }] as Action[]) take(action);
    while (state.sides[p].zones.life.length > 4)
        vmHost(ctx, game, state, []).move(state.sides[p].zones.life.at(-1)!, "hand", p);
    const leader = state.sides[p].zones.leader[0], attacker = state.sides[q].zones.leader[0];
    const effect = vmHost(ctx, game, state, []).addEffect!({ target: leader, kind: "power", value: 1000, until: "game", master: p })!;
    take({ type: "attack", player: q, attacker, target: leader }); advance();
    take({ type: "pass", player: q }); advance();
    const awaken = actions().find(action => action.type === "activate" && action.card === leader && action.skill === 10);
    assert.ok(awaken); const original = clone(state), epoch = state.cards[leader].zoneEpoch, hand = state.sides[p].zones.hand.length;
    take(awaken); advance();
    assert.equal(state.cards[leader].flipped, true); assert.equal(state.cards[leader].zoneEpoch, epoch);
    assert.equal(state.sides[p].zones.hand.length, hand + 2);
    assert.ok(state.effects.some(current => current.id === effect.id && current.target === leader));
    const participant = mixedStandingObservationFromHistory(state.mixedStandingNegationHistory!).battle!.guard;
    assert.equal(participant.present, true); assert.equal(participant.occurrence.side, "back");
    assert.equal(participant.occurrence.card, leader); cases++;
    for (const bad of ["unchangedFace", "changedEpoch", "wrongRole"] as const) {
        const saved = clone(original), token = beginStandingNegationMutation(ctx, saved);
        if (bad !== "unchangedFace") saved.cards[leader].flipped = true;
        if (bad === "changedEpoch") saved.cards[leader].zoneEpoch = (saved.cards[leader].zoneEpoch ?? 0) + 1;
        if (bad === "wrongRole") saved.battle!.guard = attacker;
        const history = JSON.stringify(saved.mixedStandingNegationHistory);
        assert.throws(() => finishStandingNegationMutation(ctx, saved, token, leader, { kind: "face", roles: ["guard"] }), /R513/);
        assert.equal(JSON.stringify(saved.mixedStandingNegationHistory), history); cases++;
    }
    for (const corrupt of ["zCard", "hidden"] as const) {
        const saved = clone(original); saved.cards[leader][corrupt] = true;
        const before = JSON.stringify(saved);
        assert.throws(() => vmHost(ctx, game, saved, []).flip(leader, true), /R513/);
        assert.equal(JSON.stringify(saved), before, "unsupported participating source refuses before its face changes"); cases++;
    }
    console.log(`PASS ${p} native full Champa Awaken preserves role/effect/epoch plus five invalid face/host controls`);
}
console.log(`combo-standing-face-5: ${cases} native/transition cases PASS`);
