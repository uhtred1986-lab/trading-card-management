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
import { compileCard, compileCostProgram, costIsOnlyOrbs, costText, parseConditionClause, priceCondition, type CardScripts } from "./compile";
import { matches, parseCondition, parseFilter } from "./filters";
import { stepScript, validateProgram, type Op, type ScriptFrame } from "./script";
import { koCard, pendTriggers } from "./triggers";
import { nextRandom, shuffle } from "./rng";
import {
  activeEnergy,
  addEffect,
  altCostFor,
  canPayCostProgram,
  areaOf,
  cardNow,
  cardsInPlay,
  comboCostOf,
  comboPowerOf,
  def,
  draw,
  endEffects,
  endTurnRelativeEffects,
  expireDelayed,
  face,
  forbids,
  fireDelayed,
  has,
  describePayment,
  forbiddenBy,
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
  permits,
  planPayment,
  playCost,
  powerOf,
  schedule,
  setMode,
  skillsOfInstance,
  type GameContext,
  condHolds,
  invokerEnergy,
  liftFromPile,
  skillNegated,
  whyNotPay,
} from "./state";
import type { Action, Applied, Area, CardDef, CardInstance, Color, FlowStep, GameEvent, GameState, PendingAuto, PlayerId, PlayerState, Prompt, RejectedAction, Requirement, Skill, Trigger } from "./types";
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
      // "Until the end of your opponent's turn" and "until the start of your
      // opponent's next turn" are both said from the controller's chair, so
      // they are read against the effect's own master — see the note there.
      endTurnRelativeEffects(s);
      for (const id of cardsInPlay(s, s.turnPlayer)) pendTriggers(ctx, s, "chargeStart", id);
      // 7-1: the same moment from the other side of the table — "at the start
      // of your opponent's turn", which is the turn now opening.
      for (const id of cardsInPlay(s, other(s.turnPlayer))) pendTriggers(ctx, s, "opponentTurnStart", id);
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
      // "At the start of your opponent's Main Phase" is the same moment seen
      // from the other side of the table, so those cards have to be asked too.
      for (const id of cardsInPlay(s, other(s.turnPlayer))) pendTriggers(ctx, s, "opponentMainStart", id);
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
      const runs = (s.continuations.endPhaseRuns as number | undefined) ?? 0;
      // 7-1: "your turn" is the controller's turn, so each side hears only the
      // wording that is about it. Pending both for both players meant an
      // effect written for your own end step also fired on your opponent's.
      //
      // 7-4-4: and only on the first pass. The End Phase repeats when a skill
      // *newly* triggers while it runs; the "at the end of your turn" skills
      // had their moment on that first pass, and re-offering them every time
      // round turned one "draw 1 card" into five.
      if (runs === 0) {
        for (const id of cardsInPlay(s, s.turnPlayer)) pendTriggers(ctx, s, "turnEnd", id);
        for (const id of cardsInPlay(s, other(s.turnPlayer))) pendTriggers(ctx, s, "opponentTurnEnd", id);
      }
      // Effects written down earlier in the turn resolve here, before the
      // "at the end of the turn" skills the cards in play are triggering now.
      const due = fireDelayed(s, "turnEnd");
      // 7-4-4: if new "at the end of the turn" skills became pending, run the
      // End Phase again before the turn passes.
      const again = s.pending.length > before && runs < 5;
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
      return resolvePlay(ctx, s, ev, step.card, step.player, step.markers, step.onto, step.negated);
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
  // 22-35 / 22-36: [Heroic] and [Villainous] are pending skills with no
  // printed line of their own, so they are pended at index -1 and there is no
  // `Skill` to find. `resolveKeywordOrText` has always had a branch for them
  // and nothing ever reached it — they were pended and then dropped here.
  if (p.skillIndex === -1) return resolveHeroicVillainous(ctx, s, ev, p.card, p.master);
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
    if (orbs.total > 0 && !planPayment(ctx, s, p.master, orbs.total, orbs.specified, undefined, orbs.either)) return "done";
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
      const affordable = !!planPayment(ctx, s, responder, cost.total + orbs.total, cost.specified, undefined, orbs.either);
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

function resolvePlay(ctx: EngineContext, s: GameState, ev: GameEvent[], card: string, p: PlayerId, markers?: number, onto?: string, negated?: "turn" | "game"): "done" | "wait" {
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
    // 22-13-6-3: [Union-Absorb] and the "play … on top of this card" wordings
    // play the card *onto* another, which carries the host's position and its
    // power effects (22-13-6-3-1). If the host has gone, it is an ordinary
    // play beside it.
    if (onto && areaOf(s, onto) === "battle") stackOnto(ctx, s, ev, card, onto, p);
    else move(ctx, s, ev, card, "battle", p, { reason: "play", reveal: true });
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
  // 9-1-5: "played … with its skills negated". Applied before the played
  // triggers pend, so a card brought back silenced does not fire its own
  // [Auto] on the way in. "For the game" is a mark on the instance, cleared
  // when it leaves play; anything shorter is an effect with a duration.
  if (negated) {
    if (negated === "game") s.cards[card].negated = "all";
    else addEffect(s, ev, { target: card, kind: "negateSkills", value: 0, until: "turn" });
    note(ev, `${face(ctx, s, card).name} was played with its skills negated`);
  }
  s.resolving = null;
  pendTriggers(ctx, s, "played", card);
  // "When your opponent plays a Battle Card": watched by every card the other
  // player has in play, with the played card as the subject.
  for (const id of cardsInPlay(s, other(p))) pendTriggers(ctx, s, "opponentPlayed", id, card);
  // "When your blue ≪God≫ card is played", "when you play a red ≪Android≫
  // card": your own side of the same moment, watched by your cards in play —
  // most often a Leader. The card just played is one of them: its skills are
  // valid in the area it now sits in (9-1-3-1) and the event it names has
  // happened, so a ≪God≫ card printing that line does see its own arrival.
  for (const id of cardsInPlay(s, p)) pendTriggers(ctx, s, "youPlayed", id, card);
  // 22-35-2 / 22-36-2: each pends when its owner plays *another* card with the
  // **same** keyword. They used to cross-match, so a [Villainous] card played
  // set off every [Heroic] on the board.
  for (const name of ["Heroic", "Villainous"] as const) {
    if (!has(ctx, s, card, name)) continue;
    for (const id of cardsInPlay(s, p)) {
      if (id === card || !has(ctx, s, id, name) || skillNegated(s, id, -1)) continue;
      s.pending.push({ card: id, skillIndex: -1, master: p, trigger: "played", subject: card });
    }
  }
  s.flow.unshift({ op: "checkpoint" });
  return "done";
}

/**
 * 22-35-3 / 22-36-3: [Heroic] draws a card, [Villainous] makes the opponent
 * drop one — and both then "negate the effects of this skill for the duration
 * of the turn", so each card does it once a turn however many more are played.
 * The pseudo-skill has no printed index, so the negation is recorded at -1.
 */
function resolveHeroicVillainous(ctx: EngineContext, s: GameState, ev: GameEvent[], card: string, master: PlayerId): "done" | "wait" {
  if (skillNegated(s, card, -1)) return "done";
  if (has(ctx, s, card, "Heroic")) {
    draw(ctx, s, ev, master, 1);
  } else if (has(ctx, s, card, "Villainous")) {
    // 20-7: which card leaves a hand is its owner's choice, so this runs the
    // ordinary discard rather than taking one off the end.
    s.flow.unshift({ op: "script.step", frame: { ops: [{ op: "discard", n: 1, side: "opponent" }], ip: 0, vars: {}, card, master } });
  } else {
    return "done";
  }
  addEffect(s, ev, { target: card, kind: "negateSkill", value: -1, until: "turn" });
  return "done";
}

// ── keyword skills and text effects ────────────────────────────────────────

function resolveKeywordOrText(ctx: EngineContext, s: GameState, ev: GameEvent[], card: string, sk: Skill, master: PlayerId, trigger?: Trigger, subject?: string): "done" | "wait" {
  const k = sk.keyword;
  const inst = s.cards[card];
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
        const alliancePrice = costText(sk.cost);
        if (/^(?:if|when|while|during)\b/i.test(alliancePrice)) {
          const cond = parseConditionClause(alliancePrice);
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
/** Where a skill leaves what its price chose, for the effect that follows it. */
const costVarsKey = (card: string, skillIndex: number) => `costvars:${card}:${skillIndex}`;

function runSkill(ctx: EngineContext, s: GameState, ev: GameEvent[], card: string, sk: Skill, master: PlayerId, trigger?: Trigger, subject?: string, vars: Record<string, string[]> = {}): "done" | "wait" {
  const script = scriptFor(ctx, s, card, sk.index);
  if (script) {
    if (script.ops.length === 0) return "done";
    // Anything the skill's price chose is already bound; "the chosen card" in
    // the effect means that card (4-3-3).
    const key = costVarsKey(card, sk.index);
    const paid = s.continuations[key] as Record<string, string[]> | undefined;
    delete s.continuations[key];
    const frame: ScriptFrame = { ops: script.ops, ip: 0, vars: { ...paid, ...vars }, card, master, trigger, subject, skillIndex: sk.index };
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
function orbTotals(sk: Skill): { total: number; specified: Partial<Record<Color, number>>; either: Color[][] } {
  const specified: Partial<Record<Color, number>> = {};
  let total = 0;
  for (const [k, v] of Object.entries(sk.energyCost)) {
    total += v ?? 0;
    if (k !== "any") specified[k as Color] = v;
  }
  // "{r}/{u}" is an orb like any other for the total; what it will accept is
  // the part `planPayment` has to be told separately.
  return { total: total + sk.energyEither.length, specified, either: sk.energyEither };
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
  if (costIsOnlyOrbs(sk.cost)) return true;
  // The orbs and any reminder text come off first — a card that costs both
  // orbs and a condition never *starts* with the condition, and testing the
  // raw text meant 1,626 skills whose effects compile were never offered.
  // A dozen cards state the condition bare, with no "if" in front of it, which
  // `priceCondition` reads once the price has failed to be an action.
  return priceCondition(sk) !== null || compileCostProgram(sk) !== null;
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
    // 22-43-3: sixteen cards watch the *payment* rather than the marker —
    // the Unison it came off ("from this card") and the player's cards in
    // play ("from one of your Unison Cards").
    pendTriggers(ctx, s, "spiritBoostPaid", u);
    for (const w of cardsInPlay(s, p)) if (w !== u) pendTriggers(ctx, s, "spiritBoostPaid", w, u);
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
  // "When your opponent attacks with a Battle Card": the defending player's
  // cards watch it, with the attacker as the subject.
  for (const id of cardsInPlay(s, other(s.turnPlayer))) pendTriggers(ctx, s, "opponentAttacks", id, b.attacker);
  // 8-1: "when your Leader Card is attacked" printed on a Battle Card — the
  // Leader's own copy of that sentence is `attacked` above, because a Leader
  // is a card in play like any other.
  const defender = other(s.turnPlayer);
  if (b.guard === s.players[defender].leader) {
    for (const id of cardsInPlay(s, defender)) if (id !== b.guard) pendTriggers(ctx, s, "yourLeaderAttacked", id, b.guard);
  }
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
        // 3-9: "when your life is placed in your Drop" — the [Critical] case —
        // and "when your life moves to another area", which is both.
        for (const id of cardsInPlay(s, defP)) pendTriggers(ctx, s, "lifeLeft", id, taken[0]);
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
      // 22-5: "when a card evolves into this card" — the card that just
      // arrived by evolving, which an ordinary "played" does not distinguish.
      pendTriggers(ctx, s, "evolvedInto", info.card, target);
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
      // "When this card is switched to Rest Mode by an [Alliance] skill" —
      // the cards rested as the cost notice it (BT28-069/070/071, BT7-004,
      // EX04-01), with the card that used [Alliance] as the subject.
      for (const id of chosen) pendTriggers(ctx, s, "restedByAlliance", id, info.card);
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
  // It may be under another card — "play up to 1 card from under this card on
  // top of this card" — and a card in a pile is in no area (23-2), so the list
  // lookup finds nothing and it would end up in two places at once.
  const l = ps[from as "hand" | "drop" | "deck"] as string[] | undefined;
  if (l) l.splice(l.indexOf(top), 1);
  else liftFromPile(s, top);
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
      // 8-1-1 says an attack may only be declared against a Leader, a Unison,
      // or a **rested** Battle Card. "This card can attack Battle Cards in
      // Active Mode" lifts that, for this attacker only — so the target list
      // is the shared one plus whatever this card's permissions add.
      const extra = permits(ctx, s, a, "attackActive").flatMap((rule) =>
        s.players[opp].battle.filter((id) => s.cards[id].mode === "active" && (!rule.filter || matches(cardNow(ctx, s, id), rule.filter))),
      );
      for (const t of [...targets, ...new Set(extra)]) {
        if (forbids(ctx, s, "beAttacked", { player: opp, card: t })) continue;
        out.push({ action: { type: "attack", player: p, attacker: a, target: t }, label: `Attack ${name(t)} with ${name(a)} (${powerOf(ctx, s, a)} vs ${powerOf(ctx, s, t)})` });
      }
    }
  }
  out.push({ action: { type: "endMain", player: p }, label: "End turn" });
  return out;
}

// ── rejected actions ───────────────────────────────────────────────────────
//
// `docs/arena-workflow-spec.md`. `legalActions` says what the server will
// accept and nothing else; a card the player cannot play is simply absent
// from it. This is the parallel list — the moves a player might reach for and
// every requirement that stops each one — so a tap on a dead card has an
// answer that comes from the rules rather than from a client's guess.
//
// The gates in `mainActions` are named predicates (`planPayment`, `canPlay`,
// `canCombo`, `activatable`, `forbids`), and each has a `whyNot*` twin beside
// it that runs the same tests in the same order, collecting instead of
// short-circuiting. The predicates themselves are untouched: they run on
// every enumeration, including Claude's, and threading a reason collector
// through them is the cost this duplication buys out of. Each pair is
// adjacent in the file and covered by the same test so they cannot drift.

/**
 * Every move the asked player might expect that is not on the menu, with
 * the reasons. At most one entry per card per action type, and never an
 * action that `legal` already offers for that card — the invariant
 * `scripts/verify-arena.ts` and `arena:playthrough` both assert.
 *
 * `legal` may be passed in when the caller already has it (the snapshot
 * does), so the menu is not enumerated a second time.
 */
export function rejectedActions(ctx: EngineContext, s: GameState, legal: LegalAction[] = legalActions(ctx, s)): RejectedAction[] {
  const pr = s.prompt;
  if (!("player" in pr) || !pr.player) return [];
  const p = pr.player;
  const out: RejectedAction[] = [];
  const name = (id: string) => face(ctx, s, id).name;
  // "activate:p1#3" — the card-and-type pairs the menu already offers. A card
  // playable by its alternative price is playable; a skill offered under one
  // index is offered. Anything offered is not rejected.
  const offered = new Set(legal.map((l) => `${l.action.type}:${cardOf(l.action) ?? ""}`));
  const seen = new Set<string>();
  const push = (action: Action, label: string, why: Requirement[]) => {
    const key = `${action.type}:${cardOf(action) ?? ""}`;
    if (offered.has(key) || seen.has(key)) return;
    seen.add(key);
    // Never empty: a twin that found nothing is a drifted twin, and an `other`
    // here is what the playthrough audit counts.
    out.push({ action, label, why: why.length ? why : [{ kind: "other", detail: "not offered by the engine" }] });
  };
  /** The first skill of the card that is a real activation, with its reasons. */
  const rejectActivate = (id: string, skills: Skill[], timing: "main" | "battle") => {
    for (const sk of skills) {
      const why = whyNotActivate(ctx, s, p, id, sk, timing);
      if (!why) continue;
      push({ type: "activate", player: p, card: id, skill: sk.index }, `Activate ${name(id)}`, why);
      return;
    }
  };

  switch (pr.kind) {
    case "charge":
      for (const id of s.players[p].hand) push({ type: "charge", player: p, card: id }, `Charge ${name(id)}`, whyNotCharge(ctx, s, p));
      return out;
    case "main": {
      const ps = s.players[p];
      for (const id of ps.hand) {
        const d = def(ctx, s, id);
        const why = whyNotPlayFromHand(ctx, s, p, id);
        if (why) push({ type: "play", player: p, card: id }, `Play ${name(id)} (${d.energyCost ?? 0})`, why);
        rejectActivate(id, skillsOf(d), "main");
        push({ type: "charge", player: p, card: id }, `Charge ${name(id)}`, whyNotCharge(ctx, s, p));
      }
      for (const id of cardsInPlay(s, p)) {
        rejectActivate(id, skillsOfInstance(ctx, s, id), "main");
        const why = whyNotAttack(ctx, s, p, id);
        if (why) push({ type: "attack", player: p, attacker: id, target: s.players[other(p)].leader }, `Attack with ${name(id)}`, why);
      }
      return out;
    }
    case "combo": {
      const ps = s.players[p];
      for (const id of ps.hand) {
        push({ type: "combo", player: p, card: id }, `Combo ${name(id)}`, whyNotCombo(ctx, s, p, id));
        rejectActivate(id, skillsOf(def(ctx, s, id)), "battle");
      }
      for (const id of ps.battle) push({ type: "combo", player: p, card: id }, `Combo ${name(id)}`, whyNotCombo(ctx, s, p, id));
      for (const id of cardsInPlay(s, p)) rejectActivate(id, skillsOfInstance(ctx, s, id), "battle");
      return out;
    }
    default:
      return out;
  }
}

/** The card an action names, the way `Tappable` indexes it. */
function cardOf(a: Action): string | null {
  const x = a as { card?: string | null; attacker?: string };
  if (typeof x.card === "string") return x.card;
  if (typeof x.attacker === "string") return x.attacker;
  return null;
}

/**
 * The `why` twin of the charge offer in `legalActions`: in the Charge Phase,
 * only a prohibition stops it (20-14); once the Main Phase has begun, the
 * one charge of the turn has gone by (7-3).
 */
function whyNotCharge(ctx: EngineContext, s: GameState, p: PlayerId): Requirement[] {
  if (s.prompt.kind !== "charge") return [{ kind: "oncePerTurn", what: "charge" }];
  const f = forbiddenBy(ctx, s, "placeEnergy", { player: p });
  return f ? [{ kind: "forbidden", by: f.by }] : [];
}

/**
 * The `why` twin of the play branches of `mainActions` — the energy and the
 * `canPlay` gate, in that order. Null for a card that is never played from
 * hand as a "play" (an Extra is activated; a Z-card comes from the Z-Deck).
 */
function whyNotPlayFromHand(ctx: EngineContext, s: GameState, p: PlayerId, card: string): Requirement[] | null {
  const d = def(ctx, s, card);
  const bt = baseType(d);
  if (bt === "BATTLE" && d.energyCost !== "X") {
    const c = playCost(ctx, s, card);
    return [...whyNotPay(ctx, s, p, c.total, c.specified), ...whyNotPlay(ctx, s, p, card)];
  }
  // 1-2-2-2-1: X may be 0, so only `canPlay` can stop it.
  if (bt === "BATTLE" && d.energyCost === "X") return whyNotPlay(ctx, s, p, card);
  if (bt === "UNISON" && !isZ(d)) {
    const min = d.energyCost === "X" ? 1 : (d.energyCost ?? 0);
    return [...whyNotPlay(ctx, s, p, card), ...whyNotPay(ctx, s, p, min, {})];
  }
  return null;
}

/**
 * The `why` twin of the attack loop in `mainActions`: the same gates in the
 * same order — the first turn (7-3-4-4-1), the attacker's mode and facing,
 * a prohibition (20-14), and then whether anything at all may be attacked
 * (8-1-1 plus this card's own permissions). Null for a card that is not in
 * play, which cannot attack in any state.
 */
function whyNotAttack(ctx: EngineContext, s: GameState, p: PlayerId, a: string): Requirement[] | null {
  if (!cardsInPlay(s, p).includes(a)) return null;
  const why: Requirement[] = [];
  if (s.turn === 1 && p === s.firstPlayer) why.push({ kind: "timing", window: "nextTurn" });
  if (s.cards[a].mode !== "active") why.push({ kind: "mode", card: a, mode: s.cards[a].mode });
  if (s.cards[a].hidden) why.push({ kind: "other", detail: "a face-down card cannot attack" });
  const f = forbiddenBy(ctx, s, "attack", { player: p, card: a });
  if (f) why.push({ kind: "forbidden", by: f.by });
  const opp = other(p);
  const targets = [s.players[opp].leader, ...(s.players[opp].unison ? [s.players[opp].unison] : []), ...s.players[opp].battle.filter((id) => s.cards[id].mode === "rest")];
  const extra = permits(ctx, s, a, "attackActive").flatMap((rule) =>
    s.players[opp].battle.filter((id) => s.cards[id].mode === "active" && (!rule.filter || matches(cardNow(ctx, s, id), rule.filter))),
  );
  if (![...targets, ...new Set(extra)].some((t) => !forbids(ctx, s, "beAttacked", { player: opp, card: t }))) why.push({ kind: "target", reason: "nothing may be attacked" });
  return why;
}

/**
 * The `why` twin of the combo offers in `legalActions`: the card's own
 * ability to combo (`canCombo`), a prohibition, and the combo cost (5-7-3),
 * with the Battle Area's extra gates first — the attacker and the guard are
 * in the battle, and a rested card cannot join it.
 */
function whyNotCombo(ctx: EngineContext, s: GameState, p: PlayerId, card: string): Requirement[] {
  const why: Requirement[] = [];
  const b = s.battle;
  if (areaOf(s, card) === "battle") {
    if (b && card === b.attacker) why.push({ kind: "other", detail: "it is the attacking card" });
    else if (b && card === b.guard) why.push({ kind: "other", detail: "it is the card being attacked" });
    if (s.cards[card].mode !== "active") why.push({ kind: "mode", card, mode: s.cards[card].mode });
    if (s.cards[card].hidden) why.push({ kind: "other", detail: "a face-down card cannot combo" });
  }
  const d = def(ctx, s, card);
  if (!canCombo(d)) why.push({ kind: "cardType", card, needs: "a Battle Card with a combo cost" });
  const f = forbiddenBy(ctx, s, "combo", { player: p, card });
  if (f) why.push({ kind: "forbidden", by: f.by });
  if (canCombo(d)) why.push(...whyNotPay(ctx, s, p, comboCostOf(ctx, s, card), {}));
  return why;
}

/**
 * Whether this card may be played at all: 22-39 ([Unique] of the same name in
 * play) and 20-14 (anything that forbids playing it). Asked in both places a
 * play can start — the menu and `apply` — so the two never disagree.
 */
function canPlay(ctx: EngineContext, s: GameState, p: PlayerId, card: string): boolean {
  const d = def(ctx, s, card);
  if (s.players[p].battle.some((id) => has(ctx, s, id, "Unique") && face(ctx, s, id).name === d.name)) return false;
  // A play the player declares, which is what "except by skills" bans.
  return !forbids(ctx, s, "play", { player: p, card, bySkill: false });
}

/**
 * The `why` twin of `canPlay`: the same two tests, reported. Empty when the
 * card may be played. Called only from `rejectedActions`.
 */
function whyNotPlay(ctx: EngineContext, s: GameState, p: PlayerId, card: string): Requirement[] {
  const d = def(ctx, s, card);
  const why: Requirement[] = [];
  const twin = s.players[p].battle.find((id) => has(ctx, s, id, "Unique") && face(ctx, s, id).name === d.name);
  if (twin) why.push({ kind: "forbidden", by: face(ctx, s, twin).name });
  const f = forbiddenBy(ctx, s, "play", { player: p, card, bySkill: false });
  if (f) why.push({ kind: "forbidden", by: f.by });
  return why;
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
  if (skillNegated(s, card, sk.index, sk.kind)) return null;
  // 20-14: a skill nothing forbids, on a card nothing forbids it on.
  if (forbids(ctx, s, "activateSkill", { player: p, card })) return null;
  if (sk.oncePerTurn && inst.usedThisTurn.includes(sk.index)) return null;
  if (sk.bond != null && s.players[p].battle.length < sk.bond) return null;
  if (sk.sparking != null && s.players[p].drop.length < sk.sparking) return null;
  // 22-27 / 22-43: a [Burst] or [Spirit Boost] tag is part of the cost.
  if (!canPayKeywordCosts(s, p, sk)) return null;
  const k = sk.keyword;
  // One reading of the skill's orbs, shared with `activate` — the two used to
  // count them separately, and neither knew about "{r}/{u}".
  const { total: orbTotal, specified: orbSpecified, either: orbEither } = orbTotals(sk);
  const canPayOrbs = () => planPayment(ctx, s, p, orbTotal, orbSpecified, undefined, orbEither) !== null;
  // The one reading of "the price is nothing but orbs", shared with
  // `costIsReadable` and with `arena:gaps`. There used to be a second one
  // here that differed on reminder text, so "{r} (Play this card from your
  // hand when you have red cards.)" counted as orbs in one place and not the
  // other — the exact drift these helpers exist to prevent.
  const costIsOrbsOnly = costIsOnlyOrbs(sk.cost);

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
        if (timing !== "main") return null;
        // 22-13-6: [Union-Absorb] is the odd one out — activated from the
        // *Battle Area*, and its effect text says which card is played onto
        // this one, so it resolves like an ordinary text skill rather than by
        // naming two characters to find.
        if (k.variant === "Absorb") {
          if (areaOf(s, card) !== "battle") return null;
          if (!canPayOrbs() || !canResolve(ctx, s, card, sk)) return null;
          const priceOk = costIsOrbsOnly || (() => {
            const prog = compileCostProgram(sk);
            return prog ? canPayCostProgram(ctx, s, p, card, prog.ops) : false;
          })();
          return priceOk ? `Union-Absorb ${name}: ${sk.effect.slice(0, 40)}` : null;
        }
        if (!costIsOrbsOnly || !canPayOrbs()) return null;
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
  const condCost = !costIsOrbsOnly ? priceCondition(sk) : null;
  // 4-3-3: or the price may be an action — "switch this card to Rest Mode",
  // "choose 1 card in your hand and place it in your Drop Area". Only offered
  // when the engine can charge it, so the effect never happens for free.
  const actionCost = !costIsOrbsOnly && !condCost ? compileCostProgram(sk) : null;
  if (!costIsOrbsOnly && !condCost && !actionCost) return null;
  if (condCost && !condHolds(ctx, s, { ops: [], ip: 0, vars: {}, card, master: p }, condCost.cond)) return null;
  if (actionCost && !canPayCostProgram(ctx, s, p, card, actionCost.ops)) return null;
  if (!canPayOrbs()) return null;
  if (!canResolve(ctx, s, card, sk)) return null;
  if (baseType(d) === "EXTRA" && inHand) {
    if (alt) {
      // 5-3 / 22-37: the printed alternative to the energy cost is its own
      // offer; the skill's orbs are still paid.
      // 22-37: [Invoker] rests one Red/Blue energy in place of the card's own
      // energy cost — but the *skill's* orbs are still paid, and out of what
      // is left. Checked against the whole pool, this offered skills whose
      // orbs needed the very energy [Invoker] was about to rest.
      if (!altCostFor(ctx, s, card, p, "play")) return null;
      const spoken = invokerEnergy(ctx, s, p);
      if (!planPayment(ctx, s, p, orbTotal, orbSpecified, undefined, orbEither, spoken ? [spoken] : undefined)) return null;
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

/**
 * The `why` twin of `activatable`: the same gates in the same order, each
 * reported instead of ending the question. Returns null for a skill that is
 * never declared — an [Auto], a [Permanent], a [Counter], a keyword with no
 * activation of its own — so no rejection is invented for it; an empty list
 * means the skill is offered. The alternative price ([Invoker]) is a second
 * offer of the same skill and is not reported separately. Called only from
 * `rejectedActions`; `activatable` is untouched.
 */
function whyNotActivate(ctx: EngineContext, s: GameState, p: PlayerId, card: string, sk: Skill, timing: "main" | "battle"): Requirement[] | null {
  const d = def(ctx, s, card);
  const inst = s.cards[card];
  const inHand = areaOf(s, card) === "hand";
  const why: Requirement[] = [];
  const k = sk.keyword;
  const ACTIVATED_KEYWORDS = ["Awaken", "Wish", "Evolve", "Union", "Over Realm", "Swap", "Arrival", "Successor", "Aegis", "Rejuvenate", "Overlord", "Field", "Z-Awaken"];
  const kindOk = timing === "main" ? sk.kind === "activate:main" || sk.kind === "activate:main/battle" : sk.kind === "activate:battle" || sk.kind === "activate:main/battle";
  const textActivate = sk.kind === "activate:main" || sk.kind === "activate:battle" || sk.kind === "activate:main/battle";
  if (k ? !ACTIVATED_KEYWORDS.includes(k.name) : !textActivate) return null;

  if (skillNegated(s, card, sk.index, sk.kind)) why.push({ kind: "other", detail: "the skill is negated" });
  const f = forbiddenBy(ctx, s, "activateSkill", { player: p, card });
  if (f) why.push({ kind: "forbidden", by: f.by });
  if (sk.oncePerTurn && inst.usedThisTurn.includes(sk.index)) why.push({ kind: "oncePerTurn", what: "skill" });
  if (sk.bond != null && s.players[p].battle.length < sk.bond) why.push({ kind: "condition", text: `[Bond ${sk.bond}]: ${sk.bond} or more Battle Cards in play` });
  if (sk.sparking != null && s.players[p].drop.length < sk.sparking) why.push({ kind: "condition", text: `[Sparking ${sk.sparking}]: ${sk.sparking} or more cards in your Drop Area` });
  if (!canPayKeywordCosts(s, p, sk)) why.push({ kind: "other", detail: sk.burst != null ? `[Burst ${sk.burst}] needs that many cards in the deck` : "[Spirit Boost] needs the markers" });
  const { total: orbTotal, specified: orbSpecified, either: orbEither } = orbTotals(sk);
  const orbs = () => whyNotPay(ctx, s, p, orbTotal, orbSpecified, orbEither);
  const costIsOrbsOnly = costIsOnlyOrbs(sk.cost);
  const wantTiming = (want: "main" | "battle") => {
    if (timing !== want) why.push({ kind: "timing", window: want });
  };
  const wantZone = (area: Area) => {
    if (areaOf(s, card) !== area) why.push({ kind: "zone", card, area });
  };
  const unread = () => why.push({ kind: "unread", card });

  if (k) {
    switch (k.name) {
      case "Awaken":
      case "Wish": {
        wantZone("leader");
        if (inst.flipped) why.push({ kind: "other", detail: "the Leader is already awakened" });
        else if (!d.back) why.push({ kind: "other", detail: "the Leader has no awakened side" });
        const cond = parseCondition(sk.cost);
        if (!cond.recognised) unread();
        else if (!conditionHolds(ctx, s, p, cond)) why.push({ kind: "condition", text: sk.cost });
        return why;
      }
      case "Evolve": {
        wantTiming("main");
        wantZone("hand");
        if (!costIsOrbsOnly) unread();
        else why.push(...orbs());
        const filter = parseFilter(sk.effect || sk.cost);
        if (!s.players[p].battle.some((id) => matches(cardNow(ctx, s, id), filter))) why.push({ kind: "target", reason: `no ${sk.effect || sk.cost} in your Battle Area` });
        return why;
      }
      case "Union": {
        wantTiming("main");
        if (k.variant === "Absorb") {
          wantZone("battle");
          why.push(...orbs());
          if (!canResolve(ctx, s, card, sk)) unread();
          const priceOk = costIsOrbsOnly || (() => {
            const prog = compileCostProgram(sk);
            return prog ? canPayCostProgram(ctx, s, p, card, prog.ops) : false;
          })();
          if (!priceOk) why.push({ kind: "other", detail: `cannot pay: ${sk.cost}` });
          return why;
        }
        if (!costIsOrbsOnly) unread();
        else why.push(...orbs());
        wantZone("hand");
        const names = (sk.effect || sk.cost).match(/<([^>]+)>/g)?.map((x) => x.slice(1, -1)) ?? [];
        if (names.length < 2) {
          unread();
          return why;
        }
        const pool = k.variant === "Fusion" ? s.players[p].hand.filter((id) => id !== card) : s.players[p].battle;
        const found = names.map((n) => pool.find((id) => def(ctx, s, id).characters.some((c) => c.toLowerCase() === n.toLowerCase())));
        if (found.some((x) => !x) || new Set(found).size < names.length) why.push({ kind: "target", reason: `needs ${names.join(" and ")} ${k.variant === "Fusion" ? "in hand" : "in your Battle Area"}` });
        else if (k.variant === "Fusion" && new Set(found.map((x) => def(ctx, s, x!).power)).size !== 1) why.push({ kind: "target", reason: "the two cards must have equal power" });
        return why;
      }
      case "Over Realm": {
        wantTiming("main");
        wantZone("hand");
        const ps = s.players[p];
        const limit = cardsInPlay(s, p).some((id) => has(ctx, s, id, "Wormhole")) ? 2 : 1;
        if (ps.overRealmsThisTurn >= limit) why.push({ kind: "oncePerTurn", what: "Over Realm" });
        const count = k.dark ? ps.drop.filter((id) => def(ctx, s, id).colors.includes("Black")).length : ps.drop.length;
        if (count < k.x) why.push({ kind: "condition", text: `${k.x} or more ${k.dark ? "black " : ""}cards in your Drop Area (${count} there)` });
        if (!costIsOrbsOnly) unread();
        else why.push(...orbs());
        return why;
      }
      case "Swap": {
        wantTiming("main");
        wantZone("battle");
        if (!costIsOrbsOnly) unread();
        else why.push(...orbs());
        return why;
      }
      case "Arrival": {
        wantTiming("battle");
        wantZone("hand");
        const combo = s.players[p].combo.map((id) => cardNow(ctx, s, id).colors);
        if (!k.colors.every((c) => combo.some((cs) => cs.includes(c)))) why.push({ kind: "condition", text: `${k.colors.join(" and ")} Battle Cards in your Combo Area` });
        why.push(...orbs());
        return why;
      }
      case "Successor": {
        wantTiming("main");
        wantZone("hand");
        if (!costIsOrbsOnly) unread();
        else why.push(...orbs());
        const need = costOf(d);
        if (need <= 0) why.push({ kind: "other", detail: "the card has no energy cost to match" });
        else if (!subsetSumExists(successorPool(ctx, s, p).map((id) => costOf(def(ctx, s, id))), need)) why.push({ kind: "target", reason: `no green/yellow Battle Cards adding up to ${need}` });
        return why;
      }
      case "Aegis": {
        if (timing !== "battle" || s.turnPlayer === p || s.battle?.step !== "defense") why.push({ kind: "timing", window: "defense" });
        if (!inPlay(s, card)) why.push({ kind: "zone", card, area: "battle" });
        if (!canCoverColors(ctx, s, s.players[p].hand, k.colors)) why.push({ kind: "condition", text: `${k.colors.join(" and ")} cards in your hand to drop` });
        if (!costIsOrbsOnly) unread();
        else why.push(...orbs());
        return why;
      }
      case "Rejuvenate": {
        wantTiming("main");
        wantZone("unison");
        if (inst.under.length === 0) why.push({ kind: "other", detail: "no card under it to drop" });
        const cost = rejuvenateCost(sk);
        if (!cost) unread();
        else {
          if (inst.markers < cost.markers) why.push({ kind: "other", detail: `needs ${cost.markers} marker${cost.markers === 1 ? "" : "s"} (${inst.markers} on it)` });
          if (inst.usedMarkerSkill) why.push({ kind: "oncePerTurn", what: "marker skill" });
          if (cost.lifeAtMost != null && s.players[p].life.length > cost.lifeAtMost) why.push({ kind: "condition", text: `your life is at ${cost.lifeAtMost} or less` });
        }
        return why;
      }
      case "Overlord": {
        wantTiming("main");
        if (!s.players[p].battle.some((id) => has(ctx, s, id, "Servant"))) why.push({ kind: "target", reason: "no [Servant] in your Battle Area" });
        return why;
      }
      case "Field": {
        wantTiming("main");
        wantZone("hand");
        if (baseType(d) !== "EXTRA") why.push({ kind: "cardType", card, needs: "an Extra Card" });
        const c = playCost(ctx, s, card);
        why.push(...whyNotPay(ctx, s, p, c.total, c.specified));
        return why;
      }
      case "Z-Awaken": {
        wantTiming("main");
        wantZone("zDeck");
        const ps = s.players[p];
        if (ps.zAwakenedThisTurn) why.push({ kind: "oncePerTurn", what: "Z-Awaken" });
        const leader = ps.leader;
        if (!leader || !s.cards[leader].flipped || isZ(def(ctx, s, leader))) why.push({ kind: "condition", text: "your Leader is awakened and not yet a Z-Leader" });
        else {
          const filter = parseFilter(sk.effect || sk.cost);
          if (!matches(cardNow(ctx, s, leader), filter) && !(filter.characters.length && def(ctx, s, leader).characters.some((c) => filter.characters.includes(c)))) why.push({ kind: "target", reason: `your Leader is not ${sk.effect || sk.cost}` });
        }
        if (ps.zEnergy.length < (d.zEnergyCost ?? 0)) why.push({ kind: "condition", text: `${d.zEnergyCost} Z-Energy (${ps.zEnergy.length} there)` });
        if (!costIsOrbsOnly) unread();
        else why.push(...orbs());
        return why;
      }
      default:
        return null;
    }
  }

  // Text [Activate] skills.
  if (!kindOk) why.push({ kind: "timing", window: timing === "main" ? "battle" : "main" });
  if (sk.markerCost != null) {
    wantZone("unison");
    if (inst.usedMarkerSkill) why.push({ kind: "oncePerTurn", what: "marker skill" });
    if (inst.markers + sk.markerCost < 0) why.push({ kind: "other", detail: `needs ${-sk.markerCost} markers (${inst.markers} on it)` });
  }
  const condCost = !costIsOrbsOnly ? priceCondition(sk) : null;
  const actionCost = !costIsOrbsOnly && !condCost ? compileCostProgram(sk) : null;
  if (!costIsOrbsOnly && !condCost && !actionCost) unread();
  if (condCost && !condHolds(ctx, s, { ops: [], ip: 0, vars: {}, card, master: p }, condCost.cond)) why.push({ kind: "condition", text: sk.cost });
  if (actionCost && !canPayCostProgram(ctx, s, p, card, actionCost.ops)) why.push({ kind: "other", detail: `cannot pay: ${sk.cost}` });
  why.push(...orbs());
  if (!canResolve(ctx, s, card, sk)) unread();
  if (baseType(d) === "EXTRA" && inHand) {
    const c = playCost(ctx, s, card);
    why.push(...whyNotPay(ctx, s, p, c.total + orbTotal, c.specified));
    return why;
  }
  if (inHand) why.push({ kind: "zone", card, area: "battle" }); // 9-1-3-1
  return why;
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
      // "When your opponent combos": watched by the other player's cards in
      // play, with the combo card as the subject.
      for (const id of cardsInPlay(s, other(p))) pendTriggers(ctx, s, "opponentCombos", id, action.card);
      // "When you use a card in a combo" — the same moment from your own side,
      // which fourteen cards watch and none of them called `comboed`: that one
      // is the combo card's own skill (8-5-8), this is the board's.
      for (const id of cardsInPlay(s, p)) pendTriggers(ctx, s, "youCombo", id, action.card);
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
        // 22-4: "when this card activates [Blocker]" — the block itself, which
        // is a different moment from being attacked.
        pendTriggers(ctx, s, "blockerUsed", action.card);
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
        let altProgram: Op[] | undefined;
        // 22-10-4: a [Counter] costs its energy cost and its skill cost —
        // unless the card prints another way to pay for it (5-3).
        if (action.alt) {
          const alt = altCostFor(ctx, s, action.card, p);
          if (!alt) throw new IllegalAction("that card has no other cost to pay");
          if (!payAltCost(ctx, s, ev, p, alt)) throw new IllegalAction("can't pay the counter's cost");
          // An action price asks the player to pick cards, so it is charged
          // through the flow rather than inline — put on the front below, so
          // that it runs before the counter it is paying for.
          altProgram = alt.pay === "program" ? alt.ops : undefined;
        } else {
          const c = playCost(ctx, s, action.card);
          const orbs = orbTotals(sk);
          const pm = planPayment(ctx, s, p, c.total + orbs.total, { ...c.specified }, action.pay, orbs.either);
          if (!pm) throw new IllegalAction("can't pay the counter's cost");
          pay(s, ev, p, pm);
        }
        // 22-10-7: the card goes to the Drop; its effect resolves as the counter motion.
        move(ctx, s, ev, action.card, "drop", p, { reason: "effect", reveal: true });
        // "When your opponent activates a [Counter] skill" (4-3): watched by
        // the other player's cards in play, with the counter card as subject.
        for (const id of cardsInPlay(s, other(p))) pendTriggers(ctx, s, "opponentCounter", id, action.card);
        // 9-7: a counter is itself an action that can be countered. The answer
        // is offered first and resolves first (9-7-3, descending order), which
        // is simply what the flow being a stack already does — and a
        // [Counter: Counter] that negates marks the step below it on its way.
        s.flow.unshift({ op: "counter", window: "counter", responder: other(p) }, { op: "counter.resolve", card: action.card, skill: sk.index, player: p });
        // 4-3-3: the price is paid on activation, before anyone may answer it,
        // so it goes on the front of the flow after everything else — the same
        // shape a printed action price uses.
        if (altProgram) s.flow.unshift({ op: "script.step", frame: { ops: altProgram, ip: 0, vars: {}, card: action.card, master: p } });
      }
      break;
    }
    case "zEnergyFromCombo": {
      if (pr.kind !== "zEnergyFromCombo") throw new IllegalAction("not choosing Z-Energy");
      if (action.card) {
        if (!pr.candidates.includes(action.card)) throw new IllegalAction("not a combo card");
        move(ctx, s, ev, action.card, "zEnergy", p, { reason: "rule" });
        pendTriggers(ctx, s, "addedToZEnergy", action.card);
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
      const key = `picking:${ch.continuation}`;
      const sofar = (s.continuations[key] as string[] | undefined) ?? [];
      const picked = [...sofar, ...action.cards];
      let left = ch.candidates.filter((id) => !action.cards.includes(id));
      // 22-30-3: with colours still to cover, only the cards that cover one of
      // them are worth offering — and once they are all covered there is
      // nothing left to ask.
      const missing = ch.cover?.filter((c) => !picked.some((id) => cardNow(ctx, s, id).colors.includes(c))) ?? [];
      if (ch.cover) left = missing.length ? left.filter((id) => cardNow(ctx, s, id).colors.some((c) => missing.includes(c))) : [];
      // The board and the move list answer one card at a time. A prompt that
      // needs more than one keeps what has been picked and asks again for the
      // rest, so the minimum is only owed on the *last* answer — checking it on
      // every answer made a [Union] asking for two characters unanswerable,
      // because a single card was the only thing on the menu.
      const willAskAgain = action.cards.length > 0 && action.cards.length < ch.max && left.length > 0;
      if (!willAskAgain && action.cards.length < ch.min) throw new IllegalAction(`choose at least ${ch.min}`);
      if (willAskAgain) {
        s.continuations[key] = picked;
        // A colour still missing means the next pick is not optional: offering
        // "choose none" here would let the player stop halfway and lose the
        // cost, which is the thing this is here to prevent.
        const min = missing.length ? 1 : Math.max(0, ch.min - action.cards.length);
        s.prompt = { ...pr, choice: { ...ch, candidates: left, min, max: ch.max - action.cards.length } };
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
    const { total, specified, either } = orbTotals(sk);
    const pm = planPayment(ctx, s, p, total, specified, explicitPay, either);
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
    // 22-13: "when you activate a [Union] skill", watched by your cards in
    // play. The moment is the activation, not the choice that follows it.
    for (const id of cardsInPlay(s, p)) pendTriggers(ctx, s, "unionActivated", id, card);
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
    // 22-15: "when you play a Battle Card using [Over Realm]" — the play is
    // this keyword, so the moment is here rather than in the ordinary play.
    for (const id of cardsInPlay(s, p)) pendTriggers(ctx, s, "overRealmPlayed", id, card);
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
    // 22-30-3: only cards that could be part of a set covering every named
    // colour. A card that covers one colour is only worth offering when the
    // hand can still cover the rest — otherwise picking it is a dead end that
    // costs the orbs and does nothing.
    const cands = ps.hand.filter((id) => {
      const mine = cardNow(ctx, s, id).colors.filter((c) => k.colors.includes(c));
      if (!mine.length) return false;
      const rest = k.colors.filter((c) => !mine.includes(c));
      return rest.every((c) => ps.hand.some((other) => other !== id && cardNow(ctx, s, other).colors.includes(c)));
    });
    s.continuations.aegis = { card, colors: k.colors };
    s.flow.unshift(
      { op: "prompt", prompt: { kind: "chooseCards", player: p, choice: { reason: `Aegis: drop ${k.colors.join(" and ")} from your hand`, candidates: cands, min: 1, max: k.colors.length, continuation: "aegis", cover: k.colors } } },
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
    // 22-40: "when you activate an [Overlord] skill".
    for (const id of cardsInPlay(s, p)) pendTriggers(ctx, s, "overlordActivated", id, card);
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
  // 4-3-3: an action price is paid on activation, before the counter window
  // opens — so it goes on the front of the flow, after everything else.
  const actionCost = compileCostProgram(sk);
  if (actionCost) s.flow.unshift({ op: "script.step", frame: { ops: actionCost.ops, ip: 0, vars: {}, card, master: p, skillIndex: sk.index, saveVarsAs: costVarsKey(card, sk.index) } });
}

// ── views ──────────────────────────────────────────────────────────────────

/** Deck lists as `CardDef` maps, for building a context from catalog rows. */
export function defsFrom(cards: CardDef[]): Record<string, CardDef> {
  const out: Record<string, CardDef> = {};
  for (const c of cards) out[c.id] = c;
  return out;
}

export { specifiedCostOf, keywordOf };
