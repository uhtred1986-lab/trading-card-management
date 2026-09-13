/**
 * The rules engine, as far as it is built.
 *
 * `legacy` (`../engine/`) plays the manual as TypeScript; this one plays a
 * `GameDefinition` — the `.rules` files in `../rulesets/` — and is being built
 * behind the same `Engine` interface so the two can be compared move for move
 * (`arena:diff`). Four things it can do now: make a game and deal the
 * pre-game procedure into zones and attributes it reads off the definition
 * (`./zones.ts`, `./cards.ts`), **run the turn** as the phase and step
 * declarations say (`./flow.ts`), draw the board and the beats for a
 * client (`./view.ts`, `./beats.ts`), and read **a move and its refusal off one
 * declaration** (`./actions.ts`).
 *
 * What it will accept is **pass, endMain and concede** (#140), and every
 * `DEFINE ACTION` `actions.rules` declares (#144) — which so far is `pass`
 * itself, re-declared. Charging, playing, activating and attacking are the
 * issues after this one: each is a paragraph in that file and a price in
 * `costs.rules`, and neither the prices nor the program evaluator exists yet.
 * `ENGINE_INFO.rules.available` stays false, so the `/arena` form still greys
 * the engine out and no row can be created on it.
 *
 * The board the flow deals is the board the legacy engine deals from the same
 * seed, and the events it logs are the events the legacy engine logs, which is
 * what `verify/vm.ts` asserts and the reason the order of the RNG calls below
 * is the older engine's call for call.
 *
 * Pure and client-safe, like the legacy engine: no database, no network. The
 * definition arrives as a generated constant (`rulesets/dbs/files.ts`), so
 * nothing here reads a file at request time.
 */
import { IllegalAction, type Action, type EngineContext, type GameEvent, type GameOptions, type LegalAction, type RejectedAction } from "../engine";
import type { Beats } from "../beats";
import type { BoardView, CardArt } from "../view";
import { PLAYERS, type PlayerId } from "../engine/types";
import { rulesetFor, type GameDefinition } from "../rulesets";
import { applyDeclared, declaredLegalActions, declaredRejectedActions } from "./actions";
import { attributeGaps, attrsForDefs, playerAttributes, type AttrProblem, type AttrValue } from "./cards";
import { NotYet, RulesetBroken } from "./errors";
import { fire } from "./events";
import { SETUP_ZONES, WORKED_STEPS, answered, draw, endGame, enterPhase, flipForChooser, moved, other, requirePrompt, run, shuffleDeck, turnPhases } from "./flow";
import { VM_STATE_VERSION, type VmSide, type VmState } from "./state";
import { emptyZones, moveCard, newCard, placeZones } from "./zones";
import { vmBoardView } from "./view";
import { vmToBeats } from "./beats";
import type { Game } from "../../catalog/games";

export { VM_STATE_VERSION, isVmState, type VmFrame, type VmSide, type VmState } from "./state";
export { actionsAt, applyDeclared, candidatesOf, declaredLegalActions, declaredRejectedActions, type Candidate } from "./actions";
export { NotYet, RulesetBroken } from "./errors";
export { SETUP_ZONES, WORKED_STEPS, draw, moved, repeatAllowed, run, stepWorkNote, turnPhases, type MoveCause } from "./flow";
export { emit, fire, log, type Moment } from "./events";
export { masterOf, matchTriggers, nextPending, pendAutos, skillsShowing, type TriggerMatch, type VmPending } from "./triggers";
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
 * Make a game, and run it to its first question.
 *
 * The order of the RNG calls is the legacy engine's, call for call, because
 * that is what makes the two engines' opening boards the same game:
 *
 *  1. the cards are created — leader, then deck, then Z-Deck, per player, and
 *     the instance ids are `p1#0`, `p1#1`, … in that order (no RNG);
 *  2. one number decides which player chooses who goes first (6-2-1-4);
 *  3. the flow takes over at the setup phase's first step, and the shuffles,
 *     the opening hands, the mulligans, the life and the starting energy
 *     marker are its steps (6-2-1-7 … 6-2-1-11).
 *
 * Step 3 is what #140 changed: #139 dealt the whole board here, because there
 * were no prompts to interrupt it. Now there are, and the deal has to happen
 * where the procedure says — a mulligan returns a hand to a deck the life has
 * not been taken off yet (6-2-1-9-1 before 6-2-1-10), so a board dealt in one
 * go before the question was asked would redraw from the wrong pile.
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
  if (!rules.setupPhase) throw new RulesetBroken(ARENA_GAME, "it names no setupPhase, so the pre-game procedure has nowhere to begin");
  const places = new Set(placeZones(game));
  for (const zone of Object.values(SETUP_ZONES)) {
    if (!places.has(zone)) throw new RulesetBroken(ARENA_GAME, `the pre-game procedure puts cards in the ${zone}, which it declares no zone for`);
  }
  // The other half of the same promise: every step the interpreter still
  // carries out itself is a step this game really declares. A row in
  // `STEP_WORK` with no declaration is work that would silently never happen.
  for (const step of WORKED_STEPS) {
    if (!game.steps[step]) throw new RulesetBroken(ARENA_GAME, `the interpreter carries out a step called ${step}, which nothing declares`);
  }
  // `turnPhases` is read here so a game with no turn declared is refused at
  // creation rather than when the first turn is due to begin.
  turnPhases(game);

  const events: GameEvent[] = [];
  const state: VmState = {
    engine: "rules",
    game: game.id,
    seed: options.seed,
    version: VM_STATE_VERSION,
    rngState: options.seed >>> 0,
    phase: rules.setupPhase,
    chooser: "p1",
    firstPlayer: null,
    sides: { p1: emptySide("p1", options.p1.name, game), p2: emptySide("p2", options.p2.name, game) },
    cards: {},
    turn: 0,
    turnPlayer: "p1",
    flow: [],
    pending: [],
    prompt: { kind: "gameOver" },
    winner: null,
    overReason: null,
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
      const placed = moveCard(state, game, id, zone, { owner: p });
      if (!placed.ok) throw new RulesetBroken(ARENA_GAME, `a card cannot be placed in the ${zone}: ${placed.refused}`);
      // 6-2-4: a card arriving somewhere is a `moved` moment even here, which
      // is how "when your Leader is placed" is answered without this function
      // naming a trigger — `moved(to: leader)` is a declaration and the leader
      // is the only card whose zone matches it. The moment fires and the *log*
      // does not: dealing a game writes 102 cards into zones and neither
      // engine logs a move for any of them (`fire`, not `emit`).
      fire(ctx, game, state, { event: "moved", card: id, controller: p, args: { to: zone, asPlay: false } });
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
  // first. The flip is part of creating the game because it spends the seed,
  // and a later flip would give a different game.
  state.chooser = flipForChooser(state);
  events.push({ type: "gameStart", first: state.chooser, seed: options.seed });

  // 3. The pre-game procedure, as its own phase (6-2). It runs until the first
  // question — which is 6-2-1-4's, so a freshly made game is a game waiting to
  // be told who goes first.
  state.flow = [];
  enterPhase(ctx, game, state, events, rules.setupPhase);
  run(ctx, game, state, events);
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

// ── the moves the flow accepts ──────────────────────────────────────────────

/**
 * One action, applied.
 *
 * Five of them, and every one is about the *flow*: who goes first, whether to
 * redraw, and the three ways of declining to do anything else. What a card
 * does is a `DEFINE ACTION` with a price and a program, which is Stage 5 — so
 * an action this engine has no case for is refused by name rather than
 * silently ignored.
 *
 * The state is cloned before anything is touched, as the legacy engine's is:
 * a refusal in the middle of a move must leave the caller's state exactly as
 * it found it.
 */
function apply(ctx: EngineContext, prev: VmState, action: Action): { state: VmState; events: GameEvent[] } {
  const game = definitionFor(prev.game);
  const state = structuredClone(prev);
  const events: GameEvent[] = [{ type: "action", action }];

  // 0-1-3-4: conceding is a player's act and no card may cause or replace it,
  // so it is answered before any prompt is looked at — including at a prompt
  // that belongs to the other player.
  //
  // It is a `DEFINE ACTION` like every other move (#145), declared
  // `listed: false` — accepted and never enumerated, because a client shows it
  // as a button of its own — and the phases it names are the phases a game is
  // still being played in. What the declaration cannot yet say is what taking
  // it *does*: no op of the effect language ends a game, so its `DO` is empty,
  // `actions.rules` says why, and the ending stays the interpreter's the way
  // `flow.ts`'s worked steps are. A `DO` that grew one would be a program this
  // silently ignored, which is why it is named rather than skipped.
  if (action.type === "concede") {
    const def = game.actions.concede;
    if (!def) throw new RulesetBroken(state.game, "nothing declares conceding, and a player may give up a game at any point in it (0-1-3-4)");
    if (!def.when.includes(state.phase)) throw new IllegalAction(`${def.label ?? def.name} is not a move of the ${state.phase} phase`);
    if (def.do.length) throw new NotYet(`run what ${def.name} does — a game ending is not something a program can say yet`, "#142");
    endGame(ctx, game, state, events, other(action.player), `${state.sides[action.player].name} conceded`);
    // Straight to the runner: a game that has ended still has to walk into its
    // over phase, whose one step asks the question nobody answers. Returning
    // here left a finished game showing the prompt it was in the middle of.
    run(ctx, game, state, events);
    return { state, events };
  }

  switch (action.type) {
    case "chooseFirst": {
      requirePrompt(state, action, ["chooseFirst"]);
      state.firstPlayer = action.first;
      state.turnPlayer = action.first;
      answered(state);
      break;
    }
    case "mulligan": {
      requirePrompt(state, action, ["mulligan"]);
      if (action.redraw) mulligan(ctx, game, state, events, action.player);
      answered(state);
      break;
    }
    default:
      // Everything else is a `DEFINE ACTION`: `actions.rules` says when it is
      // offered, for which cards, what it costs and what it does, and
      // `vm/actions.ts` reads all of it (#144). The charge, the end of the Main
      // Phase and the generic decline are the four declared so far (#145), and
      // a move no declaration claims is refused by name rather than silently
      // ignored, naming the issue that declares it.
      if (!applyDeclared(ctx, game, state, events, action)) throw new NotYet(`take a ${action.type} action — no DEFINE ACTION declares it`, DECLARED_BY[action.type] ?? "#146");
  }

  run(ctx, game, state, events);
  return { state, events };
}

/**
 * Which issue declares a move this engine has no paragraph for yet, so a
 * refusal names the work rather than the gap. The play family and the battle it
 * leads to are #146's; an activation needs a skill index as well as a card, and
 * is #147's.
 */
const DECLARED_BY: Partial<Record<Action["type"], string>> = {
  play: "#146",
  playZ: "#146",
  growUnison: "#146",
  attack: "#146",
  block: "#146",
  combo: "#146",
  counter: "#146",
  zEnergyFromCombo: "#146",
  activate: "#147",
};

/** 6-2-1-9-1: the hand goes to the bottom of the deck, the deck is shuffled, and six new cards are drawn — once. */
function mulligan(ctx: EngineContext, game: GameDefinition, state: VmState, events: GameEvent[], p: PlayerId): void {
  // To the *bottom* of the deck, one at a time, which is the order the legacy
  // engine returns them in and therefore the deck the shuffle then reorders.
  for (const id of state.sides[p].zones[SETUP_ZONES.hand].slice()) moved(ctx, game, state, events, id, SETUP_ZONES.deck, { owner: p, position: "bottom" });
  shuffleDeck(state, p);
  draw(ctx, game, state, events, p, game.game?.hand ?? 0);
}

/**
 * Every legal move: the `DEFINE ACTION`s the question on the table could be
 * answered with (#144), and then the answers that are still the flow's own.
 *
 * The declared moves come first because they are the moves; the flow's are the
 * declines, which is where the legacy engine puts "End turn" too. Conceding is
 * on neither — a move declared `listed: false` is accepted and never
 * enumerated, because it is a button of its own, which is exactly what the
 * legacy engine does with it.
 */
function legalActions(ctx: EngineContext, state: VmState): LegalAction[] {
  return [...declaredLegalActions(ctx, definitionFor(state.game), state), ...promptAnswers(state)];
}

/**
 * The answers the interpreter still gives itself: who goes first, and whether
 * to redraw.
 *
 * Both are answers to the pre-game procedure rather than moves of a turn —
 * neither is about a card, and each carries a field no candidate could supply
 * (which player, whether to redraw), which is why `DECLARABLE_ACTIONS` has no
 * word for them. The labels are the legacy engine's word for word: a client
 * that showed "Go first" on one board and "Choose to go first" on the other
 * would be a client reading the engine rather than the contract.
 */
function promptAnswers(state: VmState): LegalAction[] {
  const pr = state.prompt;
  switch (pr.kind) {
    case "chooseFirst":
      return PLAYERS.map((first) => ({ action: { type: "chooseFirst", player: pr.player, first }, label: first === pr.player ? "Go first" : "Go second" }));
    case "mulligan":
      return [
        { action: { type: "mulligan", player: pr.player, redraw: false }, label: "Keep hand" },
        { action: { type: "mulligan", player: pr.player, redraw: true }, label: "Mulligan" },
      ];
    default:
      return [];
  }
}

/**
 * Why a move is refused.
 *
 * Read off the same `DEFINE ACTION` paragraphs the menu is (#144): a candidate
 * the declaration's `REFUSE` list stops is here with the requirement that
 * stopped it, and a candidate with nothing against it is on the menu instead.
 * There is no `whyNot*` twin to keep in step, because there is no second
 * reading of the rule to drift from the first.
 *
 * The answers `promptAnswers` still gives are not explained, and honestly so:
 * each is the only answer to its question, so there is no move a player could
 * reach for and miss.
 */
function rejectedActions(ctx: EngineContext, state: VmState, legal: LegalAction[]): RejectedAction[] {
  return declaredRejectedActions(ctx, definitionFor(state.game), state, legal);
}

/** The board, drawn from the declarations for one side of the table. */
function boardView(ctx: EngineContext, state: VmState, viewer: PlayerId, images: Record<string, CardArt>): BoardView {
  return vmBoardView(ctx, definitionFor(state.game), state, viewer, images);
}

/** One batch of events as the board plays them back. */
function toBeats(ctx: EngineContext, state: VmState, events: GameEvent[], after = 0): Beats {
  return vmToBeats(ctx, state, events, after);
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
  apply,
  legalActions,
  rejectedActions,
  boardView,
  toBeats,
};
