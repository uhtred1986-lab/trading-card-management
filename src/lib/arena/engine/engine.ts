/**
 * The rules engine. `createGame` builds a state, `apply` takes one player
 * action and runs the game forward until the next decision is needed,
 * `legalActions` lists what the asked player may do. Section numbers refer
 * to the Rule Manual v4.00.
 *
 * The flow is a list of data steps (`state.flow`) executed by `run()`; a step
 * that needs a decision sets `state.prompt` and stops. That makes every
 * state storable mid-prompt and replayable from the action log.
 */
import { baseType, canCombo, isZ, keywordOf, skillsOf, specifiedCostOf } from "./cards";
import { compileCard, parseConditionClause, type CardScripts } from "./compile";
import { matches, parseCondition, parseFilter } from "./filters";
import { stepScript, validateProgram, type Op, type ScriptFrame } from "./script";
import { koCard, pendTriggers } from "./triggers";
import { nextRandom, shuffle } from "./rng";
import {
  activeEnergy,
  addEffect,
  altCostFor,
  areaOf,
  cardNow,
  cardsInPlay,
  comboCostOf,
  comboPowerOf,
  def,
  draw,
  endEffects,
  expireDelayed,
  face,
  forbids,
  fireDelayed,
  has,
  describePayment,
  inPlay,
  keyword,
  LIFE_AT_START,
  move,
  note,
  OPENING_HAND,
  pay,
  payAltCost,
  paymentOptions,
  payZEnergy,
  planPayment,
  playCost,
  powerOf,
  schedule,
  setMode,
  skillsOfInstance,
  type GameContext,
  condHolds,
  skillNegated,
} from "./state";
import type { Action, Applied, CardDef, CardInstance, Color, FlowStep, GameEvent, GameState, PendingAuto, PlayerId, PlayerState, Prompt, Skill, Trigger } from "./types";
import { other, PLAYERS } from "./types";

export interface EngineContext extends GameContext {
  /** Compiled effect programs, by catalog card id. Built once by `scriptsFor()`. */
  scripts?: Record<string, CardScripts>;
  /**
   * When set, a skill whose text did not compile stops the game and asks the
   * referee (Claude) for a program in the effect language. Without it — tests,
   * fuzzing, a hot-seat game with no API key — such a skill is logged and skipped.
   */
  referee?: boolean;
}

// ── setup ──────────────────────────────────────────────────────────────────

export interface DeckInput {
  name: string;
  leader: string;
  main: string[];
  z?: string[];
}

export interface GameOptions {
  seed: number;
  p1: DeckInput;
  p2: DeckInput;
}

function emptyPlayer(id: PlayerId, name: string): PlayerState {
  return { id, name, deck: [], hand: [], drop: [], warp: [], life: [], leader: "", battle: [], combo: [], energy: [], unison: null, zDeck: [], zEnergy: [], removed: [], energyMarkers: 0, mulliganed: false, overRealmsThisTurn: 0, zAwakenedThisTurn: false, grewUnisonThisTurn: false, damageTaken: 0 };
}

function instance(id: string, cardId: string, owner: PlayerId, isToken = false): CardInstance {
  return { id, cardId, owner, mode: "active", hidden: false, flipped: false, markers: 0, under: [], isToken, enteredTurn: 0, extraAttacks: 0, usedThisTurn: [], usedMarkerSkill: false, negated: [] };
}

export function createGame(ctx: EngineContext, opts: GameOptions): Applied {
  const s: GameState = {
    seed: opts.seed,
    rngState: opts.seed >>> 0,
    turn: 0,
    turnPlayer: "p1",
    firstPlayer: "p1",
    phase: "setup",
    battle: null,
    players: { p1: emptyPlayer("p1", opts.p1.name), p2: emptyPlayer("p2", opts.p2.name) },
    cards: {},
    effects: [],
    nextEffectId: 1,
    delayed: [],
    nextDelayedId: 1,
    pending: [],
    prompt: { kind: "gameOver" },
    counterStack: [],
    winner: null,
    overReason: null,
    resolving: null,
    continuations: {},
    flow: [],
    lastChoice: null,
    lastMode: null,
  };
  const ev: GameEvent[] = [];
  for (const p of PLAYERS) {
    const input = p === "p1" ? opts.p1 : opts.p2;
    let n = 0;
    const add = (cardId: string) => {
      if (!ctx.defs[cardId]) throw new Error(`unknown card ${cardId}`);
      const id = `${p}#${n++}`;
      s.cards[id] = instance(id, cardId, p);
      return id;
    };
    s.players[p].leader = add(input.leader);
    s.players[p].deck = input.main.map(add);
    s.players[p].zDeck = (input.z ?? []).map(add);
  }
  // 6-2-1-2/3: leaders are placed; "when placed in a Leader Area" triggers pend.
  for (const p of PLAYERS) pendTriggers(ctx, s, "leaderPlaced", s.players[p].leader);
  // 6-2-1-4: a random player chooses who goes first.
  const r = nextRandom(s.rngState);
  s.rngState = r.state;
  const chooser: PlayerId = r.value < 0.5 ? "p1" : "p2";
  ev.push({ type: "gameStart", first: chooser, seed: opts.seed });
  s.flow = [{ op: "prompt", prompt: { kind: "chooseFirst", player: chooser } }];
  run(ctx, s, ev);
  return { state: s, events: ev };
}

// ── the runner ─────────────────────────────────────────────────────────────

function run(ctx: EngineContext, s: GameState, ev: GameEvent[]): void {
  let guard = 0;
  while (s.flow.length && s.phase !== "over") {
    if (++guard > 10000) throw new Error("flow did not converge");
    const step = s.flow.shift()!;
    const r = exec(ctx, s, ev, step);
    if (r === "wait") return;
    if (lossJudgment(s, ev)) return;
  }
  if (s.phase === "over") s.prompt = { kind: "gameOver" };
}

function wait(s: GameState, prompt: Prompt): "wait" {
  s.prompt = prompt;
  return "wait";
}

function exec(ctx: EngineContext, s: GameState, ev: GameEvent[], step: FlowStep): "done" | "wait" {
  switch (step.op) {
    case "prompt":
      return wait(s, step.prompt);
    case "checkpoint":
      return checkpoint(ctx, s, ev);
    case "auto.resolve":
      return resolveAuto(ctx, s, ev, step.pending);

    case "setup.afterFirst": {
      // 6-2-1-6..9: checkpoint, shuffle, 6 cards each, mulligans starting with the first player.
      for (const p of PLAYERS) {
        const r = shuffle(s.players[p].deck, s.rngState);
        s.players[p].deck = r.items;
        s.rngState = r.state;
        draw(ctx, s, ev, p, OPENING_HAND);
      }
      s.flow.unshift({ op: "setup.mulligan", player: s.firstPlayer }, { op: "setup.mulligan", player: other(s.firstPlayer) }, { op: "setup.finish" });
      return "done";
    }
    case "setup.mulligan":
      return wait(s, { kind: "mulligan", player: step.player });
    case "setup.finish": {
      // 6-2-1-10/11: 8 life each from the top of the deck; the second player gets an energy marker.
      for (const p of PLAYERS) {
        for (let i = 0; i < LIFE_AT_START; i++) {
          const id = s.players[p].deck[0];
          if (!id) break;
          move(ctx, s, ev, id, "life", p);
        }
      }
      s.players[other(s.firstPlayer)].energyMarkers = 1;
      ev.push({ type: "energyMarker", player: other(s.firstPlayer), delta: 1 });
      s.turnPlayer = other(s.firstPlayer); // turn.next flips it
      s.flow.unshift({ op: "turn.next" });
      return "done";
    }

    case "turn.next": {
      s.turnPlayer = other(s.turnPlayer);
      s.turn++;
      for (const id of Object.keys(s.cards)) {
        s.cards[id].usedThisTurn = [];
        s.cards[id].extraAttacks = 0;
        s.cards[id].usedMarkerSkill = false;
      }
      const ps = s.players[s.turnPlayer];
      ps.overRealmsThisTurn = 0;
      ps.zAwakenedThisTurn = false;
      ps.grewUnisonThisTurn = false;
      // Anything still waiting for "the end of the turn" missed its moment.
      expireDelayed(s);
      s.flow.unshift({ op: "turn.start" });
      return "done";
    }
    case "turn.start": {
      // 7-2: Charge Phase.
      s.phase = "charge";
      ev.push({ type: "phase", phase: "charge", player: s.turnPlayer, turn: s.turn });
      endEffects(s, "opponentTurn", other(s.turnPlayer));
      // "until the end of your opponent's turn" — created on your turn, it
      // runs through theirs and ends as your next turn opens.
      endEffects(s, "nextTurn", s.turnPlayer);
      for (const id of cardsInPlay(s, s.turnPlayer)) pendTriggers(ctx, s, "chargeStart", id);
      s.flow.unshift(...fireDelayed(s, "turnStart"), { op: "checkpoint" }, { op: "turn.activeAll" }, { op: "checkpoint" }, { op: "turn.draw" }, { op: "checkpoint" }, { op: "turn.promptCharge" });
      return "done";
    }
    case "turn.activeAll": {
      // 7-2-7, except [Servant] (22-40).
      const ps = s.players[s.turnPlayer];
      const mine = [ps.leader, ps.unison, ...ps.battle, ...ps.energy].filter((id): id is string => !!id);
      for (const id of mine) {
        if (has(ctx, s, id, "Servant")) continue;
        setMode(s, ev, id, "active", ctx);
      }
      // "…will not switch to Active Mode during your next Charge Phase": the
      // Active Step it was written for has now happened, so it is spent. Only
      // this player's cards had one, which is what makes "next" the right one
      // whichever turn the effect was created on.
      s.effects = s.effects.filter((e) => !(e.until === "afterNextCharge" && mine.includes(e.target)));
      return "done";
    }
    case "turn.draw": {
      // 7-2-9-1: the first player skips the draw on turn 1.
      if (!(s.turn === 1 && s.turnPlayer === s.firstPlayer)) draw(ctx, s, ev, s.turnPlayer, 1);
      return "done";
    }
    case "turn.promptCharge":
      if (s.players[s.turnPlayer].hand.length === 0) {
        s.flow.unshift({ op: "checkpoint" }, { op: "turn.mainStart" });
        return "done";
      }
      return wait(s, { kind: "charge", player: s.turnPlayer });
    case "turn.mainStart": {
      s.phase = "main";
      ev.push({ type: "phase", phase: "main", player: s.turnPlayer, turn: s.turn });
      for (const id of cardsInPlay(s, s.turnPlayer)) pendTriggers(ctx, s, "mainStart", id);
      s.flow.unshift(...fireDelayed(s, "mainStart"), { op: "checkpoint" }, { op: "turn.promptMain" });
      return "done";
    }
    case "turn.promptMain":
      // 7-3-3: a checkpoint precedes every free timing; run one if anything is pending.
      if (s.pending.length) {
        s.flow.unshift({ op: "checkpoint" }, { op: "turn.promptMain" });
        return "done";
      }
      return wait(s, { kind: "main", player: s.turnPlayer });
    case "turn.mainEnd": {
      s.phase = "mainEnd";
      for (const id of cardsInPlay(s, s.turnPlayer)) pendTriggers(ctx, s, "mainEnd", id);
      s.flow.unshift({ op: "checkpoint" }, { op: "turn.endPhase" });
      return "done";
    }
    case "turn.endPhase": {
      // 7-4.
      s.phase = "end";
      ev.push({ type: "phase", phase: "end", player: s.turnPlayer, turn: s.turn });
      const before = s.pending.length;
      for (const p of PLAYERS) for (const id of cardsInPlay(s, p)) pendTriggers(ctx, s, "turnEnd", id);
      // Effects written down earlier in the turn resolve here, before the
      // "at the end of the turn" skills the cards in play are triggering now.
      const due = fireDelayed(s, "turnEnd");
      // 7-4-4: if new "at the end of the turn" skills became pending, run the
      // End Phase again before the turn passes.
      const again = s.pending.length > before && (s.continuations.endPhaseRuns as number | undefined ?? 0) < 5;
      s.continuations.endPhaseRuns = ((s.continuations.endPhaseRuns as number | undefined) ?? 0) + 1;
      if (again) s.flow.unshift(...due, { op: "checkpoint" }, { op: "turn.endPhase" });
      else {
        delete s.continuations.endPhaseRuns;
        s.flow.unshift(...due, { op: "checkpoint" }, { op: "turn.cleanup" }, { op: "turn.next" });
      }
      return "done";
    }
    case "turn.cleanup":
      // 7-4-5/6: "for the turn" effects end. 22-15-6 (Over Realm cards back to
      // the Warp) is now one of the delayed effects drained here.
      endEffects(s, "turn");
      s.flow.unshift(...fireDelayed(s, "turnCleanup"));
      return "done";

    case "counter":
      return openCounterWindow(ctx, s, ev, step.window, step.responder);
    case "counter.resolve": {
      // 9-7-4: a counter that was negated does nothing at all; the card has
      // already been paid for and is already in the Drop (22-10-7).
      if (step.negated) {
        note(ev, `${face(ctx, s, step.card).name} was countered`);
        return "done";
      }
      s.flow.unshift({ op: "skill.resolve", card: step.card, skill: step.skill, player: step.player });
      return "done";
    }

    case "play.resolve":
      return resolvePlay(ctx, s, ev, step.card, step.player, step.markers);
    case "skill.resolve": {
      const sk = skillsOfInstance(ctx, s, step.card).find((k) => k.index === step.skill);
      if (!sk) return "done";
      ev.push({ type: "skill", card: step.card, skill: sk.index, master: step.player, text: sk.raw });
      const r = resolveKeywordOrText(ctx, s, ev, step.card, sk, step.player, step.trigger);
      return r;
    }
    case "extra.finish": {
      // 12-2-2-2 puts the Extra in the Drop before the skill; here we only clear `resolving`.
      s.resolving = null;
      return "done";
    }

    case "battle.afterDeclare":
      return battleAfterDeclare(ctx, s);
    case "battle.blocker":
      return battleBlocker(ctx, s);
    case "battle.offense":
      return battleOffense(ctx, s, ev);
    case "battle.promptCombo":
      return battlePromptCombo(ctx, s, step.side);
    case "battle.defense":
      return battleDefense(ctx, s, ev);
    case "battle.damage":
      return battleDamage(ctx, s, ev);
    case "battle.end":
      return battleEnd(ctx, s, ev);
    case "battle.zEnergy":
      return battleZEnergy(ctx, s, step.player);
    case "battle.cleanup":
      return battleCleanup(ctx, s, ev);

    case "script.step":
      return stepScript(ctx, s, ev, step.frame);
    case "flipLeader": {
      // 22-2-4 / 22-25-4: [Awaken] and [Wish] flip the leader after their effects resolve.
      const inst = s.cards[step.card];
      if (!inst.flipped && def(ctx, s, step.card).back) {
        inst.flipped = true;
        ev.push({ type: "flip", card: step.card, flipped: true });
      }
      return "done";
    }
    case "zstack.place":
      return zStackPlace(ctx, s, ev, step.card, step.player);
    case "choose.apply":
      return chooseApply(ctx, s, ev, step);
    default:
      return "done";
  }
}

/** A negated attack skips straight to the Battle End Step (8-1-6-1): drop the queued battle steps. */
function abortBattle(s: GameState): void {
  s.flow = s.flow.filter((st) => !st.op.startsWith("battle."));
  s.flow.unshift({ op: "battle.end" });
}

// ── checkpoints, pending, rule processing (4-2, 9-6, 21) ───────────────────

/**
 * 4-2-2: rule processing, then the turn player's pending [Auto]s one at a
 * time, then the non-turn player's. Order within a player is printed order
 * (phase 1 skips the "choose which first" prompt).
 */
function checkpoint(ctx: EngineContext, s: GameState, ev: GameEvent[]): "done" | "wait" {
  ruleProcessing(ctx, s, ev);
  if (s.phase === "over") return "done";
  const pick = (p: PlayerId) => {
    const i = s.pending.findIndex((x) => x.master === p);
    return i >= 0 ? s.pending.splice(i, 1)[0] : null;
  };
  const next = pick(s.turnPlayer) ?? pick(other(s.turnPlayer));
  if (next) {
    s.flow.unshift({ op: "auto.resolve", pending: next }, { op: "checkpoint" });
  }
  return "done";
}

function resolveAuto(ctx: EngineContext, s: GameState, ev: GameEvent[], p: PendingAuto): "done" | "wait" {
  const inst = s.cards[p.card];
  const sk = skillsOfInstance(ctx, s, p.card).find((k) => k.index === p.skillIndex);
  if (!sk) return "done";
  // 9-6-11: the skill resolves even if the card moved, unless it became impossible.
  if (sk.oncePerTurn || sk.limit != null) {
    const used = inst.usedThisTurn.filter((i) => i === sk.index).length;
    if (used >= (sk.limit ?? 1)) return "done";
    inst.usedThisTurn.push(sk.index);
  }
  // 9-6-4: a cost may be declined, and then the skill does not resolve at all.
  const orbs = orbTotals(sk);
  const needsMarker = sk.markerCost != null;
  const needsKeywordCost = sk.burst != null || sk.spiritBoost != null;
  if ((orbs.total > 0 || needsMarker || needsKeywordCost) && !s.continuations[`paid:${p.card}:${sk.index}`]) {
    if (needsMarker && (inst.usedMarkerSkill || inst.markers + (sk.markerCost ?? 0) < 0)) return "done";
    if (orbs.total > 0 && !planPayment(ctx, s, p.master, orbs.total, orbs.specified)) return "done";
    // 22-27-4 / 22-43-3: a [Burst] or [Spirit Boost] that cannot be paid does not resolve.
    if (!canPayKeywordCosts(s, p.master, sk)) return "done";
    s.continuations.optionalCost = { card: p.card, skillIndex: sk.index, master: p.master, trigger: p.trigger, subject: p.subject };
    return wait(s, { kind: "optionalCost", player: p.master, card: p.card, skillIndex: sk.index, describe: describeCost(sk) });
  }
  delete s.continuations[`paid:${p.card}:${sk.index}`];
  ev.push({ type: "skill", card: p.card, skill: sk.index, master: p.master, text: sk.raw });
  return resolveKeywordOrText(ctx, s, ev, p.card, sk, p.master, p.trigger, p.subject);
}

/** 21: interruptive and confirmative rule processing, repeated until stable. */
function ruleProcessing(ctx: EngineContext, s: GameState, ev: GameEvent[]): void {
  for (let i = 0; i < 20; i++) {
    let changed = false;
    if (lossJudgment(s, ev)) return;
    for (const p of PLAYERS) {
      const ps = s.players[p];
      // 21-6: a Battle Card at 0 power or less goes to the Drop, ignoring [Indestructible].
      for (const id of ps.battle.slice()) {
        if (baseType(def(ctx, s, id)) === "BATTLE" && !s.cards[id].hidden && powerOf(ctx, s, id) <= 0) {
          move(ctx, s, ev, id, "drop", p, { reason: "rule" });
          changed = true;
        }
      }
      // 21-8 / 21-9: a Unison at 0 power loses a marker; at 0 markers it goes to the Drop.
      if (ps.unison) {
        const u = ps.unison;
        if (powerOf(ctx, s, u) <= 0 && s.cards[u].markers > 0) {
          s.cards[u].markers--;
          ev.push({ type: "markers", card: u, delta: -1, total: s.cards[u].markers });
          changed = true;
        }
        if (s.cards[u].markers <= 0) {
          move(ctx, s, ev, u, "drop", p, { reason: "rule" });
          pendTriggers(ctx, s, "unisonToDrop", u);
          changed = true;
        }
      }
      // 21-4: combo cards outside a battle go to the Drop.
      if (!s.battle && ps.combo.length) {
        for (const id of ps.combo.slice()) move(ctx, s, ev, id, "drop", p, { reason: "rule" });
        changed = true;
      }
      // 21-11 / 22-39: two [Unique] cards with the same name — keep the newest.
      const seen = new Map<string, string>();
      for (const id of ps.battle.slice()) {
        if (!has(ctx, s, id, "Unique")) continue;
        const name = face(ctx, s, id).name;
        const prev = seen.get(name);
        if (prev) {
          move(ctx, s, ev, prev, "drop", p, { reason: "rule" });
          changed = true;
        }
        seen.set(name, id);
      }
    }
    if (!changed) return;
  }
}

/** 21-2: no life or no deck loses immediately; both at once is a draw. */
function lossJudgment(s: GameState, ev: GameEvent[]): boolean {
  if (s.phase === "over") return true;
  if (s.phase === "setup") return false; // life is dealt at the end of setup (6-2-1-10)
  const lost = PLAYERS.filter((p) => s.players[p].life.length === 0 || s.players[p].deck.length === 0);
  if (lost.length === 0) return false;
  s.phase = "over";
  s.flow = [];
  if (lost.length === 2) {
    s.winner = null;
    s.overReason = "both players lost at once";
  } else {
    s.winner = other(lost[0]);
    s.overReason = s.players[lost[0]].life.length === 0 ? `${s.players[lost[0]].name} has no life left` : `${s.players[lost[0]].name} has no cards left in the deck`;
  }
  s.prompt = { kind: "gameOver" };
  ev.push({ type: "gameOver", winner: s.winner, reason: s.overReason });
  return true;
}

function gameOver(s: GameState, ev: GameEvent[], winner: PlayerId | null, reason: string): void {
  s.phase = "over";
  s.flow = [];
  s.winner = winner;
  s.overReason = reason;
  s.prompt = { kind: "gameOver" };
  ev.push({ type: "gameOver", winner, reason });
}

// ── counter timing (4-3, 9-7, 22-10) ───────────────────────────────────────

function counterCandidates(ctx: EngineContext, s: GameState, responder: PlayerId, window: "play" | "attack" | "counter" | "skill"): { card: string; skill: number }[] {
  const out: { card: string; skill: number }[] = [];
  const playing = window === "play" && s.resolving ? s.resolving.card : null;
  if (playing && has(ctx, s, playing, "Deflect")) return out; // 22-20
  for (const id of s.players[responder].hand) {
    const d = def(ctx, s, id);
    for (const sk of skillsOf(d)) {
      const want =
        (window === "play" && sk.kind === "counter:play") ||
        (window === "attack" && (sk.kind === "counter:attack" || (sk.kind === "counter:battle card attack" && s.battle && baseType(def(ctx, s, s.battle.attacker)) === "BATTLE"))) ||
        (window === "counter" && sk.kind === "counter:counter");
      if (!want) continue;
      if (!canResolve(ctx, s, id, sk)) continue;
      if (forbids(ctx, s, "activateCounter", { player: responder, card: id })) continue;
      const cost = playCost(ctx, s, id);
      const orbs = orbTotals(sk);
      // 5-3: some cards print another way to pay, which is the only way the
      // card is playable when the energy is not there.
      const affordable = !!planPayment(ctx, s, responder, cost.total + orbs.total, cost.specified);
      if (!affordable && !altCostFor(ctx, s, id, responder)) continue;
      out.push({ card: id, skill: sk.index });
    }
  }
  return out;
}

function openCounterWindow(ctx: EngineContext, s: GameState, ev: GameEvent[], window: "play" | "attack" | "battleCardAttack" | "counter" | "skill", responder: PlayerId): "done" | "wait" {
  const w = window === "battleCardAttack" ? "attack" : window;
  const candidates = w === "skill" ? [] : counterCandidates(ctx, s, responder, w);
  if (candidates.length === 0) return "done";
  s.counterStack.push({ window: w, responder, then: "", negated: false });
  return wait(s, { kind: "counter", player: responder, window: w, candidates: candidates.map((c) => c.card) });
}

// ── playing cards (5-5, 13-2, 16-2, 17-2, 18-2) ────────────────────────────

function resolvePlay(ctx: EngineContext, s: GameState, ev: GameEvent[], card: string, p: PlayerId, markers?: number): "done" | "wait" {
  const d = def(ctx, s, card);
  const bt = baseType(d);
  const ps = s.players[p];
  if (bt === "UNISON") {
    // 22-45: [Empower XY] carries up to Y markers over from the Unison this
    // one replaces, if that Unison is the colour it names (any colour when it
    // names none). Read before the old one goes, because leaving play clears
    // its markers.
    let carried = 0;
    const empower = keyword(ctx, s, card, "Empower");
    if (ps.unison && empower && empower.x > 0) {
      const old = ps.unison;
      if (empower.color == null || cardNow(ctx, s, old).colors.includes(empower.color)) carried = Math.min(empower.x, s.cards[old].markers);
    }
    // 3-11-5: an existing Unison goes to the Drop.
    if (ps.unison) move(ctx, s, ev, ps.unison, "drop", p, { reason: "rule" });
    move(ctx, s, ev, card, "unison", p, { reason: "play", reveal: true });
    s.cards[card].markers = (markers ?? 0) + carried;
    ev.push({ type: "markers", card, delta: s.cards[card].markers, total: s.cards[card].markers });
    if (carried) note(ev, `Empower: ${carried} marker${carried === 1 ? "" : "s"} carried over`);
  } else if (d.type === "Z-EXTRA") {
    // 17-2-1-3: other Z-Extras are removed.
    for (const id of ps.battle.slice()) if (def(ctx, s, id).type === "Z-EXTRA") move(ctx, s, ev, id, "removed", p, { reason: "rule" });
    move(ctx, s, ev, card, "battle", p, { reason: "play", reveal: true });
  } else {
    move(ctx, s, ev, card, "battle", p, { reason: "play", reveal: true });
    if (s.continuations.playRest === card) {
      setMode(s, ev, card, "rest");
      delete s.continuations.playRest;
    }
    if (s.continuations.playNegated === card) {
      // "…with its skills negated for the turn": a turn-long effect, not a mark
      // on the card, so the skills come back when the turn ends.
      addEffect(s, ev, { target: card, kind: "negateSkills", value: 0, until: "turn" });
      delete s.continuations.playNegated;
    }
  }
  s.resolving = null;
  pendTriggers(ctx, s, "played", card);
  // 22-35/36: Heroic/Villainous on other cards in play pend when a card with the keyword is played.
  if (has(ctx, s, card, "Heroic") || has(ctx, s, card, "Villainous")) {
    for (const id of cardsInPlay(s, p)) if (id !== card && (has(ctx, s, id, "Heroic") || has(ctx, s, id, "Villainous"))) s.pending.push({ card: id, skillIndex: -1, master: p, trigger: "played", subject: card });
  }
  s.flow.unshift({ op: "checkpoint" });
  return "done";
}

// ── keyword skills and text effects ────────────────────────────────────────

function resolveKeywordOrText(ctx: EngineContext, s: GameState, ev: GameEvent[], card: string, sk: Skill, master: PlayerId, trigger?: Trigger, subject?: string): "done" | "wait" {
  const k = sk.keyword;
  const inst = s.cards[card];
  if (sk.index === -1) {
    // Heroic / Villainous pseudo-skill.
    if (has(ctx, s, card, "Heroic")) draw(ctx, s, ev, master, 1);
    else if (has(ctx, s, card, "Villainous")) {
      const opp = s.players[other(master)];
      const drop = opp.hand[opp.hand.length - 1];
      if (drop) move(ctx, s, ev, drop, "drop", other(master), { reason: "effect" });
    }
    return "done";
  }
  if (k) {
    switch (k.name) {
      case "Attack":
        if (s.battle && s.battle.attacker === card && inst.extraAttacks < k.x - 1) {
          inst.extraAttacks++;
          s.battle.reactivate = true;
        }
        return "done";
      case "Revenge":
        if (s.battle && s.battle.guard === card) s.battle.revenge = true;
        return "done";
      case "Offering": {
        // 22-33: the opponent may drop a life card; otherwise the owner draws 2.
        const opp = other(master);
        if (s.players[opp].life.length === 0) {
          draw(ctx, s, ev, master, 2);
          return "done";
        }
        s.continuations.offering = { card, master };
        return wait(s, { kind: "offering", player: opp, card });
      }
      case "Z-Stack": {
        const filter = parseFilter(sk.effect || sk.cost);
        const cands = s.players[master].zDeck.filter((id) => matches(cardNow(ctx, s, id), filter));
        if (!cands.length) return "done";
        s.continuations.zstack = { card, x: k.x };
        s.flow.unshift({ op: "choose.apply", what: "zstack", card, player: master });
        return wait(s, { kind: "chooseCards", player: master, choice: { reason: `Z-Stack ${k.x}: cards to place under ${face(ctx, s, card).name}`, candidates: cands, min: 0, max: k.x, continuation: "zstack" } });
      }
      case "Awaken":
      case "Wish":
        // The flip is queued first so it happens after the effect, even when
        // the effect stops to ask a question (22-2-4, 22-25-4).
        s.flow.unshift({ op: "flipLeader", card });
        return runSkill(ctx, s, ev, card, sk, master, trigger);
      case "Alliance": {
        // 22-32-3: as it attacks, its owner may switch one or more of their
        // other Battle Cards of the named colours to Rest Mode as the cost;
        // the printed effect then runs with those cards bound to `rested`.
        if (!s.battle || s.battle.attacker !== card) return "done";
        // "[Alliance Red/Green] If your Leader Card is red: …" — the printed
        // condition is checked before anyone is asked to rest a card.
        if (/^(?:if|when|while|during)\b/i.test(sk.cost)) {
          const cond = parseConditionClause(sk.cost);
          if (!cond) {
            note(ev, `${face(ctx, s, card).name}: the condition on [Alliance] could not be read — "${sk.cost}"`);
            return "done";
          }
          if (!condHolds(ctx, s, { ops: [], ip: 0, vars: {}, card, master }, cond.cond)) return "done";
        }
        const cands = s.players[master].battle.filter((id) => id !== card && s.cards[id].mode === "active" && cardNow(ctx, s, id).colors.some((c) => k.colors.includes(c)));
        if (!cands.length) return "done";
        s.continuations.alliance = { card, skillIndex: sk.index, trigger };
        s.flow.unshift({ op: "choose.apply", what: "alliance", card, player: master });
        return wait(s, {
          kind: "chooseCards",
          player: master,
          choice: { reason: `Alliance ${k.colors.join("/")}: Battle Cards to switch to Rest Mode for ${face(ctx, s, card).name}, or none`, candidates: cands, min: 0, max: cands.length, continuation: "alliance" },
        });
      }
      case "Revive": {
        // 22-34: KO'd, and its owner may drop cards from hand covering both
        // colours to play it back from the Drop — once per turn per card.
        if (areaOf(s, card) !== "drop") return "done";
        if (s.continuations[`revived:${card}`] === s.turn) return "done";
        const hand = s.players[master].hand;
        if (!canCoverColors(ctx, s, hand, k.colors)) return "done";
        const cands = hand.filter((id) => cardNow(ctx, s, id).colors.some((c) => k.colors.includes(c)));
        s.continuations.revive = { card, colors: k.colors };
        s.flow.unshift({ op: "choose.apply", what: "revive", card, player: master });
        return wait(s, {
          kind: "chooseCards",
          player: master,
          choice: { reason: `Revive ${k.colors.join("/")}: drop cards covering both colours to play ${face(ctx, s, card).name} back, or none`, candidates: cands, min: 0, max: k.colors.length, continuation: "revive" },
        });
      }
      case "Field":
        // 22-3: the Extra goes to the Battle Area; other [Field] Extras go to the Drop.
        for (const id of s.players[master].battle.slice()) if (has(ctx, s, id, "Field")) move(ctx, s, ev, id, "drop", master, { reason: "rule" });
        move(ctx, s, ev, card, "battle", master, { reason: "play", reveal: true });
        return "done";
      default:
        break;
    }
  }
  return runSkill(ctx, s, ev, card, sk, master, trigger, subject);
}

/**
 * Resolve a skill's text. The compiled program runs deterministically; a skill
 * the compiler could not read is handed to the referee when one is available,
 * and otherwise logged and skipped so a game never silently does the wrong thing.
 */
function runSkill(ctx: EngineContext, s: GameState, ev: GameEvent[], card: string, sk: Skill, master: PlayerId, trigger?: Trigger, subject?: string, vars: Record<string, string[]> = {}): "done" | "wait" {
  const script = scriptFor(ctx, s, card, sk.index);
  if (script) {
    if (script.ops.length === 0) return "done";
    const frame: ScriptFrame = { ops: script.ops, ip: 0, vars: { ...vars }, card, master, trigger, subject, skillIndex: sk.index };
    return stepScript(ctx, s, ev, frame);
  }
  const d = def(ctx, s, card);
  if (ctx.referee) {
    const unread = scriptsOf(ctx, s, card).bySkill[sk.index]?.unsupported ?? [sk.effect];
    return wait(s, {
      kind: "referee",
      player: master,
      request: { card, cardId: d.id, cardName: face(ctx, s, card).name, skillIndex: sk.index, text: sk.raw, unsupported: unread, master, trigger },
    });
  }
  note(ev, `${d.id} skill ${sk.index} was not applied — the compiler could not read "${sk.effect.slice(0, 70)}"`);
  return "done";
}

/** The energy orbs in a skill cost: "{g}{g}" is two green, "{2}" is two of anything. */
function orbTotals(sk: Skill): { total: number; specified: Partial<Record<Color, number>> } {
  const specified: Partial<Record<Color, number>> = {};
  let total = 0;
  for (const [k, v] of Object.entries(sk.energyCost)) {
    total += v ?? 0;
    if (k !== "any") specified[k as Color] = v;
  }
  return { total, specified };
}

/** Compiled programs for the face-up side of a card, memoised per definition. */
const scriptCache = new WeakMap<CardDef, { front: CardScripts; back: CardScripts }>();

function scriptsOf(ctx: EngineContext, s: GameState, card: string): CardScripts {
  const d = def(ctx, s, card);
  const inst = s.cards[card];
  const side = inst.flipped && d.back ? "back" : "front";
  const stored = ctx.scripts?.[side === "back" ? `${d.id}#back` : d.id];
  if (stored) return stored;
  let entry = scriptCache.get(d);
  if (!entry) {
    entry = { front: compileCard(d, "front"), back: compileCard(d, "back") };
    scriptCache.set(d, entry);
  }
  return side === "back" ? entry.back : entry.front;
}

/** The program for one skill, or null when a clause of it could not be read. */
function scriptFor(ctx: EngineContext, s: GameState, card: string, skillIndex: number) {
  const sc = scriptsOf(ctx, s, card).bySkill[skillIndex];
  return sc && sc.unsupported.length === 0 ? sc : null;
}

/**
 * A skill cost the engine can read: nothing at all, energy orbs, a Unison
 * marker cost, or a condition the compiler reads ("if your Leader is red" —
 * which then guards the compiled program). Anything else — "if you discard 1
 * card from your hand" — is left to the referee rather than quietly skipped,
 * because resolving the effect without its cost would be worse than not
 * resolving it at all.
 */
function costIsReadable(sk: Skill): boolean {
  if (sk.cost.replace(/\{[^}]*\}/g, "").replace(/[\s,:]/g, "").length === 0) return true;
  return /^(?:if|when|while|during)\b/i.test(sk.cost) && parseConditionClause(sk.cost) !== null;
}

/** "2 Green energy and 1 marker" — what an optional cost asks for. */
function describeCost(sk: Skill): string {
  const parts: string[] = [];
  for (const [c, n] of Object.entries(sk.energyCost)) if (n) parts.push(`${n} ${c === "any" ? "energy" : `${c} energy`}`);
  if (sk.markerCost != null) parts.push(sk.markerCost >= 0 ? `add ${sk.markerCost} marker${sk.markerCost === 1 ? "" : "s"}` : `remove ${-sk.markerCost} marker${sk.markerCost === -1 ? "" : "s"}`);
  if (sk.burst != null) parts.push(`Burst ${sk.burst}: ${sk.burst} card${sk.burst === 1 ? "" : "s"} from the top of your deck to the Drop`);
  if (sk.spiritBoost != null) parts.push(`Spirit Boost ${sk.spiritBoost}: ${sk.spiritBoost} marker${sk.spiritBoost === 1 ? "" : "s"} off your Unison`);
  return parts.join(", ") || "nothing";
}

/** Whether the engine can carry out this skill on its own (or will ask the referee). */
function canResolve(ctx: EngineContext, s: GameState, card: string, sk: Skill): boolean {
  if (!costIsReadable(sk)) return !!ctx.referee;
  if (!sk.effect.trim()) return true;
  const sc = scriptsOf(ctx, s, card).bySkill[sk.index];
  if (sc && sc.unsupported.length === 0) return true;
  return !!ctx.referee;
}

/**
 * Ask which energy to rest, but only when the answer can matter — when the
 * colours left active afterwards would differ (3-8-2). Returns the waiting
 * state, or null when the engine should just pay.
 */
function askForPayment(
  ctx: EngineContext,
  s: GameState,
  p: PlayerId,
  action: Action,
  total: number,
  specified: Partial<Record<Color, number>>,
  describe: string,
): GameState | null {
  if ("pay" in action && action.pay) return null;
  if (total <= 0) return null;
  const options = paymentOptions(ctx, s, p, total, specified);
  if (options.length <= 1) return null;
  s.continuations.promptBefore = s.prompt;
  s.prompt = { kind: "payCost", player: p, action, options, describe };
  return s;
}

/** Pay a Unison card's marker cost (13-4) and lock that card's marker skills for the turn. */
/**
 * The costs a keyword tag adds to a skill: [Burst X] mills X (22-27-3), and
 * [Spirit Boost X] removes X markers from your Unison (22-43-3). Both are
 * part of the skill cost, so they are paid where the orbs are paid and refused
 * where the orbs are refused.
 */
function canPayKeywordCosts(s: GameState, p: PlayerId, sk: Skill): boolean {
  const ps = s.players[p];
  // 22-27-4: not if X is more than the deck holds.
  if (sk.burst != null && ps.deck.length < sk.burst) return false;
  if (sk.spiritBoost != null && (!ps.unison || s.cards[ps.unison].markers < sk.spiritBoost)) return false;
  return true;
}

function payKeywordCosts(ctx: EngineContext, s: GameState, ev: GameEvent[], p: PlayerId, sk: Skill): void {
  const ps = s.players[p];
  if (sk.burst != null) {
    for (let i = 0; i < sk.burst && ps.deck.length; i++) move(ctx, s, ev, ps.deck[0], "drop", p, { reason: "cost", reveal: true });
  }
  if (sk.spiritBoost != null && ps.unison) {
    const u = ps.unison;
    s.cards[u].markers = Math.max(0, s.cards[u].markers - sk.spiritBoost);
    ev.push({ type: "markers", card: u, delta: -sk.spiritBoost, total: s.cards[u].markers });
    pendTriggers(ctx, s, "markerRemoved", u);
  }
}

/** The printed energy cost as a number; X and none count as 0. */
function costOf(d: CardDef): number {
  return typeof d.energyCost === "number" ? d.energyCost : 0;
}

/** 22-38-3: mono-green, mono-yellow, or Green/Yellow — nothing else. */
function successorPool(ctx: EngineContext, s: GameState, p: PlayerId): string[] {
  return s.players[p].battle.filter((id) => {
    const colors = cardNow(ctx, s, id).colors;
    return colors.length > 0 && colors.every((c) => c === "Green" || c === "Yellow");
  });
}

/** Whether some subset of these costs adds up to exactly `target`. */
function subsetSumExists(costs: number[], target: number): boolean {
  const reachable = new Set<number>([0]);
  for (const c of costs) for (const r of [...reachable]) if (r + c <= target) reachable.add(r + c);
  return reachable.has(target);
}

/**
 * 22-30-3 / 22-34-3: whether cards in this list can cover every colour named —
 * one card of each, or one multicolour card carrying both.
 */
function canCoverColors(ctx: EngineContext, s: GameState, ids: string[], colors: Color[]): boolean {
  const covered = new Set<Color>();
  for (const id of ids) for (const c of cardNow(ctx, s, id).colors) if (colors.includes(c)) covered.add(c);
  return colors.every((c) => covered.has(c));
}

/**
 * Asks for the next card of a [Successor] cost. Only cards that still leave a
 * way to hit the exact sum are offered, so the choice can never dead-end.
 */
function successorAsk(ctx: EngineContext, s: GameState, card: string, p: PlayerId): void {
  const info = s.continuations.successor as { card: string; need: number; chosen: string[] };
  const paid = info.chosen.reduce((n, id) => n + costOf(def(ctx, s, id)), 0);
  const left = info.need - paid;
  const pool = successorPool(ctx, s, p).filter((id) => !info.chosen.includes(id));
  const cands = pool.filter((id) => {
    const c = costOf(def(ctx, s, id));
    if (c <= 0 || c > left) return false;
    const rest = pool.filter((o) => o !== id).map((o) => costOf(def(ctx, s, o)));
    return subsetSumExists(rest, left - c);
  });
  s.flow.unshift(
    { op: "prompt", prompt: { kind: "chooseCards", player: p, choice: { reason: `Successor: ${left} more energy worth of green/yellow Battle Cards to drop`, candidates: cands, min: 1, max: 1, continuation: "successor" } } },
    { op: "choose.apply", what: "successor", card, player: p },
  );
}

/** [Rejuvenate]'s printed cost: markers to remove, and any life ceiling (22-42-3). */
function rejuvenateCost(sk: Skill): { markers: number; lifeAtMost: number | null } | null {
  const t = (sk.cost || sk.effect).toLowerCase();
  const m = /remove (\d+) markers? from this card/.exec(t);
  if (!m) return null;
  const life = /your life is at (\d+) or less/.exec(t);
  return { markers: Number(m[1]), lifeAtMost: life ? Number(life[1]) : null };
}

function payMarkerCost(s: GameState, ev: GameEvent[], card: string, markerCost: number): void {
  const inst = s.cards[card];
  inst.markers = Math.max(0, inst.markers + markerCost);
  inst.usedMarkerSkill = true;
  ev.push({ type: "markers", card, delta: markerCost, total: inst.markers });
}

// ── battle (8) ─────────────────────────────────────────────────────────────

function battleAfterDeclare(ctx: EngineContext, s: GameState): "done" | "wait" {
  const b = s.battle!;
  // 8-1-3: attack/attacked triggers and [Blocker] pend; 8-1-4 counter timing; 8-1-5 checkpoint.
  pendTriggers(ctx, s, "attacks", b.attacker);
  pendTriggers(ctx, s, "attacked", b.guard);
  s.flow.unshift(
    { op: "counter", window: "attack", responder: other(s.turnPlayer) },
    { op: "battle.blocker" },
    { op: "checkpoint" },
    { op: "battle.offense" },
  );
  return "done";
}

function battleBlocker(ctx: EngineContext, s: GameState): "done" | "wait" {
  const b = s.battle!;
  if (b.negated) {
    abortBattle(s);
    return "done";
  }
  if (b.blockerOffered) return "done";
  b.blockerOffered = true;
  const defender = other(s.turnPlayer);
  const cands = cardsInPlay(s, defender).filter((id) => id !== b.guard && s.cards[id].mode === "active" && has(ctx, s, id, "Blocker") && !forbids(ctx, s, "block", { player: defender, card: id }));
  if (!cands.length) return "done";
  return wait(s, { kind: "blocker", player: defender, candidates: cands });
}

/** 8-1-7: if the attacker or the guard has left, the battle goes straight to its end step. */
function battleIntact(ctx: EngineContext, s: GameState): boolean {
  const b = s.battle;
  if (!b) return false;
  return !!areaOf(s, b.attacker) && !!areaOf(s, b.guard) && inPlay(s, b.attacker) && inPlay(s, b.guard);
}

function battleOffense(ctx: EngineContext, s: GameState, ev: GameEvent[]): "done" | "wait" {
  const b = s.battle!;
  if (b.negated || !battleIntact(ctx, s)) {
    abortBattle(s);
    return "done";
  }
  b.step = "offense";
  ev.push({ type: "battleStep", step: "offense" });
  for (const id of cardsInPlay(s, s.turnPlayer)) pendTriggers(ctx, s, "offenseStart", id);
  s.flow.unshift({ op: "checkpoint" }, { op: "battle.promptCombo", side: "offense" });
  return "done";
}

function battlePromptCombo(ctx: EngineContext, s: GameState, side: "offense" | "defense"): "done" | "wait" {
  const b = s.battle!;
  if (b.negated || !battleIntact(ctx, s)) {
    abortBattle(s);
    return "done";
  }
  const p = side === "offense" ? s.turnPlayer : other(s.turnPlayer);
  return wait(s, { kind: "combo", player: p, side });
}

function battleDefense(ctx: EngineContext, s: GameState, ev: GameEvent[]): "done" | "wait" {
  const b = s.battle!;
  if (b.negated || !battleIntact(ctx, s)) {
    abortBattle(s);
    return "done";
  }
  // 8-2-4-3-1-1: skipped when the guard is a Unison.
  if (baseType(def(ctx, s, b.guard)) === "UNISON") {
    s.flow.unshift({ op: "battle.damage" });
    return "done";
  }
  b.step = "defense";
  ev.push({ type: "battleStep", step: "defense" });
  for (const id of cardsInPlay(s, other(s.turnPlayer))) pendTriggers(ctx, s, "defenseStart", id);
  s.flow.unshift({ op: "checkpoint" }, { op: "battle.promptCombo", side: "defense" });
  return "done";
}

function battleDamage(ctx: EngineContext, s: GameState, ev: GameEvent[]): "done" | "wait" {
  const b = s.battle!;
  if (b.negated || !battleIntact(ctx, s)) {
    abortBattle(s);
    return "done";
  }
  b.step = "damage";
  ev.push({ type: "battleStep", step: "damage" });
  const atkP = s.turnPlayer;
  const defP = other(atkP);
  // 8-4-4/5: combo power is added to each side.
  const attackPower = powerOf(ctx, s, b.attacker) + s.players[atkP].combo.reduce((n, id) => n + comboPowerOf(ctx, s, id), 0);
  const guardPower = powerOf(ctx, s, b.guard) + s.players[defP].combo.reduce((n, id) => n + comboPowerOf(ctx, s, id), 0);
  const hit = attackPower >= guardPower;
  ev.push({ type: "powerCompare", attacker: b.attacker, guard: b.guard, attackPower, guardPower, hit });
  if (hit) {
    const guardDef = def(ctx, s, b.guard);
    const gt = areaOf(s, b.guard) === "leader" ? "LEADER" : baseType(guardDef);
    if (gt === "LEADER") {
      // 8-4-6-1: damage to the player. [Strike] raises it, [Critical] sends life to the Drop, [Victory Strike] wins.
      let amount = 1;
      const strike = keyword(ctx, s, b.attacker, "Strike");
      if (strike) amount = Math.max(amount, strike.x);
      const critical = has(ctx, s, b.attacker, "Critical");
      const taken: string[] = [];
      for (let i = 0; i < amount; i++) {
        const life = s.players[defP].life[0];
        if (!life) break;
        move(ctx, s, ev, life, critical ? "drop" : "hand", defP, { reason: "damage", reveal: critical });
        taken.push(life);
      }
      s.players[defP].damageTaken += taken.length;
      ev.push({ type: "damage", player: defP, amount: taken.length, critical, cards: taken });
      if (taken.length) {
        pendTriggers(ctx, s, "dealtDamage", b.attacker);
        if (has(ctx, s, b.attacker, "Victory Strike")) {
          gameOver(s, ev, atkP, `[Victory Strike] — ${face(ctx, s, b.attacker).name} dealt damage`);
          return "done";
        }
      }
    } else if (gt === "UNISON") {
      // 13-5-2: markers come off instead of KO.
      const strike = keyword(ctx, s, b.attacker, "Strike");
      const n = has(ctx, s, b.attacker, "Victory Strike") ? s.cards[b.guard].markers : strike ? strike.x : 1;
      s.cards[b.guard].markers = Math.max(0, s.cards[b.guard].markers - n);
      ev.push({ type: "markers", card: b.guard, delta: -n, total: s.cards[b.guard].markers });
      pendTriggers(ctx, s, "markerRemoved", b.guard);
    } else {
      // 8-4-6-2: the guard is KO'd unless [Indestructible] (22-12).
      if (!has(ctx, s, b.guard, "Indestructible")) koCard(ctx, s, ev, b.guard, b.attacker);
    }
  }
  s.flow.unshift({ op: "checkpoint" }, { op: "battle.end" });
  return "done";
}

function battleEnd(ctx: EngineContext, s: GameState, ev: GameEvent[]): "done" | "wait" {
  const b = s.battle!;
  b.step = "battleEnd";
  ev.push({ type: "battleStep", step: "battleEnd" });
  // 8-5-2/3: each player may put one combo card into Z-Energy. Only asked of players who run a Z-Deck.
  const steps: FlowStep[] = [{ op: "checkpoint" }];
  for (const p of [s.turnPlayer, other(s.turnPlayer)]) {
    if (s.players[p].combo.length && (s.players[p].zDeck.length || s.players[p].zEnergy.length)) steps.push({ op: "battle.zEnergy", player: p });
  }
  steps.push({ op: "battle.cleanup" });
  s.flow.unshift(...steps);
  return "done";
}

function battleZEnergy(ctx: EngineContext, s: GameState, p: PlayerId): "done" | "wait" {
  const cands = s.players[p].combo.filter((id) => !isZ(def(ctx, s, id)) && !s.cards[id].isToken);
  if (!cands.length) return "done";
  return wait(s, { kind: "zEnergyFromCombo", player: p, candidates: cands });
}

function battleCleanup(ctx: EngineContext, s: GameState, ev: GameEvent[]): "done" | "wait" {
  const b = s.battle!;
  // 8-5-5..8: combo effects end, combo cards to the Drop.
  for (const p of PLAYERS) {
    for (const id of s.players[p].combo.slice()) {
      move(ctx, s, ev, id, "drop", p, { reason: "rule" });
      pendTriggers(ctx, s, "comboed", id);
    }
  }
  // 22-9-4 [Revenge]: KO the attacker at the end of the battle.
  if (b.revenge && areaOf(s, b.attacker) === "battle") koCard(ctx, s, ev, b.attacker, b.guard);
  // 22-8-3 [X Attack]: the attacker is switched back to Active Mode.
  if (b.reactivate && areaOf(s, b.attacker)) setMode(s, ev, b.attacker, "active", ctx);
  for (const p of PLAYERS) for (const id of cardsInPlay(s, p)) pendTriggers(ctx, s, "battleEnd", id);
  const due = fireDelayed(s, "battleEnd");
  endEffects(s, "battle");
  s.battle = null;
  s.flow.unshift(...due, { op: "checkpoint" }, { op: "turn.promptMain" });
  return "done";
}

// ── Z-Stack / Evolve / Union / Swap choices ────────────────────────────────

function zStackPlace(ctx: EngineContext, s: GameState, ev: GameEvent[], card: string, p: PlayerId): "done" | "wait" {
  return chooseApply(ctx, s, ev, { op: "choose.apply", what: "zstack", card, player: p });
}

function chooseApply(ctx: EngineContext, s: GameState, ev: GameEvent[], step: Extract<FlowStep, { op: "choose.apply" }>): "done" | "wait" {
  const chosen = s.lastChoice ?? [];
  s.lastChoice = null;
  const p = step.player;
  switch (step.what) {
    case "zstack": {
      for (const id of chosen) {
        move(ctx, s, ev, id, "battle", p, { reason: "effect" });
        // The card is under the Z-card, not a separate battle card.
        s.players[p].battle.splice(s.players[p].battle.indexOf(id), 1);
        s.cards[step.card].under.push(id);
      }
      if (chosen.length) ev.push({ type: "stack", top: step.card, under: s.cards[step.card].under.slice() });
      delete s.continuations.zstack;
      return "done";
    }
    case "evolve": {
      // 22-5-5: played on top of the chosen card; position and power effects carry over (21-5-2).
      const target = chosen[0];
      const info = s.continuations.evolve as { card: string; xeno: boolean };
      delete s.continuations.evolve;
      if (!target || areaOf(s, target) !== "battle") {
        // 22-5-7: failed to enter play → Drop.
        move(ctx, s, ev, info.card, "drop", p, { reason: "rule" });
        return "done";
      }
      if (info.xeno) {
        move(ctx, s, ev, target, "warp", p, { reason: "effect" });
        move(ctx, s, ev, info.card, "battle", p, { reason: "play", reveal: true });
      } else {
        stackOnto(ctx, s, ev, info.card, target, p);
      }
      s.flow.unshift({ op: "play.resolve", card: info.card, player: p });
      return "done";
    }
    case "union": {
      const info = s.continuations.union as { card: string; variant: "Fusion" | "Potara" };
      delete s.continuations.union;
      if (info.variant === "Fusion") {
        // 22-13-4-4: the two revealed cards go to the Drop as the skill cost, then the card is played.
        for (const id of chosen) move(ctx, s, ev, id, "drop", p, { reason: "cost" });
        s.flow.unshift({ op: "play.resolve", card: info.card, player: p });
        return "done";
      }
      // Potara: on top of both chosen battle cards.
      const [a, b] = chosen;
      if (!a || !b) {
        move(ctx, s, ev, info.card, "drop", p, { reason: "rule" });
        return "done";
      }
      stackOnto(ctx, s, ev, info.card, a, p);
      const bi = s.cards[b];
      s.players[p].battle.splice(s.players[p].battle.indexOf(b), 1);
      s.cards[info.card].under.push(b, ...bi.under.splice(0));
      ev.push({ type: "stack", top: info.card, under: s.cards[info.card].under.slice() });
      s.flow.unshift({ op: "play.resolve", card: info.card, player: p });
      return "done";
    }
    case "successor": {
      const info = s.continuations.successor as { card: string; need: number; chosen: string[] };
      const pick = chosen[0];
      if (pick) info.chosen.push(pick);
      const paid = info.chosen.reduce((n, id) => n + costOf(def(ctx, s, id)), 0);
      if (paid < info.need && pick) {
        successorAsk(ctx, s, info.card, p);
        return "done";
      }
      delete s.continuations.successor;
      if (paid !== info.need) return "done"; // nothing chosen: the activation lapses
      // 22-38-3: the chosen cards to the Drop as the cost, then the play.
      for (const id of info.chosen) move(ctx, s, ev, id, "drop", p, { reason: "cost" });
      s.resolving = { card: info.card, player: p };
      s.flow.unshift({ op: "counter", window: "play", responder: other(p) }, { op: "play.resolve", card: info.card, player: p });
      return "done";
    }
    case "aegis": {
      const info = s.continuations.aegis as { card: string; colors: Color[] };
      delete s.continuations.aegis;
      // 22-30-3: the cards dropped have to cover every colour named. Chosen
      // wrongly, the cost is not paid and nothing happens — the orbs are gone,
      // which is the price of a mistake the rules do not let you take back.
      if (!chosen.length || !canCoverColors(ctx, s, chosen, info.colors)) {
        note(ev, "Aegis: the cards dropped did not cover the colours, so nothing happened");
        return "done";
      }
      for (const id of chosen) move(ctx, s, ev, id, "drop", p, { reason: "cost" });
      // 22-30-5: up to two energy from Rest to Active.
      const rested = s.players[p].energy.filter((id) => s.cards[id].mode === "rest");
      if (!rested.length) return "done";
      s.flow.unshift(
        { op: "prompt", prompt: { kind: "chooseCards", player: p, choice: { reason: "Aegis: energy to switch to Active Mode", candidates: rested, min: 0, max: 2, continuation: "aegisEnergy" } } },
        { op: "choose.apply", what: "aegisEnergy", card: info.card, player: p },
      );
      return "done";
    }
    case "aegisEnergy": {
      for (const id of chosen) setMode(s, ev, id, "active", ctx);
      return "done";
    }
    case "alliance": {
      const info = s.continuations.alliance as { card: string; skillIndex: number; trigger?: Trigger };
      delete s.continuations.alliance;
      if (!chosen.length) return "done"; // 22-32-3: may
      for (const id of chosen) setMode(s, ev, id, "rest", ctx);
      const sk = skillsOfInstance(ctx, s, info.card).find((x) => x.index === info.skillIndex);
      if (!sk) return "done";
      ev.push({ type: "skill", card: info.card, skill: sk.index, master: p, text: sk.raw });
      return runSkill(ctx, s, ev, info.card, sk, p, info.trigger, undefined, { rested: chosen });
    }
    case "revive": {
      const info = s.continuations.revive as { card: string; colors: Color[] };
      delete s.continuations.revive;
      if (!chosen.length) return "done"; // 22-34-3: may, not must
      if (!canCoverColors(ctx, s, chosen, info.colors)) {
        note(ev, "Revive: the cards chosen did not cover the colours, so it stays in the Drop");
        return "done";
      }
      if (areaOf(s, info.card) !== "drop") return "done";
      for (const id of chosen) move(ctx, s, ev, id, "drop", p, { reason: "cost" });
      // 22-34-4: played from the Drop, and no second Revive this turn.
      s.continuations[`revived:${info.card}`] = s.turn;
      s.resolving = { card: info.card, player: p };
      s.flow.unshift({ op: "counter", window: "play", responder: other(p) }, { op: "play.resolve", card: info.card, player: p });
      return "done";
    }
    case "swap": {
      const info = s.continuations.swap as { card: string };
      delete s.continuations.swap;
      move(ctx, s, ev, info.card, "hand", p, { reason: "cost" });
      const target = chosen[0];
      if (target) {
        s.flow.unshift({ op: "counter", window: "play", responder: other(p) }, { op: "play.resolve", card: target, player: p });
        s.resolving = { card: target, player: p };
      }
      return "done";
    }
  }
}

/** Place `top` on `bottom` in the Battle Area: bottom's slot, mode, markers, under-stack and power effects carry over (21-5-2, 23-2). */
function stackOnto(ctx: EngineContext, s: GameState, ev: GameEvent[], top: string, bottom: string, p: PlayerId): void {
  const ps = s.players[p];
  const bi = s.cards[bottom];
  const ti = s.cards[top];
  const slot = ps.battle.indexOf(bottom);
  const from = areaOf(s, top);
  // Detach the top card from wherever it was without the "new card" reset yet.
  const l = ps[from as "hand" | "drop" | "deck"] as string[] | undefined;
  if (l) l.splice(l.indexOf(top), 1);
  ps.battle[slot] = top;
  ti.mode = bi.mode;
  ti.enteredTurn = s.turn;
  ti.under = [bottom, ...bi.under.splice(0)];
  bi.mode = "active";
  for (const e of s.effects) if (e.target === bottom && e.kind === "power") e.target = top;
  s.effects = s.effects.filter((e) => e.target !== bottom);
  if (s.battle) {
    if (s.battle.attacker === bottom) s.battle.attacker = top;
    if (s.battle.guard === bottom) s.battle.guard = top;
  }
  ev.push({ type: "move", card: top, from: from ?? "hand", to: "battle", owner: p, reveal: true });
  ev.push({ type: "stack", top, under: ti.under.slice() });
}

// ── legal actions ──────────────────────────────────────────────────────────

export interface LegalAction {
  action: Action;
  /** One line for menus and Claude: "Play Son Goku (3)". */
  label: string;
}

export function legalActions(ctx: EngineContext, s: GameState): LegalAction[] {
  const pr = s.prompt;
  const out: LegalAction[] = [];
  const name = (id: string) => face(ctx, s, id).name;
  switch (pr.kind) {
    case "gameOver":
      return out;
    case "chooseFirst":
      for (const first of PLAYERS) out.push({ action: { type: "chooseFirst", player: pr.player, first }, label: first === pr.player ? "Go first" : "Go second" });
      return out;
    case "mulligan":
      out.push({ action: { type: "mulligan", player: pr.player, redraw: false }, label: "Keep hand" });
      out.push({ action: { type: "mulligan", player: pr.player, redraw: true }, label: "Mulligan" });
      return out;
    case "charge":
      // 20-14: a player forbidden to place energy is only offered the skip.
      if (!forbids(ctx, s, "placeEnergy", { player: pr.player }))
        for (const id of s.players[pr.player].hand) out.push({ action: { type: "charge", player: pr.player, card: id }, label: `Charge ${name(id)}` });
      out.push({ action: { type: "charge", player: pr.player, card: null }, label: "Skip charge" });
      return out;
    case "main":
      return mainActions(ctx, s, pr.player);
    case "combo": {
      const p = pr.player;
      const b = s.battle!;
      for (const id of s.players[p].hand) {
        const d = def(ctx, s, id);
        if (canCombo(d) && !forbids(ctx, s, "combo", { player: p, card: id }) && planPayment(ctx, s, p, comboCostOf(ctx, s, id), {})) out.push({ action: { type: "combo", player: p, card: id }, label: `Combo ${name(id)} from hand (+${comboPowerOf(ctx, s, id)}, cost ${comboCostOf(ctx, s, id)})` });
      }
      for (const id of s.players[p].battle) {
        if (id === b.attacker || id === b.guard || s.cards[id].mode !== "active" || s.cards[id].hidden) continue;
        const d = def(ctx, s, id);
        // 5-7-3: the combo cost is paid whether the card comes from hand or from the Battle Area.
        if (canCombo(d) && !forbids(ctx, s, "combo", { player: p, card: id }) && planPayment(ctx, s, p, comboCostOf(ctx, s, id), {}))
          out.push({ action: { type: "combo", player: p, card: id }, label: `Combo ${name(id)} from the Battle Area (+${comboPowerOf(ctx, s, id)}, cost ${comboCostOf(ctx, s, id)})` });
      }
      // [Activate: Battle] skills, and the keywords that work like one
      // ([Arrival] from hand, [Aegis] on the defence).
      for (const id of s.players[p].hand) {
        for (const sk of skillsOf(def(ctx, s, id))) {
          const act = activatable(ctx, s, p, id, sk, "battle");
          if (act) out.push({ action: { type: "activate", player: p, card: id, skill: sk.index }, label: act });
          const viaAlt = activatable(ctx, s, p, id, sk, "battle", true);
          if (viaAlt) out.push({ action: { type: "activate", player: p, card: id, skill: sk.index, alt: true }, label: viaAlt });
        }
      }
      for (const id of cardsInPlay(s, p)) {
        for (const sk of skillsOfInstance(ctx, s, id)) {
          const act = activatable(ctx, s, p, id, sk, "battle");
          if (act) out.push({ action: { type: "activate", player: p, card: id, skill: sk.index }, label: act });
        }
      }
      out.push({ action: { type: "pass", player: p }, label: pr.side === "offense" ? "End Offense Step" : "End Defense Step" });
      return out;
    }
    case "blocker":
      for (const id of pr.candidates) out.push({ action: { type: "block", player: pr.player, card: id }, label: `Block with ${name(id)}` });
      out.push({ action: { type: "block", player: pr.player, card: null }, label: "Don't block" });
      return out;
    case "counter":
      for (const id of pr.candidates) {
        const sk = skillsOf(def(ctx, s, id)).find((k) => k.kind.startsWith("counter:"));
        const cost = playCost(ctx, s, id);
        const orbs = sk ? orbTotals(sk) : { total: 0 };
        if (planPayment(ctx, s, pr.player, cost.total + orbs.total, cost.specified)) {
          out.push({ action: { type: "counter", player: pr.player, card: id, skill: sk?.index }, label: `Counter with ${name(id)}` });
        }
        // 5-3: the printed alternative is a second, separate offer — paying it
        // is a different decision, not a cheaper version of the same one.
        const alt = altCostFor(ctx, s, id, pr.player);
        if (alt) {
          const how = alt.pay === "none" ? "for no energy" : alt.pay === "invoker" ? "by resting a Red/Blue energy ([Invoker])" : `by adding ${alt.n} from your life to your hand`;
          out.push({ action: { type: "counter", player: pr.player, card: id, skill: sk?.index, alt: true }, label: `Counter with ${name(id)} (${how})` });
        }
      }
      out.push({ action: { type: "counter", player: pr.player, card: null }, label: "No counter" });
      return out;
    case "zEnergyFromCombo":
      for (const id of pr.candidates) out.push({ action: { type: "zEnergyFromCombo", player: pr.player, card: id }, label: `${name(id)} → Z-Energy` });
      out.push({ action: { type: "zEnergyFromCombo", player: pr.player, card: null }, label: "Combo cards to Drop" });
      return out;
    case "offering":
      out.push({ action: { type: "offering", player: pr.player, dropLife: true }, label: "Drop 1 life (deny the draw)" });
      out.push({ action: { type: "offering", player: pr.player, dropLife: false }, label: "Keep life (opponent draws 2)" });
      return out;
    case "chooseCards":
      for (const id of pr.choice.candidates) out.push({ action: { type: "choose", player: pr.player, cards: [id] }, label: `Choose ${name(id)}` });
      if (pr.choice.min === 0) out.push({ action: { type: "choose", player: pr.player, cards: [] }, label: s.continuations[`picking:${pr.choice.continuation}`] ? "Done choosing" : "Choose none" });
      return out;
    case "chooseMode":
      // 20-2: the printed options, in the order they are printed.
      pr.options.forEach((label, i) => out.push({ action: { type: "chooseMode", player: pr.player, index: i }, label: label.length > 90 ? `${label.slice(0, 88)}…` : label }));
      return out;
    case "optionalCost":
      // 9-6-4: an [Auto] skill's cost may be declined, and then it does not resolve.
      out.push({ action: { type: "optionalCost", player: pr.player, pay: true }, label: `Pay: ${pr.describe}` });
      out.push({ action: { type: "optionalCost", player: pr.player, pay: false }, label: "Don't pay (the skill does not resolve)" });
      return out;
    case "payCost":
      // 3-8-2: which energy to rest, asked only when the colours left would differ.
      pr.options.forEach((o, i) => out.push({ action: { type: "payCost", player: pr.player, option: i }, label: `Rest ${describePayment(ctx, s, o)}` }));
      return out;
    case "referee":
      // Answered by the server with a ruling, not by a player.
      return out;
    case "orderPending":
      pr.candidates.forEach((idx, i) => {
        const p = s.pending[idx];
        const sk = p ? skillsOfInstance(ctx, s, p.card).find((k) => k.index === p.skillIndex) : null;
        out.push({ action: { type: "orderPending", player: pr.player, index: idx }, label: `Resolve ${p ? name(p.card) : `#${i}`}${sk ? `: ${sk.effect.slice(0, 40)}` : ""}` });
      });
      return out;
  }
}

function mainActions(ctx: EngineContext, s: GameState, p: PlayerId): LegalAction[] {
  const out: LegalAction[] = [];
  const ps = s.players[p];
  const name = (id: string) => face(ctx, s, id).name;
  const energyCount = activeEnergy(s, p).length + ps.energyMarkers;

  for (const id of ps.hand) {
    const d = def(ctx, s, id);
    const bt = baseType(d);
    if (bt === "BATTLE" && d.energyCost !== "X") {
      if (planPayment(ctx, s, p, playCost(ctx, s, id).total, playCost(ctx, s, id).specified) && canPlay(ctx, s, p, id)) out.push({ action: { type: "play", player: p, card: id }, label: `Play ${name(id)} (${d.energyCost ?? 0})` });
      // 5-3: a card may print another price for playing it, which is often the
      // only reason it is playable at all.
      const alt = canPlay(ctx, s, p, id) ? altCostFor(ctx, s, id, p, "play") : null;
      if (alt) {
        const how = alt.pay === "none" ? "for no energy" : `by adding ${alt.n} from your life to your hand`;
        out.push({ action: { type: "play", player: p, card: id, alt: true }, label: `Play ${name(id)} (${how})` });
      }
    }
    // 1-2-2-2-1: with an X cost the card's master picks the value.
    if (bt === "BATTLE" && d.energyCost === "X" && canPlay(ctx, s, p, id)) {
      for (let x = 0; x <= energyCount; x++) if (planPayment(ctx, s, p, x, {})) out.push({ action: { type: "play", player: p, card: id, x }, label: `Play ${name(id)} with X = ${x}` });
    }
    if (bt === "UNISON" && !isZ(d) && canPlay(ctx, s, p, id)) {
      const max = d.energyCost === "X" ? energyCount : (d.energyCost ?? 0);
      const min = d.energyCost === "X" ? 1 : (d.energyCost ?? 0);
      for (let x = min; x <= max; x++) if (planPayment(ctx, s, p, x, {})) out.push({ action: { type: "playUnison", player: p, card: id, x }, label: `Play Unison ${name(id)} with ${x} marker${x === 1 ? "" : "s"}` });
    }
    // Keyword [Activate : Main] skills from hand and Extras with a native effect.
    for (const sk of skillsOf(d)) {
      const act = activatable(ctx, s, p, id, sk, "main");
      if (act) out.push({ action: { type: "activate", player: p, card: id, skill: sk.index }, label: act });
      const viaAlt = activatable(ctx, s, p, id, sk, "main", true);
      if (viaAlt) out.push({ action: { type: "activate", player: p, card: id, skill: sk.index, alt: true }, label: viaAlt });
    }
  }
  // Skills on cards in play.
  for (const id of cardsInPlay(s, p)) {
    for (const sk of skillsOfInstance(ctx, s, id)) {
      const act = activatable(ctx, s, p, id, sk, "main");
      if (act) out.push({ action: { type: "activate", player: p, card: id, skill: sk.index }, label: act });
    }
  }
  // 13-3: Unison growth.
  if (ps.unison && !ps.grewUnisonThisTurn) {
    const uc = s.cards[ps.unison].cardId;
    const same = ps.hand.find((id) => s.cards[id].cardId === uc);
    if (same) out.push({ action: { type: "growUnison", player: p, card: same }, label: `Grow ${name(ps.unison)} (+1 marker)` });
  }
  // Z-cards from the Z-Deck (16-2, 17-2, 18-2).
  for (const id of ps.zDeck) {
    const d = def(ctx, s, id);
    if (!isZ(d) || d.type === "Z-LEADER") continue; // 6-1-4: only Z-cards; Z-Leaders enter via [Z-Awaken]
    if (!canPlay(ctx, s, p, id)) continue; // 20-14
    const zc = d.zEnergyCost ?? 0;
    if (ps.zEnergy.length < zc) continue;
    if (d.type === "Z-UNISON") {
      const max = d.energyCost === "X" ? energyCount : (d.energyCost ?? 0);
      for (let x = d.energyCost === "X" ? 1 : max; x <= max; x++) if (planPayment(ctx, s, p, x, {})) out.push({ action: { type: "playZ", player: p, card: id, x }, label: `Play Z-Unison ${name(id)} with ${x} markers` });
      continue;
    }
    const c = playCost(ctx, s, id);
    if (planPayment(ctx, s, p, c.total, c.specified)) out.push({ action: { type: "playZ", player: p, card: id }, label: `Play ${d.type === "Z-EXTRA" ? "Z-Extra" : "Z-Battle"} ${name(id)} (${c.total}, Z${zc})` });
  }
  // 8-1: attacks — not on the first player's first turn (7-3-4-4-1).
  if (!(s.turn === 1 && p === s.firstPlayer)) {
    const opp = other(p);
    const targets = [s.players[opp].leader, ...(s.players[opp].unison ? [s.players[opp].unison] : []), ...s.players[opp].battle.filter((id) => s.cards[id].mode === "rest")];
    for (const a of cardsInPlay(s, p)) {
      if (s.cards[a].mode !== "active" || s.cards[a].hidden) continue;
      if (forbids(ctx, s, "attack", { player: p, card: a })) continue;
      for (const t of targets) {
        if (forbids(ctx, s, "beAttacked", { player: opp, card: t })) continue;
        out.push({ action: { type: "attack", player: p, attacker: a, target: t }, label: `Attack ${name(t)} with ${name(a)} (${powerOf(ctx, s, a)} vs ${powerOf(ctx, s, t)})` });
      }
    }
  }
  out.push({ action: { type: "endMain", player: p }, label: "End turn" });
  return out;
}

/**
 * Whether this card may be played at all: 22-39 ([Unique] of the same name in
 * play) and 20-14 (anything that forbids playing it). Asked in both places a
 * play can start — the menu and `apply` — so the two never disagree.
 */
function canPlay(ctx: EngineContext, s: GameState, p: PlayerId, card: string): boolean {
  const d = def(ctx, s, card);
  if (s.players[p].battle.some((id) => has(ctx, s, id, "Unique") && face(ctx, s, id).name === d.name)) return false;
  return !forbids(ctx, s, "play", { player: p, card });
}

/**
 * Whether a skill can be declared now, and its menu label. Only skills the
 * engine can pay for *and* resolve are offered: keyword skills with native
 * rules, plus text skills whose cost is orbs only and whose effect the native
 * resolver reads. Everything else waits for compiled scripts / the referee.
 */
function activatable(ctx: EngineContext, s: GameState, p: PlayerId, card: string, sk: Skill, timing: "main" | "battle", alt = false): string | null {
  const d = def(ctx, s, card);
  const inst = s.cards[card];
  const inHand = areaOf(s, card) === "hand";
  const name = face(ctx, s, card).name;
  if (skillNegated(s, card, sk.index)) return null;
  // 20-14: a skill nothing forbids, on a card nothing forbids it on.
  if (forbids(ctx, s, "activateSkill", { player: p, card })) return null;
  if (sk.oncePerTurn && inst.usedThisTurn.includes(sk.index)) return null;
  if (sk.bond != null && s.players[p].battle.length < sk.bond) return null;
  if (sk.sparking != null && s.players[p].drop.length < sk.sparking) return null;
  // 22-27 / 22-43: a [Burst] or [Spirit Boost] tag is part of the cost.
  if (!canPayKeywordCosts(s, p, sk)) return null;
  const k = sk.keyword;
  const orbCost = sk.energyCost;
  const orbTotal = Object.entries(orbCost).reduce((n, [c, v]) => n + (c === "any" ? 0 : (v ?? 0)), 0) + (orbCost.any ?? 0);
  const orbSpecified = Object.fromEntries(Object.entries(orbCost).filter(([c]) => c !== "any")) as Partial<Record<string, number>>;
  const canPayOrbs = () => planPayment(ctx, s, p, orbTotal, orbSpecified as never) !== null;
  const costIsOrbsOnly = /^[\s{}\w,/]*$/.test(sk.cost) && !/[a-z]{4,}/i.test(sk.cost.replace(/\{[^}]*\}/g, ""));

  if (k) {
    switch (k.name) {
      case "Awaken":
      case "Wish": {
        if (timing !== "main" && timing !== "battle") return null;
        if (areaOf(s, card) !== "leader" || inst.flipped || !d.back) return null;
        const cond = parseCondition(sk.cost);
        if (!cond.recognised) return null;
        if (!conditionHolds(ctx, s, p, cond)) return null;
        return `${k.name}: ${name} → ${d.back.name}`;
      }
      case "Evolve": {
        if (timing !== "main" || !inHand || !costIsOrbsOnly || !canPayOrbs()) return null;
        const filter = parseFilter(sk.effect || sk.cost);
        if (!s.players[p].battle.some((id) => matches(cardNow(ctx, s, id), filter))) return null;
        return `${k.variant} ${name} onto a ${sk.effect || sk.cost}`;
      }
      case "Union": {
        if (timing !== "main" || !costIsOrbsOnly || !canPayOrbs()) return null;
        if (k.variant === "Absorb") return null; // needs the effect text
        if (!inHand) return null;
        const names = (sk.effect || sk.cost).match(/<([^>]+)>/g)?.map((x) => x.slice(1, -1)) ?? [];
        if (names.length < 2) return null;
        const pool = k.variant === "Fusion" ? s.players[p].hand.filter((id) => id !== card) : s.players[p].battle;
        const found = names.map((n) => pool.find((id) => def(ctx, s, id).characters.some((c) => c.toLowerCase() === n.toLowerCase())));
        if (found.some((f) => !f) || new Set(found).size < names.length) return null;
        if (k.variant === "Fusion" && new Set(found.map((f) => def(ctx, s, f!).power)).size !== 1) return null; // equal power
        return `Union-${k.variant} ${name}`;
      }
      case "Over Realm": {
        if (timing !== "main" || !inHand) return null;
        const ps = s.players[p];
        const limit = cardsInPlay(s, p).some((id) => has(ctx, s, id, "Wormhole")) ? 2 : 1;
        if (ps.overRealmsThisTurn >= limit) return null;
        const count = k.dark ? ps.drop.filter((id) => def(ctx, s, id).colors.includes("Black")).length : ps.drop.length;
        if (count < k.x) return null;
        if (!costIsOrbsOnly || !canPayOrbs()) return null;
        return `${k.dark ? "Dark " : ""}Over Realm ${k.x}: play ${name} (Drop → Warp)`;
      }
      case "Swap": {
        if (timing !== "main" || areaOf(s, card) !== "battle" || !costIsOrbsOnly || !canPayOrbs()) return null;
        return `Swap ${name} for a cost-${k.x} card from hand`;
      }
      case "Arrival": {
        // 22-29: [Activate: Battle], from hand only, when the original colours
        // of the Battle Cards in your Combo Area cover every colour it names.
        if (timing !== "battle" || !inHand) return null;
        const combo = s.players[p].combo.map((id) => cardNow(ctx, s, id).colors);
        if (!k.colors.every((c) => combo.some((cs) => cs.includes(c)))) return null;
        if (!canPayOrbs()) return null;
        return `Arrival ${k.colors.join("/")}: play ${name}`;
      }
      case "Successor": {
        // 22-38: from hand, in the Main Phase, by dropping green/yellow Battle
        // Cards whose energy costs add up to this card's original cost.
        if (timing !== "main" || !inHand || !costIsOrbsOnly || !canPayOrbs()) return null;
        const need = costOf(d);
        if (need <= 0) return null;
        const costs = successorPool(ctx, s, p).map((id) => costOf(def(ctx, s, id)));
        if (!subsetSumExists(costs, need)) return null;
        return `Successor: play ${name} by dropping ${need} worth of green/yellow Battle Cards`;
      }
      case "Aegis": {
        // 22-30-4: only in the Defense Step of your opponent's turn, and the
        // colours it names have to be there in your hand to drop.
        if (timing !== "battle" || s.turnPlayer === p || s.battle?.step !== "defense") return null;
        if (!inPlay(s, card)) return null;
        if (!canCoverColors(ctx, s, s.players[p].hand, k.colors)) return null;
        if (!costIsOrbsOnly || !canPayOrbs()) return null;
        return `Aegis ${k.colors.join("/")}: drop ${k.colors.join(" and ")} from hand, stand up to 2 energy`;
      }
      case "Rejuvenate": {
        // 22-42: a Unison with cards beneath it drops one of them and pays the
        // printed marker cost; the top card of the deck becomes life.
        if (timing !== "main" || areaOf(s, card) !== "unison" || inst.under.length === 0) return null;
        const cost = rejuvenateCost(sk);
        if (!cost || inst.markers < cost.markers || inst.usedMarkerSkill) return null;
        if (cost.lifeAtMost != null && s.players[p].life.length > cost.lifeAtMost) return null;
        return `Rejuvenate: ${cost.markers} marker${cost.markers === 1 ? "" : "s"} and a card from under ${name} → +1 life`;
      }
      case "Overlord": {
        if (timing !== "main" || !s.players[p].battle.some((id) => has(ctx, s, id, "Servant"))) return null;
        return `Overlord: return a Servant to the deck, draw 1`;
      }
      case "Field": {
        if (timing !== "main" || !inHand || baseType(d) !== "EXTRA") return null;
        const c = playCost(ctx, s, card);
        if (!planPayment(ctx, s, p, c.total, c.specified)) return null;
        return `Field: place ${name} (${c.total})`;
      }
      case "Z-Awaken": {
        if (timing !== "main" || areaOf(s, card) !== "zDeck") return null;
        const ps = s.players[p];
        if (ps.zAwakenedThisTurn) return null;
        const leader = ps.leader;
        if (!leader || !s.cards[leader].flipped || isZ(def(ctx, s, leader))) return null;
        const filter = parseFilter(sk.effect || sk.cost);
        if (!matches(cardNow(ctx, s, leader), filter) && !(filter.characters.length && def(ctx, s, leader).characters.some((c) => filter.characters.includes(c)))) return null;
        if (ps.zEnergy.length < (d.zEnergyCost ?? 0)) return null;
        if (!costIsOrbsOnly || !canPayOrbs()) return null;
        return `Z-Awaken: ${name} on ${face(ctx, s, leader).name}`;
      }
      default:
        return null;
    }
  }

  // Text [Activate] skills: only when the cost is orbs only and the effect is natively readable.
  const kindOk = timing === "main" ? sk.kind === "activate:main" || sk.kind === "activate:main/battle" : sk.kind === "activate:battle" || sk.kind === "activate:main/battle";
  if (!kindOk) return null;
  // 13-4: a marker skill cost is only payable in the Unison Area, needs the
  // markers to remove, and locks that card's marker skills for the turn.
  if (sk.markerCost != null) {
    if (areaOf(s, card) !== "unison") return null;
    if (inst.usedMarkerSkill) return null;
    if (inst.markers + sk.markerCost < 0) return null;
  }
  // "[Activate: Main] If your Leader Card is red: Draw 1 card" — a cost that
  // is only a condition (9-1-3) is a skill that can be used when it holds.
  const condCost = !costIsOrbsOnly && /^(?:if|when|while|during)\b/i.test(sk.cost) ? parseConditionClause(sk.cost) : null;
  if (!costIsOrbsOnly && !condCost) return null;
  if (condCost && !condHolds(ctx, s, { ops: [], ip: 0, vars: {}, card, master: p }, condCost.cond)) return null;
  if (!canPayOrbs()) return null;
  if (!canResolve(ctx, s, card, sk)) return null;
  if (baseType(d) === "EXTRA" && inHand) {
    if (alt) {
      // 5-3 / 22-37: the printed alternative to the energy cost is its own
      // offer; the skill's orbs are still paid.
      if (!altCostFor(ctx, s, card, p, "play") || !planPayment(ctx, s, p, orbTotal, {})) return null;
      return `Activate ${name} by resting a Red/Blue energy ([Invoker])`;
    }
    const c = playCost(ctx, s, card);
    if (!planPayment(ctx, s, p, c.total + orbTotal, c.specified)) return null;
    return `Activate ${name} (${c.total})`;
  }
  if (alt) return null;
  if (inHand) return null; // 9-1-3-1: battle card skills are valid in the Battle Area
  return `Activate ${name}: ${sk.effect.slice(0, 40)}`;
}

function conditionHolds(ctx: EngineContext, s: GameState, p: PlayerId, c: ReturnType<typeof parseCondition>): boolean {
  const ps = s.players[p];
  if (c.lifeAtMost != null && ps.life.length > c.lifeAtMost) return false;
  if (c.opponentLifeAtMost != null && s.players[other(p)].life.length > c.opponentLifeAtMost) return false;
  if (c.energyAtLeast != null && ps.energy.length < c.energyAtLeast) return false;
  if (c.totalEnergyAtLeast != null && ps.energy.length + s.players[other(p)].energy.length < c.totalEnergyAtLeast) return false;
  if (c.dropAtLeast != null && ps.drop.length < c.dropAtLeast) return false;
  return true;
}

// ── apply ──────────────────────────────────────────────────────────────────

export class IllegalAction extends Error {}

function clone<T>(x: T): T {
  return structuredClone(x);
}

/** Apply one action. Throws `IllegalAction` when it is not the asked player's or not legal. */
export function apply(ctx: EngineContext, prev: GameState, action: Action): Applied {
  const s = clone(prev);
  // Games saved before delayed effects existed have no list; give them one
  // rather than letting the first scheduled effect throw.
  if (!s.delayed) {
    s.delayed = [];
    s.nextDelayedId = 1;
  }
  const ev: GameEvent[] = [{ type: "action", action }];
  const pr = s.prompt;
  if (action.type === "concede") {
    gameOver(s, ev, other(action.player), `${s.players[action.player].name} conceded`);
    return { state: s, events: ev };
  }
  if (pr.kind === "gameOver") throw new IllegalAction("the game is over");
  if ("player" in pr && pr.player !== action.player) throw new IllegalAction(`it is ${pr.player}'s decision, not ${action.player}'s`);
  const p = action.player;
  const ps = s.players[p];

  switch (action.type) {
    case "chooseFirst": {
      if (pr.kind !== "chooseFirst") throw new IllegalAction("not choosing who goes first");
      s.firstPlayer = action.first;
      s.turnPlayer = action.first;
      s.flow.unshift({ op: "checkpoint" }, { op: "setup.afterFirst" });
      break;
    }
    case "mulligan": {
      if (pr.kind !== "mulligan") throw new IllegalAction("no mulligan pending");
      if (action.redraw && !ps.mulliganed) {
        ps.mulliganed = true;
        for (const id of ps.hand.slice()) move(ctx, s, ev, id, "deck", p, { position: "bottom" });
        const r = shuffle(ps.deck, s.rngState);
        ps.deck = r.items;
        s.rngState = r.state;
        draw(ctx, s, ev, p, OPENING_HAND);
      }
      break;
    }
    case "charge": {
      if (pr.kind !== "charge") throw new IllegalAction("not the charge step");
      if (action.card) {
        if (!ps.hand.includes(action.card)) throw new IllegalAction("card not in hand");
        // 20-14: "you can't place cards in your energy for the turn".
        if (forbids(ctx, s, "placeEnergy", { player: p })) throw new IllegalAction("you can't place cards in your energy");
        move(ctx, s, ev, action.card, "energy", p, { reason: "charge", reveal: true });
      }
      s.flow.unshift({ op: "checkpoint" }, { op: "turn.mainStart" });
      break;
    }
    case "play": {
      requireMain(s, p);
      if (!ps.hand.includes(action.card)) throw new IllegalAction("card not in hand");
      const d = def(ctx, s, action.card);
      if (baseType(d) !== "BATTLE") throw new IllegalAction("not a playable Battle Card");
      if (!canPlay(ctx, s, p, action.card)) throw new IllegalAction("that card can't be played now");
      // 5-3: the card may print another price for playing it.
      if (action.alt) {
        const alt = altCostFor(ctx, s, action.card, p, "play");
        if (!alt) throw new IllegalAction("that card has no other price to pay");
        if (!payAltCost(ctx, s, ev, p, alt)) throw new IllegalAction("can't pay that price");
      } else {
        const c = d.energyCost === "X" ? { total: action.x ?? 0, specified: {} } : playCost(ctx, s, action.card);
        const asked = askForPayment(ctx, s, p, action, c.total, c.specified, `play ${face(ctx, s, action.card).name}`);
        if (asked) return { state: asked, events: ev };
        const pm = planPayment(ctx, s, p, c.total, c.specified, action.pay);
        if (!pm) throw new IllegalAction("can't pay the energy cost");
        pay(s, ev, p, pm);
      }
      s.resolving = { card: action.card, player: p };
      s.flow.unshift({ op: "counter", window: "play", responder: other(p) }, { op: "play.resolve", card: action.card, player: p }, { op: "turn.promptMain" });
      break;
    }
    case "playUnison": {
      requireMain(s, p);
      if (!ps.hand.includes(action.card)) throw new IllegalAction("card not in hand");
      const d = def(ctx, s, action.card);
      if (baseType(d) !== "UNISON") throw new IllegalAction("not a Unison card");
      if (!canPlay(ctx, s, p, action.card)) throw new IllegalAction("that card can't be played now");
      const x = d.energyCost === "X" ? action.x : (d.energyCost ?? 0);
      if (d.energyCost === "X" && x < 1) throw new IllegalAction("X must be at least 1");
      const askedUnison = askForPayment(ctx, s, p, action, x, {}, `play ${face(ctx, s, action.card).name}`);
      if (askedUnison) return { state: askedUnison, events: ev };
      const pm = planPayment(ctx, s, p, x, {}, action.pay);
      if (!pm) throw new IllegalAction("can't pay the energy cost");
      pay(s, ev, p, pm);
      s.resolving = { card: action.card, player: p };
      s.flow.unshift({ op: "counter", window: "play", responder: other(p) }, { op: "play.resolve", card: action.card, player: p, markers: pm.rest.length + pm.markers }, { op: "turn.promptMain" });
      break;
    }
    case "playZ": {
      requireMain(s, p);
      if (!ps.zDeck.includes(action.card)) throw new IllegalAction("card not in the Z-Deck");
      const d = def(ctx, s, action.card);
      if (!isZ(d)) throw new IllegalAction("only Z-cards can be played from the Z-Deck");
      if (d.type === "Z-LEADER") throw new IllegalAction("Z-Leaders enter through [Z-Awaken]");
      if (!canPlay(ctx, s, p, action.card)) throw new IllegalAction("that card can't be played now");
      const x = d.energyCost === "X" ? (action.x ?? 0) : (d.energyCost ?? 0);
      const c = d.energyCost === "X" ? { total: x, specified: {} } : playCost(ctx, s, action.card);
      const askedZ = askForPayment(ctx, s, p, action, c.total, c.specified, `play ${face(ctx, s, action.card).name}`);
      if (askedZ) return { state: askedZ, events: ev };
      const pm = planPayment(ctx, s, p, c.total, c.specified, action.pay);
      if (!pm) throw new IllegalAction("can't pay the energy cost");
      if (!payZEnergy(ctx, s, ev, p, d.zEnergyCost ?? 0)) throw new IllegalAction("can't pay the Z-Energy cost");
      pay(s, ev, p, pm);
      s.resolving = { card: action.card, player: p };
      s.flow.unshift({ op: "counter", window: "play", responder: other(p) }, { op: "play.resolve", card: action.card, player: p, markers: d.type === "Z-UNISON" ? pm.rest.length + pm.markers : undefined }, { op: "turn.promptMain" });
      break;
    }
    case "growUnison": {
      requireMain(s, p);
      if (!ps.unison || ps.grewUnisonThisTurn) throw new IllegalAction("can't grow now");
      if (!ps.hand.includes(action.card) || s.cards[action.card].cardId !== s.cards[ps.unison].cardId) throw new IllegalAction("needs a copy of the Unison in hand");
      ps.grewUnisonThisTurn = true;
      ps.hand.splice(ps.hand.indexOf(action.card), 1);
      s.cards[ps.unison].under.push(action.card);
      s.cards[ps.unison].markers++;
      ev.push({ type: "stack", top: ps.unison, under: s.cards[ps.unison].under.slice() });
      ev.push({ type: "markers", card: ps.unison, delta: 1, total: s.cards[ps.unison].markers });
      s.flow.unshift({ op: "checkpoint" }, { op: "turn.promptMain" });
      break;
    }
    case "activate": {
      const timing = pr.kind === "main" ? "main" : pr.kind === "combo" ? "battle" : null;
      if (!timing) throw new IllegalAction("no skill can be activated now");
      const skills = areaOf(s, action.card) === "hand" || areaOf(s, action.card) === "zDeck" ? skillsOf(def(ctx, s, action.card)) : skillsOfInstance(ctx, s, action.card);
      const sk = skills.find((k) => k.index === action.skill);
      if (!sk) throw new IllegalAction("no such skill");
      const label = activatable(ctx, s, p, action.card, sk, timing, !!action.alt);
      if (!label) throw new IllegalAction("that skill can't be activated now");
      activate(ctx, s, ev, p, action.card, sk, action.pay, !!action.alt);
      s.flow.push(timing === "main" ? { op: "turn.promptMain" } : { op: "battle.promptCombo", side: pr.kind === "combo" ? pr.side : "offense" });
      break;
    }
    case "attack": {
      requireMain(s, p);
      const legal = mainActions(ctx, s, p).some((a) => a.action.type === "attack" && a.action.attacker === action.attacker && a.action.target === action.target);
      if (!legal) throw new IllegalAction("illegal attack");
      setMode(s, ev, action.attacker, "rest");
      s.battle = { attacker: action.attacker, guard: action.target, target: action.target, step: "declared", negated: false, blockerOffered: false, revenge: false, reactivate: false };
      ev.push({ type: "attack", attacker: action.attacker, target: action.target });
      s.flow.unshift({ op: "battle.afterDeclare" });
      break;
    }
    case "endMain": {
      requireMain(s, p);
      s.flow.unshift({ op: "turn.mainEnd" });
      break;
    }
    case "combo": {
      if (pr.kind !== "combo") throw new IllegalAction("not a combo step");
      const b = s.battle!;
      const d = def(ctx, s, action.card);
      if (!canCombo(d)) throw new IllegalAction("that card can't be used in a combo");
      if (forbids(ctx, s, "combo", { player: p, card: action.card })) throw new IllegalAction("that card can't be used in a combo now");
      const fromHand = ps.hand.includes(action.card);
      const fromBattle = ps.battle.includes(action.card) && s.cards[action.card].mode === "active" && action.card !== b.attacker && action.card !== b.guard;
      if (!fromHand && !fromBattle) throw new IllegalAction("card not available for a combo");
      const askedCombo = askForPayment(ctx, s, p, action, comboCostOf(ctx, s, action.card), {}, `combo ${face(ctx, s, action.card).name}`);
      if (askedCombo) return { state: askedCombo, events: ev };
      const pm = planPayment(ctx, s, p, comboCostOf(ctx, s, action.card), {}, action.pay);
      if (!pm) throw new IllegalAction("can't pay the combo cost");
      pay(s, ev, p, pm);
      move(ctx, s, ev, action.card, "combo", p, { reason: "combo", reveal: true });
      s.flow.unshift({ op: "checkpoint" }, { op: "battle.promptCombo", side: pr.side });
      break;
    }
    case "pass": {
      if (pr.kind !== "combo") throw new IllegalAction("nothing to pass");
      s.flow.unshift(pr.side === "offense" ? { op: "battle.defense" } : { op: "battle.damage" });
      break;
    }
    case "block": {
      if (pr.kind !== "blocker") throw new IllegalAction("no blocker decision pending");
      if (action.card) {
        if (!pr.candidates.includes(action.card)) throw new IllegalAction("that card can't block");
        setMode(s, ev, action.card, "rest");
        s.battle!.guard = action.card;
        ev.push({ type: "guardChanged", guard: action.card, by: action.card });
        pendTriggers(ctx, s, "attacked", action.card);
        s.flow.unshift({ op: "checkpoint" });
      }
      break;
    }
    case "counter": {
      if (pr.kind !== "counter") throw new IllegalAction("no counter window");
      s.counterStack.pop();
      if (action.card) {
        if (!pr.candidates.includes(action.card)) throw new IllegalAction("that card can't counter now");
        const d = def(ctx, s, action.card);
        const sk = skillsOf(d).find((k) => k.index === (action.skill ?? -1)) ?? skillsOf(d).find((k) => k.kind.startsWith("counter:"));
        if (!sk) throw new IllegalAction("no counter skill");
        // 22-10-4: a [Counter] costs its energy cost and its skill cost —
        // unless the card prints another way to pay for it (5-3).
        if (action.alt) {
          const alt = altCostFor(ctx, s, action.card, p);
          if (!alt) throw new IllegalAction("that card has no other cost to pay");
          if (!payAltCost(ctx, s, ev, p, alt)) throw new IllegalAction("can't pay the counter's cost");
        } else {
          const c = playCost(ctx, s, action.card);
          const orbs = orbTotals(sk);
          const pm = planPayment(ctx, s, p, c.total + orbs.total, { ...c.specified }, action.pay);
          if (!pm) throw new IllegalAction("can't pay the counter's cost");
          pay(s, ev, p, pm);
        }
        // 22-10-7: the card goes to the Drop; its effect resolves as the counter motion.
        move(ctx, s, ev, action.card, "drop", p, { reason: "effect", reveal: true });
        // 9-7: a counter is itself an action that can be countered. The answer
        // is offered first and resolves first (9-7-3, descending order), which
        // is simply what the flow being a stack already does — and a
        // [Counter: Counter] that negates marks the step below it on its way.
        s.flow.unshift({ op: "counter", window: "counter", responder: other(p) }, { op: "counter.resolve", card: action.card, skill: sk.index, player: p });
      }
      break;
    }
    case "zEnergyFromCombo": {
      if (pr.kind !== "zEnergyFromCombo") throw new IllegalAction("not choosing Z-Energy");
      if (action.card) {
        if (!pr.candidates.includes(action.card)) throw new IllegalAction("not a combo card");
        move(ctx, s, ev, action.card, "zEnergy", p, { reason: "rule" });
      }
      break;
    }
    case "offering": {
      if (pr.kind !== "offering") throw new IllegalAction("no [Offering] pending");
      const info = s.continuations.offering as { card: string; master: PlayerId };
      delete s.continuations.offering;
      if (action.dropLife) {
        const life = ps.life[0];
        if (life) move(ctx, s, ev, life, "drop", p, { reason: "effect", reveal: true });
      } else draw(ctx, s, ev, info.master, 2);
      break;
    }
    case "choose": {
      if (pr.kind !== "chooseCards") throw new IllegalAction("no choice pending");
      const ch = pr.choice;
      if (action.cards.some((id) => !ch.candidates.includes(id)) || new Set(action.cards).size !== action.cards.length) throw new IllegalAction("invalid choice");
      if (action.cards.length > ch.max) throw new IllegalAction(`choose at most ${ch.max}`);
      // The board and the move list answer one card at a time. A prompt that
      // needs more than one keeps what has been picked and asks again for the
      // rest, so a "choose 2" is two taps rather than an answer nothing on the
      // menu could give.
      if (action.cards.length < ch.min) throw new IllegalAction(`choose at least ${ch.min}`);
      const key = `picking:${ch.continuation}`;
      const sofar = (s.continuations[key] as string[] | undefined) ?? [];
      const picked = [...sofar, ...action.cards];
      const left = ch.candidates.filter((id) => !action.cards.includes(id));
      if (action.cards.length > 0 && action.cards.length < ch.max && left.length > 0) {
        s.continuations[key] = picked;
        s.prompt = { ...pr, choice: { ...ch, candidates: left, min: Math.max(0, ch.min - action.cards.length), max: ch.max - action.cards.length } };
        return { state: s, events: ev };
      }
      delete s.continuations[key];
      s.lastChoice = picked;
      break;
    }
    case "chooseMode": {
      if (pr.kind !== "chooseMode") throw new IllegalAction("no option is being offered");
      if (!Number.isInteger(action.index) || action.index < 0 || action.index >= pr.options.length) throw new IllegalAction("no such option");
      s.lastMode = action.index;
      break;
    }
    case "optionalCost": {
      if (pr.kind !== "optionalCost") throw new IllegalAction("no cost is being offered");
      const info = s.continuations.optionalCost as { card: string; skillIndex: number; master: PlayerId; trigger?: Trigger; subject?: string };
      delete s.continuations.optionalCost;
      if (action.pay) {
        const sk = skillsOfInstance(ctx, s, info.card).find((k) => k.index === info.skillIndex);
        if (!sk) throw new IllegalAction("no such skill");
        const orbs = orbTotals(sk);
        if (orbs.total > 0) {
          const pm = planPayment(ctx, s, p, orbs.total, orbs.specified);
          if (!pm) throw new IllegalAction("can't pay the skill cost");
          pay(s, ev, p, pm);
        }
        if (sk.markerCost != null) payMarkerCost(s, ev, info.card, sk.markerCost);
        if (!canPayKeywordCosts(s, p, sk)) throw new IllegalAction("can't pay the skill cost");
        payKeywordCosts(ctx, s, ev, p, sk);
        // 9-6-4-2: paid, so the skill activates and resolves.
        s.continuations[`paid:${info.card}:${info.skillIndex}`] = true;
        s.flow.unshift({ op: "auto.resolve", pending: { card: info.card, skillIndex: info.skillIndex, master: info.master, trigger: info.trigger ?? "played", subject: info.subject } }, { op: "checkpoint" });
      }
      break;
    }
    case "payCost": {
      if (pr.kind !== "payCost") throw new IllegalAction("no payment is being asked for");
      const option = pr.options[action.option];
      if (!option) throw new IllegalAction("no such payment");
      // Re-run the original action with the energy the player picked.
      const restored = clone(prev);
      restored.prompt = (restored.continuations.promptBefore as Prompt | undefined) ?? restored.prompt;
      delete restored.continuations.promptBefore;
      const inner = { ...pr.action, pay: option.rest } as Action;
      const r = apply(ctx, restored, inner);
      return { state: r.state, events: [...ev, ...r.events] };
    }
    case "refereeRuling": {
      if (pr.kind !== "referee") throw new IllegalAction("no ruling was asked for");
      if (!validateProgram(action.ops)) throw new IllegalAction("the ruling is not a valid effect program");
      const req = pr.request;
      ev.push({ type: "note", text: `referee ruled on ${req.cardName} (${req.cardId}) skill ${req.skillIndex}` });
      if (action.ops.length) {
        const frame: ScriptFrame = { ops: action.ops as Op[], ip: 0, vars: {}, card: req.card, master: req.master, trigger: req.trigger };
        s.flow.unshift({ op: "script.step", frame });
      }
      break;
    }
    case "orderPending":
      throw new IllegalAction("ordering pending skills is automatic in this version");
  }
  s.prompt = { kind: "gameOver" }; // cleared; run() sets the next one
  run(ctx, s, ev);
  if (s.phase !== "over" && s.prompt.kind === "gameOver") throw new Error("engine stopped without a prompt");
  return { state: s, events: ev };
}

function requireMain(s: GameState, p: PlayerId): void {
  if (s.prompt.kind !== "main" || s.prompt.player !== p) throw new IllegalAction("not your Main Phase");
}

/** Pay a skill's cost and queue its resolution. Keyword skills with choices push a prompt. */
function activate(ctx: EngineContext, s: GameState, ev: GameEvent[], p: PlayerId, card: string, sk: Skill, explicitPay?: string[], alt = false): void {
  const d = def(ctx, s, card);
  const inst = s.cards[card];
  const k = sk.keyword;
  const ps = s.players[p];
  const payOrbs = () => {
    const total = Object.entries(sk.energyCost).reduce((n, [, v]) => n + (v ?? 0), 0);
    const specified = Object.fromEntries(Object.entries(sk.energyCost).filter(([c]) => c !== "any"));
    const pm = planPayment(ctx, s, p, total, specified as never, explicitPay);
    if (!pm) throw new IllegalAction("can't pay the skill cost");
    pay(s, ev, p, pm);
  };
  if (sk.oncePerTurn || sk.limit != null) inst.usedThisTurn.push(sk.index);
  if (sk.markerCost != null) payMarkerCost(s, ev, card, sk.markerCost);
  payKeywordCosts(ctx, s, ev, p, sk);
  ev.push({ type: "skill", card, skill: sk.index, master: p, text: sk.raw });

  if (k?.name === "Awaken" || k?.name === "Wish") {
    s.flow.unshift({ op: "skill.resolve", card, skill: sk.index, player: p });
    return;
  }
  if (k?.name === "Evolve") {
    payOrbs();
    const filter = parseFilter(sk.effect || sk.cost);
    const cands = ps.battle.filter((id) => matches(cardNow(ctx, s, id), filter));
    s.continuations.evolve = { card, xeno: k.variant === "Xeno-Evolve" };
    s.flow.unshift({ op: "prompt", prompt: { kind: "chooseCards", player: p, choice: { reason: `${k.variant}: choose the card to evolve`, candidates: cands, min: 1, max: 1, continuation: "evolve" } } }, { op: "choose.apply", what: "evolve", card, player: p });
    return;
  }
  if (k?.name === "Union" && k.variant !== "Absorb") {
    payOrbs();
    const names = (sk.effect || sk.cost).match(/<([^>]+)>/g)?.map((x) => x.slice(1, -1)) ?? [];
    const pool = k.variant === "Fusion" ? ps.hand.filter((id) => id !== card) : ps.battle;
    const cands = pool.filter((id) => names.some((n) => def(ctx, s, id).characters.some((c) => c.toLowerCase() === n.toLowerCase())));
    s.continuations.union = { card, variant: k.variant };
    s.flow.unshift({ op: "prompt", prompt: { kind: "chooseCards", player: p, choice: { reason: `Union-${k.variant}: choose ${names.join(" and ")}`, candidates: cands, min: names.length, max: names.length, continuation: "union" } } }, { op: "choose.apply", what: "union", card, player: p });
    return;
  }
  if (k?.name === "Over Realm") {
    payOrbs();
    ps.overRealmsThisTurn++;
    for (const id of ps.drop.slice()) move(ctx, s, ev, id, "warp", p, { reason: "cost" });
    // 22-15-6: the card returns to the Warp as the turn ends — a delayed
    // effect like any other, and it does nothing if the card has already left.
    schedule(s, ev, {
      at: "turnCleanup",
      scope: "thisTurn",
      ops: [{ op: "moveTo", target: { sel: { special: "self", area: "battle" } }, to: "warp" }],
      card,
      master: p,
      vars: {},
      label: "back to the Warp as the turn ends",
    });
    s.resolving = { card, player: p };
    s.flow.unshift({ op: "counter", window: "play", responder: other(p) }, { op: "play.resolve", card, player: p });
    return;
  }
  if (k?.name === "Successor") {
    // 22-38: the cost is a set of cards whose costs add up exactly, chosen
    // one at a time; the play follows once the sum is met.
    payOrbs();
    s.continuations.successor = { card, need: costOf(d), chosen: [] as string[] };
    successorAsk(ctx, s, card, p);
    return;
  }
  if (k?.name === "Aegis") {
    payOrbs();
    const cands = ps.hand.filter((id) => cardNow(ctx, s, id).colors.some((c) => k.colors.includes(c)));
    s.continuations.aegis = { card, colors: k.colors };
    s.flow.unshift(
      { op: "prompt", prompt: { kind: "chooseCards", player: p, choice: { reason: `Aegis: drop ${k.colors.join(" and ")} from your hand`, candidates: cands, min: 1, max: k.colors.length, continuation: "aegis" } } },
      { op: "choose.apply", what: "aegis", card, player: p },
    );
    return;
  }
  if (k?.name === "Rejuvenate") {
    const cost = rejuvenateCost(sk)!;
    // 22-42-3: a card from beneath goes to the Drop. Cards under a card are in
    // no area of their own, so this is the one move `move` cannot make.
    const beneath = inst.under.shift()!;
    const owner = s.cards[beneath].owner;
    s.players[owner].drop.unshift(beneath);
    ev.push({ type: "move", card: beneath, from: "unison", to: "drop", owner });
    ev.push({ type: "stack", top: card, under: inst.under.slice() });
    payMarkerCost(s, ev, card, -cost.markers);
    // 22-42-4: the top card of the deck to life.
    const top = ps.deck[0];
    if (top) move(ctx, s, ev, top, "life", p, { reason: "effect" });
    s.flow.unshift({ op: "checkpoint" });
    return;
  }
  if (k?.name === "Arrival") {
    // 22-29-5: the effect of [Arrival] is playing the card that activated it.
    payOrbs();
    s.resolving = { card, player: p };
    s.flow.unshift({ op: "counter", window: "play", responder: other(p) }, { op: "play.resolve", card, player: p });
    return;
  }
  if (k?.name === "Swap") {
    payOrbs();
    const cands = ps.hand.filter((id) => baseType(def(ctx, s, id)) === "BATTLE" && def(ctx, s, id).energyCost === k.x);
    s.continuations.swap = { card };
    s.flow.unshift({ op: "prompt", prompt: { kind: "chooseCards", player: p, choice: { reason: `Swap: play a cost-${k.x} Battle Card`, candidates: cands, min: 0, max: 1, continuation: "swap" } } }, { op: "choose.apply", what: "swap", card, player: p });
    return;
  }
  if (k?.name === "Overlord") {
    const servant = ps.battle.find((id) => has(ctx, s, id, "Servant"))!;
    move(ctx, s, ev, servant, "deck", p, { position: "bottom", reason: "cost" });
    draw(ctx, s, ev, p, 1);
    return;
  }
  if (k?.name === "Field") {
    const c = playCost(ctx, s, card);
    const pm = planPayment(ctx, s, p, c.total, c.specified, explicitPay);
    if (!pm) throw new IllegalAction("can't pay");
    pay(s, ev, p, pm);
    s.flow.unshift({ op: "skill.resolve", card, skill: sk.index, player: p }, { op: "checkpoint" });
    return;
  }
  if (k?.name === "Z-Awaken") {
    payOrbs();
    payZEnergy(ctx, s, ev, p, d.zEnergyCost ?? 0);
    ps.zAwakenedThisTurn = true;
    const old = ps.leader;
    ps.zDeck.splice(ps.zDeck.indexOf(card), 1);
    const oi = s.cards[old];
    inst.under = [old, ...oi.under.splice(0)];
    inst.mode = oi.mode;
    inst.enteredTurn = s.turn;
    ps.leader = card;
    for (const e of s.effects) if (e.target === old && e.kind === "power") e.target = card;
    s.effects = s.effects.filter((e) => e.target !== old);
    if (s.battle) {
      if (s.battle.attacker === old) s.battle.attacker = card;
      if (s.battle.guard === old) s.battle.guard = card;
    }
    ev.push({ type: "move", card, from: "zDeck", to: "leader", owner: p, reveal: true });
    ev.push({ type: "stack", top: card, under: inst.under.slice() });
    pendTriggers(ctx, s, "leaderPlaced", card);
    s.flow.unshift({ op: "checkpoint" });
    return;
  }

  // Text skill with a native effect.
  if (baseType(d) === "EXTRA" && areaOf(s, card) === "hand") {
    // 12-2-2: pay the energy cost, card to the Drop, then the skill resolves with counter timing around it.
    if (alt) {
      const a = altCostFor(ctx, s, card, p, "play");
      if (!a || !payAltCost(ctx, s, ev, p, a)) throw new IllegalAction("can't pay that price");
    } else {
      const c = playCost(ctx, s, card);
      const pm = planPayment(ctx, s, p, c.total, c.specified, explicitPay);
      if (!pm) throw new IllegalAction("can't pay");
      pay(s, ev, p, pm);
    }
    move(ctx, s, ev, card, "drop", p, { reason: "cost", reveal: true });
  }
  payOrbs();
  s.resolving = { card, skill: sk.index, player: p };
  s.flow.unshift({ op: "counter", window: "skill", responder: other(p) }, { op: "skill.resolve", card, skill: sk.index, player: p }, { op: "extra.finish", card }, { op: "checkpoint" });
}

// ── views ──────────────────────────────────────────────────────────────────

/** Deck lists as `CardDef` maps, for building a context from catalog rows. */
export function defsFrom(cards: CardDef[]): Record<string, CardDef> {
  const out: Record<string, CardDef> = {};
  for (const c of cards) out[c.id] = c;
  return out;
}

export { specifiedCostOf, keywordOf };
