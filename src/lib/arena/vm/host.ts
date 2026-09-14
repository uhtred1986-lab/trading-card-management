/**
 * The rules engine as a `ScriptHost` — the other implementation of the
 * interface `stepScript` runs on (`engine/script-host.ts`, #142 step 1).
 *
 * The interpreter is shared, so this file is where the two engines are allowed
 * to differ and the only place they do. Every method is a reading or a change
 * expressed in the **declarations**: a zone is a `DEFINE ZONE`, a value is a
 * `DEFINE ATTRIBUTE` through its `layers:`, a moment is a `DEFINE TRIGGER`
 * pattern. Nothing here knows that a card has a `power` field or that a player
 * has a `hand`.
 *
 * **What it will not do, it refuses by name.** A `NotYet` names the issue that
 * builds the missing half, and an `IllegalAction` is what the API answers with,
 * so a skill this engine cannot finish stops the move rather than half-applying
 * it. The alternative — a method that silently did nothing — is the failure
 * mode this programme has paid for twice already: a rule that compiles, reads
 * plausibly and changes nothing on the board.
 *
 * The refusals, and what each waits on:
 *
 *   `ko`, `placeUnder`                a KO and a pile are moves a rule makes,
 *                                     and the move-by-skill half is #146.
 *   `replacementsFor`, the two
 *   `setPlay*` and `replaceResolving` 9-10 and 9-6 both stand between a play
 *                                     being *declared* and its landing, and on
 *                                     this engine there is no such gap: a play
 *                                     resolves inside the op that makes it,
 *                                     because the counter window the legacy
 *                                     engine opens there is Stage 6's (#150).
 *   `battle`, `setGuard`,
 *   `negateAttack`                    Stage 6 — there is no battle yet. These
 *                                     answer "no battle" rather than refusing,
 *                                     because that is the truth about this
 *                                     board and every caller already handles it.
 *   `negateCounterInFlight`           9-8, a counter window: Stage 6.
 *   `addSkip`                         20-13 is a change to the flow, and the
 *                                     flow's skip list is #145's.
 *   `createToken`                     19-1: a token is a card the catalog has
 *                                     no row for, and `attrsOf` reads a row.
 *
 * Pure and client-safe: no database, no network, no `fs`.
 */
import type { EngineContext, GameEvent } from "../engine";
import type { ScriptHost } from "../engine/script-host";
import type { Area, CardDef, KeywordSkill, Mode, MoveReason, PlayerId, Prompt } from "../engine/types";
import type { GameDefinition } from "../rulesets";
import { addEffect, dropEffectsOn, negatedSkillsOf, schedule } from "./effects";
import { NotYet } from "./errors";
import { emit, log } from "./events";
import { resolvePlay } from "./play";
import { SETUP_ZONES, arrivalMode, moveCard } from "./zones";
import { attrsNow, amount, condHolds, forbids, hasKeyword, resolveRef, resolveSelector, sideOf, zoneOf } from "./program";
import { masterOf, skillsShowing } from "./triggers";
import type { VmState } from "./state";

/**
 * The host for one call.
 *
 * Made fresh per `apply`, like `legacyHost`, and holding the four things a
 * reading needs: the catalog, the definition, the state being changed and the
 * log being appended to.
 */
export function vmHost(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[]): ScriptHost {
  const card = (id: string) => state.cards[id];
  const zoneList = (p: PlayerId, area: Area): string[] => (state.sides[p].zones[area] ?? []).slice();

  return {
    // ── what the program can find out ────────────────────────────────────
    exists: (id) => !!card(id),
    ownerOf: (id) => card(id).owner,
    masterOf: (id) => masterOf(game, state, id),
    // The legacy `Area` union and the declared zone names are the same words
    // (`dbs/zones.rules`), so a zone name is an `Area` — the one place that
    // equality is relied on, and `createGame` already refuses a definition
    // whose zone names the procedure cannot find.
    areaOf: (id) => (zoneOf(state, id) as Area | null) ?? null,
    modeOf: (id) => (card(id).mode as Mode | null) ?? null,
    markersOf: (id) => card(id).markers,
    isFaceUp: (id) => card(id).faceUp,
    isHidden: (id) => card(id).hidden,
    isFlipped: (id) => card(id).flipped,
    hasBack: (id) => !!ctx.defs[card(id).cardId]?.back,
    catalogIdOf: (id) => card(id).cardId,
    // 5-5-4: nothing on this engine asks how old a card in play is yet — the
    // turn it arrived matters to summoning sickness and to a change of control,
    // both of which are #146's. The turn now is the honest stand-in: it makes a
    // card read as having just arrived, which is the answer that refuses.
    enteredTurnOf: () => state.turn,
    nameOf: (id) => nameOfCard(ctx, state, id),
    defOf: (id) => faceOf(ctx, state, id),
    hasKeyword: (id, name) => hasKeyword(ctx, game, state, id, name as KeywordSkill["name"]),
    // 9-1-5: negation is a continuous effect here rather than a mark on the
    // instance, and `./effects.ts` is where that is read — once, for every
    // reader of it.
    negatedSkills: (id) => negatedSkillsOf(state, id),
    cardsInPlay: (p) =>
      Object.entries(state.sides[p].zones)
        .filter(([zone]) => game.zones[zone]?.inPlay === true)
        .flatMap(([, ids]) => ids),
    zone: zoneList,
    playerName: (p) => state.sides[p].name,
    turn: () => state.turn,
    // 0-2-5: a prohibition beats an instruction, and 20-14's prohibitions are
    // now read off the board — a [Permanent] in play, a skill's turn-long
    // effect, and a card's own rule about itself wherever it sits (9-1-3-3).
    // The same predicate a `REFUSE` gates a move on, so an instruction and a
    // menu cannot disagree about what is forbidden.
    forbids: (what, opts) => forbids(ctx, game, state, what, opts ?? {}),

    // ── the language's own readings ──────────────────────────────────────
    resolveSelector: (frame, sel) => resolveSelector(ctx, game, state, frame, sel),
    resolveRef: (frame, ref) => resolveRef(ctx, game, state, frame, ref),
    amount: (frame, a) => amount(ctx, game, state, frame, a),
    condHolds: (frame, c) => condHolds(ctx, game, state, frame, c),

    // ── what the program can change ──────────────────────────────────────
    note: (text) => {
      log(ev, { type: "note", text });
    },
    log: (event) => {
      log(ev, event);
    },
    draw: (p, n) => {
      let drawn = 0;
      for (let i = 0; i < n; i++) {
        const id = state.sides[p].zones[SETUP_ZONES.deck][0];
        if (!id) break;
        moveTo(ctx, game, state, ev, id, SETUP_ZONES.hand, p, { reason: "draw" });
        log(ev, { type: "draw", player: p, card: id });
        drawn++;
      }
      return drawn;
    },
    move: (id, to, owner, opts) => {
      moveTo(ctx, game, state, ev, id, to, owner, { position: opts?.position, reveal: opts?.reveal, carry: opts?.carry, reason: opts?.reason });
      return (zoneOf(state, id) as Area | null) ?? to;
    },
    ko: (id) => {
      throw new NotYet(`KO ${nameOfCard(ctx, state, id)} — a KO is a move a rule makes, and moves by skill are declared in #146`, "#146");
    },
    placeUnder: (id) => {
      throw new NotYet(`put ${nameOfCard(ctx, state, id)} under another card (23-2)`, "#146");
    },
    setMode: (id, mode) => {
      const at = zoneOf(state, id);
      const declared = at ? game.zones[at] : undefined;
      if (!declared?.modes?.includes(mode)) return false;
      const inst = card(id);
      // 0-2-4-1: a card already in that mode does not switch, and an event for
      // a change that did not happen is a beat the board plays over nothing.
      if (inst.mode === mode) return false;
      inst.mode = mode;
      emit(ctx, game, state, ev, { event: "modeSwitched", card: id, controller: masterOf(game, state, id), args: { mode } }, { type: "mode", card: id, mode });
      return true;
    },
    setFaceUp: (id, faceUp) => {
      card(id).faceUp = faceUp;
    },
    setHidden: (id, hidden) => {
      card(id).hidden = hidden;
      log(ev, { type: "hidden", card: id, hidden });
    },
    flip: (id) => {
      card(id).flipped = true;
      log(ev, { type: "flip", card: id, flipped: true });
    },
    changeMarkers: (id, delta) => {
      const inst = card(id);
      inst.markers = Math.max(0, inst.markers + delta);
      log(ev, { type: "markers", card: id, delta, total: inst.markers });
      return inst.markers;
    },
    changeEnergyMarkers: (p, delta) => {
      const now = Number(state.sides[p].attrs.energyMarkers ?? 0);
      state.sides[p].attrs.energyMarkers = Math.max(0, now + delta);
      log(ev, { type: "energyMarker", player: p, delta });
    },
    setPlayerAttr: (p, name, value) => {
      state.sides[p].attrs[name] = value;
    },
    // 21-3: the count is for the end screen, and a player attribute is the
    // only place this engine keeps a number about a player. Nothing declares
    // one, so the figure is carried in the event and nowhere else.
    addDamageTaken: () => {},
    shuffleDecks: (players) => {
      for (const p of players) {
        log(ev, { type: "note", text: `${state.sides[p].name} shuffles their deck` });
        shuffle(state, p);
      }
    },
    setEnteredTurn: () => {},
    negateAll: (id) => {
      addEffect(state, ev, { target: id, kind: "negateSkills", value: 0, until: "game", source: id });
    },
    negateSkillIndex: (id, index) => {
      addEffect(state, ev, { target: id, kind: "negateSkill", value: index, until: "game", source: id });
    },
    addEffect: (e) => {
      addEffect(state, ev, e);
    },
    schedule: (d) => {
      schedule(state, ev, d);
    },
    addSkip: (p, what) => {
      throw new NotYet(`skip ${p}'s ${what} (20-13) — the flow's skip list is #145's`, "#145");
    },
    createToken: (_p, name) => {
      throw new NotYet(`make a ${name} token (19-1) — a token is a card no catalog row describes, and every attribute is read off one`, "#146");
    },

    // ── moments ──────────────────────────────────────────────────────────
    pendingCount: () => state.pending.length,
    // The moment, in the words `triggers.rules` is written in. A program that
    // pends is naming a legacy trigger, and `pendByName` is the one translation
    // — see its note.
    pend: (trigger, cardId, subject) => pendByName(ctx, game, state, ev, trigger, cardId, subject),
    dropPendsOfOtherColours: (before, source) => {
      const colors = source && state.cards[source] ? (attrsNow(ctx, game, state, source).colors ?? []) : [];
      state.pending = state.pending.filter((e, i) => {
        if (i < before) return true;
        const sk = skillsShowing(ctx, state, e.card).skills.find((x) => x.index === e.skillIndex);
        const m = /flipped face up by (?:one of )?your (red|blue|green|yellow|black|white) card skills?/i.exec(sk ? sk.cost + " " + sk.effect : "");
        if (!m) return true;
        const want = m[1][0].toUpperCase() + m[1].slice(1);
        return (colors as readonly string[]).includes(want);
      });
    },

    // ── replacements and the play being resolved (9-10, 9-6) ─────────────
    // No replacement is in force to find: `replaceLeave` is a [Permanent]
    // static this engine does not read yet (`DEFERRED_STATICS`), so the honest
    // answer is that nothing stands in front of the move.
    replacementsFor: () => [],
    resolvingCard: () => null,
    // 9-6: a play *being resolved* is a play that has been declared and has not
    // landed yet, which on this engine is a moment that does not exist — a play
    // resolves inside the op that makes it (`playThen` above), because the
    // counter window the legacy engine opens between the two is Stage 6's.
    // `resolvingCard` answering null is what keeps the two `setPlay*` below
    // unreachable rather than wrong, and `stepScript` already breaks on it.
    setPlayRest: () => {
      throw new NotYet("play a card in Rest Mode (5-5) — the window between declaring a play and resolving it is Stage 6's", "#150");
    },
    setPlayNegated: () => {
      throw new NotYet("play a card with its skills negated (5-5) — the window between declaring a play and resolving it is Stage 6's", "#150");
    },
    replaceResolvingPlay: () => {
      throw new NotYet("put a program in the place of the play being resolved (9-6) — the counter window it happens in is Stage 6's", "#150");
    },

    // ── the battle (8-1) ─────────────────────────────────────────────────
    battle: () => null,
    setGuard: () => {},
    negateAttack: () => {},
    negateCounterInFlight: () => null,

    // ── the questions, and the flow that carries them ────────────────────
    ask: (prompt: Prompt) => {
      state.prompt = prompt;
    },
    lastMode: () => state.lastMode,
    clearLastMode: () => {
      state.lastMode = null;
    },
    lastChoice: () => state.lastChoice,
    clearLastChoice: () => {
      state.lastChoice = null;
    },
    // 4-3-3: a price's names, left where the effect can start from them. The
    // continuation is kept on the frame that will read it rather than in a map
    // of its own — `saveVarsAs` is set by the activation that runs the two, and
    // an action price and an X price are the two halves of a skill's cost #147
    // did not reach, so nothing binds either of these yet (#149).
    saveVars: (key) => {
      throw new NotYet(`carry the names a price chose into its effect (${key}, 4-3-3) — an action price is charged by nothing yet`, "#149");
    },
    saveX: (key) => {
      throw new NotYet(`carry the X a price paid into its effect (${key}, 20-5)`, "#149");
    },

    resume: (frame) => {
      state.programs.unshift(frame);
    },
    interrupt: (first, frame) => {
      state.programs.unshift(frame);
      state.programs.unshift(first);
    },
    // 5-5-3: the `play` op, and therefore **every** play on this engine — an
    // `ACTION play` says `DO { play(target: $card) }` and arrives here too, so a
    // play a player declares and a play a skill makes are one act (#146).
    //
    // The plays happen on the spot and the frame goes back on the queue behind
    // them, which is the legacy engine's order (`play.resolve` steps first, the
    // rest of the skill after). It is synchronous because nothing a play does
    // on this engine asks a question: the counter window the legacy engine
    // opens over a play is Stage 6's, and [Empower]'s "how many markers to
    // carry" is a §22 keyword, #157's. A play that grows a question is a
    // question this must learn to hold, and `resolvePlay` names the two that
    // would.
    playThen: (cards, opts, frame) => {
      for (const id of cards) resolvePlay(ctx, game, state, ev, id, opts.player, { mode: opts.mode, onto: opts.onto, negated: opts.negated });
      state.programs.unshift(frame);
    },
  };
}

// ── the pieces more than one method needs ───────────────────────────────────

/** What to call a card in the log: the face showing, so a flipped Leader reads as its awakened name. */
function nameOfCard(ctx: EngineContext, state: VmState, id: string): string {
  return faceOf(ctx, state, id).name;
}

/** The face showing (1-9), as a `CardDef` — what a program reads a printed value off. */
function faceOf(ctx: EngineContext, state: VmState, id: string): CardDef {
  const inst = state.cards[id];
  const def = inst ? ctx.defs[inst.cardId] : undefined;
  if (!def) throw new Error(`unknown card ${id}`);
  if (!inst.flipped || !def.back) return def;
  return { ...def, ...def.back, back: def.back };
}

/**
 * A move, with the moment and the picture (3-1-4).
 *
 * The same shape `flow.ts`'s `moved` has and for the same reason: a card
 * arriving somewhere is a `moved` moment whatever moved it, and `triggers.rules`
 * decides which [Auto]s that is a moment for. Kept here rather than imported so
 * the host does not depend on the runner, which depends on the host.
 */
function moveTo(
  ctx: EngineContext,
  game: GameDefinition,
  state: VmState,
  ev: GameEvent[],
  id: string,
  to: string,
  owner: PlayerId,
  opts: { position?: "top" | "bottom"; reveal?: boolean; carry?: boolean; reason?: MoveReason },
): void {
  const from = zoneOf(state, id);
  const fromOwner = from ? ownerOfZone(state, id) : null;
  const placed = moveCard(state, game, id, to, { owner, position: opts.position, carry: opts.carry });
  if (!placed.ok) {
    log(ev, { type: "note", text: `${nameOfCard(ctx, state, id)} does not move: ${placed.refused}` });
    return;
  }
  // 3-1-4: a card that changed area is a new card, so nothing that was in force
  // on it still is. A card moving *within* play carries them (3-1-4-1).
  if (!opts.carry && from !== to) dropEffectsOn(state, ev, id);
  if (from && fromOwner) {
    log(ev, { type: "move", card: id, from: from as Area, to: to as Area, owner, ...(opts.reveal ? { reveal: true } : {}) });
  }
  // `cause` is the field the two interpreters share a name for (`MoveOptions.reason`
  // on the legacy side): "damage", "ko", "combo", "effect" and a plain draw are one
  // move told apart by it, and `triggers.rules` may match a `moved(cause: …)` (#274).
  emit(ctx, game, state, ev, { event: "moved", card: id, controller: owner, args: { from: from ?? "", to, asPlay: false, cause: opts.reason ?? "effect" } }, null);
}

function ownerOfZone(state: VmState, id: string): PlayerId | null {
  for (const p of Object.keys(state.sides) as PlayerId[]) {
    for (const ids of Object.values(state.sides[p].zones)) if (ids.includes(id)) return p;
  }
  return null;
}

/** One player's deck, randomised with the game's seeded RNG (5-11). */
function shuffle(state: VmState, p: PlayerId): void {
  const deck = state.sides[p].zones[SETUP_ZONES.deck];
  let rng = state.rngState;
  for (let i = deck.length - 1; i > 0; i--) {
    const t = (rng + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    rng = t;
    const j = Math.floor((((r ^ (r >>> 14)) >>> 0) / 4294967296) * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  state.rngState = rng;
}

/**
 * A program naming a legacy trigger, pended as the moment that trigger *is*.
 *
 * The one place the two vocabularies meet, and it is deliberately narrow: an op
 * that pends says "played", "placed", "attacked" — the legacy engine's names,
 * because the op schema was written for it — and `triggers.rules` declares the
 * moments those names come out of. A card with a `card_rules` record answers to
 * the name the record says, so a moment fired here under the same name reaches
 * the same skills on both engines (`skillAnswersTo`).
 *
 * What is *not* done here is invent a `Moment` shape per trigger name. The
 * happenings a program causes — a card moving, a mode switching — are fired by
 * the methods that cause them, in the words `triggers.rules` is written in; this
 * covers only the names a program says outright, and a name with no moment of
 * its own is a note rather than a silent miss.
 */
function pendByName(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], trigger: string, id: string, subject?: string): void {
  const controller = state.cards[id] ? masterOf(game, state, id) : state.turnPlayer;
  const moment = MOMENT_OF[trigger];
  if (!moment) {
    log(ev, { type: "note", text: `${trigger} is a moment no declaration names, so nothing answers to it` });
    return;
  }
  emit(ctx, game, state, ev, { event: moment.event, card: id, controller, args: { ...moment.args, ...(subject ? { by: subject } : {}) } }, null);
}

/**
 * The legacy trigger names a program says outright, as declared moments.
 *
 * Short on purpose: these are the names `stepScript` passes to `pend`, and each
 * is a happening `dbs/triggers.rules` already has a pattern for. Every other
 * moment reaches the cards through the method that caused it.
 */
const MOMENT_OF: Record<string, { event: string; args: Record<string, string | number | boolean> }> = {
  played: { event: "moved", args: { to: "battle", asPlay: true } },
  placed: { event: "moved", args: { to: "battle", asPlay: false } },
  addedToZEnergy: { event: "moved", args: { to: "zEnergy", asPlay: false } },
  removedFromBattle: { event: "moved", args: { from: "battle", asPlay: false } },
  droppedFromBattle: { event: "moved", args: { from: "battle", to: "drop", asPlay: false } },
  leftBattleToDrop: { event: "moved", args: { from: "battle", to: "drop", asPlay: false } },
};

/** So a caller can say which side a `Side` word means without importing the readings module. */
export { sideOf, arrivalMode };
