import { costRecordProblem } from "../../src/lib/arena/vm/skill-payment";
import { emptyFilter } from "../../src/lib/arena/text/filters";
import { printRule, parseRule, deepEqual, type Rule } from "../../src/lib/arena/lang";
/** R507: real compiled optional Permanents; printed paid movers and labeled origin mechanisms. */
import assert from "node:assert/strict";
import frozen from "./fixtures/energy-admission-5.json";
import { card, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { skillRecords } from "../../src/lib/arena/draft";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { compileEnergyEntryPolicy } from "../../src/lib/arena/compile/energy-entry";
import { rulesFromRows, runtimeSupportOfRow, type RuleRow } from "../../src/lib/arena/rules-store";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { vmHost } from "../../src/lib/arena/vm/host";
import { hasKeyword } from "../../src/lib/arena/vm/program";
import { energyEntrySource } from "../../src/lib/arena/vm/energy-entry-source";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, CardDef, Color, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
const ids = ["DB2-166", "DB2-168", "DB2-171", "DB2-173", "DB2-175", "DB2-176"] as const;
const defs: Record<string, CardDef> = { L: card("L", { type: "LEADER", colors: ["Blue"], characters: ["Whis"], skill: "[Activate: Battle] Choose up to 1 card in your Combo Area and add it to your energy." }), A: card("A", { power: 10000 }), G: card("G", { power: 30000 }), F: card("F", {}) };
for (const [id, raw] of Object.entries(frozen))
    defs[id] = card(id, { type: raw.type as CardDef["type"], name: raw.name, colors: raw.colors as Color[], skill: raw.skill, energyCost: Number(raw.cost), power: raw.power, characters: raw.characters, traits: raw.traits });
for (const color of ["Red", "Blue", "Green", "Yellow"] as const)
    defs[color] = card(color, { colors: [color] });
// These are explicitly mechanism movers, not printed cards. Actual source records are never patched.
for (const area of ["hand", "deck", "warp", "zEnergy", "battle"])
    defs[`M-${area}`] = card(`M-${area}`, { skill: `[Activate: Main] Choose up to 1 card in your ${area === "zEnergy" ? "Z-Energy" : area} and add it to your energy.` });
const rows = Object.values(defs).flatMap(skillRecords);
const ctx: EngineContext = { defs, scripts: rulesFromRows(rows.map((r, id) => ({ ...r, id, status: "draft", source: "compiler" }) as unknown as RuleRow), defs) };
for (const area of ["hand", "deck", "warp", "zEnergy", "battle"] as const) {
    const script = ctx.scripts![`M-${area}`].bySkill[0];
    // Structural origin mover; source Permanents remain compiler-produced and untouched.
    script.ops = [{ op: "choose", sel: { side: "you", area, count: 1 }, as: "incoming" }, { op: "moveTo", target: { var: "incoming" }, to: "energy", reveal: true }];
    script.unsupported = [];
}
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;
const copy = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
let cases = 0;
for (const id of ids) {
    const row = rows.find(r => r.cardId === id && r.skillIndex === 10)!;
    assert.deepEqual(row.trigger, []);
    assert.deepEqual(row.unread, []);
    assert.deepEqual(runtimeSupportOfRow(row).unsupported, []);
    assert.ok(runtimeSupportOfRow(row).unknown.length);
    assert.deepEqual(ctx.scripts![id].bySkill[10].ops, row.ops);
    const rule = copy({ kind: row.kind, trigger: row.trigger, cost: row.cost, usage: row.usage, validity: row.validity, cond: row.cond, ops: row.ops }) as Rule;
    const roundtrip = parseRule(printRule(rule));
    assert.ok(roundtrip.ok);
    assert.ok(deepEqual(roundtrip.value, rule));
    const skill = parseSkills(defs[id].skill).find(s => s.index === 10)!;
    assert.deepEqual(row.ops, [{ op: "energyEntryExhaust", colors: compileEnergyEntryPolicy(skill)!.colors }]);
    for (const patch of [{ oncePerTurn: true }, { limit: 1 }, { bond: 1 }, { sparking: 1 }, { burst: 0 }, { spiritBoost: 0 }, { markerCost: 0 }, { cost: "pay" }, { energyCost: { Red: 1 } }, { energyEither: [["Red", "Blue"]] }]) {
        assert.equal(compileEnergyEntryPolicy({ ...skill, ...patch } as typeof skill), undefined);
        cases++;
    }
    for (const change of [
        (r: typeof row) => { r.usage.oncePerTurn = true; }, (r: typeof row) => { r.validity.sparking = 1; },
        (r: typeof row) => { r.cost!.marker = 0; }, (r: typeof row) => { r.cost!.burst = 0; }, (r: typeof row) => { r.cost!.spiritBoost = 0; },
        (r: typeof row) => { r.kind = "auto"; },
        (r: typeof row) => { r.trigger = ["placedInEnergy"]; }, (r: typeof row) => { r.cost!.text = "pay"; }, (r: typeof row) => { r.cond = { kind: "life", side: "you", atLeast: 1 }; },
        (r: typeof row) => { r.cost!.awakenAlternative = { version: 1, free: { kind: "life", side: "you", atMost: 4 }, host: { side: "you", area: "battle", filter: emptyFilter() }, count: 1 }; assert.equal(costRecordProblem(r.cost), null, "valid alternative price is still not an unpriced Permanent"); },
        (r: typeof row) => { r.cost!.spiritBoostPayer = { ...emptyFilter(), type: "UNISON" }; assert.match(costRecordProblem(r.cost)!, /Spirit Boost payer needs/); },
        (r: typeof row) => { r.ops.push({ op: "draw", n: 1 }); },
        (r: typeof row) => { r.ops = [{ op: "if", cond: { kind: "life", side: "you", atLeast: 1 }, then: r.ops }]; },
    ]) {
        const bad = copy(row);
        change(bad);
        assert.ok(runtimeSupportOfRow(bad).unsupported.length);
        const scripts = rulesFromRows([{ ...bad, id: 1, status: "draft", source: "compiler" } as unknown as RuleRow], defs);
        assert.ok(scripts[id].bySkill[10].unsupported.length);
        cases++;
    }
    cases++;
}
function setup(player: PlayerId) {
    const other: PlayerId = player === "p1" ? "p2" : "p1";
    let state = RULES.createGame(ctx, { seed: 507, p1: { name: "One", leader: "L", main: fifty("F") }, p2: { name: "Two", leader: "L", main: fifty("F") } }).state as VmState;
    const events: GameEvent[] = [];
    const take = (a: Action) => { const before = JSON.stringify(state), input = copy(state); for (const viewer of ["p1", "p2"] as const)
        RULES.boardView(ctx, copy(input), viewer, {}); const r = RULES.apply(ctx, input, a); assert.equal(JSON.stringify(input), before); state = r.state as VmState; events.push(...r.events); assert.equal(state.outcome, undefined, JSON.stringify(state.outcome)); };
    take({ type: "chooseFirst", player: state.chooser, first: player });
    take({ type: "mulligan", player, redraw: false });
    take({ type: "mulligan", player: other, redraw: false });
    const stage = (p: PlayerId, id: string, area: string) => { const c = state.sides[p].zones.deck.at(-1)!; state.cards[c].cardId = id; assert.ok(moveCard(state, game, c, area, { owner: p }).ok); return c; };
    return { get s() { return state; }, take, stage, events, other };
}
for (const id of ids)
    for (const player of ["p1", "p2"] as const)
        for (const answer of ["accept", "decline", "partial"] as const) {
            const t = setup(player), incoming = t.stage(player, id, "hand");
            const policy = compileEnergyEntryPolicy(parseSkills(defs[id].skill).find(s => s.index === 10)!)!;
            const payers = policy.colors.map(c => t.stage(player, c, "drop"));
            assert.equal(hasKeyword(ctx, game, t.s, incoming, "Energy-Exhaust"), true);
            assert.ok(energyEntrySource(ctx, t.s, incoming));
            if (answer === "partial")
                vmHost(ctx, game, t.s, []).addEffect({ target: payers[0], kind: "forbid", value: 0, until: "game", forbid: { what: "beMovedBySkill", fromArea: "drop", toArea: "warp", bySkill: true } });
            t.take({ type: "charge", player, card: incoming });
            assert.equal((() => t.s.prompt.kind)(), "chooseMode");
            assert.throws(() => RULES.apply(ctx, copy(t.s), { type: "chooseMode", player: t.other, index: 0 }));
            let pick = 0;
            while (t.s.prompt.kind === "chooseMode" || t.s.prompt.kind === "chooseCards") {
                assert.equal(t.s.prompt.player, player);
                assert.ok(t.s.sides[player].zones.hand.includes(incoming));
                assert.equal(hasKeyword(ctx, game, t.s, incoming, "Energy-Exhaust"), true);
                t.take(t.s.prompt.kind === "chooseMode" ? { type: "chooseMode", player, index: answer === "decline" ? 1 : 0 } : { type: "choose", player, cards: [payers[pick++]] });
            }
            assert.equal(t.s.phase, "main");
            assert.ok(t.s.sides[player].attrs.charged);
            assert.ok(t.s.sides[player].zones.energy.includes(incoming));
            assert.equal(t.events.filter(e => e.type === "skill" && e.card === incoming && e.skill === 10).length, 0, "Permanent descriptor is never an arrival Auto activation");
            const earned = answer === "accept";
            assert.equal(t.s.cards[incoming].mode, earned ? "active" : "rest");
            assert.equal(hasKeyword(ctx, game, t.s, incoming, "Energy-Exhaust"), !earned);
            const stamps = t.s.effects.filter(e => e.target === incoming && e.energyEntryEpoch !== undefined);
            assert.equal(stamps.length, earned ? 1 : 0);
            if (earned) {
                assert.equal(stamps[0].energyEntryEpoch, t.s.cards[incoming].zoneEpoch);
                assert.equal(stamps[0].source, incoming);
                assert.equal(stamps[0].master, player);
            }
            assert.equal(t.events.filter(e => e.type === "move" && e.card === incoming && e.to === "energy").length, 1);
            if (earned) {
                assert.ok(payers.every(id => t.s.sides[player].zones.warp.includes(id)));
                vmHost(ctx, game, t.s, []).move(incoming, "hand", player);
                assert.equal(hasKeyword(ctx, game, t.s, incoming, "Energy-Exhaust"), true);
                assert.equal(t.s.effects.some(e => e.target === incoming && e.energyEntryEpoch !== undefined), false);
            }
            if (answer === "partial") {
                assert.ok(t.s.sides[player].zones.drop.includes(payers[0]));
                assert.ok(t.s.sides[player].zones.warp.includes(payers[1]));
            }
            cases++;
        }
function advance(t: ReturnType<typeof setup>, stop: () => boolean) {
    for (let n = 0; n < 80; n++) {
        if (stop())
            return;
        const q = t.s.prompt;
        const legal = RULES.legalActions(ctx, t.s).map(x => x.action);
        const action = q.kind === "optionalCost" ? { type: "optionalCost", player: q.player, pay: true } as Action :
            q.kind === "orderPending" ? { type: "orderPending", player: q.player, index: t.s.pendingOrder!.candidates[0] } as Action :
                legal.find(a => a.type === "counter" && a.card === null) ?? legal.find(a => a.type === "chooseMode" && a.index === 0) ?? legal.find(a => a.type === "payCost") ?? legal.find(a => a.type === "block" && a.card === null) ?? legal.find(a => a.type === "zEnergyFromCombo" && a.card === null) ?? legal.find(a => a.type === "pass");
        assert.ok(action, JSON.stringify(q));
        t.take(action);
    }
    throw Error("native progression bound");
}
for (const player of ["p1", "p2"] as const)
    for (const mover of ["BT1-052", "P-656"] as const)
        for (const answer of ["accept", "decline"] as const) {
            const t = setup(player);
            t.take({ type: "charge", player, card: null });
            const owner = mover === "P-656" ? t.other : player;
            const incoming = t.stage(owner, "DB2-175", mover === "P-656" ? "battle" : "hand");
            const parent = t.stage(player, mover, "hand");
            const blue = t.stage(player, "Blue", "energy"), yellow = t.stage(player, mover === "P-656" ? "Yellow" : "Blue", "energy");
            t.s.cards[blue].mode = "active";
            t.s.cards[yellow].mode = "active";
            const payers = [t.stage(owner, "Red", "drop"), t.stage(owner, "Blue", "drop")];
            t.take({ type: "activate", player, card: parent, skill: mover === "P-656" ? 20 : 0 });
            advance(t, () => t.s.prompt.kind === "chooseCards" && t.s.prompt.choice.candidates.includes(incoming));
            assert.equal(t.s.cards[blue].mode, "rest");
            assert.equal(t.s.cards[yellow].mode, "rest", "full printed cost paid");
            t.take({ type: "choose", player, cards: [incoming] });
            while (t.s.programs.some(f => f.energyEntry)) {
                assert.equal("player" in t.s.prompt ? t.s.prompt.player : undefined, owner);
                const payer = t.s.prompt.kind === "chooseCards" ? payers.find(id => t.s.prompt.kind === "chooseCards" && t.s.prompt.choice.candidates.includes(id)) : undefined;
                if (t.s.prompt.kind === "chooseCards")
                    assert.ok(payer);
                t.take(t.s.prompt.kind === "chooseMode" ? { type: "chooseMode", player: owner, index: answer === "accept" ? 0 : 1 } : { type: "choose", player: owner, cards: [payer!] });
            }
            advance(t, () => t.s.prompt.kind === "main");
            assert.ok(t.s.sides[owner].zones.energy.includes(incoming));
            assert.equal(t.s.cards[incoming].mode, mover === "P-656" || answer === "decline" ? "rest" : "active");
            assert.equal(hasKeyword(ctx, game, t.s, incoming, "Energy-Exhaust"), answer === "decline");
            const stamp = t.s.effects.find(e => e.target === incoming && e.energyEntryEpoch !== undefined);
            assert.equal(!!stamp, answer === "accept");
            if (stamp) {
                assert.equal(stamp.source, incoming);
                assert.equal(stamp.master, owner);
                assert.equal(stamp.energyEntryEpoch, t.s.cards[incoming].zoneEpoch);
            }
            assert.equal(t.events.filter(e => e.type === "move" && e.card === incoming && e.to === "energy").length, 1);
            if (mover === "BT1-052")
                assert.ok(t.s.sides[player].zones.drop.includes(parent));
            cases++;
        }
function payEntry(t: ReturnType<typeof setup>, owner: PlayerId, payers: string[]) {
    while (t.s.programs.some(f => f.energyEntry)) {
        const q = t.s.prompt;
        assert.ok(q.kind === "chooseMode" || q.kind === "chooseCards");
        assert.equal(q.player, owner);
        const chosen = q.kind === "chooseCards" ? payers.find(id => q.choice.candidates.includes(id)) : undefined;
        if (q.kind === "chooseCards")
            assert.ok(chosen);
        t.take(q.kind === "chooseMode" ? { type: "chooseMode", player: owner, index: 0 } : { type: "choose", player: owner, cards: [chosen!] });
    }
}
for (const player of ["p1", "p2"] as const)
    for (const area of ["hand", "deck", "warp", "zEnergy", "battle"] as const) {
        const t = setup(player);
        t.take({ type: "charge", player, card: null });
        const parent = t.stage(player, `M-${area}`, "battle");
        const payers = [t.stage(player, "Red", "drop"), t.stage(player, "Blue", "drop")];
        const incoming = t.stage(player, "DB2-175", area);
        t.take({ type: "activate", player, card: parent, skill: 0 });
        if (t.s.prompt.kind === "chooseCards" && t.s.prompt.choice.candidates.includes(incoming))
            t.take({ type: "choose", player, cards: [incoming] });
        payEntry(t, player, payers);
        assert.ok(t.s.sides[player].zones.energy.includes(incoming));
        assert.equal(t.s.cards[incoming].mode, "active");
        assert.equal(hasKeyword(ctx, game, t.s, incoming, "Energy-Exhaust"), false);
        cases++;
    }
for (const turn of ["p1", "p2"] as const)
    for (const offense of [true, false])
        for (const origin of ["hand", "battle"] as const) {
            const t = setup(turn), player = offense ? turn : t.other;
            for (const a of [{ type: "charge", player: turn, card: null }, { type: "endMain", player: turn }, { type: "charge", player: t.other, card: null }, { type: "endMain", player: t.other }, { type: "charge", player: turn, card: null }] as Action[])
                t.take(a);
            const incoming = t.stage(player, "DB2-175", origin), attacker = t.stage(turn, "A", "battle"), guard = t.stage(t.other, "G", "battle");
            t.s.cards[guard].mode = "rest";
            const payers = [t.stage(player, "Red", "drop"), t.stage(player, "Blue", "drop")];
            const energy = t.stage(player, "Blue", "energy");
            t.s.cards[energy].mode = "active";
            t.take({ type: "attack", player: turn, attacker, target: guard });
            advance(t, () => t.s.prompt.kind === "combo" && t.s.prompt.player === player);
            t.take({ type: "combo", player, card: incoming });
            advance(t, () => t.s.prompt.kind === "combo" && t.s.prompt.player === player);
            assert.equal(t.s.battle!.comboOrigins![incoming], origin);
            t.take({ type: "activate", player, card: t.s.sides[player].zones.leader[0], skill: 0 });
            if (t.s.prompt.kind === "chooseCards" && t.s.prompt.choice.candidates.includes(incoming))
                t.take({ type: "choose", player, cards: [incoming] });
            payEntry(t, player, payers);
            assert.ok(t.s.sides[player].zones.energy.includes(incoming));
            assert.equal(t.s.cards[incoming].mode, "active");
            assert.equal(hasKeyword(ctx, game, t.s, incoming, "Energy-Exhaust"), false);
            cases++;
        }
for (const player of ["p1", "p2"] as const) {
    const t = setup(player), incoming = t.stage(player, "DB2-175", "hand");
    for (const mutate of [
        (c: EngineContext) => { delete c.scripts!["DB2-175"].bySkill[10].price; },
        (c: EngineContext) => { c.scripts!["DB2-175"].bySkill[10].usage!.oncePerTurn = true; },
        (c: EngineContext) => { c.scripts!["DB2-175"].bySkill[10].price!.payment.marker = 0; },
        (c: EngineContext) => { c.scripts!["DB2-175"].bySkill[10].price!.condition = { kind: "life", side: "you", atLeast: 1 }; },
        (c: EngineContext) => { c.scripts!["DB2-175"].bySkill[10].trigger = ["placedInEnergy"]; },
        (c: EngineContext) => { c.scripts!["DB2-175"].bySkill[10].price!.payment.spiritBoostPayer = { ...emptyFilter(), type: "UNISON" }; },
    ]) {
        const c = copy(ctx);
        mutate(c);
        assert.throws(() => energyEntrySource(c, t.s, incoming), /Energy entry source descriptor/);
        cases++;
    }
    t.take({ type: "charge", player, card: incoming });
    while (t.s.prompt.kind === "chooseMode")
        t.take({ type: "chooseMode", player, index: 0 });
    assert.equal(t.s.cards[incoming].mode, "rest");
    assert.equal(hasKeyword(ctx, game, t.s, incoming, "Energy-Exhaust"), true);
    cases++;
}
console.log(`Energy admission: ${cases} source and native Charge cases passed`);
