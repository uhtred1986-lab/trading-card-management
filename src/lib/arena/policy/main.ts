/**
 * The local opponent's Main Phase (#646, plan O2-03): which card to play, which
 * skill to activate, what to attack with and when to end the turn — and, for the
 * energy question a play opens, which energy to rest — decided by a bounded,
 * deterministic heuristic over what the seat may know (#644) and nothing else.
 *
 * Every candidate is a decision the engine already offered (`PolicyDecisions`),
 * so a choice can be weak but never illegal. Each is scored once, by hand-written
 * rules, from the seat's observation:
 *
 *   play / playZ / playUnison / growUnison
 *                 20 + the card's value + the value of the best plays its payment
 *                 still leaves affordable (one step of lookahead, greedy and
 *                 bounded) — so a play that spends the only energy of a colour
 *                 another card in hand needs scores below one that does not.
 *   activate      12 + 1 − 0.5 per energy, at most once per card per turn (read
 *                 off the public beat history): an optional ability is never
 *                 looped. Without a readable history the activation is not taken.
 *   attack        a hit that wins (attacker ≥ guard: the attacker wins ties, 8-4)
 *                 on a Leader scores 5 + damage, a lethal one 1,000; a win against
 *                 a rested Battle Card scores 6 + the card's value; a Battle Card
 *                 attacker pays for being left rested in front of a stronger
 *                 opponent; a losing attack with the Leader is a token 0.5, with a
 *                 Battle Card it is negative.
 *   endMain       0 — the turn ends when nothing else scores above it.
 *   anything else −1: an unsupported decision type is never chosen while a
 *                 supported one or `endMain` is open.
 *
 * Plays come before activations and activations before attacks because a turn
 * is played that way: develop, pump, then swing. Ties go to the first decision
 * in the contract's canonical id order, so the choice is a function of the
 * observation and the decisions alone — no clock, no RNG (the policy RNG is
 * handed back untouched), no hidden card: an alias is an alias.
 *
 * **Bounded.** Every scoring step is counted (`work`). A decision considers at
 * most `MAIN_LIMITS.decisions` options and `MAIN_LIMITS.hand` hand cards; if the
 * count reaches `MAIN_LIMITS.work` the scoring stops and the best decision so
 * far is taken (`endMain` when nothing was scored), and the answer says so.
 *
 * **Cycles.** `guardedDecide` carries a small, serialisable memory across a
 * seat's decisions: if a turn runs past `TURN_GUARD.decisions` decisions, or the
 * same position (observation less its beat history, with the same decision set)
 * comes round more than `TURN_GUARD.repeats` times, the guard ends the turn
 * (`endMain`, else `pass`, else a battle window's decline) or — with none open —
 * interrupts rather than inventing a move or a result.
 *
 * Combat responses and combos are `combat.ts`'s (#647); every other
 * constrained choice is #650's. Outside the Main Phase and its payment
 * question (a combo's payment included), `mainThen` hands the decision to the
 * policy it wraps.
 *
 * Policy layer: value imports only from `src/lib/arena/policy/` (checked by
 * `scripts/verify/arena-policy-contract.mts`).
 */
import type { PlayerId } from "../types";
import { answerFor, fingerprint, PolicyInterruption, stableJson, type Decision, type MenuDecision, type Policy, type PolicyAnswer, type PolicyInput } from "./contract";
import type { CardFacts, PolicyObservation } from "./observation";
import type { PolicyRng } from "./rng";
import { shortcutThen } from "./shortcuts";

export const MAIN_POLICY_VERSION = 1;

export const MAIN_LIMITS = {
  /** Options scored per decision; the rest (by canonical id) are not considered. */
  decisions: 64,
  /** Hand cards the lookahead considers. */
  hand: 16,
  /** Scoring steps per decision before the scoring stops. */
  work: 4096,
  /** Activations of one card's skills per turn. */
  activationsPerCard: 1,
} as const;

export const TURN_GUARD = {
  /** Decisions one seat may take in one turn before the guard ends it. */
  decisions: 150,
  /** Times the same position may come round in a turn before the guard ends it. */
  repeats: 3,
} as const;

const SCORE = { play: 20, activate: 12, endMain: 0, unsupported: -1, lethal: 1000 } as const;

export interface MainChoice {
  id: string;
  /** Why, for the log. */
  how: string;
  score: number;
  /** Scoring steps spent. Never more than `MAIN_LIMITS.work`. */
  work: number;
  /** Options scored, of those open. */
  considered: number;
  /** The work bound stopped the scoring early. */
  bounded: boolean;
}

// ---------------------------------------------------------------------------------------------
// Energy: who can pay what.

/** One active energy card, by the colours it pays with. */
interface Payer {
  id: string;
  colors: readonly string[];
}

interface Pool {
  payers: Payer[];
  markers: number;
}

interface Price {
  energy: number;
  orbs: Record<string, number>;
}

class Work {
  n = 0;
  constructor(readonly limit: number) {}
  /** Take one step; false (and no step) once the limit is reached. */
  step(): boolean {
    if (this.n >= this.limit) return false;
    this.n++;
    return true;
  }
  get spent(): boolean {
    return this.n >= this.limit;
  }
}

function poolOf(o: PolicyObservation): Pool {
  const colours = new Map(o.you.energyColors.map((e) => [e.card, e.paymentColors.length ? e.paymentColors : e.colors]));
  const payers = o.you.energy
    .filter((c) => c.mode === "active")
    .map((c) => ({ id: c.id, colors: colours.get(c.id) ?? c.colors }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { payers, markers: Math.max(0, o.you.energyMarkers) };
}

/**
 * A hand card's price as the policy guesses it: its printed total, and one orb
 * of each of its colours (the usual specified cost; the real one is only shown
 * on a play the engine offers). Null for an X cost or none.
 */
function guessedPrice(c: CardFacts): Price | null {
  if (c.energyCost === null) return null;
  const orbs: Record<string, number> = {};
  let left = c.energyCost;
  for (const colour of [...c.colors].sort()) if (left > 0) { orbs[colour] = (orbs[colour] ?? 0) + 1; left--; }
  return { energy: c.energyCost, orbs };
}

/** How much the rest of the hand wants each colour: a payer of a wanted colour is spent last. */
function colourNeed(hand: readonly CardFacts[]): Map<string, number> {
  const need = new Map<string, number>();
  for (const c of hand) for (const colour of c.colors) need.set(colour, (need.get(colour) ?? 0) + 1);
  return need;
}

/**
 * Pay `price` from `pool`, or null when it cannot be. Orbs first, each from the
 * payer with the fewest colours that has it; the rest from the payers whose
 * colours the hand wants least, then markers. Greedy, so it can miss an exotic
 * assignment; it never claims a payment the pool cannot make.
 */
function pay(pool: Pool, price: Price, need: Map<string, number>, work: Work): Pool | null {
  // Out of work: claim nothing is payable (the conservative answer).
  if (!work.step()) return null;
  const left = [...pool.payers];
  const orbColours = Object.keys(price.orbs).sort();
  let orbTotal = 0;
  for (const colour of orbColours) {
    for (let k = 0; k < price.orbs[colour]; k++) {
      let best = -1;
      for (let i = 0; i < left.length; i++) {
        if (!left[i].colors.includes(colour)) continue;
        if (best < 0 || left[i].colors.length < left[best].colors.length) best = i;
      }
      if (best < 0) return null;
      left.splice(best, 1);
      orbTotal++;
    }
  }
  let generic = Math.max(0, price.energy - orbTotal);
  const wanted = (p: Payer) => p.colors.reduce((n, c) => n + (need.get(c) ?? 0), 0);
  const order = left.map((p, i) => ({ p, i, w: wanted(p) })).sort((a, b) => a.w - b.w || a.i - b.i);
  const spent = new Set<number>();
  for (const { i } of order) {
    if (!generic) break;
    spent.add(i);
    generic--;
  }
  const payers = left.filter((_, i) => !spent.has(i));
  if (generic > pool.markers) return null;
  return { payers, markers: pool.markers - generic };
}

// ---------------------------------------------------------------------------------------------
// Values.

const KEYWORD_VALUE: Record<string, number> = { blocker: 1, critical: 0.75, barrier: 0.25, revenge: 0.5, indestructible: 0.75, "dual attack": 1, "triple attack": 2 };

function strikeOf(c: CardFacts | null): number {
  let n = 1;
  for (const k of c?.keywords ?? []) {
    const m = /^(double|triple|quadruple) strike$/i.exec(k.trim());
    if (m) n = Math.max(n, { double: 2, triple: 3, quadruple: 4 }[m[1].toLowerCase() as "double" | "triple" | "quadruple"]);
  }
  return n;
}

const hasKeyword = (c: CardFacts | null | undefined, name: string) => !!c?.keywords.some((k) => k.trim().toLowerCase() === name);

/**
 * What losing `damage` life from `life` costs its owner: lethal is 1,000, every
 * life left lower dearer, +0.5 a card when it goes to the Drop rather than the
 * hand (22-6 [Critical]). The battle policy (#647) weighs a hit by it; the
 * choice handlers (#650) a life card paid or dropped.
 */
export function lifeLoss(life: number, damage: number, critical: boolean, victory: boolean): number {
  if (damage <= 0) return 0;
  if (victory || damage >= life) return SCORE.lethal;
  let loss = 0;
  for (let k = 0; k < damage; k++) {
    const left = life - k - 1;
    loss += (left <= 1 ? 4 : left <= 3 ? 2 : 1) + (critical ? 0.5 : 0);
  }
  return loss;
}

/** What a card is worth on the board: its power, its keywords, a draw in its text. */
export function cardValue(c: CardFacts): number {
  let v = 1 + Math.max(0, c.power ?? 0) / 5000;
  for (const k of c.keywords) v += KEYWORD_VALUE[k.trim().toLowerCase()] ?? 0;
  v += (strikeOf(c) - 1) * 1;
  if (c.text && /\bdraw\b/i.test(c.text)) v += 0.5;
  return v;
}

/**
 * The most the hand can still add from `pool`: the dearest cards first, each
 * while it is affordable. Greedy and bounded by `MAIN_LIMITS.hand`.
 */
function followUp(hand: readonly CardFacts[], pool: Pool, work: Work): number {
  let total = 0;
  let at = pool;
  const ranked = hand
    .map((c) => ({ c, v: cardValue(c), price: guessedPrice(c) }))
    .filter((x): x is { c: CardFacts; v: number; price: Price } => x.price !== null)
    .sort((a, b) => b.v - a.v || (a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0));
  for (let i = 0; i < ranked.length; i++) {
    if (work.spent) break;
    const rest = ranked.slice(i + 1).map((x) => x.c);
    const next = pay(at, ranked[i].price, colourNeed(rest), work);
    if (!next) continue;
    total += ranked[i].v;
    at = next;
  }
  return total;
}

// ---------------------------------------------------------------------------------------------
// The Main Phase.

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function findCard(o: PolicyObservation, id: unknown): CardFacts | null {
  if (typeof id !== "string") return null;
  for (const side of [o.you, o.them]) {
    for (const c of [side.leader, side.unison, ...side.battle, ...(side.hand ?? []), ...side.dropCards, ...side.warpCards, ...side.zEnergyCards, ...side.zDeckFaceUp, ...side.lifeFaceUp]) {
      if (c && c.id === id) return c;
    }
  }
  return null;
}

/**
 * Activations of `card`'s skills this turn by `seat`, from the public beat
 * history; null when the history does not reach back to the turn's start (the
 * queue is capped) or is not there at all.
 */
export function activationsThisTurn(o: PolicyObservation, seat: PlayerId, card: string): number | null {
  const list = o.beats.list;
  let start = -1;
  for (let i = list.length - 1; i >= 0; i--) {
    const b = list[i];
    if (b.t === "phase" && b.turn !== o.turn) break;
    if (b.t === "phase" && b.turn === o.turn) start = i;
  }
  if (start < 0) return null;
  let n = 0;
  for (let i = start; i < list.length; i++) {
    const b = list[i];
    if (b.t === "skill" && b.card === card && b.owner === seat && /activate/i.test(b.label)) n++;
  }
  return n;
}

function priceOfDecision(d: MenuDecision, card: CardFacts | null): Price | null {
  if (d.cost) return { energy: d.cost.energy, orbs: Object.fromEntries(Object.entries(d.cost.orbs ?? {}).filter(([, n]) => typeof n === "number" && n > 0)) as Record<string, number> };
  return card ? guessedPrice(card) : null;
}

interface Scored {
  score: number;
  how: string;
}

function scorePlay(o: PolicyObservation, d: MenuDecision, work: Work): Scored {
  const card = findCard(o, d.action.card);
  const value = card ? cardValue(card) : 1.5;
  const hand = (o.you.hand ?? []).filter((c) => c.id !== card?.id).sort(byId).slice(0, MAIN_LIMITS.hand);
  const price = priceOfDecision(d, card);
  const pool = poolOf(o);
  // The payment the engine will ask about is the seat's own choice later; here it is the
  // colour-preserving one, which is what the payment rule below picks.
  const after = price ? pay(pool, price, colourNeed(hand), work) : pool;
  const rest = after ? followUp(hand, after, work) : 0;
  const bonus = d.type === "growUnison" ? 1 : 0;
  return { score: SCORE.play + value + rest + bonus, how: `develops (${card?.name ?? d.type}, value ${value.toFixed(1)}, keeps ${rest.toFixed(1)} playable)` };
}

function scoreActivate(o: PolicyObservation, d: MenuDecision): Scored {
  const card = typeof d.action.card === "string" ? d.action.card : null;
  const used = card ? activationsThisTurn(o, o.seat, card) : null;
  if (used === null) return { score: SCORE.unsupported, how: "activation not taken: this turn's history is not readable" };
  if (used >= MAIN_LIMITS.activationsPerCard) return { score: SCORE.unsupported, how: "activation already used this turn" };
  const energy = d.cost?.energy ?? 0;
  const markers = Math.max(0, d.cost?.markers ?? 0);
  return { score: SCORE.activate + 1 - 0.5 * (energy + markers), how: `activates ${findCard(o, card)?.name ?? card} once` };
}

function scoreAttack(o: PolicyObservation, d: MenuDecision): Scored {
  const attacker = findCard(o, d.action.attacker);
  const target = findCard(o, d.action.target);
  if (!attacker || !target) return { score: SCORE.unsupported, how: "attack on a card the seat cannot read" };
  const a = attacker.power ?? 0;
  const g = target.power ?? 0;
  const wins = a >= g; // 8-4: the attacker wins ties
  const isLeaderAttacker = o.you.leader?.id === attacker.id;
  const leaderTarget = o.them.leader?.id === target.id;
  // A Battle Card left rested can be attacked next turn by anything at least as strong (their whole side stands up).
  const threats = [o.them.leader, ...o.them.battle].filter((c): c is CardFacts => !!c).map((c) => c.power ?? 0);
  const exposed = !isLeaderAttacker && threats.some((p) => p >= a);
  const exposure = exposed ? 0.5 * cardValue(attacker) : 0;
  const revenge = !isLeaderAttacker && hasKeyword(target, "revenge") ? cardValue(attacker) : 0;
  const blockers = o.them.battle.filter((c) => c.mode === "active" && c.id !== target.id && hasKeyword(c, "blocker") && (c.power ?? 0) > a);
  if (leaderTarget) {
    const damage = strikeOf(attacker);
    if (wins && o.them.life <= damage && !blockers.length) return { score: SCORE.lethal, how: `lethal: ${a} into ${g} with ${o.them.life} life left` };
    if (wins) return { score: (5 + damage) * (blockers.length ? 0.5 : 1) - exposure, how: `hits the Leader (${a} vs ${g})` };
    return isLeaderAttacker ? { score: 0.5, how: `Leader swing (${a} vs ${g})` } : { score: -1 - exposure, how: `loses (${a} vs ${g})` };
  }
  if (wins) return { score: 6 + cardValue(target) - exposure - revenge, how: `KOs ${target.name} (${a} vs ${g})` };
  return { score: -2 - exposure, how: `loses to ${target.name} (${a} vs ${g})` };
}

function scoreMain(o: PolicyObservation, d: Decision, work: Work): Scored {
  if (d.kind !== "menu") return { score: SCORE.unsupported, how: "unsupported decision" };
  switch (d.type) {
    case "play":
    case "playZ":
    case "playUnison":
    case "growUnison":
      return scorePlay(o, d, work);
    case "activate":
      return scoreActivate(o, d);
    case "attack":
      return scoreAttack(o, d);
    case "endMain":
      return { score: SCORE.endMain, how: "ends the turn: nothing scores above it" };
    default:
      return { score: SCORE.unsupported, how: `unsupported decision type ${d.type}` };
  }
}

/** The Main-Phase choice for this input, or null outside the Main Phase (or with nothing to choose). Pure. */
export function mainChoice(input: PolicyInput): MainChoice | null {
  const { observation: o, decisions } = input;
  if (decisions.actor !== decisions.seat || decisions.window !== "main" || !decisions.decisions.length) return null;
  const work = new Work(MAIN_LIMITS.work);
  const open = [...decisions.decisions].sort(byId).slice(0, MAIN_LIMITS.decisions);
  let best: { d: Decision; s: Scored } | null = null;
  let considered = 0;
  for (const d of open) {
    if (!work.step()) break;
    const s = scoreMain(o, d, work);
    considered++;
    if (!best || s.score > best.s.score) best = { d, s };
  }
  const bounded = work.spent;
  const end = open.find((d) => d.kind === "menu" && d.type === "endMain");
  // Nothing supported scored above "unsupported": end the turn if it can be, else the first decision.
  if (!best) return null;
  let pick = best;
  if (pick.s.score <= SCORE.unsupported) pick = end ? { d: end, s: { score: SCORE.endMain, how: "ends the turn: nothing supported is open" } } : { d: open[0], s: { score: pick.s.score, how: "fallback: the first open decision" } };
  return {
    id: pick.d.id,
    how: bounded ? `${pick.s.how} (work bound reached after ${considered} of ${open.length})` : pick.s.how,
    score: pick.s.score,
    work: work.n,
    considered,
    bounded,
  };
}

/**
 * The energy question a play or activation opens (`payCost`): rest the energy
 * that leaves the most of the hand payable, then the fewest resources, markers
 * dearer than energy. Null when the question names no payments.
 */
export function paymentChoice(input: PolicyInput): MainChoice | null {
  const { observation: o, decisions } = input;
  if (decisions.actor !== decisions.seat || decisions.window !== "payCost" || !o.prompt.mine || !o.prompt.payments?.length) return null;
  const work = new Work(MAIN_LIMITS.work);
  const pool = poolOf(o);
  const hand = (o.you.hand ?? []).slice().sort(byId).slice(0, MAIN_LIMITS.hand);
  const options = new Map(o.prompt.payments.map((p) => [p.option, p]));
  let best: { d: MenuDecision; score: number; keep: number } | null = null;
  let considered = 0;
  for (const d of [...decisions.decisions].sort(byId).slice(0, MAIN_LIMITS.decisions)) {
    if (!work.step()) break;
    if (d.kind !== "menu" || d.type !== "payCost") continue;
    const p = options.get(d.action.option as number);
    if (!p) continue;
    considered++;
    const rested = new Set(p.energyRest);
    const left: Pool = { payers: pool.payers.filter((x) => !rested.has(x.id)), markers: Math.max(0, pool.markers - p.markers) };
    const keep = followUp(hand, left, work);
    const score = keep * 10 - rested.size - 1.5 * p.markers;
    if (!best || score > best.score) best = { d, score, keep };
  }
  if (!best) return null;
  return { id: best.d.id, how: `pays keeping ${best.keep.toFixed(1)} of the hand playable`, score: best.score, work: work.n, considered, bounded: work.spent };
}

/** A policy that decides the Main Phase (and its payments) and defers everything else to `fallback`. Draws no randomness of its own. */
export function mainThen(fallback: Policy): Policy {
  return (input, rng) => {
    const hit = mainChoice(input) ?? paymentChoice(input);
    return hit ? { answer: answerFor(input.decisions, hit.id), rng } : fallback(input, rng);
  };
}

/**
 * The local policy as O2-03 left it: the free-choice shortcuts (#645), then
 * the Main Phase, then `fallback` for every other window — the battle's
 * included. Kept for comparison; the local policy is `combat.ts`'s
 * `localPolicy` (#647), which answers the battle's windows before `fallback`.
 */
export function mainPolicy(fallback: Policy): Policy {
  return shortcutThen(mainThen(fallback));
}

// ---------------------------------------------------------------------------------------------
// The cycle guard.

/** What a local seat carries from one decision to the next. Plain JSON. */
export interface LocalMemory {
  v: 1;
  rng: PolicyRng;
  turn: number;
  /** Decisions this seat has taken this turn. */
  decisions: number;
  /** Positions seen this turn, by fingerprint, and how often. */
  seen: Record<string, number>;
}

export function localMemory(rng: PolicyRng): LocalMemory {
  return { v: 1, rng, turn: -1, decisions: 0, seen: {} };
}

export type GuardedAnswer =
  | { ok: true; answer: PolicyAnswer; memory: LocalMemory; guard: string | null }
  | { ok: false; interrupted: string; memory: LocalMemory };

/** The position as the guard compares it: the observation less its history, and the decisions open. */
function positionKey(input: PolicyInput): string {
  const { beats: _beats, ...board } = input.observation;
  void _beats;
  return fingerprint(stableJson({ board, open: input.decisions.decisions.map((d) => d.id), window: input.decisions.window }));
}

/**
 * The decision that ends what the seat is doing: `endMain`, else `pass`, else
 * — in the battle's windows (#647) — "don't block" or "don't counter".
 */
function guardExit(open: readonly Decision[]): Decision | undefined {
  const menu = open.filter((d): d is MenuDecision => d.kind === "menu");
  return menu.find((d) => d.type === "endMain") ?? menu.find((d) => d.type === "pass") ?? menu.find((d) => (d.type === "block" || d.type === "counter") && d.action.card === null);
}

/**
 * Ask `policy`, unless this seat's turn has run too long or come round to the
 * same position too often: then end the turn (`guardExit`), or — with no exit
 * open — interrupt. Pure; the memory comes back new.
 */
export function guardedDecide(policy: Policy, input: PolicyInput, memory: LocalMemory): GuardedAnswer {
  const turn = input.observation.turn;
  const fresh = memory.turn !== turn;
  const key = positionKey(input);
  const seen = fresh ? {} : { ...memory.seen };
  seen[key] = (seen[key] ?? 0) + 1;
  const next: LocalMemory = { v: 1, rng: memory.rng, turn, decisions: (fresh ? 0 : memory.decisions) + 1, seen };
  const tripped = next.decisions > TURN_GUARD.decisions ? `${next.decisions} decisions this turn` : seen[key] > TURN_GUARD.repeats ? `the same position ${seen[key]} times this turn` : null;
  if (tripped) {
    const out = guardExit(input.decisions.decisions);
    if (!out) return { ok: false, interrupted: `cycle guard: ${tripped}, and no endMain, pass or decline is open`, memory: next };
    return { ok: true, answer: answerFor(input.decisions, out.id), memory: next, guard: `cycle guard: ${tripped} — ${out.kind === "menu" ? out.type : out.id}` };
  }
  let chosen: ReturnType<Policy>;
  try {
    chosen = policy(input, memory.rng);
  } catch (error) {
    // #650: a question no handler can read stops the session with its reason; nothing is guessed.
    if (error instanceof PolicyInterruption) return { ok: false, interrupted: `unsupported decision: ${error.message}`, memory: next };
    throw error;
  }
  return { ok: true, answer: chosen.answer, memory: { ...next, rng: chosen.rng }, guard: null };
}
