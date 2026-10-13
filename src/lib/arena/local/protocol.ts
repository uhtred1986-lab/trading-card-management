/**
 * The local match worker protocol (#652, plan O3-02): every message between a
 * page and the dedicated Web Worker that owns one local match, and the checks
 * both ends run on what they receive.
 *
 * The worker (`./worker.ts`, entry `./worker-entry.ts`) keeps the whole match —
 * engine state, the AI seat's memory and RNG, the move journal, the request
 * receipts — and sends the page only the human seat's projected `Snapshot`
 * (`browser.ts`'s `projectSnapshot`, hidden cards named by position as
 * `conceal.ts` does online). The page client (`src/components/arena/session/local.ts`)
 * implements the board's `ArenaSession` on top of it.
 *
 * The semantics are the online ones (#545/#568, `src/app/arena/actions.ts`'s `act`):
 *  - every mutation names the revision it was based on and a request id; a
 *    request id already applied for the same actor and the same payload is
 *    answered from its receipt and plays nothing, with another payload it is a
 *    conflict; the receipt is checked before freshness, freshness before the
 *    seat and the move;
 *  - an action names hidden cards by the aliases of the board it was picked
 *    from and is translated back against that revision (`resolveAliased`);
 *  - revisions only grow, and a snapshot carries its revision.
 *
 * Pure and portable: types, constants and validators only. It imports no
 * engine, so the page side can use it without loading one.
 */
import type { Action, PlayerId } from "../types";
import type { Snapshot } from "../snapshot-core";

export const LOCAL_PROTOCOL = "dbs-arena-local-match";
/** Bumped on any incompatible change to a message below. Both ends refuse any other. */
export const LOCAL_PROTOCOL_VERSION = 1;

/** The request id format of the online `act` (a UUID), so a client's ids work on either transport. */
export const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Session and match ids: chosen by the page, opaque to the worker. */
export const SESSION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/** AI decisions per committed batch, and per `advance` request. */
export const BATCH_DEFAULT = 4;
export const BATCH_MAX = 64;
export const ADVANCE_DEFAULT = 2000;
export const ADVANCE_MAX = 10000;

export interface Envelope {
  protocol: typeof LOCAL_PROTOCOL;
  v: number;
}

export interface StartRequest {
  type: "start";
  requestId: string;
  /** The page's name for this session; every later request must carry it. */
  sessionId: string;
  /** The match's durable name, under which the worker journals it (`resume`). */
  matchId: string;
  /** The board's game id (`Snapshot.game.id`); a local match is never a server row. */
  gameId: number;
  /** An offline pack (`local/pack.ts`); validated and qualified by the worker, never trusted. */
  pack: unknown;
  /** The pack's deck key for each seat. */
  decks: { p1: string; p2: string };
  /** The seat the page plays; the worker's local policy plays the other. */
  human: PlayerId;
  /** The game's seed (the engine's shuffles). */
  seed: number;
  /** The AI's own RNG seed; never the game's. */
  policySeed: number;
  /** The interpreter revision of the code the page loaded; must equal the pack's. */
  interpreterRevision: string;
  /** The policy version the page expects; any other is refused. Omitted: the worker's own. */
  policyVersion?: string;
  /** AI decisions per committed batch (default `BATCH_DEFAULT`). */
  batch?: number;
}

export interface ResumeRequest {
  type: "resume";
  requestId: string;
  sessionId: string;
  matchId: string;
  gameId: number;
  /** The pack the match was started from; its hash must be the journal's. */
  pack: unknown;
  interpreterRevision: string;
  policyVersion?: string;
  batch?: number;
}

export interface ReadRequest { type: "read"; requestId: string; sessionId: string }

export interface ApplyRequest {
  type: "apply";
  requestId: string;
  sessionId: string;
  /** The seat acting; only the human seat may. */
  actor: PlayerId;
  /** As the board shows it: hidden cards by alias. */
  action: Action;
  /** The revision of the board the action was picked from. */
  basedOn: number;
}

export interface AdvanceRequest {
  type: "advance";
  requestId: string;
  sessionId: string;
  basedOn: number;
  /** Stop after this many AI decisions (default `ADVANCE_DEFAULT`); the next advance continues. */
  maxDecisions?: number;
}

export interface CancelRequest {
  type: "cancel";
  requestId: string;
  sessionId: string;
  /** The request id of the running `advance` to stop. */
  target: string;
}

export interface DisposeRequest { type: "dispose"; requestId: string; sessionId: string }

export type LocalRequest = Envelope & (StartRequest | ResumeRequest | ReadRequest | ApplyRequest | AdvanceRequest | CancelRequest | DisposeRequest);
export type LocalRequestType = LocalRequest["type"];

export type SessionStatus = "playing" | "over" | "interrupted";

/** Why an `advance` stopped: the human is asked, the game ended, the request's bound, or an interruption. */
export type AdvanceStop = "human" | "over" | "limit" | "interrupted";

export type LocalErrorCode =
  /** Not a message of this protocol, or a field of the wrong shape. */
  | "malformed"
  /** Another protocol version. */
  | "version"
  /** The policy version asked for (or journalled) is not this worker's. */
  | "policy"
  /** The pack's interpreter revision is not the page's. */
  | "runtime"
  /** The pack fails validation, or is valid and not qualified (open blockers, unread mechanics). */
  | "unplayable"
  /** No such session in this worker (never started, or another worker's). */
  | "session"
  /** The session was disposed. */
  | "disposed"
  /** A session is already running (one match per worker), or a mutation is in flight. */
  | "busy"
  /** `basedOn` is not the current revision. */
  | "stale"
  /** The request id was already used for a different payload. */
  | "conflict"
  /** The actor is not the human seat, or not the seat being asked. */
  | "actor"
  /** The engine refused the move, or an alias does not name a card on the viewer's board now. */
  | "illegal"
  /** The match is over. */
  | "over"
  /** The AI met a question it cannot answer (an unsupported mechanic); nothing was invented. */
  | "interrupted"
  /** The advance was cancelled, or its session disposed, before its batch was committed. */
  | "cancelled"
  /** The journal is missing, or replaying it did not reproduce the recorded game. */
  | "journal"
  /** A bug in the worker. */
  | "internal";

/** A player-facing sentence for each code; the online `act`'s wording where it has one. */
export const ERROR_SENTENCE: Record<LocalErrorCode, string> = {
  malformed: "refresh the board before acting",
  version: "this page and the local game engine are different versions — reload the page",
  policy: "this match was recorded with another version of the computer opponent",
  runtime: "this deck pack was built for another version of the game engine",
  unplayable: "this deck pack cannot be played here",
  session: "no such game",
  disposed: "this game was closed",
  busy: "the computer is still thinking — try again in a moment",
  stale: "the board has moved on — read it again",
  conflict: "this request id was already used for a different action",
  actor: "it is not your turn",
  illegal: "that move is not allowed now",
  over: "the game is over",
  interrupted: "the computer opponent cannot continue this game",
  cancelled: "stopped",
  journal: "this saved game cannot be continued",
  internal: "the local game engine failed",
};

export interface ReadyMessage {
  type: "ready";
  policyVersion: string;
}

export interface ResultMessage {
  type: "result";
  requestId: string;
  sessionId: string;
  ok: true;
  /** The session's revision after the request. */
  revision: number;
  status: SessionStatus;
  /** The human seat's board at `revision`; null only for `dispose`. */
  snapshot: Snapshot | null;
  /** The request was answered from its receipt; nothing was played. */
  duplicate?: true;
  /** `advance` only: why it stopped. */
  stopped?: AdvanceStop;
  /** `cancel` only: whether a running advance was stopped. */
  cancelled?: boolean;
}

export interface ErrorMessage {
  type: "error";
  /** Null when the request was unreadable. */
  requestId: string | null;
  sessionId: string | null;
  ok: false;
  code: LocalErrorCode;
  message: string;
  /** The session's revision when it refused, if there is a session. */
  revision?: number;
  /** For `unplayable`/`runtime`/`journal`: every reason, verbatim. */
  reasons?: string[];
}

/** A committed change the page did not ask for by name (an AI batch): the human seat's new board. */
export interface SnapshotMessage {
  type: "snapshot";
  sessionId: string;
  revision: number;
  status: SessionStatus;
  snapshot: Snapshot;
}

/** The AI stopped on a question it cannot answer. The session stays at `revision`; no outcome is invented. */
export interface InterruptedMessage {
  type: "interrupted";
  sessionId: string;
  revision: number;
  reason: string;
}

export type LocalResponse = Envelope & (ReadyMessage | ResultMessage | ErrorMessage | SnapshotMessage | InterruptedMessage);

/** The exact top-level field set of each message, so nothing extra can ride along. */
export const RESPONSE_FIELDS: Record<LocalResponse["type"], { required: string[]; optional: string[] }> = {
  ready: { required: ["protocol", "v", "type", "policyVersion"], optional: [] },
  result: { required: ["protocol", "v", "type", "requestId", "sessionId", "ok", "revision", "status", "snapshot"], optional: ["duplicate", "stopped", "cancelled"] },
  error: { required: ["protocol", "v", "type", "requestId", "sessionId", "ok", "code", "message"], optional: ["revision", "reasons"] },
  snapshot: { required: ["protocol", "v", "type", "sessionId", "revision", "status", "snapshot"], optional: [] },
  interrupted: { required: ["protocol", "v", "type", "sessionId", "revision", "reason"], optional: [] },
};

export const envelope = (): Envelope => ({ protocol: LOCAL_PROTOCOL, v: LOCAL_PROTOCOL_VERSION });

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isSeat = (v: unknown): v is PlayerId => v === "p1" || v === "p2";
const isRevision = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const isInt = (v: unknown): v is number => Number.isInteger(v);
const isId = (v: unknown): v is string => typeof v === "string" && SESSION_ID_PATTERN.test(v);
const isRequestId = (v: unknown): v is string => typeof v === "string" && REQUEST_ID_PATTERN.test(v);
const optionalBound = (v: unknown, max: number) => v === undefined || (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= max);

export type Parsed<T> = { ok: true; value: T } | { ok: false; code: "malformed" | "version"; message: string; requestId: string | null; sessionId: string | null };

const REQUEST_FIELDS: Record<LocalRequestType, string[]> = {
  start: ["sessionId", "matchId", "gameId", "pack", "decks", "human", "seed", "policySeed", "interpreterRevision", "policyVersion", "batch"],
  resume: ["sessionId", "matchId", "gameId", "pack", "interpreterRevision", "policyVersion", "batch"],
  read: ["sessionId"],
  apply: ["sessionId", "actor", "action", "basedOn"],
  advance: ["sessionId", "basedOn", "maxDecisions"],
  cancel: ["sessionId", "target"],
  dispose: ["sessionId"],
};

/**
 * Read a message the page sent. Anything that is not exactly a request of this
 * protocol and version is refused with the reason; nothing is guessed.
 */
export function parseRequest(data: unknown): Parsed<LocalRequest> {
  const requestId = isRecord(data) && isRequestId(data.requestId) ? data.requestId : null;
  const sessionId = isRecord(data) && isId(data.sessionId) ? data.sessionId : null;
  const bad = (message: string, code: "malformed" | "version" = "malformed"): Parsed<LocalRequest> => ({ ok: false, code, message, requestId, sessionId });
  if (!isRecord(data)) return bad("not an object");
  if (data.protocol !== LOCAL_PROTOCOL) return bad(`not a ${LOCAL_PROTOCOL} message`);
  if (data.v !== LOCAL_PROTOCOL_VERSION) return bad(`protocol version ${String(data.v)} is not this worker's ${LOCAL_PROTOCOL_VERSION}`, "version");
  const type = data.type as LocalRequestType;
  const fields = REQUEST_FIELDS[type];
  if (!fields || !Object.prototype.hasOwnProperty.call(REQUEST_FIELDS, type)) return bad(`unknown request type ${String(data.type)}`);
  for (const k of Object.keys(data)) if (!["protocol", "v", "type", "requestId", ...fields].includes(k)) return bad(`unexpected field ${k}`);
  if (!requestId) return bad("requestId is not a UUID");
  if (!sessionId) return bad("sessionId is missing or malformed");
  switch (type) {
    case "start":
    case "resume": {
      if (!isId(data.matchId)) return bad("matchId is missing or malformed");
      if (!isInt(data.gameId)) return bad("gameId is not an integer");
      if (!isRecord(data.pack)) return bad("pack is not an object");
      if (typeof data.interpreterRevision !== "string" || !data.interpreterRevision) return bad("interpreterRevision is missing");
      if (data.policyVersion !== undefined && typeof data.policyVersion !== "string") return bad("policyVersion is not a string");
      if (!optionalBound(data.batch, BATCH_MAX)) return bad(`batch is not an integer from 1 to ${BATCH_MAX}`);
      if (type === "start") {
        const decks = data.decks;
        if (!isRecord(decks) || typeof decks.p1 !== "string" || typeof decks.p2 !== "string" || Object.keys(decks).length !== 2) return bad("decks must name a deck key for p1 and p2");
        if (!isSeat(data.human)) return bad("human is not a seat");
        if (!isInt(data.seed) || !isInt(data.policySeed)) return bad("seed and policySeed must be integers");
      }
      break;
    }
    case "apply":
      if (!isSeat(data.actor)) return bad("actor is not a seat");
      if (!isRecord(data.action) || typeof data.action.type !== "string") return bad("action is not an action");
      if (!isRevision(data.basedOn)) return bad("basedOn is not a revision");
      break;
    case "advance":
      if (!isRevision(data.basedOn)) return bad("basedOn is not a revision");
      if (!optionalBound(data.maxDecisions, ADVANCE_MAX)) return bad(`maxDecisions is not an integer from 1 to ${ADVANCE_MAX}`);
      break;
    case "cancel":
      if (!isRequestId(data.target)) return bad("target is not a request id");
      break;
  }
  return { ok: true, value: data as unknown as LocalRequest };
}

/**
 * Read a message the worker sent, on the page side: the envelope, the type and
 * the exact field set. A snapshot's own shape is the board's business.
 */
export function parseResponse(data: unknown): Parsed<LocalResponse> {
  const bad = (message: string, code: "malformed" | "version" = "malformed"): Parsed<LocalResponse> => ({ ok: false, code, message, requestId: null, sessionId: null });
  if (!isRecord(data)) return bad("not an object");
  if (data.protocol !== LOCAL_PROTOCOL) return bad(`not a ${LOCAL_PROTOCOL} message`);
  if (data.v !== LOCAL_PROTOCOL_VERSION) return bad(`protocol version ${String(data.v)} is not this page's ${LOCAL_PROTOCOL_VERSION}`, "version");
  const spec = Object.prototype.hasOwnProperty.call(RESPONSE_FIELDS, String(data.type)) ? RESPONSE_FIELDS[data.type as LocalResponse["type"]] : null;
  if (!spec) return bad(`unknown message type ${String(data.type)}`);
  for (const k of spec.required) if (!(k in data)) return bad(`${String(data.type)} without ${k}`);
  for (const k of Object.keys(data)) if (!spec.required.includes(k) && !spec.optional.includes(k)) return bad(`unexpected field ${k}`);
  if ("revision" in data && data.revision !== undefined && !isRevision(data.revision)) return bad("revision is not a revision");
  if ((data.type === "snapshot" || (data.type === "result" && data.snapshot !== null)) && !isRecord(data.snapshot)) return bad("snapshot is not an object");
  return { ok: true, value: data as unknown as LocalResponse };
}
