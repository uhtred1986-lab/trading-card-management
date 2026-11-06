/** R526 supplied-fact reducer proofs; full actual source observation is tested separately. */
import assert from "node:assert/strict";
import { emptyUnderStandingHistory as empty, settleUnderStanding as settle, validateUnderStandingHistory as validate,
    type UnderObservation, type UnderHistory } from "../../src/lib/arena/vm/standing-negation-under-history";
import { underStandingSourceKey } from "../../src/lib/arena/vm/standing-negation-under-relation";
import { mixedStandingNegationSourceKey } from "../../src/lib/arena/vm/standing-negation-mixed-history";
import type { MixedStandingNegationCard as Card, MixedStandingNegationSource as Source } from "../../src/lib/arena/vm/standing-negation-mixed-history";
import type { PlayerId } from "../../src/lib/arena/types";
import { NotYet } from "../../src/lib/arena/vm/errors";
const copy = <T,>(v: T): T => structuredClone(v);
const key = (source: UnderHistory["active"][number]["source"]) => "kind" in source ? underStandingSourceKey(source) : mixedStandingNegationSourceKey(source);
let checks = 0;
function test(name: string, run: () => void) { run(); checks++; console.log(`PASS ${name}`); }
function board(p: PlayerId) {
    const card = (id: string): Card => ({ card: id, cardId: id, epoch: 1, hiddenCount: 0, side: "front", master: p, holder: p, owner: p, area: "battle" });
    const host = card("host"), other = card("other"), target = card("target");
    const area = (c: Card, targets: Card[]) => ({ source: { ...c, policy: "otherBattleWholeV1", skillIndex: 0, skillIdentity: `supplied ${c.card} policy` } as Source, externalEnabled: true, targets });
    const occurrence = { card: "buried", cardId: "BT23-070", epoch: 2, hiddenCount: 0, side: "front" as const, owner: p };
    const under = { source: { kind: "under" as const, policy: "battleOnTopNegationAndAttackBanV1" as const,
        occurrence, skillIndex: 0, skillIdentity: "supplied under policy" }, relation: { source: occurrence, host, position: 0 },
        externalEnabled: true, negateTargets: [host], attackBanTargets: [host] };
    const observation: UnderObservation = { version: 3, policy: "underAwareWholeV1",
        area: { version: 2, policy: "mixedWholeV1", cards: [host, other, target], battle: null, candidates: [] },
        piles: [{ host, type: "BATTLE", hidden: false, cards: ["buried"] }], under: [under] };
    return { host, other, target, under, observation, area };
}
for (const p of ["p1", "p2"] as const) {
    for (const underFirst of [false, true]) test(`${p} explicit fresh independent order ${underFirst}`, () => {
        const b = board(p), o = b.observation;
        o.area.candidates = [b.area(b.other, [b.target])];
        const ordered = [key(o.area.candidates[0].source), key(b.under.source)]; if (underFirst) ordered.reverse();
        assert.throws(() => settle(empty(), o), NotYet);
        const h = settle(empty(), o, [], ordered);
        assert.deepEqual(h.active.map(g => key(g.source)), ordered);
        assert.deepEqual(h.active.map(g => g.serial), [1, 2]); validate(h);
        assert.deepEqual(settle(h, copy(o)).active, h.active);
    });
    test(`${p} newest under suppresses old host but preserves unaffected old serial`, () => {
        const b = board(p), old = copy(b.observation); old.under = []; old.piles = [];
        old.area.candidates = [b.area(b.host, [b.target]), b.area(b.other, [])];
        const h = settle(empty(), old, [], old.area.candidates.map(c => key(c.source)));
        const next = copy(b.observation); next.area.candidates = copy(old.area.candidates);
        const result = settle(h, next);
        assert.deepEqual(result.active.map(g => g.serial), [2, 3]);
        assert.equal(key(result.active[0].source), key(old.area.candidates[1].source));
        assert.equal(key(result.active[1].source), key(b.under.source));
        assert.equal(result.nextSerial, 4); assert.equal(h.nextSerial, 3);
        const off = copy(next); off.under[0].externalEnabled = false;
        const restored = settle(result, off);
        assert.deepEqual(restored.active.map(g => g.serial), [2, 4]);
        assert.equal(key(restored.active[1].source), key(old.area.candidates[0].source));
    });
    for (const reversed of [false, true]) test(`${p} multiple newly enabled areas retain explicit order ${reversed}`, () => {
        const b = board(p), before = b.observation;
        before.area.candidates = [b.area(b.host, [b.other]), b.area(b.other, [b.host])];
        before.area.candidates.forEach(candidate => { candidate.externalEnabled = false; });
        const h = settle(empty(), before);
        const next = copy(before); next.under[0].externalEnabled = false;
        next.area.candidates.forEach(candidate => { candidate.externalEnabled = true; });
        assert.throws(() => settle(h, next), NotYet);
        const order = next.area.candidates.map(c => key(c.source)); if (reversed) order.reverse();
        const result = settle(h, next, [], order);
        assert.equal(result.active.length, 1); assert.equal(key(result.active[0].source), order[0]);
        assert.equal(result.active[0].serial, 2);
    });
    test(`${p} dependency pre-disables fresh host even when explicitly ordered before under`, () => {
        const b = board(p), o = b.observation; o.area.candidates = [b.area(b.host, [b.target]), b.area(b.other, [])];
        const order = [key(o.area.candidates[0].source), key(o.area.candidates[1].source), key(b.under.source)];
        const h = settle(empty(), o, [], order);
        assert.deepEqual(h.active.map(g => key(g.source)), order.slice(1));
        assert.deepEqual(h.active.map(g => g.serial), [1, 2]);
        assert.throws(() => settle(empty(), o, [], [order[1], order[1], order[2]]), NotYet);
        assert.throws(() => settle(empty(), o, [], ["forged", order[2]]), NotYet);
    });
    test(`${p} validator rejects restored blocked host and noncanonical edge serials`, () => {
        const b = board(p), old = copy(b.observation); old.under = []; old.piles = [];
        old.area.candidates = [b.area(b.host, [b.target])];
        const h = settle(empty(), old); const next = copy(b.observation); next.area.candidates = copy(old.area.candidates);
        const result = settle(h, next);
        const forged = copy(result); forged.active.unshift(h.active[0]);
        assert.throws(() => validate(forged), NotYet);
        const wrong = copy(result); wrong.negated[0].serial = 1;
        assert.throws(() => validate(wrong), NotYet);
    });
}
console.log(`standing-joint-priority-5: ${checks} supplied-fact cases PASS`);
