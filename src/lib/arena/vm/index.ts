/**
 * The rules engine, as far as it is built.
 *
 * `legacy` (`../engine/`) plays the manual as TypeScript; this one plays a
 * `GameDefinition` — the `.rules` files in `../rulesets/` — and is being built
 * behind the same `Engine` interface so the two can be compared move for move
 * (`arena:diff`). Today it can do two things: make a game, and **deal the
 * opening board** into zones and attributes it reads off the definition
 * (`./zones.ts`, `./cards.ts`). The board it deals is the same board the legacy
 * engine deals from the same seed, which is the claim `verify/vm.ts` makes and
 * the reason the dealing had to come before the flow: every later stage is
 * measured against the older engine, and a measurement needs a shared
 * starting point.
 *
 * Every other call throws `NotYet`, naming both the call and the issue that
 * builds it, because a silent no-op would look like a game that simply had
 * nothing to do. `ENGINE_INFO.rules.available` stays false, so the `/arena`
 * form still greys the engine out and no row can be created on it.
 *
 * Pure and client-safe, like the legacy engine: no database, no network. The
 * definition arrives as a generated constant (`rulesets/dbs/files.ts`), so
 * nothing here reads a file at request time.
 */
import type { EngineContext, GameEvent, GameOptions, LegalAction, RejectedAction } from "../engine";
import type { Beats } from "../beats";
import type { BoardView } from "../view";
import { nextRandom, shuffle } from "../engine/rng";
import { PLAYERS, type PlayerId } from "../engine/types";
import { rulesetFor, type GameDefinition } from "../rulesets";
import { attributeGaps, attrsForDefs, playerAttributes, type AttrProblem, type AttrValue } from "./cards";
import { VM_STATE_VERSION, type VmSide, type VmState } from "./state";
import { emptyZones, moveCard, newCard, placeZones } from "./zones";
import type { Game } from "../../catalog/games";

export { VM_STATE_VERSION, isVmState, type VmSide, type VmState } from "./state";
export { attributeGaps, attrsForDefs, attrsOf, cardAttributes, playerAttributes, type AttrProblem, type AttrValue, type Attrs, type AttributeGaps } from "./cards";
export { FilterNeedsAttribute, MEASURES, attributesRead, attributesRequired, deferredMeasures, measuresUsed, predicateOf, skillsIn, usesMeasure, type Measure } from "./filters";
export {
  arrivalMode,
  emptyZones,
  findCard,
  hostOf,
  inPlayZones,
  moveCard,
  newCard,
  placeZones,
  type At,
  type Board,
  type MoveOptions,
  type MoveRecord,
  type MoveResult,
  type Replacement,
  type VmCard,
  type Zones,
} from "./zones";

/**
 * The arena plays the original game only — the engine reads the Masters rule
 * manual and `deckInputFor` returns null for a Fusion World deck (owner's
 * decision, 4 Sep 2026). A second game is a second directory under
 * `rulesets/` and a second value here, not a second engine.
 */
const ARENA_GAME: Game = "dbs";

/**
 * The zones the pre-game procedure puts cards in, by the names `game.rules`
 * already uses for the same things: `DEFINE GAME`'s `deck:`, `zDeck:`, `hand:`
 * and `life:` are the sizes of these four piles, and the Leader Card's own area
 * is the fifth (6-2-1-2).
 *
 * **This is the one place the interpreter still knows a zone by name**, and it
 * is here because the setup *steps* in `game.rules` carry no `DO` programs yet:
 * `setupShuffle`, `setupHand` and `setupLife` are declared with their manual
 * sections and their text, and nothing else (Stage 5 writes the programs, and
 * #140 runs them). Naming five zones in one constant that is checked against
 * the declarations at load is the honest version of that gap — the dishonest
 * version is an interpreter that reads `state.sides.p1.hand` in fifty places.
 * When the steps carry programs, this constant goes and the deal becomes six
 * declarations.
 */
const SETUP_ZONES = { leader: "leader", deck: "deck", zDeck: "zDeck", hand: "hand", life: "life" } as const;

/**
 * A call the rules engine cannot answer yet.
 *
 * The message names the call *and* the issue that builds it, so a stack trace
 * from a script or a fuzz run says what to go and read rather than only that
 * something was missing.
 */
export class NotYet extends Error {
  readonly step: string;
  readonly issue: string;
  constructor(step: string, issue: string) {
    super(`the rules engine cannot ${step} yet — ${issue} builds it`);
    this.name = "NotYet";
    this.step = step;
    this.issue = issue;
  }
}

/** The game's definition would not load, which is a bug in the `.rules` files rather than in the game being started. */
export class RulesetBroken extends Error {
  constructor(game: Game, detail: string) {
    super(`the ${game} ruleset does not load, so no game can be played on the rules engine: ${detail}`);
    this.name = "RulesetBroken";
  }
}

/** The loaded definition, or a `RulesetBroken` naming the first thing wrong with it. */
function definitionFor(game: Game): GameDefinition {
  const loaded = rulesetFor(game);
  if (!loaded.ok) {
    const first = loaded.errors[0];
    throw new RulesetBroken(game, first ? `${first.file}:${first.line}:${first.col} ${first.message}` : "no reason given");
  }
  return loaded.definition;
}

/**
 * Make a game, and deal the pre-game procedure of 6-2-1 into it.
 *
 * The order of the RNG calls is the legacy engine's, call for call, because
 * that is what makes the two engines' opening boards the same game:
 *
 *  1. the cards are created — leader, then deck, then Z-Deck, per player, and
 *     the instance ids are `p1#0`, `p1#1`, … in that order (no RNG);
 *  2. one number decides which player chooses who goes first (6-2-1-4);
 *  3. each player's deck is shuffled and six cards drawn (6-2-1-7, 6-2-1-9),
 *     p1 then p2;
 *  4. each player's top eight cards become their life (6-2-1-10).
 *
 * Three things the procedure asks for are **not** done, each because it needs
 * something this engine does not have yet rather than because it was forgotten:
 * the mulligan (6-2-1-9-1) and the first-player choice (6-2-1-5) are prompts,
 * which are #140's; and the starting energy marker (6-2-1-11) belongs to
 * whoever goes second, which is not known until that choice is made — and
 * `DEFINE GAME` has no `startMarkers:` to read it from either, because the
 * rule is "the second player only" and the field is one number for both
 * players (recorded in `game.rules`, 12 Sep 2026). None of the three moves a
 * shuffle or a draw, so the board dealt here is the board both engines have
 * once the mulligans are declined.
 *
 * The card *attributes* are built here and not stored: they are a pure function
 * of the catalog rows in `ctx.defs` and the declarations, so copying them into
 * `arena_games.state` would be copying the catalog into every row. What is
 * stored is the board. A catalog value the declarations do not describe is
 * reported as a `note` once, at creation — never thrown, because one odd row
 * out of 6,500 must not be what stops a game.
 */
function createGame(ctx: EngineContext, options: GameOptions): { state: VmState; events: GameEvent[] } {
  const game = definitionFor(ARENA_GAME);
  const rules = game.game;
  if (!rules) throw new RulesetBroken(ARENA_GAME, "it declares no DEFINE GAME, so there are no setup numbers to deal");
  if ((rules.players ?? 2) !== 2) throw new RulesetBroken(ARENA_GAME, `it declares ${rules.players} players, and a game is played by the two the app seats`);
  const places = new Set(placeZones(game));
  for (const zone of Object.values(SETUP_ZONES)) {
    if (!places.has(zone)) throw new RulesetBroken(ARENA_GAME, `the pre-game procedure puts cards in the ${zone}, which it declares no zone for`);
  }

  const events: GameEvent[] = [];
  const state: VmState = {
    engine: "rules",
    game: game.id,
    seed: options.seed,
    version: VM_STATE_VERSION,
    rngState: options.seed >>> 0,
    phase: "setup",
    chooser: "p1",
    firstPlayer: null,
    sides: { p1: emptySide("p1", options.p1.name, game), p2: emptySide("p2", options.p2.name, game) },
    cards: {},
  };

  // 1. The cards. Every card in the game exists before anything is shuffled,
  // which is what makes an instance id a function of the decklist alone.
  for (const p of PLAYERS) {
    const input = p === "p1" ? options.p1 : options.p2;
    let n = 0;
    const add = (cardId: string, zone: string): string => {
      if (!ctx.defs[cardId]) throw new Error(`unknown card ${cardId}`);
      const id = `${p}#${n++}`;
      state.cards[id] = newCard(id, cardId, p);
      const moved = moveCard(state, game, id, zone, { owner: p });
      if (!moved.ok) throw new RulesetBroken(ARENA_GAME, `a card cannot be placed in the ${zone}: ${moved.refused}`);
      return id;
    };
    add(input.leader, SETUP_ZONES.leader);
    for (const cardId of input.main) add(cardId, SETUP_ZONES.deck);
    for (const cardId of input.z ?? []) add(cardId, SETUP_ZONES.zDeck);
  }

  // The load report: every attribute of every card in this game, checked
  // against the declarations once.
  events.push(...report(attrsForDefs(ctx.defs, game).problems, attributeGaps(game)));

  // 2. 6-2-1-4: a random method chooses one player, who then chooses who goes
  // first. The choice itself is #140; the flip is part of dealing because it
  // spends the seed, and a later flip would give a different game.
  const flip = nextRandom(state.rngState);
  state.rngState = flip.state;
  state.chooser = flip.value < 0.5 ? "p1" : "p2";

  // 3. 6-2-1-7/9: shuffle, then draw the opening hand, one player at a time.
  for (const p of PLAYERS) {
    const deck = state.sides[p].zones[SETUP_ZONES.deck];
    const shuffled = shuffle(deck, state.rngState);
    state.sides[p].zones[SETUP_ZONES.deck] = shuffled.items;
    state.rngState = shuffled.state;
    deal(state, game, p, SETUP_ZONES.hand, rules.hand, "bottom");
  }

  // 4. 6-2-1-10: the top eight cards of the deck become the life, each placed
  // on the pile as it is taken — which is the legacy engine's order, and the
  // order damage later takes them back in.
  for (const p of PLAYERS) deal(state, game, p, SETUP_ZONES.life, rules.life, "top");

  return { state, events };
}

/** An empty side: a list per declared place zone, and the declared player attributes at rest. */
function emptySide(id: PlayerId, name: string, game: GameDefinition): VmSide {
  const attrs: Record<string, AttrValue> = {};
  for (const attr of playerAttributes(game)) {
    const declared = game.attributes[attr];
    // Only a number has an obvious value at rest; anything else is the
    // interpreter's to fill when the rule that sets it runs.
    if (declared.value === "number") attrs[attr] = 0;
  }
  return { id, name, zones: emptyZones(game), attrs };
}

/** Move `n` cards from the top of the deck into `zone`. Stops early rather than dealing cards that are not there — a short deck is the deck-building rules' business (6-1-3), not the dealer's. */
function deal(state: VmState, game: GameDefinition, p: PlayerId, zone: string, n: number, position: "top" | "bottom"): void {
  const deck = state.sides[p].zones[SETUP_ZONES.deck];
  for (let i = 0; i < n; i++) {
    const id = deck[0];
    if (!id) return;
    const moved = moveCard(state, game, id, zone, { owner: p, position });
    if (!moved.ok) throw new RulesetBroken(state.game, `the pre-game procedure cannot deal into the ${zone}: ${moved.refused}`);
  }
}

/**
 * The load report as events: one note per problem, and one per direction of a
 * gap between the adapter and the declarations. Capped, because a catalog-wide
 * mistake would otherwise write six thousand notes into the first game that
 * noticed it; the count is in the last note so nothing is hidden.
 */
function report(problems: AttrProblem[], gaps: { unfilled: string[]; undeclared: string[] }): GameEvent[] {
  const events: GameEvent[] = [];
  const LIMIT = 10;
  for (const p of problems.slice(0, LIMIT)) {
    events.push({ type: "note", text: `${p.card}'s ${p.attr} is declared ${p.declared} and the catalog gave ${p.got}, so the card has no ${p.attr} in this game` });
  }
  if (problems.length > LIMIT) events.push({ type: "note", text: `${problems.length} card values in all do not match their attribute declarations` });
  if (gaps.unfilled.length) events.push({ type: "note", text: `nothing fills the declared card attributes ${gaps.unfilled.join(", ")}` });
  if (gaps.undeclared.length) events.push({ type: "note", text: `the catalog is read for ${gaps.undeclared.join(", ")}, which this game declares no attribute for` });
  return events;
}

/**
 * The engine itself.
 *
 * Declared here without the `Engine` annotation and given it in
 * `../engines.ts`, which is what keeps the dependency one-way: the switch
 * knows about the engine, the engine does not know about the switch.
 */
export const RULES = {
  id: "rules" as const,
  createGame,
  /**
   * Each of these takes no argument on purpose: it reads nothing, because
   * there is nothing yet to read it with. A narrower function is still
   * assignable to the `Engine` member it stands in for, so the interface says
   * what each one *will* be handed and this file says only that it cannot use
   * it yet.
   */
  apply(): { state: VmState; events: GameEvent[] } {
    throw new NotYet("apply an action", "#140");
  },
  legalActions(): LegalAction[] {
    throw new NotYet("list the legal actions", "#140");
  },
  rejectedActions(): RejectedAction[] {
    throw new NotYet("say why a move is refused", "#140");
  },
  boardView(): BoardView {
    throw new NotYet("draw the board", "#140");
  },
  toBeats(): Beats {
    throw new NotYet("turn its events into beats", "#140");
  },
};
