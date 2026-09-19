/**
 * What a game on the rules engine *is*.
 *
 * The saved-game layer treats a state as opaque JSON: it is written to
 * `arena_games.state` and handed back to the same engine, which is the whole
 * reason a second engine can exist beside the first without the row shape
 * changing. Two fields are not opaque, and they are here for one reason —
 * **a row must never be replayed on the wrong interpreter**. `engine` says
 * which one wrote it and `game` which game's definition it was written
 * against, so a legacy state handed to the rules engine (or the reverse) is
 * refused loudly rather than misread field by field.
 *
 * What #139 added is the board, and it is the shape the whole stage rests on:
 * a side is **a map of declared zones** (`Zones`, built from the `ZONE`
 * declarations) and a card is **a bag of declared attributes** (`Attrs`, built
 * from the `ATTRIBUTE` declarations) plus the few things about the copy on the
 * table that no card text can say. There is no `hand` field, no `power` field
 * and no `PlayerState` with an area per name: an interpreter that plays a
 * `GameDefinition` cannot know those names, and the moment it does, a second
 * game needs code rather than files.
 *
 * What #140 added is the **flow**: `flow` is a stack of frames, one per phase
 * in progress, and a frame is a phase name plus the index of the next step —
 * a data program counter, as the legacy engine's `state.flow` is a data step
 * list. Suspension is the frame and nothing else: a game waiting on a prompt
 * is a game whose top frame points at the step that asked, which is what makes
 * it storable mid-decision and reproducible from seed plus actions.
 *
 * What #141 added is the **pend list**: an [Auto] whose moment has happened and
 * whose program has not run yet (9-6-2). It is state rather than a local because
 * a checkpoint can be reached with a question still to put, so the queue has to
 * survive being written to `arena_games.state` like everything else. The event
 * *log* is not here and is not going to be: events are returned from each call
 * and the row keeps the action log, which is the reproducible source — a second
 * copy in the state would be a second thing to keep true.
 *
 * What #142 added is everything that **outlives the step that made it**:
 * `effects` (9-1-4), `delayed` (20-15) and the `programs` a question suspended
 * mid-resolution, plus the two fields a question's answer comes back on. The
 * programs are on the state and not in a closure for the same reason the flow
 * is: a game waiting on a choice inside a skill is written to
 * `arena_games.state` like any other, and has to resume exactly where it
 * stopped.
 *
 * Pure and client-safe: types and one guard, no database, no `fs`.
 */
import type { VmPending } from "./triggers";
import type { Game } from "../../catalog/games";
import type { ScriptFrame } from "../engine/script";
import type { BattleStep, ContinuousEffect, DelayedEffect, PlayerId, Prompt } from "../engine/types";
import type { AttrValue } from "./cards";
import type { VmCard, Zones } from "./zones";

/**
 * The battle in progress (8-1), or its absence.
 *
 * The legacy engine's own `Battle` shape, pared to what #150's flow actually
 * reads and writes: no `revenge`/`reactivate` (22-9/22-8, keyword bodies
 * Stage 7 has not built) and no Z-Energy bookkeeping (`zEnergyFromCombo` is
 * #151's). What is here is what `ScriptHost.battle()` hands a running program
 * (`redirectAttack`, `negateAttack`, §22-13's [Union-Absorb] guard swap) and
 * what the board's `BattleView` reads back (`vm/view.ts`).
 */
export interface VmBattle {
  attacker: string;
  guard: string;
  /** The card the attack was declared against, before any [Blocker] changed the guard (8-1-2-1). */
  target: string;
  step: BattleStep;
  /** 8-1-6-1: a `negateAttack` op was run against this battle — a program a declared op can already fire (`engine/script.ts`'s `case "negateAttack"`), wired here so the day a card reaches it, the battle honours it. */
  negated: boolean;
  /** 8-1-2-3: [Blocker] is offered once a battle. */
  blockerOffered: boolean;
  /**
   * The counter cards played into this battle, in play order — `docs/arena-battle-staging-spec.md`
   * §3.1's own field, the legacy `Battle.counters`' shape exactly, so the two
   * engines' `BattleView.counters` come off the same record.
   */
  counters: { card: string; by: PlayerId; after: number }[];
}

/**
 * Bumped when the shape changes in a way a stored state cannot be read
 * through. Nothing reads it yet — there are no stored states to migrate —
 * but a state that cannot say which shape it is written in is a state that
 * cannot be migrated later either.
 *
 * 2: #139's board (`sides`, `cards`, `rngState`, `phase`, the first-player
 * fields). A version-1 state was a skeleton with no board at all.
 * 3: #140's flow (`flow`, `prompt`, `turn`, `turnPlayer`, `winner`,
 * `overReason`). A version-2 state was a board nothing played on.
 * 4: #141's pend list (`pending`). A version-3 state is a game in which no
 * moment could reach a card.
 * 5: #142's effects, delayed effects, suspended programs and the two answer
 * fields. A version-4 state is a game no skill had resolved in.
 * 6: #147's per-copy record of the skill lines used this turn
 * (`VmCard.usedThisTurn`, `usedMarkerSkill`). A version-5 state is a game in
 * which a [Once per turn] skill had no way to have been used.
 * 7: #269's declared player attributes with a turn-start reset
 * (`charged`, `grewUnison`) start carrying a real value in `VmSide.attrs`
 * rather than reading as `undefined` everywhere. A version-6 state is a game
 * in which nobody had yet had a charge or grown a Unison this turn either way.
 * 8: #150's battle (`battle`, `VmBattle`). A version-7 state is a game in
 * which no attack had ever been declared, so the field is simply absent —
 * `battle` is optional on load and defaults to null, the same convention
 * `firstPlayer` uses for "not decided yet".
 * 9: #152's `VmCard.battledThisTurn` (8-1-2-1/8-1-2-2), the legacy engine's
 * own per-copy memory of a battle already played this turn, ported rather
 * than left `NARROWER`. A version-8 state read `battled` as always false —
 * harmless, since no saved rules-engine game predates this field.
 */
export const VM_STATE_VERSION = 9;

/** One player, as the definition describes one: a name, a map of zones, and the attributes a *player* has (1-14). */
export interface VmSide {
  id: PlayerId;
  name: string;
  /** One list per zone the game declares as a place, in declaration order. */
  zones: Zones;
  /** The declared `of: player` attributes — `energyMarkers` in DBS. */
  attrs: Record<string, AttrValue>;
}

/**
 * One phase in progress: which phase, and which of its steps comes next.
 *
 * The stack of these *is* the runner's memory (`vm/flow.ts`). Nothing is held
 * in a closure and nothing is recomputed from the board, so a game that is
 * written to `arena_games.state` in the middle of a decision resumes exactly
 * where it stopped — the guarantee the legacy engine's `state.flow` gives and
 * the one thing a second engine may not quietly drop.
 */
export interface VmFrame {
  /** The phase whose steps this frame is running. */
  phase: string;
  /** The index in that phase's `steps:` of the step to run next. */
  index: number;
  /** How many times a bounded step has sent this phase round again (7-4-4, `LIMIT`). */
  repeats: number;
  /**
   * The players the step at `index` still has to ask, in the order they are
   * asked; `null` for a question addressed to nobody (the game is over).
   * Absent until the step has been arrived at, which is how the runner tells
   * "not started" from "started and answered by everyone".
   */
  asking?: (PlayerId | null)[];
}

export interface VmState {
  /** Which interpreter wrote this. The one field `legacyState` reads. */
  engine: "rules";
  /** The game definition this state was dealt from (`rulesets/<game>/`). */
  game: Game;
  /** The seed the game was created from, so a replay starts where it did. */
  seed: number;
  /** `VM_STATE_VERSION` as at the moment the game was created. */
  version: number;
  /** The seeded RNG's state, advanced by every shuffle and every flip (`engine/rng.ts`). */
  rngState: number;
  /** The declared phase the game is in — `"setup"` for a game that has only been dealt. */
  phase: string;
  /**
   * 6-2-1-4: the player a random method chose, who then chooses who goes
   * first. Kept because it is the one thing the coin flip decided, and the
   * choice it leads to has not been made yet.
   */
  chooser: PlayerId;
  /**
   * Who goes first (6-2-1-5) — a *choice*, so null until there is a prompt to
   * make it with (#140). Nothing in the deal depends on it: it decides who is
   * asked about a mulligan first, who places the starting energy marker
   * (6-2-1-11) and who takes the first turn, and none of those moves a shuffle
   * or a draw.
   */
  firstPlayer: PlayerId | null;
  sides: Record<PlayerId, VmSide>;
  /** Every card in the game by instance id (`p1#17`). The zones hold these ids. */
  cards: Record<string, VmCard>;
  /**
   * Which turn it is (7-1). 0 while the pre-game procedure runs, 1 on the
   * first player's first turn, and one more each time the turn passes.
   */
  turn: number;
  /** Whose turn it is (7-1). Meaningless until `turn` is 1; `p1` until then, as the legacy engine has it. */
  turnPlayer: PlayerId;
  /** The phases in progress, innermost last. Empty only between a game ending and its over phase being entered. */
  flow: VmFrame[];
  /**
   * The [Auto] skills whose moment has happened and whose program has not run
   * (9-6-2), in the order they were pended. The *resolution* order is 9-6-6's
   * and is `nextPending`'s, so this is a set with a tie-break rather than a
   * queue — which is why a skill is taken off it by master and not by position.
   */
  pending: VmPending[];
  /**
   * 9-1-4: every continuous effect in force, oldest first (9-9-2). The legacy
   * engine's own `ContinuousEffect`, because `src/lib/arena/effects.ts` turns
   * one into the label the board shows and there is only one of those.
   */
  effects: ContinuousEffect[];
  /** 20-15: the programs written down for a later moment, with the moment each waits on. */
  delayed: DelayedEffect[];
  /**
   * The id the next effect or delayed effect gets. One counter for both, so an
   * id is unique across everything in force and an `effectEnded` beat can never
   * be matched to the wrong `effect`.
   */
  nextEffect: number;
  /**
   * The skill programs in progress, innermost first (9-6-3).
   *
   * The runner takes the first off and steps it; a program that stops to ask
   * puts itself back, which is exactly what the legacy engine's
   * `flow.unshift({ op: "script.step", frame })` does. Empty is the common
   * case: a program that runs to the end never appears here at all.
   */
  programs: ScriptFrame[];
  /** The cards a `chooseCards` answer brought back, until the program that asked reads them. Null the rest of the time. */
  lastChoice: string[] | null;
  /** The option index a `chooseMode` answer brought back, read the same way. */
  lastMode: number | null;
  /**
   * The question the game is waiting on — the legacy engine's own `Prompt`
   * shape, on purpose: a prompt is answered by an `Action`, and the `Engine`
   * interface takes one union of those. A second spelling of the same
   * question would make the two engines unanswerable by one client.
   */
  prompt: Prompt;
  /** Who won, once a `DEFINE WIN` has been met or someone conceded. Null for a draw as well as for a game still being played. */
  winner: PlayerId | null;
  /** Why it ended, in words, or null while it has not. */
  overReason: string | null;
  /** 8-1: the battle in progress, or null between battles — #150's field, absent on a state saved before it existed. */
  battle?: VmBattle | null;
}

/**
 * Is this the rules engine's state?
 *
 * Read off `engine`, never off a field the legacy `GameState` happens to
 * lack: the legacy state has no `engine` field at all, so this is a positive
 * answer about one shape rather than a guess about the other.
 */
export function isVmState(value: unknown): value is VmState {
  return typeof value === "object" && value !== null && (value as { engine?: unknown }).engine === "rules";
}
