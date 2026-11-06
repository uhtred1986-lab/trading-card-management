/** R526 staged structural proofs using full source definitions, not gameplay admission. */
import assert from "node:assert/strict";
import areaSources from "./fixtures/combo-standing-source.json";
import underSources from "./fixtures/under-standing-observer-5.json";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import type { CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { vmHost } from "../../src/lib/arena/vm/host";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { discoverNativeAreaStandingFacts } from "../../src/lib/arena/vm/standing-negation-native-facts";
import { discoverUnderStandingCandidates, discoverUnderStandingProtection, underStandingCandidateFacts } from "../../src/lib/arena/vm/standing-negation-under-observation";
import { underStandingSourceKey } from "../../src/lib/arena/vm/standing-negation-under-relation";
import { NotYet } from "../../src/lib/arena/vm/errors";
import { reviewUnderStandingDefinitions } from "../../src/lib/arena/vm/standing-negation-under-definition";
import { initializeJointStandingProof as initialize, assertJointStandingProof as read,
    captureJointStandingBoundary as capture, finishJointStandingBoundary as finish,
    type JointStandingIntent } from "../../src/lib/arena/vm/standing-negation-joint-facts";
const defs: EngineContext["defs"] = { L: card("L", { type: "LEADER", skill: null }), F: card("F", { skill: null }) };
for (const [id, { card: c }] of Object.entries({ ...areaSources, ...underSources })) {
    defs[id] = card(id, { name: c.name, type: c.type as CardDef["type"], colors: c.colors as CardDef["colors"],
        energyCost: c.cost === null ? null : Number(c.cost), power: c.power, characters: c.characters, traits: c.traits, skill: c.skill });
}
const ctx: EngineContext = { defs, scripts: rulesFromRows(Object.values(defs).flatMap(skillRecords).map((r, id) =>
    ({ ...r, id, status: r.unread.length ? "open" : "confirmed", source: "compiler" }) as RuleRow), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const reviewed = reviewUnderStandingDefinitions(ctx, "BT23-070", "front");
const other = (p: PlayerId): PlayerId => p === "p1" ? "p2" : "p1";
let checks = 0;
function test(name: string, run: () => void) { run(); checks++; console.log(`PASS ${name}`); }
function setup(p: PlayerId, hostCard = "BT1-034", foreign = false, prepare?: (state: VmState, stage: (owner: PlayerId, id: string, zone: string) => string) => void) {
    const state = RULES.createGame({ defs: { L: defs.L, F: defs.F } }, { seed: 526,
        p1: { name: "One", leader: "L", main: fifty("F"), z: [] }, p2: { name: "Two", leader: "L", main: fifty("F"), z: [] } }).state as VmState;
    const stage = (owner: PlayerId, id: string, zone: string) => {
        const key = state.sides[owner].zones.deck.at(-1)!; state.cards[key].cardId = id;
        assert.ok(moveCard(state, game, key, zone, { owner }).ok); return key;
    };
    const host = stage(p, hostCard, "hand"), source = stage(foreign ? other(p) : p, "BT23-070", "drop");
    prepare?.(state, stage);
    let proof = initialize(ctx, game, state, reviewed);
    const act = (intent: JointStandingIntent, action: () => void) => {
        const boundary = capture(ctx, game, state, proof, intent); action();
        const result = finish(ctx, game, state, boundary); proof = result.proof; return result;
    };
    const enter = () => act({ kind: "areaMove", card: host, to: "battle" }, () => { assert.ok(moveCard(state, game, host, "battle", { owner: p }).ok); });
    const attach = () => act({ kind: "attach", source, host }, () => { assert.ok(vmHost(ctx, game, state, []).placeUnder(source, host)); });
    return { state, host, source, enter, attach, act, get proof() { return proof; } };
}
for (const p of ["p1", "p2"] as const) {
    for (const id of ["BT1-034", "BT1-043", "TB1-097"]) for (const foreign of [false, true]) test(`${p} ${id} independent ban / owner ${foreign}`, () => {
        const t = setup(p, id, foreign); t.enter(); const result = t.attach();
        assert.equal(result.plan.negate.length, id === "BT1-034" ? 1 : 0); assert.equal(result.plan.forbidAttack.length, 1);
        assert.equal(result.sources[0].master, p); assert.equal(result.sources[0].owner, foreign ? other(p) : p);
        assert.deepEqual(ctx.scripts!["BT23-070"].bySkill[0].unsupported, reviewed[0].script.unsupported);
        const before = JSON.stringify(t.state); const readback = read(ctx, game, t.state, t.proof);
        readback.history.active.length = 0; assert.equal(read(ctx, game, t.state, t.proof).history.active.length, 1);
        assert.equal(JSON.stringify(t.state), before);
    });
    for (const id of ["DB1-066", "BT10-153"]) test(`${p} existing ${id} then attach retires the older host generation`, () => {
        const t = setup(p, id); const old = t.enter(); assert.equal(old.history.active[0].serial, 1);
        const boundary = capture(ctx, game, t.state, t.proof, { kind: "attach", source: t.source, host: t.host });
        assert.ok(moveCard(t.state, game, t.source, "battle", { owner: p, under: t.host }).ok);
        const before = JSON.stringify(t.state);
        const result = finish(ctx, game, t.state, boundary);
        assert.equal(JSON.stringify(t.state), before); assert.equal(old.history.active[0].serial, 1);
        assert.equal(result.history.active.length, 1);
        assert.equal(result.history.active[0].serial, 2);
        assert.equal(result.plan.negate[0].target.card, t.host);
        assert.equal(result.plan.forbidAttack[0].target.card, t.host);
        const disabled = capture(ctx, game, t.state, result.proof, { kind: "effects" });
        addEffect(t.state, [], { target: t.source, kind: "negateSkills", value: 0, until: "turn" });
        const restored = finish(ctx, game, t.state, disabled);
        assert.equal(restored.history.active[0].serial, 3);
        assert.equal("kind" in restored.history.active[0].source, false);
    });
    test(`${p} detach and fresh reattach allocates new under generation`, () => {
        const t = setup(p); t.enter(); const first = t.attach();
        t.act({ kind: "detach", source: t.source, host: t.host }, () => { assert.ok(moveCard(t.state, game, t.source, "drop", { owner: p }).ok); });
        const next = t.attach(); assert.equal(next.history.active[0].serial, first.history.active[0].serial + 1);
    });
    test(`${p} crossboard, cloned token and stale board refuse`, () => {
        const t = setup(p), u = setup(p); t.enter(); u.enter();
        assert.throws(() => read(ctx, game, u.state, t.proof), NotYet);
        assert.throws(() => read(ctx, game, t.state, structuredClone(t.proof)), NotYet);
        const boundary = capture(ctx, game, t.state, t.proof, { kind: "effects" });
        assert.throws(() => finish(ctx, game, u.state, boundary), NotYet);
        t.state.cards[t.host].zoneEpoch = (t.state.cards[t.host].zoneEpoch ?? 0) + 1; const before = JSON.stringify(t.state);
        assert.throws(() => finish(ctx, game, t.state, boundary), NotYet); assert.equal(JSON.stringify(t.state), before);
    });
    test(`${p} whole source negation suppresses independent outputs`, () => {
        const t = setup(p); t.enter(); t.attach();
        const off = t.act({ kind: "effects" }, () => { addEffect(t.state, [], { target: t.source, kind: "negateSkills", value: 0, until: "turn" }); });
        assert.equal(off.plan.negate.length, 0); assert.equal(off.plan.forbidAttack.length, 0);
    });
    test(`${p} full P680 broad protection remains refused`, () => {
        const t = setup(p, "P-680");
        assert.throws(() => t.enter(), NotYet);
    });
    test(`${p} staged initialization cannot reset an active source or attached source`, () => {
        const t = setup(p, "DB1-066"); t.enter();
        assert.throws(() => initialize(ctx, game, t.state, reviewed), NotYet);
        const u = setup(p); u.enter(); u.attach(); assert.throws(() => initialize(ctx, game, u.state, reviewed), NotYet);
    });
}
for (const p of ["p1", "p2"] as const) {
    test(`${p} actual captured Goku role and six/seven/eight Combo observations`, () => {
        const own: string[] = []; let prum = "";
        const t = setup(p, "BT20-086", false, (_state, stage) => {
            for (let i = 0; i < 8; i++) own.push(stage(p, "F", "hand"));
            prum = stage(other(p), "DB2-086", "hand");
        });
        const old = t.state.sides[p].zones.leader[0];
        const move = (id: string, to: "leader" | "combo" | "drop") => t.act({ kind: "areaMove", card: id, to }, () => {
            assert.ok(moveCard(t.state, game, id, to, { owner: t.state.cards[id].owner }).ok);
        });
        move(old, "drop"); move(t.host, "leader"); move(prum, "combo");
        const guard = t.state.sides[other(p)].zones.leader[0];
        t.act({ kind: "beginBattle", attacker: t.host, guard }, () => {
            t.state.battle = { attacker: t.host, guard, target: guard, step: "offense", negated: true, blockerOffered: false, counters: [] };
        });
        for (let i = 0; i < own.length; i++) {
            const result = move(own[i], "combo");
            assert.equal(result.plan.negate.some(edge => edge.target.card === prum), i >= 6);
        }
        const serial = read(ctx, game, t.state, t.proof).history.active[0].serial;
        move(own[7], "drop"); assert.equal(read(ctx, game, t.state, t.proof).history.active[0].serial, serial);
        move(own[6], "drop"); assert.equal(read(ctx, game, t.state, t.proof).history.active.length, 0);
        t.act({ kind: "endBattle" }, () => { delete t.state.battle; });
        assert.equal(read(ctx, game, t.state, t.proof).observation.area.battle, null);
    });
    test(`${p} foreign-owned Combo host uses actual area holder`, () => {
        const t = setup(p, "BT1-043", false, (state) => {
            // Host was staged in this player's Hand. Physical owner intentionally
            // differs; this is a relation mechanism, not a control-card action.
            const id = state.sides[p].zones.hand.find(id => state.cards[id].cardId === "BT1-043")!;
            state.cards[id].owner = other(p);
            assert.ok(moveCard(state, game, id, "combo", { owner: p }).ok);
        });
        const result = t.attach();
        assert.equal(result.sources[0].master, p);
        assert.equal(result.observation.under[0].relation.host.owner, other(p));
        assert.equal(result.plan.negate.length, 1, "Battle self immunity is inactive in Combo");
        assert.equal(result.plan.forbidAttack.length, 1);
    });
    test(`${p} both views and board remain free of isolated private facts`, () => {
        const t = setup(p); t.enter(); t.attach();
        for (const viewer of [p, other(p)]) assert.doesNotMatch(JSON.stringify(RULES.boardView(ctx, t.state, viewer, {})),
            /isolated-review-only|underAwareWholeV1|definitionIdentity|deleteGrants|JointStanding/);
        assert.equal(t.state.mixedStandingNegationHistory, undefined);
        assert.equal(t.state.standingNegationHistory, undefined);
    });
}
for (const p of ["p1", "p2"] as const) {
    test(`${p} opaque discovery cannot authorize another same-ID board`, () => {
        const t = setup(p), u = setup(p);
        const under = discoverUnderStandingCandidates(ctx, game, t.state, reviewed);
        const area = discoverNativeAreaStandingFacts(ctx, game, u.state, null);
        assert.throws(() => discoverUnderStandingProtection(ctx, game, t.state, under, area), NotYet);
        assert.throws(() => discoverUnderStandingProtection(ctx, game, u.state, under), NotYet);
        assert.throws(() => discoverUnderStandingProtection(ctx, game, t.state, structuredClone(under)), NotYet);
        t.state.cards[t.host].owner = other(p);
        assert.throws(() => discoverUnderStandingProtection(ctx, game, t.state, under), NotYet);
    });
    test(`${p} changed original definitions and copied protection refuse purely`, () => {
        const t = setup(p); t.enter();
        const boundary = capture(ctx, game, t.state, t.proof, { kind: "effects" });
        const before = ctx.defs["BT1-034"].name;
        ctx.defs["BT1-034"].name += " altered";
        try { assert.throws(() => finish(ctx, game, t.state, boundary), NotYet); }
        finally { ctx.defs["BT1-034"].name = before; }
        addEffect(t.state, [], { target: t.host, kind: "copiedSkills", value: 0, until: "turn",
            copied: { cardId: "BT23-070", side: "front", skills: [0], from: t.source } });
        const snapshot = JSON.stringify(t.state);
        assert.throws(() => finish(ctx, game, t.state, boundary), NotYet); assert.equal(JSON.stringify(t.state), snapshot);
    });
    test(`${p} timed protection and uncaptured participant changes refuse`, () => {
        const t = setup(p); t.enter();
        const boundary = capture(ctx, game, t.state, t.proof, { kind: "effects" });
        addEffect(t.state, [], { target: t.host, kind: "forbid", value: 0, until: "turn", forbid: { what: "beNegated" } });
        assert.throws(() => finish(ctx, game, t.state, boundary), NotYet);
        const u = setup(p); u.enter(); const changed = capture(ctx, game, u.state, u.proof, { kind: "effects" });
        const guard = u.state.sides[other(p)].zones.leader[0];
        u.state.battle = { attacker: u.host, guard, target: guard, step: "offense", negated: false, blockerOffered: false, counters: [] };
        assert.throws(() => finish(ctx, game, u.state, changed), NotYet);
    });
}
for (const p of ["p1", "p2"] as const) {
    test(`${p} inactive unrelated flat pile has complete physical proof`, () => {
        const t = setup(p, "BT1-034", false, (state, stage) => {
            const outer = stage(p, "F", "battle"), material = stage(p, "F", "hand");
            assert.ok(moveCard(state, game, material, "battle", { owner: p, under: outer }).ok);
        });
        t.enter(); t.attach(); assert.equal(read(ctx, game, t.state, t.proof).plan.forbidAttack.length, 1);
    });
    test(`${p} nested unrelated pile cannot masquerade as inactive material`, () => {
        assert.throws(() => setup(p, "BT1-034", false, (state, stage) => {
            const outer = stage(p, "F", "battle"), material = stage(p, "F", "hand"), inner = stage(p, "F", "drop");
            assert.ok(moveCard(state, game, material, "battle", { owner: p, under: outer }).ok);
            state.sides[p].zones.drop = state.sides[p].zones.drop.filter(id => id !== inner);
            state.cards[material].under.push(inner);
        }), NotYet);
    });
}
for (const p of ["p1", "p2"] as const) test(`${p} supplied order binds discovered keys and failed validation does not advance`, () => {
    const t = setup(p); t.enter();
    const boundary = capture(ctx, game, t.state, t.proof, { kind: "attach", source: t.source, host: t.host });
    assert.ok(vmHost(ctx, game, t.state, []).placeUnder(t.source, t.host));
    const snapshot = JSON.stringify(t.state);
    assert.throws(() => finish(ctx, game, t.state, boundary, ["invented-source"]), NotYet);
    assert.equal(JSON.stringify(t.state), snapshot);
    const discovery = discoverUnderStandingCandidates(ctx, game, t.state, reviewed);
    const key = underStandingSourceKey(underStandingCandidateFacts(ctx, game, t.state, discovery).under[0].source);
    assert.equal(finish(ctx, game, t.state, boundary, [key]).history.active[0].serial, 1);
    assert.throws(() => finish(ctx, game, t.state, boundary, [key]), NotYet);
});
for (const p of ["p1", "p2"] as const) for (const id of ["DB1-066", "BT10-153"]) test(`${p} ${id} under-first, detach, reattach retains genuine generation history`, () => {
    const t = setup(p, id);
    let external = -1;
    t.act({ kind: "effects" }, () => { external = addEffect(t.state, [], { target: t.host, kind: "negateSkills", value: 0, until: "turn" }).id; });
    t.enter();
    const first = t.act({ kind: "attach", source: t.source, host: t.host }, () => {
        assert.ok(moveCard(t.state, game, t.source, "battle", { owner: p, under: t.host }).ok);
    });
    assert.equal(first.history.active[0].serial, 1);
    const hostEnabled = t.act({ kind: "effects" }, () => { t.state.effects = t.state.effects.filter(effect => effect.id !== external); });
    assert.equal(hostEnabled.history.active[0].serial, 1);
    assert.equal("kind" in hostEnabled.history.active[0].source, true);
    const detached = t.act({ kind: "detach", source: t.source, host: t.host }, () => {
        assert.ok(moveCard(t.state, game, t.source, "drop", { owner: p }).ok);
    });
    assert.equal(detached.history.active[0].serial, 2);
    assert.equal("kind" in detached.history.active[0].source, false);
    const reattached = t.act({ kind: "attach", source: t.source, host: t.host }, () => {
        assert.ok(moveCard(t.state, game, t.source, "battle", { owner: p, under: t.host }).ok);
    });
    assert.equal(reattached.history.active[0].serial, 3);
    assert.equal("kind" in reattached.history.active[0].source, true);
    assert.equal(reattached.history.seen[0].epoch, t.state.cards[t.source].zoneEpoch);
});
for (const p of ["p1", "p2"] as const) for (const id of ["BT1-043", "TB1-097"]) for (const kind of ["negateSkills", "negateSkill"] as const)
    test(`${p} ${id} ${kind} preserves original under suppression and bounds reactivation`, () => {
        const t = setup(p, id); t.enter(); let effectId = -1;
        const line = Object.entries(ctx.scripts![id].bySkill).find(([, script]) => script.ops.some(op => op.op === "forbid" && op.what === "beNegated"));
        assert.ok(line);
        t.act({ kind: "effects" }, () => { effectId = addEffect(t.state, [], { target: t.host, kind, value: kind === "negateSkill" ? Number(line[0]) : 0, until: "turn" }).id; });
        const attached = t.attach(); assert.equal(attached.plan.negate.length, 1);
        const retained = t.act({ kind: "effects" }, () => { t.state.effects = t.state.effects.filter(effect => effect.id !== effectId); });
        assert.equal(retained.plan.negate.length, 1); assert.equal(retained.plan.forbidAttack.length, 1);
        assert.equal(retained.history.active[0].serial, attached.history.active[0].serial);
        const ending = capture(ctx, game, t.state, t.proof, { kind: "detach", source: t.source, host: t.host });
        assert.ok(moveCard(t.state, game, t.source, "drop", { owner: p }).ok);
        const before = JSON.stringify(t.state);
        assert.throws(() => finish(ctx, game, t.state, ending), /reactivation or changed suppressor feedback/);
        assert.equal(JSON.stringify(t.state), before);
    });
for (const p of ["p1", "p2"] as const) test(`${p} original and newly resolved grants produce defensive all-current deletion plan only`, () => {
    let original = -1;
    const t = setup(p, "BT1-034", false, (state) => {
        const host = state.sides[p].zones.hand.find(id => state.cards[id].cardId === "BT1-034")!;
        assert.ok(moveCard(state, game, host, "battle", { owner: p }).ok);
        original = addEffect(state, [], { target: host, kind: "copiedSkills", value: 0, until: "turn",
            copied: { cardId: "BT7-008", side: "front", skills: [0], from: host } }).id;
    });
    const attached = t.attach(); assert.deepEqual(attached.plan.deleteGrants, [{ effect: original, target: t.host }]);
    assert.ok(t.state.effects.some(effect => effect.id === original));
    assert.deepEqual(read(ctx, game, t.state, t.proof).plan.deleteGrants, attached.plan.deleteGrants);
    let added = -1;
    const next = t.act({ kind: "effects" }, () => { added = addEffect(t.state, [], { target: t.host, kind: "keyword", value: { name: "Blocker" }, until: "turn" }).id; });
    assert.deepEqual(next.plan.deleteGrants, [{ effect: original, target: t.host }, { effect: added, target: t.host }]);
    next.plan.deleteGrants.length = 0;
    assert.equal(read(ctx, game, t.state, t.proof).plan.deleteGrants.length, 2);
    assert.ok(t.state.effects.some(effect => effect.id === added));
});
console.log(`standing-joint-facts-5: ${checks} isolated structural cases PASS`);
