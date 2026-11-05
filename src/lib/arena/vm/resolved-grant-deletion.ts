import type { ContinuousEffect } from "../types";
import type { VmState } from "./state";
import { NotYet } from "./errors";

/** RM9-1-2-2-1: a resolved grant is not restored when its negation expires.
 * This ledger deliberately excludes continuously supplied Permanent grants.
 */
export interface ResolvedGrantDeletion {
  version: 1;
  card: string;
  epoch: number;
  grant: number;
  kind: "keyword" | "copiedSkills";
  deleted: boolean;
  /** Original indices within the copied effect, not printed target indices. */
  skills?: number[];
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
      || !Number.isSafeInteger(receipt.grant) || receipt.grant < 0
      || typeof receipt.deleted !== "boolean") return fail();
    if (receipt.kind === "copiedSkills") {
      if (!Array.isArray(receipt.skills) || receipt.skills.some(index => !Number.isSafeInteger(index) || index < 0)
        || new Set(receipt.skills).size !== receipt.skills.length) return fail();
    } else if (receipt.kind !== "keyword" || receipt.skills !== undefined) return fail();
    const key = JSON.stringify([receipt.card, receipt.epoch, receipt.grant]);
    if (seen.has(key)) return fail();
    seen.add(key);
  }
  return receipts;
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
  const grants = changed.kind === "negateSkills"
    ? state.effects.filter(effect => effect.target === card && (effect.kind === "keyword" || effect.kind === "copiedSkills"))
    : [changed];
  for (const grant of grants) {
    if (grant.kind !== "keyword" && grant.kind !== "copiedSkills") continue;
    const receipts = state.resolvedGrantDeletions ??= [];
    const existing = receipts.find(receipt => receipt.card === card && receipt.epoch === epoch && receipt.grant === grant.id);
    if (existing) { existing.deleted ||= deleted; continue; }
    receipts.push({ version: 1, card, epoch, grant: grant.id, kind: grant.kind, deleted,
      ...(grant.kind === "copiedSkills" ? { skills: [...(grant.copied?.skills ?? [])] } : {}) });
  }
}

/** Pure identity query. A new grant or new physical occurrence is independent. */
export function resolvedGrantDeleted(state: VmState, card: string, grant: number, skill?: number): boolean {
  const epoch = state.cards[card]?.zoneEpoch;
  if (epoch === undefined) return false;
  const receipt = receiptsOf(state).find(value => value.card === card && value.epoch === epoch && value.grant === grant);
  if (!receipt || receipt.version !== 1 || typeof receipt.deleted !== "boolean") {
    throw new NotYet("rebuild resolved skill-grant deletion history", "R475");
  }
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
