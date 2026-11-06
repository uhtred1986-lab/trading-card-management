import { ENERGY_ENTRY_SLOTS } from "../../src/lib/arena/vm/energy-entry-effect";
/** R508 actual paid Gogeta end-turn movement, full compiled DB2-175 source. */
import assert from "node:assert/strict";
import frozen from "./fixtures/energy-entry-drop-5.json";
import { card, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, runtimeSupportOfRow, type RuleRow } from "../../src/lib/arena/rules-store";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { vmHost } from "../../src/lib/arena/vm/host";
import { hasKeyword } from "../../src/lib/arena/vm/program";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import type { Action, CardDef, Color, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const defs: Record<string, CardDef> = { L: card("L", { type: "LEADER", colors: ["Blue"], characters: ["Gogeta: Br"] }), WRONG: card("WRONG", { type: "LEADER", colors: ["Red"], characters: ["Gogeta: Br"] }), F: card("F", {}), RB: card("RB", { colors: ["Red", "Blue"] }), R: card("R", { colors: ["Red"] }), B: card("B", { colors: ["Blue"] }) };
for (const [id, c] of Object.entries(frozen))
    defs[id] = card(id, { type: c.type as CardDef["type"], colors: c.colors as Color[], energyCost: Number(c.cost), power: c.power, name: c.name, characters: c.characters, traits: c.traits, skill: c.skill });
const rows = Object.values(defs).flatMap(skillRecords);
for (const row of rows.filter(r => r.cardId === "BT16-142" || r.cardId === "DB2-175")) {
    assert.deepEqual(row.unread, []);
    assert.deepEqual(runtimeSupportOfRow(row).unsupported, []);
}
const ctx: EngineContext = { defs, scripts: rulesFromRows(rows.map((r, id) => ({ ...r, id, status: "draft", source: "compiler" }) as unknown as RuleRow), defs) };
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;
const copy = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
function setup(player: PlayerId, scenario = "accept") {
    const other: PlayerId = player === "p1" ? "p2" : "p1", leader = scenario === "wrongLeader" ? "WRONG" : "L";
    let state = RULES.createGame(ctx, { seed: 508, p1: { name: "One", leader, main: fifty("F") }, p2: { name: "Two", leader, main: fifty("F") } }).state as VmState;
    const events: GameEvent[] = [];
    const take = (a: Action, interrupted = false) => { const before = JSON.stringify(state), saved = copy(state); for (const p of ["p1", "p2"] as const)
        RULES.boardView(ctx, copy(saved), p, {}); const r = RULES.apply(ctx, saved, a); assert.equal(JSON.stringify(saved), before); state = r.state as VmState; events.push(...r.events); if (!interrupted)
        assert.equal(state.outcome, undefined, JSON.stringify(state.outcome)); };
    for (const a of [{ type: "chooseFirst", player: state.chooser, first: player }, { type: "mulligan", player, redraw: false }, { type: "mulligan", player: other, redraw: false }, { type: "charge", player, card: null }] as Action[])
        take(a);
    const stage = (id: string, area: string) => { const c = state.sides[player].zones.deck.at(-1)!; state.cards[c].cardId = id; assert.ok(moveCard(state, game, c, area, { owner: player }).ok); state.cards[c].mode = "active"; return c; };
    const parent = stage("BT16-142", "hand"), incoming = stage("DB2-175", "drop");
    const payers = scenario === "forcedSelf" ? [stage("B", "drop")] : [stage(scenario === "dual" ? "RB" : "R", "drop"), stage(scenario === "dual" ? "RB" : "B", "drop")];
    const energy = Array.from({ length: 5 }, (_, i) => stage(i === 0 ? "R" : "B", "energy"));
    const advance = (stop: () => boolean) => { for (let n = 0; n < 60; n++) {
        if (stop() || state.outcome)
            return;
        const legal = RULES.legalActions(ctx, state).map(x => x.action), a = legal.find(a => a.type === "counter" && a.card === null) ?? legal.find(a => a.type === "orderPending") ?? legal.find(a => a.type === "optionalCost" && a.pay) ?? legal.find(a => a.type === "payCost") ?? legal.find(a => a.type === "pass");
        assert.ok(a, JSON.stringify(state.prompt));
        take(a);
    } throw Error("native bound"); };
    take({ type: "play", player, card: parent });
    advance(() => state.prompt.kind === "main");
    assert.ok(state.sides[player].zones.battle.includes(parent));
    assert.ok(energy.every(id => state.cards[id].mode === "rest"));
    const h = vmHost(ctx, game, state, []);
    if (scenario === "faq")
        h.move(parent, "drop", player);
    if (scenario === "whole")
        h.addEffect({ target: incoming, kind: "negateSkills", value: 0, until: "game" });
    if (scenario === "line")
        h.addEffect({ target: incoming, kind: "negateSkill", value: 10, until: "game" });
    if (scenario === "protected")
        h.addEffect({ target: "", kind: "forbid", value: 0, until: "game", forbid: { what: "beNegated", fromArea: "any" } });
    if (scenario === "refused")
        h.addEffect({ target: incoming, kind: "forbid", value: 0, until: "game", forbid: { what: "beMovedBySkill", fromArea: "drop", toArea: "energy", bySkill: true } });
    if (scenario === "partialFirst" || scenario === "partialSecond")
        h.addEffect({ target: payers[scenario === "partialFirst" ? 0 : 1], kind: "forbid", value: 0, until: "game", forbid: { what: "beMovedBySkill", fromArea: "drop", toArea: "warp", bySkill: true } });
    const drawBefore = events.filter(e => e.type === "draw" && e.player === player).length;
    take({ type: "endMain", player });
    advance(() => state.prompt.kind === "charge" || state.prompt.kind === "chooseCards" && state.prompt.choice.candidates.includes(incoming));
    return { get s() { return state; }, take, advance, stage, events, parent, incoming, payers, player, other, drawBefore };
}
let cases = 0;
for (const player of ["p1", "p2"] as const)
    for (const scenario of ["accept", "decline", "partialFirst", "partialSecond", "dual", "whole", "line", "protected", "refused", "parentLeaves", "faq", "wrongLeader"]) {
        const t = setup(player, scenario), epoch = t.s.cards[t.incoming].zoneEpoch;
        if (scenario === "faq" || scenario === "wrongLeader") {
            assert.equal(t.s.prompt.kind, "charge");
            assert.equal(t.events.filter(e => e.type === "draw" && e.player === player).length, t.drawBefore);
            assert.ok(t.s.sides[player].zones.drop.includes(t.incoming));
            assert.equal(t.events.filter(e => e.type === "skill" && e.card === t.parent && e.skill === 30).length, 0);
            cases++;
            continue;
        }
        assert.equal(t.events.filter(e => e.type === "draw" && e.player === player).length, t.drawBefore + 1);
        if (scenario === "parentLeaves") {
            const h = vmHost(ctx, game, t.s, []);
            h.move(t.parent, "warp", player);
            h.addEffect({ target: t.parent, kind: "negateSkills", value: 0, until: "game" });
        }
        t.take({ type: "choose", player, cards: [t.incoming] });
        let picks = 0;
        while (t.s.programs.some(f => f.energyEntry)) {
            const q = t.s.prompt;
            assert.ok(q.kind === "chooseMode" || q.kind === "chooseCards");
            assert.equal(q.player, player);
            assert.ok(t.s.sides[player].zones.drop.includes(t.incoming));
            if (q.kind === "chooseCards") {
                assert.ok(q.choice.candidates.includes(t.incoming), "unresolved incoming payer stays in the full pool");
                assert.ok(q.choice.candidates.includes(t.payers[picks]));
            }
            t.take(q.kind === "chooseMode" ? { type: "chooseMode", player, index: scenario === "decline" ? 1 : 0 } : { type: "choose", player, cards: [t.payers[picks++]] });
        }
        const earned = ["accept", "dual", "parentLeaves"].includes(scenario), arrives = scenario !== "refused";
        assert.equal(t.s.sides[player].zones.energy.includes(t.incoming), arrives);
        if (arrives) {
            assert.equal(t.s.cards[t.incoming].zoneEpoch, epoch! + 1);
            assert.equal(t.s.cards[t.incoming].mode, earned || scenario === "whole" ? "active" : "rest");
            const stamp = t.s.effects.find(e => e.target === t.incoming && e.energyEntryEpoch !== undefined);
            assert.equal(!!stamp, earned);
            if (stamp) {
                assert.equal(stamp.source, t.incoming);
                assert.equal(stamp.master, player);
                assert.equal(stamp.energyEntryEpoch, t.s.cards[t.incoming].zoneEpoch);
            }
        }
        assert.equal(t.events.filter(e => e.type === "move" && e.card === t.incoming && e.to === "energy").length, arrives ? 1 : 0);
        assert.equal(t.events.filter(e => e.type === "skill" && e.card === t.incoming && e.skill === 10).length, 0);
        if (scenario === "partialFirst")
            assert.ok(t.s.sides[player].zones.drop.includes(t.payers[0]) && t.s.sides[player].zones.warp.includes(t.payers[1]));
        if (scenario === "partialSecond")
            assert.ok(t.s.sides[player].zones.warp.includes(t.payers[0]) && t.s.sides[player].zones.drop.includes(t.payers[1]));
        if (earned)
            assert.equal(hasKeyword(ctx, game, t.s, t.incoming, "Energy-Exhaust"), false);
        cases++;
    }
for (const player of ["p1", "p2"] as const)
    for (const scenario of ["firstSelf", "secondSelf", "forcedSelf"]) {
        const t = setup(player, scenario);
        t.take({ type: "choose", player, cards: [t.incoming] });
        const cards = copy(t.s.cards), zones = copy(t.s.sides[player].zones), moves = t.events.filter(e => e.type === "move").length;
        t.take({ type: "chooseMode", player, index: 0 }, scenario === "forcedSelf");
        if (scenario !== "forcedSelf") {
            if (scenario === "secondSelf")
                t.take({ type: "choose", player, cards: [t.payers[0]] });
            assert.ok(t.s.prompt.kind === "chooseCards" && t.s.prompt.choice.candidates.includes(t.incoming));
            t.take({ type: "choose", player, cards: [t.incoming] }, true);
        }
        assert.equal(t.s.outcome?.kind, "interrupted");
        assert.match(JSON.stringify(t.s.outcome), /incoming Drop card Energy-entry payment ruling/);
        assert.deepEqual(t.s.cards, cards);
        assert.deepEqual(t.s.sides[player].zones, zones);
        assert.equal(t.events.filter(e => e.type === "move").length, moves);
        cases++;
    }
for (const player of ["p1", "p2"] as const)
    for (const choice of [0, 1])
        for (const target of ["source", "first", "second"]) {
            if (choice === 0 && target === "second")
                continue; // The second pool has not been offered yet.
            const t = setup(player);
            t.take({ type: "choose", player, cards: [t.incoming] });
            t.take({ type: "chooseMode", player, index: 0 });
            if (choice === 1)
                t.take({ type: "choose", player, cards: [t.payers[0]] });
            const id = target === "source" ? t.incoming : t.payers[target === "first" ? 0 : 1];
            const h = vmHost(ctx, game, t.s, []);
            h.move(id, "warp", player);
            h.move(id, "drop", player);
            const saved = copy(t.s), before = JSON.stringify(saved);
            assert.throws(() => RULES.apply(ctx, saved, { type: "choose", player, cards: [t.payers[choice]] }), /original incoming Energy card|original Drop card|offered Energy-entry payer/);
            assert.equal(JSON.stringify(saved), before);
            assert.ok(t.s.sides[player].zones.drop.includes(t.incoming));
            assert.ok(t.payers.every(p => t.s.sides[player].zones.drop.includes(p)));
            cases++;
        }
for (const player of ["p1", "p2"] as const)
    for (const savedKind of ["vars", "selected"]) {
        const t = setup(player);
        t.take({ type: "choose", player, cards: [t.incoming] });
        t.take({ type: "chooseMode", player, index: 0 });
        const pending = t.s.programs.find(f => f.energyEntry)!.energyEntry!, slot = ENERGY_ENTRY_SLOTS[0];
        pending.child.vars[slot] = [t.incoming];
        if (savedKind === "selected") {
            const offered = pending.payers[slot].offered.find(p => p.card === t.incoming)!;
            assert.ok(offered);
            pending.payers[slot].selected = copy(offered);
            pending.child.vars[`${slot}@epoch`] = [`${t.incoming}@${offered.epoch}`];
        }
        const cards = copy(t.s.cards), zones = copy(t.s.sides[player].zones), moves = t.events.filter(e => e.type === "move").length;
        t.take({ type: "choose", player, cards: [t.payers[0]] }, true);
        assert.equal(t.s.outcome?.kind, "interrupted");
        assert.match(JSON.stringify(t.s.outcome), /incoming Drop card Energy-entry payment ruling/);
        assert.deepEqual(t.s.cards, cards);
        assert.deepEqual(t.s.sides[player].zones, zones);
        assert.equal(t.events.filter(e => e.type === "move").length, moves);
        cases++;
    }
for (const player of ["p1", "p2"] as const) {
    const t = setup(player);
    t.take({ type: "choose", player, cards: [] });
    t.advance(() => t.s.prompt.kind === "charge");
    const draws = t.events.filter(e => e.type === "draw" && e.player === player).length;
    t.take({ type: "charge", player: t.other, card: null });
    t.take({ type: "endMain", player: t.other });
    t.advance(() => t.s.prompt.kind === "charge");
    assert.equal(t.events.filter(e => e.type === "draw" && e.player === player).length, draws + 1, "only the next normal turn draw: the compiled played-this-turn gate skips the Auto body");
    assert.ok(t.s.sides[player].zones.drop.includes(t.incoming));
    cases++;
}
for (const player of ["p1", "p2"] as const)
    for (const target of ["source", "payer"]) {
        const t = setup(player);
        t.take({ type: "choose", player, cards: [t.incoming] });
        t.take({ type: "chooseMode", player, index: 0 });
        const id = target === "source" ? t.incoming : t.payers[0];
        // Malformed saved physical holder, with unchanged owner and occurrence.
        const own = t.s.sides[player].zones.drop;
        own.splice(own.indexOf(id), 1);
        t.s.sides[t.other].zones.drop.push(id);
        const saved = copy(t.s), before = JSON.stringify(saved);
        assert.throws(() => RULES.apply(ctx, saved, { type: "choose", player, cards: [t.payers[0]] }), /original incoming Energy card|offered Energy-entry payer/);
        assert.equal(JSON.stringify(saved), before);
        cases++;
    }
for (const player of ["p1", "p2"] as const) {
    const t = setup(player);
    t.take({ type: "choose", player, cards: [t.incoming] });
    t.take({ type: "chooseMode", player, index: 0 });
    t.take({ type: "choose", player, cards: [t.payers[0]] });
    vmHost(ctx, game, t.s, []).addEffect({ target: t.payers[0], source: t.payers[0], master: player, kind: "replaceLeave", value: { target: { special: "self" }, to: "deck" }, until: "game" });
    const cards = copy(t.s.cards), zones = copy(t.s.sides[player].zones), moves = t.events.filter(e => e.type === "move").length;
    t.take({ type: "choose", player, cards: [t.incoming] }, true);
    assert.match(JSON.stringify(t.s.outcome), /incoming Drop card Energy-entry payment ruling/);
    assert.deepEqual(t.s.cards, cards);
    assert.deepEqual(t.s.sides[player].zones, zones);
    assert.equal(t.events.filter(e => e.type === "move").length, moves);
    cases++;
}
for (const player of ["p1", "p2"] as const) for (const malformed of ["missing", "null", "array"]) {
    const t = setup(player);
    t.take({ type: "choose", player, cards: [t.incoming] });
    const child = t.s.programs.find(f => f.energyEntry)!.energyEntry!.child as unknown as { vars?: unknown };
    if (malformed === "missing") delete child.vars; else child.vars = malformed === "null" ? null : [];
    const cards = copy(t.s.cards), zones = copy(t.s.sides[player].zones);
    t.take({ type: "chooseMode", player, index: 0 }, true);
    assert.equal(t.s.outcome?.kind, "interrupted");
    assert.match(JSON.stringify(t.s.outcome), /saved Energy entry continuation/);
    assert.deepEqual(t.s.cards, cards); assert.deepEqual(t.s.sides[player].zones, zones); cases++;
}
console.log(`energy-entry-drop-5: ${cases} actual paid-source and Drop-entry controls passed`);
