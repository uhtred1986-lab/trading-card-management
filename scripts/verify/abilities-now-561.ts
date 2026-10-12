/** Pure projections behind the live Abilities now panel. */
import assert from "node:assert/strict";
import type { LegalAction, Requirement } from "../../src/lib/arena/types";
import type { CardView } from "../../src/lib/arena/view";
import { CTX, DEFS, card as definition, fifty } from "./harness";
import { engineFor } from "../../src/lib/arena/engines";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import type { Action, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
import {
  abilityActionLabel,
  abilityCost,
  abilityPanelRows,
  matchesAbilityAction,
  offeredMoves,
  isStructuralRefusal,
  type AbilityLine,
  type AbilitySheetMove,
} from "../../src/components/arena/ability-panel-model";

const card = { id: "p1#ability", cardId: "TEST", name: "Senzu Bean", cost: null } as CardView;
const req = (value: Requirement) => value;
function line(overrides: Partial<AbilityLine> & Pick<AbilityLine, "skillIndex" | "category" | "availability">): AbilityLine {
  const base: AbilityLine = {
    skillIndex: overrides.skillIndex,
    kind: overrides.kind ?? "activate:main",
    category: overrides.category,
    text: overrides.text ?? "[Activate: Main] Draw 1 card.",
    tags: overrides.tags ?? ["Activate: Main"],
    zone: overrides.zone ?? "hand",
    owner: overrides.owner ?? "p1",
    controller: overrides.controller ?? "p1",
    origin: overrides.origin ?? "printed",
    availability: overrides.availability,
    costPreview: overrides.costPreview ?? { state: "incomplete" },
  };
  return Object.assign(base, overrides);
}
function move(action: LegalAction["action"], label = "engine offer", cost?: LegalAction["cost"]): AbilitySheetMove {
  return { index: 7, legal: { action, label, ...(cost ? { cost } : {}) } };
}

// A timely resource refusal remains in Abilities now; wrong phase/zone and an
// action that the viewer is not authorized to evaluate stay under Other.
{
  const rows = [
    line({ skillIndex: 0, category: "manual", availability: "refused", why: [req({ kind: "energyColour", colour: "Blue", need: 1, have: 0 })] }),
    line({ skillIndex: 1, category: "manual", availability: "refused", kind: "activate:battle", timing: "battle", why: [req({ kind: "timing", window: "battle" })] }),
    line({ skillIndex: 2, category: "manual", availability: "refused", why: [req({ kind: "zone", card: card.id, area: "battle" })] }),
    line({ skillIndex: 3, category: "manual", availability: "notEvaluated", notEvaluatedReason: "notDecisionActor" }),
    line({ skillIndex: 4, category: "automatic", availability: "notEvaluated", pending: true }),
    line({ skillIndex: 5, category: "passive", availability: "notEvaluated", permanentState: "on" }),
  ];
  const panel = abilityPanelRows(rows);
  assert.deepEqual(panel.manual.map((row) => row.skillIndex), [0], "a timely energy shortfall remains visible with its engine reason");
  assert.deepEqual(panel.other.map((row) => row.skillIndex), [1, 2, 3], "timing, zone and other-player evidence is collapsed by default");
  assert.deepEqual(panel.pending.map((row) => row.skillIndex), [4], "a pending Auto is represented in its own read-only group");
  assert.deepEqual(panel.passive.map((row) => row.skillIndex), [5], "passive effects do not become action buttons");
}

// A CTA is keyed by instance + engine skill index, not the card's name, text,
// or a same-named line from another copy.
{
  const active = line({ skillIndex: 6, category: "manual", availability: "offered" });
  const action = { type: "activate", player: "p1", card: card.id, skill: 6 } as const;
  const exact = move(action);
  const wrongInstance = move({ ...action, card: "p1#different" });
  const wrongSkill = move({ ...action, skill: 9 });
  const wrongActor = move({ ...action, player: "p2" });
  assert.deepEqual(offeredMoves(active, card, [active], [exact, wrongInstance, wrongSkill]), [exact]);
  assert.equal(matchesAbilityAction(active, wrongInstance.legal.action, card, [active]), false);
  assert.deepEqual(offeredMoves(active, card, [active], [wrongActor]), [], "a same-card/index action for the other player is not this ability's offer");
}

// The native Counter menu may omit its skill index. The snapshot attributes
// that card-level action to one selected line; never fan it out to other lines.
{
  const first = line({ skillIndex: 10, category: "counter", kind: "counter:attack", availability: "offered" });
  const otherLine = line({ skillIndex: 11, category: "counter", kind: "counter:attack", availability: "notEvaluated", notEvaluatedReason: "unidentifiedAction" });
  const action = { type: "counter", player: "p1", card: card.id } as const;
  const exact = move(action);
  assert.deepEqual(offeredMoves(first, card, [first, otherLine], [exact]), [exact]);
  assert.deepEqual(offeredMoves(otherLine, card, [first, otherLine], [exact]), []);
  assert.equal(matchesAbilityAction(otherLine, action, card, [first, otherLine]), false);
  const otherActor = move({ type: "counter", player: "p2", card: card.id });
  assert.deepEqual(offeredMoves(first, card, [first], [otherActor]), [], "Counter actions are bound to the line controller");
  const otherWindow = line({ skillIndex: 13, category: "counter", kind: "counter:play", availability: "refused", why: [req({ kind: "timing", window: "main" })] });
  assert.deepEqual(offeredMoves(first, card, [first, otherWindow], [exact]), [exact], "a refused Counter: Play line does not make the offered Counter: Attack ambiguous");
  const twoOffers = [first, line({ skillIndex: 12, category: "counter", kind: "counter:attack", availability: "offered" })];
  assert.deepEqual(offeredMoves(first, card, twoOffers, [exact]), [], "an unqualified action is ambiguous when two lines are offered");
  const twoPrices = line({
    skillIndex: 14,
    category: "counter",
    kind: "counter:attack",
    availability: "offered",
    costPreview: { state: "known", offers: [
      { label: "Counter with 1 energy", cost: { energy: 1, describe: "1 energy" } },
      { label: "Counter with 2 energy", cost: { energy: 2, describe: "2 energy" } },
    ] },
  });
  assert.equal(abilityCost(twoPrices, move({ type: "counter", player: "p1", card: card.id }, "choose a payment")), "Choose payment");

  const xLine = line({ skillIndex: 15, category: "manual", availability: "offered" });
  const xOne = move({ type: "activate", player: "p1", card: card.id, skill: 15, x: 1 }, "Activate Senzu with X = 1", { energy: 1, describe: "1 energy" });
  const xTwo = move({ type: "activate", player: "p1", card: card.id, skill: 15, x: 2 }, "Activate Senzu with X = 2", { energy: 2, describe: "2 energy" });
  const alternate = move({ type: "activate", player: "p1", card: card.id, skill: 15, alt: true }, "Activate Senzu by resting a Red/Blue energy ([Invoker])", { energy: 1, describe: "1 Red/Blue energy" });
  const variants = [xOne, xTwo, alternate];
  assert.equal(abilityActionLabel(xLine, xOne, variants), xOne.legal.label, "multiple X offers retain their engine-provided distinction");
  assert.equal(abilityActionLabel(xLine, xTwo, variants), xTwo.legal.label, "each X value stays identifiable without duplicating effect text");
  assert.equal(abilityActionLabel(xLine, alternate, variants), alternate.legal.label, "alternate payment keeps its engine-provided explanation");
  assert.equal(abilityActionLabel(xLine, xOne, [xOne]), "Activate", "a single unambiguous action stays compact");
}

// A missing price projection must not become “free” through the legacy
// `priceOf` card-cost fallback. The authoritative incomplete state is said.
{
  const offered = line({ skillIndex: 0, category: "counter", kind: "counter:attack", availability: "offered", costPreview: { state: "incomplete" } });
  const legal = move({ type: "counter", player: "p1", card: card.id });
  assert.equal(abilityCost(offered, legal), "Cost details unavailable");
  const priced = line({
    skillIndex: 0,
    category: "counter",
    kind: "counter:attack",
    availability: "offered",
    costPreview: { state: "known", offers: [{ label: "Counter", cost: { energy: 1, describe: "1 blue energy" } }] },
  });
  assert.equal(abilityCost(priced, legal), "1 blue energy");
}

// Structural type/zone/timing refusals move into collapsed Other actions
// when line-level abilities are available. Resource and turn-limit blockers
// remain directly visible and actionable.
{
  const reject = (why: Requirement[]): Parameters<typeof isStructuralRefusal>[0] => ({
    action: { type: "combo", player: "p1", card: card.id },
    label: "Combo Senzu Bean",
    why,
  });
  assert.equal(isStructuralRefusal(reject([{ kind: "cardType", card: card.id, needs: "a Battle Card" }])), true);
  assert.equal(isStructuralRefusal(reject([{ kind: "zone", card: card.id, area: "battle" }])), true);
  assert.equal(isStructuralRefusal(reject([{ kind: "timing", window: "battle" }])), true);
  assert.equal(isStructuralRefusal(reject([{ kind: "energyColour", colour: "Blue", need: 1, have: 0 }])), false);
  assert.equal(isStructuralRefusal(reject([
    { kind: "cardType", card: card.id, needs: "a Battle Card" },
    { kind: "oncePerTurn", what: "this skill" },
  ])), false, "a mixed structural/resource/limit refusal stays visible as an actionable blocker");
}

// Engine-backed timing evidence for the extra Main-vs-Battle distinction.
// These are intentionally synthetic definitions: the real Senzu Bean print
// has a Battle ability, not a Main ability. Its actual artwork remains the
// UI fixture; this separate card exists only to exercise generic Main timing.
{
  const engine = engineFor("rules");
  const loaded = rulesetFor("dbs");
  assert.ok(loaded.ok);
  const previous = new Map(["U04_MAIN", "U04_BATTLE", "U04_COUNTER"].map((id) => [id, DEFS[id]]));
  DEFS.U04_MAIN = definition("U04_MAIN", { energyCost: 0, power: 10000, skill: "[Activate: Main] Draw 1 card." });
  DEFS.U04_BATTLE = definition("U04_BATTLE", { energyCost: 0, power: 10000, skill: "[Activate: Battle] Draw 1 card." });
  DEFS.U04_COUNTER = definition("U04_COUNTER", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Counter: Attack] Negate the attack." });

  const fresh = (seed: number): VmState => engine.createGame(CTX, {
    seed,
    p1: { name: "You", leader: "L-RED", main: fifty("V1") },
    p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") },
  }).state as VmState;
  const apply = (state: VmState, action: Action): VmState => engine.apply(CTX, state, action).state as VmState;
  const availability = (state: VmState, viewer: PlayerId) => {
    const legal = engine.legalActions(CTX, state);
    return engine.abilityAvailability(CTX, state, viewer, legal, engine.rejectedActions(CTX, state, legal));
  };
  const firstMain = (seed: number): VmState => {
    let state = fresh(seed);
    state = apply(state, { type: "chooseFirst", player: state.chooser, first: "p1" });
    for (let i = 0; i < 24 && state.prompt.kind !== "main"; i++) {
      const actor = (state.prompt as { player: PlayerId }).player;
      state = apply(state, { type: "pass", player: actor });
    }
    assert.equal(state.prompt.kind, "main");
    return state;
  };
  const onBoard = (state: VmState, player: PlayerId, cardId: string): string => {
    const instance = state.sides[player].zones.hand[0];
    assert.ok(instance);
    state.cards[instance].cardId = cardId;
    assert.ok(moveCard(state, loaded.definition, instance, "battle", { owner: player }).ok);
    return instance;
  };
  const inHand = (state: VmState, player: PlayerId, cardId: string): string => {
    const instance = state.sides[player].zones.hand[0];
    assert.ok(instance);
    state.cards[instance].cardId = cardId;
    return instance;
  };
  try {
    let state = firstMain(56101);
    const mainSkill = onBoard(state, "p1", "U04_MAIN");
    const battleSkill = onBoard(state, "p1", "U04_BATTLE");
    inHand(state, "p1", "U04_COUNTER");
    const mainOffer = availability(state, "p1").find((row) => row.card === mainSkill);
    assert.equal(mainOffer?.state, "offered", "the synthetic Main skill is offered in its actual Main decision");

    state = apply(state, { type: "endMain", player: "p1" });
    for (let i = 0; i < 30 && !(state.prompt.kind === "main" && state.prompt.player === "p2"); i++) {
      const actor = (state.prompt as { player: PlayerId }).player;
      state = state.prompt.kind === "main" ? apply(state, { type: "endMain", player: actor }) : apply(state, { type: "pass", player: actor });
    }
    assert.equal(state.prompt.kind, "main");
    const attack = engine.legalActions(CTX, state).find((item) => item.action.type === "attack" && item.action.attacker === state.sides.p2.zones.leader[0] && item.action.target === state.sides.p1.zones.leader[0]);
    assert.ok(attack);
    state = apply(state, attack.action);
    assert.equal(state.prompt.kind, "counter");
    const counterRows = availability(state, "p1");
    assert.equal(counterRows.find((row) => row.card === mainSkill)?.state, "refused");
    assert.ok(counterRows.find((row) => row.card === mainSkill)?.why?.some((why) => why.kind === "timing"));
    assert.equal(counterRows.find((row) => row.card === battleSkill)?.state, "refused");
    assert.ok(counterRows.find((row) => row.card === battleSkill)?.why?.some((why) => why.kind === "timing"));
    state = apply(state, { type: "counter", player: "p1", card: null });
    if (state.prompt.kind === "combo" && state.prompt.player === "p2") state = apply(state, { type: "pass", player: "p2" });
    assert.equal(state.prompt.kind, "combo");
    assert.equal(state.prompt.player, "p1");
    const comboRows = availability(state, "p1");
    assert.equal(comboRows.find((row) => row.card === battleSkill)?.state, "offered", "the printed Battle skill is available in the actual defense combo decision");
    assert.equal(comboRows.find((row) => row.card === mainSkill)?.state, "refused");
    assert.ok(comboRows.find((row) => row.card === mainSkill)?.why?.some((why) => why.kind === "timing"));
    const battleAction = engine.legalActions(CTX, state).find((item) => item.action.type === "activate" && item.action.card === battleSkill && item.action.skill === 0);
    assert.ok(battleAction, "the same Battle line is an actual current-engine move");
    const activated = apply(state, battleAction.action);
    assert.equal(activated.sides.p1.zones.deck.length, state.sides.p1.zones.deck.length - 1, "applying the exact offer resolves its printed draw effect");
  } finally {
    for (const [id, prior] of previous) {
      if (prior) DEFS[id] = prior;
      else delete DEFS[id];
    }
  }
}

console.log("Abilities now projection checks passed.");
