/**
 * Engine-built fixtures for the #561 browser proof. The card rows below keep
 * the checked-in design catalog facts (BT11-053/BT1-055, Blue Extra, no power or
 * combo stats) and printed ability wording; all windows, availability, costs,
 * legal actions and snapshots are then produced by the rules engine.
 */
import { CTX, DEFS, card, fifty, rulesFromCompiler } from "./harness";
import { engineFor } from "../../src/lib/arena/engines";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { buildSnapshot, type Snapshot } from "../../src/lib/arena/snapshot";
import type { CardArt } from "../../src/lib/arena/view";
import type { Action, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

export const SENZU_ID = "BT11-053";
export const WHIS_ID = "BT1-055";
export const SENZU_TEXT = "[Activate: Battle] Choose up to 1 of your cards. It gains +5000 power for the duration of the turn. Then, choose up to 2 of your energy and switch them to Active Mode.";
export const WHIS_TEXT = "[Counter: Attack] Negate the attack. Then, choose up to 1 of your energy and switch it to Active Mode.";

const fixtureIds = [SENZU_ID, WHIS_ID, "U04_BLUE_ENERGY"];
const previous = new Map(fixtureIds.map((id) => [id, DEFS[id]] as const));

DEFS[SENZU_ID] = card(SENZU_ID, {
  name: "Senzu Bean",
  type: "EXTRA",
  colors: ["Blue"],
  energyCost: 1,
  specifiedCost: { Blue: 1 },
  power: null,
  comboCost: null,
  comboPower: null,
  skill: SENZU_TEXT,
});
DEFS[WHIS_ID] = card(WHIS_ID, {
  name: "Whis's Coercion",
  type: "EXTRA",
  colors: ["Blue"],
  energyCost: 1,
  specifiedCost: { Blue: 1 },
  power: null,
  comboCost: null,
  comboPower: null,
  skill: WHIS_TEXT,
});
DEFS.U04_BLUE_ENERGY = card("U04_BLUE_ENERGY", {
  type: "BATTLE",
  colors: ["Blue"],
  energyCost: 0,
  skill: null,
});

const ctx = { ...CTX, defs: DEFS, scripts: rulesFromCompiler(DEFS) };
const engine = engineFor("rules");
const dbsLoaded = rulesetFor("dbs");
if (!dbsLoaded.ok) throw new Error(`DBS ruleset failed to load: ${JSON.stringify(dbsLoaded.errors)}`);
const dbs = dbsLoaded.definition;

function fresh(seed: number): VmState {
  return engine.createGame(ctx, {
    seed,
    p1: { name: "You", leader: "L-RED", main: fifty("V1") },
    p2: { name: "Opponent", leader: "L-BLUE", main: fifty("V-BLUE") },
  }).state as VmState;
}

export function apply(state: VmState, action: Action): VmState {
  return engine.apply(ctx, state, action).state as VmState;
}

export function applyWithEvents(state: VmState, action: Action) {
  const result = engine.apply(ctx, state, action);
  return { state: result.state as VmState, events: result.events };
}

function firstMain(seed: number, first: PlayerId, target: PlayerId): VmState {
  let state = fresh(seed);
  state = apply(state, { type: "chooseFirst", player: state.chooser, first });
  for (let n = 0; n < 60 && !(state.prompt.kind === "main" && state.prompt.player === target); n++) {
    const prompt = state.prompt as { kind: string; player?: PlayerId };
    if (prompt.kind === "main") state = apply(state, { type: "endMain", player: prompt.player! });
    else state = apply(state, { type: "pass", player: prompt.player! });
  }
  if (state.prompt.kind !== "main" || state.prompt.player !== target) throw new Error(`Could not reach ${target}'s Main Phase`);
  return state;
}

function stageFromHand(state: VmState, player: PlayerId, cardId: string, excluded: string[] = []): string {
  const id = state.sides[player].zones.hand.find((candidate) => !excluded.includes(candidate));
  if (!id) throw new Error(`${player} has no fixture instance to stage`);
  state.cards[id].cardId = cardId;
  return id;
}

function blueEnergy(state: VmState, player: PlayerId, excluded: string[] = []): string {
  const id = stageFromHand(state, player, "U04_BLUE_ENERGY", excluded);
  const moved = moveCard(state, dbs, id, "energy", { owner: player });
  if (!moved.ok) throw new Error(`Could not stage Blue energy: ${JSON.stringify(moved)}`);
  state.cards[id].mode = "active";
  return id;
}

function attackLeader(state: VmState, attacker: PlayerId): VmState {
  const attack = engine.legalActions(ctx, state).find((row) => row.action.type === "attack" && row.action.attacker === state.sides[attacker].zones.leader[0] && row.action.target === state.sides[attacker === "p1" ? "p2" : "p1"].zones.leader[0]);
  if (!attack) throw new Error(`${attacker} leader has no legal leader attack at ${state.prompt.kind}; leader=${state.sides[attacker].zones.leader[0]} mode=${state.cards[state.sides[attacker].zones.leader[0]!]?.mode}; attacks=${JSON.stringify(engine.legalActions(ctx, state).filter((row) => row.action.type === "attack"))}`);
  state = apply(state, attack.action);
  if (state.prompt.kind === "combo" && state.prompt.player === attacker && state.prompt.side === "offense") {
    state = apply(state, { type: "pass", player: attacker });
  }
  return state;
}

function snap(state: VmState, revision: number, images: Record<string, CardArt>): Snapshot {
  const legal = engine.legalActions(ctx, state);
  return buildSnapshot({
    id: 561,
    revision,
    engine: "rules",
    mode: "versus",
    status: "playing",
    p1Name: "You",
    p2Name: "Opponent",
    ctx,
    state,
    legal,
    log: [],
    beats: null,
    spotlight: null,
    spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 },
    ai: null,
    viewer: "p1",
    images,
  });
}

export type SenzuFixture = { initial: Snapshot; fresh: Snapshot; state: VmState; card: string; energy: string };
export type WhisFixture = { snapshot: Snapshot; state: VmState; card: string; energy: string };

export function makeSenzuFixture(artUrl: string): SenzuFixture {
  let state = firstMain(56101, "p2", "p2");
  const card = stageFromHand(state, "p1", SENZU_ID);
  const whisCard = stageFromHand(state, "p1", WHIS_ID, [card]);
  const energy = blueEnergy(state, "p1", [card, whisCard]);

  state = apply(state, { type: "endMain", player: "p2" });
  for (let n = 0; n < 60 && !(state.prompt.kind === "main" && state.prompt.player === "p1"); n++) {
    const prompt = state.prompt as { kind: string; player?: PlayerId };
    if (prompt.kind === "main") state = apply(state, { type: "endMain", player: prompt.player! });
    else state = apply(state, { type: "pass", player: prompt.player! });
  }
  if (state.prompt.kind !== "main" || state.prompt.player !== "p1") throw new Error("Could not reach Senzu owner's Main Phase");

  state = apply(state, { type: "endMain", player: "p1" });
  for (let n = 0; n < 60 && !(state.prompt.kind === "main" && state.prompt.player === "p2"); n++) {
    const prompt = state.prompt as { kind: string; player?: PlayerId };
    if (prompt.kind === "main") state = apply(state, { type: "endMain", player: prompt.player! });
    else state = apply(state, { type: "pass", player: prompt.player! });
  }
  if (state.prompt.kind !== "main" || state.prompt.player !== "p2") throw new Error("Could not reach opponent's Main Phase");
  state = attackLeader(state, "p2");
  if (state.prompt.kind !== "counter" || state.prompt.player !== "p1") throw new Error(`Expected actual Counter: Attack prompt with Whis, got ${state.prompt.kind} ${JSON.stringify(state.prompt)}`);
  const images = {
    [SENZU_ID]: { front: artUrl, back: null },
    [WHIS_ID]: { front: "http://arena-561-art.local/BT1-055.webp", back: null },
  };
  const initial = snap(structuredClone(state) as VmState, 1, images);
  state = apply(state, { type: "counter", player: "p1", card: null });
  if (state.prompt.kind === "combo" && state.prompt.player === "p2") state = apply(state, { type: "pass", player: "p2" });
  if (state.prompt.kind !== "combo" || state.prompt.player !== "p1" || state.prompt.side !== "defense") throw new Error(`Expected the actual defender combo prompt, got ${state.prompt.kind} ${JSON.stringify(state.prompt)}`);
  const freshState = structuredClone(state) as VmState;
  return { initial, fresh: snap(freshState, 2, images), state: freshState, card, energy };
}

export function makeWhisFixture(artUrl: string): WhisFixture {
  let state = firstMain(56102, "p2", "p2");
  const card = stageFromHand(state, "p1", WHIS_ID);
  const energy = blueEnergy(state, "p1", [card]);
  state = apply(state, { type: "endMain", player: "p2" });
  for (let n = 0; n < 60 && !(state.prompt.kind === "main" && state.prompt.player === "p1"); n++) {
    const prompt = state.prompt as { kind: string; player?: PlayerId };
    if (prompt.kind === "main") state = apply(state, { type: "endMain", player: prompt.player! });
    else state = apply(state, { type: "pass", player: prompt.player! });
  }
  if (state.prompt.kind !== "main" || state.prompt.player !== "p1") throw new Error("Could not reach Senzu owner's Main Phase");
  state = apply(state, { type: "endMain", player: "p1" });
  for (let n = 0; n < 60 && !(state.prompt.kind === "main" && state.prompt.player === "p2"); n++) {
    const prompt = state.prompt as { kind: string; player?: PlayerId };
    if (prompt.kind === "main") state = apply(state, { type: "endMain", player: prompt.player! });
    else state = apply(state, { type: "pass", player: prompt.player! });
  }
  if (state.prompt.kind !== "main" || state.prompt.player !== "p2") throw new Error("Could not reach opponent's Main Phase");
  state = attackLeader(state, "p2");
  if (state.prompt.kind !== "counter" || state.prompt.player !== "p1") {
    const legal = engine.legalActions(ctx, state);
    throw new Error(`Expected the actual defender Counter: Attack prompt, got ${state.prompt.kind} ${JSON.stringify(state.prompt)}; legal=${JSON.stringify(legal)}; Whis=${JSON.stringify(engine.abilityAvailability(ctx, state, "p1", legal, engine.rejectedActions(ctx, state, legal)))}`);
  }
  return {
    snapshot: snap(state, 1, { [WHIS_ID]: { front: artUrl, back: null } }),
    state,
    card,
    energy,
  };
}

export function exactCurrentAction(snapshot: Snapshot, type: "activate" | "counter", card: string) {
  return snapshot.legal.find((row) => row.action.type === type && row.action.card === card)?.action ?? null;
}

export function restoreFixtureDefs(): void {
  for (const [id, prior] of previous) {
    if (prior) DEFS[id] = prior;
    else delete DEFS[id];
  }
}
