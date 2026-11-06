/** R-399: freely selected declared resource pools, distinct from ordered draws. */
import type { Action, EngineContext, CardChoice, CardOccurrence, PlayerId, PoolPaymentSelection } from "../types";
import type { GameDefinition } from "../rulesets";
import { chargeCost, chargesOf, explicitPoolProblem, choicePoolCards, type Price, type VmPayment } from "./costs";
import { canFinishAutomaticPrice, interchangeablePoolCandidates } from "./auto-costs";
import { NotYet } from "./errors";
import { IllegalAction } from "./common";
import type { ScriptFrame } from "./script";
import type { VmState } from "./state";

export interface FramePoolPayment {
  selection: PoolPaymentSelection;
  pending?: { cost: string; n: number; candidates: CardOccurrence[] };
  /** A declared native pool may itself consume the source; that successful payment is not a stale source. */
  sourcePaid?: true;
}
const occurrence = (state: VmState, card: string): CardOccurrence => ({ card, epoch: state.cards[card]?.zoneEpoch ?? 0 });
export function poolSelection(state: VmState, card: string | null): PoolPaymentSelection {
  return { source: card === null ? null : occurrence(state, card), pools: [] };
}
function append(selection: PoolPaymentSelection, picked: PoolPaymentSelection["pools"][number]): void {
  const prior = selection.pools.find(p => p.cost === picked.cost);
  if (prior) prior.cards.push(...picked.cards); else selection.pools.push(picked);
}
export function selectedPoolAnswer(state: VmState, pending: { cost: string; n: number; candidates: CardOccurrence[] }, cards: string[]): PoolPaymentSelection["pools"][number] {
  if (new Set(cards).size !== cards.length) throw new IllegalAction("a pooled payment cannot spend the same card twice");
  return { cost: pending.cost, n: pending.n, cards: cards.map(card => {
    const saved = pending.candidates.find(x => x.card === card);
    if (!saved || !state.cards[card] || (state.cards[card].zoneEpoch ?? 0) !== saved.epoch) throw new IllegalAction("that pooled payment occurrence is no longer available");
    return saved;
  }) };
}
/** Bind source and forced physical payers before an earlier resource prompt. */
export function primeFramePools(game: GameDefinition, state: VmState, frame: ScriptFrame, price: Price): void {
  const charges = chargesOf(game);
  if (!price.pooled.some(p => p.n > 0 && charges[p.cost]?.asks === "choice")) return;
  const saved = frame.poolPayment ??= { selection: poolSelection(state, frame.card) };
  for (const pool of price.pooled) {
    if (charges[pool.cost]?.asks !== "choice" || saved.selection.pools.some(p => p.cost === pool.cost)) continue;
    const ids = choicePoolCards(game, state, frame.master, pool);
    if (pool.n > 0 && ids.length === pool.n) saved.selection.pools.push({ cost: pool.cost, n: pool.n, cards: ids.map(id => occurrence(state, id)) });
  }
}
function nextPool(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame, price: Price, payment: VmPayment, selection: PoolPaymentSelection, complete?: (payment: VmPayment) => boolean, symmetry = true) {
  const problem = explicitPoolProblem(game, state, frame.master, price, frame.card, selection, true);
  if (problem) throw new IllegalAction(problem);
  const charges = chargesOf(game);
  for (const pool of price.pooled) {
    if (pool.n <= 0 || charges[pool.cost]?.asks !== "choice") continue;
    const prior = selection.pools.find(p => p.cost === pool.cost)?.cards ?? [];
    const left = pool.n - prior.length;
    if (!left) continue;
    const available = choicePoolCards(game, state, frame.master, pool).filter(id => !prior.some(p => p.card === id));
    if (available.length < left) throw new IllegalAction("not enough cards remain for the pooled payment");
    if (available.length === left) {
      append(selection, { cost: pool.cost, n: pool.n, cards: available.map(id => occurrence(state, id)) });
      continue;
    }
    const candidates = complete ? available.filter(id => {
      const trial = structuredClone(selection);
      append(trial, { cost: pool.cost, n: pool.n, cards: [occurrence(state, id)] });
      for (const variant of pooledPaymentVariants(ctx, game, state, frame, price, payment, trial, { symmetry })) if (complete(variant)) return true;
      return false;
    }) : available;
    if (!candidates.length) throw new IllegalAction("no selection can pay the complete skill cost");
    const n = complete ? 1 : left;
    const area = game.words[pool.area]?.you ?? `your ${pool.area}`;
    const choice: CardChoice = { reason: `Choose ${n} card${n === 1 ? "" : "s"} from ${area} to pay the cost${complete && left > 1 ? ` (${left} remaining)` : ""}`, candidates, min: n, max: n, continuation: "pooledPayment", ...(!complete ? { atomic: true as const } : {}) };
    return { cost: pool.cost, n: pool.n, candidates: candidates.map(id => occurrence(state, id)), choice };
  }
  for (const picked of selection.pools) payment.pooled.find(p => p.cost === picked.cost)!.cards = picked.cards.map(x => x.card);
  if (price.pooled.some(p => p.n > 0 && charges[p.cost]?.asks === "choice") && complete && !complete(payment)) throw new IllegalAction("that pool selection cannot pay the complete skill cost");
  return null;
}
/** Native action continuation; resource mutations happen only after every choice. */
export function askActionPool(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, action: Action, price: Price, card: string, payment: VmPayment, ops: ScriptFrame["ops"], complete?: (payment: VmPayment) => boolean): boolean {
  const selection = structuredClone((action as { payPools?: PoolPaymentSelection }).payPools ?? poolSelection(state, card));
  const frame: ScriptFrame = { card, master: player, ops, ip: 0, vars: {} };
  const next = nextPool(ctx, game, state, frame, price, payment, selection, complete);
  if (!next) return false;
  const continuation = { ...action, payPools: selection } as Action;
  state.prompt = { kind: "chooseCards", player, choice: next.choice, pooledPayment: { action: continuation, cost: next.cost, n: next.n, candidates: next.candidates, source: selection.source } };
  return true;
}
/** Auto/Aegis/Fusion use the same prefix and full-price proof as native actions. */
export function chooseFramePools(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame, price: Price, payment: VmPayment, complete?: (payment: VmPayment) => boolean, { symmetry = true }: { symmetry?: boolean } = {}): "wait" | "done" {
  primeFramePools(game, state, frame, price);
  if (!frame.poolPayment) return "done";
  const saved = frame.poolPayment;
  if (saved.pending) {
    if (!state.lastChoice) throw new IllegalAction("the pooled resource payment has no answer");
    append(saved.selection, selectedPoolAnswer(state, saved.pending, state.lastChoice));
    state.lastChoice = null;
    delete saved.pending;
  }
  const next = nextPool(ctx, game, state, frame, price, payment, saved.selection, complete, symmetry);
  if (!next) return "done";
  saved.pending = { cost: next.cost, n: next.n, candidates: next.candidates };
  state.programs.unshift(frame);
  state.prompt = { kind: "chooseCards", player: frame.master, choice: next.choice };
  return "wait";
}
/** Recheck source and the remaining selected payers across native departures. */
export function requirePoolOccurrence(state: VmState, frame: ScriptFrame, cost?: string, card?: string): void {
  const source = frame.poolPayment?.selection.source;
  if (source && !frame.poolPayment?.sourcePaid && (!state.cards[source.card] || (state.cards[source.card].zoneEpoch ?? 0) !== source.epoch)) throw new IllegalAction("that resource payment source occurrence is no longer available");
  const selected = frame.poolPayment?.selection.pools.find(p => p.cost === cost)?.cards.find(x => x.card === card);
  if (selected && (!state.cards[selected.card] || (state.cards[selected.card].zoneEpoch ?? 0) !== selected.epoch)) throw new IllegalAction("that selected resource occurrence is no longer available");
}

/** Exact, lazy class-count search. The UI still exposes every physical card.
 * Call only for a following identity-sensitive price, never ordinary Z play. */
export function* pooledPaymentVariants(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame, price: Price, payment: VmPayment, prefix?: PoolPaymentSelection, { symmetry = true }: { symmetry?: boolean } = {}): Generator<VmPayment> {
  const charges = chargesOf(game);
  const pools = price.pooled.filter(p => p.n > 0 && charges[p.cost]?.asks === "choice");
  function* subsets(pool: typeof pools[number]): Generator<string[]> {
    const picked = prefix?.pools.find(p => p.cost === pool.cost)?.cards.map(x => x.card) ?? [];
    const candidates = choicePoolCards(game, state, frame.master, pool).filter(id => !picked.includes(id));
    const destination = (charges[pool.cost]?.does as { to?: string } | null)?.to ?? "";
    const classes = symmetry ? interchangeablePoolCandidates(ctx, game, state, frame, candidates, pool.area, destination) : new Map<string, string>();
    const groups = new Map<string, string[]>();
    for (const id of candidates) { const key = classes.get(id) ?? id; groups.set(key, [...(groups.get(key) ?? []), id]); }
    const grouped = [...groups.values()], suffix = Array(grouped.length + 1).fill(0) as number[];
    for (let i = grouped.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + grouped[i].length;
    function* visit(i: number, left: number, selected: string[]): Generator<string[]> {
      if (!left) { yield selected; return; }
      if (i === grouped.length || suffix[i] < left) return;
      for (let n = Math.min(grouped[i].length, left); n >= Math.max(0, left - suffix[i + 1]); n--)
        yield* visit(i + 1, left - n, [...selected, ...grouped[i].slice(0, n)]);
    }
    yield* visit(0, pool.n - picked.length, picked);
  }
  function* visitPool(i: number, selected: VmPayment["pooled"]): Generator<VmPayment> {
    if (i === pools.length) { yield { ...payment, pooled: selected }; return; }
    const pool = pools[i];
    for (const cards of subsets(pool)) yield* visitPool(i + 1, selected.map(p => p.cost === pool.cost ? { cost: p.cost, cards } : p));
  }
  yield* visitPool(0, payment.pooled);
}

/** Resource planning remains isolated; predictable full-price failure pays nothing. */
export function resourceActionFinishes(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame, payment: VmPayment, costs: string[], ops: ScriptFrame["ops"]): boolean {
  const clone = structuredClone(state);
  try { chargeCost(ctx, game, clone, [], frame.master, payment, frame.card, costs); }
  catch (err) { if (err instanceof IllegalAction && !(err instanceof NotYet)) return false; throw err; }
  return canFinishAutomaticPrice(ctx, game, clone, { ...frame, ops, ip: 0, awaiting: undefined });
}
