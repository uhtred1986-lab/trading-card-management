/**
 * The play-test sandbox (Rules PR 5): one staged board, played in memory.
 *
 * The human seat (p1) plays on the real `ArenaStage`; the opponent seat (p2)
 * is the LOCAL AI POLICY — `localStep` over a `PinnedMatch`, the same call the
 * local worker makes per decision. Nothing is persisted: no `arena_games`
 * row, no deck check, no clock. The context and the position come from the
 * server (`sandboxSeedAction`) as JSON and are all this module needs.
 *
 * Browser-safe, like `tutorial/session.ts` (whose shape this follows): the
 * engine, the policy and the snapshot core, nothing server-side.
 */
import { capabilitiesOf, type ArenaSession, type SessionResult, type WatchOptions } from "../../../components/arena/session/contract";
import { applyMove, legalMoves, projectSnapshot, RULES_ENGINE, type PinnedMatch } from "../browser";
import { localStep } from "../policy/boundary";
import { localPolicy } from "../policy/combat";
import { localMemory, type LocalMemory } from "../policy/main";
import { policyRng } from "../policy/rng";
import { narrate } from "../narration";
import { IllegalAction } from "../vm/common";
import type { Snapshot } from "../snapshot-core";
import type { Action, EngineContext, GameEvent, PlayerId } from "../types";
import type { CardArt } from "../view";
import type { VmState } from "../vm/state";

/** What the server hands over: a context carrying the rule under test, and the staged position. */
export interface SandboxSeed {
  ctx: EngineContext;
  state: VmState;
  art: Record<string, CardArt>;
  /** How the board was built, in words (the probe's own `input` lines). */
  input: string[];
  /** What the board waits for the card to be offered, in words. */
  waitsFor: string[];
  /** Every board this rule can be played on, the first being its default. */
  boards: { key: string; title: string }[];
  /** The board these positions are: the key asked for, or the default when it named none. */
  boardKey: string;
  /** The instance the rule is on. */
  card: string;
  title: string;
}

/** One move taken, by either seat, with the words the board would say for it. */
export interface JournalEntry {
  /** Null for the opponent: the local AI answers a decision, not a typed move. */
  action: Action | null;
  actor: PlayerId;
  label: string;
  lines: string[];
}

export interface SandboxUpdate {
  kind: "move" | "interrupted";
  entry?: JournalEntry;
  snapshot: Snapshot;
}

export interface SandboxSession extends ArenaSession {
  advance(): Promise<SessionResult>;
  getSnapshot(): Snapshot;
  subscribe(listener: (update: SandboxUpdate) => void): () => void;
  /** Every move taken so far, both seats, in order. */
  journal(): JournalEntry[];
  /** The engine ended the game as interrupted (a skill it cannot play yet): why, from its own private context. */
  engineInterruption(): string | null;
  /** Why the opponent stopped, or null while it plays. */
  interruption(): string | null;
  /** Whether it is the human seat's turn to answer. */
  waitingForYou(): boolean;
}

export const SANDBOX_GAME_ID = 9001;
const POLICY_SEED = 11;
const MAX_OPPONENT_STEPS = 64;

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => (item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : item));
}
/** The board may name explicit energy with an otherwise enumerated declaration; the engine validates it. */
function offered(action: Action): Action {
  if ("pay" in action) {
    const declaration = { ...action };
    delete declaration.pay;
    return declaration;
  }
  return action;
}
const sameAction = (a: Action, b: Action) => canonical(offered(a)) === canonical(offered(b));

/** The board's own words for what an action did. */
function wordsFor(match: PinnedMatch, events: GameEvent[]): string[] {
  const beats = RULES_ENGINE.toBeats(match.ctx, match.state, events, 0);
  const out: string[] = [];
  for (const b of beats.list) {
    const said = narrate(b, { viewer: "p1", them: "Local AI", art: beats.art, ownerOf: (id) => match.state.cards[id]?.owner ?? null }, undefined, { full: true });
    if (said) out.push(said);
  }
  return out;
}

class Sandbox implements SandboxSession {
  readonly gameId = SANDBOX_GAME_ID;
  readonly capabilities = capabilitiesOf({ advance: async () => ({ error: null }) });
  private match: PinnedMatch;
  private entries: JournalEntry[] = [];
  private memory: LocalMemory = localMemory(policyRng(POLICY_SEED));
  private stopped: string | null = null;
  private watchers = new Set<WatchOptions>();
  private listeners = new Set<(update: SandboxUpdate) => void>();
  private current: Snapshot;

  constructor(seed: SandboxSeed) {
    this.match = { ctx: structuredClone(seed.ctx), state: structuredClone(seed.state), beats: null, art: structuredClone(seed.art), names: { p1: "You", p2: "Local AI" } };
    this.current = this.project();
  }

  private project(): Snapshot {
    return projectSnapshot(this.match, "p1", { id: SANDBOX_GAME_ID, revision: this.entries.length, mode: "sparring" });
  }
  getSnapshot(): Snapshot {
    return structuredClone(this.current);
  }
  journal(): JournalEntry[] {
    return structuredClone(this.entries);
  }
  engineInterruption(): string | null {
    const o = (this.match.state as { outcome?: { kind?: string; privateContext?: { issue?: string; detail?: string; skillIndex?: number; trigger?: string } } }).outcome;
    if (o?.kind !== "interrupted") return null;
    const c = o.privateContext;
    return c ? [c.detail, c.issue ? `(${c.issue})` : null].filter(Boolean).join(" ") : "the engine interrupted this game";
  }
  interruption(): string | null {
    return this.stopped;
  }
  waitingForYou(): boolean {
    const p = this.match.state.prompt as { player?: PlayerId };
    return this.match.state.phase !== "over" && p.player === "p1";
  }
  subscribe(listener: (update: SandboxUpdate) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  watch(options: WatchOptions) {
    this.watchers.add(options);
    options.onConnection("connected");
    if (this.current.game.revision > options.revision) options.onSnapshot(this.getSnapshot());
    return { stop: () => void this.watchers.delete(options), retry: () => this.refresh() };
  }
  refresh(): void {
    for (const w of this.watchers) w.onSnapshot(this.getSnapshot());
  }

  private commit(actor: PlayerId, action: Action, label: string): void {
    const next = applyMove(this.match, action);
    this.match = next.match;
    const entry: JournalEntry = { action: structuredClone(action), actor, label, lines: wordsFor(this.match, next.events) };
    this.entries.push(entry);
    this.current = this.project();
    this.refresh();
    for (const l of this.listeners) l({ kind: "move", entry: structuredClone(entry), snapshot: this.getSnapshot() });
  }

  async act(action: Action, basedOn: number, requestId: string): Promise<SessionResult> {
    if (!requestId || requestId.length > 200) return { error: "Invalid request identifier." };
    if (basedOn !== this.entries.length) return { error: "The board has changed. Refresh and try again." };
    const menu = legalMoves(this.match);
    const hit = menu.find((x) => sameAction(x.action, action));
    if (action.player !== "p1" || !hit) return { error: "That action is not available now." };
    try {
      this.commit("p1", action, hit.label);
    } catch (error) {
      if (!(error instanceof IllegalAction)) throw error;
      return { error: "That payment or action is not available now." };
    }
    return { error: null };
  }

  /** The local AI answers until the human seat is asked again, or it cannot go on. */
  async advance(): Promise<SessionResult> {
    for (let n = 0; n < MAX_OPPONENT_STEPS; n++) {
      if (this.match.state.phase === "over" || !this.opponentAsked()) return { error: null };
      const step = localStep(this.match, "p2", this.entries.length, this.memory, localPolicy());
      this.memory = step.memory;
      if (!step.ok) {
        this.stopped = step.reason === "interrupted" ? step.detail : `${step.reason}: ${step.detail}`;
        this.current = this.project();
        for (const l of this.listeners) l({ kind: "interrupted", snapshot: this.getSnapshot() });
        return { error: `The opponent stopped: ${this.stopped}` };
      }
      this.stopped = null;
      this.match = step.match;
      const entry: JournalEntry = { action: null, actor: "p2", label: step.id, lines: wordsFor(this.match, step.events) };
      this.entries.push(entry);
      this.current = this.project();
      this.refresh();
      for (const l of this.listeners) l({ kind: "move", entry: structuredClone(entry), snapshot: this.getSnapshot() });
    }
    return { error: "The opponent reached its decision limit. Continue to advance." };
  }

  opponentAsked(): boolean {
    const p = this.match.state.prompt as { player?: PlayerId };
    return p.player === "p2";
  }
}

export function createSandboxSession(seed: SandboxSeed): SandboxSession {
  return new Sandbox(seed);
}

/** Where a replay stopped, and why. */
export interface ReplayStop {
  /** Which of the human's moves (1-based) could not be played. */
  move: number;
  label: string;
  message: string;
}

/**
 * Play the human seat's recorded moves again on a (possibly changed) seed:
 * the local AI answers afresh between them, and the replay stops at the first
 * move of yours the new rule leaves off the menu. The session returned is
 * the board as far as the replay got.
 */
export async function replayMoves(seed: SandboxSeed, mine: JournalEntry[]): Promise<{ session: SandboxSession; played: number; stop: ReplayStop | null }> {
  const session = new Sandbox(seed);
  await session.advance();
  let played = 0;
  for (const entry of mine) {
    if (!entry.action) continue;
    if (session.interruption()) return { session, played, stop: { move: played + 1, label: entry.label, message: `The opponent stopped before your move ${played + 1} (${entry.label}): ${session.interruption()}` } };
    const snap = session.getSnapshot();
    const res = await session.act(entry.action, snap.game.revision, `replay:${played}`);
    if (res.error) {
      return { session, played, stop: { move: played + 1, label: entry.label, message: `Your move ${played + 1} (${entry.label}) is no longer available with your edit, so the replay stopped there. Play on from this board.` } };
    }
    played++;
    await session.advance();
  }
  return { session, played, stop: null };
}
