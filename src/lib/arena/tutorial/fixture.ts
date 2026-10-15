import type { CardDef, EngineContext } from "../types";
import { RULES, type VmState } from "../vm";
import type { CardArt } from "../view";

export const PRACTICE_FIXTURE_VERSION = 1;
export const PRACTICE_GAME_ID = 841;
const card = (id: string, name: string, leader = false): CardDef => ({
  id, name, type: leader ? "LEADER" : "BATTLE", colors: ["Red"], energyCost: leader ? null : 1,
  specifiedCost: leader ? {} : { Red: 1 }, zEnergyCost: null, power: 10000,
  comboCost: leader ? null : 0, comboPower: leader ? null : 5000,
  skill: null, characters: [name], traits: ["Training"],
});
export const PRACTICE_CARDS: Record<string, CardDef> = {
  "TRAIN-LEADER": card("TRAIN-LEADER", "Tournament Trainee", true),
  "TRAIN-SCOUT": card("TRAIN-SCOUT", "Red Training Scout"),
  "TRAIN-PARTNER": card("TRAIN-PARTNER", "Red Sparring Partner"),
};
// Skill-less synthetic cards have explicit, complete precompiled rule records.
export const PRACTICE_CONTEXT: EngineContext = {
  defs: PRACTICE_CARDS,
  scripts: Object.fromEntries(Object.keys(PRACTICE_CARDS).map(id => [id, { bySkill: {}, complete: true, unsupported: [] }])),
};
export const PRACTICE_ART: Record<string, CardArt> = Object.fromEntries(Object.keys(PRACTICE_CARDS).map(id => [id, { front: `/arena/tutorial/cards/${id}.svg`, back: null }]));

/** Normal engine setup first; this fresh fixture alone then uses the disclosed three-Life shortcut. */
export function createPracticeState(): VmState {
  const deck = { name: "Synthetic red training deck", leader: "TRAIN-LEADER", main: Array.from({ length: 50 }, (_, i) => i % 2 ? "TRAIN-SCOUT" : "TRAIN-PARTNER") };
  let state = RULES.createGame(PRACTICE_CONTEXT, { seed: 841, p1: deck, p2: deck }).state;
  for (let n = 0; state.phase === "setup" && n < 12; n++) {
    const actions = RULES.legalActions(PRACTICE_CONTEXT, state);
    const action = actions.find(x => x.action.type === "chooseFirst" && x.action.first === "p1")?.action
      ?? actions.find(x => x.action.type === "mulligan" && !x.action.redraw)?.action;
    if (!action) throw new Error("Training setup changed: unsupported prompt");
    state = RULES.apply(PRACTICE_CONTEXT, state, action).state;
  }
  if (state.phase === "setup") throw new Error("Training setup did not finish");
  for (const player of ["p1", "p2"] as const) {
    const zones = state.sides[player].zones;
    // Return all five extra cards to deck, conserving every instance.
    zones.deck.push(...zones.life.splice(3));
  }
  return state;
}
