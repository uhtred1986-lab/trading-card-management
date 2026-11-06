/** R513 native-writer mechanisms; staged boards, not claimed paid gameplay. */
import assert from "node:assert/strict";
import fixture from "./fixtures/combo-standing-source.json";
import koFixture from "./fixtures/conditional-ko-result-5.json";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { vmHost } from "../../src/lib/arena/vm/host";
import { skillsNegated } from "../../src/lib/arena/vm/effects";
import { resolvedGrantDeleted } from "../../src/lib/arena/vm/resolved-grant-deletion";
import { beginStandingNegationMutation, finishStandingNegationMutation, validateStandingNegationRead } from "../../src/lib/arena/vm/standing-negation-runtime";
import { prepareComboDropBatch, commitComboDropBatch } from "../../src/lib/arena/vm/combo-drop-batch";
import type { EngineContext, GameEvent, PlayerId, Area } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const other = (p: PlayerId): PlayerId => p === "p1" ? "p2" : "p1";
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const defs: EngineContext["defs"] = { L: card("L", { type: "LEADER" }), F: card("F", {}) };
for (const [id, source] of Object.entries({ ...fixture, "BT4-124": koFixture["BT4-124"] }))
    defs[id] = card(id, source.card as Parameters<typeof card>[1]);
const ctx: EngineContext = { defs, scripts: rulesFromRows(Object.values(defs).flatMap(skillRecords).map((row, id) =>
    ({ ...row, id, status: row.unread.length ? "open" : "confirmed", source: "compiler" }) as RuleRow), defs) };
let cases = 0;
function check(label: string, fn: () => void) { fn(); cases++; console.log(`PASS ${label}`); }
function setup(p: PlayerId, count = 7) {
    const q = other(p), events: GameEvent[] = [];
    const state = RULES.createGame(ctx, { seed: 513, p1: { name: "One", leader: p === "p1" ? "BT20-086" : "L", main: fifty("F") },
        p2: { name: "Two", leader: p === "p2" ? "BT20-086" : "L", main: fifty("F") } }).state as VmState;
    function stage(owner: PlayerId, definition: string, area: Area) {
        const id = state.sides[owner].zones.deck.at(-1)!;
        state.cards[id].cardId = definition;
        assert.ok(vmHost(ctx, game, state, events).move(id, area, owner)); return id;
    }
    const source = state.sides[p].zones.leader[0];
    const opponent = stage(q, "F", "battle"), target = stage(q, "P-035", "combo");
    const own = Array.from({ length: count }, () => stage(p, "F", "combo"));
    const transaction = beginStandingNegationMutation(ctx, state);
    state.battle = { attacker: opponent, guard: source, target: source, step: "defense", negated: false, blockerOffered: true,
        counters: [], comboOrigins: Object.fromEntries([...own, target].map(id => [id, "hand"])) };
    finishStandingNegationMutation(ctx, state, transaction, undefined, { kind: "begin" });
    function end(reverse = false) {
        state.battle!.step = "battleEnd";
        const subjects = [state.turnPlayer, other(state.turnPlayer)].flatMap(player => state.sides[player].zones.combo);
        state.battle!.endCombo = { chooserIndex: 2, stage: "departures", retainedComboPower: {},
            departureSubjects: reverse ? subjects.reverse() : subjects, departureCursor: 0, specialSubjects: [], specialCursor: 0 };
    }
    return { state, p, q, events, source, opponent, target, own, stage, end };
}
for (const p of ["p1", "p2"] as const) {
    for (const reverse of [false, true]) check(`${p} batch original history, final restoration, reverse=${reverse}`, () => {
        const b = setup(p); b.end(reverse); assert.equal(skillsNegated(b.state, b.target), true);
        const token = prepareComboDropBatch(ctx, game, b.state), events: GameEvent[] = [];
        const completed = commitComboDropBatch(ctx, game, b.state, events, token);
        assert.equal(completed.length, 8); assert.equal(skillsNegated(b.state, b.target), false);
        assert.ok(completed.find(subject => subject.card === b.target)!.movementHistory.declarations.some(line => line.index === 20 && line.negated));
        assert.equal(events.filter(event => event.type === "move").length, 8);
        assert.equal(JSON.stringify(events).includes("movementHistory"), false);
        assert.equal(b.state.sides.p1.zones.combo.length + b.state.sides.p2.zones.combo.length, 0);
        const after = JSON.stringify(b.state); assert.throws(() => commitComboDropBatch(ctx, game, b.state, [], token), /R513/);
        assert.equal(JSON.stringify(b.state), after, "a consumed token cannot replay the action");
    });
    for (const mutation of ["cursor", "subjects", "stage", "origin", "epoch", "holder", "hidden"] as const)
        check(`${p} prepared ${mutation} mutation refuses before first write`, () => {
            const b = setup(p); b.end(); const token = prepareComboDropBatch(ctx, game, b.state);
            const end = b.state.battle!.endCombo!;
            if (mutation === "cursor") end.departureCursor = 1;
            if (mutation === "subjects") end.departureSubjects!.reverse();
            if (mutation === "stage") end.stage = "battleEndCheckpoint";
            if (mutation === "origin") b.state.battle!.comboOrigins![b.target] = "battle";
            if (mutation === "epoch") b.state.cards[b.target].zoneEpoch!++;
            if (mutation === "holder") { b.state.sides[b.q].zones.combo.pop(); b.state.sides[p].zones.combo.push(b.target); }
            if (mutation === "hidden") b.state.cards[b.target].hidden = true;
            const before = JSON.stringify(b.state), events: GameEvent[] = [];
            assert.throws(() => commitComboDropBatch(ctx, game, b.state, events, token), /R513/);
            assert.equal(JSON.stringify(b.state), before); assert.deepEqual(events, []);
        });
    for (const owner of [p, other(p)]) check(`${p} actual Ultimate ${owner === p ? "own" : "opposing"} original-hook semantics`, () => {
        const b = setup(p), ultimate = b.stage(owner, "BT4-124", "combo"); b.end();
        const before = JSON.stringify(b.state);
        if (owner === p) {
            assert.throws(() => prepareComboDropBatch(ctx, game, b.state), /R513/);
            assert.equal(JSON.stringify(b.state), before, "own unnegated Ultimate refuses before every departure");
        } else {
            assert.equal(skillsNegated(b.state, ultimate), true);
            const completed = commitComboDropBatch(ctx, game, b.state, [], prepareComboDropBatch(ctx, game, b.state));
            assert.ok(completed.some(subject => subject.card === ultimate));
            assert.ok(b.state.sides[owner].zones.drop.includes(ultimate), "originally negated Ultimate has no active native leave hook");
        }
    });
    check(`${p} actual Paparoni replacement refuses the full batch`, () => {
        const b = setup(p); b.stage(p, "DB2-140", "combo"); b.end(); const before = JSON.stringify(b.state);
        assert.throws(() => prepareComboDropBatch(ctx, game, b.state), /R513/); assert.equal(JSON.stringify(b.state), before);
    });
    check(`${p} surviving source retains battle through opponent departure and negated attack`, () => {
        const b = setup(p); b.state.battle!.negated = true;
        assert.equal(skillsNegated(b.state, b.target), true);
        vmHost(ctx, game, b.state, b.events).move(b.opponent, "drop", b.q);
        assert.equal(skillsNegated(b.state, b.target), true);
        const saved = clone(b.state); validateStandingNegationRead(ctx, saved); assert.equal(skillsNegated(saved, b.target), true);
        vmHost(ctx, game, b.state, b.events).move(b.source, "removed", p);
        assert.equal(skillsNegated(b.state, b.target), false);
        vmHost(ctx, game, b.state, b.events).move(b.source, "leader", p);
        assert.equal(skillsNegated(b.state, b.target), false, "fresh source occurrence does not inherit old battle role");
    });
    check(`${p} original source line negation and saved validation`, () => {
        const b = setup(p); const host = vmHost(ctx, game, b.state, b.events);
        host.negateSkillIndex!(b.source, 10); assert.equal(skillsNegated(b.state, b.target), false);
        const saved = clone(b.state); validateStandingNegationRead(ctx, saved); assert.equal(skillsNegated(saved, b.target), false);
    });
    check(`${p} opposing unread Permanent refuses observation before suppression publication`, () => {
        const b = setup(p), before = JSON.stringify(b.state.mixedStandingNegationHistory);
        assert.throws(() => b.stage(b.q, "DB2-140", "combo"), /R513/);
        assert.equal(JSON.stringify(b.state.mixedStandingNegationHistory), before);
    });
    check(`${p} foreign-owned Combo card refuses before batch departures`, () => {
        const b = setup(p), borrowed = b.stage(b.q, "F", "hand");
        vmHost(ctx, game, b.state, b.events).move(borrowed, "combo", p); b.end();
        const before = JSON.stringify(b.state); assert.throws(() => prepareComboDropBatch(ctx, game, b.state), /R513/);
        assert.equal(JSON.stringify(b.state), before);
    });
    check(`${p} unread copied Permanent refuses before suppression publication`, () => {
        const b = setup(p, 6), before = JSON.stringify(b.state.mixedStandingNegationHistory);
        assert.throws(() => vmHost(ctx, game, b.state, b.events).addEffect!({ target: b.target, master: b.q,
            kind: "copiedSkills", value: 0, until: "game", copied: { cardId: "DB2-140", side: "front", skills: [0] } }),
            /complete copied Permanent/);
        assert.equal(JSON.stringify(b.state.mixedStandingNegationHistory), before);
    });
    check(`${p} no candidate preserves dormant copied-Permanent behavior`, () => {
        const b = setup(p, 6), host = vmHost(ctx, game, b.state, b.events);
        host.move(b.source, "removed", p);
        const grant = host.addEffect!({ target: b.target, master: b.q, kind: "copiedSkills", value: 0, until: "game",
            copied: { cardId: "DB2-140", side: "front", skills: [0] } });
        assert.ok(grant); validateStandingNegationRead(ctx, b.state);
        assert.equal(b.state.mixedStandingNegationHistory!.active.length, 0);
    });
    check(`${p} actual Whis protection ends in Combo`, () => {
        const b = setup(p), whis = b.stage(b.q, "BT1-043", "battle");
        assert.equal(skillsNegated(b.state, whis), false);
        vmHost(ctx, game, b.state, b.events).move(whis, "combo", b.q);
        assert.equal(skillsNegated(b.state, whis), true);
    });
    check(`${p} native mixed King history preserves grant deletion across Battle to Combo`, () => {
        const b = setup(p, 6), prum = b.stage(b.q, "DB2-086", "battle");
        const host = vmHost(ctx, game, b.state, b.events);
        const grant = host.addEffect!({ target: prum, master: b.q, kind: "keyword", value: { name: "Blocker" }, until: "game" })!;
        const copied = host.addEffect!({ target: prum, master: b.q, kind: "copiedSkills", value: 0, until: "game",
            copied: { cardId: "DB2-086", side: "front", skills: [0] } })!;
        b.stage(p, "DB1-066", "battle"); assert.equal(skillsNegated(b.state, prum), true);
        assert.equal(resolvedGrantDeleted(b.state, prum, copied.id), true);
        assert.equal(resolvedGrantDeleted(b.state, prum, grant.id), true);
        host.move(prum, "combo", b.q); assert.equal(skillsNegated(b.state, prum), false);
        assert.equal(resolvedGrantDeleted(b.state, prum, copied.id), true, "complete copied Auto keeps its deletion history");
        assert.equal(resolvedGrantDeleted(b.state, prum, grant.id), true);
        b.stage(p, "F", "combo"); assert.equal(skillsNegated(b.state, prum), true);
        host.move(b.own[0], "zEnergy", p); assert.equal(skillsNegated(b.state, prum), false);
        assert.equal(resolvedGrantDeleted(b.state, prum, grant.id), true);
        const fresh = host.addEffect!({ target: prum, master: b.q, kind: "keyword", value: { name: "Blocker" }, until: "game" })!;
        assert.equal(resolvedGrantDeleted(b.state, prum, fresh.id), false);
    });
}
console.log(`combo-standing-batch-5: ${cases} native-writer mechanism cases PASS`);
