/**
 * The seam between the arena board and whatever carries a match (#648, O3-01).
 *
 * `ArenaStage` draws a `Snapshot` and sends back actions; it does not know how
 * either travels. This file is the whole of what it may ask of a transport:
 * snapshots in (`watch`), actions out (`act`, `advance`, `abandon`, `rematch`,
 * `flag`, `preview`), a connection status, and `capabilities` saying which of
 * the optional affordances exist. The online session (server actions, long
 * polling by revision, request-id receipts) is one implementation, in
 * `./online.ts`; a local worker session (O3-02/O3-05) will be another.
 *
 * Rules for this file, kept by `scripts/verify/arena-session-648.mts`:
 *  - no React, no `next/*`, no `@/app` or other server module in its value graph —
 *    the presentation's graph may not reach a server action;
 *  - a session is bound to one game: a snapshot of another game, or one older
 *    than what the board already shows, is never adopted (`acceptSnapshot`).
 */
import type { Snapshot } from "@/lib/arena/snapshot";
import type { Action } from "@/lib/arena/types";
import type { GameplanPreview } from "@/lib/arena/gameplan-types";
import type { FlagLine } from "@/lib/arena/review-store";
import type { ArenaSkin } from "@/lib/arena/skin";
import type { ArenaStaging } from "@/lib/arena/staging";

export type SessionConnection = "connected" | "offline" | "reconnecting" | "paused";

/** What every mutation answers: `error` is a sentence for the player, `null` is success. */
export interface SessionResult { error: string | null }

/**
 * The optional affordances. A transport that lacks one leaves the matching
 * method off, and the board hides the control — it never calls and hopes.
 */
export interface SessionCapabilities {
  /** `advance()` exists: the opponent or referee moves on the other side of the transport. */
  advance: boolean;
  /** "Give up" (`abandon`). */
  abandon: boolean;
  /** "Play again" on the end screen (`rematch`). */
  rematch: boolean;
  /** The admin drawer's "flag this turn" (`flag`); who may use it is still decided by the host. */
  flag: boolean;
  /** The gameplan price check (`preview`). */
  plan: boolean;
  /** The menu's skin switch (`chooseSkin`). */
  skin: boolean;
  /** The menu's battle-staging switch (`chooseStaging`). */
  staging: boolean;
  /** "Something's wrong" (`reportBug`). */
  report: boolean;
}

export interface WatchOptions {
  /** The newest revision / beat sequence the board already holds. */
  revision: number;
  beat: number;
  onSnapshot(snapshot: Snapshot): void;
  onConnection(connection: SessionConnection): void;
}

export interface WatchHandle {
  /** Try again now (the Retry chip). */
  retry(): void;
  stop(): void;
}

export interface ArenaSession {
  /** The one game this session carries. */
  readonly gameId: number;
  readonly capabilities: SessionCapabilities;
  /** Send one action based on the revision the board is showing; `requestId` makes a retry a replay. */
  act(action: Action, basedOn: number, requestId: string): Promise<SessionResult>;
  /** Start delivering newer snapshots and connection changes until `stop()`. */
  watch(options: WatchOptions): WatchHandle;
  /** The board is showing something the transport refused as stale: reload whatever authoritative copy exists. */
  refresh(): void;
  advance?(): Promise<SessionResult>;
  abandon?(basedOn: number, requestId: string): Promise<SessionResult>;
  rematch?(): Promise<SessionResult>;
  flag?(note: string | null): Promise<SessionResult & { flag: FlagLine | null; created: boolean }>;
  preview?(actions: Action[], basedOn: number): Promise<SessionResult & { preview: GameplanPreview | null }>;
  /** Board preferences the host stores (the online one in cookies). */
  chooseSkin?(skin: ArenaSkin): Promise<void>;
  chooseStaging?(staging: ArenaStaging): Promise<void>;
  reportBug?(note: string, cardId: string | null): Promise<SessionResult>;
}

/** Capabilities derived from the methods present, so a flag and a method cannot disagree. */
export type OptionalMethods = Pick<ArenaSession, "advance" | "abandon" | "rematch" | "flag" | "preview" | "chooseSkin" | "chooseStaging" | "reportBug">;
export function capabilitiesOf(methods: Partial<OptionalMethods>): SessionCapabilities {
  return {
    advance: !!methods.advance,
    abandon: !!methods.abandon,
    rematch: !!methods.rematch,
    flag: !!methods.flag,
    plan: !!methods.preview,
    skin: !!methods.chooseSkin,
    staging: !!methods.chooseStaging,
    report: !!methods.reportBug,
  };
}

/**
 * Whether `next` may replace `current` on a board bound to `gameId`.
 * Returns the snapshot to show, or `null` to keep what is shown.
 *
 *  - another game's snapshot is refused outright (a cross-session update);
 *  - an older revision is refused (a stale update);
 *  - the same revision is refused, except that its beat list may have moved on
 *    (animation sequences advance independently of the row revision), in which
 *    case only `beats` is taken.
 */
export function acceptSnapshot(current: Snapshot, next: Snapshot, gameId: number): Snapshot | null {
  if (next.game.id !== gameId || current.game.id !== gameId) return null;
  if (next.game.revision > current.game.revision) return next;
  if (next.game.revision === current.game.revision && (next.beats?.seq ?? 0) > (current.beats?.seq ?? 0)) {
    return { ...current, beats: next.beats };
  }
  return null;
}

export interface LiveGameListener {
  onSnapshot(snapshot: Snapshot): void;
  onConnection(connection: SessionConnection): void;
}

/**
 * The live-game state machine without React: the snapshot the board shows, the
 * connection, and the watch on the transport. `useLiveGame` is a thin wrapper;
 * the conformance script drives this directly with an in-memory session.
 */
export class LiveGameCore {
  private current: Snapshot;
  private handle: WatchHandle | null = null;
  constructor(readonly session: ArenaSession, initial: Snapshot, private readonly listener: LiveGameListener) {
    this.current = initial;
  }

  get snapshot(): Snapshot { return this.current; }

  /** A newer server render arrived as a prop; adopt it only when it is not older than what is shown. */
  adopt(fromServer: Snapshot): void {
    // A different game (the page was reused for another id) always replaces; the same game only by revision.
    const replaces = fromServer.game.id !== this.current.game.id || fromServer.game.revision > this.current.game.revision;
    if (!replaces) return;
    this.current = fromServer;
    this.listener.onSnapshot(fromServer);
  }

  /** Begin watching from the revision/beat of the server render. Replaces a running watch. */
  start(fromServer: Snapshot): void {
    this.stop();
    const sameGame = this.current.game.id === this.session.gameId;
    const startRevision = fromServer.game.revision;
    const startSeq = fromServer.beats?.seq ?? 0;
    this.handle = this.session.watch({
      revision: sameGame ? Math.max(startRevision, this.current.game.revision) : startRevision,
      beat: sameGame ? Math.max(startSeq, this.current.beats?.seq ?? 0) : startSeq,
      onConnection: (connection) => this.listener.onConnection(connection),
      onSnapshot: (next) => {
        const accepted = acceptSnapshot(this.current, next, this.session.gameId);
        if (!accepted) return;
        this.current = accepted;
        this.listener.onSnapshot(accepted);
      },
    });
  }

  retry(): void { this.handle?.retry(); }

  stop(): void {
    this.handle?.stop();
    this.handle = null;
  }
}
