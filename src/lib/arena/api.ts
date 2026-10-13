/**
 * Shared pieces of `/api/v1` — the HTTP door onto `session.ts`.
 *
 * A client picks a move by **index into `legal`**, never by describing one.
 * That is the contract's first rule made structural rather than checked: there
 * is no way to express a move the engine did not offer, so a forged request
 * cannot even be written down, let alone refused. It also means this module
 * validates a small request object instead of restating the whole `Action` union
 * in Zod, which would be the very duplication the contract exists to prevent.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import type { PlayerId } from "./types";
import { ENGINE_IDS, LegacyGameRetired } from "./engines";
import { isVersus, seatOf, type Seats } from "./games";
import { CONTRACT_VERSION } from "./snapshot";

export type ErrorCode = "bad_request" | "not_found" | "illegal_action" | "game_over" | "not_your_turn" | "stale" | "idempotency_conflict" | "ai_error" | "contract_mismatch" | "gone";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  not_found: 404,
  illegal_action: 409,
  game_over: 409,
  not_your_turn: 409,
  stale: 409,
  idempotency_conflict: 409,
  ai_error: 502,
  contract_mismatch: 426,
  gone: 410,
};

export function fail(code: ErrorCode, message: string) {
  return NextResponse.json({ error: { code, message } }, { status: STATUS[code] });
}

/**
 * `loadGame(...).catch(retiredGame)`: a row the retired legacy engine wrote
 * (#118; the cleanup migration deletes them, this is for one that slipped
 * through) answers 410 with the reason instead of a server error.
 */
export function retiredGame(err: unknown): NextResponse {
  if (err instanceof LegacyGameRetired) return fail("gone", err.message);
  throw err;
}

export function ok<T>(body: T) {
  return NextResponse.json(body);
}

const mutationSchema = z.object({
  /**
   * The authoritative snapshot revision the client was looking at. It is
   * independent of `beats.seq`, which only tracks animation progress.
   */
  basedOn: z.number().int().min(0),
  /** Stable UUID reused when retrying this exact mutation. */
  requestId: z.string().uuid(),
});

/** Pick a move by its index in the `legal` array of the snapshot you hold. */
export const chooseSchema = mutationSchema.extend({ index: z.number().int().min(0) });
export const abandonSchema = mutationSchema;

export const newGameSchema = z.object({
  p1DeckId: z.number().int(),
  p2DeckId: z.number().int(),
  // "versus" is deliberately absent: a 1 v 1 is two people choosing two decks
  // at two moments, so it is opened as a match on the web (`matches.ts`) and
  // there is nothing here for a client to create in one call.
  mode: z.enum(["hotseat", "sparring", "tournament"]).default("hotseat"),
  debug: z.boolean().default(true),
  /** Accepted for older clients; the rules engine is the only one (#118), so only `rules` is valid and it changes nothing. */
  engine: z.enum(ENGINE_IDS).optional(),
});

/**
 * The chair this request sits in, and whether it may look at all.
 *
 * A 1 v 1 is drawn twice — once per device — so every read on this side needs
 * the asking login's seat, and every write needs it checked. Everything else
 * has one pair of eyes and gets `null`, which leaves `buildSnapshot` deriving
 * the viewer exactly as it always has.
 */
export async function seatFor(game: Seats & { mode: string }): Promise<PlayerId | null> {
  if (!isVersus(game.mode)) return null;
  return seatOf(game, await currentUser());
}

/** Query parameters of the long-polling board read. */
export function pollParams(url: URL): { sinceBeat: number; sinceRevision: number | null; waitMs: number } {
  const sinceBeat = Number(url.searchParams.get("sinceBeat") ?? 0);
  const rawRevision = url.searchParams.get("sinceRevision");
  const parsedRevision = rawRevision == null ? null : Number(rawRevision);
  const wait = Number(url.searchParams.get("wait") ?? 0);
  return {
    sinceBeat: Number.isFinite(sinceBeat) && sinceBeat > 0 ? Math.floor(sinceBeat) : 0,
    sinceRevision: parsedRevision != null && Number.isFinite(parsedRevision) && parsedRevision >= 0 ? Math.floor(parsedRevision) : null,
    // Capped: a long-poll holds a function for its whole duration.
    waitMs: Number.isFinite(wait) ? Math.min(Math.max(wait, 0), 30) * 1000 : 0,
  };
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export const CONTRACT = CONTRACT_VERSION;
