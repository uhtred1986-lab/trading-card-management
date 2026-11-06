/** R513 stage 1: isolated contracts; no native Combo-negation admission. */
import assert from "node:assert/strict";
import sources from "./fixtures/combo-standing-source.json";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { RULES } from "../../src/lib/arena/vm";
import type { EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
import { standingComboWholeDescriptor, standingComboWholePrinted, standingComboWholeScript } from "../../src/lib/arena/vm/standing-negation-policy";
import { emptyMixedStandingNegationHistory as empty, settleMixedStandingNegation as settle,
  mixedStandingNegationAffects as affects, mixedStandingNegationSourceKey as key,
  validateMixedStandingNegationObservation as validate } from "../../src/lib/arena/vm/standing-negation-mixed-history";
import type { MixedStandingNegationCard as Card, MixedStandingNegationSource as Source,
  MixedStandingNegationObservation as Observation, MixedStandingNegationHistory as History } from "../../src/lib/arena/vm/standing-negation-mixed-history";
import * as legacy from "../../src/lib/arena/vm/standing-negation-history";
import { issueMixedStandingNegationReadSeal as issue, mixedStandingNegationReadSealMatches as matches,
  mixedStandingSkillsNegated as read } from "../../src/lib/arena/vm/standing-negation-mixed-read";

let cases = 0;
const test = (label: string, fn: () => void) => { fn(); cases++; console.log(`PASS ${label}`); };
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const other = (p: PlayerId): PlayerId => p === "p1" ? "p2" : "p1";
function occurrence(id: string, holder: PlayerId, area: Card["area"]): Card {
  return { card: id, cardId: id, epoch: 1, hiddenCount: 0, side: "front", master: holder, holder, owner: holder, area };
}
function source(id: string, holder: PlayerId, policy: Source["policy"]): Source {
  return { ...occurrence(id, holder, policy === "otherBattleWholeV1" ? "battle" : "leader"),
    policy, skillIndex: 10, skillIdentity: `full stored ${id}` };
}
function board(p: PlayerId, count = 7): Observation {
  const goku = source("goku", p, "opponentComboSevenInBattleV1"), guard = occurrence("guard", other(p), "leader");
  const target = occurrence("target", other(p), "combo");
  return { version: 2, policy: "mixedWholeV1", cards: [goku, guard, target,
    ...Array.from({ length: count }, (_, i) => occurrence(`own${i}`, p, "combo"))],
  battle: { attacker: { occurrence: goku, present: true }, guard: { occurrence: guard, present: true } }, candidates: [{ source: goku, externalEnabled: true, targets: [target] }] };
}
const actual = card("BT20-086", sources["BT20-086"].card as Parameters<typeof card>[1]);
const rows = skillRecords(actual);
const script = rulesFromRows(rows.map((row, id) => ({ ...row, id, status: "draft", source: "compiler" }) as unknown as RuleRow), { [actual.id]: actual })[actual.id].bySkill[10];
const printed = parseSkills(actual.skill).find(skill => skill.index === 10)!;
test("actual complete printed and compiled conditional Permanent", () => {
  assert.equal(standingComboWholePrinted(printed), true);
  assert.equal(standingComboWholeDescriptor(script.ops), true);
  assert.equal(standingComboWholeScript(script), true);
});
// Deliberately malformed policy fields remain explicit in these negative controls.
type PolicyMutation = { cond: { atLeast: number }; then: { cond: { sel: { side: string } }; then: { target: { sel: { side: string; count: number; filter: { type: string } } } }[] }[]; else?: unknown[] };
const mutablePolicy = (s: typeof script) => s.ops[0] as unknown as PolicyMutation;
for (const [label, change] of Object.entries({
  price: (s: typeof script) => { s.price!.payment.orbs = { Yellow: 1 }; },
  usage: (s: typeof script) => { s.usage!.oncePerTurn = true; },
  validity: (s: typeof script) => { s.validity!.sparking = 1; },
  trigger: (s: typeof script) => { s.trigger = ["played"]; },
  mixed: (s: typeof script) => { s.ops.push({ op: "draw", n: 1 }); },
  threshold: (s: typeof script) => { mutablePolicy(s).cond.atLeast = 6; },
  sourceRole: (s: typeof script) => { mutablePolicy(s).then[0].cond.sel.side = "you"; },
  targetSide: (s: typeof script) => { mutablePolicy(s).then[0].then[0].target.sel.side = "both"; },
  targetCount: (s: typeof script) => { mutablePolicy(s).then[0].then[0].target.sel.count = 1; },
  targetFilter: (s: typeof script) => { mutablePolicy(s).then[0].then[0].target.sel.filter = { type: "BATTLE" }; },
  extraElse: (s: typeof script) => { mutablePolicy(s).else = []; },
})) test(`exact policy rejects ${label}`, () => { const changed = copy(script); change(changed); assert.equal(standingComboWholeScript(changed), false); });
for (const p of ["p1", "p2"] as const) {
  const seven = board(p), target = seven.cards.find(card => card.card === "target")!;
  const six = board(p, 6), dormant = settle(empty(), six), active = settle(dormant, seven);
  test(`${p} threshold, exit, re-entry preserves monotonic generations`, () => {
    assert.equal(affects(dormant, six, target), false);
    assert.equal(affects(active, seven, target), true);
    const inactive = settle(active, six), restored = settle(inactive, seven);
    assert.equal(inactive.active.length, 0); assert.equal(restored.active[0].serial, 2);
    assert.equal(restored.nextSerial, 3);
  });
  test(`${p} source battle role and external negation are separate conditions`, () => {
    for (const change of [(o: Observation) => { o.battle = null; }, 
      (o: Observation) => { o.candidates[0].externalEnabled = false; }]) {
      const o = copy(seven); change(o); assert.equal(settle(active, o).active.length, 0);
    }
    const unrelated = copy(seven), attacker = occurrence("unrelated", p, "battle");
    unrelated.cards.push(attacker); unrelated.battle!.attacker = { occurrence: attacker, present: true };
    assert.equal(settle(active, unrelated).active.length, 0);
    const defending = copy(seven); [defending.battle!.attacker, defending.battle!.guard] = [defending.battle!.guard, defending.battle!.attacker];
    assert.deepEqual(settle(active, defending).active, active.active);
  });
  test(`${p} opposing Unison attacker keeps Goku guard policy active`, () => {
    const o = copy(seven), unison = occurrence("attackingUnison", other(p), "unison");
    o.cards.push(unison);
    o.battle = { attacker: { occurrence: unison, present: true }, guard: { occurrence: o.candidates[0].source, present: true } };
    const h = settle(active, o);
    assert.deepEqual(h.active, active.active);
    assert.equal(affects(h, o, target), true);
    validate(h, o);
  });
  test(`${p} historical opponent preserves source generation`, () => {
    const o = copy(seven), opposite = o.battle!.guard;
    o.cards = o.cards.filter(card => card.card !== opposite.occurrence.card);
    opposite.present = false;
    const h = settle(active, o); validate(h, o);
    assert.deepEqual(h.active, active.active); assert.equal(affects(h, o, target), true);
    const bad = copy(o); bad.battle!.guard.present = true;
    assert.throws(() => settle(h, bad), /battle occurrence/);
  });
  test(`${p} historical source cannot enable a fresh same-ID occurrence`, () => {
    const o = copy(seven), original = o.candidates[0];
    o.battle!.attacker.present = false;
    o.cards = o.cards.filter(card => card.card !== original.source.card); o.candidates = [];
    const departed = settle(active, o); assert.equal(departed.active.length, 0);
    const returned = { ...original.source, epoch: original.source.epoch + 2 };
    o.cards.push(returned); o.candidates = [{ ...original, source: returned }];
    const h = settle(departed, o); validate(h, o);
    assert.equal(h.active.length, 0); assert.equal(h.nextSerial, active.nextSerial);
  });
  test(`${p} physical holder counts cards, printed owner does not`, () => {
    const o = copy(seven); o.cards.find(card => card.card === "own0")!.owner = other(p);
    assert.equal(settle(active, o).active[0].serial, 1);
    o.cards.find(card => card.card === "own0")!.holder = other(p);
    assert.equal(settle(active, o).active.length, 0);
  });
  test(`${p} same epoch Battle->Combo target changes policy membership`, () => {
    const king = source("king", other(p), "otherBattleWholeV1");
    const before = copy(seven); before.cards.push(king); before.cards.find(card => card.card === "target")!.area = "battle";
    before.candidates[0].targets = [];
    before.candidates.push({ source: king, externalEnabled: true, targets: [before.cards.find(card => card.card === "target")!] });
    const first = settle(empty(), before, before.candidates.map(c => key(c.source)));
    const after = copy(seven); after.cards.push(king); after.candidates.push({ source: king, externalEnabled: true, targets: [] });
    const next = settle(first, after);
    assert.deepEqual(next.active, first.active);
    assert.equal(next.suppressed.length, 1);
    assert.equal(next.suppressed[0].source, key(after.candidates[0].source));
    assert.equal(next.suppressed[0].target.area, "combo");
    assert.equal(next.suppressed[0].target.epoch, 1);
  });
  test(`${p} isolated history never mutates IDs or external grant receipts`, () => {
    const grants = [{ id: 91, card: "target", deleted: true }];
    const before = JSON.stringify({ active, seven, grants });
    assert.deepEqual(settle(copy(active), copy(seven)), active);
    affects(active, seven, target);
    assert.equal(JSON.stringify({ active, seven, grants }), before);
  });
  test(`${p} legacy and missing affected histories are not migrated`, () => {
    assert.throws(() => settle(undefined, seven), /rebuild affected/);
    assert.throws(() => settle(legacy.emptyStandingNegationHistory() as unknown as History, seven), /generation history/);
    assert.throws(() => validate(active, six), /not been settled/);
  });
  for (const [label, change] of Object.entries({
    selfBattle: (o: Observation) => { o.battle!.guard = o.battle!.attacker; },
    sameHolderBattle: (o: Observation) => { o.battle!.guard.occurrence.holder = p; },
    attackingCombo: (o: Observation) => { o.battle!.attacker.occurrence.area = "combo"; },
    extraObservationField: (o: Observation) => { Object.assign(o, { serial: 99 }); },
    extraSourceField: (o: Observation) => { Object.assign(o.candidates[0].source, { invented: true }); },
    duplicateCard: (o: Observation) => { o.cards.push(copy(o.cards[0])); },
    missingBattleCard: (o: Observation) => { o.battle!.guard.occurrence.card = "absent"; },
    inventedArea: (o: Observation) => { Object.assign(o.cards[0], { area: "fake" }); },
    misplacedSource: (o: Observation) => { o.candidates[0].source.area = "combo"; },
    invalidHolder: (o: Observation) => { Object.assign(o.cards[0], { holder: "p3" }); },
    duplicateTarget: (o: Observation) => { o.candidates[0].targets.push(copy(o.candidates[0].targets[0])); },
    ownTarget: (o: Observation) => { o.candidates[0].targets = [o.cards.find(card => card.card === "own0")!]; },
    missingPolicy: (o: Observation) => { Reflect.deleteProperty(o.candidates[0].source, "policy"); },
  })) test(`${p} malformed ${label} refuses deliberately`, () => {
    const bad = copy(seven); change(bad); assert.throws(() => settle(active, bad), /mixed|standing|negation/);
  });
}
for (const malformed of [null, {}, { version: 2, policy: "mixedWholeV1", cards: null, battle: null, candidates: [] },
  { ...board("p1"), candidates: [null] }, { ...board("p1"), battle: {} },
  ...[undefined, "battle", 1, { attacker: null }, { attacker: { present: true }, guard: null }].map(battle => ({ ...board("p1"), battle }))]) {
  test("malformed observation refuses without TypeError", () => {
    assert.throws(() => settle(empty(), malformed as unknown as Observation), error => {
      assert.ok(error instanceof Error); assert.notEqual(error.name, "TypeError"); return /negation|mixed/.test(error.message);
    });
  });
}
for (const mutate of [(h: History) => { h.active[0].source = null as unknown as Source; },
  (h: History) => { h.suppressed[0].target = null as unknown as Card; },
  (h: History) => { h.nextSerial = Number.NaN; }, (h: History) => { h.active[0].serial = h.nextSerial; }]) {
  test("malformed history refuses without TypeError", () => {
    const o = board("p1"), h = settle(empty(), o); mutate(h);
    assert.throws(() => validate(h, o), error => {
      assert.ok(error instanceof Error); assert.notEqual(error.name, "TypeError"); return /negation|mixed/.test(error.message);
    });
  });
}
test("initial empty history is bound to exactly empty facts", () => {
  const emptyFacts: Observation = { version: 2, policy: "mixedWholeV1", cards: [], battle: null, candidates: [] };
  validate(empty(), emptyFacts);
  assert.throws(() => validate(empty(), { ...emptyFacts, cards: [occurrence("other", "p1", "battle")] }), /not been settled/);
  assert.throws(() => validate(empty(), { ...emptyFacts, candidates: board("p1", 6).candidates }), /absent/);
});
test("equivalent observed enumeration preserves generation and read validation", () => {
  const o = board("p1"), h = settle(empty(), o), reversed = copy(o);
  reversed.cards.reverse(); reversed.candidates.reverse();
  validate(h, reversed); assert.deepEqual(settle(h, reversed), h);
});
// Exact legacy priority/serial compatibility over repeated entry, exit,
// suppression and restoration. Error parity includes unsupported asymmetric cases.
let oldHistory = legacy.emptyStandingNegationHistory(), newHistory = empty();
for (let step = 0; step < 128; step++) {
  const a = source("A", "p1", "otherBattleWholeV1"), b = source("B", "p2", "otherBattleWholeV1");
  const present = [a, b].filter((_, i) => (step & (1 << i)) !== 0);
  const oldSource = (s: Source) => ({ card: s.card, cardId: s.cardId, epoch: s.epoch, hiddenCount: s.hiddenCount, side: s.side,
    master: s.master, skillIndex: s.skillIndex, skillIdentity: s.skillIdentity });
  const oldObs: legacy.StandingNegationObservation = { version: 1, policy: "otherBattleWholeV1", candidates: present.map(s => ({
    source: oldSource(s), enabled: (step & (s.card === "A" ? 4 : 8)) === 0, targets: present.filter(t => t.card !== s.card).map(oldSource),
  })) };
  const newObs: Observation = { version: 2, policy: "mixedWholeV1", cards: present, battle: null, candidates: present.map(s => ({
    source: s, externalEnabled: (step & (s.card === "A" ? 4 : 8)) === 0, targets: present.filter(t => t.card !== s.card),
  })) };
  test(`legacy parity transition ${step}`, () => {
    oldHistory = legacy.settleStandingNegation(oldHistory, oldObs, oldObs.candidates.map(c => legacy.standingNegationSourceKey(c.source)));
    newHistory = settle(newHistory, newObs, present.map(key));
    assert.equal(newHistory.nextSerial, oldHistory.nextSerial);
    assert.deepEqual(newHistory.active.map(g => ({ source: oldSource(g.source), serial: g.serial })), oldHistory.active);
    assert.deepEqual(newHistory.suppressed.map(e => [e.serial, e.target.card]), oldHistory.suppressed.map(e => [e.serial, e.target.card]));
    validate(newHistory, newObs);
  });
}
// Seal tests use a staged state only. No native observer or policy is admitted.
const defs = { L: card("L", { type: "LEADER" }), F: card("F", {}) };
const ctx: EngineContext = { defs };
const state = RULES.createGame(ctx, { seed: 513, p1: { name: "one", leader: "L", main: fifty("F") }, p2: { name: "two", leader: "L", main: fifty("F") } }).state as VmState;
const observation: Observation = { version: 2, policy: "mixedWholeV1", cards: [], battle: null, candidates: [] };
for (const [label, change] of Object.entries({
  comboMembership: (s: VmState) => { s.sides.p1.zones.combo.push(s.sides.p1.zones.deck.pop()!); },
  leaderEpoch: (s: VmState) => { s.cards[s.sides.p1.zones.leader[0]].zoneEpoch = 9; },
  leaderOwner: (s: VmState) => { s.cards[s.sides.p1.zones.leader[0]].owner = "p2"; },
  battleRole: (s: VmState) => { s.battle = { attacker: s.sides.p1.zones.leader[0], guard: s.sides.p2.zones.leader[0] } as NonNullable<VmState["battle"]>; },
  grantDeletion: (s: VmState) => { Object.assign(s, { resolvedGrantDeletions: { changed: true } }); },
})) test(`mixed read seal detects ${label} without repair`, () => {
  const s = copy(state), h = empty(); issue(ctx, s, h, observation); assert.equal(matches(ctx, s, h), true);
  change(s); assert.equal(matches(ctx, s, h), false); assert.throws(() => read(s, h, "anything"), /changed board/);
});
test("mixed seal does not survive save or altered history", () => {
  const h = empty(); issue(ctx, state, h, observation);
  assert.equal(matches(ctx, copy(state), h), false);
  h.nextSerial++; assert.equal(matches(ctx, state, h), false);
});
console.log(`mixed standing-negation isolated contracts: ${cases} cases passed`);
