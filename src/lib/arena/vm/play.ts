/**
 * A card being played, and what that comes to on the board (5-5, 8-3-2).
 *
 * Playing is the one move with more to it than a price and a program: the card
 * arrives somewhere, something already there may have to leave, markers are put
 * on it, its [Permanent]s come into force, and every [Auto] watching for an
 * arrival answers. The legacy engine does all of that in `resolvePlay`
 * (`engine/engine.ts`), reached from four action handlers and from the `play`
 * op; here it is reached from **one** place — `host.playThen`, the method
 * `stepScript` calls for the `play` op — so a play a player declares and a play
 * a skill makes (5-5-3) are the same act rather than two copies of it. An
 * `ACTION play` says `DO { play(target: $card) }` and lands here; so does a
 * card reading "play 1 card from your hand".
 *
 * **What is a declaration and what is still named here.** Where the card goes
 * is `PLAY_ZONES`, and where something already there goes is read off the
 * zone's own `single:` — 3-11-5 is not a rule about Unisons, it is what a zone
 * that holds one does when a second arrives, and `zones.rules` is where DBS
 * says which zones those are. `PLAY_ZONES` and `REPLACED_ON_PLAY` are the two
 * pieces of the DBS definition this module still names, and both are checked
 * against the declarations at `createGame` the way `SETUP_ZONES` and
 * `STEP_WORK` are: what would replace them is a line on `DEFINE ZONE` saying
 * which card types it receives, which is a grammar addition and not this
 * issue's.
 *
 * **Nothing here names a trigger.** The arrival is `moved(asPlay: true)` and
 * `dbs/triggers.rules` decides that this is `played`, `youPlayed` and
 * `opponentPlayed` — the difference from the forty hand-placed `pendTriggers`
 * calls in `engine/`. A [Permanent] coming into force needs no call at all:
 * `vm/effects.ts` reads them off every in-play zone, so a card that has arrived
 * is a card whose statics stand.
 *
 * Pure and client-safe, like the rest of `vm/`: no database, no network.
 */
import type { EngineContext, GameEvent } from "../types";
import type { Mode, PlayerId } from "../types";
import type { GameDefinition } from "../rulesets";
import { attrsOf } from "./cards";
import { addEffect } from "./effects";
import { NotYet, RulesetBroken } from "./errors";
import { log } from "./events";
import { moved } from "./flow";
import type { VmState } from "./state";
import { attrsNow, queryHookStatics } from "./program";
import { SETUP_ZONES, findCard, moveCard } from "./zones";

/**
 * The in-play area a card of each base type is played into (3-6-1, 3-11-4).
 *
 * Keyed by the base type a `CardFilter`'s `type:` is compared against — a
 * Z-card by what it is a Z-card *of* (14-1), a token by the Battle Card it is
 * (19-1) — so one row covers `BATTLE`, `Z-BATTLE` and `TOKEN` together, which
 * is the same reading `vm/filters.ts` makes of the declared `type` attribute.
 * An Extra Card is activated rather than played (4-2), and the row is here
 * because a skill may still *place* one (5-5-3).
 *
 * There is deliberately **no row for a Leader**. 3-5-3 says no effect or rule
 * moves a card out of the Leader Area, so a Leader is never the card a play is
 * about; a program that named one would otherwise displace the Leader standing
 * there, which is the rule read backwards.
 */
export const PLAY_ZONES: Record<string, string> = { BATTLE: "battle", UNISON: "unison", EXTRA: "battle" };

/**
 * 17-2-1-3: a Z-Extra arriving removes the Z-Extras already out.
 *
 * The one rule of a play that is about a **card type** rather than about a
 * zone, which is exactly why it is a row and not a branch: the declarations
 * have no word for "a card of this type replaces the cards of that type", and
 * inventing one for a single rule would be a grammar nobody else could use.
 * Keyed by the printed type (not the base type), because a Z-Extra and an Extra
 * are different rules.
 */
const REPLACED_ON_PLAY: Record<string, { of: string; to: string; section: string }> = {
  "Z-EXTRA": { of: "Z-EXTRA", to: "removed", section: "17-2-1-3" },
};

/**
 * 3-11-5: where the card an arrival displaces goes.
 *
 * A zone declared `single:` says that a second card cannot join the first; it
 * does not say what becomes of the first, and no field of `DEFINE ZONE` does
 * either. The third and last name this module carries, and the same one the
 * `life` price already names through its own `DO`.
 */
const DISPLACED_TO = "drop";

/** Every zone this module names, for the check `createGame` makes against the declarations. */
export const PLAY_ZONE_NAMES = [...new Set([...Object.values(PLAY_ZONES), ...Object.values(REPLACED_ON_PLAY).map((r) => r.to), DISPLACED_TO])];

/**
 * How a card came to be played, beyond the card and the player.
 *
 * 13-2-3's markers are here since #157: a Unison arrives carrying the energy
 * paid for it, which `actions.rules` says as `play(target: $card, markers: X)`
 * — part of the arrival rather than a later step, so the markers [Empower]
 * carries across land after them (22-45-3), the legacy `play.resolve`'s order.
 */
export interface PlayOptions {
  /** 5-5: "play it in Rest Mode". */
  mode?: Mode;
  /** 22-13-6-3 / 22-5-5: played *onto* another card, which goes under it (23-2's pile, `stackOnto`). */
  onto?: string;
  /** 9-1-5: "played with its skills negated". */
  negated?: "turn" | "game";
  /**
   * 9-1-5 again, the shape a [Counter: Play] leaves on the play it answers
   * ("it's played with its skills negated for the turn", #150): the same
   * turn-long effect, but no note — the legacy `continuations.playNegated`,
   * which `resolvePlay` applies silently where its own `negated` argument
   * says so in the log.
   */
  negatedForTurn?: boolean;
  /**
   * 13-2-3: the markers a Unison arrives with, paid for as its cost — part of
   * the arrival since #157, so markers carried across land after them (the
   * `playUnison` move says `play(target: $card, markers: X)`).
   */
  markers?: number;
  /** 22-45-3: markers carried across from the Unison this one replaced ([Empower], #157) — read before it left. */
  carry?: { from: string; n: number };
}

/**
 * 22-45-3: may markers come across onto this card from the one its arrival
 * displaces? The card's `markerCarry` keyword bodies are read ([Empower]'s
 * `carryMarkers` leaf), against the card already in the single-card area it
 * is played into: the first whose colour the old card has (any, with none)
 * gives the most — the least of its `upTo` and the markers the old card has.
 * Null when nothing would be displaced or nothing answers.
 */
export function carryFor(ctx: EngineContext, game: GameDefinition, state: VmState, card: string, player: PlayerId): { from: string; max: number } | null {
  const inst = state.cards[card];
  const def = inst && ctx.defs[inst.cardId];
  if (!def) return null;
  const to = PLAY_ZONES[baseTypeOf(String(attrsOf(def, game).attrs.type ?? ""))];
  if (!to || game.zones[to]?.single !== true) return null;
  const from = (state.sides[player].zones[to] ?? []).find((id) => id !== card);
  if (!from) return null;
  const colors = (attrsNow(ctx, game, state, from).colors ?? []) as string[];
  const fact = queryHookStatics(ctx, game, state, card, "markerCarry").find((f) => f.op === "carryMarkers" && (f.color == null || colors.includes(f.color)));
  if (!fact || fact.op !== "carryMarkers" || fact.upTo <= 0) return null;
  return { from, max: Math.min(fact.upTo, state.cards[from].markers) };
}

/**
 * Put a played card where it goes, and let the board answer.
 *
 * In this order, and the order is the legacy engine's because the log is what
 * `arena:diff` compares: whatever the card displaces leaves first (3-11-5, so a
 * skill answering to the old Unison's departure is behind it in the log and in
 * front of the arrival), then the card arrives, then its markers, then the
 * silence 9-1-5 puts on it — which is applied **before** the [Auto]s can
 * resolve, so a card brought back silenced does not fire its own skill on the
 * way in.
 */
export function resolvePlay(
  ctx: EngineContext,
  game: GameDefinition,
  state: VmState,
  ev: GameEvent[],
  card: string,
  player: PlayerId,
  opts: PlayOptions = {},
): void {
  const inst = state.cards[card];
  const def = inst && ctx.defs[inst.cardId];
  if (!def) throw new RulesetBroken(state.game, `there is no card ${card} to play`);
  const printed = String(attrsOf(def, game).attrs.type ?? "");
  // 22-46-6: a card played *onto* another goes where its host stands — a
  // Z-Leader by [Z-Awaken] onto the Leader, which is the one way a card joins
  // the Leader Area (6-1-4); the old Leader goes under it and does not leave
  // the area (3-5-3). [Evolve] and [Union-Absorb]'s hosts are in the area
  // their type is played into anyway (#155).
  const host = opts.onto;
  const hostZone = host !== undefined && host !== card ? (findCard(state, host)?.zone ?? null) : null;
  const to = hostZone && hostZone === SETUP_ZONES.leader ? hostZone : PLAY_ZONES[baseTypeOf(printed)];
  // A `NotYet` and not a `RulesetBroken`: the only way here is a skill whose
  // program plays a card of a type no area receives (a Leader, 3-5-3), and the
  // runner catches a `NotYet` and stops that one skill rather than the game.
  if (!to) throw new NotYet(`play ${def.name}, which is a ${printed || "card"} and not a card this game plays into any area (3-5-3)`, "#146");

  // 17-2-1-3, and nothing else of its shape: the cards this arrival replaces.
  const replaces = REPLACED_ON_PLAY[printed];
  if (replaces) {
    for (const id of (state.sides[player].zones[to] ?? []).slice()) {
      if (id === card) continue;
      const other = ctx.defs[state.cards[id]?.cardId ?? ""];
      if (!other || String(attrsOf(other, game).attrs.type ?? "") !== replaces.of) continue;
      moved(ctx, game, state, ev, id, replaces.to, { owner: player });
    }
  }

  // 3-11-5 read off the zone rather than off the card: an area that holds one
  // card sends the card already in it to the Drop when a second is played.
  if (game.zones[to]?.single === true) {
    for (const id of (state.sides[player].zones[to] ?? []).slice()) {
      if (id !== card && id !== host) moved(ctx, game, state, ev, id, DISPLACED_TO, { owner: player });
    }
  }

  // 9-6-9-4: this *is* the play, which is what `asPlay: true` says and what
  // `played`/`youPlayed`/`opponentPlayed` ask for. 5-5-1: the card is revealed
  // as it arrives. 22-13-6-3 / 22-5-5: played *onto* another card, it takes
  // that card's place and the card goes under it (`stackOnto`); with the host
  // gone from the area, it is an ordinary play beside it — the legacy reading.
  if (host !== undefined && host !== card && (state.sides[player].zones[to] ?? []).includes(host)) stackOnto(ctx, game, state, ev, card, host, player, to);
  else moved(ctx, game, state, ev, card, to, { owner: player, asPlay: true, reveal: true });

  // 13-2-3, 22-45-3: the markers paid for it, then those carried across from
  // the Unison it replaced, each its own beat — the carried one naming the
  // card it left (#109) — the legacy `resolvePlay`'s order and words.
  const paid = opts.markers ?? 0;
  const carried = opts.carry?.n ?? 0;
  if (paid || carried) state.cards[card].markers = paid + carried;
  if (paid) log(ev, { type: "markers", card, delta: paid, total: paid });
  if (carried && opts.carry) {
    log(ev, { type: "markers", card, delta: carried, total: paid + carried, from: opts.carry.from });
    log(ev, { type: "note", text: `Empower: ${carried} marker${carried === 1 ? "" : "s"} carried over` });
  }

  // 5-5: "play it in Rest Mode" — the mode the play itself puts it in, which is
  // a fact about the arrival rather than a switch afterwards, so no
  // `modeSwitched` moment is fired for it.
  if (opts.mode && game.zones[to]?.modes?.includes(opts.mode)) {
    const now = state.cards[card];
    if (now.mode !== opts.mode) {
      now.mode = opts.mode;
      log(ev, { type: "mode", card, mode: opts.mode });
    }
  }
  // 9-1-5: "played with its skills negated". A continuous effect for both
  // durations rather than a mark on the instance, which is how this engine
  // keeps negation everywhere (`vm/effects.ts`, `host.negateAll`) — one reading
  // of the rule, for every reader of it.
  if (opts.negatedForTurn) addEffect(state, ev, { target: card, kind: "negateSkills", value: 0, until: "turn", source: card });
  if (opts.negated) {
    addEffect(state, ev, { target: card, kind: "negateSkills", value: 0, until: opts.negated, source: card });
    log(ev, { type: "note", text: `${def.name} was played with its skills negated` });
  }
}

/**
 * 22-5-5, 22-13-6-3: a card played on top of another (23-2) — [Evolve],
 * [Union-Absorb], "play … on top of this card". The legacy `stackOnto`, in its
 * order: the card arrives (the play, so its moments are the play's), takes the
 * host's place in the area and its mode, the host goes under it with its own
 * pile, the host's power effects carry over to the stack (21-5-2) and its
 * others end, and a host fighting a battle hands its role to the stack
 * (8-1-7-1). The card underneath answers no moment: it has not left the area
 * (23-2-2-2), which is why it moves by `moveCard` and not by `moved`.
 */
function stackOnto(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], card: string, host: string, player: PlayerId, to: string): void {
  const list = state.sides[player].zones[to];
  const slot = list.indexOf(host);
  const mode = state.cards[host].mode;
  moved(ctx, game, state, ev, card, to, { owner: player, asPlay: true, reveal: true, onto: host });
  const under = moveCard(state, game, host, to, { under: card });
  if (!under.ok) throw new RulesetBroken(state.game, `${host} cannot go under ${card}: ${under.refused}`);
  list.splice(list.indexOf(card), 1);
  list.splice(Math.min(slot, list.length), 0, card);
  if (mode !== undefined) state.cards[card].mode = mode;
  for (const e of state.effects) if (e.target === host && e.kind === "power") e.target = card;
  state.effects = state.effects.filter((e) => e.target !== host);
  const b = state.battle;
  if (b && (b.attacker === host || b.guard === host)) {
    state.cards[card].battledThisTurn = true;
    if (b.attacker === host) b.attacker = card;
    if (b.guard === host) b.guard = card;
  }
  log(ev, { type: "stack", top: card, under: state.cards[card].under.slice() });
}

/** The base type a zone is chosen by (14-1, 19-1) — `vm/filters.ts`'s reading of the same attribute. */
function baseTypeOf(type: string): string {
  const bare = type.replace(/^Z-/, "");
  return bare === "TOKEN" ? "BATTLE" : bare;
}
