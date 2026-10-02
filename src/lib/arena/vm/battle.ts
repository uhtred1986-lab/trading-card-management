/**
 * The battle (8-1 … 8-5), as a sub-flow nested inside the Main Phase.
 *
 * `attack` is the fifth free-timing choice 7-3-4 grants and the first that is
 * not a paragraph in `actions.rules`: a `DEFINE ACTION` names at most one
 * candidate card (`docs/arena-ruleset-spec.md`'s own limit, recorded on
 * `vm/actions.ts`'s `Candidate`), and an attack is a *pair* — an attacker and
 * a target, which is exactly the gap that file's own docstring names
 * ("an attack needs a target (#150)"). `block` and `counter` have a second
 * reason to live here instead: the `Prompt` shapes the legacy engine already
 * gave them (`{kind:"blocker",candidates}`, `{kind:"counter",window,candidates}`)
 * freeze their candidate list onto the question the moment it is raised,
 * which is not what a `FOR` selector does (it is read fresh every time the
 * menu is asked for) — so these three moves are native code here, the same
 * "not everything is declarative yet" precedent `vm/flow.ts`'s `STEP_WORK`
 * already sets for the turn's own machinery, extended to the fight nested
 * inside it. `combo` *is* offered fresh every read (its `Prompt` carries no
 * candidates of its own) and is native for the same reason as the other
 * three: consistency, and because "which cards can combo right now" needs the
 * open battle's attacker/guard excluded, which a `FOR` selector has no word
 * for either.
 *
 * **The nesting.** `declareAttack` below pushes a `battle` phase frame onto
 * `state.flow` with `enterPhase` — the exact mechanism a turn phase uses —
 * *without* answering the Main Phase's own question (no `answered()` call),
 * so the frame underneath keeps waiting exactly as `play`/`activate`/
 * `growUnison`'s `again: true` leaves it. `game.rules`'s `phaseAfter` does not
 * know the word "battle" (it is not in `DEFINE GAME`'s `phases:` list and is
 * not the `setupPhase`), so the moment the battle phase runs out of steps
 * `vm/flow.ts`'s own runner pops it and falls back to reading the frame
 * beneath — the Main Phase's, `top.asking` untouched since the attack was
 * declared — and the very same "main" question is put again. No change to
 * the runner was needed for this half; `docs/arena-ruleset-spec.md`'s
 * prediction that a battle "nests inside the Main Phase and returns to it
 * when it finishes" is exactly this, built with the frame stack already
 * there for it.
 *
 * **The steps that ask something the declarative table cannot** (blocker,
 * the counter window, and the repeatable combo offer) return `"wait"` from
 * their `Work.run` — #150's one addition to `vm/flow.ts`'s runner — having
 * set `state.prompt` themselves. `applyCombo` below is what stands in for
 * `again: true` at a prompt no declaration owns: it clears the battle
 * frame's own `asking` (left empty by `askers` since these steps declare no
 * `prompt:`) before returning, so the very next pass through the runner
 * calls `battleOffenseCombo`/`battleDefenseCombo`'s work again and either
 * offers the next card or, finding none left, falls through to the step
 * after.
 *
 * **What #150 built of damage, KO and combo, and what #151 still owns.**
 * `dealDamage` here is the generic move a battle needs — the top of the
 * declared `life` zone to the hand, face down, one card per hit, stopping to
 * ask over a life card's own 9-10 replacement (#272) — and
 * `koCard` is the generic KO: the card to its owner's Drop, the `ko` moment
 * fired with both roles. Both are *this* module's, because a battle cannot
 * resolve without them, and read one keyword directly ([Indestructible]
 * stopping a battle KO, #154) and ask the attacker's `beforeDamage` bodies
 * how its damage lands (#156: [Critical] sending the card to the Drop face
 * up, [Strike] raising the amount, [Victory Strike] ending the game
 * outright — `damageRule` below). Combo is paid through the same
 * `energy`-priced planner every other move is (`vm/costs.ts`), reading `comboCostOf` — the
 * declared, reduction-aware attribute — rather than a number this module
 * invents; #151 owns the Z-Energy a spent combo card may become at the end
 * of the battle (`DECLARED_BY`'s own "#151" against `zEnergyFromCombo`) and
 * this module simply sends every combo card to the Drop instead, which is
 * the honest board until that lands.
 *
 * Pure and client-safe, like the rest of `vm/`: no database, no network.
 */
import { IllegalAction } from "./common";
import { type EngineContext, type GameEvent, type LegalAction, type RejectedAction } from "../types";
import { canCombo } from "../text/cards";
import type { Action, PlayerId, Prompt, ReplacementResult, Requirement, Skill } from "../types";
import { describeScript, replacementPrompt, routeOf, type Op, type ScriptFrame } from "./script";
import type { ActionDef, GameDefinition } from "../rulesets";
import { applyDeclared, keyOf, legalActionsOf, rejectionsOf } from "./actions";
import { costIsOnlyOrbs } from "../compile";
import { altCostFor, programAltsFor, cardPrice, chargeCost, payAltCost, planCost, priceFor, restingFor, skillOrbs, type BoundAmounts } from "./costs";
import type { VmAltCost } from "./effects";
import { RulesetBroken } from "./errors";
import { emit, fire, log } from "./events";
import { endGame, enterPhase, moved, other, requirePrompt, type Work } from "./flow";
import { canPayPriceProgram } from "./activate";
import { fireHook } from "./hooks";
import { lifeReplacementChoices } from "./replace";
import { attrsNow, forbiddenBy, forbiddenForCard, forbids, hasKeyword, permissions, permitted, queryHookStatics, readingBoard } from "./program";
import { masterOf, skillsShowing } from "./triggers";
import { stepSkippedByPermanent, takeSkip } from "./skips";
import type { VmBattle, VmState } from "./state";

// ── the phase, from the Main Phase's own "attack" choice ────────────────────

/** Every attacker this player may declare right now, paired with a legal target, for the "main" prompt's menu. */
export function attackLegalActions(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId): LegalAction[] {
  const out: LegalAction[] = [];
  for (const attacker of eligibleAttackers(ctx, game, state, player)) {
    for (const target of targetsFor(ctx, game, state, player, attacker)) {
      const label = `Attack ${nameOf(ctx, state, target)} with ${nameOf(ctx, state, attacker)} (${powerOf(ctx, game, state, attacker)} vs ${powerOf(ctx, game, state, target)})`;
      out.push({ action: { type: "attack", player, attacker, target }, label });
    }
  }
  return out;
}

/** The `whyNotAttack` reading, one entry per card that could reach for the move and find no button — never per attacker×target pair, the way `mainActions`' own rejection twin reads it (8-1-1). */
export function attackRejectedActions(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId): RejectedAction[] {
  const out: RejectedAction[] = [];
  for (const attacker of inPlayCards(game, state, player)) {
    const why = attackWhy(ctx, game, state, player, attacker);
    if (!why.length) continue;
    out.push({ action: { type: "attack", player, attacker, target: attacker }, label: `Attack with ${nameOf(ctx, state, attacker)}`, why });
  }
  return out;
}

/** Take the move: open the battle. Leaves the Main Phase's own question on the table, the way `play`/`activate`'s `again: true` does. */
export function declareAttack(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], action: Action): void {
  if (action.type !== "attack") throw new RulesetBroken(state.game, "declareAttack called on a non-attack action");
  requirePrompt(state, action, ["main"]);
  const legal = attackLegalActions(ctx, game, state, action.player);
  if (!legal.some((l) => l.action.type === "attack" && l.action.attacker === action.attacker && l.action.target === action.target)) {
    throw new IllegalAction("that attack is not offered");
  }
  const attacker = action.attacker;
  setMode(ctx, game, state, ev, attacker, "rest");
  // 8-1, #156: the count [Dual Attack]'s `attacked` condition reads.
  state.cards[attacker].attacksThisTurn = (state.cards[attacker].attacksThisTurn ?? 0) + 1;
  state.battle = { attacker, guard: action.target, target: action.target, step: "declared", negated: false, blockerOffered: false, counters: [] };
  joinsBattle(state, attacker, action.target);
  log(ev, { type: "attack", attacker, target: action.target });
  enterPhase(ctx, game, state, ev, "battle");
}

const eligibleAttackers = (ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId): string[] =>
  inPlayCards(game, state, player).filter((id) => !attackWhy(ctx, game, state, player, id).length);

/**
 * 8-1-1: a Leader, a Unison, or a rested Battle Card of the opponent's — the
 * one target list every attacker shares today. No `attacker` parameter: the
 * day a [Permanent] permission like "can attack Battle Cards in Active Mode"
 * needs to widen the list *for that card* (Stage 7's keyword bodies, the same
 * shape legacy's own `permits(ctx, s, a, "attackActive")` extends this list
 * with), this signature grows one rather than carrying it unread until then.
 */
function targetsFor(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, attacker?: string): string[] {
  const opp = other(player);
  const out: string[] = [];
  const leader = state.sides[opp].zones.leader?.[0];
  if (leader) out.push(leader);
  // 23-5-2 with 8-1-1: a Hidden Mode card has no card type, so a face-down
  // card in a Battle or Unison Area is neither a Battle Card nor a Unison
  // Card, and only those are attacked.
  const unison = state.sides[opp].zones.unison?.[0];
  if (unison && !state.cards[unison]?.hidden) out.push(unison);
  for (const id of state.sides[opp].zones.battle ?? []) if (state.cards[id]?.mode === "rest" && !state.cards[id].hidden) out.push(id);
  // 8-1-1 lifted for this attacker: "this card can attack Battle Cards in
  // Active Mode" — a resolved skill's for its span, or a [Permanent]'s.
  if (attacker) {
    const lifts = permissions(ctx, game, state, "attackActive").filter((p) => p.target === attacker);
    for (const id of state.sides[opp].zones.battle ?? []) {
      if (state.cards[id]?.mode !== "active" || state.cards[id].hidden) continue;
      if (lifts.some((p) => permitted(ctx, game, state, p.filter, id))) out.push(id);
    }
  }
  return out.filter((id) => !forbids(ctx, game, state, "beAttacked", { player: opp, card: id }));
}

/** The `whyNotAttack` reading (8-1): timing first, then mode, then a prohibition, then whether anything at all may be hit — `whyNotCharge`'s own order, board-fact-before-card-fact where the two could otherwise disagree about which is first. */
function attackWhy(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, attacker: string): Requirement[] {
  const why: Requirement[] = [];
  // 7-3-4-4-1: not the first player's first turn.
  if (state.turn === 1 && player === state.firstPlayer) why.push({ kind: "timing", window: "nextTurn" });
  const inst = state.cards[attacker];
  if (!inst) return why;
  // 8-1-1 is a Leader, Battle or Unison *Card* attacking, and a Hidden Mode
  // card has no card type at all (23-5-2) — face down, it cannot attack.
  if (inst.hidden) why.push({ kind: "other", detail: "a Hidden Mode card has no card type, so it cannot attack (23-5-2)" });
  if (inst.mode !== "active") why.push({ kind: "mode", card: attacker, mode: (inst.mode as "active" | "rest" | null) ?? "active" });
  const banned = forbiddenBy(ctx, game, state, "attack", { player, card: attacker });
  if (banned) why.push({ kind: "forbidden", ...banned });
  if (!why.length && !targetsFor(ctx, game, state, player, attacker).length) why.push({ kind: "target", reason: "nothing may be attacked" });
  return why;
}

// ── battleDeclare: the moments, then the two windows before the fight begins ─

export const BATTLE_STEP_WORK: Record<string, Work> = {
  battleDeclare: {
    section: "8-1-3",
    waits: "a DO program of its own, the way every other worked step in `flow.ts` does — firing `attackDeclared` is native here because nothing yet needs a card's own text to change *how* an attack is declared, only what answers to one having been",
    run: (ctx, game, state) => {
      const b = state.battle!;
      const defender = other(state.turnPlayer);
      const guardArea = state.sides[defender].zones.leader?.includes(b.guard) ? "leader" : state.sides[defender].zones.unison?.includes(b.guard) ? "unison" : "battle";
      // Two moments, not one: `attacks`/`opponentAttacks` bind the attacker as
      // the card the trigger fires *for*, `attacked`/`yourLeaderAttacked` bind
      // the guard — and each is asked of a different card
      // (`matchTriggers`/`asked` reads `moment.card` literally), which one
      // moment cannot say about two cards at once. `role` is what tells the
      // two apart for the patterns that read either (`triggers.rules`'s own
      // `opponentAttacks`/`koed` carry the same field for the same reason,
      // added in this stage since neither had been fired before it).
      fire(ctx, game, state, { event: "attackDeclared", card: b.attacker, controller: state.turnPlayer, args: { role: "attacker" } });
      fire(ctx, game, state, { event: "attackDeclared", card: b.guard, controller: defender, args: { role: "target", target: guardArea } });
    },
  },

  // 8-1-4, 9-7: the window after an attack is declared, before anything else
  // happens — the guard has not been asked to block yet, so a [Counter: Attack]
  // answers the attack itself rather than whatever guards it in the end.
  battleCounterAttack: {
    section: "8-1-4",
    waits: "9-7-3's recursion — a [Counter: Counter] answering the counter just taken (the legacy `counter` window); this engine opens the attack window and, since #150, the play window (`openPlayCounterWindow`), but neither over its own resolution",
    run: (ctx, game, state) => openCounterWindow(ctx, game, state),
  },

  battleBlocker: {
    section: "8-1-2-1",
    waits: "[Blocker] as a keyword macro (Stage 7) rather than a bare `hasKeyword` read — this step already offers the window, which is the whole of what #150 owes it (issue #150's own 'out of scope' line)",
    run: (ctx, game, state) => openBlockerWindow(ctx, game, state),
  },

  battleOffense: {
    section: "8-2",
    waits: "20-13's skip as a declared `skip:` on the step rather than read here natively — a battle step is the turn player's or the guard's, which a phase's word (always the turn player's) cannot say",
    run: (ctx, game, state, ev) => {
      const b = state.battle;
      if (!b || !battleIntact(state)) return abortToEnd(game, state);
      b.step = "offense";
      // 20-13: "you skip your Offense Step" — announced and then not
      // performed, so no [Auto] answers to its start and no combo is offered
      // (`comboWork` reads `skipped`). A one-shot entry, or a [Permanent]
      // holding while its own condition does (#278): the legacy
      // `battleOffense`'s two readings, in its order.
      if (takeSkip(state, state.turnPlayer, "offense") || stepSkippedByPermanent(ctx, game, state, state.turnPlayer, "offense")) {
        (b.skipped ??= []).push("offense");
        log(ev, { type: "battleStep", step: "offense", skipped: true });
        return;
      }
      log(ev, { type: "battleStep", step: "offense" });
      // `offenseStart` names no `watcher:` — it is `WHERE isTurnPlayer(who:
      // you)` alone, the same shape `phaseStart` fires with no `card` at all
      // (`flow.ts`'s `enterPhase`): a moment with no card asks every card in
      // play (9-1-3-1) and the `WHERE` is what narrows it to one side.
      fire(ctx, game, state, { event: "stepStart", controller: state.turnPlayer, args: { step: "offense" } });
    },
  },
  battleOffenseCombo: { section: "5-7, 8-2", waits: "nothing — offered every pass, declined by the generic `pass`", run: (ctx, game, state, ev) => comboWork(ctx, game, state, ev, "offense") },

  battleDefense: {
    section: "8-3",
    waits: "20-13's skip as a declared field, the same gap `battleOffense` carries",
    run: (ctx, game, state, ev) => {
      const b = state.battle;
      if (!b || !battleIntact(state)) return abortToEnd(game, state);
      // 8-2-4-3-1-1: a Unison guard has no Defense Step at all.
      const defender = other(state.turnPlayer);
      if (state.sides[defender].zones.unison?.includes(b.guard)) return;
      b.step = "defense";
      // 20-13: "your opponent skips their Defense Step" — the guard's side.
      if (takeSkip(state, defender, "defense") || stepSkippedByPermanent(ctx, game, state, defender, "defense")) {
        (b.skipped ??= []).push("defense");
        log(ev, { type: "battleStep", step: "defense", skipped: true });
        return;
      }
      log(ev, { type: "battleStep", step: "defense" });
      fire(ctx, game, state, { event: "stepStart", controller: defender, args: { step: "defense" } });
    },
  },
  battleDefenseCombo: { section: "5-7, 8-3", waits: "the same as the offense one", run: (ctx, game, state, ev) => comboWork(ctx, game, state, ev, "defense") },

  battleDamage: {
    section: "8-4",
    waits: "a damage loop as a program: 9-10's life replacements are asked per life card natively since #272 (`dealDamage`'s `replaceMove`, the legacy `damageLife`'s question) — [Strike]/[Critical]/[Victory Strike] are the attacker's `beforeDamage` bodies since #156, and [Indestructible]'s battle-KO half is #154's, read directly in `damageWork` below",
    run: (ctx, game, state, ev) => damageWork(ctx, game, state, ev),
  },

  battleEnd: {
    section: "8-5",
    waits: "the Z-Energy offer over a spent combo card (#151 owns `zEnergyFromCombo`)",
    run: (ctx, game, state, ev) => {
      const b = state.battle;
      if (!b) return;
      b.step = "battleEnd";
      log(ev, { type: "battleStep", step: "battleEnd" });
      // 8-5-5..8: every combo card, both sides, to the Drop — #151's own
      // primitive picks up the Z-Energy offer this loop does not make.
      // `moved()` already fires the generic `moved(from: combo)` moment
      // `comboed` reads (5-7's own "when this card is used in a combo" is
      // answered by the departure, not by a second `comboUsed` here — that
      // moment is "when you combo", fired once already, in `applyCombo`, at
      // the moment the card joined).
      for (const p of Object.keys(state.sides) as PlayerId[]) {
        for (const id of (state.sides[p].zones.combo ?? []).slice()) {
          moved(ctx, game, state, ev, id, "drop", { owner: p });
        }
      }
      fire(ctx, game, state, { event: "stepStart", controller: state.turnPlayer, args: { step: "battleEnd" } });
      // #156: [Revenge]'s own hook (22-9) — the guard's `[attacker]` is read
      // off `state.battle`, which is why this step does not clear it itself
      // (`vm/flow.ts`'s own phase-pop does, once this step's queued program
      // has actually run — see the comment there for why the ordering
      // matters). Fired on both cards of the fight: the guard's is
      // [Revenge]'s, the attacker's [Dual Attack]'s stand (22-8-3). Each body
      // is `unshift`ed onto the queue, so the attacker's is fired first and
      // runs second — the legacy `battleCleanup`'s order, the [Revenge] KO
      // before the stand.
      if (b.attacker !== b.guard) fireHook(ctx, game, state, b.attacker, "battleEnd");
      fireHook(ctx, game, state, b.guard, "battleEnd");
    },
  },
};

/**
 * 8-1-2-1: these cards are now the attack card and the guard card, which is
 * what BT3-103 means by participating in a battle. The roles end with the
 * battle (8-1-2-2) and the card is asked about it afterwards, so the memory
 * lives on the card until `endTurn` clears it — the legacy engine's own
 * `joinsBattle` (`engine/engine.ts`), ported for #152 rather than left
 * `NARROWER` (`vm/program.ts`'s `"battled"` condition reads this field now).
 */
function joinsBattle(state: VmState, ...ids: string[]): void {
  for (const id of ids) if (state.cards[id]) state.cards[id].battledThisTurn = true;
}

/** 8-1-7: if the attacker or the guard has already left play — or, 23-5-4, been switched to Hidden Mode — the battle skips straight to its end step. */
function battleIntact(state: VmState): boolean {
  const b = state.battle;
  if (!b || b.hiddenOut) return false;
  return inPlayZone(state, b.attacker) !== null && inPlayZone(state, b.guard) !== null;
}

function inPlayZone(state: VmState, id: string): PlayerId | null {
  for (const p of Object.keys(state.sides) as PlayerId[]) {
    for (const zone of ["battle", "leader", "unison"]) if (state.sides[p].zones[zone]?.includes(id)) return p;
  }
  return null;
}

/**
 * 8-1-6-1, 8-1-7: a negated attack, or one whose attacker or guard has already
 * left play, goes straight to the Battle End Step — read at the front of
 * every step from `battleBlocker` on, the same point `battleIntact` guards in
 * the legacy engine. Jumps the battle phase's own frame straight to
 * `battleEnd` by name, read off the declaration rather than a second copy of
 * the step order — the honest version of `flow.ts`'s own `SETUP_ZONES`
 * convention for a name this module still has to know.
 */
function abortToEnd(game: GameDefinition, state: VmState): void {
  const top = state.flow[state.flow.length - 1];
  if (!top) return;
  const steps = game.phases[top.phase]?.steps ?? [];
  const at = steps.indexOf("battleEnd");
  // The runner's own fallthrough (`vm/flow.ts`) does `top.index++` immediately
  // after this step's `run` returns without waiting — this call is made
  // *from inside* that same `run`, so one short of `battleEnd`'s real index
  // is what lands exactly on it once that increment happens, rather than one
  // past it.
  if (at >= 0) top.index = at - 1;
}

// ── the counter windows (8-1-4, 9-7, 22-10) ─────────────────────────────────

interface CounterCandidate {
  card: string;
  skill: Skill;
  bound: BoundAmounts;
}

/**
 * The two windows this engine opens, and the legacy engine's word for each
 * (`CounterWindow`): the one after an attack is declared (8-1-4) and the one
 * between a play being declared and its resolving (9-6, #150's second). The
 * other two legacy words are not opened here — `counter` (a [Counter:
 * Counter] answering a counter, 9-7-3's recursion) and `skill`, which the
 * legacy engine opens with no candidates at all.
 */
type OpenWindow = "attack" | "play";

/** Is this printed line one the window offers? The legacy `counterCandidates`' own `want`. */
function wantsLine(ctx: EngineContext, state: VmState, window: OpenWindow, sk: Skill): boolean {
  if (window === "play") return sk.kind === "counter:play";
  const b = state.battle;
  if (!b) return false;
  return sk.kind === "counter:attack" || (sk.kind === "counter:battle card attack" && baseTypeOf(ctx, state, b.attacker) === "BATTLE");
}

/**
 * 22-20: a card being played that is "not affected by [Counter: Play] skills"
 * empties the window outright — [Deflect]'s own `counterWindow` hook body
 * (`keywords.rules`), read the declarative way every query hook is
 * (`queryHookStatics`), asked of the card whose play opened the window. The
 * legacy `counterCandidates`' first line, `has(playing, "Deflect")`.
 */
function windowClosedBy(ctx: EngineContext, game: GameDefinition, state: VmState, window: OpenWindow): boolean {
  if (window !== "play") return false;
  const playing = state.resolving?.card;
  if (!playing) return true;
  return queryHookStatics(ctx, game, state, playing, "counterWindow").some((f) => f.op === "forbid" && f.forbid.what === "activateCounter");
}

/**
 * Hand cards whose printed [Counter] of the window's kind this engine can both
 * pay for and resolve — the legacy `counterCandidates`' own reading
 * (`playCost(id) + orbTotals(id, sk)`), minus an alt cost (5-3, Stage 7).
 *
 * Deliberately **not** `vm/activate.ts`'s `boundFor`: that function's "an
 * Extra used from the hand pays its own energy cost too" (12-2-2) is
 * `activate`'s own reading of 4-2 — using an Extra *is* playing it — and
 * folds the card's price into the line's own. A [Counter] is never "played"
 * by being activated (22-10-7 sends it to the Drop as the counter itself,
 * not as 5-5's play), so its price is the ordinary sum every counter has:
 * the card's own cost, exactly as `play` would charge it, plus whatever the
 * skill line prints in front of its own colon — reusing `boundFor` here
 * would double an Extra counter's price, since its own Extra-in-hand
 * addition and this module's card price would both count the same cost.
 */
function counterCandidates(ctx: EngineContext, game: GameDefinition, state: VmState, responder: PlayerId, window: OpenWindow = "attack"): CounterCandidate[] {
  if (window === "attack" && !state.battle) return [];
  if (windowClosedBy(ctx, game, state, window)) return [];
  const out: CounterCandidate[] = [];
  for (const card of state.sides[responder].zones.hand ?? []) {
    const showing = skillsShowing(ctx, state, card);
    for (const sk of showing.skills) {
      if (!wantsLine(ctx, state, window, sk)) continue;
      if (!canResolveLine(sk, showing.scripts.bySkill[sk.index])) continue;
      if (forbids(ctx, game, state, "activateCounter", { player: responder, card })) continue;
      // 4-3-3: a price that is an action as well as orbs — "Choose 1 of your
      // white Battle Cards and switch it to Hidden Mode: Play this card"
      // (BT28-121) — is offered while it can be paid, the way an [Activate]'s
      // is (`canPayPriceProgram`); one with no record to pay it from is not.
      if (!costIsOnlyOrbs(sk.cost)) {
        const ops = counterPriceOps(showing.scripts.bySkill[sk.index]);
        if (!ops || !canPayPriceProgram(ctx, game, state, responder, card, ops)) continue;
      }
      const combined = counterPrice(ctx, game, state, card, sk);
      const price = priceFor(ctx, game, state, game.actions.play!, card, combined);
      // 5-3: a card printing another way to pay for its [Counter] is a
      // candidate on that price alone when the energy is not there — the
      // legacy `counterCandidates`' own `altCostFor` (#439).
      if (!planCost(ctx, game, state, responder, price, card).ok && !counterAlt(ctx, game, state, card, responder)) continue;
      out.push({ card, skill: sk, bound: combined });
    }
  }
  return out;
}

/** The action price (4-3-3) a [Counter] line's record carries, or null when it has none. */
function counterPriceOps(script: { price?: { ops?: Op[] | null } } | undefined): Op[] | null {
  const ops = script?.price?.ops;
  return ops?.length ? ops : null;
}

/** Where a [Counter]'s action price leaves what it chose for the effect — `vm/activate.ts`'s own key shape. */
const counterVarsKey = (card: string, skillIndex: number) => `costvars:${card}:${skillIndex}`;

/**
 * 5-3: the other price a [Counter] in the hand may be activated at — one its
 * own skills or a skill in force give it for a counter, or 22-37's [Invoker]:
 * an Extra used from the hand is played (4-2), so the resting price
 * [Invoker]'s `altPayment` body offers for a play stands for its [Counter]
 * too, as the legacy `altCostFor` offers its `invoker` price there (#439).
 */
function counterAlt(ctx: EngineContext, game: GameDefinition, state: VmState, card: string, player: PlayerId): VmAltCost | null {
  const own = altCostFor(ctx, game, state, card, player, "counter");
  if (own) return own;
  // 5-3 with 4-3-3: an alternative that is an action — "by choosing 1 Hidden
  // Mode card in your Battle Area and placing it into its owner's Drop"
  // (BT28-124) — offered while that action can be paid.
  const action = programAltsFor(ctx, game, state, card, "counter").find((alt) => canPayPriceProgram(ctx, game, state, player, card, alt.ops!));
  if (action) return action;
  const asPlay = baseTypeOf(ctx, state, card) === "EXTRA" ? altCostFor(ctx, game, state, card, player, "play") : null;
  return asPlay && asPlay.pay === "energy" && asPlay.rest ? asPlay : null;
}

/**
 * The counter prompt's menu: each candidate at its price when the energy
 * covers it, and again at its printed alternative (5-3) when it has one — a
 * second, separate offer, the legacy menu's "Counter with X (for no
 * energy)" row (#439). The paid row keeps the shape it always had.
 */
export function counterLegalActions(ctx: EngineContext, game: GameDefinition, state: VmState): LegalAction[] {
  const pr = state.prompt;
  if (pr.kind !== "counter") return [];
  const window: OpenWindow = pr.window === "play" ? "play" : "attack";
  const out: LegalAction[] = [];
  for (const card of pr.candidates) {
    const sk = skillsShowing(ctx, state, card).skills.find((s) => wantsLine(ctx, state, window, s));
    const paid = sk ? planCost(ctx, game, state, pr.player, priceFor(ctx, game, state, game.actions.play!, card, counterPrice(ctx, game, state, card, sk)), card).ok : false;
    if (paid) out.push({ action: { type: "counter", player: pr.player, card }, label: `Counter with ${nameOf(ctx, state, card)}` });
    const alt = counterAlt(ctx, game, state, card, pr.player);
    if (!alt) continue;
    const resting = restingFor(alt);
    const orbs = (alt.orbs ?? []).map((o) => `{${o}}`).join("");
    const how = alt.pay === "none" ? "for no energy" : alt.pay === "program" ? `instead of energy: ${describeScript(alt.ops ?? [])}` : alt.pay === "life" ? `by adding ${alt.n} from your life to your hand` : resting.length ? `by resting ${resting.map((id) => nameOf(ctx, state, id)).join(" and ")}` : `for ${orbs}`;
    const energy = alt.pay === "energy" ? (alt.orbs ?? []).length || 1 : 0;
    const cost = alt.pay === "none" ? { energy: 0, describe: "free" } : alt.pay === "energy" ? { energy, describe: orbs || "free" } : { energy: 0, describe: "alternative cost" };
    out.push({ action: { type: "counter", player: pr.player, card, ...(sk ? { skill: sk.index } : {}), alt: true }, label: `Counter with ${nameOf(ctx, state, card)} (${how})`, cost });
  }
  return out;
}

function openCounterWindow(ctx: EngineContext, game: GameDefinition, state: VmState): void | "wait" {
  const b = state.battle;
  if (!b || b.negated || !battleIntact(state)) return;
  const responder = other(state.turnPlayer);
  const candidates = counterCandidates(ctx, game, state, responder);
  if (!candidates.length) return;
  state.prompt = { kind: "counter", player: responder, window: "attack", candidates: candidates.map((c) => c.card) };
  return "wait";
}

/**
 * The moves that declare a play a [Counter: Play] may answer — the legacy
 * engine's three action handlers that put `{op:"counter", window:"play"}` in
 * front of their `play.resolve` (`engine/engine.ts`). A play a *skill* makes
 * (5-5-3, the `play` op) opens no window on either engine. The keyword plays
 * the legacy engine also opens one over are the `play` op's `counterWindow`
 * (`openKeywordPlayWindow` below — [Arrival], [Successor] and [Revive] since
 * #155; [Swap] and [Over Realm] are still unwritten), and [Evolve] and [Union]
 * open none on either engine (#157).
 */
const PLAY_MOVES: readonly Action["type"][] = ["play", "playUnison", "playZ"];

/**
 * 9-6, 22-10: the window between a play being declared and its resolving.
 *
 * Called by `vm/index.ts` once a declared play has been paid for and its `DO`
 * queued, and before the flow runs on. With no [Counter: Play] the opponent
 * could use, nothing changes: the play resolves inside its own `DO` the way it
 * always has, which is the legacy engine's own "a window with no candidates is
 * not opened". With one, the move's `DO` frame is lifted off the queue onto
 * `state.resolving` — the play is now *being resolved* — and the opponent is
 * asked. `vm/flow.ts`'s runner puts the frame back once the answer (and any
 * counter's own program) has run, so the counter resolves first and the play
 * after it: 9-7-3's descending order, the order the legacy flow stack gives
 * the same two steps.
 */
export function openPlayCounterWindow(ctx: EngineContext, game: GameDefinition, state: VmState, action: Action): boolean {
  if (!PLAY_MOVES.includes(action.type)) return false;
  const card = (action as { card?: string }).card;
  const frame = state.programs[0];
  // The declared move's own `DO` is the frame `runProgram` just put at the
  // front, bound to the card it plays; anything else there is not a play this
  // window could stand in front of.
  if (!card || !frame || frame.card !== card || frame.skillIndex !== undefined) return false;
  state.resolving = { card, player: action.player };
  const responder = other(action.player);
  const candidates = counterCandidates(ctx, game, state, responder, "play");
  if (!candidates.length) {
    state.resolving = null;
    return false;
  }
  state.programs.shift();
  state.resolving.frame = frame;
  state.prompt = { kind: "counter", player: responder, window: "play", candidates: candidates.map((c) => c.card) };
  return true;
}

/**
 * #155: the same window over the play a keyword's own move makes — [Arrival],
 * [Revive] and [Successor] say `play(target: [self], counterWindow: true)`,
 * the legacy engine's `{op:"counter", window:"play"}` in front of its
 * `play.resolve`. Reached from inside the running program (`host.playThen`),
 * so what is held on `state.resolving` is that program, put back *at* its
 * `play` op — with the window field dropped, so landing the card does not ask
 * again — and `vm/flow.ts`'s runner releases it once the answer has run, the
 * same as a declared play's `DO`. False, and nothing changed, when the
 * opponent has no [Counter: Play] to answer with.
 */
export function openKeywordPlayWindow(ctx: EngineContext, game: GameDefinition, state: VmState, card: string, player: PlayerId, frame: ScriptFrame): boolean {
  state.resolving = { card, player };
  const responder = other(player);
  const candidates = counterCandidates(ctx, game, state, responder, "play");
  if (!candidates.length) {
    state.resolving = null;
    return false;
  }
  const at = frame.ip - 1;
  const ops = frame.ops.slice();
  const landing = { ...ops[at] } as Extract<Op, { op: "play" }>;
  delete landing.counterWindow;
  ops[at] = landing;
  state.resolving.frame = { ...frame, ops, ip: at };
  state.prompt = { kind: "counter", player: responder, window: "play", candidates: candidates.map((c) => c.card) };
  return true;
}

/** Which window the counter prompt on the table (or the one a `payCost` interrupted) belongs to: a play being resolved, or the battle's. */
const windowNow = (state: VmState): OpenWindow => (state.resolving?.frame ? "play" : "attack");

const canResolveLine = (sk: Skill, script: { unsupported: unknown[] } | undefined): boolean => (!sk.effect.trim() ? true : !!script && script.unsupported.length === 0);

function mergeOrbs(a: Partial<Record<string, number>>, b: Partial<Record<string, number>>): Partial<Record<string, number>> {
  const out: Partial<Record<string, number>> = { ...a };
  for (const [k, n] of Object.entries(b)) out[k] = (out[k] ?? 0) + (n ?? 0);
  return out;
}

/** A [Counter]'s price: the card's own play price plus whatever orbs are printed in front of the skill line itself (5-3, legacy `playCost(id) + orbTotals(id, sk)`). */
function counterPrice(ctx: EngineContext, game: GameDefinition, state: VmState, card: string, sk: Skill): BoundAmounts {
  const play = cardPrice(ctx, game, state, card);
  // 20-21: the line's own orbs through their reduction layer — "reduce the
  // skill cost of your red cards in your hand by {r}" reaches a [Counter]'s
  // orbs as it reaches an [Activate]'s (`skillOrbs`, #148; #439 for this
  // window), the legacy `orbTotals` every counter price is read through.
  const own = skillOrbs(ctx, game, state, card, sk);
  return { energy: { total: play.total + own.total, orbs: mergeOrbs(play.orbs, own.orbs), either: own.either }, markers: 0, unreadable: null };
}

/** The base printed type, Z- stripped — the same reading `vm/play.ts`'s `PLAY_ZONES` and `vm/filters.ts` make of the `type` attribute. */
function baseTypeOf(ctx: EngineContext, state: VmState, id: string): string {
  const inst = state.cards[id];
  const def = inst && ctx.defs[inst.cardId];
  if (!def) return "";
  return String(def.type ?? "").replace(/^Z-/, "");
}

/**
 * Take the counter move, or decline it (a null `card`, exactly `block`'s
 * shape). `"asked"` mirrors `applyDeclared`'s own answer for a price with more
 * than one genuinely different way to pay (3-8-2): the caller must not run the
 * flow on, because the frame this suspended in is the whole of its
 * continuation, the same promise every other costed move keeps.
 */
export function applyCounter(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], action: Action): "done" | "asked" {
  if (action.type !== "counter") throw new RulesetBroken(state.game, "applyCounter called on a non-counter action");
  requirePrompt(state, action, ["counter"]);
  const pr = state.prompt as Extract<Prompt, { kind: "counter" }>;
  if (!action.card) return "done";
  if (!pr.candidates.includes(action.card)) throw new IllegalAction("that card can't counter now");
  const card = action.card;
  const window: OpenWindow = pr.window === "play" ? "play" : "attack";
  const showing = skillsShowing(ctx, state, card);
  const sk = showing.skills.find((s) => s.index === action.skill && wantsLine(ctx, state, window, s)) ?? showing.skills.find((s) => wantsLine(ctx, state, window, s));
  if (!sk) throw new IllegalAction("no counter skill on that card");
  // 5-3: the printed alternative is paid *instead of* the card's energy cost
  // and the line's orbs — the legacy `payAltCost` on `action.alt` (#439).
  const alt = action.alt ? counterAlt(ctx, game, state, card, action.player) : null;
  if (action.alt && !alt) throw new IllegalAction("that card has no other cost to pay");
  // An action alternative (`pay: "program"`) is not paid here: it runs as a
  // price program in front of the effect, below.
  if (alt) {
    if (alt.pay !== "program") payAltCost(ctx, game, state, ev, action.player, alt);
  } else {
    const combined = counterPrice(ctx, game, state, card, sk);
    const price = priceFor(ctx, game, state, game.actions.play!, card, combined);
    const plan = planCost(ctx, game, state, action.player, price, card, action.pay);
    if (!plan.ok) throw new IllegalAction(`can't pay the counter's cost: ${plan.why[0]?.kind}`);
    if (action.pay === undefined && plan.asks && plan.options.length > 1) {
      const describe = `activate ${nameOf(ctx, state, card)}'s counter`;
      state.prompt = { kind: "payCost", player: action.player, action, options: plan.options, describe };
      return "asked";
    }
    chargeCost(ctx, game, state, ev, action.player, plan.payment, card, ["energy"]);
  }
  // 22-10-7: the battle writes the counter down before it is lost in the
  // Drop (staging spec §3.1) — the battle's own record, so a [Counter: Play]
  // answered outside one is written nowhere, as on the legacy engine.
  const b = state.battle;
  if (b) (b.counters ??= []).push({ card, by: action.player, after: state.sides[action.player].zones.combo?.length ?? 0 });
  moved(ctx, game, state, ev, card, "drop", { owner: action.player, reveal: true });
  // "Without paying its energy cost" is the waiver alone, as on the legacy
  // engine (`counterFreeFromHand` pends for `pay: "none"` only).
  fire(ctx, game, state, { event: "skillActivated", card, controller: action.player, args: { kind: "counter", from: "hand", paid: alt?.pay !== "none", extra: baseTypeOf(ctx, state, card) === "EXTRA" } });
  const program = showing.scripts.bySkill[sk.index]?.ops ?? [];
  // 4-3-3: an action price runs as its own program in front of the effect and
  // hands on what it chose ("the card that was switched to Hidden Mode by
  // this skill", BT28-121); the price finishing is what announces the line —
  // `vm/activate.ts`'s shape, which the host already reads.
  const priceOps = alt?.pay === "program" ? (alt.ops ?? null) : costIsOnlyOrbs(sk.cost) || alt ? null : counterPriceOps(showing.scripts.bySkill[sk.index]);
  if (priceOps) {
    const key = counterVarsKey(card, sk.index);
    state.programs.unshift({ ops: priceOps, ip: 0, vars: {}, card, master: action.player, skillIndex: sk.index, saveVarsAs: key }, { ops: program, ip: 0, vars: {}, card, master: action.player, skillIndex: sk.index, pricedBy: { key, text: sk.raw } });
    return "done";
  }
  log(ev, { type: "skill", card, skill: sk.index, master: action.player, text: sk.raw, inBattle: !!b });
  if (program.length) state.programs.unshift({ ops: program, ip: 0, vars: {}, card, master: action.player, skillIndex: sk.index });
  return "done";
}

// ── the blocker window (8-1-2-1, 22-4) ──────────────────────────────────────

function blockerCandidates(ctx: EngineContext, game: GameDefinition, state: VmState, defender: PlayerId): string[] {
  const b = state.battle;
  if (!b) return [];
  return (state.sides[defender].zones.battle ?? []).filter(
    (id) => id !== b.guard && state.cards[id]?.mode === "active" && hasKeyword(ctx, game, state, id, "Blocker") && !forbids(ctx, game, state, "block", { player: defender, card: id }),
  );
}

function openBlockerWindow(ctx: EngineContext, game: GameDefinition, state: VmState): void | "wait" {
  const b = state.battle;
  if (!b || b.negated || !battleIntact(state)) return abortToEnd(game, state);
  if (b.blockerOffered) return;
  b.blockerOffered = true;
  const defender = other(state.turnPlayer);
  const candidates = blockerCandidates(ctx, game, state, defender);
  if (!candidates.length) return;
  state.prompt = { kind: "blocker", player: defender, candidates };
  return "wait";
}

export function applyBlock(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], action: Action): void {
  if (action.type !== "block") throw new RulesetBroken(state.game, "applyBlock called on a non-block action");
  requirePrompt(state, action, ["blocker"]);
  const pr = state.prompt as Extract<Prompt, { kind: "blocker" }>;
  if (!action.card) return;
  if (!pr.candidates.includes(action.card)) throw new IllegalAction("that card can't block now");
  const b = state.battle!;
  setMode(ctx, game, state, ev, action.card, "rest");
  b.guard = action.card;
  joinsBattle(state, action.card);
  log(ev, { type: "guardChanged", guard: action.card, by: action.card });
  fire(ctx, game, state, { event: "keywordActivated", card: action.card, controller: masterOf(game, state, action.card), args: { keyword: "Blocker" } });
  // The new guard is attacked too (8-1-2-1), the same `attacked`/`yourLeaderAttacked` moment the original target answered to.
  const defender = other(state.turnPlayer);
  const guardArea = state.sides[defender].zones.leader?.includes(action.card) ? "leader" : state.sides[defender].zones.unison?.includes(action.card) ? "unison" : "battle";
  fire(ctx, game, state, { event: "attackDeclared", card: action.card, controller: defender, args: { role: "target", target: guardArea } });
}

// ── the combo offer (5-7, 8-2, 8-3) ─────────────────────────────────────────

function comboEligible(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId): string[] {
  // Only reads, and asks the statics once per card in hand and on the field.
  return readingBoard(ctx, game, state, () => comboEligibleOnBoard(ctx, game, state, player));
}

function comboEligibleOnBoard(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId): string[] {
  const b = state.battle;
  if (!b) return [];
  const hand = state.sides[player].zones.hand ?? [];
  // 5-7 lifted: "you can use your … Rest Mode … cards in combos" (BT18-001,
  // BT29-129) lets in the rested ones the description fits.
  const rested = permissions(ctx, game, state, "comboRest").filter((p) => p.master === player);
  const field = (state.sides[player].zones.battle ?? []).filter(
    (id) => id !== b.attacker && id !== b.guard && (state.cards[id]?.mode === "active" || (state.cards[id]?.mode === "rest" && rested.some((p) => permitted(ctx, game, state, p.filter, id)))),
  );
  return [...hand, ...field].filter((id) => {
    const inst = state.cards[id];
    const def = inst && ctx.defs[inst.cardId];
    if (!def || !canCombo(def)) return false;
    if (forbids(ctx, game, state, "combo", { player, card: id })) return false;
    const cost = Number(attrsNow(ctx, game, state, id).comboCostOf ?? def.comboCost ?? 0);
    const price = priceFor(ctx, game, state, game.actions.play!, id, { energy: { total: cost, orbs: {}, either: [] }, markers: 0, unreadable: null });
    return planCost(ctx, game, state, player, price, id).ok;
  });
}

function comboSide(ctx: EngineContext, state: VmState, side: "offense" | "defense"): PlayerId {
  return side === "offense" ? state.turnPlayer : other(state.turnPlayer);
}

function comboWork(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], side: "offense" | "defense"): void | "wait" {
  const b = state.battle;
  if (!b || b.negated || !battleIntact(state)) return abortToEnd(game, state);
  // 8-2-4-3-1-1: a Unison guard has no Defense Step at all, and the combo
  // offer is part of it — `battleDefense`'s own mode-switch step already
  // makes this check (#150); the combo step is a separate declared step
  // (`BATTLE_STEP_WORK`) and needs the same one, or a Unison guard would get
  // half a Defense Step instead of none (#152, found by staging it).
  if (side === "defense" && state.sides[other(state.turnPlayer)].zones.unison?.includes(b.guard)) return;
  // 20-13: the combo offer is part of the step it belongs to, so a skipped
  // step makes none.
  if (b.skipped?.includes(side)) return;
  const player = comboSide(ctx, state, side);
  if (!comboEligible(ctx, game, state, player).length && !battleActivations(ctx, game, state, player).length) return;
  state.prompt = { kind: "combo", player, side };
  return "wait";
}

export function comboLegalActions(ctx: EngineContext, game: GameDefinition, state: VmState): LegalAction[] {
  const pr = state.prompt;
  if (pr.kind !== "combo") return [];
  return [
    ...comboEligible(ctx, game, state, pr.player).map((card) => ({ action: { type: "combo" as const, player: pr.player, card }, label: `Combo ${nameOf(ctx, state, card)}` })),
    ...battleActivations(ctx, game, state, pr.player),
  ];
}

// ── [Activate: Battle] at the combo prompt (1-5-5, 8-2, 8-3) ───────────────

/**
 * The skill kinds the battle's own window offers: [Activate: Battle], and the
 * lines usable in either window. `actions.rules`' `activate` declares the
 * Main Phase's pair; this is the same paragraph's other window, which its own
 * comment anticipates ("the window this move offers is the one its kinds
 * share") — `windowOf` reads `battle` off these two the way it reads `main`
 * off the declared ones, so a Main-only line asked about here is owed the
 * `timing` requirement naming its window, with no second table.
 */
const BATTLE_SKILL_KINDS: NonNullable<ActionDef["skills"]> = ["activate:battle", "activate:main/battle"];

/**
 * `actions.rules`' `activate`, read against the combo prompt (#150).
 *
 * A declaration's name is the action type a client sends (`vm/actions.ts`), so
 * the battle window cannot be a second `DEFINE ACTION activate` — the loader
 * keys declarations by name. It is the one paragraph with its window moved:
 * the same `FOR`, the same price (`COST [marker, energy, payWith, text]`), the
 * same `again:`, asked in the battle phase at the combo prompt, about the
 * battle's own kinds. The legacy twin is the combo case of its `legalActions`,
 * which offers `activatable(…, "battle")` over the hand and the cards in play.
 */
function battleActivationDef(game: GameDefinition): ActionDef | null {
  const declared = game.actions.activate;
  if (!declared) return null;
  return { ...declared, when: ["battle"], prompts: ["combo"], skills: BATTLE_SKILL_KINDS };
}

function battleActivations(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId): LegalAction[] {
  const def = battleActivationDef(game);
  return def ? legalActionsOf(ctx, game, state, def, player) : [];
}

/**
 * Take an [Activate: Battle] at the combo prompt: the declared move, checked
 * and charged exactly as at the Main Phase (`applyDeclared`), and then the
 * combo step asked **again** once the skill has resolved — the legacy
 * `battle.promptCombo` pushed behind `activate()`. `reask` rather than
 * clearing `asking` the way `applyCombo` does, because clearing it would
 * re-run the step before the program it just queued (`vm/flow.ts`'s runner
 * works a fresh step before it drains the queue), and a skill that puts a
 * card in the Combo Area has to have done so before the next offer is read.
 */
export function applyBattleActivation(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], action: Action): "done" | "asked" {
  requirePrompt(state, action, ["combo"]);
  const def = battleActivationDef(game);
  if (!def) throw new IllegalAction("nothing declares using a skill");
  const took = applyDeclared(ctx, game, state, ev, action, def);
  if (took === "asked") return "asked";
  const top = state.flow[state.flow.length - 1];
  if (top) top.reask = true;
  return "done";
}

export function applyCombo(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], action: Action): "done" | "asked" {
  if (action.type !== "combo") throw new RulesetBroken(state.game, "applyCombo called on a non-combo action");
  requirePrompt(state, action, ["combo"]);
  if (!comboEligible(ctx, game, state, action.player).includes(action.card)) throw new IllegalAction("that card can't combo now");
  const inst = state.cards[action.card];
  const def = ctx.defs[inst.cardId];
  const cost = Number(attrsNow(ctx, game, state, action.card).comboCostOf ?? def.comboCost ?? 0);
  const price = priceFor(ctx, game, state, game.actions.play!, action.card, { energy: { total: cost, orbs: {}, either: [] }, markers: 0, unreadable: null });
  const plan = planCost(ctx, game, state, action.player, price, action.card, action.pay);
  if (!plan.ok) throw new IllegalAction(`can't pay the combo cost: ${plan.why[0]?.kind}`);
  if (action.pay === undefined && plan.asks && plan.options.length > 1) {
    state.prompt = { kind: "payCost", player: action.player, action, options: plan.options, describe: `combo ${nameOf(ctx, state, action.card)}` };
    return "asked";
  }
  chargeCost(ctx, game, state, ev, action.player, plan.payment, action.card, ["energy"]);
  moved(ctx, game, state, ev, action.card, "combo", { owner: action.player, reveal: true });
  fire(ctx, game, state, { event: "comboUsed", card: action.card, controller: action.player, args: {} });
  // The step is asked again — a player may combo more than one card — once
  // the checkpoint has run: "when you combo" (5-7) has just pended, and the
  // legacy flow resolves it before the next combo offer (#439). `reask` is
  // the runner's own "ask this step again after the checkpoint", the one an
  // [Activate: Battle] taken at the same prompt uses.
  const top = state.flow[state.flow.length - 1];
  if (top) top.reask = true;
  return "done";
}

/**
 * Put back the native prompt a `combo` or `counter` action was answering,
 * after `payCost` set its own prompt in its place (3-8-2).
 *
 * The shared `payCost` re-entry (`vm/index.ts`) rediscovers a *declared*
 * move's question by running the flow again and reading the step's own
 * `top.asking` — which works because such a move never touched it (`again:`
 * leaves it exactly as `askers` set it). `combo`/`counter`/`block`'s prompts
 * are never built that way at all (`vm/battle.ts`'s own header): their steps
 * declare no `prompt:`, so `top.asking` is always empty and running the flow
 * on it would simply fall through and advance the battle to its next step —
 * silently discarding the question rather than restoring it. This is the
 * other half of the same re-entry, for the two native moves the shared one
 * cannot reconstruct: recomputed exactly as the window that opened it would,
 * from the action alone (`counter`'s candidates are read fresh; `combo`'s
 * `side` is derived from whether the answering player is the turn player).
 * Null when the action is not one of these two, so the caller falls back to
 * the shared mechanism unchanged.
 */
export function restoreNativePrompt(ctx: EngineContext, game: GameDefinition, state: VmState, action: Action): Prompt | null {
  if (action.type === "counter") {
    const responder = action.player;
    const window = windowNow(state);
    const candidates = counterCandidates(ctx, game, state, responder, window).map((c) => c.card);
    return { kind: "counter", player: responder, window, candidates };
  }
  // An [Activate: Battle] is asked at the combo prompt and nowhere else in
  // the battle phase (#150), so an activation interrupted there is that one.
  if (action.type === "combo" || (action.type === "activate" && state.phase === "battle")) {
    const side: "offense" | "defense" = action.player === state.turnPlayer ? "offense" : "defense";
    return { kind: "combo", player: action.player, side };
  }
  return null;
}

// ── damage and KO (8-4) ──────────────────────────────────────────────────────

function damageWork(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[]): void | "wait" {
  const b = state.battle;
  // #272: the step is back with the answer to one life card's question — it
  // picks up at that card, without re-reading the battle (the legacy
  // `battleDamage`'s `resume`, which goes straight to `damageLife`).
  if (b?.damage) return dealDamage(ctx, game, state, ev, other(state.turnPlayer));
  if (!b || b.negated || !battleIntact(state)) return abortToEnd(game, state);
  b.step = "damage";
  log(ev, { type: "battleStep", step: "damage" });
  // `damageStart` (§8-4) is `watcher: both` — every card in play answers, so
  // no `card` is needed to pick a side; `WHERE` is absent too, unlike the
  // offense/defense steps' own moments.
  fire(ctx, game, state, { event: "stepStart", controller: state.turnPlayer, args: { step: "damage" } });
  const atkP = state.turnPlayer;
  const defP = other(atkP);
  const combo = (p: PlayerId) => (state.sides[p].zones.combo ?? []).reduce((n, id) => n + Number(attrsNow(ctx, game, state, id).comboPower ?? 0), 0);
  const attackPower = Number(attrsNow(ctx, game, state, b.attacker).power ?? 0) + combo(atkP);
  const guardPower = Number(attrsNow(ctx, game, state, b.guard).power ?? 0) + combo(defP);
  const hit = attackPower >= guardPower;
  log(ev, { type: "powerCompare", attacker: b.attacker, guard: b.guard, attackPower, guardPower, hit });
  if (hit) {
    const how = damageRule(ctx, game, state, b.attacker);
    if (state.sides[defP].zones.leader?.includes(b.guard)) {
      // 8-4-6-1, 22-7: [Strike X] raises the damage to X.
      b.damage = { taken: [], remaining: Math.max(1, how.atLeast ?? 1), critical: how.to === "drop", ...(how.wins ? { wins: true as const } : {}) };
      return dealDamage(ctx, game, state, ev, defP);
    } else if (state.sides[defP].zones.unison?.includes(b.guard)) {
      // 13-5-2: markers come off instead of a KO — X for [Strike X], every
      // one for [Victory Strike] (13-5-2-2), one otherwise.
      const inst = state.cards[b.guard];
      const want = how.allMarkers ? inst.markers : (how.atLeast ?? 1);
      const n = Math.min(want, inst.markers);
      inst.markers = Math.max(0, inst.markers - want);
      log(ev, { type: "markers", card: b.guard, delta: -n, total: inst.markers });
      fire(ctx, game, state, { event: "markerRemoved", card: b.guard, controller: defP, args: {} });
    } else if (!hasKeyword(ctx, game, state, b.guard, "Indestructible")) {
      // 22-12: "can't be KO'd... as a result of battle" — battle's own KO,
      // not an effect's, so it is read directly rather than through the hook
      // contract's `koByEffect` (#154; that hook is for a *skill's* KO, and
      // reads `forbid(what: beKOdBySkill)` through `prohibitions()` instead —
      // see `docs/arena-ruleset-spec.md` §4.3).
      koCard(ctx, game, state, ev, b.guard, b.attacker);
    }
  }
}

/** How an attacker's battle damage lands: the `beforeDamage` hook bodies in force on it, folded together. */
interface DamageRule {
  atLeast?: number;
  to?: "drop";
  allMarkers?: boolean;
  wins?: boolean;
}

/**
 * 8-4-6, 22-6/22-7/22-18: the attacker's `beforeDamage` bodies — [Critical],
 * [Strike X], [Victory Strike] — read declaratively the moment the damage
 * lands (`queryHookStatics`), the legacy `battleDamage`'s own inline
 * `has`/`keyword` reads. A keyword granted for the turn counts, as it does
 * there. Two [Strike]s keep the larger X.
 */
function damageRule(ctx: EngineContext, game: GameDefinition, state: VmState, attacker: string): DamageRule {
  const out: DamageRule = {};
  for (const f of queryHookStatics(ctx, game, state, attacker, "beforeDamage")) {
    if (f.op !== "battleDamage") continue;
    if (f.atLeast !== undefined) out.atLeast = Math.max(out.atLeast ?? 0, f.atLeast);
    if (f.to) out.to = f.to;
    if (f.allMarkers) out.allMarkers = true;
    if (f.wins) out.wins = true;
  }
  return out;
}

/**
 * 8-4-6-1: the generic move a battle needs — the declared `life` zone's top
 * card to the hand, face down, one per hit; #151's `damage(side, n)` primitive
 * is this same shape, generalised to a program rather than a battle step.
 * The attacker's own rule (#156), read once into `state.battle.damage` when
 * the damage began: [Critical] sends the cards to the Drop face up instead
 * (22-6), and [Victory Strike] ends the game once one has landed (22-18-2) —
 * after the damage is logged and its moments fired, the legacy `damageLife`'s
 * order.
 *
 * One life card at a time (#272): each can carry its own `life` replacement
 * (BT10-031/SD18-01's "you may reveal it and add it to your hand instead",
 * `vm/replace.ts`'s `lifeReplacementChoices`), and 9-10-2's choice between
 * several or 9-10-3's "you may" is the one reason this loop stops. It puts
 * the `replaceMove` question to the life card's owner and says `"wait"`;
 * the answer (`vm/index.ts`'s `chooseMode`) clears the step's `asking` through
 * `resumeDamage` below, the runner calls the Damage Step's work again, and
 * `damageWork` hands straight back here with `awaiting` set, which reads the
 * answer off `lastMode` rather than asking about the next card — the legacy
 * `damageLife`'s own re-entry, over the same record.
 */
function dealDamage(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], defender: PlayerId): void | "wait" {
  const b = state.battle!;
  const d = b.damage!;
  const dest = d.critical ? "drop" : "hand";
  while (d.remaining > 0) {
    const id = state.sides[defender].zones.life?.[0];
    if (!id) break;
    const choices = lifeReplacementChoices(ctx, game, state, id, dest);
    const allowNone = choices.length > 0 && choices.every((c) => c.optional);
    let replaced: ReplacementResult | null | undefined;
    if (d.awaiting) {
      const index = state.lastMode;
      state.lastMode = null;
      delete d.awaiting;
      replaced = index == null || index < 0 || index >= choices.length ? null : routeOf(choices[index]);
    } else if (choices.length > 1 || allowNone) {
      d.awaiting = true;
      const prompt = replacementPrompt(nameOf(ctx, state, id), dest, choices, allowNone);
      state.prompt = { kind: "replaceMove", player: defender, card: id, reason: prompt.reason, options: prompt.options };
      return "wait";
    } else {
      replaced = choices.length ? routeOf(choices[0]) : null;
    }
    // `reveal` is said either way, as the legacy `damageLife` says it. Never
    // deferred: neither printed card's substitute (reveal, then to the hand)
    // asks anything of its own, so `leaveRoute` runs it inline.
    moved(ctx, game, state, ev, id, dest, { owner: defender, reveal: d.critical, ...(replaced === undefined ? {} : { replaced }) });
    d.taken.push(id);
    d.remaining--;
  }
  delete b.damage;
  const taken = d.taken;
  if (!taken.length) return;
  log(ev, { type: "damage", player: defender, amount: taken.length, critical: d.critical, cards: taken });
  const attacker = b.attacker;
  fire(ctx, game, state, { event: "damage", card: attacker, controller: masterOf(game, state, attacker), args: { role: "source" } });
  if (d.wins) endGame(ctx, game, state, ev, other(defender), `[Victory Strike] — ${nameOf(ctx, state, attacker)} dealt damage`);
}

/**
 * The answer to a life card's question is in (`vm/index.ts`'s `chooseMode`):
 * if the Damage Step is the one waiting on it, it is asked to run again, the
 * way `applyCombo` re-asks the combo step. True when it was.
 */
export function resumeDamage(state: VmState): boolean {
  if (!state.battle?.damage?.awaiting) return false;
  const top = state.flow[state.flow.length - 1];
  if (top) delete top.asking;
  return true;
}

/**
 * 5-12 / 8-4-6-2: the generic KO — a battle's and a skill's alike (#146), to
 * the owner's Drop, with the moments the legacy `koCard` (`engine/triggers.ts`)
 * pends, in the log order it writes them.
 *
 * - **20-14 first**: a card that "can't be KO'd" at all is not KO'd by battle
 *   either, so the prohibition is read here rather than at either caller —
 *   the legacy engine's own placement, and the reason a battle KO now reads
 *   it too.
 * - **The `ko` event, then the move**: the client's picture of a KO is the
 *   legacy engine's two events in that order (`ko`, then `move` to the Drop),
 *   which is what `beats.ts` plays the shatter off.
 * - **Both roles**: `koed` for the card itself (with `to: drop`, 9-1-3-1's
 *   derived "fires while elsewhere"), and `cause` for the card that did it —
 *   only when that card is an *opponent's* and still exists, the legacy
 *   `kos` pend's own three conditions ("when this card KOs an opponent's
 *   Battle Card"). `cause` is absent for a KO no card caused.
 *
 * The move itself carries no `by`: a KO by skill is not, on either engine,
 * the "removed from a Battle Area by a skill" moment (the legacy `ko` op pends
 * nothing of that family), only `leftBattleToDrop`'s causeless one.
 */
export function koCard(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], card: string, cause?: string, replaced?: ReplacementResult | null): void {
  if (forbids(ctx, game, state, "beKOd", { card })) return;
  const owner = state.cards[card].owner;
  const master = masterOf(game, state, card);
  // 9-6-9-3: a card KO'd face down answers to its own KO only where a
  // declaration asks for that (`matchTriggers`).
  const wasHidden = !!state.cards[card].hidden;
  log(ev, { type: "ko", card, ...(cause === undefined ? {} : { by: cause }) });
  // 9-10: a KO is a departure a replacement may stand in front of — the one
  // a skill's `ko` loop settled on, or the first that answers (`vm/replace.ts`).
  moved(ctx, game, state, ev, card, "drop", { owner, reason: "ko", ...(replaced !== undefined ? { replaced } : {}) });
  // `to: drop` matches `koed`'s own pattern (`triggers.rules`) — the card has
  // already landed there by the time this fires, and that field is what lets
  // it still answer about itself (9-1-3-1's derived "fires while elsewhere").
  fire(ctx, game, state, { event: "ko", card, controller: owner, args: { role: "koed", to: "drop", ...(wasHidden ? { hidden: true } : {}) } });
  if (cause !== undefined && cause !== card && state.cards[cause] && masterOf(game, state, cause) !== master) {
    fire(ctx, game, state, { event: "ko", card: cause, controller: masterOf(game, state, cause), args: { role: "cause" } });
  }
}

// ── why not: the battle's own three prompts (review §3.7, #152) ──────────────

/**
 * The rejected list at a battle prompt — `combo`, `counter` or `blocker` — the
 * twin of the menu `vm/index.ts`'s `promptAnswers` gives at the same three.
 *
 * Each case is the legacy `rejectedActions`' own (`engine/rejections.ts`), gate
 * for gate and in its order, so the first requirement the two engines give for
 * the same card on the same board is the same requirement. One entry per card
 * per action type, except an activation, which is one per skill line (§3.2) —
 * the same `keyOf` the declared moves are filed under, so nothing offered is
 * also refused and nothing is refused twice. A reason list that comes out empty
 * is a drifted twin, and says so the way the legacy one does rather than
 * vanishing from both lists.
 */
export function battleRejectedActions(ctx: EngineContext, game: GameDefinition, state: VmState, legal: LegalAction[]): RejectedAction[] {
  const pr = state.prompt;
  if (pr.kind !== "combo" && pr.kind !== "counter" && pr.kind !== "blocker") return [];
  const p = pr.player;
  const offered = new Set(legal.map((l) => keyOf(l.action)));
  const seen = new Set<string>();
  const out: RejectedAction[] = [];
  const push = (r: RejectedAction) => {
    const key = keyOf(r.action);
    if (offered.has(key) || seen.has(key)) return;
    seen.add(key);
    out.push(r.why.length ? r : { ...r, why: [{ kind: "other", detail: "not offered by the engine" }] });
  };
  const zone = (name: string): string[] => state.sides[p].zones[name] ?? [];

  if (pr.kind === "combo") {
    // The legacy order: each hand card's combo and then its own activations,
    // the Battle Area's combos, and then the activations of every card in play.
    const def = battleActivationDef(game);
    const activations = def ? rejectionsOf(ctx, game, state, def, p, offered) : [];
    const activationsOfCard = (id: string) => activations.filter((r) => r.action.type === "activate" && r.action.card === id);
    for (const id of zone("hand")) {
      push({ action: { type: "combo", player: p, card: id }, label: `Combo ${nameOf(ctx, state, id)}`, why: comboWhy(ctx, game, state, p, id) });
      for (const r of activationsOfCard(id)) push(r);
    }
    for (const id of zone("battle")) push({ action: { type: "combo", player: p, card: id }, label: `Combo ${nameOf(ctx, state, id)}`, why: comboWhy(ctx, game, state, p, id) });
    for (const id of cardsInPlay(state, p)) for (const r of activationsOfCard(id)) push(r);
    return out;
  }

  if (pr.kind === "counter") {
    // Every counter card in hand that is not on the menu: a candidate the
    // energy cannot cover, a counter for another moment, or one this engine
    // cannot read — the same gates `counterCandidates` and the menu apply.
    for (const id of zone("hand")) {
      const why = counterWhy(ctx, game, state, p, id, pr.window, pr.candidates);
      if (why) push({ action: { type: "counter", player: p, card: id }, label: `Counter with ${nameOf(ctx, state, id)}`, why });
    }
    return out;
  }

  // A [Blocker] that is not offered: the card being attacked, resting, or
  // forbidden to block.
  const b = state.battle;
  for (const id of cardsInPlay(state, p)) {
    if (pr.candidates.includes(id) || !hasKeyword(ctx, game, state, id, "Blocker")) continue;
    const why: Requirement[] = [];
    if (b && id === b.guard) why.push({ kind: "other", detail: "it is the card being attacked" });
    if (state.cards[id].mode !== "active") why.push(modeWhy(ctx, game, state, id));
    const banned = forbiddenBy(ctx, game, state, "block", { player: p, card: id });
    if (banned) why.push({ kind: "forbidden", ...banned });
    push({ action: { type: "block", player: p, card: id }, label: `Block with ${nameOf(ctx, state, id)}`, why });
  }
  return out;
}

/**
 * The legacy `whyNotCombo`: the Battle Area's own gates first (the attacker and
 * the guard are already in the battle, and a rested or face-down card cannot
 * join it), then the card's ability to combo at all, a prohibition (20-14), and
 * the combo cost (5-7-3) — read through the same planner `comboEligible` pays
 * with, so the energy the refusal counts is the energy the menu counted.
 */
function comboWhy(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, card: string): Requirement[] {
  const why: Requirement[] = [];
  const b = state.battle;
  const inst = state.cards[card];
  if (state.sides[player].zones.battle?.includes(card)) {
    if (b && card === b.attacker) why.push({ kind: "other", detail: "it is the attacking card" });
    else if (b && card === b.guard) why.push({ kind: "other", detail: "it is the card being attacked" });
    if (inst.mode !== "active") why.push(modeWhy(ctx, game, state, card));
    if (inst.hidden) why.push({ kind: "other", detail: "a face-down card cannot combo" });
  }
  const def = ctx.defs[inst.cardId];
  const combos = !!def && canCombo(def);
  if (!combos) why.push({ kind: "cardType", card, needs: "a Battle Card with a combo cost" });
  const banned = forbiddenBy(ctx, game, state, "combo", { player, card });
  if (banned) why.push({ kind: "forbidden", ...banned });
  if (combos) {
    const cost = Number(attrsNow(ctx, game, state, card).comboCostOf ?? def.comboCost ?? 0);
    const price = priceFor(ctx, game, state, game.actions.play!, card, { energy: { total: cost, orbs: {}, either: [] }, markers: 0, unreadable: null });
    const plan = planCost(ctx, game, state, player, price, card);
    if (!plan.ok) why.push(...plan.why);
  }
  return why;
}

/**
 * The legacy `whyNotCounter`: null for a card with no [Counter] line at all,
 * which nobody expects to counter with. A card already on the window's list
 * that is not on the menu is held up only by its price; any other names the
 * window its first line belongs to, [Deflect] closing the window (22-20), the
 * attacker's kind, an unreadable effect, a prohibition, and then the price.
 *
 * One reading the legacy engine has no twin for: a [Counter] whose printed
 * price is more than orbs is never offered here (`counterCandidates`'
 * `costIsOnlyOrbs`), so it is refused as `unread` rather than left in neither
 * list.
 */
function counterWhy(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, card: string, window: string, candidates: string[]): Requirement[] | null {
  const showing = skillsShowing(ctx, state, card);
  const counters = showing.skills.filter((sk) => sk.kind.startsWith("counter:"));
  if (!counters.length) return null;
  const priceOf = (sk: Skill): Requirement[] => {
    const price = priceFor(ctx, game, state, game.actions.play!, card, counterPrice(ctx, game, state, card, sk));
    const plan = planCost(ctx, game, state, player, price, card);
    return plan.ok ? [] : plan.why;
  };
  // On the list but not on the menu: only the price stops it.
  if (candidates.includes(card)) return priceOf(counters[0]);
  const fits = counters.filter(
    (sk) =>
      (window === "play" && sk.kind === "counter:play") ||
      (window === "attack" && (sk.kind === "counter:attack" || sk.kind === "counter:battle card attack")) ||
      (window === "counter" && sk.kind === "counter:counter"),
  );
  if (!fits.length) return [{ kind: "timing", window: counters[0].kind.replace("counter:", "") }];
  const sk = fits[0];
  const why: Requirement[] = [];
  const playing = window === "play" ? state.resolving?.card : undefined;
  if (playing && windowClosedBy(ctx, game, state, "play")) why.push({ kind: "forbidden", by: nameOf(ctx, state, playing), until: "permanent" });
  const b = state.battle;
  if (sk.kind === "counter:battle card attack" && b && baseTypeOf(ctx, state, b.attacker) !== "BATTLE") why.push({ kind: "target", reason: "only an attacking Battle Card" });
  if (!canResolveLine(sk, showing.scripts.bySkill[sk.index])) why.push({ kind: "unread", card });
  const banned = forbiddenBy(ctx, game, state, "activateCounter", { player, card });
  if (banned) why.push({ kind: "forbidden", ...banned });
  why.push(...priceOf(sk));
  if (!why.length && !costIsOnlyOrbs(sk.cost)) why.push({ kind: "unread", card });
  return why;
}

/** The legacy `modeWhy`: a card refused for resting, `locked` when a rule will keep it down through its next Charge Phase (7-2-7 lifted by 20-14). */
function modeWhy(ctx: EngineContext, game: GameDefinition, state: VmState, card: string): Requirement {
  const mode = state.cards[card].mode === "rest" ? "rest" : "active";
  return { kind: "mode", card, mode, ...(forbiddenForCard(ctx, game, state, "switchToActive", card) ? { locked: true } : {}) };
}

/** The legacy `cardsInPlay`, in its order: the Leader, the Unison, then the Battle Area. */
function cardsInPlay(state: VmState, player: PlayerId): string[] {
  const zones = state.sides[player].zones;
  return [...(zones.leader ?? []), ...(zones.unison ?? []), ...(zones.battle ?? [])];
}

// ── small shared readings ────────────────────────────────────────────────────

function inPlayCards(game: GameDefinition, state: VmState, player: PlayerId): string[] {
  return Object.entries(state.sides[player].zones)
    .filter(([zone]) => game.zones[zone]?.inPlay === true)
    .flatMap(([, ids]) => ids);
}

function setMode(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], id: string, mode: string): void {
  const inst = state.cards[id];
  if (!inst || inst.mode === mode) return;
  inst.mode = mode;
  emit(ctx, game, state, ev, { event: "modeSwitched", card: id, controller: masterOf(game, state, id), args: { mode } }, { type: "mode", card: id, mode: mode as "active" | "rest" });
}

const nameOf = (ctx: EngineContext, state: VmState, id: string): string => ctx.defs[state.cards[id]?.cardId ?? ""]?.name ?? id;

const powerOf = (ctx: EngineContext, game: GameDefinition, state: VmState, id: string): number => Number(attrsNow(ctx, game, state, id).power ?? 0);

export type { VmBattle };
