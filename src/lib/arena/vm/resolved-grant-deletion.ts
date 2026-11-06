import type { ContinuousEffect, CopiedSkills } from "../types";
import type { VmState } from "./state";
import { canonicalTaxValue } from "./tax-receipt";
import { NotYet } from "./errors";

/** RM9-1-2-2-1: a resolved grant is not restored when its negation expires.
 * This ledger deliberately excludes continuously supplied Permanent grants.
 */
export interface ResolvedGrantDeletion {
  version: 1;
  card: string;
  epoch: number;
  hiddenCount: number;
  grant: number;
  kind: "keyword" | "copiedSkills";
  deleted: boolean;
  /** Earlier actual retained occurrences of this same grant; never fresh grants. */
  retainedOccurrences?: { epoch: number; hiddenCount: number }[];
  /** Original indices within the copied effect, not printed target indices. */
  skills?: number[];
  copied?: CopiedSkills;
}

function receiptsOf(state: VmState): ResolvedGrantDeletion[] {
  const receipts = state.resolvedGrantDeletions;
  if (receipts === undefined) return [];
  const fail = (): never => { throw new NotYet("rebuild resolved skill-grant deletion history", "R475"); };
  if (!Array.isArray(receipts)) return fail();
  const seen = new Set<string>();
  for (const receipt of receipts) {
    if (!receipt || receipt.version !== 1 || typeof receipt.card !== "string"
      || !Number.isSafeInteger(receipt.epoch) || receipt.epoch < 0
      || !Number.isSafeInteger(receipt.hiddenCount) || receipt.hiddenCount < 0
      || !Number.isSafeInteger(receipt.grant) || receipt.grant < 0
      || typeof receipt.deleted !== "boolean") return fail();
    if (receipt.kind === "copiedSkills") {
      if (!Array.isArray(receipt.skills) || receipt.skills.some(index => !Number.isSafeInteger(index) || index < 0)
        || new Set(receipt.skills).size !== receipt.skills.length || !receipt.copied || typeof receipt.copied.cardId !== "string" || !["front", "back"].includes(receipt.copied.side) || !Array.isArray(receipt.copied.skills) || JSON.stringify(receipt.copied.skills) !== JSON.stringify(receipt.skills) || (receipt.copied.quoted !== undefined && typeof receipt.copied.quoted !== "boolean") || (receipt.copied.from !== undefined && typeof receipt.copied.from !== "string") || (receipt.copied.name !== undefined && typeof receipt.copied.name !== "string")) return fail();
    } else if (receipt.kind !== "keyword" || receipt.skills !== undefined || receipt.copied !== undefined) return fail();
    if (receipt.retainedOccurrences !== undefined) {
      if (!Array.isArray(receipt.retainedOccurrences)) return fail();
      let previous = -1;
      for (const at of receipt.retainedOccurrences) {
        if (!at || !Number.isSafeInteger(at.epoch) || at.epoch < 0 || at.epoch <= previous
          || at.epoch >= receipt.epoch || at.hiddenCount !== receipt.hiddenCount) return fail();
        previous = at.epoch;
      }
    }
    const key = JSON.stringify([receipt.card, receipt.grant]);
    if (seen.has(key)) return fail();
    seen.add(key);
  }
  return receipts;
}

/** Validate before the writer mutates effects/IDs. A new grant must not bless
 * an older live grant whose deleted-text history is unknowable. */
export function prepareResolvedGrantChange(state: VmState, changed: Pick<ContinuousEffect, "kind" | "target">): void {
  if (changed.kind !== "negateSkills" && changed.kind !== "keyword" && changed.kind !== "copiedSkills") return;
  receiptsOf(state);
  requireResolvedGrantHistory(state, changed.target);
}

/** Mutation-only capture; projections must never create deletion receipts. */
export function captureResolvedGrantDeletions(state: VmState, changed: ContinuousEffect): void {
  if (changed.kind !== "negateSkills" && changed.kind !== "keyword" && changed.kind !== "copiedSkills") return;
  receiptsOf(state);
  const card = changed.target;
  if (!state.cards[card]) return;
  if (changed.kind === "negateSkills") requireResolvedGrantHistory(state, card);
  const deleted = state.effects.some(effect => effect.kind === "negateSkills" && effect.target === card);
  const epoch = state.cards[card].zoneEpoch ?? 0;
  const hiddenCount = state.cards[card].hiddenCount ?? 0;
  const grants = changed.kind === "negateSkills"
    ? state.effects.filter(effect => effect.target === card && (effect.kind === "keyword" || effect.kind === "copiedSkills"))
    : [changed];
  for (const grant of grants) {
    if (grant.kind !== "keyword" && grant.kind !== "copiedSkills") continue;
    const receipts = state.resolvedGrantDeletions ??= [];
    const existing = receipts.find(receipt => receipt.card === card && receipt.epoch === epoch && receipt.hiddenCount === hiddenCount && receipt.grant === grant.id);
    if (existing) { existing.deleted ||= deleted; continue; }
    receipts.push({ version: 1, card, epoch, hiddenCount, grant: grant.id, kind: grant.kind, deleted,
      ...(grant.kind === "copiedSkills" ? { skills: [...(grant.copied?.skills ?? [])], copied: structuredClone(grant.copied!) } : {}) });
  }
}

/** Pure identity query. A new grant or new physical occurrence is independent. */
export function resolvedGrantDeleted(state: VmState, card: string, grant: number, skill?: number): boolean {
  const inst = state.cards[card];
  if (!inst) return false;
  const epoch = inst.zoneEpoch ?? 0;
  const hiddenCount = inst.hiddenCount ?? 0;
  const receipt = receiptsOf(state).find(value => value.card === card && value.epoch === epoch && value.hiddenCount === hiddenCount && value.grant === grant);
  if (!receipt || receipt.version !== 1 || typeof receipt.deleted !== "boolean") {
    throw new NotYet("rebuild resolved skill-grant deletion history", "R475");
  }
  requireLiveGrantIdentity(state, receipt);
  return receipt.deleted && (skill === undefined || receipt.kind === "copiedSkills" && !!receipt.skills?.includes(skill));
}

/** Call before mutating a live legacy grant: expired negation is unrecoverable. */
export function requireResolvedGrantHistory(state: VmState, card: string): void {
  for (const effect of state.effects) {
    if (effect.target === card && (effect.kind === "keyword" || effect.kind === "copiedSkills")) {
      resolvedGrantDeleted(state, card, effect.id);
    }
  }
}

/** A caller can inspect an old observed occurrence without substituting the
 * card's current occurrence. Used only for captured pending/active programs. */
export function resolvedGrantReceipt(state: VmState, card: string, epoch: number, grant: number, hiddenCount: number): ResolvedGrantDeletion {
  const receipt = receiptsOf(state).find(value => value.card === card && value.grant === grant
    && (value.epoch === epoch && value.hiddenCount === hiddenCount
      || value.retainedOccurrences?.some(at => at.epoch === epoch && at.hiddenCount === hiddenCount)));
  if (!receipt) throw new NotYet("rebuild captured resolved skill-grant history", "R475");
  requireLiveGrantIdentity(state, receipt);
  return receipt;
}

function requireLiveGrantIdentity(state: VmState, receipt: ResolvedGrantDeletion): void {
  const effect = state.effects.find(effect => effect.id === receipt.grant && effect.target === receipt.card);
  if (effect && ((state.cards[receipt.card]?.hiddenCount ?? 0) !== receipt.hiddenCount || (state.cards[receipt.card]?.zoneEpoch ?? 0) !== receipt.epoch || effect.kind !== receipt.kind || (effect.kind === "copiedSkills" && canonicalTaxValue(effect.copied) !== canonicalTaxValue(receipt.copied)))) {
    throw new NotYet("rebuild mismatched resolved skill-grant history", "R475");
  }
}

/** Existing captured hooks retain the old occurrence. This is not a current
 * permission read, and never authorizes a fresh source occurrence. */
export function capturedResolvedGrant(state: VmState, card: string, grant: number): ResolvedGrantDeletion {
  const matches = receiptsOf(state).filter(receipt => receipt.card === card && receipt.grant === grant);
  if (matches.length !== 1) throw new NotYet("rebuild captured resolved skill-grant history", "R475");
  requireLiveGrantIdentity(state, matches[0]);
  return matches[0];
}

/** Capture before a primitive can advance the target's occurrence. */
export function captureRetainedGrantHistory(state: VmState, card: string): ResolvedGrantDeletion[] {
  requireResolvedGrantHistory(state, card);
  const inst = state.cards[card];
  if (!inst) return [];
  return state.effects.filter(effect => effect.target === card && (effect.kind === "keyword" || effect.kind === "copiedSkills"))
    .map(effect => structuredClone(resolvedGrantReceipt(state, card, inst.zoneEpoch ?? 0, effect.id, inst.hiddenCount ?? 0)));
}

/** Only the exact grants actually retained by the movement's effect policy
 * acquire a new current occurrence. The one deletion bit remains authoritative. */
export function carryRetainedGrantHistory(state: VmState, captured: readonly ResolvedGrantDeletion[]): void {
  const rows = receiptsOf(state);
  for (const before of captured) {
    const effect = state.effects.find(value => value.id === before.grant && value.target === before.card);
    if (!effect) continue;
    const row = rows.find(value => value.card === before.card && value.grant === before.grant);
    const card = state.cards[before.card];
    if (!row || !card || canonicalTaxValue(row) !== canonicalTaxValue(before)
      || effect.kind !== row.kind || effect.kind === "copiedSkills" && canonicalTaxValue(effect.copied) !== canonicalTaxValue(row.copied)
      || (card.hiddenCount ?? 0) !== row.hiddenCount || (card.zoneEpoch ?? 0) < row.epoch) {
      throw new NotYet("preserve the original retained grant occurrence", "R505");
    }
    const epoch = card.zoneEpoch ?? 0;
    if (epoch === row.epoch) continue;
    (row.retainedOccurrences ??= []).push({ epoch: row.epoch, hiddenCount: row.hiddenCount });
    row.epoch = epoch;
  }
}
