"use client";

/**
 * Where the invisible piles are.
 *
 * A card coming from the deck, or going to the Drop, has no element of its own
 * at either end — the pile is a number, not a row of cards. An anchor gives
 * each of those piles a rectangle, so a flight has somewhere to start and a
 * ghost has somewhere to go.
 */

export interface Point {
  x: number;
  y: number;
}

/** An invisible marker filling whatever it is dropped into. */
export function ZoneAnchor({ zone }: { zone: string }) {
  return <span data-arena-zone={zone} aria-hidden className="pointer-events-none absolute inset-0" />;
}

/**
 * The middle of a zone, relative to the board, offset by half a card so the
 * card's top-left lands on the pile rather than beside it.
 *
 * Measured at the moment the beat plays, not at render: by the time a ghost is
 * drawn the board may have moved, and where the pile was when the card left it
 * is the honest answer.
 */
export function anchorPoint(host: HTMLElement | null, zone: string): Point | null {
  if (!host) return null;
  const el = host.querySelector(`[data-arena-zone="${CSS.escape(zone)}"]`);
  if (!el) return null;
  const h = host.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2 - h.left - 20, y: r.top + r.height / 2 - h.top - 28 };
}

/**
 * The middle of a specific card's own element, by the instance id every beat
 * names (`data-arena-card`, `ArenaCard.tsx`) — for a flight between two named
 * cards rather than between a card and a pile. Null when that card has no
 * element on the board right now, which is the caller's cue to fall back to
 * a pile anchor instead.
 */
export function cardPoint(host: HTMLElement | null, cardId: string): Point | null {
  if (!host) return null;
  const el = host.querySelector(`[data-arena-card="${CSS.escape(cardId)}"]`);
  if (!el) return null;
  const h = host.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2 - h.left - 14, y: r.top + r.height / 2 - h.top - 14 };
}
