/**
 * What a program needs from a game, and nothing else.
 *
 * `stepScript` (`./script.ts`) runs the same `Op` tree both engines read off
 * the same `card_rules` row. If it reached into a `GameState` field by field
 * it could only ever run on the engine that has those fields, and a record
 * would then mean one thing on `legacy` and another on `rules` — which is the
 * one thing the two-engine plan may not allow (plan Stage 4, #142).
 *
 * So the interpreter is handed a **host**: every read and every change it
 * makes to the game, named. `legacyHost` below is the implementation over the
 * legacy `GameState`, a thin wrapper and nothing more — each method is the
 * call the interpreter used to make inline, so the extraction moved no
 * behaviour. `vm/state.ts` implements the same interface over `VmState`, and
 * the two engines then diverge only where the game does.
 *
 * Three rules kept this interface honest while it was being pulled out:
 *
 *  - **The vocabulary is the shared one.** `Area`, `PlayerId`, `Prompt`,
 *    `GameEvent`, `ContinuousEffect`, `DelayedEffect` and `Trigger` all live in
 *    `./types.ts` and are already what the contract carries, so a host method
 *    never has to translate a word for its own engine's spelling. The rules
 *    engine's zone names *are* these names, because `dbs/zones.rules` declares
 *    them (`vm/zones.ts`).
 *  - **A method is an operation, not a field.** `changeMarkers` clamps at zero
 *    and logs, because that is what the op did inline; a `markers` setter would
 *    have left the clamping and the event for two engines to get right
 *    separately.
 *  - **Nothing here knows the interpreter.** The host never reads a `ScriptFrame`
 *    except to hand it back to its own flow (`resume`, `interrupt`, `playThen`),
 *    which is the only part of running a program that is the engine's own.
 *
 * Pure: no database, no network, no `fs`.
 */
import {
  addEffect,
  addSkip,
  amount,
  areaOf,
  cardNow,
  cardsInPlay,
  condHolds,
  def,
  draw,
  face,
  forbids,
  has,
  move,
  note,
  placeUnder,
  replacementChoicesFor,
  resolveRef,
  resolveSelector,
  schedule,
  setMode,
  skillsOfInstance,
  tokenCardId,
  type GameContext,
  type MoveOptions,
} from "./state";
import { koCard, masterOf, pendTriggers } from "./triggers";
import type { Amount, Cond, Op, Ref, ScriptFrame, Selector } from "./script";
import type {
  Area,
  CardDef,
  Color,
  ContinuousEffect,
  DelayedEffect,
  FlowStep,
  ForbiddenAction,
  GameEvent,
  GameState,
  KeywordSkill,
  Mode,
  MoveActor,
  MoveReason,
  PlayerId,
  Prompt,
  ReplacementChoice,
  SkipWhat,
  Trigger,
} from "./types";

/** A continuous effect as a program asks for one: the bookkeeping fields are the host's to fill (9-1-4). */
export type EffectSpec = Omit<ContinuousEffect, "id" | "createdTurn" | "ownerTurn" | "master"> & { master?: PlayerId };

/** A delayed effect as a program asks for one (20-15). Same bargain as `EffectSpec`. */
export type DelaySpec = Omit<DelayedEffect, "id" | "createdTurn">;

/** The battle a program can see and change: who is fighting, and whether the attack still stands (8-1). */
export interface BattleView {
  attacker: string;
  guard: string;
  negated?: boolean;
}

/** Who is moving the card, for the replacement lookup (9-10) — the `by`/`bySide` narrowings 19 cards print. */
export interface ReplacementLookup {
  actor?: MoveActor;
  inSubstitute?: boolean;
}

/**
 * Everything `stepScript` may do to a game.
 *
 * Grouped the way the interpreter uses them: what it can find out, what it can
 * change, the questions it can put, and the three flow operations that are the
 * engine's own. A method that reads returns a copy or a value — never a
 * mutable handle into the state — with the one exception named on `battle`.
 */
export interface ScriptHost {
  // ── what the program can find out ────────────────────────────────────────

  /** Is there a card with this instance id at all? A selector can name one that has since gone. */
  exists(id: string): boolean;
  /** Whose card it is (3-1-6), which is not necessarily who controls it. */
  ownerOf(id: string): PlayerId;
  /** Who controls it now (20-9). */
  masterOf(id: string): PlayerId;
  /** Which area it stands in, or null for a card that is nowhere (under another card, or gone). */
  areaOf(id: string): Area | null;
  /** Active or Rest (1-10), or null where the area has no modes. */
  modeOf(id: string): Mode | null;
  /** Markers on the card (1-11). */
  markersOf(id: string): number;
  /** 3-9-2-1: face up in a closed area. */
  isFaceUp(id: string): boolean;
  /** 1-10-2: Hidden Mode. */
  isHidden(id: string): boolean;
  /** 1-9: turned to its back side. */
  isFlipped(id: string): boolean;
  /** Does the card have a back side to turn to at all? */
  hasBack(id: string): boolean;
  /** The catalog id (`BT18-020`) of the copy on the table. */
  catalogIdOf(id: string): string;
  /** The turn it arrived in play (5-5-4). */
  enteredTurnOf(id: string): number;
  /** What to call it in the log — the face showing, so a flipped Leader reads as its awakened name. */
  nameOf(id: string): string;
  /** The card as it is right now, effects and all: what a program reads a printed value off. */
  defOf(id: string): CardDef;
  /** 22: does it have this keyword skill, printed or granted? */
  hasKeyword(id: string, name: KeywordSkill["name"]): boolean;
  /** Which of its skills are switched off: `"all"`, or the indexes (9-1-5). */
  negatedSkills(id: string): "all" | number[];
  /** Every card this player has in play (9-1-3-1) — who watches a moment. */
  cardsInPlay(p: PlayerId): string[];
  /** One area of one player, in its own order. A copy: changing it changes nothing. */
  zone(p: PlayerId, area: Area): string[];
  /** What to call the player in the log. */
  playerName(p: PlayerId): string;
  /** Which turn it is (7-1). */
  turn(): number;
  /** 0-2-5: is this action forbidden right now? */
  forbids(what: ForbiddenAction, opts?: { player?: PlayerId; card?: string; bySkill?: boolean }): boolean;

  // ── the language's own readings ──────────────────────────────────────────

  /** The cards a selector names right now (5-2). */
  resolveSelector(frame: ScriptFrame, sel: Selector): string[];
  /** The cards a reference names: a bound variable, or a selector. */
  resolveRef(frame: ScriptFrame, ref: Ref): string[];
  /** A number the program asks for, which may count cards or read an attribute. */
  amount(frame: ScriptFrame, a: Amount): number;
  /** Does this condition hold (9-4)? */
  condHolds(frame: ScriptFrame, c: Cond): boolean;

  // ── what the program can change ──────────────────────────────────────────

  /** One line in the log, for what has no picture of its own. */
  note(text: string): void;
  /** One event, as the engines' shared log carries it. */
  log(event: GameEvent): void;
  /** 5-4: draw, and say how many really came. */
  draw(p: PlayerId, n: number): number;
  /** 3-1-4: move a card to an area, with everything that entails. Returns where it really ended. */
  move(id: string, to: Area, owner: PlayerId, opts?: MoveOptions): Area;
  /** 5-9: KO a card, by this source. */
  ko(id: string, by: string | undefined, opts?: Pick<MoveOptions, "replaced">): void;
  /** 23-2: put a card under another. */
  placeUnder(id: string, host: string): boolean;
  /** 1-10: switch a card's mode. Returns whether it moved. */
  setMode(id: string, mode: Mode): boolean;
  /** 3-9-2-1: turn a card face up or face down where it stands. */
  setFaceUp(id: string, faceUp: boolean): void;
  /** 23-5: switch a Battle Card between Hidden and Revealed Mode. */
  setHidden(id: string, hidden: boolean): void;
  /** 1-9: turn a Leader to its back side, and log it. */
  flip(id: string): void;
  /** 1-11: add or remove markers, never below zero, and log the new total. Returns that total. */
  changeMarkers(id: string, delta: number): number;
  /** 6-2-1-11: change a player's energy markers, never below zero, and log the change asked for. */
  changeEnergyMarkers(p: PlayerId, delta: number): void;
  /** 21-3: record damage taken, for the cards that count it. */
  addDamageTaken(p: PlayerId, n: number): void;
  /** 5-11: shuffle these players' decks with the game's own RNG, so a replay reproduces the order. */
  shuffleDecks(players: PlayerId[]): void;
  /** 20-9-2: the turn a card entered play, kept across a change of control. */
  setEnteredTurn(id: string, turn: number): void;
  /** 9-1-5: switch every skill of a card off for the rest of the game. */
  negateAll(id: string): void;
  /** 9-1-5: switch one skill of a card off for the rest of the game. */
  negateSkillIndex(id: string, index: number): void;
  /** 9-1-4: put a continuous effect in force. */
  addEffect(e: EffectSpec): void;
  /** 20-15: schedule a program for a later moment. */
  schedule(d: DelaySpec): void;
  /** 20-13: skip a step, this time round or the next. */
  addSkip(p: PlayerId, what: SkipWhat, when: "this" | "next"): void;
  /** 19-1: make a token in this player's Battle Area, and log it. Returns its instance id. */
  createToken(p: PlayerId, name: string, power: number, comboCost: number | null, comboPower: number | null, colors: Color[]): string;

  // ── moments ──────────────────────────────────────────────────────────────

  /** How many [Auto]s are waiting (9-6-2) — the mark a `dropPendsOfOtherColours` measures from. */
  pendingCount(): number;
  /** 9-6: this moment happened to this card; whatever answers to it waits for the next checkpoint. */
  pend(trigger: Trigger, card: string, subject?: string): void;
  /**
   * "Flipped face up **by one of your red card skills**": the trigger text is
   * read without state, so the colour is checked where the source is known and
   * the entries pended since `before` that name a colour it has not got are
   * dropped again.
   */
  dropPendsOfOtherColours(before: number, source: string | undefined): void;

  // ── replacements and the play being resolved (9-10, 9-6) ─────────────────

  /** The replacements standing in front of this card's departure, most-specific order. */
  replacementsFor(id: string, reason: MoveReason | undefined, opts?: ReplacementLookup): ReplacementChoice[];
  /** The card whose play is being resolved, for a [Counter: Play] (9-6). */
  resolvingCard(): string | null;
  /** 5-5: the card being played arrives in Rest Mode. */
  setPlayRest(card: string): void;
  /** 5-5: the card being played arrives with its skills negated. */
  setPlayNegated(card: string): void;
  /** 9-6: the play being resolved happens differently — this program in its place. */
  replaceResolvingPlay(ops: Op[]): void;

  // ── the battle (8-1) ─────────────────────────────────────────────────────

  /** The battle in progress, or null. Read-only: change it with the two calls below. */
  battle(): BattleView | null;
  /** 8-1: the attack is redirected at this card, by that source. */
  setGuard(guard: string, by: string): void;
  /** 8-6: the attack does not happen. */
  negateAttack(): void;
  /**
   * The [Counter] this window was opened over is negated (9-8). Returns the
   * card that was countered, or null when there is none — the one flow shape
   * a program can reach into, and it reaches no further than this.
   */
  negateCounterInFlight(): string | null;

  // ── the questions, and the flow that carries them ────────────────────────

  /** Put the question. The caller then returns "wait". */
  ask(prompt: Prompt): void;
  /** The index a `chooseMode`-shaped answer came back with, or null when none is waiting. */
  lastMode(): number | null;
  /** Take that answer off the state, so the next step does not read it again. */
  clearLastMode(): void;
  /** The cards a `chooseCards` answer came back with, or null when none is waiting. */
  lastChoice(): string[] | null;
  /** Take that answer off the state. */
  clearLastChoice(): void;
  /** 4-3-3: leave this program's names where the next one can start from them. */
  saveVars(key: string, vars: Record<string, string[]>): void;
  /** 20-5: and the X it paid, beside them. */
  saveX(key: string, x: number): void;

  /** Continue this program after the answer comes back. */
  resume(frame: ScriptFrame): void;
  /** Run `first` now and come back to `frame` — a replacement's substitute, which may itself ask (9-10-1-1). */
  interrupt(first: ScriptFrame, frame: ScriptFrame): void;
  /** 5-5-3: play these cards, then come back to `frame`. */
  playThen(cards: string[], opts: { player: PlayerId; mode?: Mode; onto?: string; negated?: "turn" | "game" }, frame: ScriptFrame): void;
}

/**
 * The legacy engine as a host.
 *
 * Every method is the call `stepScript` made inline before the extraction, in
 * the same order with the same arguments, which is the whole of why the
 * refactor moved nothing. A method that looks longer than one line is one the
 * interpreter wrote out inline — `changeMarkers`, `createToken` — and the body
 * is that code, unchanged.
 */
export function legacyHost(ctx: GameContext, s: GameState, ev: GameEvent[]): ScriptHost {
  const inst = (id: string) => s.cards[id];
  return {
    exists: (id) => !!s.cards[id],
    ownerOf: (id) => inst(id).owner,
    masterOf: (id) => masterOf(s, id),
    areaOf: (id) => areaOf(s, id),
    modeOf: (id) => inst(id).mode,
    markersOf: (id) => inst(id).markers,
    isFaceUp: (id) => !!inst(id).faceUp,
    isHidden: (id) => inst(id).hidden,
    isFlipped: (id) => inst(id).flipped,
    hasBack: (id) => !!ctx.defs[inst(id).cardId]?.back,
    catalogIdOf: (id) => inst(id).cardId,
    enteredTurnOf: (id) => inst(id).enteredTurn,
    nameOf: (id) => face(ctx, s, id).name,
    defOf: (id) => def(ctx, s, id),
    hasKeyword: (id, name) => has(ctx, s, id, name),
    negatedSkills: (id) => inst(id).negated,
    cardsInPlay: (p) => cardsInPlay(s, p),
    // The legacy board keeps the two single-card areas as a bare string
    // (3-5-1, 3-11-4), so they are read as the one-or-no-card list every other
    // area already is — the shape the rules engine's zones have for all fifteen.
    zone: (p, area) => {
      const held = s.players[p][area];
      if (typeof held === "string") return [held];
      return held === null ? [] : held.slice();
    },
    playerName: (p) => s.players[p].name,
    turn: () => s.turn,
    forbids: (what, opts) => forbids(ctx, s, what, opts ?? {}),

    resolveSelector: (frame, sel) => resolveSelector(ctx, s, frame, sel),
    resolveRef: (frame, ref) => resolveRef(ctx, s, frame, ref),
    amount: (frame, a) => amount(ctx, s, frame, a),
    condHolds: (frame, c) => condHolds(ctx, s, frame, c),

    note: (text) => note(ev, text),
    log: (event) => {
      ev.push(event);
    },
    draw: (p, n) => draw(ctx, s, ev, p, n),
    move: (id, to, owner, opts) => move(ctx, s, ev, id, to, owner, opts ?? {}),
    ko: (id, by, opts) => koCard(ctx, s, ev, id, by, opts ?? {}),
    placeUnder: (id, host) => placeUnder(ctx, s, ev, id, host),
    setMode: (id, mode) => setMode(s, ev, id, mode, ctx),
    setFaceUp: (id, faceUp) => {
      inst(id).faceUp = faceUp;
    },
    setHidden: (id, hidden) => {
      inst(id).hidden = hidden;
    },
    flip: (id) => {
      inst(id).flipped = true;
      ev.push({ type: "flip", card: id, flipped: true });
    },
    changeMarkers: (id, delta) => {
      const card = inst(id);
      card.markers = Math.max(0, card.markers + delta);
      ev.push({ type: "markers", card: id, delta, total: card.markers });
      return card.markers;
    },
    changeEnergyMarkers: (p, delta) => {
      s.players[p].energyMarkers = Math.max(0, s.players[p].energyMarkers + delta);
      ev.push({ type: "energyMarker", player: p, delta });
    },
    addDamageTaken: (p, n) => {
      s.players[p].damageTaken += n;
    },
    shuffleDecks: (players) => shuffleDecks(s, players),
    setEnteredTurn: (id, turn) => {
      inst(id).enteredTurn = turn;
    },
    negateAll: (id) => {
      inst(id).negated = "all";
    },
    negateSkillIndex: (id, index) => {
      const card = inst(id);
      if (card.negated !== "all") card.negated.push(index);
    },
    addEffect: (e) => {
      addEffect(s, ev, e);
    },
    schedule: (d) => {
      schedule(s, ev, d);
    },
    addSkip: (p, what, when) => addSkip(s, p, what, when),
    createToken: (p, name, power, comboCost, comboPower, colors) => {
      const id = `${p}#token${Object.keys(s.cards).length}`;
      s.cards[id] = {
        id,
        cardId: tokenCardId(name, power, comboCost, comboPower, colors),
        owner: p,
        mode: "active",
        hidden: false,
        flipped: false,
        markers: 0,
        under: [],
        isToken: true,
        enteredTurn: s.turn,
        extraAttacks: 0,
        usedThisTurn: [],
        usedMarkerSkill: false,
        battledThisTurn: false,
        negated: [],
      };
      s.players[p].battle.push(id);
      ev.push({ type: "token", card: id, owner: p });
      return id;
    },

    pendingCount: () => s.pending.length,
    pend: (trigger, card, subject) => pendTriggers(ctx, s, trigger, card, subject),
    dropPendsOfOtherColours: (before, source) => {
      const colors = source && s.cards[source] ? cardNow(ctx, s, source).colors : [];
      s.pending = s.pending.filter((e, i) => {
        if (i < before) return true;
        const sk = skillsOfInstance(ctx, s, e.card).find((x) => x.index === e.skillIndex);
        const m = /flipped face up by (?:one of )?your (red|blue|green|yellow|black|white) card skills?/i.exec(sk ? sk.cost + " " + sk.effect : "");
        if (!m) return true;
        const want = (m[1][0].toUpperCase() + m[1].slice(1)) as Color;
        return colors.includes(want);
      });
    },

    replacementsFor: (id, reason, opts) => replacementChoicesFor(ctx, s, id, reason, opts ?? {}),
    resolvingCard: () => s.resolving?.card ?? null,
    setPlayRest: (card) => {
      s.continuations.playRest = card;
    },
    setPlayNegated: (card) => {
      s.continuations.playNegated = card;
    },
    replaceResolvingPlay: (ops) => replaceResolvingPlay(ctx, s, ev, ops),

    battle: () => s.battle ?? null,
    setGuard: (guard, by) => {
      if (!s.battle) return;
      s.battle.guard = guard;
      ev.push({ type: "guardChanged", guard, by });
    },
    negateAttack: () => {
      if (!s.battle) return;
      s.battle.negated = true;
      ev.push({ type: "attackNegated" });
    },
    negateCounterInFlight: () => {
      const target = s.flow.find((f) => f.op === "counter.resolve");
      if (!target || target.op !== "counter.resolve") return null;
      target.negated = true;
      return target.card;
    },

    ask: (prompt) => {
      s.prompt = prompt;
    },
    lastMode: () => s.lastMode,
    clearLastMode: () => {
      s.lastMode = null;
    },
    lastChoice: () => s.lastChoice,
    clearLastChoice: () => {
      s.lastChoice = null;
    },
    saveVars: (key, vars) => {
      s.continuations[key] = vars;
    },
    saveX: (key, x) => {
      s.continuations[key] = x;
    },

    resume: (frame) => {
      s.flow.unshift({ op: "script.step", frame });
    },
    interrupt: (first, frame) => {
      s.flow.unshift({ op: "script.step", frame });
      s.flow.unshift({ op: "script.step", frame: first });
    },
    playThen: (cards, opts, frame) => {
      const steps: FlowStep[] = cards.map((card) => ({ op: "play.resolve" as const, card, player: opts.player, mode: opts.mode, onto: opts.onto, negated: opts.negated }));
      steps.push({ op: "script.step", frame });
      s.flow.unshift(...steps);
    },
  };
}

/**
 * 9-6: the play being resolved happens differently — the one moment a
 * `replace` op resolves rather than standing. The program that takes its place
 * is a single move of the card being played: the play is negated, the step
 * that would have put the card into play is dropped from the flow, and the
 * card goes where the program says from wherever it was being played from. The
 * energy stays paid — negating a play does not undo the cost.
 *
 * Anything else in the `with` block is a shape this engine cannot put in a
 * play's place, and doing half of it is worse than none, so it does nothing.
 */
function replaceResolvingPlay(ctx: GameContext, s: GameState, ev: GameEvent[], ops: Op[]): void {
  const card = s.resolving?.card;
  if (!card) return;
  const only = ops.length === 1 ? ops[0] : null;
  if (!only || only.op !== "moveTo") return;
  s.flow = s.flow.filter((f) => !(f.op === "play.resolve" && f.card === card));
  const owner = s.cards[card].owner;
  note(ev, `${face(ctx, s, card).name} is not played`);
  // "Under" is not an area a card can simply be put in (23-2), and no card
  // says so here; the Drop is the printed default.
  const dest: Area = only.to === "play" ? "battle" : only.to === "under" ? "drop" : only.to;
  move(ctx, s, ev, card, dest, owner, { reason: "effect", position: only.position, reveal: true });
  s.resolving = null;
}

function shuffleDecks(s: GameState, players: PlayerId[]): void {
  // Uses the game's RNG so a replay reproduces the order exactly.
  for (const p of players) {
    const deck = s.players[p].deck;
    let state = s.rngState;
    for (let i = deck.length - 1; i > 0; i--) {
      const t = (state + 0x6d2b79f5) | 0;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      state = t;
      const j = Math.floor((((r ^ (r >>> 14)) >>> 0) / 4294967296) * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    s.rngState = state;
  }
}
