/**
 * #642: named, database-free scenarios on the pinned rules engine, and the executor that checks
 * them. Portable on purpose — like `arena-browser-scenario.ts` it imports only `browser.ts` and
 * `replay-core.ts`, so the same file runs under Node (`scripts/arena-scenario.mts`,
 * `scripts/verify/arena-scenario-runner.ts` in `npm test`) and inside the real browser module
 * worker (`arena-scenario-worker.ts`, `arena-scenario.mts --browser`).
 *
 * A scenario is data: a list of steps, each choosing moves from the engine's own legal list (never
 * a hard-coded instance id, so it survives a different seed) and then asserting what must be true
 * of the state, the step's events and the legal moves. The engine is never duplicated; every move
 * goes through `applyMove`. Running one yields an evidence record — scenario id, seed, revisions,
 * bundle / state / events / legal-move / snapshot hashes, pass or fail and a bounded list of
 * differences — and the record contains nothing that varies between runs or machines, so two
 * runtimes agree exactly when their records are deeply equal.
 */
import type { Action, GameEvent, LegalAction, PlayerId } from "../../src/lib/arena/types";
import { applyMove, createPinnedMatch, legalMoves, projectSnapshot, type PinnedMatch } from "../../src/lib/arena/browser";
import { canonicalJson, replayHash, type ReplayBundleRecord } from "../../src/lib/arena/replay-core";

/** A legal action to choose: its `type`, every `where` field equal, then the `nth` match (default first). */
export interface Pick {
  type: string;
  where?: Record<string, unknown>;
  nth?: number;
}

/** Stop advancing when the prompt (and/or the legal list) looks like this. `$turn` / `$other` name seats. */
export interface Until {
  promptKind?: string;
  player?: string;
  legalType?: string;
}

export interface Expect {
  phase?: string;
  turn?: number;
  over?: boolean;
  /** A deep subset of `state.prompt`. Seat strings may be `$turn` or `$other` (relative to `turnPlayer`). */
  prompt?: Record<string, unknown>;
  /** The set of legal action types, exactly (order and repeats ignored). */
  legalTypes?: string[];
  /** Legal action types that must be among the legal moves. */
  legalIncludes?: string[];
  legalCount?: number;
  /** The legal actions that name a card are exactly `prompt.candidates` (a decline names none). */
  legalMatchPromptCandidates?: boolean;
  /** Zone sizes by seat (`p1`, `p2`, `$turn`, `$other`). */
  zones?: Record<string, Record<string, number>>;
  /** Event types of the step's events that must appear, in this order (other events may sit between). */
  eventsInclude?: string[];
  /** Event types that must not appear in the step's events. */
  eventsExclude?: string[];
  /** Raw actions the engine must refuse, leaving the match untouched. */
  refuses?: Record<string, unknown>[];
}

export interface Step {
  label: string;
  /** Apply one move picked from the legal list. */
  move?: Pick;
  /** Or apply `prefer` (first that matches, in order) until `until` holds, at most `max` moves. */
  advance?: { prefer: Pick[]; until: Until; max: number };
  expect: Expect;
}

export interface Scenario {
  id: string;
  description: string;
  seed: number;
  /** Expectations on the game as created, before any move. */
  initial?: Expect;
  steps: Step[];
  /** Deliberately wrong: never run by `all`; it proves a mismatch exits nonzero. */
  demo?: boolean;
}

const KEEP_MULLIGAN: Pick = { type: "mulligan", where: { redraw: false } };
const FIRST_P1: Pick = { type: "chooseFirst", where: { first: "p1" } };
const TO_FIRST_ATTACK: Step["advance"] = {
  prefer: [FIRST_P1, KEEP_MULLIGAN, { type: "play" }, { type: "charge" }, { type: "endMain" }],
  until: { promptKind: "main", legalType: "attack" },
  max: 40,
};

export const SCENARIOS: Scenario[] = [
  {
    id: "setup",
    description: "Game creation: first-player choice, both mulligans, then the opening charge prompt",
    seed: 641,
    initial: {
      phase: "setup",
      turn: 0,
      prompt: { kind: "chooseFirst", player: "p1" },
      legalTypes: ["chooseFirst"],
      legalCount: 2,
      zones: { p1: { deck: 50, hand: 0, leader: 1, life: 0 }, p2: { deck: 50, hand: 0, leader: 1, life: 0 } },
      eventsInclude: ["gameStart"],
    },
    steps: [
      {
        label: "p1 goes first: both seats draw, p1 is asked about the mulligan",
        move: FIRST_P1,
        expect: {
          phase: "setup",
          prompt: { kind: "mulligan", player: "p1" },
          legalTypes: ["mulligan"],
          legalCount: 2,
          zones: { p1: { hand: 6, deck: 44 }, p2: { hand: 6, deck: 44 } },
          eventsInclude: ["action", "draw"],
          refuses: [{ type: "mulligan", player: "p2", redraw: false }],
        },
      },
      {
        label: "p1 keeps: p2 is asked",
        move: KEEP_MULLIGAN,
        expect: { phase: "setup", prompt: { kind: "mulligan", player: "p2" }, legalTypes: ["mulligan"], zones: { p1: { hand: 6 } } },
      },
      {
        label: "p2 keeps: life is dealt and turn 1 opens on the charge step",
        move: KEEP_MULLIGAN,
        expect: {
          phase: "charge",
          turn: 1,
          prompt: { kind: "charge", player: "p1" },
          legalTypes: ["charge"],
          legalCount: 7,
          zones: { p1: { hand: 6, life: 8, deck: 36, energy: 0 }, p2: { hand: 6, life: 8, deck: 36 } },
          eventsInclude: ["phase"],
          eventsExclude: ["damage"],
        },
      },
    ],
  },
  {
    id: "battle",
    description: "A leader attack with no combo cards: offence passes, defence passes, the hit resolves and the turn player is back in the main step",
    seed: 641,
    steps: [
      {
        label: "play on to the first main step with an attack available",
        advance: TO_FIRST_ATTACK,
        expect: { phase: "main", prompt: { kind: "main", player: "$turn" }, legalIncludes: ["attack", "endMain"] },
      },
      {
        label: "attack: the battle opens on the offence combo step",
        move: { type: "attack" },
        expect: {
          phase: "battle",
          prompt: { kind: "combo", player: "$turn", side: "offense" },
          legalIncludes: ["pass"],
          eventsInclude: ["action", "attack", "battleStep"],
        },
      },
      {
        label: "offence passes: the defender is asked for combo cards",
        move: { type: "pass" },
        expect: { phase: "battle", prompt: { kind: "combo", player: "$other", side: "defense" }, legalIncludes: ["pass"], eventsInclude: ["battleStep"] },
      },
      {
        label: "defence passes: powers are compared and the battle ends in the main step",
        move: { type: "pass" },
        expect: {
          phase: "main",
          prompt: { kind: "main", player: "$turn" },
          eventsInclude: ["battleStep", "powerCompare", "battleStep"],
          legalIncludes: ["endMain"],
        },
      },
    ],
  },
  {
    id: "pending-choice",
    description: "A pending choice: after a combo, the attacker must pick which combo card becomes Z-Energy; only the listed cards are legal",
    seed: 641,
    steps: [
      {
        label: "play on to the first main step with an attack available",
        advance: TO_FIRST_ATTACK,
        expect: { phase: "main", prompt: { kind: "main", player: "$turn" }, legalIncludes: ["attack"] },
      },
      { label: "attack", move: { type: "attack" }, expect: { phase: "battle", prompt: { kind: "combo", side: "offense" }, legalIncludes: ["combo", "pass"] } },
      {
        label: "offence plays a combo card: its cost is a pending choice for the same seat",
        move: { type: "combo" },
        expect: {
          phase: "battle",
          prompt: { kind: "payCost", player: "$turn", action: { type: "combo" } },
          legalTypes: ["payCost"],
          legalCount: 2,
          eventsInclude: ["action"],
          refuses: [
            { type: "payCost", player: "$turn", option: 9 },
            { type: "payCost", player: "$other", option: 0 },
            { type: "pass", player: "$turn" },
          ],
        },
      },
      {
        label: "offence pays by resting energy: the card is in the combo area and the combo step is back",
        move: { type: "payCost", where: { option: 0 } },
        expect: { phase: "battle", prompt: { kind: "combo", player: "$turn", side: "offense" }, zones: { $turn: { combo: 1 } }, eventsInclude: ["move"] },
      },
      { label: "offence passes", move: { type: "pass" }, expect: { phase: "battle", prompt: { kind: "combo", player: "$other", side: "defense" } } },
      {
        label: "defence passes: the battle is over and the attacker is asked about Z-Energy",
        move: { type: "pass" },
        expect: {
          phase: "battle",
          prompt: { kind: "zEnergyFromCombo", player: "$turn" },
          legalTypes: ["zEnergyFromCombo"],
          legalMatchPromptCandidates: true,
          zones: { $turn: { combo: 1, zEnergy: 0 } },
          eventsInclude: ["powerCompare"],
          // The leader is not a candidate, and the wrong seat may not answer.
          refuses: [
            { type: "zEnergyFromCombo", player: "p1", card: "p1#0" },
            { type: "zEnergyFromCombo", player: "p2", card: "p2#0" },
            { type: "pass", player: "p1" },
          ],
        },
      },
      {
        label: "the attacker chooses: the card moves to Z-Energy and the choice is gone",
        move: { type: "zEnergyFromCombo" },
        expect: {
          phase: "main",
          prompt: { kind: "main", player: "$turn" },
          zones: { $turn: { combo: 0, zEnergy: 1 } },
          eventsInclude: ["move"],
          legalIncludes: ["endMain"],
        },
      },
    ],
  },
  {
    id: "mismatch-demo",
    description: "Deliberately wrong expectations (state, events and legal moves) — proves a mismatch fails with bounded diagnostics and a nonzero exit",
    seed: 641,
    demo: true,
    initial: { phase: "main", legalTypes: ["endMain"], eventsInclude: ["damage"], zones: { p1: { hand: 99 } } },
    steps: [{ label: "choose the first player", move: FIRST_P1, expect: { prompt: { kind: "charge" }, legalCount: 0 } }],
  },
];

export interface Diff {
  step: string;
  field: string;
  expected: string;
  actual: string;
}

export interface Evidence {
  scenario: string;
  seed: number;
  engine: "rules";
  interpreterRevision: string | null;
  bundleHash: string;
  rulesetHash: string;
  catalogHash: string;
  programsHash: string;
  pass: boolean;
  /** Moves applied. */
  moves: number;
  /** Steps whose expectations were checked, of the steps in the scenario. */
  checked: number;
  steps: number;
  /** Where it stopped: phase / turn / prompt kind of the final state. */
  final: { phase: string; turn: number; prompt: string; over: boolean };
  hashes: { state: string; events: string; legal: string; p1: string; p2: string; actions: string };
  /** First failing step's differences, at most `MAX_DIFFS`; `omitted` counts the rest. */
  diffs: Diff[];
  omitted: number;
}

export const MAX_DIFFS = 6;
const MAX_TEXT = 100;

function short(value: unknown): string {
  const text = typeof value === "string" ? value : canonicalJson(value) ?? String(value);
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 3)}...` : text;
}

function seat(token: string, match: PinnedMatch): string {
  const turn = match.state.turnPlayer as PlayerId | null;
  if (token === "$turn") return turn ?? "?";
  if (token === "$other") return turn ? (turn === "p1" ? "p2" : "p1") : "?";
  return token;
}

/** Replace `$turn` / `$other` anywhere in an expected value. */
function resolve(value: unknown, match: PinnedMatch): unknown {
  if (typeof value === "string") return value.startsWith("$") ? seat(value, match) : value;
  if (Array.isArray(value)) return value.map((v) => resolve(v, match));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [seat(k, match), resolve(v, match)]));
  return value;
}

/** Every key of `want` is present in `have` with an equal (subset-compared) value; the first miss is returned. */
function subsetMiss(want: unknown, have: unknown, path: string): { path: string; want: unknown; have: unknown } | null {
  if (want && typeof want === "object" && !Array.isArray(want)) {
    if (!have || typeof have !== "object") return { path, want, have };
    for (const [k, v] of Object.entries(want)) {
      const miss = subsetMiss(v, (have as Record<string, unknown>)[k], `${path}.${k}`);
      if (miss) return miss;
    }
    return null;
  }
  return canonicalJson(want) === canonicalJson(have) ? null : { path, want, have };
}

function matches(legal: LegalAction, pick: Pick, match: PinnedMatch): boolean {
  if (legal.action.type !== pick.type) return false;
  const action = legal.action as unknown as Record<string, unknown>;
  return Object.entries(pick.where ?? {}).every(([k, v]) => canonicalJson(action[k]) === canonicalJson(resolve(v, match)));
}

function choose(legal: LegalAction[], pick: Pick, match: PinnedMatch): Action | null {
  const found = legal.filter((l) => matches(l, pick, match));
  return found[pick.nth ?? 0]?.action ?? null;
}

function promptKind(match: PinnedMatch): string {
  const prompt = match.state.prompt as { kind?: string } | null;
  return prompt?.kind ?? "none";
}

function reached(until: Until, match: PinnedMatch, legal: LegalAction[]): boolean {
  const prompt = (match.state.prompt ?? {}) as { kind?: string; player?: string };
  if (until.promptKind && prompt.kind !== until.promptKind) return false;
  if (until.player && prompt.player !== seat(until.player, match)) return false;
  if (until.legalType && !legal.some((l) => l.action.type === until.legalType)) return false;
  return true;
}

function zoneSize(match: PinnedMatch, who: string, zone: string): number | null {
  const side = (match.state.sides as Record<string, { zones: Record<string, string[]> }>)[who];
  return side?.zones[zone]?.length ?? null;
}

function checkExpect(label: string, expect: Expect, match: PinnedMatch, legal: LegalAction[], events: GameEvent[], out: Diff[]): void {
  const add = (field: string, expected: unknown, actual: unknown) => out.push({ step: label, field, expected: short(expected), actual: short(actual) });
  const state = match.state;
  if (expect.phase !== undefined && state.phase !== expect.phase) add("phase", expect.phase, state.phase);
  if (expect.turn !== undefined && state.turn !== expect.turn) add("turn", expect.turn, state.turn);
  if (expect.over !== undefined && (state.phase === "over") !== expect.over) add("over", expect.over, state.phase === "over");
  if (expect.prompt) {
    const want = resolve(expect.prompt, match);
    const miss = subsetMiss(want, state.prompt, "prompt");
    if (miss) add(miss.path, miss.want, miss.have);
  }
  const types: string[] = [...new Set(legal.map((l) => l.action.type as string))].sort();
  if (expect.legalTypes && canonicalJson(types) !== canonicalJson([...expect.legalTypes].sort())) add("legal types", [...expect.legalTypes].sort(), types);
  for (const t of expect.legalIncludes ?? []) if (!types.includes(t)) add("legal types include", t, types);
  if (expect.legalCount !== undefined && legal.length !== expect.legalCount) add("legal count", expect.legalCount, legal.length);
  if (expect.legalMatchPromptCandidates) {
    const candidates = ((state.prompt as { candidates?: string[] } | null)?.candidates ?? []).slice().sort();
    const named = legal.map((l) => (l.action as unknown as { card?: string }).card).filter((c): c is string => typeof c === "string").sort();
    if (canonicalJson(candidates) !== canonicalJson(named)) add("legal cards vs prompt candidates", candidates, named);
  }
  for (const [token, zones] of Object.entries(expect.zones ?? {})) {
    const who = seat(token, match);
    for (const [zone, want] of Object.entries(zones)) {
      const have = zoneSize(match, who, zone);
      if (have !== want) add(`${who}.${zone} size`, want, have);
    }
  }
  const seen = events.map((e) => e.type as string);
  let at = 0;
  for (const t of expect.eventsInclude ?? []) {
    const i = seen.indexOf(t, at);
    if (i < 0) {
      add("events include (in order)", t, seen.length > 12 ? [...seen.slice(0, 12), `+${seen.length - 12}`] : seen);
      break;
    }
    at = i + 1;
  }
  for (const t of expect.eventsExclude ?? []) if (seen.includes(t)) add("events exclude", t, "present");
  for (const bogus of expect.refuses ?? []) {
    const before = canonicalJson(match.state);
    let refused = false;
    try {
      applyMove(match, resolve(bogus, match) as unknown as Action);
    } catch {
      refused = true;
    }
    if (!refused) add("illegal action refused", short(bogus), "accepted");
    else if (canonicalJson(match.state) !== before) add("refused action left state untouched", "unchanged", "changed");
  }
}

export interface RunInput {
  bundle: ReplayBundleRecord;
  /** Defaults to the scenario's own seed. */
  seed?: number;
  interpreterRevision: string | null;
}

export function scenarioIds(includeDemos = false): string[] {
  return SCENARIOS.filter((s) => includeDemos || !s.demo).map((s) => s.id);
}

export async function runScenario(id: string, input: RunInput): Promise<Evidence> {
  const scenario = SCENARIOS.find((s) => s.id === id);
  if (!scenario) throw new Error(`unknown scenario "${id}" (known: ${SCENARIOS.map((s) => s.id).join(", ")})`);
  const seed = input.seed ?? scenario.seed;
  const diffs: Diff[] = [];
  const created = await createPinnedMatch({ bundle: input.bundle, seed, interpreterRevision: input.interpreterRevision });
  let match = created.match;
  let legal = legalMoves(match);
  let lastEvents: GameEvent[] = created.events;
  const actions: Action[] = [];
  let checked = 0;
  const stop = (label: string, field: string, expected: string, actual: string) => diffs.push({ step: label, field, expected, actual });

  if (scenario.initial) {
    checkExpect("create", scenario.initial, match, legal, created.events, diffs);
    checked++;
  }
  const apply = (action: Action): GameEvent[] => {
    const next = applyMove(match, action);
    match = next.match;
    actions.push(action);
    legal = match.state.phase === "over" ? [] : legalMoves(match);
    return next.events;
  };

  for (const step of scenario.steps) {
    if (diffs.length) break;
    const label = step.label;
    let events: GameEvent[] = [];
    try {
      if (step.move) {
        const action = choose(legal, step.move, match);
        if (!action) {
          stop(label, "no legal move matches", short(step.move), `legal: ${short([...new Set(legal.map((l) => l.action.type))])}`);
          break;
        }
        events = apply(action);
      } else if (step.advance) {
        const { prefer, until, max } = step.advance;
        for (let n = 0; !reached(until, match, legal); n++) {
          if (n >= max || !legal.length) {
            stop(label, "advance did not reach", short(until), `${n} moves, now ${match.state.phase}/${promptKind(match)}`);
            break;
          }
          const action = prefer.map((p) => choose(legal, p, match)).find((a) => a !== null) ?? null;
          if (!action) {
            stop(label, "advance has no preferred move", short(prefer.map((p) => p.type)), `legal: ${short([...new Set(legal.map((l) => l.action.type))])}`);
            break;
          }
          events.push(...apply(action));
        }
      }
    } catch (error) {
      stop(label, "engine refused a legal move", "accepted", short(error instanceof Error ? error.message : String(error)));
      break;
    }
    if (diffs.length) break;
    lastEvents = events;
    checkExpect(label, step.expect, match, legal, events, diffs);
    checked++;
  }

  const snapshots = { p1: projectSnapshot(match, "p1"), p2: projectSnapshot(match, "p2") };
  const [state, ev, lg, p1, p2, act] = await Promise.all([
    replayHash(match.state),
    replayHash(lastEvents),
    replayHash(legal),
    replayHash(snapshots.p1),
    replayHash(snapshots.p2),
    replayHash(actions),
  ]);
  const b = input.bundle;
  return {
    scenario: scenario.id,
    seed,
    engine: "rules",
    interpreterRevision: input.interpreterRevision,
    bundleHash: b.hash,
    rulesetHash: b.rulesetHash,
    catalogHash: b.catalogHash,
    programsHash: b.programsHash,
    pass: diffs.length === 0,
    moves: actions.length,
    checked,
    steps: scenario.steps.length + (scenario.initial ? 1 : 0),
    final: { phase: match.state.phase, turn: match.state.turn, prompt: promptKind(match), over: match.state.phase === "over" },
    hashes: { state, events: ev, legal: lg, p1, p2, actions: act },
    diffs: diffs.slice(0, MAX_DIFFS),
    omitted: Math.max(0, diffs.length - MAX_DIFFS),
  };
}

export async function runScenarios(ids: string[], input: RunInput): Promise<Evidence[]> {
  const out: Evidence[] = [];
  for (const id of ids) out.push(await runScenario(id, input));
  return out;
}
