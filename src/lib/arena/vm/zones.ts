/**
 * Where a card *is*, read off the `ZONE` declarations rather than off a field
 * name.
 *
 * The legacy engine has one `PlayerState` with a named field per area —
 * `hand`, `battle`, `zDeck`, and `leader`/`unison` as a bare string because
 * only one card fits. An interpreter that plays a `GameDefinition` cannot have
 * any of those: it is handed fifteen `DEFINE ZONE`s it has never seen and a
 * side is a `Record<zoneName, cardId[]>` built from them. Everything a zone's
 * declaration says is honoured here and nowhere else —
 *
 *   `place`       whether the zone is a list of cards at all (#139's one
 *                 grammar addition): `play` is a word for three zones at once
 *                 (9-1-3-1) and `under` is the pile hanging off one card
 *                 (23-2-2-2), and without the line an interpreter would have
 *                 to know those two names.
 *   `single`      at most one card, so the leader and the Unison Area need no
 *                 second shape (3-5-1, 3-11-4).
 *   `ordered`     the rules fix the order; `position` says which end a card
 *                 arrives at (3-2-2, 3-9-2).
 *   `modes`       the positions a card in this zone can be in, the first being
 *                 the one it arrives in (1-10).
 *   `markers`     whether a card here may carry markers (1-11); anywhere else
 *                 they are dropped on arrival.
 *   `inPlay`      the areas a card's own skills are valid in (9-1-3-1), which
 *                 is what `play` stands for.
 *   `host`        whether a card in this zone may have cards under it (23-2).
 *
 * `moveCard` is the only mover, the way `move` is in the legacy engine: one
 * place for 3-1-4 (a card that changes area is a new card), for the single-card
 * refusal, and for the **replacement hook** 9-10 needs — an effect that changes
 * where a card about to move goes (#125/#142). The hook is a parameter and a
 * record here, not a behaviour: nothing in this engine can yet say "instead",
 * and a mover that quietly applied a replacement it had not been given would be
 * the harder bug to find later.
 *
 * Pure and client-safe: no database, no network, no `fs`.
 */
import type { PlayerId } from "../engine/types";
import type { GameDefinition, ZoneDef } from "../rulesets";

/** One side's areas: every zone the game declares as a place, in declaration order. */
export type Zones = Record<string, string[]>;

/** A card in a game, as the rules engine keeps it. Everything else about a card is an *attribute* (`vm/cards.ts`). */
export interface VmCard {
  /** Unique in this game (`p1#17`), the same convention the legacy engine uses. */
  id: string;
  /** The catalog id (`BT18-020`), which is what `ctx.defs` is keyed by. */
  cardId: string;
  /** Whose card it is. A card in an opponent's area still belongs to its owner (3-1-6). */
  owner: PlayerId;
  /** The mode it is in, when its zone declares any; null when the zone has none (1-10). */
  mode: string | null;
  /** Markers on the card (1-11). Only a zone declared `markers: true` keeps them. */
  markers: number;
  /** The cards under this one, topmost first (23-2). They are in no zone of their own. */
  under: string[];
  /** 3-9-2-1: turned face up in a closed area, and still in it. */
  faceUp: boolean;
  /** Turned to its back side — a Leader's awakened face (1-9). */
  flipped: boolean;
  /** 1-10-2 Hidden Mode: face down in play, no information (23-5). */
  hidden: boolean;
}

/** A fresh card, in no zone yet: its caller moves it somewhere with `moveCard`. */
export function newCard(id: string, cardId: string, owner: PlayerId): VmCard {
  return { id, cardId, owner, mode: null, markers: 0, under: [], faceUp: false, flipped: false, hidden: false };
}

/**
 * The zones a side has: every `owner: player` zone the game declares as a
 * place, in the order the declarations were read, so two machines build the
 * same side from the same files.
 *
 * A `shared` zone is not one of these — no area of DBS is shared (3-1-1) and a
 * game that declares one needs a board-level list, which is the issue that
 * declares it.
 */
export function placeZones(game: GameDefinition): string[] {
  return Object.entries(game.zones)
    .filter(([, z]) => z.owner === "player" && z.place !== false)
    .map(([name]) => name);
}

/** The zones a card in them is *in play* (9-1-3-1) — what the word `play` stands for. */
export function inPlayZones(game: GameDefinition): string[] {
  return placeZones(game).filter((name) => game.zones[name].inPlay === true);
}

/** An empty board for one side: one list per place zone. */
export function emptyZones(game: GameDefinition): Zones {
  const zones: Zones = {};
  for (const name of placeZones(game)) zones[name] = [];
  return zones;
}

/** The mode a card arriving in this zone is in: the first the zone declares, or none at all (1-10). */
export function arrivalMode(zone: ZoneDef): string | null {
  return zone.modes?.[0] ?? null;
}

// ── the one mover ───────────────────────────────────────────────────────────

/**
 * What a replacement effect would have the move be instead (9-10). Carried so
 * the hook point exists and is recorded; **nothing applies it yet** — #125
 * declares `replace(event)` and #142 runs it.
 */
export interface Replacement {
  /** The rule asking for the change, so the log can say who. */
  source: string;
  /** The zone the card goes to instead. */
  to: string;
  /** The mode it arrives in, when the replacement says (" …in Rest Mode instead"). */
  mode?: string;
}

export interface MoveOptions {
  /** Whose copy of the zone: an opponent's Battle Area is a different area (3-1-1). Defaults to the card's owner. */
  owner?: PlayerId;
  /** Which end of the pile the card arrives at. `"bottom"` (append) by default; the rule being played says when it is the top. */
  position?: "top" | "bottom";
  /** The mode it arrives in. Defaults to the zone's first declared mode. */
  mode?: string;
  /** Keep mode, markers and the faces — a card moving *within* play has not changed area (3-1-4). */
  carry?: boolean;
  /** Put it under this card instead of into a zone (23-2). The host's zone must be declared `host: true`. */
  under?: string;
  /** A replacement the caller has already decided on. Recorded, never applied (see `Replacement`). */
  replacement?: Replacement | null;
}

/** What a move did, as the log will read it once there is one (#141). */
export interface MoveRecord {
  card: string;
  /** The zone it left, or null if it was in none (a card just created, or one under another card). */
  from: string | null;
  fromOwner: PlayerId | null;
  /** The zone it arrived in, or `under` when it went beneath a host. */
  to: string;
  owner: PlayerId;
  /** The host it went under (23-2), when it did. */
  under: string | null;
  /** The replacement the caller passed, so a later stage can see the hook was reached and declined. */
  replacement: Replacement | null;
}

export type MoveResult = { ok: true; move: MoveRecord } | { ok: false; refused: string };

/** Where a card is: whose zone, which zone, and where in it. Null for a card under another card, which is in no zone (3-1-4). */
export interface At {
  owner: PlayerId;
  zone: string;
  index: number;
}

/** The board `moveCard` works on — the part of `VmState` that is cards and zones, so the mover needs no whole state. */
export interface Board {
  sides: Record<PlayerId, { zones: Zones }>;
  cards: Record<string, VmCard>;
}

/** Where this card is, searched the same way for both sides so the answer does not depend on who asked. */
export function findCard(board: Board, id: string): At | null {
  for (const owner of Object.keys(board.sides) as PlayerId[]) {
    const zones = board.sides[owner].zones;
    for (const zone of Object.keys(zones)) {
      const index = zones[zone].indexOf(id);
      if (index >= 0) return { owner, zone, index };
    }
  }
  return null;
}

/** The card this one is under, if any (23-2). A card in a pile is in no zone, so this is how it is found at all. */
export function hostOf(board: Board, id: string): string | null {
  for (const card of Object.values(board.cards)) if (card.under.includes(id)) return card.id;
  return null;
}

/**
 * Move one card, honouring what the zone's declaration says about it.
 *
 * Refuses rather than throws, and the refusal is a sentence: a mover that threw
 * would make a single-card zone a crash instead of a rule, and every caller is
 * a rule that can say why it did not happen.
 */
export function moveCard(board: Board, game: GameDefinition, id: string, to: string, opts: MoveOptions = {}): MoveResult {
  const card = board.cards[id];
  if (!card) return { ok: false, refused: `there is no card ${id} in this game` };

  const from = findCard(board, id);
  const host = hostOf(board, id);

  // ── under a host (23-2) ──────────────────────────────────────────────────
  if (opts.under !== undefined) {
    const onTop = board.cards[opts.under];
    if (!onTop) return { ok: false, refused: `there is no card ${opts.under} to go under` };
    if (onTop.id === id) return { ok: false, refused: `a card cannot go under itself` };
    const at = findCard(board, onTop.id);
    if (!at) return { ok: false, refused: `${opts.under} is in no zone, so nothing can go under it` };
    if (game.zones[at.zone]?.host !== true) return { ok: false, refused: `the ${at.zone} does not hold cards under cards (23-2)` };
    lift(board, id, host);
    // 23-2-2-2: the cards under a card are in the area of the card on top, and
    // 3-1-4 applies on the way down — a card in a pile carries nothing with it.
    reset(card, null);
    // A card arriving with a pile of its own flattens into the host's, the way
    // the legacy engine's `placeUnder` does: a pile hanging off a card that is
    // itself in a pile is in no area at all.
    const carried = card.under.splice(0);
    onTop.under.unshift(id, ...carried);
    return { ok: true, move: record(id, from, "under", onTop.owner, opts, opts.under) };
  }

  // ── into a zone ─────────────────────────────────────────────────────────
  const zone = game.zones[to];
  if (!zone) return { ok: false, refused: `the ${game.id} ruleset declares no zone called ${JSON.stringify(to)}` };
  if (zone.place === false) return { ok: false, refused: `the ${to} is not a place a card is put (${zone.text ?? "no card sits in it"})` };
  if (zone.owner !== "player") return { ok: false, refused: `the ${to} is not a zone a player has` };

  const owner = opts.owner ?? card.owner;
  // 3-1-6-1: only an in-play or combo area may hold a card that is not its
  // master's. Anywhere else the card goes to its owner's copy of the zone.
  const toOwner = owner !== card.owner && !(zone.inPlay === true || zone.host === true) ? card.owner : owner;
  const list = board.sides[toOwner]?.zones[to];
  if (!list) return { ok: false, refused: `${toOwner} has no ${to}` };
  if (zone.single === true && list.length && list[0] !== id) {
    return { ok: false, refused: `there is already a card in the ${to}, which holds one` };
  }
  // Every refusal above and this one come before anything is touched: a mover
  // that detached first and then refused would leave the card in no zone at
  // all, which is a board no rule can describe.
  if (opts.mode !== undefined && !zone.modes?.includes(opts.mode)) return { ok: false, refused: `a card in the ${to} is never ${opts.mode}` };

  lift(board, id, host);
  if (!opts.carry) reset(card, zone);
  else if (zone.modes && !zone.modes.includes(card.mode ?? "")) card.mode = arrivalMode(zone);
  if (opts.mode !== undefined) card.mode = opts.mode;
  if (zone.markers !== true) card.markers = 0;
  if (opts.position === "top") list.unshift(id);
  else list.push(id);
  return { ok: true, move: record(id, from, to, toOwner, opts, null) };
}

function record(id: string, from: At | null, to: string, owner: PlayerId, opts: MoveOptions, under: string | null): MoveRecord {
  return { card: id, from: from?.zone ?? null, fromOwner: from?.owner ?? null, to, owner, under, replacement: opts.replacement ?? null };
}

/**
 * Take the card out of wherever it is — its zone, or the pile of the card it was
 * under. Both, because a card is in one or the other and a mover that knew only
 * about zones would leave a copy of it behind in a host's pile.
 */
function lift(board: Board, id: string, host: string | null): void {
  const at = findCard(board, id);
  if (at) board.sides[at.owner].zones[at.zone].splice(at.index, 1);
  if (host) {
    const above = board.cards[host];
    above.under = above.under.filter((u) => u !== id);
  }
}

/**
 * 3-1-4: a card that changes area is treated as a new card. Mode, markers and
 * both faces go back to what a card arriving in this zone has — which is the
 * zone's first declared mode, or none when it declares none.
 */
function reset(card: VmCard, zone: ZoneDef | null): void {
  card.mode = zone ? arrivalMode(zone) : null;
  card.markers = 0;
  card.faceUp = false;
  card.flipped = false;
  card.hidden = false;
}
