/**
 * Shared pieces of `/api/v1` — the HTTP door onto `session.ts`.
 *
 * A client picks a move by **index into `legal`**, never by describing one.
 * That is the contract's first rule made structural rather than checked: there
 * is no way to express a move the engine did not offer, so a forged request
 * cannot even be written down, let alone refused. It also means this module
 * validates a two-field object instead of restating the whole `Action` union
 * in Zod, which would be the very duplication the contract exists to prevent.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import type { PlayerId } from "./engine";
import { ENGINE_IDS } from "./engines";
import { isVersus, seatOf, type Seats } from "./games";
import { CONTRACT_VERSION } from "./snapshot";

export type ErrorCode = "bad_request" | "not_found" | "illegal_action" | "game_over" | "not_your_turn" | "stale" | "ai_error" | "contract_mismatch";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  not_found: 404,
  illegal_action: 409,
  game_over: 409,
  not_your_turn: 409,
  stale: 409,
  ai_error: 502,
  contract_mismatch: 426,
};

export function fail(code: ErrorCode, message: string) {
  return NextResponse.json({ error: { code, message } }, { status: STATUS[code] });
}

export function ok<T>(body: T) {
  return NextResponse.json(body);
}

/** Pick a move by its index in the `legal` array of the snapshot you hold. */
export const chooseSchema = z.object({
  index: z.number().int().min(0),
  /**
   * The `beats.seq` the client was looking at. When it no longer matches, the
   * game has moved on and the index means something else — so the move is
   * refused rather than guessed at.
   */
  basedOn: z.number().int().min(0).optional(),
});

export const newGameSchema = z.object({
  p1DeckId: z.number().int(),
  p2DeckId: z.number().int(),
  // "versus" is deliberately absent: a 1 v 1 is two people choosing two decks
  // at two moments, so it is opened as a match on the web (`matches.ts`) and
  // there is nothing here for a client to create in one call.
  mode: z.enum(["hotseat", "sparring", "tournament"]).default("hotseat"),
  debug: z.boolean().default(true),
  /** Which engine plays it (`engines.ts`); left out, the `arena.engine` setting decides. */
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
export function pollParams(url: URL): { sinceBeat: number; waitMs: number } {
  const sinceBeat = Number(url.searchParams.get("sinceBeat") ?? 0);
  const wait = Number(url.searchParams.get("wait") ?? 0);
  return {
    sinceBeat: Number.isFinite(sinceBeat) && sinceBeat > 0 ? Math.floor(sinceBeat) : 0,
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
