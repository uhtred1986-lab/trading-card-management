/** R465: original self occurrence, independent replacement tail and ordinary targets. */
import assert from "node:assert/strict";
import { stepScript } from "../../src/lib/arena/vm/script";
import { vmHost } from "../../src/lib/arena/vm/host";
import { card, fifty } from "./harness";
import { correctSkillText } from "../../src/lib/catalog/errata";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const defs: Record<string, CardDef> = {
  L: card("L", { type: "LEADER" }),
  F: card("F", { colors: ["Blue"] }),
  Blue: card("Blue", { colors: ["Blue"] }),
  Yellow: card("Yellow", { colors: ["Yellow"] }),
  SOURCE: card("SOURCE", { skill: "[Activate: Main] Choose up to 1 Battle Card from your hand and play it." }),
  ANSWER: card("ANSWER", { type: "EXTRA", energyCost: 0, skill: "[Counter: Counter] Negate the [Counter]." }),
  ORDINARY: card("ORDINARY", { colors: ["Blue"], skill: "[Counter: Attack] Negate the attack. Choose up to 1 blue Battle Card from your Drop Area and play it." }),
};
defs["P-337"]=card("P-337",{"type": "BATTLE", "name": "Zamasu, the Eliminator", "colors": ["Blue", "Yellow"], "power": 5000, "characters": ["Zamasu"], "traits": ["God"], "skill": "[energy-exhaust][indestructible]<br>[counter: play] Play this card, and if the card being played has an energy cost of 4 or less, return it to its owner&apos;s hand instead.<br>[permanent] If you have another Blue/Yellow multicolor card in your energy, negate this card&apos;s [energy-exhaust] skill in all areas.<br>[auto] When this card is played, draw 1 card, then choose up to 1 of your opponent&apos;s Battle Cards and switch it to Rest Mode.", "energyCost": 2, "specifiedCost": {"Blue": 1, "Yellow": 1}});
for (const def of Object.values(defs)) def.skill = correctSkillText(def.id, def.skill);
const rows = Object.values(defs).flatMap(skillRecords).map((row, id) => ({ ...row, id, source: "compiler", status: "confirmed" }) as unknown as RuleRow);
const ctx: EngineContext = { defs, scripts: rulesFromRows(rows, defs) };
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const other = (player: PlayerId): PlayerId => player === "p1" ? "p2" : "p1";
const take = (state: VmState, action: Action) => RULES.apply(ctx, copy(state), action).state as VmState;
function fresh(first: PlayerId): VmState {
  let state = RULES.createGame(ctx, { seed: 465, p1: { name: "One", leader: "L", main: fifty("F") }, p2: { name: "Two", leader: "L", main: fifty("F") } }).state as VmState;
  for (const action of [
    { type: "chooseFirst", player: state.chooser, first },
    { type: "mulligan", player: first, redraw: false },
    { type: "mulligan", player: other(first), redraw: false },
    { type: "charge", player: first, card: null }, { type: "endMain", player: first },
    { type: "charge", player: other(first), card: null }, { type: "endMain", player: other(first) },
    { type: "charge", player: first, card: null },
  ] as Action[]) state = take(state, action);
  state.sides[other(first)].attrs.energyMarkers = 0;
  return state;
}
function stage(state: VmState, player: PlayerId, definition: string, area: string): string {
  const id = state.sides[player].zones.deck.at(-1)!;
  state.cards[id].cardId = definition;
  assert.ok(moveCard(state, game, id, area, { owner: player }).ok);
  return id;
}
function answer(state: VmState, card: string | null): VmState {
  assert.equal(state.prompt.kind, "counter");
  return take(state, { type: "counter", player: state.prompt.player!, card });
}
function finish(state: VmState): VmState {
  for (let n = 0; n < 50 && state.prompt.kind !== "main"; n++) {
    assert.equal(state.outcome, undefined, JSON.stringify(state.outcome));
    const prompt = state.prompt;
    if (prompt.kind === "chooseCards") {
      state = take(state, { type: "choose", player: prompt.player, cards: prompt.choice.candidates.slice(0, prompt.choice.min) });
    } else {
      const actions = RULES.legalActions(ctx, state).map(item => item.action);
      const action = actions.find(action => action.type === "payCost") ?? actions.find(action => action.type === "counter" && action.card === null) ?? actions.find(action => action.type === "orderPending");
      assert.ok(action, JSON.stringify(prompt));
      state = take(state, action);
    }
  }
  assert.equal(state.prompt.kind, "main");
  return state;
}
let cases = 0;
// Ordinary target choices can select a fresh source occurrence: they are not self references.
for (const owner of ["p1", "p2"] as const) for (const taxed of [false, true]) {
  const first = other(owner);
  let state = fresh(first);
  const counter = stage(state, owner, "ORDINARY", "hand");
  stage(state, owner, "Blue", "energy");
  stage(state, first, "ANSWER", "hand");
  const payer = state.sides[owner].zones.hand.find(id => id !== counter)!;
  if (taxed) assert.equal(stepScript(vmHost(ctx, game, state, []), {
    ops: [{ op: "forbid", what: "play", side: "opponent", until: "turn", unlessPay: [
      { op: "choose", sel: { side: "you", area: "hand", count: 1, upTo: false }, as: "ordinaryTax" },
      { op: "moveTo", target: { var: "ordinaryTax" }, to: "drop" },
    ] }], ip: 0, vars: {}, card: state.sides[first].zones.leader[0], master: first,
  }), "done");
  state = take(state, { type: "attack", player: first, attacker: state.sides[first].zones.leader[0], target: state.sides[owner].zones.leader[0] });
  state = answer(state, counter);
  assert.equal(state.prompt.kind, "counter");
  // Deliberate saved-state fault, not an invented action during atomic Counter resolution.
  assert.ok(moveCard(state, game, counter, "warp", { owner }).ok);
  assert.ok(moveCard(state, game, counter, "drop", { owner }).ok);
  state = answer(state, null);
  assert.equal(state.prompt.kind, "chooseCards");
  state = take(state, { type: "choose", player: owner, cards: [counter] });
  if (taxed) {
    assert.equal(state.prompt.kind, "chooseMode");
    state = take(state, { type: "chooseMode", player: owner, index: 0 });
    assert.equal(state.prompt.kind, "chooseCards");
    state = take(state, { type: "choose", player: owner, cards: [payer] });
    assert.ok(state.sides[owner].zones.drop.includes(payer));
  }
  state = finish(state);
  assert.ok(state.sides[owner].zones.battle.includes(counter));
  cases++;
}
for (const owner of ["p1", "p2"] as const) for (const fault of [false, true]) for (const timing of ["skill", "declared"] as const) {
  const first = other(owner);
  let state = fresh(first);
  const parent = stage(state, first, "SOURCE", "battle");
  const incoming = stage(state, first, "F", "hand");
  const counter = stage(state, owner, "P-337", "hand");
  stage(state, owner, "Blue", "energy");
  stage(state, owner, "Yellow", "energy");
  stage(state, first, "ANSWER", "hand");
  const deckBefore = state.sides[owner].zones.deck.length;
  if (timing === "declared") {
    state.sides[first].attrs.energyMarkers = 0;
    stage(state, first, "Blue", "energy");
    state = take(state, { type: "play", player: first, card: incoming });
  } else state = take(state, { type: "activate", player: first, card: parent, skill: 0 });
  state = answer(state, counter);
  assert.equal(state.prompt.kind, "counter");
  assert.ok(state.sides[owner].zones.drop.includes(counter));
  if (fault) {
    // Saved-state ABA fault after activation. The independent replacement still resolves.
    assert.ok(moveCard(state, game, counter, "warp", { owner }).ok);
    assert.ok(moveCard(state, game, counter, "drop", { owner }).ok);
  }
  state = answer(state, null);
  assert.ok(state.sides[owner].zones[fault ? "drop" : "battle"].includes(counter), "self-play must retain its original occurrence");
  if (timing === "skill") {
    assert.equal(state.prompt.kind, "chooseCards");
    assert.equal(state.prompt.player, first);
    state = take(state, { type: "choose", player: first, cards: [incoming] });
  }
  state = finish(state);
  assert.ok(state.sides[first].zones.hand.includes(incoming), "independent replacement survives failed self-play");
  assert.equal(state.sides[owner].zones.deck.length, deckBefore - (fault ? 0 : 1));
  assert.equal(state.skillPlayScopes, undefined);
  cases++;
}
// This price is a typed test tax, not a claim about an additional printed card.
for (const owner of ["p1", "p2"] as const) for (const fault of ["unchanged", "offer", "child", "partial", "missing", "malformed", "missing-parent", "missing-parent-tail", "scope-missing", "scope-malformed", "scope-phase", "cursor-without-stamp"] as const) {
  const first = other(owner);
  let state = fresh(first);
  const parent = stage(state, first, "SOURCE", "battle");
  const incoming = stage(state, first, "F", "hand");
  const counter = stage(state, owner, "P-337", "hand");
  stage(state, owner, "Blue", "energy");
  stage(state, owner, "Yellow", "energy");
  stage(state, first, "ANSWER", "hand");
  const [payer, secondPayer] = state.sides[owner].zones.hand.filter(id => id !== counter);
  assert.equal(stepScript(vmHost(ctx, game, state, []), {
    ops: [{ op: "forbid", what: "play", side: "opponent", until: "turn", unlessPay: [
      { op: "choose", sel: { side: "you", area: "hand", count: 1, upTo: false }, as: "taxPayer" },
      { op: "moveTo", target: { var: "taxPayer" }, to: "drop" },
      { op: "choose", sel: { side: "you", area: "hand", count: 1, upTo: false }, as: "secondTaxPayer" },
      { op: "moveTo", target: { var: "secondTaxPayer" }, to: "drop" },
    ] }], ip: 0, vars: {}, card: parent, master: first,
  }), "done");
  state = take(state, { type: "activate", player: first, card: parent, skill: 0 });
  state = answer(state, counter);
  state = answer(state, null);
  assert.equal(state.prompt.kind, "chooseMode");
  const reenter = () => {
    // Saved-state fault, not an invented interrupt while an effect resolves.
    assert.ok(moveCard(state, game, counter, "warp", { owner }).ok);
    assert.ok(moveCard(state, game, counter, "drop", { owner }).ok);
  };
  if (fault === "offer") reenter();
  state = take(state, { type: "chooseMode", player: owner, index: 0 });
  if (fault !== "offer") {
    assert.equal(state.prompt.kind, "chooseCards");
    assert.equal(state.prompt.player, owner);
    if (fault === "partial") {
      state = take(state, { type: "choose", player: owner, cards: [payer] });
      assert.ok(state.sides[owner].zones.drop.includes(payer));
      assert.equal(state.prompt.kind, "chooseCards");
    }
    if (fault === "child" || fault === "partial") reenter();
    const child = state.programs.find(frame => frame.counterSelfTax)!;
    assert.ok(child);
    if (fault === "missing") delete child.counterSelfTax;
    if (fault === "malformed") child.counterSelfTax!.version = 0 as 1;
    if (fault === "missing-parent" || fault === "missing-parent-tail") {
      const savedParent = state.programs.find(frame => frame.card === counter && frame.skillKind === "counter")!;
      delete savedParent.counterSelfChoices;
      if (fault === "missing-parent-tail") {
        savedParent.ops = savedParent.ops.slice(savedParent.ip);
        savedParent.ip = 0;
      }
    }
    if (fault === "cursor-without-stamp") {
      const savedParent = state.programs.find(frame => frame.card === counter && frame.skillKind === "counter")!;
      savedParent.ip++;
      delete child.counterSelfTax;
    }
    if (fault === "scope-missing") delete state.skillPlayScopes;
    if (fault === "scope-malformed") state.skillPlayScopes!.at(-1)!.version = 1 as 2;
    if (fault === "scope-phase") state.skillPlayScopes!.at(-1)!.phase = "after";
    state = take(state, { type: "choose", player: owner, cards: [fault === "partial" ? secondPayer : payer] });
    if (fault === "missing" || fault === "malformed" || fault === "missing-parent" || fault === "missing-parent-tail" || fault === "cursor-without-stamp" || fault === "scope-missing" || fault === "scope-malformed" || fault === "scope-phase") {
      assert.ok(state.sides[owner].zones.hand.includes(payer), `${fault}: invalid tax ownership must refuse before moving a payer`);
      assert.match(JSON.stringify(state.outcome), /rebuild/);
      assert.ok(state.sides[owner].zones.hand.includes(payer));
      cases++;
      continue;
    }
    if (fault === "unchanged") {
      assert.equal(state.prompt.kind, "chooseCards");
      state = take(state, { type: "choose", player: owner, cards: [secondPayer] });
    }
  }
  assert.equal(state.sides[owner].zones.drop.includes(payer), fault === "partial" || fault === "unchanged", "prior payments stay spent; no new payer is spent after the source leaves");
  assert.equal(state.sides[owner].zones.drop.includes(secondPayer), fault === "unchanged");
  assert.equal(state.prompt.kind, "chooseCards");
  assert.equal(state.prompt.player, first);
  state = take(state, { type: "choose", player: first, cards: [incoming] });
  state = finish(state);
  assert.ok(state.sides[owner].zones[fault === "unchanged" ? "battle" : "drop"].includes(counter));
  assert.ok(state.sides[first].zones.hand.includes(incoming));
  cases++;
}
console.log(`counter-self-binding-native-5: ${cases} native cases passed`);
