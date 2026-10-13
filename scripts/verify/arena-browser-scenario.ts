/**
 * #641: a fixed-seed create → apply → project scenario on the browser-safe
 * rules entry (`src/lib/arena/browser.ts`). Portable on purpose — it imports
 * only `browser.ts` and `replay-core.ts` — so the same file runs under Node
 * (`arena-browser-boundary.mts`, in `npm test`) and inside a real browser
 * module worker (`arena-browser-worker.ts`, driven by
 * `arena-browser-engine-browser.mts`).
 *
 * The move policy is a pure function of the step number and the engine's own
 * legal list, so two runs that agree on every state agree on every move. Each
 * step records hashes of the state, the events, the legal moves and both
 * seats' projected snapshots; the final record carries all of them in full.
 * The viewer-safety checks run inside the scenario, so they hold wherever it
 * runs.
 */
import type { Action, GameEvent, LegalAction, PlayerId } from "../../src/lib/arena/types";
import type { Snapshot } from "../../src/lib/arena/snapshot-core";
import type { VmState } from "../../src/lib/arena/vm/state";
import { applyMove, createPinnedMatch, legalMoves, projectSnapshot, replayWith, RULES_ENGINE, type PinnedMatch } from "../../src/lib/arena/browser";
import { canonicalJson, replayHash, type ReplayBundleRecord } from "../../src/lib/arena/replay-core";

export interface ScenarioStep {
  n: number;
  action: Action | null;
  state: string;
  events: string;
  legal: string;
  p1: string;
  p2: string;
}

export interface ScenarioResult {
  steps: ScenarioStep[];
  /** Canonical JSON of the final state, every event, the final legal moves and both final snapshots. */
  finalJson: string;
  finalHash: string;
  phase: string;
  turn: number;
  over: boolean;
  /** Viewer-safety checks that passed, by name (a failure throws). */
  checks: string[];
}

const PLAYERS: PlayerId[] = ["p1", "p2"];

function fail(message: string): never {
  throw new Error(`scenario: ${message}`);
}

/** Instance ids `viewer` may not identify: the other seat's hand and both decks, unless face up. */
function hiddenFrom(state: VmState, viewer: PlayerId): Map<string, string> {
  const hidden = new Map<string, string>();
  for (const p of PLAYERS) {
    const zones = state.sides[p].zones as Record<string, string[]>;
    const ids = [...(p === viewer ? [] : zones.hand ?? []), ...(zones.deck ?? [])];
    for (const id of ids) if (!state.cards[id]?.faceUp) hidden.set(id, state.cards[id].cardId);
  }
  return hidden;
}

/** Walk a snapshot for any object that names a hidden instance together with its real card id or name. */
function leaks(value: unknown, hidden: Map<string, string>, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const v of value) leaks(v, hidden, out);
  else if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.id === "string" && hidden.has(o.id) && (o.cardId === hidden.get(o.id) || o.name === hidden.get(o.id))) out.push(o.id);
    for (const v of Object.values(o)) leaks(v, hidden, out);
  }
  return out;
}

function checkViewerSafe(match: PinnedMatch, viewer: PlayerId, snap: Snapshot, legal: LegalAction[]): void {
  const other = viewer === "p1" ? "p2" : "p1";
  if (snap.game.you !== viewer || snap.view.them.hand !== null) fail(`${viewer}'s board shows the other seat's hand`);
  if (snap.view.them.handCount !== (match.state.sides[other].zones as Record<string, string[]>).hand.length) fail("hand count disagrees with the state");
  const hidden = hiddenFrom(match.state, viewer);
  const named = leaks(snap.view, hidden);
  if (named.length) fail(`${viewer}'s view names hidden cards ${named.slice(0, 3).join(", ")}`);
  for (const id of Object.keys(snap.beats?.art ?? {})) if (hidden.has(id)) fail(`${viewer}'s beats carry the face of hidden ${id}`);
  const prompt = match.state.prompt as { player?: PlayerId | null };
  const asked = prompt.player ?? null;
  if (asked && asked !== viewer && snap.legal.length) fail(`${viewer}'s board lists ${asked}'s moves`);
  if (asked === viewer && canonicalJson(snap.legal) !== canonicalJson(legal) && !snap.over) fail(`${viewer}'s board lists different moves than the engine`);
  for (const b of snap.beats?.list ?? []) if ("revealEpoch" in b) fail("a beat carries a private reveal epoch");
}

/**
 * Pick a move: a pure function of the step and the engine's list. Never
 * concedes while anything else is open, and activates a repeatable skill only
 * every fifth step, so the game moves on through plays, battles and turns.
 */
export function pick(step: number, legal: LegalAction[]): Action | null {
  const open = legal.filter((l) => l.action.type !== "concede");
  const varied = step % 5 === 0 ? open : open.filter((l) => l.action.type !== "activate");
  const from = varied.length ? varied : open.length ? open : legal;
  return from.length ? from[(step * 7 + 3) % from.length].action : null;
}

export async function runBrowserScenario(input: { bundle: ReplayBundleRecord; seed: number; interpreterRevision: string; maxSteps: number }): Promise<ScenarioResult> {
  const checks = new Set<string>();
  const created = await createPinnedMatch({ bundle: input.bundle, seed: input.seed, interpreterRevision: input.interpreterRevision });
  let match = created.match;
  const allEvents: GameEvent[] = [...created.events];
  const actions: Action[] = [];
  const steps: ScenarioStep[] = [];
  let snaps: Record<PlayerId, Snapshot> = { p1: projectSnapshot(match, "p1"), p2: projectSnapshot(match, "p2") };
  let legal = legalMoves(match);
  const record = async (n: number, action: Action | null, events: GameEvent[]) => {
    for (const p of PLAYERS) checkViewerSafe(match, p, snaps[p], legal);
    checks.add("opponent hand withheld").add("hidden faces absent from view and beats").add("other seat's moves withheld").add("no private reveal epochs");
    const [state, ev, lg, p1, p2] = await Promise.all([replayHash(match.state), replayHash(events), replayHash(legal), replayHash(snaps.p1), replayHash(snaps.p2)]);
    steps.push({ n, action, state, events: ev, legal: lg, p1, p2 });
  };
  await record(0, null, created.events);
  for (let n = 1; n <= input.maxSteps; n++) {
    if (match.state.phase === "over" || !legal.length) break;
    const action = pick(n, legal);
    if (!action) break;
    const before = canonicalJson(match.state);
    const next = applyMove(match, action);
    if (canonicalJson(match.state) !== before) fail("applyMove mutated the match it was given");
    match = next.match;
    actions.push(action);
    allEvents.push(...next.events);
    legal = match.state.phase === "over" ? [] : legalMoves(match);
    snaps = { p1: projectSnapshot(match, "p1"), p2: projectSnapshot(match, "p2") };
    await record(n, action, next.events);
  }
  checks.add("applyMove leaves its input untouched");

  // The same moves through the replay seam reach the same state and events.
  const replayed = await replayWith(RULES_ENGINE, { bundle: input.bundle, seed: input.seed, actions, interpreterRevision: input.interpreterRevision });
  if (canonicalJson(replayed.state) !== canonicalJson(match.state)) fail("replayWith reached a different state");
  if (canonicalJson(replayed.events) !== canonicalJson(allEvents)) fail("replayWith produced different events");
  checks.add("replayWith reproduces the played game");

  // An illegal move is refused and changes nothing.
  if (match.state.phase !== "over") {
    const bogus = { type: "attack", player: "p1", attacker: "nope#0", target: "nope#1" } as unknown as Action;
    let refused = false;
    try {
      applyMove(match, bogus);
    } catch {
      refused = true;
    }
    if (!refused) fail("an illegal move was accepted");
    checks.add("an illegal move is refused");
  }

  const finalJson = canonicalJson({ state: match.state, events: allEvents, legal, snapshots: snaps, actions });
  return {
    steps,
    finalJson,
    finalHash: await replayHash(JSON.parse(finalJson)),
    phase: match.state.phase,
    turn: match.state.turn,
    over: match.state.phase === "over",
    checks: [...checks],
  };
}
