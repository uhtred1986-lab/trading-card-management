import { capabilitiesOf, type ArenaSession, type SessionResult, type WatchOptions } from "../../../components/arena/session/contract";
import { buildSnapshot, type Snapshot } from "../snapshot-core";
import type { Beats } from "../beats";
import type { Action, PlayerId } from "../types";
import { RULES, type VmState } from "../vm";
import { PRACTICE_ART, PRACTICE_CONTEXT, PRACTICE_FIXTURE_VERSION, PRACTICE_GAME_ID, createPracticeState } from "./fixture";

export interface PracticeTransition { action: Action; actor: PlayerId; before: Snapshot; after: Snapshot }
interface Entry { action: Action; requestId: string; basedOn: number }
export interface PracticeSave { version: 1; fixture: number; journal: Entry[] }
export interface PracticeSession extends ArenaSession {
  getSnapshot(): Snapshot;
  subscribe(listener: (transition: PracticeTransition) => void): () => void;
  serialize(): PracticeSave;
}
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

class TrainingSession implements PracticeSession {
  readonly gameId = PRACTICE_GAME_ID;
  readonly capabilities = capabilitiesOf({ advance: async () => ({ error: null }) });
  private state: VmState = createPracticeState();
  private journal: Entry[] = [];
  private beats: Beats | null = null;
  private receipts = new Map<string, { fingerprint: string; result: SessionResult }>();
  private watchers = new Set<WatchOptions>();
  private listeners = new Set<(transition: PracticeTransition) => void>();
  private current: Snapshot = this.snapshot();
  private snapshot(): Snapshot {
    return buildSnapshot({ id: this.gameId, revision: this.journal.length, mode: "sparring", status: this.state.phase === "over" ? "over" : "playing",
      p1Name: "You", p2Name: "Training opponent", ctx: PRACTICE_CONTEXT, state: this.state,
      legal: RULES.legalActions(PRACTICE_CONTEXT, this.state), log: [], beats: this.beats, spotlight: null,
      spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: "p2", viewer: "p1", images: PRACTICE_ART });
  }
  getSnapshot(): Snapshot { return structuredClone(this.current); }
  subscribe(listener: (transition: PracticeTransition) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  serialize(): PracticeSave { return structuredClone({ version: 1, fixture: PRACTICE_FIXTURE_VERSION, journal: this.journal }); }
  watch(options: WatchOptions) {
    this.watchers.add(options); options.onConnection("connected");
    if (this.current.game.revision > options.revision) options.onSnapshot(this.getSnapshot());
    return { stop: () => { this.watchers.delete(options); }, retry: () => this.refresh() };
  }
  refresh(): void { for (const w of this.watchers) w.onSnapshot(this.getSnapshot()); }
  private commit(action: Action, basedOn: number, requestId: string, actor: PlayerId): SessionResult {
    const fingerprint = canonical({ action, basedOn });
    const receipt = this.receipts.get(requestId);
    if (receipt) return receipt.fingerprint === fingerprint ? receipt.result : { error: "That request was already used for another action." };
    let result: SessionResult;
    if (!requestId || requestId.length > 200) return { error: "Invalid request identifier." };
    if (basedOn !== this.journal.length) result = { error: "The board has changed. Refresh and try again." };
    else if (action.player !== actor || !RULES.legalActions(PRACTICE_CONTEXT, this.state).some(x => same(x.action, action))) result = { error: "That action is not available now." };
    else {
      const before = this.getSnapshot();
      const applied = RULES.apply(PRACTICE_CONTEXT, this.state, action);
      this.state = applied.state;
      this.beats = RULES.toBeats(PRACTICE_CONTEXT, this.state, applied.events, this.beats?.seq ?? 0);
      this.journal.push(structuredClone({ action, basedOn, requestId }));
      this.current = this.snapshot();
      result = { error: null };
      this.receipts.set(requestId, { fingerprint, result });
      this.refresh();
      for (const listener of this.listeners) listener({ action: structuredClone(action), actor, before, after: this.getSnapshot() });
      return result;
    }
    this.receipts.set(requestId, { fingerprint, result });
    return result;
  }
  async act(action: Action, basedOn: number, requestId: string): Promise<SessionResult> { return this.commit(action, basedOn, requestId, "p1"); }
  async advance(): Promise<SessionResult> {
    for (let n = 0; n < 64; n++) {
      const legal = RULES.legalActions(PRACTICE_CONTEXT, this.state).map(x => x.action);
      if (!legal.length || legal[0].player !== "p2") return { error: null };
      // Only select current legal actions; never hold an expected card across a prompt.
      const leader = this.state.sides.p2.zones.leader[0];
      const target = this.state.sides.p1.zones.leader[0];
      const action = legal.find(a => a.type === "charge" && a.card !== null)
        ?? legal.find(a => a.type === "play" && this.state.sides.p2.zones.battle.length === 0)
        ?? legal.find(a => a.type === "attack" && a.attacker === leader && a.target === target)
        ?? legal.find(a => a.type === "endMain")
        ?? legal.find(a => a.type === "pass")
        ?? legal.find(a => a.type === "zEnergyFromCombo" && a.card === null)
        ?? legal[0];
      const result = this.commit(action, this.journal.length, `opponent:${this.journal.length}`, "p2");
      if (result.error) return result;
    }
    return { error: "The opponent reached its decision limit. Continue to advance." };
  }
  restore(entries: Entry[]): void {
    for (const entry of entries) {
      if (!entry || typeof entry.requestId !== "string" || !Number.isSafeInteger(entry.basedOn) || !entry.action || !["p1", "p2"].includes(entry.action.player)) throw new Error("Invalid training journal entry");
      const revision = this.journal.length;
      const result = this.commit(entry.action, entry.basedOn, entry.requestId, entry.action.player);
      if (result.error || this.journal.length !== revision + 1) throw new Error("Invalid training action journal");
    }
  }
}
export function createPracticeSession(): PracticeSession { return new TrainingSession(); }
export function restorePracticeSession(value: unknown): PracticeSession {
  if (!value || typeof value !== "object") throw new Error("Invalid training save");
  const save = value as Partial<PracticeSave>;
  if (save.version !== 1 || save.fixture !== PRACTICE_FIXTURE_VERSION || !Array.isArray(save.journal) || save.journal.length > 10000) throw new Error("Unsupported training save");
  const session = new TrainingSession(); session.restore(save.journal); return session;
}
