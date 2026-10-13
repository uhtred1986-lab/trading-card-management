/** Focused engine evidence for #558's authoritative ability availability. */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import { counterAbilityAvailability, selectedCounterSkill } from "../../src/lib/arena/vm/battle";
import { abilityViews } from "../../src/lib/arena/view";
import { parseSkills } from "../../src/lib/arena/text/cards";
import type { Action, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const engine = RULES;
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const dbs = loaded.definition;
const ids = ["H558_MAIN", "H558_BATTLE", "H558_ATTACK", "H558_ENERGY", "H558_COST", "H558_COUNTER", "H558_COUNTER_PLAY", "H558_MULTI_COUNTER", "H558_MIXED_COUNTER", "H558_AUTO"];
const previous = new Map(ids.map((id) => [id, DEFS[id]]));

DEFS.H558_MAIN = card("H558_MAIN", { energyCost: 0, power: 10000, skill: "[Activate: Main][Once per turn] Draw 1 card." });
DEFS.H558_BATTLE = card("H558_BATTLE", { energyCost: 0, power: 10000, skill: "[Activate: Battle]: Draw 1 card." });
DEFS.H558_ATTACK = card("H558_ATTACK", { energyCost: 0, power: 20000, skill: null });
DEFS.H558_ENERGY = card("H558_ENERGY", { energyCost: 0, colors: ["Blue"], skill: null });
DEFS.H558_COST = card("H558_COST", { energyCost: 0, power: 10000, skill: "[Activate: Main]{r}: Draw 1 card." });
DEFS.H558_COUNTER = card("H558_COUNTER", { energyCost: 0, skill: "[Counter: Attack] Negate the attack." });
DEFS.H558_COUNTER_PLAY = card("H558_COUNTER_PLAY", { energyCost: 0, skill: "[Counter: Play] The Battle Card being played is placed in its owner's Drop Area instead of being played." });
DEFS.H558_MULTI_COUNTER = card("H558_MULTI_COUNTER", { energyCost: 0, skill: "[Counter: Attack] Negate the attack.<br>[Counter: Attack] Negate the attack." });
DEFS.H558_MIXED_COUNTER = card("H558_MIXED_COUNTER", { energyCost: 0, skill: "[Counter: Attack]{u}: Negate the attack.<br>[Counter: Play] The Battle Card being played is placed in its owner's Drop Area instead of being played." });
DEFS.H558_AUTO = card("H558_AUTO", { energyCost: 0, power: 10000, skill: "[Auto] When this card is played, draw 1 card." });

function fresh(seed: number): VmState {
  return engine.createGame(CTX, {
    seed,
    p1: { name: "You", leader: "L-RED", main: fifty("V1") },
    p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") },
  }).state as VmState;
}

function apply(state: VmState, action: Action): VmState {
  return engine.apply(CTX, state, action).state as VmState;
}

function mainPhase(seed = 558): VmState {
  let state = fresh(seed);
  state = apply(state, { type: "chooseFirst", player: state.chooser, first: "p1" });
  for (let i = 0; i < 24 && state.prompt.kind !== "main"; i++) {
    const player = (state.prompt as { player: PlayerId }).player;
    state = apply(state, { type: "pass", player });
  }
  assert.equal(state.prompt.kind, "main");
  return state;
}

function secondPlayerMain(seed = 5580): VmState {
  let state = fresh(seed);
  state = apply(state, { type: "chooseFirst", player: state.chooser, first: "p2" });
  for (let i = 0; i < 40 && !(state.prompt.kind === "main" && state.prompt.player === "p1"); i++) {
    const player = (state.prompt as { player: PlayerId }).player;
    state = state.prompt.kind === "main" ? apply(state, { type: "endMain", player }) : apply(state, { type: "pass", player });
  }
  assert.equal(state.prompt.kind, "main");
  assert.equal((state.prompt as { player: PlayerId }).player, "p1");
  return state;
}

function stage(state: VmState, player: PlayerId, cardId: string, area: "hand" | "battle" | "energy", excluded: string[] = []): string {
  const id = state.sides[player].zones.hand.find((candidate) => !excluded.includes(candidate));
  assert.ok(id);
  state.cards[id].cardId = cardId;
  if (area !== "hand") assert.ok(moveCard(state, dbs, id, area, { owner: player }).ok);
  return id;
}

function rows(state: VmState, viewer: PlayerId) {
  const legal = engine.legalActions(CTX, state);
  const rejected = engine.rejectedActions(CTX, state, legal);
  return engine.abilityAvailability(CTX, state, viewer, legal, rejected);
}

function cleanup(): void {
  for (const id of ids) {
    const prior = previous.get(id);
    if (prior) DEFS[id] = prior;
    else delete DEFS[id];
  }
}

try {
  // At the actual current Main prompt, a visible Battle Area Main skill is
  // offered with its exact action and a hand copy is refused for its zone.
  {
    const state = mainPhase();
    const inBattle = stage(state, "p1", "H558_MAIN", "battle");
    const inHand = stage(state, "p1", "H558_MAIN", "hand", [inBattle]);
    const battleOnly = stage(state, "p1", "H558_BATTLE", "battle", [inBattle, inHand]);
    const result = rows(state, "p1");
    assert.equal(result.find((row) => row.card === inBattle)?.state, "offered");
    assert.equal(result.find((row) => row.card === inHand)?.state, "refused");
    assert.ok(result.find((row) => row.card === inHand)?.why?.some((why) => why.kind === "zone" && why.area === "battle"));
    assert.equal(result.find((row) => row.card === battleOnly)?.state, "refused");
    assert.ok(result.find((row) => row.card === battleOnly)?.why?.some((why) => why.kind === "timing" && why.window === "battle"));
    const capturedOffer = result.find((row) => row.card === inBattle)?.offers?.[0]?.action;
    assert.ok(capturedOffer);
    const afterEndMain = apply(state, { type: "endMain", player: "p1" });
    assert.throws(() => engine.apply(CTX, afterEndMain, capturedOffer), /prompt|decision|activate|not available|cannot/i,
      "the snapshot evidence does not relax the engine's fresh prompt/action gate");
  }

  // Charge is a real prompt produced by the engine. The same acting player's
  // otherwise-valid Main skill receives the declaration's timing gate.
  {
    let state = fresh(5581);
    state = apply(state, { type: "chooseFirst", player: state.chooser, first: "p1" });
    for (let i = 0; i < 12 && state.prompt.kind !== "charge"; i++) {
      const player = (state.prompt as { player: PlayerId }).player;
      state = apply(state, { type: "pass", player });
    }
    assert.equal(state.prompt.kind, "charge");
    const id = stage(state, "p1", "H558_MAIN", "battle");
    const before = JSON.stringify(state);
    const row = rows(state, "p1").find((item) => item.card === id);
    assert.equal(row?.state, "refused");
    assert.ok(row?.why?.some((why) => why.kind === "timing" && why.window === "main"));
    assert.equal(JSON.stringify(state), before, "availability is a read-only query");
  }

  // Once-per-turn refusal comes from the engine's same per-skill activation
  // gate, even if the line would otherwise be legal now.
  {
    const state = mainPhase(5582);
    const id = stage(state, "p1", "H558_MAIN", "battle");
    state.cards[id].usedThisTurn.push(0);
    const row = rows(state, "p1").find((item) => item.card === id);
    assert.equal(row?.state, "refused");
    assert.ok(row?.why?.some((why) => why.kind === "oncePerTurn"));
  }

  // A legal attack opens the real combo prompt, where the native Battle
  // activation path offers an Activate: Battle line to its decision actor.
  {
    const state = secondPlayerMain(55821);
    const source = stage(state, "p1", "H558_BATTLE", "battle");
    const attack = engine.legalActions(CTX, state).find((item) => item.action.type === "attack" && item.action.attacker === state.sides.p1.zones.leader[0]);
    assert.ok(attack);
    const afterAttack = apply(state, attack.action);
    assert.equal(afterAttack.prompt.kind, "combo");
    const row = rows(afterAttack, "p1").find((item) => item.card === source);
    assert.equal(row?.state, "offered");
  }

  // Resource shortfall remains the planner's exact refusal, distinct from
  // timing and once-per-turn gates.
  {
    const state = mainPhase(55822);
    const id = stage(state, "p1", "H558_COST", "battle");
    const row = rows(state, "p1").find((item) => item.card === id);
    assert.equal(row?.state, "refused");
    assert.ok(row?.why?.some((why) => why.kind === "energy" || why.kind === "energyColour"));
  }

  // The native attack window reports the precise first matching Counter line.
  // A Counter: Play line in that window is refused for its printed timing,
  // and the second same-kind line remains addressable by its explicit index.
  {
    const state = secondPlayerMain(55823);
    const counter = stage(state, "p2", "H558_COUNTER", "hand");
    const playCounter = stage(state, "p2", "H558_COUNTER_PLAY", "hand", [counter]);
    const multiple = stage(state, "p2", "H558_MULTI_COUNTER", "hand", [counter, playCounter]);
    const mixed = stage(state, "p2", "H558_MIXED_COUNTER", "hand", [counter, playCounter, multiple]);
    const energy = stage(state, "p2", "H558_ENERGY", "energy", [counter, playCounter, multiple, mixed]);
    const attack = engine.legalActions(CTX, state).find((item) => item.action.type === "attack" && item.action.attacker === state.sides.p1.zones.leader[0] && item.action.target === state.sides.p2.zones.leader[0]);
    assert.ok(attack);
    const prompt = apply(state, attack.action);
    assert.equal(prompt.prompt.kind, "counter");
    const beforeQuery = JSON.stringify(prompt);
    const availability = rows(prompt, "p2");
    assert.equal(JSON.stringify(prompt), beforeQuery, "Counter availability is read-only and does not spend cost or alter the window");
    const offered = availability.find((row) => row.card === counter);
    assert.equal(offered?.state, "offered");
    assert.equal(offered?.skill, 0);
    assert.deepEqual(offered?.offers?.[0]?.cost, { energy: 0, describe: "free" }, "native zero-resource Counter cost is known, not inferred by the client");
    const mixedAttack = availability.find((row) => row.card === mixed && row.skill === 0);
    assert.equal(mixedAttack?.state, "offered");
    assert.equal(mixedAttack?.offers?.[0]?.cost?.energy, 1);
    assert.equal(mixedAttack?.offers?.[0]?.cost?.orbs?.Blue, 1);
    const mixedPlay = availability.find((row) => row.card === mixed && row.skill === 10);
    assert.equal(mixedPlay?.state, "refused");
    assert.ok(mixedPlay?.why?.some((why) => why.kind === "timing" && why.window === "play"), "the selector fallback must not misclassify a mixed-card Counter line's window");
    const paidMixed = engine.apply(CTX, prompt, mixedAttack!.offers![0].action);
    assert.equal(paidMixed.state.cards[energy].mode, "rest", "the displayed native price equals the actual charge");
    assert.equal(prompt.cards[energy].mode, "active", "the read-only price query does not pay energy");
    const wrongWindow = availability.find((row) => row.card === playCounter);
    assert.equal(wrongWindow?.state, "refused");
    assert.ok(wrongWindow?.why?.some((why) => why.kind === "timing"));
    const firstLine = selectedCounterSkill(CTX, prompt, multiple, "attack");
    const secondLine = selectedCounterSkill(CTX, prompt, multiple, "attack", 10);
    assert.equal(firstLine?.index, 0);
    assert.equal(secondLine?.index, 10);
    const multiRow = availability.find((row) => row.card === multiple);
    assert.equal(multiRow?.state, "offered");
    assert.equal(multiRow?.skill, 0, "an unqualified counter action uses the same first matching line as the menu");
    assert.equal(availability.find((row) => row.card === multiple && row.skill === 10)?.notEvaluatedReason, "unidentifiedAction",
      "the real native menu does not claim its card-level action belongs to the second matching line");
    const promptLegal = engine.legalActions(CTX, prompt);
    const promptSnapshot = buildSnapshot({
      id: 55823,
      mode: "versus",
      status: "playing",
      p1Name: "You",
      p2Name: "Other",
      ctx: CTX,
      state: prompt,
      legal: promptLegal,
      log: [],
      beats: null,
      spotlight: null,
      spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 },
      ai: null,
      viewer: "p2",
      images: {},
    });
    const multiSnapshotRows = promptSnapshot.view.you.hand?.find((view) => view.id === multiple)?.abilities;
    assert.equal(multiSnapshotRows?.find((row) => row.skillIndex === 0)?.availability, "offered");
    assert.equal(multiSnapshotRows?.find((row) => row.skillIndex === 10)?.notEvaluatedReason, "unidentifiedAction");

    // Projection-only fixture: if a caller supplies a native counter action
    // with an explicit second-line identity, group that offer on index 10.
    // This does not claim the current counter menu itself emits such a row.
    const actualLegal = engine.legalActions(CTX, prompt);
    const supplied = [...actualLegal];
    supplied.push({ action: { type: "counter", player: "p2", card: multiple, skill: 10, alt: true }, label: "synthetic explicit-index fixture" });
    const projected = counterAbilityAvailability(CTX, dbs, prompt, "p2", supplied, engine.rejectedActions(CTX, prompt, actualLegal));
    assert.equal(projected.find((row) => row.card === multiple && row.skill === 10)?.state, "offered");
    assert.equal(projected.find((row) => row.card === multiple && row.skill === 0)?.state, "offered");
    const projectedViews = abilityViews({
      card: multiple,
      skills: parseSkills(DEFS.H558_MULTI_COUNTER.skill),
      copied: new Set(),
      zone: "hand",
      owner: "p2",
      controller: "p2",
      viewer: "p2",
      used: [],
      pending: new Set(),
      availability: projected,
      decisionActor: "p2",
      permanents: [],
    });
    assert.equal(projectedViews.find((row) => row.skillIndex === 10)?.availability, "offered");
  }

  // The real play counter window offers Counter: Play and reports Counter:
  // Attack on the same hand card as a timing refusal.
  {
    const state = mainPhase(55824);
    const played = stage(state, "p1", "H558_ATTACK", "hand");
    const playCounter = stage(state, "p2", "H558_COUNTER_PLAY", "hand");
    const attackCounter = stage(state, "p2", "H558_COUNTER", "hand", [playCounter]);
    const play = engine.legalActions(CTX, state).find((item) => item.action.type === "play" && item.action.card === played);
    assert.ok(play);
    const prompt = apply(state, play.action);
    assert.equal(prompt.prompt.kind, "counter");
    const availability = rows(prompt, "p2");
    assert.equal(availability.find((row) => row.card === playCounter)?.state, "offered");
    const wrongWindow = availability.find((row) => row.card === attackCounter);
    assert.equal(wrongWindow?.state, "refused");
    assert.ok(wrongWindow?.why?.some((why) => why.kind === "timing"));
  }

  // On the opponent's real Main prompt, the viewer's own private skill has an
  // explicit actor reason and is not evaluated for price or affordability.
  {
    let state = mainPhase(5583);
    const privateId = stage(state, "p1", "H558_MAIN", "battle");
    state = apply(state, { type: "endMain", player: "p1" });
    for (let i = 0; i < 24 && !(state.prompt.kind === "main" && state.prompt.player === "p2"); i++) {
      const player = (state.prompt as { player: PlayerId }).player;
      if (state.prompt.kind === "main") state = apply(state, { type: "endMain", player });
      else state = apply(state, { type: "pass", player });
    }
    assert.equal(state.prompt.kind, "main");
    assert.equal((state.prompt as { player: PlayerId }).player, "p2");
    const row = rows(state, "p1").find((item) => item.card === privateId);
    assert.equal(row?.state, "notEvaluated");
    assert.equal(row?.notEvaluatedReason, "notDecisionActor");
  }

  // The two seat projections retain public in-play ability text, mark the
  // other seat's price as unevaluated, and never expose hidden hand/life ids.
  {
    let state = mainPhase(55831);
    state = apply(state, { type: "endMain", player: "p1" });
    for (let i = 0; i < 24 && !(state.prompt.kind === "main" && state.prompt.player === "p2"); i++) {
      const player = (state.prompt as { player: PlayerId }).player;
      state = state.prompt.kind === "main" ? apply(state, { type: "endMain", player }) : apply(state, { type: "pass", player });
    }
    assert.equal(state.prompt.kind, "main");
    assert.equal((state.prompt as { player: PlayerId }).player, "p2");
    const publicSkill = stage(state, "p2", "H558_MAIN", "battle");
    const handSecret = stage(state, "p2", "H558_MAIN", "hand", [publicSkill]);
    const lifeSecret = stage(state, "p2", "H558_MAIN", "hand", [publicSkill, handSecret]);
    assert.ok(moveCard(state, dbs, lifeSecret, "life", { owner: "p2" }).ok);
    const ownCard = stage(state, "p1", "H558_MAIN", "hand");
    const legal = engine.legalActions(CTX, state);
    const snapshot = buildSnapshot({
      id: 55831,
      mode: "versus",
      status: "playing",
      p1Name: "You",
      p2Name: "Other",
      ctx: CTX,
      state,
      legal,
      log: [],
      beats: null,
      spotlight: null,
      spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 },
      ai: null,
      viewer: "p1",
      images: {},
    });
    assert.equal(snapshot.decision?.actor, "p2");
    assert.equal(snapshot.view.them.hand, null);
    const publicRow = snapshot.view.them.battle.find((view) => view.id === publicSkill)?.abilities?.[0];
    assert.equal(publicRow?.availability, "notEvaluated");
    assert.equal(publicRow?.notEvaluatedReason, "notDecisionActor");
    const ownHandRow = snapshot.view.you.hand?.find((view) => view.id === ownCard)?.abilities?.[0];
    assert.equal(ownHandRow?.availability, "notEvaluated");
    assert.equal(ownHandRow?.notEvaluatedReason, "notDecisionActor");
    const wire = JSON.stringify(snapshot);
    assert.ok(!wire.includes(handSecret));
    assert.ok(!wire.includes(lifeSecret));

    const secondViewer = buildSnapshot({
      id: 55832,
      mode: "versus",
      status: "playing",
      p1Name: "You",
      p2Name: "Other",
      ctx: CTX,
      state,
      legal,
      log: [],
      beats: null,
      spotlight: null,
      spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 },
      ai: null,
      viewer: "p2",
      images: {},
    });
    assert.ok(secondViewer.view.you.hand?.some((view) => view.id === handSecret));
    assert.equal(secondViewer.view.them.hand, null);
    const secondWire = JSON.stringify(secondViewer);
    assert.ok(!secondWire.includes(ownCard), "the other viewer's closed hand identity stays private");
    assert.ok(!secondWire.includes(lifeSecret), "face-down life identity stays private to both viewers");
  }

  // An Auto remains visibly pending after the checkpoint removes it from the
  // queue and while its stored program waits for a decision. Only the visible
  // card/line identity is projected; trigger bindings and frame data stay private.
  {
    const state = mainPhase(55833);
    const autoId = stage(state, "p1", "H558_AUTO", "battle");
    const skillIndex = parseSkills(DEFS.H558_AUTO.skill).find((skill) => skill.kind === "auto")!.index;
    const snapshot = (current: VmState) => buildSnapshot({
      id: 55833,
      mode: "versus",
      status: "playing",
      p1Name: "You",
      p2Name: "Other",
      ctx: CTX,
      state: current,
      legal: engine.legalActions(CTX, current),
      log: [],
      beats: null,
      spotlight: null,
      spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 },
      ai: null,
      viewer: "p1",
      images: {},
    });
    state.pending.push({ card: autoId, skillIndex, master: "p1", trigger: "played" });
    assert.equal(snapshot(state).view.you.battle.find((view) => view.id === autoId)?.abilities?.[0]?.pending, true,
      "queued Auto is visibly pending");

    state.pending = [];
    state.programs = [{
      ops: [], ip: 0, vars: {}, card: autoId, master: "p1", trigger: "played", skillIndex,
      awaiting: "chooseCards", subject: "PRIVATE_SUBJECT_SENTINEL",
      // A synthetic extension stands in for a checkpoint paused at the
      // payment prompt; the contract must not depend on or serialize it.
      paymentContinuation: { source: "PRIVATE_SOURCE_SENTINEL", selected: ["PRIVATE_CARD_SENTINEL"] },
    } as unknown as VmState["programs"][number]];
    const pausedWire = JSON.stringify(snapshot(state));
    const paused = JSON.parse(pausedWire) as ReturnType<typeof snapshot>;
    assert.equal(paused.view.you.battle.find((view) => view.id === autoId)?.abilities?.[0]?.pending, true,
      "the Auto remains pending while its stored resolution is paused");
    assert.ok(!pausedWire.includes("PRIVATE_SUBJECT_SENTINEL"));
    assert.ok(!pausedWire.includes("PRIVATE_SOURCE_SENTINEL"));
    assert.ok(!pausedWire.includes("PRIVATE_CARD_SENTINEL"));

    state.programs = [];
    assert.equal(snapshot(state).view.you.battle.find((view) => view.id === autoId)?.abilities?.[0]?.pending, false,
      "cleared or resolved Auto no longer appears pending");
  }
} finally {
  cleanup();
}

console.log("  ✓ #558 query reports current, wrong-zone, wrong-window, limit, and not-decision-actor evidence without mutating state");
