/**
 * Engine events → what a client animates.
 *
 * `GameEvent` says in its own comment that the UI animates from it, but the
 * events only exist for the length of one `apply()`. This turns a batch of
 * them into *beats*: the same story, told in the few shapes a board can draw,
 * with every card named by the instance id both clients key their cards on.
 *
 * It is a translation, not a passthrough. Several events have no picture and
 * deliberately collapse to nothing, and `powerCompare` becomes one `clash`.
 * The switch is exhaustive, so a new engine event is a compile error here
 * rather than a moment the board silently stops showing.
 *
 * Pure: no database, no images. `art` carries the name captured *at event
 * time* — a KO'd card is gone from any later view, so a client cannot look it
 * up — and `session.ts` fills in the image URLs, which is what keeps this
 * testable in `npm test`.
 */
import { compileCardCached, face, skillsOf, type EngineContext, type GameEvent, type GameState, type PlayerId } from "./engine";
import type { Area } from "./engine";
import { def } from "./engine/state";

export type Beat =
  /** A named step of the game: a phase, or a step within a battle. */
  | { t: "phase"; phase: string; player: PlayerId; turn: number }
  | { t: "draw"; player: PlayerId; card: string | null }
  | { t: "move"; card: string; from: Area; to: Area; owner: PlayerId }
  | { t: "mode"; card: string; mode: "active" | "rest" }
  | { t: "flip"; card: string }
  | { t: "markers"; card: string; delta: number; total: number }
  /** A token appears in a Battle Area from outside the game. */
  | { t: "token"; card: string; owner: PlayerId }
  | { t: "attack"; attacker: string; target: string }
  | { t: "block"; guard: string; by: string }
  | { t: "clash"; attacker: string; guard: string; attackPower: number; guardPower: number; hit: boolean }
  /** `cards` are the life cards taken, so they can be flown to hand or Drop. */
  | { t: "damage"; player: PlayerId; amount: number; critical: boolean; cards: string[] }
  | { t: "ko"; card: string }
  | { t: "negated" }
  | { t: "skill"; card: string; label: string; text: string; unread: boolean }
  /** Claude's table talk, added by `run.ts` rather than by the engine. */
  | { t: "say"; text: string }
  | { t: "over"; winner: PlayerId | null; reason: string };

/**
 * Beats are numbered rather than counted, so a client can replay exactly what
 * it has not seen (`n > lastPlayed`) even after the queue has been capped.
 */
export type NumberedBeat = Beat & { n: number };

/** A card a beat names, as it was when the beat happened. */
export interface BeatArt {
  cardId: string;
  name: string;
  /** Filled in by `session.ts`; null everywhere the catalog is not reachable. */
  imageUrl: string | null;
}

export interface Beats {
  /** The highest `n` in `list`. Monotonic for the life of the queue. */
  seq: number;
  list: NumberedBeat[];
  /** Keyed by instance id, for cards that have left the board by now. */
  art: Record<string, BeatArt>;
}

export const EMPTY_BEATS: Beats = { seq: 0, list: [], art: {} };

/** How many beats a game keeps. A whole opponent turn is a few dozen. */
export const BEAT_CAP = 300;

const SKILL_LABELS: Record<string, string> = {
  "activate:main": "Activate: Main",
  "activate:battle": "Activate: Battle",
  "activate:main/battle": "Activate: Main/Battle",
  auto: "Auto",
  permanent: "Permanent",
  "counter:play": "Counter: Play",
  "counter:attack": "Counter: Attack",
  "counter:battle card attack": "Counter: Attack",
  "counter:counter": "Counter",
  keyword: "Keyword",
};

/**
 * The card, tag and clause behind a `skill` event — which is also exactly what
 * the board's spotlight banner needs, so `games.ts` reads it from here rather
 * than working it out a second time.
 */
export function describeSkillEvent(
  ctx: EngineContext,
  state: GameState,
  e: Extract<GameEvent, { type: "skill" }>,
): { cardId: string; name: string; label: string; text: string; unread: boolean } | null {
  const inst = state.cards[e.card];
  if (!inst) return null;
  try {
    const d = def(ctx, state, e.card);
    const side = inst.flipped && d.back ? "back" : "front";
    const sk = skillsOf(d, side).find((x) => x.index === e.skill);
    const compiled = compileCardCached(d, side).bySkill[e.skill];
    return {
      cardId: inst.cardId,
      name: face(ctx, state, e.card).name,
      label: sk?.tags[0] ?? SKILL_LABELS[sk?.kind ?? ""] ?? "Skill",
      text: e.text.replace(/\s+/g, " ").trim(),
      unread: !!compiled?.unsupported.length,
    };
  } catch {
    return null;
  }
}

/**
 * One batch of events, numbered from `after`.
 *
 * `after` is the seq the queue is already at, so beats keep climbing across
 * the several `apply()` calls one opponent turn takes.
 */
export function toBeats(ctx: EngineContext, state: GameState, events: GameEvent[], after = 0): Beats {
  const list: NumberedBeat[] = [];
  const art: Record<string, BeatArt> = {};
  let n = after;

  const push = (b: Beat) => list.push({ ...b, n: ++n } as NumberedBeat);

  /** Remember a card as it is *now*, before it leaves the board for good. */
  const remember = (id: string) => {
    if (art[id]) return;
    const inst = state.cards[id];
    if (!inst) return;
    let name = inst.cardId;
    try {
      name = face(ctx, state, id).name;
    } catch {
      // A token whose definition has gone, or a card mid-move: the id reads
      // better than throwing away the whole batch.
    }
    art[id] = { cardId: inst.cardId, name, imageUrl: null };
  };

  for (const e of events) {
    switch (e.type) {
      case "phase":
        push({ t: "phase", phase: e.phase, player: e.player, turn: e.turn });
        break;
      case "battleStep":
        // A battle step is a named step like a phase is; the client labels it.
        push({ t: "phase", phase: e.step, player: state.turnPlayer, turn: state.turn });
        break;
      case "draw":
        remember(e.card);
        push({ t: "draw", player: e.player, card: e.card });
        break;
      case "move":
        remember(e.card);
        push({ t: "move", card: e.card, from: e.from, to: e.to, owner: e.owner });
        break;
      case "mode":
        remember(e.card);
        push({ t: "mode", card: e.card, mode: e.mode });
        break;
      case "flip":
        // Only the awakening. A leader turning back has no moment to show.
        if (e.flipped) {
          remember(e.card);
          push({ t: "flip", card: e.card });
        }
        break;
      case "markers":
        remember(e.card);
        push({ t: "markers", card: e.card, delta: e.delta, total: e.total });
        break;
      case "token":
        // A token is pushed straight into the Battle Area with no `move`, so
        // without this it would appear out of nowhere between two snapshots.
        remember(e.card);
        push({ t: "token", card: e.card, owner: e.owner });
        break;
      case "attack":
        remember(e.attacker);
        remember(e.target);
        push({ t: "attack", attacker: e.attacker, target: e.target });
        break;
      case "guardChanged":
        remember(e.guard);
        remember(e.by);
        push({ t: "block", guard: e.guard, by: e.by });
        break;
      case "powerCompare":
        remember(e.attacker);
        remember(e.guard);
        push({ t: "clash", attacker: e.attacker, guard: e.guard, attackPower: e.attackPower, guardPower: e.guardPower, hit: e.hit });
        break;
      case "damage":
        for (const c of e.cards) remember(c);
        push({ t: "damage", player: e.player, amount: e.amount, critical: e.critical, cards: e.cards });
        break;
      case "ko":
        remember(e.card);
        push({ t: "ko", card: e.card });
        break;
      case "attackNegated":
        push({ t: "negated" });
        break;
      case "skill": {
        const d = describeSkillEvent(ctx, state, e);
        if (d) {
          remember(e.card);
          push({ t: "skill", card: e.card, label: d.label, text: d.text, unread: d.unread });
        }
        break;
      }
      case "gameOver":
        push({ t: "over", winner: e.winner, reason: e.reason });
        break;

      // Nothing to draw. Each of these is either an input, bookkeeping, or a
      // number that simply reads differently in the next snapshot.
      case "gameStart": // the mulligan prompt follows immediately and says it better
      case "action": // the input, not a picture of it
      case "hidden": // a card's facing is already in the view
      case "energyMarker": // a counter in the side panel, with no motion of its own
      case "effect": // continuous effects show up as changed power figures
      case "delayed": // written down for later; it gets its moment when it fires
      case "stack": // the stacked card's own `move` beat covers the arrival
      case "note": // engine commentary, for the log only
        break;

      default: {
        const _exhaustive: never = e;
        void _exhaustive;
        break;
      }
    }
  }

  return { seq: n, list, art };
}

/** Add a batch to a game's queue, keeping it bounded. */
export function appendBeats(prev: Beats | null, next: Beats): Beats {
  const before = prev ?? EMPTY_BEATS;
  const list = [...before.list, ...next.list].slice(-BEAT_CAP);
  return { seq: next.seq, list, art: { ...before.art, ...next.art } };
}
