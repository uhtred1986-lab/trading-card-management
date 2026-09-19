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
 * declared `life` zone to the hand, face down, one card per hit — and
 * `koCard` is the generic KO: the card to its owner's Drop, the `ko` moment
 * fired with both roles. Both are *this* module's, because a battle cannot
 * resolve without them, but neither reads a keyword ([Critical] sending the
 * card to the Drop face up, [Strike] raising the amount, [Indestructible]
 * stopping the KO, [Victory Strike] ending the game outright) — those are
 * Stage 7's, and the honest board today is the one 8-4-6-1 and 8-4-6-2 read
 * with no keyword in force. Combo is paid through the same `energy`-priced
 * planner every other move is (`vm/costs.ts`), reading `comboCostOf` — the
 * declared, reduction-aware attribute — rather than a number this module
 * invents; #151 owns the Z-Energy a spent combo card may become at the end
 * of the battle (`DECLARED_BY`'s own "#151" against `zEnergyFromCombo`) and
 * this module simply sends every combo card to the Drop instead, which is
 * the honest board until that lands.
 *
 * Pure and client-safe, like the rest of `vm/`: no database, no network.
 */
import { IllegalAction, type EngineContext, type GameEvent, type LegalAction, type RejectedAction } from "../engine";
import { canCombo } from "../engine/cards";
import type { Action, PlayerId, Prompt, Requirement, Skill } from "../engine/types";
import type { GameDefinition } from "../rulesets";
import { boundFor, type ActivationLine } from "./activate";
import { cardPrice, chargeCost, planCost, priceFor, type BoundAmounts } from "./costs";
import { RulesetBroken } from "./errors";
import { emit, fire, log } from "./events";
import { enterPhase, moved, other, requirePrompt, type Work } from "./flow";
import { attrsNow, forbiddenBy, forbids, hasKeyword } from "./program";
import { masterOf, skillsShowing } from "./triggers";
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
  state.battle = { attacker, guard: action.target, target: action.target, step: "declared", negated: false, blockerOffered: false, counters: [] };
  log(ev, { type: "attack", attacker, target: action.target });
  enterPhase(ctx, game, state, ev, "battle");
}

const eligibleAttackers = (ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId): string[] =>
  inPlayCards(game, state, player).filter((id) => !attackWhy(ctx, game, state, player, id).length);

/**
 * 8-1-1: a Leader, a Unison, or a rested Battle Card of the opponent's — the
 * one target list every attacker shares. `_attacker` is unread today and kept
 * in the signature for the day a [Permanent] permission like "can attack
 * Battle Cards in Active Mode" needs to widen the list *for that card*
 * (Stage 7's keyword bodies) — the same shape legacy's own `permits(ctx, s,
 * a, "attackActive")` extends this list with.
 */
function targetsFor(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, _attacker: string): string[] {
  const opp = other(player);
  const out: string[] = [];
  const leader = state.sides[opp].zones.leader?.[0];
  if (leader) out.push(leader);
  const unison = state.sides[opp].zones.unison?.[0];
  if (unison) out.push(unison);
  for (const id of state.sides[opp].zones.battle ?? []) if (state.cards[id]?.mode === "rest") out.push(id);
  return out.filter((id) => !forbids(ctx, game, state, "beAttacked", { player: opp, card: id }));
}

/** The `whyNotAttack` reading (8-1): timing first, then mode, then a prohibition, then whether anything at all may be hit — `whyNotCharge`'s own order, board-fact-before-card-fact where the two could otherwise disagree about which is first. */
function attackWhy(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, attacker: string): Requirement[] {
  const why: Requirement[] = [];
  // 7-3-4-4-1: not the first player's first turn.
  if (state.turn === 1 && player === state.firstPlayer) why.push({ kind: "timing", window: "nextTurn" });
  const inst = state.cards[attacker];
  if (!inst) return why;
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
    waits: "a second counter window (Stage 6 opens only the attack one; the play and skill windows named in `vm/host.ts`'s and `vm/play.ts`'s own docstrings are a separate piece of work)",
    run: (ctx, game, state) => openCounterWindow(ctx, game, state),
  },

  battleBlocker: {
    section: "8-1-2-1",
    waits: "[Blocker] as a keyword macro (Stage 7) rather than a bare `hasKeyword` read — this step already offers the window, which is the whole of what #150 owes it (issue #150's own 'out of scope' line)",
    run: (ctx, game, state) => openBlockerWindow(ctx, game, state),
  },

  battleOffense: {
    section: "8-2",
    waits: "20-13's skip as something this step reads generically rather than never applying — no card in the harness skips a step yet, so the gap is unexercised, not fixed",
    run: (ctx, game, state, ev) => {
      const b = state.battle;
      if (!b || !battleIntact(state)) return abortToEnd(game, state);
      b.step = "offense";
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
    waits: "20-13's skip, the same gap `battleOffense` carries",
    run: (ctx, game, state, ev) => {
      const b = state.battle;
      if (!b || !battleIntact(state)) return abortToEnd(game, state);
      // 8-2-4-3-1-1: a Unison guard has no Defense Step at all.
      const defender = other(state.turnPlayer);
      if (state.sides[defender].zones.unison?.includes(b.guard)) return;
      b.step = "defense";
      log(ev, { type: "battleStep", step: "defense" });
      fire(ctx, game, state, { event: "stepStart", controller: defender, args: { step: "defense" } });
    },
  },
  battleDefenseCombo: { section: "5-7, 8-3", waits: "the same as the offense one", run: (ctx, game, state, ev) => comboWork(ctx, game, state, ev, "defense") },

  battleDamage: {
    section: "8-4",
    waits: "[Strike]/[Critical]/[Indestructible]/[Victory Strike] (Stage 7 keyword bodies) — this reads 8-4-6-1/8-4-6-2 with none of them in force",
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
      state.battle = null;
    },
  },
};

/** 8-1-7: if the attacker or the guard has already left play, the battle skips straight to its end step. */
function battleIntact(state: VmState): boolean {
  const b = state.battle;
  if (!b) return false;
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
  if (at >= 0) top.index = at;
}

// ── the counter window (8-1-4, 9-7) ─────────────────────────────────────────

interface CounterCandidate {
  card: string;
  skill: Skill;
  bound: BoundAmounts;
}

/** Hand cards whose printed [Counter: Attack] (or [Counter: Battle Card Attack], narrowed to a Battle Card attacker) this engine can both pay for and resolve — the legacy `counterCandidates`' own reading, minus [Deflect] and an alt cost (5-3, Stage 7). */
function counterCandidates(ctx: EngineContext, game: GameDefinition, state: VmState, responder: PlayerId): CounterCandidate[] {
  const b = state.battle;
  if (!b) return [];
  const attackerIsBattleCard = baseTypeOf(ctx, state, b.attacker) === "BATTLE";
  const out: CounterCandidate[] = [];
  for (const card of state.sides[responder].zones.hand ?? []) {
    const showing = skillsShowing(ctx, state, card);
    for (const sk of showing.skills) {
      const wants = sk.kind === "counter:attack" || (sk.kind === "counter:battle card attack" && attackerIsBattleCard);
      if (!wants) continue;
      if (!canResolveLine(sk, showing.scripts.bySkill[sk.index])) continue;
      if (forbids(ctx, game, state, "activateCounter", { player: responder, card })) continue;
      const line: ActivationLine = { card, skillIndex: sk.index, skill: sk, script: showing.scripts.bySkill[sk.index] };
      const bound = boundFor(ctx, game, state, line);
      if (bound.unreadable !== null) continue;
      const play = cardPrice(ctx, game, state, card);
      const combined = counterPrice(play, bound);
      const price = priceFor(ctx, game, state, game.actions.play!, card, combined);
      if (!planCost(ctx, game, state, responder, price, card).ok) continue;
      out.push({ card, skill: sk, bound: combined });
    }
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

const canResolveLine = (sk: Skill, script: { unsupported: unknown[] } | undefined): boolean => (!sk.effect.trim() ? true : !!script && script.unsupported.length === 0);

function mergeOrbs(a: Partial<Record<string, number>>, b: Partial<Record<string, number>>): Partial<Record<string, number>> {
  const out: Partial<Record<string, number>> = { ...a };
  for (const [k, n] of Object.entries(b)) out[k] = (out[k] ?? 0) + (n ?? 0);
  return out;
}

/**
 * A [Counter] costs the card's own play price plus whatever orbs are printed
 * in front of the skill line itself (5-3, legacy `playCost` + `orbTotals`) —
 * `boundFor` reads only the second half (it exists for a *skill line*, and
 * only adds a card's play price for an Extra used from the hand, which a
 * [Counter] card never is), so the two are added here.
 */
function counterPrice(play: { total: number; orbs: Partial<Record<string, number>> }, bound: BoundAmounts): BoundAmounts {
  const line = bound.energy ?? { total: 0, orbs: {}, either: [] };
  return { energy: { total: play.total + (line.total ?? 0), orbs: mergeOrbs(play.orbs, line.orbs), either: line.either }, markers: 0, unreadable: null };
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
  const showing = skillsShowing(ctx, state, card);
  const attackerIsBattleCard = baseTypeOf(ctx, state, state.battle!.attacker) === "BATTLE";
  const sk = showing.skills.find((s) => s.kind === "counter:attack" || (s.kind === "counter:battle card attack" && attackerIsBattleCard));
  if (!sk) throw new IllegalAction("no counter skill on that card");
  const line: ActivationLine = { card, skillIndex: sk.index, skill: sk, script: showing.scripts.bySkill[sk.index] };
  const bound = boundFor(ctx, game, state, line);
  const play = cardPrice(ctx, game, state, card);
  const combined = counterPrice(play, bound);
  const price = priceFor(ctx, game, state, game.actions.play!, card, combined);
  const plan = planCost(ctx, game, state, action.player, price, card, action.pay);
  if (!plan.ok) throw new IllegalAction(`can't pay the counter's cost: ${plan.why[0]?.kind}`);
  if (action.pay === undefined && plan.asks && plan.options.length > 1) {
    const describe = `activate ${nameOf(ctx, state, card)}'s counter`;
    state.prompt = { kind: "payCost", player: action.player, action, options: plan.options, describe };
    return "asked";
  }
  chargeCost(ctx, game, state, ev, action.player, plan.payment, card, ["energy"]);
  const b = state.battle!;
  (b.counters ??= []).push({ card, by: action.player, after: state.sides[action.player].zones.combo?.length ?? 0 });
  moved(ctx, game, state, ev, card, "drop", { owner: action.player, reveal: true });
  fire(ctx, game, state, { event: "skillActivated", card, controller: action.player, args: { kind: "counter", from: "hand", paid: true } });
  log(ev, { type: "skill", card, skill: sk.index, master: action.player, text: sk.raw, inBattle: true });
  const program = showing.scripts.bySkill[sk.index]?.ops ?? [];
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
  log(ev, { type: "guardChanged", guard: action.card, by: action.card });
  fire(ctx, game, state, { event: "keywordActivated", card: action.card, controller: masterOf(game, state, action.card), args: { keyword: "Blocker" } });
  // The new guard is attacked too (8-1-2-1), the same `attacked`/`yourLeaderAttacked` moment the original target answered to.
  const defender = other(state.turnPlayer);
  const guardArea = state.sides[defender].zones.leader?.includes(action.card) ? "leader" : state.sides[defender].zones.unison?.includes(action.card) ? "unison" : "battle";
  fire(ctx, game, state, { event: "attackDeclared", card: action.card, controller: defender, args: { role: "target", target: guardArea } });
}

// ── the combo offer (5-7, 8-2, 8-3) ─────────────────────────────────────────

function comboEligible(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId): string[] {
  const b = state.battle;
  if (!b) return [];
  const hand = state.sides[player].zones.hand ?? [];
  const field = (state.sides[player].zones.battle ?? []).filter((id) => id !== b.attacker && id !== b.guard && state.cards[id]?.mode === "active");
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
  const player = comboSide(ctx, state, side);
  if (!comboEligible(ctx, game, state, player).length) return;
  state.prompt = { kind: "combo", player, side };
  return "wait";
}

export function comboLegalActions(ctx: EngineContext, game: GameDefinition, state: VmState): LegalAction[] {
  const pr = state.prompt;
  if (pr.kind !== "combo") return [];
  return comboEligible(ctx, game, state, pr.player).map((card) => ({ action: { type: "combo", player: pr.player, card }, label: `Combo ${nameOf(ctx, state, card)}` }));
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
  // The step is asked again — a player may combo more than one card — by
  // clearing this frame's `asking` so the runner re-invokes the work above.
  const top = state.flow[state.flow.length - 1];
  if (top) delete top.asking;
  return "done";
}

// ── damage and KO (8-4) ──────────────────────────────────────────────────────

function damageWork(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[]): void {
  const b = state.battle;
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
    if (state.sides[defP].zones.leader?.includes(b.guard)) {
      dealDamage(ctx, game, state, ev, defP, 1);
    } else if (state.sides[defP].zones.unison?.includes(b.guard)) {
      const inst = state.cards[b.guard];
      const n = Math.min(1, inst.markers);
      inst.markers = Math.max(0, inst.markers - 1);
      log(ev, { type: "markers", card: b.guard, delta: -n, total: inst.markers });
      fire(ctx, game, state, { event: "markerRemoved", card: b.guard, controller: defP, args: {} });
    } else {
      koCard(ctx, game, state, ev, b.guard, b.attacker);
    }
  }
}

/** 8-4-6-1: the generic move a battle needs — the declared `life` zone's top card to the hand, face down, one per hit. The face-up/[Critical] half is Stage 7's; #151's `damage(side, n)` primitive is this same shape, generalised to a program rather than a battle step. */
export function dealDamage(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], defender: PlayerId, n: number): void {
  const taken: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = state.sides[defender].zones.life?.[0];
    if (!id) break;
    moved(ctx, game, state, ev, id, "hand", { owner: defender });
    taken.push(id);
  }
  if (!taken.length) return;
  log(ev, { type: "damage", player: defender, amount: taken.length, critical: false, cards: taken });
  const attacker = state.battle?.attacker;
  if (attacker) fire(ctx, game, state, { event: "damage", card: attacker, controller: masterOf(game, state, attacker), args: { role: "source" } });
}

/** 8-4-6-2: the generic KO a battle needs — to the owner's Drop, both `ko` roles fired so `koed`/`kos`/`yourCardKoed`/`opponentCardKoed` each answer the moment meant for them. `role` tells the koed card's own moment from the causing card's, the same fix `battleDeclare` needed for `attackDeclared` (`triggers.rules`, this stage). */
export function koCard(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], card: string, cause: string): void {
  const owner = state.cards[card].owner;
  moved(ctx, game, state, ev, card, "drop", { owner });
  // `to: drop` matches `koed`'s own pattern (`triggers.rules`) — the card has
  // already landed there by the time this fires, and that field is what lets
  // it still answer about itself (9-1-3-1's derived "fires while elsewhere").
  fire(ctx, game, state, { event: "ko", card, controller: owner, args: { role: "koed", to: "drop" } });
  fire(ctx, game, state, { event: "ko", card: cause, controller: masterOf(game, state, cause), args: { role: "cause" } });
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
