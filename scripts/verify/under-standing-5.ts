/** Isolated supplied-fact contracts; no native observer/writer or product admission claim. */
import assert from "node:assert/strict";
import source from "./fixtures/under-standing-5.json";
import { card } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { standingUnderDescriptor, standingUnderPrinted, standingUnderScript } from "../../src/lib/arena/vm/standing-negation-under-policy";
import { emptyUnderStandingHistory as empty, settleUnderStanding as settle, readUnderStandingPlan as read,
    validateUnderStandingHistory as validate, type UnderObservation as Observation } from "../../src/lib/arena/vm/standing-negation-under-history";
import { underStandingSourceKey as key, type UnderRelationChange } from "../../src/lib/arena/vm/standing-negation-under-relation";
import * as v2 from "../../src/lib/arena/vm/standing-negation-mixed-history";
import type { PlayerId } from "../../src/lib/arena/types";
import { NotYet } from "../../src/lib/arena/vm/errors";
const copy = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
let count = 0;
const test = (name: string, f: () => void) => { f(); count++; console.log(`PASS ${name}`); };
const refused = (f: () => unknown) => assert.throws(f, NotYet);
const actual = source["BT23-070"].card;
const def = card(actual.id, { ...actual, type: "EXTRA", colors: ["Blue"], energyCost: Number(actual.cost) });
const records = skillRecords(def);
const scripts = rulesFromRows(records.map((r, id) => ({ ...r, id, status: r.unread.length ? "open" : "confirmed", source: "compiler" }) as RuleRow), { [def.id]: def })[def.id];
// The production loader still rejects #0. Only a local helper candidate removes
// that known admission label; complete original source and siblings stay frozen.
const candidate = { ...scripts.bySkill[0], unsupported: [] };
test("full frozen source records unchanged and not admitted", () => {
    assert.deepEqual(copy(records), Object.values(source["BT23-070"].records));
    assert.ok(scripts.bySkill[0].unsupported.length);
    assert.ok(scripts.bySkill[10].unsupported.length); assert.ok(scripts.bySkill[20].unsupported.length);
    assert.ok(standingUnderPrinted(parseSkills(def.skill).find(s => s.index === 0)!));
    assert.ok(standingUnderDescriptor(candidate.ops)); assert.ok(standingUnderScript(candidate));
});
for (const [name, change] of Object.entries({
    price: (s: typeof candidate) => { s.price!.payment.orbs = { any: 1 }; },
    usage: (s: typeof candidate) => { s.usage!.oncePerTurn = true; },
    trigger: (s: typeof candidate) => { s.trigger = ["played"]; },
    partial: (s: typeof candidate) => { s.ops.pop(); },
    reversed: (s: typeof candidate) => { s.ops.reverse(); },
    extra: (s: typeof candidate) => { s.ops.push({ op: "draw", n: 1 }); },
})) test(`whole policy rejects ${name}`, () => { const s = copy(candidate); change(s); assert.equal(standingUnderScript(s), false); });
function board(p: PlayerId): Observation {
    const host: v2.MixedStandingNegationCard = { card: "host", cardId: "BT1-034", epoch: 1, hiddenCount: 0,
        side: "front", master: p, holder: p, owner: p, area: "battle" };
    const occurrence = { card: "attached", cardId: "BT23-070", epoch: 2, hiddenCount: 0, side: "front" as const, owner: p === "p1" ? "p2" as const : "p1" as const };
    return { version: 3, policy: "underAwareWholeV1", area: { version: 2, policy: "mixedWholeV1", cards: [host], battle: null, candidates: [] },
        piles: [{ host, type: "BATTLE", hidden: false, cards: [occurrence.card] }], under: [{
            source: { kind: "under", policy: "battleOnTopNegationAndAttackBanV1", occurrence, skillIndex: 0, skillIdentity: JSON.stringify(candidate) },
            relation: { source: occurrence, host, position: 0 }, externalEnabled: true, negateTargets: [host], attackBanTargets: [host],
        }] };
}
for (const p of ["p1", "p2"] as const) {
    const b = board(p), h = settle(empty(), b);
    test(`${p} foreign physical owner, separate immutable outputs`, () => {
        const before = JSON.stringify({ b, h }), plan = read(h, b);
        assert.equal(plan.negate.length, 1); assert.equal(plan.forbidAttack.length, 1);
        plan.negate[0].target.card = "mutated";
        assert.equal(JSON.stringify({ b, h }), before);
        assert.equal(h.active[0].serial, 1);
    });
    test(`${p} negation immunity does not remove attack ban`, () => {
        const next = copy(b); next.under[0].negateTargets = [];
        const result = settle(h, next);
        assert.equal(result.negated.length, 0); assert.equal(result.attackBans.length, 1);
        assert.equal(result.active[0].serial, 1);
    });
    test(`${p} source suppression stops both and reenable allocates fresh generation`, () => {
        const next = copy(b); next.under[0].externalEnabled = false;
        const off = settle(h, next), on = settle(off, b);
        assert.equal(off.negated.length + off.attackBans.length, 0); assert.equal(on.active[0].serial, 2);
    });
    test(`${p} exact reorder receipt preserves key and serial`, () => {
        const next = copy(b); next.piles[0].cards.unshift("other material"); next.under[0].relation.position++;
        refused(() => settle(h, next));
        const receipt: UnderRelationChange = { kind: "reorder", before: b.under[0].relation, after: next.under[0].relation };
        assert.equal(key(next.under[0].source), key(b.under[0].source));
        assert.equal(settle(h, next, [receipt]).active[0].serial, 1);
        refused(() => settle(h, next, [receipt, receipt]));
    });
    test(`${p} cross-area carry is refused at exact and jumped epochs`, () => {
        const next = copy(b), host = { ...next.area.cards[0], area: "combo" as const, epoch: 2 };
        next.area.cards = [host]; next.piles[0].host = host; next.under[0].relation.host = host;
        next.under[0].negateTargets = [host]; next.under[0].attackBanTargets = [host];
        const receipt = { kind: "carry", before: b.under[0].relation, after: next.under[0].relation } as unknown as UnderRelationChange;
        refused(() => settle(h, next)); refused(() => settle(h, next, [receipt]));
        const skipped = copy(next); skipped.area.cards[0].epoch = 5; skipped.piles[0].host.epoch = 5;
        skipped.under[0].relation.host.epoch = 5; skipped.under[0].negateTargets[0].epoch = 5; skipped.under[0].attackBanTargets[0].epoch = 5;
        refused(() => settle(h, skipped, [{ ...receipt, after: skipped.under[0].relation }]));
    });
    test(`${p} detach cannot resurrect old occurrence`, () => {
        const gone = copy(b); gone.under = []; gone.piles = [];
        const detached = settle(h, gone); refused(() => settle(detached, b));
        const fresh = copy(b); fresh.under[0].source.occurrence.epoch++; fresh.under[0].relation.source.epoch++;
        assert.equal(settle(detached, fresh).active[0].serial, 2);
    });
    for (const [name, change] of Object.entries({
        duplicate: (o: Observation) => { o.piles[0].cards.push("attached"); },
        zoneMember: (o: Observation) => { o.piles[0].cards.push("host"); },
        wrongPosition: (o: Observation) => { o.under[0].relation.position = 2; },
        missingHost: (o: Observation) => { o.area.cards = []; },
        wrongTarget: (o: Observation) => { o.under[0].negateTargets[0] = { ...o.area.cards[0], card: "other" }; },
        wrongSource: (o: Observation) => { o.under[0].relation.source.owner = p; },
    })) test(`${p} malformed ${name} refuses`, () => { const next = copy(b); change(next); refused(() => settle(h, next)); });
    test(`${p} stale read and malformed history refuse`, () => {
        const changed = copy(b); changed.under[0].attackBanTargets = [];
        refused(() => read(h, changed));
        const corrupt = copy(h); corrupt.attackBans = []; refused(() => validate(corrupt));
        const missing = copy(h); missing.seen = []; refused(() => validate(missing));
        const malformed = copy(h) as unknown as { active: { source: unknown }[] };
        malformed.active[0].source = "not an occurrence";
        refused(() => validate(malformed as unknown as typeof h));
    });
}
for (const p of ["p1", "p2"] as const) {
    const b = board(p), h = settle(empty(), b);
    for (const kind of ["control", "promotion", "face", "hidden", "unison"] as const)
        test(`${p} explicit unsupported relation ${kind}`, () => {
            const next = copy(b), host = copy(next.area.cards[0]);
            if (kind === "control") host.master = host.holder = p === "p1" ? "p2" : "p1";
            if (kind === "promotion") { host.card = "promoted"; host.cardId = "new top"; }
            if (kind === "face") host.side = "back";
            if (kind === "hidden") host.hiddenCount++;
            if (kind === "unison") host.area = "unison";
            next.area.cards = [host]; next.piles[0].host = host; next.under[0].relation.host = host;
            next.under[0].negateTargets = [host]; next.under[0].attackBanTargets = [host];
            refused(() => settle(h, next));
            refused(() => settle(h, next, [{ kind: "reorder", before: b.under[0].relation, after: next.under[0].relation }]));
        });
    test(`${p} multiple attachments have stable separate generations`, () => {
        const next = copy(b), second = copy(next.under[0]);
        second.source.occurrence.card = "second"; second.relation.source.card = "second"; second.relation.position = 1;
        next.piles[0].cards.push("second"); next.under.push(second);
        const both = settle(h, next); assert.deepEqual(both.active.map(g => g.serial), [1, 2]);
        assert.deepEqual(settle(both, copy(next)).active.map(g => g.serial), [1, 2]);
        assert.equal(read(both, next).negate.length, 2);
    });
    test(`${p} malformed receipt hosts refuse deliberately`, () => {
        const next = copy(b); next.piles[0].cards.unshift("material"); next.under[0].relation.position = 1;
        const receipt = { kind: "reorder", before: { ...b.under[0].relation, host: null }, after: next.under[0].relation };
        refused(() => settle(h, next, [receipt as unknown as UnderRelationChange]));
    });
}
// Every non-under priority decision is compared directly with the unchanged v2 reducer.
for (const p of ["p1", "p2"] as const) for (const reversed of [false, true]) {
    test(`${p} v2 first-source priority and serial equivalence ${reversed}`, () => {
        const first = { ...board(p).area.cards[0], card: "kingA", cardId: "kingA", policy: "otherBattleWholeV1" as const, skillIndex: 0, skillIdentity: "A" };
        const second = { ...first, card: "kingB", cardId: "kingB", skillIdentity: "B" };
        const cardOnly = (s: typeof first) => { const { card, cardId, epoch, hiddenCount, side, master, holder, owner, area } = s; return { card, cardId, epoch, hiddenCount, side, master, holder, owner, area }; };
        let old = v2.emptyMixedStandingNegationHistory(), modern = empty();
        for (const n of [1, 2, 0, 2]) {
            const chosen = (reversed ? [second, first] : [first, second]).slice(0, n);
            const area: v2.MixedStandingNegationObservation = { version: 2, policy: "mixedWholeV1", cards: chosen.map(cardOnly), battle: null,
                candidates: chosen.map(s => ({ source: s, externalEnabled: true, targets: chosen.filter(t => t.card !== s.card).map(cardOnly) })) };
            const order = chosen.map(v2.mixedStandingNegationSourceKey);
            old = v2.settleMixedStandingNegation(old, area, order);
            modern = settle(modern, { version: 3, policy: "underAwareWholeV1", area, piles: [], under: [] }, [], order);
            assert.equal(modern.nextSerial, old.nextSerial); assert.deepEqual(modern.active, old.active);
            assert.deepEqual(modern.negated, old.suppressed); assert.deepEqual(modern.attackBans, []);
        }
    });
}
for (const p of ["p1", "p2"] as const) test(`${p} v2 Combo threshold and role priority equivalence`, () => {
    const q = p === "p1" ? "p2" : "p1";
    const leader = { ...board(p).area.cards[0], card: "goku", cardId: "BT20-086", area: "leader" as const,
        policy: "opponentComboSevenInBattleV1" as const, skillIndex: 10, skillIdentity: "full Goku supplied descriptor" };
    const guard = { ...board(q).area.cards[0], card: "guard", area: "leader" as const };
    const target = { ...board(q).area.cards[0], card: "target", area: "combo" as const };
    const { policy: ignoredPolicy, skillIndex: ignoredIndex, skillIdentity: ignoredIdentity, ...leaderCard } = leader;
    void ignoredPolicy; void ignoredIndex; void ignoredIdentity;
    let old = v2.emptyMixedStandingNegationHistory(), modern = empty();
    for (const n of [6, 7, 8, 7, 6, 7]) {
        const area: v2.MixedStandingNegationObservation = { version: 2, policy: "mixedWholeV1",
            cards: [leaderCard, guard, target, ...Array.from({ length: n }, (_, i) => ({ ...board(p).area.cards[0], card: `own${i}`, area: "combo" as const }))],
            battle: { attacker: { occurrence: leaderCard, present: true }, guard: { occurrence: guard, present: true } },
            candidates: [{ source: leader, externalEnabled: true, targets: [target] }] };
        old = v2.settleMixedStandingNegation(old, area);
        modern = settle(modern, { version: 3, policy: "underAwareWholeV1", area, piles: [], under: [] });
        assert.equal(modern.nextSerial, old.nextSerial); assert.deepEqual(modern.active, old.active); assert.deepEqual(modern.negated, old.suppressed);
    }
});
console.log(`under-standing-5: ${count} isolated cases PASS`);
