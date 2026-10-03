/**
 * The legacy engine as a `ScriptHost` (`vm/script-host.ts`), split out of
 * that file when the interface moved to `vm/` (#118). Goes with `engine/`.
 */
import { addEffect, addSkip, amount, areaOf, cardNow, cardsInPlay, condHolds, def, draw, face, forbids, has, move, note, placeUnder, replacementChoicesFor, resolveRef, resolveSelector, schedule, setMode, skillsOfInstance } from "./state";
import { tokenCardId } from "../vm/common";
import type { GameContext } from "../types";
import { koCard, masterOf, pendPlacedWatchers, pendTriggers } from "./triggers";
import type { Op } from "../vm/script";
import type { Area, Color, FlowStep, GameEvent, GameState, PlayerId } from "../types";
import type { ScriptHost } from "../vm/script-host";

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
    setPlayerAttr: (p, name, value) => {
      // #157: [Over Realm]'s count, the field this engine already keeps.
      if (typeof value === "object") {
        if (name === "overRealms") s.players[p].overRealmsThisTurn += value.add;
        return;
      }
      if (name === "grewUnison") s.players[p].grewUnisonThisTurn = value;
      // "charged" and any other declared player attribute have no legacy
      // field: this engine's own charge logic never calls this op (7-2-11 is
      // read off `s.prompt.kind`, not a stored fact), so there is nothing to
      // set here yet.
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
      // "…while this card is in a Battle Area": a source already gone by the
      // time the effect resolves gives it no period to last for at all.
      if (e.until === "whileSourceInPlay" && (!e.source || areaOf(s, e.source) !== "battle")) return;
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
    pend: (trigger, card, subject) => {
      pendTriggers(ctx, s, trigger, card, subject);
      // A skill placing a card in a Battle Area (`moveTo`) is also "a card is
      // placed in your Battle Area" for the rest of that side (`yourCardPlaced`).
      if (trigger === "placed") pendPlacedWatchers(ctx, s, card);
    },
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
    swapBattleCard: (out, into) => {
      const b = s.battle;
      if (!b || (b.attacker !== out && b.guard !== out)) return;
      // 8-1-7-2: the new card is in the battle from here on (`joinsBattle`).
      inst(into).battledThisTurn = true;
      if (b.attacker === out) b.attacker = into;
      else b.guard = into;
      note(ev, `${face(ctx, s, into).name} takes ${face(ctx, s, out).name}'s place in the battle`);
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
      const steps: FlowStep[] = cards.map((card) => ({ op: "play.resolve" as const, card, player: opts.player, mode: opts.mode, onto: opts.onto, negated: opts.negated, ...(opts.markers !== undefined ? { markers: opts.markers } : {}), ...(opts.using ? { using: opts.using } : {}) }));
      // #155: the shared word's legacy reading — the same two steps this
      // engine's own [Arrival]/[Revive]/[Successor] cases queue (no program of
      // this engine writes it).
      if (opts.counterWindow && cards.length === 1) {
        s.resolving = { card: cards[0], player: opts.player };
        steps.unshift({ op: "counter", window: "play", responder: opts.player === "p1" ? "p2" : "p1" });
      }
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
