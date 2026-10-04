import { eq, isNull } from "drizzle-orm";
import { decks, ownedCards } from "@/db/schema";

/**
 * Whose cards and decks a query counts (docs/architecture/auth.md):
 *
 * - `undefined`: everyone's — an SL's whole view, and local dev;
 * - a name: that owner's only — a player always, and a deck's own owner for
 *   what that deck reserves;
 * - `null`: the lots and decks with no owner (added while the app ran open).
 *
 * Built decks reserve copies from their own owner's lots only, so one player
 * can never block another's cards (`src/lib/decks/reservations.ts`).
 */
export type OwnerScope = string | null | undefined;

export function lotScope(scope: OwnerScope) {
  if (scope === undefined) return undefined;
  return scope === null ? isNull(ownedCards.owner) : eq(ownedCards.owner, scope);
}

export function deckScope(scope: OwnerScope) {
  if (scope === undefined) return undefined;
  return scope === null ? isNull(decks.owner) : eq(decks.owner, scope);
}

/** A player sees their own owner name only; an SL (or nobody, local dev) sees everyone's. */
export function scopeFor(viewer: { kind: "sl" | "player"; owner: string | null } | null): OwnerScope {
  return viewer?.kind === "player" ? (viewer.owner ?? "") : undefined;
}
