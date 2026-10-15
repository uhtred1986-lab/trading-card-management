import type { EngineContext } from "../types";
import { RULES, type VmState } from "../vm";
import type { CardArt } from "../view";
import pack from "./classic-pack.json";

export const PRACTICE_FIXTURE_VERSION = 2;
export const PRACTICE_GAME_ID = 841;
export const PRACTICE_SEED = 7;
export const PRACTICE_CARDS = (pack as unknown as EngineContext).defs;
export const PRACTICE_CONTEXT: EngineContext = { defs: PRACTICE_CARDS, scripts: (pack as unknown as EngineContext).scripts };
export const PRACTICE_ART = pack.art as Record<string, CardArt>;
const copies = (four: string[], two: string[]) => [...four.flatMap(id => Array(4).fill(`BT1-${id}`)), ...two.flatMap(id => Array(2).fill(`BT1-${id}`))] as string[];
export const PRACTICE_DECKS = {
  p1: { name: "You · Goku", leader: "BT1-056", main: copies(["060", "061", "062", "065", "066", "068", "071", "072", "079", "080", "082"], ["064", "067", "070"]) },
  p2: { name: "Frieza", leader: "BT1-084", main: copies(["089", "093", "096", "097", "099", "102", "103", "104", "105", "109", "088"], ["090", "094", "098"]) },
};
/** Ordinary engine setup: first player, keep both hands, eight Life. */
export function createPracticeState(seed = PRACTICE_SEED): VmState {
  let state = RULES.createGame(PRACTICE_CONTEXT, { seed, ...PRACTICE_DECKS }).state;
  for (let n = 0; state.phase === "setup" && n < 12; n++) {
    const actions = RULES.legalActions(PRACTICE_CONTEXT, state);
    const action = actions.find(x => x.action.type === "chooseFirst" && x.action.first === "p1")?.action
      ?? actions.find(x => x.action.type === "mulligan" && !x.action.redraw)?.action;
    if (!action) throw new Error("Training setup changed: unsupported prompt");
    state = RULES.apply(PRACTICE_CONTEXT, state, action).state;
  }
  if (state.phase === "setup") throw new Error("Training setup did not finish");
  return state;
}
