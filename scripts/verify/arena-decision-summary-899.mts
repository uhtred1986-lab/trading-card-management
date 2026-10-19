/** #899: executable decision facts, exact line/target, privacy and bounded refusals. */
import assert from "node:assert/strict";
import { combatFixtureBundle, combatMainPhase, p2MainPhase, battleAt } from "./arena-policy-combat-fixture";
import { legalMoves, applyMove, type PinnedMatch } from "../../src/lib/arena/browser";
import { policyTurn } from "../../src/lib/arena/policy/boundary";
import { emptyFilter } from "../../src/lib/arena/text/filters";
import { condHolds } from "../../src/lib/arena/vm/program";
import { defensiveSummary, battlePowerChoices } from "../../src/lib/arena/vm/decision-summary";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { permutedFor } from "./arena-policy-permute";
import type { LegalAction, PlayerId } from "../../src/lib/arena/types";
import type { Op } from "../../src/lib/arena/vm/script";
const copy = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const opening = await combatMainPhase(await combatFixtureBundle());
const otherOpening = p2MainPhase(opening);
let cases = 0;
for (const owner of ["p1", "p2"] as const) {
  const other: PlayerId = owner === "p1" ? "p2" : "p1";
  const counter = battleAt(owner === "p2" ? opening : otherOpening, {
    [owner]: { hand: ["C-NEG"], energy: ["C-V5"], battle: [], leaderMode: "rest" },
    [other]: { hand: [], energy: [], battle: [{ cardId: "C-BIG", mode: "active" }] },
  }, "C-BIG", "leader", { [owner]: "C-L-PUMP", [other]: "C-L-RED" });
  const neg = legalMoves(counter).find(l => l.action.type === "counter" && l.action.card)!; assert.ok(neg);
  const direct = (m: PinnedMatch, legal: LegalAction) => defensiveSummary(m.ctx, game, m.state, legal, owner);
  assert.deepEqual(direct(counter, neg).counterResponse, { version: 1, skillIndex: 0, kind: "counter:attack", negatesAttack: true, alternativePrice: "none" }); cases++;
  const counterCard = (neg.action as { card: string }).card;
  const changed = copy(counter); changed.ctx.defs["C-NEG"].skill = "[Counter: Attack] Draw 1 card.";
  assert.equal(direct(changed, neg).counterResponse?.negatesAttack, true, "display does not override stored negate"); cases++;
  changed.ctx.scripts!["C-NEG"].bySkill[0].ops = [{ op: "draw", n: 1 }];
  assert.equal(direct(changed, neg).counterResponse?.negatesAttack, false, "known typed non-negation is distinct from unknown"); cases++;
  changed.ctx.scripts!["C-NEG"].bySkill[0].ops = [{ op: "negateAttack" }, { op: "damage", n: 1 }];
  assert.equal(direct(changed, neg).counterResponse?.negatesAttack, null, "unrecognized tail cannot certify negation"); cases++;
  for (const pay of ["none", "life"] as const) {
    const m = copy(counter); m.state.effects.push({ id: 899, kind: "altCost", source: counterCard, target: counterCard, master: owner, value: 0, until: "turn", altCost: { for: "counter", pay, n: 1 } });
    const legal: LegalAction = { ...neg, action: { type: "counter", player: owner, card: counterCard, alt: true } };
    assert.equal(direct(m, legal).counterResponse?.alternativePrice, pay === "none" ? "free" : "other"); cases++;
  }
  let match = applyMove(counter, { type: "counter", player: owner, card: null }).match;
  for (let n = 0; n < 8 && !(match.state.prompt.kind === "combo" && match.state.prompt.player === owner); n++) {
    const pass = legalMoves(match).find(l => l.action.type === "pass" || l.action.type === "block" && l.action.card === null); assert.ok(pass); match = applyMove(match, pass.action).match;
  }
  assert.equal(match.state.prompt.kind, "combo");
  const activation = legalMoves(match).find(l => l.action.type === "activate")!; assert.ok(activation);
  assert.deepEqual(direct(match, activation).battleActivation?.power, { battle: 5000, turn: 5000 }); cases++;
  const source = (activation.action as { card: string }).card;
  const cardId = match.state.cards[source].cardId;
  const mutate = (ops: Op[]) => { const m = copy(match); m.ctx.scripts![cardId].bySkill[0].ops = ops; return m; };
  const power: Op = { op: "power", target: { sel: { special: "leader" } }, amount: 7000, until: "battle" };
  const typed = mutate([{ op: "draw", n: 1 }, power]);
  assert.deepEqual(direct(typed, activation).battleActivation, { version: 1, skillIndex: 0, timing: "activate:battle", power: { battle: 7000, turn: 0 }, drawnFirst: 1 }); cases++;
  typed.ctx.defs[cardId].skill = "[Activate: Battle] Your Leader gets +1 power for the turn.";
  assert.equal(direct(typed, activation).battleActivation?.power.battle, 7000, "typed amount/duration beat display"); cases++;
  const wrong = mutate([{ ...power, target: { sel: { area: "battle", side: "you" } } }]);
  assert.equal(direct(wrong, activation).battleActivation?.power.battle, 0, "another target's power is not the guard's"); cases++;
  assert.equal(direct(mutate([power, { op: "damage", n: 1 }]), activation).battleActivation, undefined, "harmful unknown tail invalidates whole path"); cases++;
  assert.equal(direct(mutate([{ ...power, amount: { x: true } }]), activation).battleActivation, undefined, "dynamic figures are explicit unknown"); cases++;
  const hidden: Op = { op: "if", cond: { kind: "count", sel: { side: "opponent", area: "hand", filter: { ...emptyFilter(), colors: ["Red"] } }, atLeast: 1 }, then: [power] };
  const privateMatch = mutate([hidden]);
  privateMatch.ctx.defs["BLUE899"] = { ...privateMatch.ctx.defs["C-V5"], id: "BLUE899", colors: ["Blue"] };
  privateMatch.ctx.scripts!["BLUE899"] = copy(privateMatch.ctx.scripts!["C-V5"]);
  const hiddenCard = privateMatch.state.sides[other].zones.deck.pop()!;
  privateMatch.state.sides[other].zones.hand.push(hiddenCard); privateMatch.state.cards[hiddenCard].cardId = "C-V5";
  const twin = permutedFor(privateMatch, owner, 899);
  twin.state.cards[twin.state.sides[other].zones.hand[0]].cardId = "BLUE899";
  const conditionFrame = { ops: [], ip: 0, vars: {}, card: source, master: owner };
  assert.equal(condHolds(privateMatch.ctx, game, privateMatch.state, conditionFrame, hidden.cond), true);
  assert.equal(condHolds(twin.ctx, game, twin.state, conditionFrame, hidden.cond), false, "the hidden predicate actually changes truth");
  // Nonvacuous: the predicate is in the effect being summarized; it is never evaluated.
  assert.equal(direct(privateMatch, activation).battleActivation, undefined);
  assert.deepEqual(direct(privateMatch, activation), direct(twin, activation));
  const input = policyTurn(privateMatch, owner, 0).input.decisions;
  assert.deepEqual(input, policyTurn(twin, owner, 0).input.decisions, "hidden-dependent effect leaves decision facts identical"); cases++;
  assert.equal(direct(mutate(Array.from({ length: 129 }, () => power)), activation).battleActivation, undefined, "projection work cap yields unknown rather than partial positive facts"); cases++;
  const publicIf = mutate([{ op: "if", cond: { kind: "isTurnPlayer", who: "opponent" }, then: [power] }]);
  assert.equal(direct(publicIf, activation).battleActivation?.power.battle, 7000); cases++;
  const chosen = mutate([{ op: "choose", sel: { special: "leader", count: 1, upTo: true }, as: "target899" }, { ...power, target: { var: "target899" } }]);
  const next = applyMove(chosen, activation.action).match;
  assert.equal(next.state.prompt.kind, "chooseCards");
  assert.equal(battlePowerChoices(next.ctx, game, next.state, owner).target, source);
  const picked = policyTurn(next, owner, 1).input.decisions.decisions.find(d => d.kind === "pick");
  assert.equal(picked?.battlePowerTarget, source, "only proven eligible current battler gets target annotation"); cases++;
  const captured = copy(next);
  captured.state.programs[0].vars.private899 = [source];
  captured.state.programs[0].ops[captured.state.programs[0].ip + 1] = { ...power, target: { var: "private899" } };
  assert.deepEqual(battlePowerChoices(captured.ctx, game, captured.state, owner), {}, "captured variable with unknown provenance cannot justify a target"); cases++;
  const hiddenOrigin = copy(next);
  hiddenOrigin.ctx.scripts![cardId].bySkill[0].ops = [hidden, ...hiddenOrigin.ctx.scripts![cardId].bySkill[0].ops];
  assert.deepEqual(battlePowerChoices(hiddenOrigin.ctx, game, hiddenOrigin.state, owner), {}, "a visible suffix does not erase a hidden original condition"); cases++;
  const replay = copy(next); assert.deepEqual(policyTurn(replay, owner, 1), policyTurn(next, owner, 1)); cases++;
  const untouched = copy(match); policyTurn(match, owner, 0); assert.deepEqual(copy(match), untouched, "summary projection is read only"); cases++;
}
console.log(`decision-summary-899: ${cases} exact-line, target, typed mutation, counter route, privacy, refusal and save checks passed`);
