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
import type { EngineContext, GameEvent } from "../engine";
import type { Mode, PlayerId } from "../engine/types";
import type { GameDefinition } from "../rulesets";
import { attrsOf } from "./cards";
import { addEffect } from "./effects";
import { NotYet, RulesetBroken } from "./errors";
import { log } from "./events";
import { moved } from "./flow";
import type { VmState } from "./state";

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
 * 13-2-3's markers are **not** here: a Unison arrives carrying the energy paid
 * for it, and `actions.rules` says so in the move's own program
 * (`addMarker(target: $card, n: X)`) rather than as a parameter of the play.
 * The legacy engine carries the number on its `play.resolve` flow step, which
 * is the same fact said in the place a `DEFINE ACTION` cannot reach.
 */
export interface PlayOptions {
  /** 5-5: "play it in Rest Mode". */
  mode?: Mode;
  /** 22-13-6-3: played *onto* another card, which is 23-2's pile and is not built yet. */
  onto?: string;
  /** 9-1-5: "played with its skills negated". */
  negated?: "turn" | "game";
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
  const to = PLAY_ZONES[baseTypeOf(printed)];
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
      if (id !== card) moved(ctx, game, state, ev, id, DISPLACED_TO, { owner: player });
    }
  }

  if (opts.onto !== undefined) {
    throw new NotYet(`play ${def.name} on top of another card (22-13-6-3) — [Union-Absorb] is a keyword, and its body is #157's`, "#157");
  }

  // 9-6-9-4: this *is* the play, which is what `asPlay: true` says and what
  // `played`/`youPlayed`/`opponentPlayed` ask for. 5-5-1: the card is revealed
  // as it arrives.
  moved(ctx, game, state, ev, card, to, { owner: player, asPlay: true, reveal: true });

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
  if (opts.negated) {
    addEffect(state, ev, { target: card, kind: "negateSkills", value: 0, until: opts.negated, source: card });
    log(ev, { type: "note", text: `${def.name} was played with its skills negated` });
  }
}

/** The base type a zone is chosen by (14-1, 19-1) — `vm/filters.ts`'s reading of the same attribute. */
function baseTypeOf(type: string): string {
  const bare = type.replace(/^Z-/, "");
  return bare === "TOKEN" ? "BATTLE" : bare;
}
