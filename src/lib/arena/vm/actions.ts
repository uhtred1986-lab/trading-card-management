/**
 * A move, as a declaration — and the refusal that comes with it.
 *
 * In the legacy engine legality is a predicate per action (`canPlay`,
 * `canCombo`, `activatable`, `planPayment`) with a hand-written `whyNot*` twin
 * beside each, running the same tests in the same order and collecting instead
 * of short-circuiting (`engine/rejections.ts`'s own header). Two functions per
 * rule, adjacent in the file, held together by a test because nothing else
 * holds them together.
 *
 * Here there is one. A `DEFINE ACTION` says **WHEN** it is offered, **FOR**
 * which cards, what it **COST**s, what it **DO**es, and the requirements that
 * **REFUSE** it — and `legalActions` and `rejectedActions` are two readings of
 * that one paragraph: the candidates whose refusals are all satisfied, and the
 * first requirement that stopped each of the rest. Adding a move to a game is
 * then a paragraph in `actions.rules`, and the refusal comes for free
 * (#144).
 *
 * **The `Requirement` shapes are the engine's own**, so `src/lib/arena/wording.ts`
 * words a rules-engine refusal with the very table it words a legacy one with.
 * A game may not invent a requirement — `REQUIREMENT_KINDS` is closed — because
 * a refusal no client can say is a greyed-out move with nothing behind it.
 *
 * **One rejection per card per action type** (`docs/arena-workflow-spec.md`
 * §3.2). In the legacy engine that is a `keyOf`/`seen` pair inside
 * `rejections.ts`; here it is the shape rather than a pass — a candidate is a
 * card, an action is asked about it once, and a card already on the menu for
 * that action is never also refused for it. §3.2's exception is the same
 * promise one level down: an activation is one rejection *per skill line*,
 * because a card prints up to nine and one being on the menu says nothing about
 * the rest. `keyOf` below already files an activation under its skill index, so
 * the exception costs nothing when #147 declares the action whose candidate is
 * a skill line rather than a card.
 *
 * Pure and client-safe, like the rest of `vm/`: no database, no network, and
 * nothing read at request time.
 */
import { IllegalAction, type EngineContext, type GameEvent, type LegalAction, type RejectedAction } from "../engine";
import type { Action, PlayerId, Prompt, Requirement } from "../engine/types";
import type { Cond, Selector } from "../engine/script";
import type { ActionDef, GameDefinition } from "../rulesets";
import { attrsOf } from "./cards";
import { NotYet, RulesetBroken } from "./errors";
import { answered } from "./flow";
import { predicateOf } from "./filters";
import { SETUP_ZONES } from "./zones";
import type { VmState } from "./state";

/**
 * One candidate of one action: the card it is about, or null for a move that is
 * about no card at all (a decline, conceding, ending a phase).
 *
 * `why` is empty for a move that is offered and holds the requirements that
 * stopped it otherwise, most decisive first — which for a declared action means
 * the first `REFUSE` line that did not hold, since the list is written in the
 * order the legality check runs.
 */
export interface Candidate {
  card: string | null;
  why: Requirement[];
}

/**
 * Every declared action the question on the table could be answered with.
 *
 * Two gates, and both are the declaration's: the phase the flow is in has to be
 * one of `WHEN`'s, and the question has to be one of `prompts:`. An action that
 * names no prompts is offered at whatever its phases ask, which is how a game
 * with one question per phase says nothing twice.
 *
 * Who it is offered *to* is not a gate here and is not a field of the
 * declaration: a prompt is put to a player and an action answers a prompt, so
 * the asked player is the actor (`docs/arena-ruleset-spec.md` §7 — prompt
 * mechanics are the interpreter's).
 */
export function actionsAt(game: GameDefinition, state: VmState): ActionDef[] {
  const prompt = state.prompt;
  if (!("player" in prompt) || !prompt.player) return [];
  return Object.values(game.actions).filter((def) => def.when.includes(state.phase) && (def.prompts === undefined || def.prompts.includes(prompt.kind)));
}

/**
 * The cards an action is about, each with the requirements that refuse it.
 *
 * An action with no `FOR` is about no card: one candidate, and the `REFUSE`
 * list is read about the board rather than about a card. An action with one
 * asks it of every card the selector finds — including the cards it will
 * refuse, which is the point: a rejection is the answer to "why can't I play
 * *that* card", so a candidate that cannot be chosen still has to be asked
 * about.
 */
export function candidatesOf(ctx: EngineContext, game: GameDefinition, state: VmState, def: ActionDef, player: PlayerId): Candidate[] {
  if (def.decline !== undefined && def.for === undefined) {
    throw new RulesetBroken(state.game, `DEFINE ACTION ${JSON.stringify(def.name)} declines with no FOR, and a move about no card is already the answer that takes nothing`);
  }
  // 7-2-11: the charge is a *may*, and the half of it that takes no card is a
  // candidate of its own — one more answer to the same question, last on the
  // menu, so a client that draws a button per candidate keeps the ghost button
  // the board already has (`docs/arena-hud-spec.md` §2.3).
  const cards = def.for === undefined ? [null] : [...select(ctx, game, state, def.for, player), ...(def.decline === undefined ? [] : [null])];
  return cards.map((card) => {
    const why = refusedBy(ctx, game, state, def, player, card);
    // 8-3-2-3: an action asks for a price by name and `costs.rules` says how it
    // is charged. Neither the file nor the payment search exists yet, so a
    // priced action is refused with the reason rather than silently offered for
    // free — the same decision the price of 8 Sep 2026 made about a skill with
    // no record. Last, so a card refused for a reason of its own says that one.
    // Declining pays nothing, so it is not held up by a price either.
    if (!why.length && def.cost?.length && !declining(def, card)) why.push(unpriced(def));
    return { card, why };
  });
}

/**
 * Is this candidate the answer that takes none of what the move offers?
 *
 * An action with a `FOR` is about cards, and the one candidate that is about no
 * card is its `decline:` — which is never the thing that is refused: the
 * `REFUSE` lines are written about a card, and a question that is on the table
 * can always be answered by taking nothing from it. An action with no `FOR` is
 * about no card at all, and its one candidate is the move itself.
 */
const declining = (def: ActionDef, card: string | null): boolean => card === null && def.for !== undefined;

/** The requirement a price the interpreter cannot charge yet produces, in the one place both lists and `apply` read it from. */
const unpriced = (def: ActionDef): Requirement => ({
  kind: "other",
  detail: `${def.label ?? def.name} asks for the price ${def.cost!.join(" and ")}, which the rules engine cannot charge yet (#148)`,
});

/**
 * Why this candidate is not offered, or nothing.
 *
 * The `REFUSE` lines are read **in order and no further than the first that
 * fails**: they are written in the order the legality check runs, and a later
 * line may well ask something that only makes sense once the earlier one holds.
 * A price the interpreter cannot charge yet is not one of these and is added
 * after them by `candidatesOf`, so a card refused for a reason of its own says
 * that reason.
 */
function refusedBy(ctx: EngineContext, game: GameDefinition, state: VmState, def: ActionDef, player: PlayerId, card: string | null): Requirement[] {
  if (declining(def, card)) return [];
  for (const refusal of def.refusals ?? []) {
    if (holds(ctx, game, state, refusal.unless, player, card)) continue;
    return [requirementOf(state, refusal.kind, refusal.args, card)];
  }
  return [];
}

/**
 * A declared refusal, as the `Requirement` a client words.
 *
 * The literal fields come off the declaration; the one field an interpreter can
 * work out for itself is filled in here — every requirement that is *about a
 * card* carries the candidate's instance id, because the declaration cannot
 * know which card it is being asked about. Everything else a game has to say.
 */
function requirementOf(state: VmState, kind: Requirement["kind"], args: Record<string, unknown>, card: string | null): Requirement {
  const out: Record<string, unknown> = { kind, ...args };
  if (card !== null && ABOUT_A_CARD.has(kind) && out.card === undefined) out.card = card;
  if (kind === "mode" && out.mode === undefined && card !== null) out.mode = state.cards[card]?.mode ?? "active";
  return out as unknown as Requirement;
}

/** The requirement kinds whose shape carries the card they are about (`engine/types.ts`). */
const ABOUT_A_CARD = new Set<Requirement["kind"]>(["mode", "zone", "cardType", "immune", "unread"]);

// ── the two lists ───────────────────────────────────────────────────────────

/**
 * Every declared move that may be made now.
 *
 * `listed: false` is left out — a move a client shows as a button of its own is
 * accepted without being enumerated, which is what the legacy engine does with
 * conceding. It is still checked exactly as a listed move is; it is simply not
 * on the menu, and so is on neither list.
 */
export function declaredLegalActions(ctx: EngineContext, game: GameDefinition, state: VmState): LegalAction[] {
  const player = askedPlayer(state);
  if (!player) return [];
  const out: LegalAction[] = [];
  for (const def of actionsAt(game, state)) {
    if (def.listed === false) continue;
    for (const c of candidatesOf(ctx, game, state, def, player)) {
      if (c.why.length) continue;
      out.push({ action: actionFor(game, def, player, c.card), label: labelFor(ctx, state, def, c.card) });
    }
  }
  return out;
}

/**
 * Every declared move the asked player might reach for that is not on the menu,
 * with the requirement that stops it.
 *
 * One entry per card per action type falls out of the shape: an action is asked
 * about each of its candidates once, and a candidate with nothing against it is
 * on the menu instead. `legal` is taken as an argument rather than recomputed
 * so the two lists cannot be built from two different readings of the board —
 * and so the caller that already has the menu (the snapshot) does not enumerate
 * it twice.
 */
export function declaredRejectedActions(ctx: EngineContext, game: GameDefinition, state: VmState, legal: LegalAction[]): RejectedAction[] {
  const player = askedPlayer(state);
  if (!player) return [];
  const offered = new Set(legal.map((l) => keyOf(l.action)));
  const out: RejectedAction[] = [];
  for (const def of actionsAt(game, state)) {
    if (def.listed === false) continue;
    for (const c of candidatesOf(ctx, game, state, def, player)) {
      if (!c.why.length) continue;
      const action = actionFor(game, def, player, c.card);
      // Never both lists, whatever the declaration says: a move already
      // offered is not refused, which is the invariant every client indexes by
      // card on.
      if (offered.has(keyOf(action))) continue;
      out.push({ action, label: labelFor(ctx, state, def, c.card), why: c.why });
    }
  }
  return out;
}

/** The identity a move is filed under — the legacy engine's, so the one-per-card promise means the same thing on both. */
const keyOf = (a: Action): string => {
  const x = a as { card?: string | null; skill?: number };
  return `${a.type}:${x.card ?? ""}${a.type === "activate" && typeof x.skill === "number" ? `#${x.skill}` : ""}`;
};

/**
 * The move itself, in the shared `Action` union.
 *
 * The declaration's **name is the action type**: `DEFINE ACTION play` is a
 * `{type: "play"}`, which is what lets one client answer either engine. A name
 * the union has no word for — or one whose shape a candidate cannot fill — is a
 * declaration no client could send, so it is said rather than cast.
 */
function actionFor(game: GameDefinition, def: ActionDef, player: PlayerId, card: string | null): Action {
  const shape = DECLARABLE_ACTIONS[def.name as Action["type"]];
  if (!shape) throw new RulesetBroken(game.id, `DEFINE ACTION ${JSON.stringify(def.name)} is not a move a client can send: no action of that name is a player, a card and nothing else`);
  if (shape === "none" && def.for !== undefined) throw new RulesetBroken(game.id, `DEFINE ACTION ${JSON.stringify(def.name)} has a FOR, and a ${def.name} names no card`);
  if (shape === "card" && card === null) throw new RulesetBroken(game.id, `DEFINE ACTION ${JSON.stringify(def.name)} names no card, and a ${def.name} is always about one`);
  return (shape === "none" ? { type: def.name, player } : { type: def.name, player, card }) as unknown as Action;
}

/**
 * The moves a game may declare, and what each does with a card.
 *
 * A deliberate subset of the shared `Action` union rather than all of it: an
 * action built from a declaration is **a player and at most one card**, and
 * every other answer shape carries something a candidate cannot supply — which
 * player goes first, how many markers to carry, an X, a skill line. Those are
 * answers to questions rather than moves a menu enumerates, and the two that
 * are moves and are missing say which issue brings them: an activation needs a
 * skill index (#147) and an attack needs a target (#146).
 *
 * Keyed by the union's own words, so a name here that stops being an action
 * fails `npm run typecheck`.
 */
const DECLARABLE_ACTIONS: Partial<Record<Action["type"], "card" | "cardOrNone" | "none">> = {
  charge: "cardOrNone",
  play: "card",
  playZ: "card",
  growUnison: "card",
  combo: "card",
  block: "cardOrNone",
  counter: "cardOrNone",
  zEnergyFromCombo: "cardOrNone",
  endMain: "none",
  pass: "none",
  concede: "none",
};

/** The words the menu shows: the declaration's `label:`, and the card's own name when the move is about one. */
function labelFor(ctx: EngineContext, state: VmState, def: ActionDef, card: string | null): string {
  const label = def.label ?? def.name;
  // The answer that takes no card has words of its own, because "Charge" said
  // of nothing is not what a board shows for skipping the charge.
  if (card === null) return declining(def, card) ? (def.decline ?? label) : label;
  const cardId = state.cards[card]?.cardId;
  const name = (cardId && ctx.defs[cardId]?.name) || cardId || card;
  return `${label} ${name}`;
}

/** The player the question is put to, or null when the game is asking nobody. */
function askedPlayer(state: VmState): PlayerId | null {
  const prompt = state.prompt;
  return "player" in prompt && prompt.player ? prompt.player : null;
}

// ── taking one ──────────────────────────────────────────────────────────────

/**
 * Take a declared move, or say there is no declaration for it.
 *
 * Returns false for an action no `DEFINE ACTION` claims, so the caller can go
 * on to the moves that are still the interpreter's own (answering who goes
 * first, a mulligan, conceding) and refuse the rest by name.
 *
 * Everything a client may send is checked against the declarations and nothing
 * else: the contract's "a client picks a move by index" rests on a move that
 * was not offered being refused rather than quietly taken.
 */
export function applyDeclared(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], action: Action): boolean {
  const def = game.actions[action.type];
  if (!def) return false;
  const player = action.player;

  if (state.prompt.kind === "gameOver") throw new IllegalAction("the game is over");
  const who = askedPlayer(state);
  if (who && who !== player) throw new IllegalAction(`it is ${who}'s decision, not ${player}'s`);
  const kinds = promptsOf(game, def);
  if (!kinds.includes(state.prompt.kind)) throw new IllegalAction(`that is not what is being asked: the game is at the ${state.prompt.kind} prompt`);
  if (!def.when.includes(state.phase)) throw new IllegalAction(`${def.label ?? def.name} is not a move of the ${state.phase} phase`);

  const card = (action as { card?: string | null }).card ?? null;
  const candidates = candidatesOf(ctx, game, state, def, player);
  const chosen = candidates.find((c) => c.card === card);
  if (!chosen) throw new IllegalAction(card === null ? `${def.label ?? def.name} is not offered now` : `${card} is not one of the cards ${def.label ?? def.name} is offered for`);
  const refused = refusedBy(ctx, game, state, def, player, card);
  if (refused.length) throw new IllegalAction(`${def.label ?? def.name} is refused: ${refused[0].kind}`);

  // The price, then the program. Charging is #148's and says so rather than
  // being skipped: an action that ran half of itself would be a board in a
  // state no replay could reach.
  if (def.cost?.length) throw new NotYet(`charge the price ${def.cost.join(" and ")} that ${def.name} asks for`, "#148");
  runProgram(state, def, player, card);

  // The question has been answered. A step that means to ask again — the Main
  // Phase's free timing, 7-3-4 — is the flow's business and not the action's
  // (#146), so nothing here decides to re-ask.
  answered(state);
  return true;
}

/**
 * The `DO` program: the same interpreter a card's rule runs on (#142).
 *
 * An action's program and a skill's program are one language, so they are one
 * interpreter — `stepScript` over the rules engine's `ScriptHost`. Before #142
 * this function had a case per op and a `NotYet` for the rest; now it has
 * neither, because the interpreter has every case and the host is where a gap
 * is named.
 *
 * The frame is the action's. `BIND` is what makes that work: the name the
 * declaration gave the candidate is bound to the card the move was taken for,
 * so `$card` in the `DO` means the very card the menu entry was about — and is
 * bound to **nothing** when the answer took no card, which is how one paragraph
 * says both halves of a *may* (7-2-11: the charge that places a card and the
 * charge that declines are one `DO` over one or zero cards). `self` is that
 * card, or the actor's Leader when there is none, so a program that names
 * itself still names something.
 *
 * It goes on the queue rather than running here. A `DO` that stops to ask is a
 * question inside a move, and the runner is the one thing that can hold one —
 * exactly as a skill's is. `run` picks it up as soon as `apply` returns here.
 */
function runProgram(state: VmState, def: ActionDef, player: PlayerId, card: string | null): void {
  if (!def.do.length) return;
  const self = card ?? state.sides[player].zones[SETUP_ZONES.leader]?.[0] ?? "";
  const vars = def.bind ? { [def.bind]: card === null ? [] : [card] } : {};
  state.programs.unshift({ ops: def.do, ip: 0, vars, card: self, master: player });
}

/** The questions an action answers: its own `prompts:`, or every question its phases ask. */
function promptsOf(game: GameDefinition, def: ActionDef): Prompt["kind"][] {
  const names =
    def.prompts ??
    Object.values(game.steps)
      .filter((s) => def.when.includes(s.phase) && s.prompt)
      .map((s) => s.prompt!);
  return [...new Set(names)] as Prompt["kind"][];
}

// ── reading a declaration's selector and its conditions ─────────────────────

/**
 * The cards a `FOR` selector finds.
 *
 * The parts a candidate list is made of — a side, an area or several, a filter,
 * a mode — and a refusal by name for the rest. `count:`/`upTo:` are read and
 * ignored on purpose: they say how many of the candidates a player ends up
 * choosing, which is the prompt's business, not which cards may be chosen.
 *
 * The whole of selector evaluation is `engine/state.ts`'s `resolveSelector` and
 * is deliberately code rather than configuration (`docs/arena-ruleset-spec.md`
 * §7); this is the part a menu needs, and #142 is where the two become one.
 */
function select(ctx: EngineContext, game: GameDefinition, state: VmState, sel: Selector, me: PlayerId): string[] {
  const rich = (["special", "fromVar", "underHost", "take", "fromEnd", "hidden", "ignoreBarrier", "notSelf"] as const).find((f) => sel[f] !== undefined);
  if (rich) throw new RulesetBroken(state.game, `an action's FOR selects by ${rich}, and this interpreter reads a side, an area, a filter and a mode so far (#142)`);
  const areas = sel.areas ?? (sel.area ? [sel.area] : []);
  if (!areas.length) throw new RulesetBroken(state.game, "an action's FOR names no area, so there is nowhere to look for a candidate");
  for (const area of areas) if (!game.zones[area]) throw new RulesetBroken(state.game, `an action's FOR looks in ${JSON.stringify(area)}, which nothing declares`);
  const matches = sel.filter ? predicateOf(sel.filter, game) : null;
  const out: string[] = [];
  for (const p of sidesOf(sel.side ?? "you", me)) {
    for (const area of areas) {
      for (const id of state.sides[p].zones[area] ?? []) {
        const inst = state.cards[id];
        if (!inst) continue;
        if (sel.mode !== undefined && inst.mode !== sel.mode) continue;
        if (matches) {
          const def = ctx.defs[inst.cardId];
          if (!def || !matches(attrsOf(def, game).attrs)) continue;
        }
        out.push(id);
      }
    }
  }
  return out;
}

/**
 * A refusal's condition, as far as the interpreter reads one.
 *
 * `count()` over a selector is the shape every other condition in the language
 * is one of with the right selector around it (§2.4), and the candidate is
 * reachable through it: a selector written `FROM $card` is the one card the
 * refusal is being asked about, which is what `BIND` names. `not`, `all` and
 * `any` compose them.
 *
 * Anything richer is refused by name, exactly as `flow.ts` refuses a win
 * condition it cannot read — a condition read as `false` is a move that can
 * never be made and nothing saying why. #142 brings the whole evaluator, shared
 * with the card programs.
 */
function holds(ctx: EngineContext, game: GameDefinition, state: VmState, cond: Cond, me: PlayerId, card: string | null): boolean {
  switch (cond.kind) {
    case "not":
      return !holds(ctx, game, state, cond.cond, me, card);
    case "all":
      return cond.conds.every((c) => holds(ctx, game, state, c, me, card));
    case "any":
      return cond.conds.some((c) => holds(ctx, game, state, c, me, card));
    case "isTurnPlayer":
      // 7-1: `who: opponent` is "during your opponent's turn", which is this
      // condition and never a duration — so the field is read, not assumed.
      return cond.who === "opponent" ? state.turnPlayer !== me : state.turnPlayer === me;
    case "count": {
      const n = counted(ctx, game, state, cond.sel, me, card);
      if (cond.atLeast !== undefined && n < cond.atLeast) return false;
      if (cond.atMost !== undefined && n > cond.atMost) return false;
      return cond.atLeast !== undefined || cond.atMost !== undefined;
    }
    default:
      throw new RulesetBroken(state.game, `a refusal is written as ${cond.kind}, and this interpreter reads count(), isTurnPlayer() and their combinations so far (#142)`);
  }
}

/** How many cards a condition's selector finds — the candidate itself when it says `FROM $<bind>`, else the board. */
function counted(ctx: EngineContext, game: GameDefinition, state: VmState, sel: Selector, me: PlayerId, card: string | null): number {
  if (sel.fromVar === undefined) return select(ctx, game, state, sel, me).length;
  if (card === null) return 0;
  const inst = state.cards[card];
  if (!inst) return 0;
  if (sel.mode !== undefined && inst.mode !== sel.mode) return 0;
  if (sel.area !== undefined || sel.areas !== undefined) {
    const areas = sel.areas ?? [sel.area!];
    const where = sidesOf(sel.side ?? "you", me).some((p) => areas.some((a) => (state.sides[p].zones[a] ?? []).includes(card)));
    if (!where) return 0;
  }
  if (sel.filter) {
    const def = ctx.defs[inst.cardId];
    if (!def || !predicateOf(sel.filter, game)(attrsOf(def, game).attrs)) return 0;
  }
  return 1;
}

const sidesOf = (side: string, me: PlayerId): PlayerId[] => {
  const them: PlayerId = me === "p1" ? "p2" : "p1";
  return side === "both" ? ["p1", "p2"] : side === "opponent" ? [them] : [me];
};
