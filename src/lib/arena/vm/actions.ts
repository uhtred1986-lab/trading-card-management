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
 * the rest. `keyOf` below files an activation under its skill index, and #147's
 * `skills:` is what makes such a candidate a line in the first place — so the
 * exception is the same shape one level down rather than a pass of its own.
 *
 * Pure and client-safe, like the rest of `vm/`: no database, no network, and
 * nothing read at request time.
 */
import { IllegalAction, type EngineContext, type GameEvent, type LegalAction, type RejectedAction } from "../engine";
import { other, type Action, type PlayerId, type Prompt, type Requirement } from "../engine/types";
import type { Cond, Selector } from "../engine/script";
import type { ActionDef, GameDefinition } from "../rulesets";
import { activationMoment, activationRefusals, activationsOf, boundFor, resolveActivation, type ActivationLine } from "./activate";
import { attrsOf } from "./cards";
import { actionCostOf, chargeCost, freePrice, planCost, priceFor, xValues, type BoundAmounts, type Price } from "./costs";
import { RulesetBroken } from "./errors";
import { fire } from "./events";
import { answered } from "./flow";
import { predicateOf } from "./filters";
import { forbiddenBy } from "./program";
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
  /**
   * Which of the card's printed skill lines this candidate is, for a move whose
   * declaration says `skills:` (#147). Absent for every move that is about the
   * card itself, which is every other move: a card is asked about once, a skill
   * line once each.
   */
  skill?: number;
  /**
   * The X this candidate answers with, for a move declared `x: true` whose
   * card's own price is one (issue #270) — a card with a fixed price is never
   * given one, which is what keeps a fixed-cost `play` sending the same
   * `Action` shape it always has. `playUnison`'s `x` still comes off
   * `price.energy` unconditionally (13-2-3: a Unison's markers are the price
   * regardless of whether the printed cost was a number or X); this field is
   * for a move like `play`, where carrying it at all depends on the card.
   */
  x?: number;
  why: Requirement[];
  /**
   * What the move costs this candidate, read once (#148). The menu wears it and
   * the charge is taken from it, which is the promise `vm/costs.ts` exists to
   * keep: a row whose figure came from a second reading of the price is the
   * drift the legacy engine has lost twice.
   */
  price: Price;
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
  // §3.2's one exception, and the only place the shape of a candidate changes:
  // a move declared `skills:` is about a **line** of each of those cards rather
  // than about the card, so a card with three of them is asked about three
  // times and answered three times (#147).
  if (def.skills) return cards.flatMap((card) => (card === null ? [] : activationsOf(ctx, state, def, card).map((line) => activation(ctx, game, state, def, player, line))));
  return (
    cards
      .flatMap((card): Candidate[] => {
        const why = refusedBy(ctx, game, state, def, player, card);
        // 1-2-2-2: a move declared `x: true` whose candidate's own price is X
        // (`costOf` absent) is not one card to refuse or offer — it is one
        // candidate per legal value, the way the legacy engine's own X menu
        // is (issue #270). Read *before* the ordinary price below, which is
        // never reached for such a card: `xValues` returns nothing to try
        // unless `def.x` is set and the card's price really is unpriced, so a
        // fixed-cost card takes the ordinary path exactly as it always has.
        if (!why.length && !declining(def, card) && card !== null) {
          const x = xValues(ctx, game, state, def, player, card);
          if (x.values.length) return x.values.map(({ x: n, price }) => ({ card, why: [], price, x: n }));
          if (x.unaffordable.length) return [{ card, why: x.unaffordable, price: freePrice() }];
        }
        // 8-3-2-3: an action asks for a price by name and `costs.rules` says how it
        // is charged (#148). Declining pays nothing, so the answer that takes no
        // card is never held up by a price. The price is read **last**, so a card
        // refused for a reason of its own says that reason rather than "1 short".
        const price = def.cost?.length && !declining(def, card) ? priceFor(ctx, game, state, def, card) : freePrice();
        if (!why.length && def.cost?.length && !declining(def, card)) {
          const plan = planCost(ctx, game, state, player, price, card);
          if (!plan.ok) why.push(...plan.why);
        }
        return [{ card, why, price }];
      })
      // The answer that takes no card is an answer to *this question*, so a
      // refusal about the board — one written without ever mentioning the
      // candidate — takes it off the board rather than greying it out: there is
      // no "Skip charge" ghost to explain at a question the charge does not
      // answer (#145). A card so refused still gets its rejection, because a
      // player can see the card and reach for it; nobody can reach for a button
      // that is not drawn.
      .filter((c) => !(declining(def, c.card) && c.why.length))
  );
}

/**
 * One skill line as a candidate: the declaration's own `REFUSE` lines, then the
 * gates of an activation with the price in its place (#147).
 *
 * The order is the whole point. `vm/activate.ts` hands back the gates the legacy
 * `whyNotActivate` asks *before* it counts the energy and the ones it asks
 * afterwards, and the price goes between them — so the first requirement the two
 * engines give for the same line on the same board is the same requirement.
 *
 * The price's **amounts** come off the line rather than off the card, which is
 * what `BoundAmounts` is for: `ACTION play COST [energy]` reads the number off
 * the card being paid for, and no attribute of a card says what one of its nine
 * skill lines charges.
 */
function activation(ctx: EngineContext, game: GameDefinition, state: VmState, def: ActionDef, player: PlayerId, line: ActivationLine): Candidate {
  const gates = activationRefusals(ctx, game, state, def, player, line);
  const why = [...refusedBy(ctx, game, state, def, player, line.card), ...gates.before];
  const bound: BoundAmounts = boundFor(ctx, game, state, player, line);
  const price = def.cost?.length ? priceFor(ctx, game, state, def, line.card, bound) : freePrice();
  if (!why.length && def.cost?.length) {
    const plan = planCost(ctx, game, state, player, price, line.card);
    if (!plan.ok) why.push(...plan.why);
  }
  why.push(...gates.after);
  return { card: line.card, skill: line.skillIndex, why, price };
}

/** The line a candidate is, re-read from the board — the one place a `skill` index becomes the record it stands for. */
function lineOf(ctx: EngineContext, state: VmState, def: ActionDef, card: string, skill: number): ActivationLine | undefined {
  return activationsOf(ctx, state, def, card).find((line) => line.skillIndex === skill);
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
  // The answer that takes no card is asked only the refusals that are not
  // about a card. A `REFUSE` whose condition never names the candidate is a
  // fact about the board — "the question on the table is no longer the
  // charge's" — and that stops the decline exactly as it stops every card;
  // one written `FROM $card` has nothing to be asked about here.
  const boardOnly = declining(def, card);
  for (const refusal of def.refusals ?? []) {
    if (boardOnly && mentionsCandidate(refusal.unless)) continue;
    // What a condition *found* when it failed, for the one or two fields an
    // interpreter has to fill in rather than a declaration: which card's rule
    // forbade the move, how long it holds and what would let it through. A
    // declaration cannot name them — the rule is on the board, not in the file.
    const found: Record<string, unknown> = {};
    if (holds(ctx, game, state, refusal.unless, player, card, found)) continue;
    return [requirementOf(state, refusal.kind, { ...refusal.args, ...found }, card)];
  }
  return [];
}

/**
 * Does this refusal's condition ask about the candidate, or about the board?
 *
 * `FROM $card` is the one way a condition reaches the card being asked about
 * (`counted` below), so a condition with no such selector anywhere in it is a
 * fact about the game — true or false before any card is named. An unknown
 * condition kind counts as *about the candidate*, which is the cautious way
 * round: it leaves the decline on the menu rather than silently removing it,
 * and `holds` refuses such a condition by name the moment a card asks it.
 */
function mentionsCandidate(cond: Cond): boolean {
  switch (cond.kind) {
    case "not":
      return mentionsCandidate(cond.cond);
    case "all":
    case "any":
      return cond.conds.some(mentionsCandidate);
    case "count":
      return cond.sel.fromVar !== undefined;
    case "isTurnPlayer":
    case "asking":
      return false;
    // 20-14 is about the candidate *and* the actor: a rule that names no card
    // still refuses the decline ("you can't place cards in your Energy Area"),
    // but one that names a filter is about which card is being reached for. The
    // cautious reading is the one that keeps the decline on the menu, and the
    // board-level half of the rule reaches it through the move's other lines.
    case "forbidden":
      return true;
    // A fact about the player, never about the candidate (#269) — the same
    // reading `isTurnPlayer`/`asking` already get.
    case "playerAttr":
      return false;
    // Candidate-shaped only through `FROM $<bind>` on either side, the same
    // test `count` makes of its own selector.
    case "sameCard":
      return cond.a.fromVar !== undefined || cond.b.fromVar !== undefined;
    default:
      return true;
  }
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
      const cost = actionCostOf(c.price);
      out.push({ action: actionFor(game, def, player, c), label: labelFor(ctx, state, def, c), ...(cost ? { cost } : {}) });
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
      const action = actionFor(game, def, player, c);
      // Never both lists, whatever the declaration says: a move already
      // offered is not refused, which is the invariant every client indexes by
      // card on.
      if (offered.has(keyOf(action))) continue;
      out.push({ action, label: labelFor(ctx, state, def, c), why: c.why });
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
function actionFor(game: GameDefinition, def: ActionDef, player: PlayerId, c: Candidate): Action {
  const card = c.card;
  const shape = DECLARABLE_ACTIONS[def.name as Action["type"]];
  if (!shape) throw new RulesetBroken(game.id, `DEFINE ACTION ${JSON.stringify(def.name)} is not a move a client can send: no action of that name is a player, a card and nothing else`);
  if (shape === "none" && def.for !== undefined) throw new RulesetBroken(game.id, `DEFINE ACTION ${JSON.stringify(def.name)} has a FOR, and a ${def.name} names no card`);
  if (shape !== "none" && shape !== "cardOrNone" && card === null) throw new RulesetBroken(game.id, `DEFINE ACTION ${JSON.stringify(def.name)} names no card, and a ${def.name} is always about one`);
  if (shape === "none") return { type: def.name, player } as unknown as Action;
  // 13-2 and 20-5: the `x` a move carries is **the amount its price was
  // settled at**, which is what the price already is — the markers a Unison
  // arrives with are the energy paid for it. A price the candidate could not
  // settle (an X cost) never reaches here: `candidatesOf` has already refused
  // it as `unread`, so the number below is never one nobody chose.
  if (shape === "cardWithX") return { type: def.name, player, card, x: c.price.energy } as unknown as Action;
  // 9-1-2: a move about a *line* carries which line, because the card alone
  // does not say which of its nine the player reached for (#147).
  if (shape === "cardSkill") {
    if (c.skill === undefined) throw new RulesetBroken(game.id, `DEFINE ACTION ${JSON.stringify(def.name)} is about a skill line and this candidate names none`);
    return { type: def.name, player, card, skill: c.skill } as unknown as Action;
  }
  // 1-2-2-2: an X-cost card carries the value it was offered at (issue #270);
  // a fixed-cost card played by the same declaration carries none, exactly as
  // it always has — `x` is the candidate's, not the shape's, for a move like
  // `play` where it depends on the card rather than on the move.
  if (c.x !== undefined) return { type: def.name, player, card, x: c.x } as unknown as Action;
  return { type: def.name, player, card } as unknown as Action;
}

/**
 * The moves a game may declare, and what each does with a card.
 *
 * A deliberate subset of the shared `Action` union rather than all of it: an
 * action built from a declaration is **a player and at most one card**, and
 * every other answer shape carries something a candidate cannot supply — which
 * player goes first, how many markers to carry, an X, a skill line. Those are
 * answers to questions rather than moves a menu enumerates, and the one that is
 * a move and is missing says which issue brings it: an attack needs a target
 * (#150). Two shapes are not second answers: a move whose `x` is settled by its
 * own price carries that number rather than asking for it (13-2-3), and a move
 * about a skill line carries which line, which the declaration's own `skills:`
 * already enumerated (#147).
 *
 * Keyed by the union's own words, so a name here that stops being an action
 * fails `npm run typecheck`.
 */
const DECLARABLE_ACTIONS: Partial<Record<Action["type"], "card" | "cardWithX" | "cardSkill" | "cardOrNone" | "none">> = {
  charge: "cardOrNone",
  play: "card",
  // 9-1-2: the one move whose candidate is a line of a card rather than the
  // card, and therefore the one §3.2 counts per line.
  activate: "cardSkill",
  // 13-2-3: a Unison's `x` is not a second decision — it is the energy the move
  // was paid with, which the candidate's own price already is, so the shape
  // carries it rather than asking for it (`actionFor`).
  playUnison: "cardWithX",
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

/**
 * The words the menu shows: the declaration's `label:`, the card's own name when
 * the move is about one, and **which line** when it is about one of those.
 *
 * The last is not decoration. A card prints up to nine activations and §3.2
 * gives each its own row, so three rows all reading "Activate Piccolo" is the
 * move nobody can identify — the keyword names itself and a text skill is named
 * by the start of its effect, which is the same 40 characters the legacy
 * engine's own menu and rejection labels use.
 */
function labelFor(ctx: EngineContext, state: VmState, def: ActionDef, c: Candidate): string {
  const label = def.label ?? def.name;
  const card = c.card;
  // The answer that takes no card has words of its own, because "Charge" said
  // of nothing is not what a board shows for skipping the charge.
  if (card === null) return declining(def, card) ? (def.decline ?? label) : label;
  const cardId = state.cards[card]?.cardId;
  const name = (cardId && ctx.defs[cardId]?.name) || cardId || card;
  // 1-2-2-2: several rows share a card when its price is X — one per legal
  // value (issue #270) — so the row has to say which, the same "with X = n"
  // the legacy engine's own label gives a Battle Card.
  if (c.x !== undefined) return `${label} ${name} with X = ${c.x}`;
  if (c.skill === undefined) return `${label} ${name}`;
  const line = lineOf(ctx, state, def, card, c.skill);
  const what = line?.skill.keyword ? `[${line.skill.keyword.name}]` : (line?.skill.effect.slice(0, 40) ?? "");
  return what ? `${label} ${name}: ${what}` : `${label} ${name}`;
}

/** The player the question is put to, or null when the game is asking nobody. */
function askedPlayer(state: VmState): PlayerId | null {
  const prompt = state.prompt;
  return "player" in prompt && prompt.player ? prompt.player : null;
}

// ── taking one ──────────────────────────────────────────────────────────────

/**
 * What taking a declared move came to.
 *
 * `"none"` is an action no `DEFINE ACTION` claims, so the caller can go on to
 * the moves that are still the interpreter's own (answering who goes first, a
 * mulligan, conceding) and refuse the rest by name. `"asked"` is a move that
 * stopped **inside itself** to put a question — 3-8-2's "which energy" — and it
 * is a third answer rather than a flag because the caller must not run the flow
 * on: a game whose next step ran would have replaced the question with the one
 * the step asks, which is exactly how a half-paid move loses its prompt.
 */
export type Applied = "none" | "done" | "asked";

/**
 * Take a declared move, or say there is no declaration for it.
 *
 * Everything a client may send is checked against the declarations and nothing
 * else: the contract's "a client picks a move by index" rests on a move that
 * was not offered being refused rather than quietly taken.
 */
export function applyDeclared(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], action: Action): Applied {
  const def = game.actions[action.type];
  if (!def) return "none";
  const player = action.player;

  if (state.prompt.kind === "gameOver") throw new IllegalAction("the game is over");
  const who = askedPlayer(state);
  if (who && who !== player) throw new IllegalAction(`it is ${who}'s decision, not ${player}'s`);
  const kinds = promptsOf(game, def);
  if (!kinds.includes(state.prompt.kind)) throw new IllegalAction(`that is not what is being asked: the game is at the ${state.prompt.kind} prompt`);
  if (!def.when.includes(state.phase)) throw new IllegalAction(`${def.label ?? def.name} is not a move of the ${state.phase} phase`);

  const card = (action as { card?: string | null }).card ?? null;
  // A move about a skill line is chosen by the pair, because the card alone
  // names up to nine of them and eight of those may be refused (#147).
  const skill = def.skills ? (action as { skill?: number }).skill : undefined;
  if (def.skills && typeof skill !== "number") throw new IllegalAction(`${def.label ?? def.name} names no skill line, and a skill is used one line at a time`);
  // 1-2-2-2: a move declared `x: true` carries several candidates for the same
  // card, one per legal value, so the value the action names is part of which
  // one was meant — matched against `c.x` for the enumerated path and against
  // `c.price.energy` for `playUnison`'s own `cardWithX` shape, which is where
  // that value has always come from (issue #270).
  const x = def.x ? (action as { x?: number }).x : undefined;
  const candidates = candidatesOf(ctx, game, state, def, player);
  const chosen = candidates.find((c) => c.card === card && c.skill === skill && (x === undefined || c.x === x || c.price.energy === x));
  if (!chosen) throw new IllegalAction(card === null ? `${def.label ?? def.name} is not offered now` : `${card} is not one of the cards ${def.label ?? def.name} is offered for`);
  // The candidate's own reasons rather than a second reading of them: an
  // activation's gates are read off the line and the price sits inside them, so
  // asking `refusedBy` again here would answer about the card and miss both.
  if (chosen.why.length) throw new IllegalAction(`${def.label ?? def.name} is refused: ${chosen.why[0].kind}`);

  // The price, then the program — in that order, and never half of one: an
  // action whose program was queued before its price was settled would be a
  // board in a state no replay could reach (#148). The price is charged here
  // and the program goes on the queue below, so the two cannot be interleaved
  // even though only one of them runs on the spot.
  const line = def.skills && card !== null && typeof skill === "number" ? lineOf(ctx, state, def, card, skill) : undefined;
  if (def.skills && !line) throw new IllegalAction(`${card} has no skill line ${skill}`);
  if (def.cost?.length && !declining(def, card)) {
    const explicit = (action as { pay?: string[] }).pay;
    const plan = planCost(ctx, game, state, player, chosen.price, card, explicit);
    if (!plan.ok) throw new IllegalAction(`${def.label ?? def.name} cannot be paid for: ${plan.why[0].kind}`);
    // 3-8-2: the player pays with whatever energy they like, so a price with
    // more than one genuinely different answer is *asked* before it is taken —
    // the existing `payCost` prompt, whose options are legacy `Payment` values,
    // so one client answers either engine. `explicit` is that answer coming
    // back, and a price with one way to pay is settled without a question.
    //
    // This question is put **before** the `DO` is queued, which is what keeps it
    // apart from a question the program itself asks (#142's `state.programs`):
    // a move suspended here has paid nothing and done nothing, and the frame the
    // step is still in is the whole of its continuation.
    if (explicit === undefined && plan.asks && plan.options.length > 1) {
      // "play Son Goku" — the legacy engine's own wording for this prompt, which
      // is the move's label with its first letter lowered.
      const label = labelFor(ctx, state, def, chosen);
      state.prompt = { kind: "payCost", player, action, options: plan.options, describe: label.charAt(0).toLowerCase() + label.slice(1) };
      return "asked";
    }
    chargeCost(ctx, game, state, ev, player, plan.payment, card, def.cost);
  }
  // The one move whose program is not the declaration's: an activation runs the
  // **record's**, because a `DO` written once in the file could not be the
  // program of nine different lines. `vm/activate.ts` counts the use, sends an
  // Extra to the Drop (12-2-2), announces the line and queues its frame — and
  // the moment is fired here, as a moment and never as a trigger name.
  if (line) {
    // Read where the line was used **before** it is used: 12-2-2 sends an Extra
    // to the Drop as part of using it, and "from: hand" is what 22-10 asks
    // about.
    const moment = activationMoment(state, player, line);
    resolveActivation(ctx, game, state, ev, player, line);
    fire(ctx, game, state, moment);
  } else {
    runProgram(state, def, player, chosen);
  }

  // 7-3-4: a move declared `again:` leaves the question on the table — the
  // Main Phase grants its free timing over and over, and a play is one of the
  // moves it grants. The step is simply not *answered*, so the runner drains
  // the checkpoint the move's [Auto]s went into (9-6-6) and then puts the very
  // same question back. Every other move answers the question its step asked
  // and the step moves on, which is what ends a Main Phase: `endMain` carries
  // no `again:`.
  if (def.again !== true) answered(state);
  return "done";
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
function runProgram(state: VmState, def: ActionDef, player: PlayerId, chosen: Candidate): void {
  if (!def.do.length) return;
  const card = chosen.card;
  const self = card ?? state.sides[player].zones[SETUP_ZONES.leader]?.[0] ?? "";
  const vars = def.bind ? { [def.bind]: card === null ? [] : [card] } : {};
  // 20-5: `X` in a move's program is **the amount its price was settled at** —
  // which is what X means everywhere else in the language, and is 13-2-3's
  // "with that many markers" without a second word for it. A move that names a
  // price binds it even when the price came to nothing; a move that names none
  // binds nothing, so a program of such a move that reads `X` says so rather
  // than reading zero (`amount` throws on an unbound X).
  const x = def.cost?.length ? chosen.price.energy : undefined;
  state.programs.unshift({ ops: def.do, ip: 0, vars, card: self, master: player, ...(x === undefined ? {} : { x }) });
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
function holds(ctx: EngineContext, game: GameDefinition, state: VmState, cond: Cond, me: PlayerId, card: string | null, found?: Record<string, unknown>): boolean {
  switch (cond.kind) {
    case "not":
      return !holds(ctx, game, state, cond.cond, me, card, found);
    case "all":
      return cond.conds.every((c) => holds(ctx, game, state, c, me, card, found));
    case "any":
      return cond.conds.some((c) => holds(ctx, game, state, c, me, card, found));
    case "isTurnPlayer":
      // 7-1: `who: opponent` is "during your opponent's turn", which is this
      // condition and never a duration — so the field is read, not assumed.
      return cond.who === "opponent" ? state.turnPlayer !== me : state.turnPlayer === me;
    // 7-2-11: which question is on the table, which is how one paragraph is
    // offered at two of them and refused at one. The legacy `whyNotCharge`
    // reads the very same field, so the two engines cannot disagree about what
    // "you have already had your charge this turn" means.
    case "asking":
      return state.prompt.kind === cond.prompt;
    // 20-14: a rule in force stopping this move, asked of this candidate and
    // this actor. It is the only condition that answers with more than a
    // boolean — the `forbidden` requirement has to name *which* card's rule and
    // for how long, and only the board knows — so what it found is written into
    // `found` and `refusedBy` merges it into the declared requirement.
    case "forbidden": {
      const rule = forbiddenBy(ctx, game, state, cond.what, {
        player: me,
        ...(card === null ? {} : { card }),
        ...(cond.bySkill === undefined ? {} : { bySkill: cond.bySkill }),
      });
      if (rule && found) Object.assign(found, rule);
      return rule !== null;
    }
    case "count": {
      const n = counted(ctx, game, state, cond.sel, me, card);
      if (cond.atLeast !== undefined && n < cond.atLeast) return false;
      if (cond.atMost !== undefined && n > cond.atMost) return false;
      return cond.atLeast !== undefined || cond.atMost !== undefined;
    }
    // 7-2-11, 13-3: a `DEFINE ATTRIBUTE of: player` fact, read by name (#269).
    case "playerAttr":
      return !!state.sides[cond.side === "opponent" ? other(me) : me].attrs[cond.name];
    // 13-3: "a copy of the Unison Card in play" — two selectors, compared by
    // identity rather than counted (#269).
    case "sameCard": {
      const a = resolvedCard(ctx, game, state, cond.a, me, card);
      const b = resolvedCard(ctx, game, state, cond.b, me, card);
      return a !== null && b !== null && state.cards[a].cardId === state.cards[b].cardId;
    }
    default:
      throw new RulesetBroken(
        state.game,
        `a refusal is written as ${cond.kind}, and this interpreter reads count(), isTurnPlayer(), asking(), forbidden(), playerAttr(), sameCard() and their combinations so far (#142)`,
      );
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

/** The one card a selector names, for a condition that compares identity rather than counting (`sameCard`, #269). Null for none or more than one. */
function resolvedCard(ctx: EngineContext, game: GameDefinition, state: VmState, sel: Selector, me: PlayerId, card: string | null): string | null {
  if (sel.fromVar !== undefined) return card;
  const found = select(ctx, game, state, sel, me);
  return found.length === 1 ? found[0] : null;
}

const sidesOf = (side: string, me: PlayerId): PlayerId[] => {
  const them: PlayerId = me === "p1" ? "p2" : "p1";
  return side === "both" ? ["p1", "p2"] : side === "opponent" ? [them] : [me];
};
