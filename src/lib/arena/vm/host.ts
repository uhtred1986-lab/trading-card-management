/**
 * The rules engine as a `ScriptHost` — the other implementation of the
 * interface `stepScript` runs on (`vm/script-host.ts`, #142 step 1).
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
 *   `ko` and `createToken` are real now (#146): a skill's KO is
 *                                     `vm/battle.ts`'s `koCard`, and a token
 *                                     is a card whose row is its id (19-1,
 *                                     `withTokens`). `placeUnder` (23-2) is
 *                                     real too (#152), wired to `moveCard`'s
 *                                     own `under` option.
 *   `replacementsFor`                 9-10 is real (1 Oct 2026): a
 *                                     [Permanent] standing in front of a
 *                                     departure is collected and read by
 *                                     `vm/replace.ts`, asked here and applied
 *                                     by every mover. The
 *                                     play being resolved (9-6) is real since
 *                                     #150 opened the [Counter: Play] window:
 *                                     `resolvingCard`, the two `setPlay*` and
 *                                     `replaceResolvingPlay` read and write
 *                                     `state.resolving`, which `vm/play.ts`
 *                                     reads as the card lands.
 *   `negateCounterInFlight`           9-8: a [Counter] negating the [Counter]
 *                                     it is answering, inside the *same*
 *                                     window (9-7-4) — #150 opens the
 *                                     attack window (`vm/battle.ts`) but does
 *                                     not recurse it over its own resolution,
 *                                     so there is truthfully never one in
 *                                     flight to negate. `battle`, `setGuard`
 *                                     and `negateAttack` are real now
 *                                     (#150) — a card whose program reads or
 *                                     changes the battle in progress does,
 *                                     through `state.battle` the same
 *                                     `vm/battle.ts` writes.
 *   `addSkip` is real too (#439): an entry on the player's skip list
 *                                     (`vm/skips.ts`), spent by the phase or
 *                                     step it names as the flow reaches it.
 *   `saveVars`/`saveX` are real (#458): an action price (4-3-3) runs
 *                                     as its own frame in front of the
 *                                     effect, and hands what it chose to
 *                                     the frame marked `pricedBy`.
 *
 * Pure and client-safe: no database, no network, no `fs`.
 */
import type { EngineContext, GameEvent } from "../types";
import type { ScriptHost } from "./script-host";
import type { Area, CardDef, ContinuousEffect, KeywordSkill, Mode, MoveReason, PlayerId, Prompt, ReplacementResult } from "../types";
import type { GameDefinition } from "../rulesets";
import { addEffect, dropEffectsOn, negatedSkillsOf, schedule } from "./effects";
import { tokenCardId } from "./common";
import { backCharactersOf } from "../text/cards";
import { koCard, openKeywordPlayWindow } from "./battle";
import { RulesetBroken } from "./errors";
import { savedXKey } from "./script";
import { emit, log } from "./events";
import { fireHook } from "./hooks";
import { carryFor, resolvePlay } from "./play";
import { SETUP_ZONES, arrivalMode, hostOf, inPlayZones, moveCard, newCard } from "./zones";
import { attrsNow, amount, condHolds, forbids, hasKeyword, resolveRef, resolveSelector, sideOf, zoneOf } from "./program";
import { masterOf, pendAutos, skillsShowing } from "./triggers";
import { leaveRoute, replacementChoices } from "./replace";
import { addSkip } from "./skips";
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
      moveTo(ctx, game, state, ev, id, to, owner, { position: opts?.position, reveal: opts?.reveal, carry: opts?.carry, reason: opts?.reason, ...(opts && "replaced" in opts ? { replaced: opts.replaced ?? null } : {}) });
      return (zoneOf(state, id) as Area | null) ?? to;
    },
    // 5-12: a skill's KO is the battle's KO (#146) — one `koCard`, so the
    // prohibition it reads, the `ko` event and the moments it fires cannot
    // differ by what caused it. The interpreter has already skipped
    // [Indestructible] and "can't be KO'd by skills" (`stepScript`'s `ko`
    // case, shared). `opts.replaced` is the route the interpreter's `ko`
    // loop settled on — asked, or the one replacement there was — and
    // `null` when none answers; the KO honours it rather than looking again.
    ko: (id, by, opts) => {
      koCard(ctx, game, state, ev, id, by, opts && "replaced" in opts ? (opts.replaced ?? null) : undefined);
    },
    // 23-2: `moveCard`'s own `under` option already carries 23-2-2 through
    // 23-2-6 (#152 taught it 23-2-5's "different area → Drop" half, which it
    // did not have before) — this is a card's own skill reaching for that
    // primitive, the way `battle.ts`'s `koCard`/`dealDamage` reach for a move
    // outside a program without going through `stepScript` at all. No `moved`
    // moment fires (23-2 declares none, and the legacy engine's own
    // `placeUnder` fires none either — only the client-visible picture),
    // which is why this is `log`, not `emit`.
    placeUnder: (id, host) => {
      const result = moveCard(state, game, id, "drop", { under: host });
      if (!result.ok) return false;
      log(ev, { type: "stack", top: host, under: state.cards[host].under.slice() });
      // 23-2: going into the pile is a moment for the card itself — "when
      // this card is placed under a <Vegito> card" (BT29-140).
      emit(ctx, game, state, ev, { event: "placedUnder", card: id, controller: masterOf(game, state, host), args: { to: "under" } }, null);
      return true;
    },
    setMode: (id, mode, by) => {
      const at = zoneOf(state, id);
      const declared = at ? game.zones[at] : undefined;
      if (!declared?.modes?.includes(mode)) return false;
      const inst = card(id);
      // 0-2-4-1: a card already in that mode does not switch, and an event for
      // a change that did not happen is a beat the board plays over nothing.
      if (inst.mode === mode) return false;
      inst.mode = mode;
      // 1-10-1: a skill doing the switching is part of the moment — `by:
      // skill`, or the keyword whose skill it is (`by: Alliance`, 22-32-3) —
      // and so is whose skill it was against whose card, and where the card
      // is: "when this card is switched to Rest Mode by one of your skills",
      // "when your skill rests an opponent's Battle Card or energy" (#157).
      const controller = masterOf(game, state, id);
      const cause: Record<string, string | boolean> = by ? { by: by.keyword ?? "skill", byOpponent: by.master !== controller } : {};
      emit(ctx, game, state, ev, { event: "modeSwitched", card: id, controller, args: { mode, in: at ?? "", ...cause } }, { type: "mode", card: id, mode });
      return true;
    },
    setFaceUp: (id, faceUp) => {
      card(id).faceUp = faceUp;
    },
    setHidden: (id, hidden, by) => {
      card(id).hidden = hidden;
      log(ev, { type: "hidden", card: id, hidden });
      // 21-16-2 / 9-9-2: the card keeps its Active or Rest Mode, but no
      // continuous effect on it carries over the flip — a [Permanent] is
      // read fresh, so only the effects written down here go.
      dropEffectsOn(state, ev, id);
      // 23-5-4: face down, an attack card or guard card is neither any more.
      const b = state.battle;
      if (hidden && b && (b.attacker === id || b.guard === id)) b.hiddenOut = true;
      // 1-10-2: the switch is a moment, with what caused it and where the card
      // is — the same shape as `modeSwitched` above (`hiddenBySkill`,
      // `triggers.rules`).
      const controller = masterOf(game, state, id);
      const cause: Record<string, string | boolean> = by ? { by: "skill", byOpponent: by.master !== controller } : {};
      emit(ctx, game, state, ev, { event: "hiddenSwitched", card: id, controller, args: { hidden, in: zoneOf(state, id) ?? "", ...cause } }, null);
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
      // #157: a counted fact goes up rather than being set.
      state.sides[p].attrs[name] = typeof value === "object" ? Number(state.sides[p].attrs[name] ?? 0) + value.add : value;
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
    // 20-13: an entry on the player's skip list, spent by the occurrence it
    // names — a phase by its declared `skip:` word (`vm/flow.ts`), a battle
    // step by `vm/battle.ts`'s own work, a whole turn as it begins.
    addSkip: (p, what, when) => {
      addSkip(state, p, what, when);
    },
    // 19-1: a card no catalog row describes, so its row is its id — the
    // legacy `tokenCardId` encoding, which `withTokens` (`./cards.ts`) decodes
    // wherever a row is read. The id, the zone end it joins and the one
    // `token` event are the legacy engine's own, so the two logs agree; no
    // `moved` moment fires here, because the interpreter pends the token's
    // own `played` next (`stepScript`'s `token` case), exactly as it does
    // for the legacy host.
    createToken: (p, name, power, comboCost, comboPower, colors) => {
      const id = `${p}#token${Object.keys(state.cards).length}`;
      state.cards[id] = newCard(id, tokenCardId(name, power, comboCost, comboPower, colors), p);
      const placed = moveCard(state, game, id, TOKEN_ZONE, { owner: p });
      if (!placed.ok) throw new RulesetBroken(state.game, `a token cannot be made in the ${TOKEN_ZONE}: ${placed.refused}`);
      log(ev, { type: "token", card: id, owner: p });
      return id;
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
    // Every [Permanent] replacement standing in front of this departure, for
    // the interpreter's two loops that can ask 9-10-2/9-10-3's question
    // (`vm/replace.ts`, the legacy `replacementChoicesFor`).
    replacementsFor: (id, reason, opts) => replacementChoices(ctx, game, state, id, reason, opts ?? {}),
    // 9-6: a play *being resolved* — declared and paid for, not landed — is
    // `state.resolving`, which `vm/battle.ts`'s `openPlayCounterWindow` writes
    // when a [Counter: Play] could answer it (#150). Null outside that window,
    // and null again once a counter has replaced the play, the legacy
    // `s.resolving = null` in its own `replaceResolvingPlay`.
    resolvingCard: () => (state.resolving && !state.resolving.replaced ? state.resolving.card : null),
    // 5-5: the manner of the arrival, read by `playThen` below as the card
    // lands — the legacy `continuations.playRest`/`playNegated`, kept on the
    // one record the window opened.
    setPlayRest: (id) => {
      if (state.resolving?.card === id) state.resolving.rest = true;
    },
    setPlayNegated: (id) => {
      if (state.resolving?.card === id) state.resolving.negated = true;
    },
    // 9-6: the play happens differently — this program in its place. The
    // legacy reading exactly: the one shape it can put in a play's place is a
    // single move of the card itself, which goes where the program says from
    // wherever it was being played from, and the energy stays paid. The move's
    // `DO` frame is dropped unrun (`vm/flow.ts`'s runner, on `replaced`), which
    // is the legacy engine filtering its `play.resolve` step out of the flow.
    replaceResolvingPlay: (ops) => {
      const r = state.resolving;
      if (!r || r.replaced) return;
      const only = ops.length === 1 ? ops[0] : null;
      if (!only || only.op !== "moveTo") return;
      const id = r.card;
      log(ev, { type: "note", text: `${nameOfCard(ctx, state, id)} is not played` });
      // "Under" is not an area a card can simply be put in (23-2), and no card
      // says so here; the Drop is the printed default — the legacy mapping.
      const dest = only.to === "play" ? "battle" : only.to === "under" ? "drop" : only.to;
      moveTo(ctx, game, state, ev, id, dest, card(id).owner, { reason: "effect", position: only.position, reveal: true });
      r.replaced = true;
    },

    // ── the battle (8-1) ─────────────────────────────────────────────────
    //
    // Read and written off `state.battle`, the same record `vm/battle.ts`'s
    // native flow keeps — a program's `case "redirectAttack"`/`case
    // "negateAttack"` in the shared `vm/script.ts` interpreter call these
    // three, so a card whose skill runs either op now really does change the
    // battle in progress, the moment its `card_rules` program calls for it
    // (no card does yet — `ops.rules` declares neither as a macro, since both
    // are already primitive cases the interpreter reads directly).
    battle: () => (state.battle ? { attacker: state.battle.attacker, guard: state.battle.guard, negated: state.battle.negated } : null),
    setGuard: (guard, by) => {
      if (!state.battle) return;
      state.battle.guard = guard;
      log(ev, { type: "guardChanged", guard, by });
    },
    negateAttack: () => {
      if (!state.battle) return;
      state.battle.negated = true;
      log(ev, { type: "attackNegated" });
    },
    // 9-7-4: a [Counter] negating the [Counter] it answers, inside the same
    // recursive window — this engine opens the attack window once and does
    // not recurse it over its own resolution (`vm/battle.ts`'s header), so
    // there is truthfully never one in flight for a program to negate.
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
    // of its own: `vm/activate.ts`'s `resolveActivation` queues the price with
    // `saveVarsAs` and the effect behind it with `pricedBy` under the same key
    // (#458). The price being paid is also the moment the line is announced —
    // the legacy `skill.resolve`, which runs after the price for that reason.
    saveVars: (key, vars) => {
      const effect = state.programs.find((f) => f.pricedBy?.key === key);
      if (!effect) throw new RulesetBroken(state.game, `a price finished with no effect waiting for what it chose (${key})`);
      effect.vars = { ...vars, ...effect.vars };
      log(ev, { type: "skill", card: effect.card, skill: effect.skillIndex ?? 0, master: effect.master, text: effect.pricedBy!.text, inBattle: !!state.battle });
    },
    // 20-5: the X a price chose (a `bindX` choose), for its effect — unless the
    // activation already charged an energy X, which wins, as in the legacy
    // `runSkill` (`x ?? paidX`).
    saveX: (key, x) => {
      const effect = state.programs.find((f) => f.pricedBy && savedXKey(f.pricedBy.key) === key);
      if (!effect) throw new RulesetBroken(state.game, `a price finished with no effect waiting for the X it bound (${key})`);
      if (effect.x === undefined) effect.x = x;
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
    // rest of the skill after). Two plays stop to ask first, and both hold the
    // frame at its `play` step until answered: the [Counter: Play] window a
    // keyword's own play opens (#155) and [Empower]'s "how many markers to
    // carry" (#157, the `markerCarry` hook).
    playThen: (cards, opts, frame) => {
      // #155, 9-6: a keyword's own play ([Arrival], [Revive], [Successor]) is
      // declared, and the opponent may answer it with a [Counter: Play] before
      // it lands — the window `vm/battle.ts` opens over a declared play. With
      // no counter they could use, nothing is asked and the play lands now.
      if (opts.counterWindow && cards.length === 1 && !state.resolving && openKeywordPlayWindow(ctx, game, state, cards[0], opts.player, frame)) return "wait";
      for (const id of cards) {
        // 22-45-3 (#157): a `markerCarry` keyword ([Empower]) on a card
        // replacing one that carries markers asks how many come across —
        // before the old one leaves, since leaving clears them (5-13-3) — and
        // the play waits on the answer: the frame is put back at this `play`
        // step, which lands once `carried` holds the answer.
        const carry = carryFor(ctx, game, state, id, opts.player);
        const answered = state.carried?.card === id ? state.carried.n : undefined;
        if (carry && carry.max > 0 && answered === undefined) {
          state.programs.unshift({ ...frame, ip: frame.ip - 1 });
          state.prompt = { kind: "empowerCarry", player: opts.player, card: id, from: carry.from, max: carry.max, ...(opts.markers !== undefined ? { markers: opts.markers } : {}) };
          return "wait";
        }
        if (answered !== undefined) state.carried = null;
        // 9-6: the play a [Counter: Play] window was open over lands here, in
        // the manner the counter left it (5-5) — and is no longer being
        // resolved once it has, the legacy `s.resolving = null`.
        const r = state.resolving?.card === id && !state.resolving.replaced ? state.resolving : null;
        resolvePlay(ctx, game, state, ev, id, opts.player, {
          mode: r?.rest ? "rest" : opts.mode,
          onto: opts.onto,
          negated: opts.negated,
          ...(r?.negated ? { negatedForTurn: true } : {}),
          ...(opts.markers !== undefined ? { markers: opts.markers } : {}),
          ...(carry && answered ? { carry: { from: carry.from, n: Math.min(Math.max(0, answered), carry.max) } } : {}),
        });
        if (r) state.resolving = null;
      }
      state.programs.unshift(frame);
    },
  };
}

// ── the pieces more than one method needs ───────────────────────────────────

/** 19-1-2: where a token is made — a Battle Area, by the name `DEFINE ZONE` gives it. */
const TOKEN_ZONE = "battle";

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
  return { ...def, ...def.back, characters: backCharactersOf(def), back: def.back };
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
  opts: { position?: "top" | "bottom"; reveal?: boolean; carry?: boolean; reason?: MoveReason; replaced?: ReplacementResult | null },
): void {
  const from = zoneOf(state, id);
  // 9-6-9-3: whether it left face down, read before the move resets it.
  const wasHidden = !!state.cards[id]?.hidden;
  // 9-10: what stands in front of a card leaving play (`vm/replace.ts`) — a
  // redirect changes `to`, a substitute keeps the card where it is.
  const route = leaveRoute(ctx, game, state, ev, id, from, to, { reason: opts.reason, ...(opts.replaced !== undefined ? { replaced: opts.replaced } : {}) });
  if (route.stays) return;
  to = route.to;
  const fromOwner = from ? ownerOfZone(state, id) : null;
  // 23-2-2-2: a card under another is in the area of the card on top, and
  // taking it out is shown as a move out of that area followed by the pile
  // as it now stands — the legacy [Rejuvenate]'s two events (#155). Read
  // before the move, while the card is still in the pile.
  const host = from ? null : hostOf(state, id);
  const hostZone = host ? zoneOf(state, host) : null;
  // 3-1-4-1: a card moving from play (or a combo) to play (or a combo) has not
  // changed area, so it keeps its mode, markers and the effects on it — the
  // legacy `move`'s own `carry` convention, which needs no caller to ask for
  // it. A skill's "gain control of it" compiles to a plain `moveTo battle`, so
  // without this the card taken arrived reset to Active Mode (#459,
  // `verify/compiler.ts`'s STEALER case).
  const held = (zone: string | null) => !!zone && (inPlayZones(game).includes(zone) || game.zones[zone]?.host === true);
  const carry = !!opts.carry || (held(from) && held(to));
  const placed = moveCard(state, game, id, to, { owner, position: opts.position, carry, ...(route.mode ? { mode: route.mode } : {}) });
  if (!placed.ok) {
    log(ev, { type: "note", text: `${nameOfCard(ctx, state, id)} does not move: ${placed.refused}` });
    return;
  }
  // Where it really went, which a rule about what the card *is* may change
  // (19-1-7: a token leaving play is removed, `moveCard`'s own redirect) — and
  // the owner whose copy of the zone it landed in (3-1-6-1's clamp).
  to = placed.move.to;
  // 3-1-4: a card that changed area is a new card, so nothing that was in force
  // on it still is. A card moving *within* play carries them (3-1-4-1).
  if (!carry && from !== to) dropEffectsOn(state, ev, id);
  if (from && fromOwner) {
    log(ev, { type: "move", card: id, from: from as Area, to: to as Area, owner: placed.move.owner, ...(opts.reveal ? { reveal: true } : {}) });
  } else if (host && hostZone) {
    log(ev, { type: "move", card: id, from: hostZone as Area, to: to as Area, owner: placed.move.owner, ...(opts.reveal ? { reveal: true } : {}) });
    log(ev, { type: "stack", top: host, under: state.cards[host].under.slice() });
  }
  // `cause` is the field the two interpreters share a name for (`MoveOptions.reason`
  // on the legacy side): "damage", "ko", "combo", "effect" and a plain draw are one
  // move told apart by it, and `triggers.rules` may match a `moved(cause: …)` (#274).
  emit(ctx, game, state, ev, { event: "moved", card: id, controller: owner, args: { from: from ?? "", to, asPlay: false, cause: opts.reason ?? "effect", ...(wasHidden ? { hidden: true } : {}) } }, null);
  // #157: a keyword's own `chargeLimit` hook (22-31, "valid in every area") —
  // this is the one script-level mover every DO program's own `moveTo` op
  // runs through (the charge action's own `DO { moveTo(..., to: energy) }`
  // included), so wiring it here reaches "any source" the way the contract's
  // own doc asks for, without a special case per action. `flow.ts`'s `moved()`
  // is a *different* mover (native moves — KO, combo-to-drop, battle) and
  // fires its own `onEnter`/`onLeave`/`afterSkill` (#155); neither wraps the
  // other, so a card reaching an Energy Area through *that* path still would
  // not answer here, which is the same edge the legacy site's own comment
  // about a granted (not printed) [Energy-Exhaust] already names.
  if (to === "energy") fireHook(ctx, game, state, id, "chargeLimit");
}

/**
 * 20-9 with a duration on it: the loan is over, so the card walks back — the
 * legacy `dropEffects`' own tail, for the effects a duration just ended
 * (#439). Only a card still in a Battle Area on the side it was taken to: one
 * KO'd or bounced lost the effect with the rest of them, and one in a Combo
 * Area is not somewhere control can return it from. The move carries, as the
 * one that took it did (20-9-2).
 */
export function returnLoans(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], ended: ContinuousEffect[]): void {
  for (const e of ended) {
    if (e.kind !== "control" || !e.control) continue;
    if (zoneOf(state, e.target) !== "battle" || ownerOfZone(state, e.target) === e.control.from) continue;
    moveTo(ctx, game, state, ev, e.target, "battle", e.control.from, { carry: true, reason: "effect" });
  }
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
  // A switch to Rest Mode by a skill is `setMode`'s own moment, fired as the
  // card switched and saying what switched it (#157); the name the program
  // also says is that same happening, already answered.
  if (FIRED_BY_SET_MODE.has(trigger) || FIRED_BY_MOVE.has(trigger)) return;
  const controller = state.cards[id] ? masterOf(game, state, id) : state.turnPlayer;
  const moment = MOMENT_OF[trigger];
  if (!moment) {
    log(ev, { type: "note", text: `${trigger} is a moment no declaration names, so nothing answers to it` });
    return;
  }
  // The legacy `pend(trigger, card)` asks **one** card whether one of its own
  // skills answers to **one** trigger, and nothing else on the board hears
  // it — so the moment is matched, and only that card's answer to that name is
  // pended. Left as a broadcast, a token's `played` (19-1) would also reach
  // every "when you play a card" watcher in play, which the legacy engine
  // never pends for a token (#146).
  pendAutos(ctx, game, state, { event: moment.event, card: id, controller, args: { ...moment.args, ...(subject ? { by: subject } : {}) } }, (m) => m.card === id && m.trigger === trigger);
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
  // `by: skill`: these three are pended by name only from `moveTo`, a skill's own move, and
  // the declarations (`triggers.rules`) ask for it — without it none of them
  // ever matched, and "removed … by an opponent's skill" had no moment at all (#459).
  removedFromBattle: { event: "moved", args: { from: "battle", asPlay: false, by: "skill" } },
  removedByOpponent: { event: "moved", args: { from: "battle", asPlay: false, by: "skill", byOpponent: true } },
  droppedFromBattle: { event: "moved", args: { from: "battle", to: "drop", asPlay: false, by: "skill" } },
  leftBattleToDrop: { event: "moved", args: { from: "battle", to: "drop", asPlay: false } },
  // 5-13: `removeMarker` says it (#155: [Rejuvenate]'s printed price is the
  // first keyword to run one), and `triggers.rules` declares the moment.
  markerRemoved: { event: "markerRemoved", args: {} },
};

/** The names `stepScript`'s `switchMode` pends whose moment `setMode` has already fired as `modeSwitched(by: …)` (`dbs/triggers.rules`). */
const FIRED_BY_SET_MODE = new Set(["restedBySkill", "restedTheirsBySkill", "restedByAlliance"]);

/**
 * The names `stepScript`'s `moveTo` pends right after `moveTo` above has
 * already fired the `moved` moment they are declared on — `placed`
 * (`moved(to: battle)`), `addedToZEnergy` (`moved(to:
 * zEnergy)`) and `leftBattleToDrop` (`moved(from: battle, to: drop)`) match
 * that moment as it is, so pending them again by name answered every such
 * skill twice: a card placed by a skill drew two cards for "when this card is
 * placed in a Battle Area, draw 1 card" (#459, `verify/readings.ts`'s
 * ARRIVES case). The names whose declaration asks for more than the mover
 * says (`removedFromBattle`'s `by: skill`) still come through by name.
 */
const FIRED_BY_MOVE = new Set(["placed", "addedToZEnergy", "leftBattleToDrop"]);

/** So a caller can say which side a `Side` word means without importing the readings module. */
export { sideOf, arrivalMode };
