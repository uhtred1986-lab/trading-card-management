/** R495: private ownership of effects actually applied by one execution.
* Provenance only; the movement adapter chooses and applies effect cleanup.
*/
import type { ContinuousEffect } from "../types";
import type { ScriptFrame } from "./script";
import type { VmState } from "./state";
import { findCard } from "./zones";
import { NotYet } from "./errors";
export interface Occurrence {
  card: string;
  cardId: string;
  epoch: number;
  hiddenCount: number;
  holder: string;
  area: string;
}
export interface Root {
  kind: 'activate' | 'auto' | 'counter' | 'delayed' | 'invoke' | 'tax' | 'hook' | 'replacement' | 'keyword' | 'permanent';
  master: string;
  source: Occurrence;
  skillIndex: number | null;
}
export interface OwnerTag {
  version: 1;
  anchor: number;
  effect: number;
  root: Root;
  application: Occurrence;
  current: Occurrence | null;
}
export type AppliedEffect = ContinuousEffect;
export interface Receipt {
  version: 1;
  root: Root;
  anchor: number | null;
  entries: {
    effect: number;
    target: Occurrence;
  }[];
}
export interface Board {
  effects: AppliedEffect[];
  ownership: Record<number, OwnerTag>;
}
export interface MovePlan {
  version: 1;
  root: Root;
  anchor: number | null;
  from: Occurrence;
  effects: number[];
}
export type Retention = 'area' | 'sameSkill' | 'reset';
const destinations = new Set(['leader', 'battle', 'unison', 'combo']);
const same = (a: Occurrence, b: Occurrence) => a.card === b.card && a.cardId === b.cardId && a.epoch === b.epoch && a.hiddenCount === b.hiddenCount && a.holder === b.holder && a.area === b.area;
const sameRoot = (a: Root, b: Root) => a.kind === b.kind && a.master === b.master && a.skillIndex === b.skillIndex && same(a.source, b.source);
const fail = (): never => {
  throw new NotYet('rebuild same-skill applied-effect receipt', 'R495');
};
const natural = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const occurrence = (x: Occurrence): boolean => !!x && typeof x.card === 'string' && !!x.card && typeof x.cardId === 'string' && !!x.cardId && natural(x.epoch) && natural(x.hiddenCount) && (x.holder === 'p1' || x.holder === 'p2') && typeof x.area === 'string' && !!x.area;
const validRoot = (x: Root): boolean => !!x && ['activate', 'auto', 'counter', 'delayed', 'invoke', 'tax', 'hook', 'replacement', 'keyword', 'permanent'].includes(x.kind) && (x.master === 'p1' || x.master === 'p2') && occurrence(x.source) && (x.skillIndex === null || natural(x.skillIndex));
export function beginRoot(root: Root): Receipt {
  if (!validRoot(root))
    fail();
  return { version: 1, root: structuredClone(root), anchor: null, entries: [] };
}
export function areaCarries(from: string, to: string, sameHolder = true): boolean {
  return from === to && sameHolder || ['battle', 'unison'].includes(from) && ['battle', 'unison', 'combo'].includes(to) || from === 'combo' && to === 'battle';
}
function validTag(effect: AppliedEffect, board: Board): boolean {
  const tag = board.ownership[effect.id];
  return !!tag && tag.version === 1 && natural(tag.anchor) && tag.effect === effect.id && effect.id >= tag.anchor && validRoot(tag.root) && occurrence(tag.application)
    && (tag.current === null || occurrence(tag.current) && tag.current.card === effect.target && tag.current.card === tag.application.card && tag.current.cardId === tag.application.cardId && tag.current.epoch >= tag.application.epoch && tag.current.hiddenCount >= tag.application.hiddenCount);
}
export function validate(receipt: Receipt, board: Board, expectedRoot: Root): void {
  if (!board || !board.ownership || typeof board.ownership !== 'object' || Array.isArray(board.ownership) || !Array.isArray(board.effects) || board.effects.some(e => !e || !natural(e.id) || typeof e.target !== 'string') || !validRoot(expectedRoot) || !receipt || receipt.version !== 1 || !validRoot(receipt.root) || !sameRoot(receipt.root, expectedRoot) || !Array.isArray(receipt.entries) || receipt.anchor !== null && !natural(receipt.anchor) || receipt.anchor === null && receipt.entries.length)
    fail();
  const ids = new Set<number>();
  for (const entry of receipt.entries) {
    if (!entry || !natural(entry.effect) || !occurrence(entry.target) || ids.has(entry.effect) || receipt.anchor === null || entry.effect < receipt.anchor)
      fail();
    ids.add(entry.effect);
    const live = board.effects.filter(e => e.id === entry.effect);
    if (live.length > 1)
      fail();
    if (live.length && (!validTag(live[0], board) || board.ownership[live[0].id].anchor !== receipt.anchor || !sameRoot(board.ownership[live[0].id].root, receipt.root) || !same(board.ownership[live[0].id].application, entry.target)))
      fail();
    // Mutable kind/value/source/master are deliberately not immutable identity.
  }
}
/** Call INSIDE the standing mutation around the actual production addEffect.
* The adapter supplies its independently bound executing root and occurrence. */
export function applyOwned(receipt: Receipt, board: Board, root: Root, target: Occurrence, apply: () => AppliedEffect | undefined): AppliedEffect | undefined {
  validate(receipt, board, root);
  if (!occurrence(target))
    fail();
  const prior = new Set(board.effects.map(e => e.id)), made = apply();
  if (!made)
    return;
  if (!natural(made.id) || prior.has(made.id) || !board.effects.includes(made) || board.effects.filter(e => e.id === made.id).length !== 1 || made.target !== target.card || board.ownership[made.id])
    fail();
  receipt.anchor ??= made.id;
  board.ownership[made.id] = { version: 1, anchor: receipt.anchor, effect: made.id, root: structuredClone(root), application: structuredClone(target), current: structuredClone(target) };
  receipt.entries.push({ effect: made.id, target: structuredClone(target) });
  return made;
}
/** Replacement/choice questions finish BEFORE this synchronous pre-move plan. */
export function captureForMove(receipt: Receipt, board: Board, root: Root, from: Occurrence): MovePlan {
  validate(receipt, board, root);
  if (!occurrence(from))
    fail();
  const effects: number[] = [];
  for (const entry of receipt.entries) {
    const live = board.effects.find(e => e.id === entry.effect);
    if (!live || !board.ownership[live.id]?.current || live.target !== from.card)
      continue;
    if (!same(board.ownership[live.id].current!, from))
      fail();
    effects.push(entry.effect);
  }
  return { version: 1, root: structuredClone(root), anchor: receipt.anchor, from: structuredClone(from), effects };
}
/** Before cleanup, obtain SAME-SKILL eligible ids only. Area carry keeps other
* executions' effects too, but never adopts their provenance into this receipt. */
export function eligible(plan: MovePlan, to: Occurrence, retention: Retention): number[] {
  if (!plan || plan.version !== 1 || plan.anchor !== null && !natural(plan.anchor) || !validRoot(plan.root) || !occurrence(plan.from) || !occurrence(to) || plan.from.card !== to.card || plan.from.cardId !== to.cardId || !Array.isArray(plan.effects) || plan.effects.some(id => !natural(id)) || new Set(plan.effects).size !== plan.effects.length)
    fail();
  if (!['area', 'sameSkill', 'reset'].includes(retention))
    fail();
  if (retention === 'area' && !areaCarries(plan.from.area, to.area, plan.from.holder === to.holder) || retention === 'sameSkill' && (!destinations.has(to.area) || areaCarries(plan.from.area, to.area, plan.from.holder === to.holder)))
    fail();
  return retention === 'reset' ? [] : [...plan.effects];
}
/** AFTER real movement+cleanup, only live effects actually retained are rebound.
* `moved` means an actual successful move, NOT requested-destination completion.
* Native adapter supplies independently observed from/to and selected policy.
* A rule-specific reset may override ordinary area carry, explicitly.
*/
export function settleMove(receipt: Receipt, board: Board, root: Root, plan: MovePlan, result: {
  moved: boolean;
  from: Occurrence;
  to: Occurrence;
  retention: Retention;
}): number[] {
  validate(receipt, board, root);
  if (!result || !plan || plan.version !== 1 || !validRoot(plan.root) || !sameRoot(plan.root, root) || plan.anchor !== receipt.anchor || !occurrence(plan.from) || !occurrence(result.from) || !occurrence(result.to) || typeof result.moved !== 'boolean' || !same(plan.from, result.from))
    fail();
  const allowed = eligible(plan, result.to, result.retention);
  if (plan.effects.some(id => !receipt.entries.some(e => e.effect === id)))
    fail();
  // Validate ALL tagged effects participating in the transition, including parked parents.
  const crossing = board.effects.filter(e => e.target === plan.from.card && board.ownership[e.id]?.current !== null && board.ownership[e.id] !== undefined);
  for (const e of crossing)
    if (!validTag(e, board) || !same(board.ownership[e.id].current!, plan.from))
      fail();
  if (!result.moved) {
    if (!same(result.from, result.to))
      fail();
    return [];
  }
  if (same(result.from, result.to))
    return [];
  const retained: number[] = [];
  for (const e of crossing) {
    const own = board.ownership[e.id].anchor === receipt.anchor && sameRoot(board.ownership[e.id].root, root) && allowed.includes(e.id);
    const keep = result.retention === 'area' || result.retention === 'sameSkill' && own;
    board.ownership[e.id].current = keep ? structuredClone(result.to) : null;
    if (keep && own)
      retained.push(e.id);
  }
  // Immutable applications stay in their owning receipt; deleted/retired effects
  // are inert. Only the live tag's current occurrence advances across movement.
  return retained;
}
/** An unreviewed retarget keeps its value but cannot invent a new carry identity. */
export function retireForRetarget(board: Board, effect: AppliedEffect): void {
  if (board.ownership[effect.id]) {
    if (!validTag(effect, board))
      fail();
    board.ownership[effect.id].current = null;
  }
}
/** Source capture is a fact at root construction, not a demand that an activated
* parent remain in that area. Under/removed sources keep their exact absence. */
export function effectOccurrence(state: VmState, card: string): Occurrence {
  const inst = state.cards[card];
  if (!inst)
    fail();
  const at = findCard(state, card);
  return { card, cardId: inst.cardId, epoch: inst.zoneEpoch ?? 0, hiddenCount: inst.hiddenCount ?? 0, holder: at?.owner ?? inst.owner, area: at?.zone ?? "underOrRemoved" };
}
function boardOf(state: VmState): Board {
  return { get effects() {
      return state.effects;
    }, ownership: state.appliedEffectOwnership ?? {} };
}
function paymentFrame(frame: ScriptFrame): boolean {
  return !!(frame.saveVarsAs || frame.autoCost || frame.counterCost || frame.keywordCost || frame.aegisCost || frame.reviveCost || frame.dropCost || frame.swapCost || frame.fieldCost || frame.counterSelfTax || frame.overRealmLateTax);
}
export function freshAppliedEffectRoot<T extends ScriptFrame>(state: VmState, frame: T, kind: Root['kind']): T {
  const root: Root = { kind, master: frame.master, source: effectOccurrence(state, frame.card), skillIndex: frame.skillIndex ?? null };
  frame.appliedEffects = beginRoot(root);
  frame.appliedPaymentEffects = beginRoot({ ...root, kind: 'tax' });
  return frame;
}
export function executionReceipt(state: VmState, frame: ScriptFrame | undefined): Receipt | undefined {
  if (!frame)
    return;
  const required = frame.skillEffectOrigin !== undefined || frame.appliedEffects !== undefined || frame.appliedPaymentEffects !== undefined;
  if (!required)
    return; // Direct unowned native helpers do not inherit a parked root.
  const receipt = paymentFrame(frame) ? frame.appliedPaymentEffects : frame.appliedEffects;
  if (!receipt || !validRoot(receipt.root))
    return fail();
  if (receipt.root.source.card !== frame.card || receipt.root.master !== frame.master || receipt.root.skillIndex !== (frame.skillIndex ?? null))
    fail();
  if (paymentFrame(frame) && receipt.root.kind !== 'tax')
    fail();
  if (!paymentFrame(frame) && frame.skillEffectOrigin && receipt.root.kind !== frame.skillEffectOrigin.kind)
    fail();
  validate(receipt, boardOf(state), receipt.root);
  return receipt;
}
/** Use inside the producer's standing mutation, before settlement. */
export function recordAppliedEffect(state: VmState, frame: ScriptFrame | undefined, target: string, produce: () => ContinuousEffect | undefined): ContinuousEffect | undefined {
  const receipt = executionReceipt(state, frame);
  if (!receipt || !target || !state.cards[target])
    return produce();
  state.appliedEffectOwnership ??= {};
  const board = boardOf(state);
  return applyOwned(receipt, board, receipt.root, effectOccurrence(state, target), produce);
}
export interface NativeEffectMove {
  from: Occurrence;
  plan?: MovePlan;
  receipt?: Receipt;
}
export function captureAppliedEffectMove(state: VmState, card: string, receipt?: Receipt): NativeEffectMove {
  const from = effectOccurrence(state, card);
  return { from, ...(receipt ? { receipt, plan: captureForMove(receipt, boardOf(state), receipt.root, from) } : {}) };
}
/** Settle metadata after actual cleanup; this function does not choose which
 * effects survive. Only live retained effects acquire the new occurrence. */
export function settleAppliedEffectMove(state: VmState, move: NativeEffectMove): void {
  const to = effectOccurrence(state, move.from.card), board = boardOf(state), area = areaCarries(move.from.area, to.area, move.from.holder === to.holder);
  if (move.receipt && move.plan) {
    // Preserve provenance, including payment provenance, only for surviving
    // effects. Entitlement and pre-mutation payment refusal belong to the mover.
    const sameSkill = destinations.has(to.area);
    settleMove(move.receipt, board, move.receipt.root, move.plan, { moved: true, from: move.from, to, retention: area ? 'area' : sameSkill ? 'sameSkill' : 'reset' });
  }
  else {
    if (same(move.from, to))
      return;
    for (const effect of state.effects) {
      const tag = board.ownership[effect.id];
      if (!tag || tag.current === null || effect.target !== move.from.card)
        continue;
      if (!validTag(effect, board) || !same(tag.current, move.from))
        fail();
      tag.current = area ? structuredClone(to) : null;
    }
  }
  for (const id of Object.keys(board.ownership))
    if (!state.effects.some(e => e.id === Number(id)))
      delete board.ownership[Number(id)];
}
export function retireAppliedEffectRetarget(state: VmState, effect: ContinuousEffect): void {
  retireForRetarget(boardOf(state), effect);
}
/** Strict action-price hosts execute a separate payment receipt even when their
* proof cursor strips autoCost. The body receipt stays parked and untouched. */
export function paymentEffectFrame(frame: ScriptFrame | undefined): ScriptFrame | undefined {
  if (!frame)
    return;
  if (!frame.appliedPaymentEffects) {
    if (frame.skillEffectOrigin || frame.appliedEffects)
      return fail();
    return frame;
  }
  return { ...frame, skillEffectOrigin: undefined, appliedEffects: frame.appliedPaymentEffects };
}
