/**
 * The turn, run as a program.
 *
 * In the legacy engine a turn is a `switch` over `Phase` (`exec`,
 * `engine/engine.ts`). Here it is the `DEFINE PHASE` and `DEFINE STEP`
 * declarations of `rulesets/<game>/game.rules`, and this module is the whole
 * interpreter of them: it knows **steps, prompts and the bound on a repeat**,
 * and nothing about Dragon Ball. Getting that line right is what makes a second
 * game a set of files (`docs/arena-ruleset-spec.md` §1).
 *
 * **The frame is the suspension.** `state.flow` is a stack of `{ phase, index }`
 * — one frame per phase in progress, `index` the step that comes next — and a
 * game waiting on a prompt is a game whose top frame points at the step that
 * asked. Nothing is held in a closure and nothing is recomputed from the board,
 * so a game is storable mid-decision and reproducible from its seed plus its
 * actions. That is the legacy engine's guarantee, kept, and it is the property
 * `arena:diff` rests on.
 *
 * **What it still knows by name, and why.** Two constants name pieces of the
 * DBS definition: `SETUP_ZONES` (#139's, kept — it now lives in `./zones.ts`,
 * where the readings in `./program.ts` can reach it without importing the
 * runner that imports them) and `STEP_WORK` below. A step carries a `DO`
 * program from Stage 5; until then eleven of them are things the interpreter
 * does itself, and naming those eleven in one table that is checked against
 * the declarations at load is the honest version of that gap. The
 * dishonest version is a runner with `if (phase === "charge")` in it. Each row
 * says which manual section it is and what it waits on; when the steps carry
 * programs the table goes and this module loses its last DBS word.
 *
 * **What happens is fired as a moment, never as a trigger name** (#141). A step
 * that moves a card, enters a phase or switches a mode says so in the words the
 * `DEFINE TRIGGER` patterns are written in (`./events.ts`), and
 * `rulesets/dbs/triggers.rules` decides which [Auto]s that is a moment for. The
 * runner names no trigger anywhere, which is the difference between this and the
 * forty hand-placed `pendTriggers` calls in the engine it is replacing.
 *
 * Pure and client-safe: no database, no network, no `fs`.
 */
import { IllegalAction, type Action, type EngineContext, type GameEvent } from "../engine";
import { AREAS, PHASES } from "../engine/script";
import { nextRandom, shuffle } from "../engine/rng";
import { PLAYERS, other, type Area, type Phase, type PlayerId, type Prompt } from "../engine/types";
import type { Cond, Selector, Side } from "../engine/script";
import type { PatternValue } from "../lang";
import type { GameDefinition, StepDef, WinDef } from "../rulesets";
import { RulesetBroken } from "./errors";
import { emit, log, type Moment } from "./events";
import { nextPending, skillsShowing } from "./triggers";
import { dueDelays, endEffects as endEffectsOfDuration, endTurnRelativeEffects, expireDelayed } from "./effects";
import { vmHost } from "./host";
import { NotYet } from "./errors";
import { stepScript, type ScriptFrame } from "../engine/script";
import type { Trigger } from "../engine/types";
import { SETUP_ZONES, arrivalMode, moveCard } from "./zones";
import type { VmFrame, VmState } from "./state";

// `other` is the engine's own: a game of two is what `DEFINE GAME players: 2`
// declares and `createGame` refuses anything else, and the two engines had
// better agree which player is the other one.
export { other };

/**
 * The zones the pre-game procedure and the turn put cards in, by the names
 * `game.rules` already uses for the same things: `DEFINE GAME`'s `deck:`,
 * `zDeck:`, `hand:` and `life:` are the sizes of these four piles, and the
 * Leader Card's own area is the fifth (6-2-1-2).
 *
 * **This is one of the two places the interpreter still knows a zone by name**,
 * and it is here because the setup and Charge Phase *steps* in `game.rules`
 * carry no `DO` programs yet (Stage 5 writes them). Naming five zones in one
 * constant that is checked against the declarations at load is the honest
 * version of that gap — the dishonest version is an interpreter that reads
 * `state.sides.p1.hand` in fifty places. When the steps carry programs, this
 * constant goes and the deal becomes six declarations.
 */
export { SETUP_ZONES };

/**
 * Who a declared prompt kind asks.
 *
 * Prompt *mechanics* are the interpreter's and not the game's
 * (`docs/arena-ruleset-spec.md` §7): how a question is asked, how a partial
 * answer is held, how the same question re-asks after a replay. Which player it
 * is put to is part of that machinery, and this is the whole of it — the
 * *words* of a prompt come from the definition at Stage 8, and `DEFINE PROMPT`
 * is #131's open question.
 *
 *   `chooser`      the player the random method picked (6-2-1-4)
 *   `turnPlayer`   whoever is taking the turn (7-1)
 *   `eachInOrder`  both players, beginning with the one who goes first
 *   `nobody`       a statement rather than a question: the game is over
 */
const PROMPT_ASKS: Record<string, "chooser" | "turnPlayer" | "eachInOrder" | "nobody"> = {
  chooseFirst: "chooser",
  mulligan: "eachInOrder",
  charge: "turnPlayer",
  main: "turnPlayer",
  gameOver: "nobody",
};

/**
 * One step the interpreter still carries out itself, with the section it is and
 * the reason it is not a `DO` program yet.
 *
 * Read as a promise: each row is a step whose declaration is complete except
 * for its program, and Stage 5 replaces the row with that program rather than
 * adding a seventh.
 */
interface Work {
  /** The manual section, so the table reads like the file it shadows. */
  section: string;
  /** What the step's `DO` program would have to be able to say. */
  waits: string;
  run: (ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[]) => void;
}

const STEP_WORK: Record<string, Work> = {
  setupShuffle: {
    section: "6-2-1-7",
    waits: "shuffle(), whose target is a whole zone rather than a selection",
    run: (_ctx, _game, state) => {
      for (const p of PLAYERS) shuffleDeck(state, p);
    },
  },
  setupHand: {
    section: "6-2-1-9",
    waits: "draw(n: attr(game, hand)), and a way to say 'each player'",
    run: (ctx, game, state, ev) => {
      for (const p of PLAYERS) draw(ctx, game, state, ev, p, game.game?.hand ?? 0);
    },
  },
  setupLife: {
    section: "6-2-1-10",
    waits: "moveTo() with TOP n and a computed count, and 'each player'",
    run: (ctx, game, state, ev) => {
      // The cards are placed on the pile as they are taken, which is the order
      // damage later takes them back in — and the order the legacy engine
      // deals them, which is what makes both engines' life piles one pile.
      for (const p of PLAYERS) {
        const n = game.game?.life ?? 0;
        for (let i = 0; i < n; i++) {
          const id = state.sides[p].zones[SETUP_ZONES.deck][0];
          if (!id) break;
          moved(ctx, game, state, ev, id, SETUP_ZONES.life, { owner: p, position: "top" });
        }
      }
    },
  },
  setupEnergyMarker: {
    section: "6-2-1-11",
    waits: "energyMarker(n: 1, side: …) said of the player who goes second — `startMarkers:` is one number for both players, which is why game.rules leaves it out",
    run: (_ctx, _game, state, ev) => {
      const second = other(state.firstPlayer ?? "p1");
      state.sides[second].attrs.energyMarkers = Number(state.sides[second].attrs.energyMarkers ?? 0) + 1;
      log(ev, { type: "energyMarker", player: second, delta: 1 });
    },
  },
  setupStart: {
    section: "6-2-1-12",
    waits: "the turn itself as a declaration — see `endTurn` below",
    run: (_ctx, _game, state) => {
      state.turn = 1;
      state.turnPlayer = state.firstPlayer ?? "p1";
    },
  },
  chargeTurnEffects: {
    section: "7-2-2",
    waits: "the delayed effects themselves as declarations — `DEFINE DELAY turnStart` and its three siblings, which no grammar kind covers yet",
    run: (_ctx, _game, state) => {
      // 20-15: "at the start of the turn, …", written down on an earlier turn
      // and waiting for this one. The programs go on the queue rather than
      // running here, because one of them can stop and ask.
      state.programs.push(...dueDelays(state, "turnStart"));
    },
  },
  chargeContinuousEnd: {
    section: "7-2-4",
    waits: "an `until:` a duration expiry can be declared against, rather than the closed `DURATIONS` list the language carries",
    run: (_ctx, _game, state, ev) => {
      endTurnRelativeEffects(state, ev);
    },
  },
  mainPending: {
    section: "7-3-2",
    waits: "the same DELAY declaration `chargeTurnEffects` waits on",
    run: (_ctx, _game, state) => {
      state.programs.push(...dueDelays(state, "mainStart"));
    },
  },
  endPending: {
    section: "7-4-2",
    waits: "the same DELAY declaration `chargeTurnEffects` waits on",
    run: (_ctx, _game, state) => {
      state.programs.push(...dueDelays(state, "turnEnd"));
    },
  },
  endEffects: {
    section: "7-4-5",
    waits: "the same `until:` declaration `chargeContinuousEnd` waits on",
    run: (_ctx, _game, state, ev) => {
      // 7-4-5/6: "for the turn" effects end, and 20-15's last timing is the
      // one that happens as the turn closes over them.
      endEffectsOfDuration(state, ev, "turn");
      state.programs.push(...dueDelays(state, "turnCleanup"));
    },
  },
  chargeActivate: {
    section: "7-2-7",
    waits: "switchMode() over a selector naming every in-play area at once",
    run: (ctx, game, state, ev) => {
      for (const zone of Object.keys(state.sides[state.turnPlayer].zones)) {
        const declared = game.zones[zone];
        if (declared?.inPlay !== true) continue;
        const mode = arrivalMode(declared);
        if (mode === null) continue;
        for (const id of state.sides[state.turnPlayer].zones[zone]) {
          const card = state.cards[id];
          // 0-2-4-1: a card already in that mode does not switch, and an
          // event for a change that did not happen would be a beat the board
          // plays over nothing.
          if (card.mode === mode) continue;
          card.mode = mode;
          // 1-10-1: the switch is a moment (`modeSwitched`), and this one has no
          // `by:` — the Charge Phase stands cards up as a rule of the turn, not
          // as a skill, which is what keeps "rested by one of your skills" off it.
          const shown = mode === "active" || mode === "rest" ? ({ type: "mode", card: id, mode } as const) : null;
          emit(ctx, game, state, ev, { event: "modeSwitched", card: id, controller: state.turnPlayer, args: { mode } }, shown);
        }
      }
    },
  },
  chargeDraw: {
    section: "7-2-9",
    waits: "draw(n: 1) under a condition about the turn number, which no attribute names yet",
    run: (ctx, game, state, ev) => {
      // 7-2-9-1: the player who goes first skips the draw on their first turn.
      // `firstPlayerDraws: false` is the declaration that says so.
      const skips = state.turn === 1 && state.turnPlayer === state.firstPlayer && game.game?.firstPlayerDraws !== true;
      if (!skips) draw(ctx, game, state, ev, state.turnPlayer, 1);
    },
  },
  endTurn: {
    section: "7-4-7",
    waits: "the turn as something a program can end — the one step that is about the flow rather than about the board",
    run: (ctx, game, state, ev) => {
      // 20-15: anything still waiting for a moment of this turn missed it.
      expireDelayed(state);
      state.turn++;
      state.turnPlayer = other(state.turnPlayer);
      // The turn passing ends every frame of it: nothing declared after this
      // step belongs to the turn that has just ended.
      state.flow = [];
      enterPhase(ctx, game, state, ev, turnPhases(game)[0]);
    },
  },
};

/** The steps the interpreter carries out itself, for the check `createGame` makes against the declarations. */
export const WORKED_STEPS = Object.keys(STEP_WORK);

/** What each of those steps is waiting on, so the gap can be read without opening this file. */
export const stepWorkNote = (name: string): string | null => (STEP_WORK[name] ? `${name} (${STEP_WORK[name].section}): ${STEP_WORK[name].waits}` : null);

// ── the runner ──────────────────────────────────────────────────────────────

/** How many steps may run between two decisions before the flow is called broken. The legacy engine's own ceiling. */
const GUARD = 10_000;

/**
 * Advance the game until it needs an answer or has ended.
 *
 * Called from `createGame` once and from `apply` after every action, exactly as
 * the legacy `run` is. It returns when `state.prompt` has been set — which is
 * every path out, because a finished game sits in its over phase asking the
 * question nobody answers.
 */
export function run(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[]): void {
  let guard = 0;
  checkWins(ctx, game, state, ev);
  while (state.flow.length) {
    if (++guard > GUARD) throw new RulesetBroken(state.game, `${GUARD} steps ran without the game asking anything or ending, which is a phase that never leaves its own steps`);
    const top = state.flow[state.flow.length - 1];
    const phase = game.phases[top.phase];
    if (!phase) throw new RulesetBroken(state.game, `the flow is in a phase called ${JSON.stringify(top.phase)}, which nothing declares`);

    if (top.index >= phase.steps.length) {
      state.flow.pop();
      // 7-3: a phase running out of steps is the moment "at the end of your
      // Main Phase" names. No client draws a phase *ending* and the legacy
      // engine logs none, so it is a moment with no picture — which is exactly
      // what `emit`'s null second half is for.
      emit(ctx, game, state, ev, { event: "phaseEnd", controller: state.turnPlayer, args: { phase: top.phase } });
      const next = phaseAfter(game, top.phase);
      if (next) enterPhase(ctx, game, state, ev, next);
      // A frame popping back to an outer one is the battle sub-flow's shape
      // (Stage 6); nothing nests today, and the phase is restored here rather
      // than left reading the one that just finished.
      else if (state.flow.length) state.phase = state.flow[state.flow.length - 1].phase;
      continue;
    }

    const name = phase.steps[top.index];
    const step = game.steps[name];
    if (!step) throw new RulesetBroken(state.game, `${top.phase} names a step called ${JSON.stringify(name)}, which nothing declares`);

    if (top.asking === undefined) {
      top.asking = askers(state, step);
      const pended = state.pending.length;
      STEP_WORK[name]?.run(ctx, game, state, ev);
      checkWins(ctx, game, state, ev);
      // The work may have ended the game or passed the turn, either of which
      // replaces the flow this frame was on.
      if (state.flow[state.flow.length - 1] !== top) continue;
      // 7-4-4: a step that carries a `LIMIT` may send its phase round again,
      // and the declaration's number is the ceiling. Checked here, once, on the
      // step's own arrival — a repeat decided anywhere else would be a loop
      // whose bound is not the one the game declared.
      if (state.pending.length > pended && repeatAllowed(step, top)) {
        top.repeats++;
        top.index = 0;
        delete top.asking;
        announce(game, state, ev, top.phase);
        continue;
      }
    }

    // A program in progress runs before anything else looks at the board:
    // 9-6-3 resolves one skill completely before the next begins, and a
    // checkpoint reached in the middle of one would put a second skill in
    // front of the first. This is also what a suspended program resumes
    // through — the answer came back, the frame is at the front, and the next
    // pass through the loop steps it.
    if (state.programs.length) {
      if (stepProgram(ctx, game, state, ev) === "wait") return;
      continue;
    }

    // 4-2-2: a checkpoint, here and nowhere else. Between one step and the
    // next, and before any question is put — which is where the legacy
    // engine's own `{ op: "checkpoint" }` entries sit, because those are the
    // two places a player is about to be asked to act (9-6-6).
    if (checkpoint(ctx, game, state, ev)) continue;

    if (top.asking.length) {
      state.prompt = promptFor(state, step, top.asking[0]);
      return;
    }
    top.index++;
    delete top.asking;
  }
  // A flow that has run out with no prompt is a definition whose last phase
  // leads nowhere. Said rather than left as a game that answers nothing.
  throw new RulesetBroken(state.game, `the ${state.phase} phase ran out of steps and nothing follows it, so the game has no next moment`);
}

/** The phases of a turn, in the order `DEFINE GAME` declares them. */
export function turnPhases(game: GameDefinition): string[] {
  const phases = game.game?.phases ?? [];
  if (!phases.length) throw new RulesetBroken(game.id, "DEFINE GAME declares no phases, so there is no turn to run");
  return phases;
}

/** The phase that follows this one *within* a turn: the next of `phases:`, or the first of them after the setup phase. Null at the end of a turn, which `endTurn` is what passes. */
function phaseAfter(game: GameDefinition, phase: string): string | null {
  if (phase === game.game?.setupPhase) return turnPhases(game)[0];
  const phases = turnPhases(game);
  const at = phases.indexOf(phase);
  return at >= 0 && at + 1 < phases.length ? phases[at + 1] : null;
}

/**
 * Enter a phase: a frame for it, and the moment the game declares there is one.
 *
 * The *moment* fires whatever `announce:` says, because 7-1-1 is about the
 * phase happening and `announce:` is only about whether a client draws it: "at
 * the start of your Main Phase" is no less that phase's start for a board that
 * does not put a card on the screen for it.
 */
export function enterPhase(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], name: string): void {
  const declared = game.phases[name];
  if (!declared) throw new RulesetBroken(state.game, `nothing declares a phase called ${JSON.stringify(name)}`);
  state.phase = name;
  state.flow.push({ phase: name, index: 0, repeats: 0 });
  emit(ctx, game, state, ev, { event: "phaseStart", controller: state.turnPlayer, args: { phase: name } }, shownPhase(game, state, name));
}

/**
 * 7-1-1: a phase happens whether or not anything happens in it; `announce:` is
 * whether it is a moment of its own in the log.
 *
 * Called on its own only by the 7-4-4 repeat, which re-runs a phase's steps
 * without re-entering the phase: the legacy engine logs the End Phase again on
 * every pass and pends its "at the end of your turn" skills only on the first,
 * and a repeat that fired `phaseStart` again would be the second half of that
 * undone.
 */
function announce(game: GameDefinition, state: VmState, ev: GameEvent[], name: string): void {
  const shown = shownPhase(game, state, name);
  if (shown) log(ev, shown);
}

/** The picture a phase has in the log, or null for one the game asks not to announce or that the shared event union has no word for. */
function shownPhase(game: GameDefinition, state: VmState, name: string): GameEvent | null {
  if (game.phases[name]?.announce === false) return null;
  if (!isPhaseWord(name)) return null;
  return { type: "phase", phase: name, player: state.turnPlayer, turn: state.turn };
}

/**
 * 7-4-4, the bounded loop: may this step send its phase round again?
 *
 * The ceiling is the declaration's (`LIMIT n`), never a number in here, so a
 * mis-declared trigger cannot hang a game — and a game that declares no limit
 * declares no repeat. Exported because the bound is the point of the field:
 * `npm test` asserts it holds at the ceiling.
 */
export function repeatAllowed(step: StepDef, frame: VmFrame): boolean {
  return step.limit !== undefined && frame.repeats < step.limit;
}

/**
 * 4-2-2: the checkpoint. One pended [Auto] resolved, the turn player's first.
 *
 * Returns true when it took one off the queue, and the runner then looks again
 * — so a skill that pends another is behind it rather than lost, which is the
 * legacy engine's `{ op: "auto.resolve" }, { op: "checkpoint" }` pair said as a
 * loop instead of as two steps.
 *
 * The skill is not run here: its program goes to the front of `state.programs`
 * and the runner steps it on the next pass. That is what makes a skill that
 * stops to ask storable — the frame is the suspension, as it is on the legacy
 * engine — and what keeps 9-6-3 honest, since nothing else may happen between
 * a skill starting and finishing.
 *
 * Three reasons a pended skill resolves to nothing, each said out loud:
 * negated (9-1-5), a condition on its price that does not hold (9-4), and a
 * price this engine cannot charge yet (#147). The fourth — the compiler could
 * not read the text — is the referee's, and on this engine it is a note.
 */
function checkpoint(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[]): boolean {
  const next = nextPending(state);
  if (!next) return false;
  const named = state.cards[next.card]?.cardId ?? next.card;
  const showing = skillsShowing(ctx, state, next.card);
  const skill = showing.skills.find((sk) => sk.index === next.skillIndex);
  const program = showing.scripts.bySkill[next.skillIndex];
  const frame: ScriptFrame = {
    ops: program?.ops ?? [],
    ip: 0,
    vars: {},
    card: next.card,
    master: next.master,
    trigger: next.trigger as Trigger,
    subject: next.subject,
    skillIndex: next.skillIndex,
  };

  // 9-1-5: a card whose skills are negated has none, and one skill switched
  // off is off for the moment it answered to as well as for every other.
  const off = state.effects.some((e) => (e.kind === "negateSkills" && e.target === next.card) || (e.kind === "negateSkill" && e.target === next.card && e.value === next.skillIndex));
  if (off) {
    log(ev, { type: "note", text: `${named}'s skill is negated, so it does not resolve` });
    return true;
  }
  if (!program || program.unsupported.length) {
    log(ev, { type: "note", text: `${named} answers to ${next.trigger}, and no rule this engine can read says what happens` });
    return true;
  }
  // 9-4: a condition the record hoisted out of the price. It is asked now,
  // when the skill resolves, which is where the legacy engine asks it.
  if (program.price?.condition && !vmHost(ctx, game, state, ev).condHolds(frame, program.price.condition)) {
    log(ev, { type: "note", text: `${named} answers to ${next.trigger}, and its condition does not hold` });
    return true;
  }
  if (program.price?.ops?.length || program.price?.x) {
    log(ev, { type: "note", text: `${named} answers to ${next.trigger}, and charging a skill's price is #147's — so it does not resolve` });
    return true;
  }

  log(ev, { type: "skill", card: next.card, skill: next.skillIndex, master: next.master, text: skill?.effect ?? "", inBattle: false });
  state.programs.unshift(frame);
  return true;
}

/**
 * One step of the program at the front of the queue.
 *
 * `stepScript` is the legacy engine's interpreter, shared (#142 step 1): it
 * takes the frame off the queue, runs it until it finishes or asks, and puts
 * itself back through `host.resume` when it asks. So the frame is shifted off
 * here and never put back by this function.
 *
 * **A `NotYet` stops that one skill and no more.** An op this engine has no
 * half of — a KO, a play, a price — throws, and the throw is caught here, named
 * in the log, and the frame dropped. The alternative is letting it out of
 * `apply`, which would make every deck holding such a card unplayable and take
 * `arena-fuzz --engine rules` and the oracle with it, exactly while they are
 * the instruments this stage is measured by. What the skill did before it
 * stopped stands, which is the honest cost of that choice and is bounded by
 * `ENGINE_INFO.rules.available` still being false: no game a person plays can
 * reach it. #146 and #147 remove most of these, and the boundary becomes a
 * refusal when a game can be made on this engine.
 */
function stepProgram(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[]): "done" | "wait" {
  const frame = state.programs.shift();
  if (!frame) return "done";
  try {
    return stepScript(vmHost(ctx, game, state, ev), frame);
  } catch (err) {
    if (!(err instanceof NotYet)) throw err;
    log(ev, { type: "note", text: `${state.cards[frame.card]?.cardId ?? frame.card}: ${err.message}` });
    return "done";
  }
}

// ── prompts ─────────────────────────────────────────────────────────────────

/** The players a step's prompt is put to, in the order they are asked. Empty when the step asks nothing. */
function askers(state: VmState, step: StepDef): (PlayerId | null)[] {
  if (!step.prompt) return [];
  const asks = PROMPT_ASKS[step.prompt];
  if (!asks) throw new RulesetBroken(state.game, `step ${JSON.stringify(step.name)} asks ${JSON.stringify(step.prompt)}, which this interpreter has no asker for`);
  switch (asks) {
    case "chooser":
      return [state.chooser];
    case "turnPlayer":
      return [state.turnPlayer];
    case "eachInOrder": {
      const first = state.firstPlayer ?? state.turnPlayer;
      return [first, other(first)];
    }
    case "nobody":
      return [null];
  }
}

/**
 * The question, in the legacy engine's `Prompt` shape.
 *
 * One union for both engines is not a shortcut: a prompt is answered by an
 * `Action`, the `Engine` interface takes one union of those, and a second
 * spelling of the same question would make one client unable to answer both
 * engines. The *words* are `view.ts`'s, and Stage 8 is where they come from
 * `words.rules` instead.
 */
function promptFor(state: VmState, step: StepDef, player: PlayerId | null): Prompt {
  const kind = step.prompt ?? "";
  if (kind === "gameOver") return { kind: "gameOver" };
  if (player === null) throw new RulesetBroken(state.game, `step ${JSON.stringify(step.name)} asks ${JSON.stringify(kind)} of nobody`);
  switch (kind) {
    case "chooseFirst":
    case "mulligan":
    case "charge":
    case "main":
      return { kind, player };
    default:
      throw new RulesetBroken(state.game, `step ${JSON.stringify(step.name)} asks ${JSON.stringify(kind)}, which is not a question this interpreter knows how to put`);
  }
}

/** The answer to the question at the top of the flow has been given: stop asking this player. */
export function answered(state: VmState): void {
  const top = state.flow[state.flow.length - 1];
  if (top?.asking?.length) top.asking.shift();
}

/** Whose answer is being waited for, or null when the question is addressed to nobody. */
export function asked(state: VmState): PlayerId | null {
  const pr = state.prompt;
  return "player" in pr ? pr.player : null;
}

/** The refusal every `apply` begins with: the game is over, or it is not this player's decision. */
export function requirePrompt(state: VmState, action: Action, kinds: Prompt["kind"][]): void {
  if (state.prompt.kind === "gameOver") throw new IllegalAction("the game is over");
  const who = asked(state);
  if (who && who !== action.player) throw new IllegalAction(`it is ${who}'s decision, not ${action.player}'s`);
  if (!kinds.includes(state.prompt.kind)) throw new IllegalAction(`that is not what is being asked: the game is at the ${state.prompt.kind} prompt`);
}

// ── the board the steps move ────────────────────────────────────────────────

/** One player's deck, randomised with the game's seeded RNG (6-2-1-7). The only place the deck's order is decided, so a replay from the same seed shuffles the same way. */
export function shuffleDeck(state: VmState, p: PlayerId): void {
  const shuffled = shuffle(state.sides[p].zones[SETUP_ZONES.deck], state.rngState);
  state.sides[p].zones[SETUP_ZONES.deck] = shuffled.items;
  state.rngState = shuffled.state;
}

/** One card from the top of a player's deck into their hand, `n` times, with the two events the legacy engine emits for each. */
export function draw(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], p: PlayerId, n: number): number {
  let drawn = 0;
  for (let i = 0; i < n; i++) {
    const id = state.sides[p].zones[SETUP_ZONES.deck][0];
    if (!id) break;
    moved(ctx, game, state, ev, id, SETUP_ZONES.hand, { owner: p });
    // A draw is not a moment of its own: no declaration names one, and the card
    // arriving in the hand is the `moved` above. It is a *picture*, which is
    // why it is logged and not emitted.
    log(ev, { type: "draw", player: p, card: id });
    drawn++;
  }
  return drawn;
}

/** How a card came to move, for the pattern arguments that ask (`moved(asPlay: true)`, `moved(by: skill)`). */
export interface MoveCause {
  owner?: PlayerId;
  position?: "top" | "bottom";
  /**
   * 9-6-9-4: was this the card being **played**? The declarations turn on it —
   * `played` and `youPlayed` ask for `asPlay: true`, `placed` for `false` — so
   * every move states it rather than leaving it out to be read as either.
   * Playing a card is a `DEFINE ACTION` with a price (#145), so nothing says
   * `true` yet; the argument is here because the pattern asks for it.
   */
  asPlay?: boolean;
  /**
   * Was the card shown to both players as it moved? The charge places a card in
   * the Energy Area **face up** (7-2-11), and a board that did not say so would
   * fly a face-down card into a public pile. It is a fact about the *picture*
   * and not about the moment: no `DEFINE TRIGGER` asks for it, and the shared
   * `move` event has carried the flag since the engine that has been playing.
   */
  reveal?: boolean;
  /** What caused it — `"skill"` for 3-1-5's "removed by a skill". A move the game's own procedure makes has no cause, and a pattern naming one does not match it. */
  by?: string;
  /** 3-1-5: was the cause the other player's? Only meaningful beside `by`. */
  byOpponent?: boolean;
}

/**
 * `moveCard`, with the move logged and fired as a `moved` moment.
 *
 * A refusal is a bug in the definition, not a rule: every caller here is a step
 * of the game's own procedure. The moment fires even where the log has no
 * picture — a zone the shared `GameEvent` union has no `Area` word for is a
 * zone a board cannot animate, and still a place a card arrived in.
 */
export function moved(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], id: string, to: string, opts: MoveCause = {}): void {
  const from = fromZone(state, id);
  const result = moveCard(state, game, id, to, opts);
  if (!result.ok) throw new RulesetBroken(state.game, `a step of the game cannot move a card to the ${to}: ${result.refused}`);
  const shown: GameEvent | null =
    isAreaWord(to) && (from === null || isAreaWord(from))
      ? { type: "move", card: id, from: from ?? "removed", to, owner: result.move.owner, ...(opts.reveal === undefined ? {} : { reveal: opts.reveal }) }
      : null;
  emit(ctx, game, state, ev, movement(result.move.card, from, to, result.move.owner, opts), shown);
}

/** The `moved` moment, in the words `triggers.rules` asks about it in. */
function movement(id: string, from: string | null, to: string, owner: PlayerId, opts: MoveCause): Moment {
  const cause: Record<string, PatternValue> = opts.by !== undefined ? { by: opts.by, byOpponent: opts.byOpponent ?? false } : {};
  const where: Record<string, PatternValue> = from !== null ? { from } : {};
  return {
    event: "moved",
    card: id,
    // 3-1-6: the side whose copy of the zone it arrived in, which is what
    // "when **you** play a card" means by you. For a card leaving play it is
    // its owner, which `moveCard` has already clamped the destination to.
    controller: owner,
    args: { ...where, to, asPlay: opts.asPlay ?? false, ...cause },
  };
}

function fromZone(state: VmState, id: string): string | null {
  for (const p of PLAYERS) {
    for (const [zone, ids] of Object.entries(state.sides[p].zones)) if (ids.includes(id)) return zone;
  }
  return null;
}

// ── the game ending ─────────────────────────────────────────────────────────

/** A game comes to rest in its over phase, which is a phase like any other: it has a step, and that step asks the question nobody answers. */
export function endGame(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], winner: PlayerId | null, reason: string): void {
  const over = game.game?.overPhase;
  if (!over) throw new RulesetBroken(state.game, "DEFINE GAME names no overPhase, so a finished game has nowhere to come to rest");
  state.winner = winner;
  state.overReason = reason;
  state.flow = [];
  // 0-1-3: nothing answers to a game that has ended, so the queue goes with it
  // rather than being drained into an over phase by the checkpoint.
  state.pending = [];
  enterPhase(ctx, game, state, ev, over);
  log(ev, { type: "gameOver", winner, reason });
}

/**
 * Every `DEFINE WIN`, asked of both players (0-1-3).
 *
 * A player who meets a `result: lose` condition loses immediately (0-1-3-1);
 * both at once is the draw of 0-1-3-3, which no single declaration can state
 * because it is a fact about the other declarations rather than about the
 * board. The pre-game procedure is exempt for the reason the legacy engine
 * exempts it: the life piles are dealt at the end of it, so every player has
 * "no life" until they do.
 */
function checkWins(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[]): void {
  if (state.phase === game.game?.setupPhase || state.phase === game.game?.overPhase) return;
  const lost: { player: PlayerId; win: WinDef }[] = [];
  for (const p of PLAYERS) {
    for (const win of Object.values(game.wins)) {
      if (win.result !== "lose") continue;
      if (holds(game, state, win.if, p)) lost.push({ player: p, win });
    }
  }
  if (!lost.length) return;
  const losers = [...new Set(lost.map((l) => l.player))];
  if (losers.length === 2) return endGame(ctx, game, state, ev, null, "both players lost at once");
  const first = lost.find((l) => l.player === losers[0])!;
  endGame(ctx, game, state, ev, other(losers[0]), `${state.sides[losers[0]].name} lost: ${first.win.text ?? first.win.name}`);
}

/**
 * The one condition shape a win is written in: a bound on how many cards a
 * selector finds (§2.4 — every other condition in the language is this one with
 * the right selector around it).
 *
 * Anything richer is refused rather than guessed at, because a win condition
 * read as `false` is a game that never ends. #142 brings the whole condition
 * evaluator, shared with the card programs; this is the part a turn needs.
 */
function holds(game: GameDefinition, state: VmState, cond: Cond, me: PlayerId): boolean {
  if (cond.kind !== "count") throw new RulesetBroken(state.game, `a win condition is written as ${cond.kind}, and this interpreter reads only count() so far (#142)`);
  const n = countOf(game, state, cond.sel, me);
  if (cond.atLeast !== undefined && n < cond.atLeast) return false;
  if (cond.atMost !== undefined && n > cond.atMost) return false;
  return cond.atLeast !== undefined || cond.atMost !== undefined;
}

/** How many cards a selector finds. The fields a turn's own conditions use — a side and an area — and a refusal for the rest. */
function countOf(game: GameDefinition, state: VmState, sel: Selector, me: PlayerId): number {
  const rich = (["filter", "special", "fromVar", "areas", "mode", "hidden", "underHost", "count", "take"] as const).find((f) => sel[f] !== undefined);
  if (rich) throw new RulesetBroken(state.game, `a win condition selects by ${rich}, and this interpreter reads only a side and an area so far (#142)`);
  if (!sel.area) throw new RulesetBroken(state.game, "a win condition counts cards in no named area");
  if (!game.zones[sel.area]) throw new RulesetBroken(state.game, `a win condition counts cards in ${JSON.stringify(sel.area)}, which nothing declares`);
  let n = 0;
  for (const p of sidesOf(sel.side ?? "you", me)) n += state.sides[p].zones[sel.area]?.length ?? 0;
  return n;
}

const sidesOf = (side: Side, me: PlayerId): PlayerId[] => (side === "both" ? [...PLAYERS] : side === "opponent" ? [other(me)] : [me]);

// ── the words the shared event log is typed by ──────────────────────────────
//
// `GameEvent` is the currency both engines are read in, and its `phase` and
// `move` events are typed by the legacy engine's closed unions. A declared name
// that is not one of those words is a game this log cannot describe — so the
// event is left out rather than cast, and the board simply does not animate a
// zone it has never heard of. DBS declares none such, which is what makes the
// two engines' logs comparable at all.

const isPhaseWord = (name: string): name is Phase => (PHASES as readonly string[]).includes(name);
const isAreaWord = (name: string): name is Area => (AREAS as readonly string[]).includes(name) && name !== "under" && name !== "play";

// ── the pieces `index.ts` needs ─────────────────────────────────────────────

/** 6-2-1-4: the random method that picks who chooses. Spends the seed, so it happens once and in the same place on both engines. */
export function flipForChooser(state: VmState): PlayerId {
  const flip = nextRandom(state.rngState);
  state.rngState = flip.state;
  return flip.value < 0.5 ? "p1" : "p2";
}
