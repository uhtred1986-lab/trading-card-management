/**
 * The local opponent's battle (#647, plan O2-04): whether to block and with
 * what, whether to [Counter] an attack, and which cards to combo — offence or
 * defence — decided by a bounded, deterministic heuristic over what the seat may
 * know (#644) and nothing else.
 *
 * Every candidate is a decision the engine already offered, so a choice can be
 * weak but never illegal. A decision is judged by what is at stake in the battle
 * **at the current totals** — the engine's own public projection (`stakes`,
 * `vm/view.ts`) where it gives one — and by what the seat's own resources can
 * change about it. It never guesses a hidden response: the other hand, its
 * combos and its counters are not modelled, only the figures on the board.
 *
 *   the rules it reads        8-4-6: the attack card wins when its power is
 *                             greater than **or equal to** the guard's (ties go
 *                             to the attacker); 8-4-6-1 a hit on a Leader deals
 *                             damage, 22-7 [Strike X] makes it X, 22-6
 *                             [Critical] sends the life to the Drop instead of the
 *                             hand, 22-18 [Victory Strike] wins outright; 8-4-6-2
 *                             a hit on a Battle Card KOs it; 5-7-5/5-7-6 a player
 *                             may combo any number of cards, one at a time, each
 *                             at its combo cost; 22-4 [Blocker] rests the blocker
 *                             and makes it the guard; 8-1-4 the counter timing
 *                             after an attack, where a [Counter: Attack] that
 *                             negates the attack ends the battle.
 *   what a loss costs         a lethal hit 1,000; a life lost 1, 2 when it leaves
 *                             3 or fewer, 4 when it leaves 1 or none, +0.5 with
 *                             [Critical] (the card goes to the Drop, not the
 *                             hand); a KO'd Battle Card its board value
 *                             (`cardValue`); a Unison marker 0.75.
 *   what a response costs     a card from hand 1, a Battle Card from the field its
 *                             board value, each energy 0.25, resting a blocker
 *                             that survives 0.25.
 *
 *   blocker   each candidate and "don't block" are costed: the loss the battle
 *             then threatens at the current attack power, or the cheapest
 *             combo cover that would avoid it if that is cheaper; the least
 *             costly option is taken, ties to not blocking. So a lethal attack
 *             is blocked, a non-lethal one is not chump-blocked while life
 *             allows, and a blocker that survives the attack is used.
 *   counter   at the attack's counter timing, a [Counter] whose line negates
 *             the attack is taken when what the battle threatens costs more
 *             than the counter — the threat being the best of not blocking and
 *             of each [Blocker] still to be asked (this engine opens the
 *             counter timing before the blocker window), each with its combo
 *             cover; any other counter,
 *             every counter at a play's timing, and every [Counter: Counter]
 *             answering a counter (#552), is declined — its worth would be a
 *             guess.
 *   combo     the deficit at the current totals (offence: guard − attack;
 *             defence: attack − guard + 1) is covered by the cheapest set of
 *             the offered combos (and typed power battle activations)
 *             the active energy pays for — exactly enough, never padded against
 *             a response nobody has made — and only when what the battle is
 *             worth exceeds that set's cost. A battle already won, one that
 *             cannot be won, or one not worth the cards is passed.
 *   combo waste (v4) in defence, a cover is only paid for if, after it, the
 *             seat could still hold the target through the rest of the turn:
 *             each other card of the opponent's in Active Mode (Leader and
 *             Battle Cards, the attacker aside) is an attack still to come,
 *             assumed sent at this target. A Battle Card holds when every such
 *             attack that reaches its power (ties to the attacker) can be
 *             stopped; the Leader when enough can be stopped that the rest take
 *             less than the life it has, no [Victory Strike] among them. The
 *             means are the seat's own: the combo cards it keeps, its battle
 *             activations left, its energy left, each other active [Blocker]
 *             (one attack each), plus the cover's "for the turn" power — and
 *             they are counted generously (combo power pooled across battles),
 *             so a "no" means no order of them would do. When the cheapest cover
 *             fails that test, the cheapest that passes it is taken; with none,
 *             the hit is taken and the cards kept (in time to answer a later
 *             attack: AI-02's "allow the first hit, survive the Double Strike").
 *             It never applies to a Leader hit that is lethal now, nor with no
 *             other active attacker, nor to a Unison. The opponent's hidden hand,
 *             a card it has yet to play, an extra attack and its combos are not
 *             counted, nor are the seat's counters or a Life card a hit would
 *             put in its hand.
 *   plan cards (v6) an Evolve-family or Union card in hand costs 1.5 more
 *             to combo than a plain hand card: it is a play for a later turn.
 *   counter conservation (v5) at the counter timing, a negating counter is
 *             declined when the seat's combos can hold this attack and the
 *             counter kept is what holds the rest of the turn: after the
 *             cheapest combo cover, the counter stops one attack still to come
 *             (each other active attacker of the opponent's, as above, a lethal
 *             hit now included) and the remaining combos the others; spending
 *             the counter now would leave those attacks unanswerable. The other
 *             negating counters offered stop one attack each in both lines,
 *             each for its own energy. AI-10's "Negate the 30,000, the combos
 *             hold the 20,000" when the 20,000 attacks first.
 *
 * **Bounded.** Every scoring step and every node of the cover search is
 * counted; at `COMBAT_LIMITS.work` the search stops with the best cover found
 * (none, when none was: the conservative answer, which declines). At most
 * `COMBAT_LIMITS.resources` resources enter a cover search and at most
 * `COMBAT_LIMITS.threats` attacks still to come the combo-waste test; when the
 * work runs out inside that test, the cover chosen before it stands.
 *
 * Ties go to the first option in canonical order — declining first — so the
 * choice is a function of the observation and the decisions alone: no clock,
 * no RNG (the policy RNG is handed back untouched), no hidden card.
 *
 * Policy layer: value imports only from `src/lib/arena/policy/` (checked by
 * `scripts/verify/arena-policy-contract.mts`).
 */
import { answerFor, type Decision, type MenuDecision, type Policy, type PolicyInput } from "./contract";
import { activationsThisTurn, cardValue, lifeLoss, mainThen } from "./main";
import type { CardFacts, PolicyObservation, SideFacts } from "./observation";
import { PLAN_KEYWORD, shortcutThen } from "./shortcuts";
import { choicesThen } from "./choices";
import { interruptingPolicy } from "./contract";

/** What losing `damage` life costs its owner (`main.ts` since #650, where the choice handlers read it too). */
export { lifeLoss };

export const COMBAT_POLICY_VERSION = 6;

export const COMBAT_LIMITS = {
  /** Options scored per decision; the rest (by canonical id) are not considered. */
  decisions: 64,
  /** Resources (combo cards, pump activations) a cover search considers. */
  resources: 12,
  /** The opponent's attacks still to come that the combo-waste test weighs (the strongest; the rest are not counted). */
  threats: 6,
  /** Scoring and search steps per decision. */
  work: 4096,
} as const;

/** The windows this module answers. */
export const COMBAT_WINDOWS = ["blocker", "counter", "combo"] as const;

const COST = { future: 0.5, lethal: 1000, handCard: 1, energy: 0.25, restBlocker: 0.25, marker: 0.75, activation: 0.5, unknownAlt: 1, planCard: 1.5 } as const;

/**
 * Plan cards (v6): an Evolve-family or Union card in hand is a play for a later turn (its base or
 * materials), not only a combo card, so comboing it costs `COST.planCard` more than a plain hand card.
 * It is still spent when the battle is worth it (a lethal hit always is). AI-07.
 */
const handLoss = (c: CardFacts) => COST.handCard + (PLAN_KEYWORD.test(c.text ?? "") ? COST.planCard : 0);

export interface CombatChoice {
  id: string;
  /** Why, for the log. */
  how: string;
  /** The chosen option's expected loss (lower is better). */
  loss: number;
  /** Steps spent. Never more than `COMBAT_LIMITS.work`. */
  work: number;
  considered: number;
  bounded: boolean;
}

class Work {
  n = 0;
  constructor(readonly limit: number) {}
  step(): boolean {
    if (this.n >= this.limit) return false;
    this.n++;
    return true;
  }
  get spent(): boolean {
    return this.n >= this.limit;
  }
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const hasKeyword = (c: CardFacts | null | undefined, name: string) => !!c?.keywords.some((k) => k.trim().toLowerCase() === name);

function strikeOf(c: CardFacts | null): number {
  let n = 1;
  for (const k of c?.keywords ?? []) {
    const m = /^(double|triple|quadruple) strike$/i.exec(k.trim());
    if (m) n = Math.max(n, { double: 2, triple: 3, quadruple: 4 }[m[1].toLowerCase() as "double" | "triple" | "quadruple"]);
  }
  return n;
}

function cardsOf(side: SideFacts): CardFacts[] {
  return [side.leader, side.unison, ...side.battle, ...(side.hand ?? [])].filter((c): c is CardFacts => !!c);
}

function findCard(o: PolicyObservation, id: unknown): CardFacts | null {
  if (typeof id !== "string") return null;
  for (const side of [o.you, o.them]) for (const c of cardsOf(side)) if (c.id === id) return c;
  return null;
}

// ---------------------------------------------------------------------------------------------
// What the battle is about.

/** The battle as the policy reads it: public figures at the current totals. */
interface Battle {
  attacking: boolean;
  attack: number;
  guard: number;
  attackerCard: CardFacts | null;
  guardCard: CardFacts | null;
  target: "leader" | "unison" | "battle";
  /** Life the defender would lose to a Leader hit (22-7), before the life left caps it. */
  damage: number;
  critical: boolean;
  victory: boolean;
  koPrevented: boolean;
  defender: SideFacts;
}

function battleOf(o: PolicyObservation): Battle | null {
  const b = o.battle;
  if (!b) return null;
  const attacking = o.turnPlayer === o.seat;
  const defender = attacking ? o.them : o.you;
  const attackerCard = findCard(o, b.attacker);
  const guardCard = findCard(o, b.guard);
  const s = b.stakes;
  const target = s?.target ?? (defender.leader?.id === b.guard ? "leader" : defender.unison?.id === b.guard ? "unison" : "battle");
  return {
    attacking,
    attack: b.attackPower,
    guard: b.guardPower,
    attackerCard,
    guardCard,
    target,
    damage: s?.strikeDamage ?? strikeOf(attackerCard),
    critical: s?.critical ?? hasKeyword(attackerCard, "critical"),
    victory: s?.victoryStrike ?? hasKeyword(attackerCard, "victory strike"),
    koPrevented: s?.koPrevented ?? hasKeyword(guardCard, "indestructible"),
    defender,
  };
}

/** What a hit costs the defender when the guard is `guardCard` (in area `target`). */
function hitLoss(bt: Battle, target: Battle["target"], guardCard: CardFacts | null): number {
  if (target === "leader") return lifeLoss(bt.defender.life, bt.damage, bt.critical, bt.victory);
  if (target === "unison") return COST.marker * Math.min(guardCard?.markers ?? 0, bt.damage);
  return bt.koPrevented && guardCard?.id === bt.guardCard?.id ? 0 : guardCard ? cardValue(guardCard) : 1;
}

// ---------------------------------------------------------------------------------------------
// Covers: the cheapest set of power the seat's own resources can add.

interface Resource {
  /** The decision that spends it (combo window), or the card (estimate before it). */
  id: string;
  power: number;
  energy: number;
  /** What spending it loses, energy aside. */
  loss: number;
  /** Power it gives the guard "for the turn" (#899), so it also holds the battles still to come; absent for a one-battle figure. */
  turn?: number;
  /** The card a combo spends (it is gone for the battles still to come). */
  card?: string;
  /** A typed battle activation: unspent, it is still there for a later battle this turn. */
  activation?: true;
}

interface Cover {
  ids: string[];
  power: number;
  cost: number;
}

/**
 * The cheapest subset of `resources` whose power reaches `need` and whose
 * energy the seat can pay, by total cost, then fewest resources, then least
 * excess power, then canonical order. A depth-first search with
 * branch-and-bound, every node a counted step; null when none is found (or the
 * work ran out before one was).
 */
function cheapestCover(resources: readonly Resource[], need: number, energy: number, work: Work, accept?: (c: Cover) => boolean): Cover | null {
  if (need <= 0) return { ids: [], power: 0, cost: 0 };
  const list = [...resources].filter((r) => r.power > 0).sort((a, b) => b.power - a.power || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, COMBAT_LIMITS.resources);
  const cost = (r: Resource) => r.loss + COST.energy * r.energy;
  let best: Cover | null = null;
  const better = (c: Cover) =>
    !best || c.cost < best.cost - 1e-9 || (Math.abs(c.cost - best.cost) <= 1e-9 && (c.ids.length < best.ids.length || (c.ids.length === best.ids.length && c.power < best.power)));
  // Power still available from index i on, for pruning.
  const tail: number[] = new Array(list.length + 1).fill(0);
  for (let i = list.length - 1; i >= 0; i--) tail[i] = tail[i + 1] + list[i].power;
  const walk = (i: number, ids: string[], power: number, spent: number, paid: number) => {
    if (!work.step()) return;
    if (power >= need) {
      const c = { ids: [...ids], power, cost: paid };
      if (better(c) && (!accept || accept(c))) best = c;
      return;
    }
    if (i >= list.length || power + tail[i] < need) return;
    if (best && paid >= (best as Cover).cost + 1e-9) return;
    const r = list[i];
    if (spent + r.energy <= energy) {
      ids.push(r.id);
      walk(i + 1, ids, power + r.power, spent + r.energy, paid + cost(r));
      ids.pop();
    }
    walk(i + 1, ids, power, spent, paid);
  };
  walk(0, [], 0, 0, 0);
  return best;
}

/** Facts belong to the exact offered skill; malformed or absent metadata is not a benefit. */
function battleActivationOf(d: MenuDecision): MenuDecision["battleActivation"] | null {
  const s = d.battleActivation;
  if (!s || s.version !== 1 || !Number.isSafeInteger(s.skillIndex) || s.skillIndex < 0 || d.action.skill !== s.skillIndex
    || !["activate:battle", "activate:main/battle"].includes(s.timing)
    || !Number.isSafeInteger(s.power?.battle) || s.power.battle < 0 || !Number.isSafeInteger(s.power?.turn) || s.power.turn < 0 || s.power.turn > s.power.battle
    || !Number.isSafeInteger(s.drawnFirst) || s.drawnFirst < 0) return null;
  return s;
}

function counterResponseOf(d: MenuDecision): MenuDecision["counterResponse"] | null {
  const s = d.counterResponse;
  if (!s || s.version !== 1 || !Number.isSafeInteger(s.skillIndex) || s.skillIndex < 0
    || d.action.skill !== undefined && d.action.skill !== s.skillIndex
    || !["counter:attack", "counter:battle card attack", "counter:counter", "counter:play"].includes(s.kind)
    || s.negatesAttack !== null && typeof s.negatesAttack !== "boolean"
    || !["none", "free", "other"].includes(s.alternativePrice)
    || !d.action.alt && s.alternativePrice !== "none") return null;
  return s;
}

/** The seat's own resources at the combo window: the offered combos and typed pump activations. */
function offeredResources(o: PolicyObservation, bt: Battle, open: readonly MenuDecision[], work: Work): Resource[] {
  const out: Resource[] = [];
  for (const d of open) {
    if (!work.step()) break;
    if (d.type === "combo") {
      const card = findCard(o, d.action.card);
      if (!card) continue;
      const fromHand = (o.you.hand ?? []).some((c) => c.id === card.id);
      out.push({ id: d.id, power: Math.max(0, card.comboPower ?? 0), energy: Math.max(0, card.comboCost ?? 0), loss: fromHand ? handLoss(card) : cardValue(card), card: card.id });
    } else if (d.type === "activate") {
      const card = findCard(o, d.action.card);
      const used = typeof d.action.card === "string" ? activationsThisTurn(o, o.seat, d.action.card) : null;
      if (used === null || used >= 1) continue;
      const summary = battleActivationOf(d);
      if (!summary) continue;
      const turn = bt.attacking ? 0 : summary.power.turn;
      const power = summary.power.battle;
      if (!power) continue;
      const energy = Math.max(0, (d.cost?.energy ?? 0) + Math.max(0, d.cost?.markers ?? 0));
      // From the hand it spends that card (an Extra), less what it draws first; on the field it costs the activation.
      const fromHand = !!card && (o.you.hand ?? []).some((c) => c.id === card.id);
      const loss = fromHand ? Math.max(0, COST.handCard - summary.drawnFirst) : COST.activation;
      out.push({ id: d.id, power, energy, loss, ...(turn > 0 ? { turn } : {}), activation: true });
    }
  }
  return out;
}

/**
 * The seat's own defensive resources before the combo window opens (the
 * blocker and counter windows), estimated from its hand and field: cards with a
 * combo cost and power, the guard and `exclude` left out. The engine decides
 * eligibility at the window itself; this is only what the seat could cover.
 */
function estimatedResources(o: PolicyObservation, exclude: ReadonlySet<string>): Resource[] {
  const out: Resource[] = [];
  const usable = (c: CardFacts) => c.comboCost !== null && c.comboPower !== null && c.comboPower > 0 && !exclude.has(c.id);
  for (const c of [...(o.you.hand ?? [])].sort(byId)) if (usable(c)) out.push({ id: c.id, power: c.comboPower!, energy: Math.max(0, c.comboCost!), loss: handLoss(c) });
  for (const c of [...o.you.battle].sort(byId)) if (c.mode === "active" && usable(c)) out.push({ id: c.id, power: c.comboPower!, energy: Math.max(0, c.comboCost!), loss: cardValue(c) });
  return out;
}

// ---------------------------------------------------------------------------------------------
// The windows.

interface Option {
  d: MenuDecision;
  loss: number;
  how: string;
}

const isDecline = (d: MenuDecision) => d.type === "pass" || ((d.type === "block" || d.type === "counter") && d.action.card === null);

/** The least loss; ties to the earlier option (declining is listed first). */
function cheapest(options: Option[]): Option | null {
  let best: Option | null = null;
  for (const x of options) if (!best || x.loss < best.loss - 1e-9) best = x;
  return best;
}

/** What the defender loses at guard power `guard` with guard card `card`: the hit, or the cover that avoids it if cheaper. */
function defenceLoss(o: PolicyObservation, bt: Battle, guard: number, target: Battle["target"], card: CardFacts | null, exclude: Set<string>, work: Work): { loss: number; how: string } {
  if (bt.attack < guard) return { loss: 0, how: `the attack (${bt.attack}) does not reach ${guard}` };
  const hit = hitLoss(bt, target, card);
  const cover = cheapestCover(estimatedResources(o, exclude), bt.attack - guard + 1, Math.max(0, o.you.activeEnergy), work);
  if (cover && cover.cost < hit) return { loss: cover.cost, how: `combos ${cover.ids.length} to hold (${cover.power} power)` };
  return { loss: hit, how: hit >= COST.lethal ? "lethal" : `costs ${hit.toFixed(2)}` };
}

/** What declining to block, or blocking with `card`, leaves the defender to lose. */
function blockLoss(o: PolicyObservation, bt: Battle, card: CardFacts | null, work: Work): { loss: number; how: string } {
  const guardSet = new Set([bt.guardCard?.id ?? ""]);
  if (!card) {
    const r = defenceLoss(o, bt, bt.guard, bt.target, bt.guardCard, guardSet, work);
    return { loss: r.loss, how: `no block: ${r.how}` };
  }
  const power = card.power ?? 0;
  const r = defenceLoss(o, bt, power, "battle", card, new Set([card.id, ...guardSet]), work);
  return { loss: r.loss + COST.restBlocker, how: `blocks with ${card.name} (${power} vs ${bt.attack}): ${r.how}` };
}

function blockerChoice(o: PolicyObservation, bt: Battle, open: MenuDecision[], work: Work): Option | null {
  const options: Option[] = [];
  const decline = open.find((d) => d.type === "block" && d.action.card === null);
  for (const d of [...(decline ? [decline] : []), ...open.filter((x) => x.type === "block" && x.action.card !== null)]) {
    if (!work.step()) break;
    const card = d.action.card === null ? null : findCard(o, d.action.card);
    if (d.action.card !== null && !card) continue;
    options.push({ d, ...blockLoss(o, bt, card, work) });
  }
  return cheapest(options);
}

/**
 * The best the defender can still do without a counter. This engine opens the
 * attack's counter timing before the blocker window (`vm/battle.ts`, 8-1-4 then
 * 8-1-2-1), so a [Blocker] still to be asked is an alternative: each active
 * card of the seat's with [Blocker] (not the guard) is costed as a block would be.
 */
function withoutCounter(o: PolicyObservation, bt: Battle, work: Work): { loss: number; how: string } {
  let best = blockLoss(o, bt, null, work);
  const blockers = o.you.battle.filter((c) => c.mode === "active" && c.id !== bt.guardCard?.id && hasKeyword(c, "blocker")).sort(byId);
  for (const c of blockers) {
    if (!work.step()) break;
    const r = blockLoss(o, bt, c, work);
    if (r.loss < best.loss - 1e-9) best = r;
  }
  return best;
}

function counterChoice(o: PolicyObservation, bt: Battle | null, open: MenuDecision[], work: Work): Option | null {
  const decline = open.find((d) => d.type === "counter" && d.action.card === null);
  if (!decline) return null;
  // #552: a [Counter: Counter] window (9-7-3-3, 22-10-3-4) — every card offered
  // answers the opponent's counter, not the attack, and what negating that
  // counter is worth is not read here: declined explicitly (9-7-2-3).
  const offered = open.filter((d) => d.type === "counter" && d.action.card !== null);
  if (offered.length && offered.every((d) => counterResponseOf(d)?.kind === "counter:counter")) {
    return { d: decline, loss: 0, how: "declines: a [Counter: Counter] answer is not weighed" };
  }
  // A play's counter timing (no battle, or one past its declaration): what the play is worth is not read here.
  if (!bt || bt.attacking || o.battle?.step !== "declared") return { d: decline, loss: 0, how: "declines: a counter is only weighed against an attack" };
  const threat = withoutCounter(o, bt, work);
  const options: Option[] = [{ d: decline, loss: threat.loss, how: `no counter: ${threat.how}` }];
  for (const d of open) {
    if (!work.step()) break;
    if (d.type !== "counter" || d.action.card === null) continue;
    const card = findCard(o, d.action.card);
    const summary = counterResponseOf(d);
    if (summary?.negatesAttack !== true || !["counter:attack", "counter:battle card attack"].includes(summary.kind)) continue;
    const energy = d.cost ? d.cost.energy : Math.max(0, card?.energyCost ?? 0);
    const extra = d.action.alt && summary.alternativePrice !== "free" && !d.cost?.energy ? COST.unknownAlt : 0;
    options.push({ d, loss: COST.handCard + COST.energy * energy + extra, how: `counters with ${card?.name ?? "a card"}: negates the attack` });
  }
  const best = cheapest(options);
  if (!best || best.d === decline) return best;
  const kept = counterKept(o, bt, open, best.d, work);
  return kept ? { d: decline, loss: threat.loss, how: `keeps the counter: ${kept}` } : best;
}

/** The negating counters offered at this timing: card and energy, canonical order. */
function negatingCounters(o: PolicyObservation, open: readonly MenuDecision[]): { d: MenuDecision; card: string; energy: number }[] {
  const out: { d: MenuDecision; card: string; energy: number }[] = [];
  for (const d of [...open].sort(byId)) {
    if (d.type !== "counter" || d.action.card === null || d.action.alt) continue;
    const summary = counterResponseOf(d);
    if (summary?.negatesAttack !== true || !["counter:attack", "counter:battle card attack"].includes(summary.kind)) continue;
    const card = findCard(o, d.action.card);
    out.push({ d, card: String(d.action.card), energy: d.cost ? d.cost.energy : Math.max(0, card?.energyCost ?? 0) });
  }
  return out;
}

/**
 * Counter conservation (v5): why declining `chosen` and holding this attack with combos keeps the rest
 * of the turn answerable when countering now does not; null when it does not (the counter stands).
 * Defence of the Leader or a Battle Card only, with at least one other active attacker of the
 * opponent's. Both lines are judged by `holdsRest` on the seat's own known means.
 */
function counterKept(o: PolicyObservation, bt: Battle, open: readonly MenuDecision[], chosen: MenuDecision, work: Work): string | null {
  if (bt.attacking || bt.target === "unison" || bt.victory) return null;
  const threats = attacksToCome(o);
  if (!threats.length) return null;
  const counters = negatingCounters(o, open);
  const spent = counters.find((c) => c.d.id === chosen.id);
  if (!spent) return null;
  const others = counters.filter((c) => c !== spent);
  const energy = Math.max(0, o.you.activeEnergy);
  const guardSet = new Set([bt.guardCard?.id ?? "", ...counters.map((c) => c.card)]);
  const base = bt.guardCard?.power ?? bt.guard;
  const blockers = o.you.battle.filter((x) => x.mode === "active" && x.id !== bt.guardCard?.id && hasKeyword(x, "blocker")).length;
  // Countering now: the counter and its energy gone, everything else kept.
  const afterCounter = holdsRest(bt, threats, base, blockers, others, estimatedResources(o, guardSet), energy - spent.energy, work);
  if (afterCounter !== false) return null;
  // Declining: the cheapest combo cover holds this battle (the attacker wins ties), then the counter is kept.
  const means = estimatedResources(o, guardSet);
  const cover = cheapestCover(means, bt.attack - bt.guard + 1, energy, work);
  if (!cover || work.spent) return null;
  const used = new Set(cover.ids);
  const left = energy - means.filter((r) => used.has(r.id)).reduce((n, r) => n + r.energy, 0);
  const afterDecline = holdsRest(bt, threats, base, blockers, counters, means.filter((r) => !used.has(r.id)), left, work);
  if (afterDecline !== true) return null;
  return `${cover.ids.length} combo(s) hold this attack (${cover.power}) and the counter answers one of the ${threats.length} attack(s) still to come; countering now leaves them unanswerable`;
}

/** Each other card of the opponent's in Active Mode (the attacker aside) is an attack still to come, the strongest first. */
function attacksToCome(o: PolicyObservation): Threat[] {
  const attacker = o.battle?.attacker;
  const out: Threat[] = [];
  for (const c of [o.them.leader, ...o.them.battle]) {
    if (!c || c.mode !== "active" || c.id === attacker || c.power === null) continue;
    out.push({ id: c.id, power: c.power, damage: threatDamage(c), victory: hasKeyword(c, "victory strike") });
  }
  out.sort((a, b) => b.power - a.power || b.damage - a.damage || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out.slice(0, COMBAT_LIMITS.threats);
}

/**
 * Whether the target (at `power`) holds through `threats` with `blockers` blockers, the `counters`
 * (one attack each, for its energy) and the combo `means` for the energy left: some number of the
 * cheapest counters used, the rest of the energy to combos. Null when the work ran out.
 */
function holdsRest(bt: Battle, threats: readonly Threat[], power: number, blockers: number, counters: readonly { energy: number }[], means: readonly Resource[], energy: number, work: Work): boolean | null {
  if (energy < 0) return false;
  const costs = counters.map((c) => c.energy).sort((a, b) => a - b);
  let paid = 0;
  for (let k = 0; k <= costs.length; k++) {
    if (k > 0) paid += costs[k - 1];
    if (paid > energy) break;
    const need = leastToHold(bt, threats, power, blockers + k, work);
    if (work.spent) return null;
    if (need <= 0 || need <= maxPower(means, energy - paid, work)) return work.spent ? null : true;
  }
  return work.spent ? null : false;
}

function comboChoice(o: PolicyObservation, bt: Battle | null, open: MenuDecision[], work: Work): Option | null {
  const pass = open.find((d) => d.type === "pass");
  if (!pass) return null;
  if (!bt) return { d: pass, loss: 0, how: "passes: no battle to fight" };
  // 8-4-6: the attacker wins ties.
  const need = bt.attacking ? bt.guard - bt.attack : bt.attack - bt.guard + 1;
  if (need <= 0) return { d: pass, loss: 0, how: bt.attacking ? `passes: ${bt.attack} already beats ${bt.guard} (ties go to the attacker)` : `passes: ${bt.guard} already holds ${bt.attack}` };
  const worth = hitLoss(bt, bt.target, bt.guardCard);
  const resources = offeredResources(o, bt, open, work);
  const energy = Math.max(0, o.you.activeEnergy);
  // #899: a "for the turn" figure also holds the public attackers still to come, a one-battle combo does not.
  // Only when one is offered are the covers weighed by what they leave exposed; otherwise a cover's score is its cost.
  const turnLong = resources.filter((r) => r.turn);
  const turnOf = (ids: readonly string[]) => ids.reduce((n, id) => n + (resources.find((r) => r.id === id)?.turn ?? 0), 0);
  const weigh = (c: Cover) => (turnLong.length ? c.cost + exposure(o, bt, bt.guard + turnOf(c.ids), worth) : c.cost);
  /** The best-scoring cover `accept` allows: the cheapest set, or a lone turn-long resource that leaves less exposed. */
  const choose = (accept?: (c: Cover) => boolean): { cover: Cover | null; score: number } => {
    let cover = cheapestCover(resources, need, energy, work, accept);
    let score = cover ? weigh(cover) : Infinity;
    for (const r of turnLong) {
      if (!work.step() || r.power < need || r.energy > energy) continue;
      const alone: Cover = { ids: [r.id], power: r.power, cost: r.loss + COST.energy * r.energy };
      if (accept && !accept(alone)) continue;
      const s = weigh(alone);
      if (s < score - 1e-9) {
        cover = alone;
        score = s;
      }
    }
    return { cover, score };
  };
  let { cover, score } = choose();
  if (!cover) return { d: pass, loss: worth, how: `passes: ${need} more power is out of reach` };
  // Combo waste (v4): a defence the rest of the turn undoes anyway is not paid for. When the chosen cover would
  // leave the seat unable to hold the target through the opponent's other public attackers, the cheapest cover
  // that would still hold is taken instead, and with none the hit is taken and the cards kept. Out of work, the
  // first choice stands.
  let holdsTurn = "";
  const threats = restOfTurn(o, bt);
  if (threats) {
    const holds = turnHolder(o, bt, threats, resources, energy, work);
    if (!holds(cover)) {
      const kept = choose(holds);
      if (!work.spent) {
        const what = bt.target === "leader" ? "the Leader" : (bt.guardCard?.name ?? "the guard");
        if (!kept.cover) return { d: pass, loss: worth, how: `passes: no cover also holds ${what} through the ${threats.length} other active attacker(s) this turn, so the cards are kept` };
        cover = kept.cover;
        score = kept.score;
        holdsTurn = ", one that also holds the rest of the turn";
      }
    }
  }
  if (score >= worth) return { d: pass, loss: worth, how: `passes: the cover (${score.toFixed(2)}) costs more than the battle is worth (${worth.toFixed(2)})` };
  const first = open.find((d) => d.id === cover!.ids[0])!;
  return { d: first, loss: score, how: `${bt.attacking ? "offence" : "defence"}: ${cover.ids.length} resource(s) cover ${need} (${cover.power}), cost ${score.toFixed(2)} < worth ${worth.toFixed(2)}${holdsTurn}` };
}

/**
 * What the guard still risks this turn at guard power `guard` (#899): each other
 * public active attacker of the opponent that reaches it (ties go to the attacker, 8-4-6)
 * might be sent at it, weighted `COST.future`. Read from the observation only.
 */
function exposure(o: PolicyObservation, bt: Battle, guard: number, hit: number): number {
  if (bt.attacking) return 0;
  const them = o.them;
  let n = 0;
  for (const c of [them.leader, ...them.battle]) if (c && c.mode === "active" && c.id !== bt.attackerCard?.id && (c.power ?? 0) >= guard) n++;
  return n * COST.future * hit;
}

// ---------------------------------------------------------------------------------------------
// Combo waste (v4): the rest of the turn, as the defender can see it.

/** An attack the opponent can still make this turn, by the figures on its card. */
interface Threat {
  id: string;
  power: number;
  /** Life a hit on the Leader takes (22-7). */
  damage: number;
  victory: boolean;
}

/**
 * The opponent's attacks still to come this turn, or null where the combo-waste test does not
 * apply: offence, a Unison guard, a Leader hit that is lethal now (cards kept are worth nothing to
 * a seat that has lost: such a hit is still covered when it can be), or no other attacker. Each other
 * card of the opponent's in Active Mode — its Leader and Battle Cards, the attacker aside — is one
 * attack, assumed sent at this battle's target. A card it has yet to play, an extra attack and its
 * combos are not counted, so the threat is never overstated. At most `COMBAT_LIMITS.threats`, the strongest.
 */
function restOfTurn(o: PolicyObservation, bt: Battle): Threat[] | null {
  if (bt.attacking || bt.target === "unison") return null;
  if (bt.target === "leader" && (bt.victory || bt.damage >= bt.defender.life)) return null;
  const attacker = o.battle?.attacker;
  const out: Threat[] = [];
  for (const c of [o.them.leader, ...o.them.battle]) {
    if (!c || c.mode !== "active" || c.id === attacker || c.power === null) continue;
    out.push({ id: c.id, power: c.power, damage: threatDamage(c), victory: hasKeyword(c, "victory strike") });
  }
  out.sort((a, b) => b.power - a.power || b.damage - a.damage || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out.length ? out.slice(0, COMBAT_LIMITS.threats) : null;
}

/**
 * The life a hit by `c` would take (22-7), for a battle not yet declared (no `stakes`). The board
 * names the keyword's family ("Strike") and the printed text keeps its figure, as `search.ts` reads
 * it: one printed [Double/Triple/Quadruple Strike] while the keyword is active and no effect grants
 * a Strike. Anything less certain counts 1, the least a hit takes, so the threat is not overstated.
 */
function threatDamage(c: CardFacts): number {
  const named = strikeOf(c);
  if (named > 1 || !hasKeyword(c, "strike") || c.effects?.some((e) => e.keyword && /strike/i.test(e.keyword))) return named;
  const printed = [...(c.text ?? "").matchAll(/\[(Double|Triple|Quadruple) Strike\]/gi)];
  return printed.length === 1 ? { double: 2, triple: 3, quadruple: 4 }[printed[0][1].toLowerCase() as "double" | "triple" | "quadruple"] : 1;
}

/** The most power `resources` add for at most `energy` energy: a 0/1 knapsack over energy, one step per resource. */
function maxPower(resources: readonly Resource[], energy: number, work: Work): number {
  const list = resources.filter((r) => r.power > 0).slice(0, COMBAT_LIMITS.resources);
  const cap = Math.max(0, Math.min(energy, list.reduce((n, r) => n + r.energy, 0)));
  const best: number[] = new Array(cap + 1).fill(0);
  for (const r of list) {
    if (!work.step()) return Infinity;
    for (let e = cap; e >= r.energy; e--) best[e] = Math.max(best[e], best[e - r.energy] + r.power);
  }
  return best[cap];
}

/**
 * Whether, after spending a cover, the seat could still hold this battle's target through
 * `threats`: the Leader alive (the life it has now, every [Victory Strike] that reaches it stopped),
 * a Battle Card not KO'd (every attack that reaches it stopped). The target's power is its card's
 * own (no combo of this battle) plus the cover's "for the turn" power; an attack reaches it at equal
 * power (8-4-6) and needs the difference + 1 to stop. The seat's means are what it knows of its own:
 * the combo cards left in hand and on the field (`estimatedResources`), the battle activations not
 * spent, the energy left, and each other active [Blocker] of its own.
 *
 * Optimistic for the defender on purpose — the combos pooled as if split freely between battles,
 * each blocker taking one attack whole, a [Counter] and a Life card a hit puts in the hand not
 * counted against the threat but not counted for it either — so "no" means no order of the seat's
 * known resources holds the target if the opponent sends those attackers at it. Out of work, "yes".
 */
function turnHolder(o: PolicyObservation, bt: Battle, threats: readonly Threat[], offered: readonly Resource[], energy: number, work: Work): (c: Cover) => boolean {
  const guardId = bt.guardCard?.id ?? "";
  const base = bt.guardCard?.power ?? bt.guard;
  const memo = new Map<string, number>();
  /** The least combo power that holds the target at `power` with `blockers` blockers. */
  const least = (power: number, blockers: number): number => {
    const key = `${power}:${blockers}`;
    const known = memo.get(key);
    if (known !== undefined) return known;
    const v = leastToHold(bt, threats, power, blockers, work);
    memo.set(key, v);
    return v;
  };
  return (c) => {
    if (!work.step()) return true;
    const spent = new Set(c.ids);
    const used = offered.filter((r) => spent.has(r.id));
    const gone = new Set([guardId, ...used.flatMap((r) => (r.card ? [r.card] : []))]);
    const left = energy - used.reduce((n, r) => n + r.energy, 0);
    const blockers = o.you.battle.filter((x) => x.mode === "active" && !gone.has(x.id) && hasKeyword(x, "blocker")).length;
    const need = least(base + used.reduce((n, r) => n + (r.turn ?? 0), 0), blockers);
    if (need <= 0) return true;
    const later = [...estimatedResources(o, gone), ...offered.filter((r) => r.activation && !spent.has(r.id))];
    return need <= maxPower(later, Math.max(0, left), work);
  };
}

/**
 * The least combo power that holds this battle's target at `power` through `threats`, with `blockers`
 * attacks stopped whole (the largest needs first): a Battle Card every attack that reaches it stopped;
 * the Leader enough stopped that the rest take less than the life it has, no [Victory Strike] among
 * them. Infinity when nothing does; 0 out of work.
 */
function leastToHold(bt: Battle, threats: readonly Threat[], power: number, blockers: number, work: Work): number {
  const reaching = threats.filter((t) => t.power >= power);
  const needs = (ts: readonly Threat[]) => ts.map((t) => t.power - power + 1).sort((a, b) => b - a).slice(blockers).reduce((n, x) => n + x, 0);
  if (bt.target !== "leader") return needs(reaching);
  let v = Infinity;
  // The attacks stopped (bit set) and those let through: less damage than the life left, no Victory Strike.
  for (let mask = 0; mask < 1 << reaching.length; mask++) {
    if (!work.step()) return 0;
    const stopped = reaching.filter((_, i) => mask & (1 << i));
    const through = reaching.filter((_, i) => !(mask & (1 << i)));
    if (through.some((t) => t.victory) || through.reduce((n, t) => n + t.damage, 0) >= bt.defender.life) continue;
    v = Math.min(v, needs(stopped));
  }
  return v;
}

/** The battle choice for this input, or null outside the battle's windows (or with nothing to choose). Pure. */
export function combatChoice(input: PolicyInput): CombatChoice | null {
  const { observation: o, decisions } = input;
  if (decisions.actor !== decisions.seat || !(COMBAT_WINDOWS as readonly string[]).includes(decisions.window)) return null;
  const work = new Work(COMBAT_LIMITS.work);
  const open = decisions.decisions
    .filter((d: Decision): d is MenuDecision => d.kind === "menu")
    .sort(byId)
    .slice(0, COMBAT_LIMITS.decisions);
  if (!open.length) return null;
  const bt = battleOf(o);
  let pick: Option | null = null;
  if (decisions.window === "blocker") pick = bt ? blockerChoice(o, bt, open, work) : null;
  else if (decisions.window === "counter") pick = counterChoice(o, bt, open, work);
  else pick = comboChoice(o, bt, open, work);
  if (!pick) {
    // Nothing readable: decline, which every battle window offers.
    const decline = open.find(isDecline);
    if (!decline) return null;
    pick = { d: decline, loss: 0, how: "declines: the battle is not readable" };
  }
  const bounded = work.spent;
  return { id: pick.d.id, how: bounded ? `${pick.how} (work bound reached)` : pick.how, loss: pick.loss, work: work.n, considered: open.length, bounded };
}

/** A policy that decides the battle's windows and defers everything else to `fallback`. Draws no randomness of its own. */
export function combatThen(fallback: Policy): Policy {
  return (input, rng) => {
    const hit = combatChoice(input);
    return hit ? { answer: answerFor(input.decisions, hit.id), rng } : fallback(input, rng);
  };
}

/**
 * The local policy as O2-04 left it: the free-choice shortcuts (#645), the
 * Main Phase and its payments (#646), the battle's windows (#647), then
 * `fallback` for every other window. Kept for comparison (#650's strength
 * check); the local policy is `localPolicy` below.
 */
export function combatPolicy(fallback: Policy): Policy {
  return shortcutThen(mainThen(combatThen(fallback)));
}

/**
 * The local policy (#650): the free-choice shortcuts (#645), the Main Phase and
 * its payments (#646), the battle's windows (#647), then the constrained
 * choices — card picks, modes, replacements, prices, Auto order (`choices.ts`).
 * Every `DECISION_WINDOWS` kind has a handler (`WINDOW_HANDLERS`), so
 * `fallback` is reached only by a question no handler can read; by default it
 * interrupts (`interruptingPolicy`) rather than guessing.
 */
export function localPolicy(fallback: Policy = interruptingPolicy): Policy {
  return shortcutThen(mainThen(combatThen(choicesThen(fallback))));
}
