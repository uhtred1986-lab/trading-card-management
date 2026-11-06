/** R513 native action proofs. Full frozen sources; ordinary resources and the
 * starting Z-Leader are staged. R512 separately proves its real paid Z-Awaken. */
import assert from "node:assert/strict";
import fixture from "./fixtures/combo-standing-source.json";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, runtimeSupportOfRow, type RuleRow } from "../../src/lib/arena/rules-store";
import { parseRule, printRule, type Rule } from "../../src/lib/arena/lang";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { vmHost } from "../../src/lib/arena/vm/host";
import { skillsNegated } from "../../src/lib/arena/vm/effects";
import type { Action, Area, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const other = (p: PlayerId): PlayerId => p === "p1" ? "p2" : "p1";
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const defs: EngineContext["defs"] = {
    L: card("L", { type: "LEADER", colors: ["Green"], power: 10000 }),
    F: card("F", { comboCost: 0, comboPower: 5000 }),
};
for (const [id, { card: source }] of Object.entries(fixture)) {
    defs[id] = card(id, { ...source, type: source.type as CardDef["type"], colors: source.colors as CardDef["colors"],
        energyCost: source.cost == null ? null : Number(source.cost), zEnergyCost: source.z == null ? null : Number(source.z),
        comboCost: 0, comboPower: 5000 });
}
// Full confirmed source records; no Permanent body or condition is patched.
const records = Object.values(defs).flatMap(skillRecords);
const ctx: EngineContext = { defs, scripts: rulesFromRows(records.map((row, id) =>
    ({ ...row, id, status: row.unread.length ? "open" : "confirmed", source: "compiler" }) as RuleRow), defs) };
const policy = records.find(row => row.cardId === "BT20-086" && row.skillIndex === 10)!;
assert.deepEqual(runtimeSupportOfRow(policy).unsupported, []);
assert.ok(runtimeSupportOfRow(policy).unknown.length);
assert.deepEqual(ctx.scripts!["BT20-086"].bySkill[10].trigger, []);
assert.deepEqual(ctx.scripts!["BT20-086"].bySkill[10].unsupported, []);
const rule = clone({ kind: policy.kind, trigger: policy.trigger, cost: policy.cost, usage: policy.usage,
    validity: policy.validity, cond: policy.cond, ops: policy.ops }) as Rule;
const roundtrip = parseRule(printRule(rule)); assert.ok(roundtrip.ok); assert.equal(printRule(roundtrip.value), printRule(rule), "DSL normalizes only its default-false selector spelling");
assert.deepEqual(runtimeSupportOfRow({ ...policy, ...roundtrip.value }).unsupported, []);
for (const alter of [
    (row: typeof policy) => { row.usage.oncePerTurn = true; },
    (row: typeof policy) => { row.cost!.text = "unrepresented price"; },
    (row: typeof policy) => { row.cost!.marker = 0; },
    (row: typeof policy) => { row.trigger = ["played"]; },
    (row: typeof policy) => { row.cond = { kind: "count", sel: { side: "you", area: "combo" }, atLeast: 6 }; },
    (row: typeof policy) => { row.ops.push({ op: "draw", n: 1 }); },
    (row: typeof policy) => { row.printed = row.printed.replace("7 or more", "6 or more"); },
    (row: typeof policy) => {
        const condition = row.ops[0]; assert.ok(condition.op === "if");
        const negation = condition.then[0]; assert.ok(negation.op === "negateSkills" && "sel" in negation.target);
        negation.target.sel.upTo = true;
    },
    (row: typeof policy) => {
        const condition = row.ops[0]; assert.ok(condition.op === "if");
        const negation = condition.then[0]; assert.ok(negation.op === "negateSkills" && "sel" in negation.target);
        negation.target.sel.ignoreBarrier = true;
    },

]) {
    const near = clone(policy); alter(near); assert.ok(runtimeSupportOfRow(near).unsupported.length);
}
let cases = 0;
function setup(p: PlayerId, role: "attack" | "defend", battleAttacker = false) {
    const q = other(p), turn = role === "attack" ? p : q;
    let state = RULES.createGame(ctx, { seed: 513, p1: { name: "One", leader: p === "p1" ? "BT20-086" : "L", main: fifty("F") },
        p2: { name: "Two", leader: p === "p2" ? "BT20-086" : "L", main: fifty("F") } }).state as VmState;
    const events: GameEvent[] = [];
    let allowP035Boundary = false;
    const actions = () => RULES.legalActions(ctx, state).map(row => row.action);
    function take(action: Action) {
        const saved = clone(state), before = JSON.stringify(saved);
        for (const viewer of ["p1", "p2"] as const) {
            const view = RULES.boardView(ctx, saved, viewer, {});
            assert.doesNotMatch(JSON.stringify(view), /mixedStandingNegationHistory|movementHistory|opponentComboSevenInBattleV1|skillIdentity/);
        }
        const result = RULES.apply(ctx, saved, action);
        assert.equal(JSON.stringify(saved), before, "native action does not mutate saved input");
        state = result.state as VmState; events.push(...result.events);
        assert.doesNotMatch(JSON.stringify(result.events), /mixedStandingNegationHistory|movementHistory|opponentComboSevenInBattleV1|skillIdentity/);
        if (allowP035Boundary && state.outcome?.kind === "interrupted") {
            assert.equal(state.outcome.privateContext?.skillIndex, 20);
            assert.equal(state.outcome.privateContext?.trigger, "comboed");
            assert.equal(state.outcome.privateContext?.issue, "#544");
        } else assert.equal(state.outcome, undefined, JSON.stringify(state.outcome));
    }
    function advance() {
        for (let i = 0; i < 60 && !state.outcome && !["main", "combo", "charge", "zEnergyFromCombo"].includes(state.prompt.kind); i++) {
            const prompt = state.prompt;
            const action: Action | undefined = prompt.kind === "chooseCards"
                ? { type: "choose", player: prompt.player, cards: prompt.choice.candidates.slice(0, prompt.choice.min ?? 0) }
                : prompt.kind === "orderPending" ? { type: "orderPending", player: prompt.player, index: state.pendingOrder!.candidates[0] }
                : actions().find(a => a.type === "counter" && a.card === null || a.type === "block" && a.card === null || a.type === "payCost");
            assert.ok(action, JSON.stringify(prompt)); take(action);
        }
    }
    for (const action of [{ type: "chooseFirst", player: state.chooser, first: turn },
        { type: "mulligan", player: turn, redraw: false }, { type: "mulligan", player: other(turn), redraw: false },
        { type: "charge", player: turn, card: null }, { type: "endMain", player: turn },
        { type: "charge", player: other(turn), card: null }, { type: "endMain", player: other(turn) },
        { type: "charge", player: turn, card: null }] as Action[]) take(action);
    function stage(owner: PlayerId, definition: string, area: Area) {
        const id = state.sides[owner].zones.deck.at(-1)!;
        state.cards[id].cardId = definition;
        assert.ok(vmHost(ctx, game, state, events).move(id, area, owner));
        return id;
    }
    // Pan's actual life condition is established by ordinary native movement.
    while (state.sides[q].zones.life.length > 4)
        vmHost(ctx, game, state, events).move(state.sides[q].zones.life.at(-1)!, "hand", q);
    const prum = stage(q, "DB2-086", "battle"), pan = stage(q, "BT20-067", "hand"), bardock = stage(q, "P-035", "hand");
    const source = state.sides[p].zones.leader[0], opponent = battleAttacker ? stage(q, "F", "battle") : state.sides[q].zones.leader[0];
    function combo(owner: PlayerId, id: string) {
        const action = actions().find(a => a.type === "combo" && a.player === owner && a.card === id);
        assert.ok(action, JSON.stringify(state.prompt)); take(action); advance();
    }
    const drawCount = () => events.filter(event => event.type === "draw" && event.player === q).length;
    function begin(count: number) {
        take({ type: "attack", player: turn, attacker: role === "attack" ? source : opponent, target: role === "attack" ? opponent : source }); advance();
        const before = drawCount();
        if (role === "defend") {
            for (const id of [prum, pan, bardock]) combo(q, id);
            assert.equal(drawCount() - before, 2, "the opponent's earlier Combo arrivals precede the threshold");
            take({ type: "pass", player: q }); advance();
        }
        const own: string[] = [];
        for (let i = 0; i < count; i++) { const id = stage(p, "F", "hand"); own.push(id); combo(p, id); }
        if (role === "attack") {
            take({ type: "pass", player: p }); advance();
            for (const id of [prum, pan, bardock]) combo(q, id);
            assert.equal(drawCount() - before, count >= 7 ? 0 : 2, "both actual arrival Autos use the settled threshold");
        }
        assert.equal(skillsNegated(state, prum), count >= 7);
        assert.equal(skillsNegated(state, pan), count >= 7);
        return own;
    }
    function finish(zChoice?: string, expectedP035 = false) {
        allowP035Boundary = expectedP035;
        for (let i = 0; i < 80 && !state.outcome && state.prompt.kind !== "main"; i++) {
            if (state.prompt.kind === "zEnergyFromCombo") {
                const prompt = state.prompt;
                take({ type: "zEnergyFromCombo", player: prompt.player, card: prompt.player === p ? zChoice ?? null : null });
            } else {
                const action = actions().find(a => a.type === "pass");
                if (action) take(action); else advance();
            }
            advance();
        }
        if (expectedP035) {
            assert.equal(state.outcome?.kind, "interrupted");
            assert.equal(state.outcome?.privateContext?.sourceCard, bardock);
        } else assert.equal(state.prompt.kind, "main");
    }
    return { get state() { return state; }, events, p, q, source, opponent, prum, pan, bardock, stage, take, begin, finish, actions, advance };
}
for (const p of (process.env.R513_LIFETIME ? [] : ["p1", "p2"] as const)) for (const role of ["attack", "defend"] as const) for (const count of [6, 7]) {
    const b = setup(p, role); b.begin(count); b.finish(undefined, role === "defend" && count < 7);
    for (const id of [b.prum, b.pan, b.bardock]) {
        assert.ok(b.state.sides[b.q].zones.drop.includes(id));
        assert.equal(skillsNegated(b.state, id), false, "fresh Drop printed skills restore");
        assert.equal(b.events.filter(event => event.type === "move" && event.card === id && event.from === "combo" && event.to === "drop").length, 1);
    }
    const activated = b.state.outcome?.kind === "interrupted" && b.state.outcome.privateContext?.sourceCard === b.bardock ? 1 : 0;
    assert.equal(activated, role === "defend" && count < 7 ? 1 : 0, "P-035 special Auto uses original simultaneous Combo negation and actual turn");
    assert.equal(b.state.mixedStandingNegationHistory!.active.length, 0);
    assert.equal(b.events.some(event => event.type === "skill" && event.card === b.source && event.skill === 10), false,
        "the incoming Permanent is never a manufactured activation");
    assert.equal(b.state.effects.some(effect => effect.kind === "negateSkills" && [b.prum, b.pan].includes(effect.target)), false,
        "standing suppression is represented by history, not a fabricated resolved negation");
    console.log(`PASS ${p} ${role} ${count} actual Prum/Pan arrival and P-035 cleanup`); cases++;
}
for (const p of (process.env.R513_LIFETIME ? [] : ["p1", "p2"] as const)) for (const count of [7, 8]) {
    const b = setup(p, "defend"), own = b.begin(count); b.finish(own[0], count === 7);
    assert.ok(b.state.sides[p].zones.zEnergy.includes(own[0]));
    const activated = b.state.outcome?.kind === "interrupted" && b.state.outcome.privateContext?.sourceCard === b.bardock ? 1 : 0;
    assert.equal(activated, count === 7 ? 1 : 0, "8-5-3 choice precedes the independent 8-5-8 snapshot");
    console.log(`PASS ${p} ${count} own Combo then one actual Z-Energy choice`); cases++;
}
for (const p of ["p1", "p2"] as const) {
    const b = setup(p, "defend", true); b.begin(7);
    for (const definition of ["BT1-055", "F", "F"]) b.stage(p, definition, "energy");
    const beam = b.stage(p, "BT9-109", "hand");
    const activate = b.actions().find(action => action.type === "activate" && action.card === beam && action.skill === 10);
    assert.ok(activate, "full Emperor's Death Beam is offered with red and blue energy during native defense timing"); b.take(activate);
    for (let i = 0; i < 50 && b.state.prompt.kind !== "main"; i++) {
        const prompt = b.state.prompt;
        if (prompt.kind === "chooseCards" && prompt.choice.candidates.includes(b.opponent))
            b.take({ type: "choose", player: prompt.player, cards: [b.opponent] });
        else if (prompt.kind === "zEnergyFromCombo") b.take({ type: "zEnergyFromCombo", player: prompt.player, card: null });
        else if (prompt.kind === "combo") b.take({ type: "pass", player: prompt.player });
        else {
            const action: Action | undefined = prompt.kind === "chooseCards" ? { type: "choose", player: prompt.player,
                cards: prompt.choice.candidates.slice(0, prompt.choice.min ?? 0) }
                : prompt.kind === "orderPending" ? { type: "orderPending", player: prompt.player, index: b.state.pendingOrder!.candidates[0] }
                : b.actions().find(a => a.type === "counter" && a.card === null || a.type === "payCost");
            assert.ok(action, JSON.stringify(prompt)); b.take(action);
        }
    }
    assert.equal(b.state.prompt.kind, "main");
    assert.ok(b.state.sides[b.q].zones.drop.includes(b.opponent), "actual power-zero departure removes the attacker");
    assert.equal(b.state.sides[p].zones.energy.filter(id => b.state.cards[id].mode === "rest").length, 3);
    assert.equal(b.events.filter(event => event.type === "skill" && event.card === b.bardock && event.skill === 20).length, 0,
        "surviving Goku remains in battle through native early Battle End and original special-Auto history");
    console.log(`PASS ${p} paid actual Death Beam causes opposing combatant departure before cleanup`); cases++;
}
for (const p of ["p1", "p2"] as const) {
    const b = setup(p, "defend"); b.begin(7);
    const pass = b.actions().find(action => action.type === "pass"); assert.ok(pass);
    for (const mutation of ["missing", "sourceEpoch", "guard"] as const) {
        const saved = clone(b.state);
        if (mutation === "missing") delete saved.mixedStandingNegationHistory;
        if (mutation === "sourceEpoch") saved.cards[b.source].zoneEpoch = (saved.cards[b.source].zoneEpoch ?? 0) + 1;
        if (mutation === "guard") saved.battle!.guard = b.opponent;
        const before = JSON.stringify(saved);
        assert.throws(() => RULES.apply(ctx, saved, pass), /R513/, mutation);
        assert.equal(JSON.stringify(saved), before);
        cases++;
    }
    console.log(`PASS ${p} native saved missing history/source epoch/role refusals`);
}
// Counter timing normally precedes normal Combo entries. This deliberately
// staged preexisting Combo board isolates the native negated-attack lifetime;
// it is not claimed as a printed route that builds seven combos before Counter.
for (const p of ["p1", "p2"] as const) {
    const b = setup(p, "defend");
    for (let i = 0; i < 7; i++) b.stage(p, "F", "combo");
    const special = b.stage(b.q, "P-035", "combo"), counter = b.stage(p, "BT1-055", "hand");
    b.stage(p, "BT1-055", "energy");
    b.take({ type: "attack", player: b.q, attacker: b.opponent, target: b.source });
    const answer = b.actions().find(action => action.type === "counter" && action.card === counter);
    assert.ok(answer, "actual Whis's Coercion offered at native attack Counter timing"); b.take(answer);
    b.advance(); b.finish();
    assert.ok(b.events.some(event => event.type === "attackNegated"));
    assert.equal(b.events.filter(event => event.type === "skill" && event.card === special && event.skill === 20).length, 0);
    assert.ok(b.state.sides[b.q].zones.drop.includes(special));
    console.log(`PASS ${p} native paid attack negation with explicitly staged preexisting Combo board`); cases++;
}
console.log(`combo-standing-5: ${cases} native gameplay scenarios PASS`);
