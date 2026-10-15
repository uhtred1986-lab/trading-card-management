/** Admin-only diagnostics. Snapshots and traces contain private deck data; never serve them to players. */
import { RULES, isVmState, type VmState } from "../../src/lib/arena/vm";
import { resolveOutcome, type StoredOutcome } from "../../src/lib/arena/outcome";
import { parseSkills } from "../../src/lib/arena/text/cards";
import type { Action, EngineContext, GameOptions } from "../../src/lib/arena/types";

export interface FuzzTrace {
  format: "arena-fuzz-trace-v1";
  context: EngineContext;
  options: GameOptions;
  /** Includes the attempted action when apply or its resulting invariant throws. */
  actions: Action[];
}

export interface FuzzInterruption {
  sourceCard?: string;
  cardId?: string;
  name?: string;
  side?: "front" | "back";
  skillIndex?: number;
  printed?: string;
  trigger?: string;
  issue?: string;
  detail?: string;
}

export interface FuzzResult {
  status: "completed" | "interrupted" | "action-limit" | "crash";
  seed: number;
  steps: number;
  turn: number;
  lastAction: string | null;
  outcome: StoredOutcome | null;
  interruption?: FuzzInterruption;
  error?: string;
  trace: FuzzTrace;
}

/** Rule 3-1: every card in exactly one zone or pile. */
export function checkFuzzState(state: unknown): VmState {
  if (!isVmState(state)) throw new Error(`the rules engine returned a state it does not recognise: ${JSON.stringify(state).slice(0, 120)}`);
  const seen = new Map<string, number>();
  for (const side of Object.values(state.sides)) for (const [zone, ids] of Object.entries(side.zones)) {
    for (const id of ids) {
      if (!state.cards[id]) throw new Error(`${side.id}'s ${zone} holds ${id}, which is not a card in the game`);
      seen.set(id, (seen.get(id) ?? 0) + 1);
    }
  }
  for (const card of Object.values(state.cards)) for (const id of card.under) seen.set(id, (seen.get(id) ?? 0) + 1);
  for (const id of Object.keys(state.cards)) {
    if (seen.get(id) !== 1) throw new Error(`${id} (${state.cards[id].cardId}) is in ${seen.get(id) ?? 0} places, not 1`);
  }
  return state;
}

export function fuzzInterruption(context: EngineContext, state: VmState, printedSkills: Map<string, string>): FuzzInterruption | undefined {
  if (resolveOutcome(state)?.kind !== "interrupted") return;
  const detail = state.outcome?.privateContext ?? {};
  const card = detail.sourceCard ? state.cards[detail.sourceCard] : undefined;
  const def = card ? context.defs[card.cardId] : undefined;
  const side = card?.flipped ? "back" : "front";
  const text = side === "back" ? def?.back?.skill : def?.skill;
  const printed = detail.skillIndex == null ? undefined
    : printedSkills.get(`${detail.sourceCard}#${detail.skillIndex}`) ?? parseSkills(text).find((sk) => sk.index === detail.skillIndex)?.raw;
  return { ...detail, ...(card ? { cardId: card.cardId, name: def?.name, side } : {}), ...(printed ? { printed } : {}) };
}

/** The old fuzz's exact random calls and bias, or a recorded sequence with no randomness. */
export function runFuzzGame(context: EngineContext, options: GameOptions, input: { random: () => number; maxActions?: number; note?: (text: string) => void } | { actions: Action[] }): FuzzResult {
  const trace: FuzzTrace = { format: "arena-fuzz-trace-v1", context, options, actions: [] };
  const printedSkills = new Map<string, string>();
  let state: VmState | undefined;
  let steps = 0;
  let lastAction: string | null = null;
  const result = (status: FuzzResult["status"], error?: string): FuzzResult => ({
    status, seed: options.seed, steps, turn: state?.turn ?? 0, lastAction,
    outcome: state?.outcome ?? (state ? resolveOutcome(state) : null),
    ...(state && fuzzInterruption(context, state, printedSkills) ? { interruption: fuzzInterruption(context, state, printedSkills) } : {}),
    ...(error ? { error } : {}), trace,
  });
  try {
    state = checkFuzzState(RULES.createGame(context, options).state);
    const limit = "actions" in input ? input.actions.length : input.maxActions ?? 4000;
    while (state.phase !== "over" && steps < limit) {
      const legal = RULES.legalActions(context, state);
      if (!legal.length) throw new Error(`no legal actions at prompt ${JSON.stringify(state.prompt)}`);
      let action: Action;
      if ("actions" in input) {
        action = input.actions[steps];
        lastAction = legal.find((l) => JSON.stringify(l.action) === JSON.stringify(action))?.label ?? JSON.stringify(action);
      } else {
        const pool = legal.filter((l) => l.action.type !== "endMain" && l.action.type !== "concede");
        const pick = pool.length && input.random() < 0.85 ? pool[Math.floor(input.random() * pool.length)] : legal[Math.floor(input.random() * legal.length)];
        action = pick.action;
        lastAction = pick.label;
      }
      trace.actions.push(structuredClone(action));
      const applied = RULES.apply(context, state, action);
      for (const event of applied.events) {
        if (event.type === "skill") printedSkills.set(`${event.card}#${event.skill}`, event.text);
        if (event.type === "note" && "note" in input) input.note?.(event.text);
      }
      state = checkFuzzState(applied.state);
      steps++;
    }
    return result(state.phase !== "over" ? "action-limit" : resolveOutcome(state)?.kind === "interrupted" ? "interrupted" : "completed");
  } catch (error) {
    return result("crash", error instanceof Error ? error.message : String(error));
  }
}

export function replayFuzzTrace(trace: FuzzTrace): FuzzResult {
  if (trace.format !== "arena-fuzz-trace-v1") throw new Error("unsupported fuzz trace format");
  return runFuzzGame(trace.context, trace.options, { actions: trace.actions });
}
