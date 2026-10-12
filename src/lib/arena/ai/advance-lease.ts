import { and, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Db } from "@/db";
import { arenaAdvanceCalls } from "@/db/schema";
import type { Action } from "../types";
import type { Op } from "../vm/script";

export type AdvanceCheckpoint =
  | { kind: "move"; index: number; action: Action; say: string | null; how: string; spend: { model: string; provider?: string; billed?: boolean; input: number; output: number; cached: number; cacheWrite?: number; costMicros?: number } | null }
  | { kind: "referee"; ops: Op[]; why: string; valid: boolean; spend: { model: string; provider?: string; billed?: boolean; input: number; output: number; cached: number; cacheWrite?: number; costMicros?: number } | null };

export type AdvanceClaim =
  | { kind: "claimed"; gameId: number; revision: number; callId: string; owner: string; checkpoint: AdvanceCheckpoint | null }
  | { kind: "busy" }
  | { kind: "applied" }
  | { kind: "attention" };

const LEASE_MS = 90_000;

/**
 * Claim one game revision. Expired pre-call claims are safe to resume. An
 * expired provider attempt is only resumable when its ai_runs result was
 * durably recorded; otherwise it is marked attention and is never recalled.
 */
export async function claimAdvance(
  db: Db,
  gameId: number,
  revision: number,
  hasRecordedResult: (callId: string) => Promise<boolean>,
  now = new Date(),
): Promise<AdvanceClaim> {
  const owner = randomUUID();
  const expires = new Date(now.getTime() + LEASE_MS);
  const inserted = await db.insert(arenaAdvanceCalls).values({
      gameId,
      revision,
      callId: randomUUID(),
      phase: "claimed",
      owner,
      leaseUntil: expires,
    }).onConflictDoNothing().returning({ callId: arenaAdvanceCalls.callId });
  if (inserted.length) return { kind: "claimed", gameId, revision, callId: inserted[0].callId, owner, checkpoint: null };

  const [row] = await db.select().from(arenaAdvanceCalls)
    .where(and(eq(arenaAdvanceCalls.gameId, gameId), eq(arenaAdvanceCalls.revision, revision))).limit(1);
  if (!row) throw new Error("Could not load the Arena advance lease.");
  if (row.phase === "applied") return { kind: "applied" };
  const recorded = row.phase === "attempting" || row.phase === "attention"
    ? await hasRecordedResult(row.callId)
    : false;
  if (row.phase === "attempting" && !recorded) {
    if (row.leaseUntil && row.leaseUntil > now) return { kind: "busy" };
    await db.update(arenaAdvanceCalls).set({ phase: "attention", owner: null, leaseUntil: null, updatedAt: now })
      .where(and(eq(arenaAdvanceCalls.gameId, gameId), eq(arenaAdvanceCalls.revision, revision), eq(arenaAdvanceCalls.phase, "attempting"), lte(arenaAdvanceCalls.leaseUntil, now)));
    return { kind: "attention" };
  }
  if (row.phase === "attention" && !recorded) return { kind: "attention" };
  if (row.owner && row.leaseUntil && row.leaseUntil > now) return { kind: "busy" };
  const phase = row.checkpoint || recorded ? "checkpoint" : "claimed";
  const claimed = await db.update(arenaAdvanceCalls).set({ phase, owner, leaseUntil: expires, updatedAt: now })
    .where(and(
      eq(arenaAdvanceCalls.gameId, gameId),
      eq(arenaAdvanceCalls.revision, revision),
      eq(arenaAdvanceCalls.callId, row.callId),
      // Fence the read/claim gap. In particular, a claimant that selected an
      // expired checkpoint must not resurrect it after another worker marked
      // the same row applied.
      eq(arenaAdvanceCalls.phase, row.phase),
      row.owner === null ? isNull(arenaAdvanceCalls.owner) : eq(arenaAdvanceCalls.owner, row.owner),
      row.leaseUntil === null ? isNull(arenaAdvanceCalls.leaseUntil) : eq(arenaAdvanceCalls.leaseUntil, row.leaseUntil),
      or(isNull(arenaAdvanceCalls.leaseUntil), lte(arenaAdvanceCalls.leaseUntil, now)),
    ))
    .returning({ callId: arenaAdvanceCalls.callId, checkpoint: arenaAdvanceCalls.checkpoint });
  if (!claimed.length) {
    const [current] = await db.select({ phase: arenaAdvanceCalls.phase }).from(arenaAdvanceCalls)
      .where(and(eq(arenaAdvanceCalls.gameId, gameId), eq(arenaAdvanceCalls.revision, revision))).limit(1);
    if (current?.phase === "applied") return { kind: "applied" };
    return { kind: "busy" };
  }
  return { kind: "claimed", gameId, revision, callId: claimed[0].callId, owner, checkpoint: claimed[0].checkpoint as AdvanceCheckpoint | null };
}

/** Durable fence immediately before a provider request leaves the process. */
export async function markProviderAttempt(db: Db, claim: Extract<AdvanceClaim, { kind: "claimed" }>): Promise<void> {
  const now = new Date();
  const updated = await db.update(arenaAdvanceCalls)
    .set({ phase: "attempting", leaseUntil: new Date(now.getTime() + LEASE_MS), updatedAt: now })
    .where(and(
      eq(arenaAdvanceCalls.gameId, claim.gameId),
      eq(arenaAdvanceCalls.revision, claim.revision),
      eq(arenaAdvanceCalls.callId, claim.callId),
      eq(arenaAdvanceCalls.owner, claim.owner),
      eq(arenaAdvanceCalls.phase, "claimed"),
    ))
    .returning({ callId: arenaAdvanceCalls.callId });
  if (!updated.length) throw new Error("The Arena advance lease was lost before the provider request.");
}

/** Save the model/rules choice before accounting or applying it to the game. */
export async function saveAdvanceCheckpoint(
  db: Db,
  claim: Extract<AdvanceClaim, { kind: "claimed" }>,
  checkpoint: AdvanceCheckpoint,
): Promise<void> {
  const result = await db.update(arenaAdvanceCalls)
    .set({ phase: "checkpoint", checkpoint, updatedAt: new Date() })
    .where(and(
      eq(arenaAdvanceCalls.gameId, claim.gameId),
      eq(arenaAdvanceCalls.revision, claim.revision),
      eq(arenaAdvanceCalls.callId, claim.callId),
      eq(arenaAdvanceCalls.owner, claim.owner),
      // Free rule choices checkpoint from claimed; model choices checkpoint
      // from attempting.
      inArray(arenaAdvanceCalls.phase, ["claimed", "attempting", "checkpoint"]),
    ))
    .returning({ callId: arenaAdvanceCalls.callId });
  // On a very slow call another request may have marked it attention after its
  // lease elapsed. The now-durable result is still safe to checkpoint; it is
  // the sole result attached to this stable call identity.
  if (!result.length) {
    const lateResult = await db.update(arenaAdvanceCalls)
      .set({ phase: "checkpoint", checkpoint, owner: claim.owner, leaseUntil: new Date(Date.now() + LEASE_MS), updatedAt: new Date() })
      .where(and(
        eq(arenaAdvanceCalls.gameId, claim.gameId),
        eq(arenaAdvanceCalls.revision, claim.revision),
        eq(arenaAdvanceCalls.callId, claim.callId),
        eq(arenaAdvanceCalls.phase, "attention"),
        isNull(arenaAdvanceCalls.owner),
      ))
      .returning({ callId: arenaAdvanceCalls.callId });
    if (!lateResult.length) throw new Error("The Arena advance lease was lost before its result could be checkpointed.");
  }
}

export async function finishAdvance(db: Db, claim: Extract<AdvanceClaim, { kind: "claimed" }>): Promise<void> {
  await db.update(arenaAdvanceCalls)
    .set({ phase: "applied", owner: null, leaseUntil: null, updatedAt: new Date() })
    .where(and(eq(arenaAdvanceCalls.gameId, claim.gameId), eq(arenaAdvanceCalls.revision, claim.revision), eq(arenaAdvanceCalls.callId, claim.callId), eq(arenaAdvanceCalls.owner, claim.owner)));
}

export async function failAdvance(db: Db, claim: Extract<AdvanceClaim, { kind: "claimed" }>, attempted: boolean): Promise<void> {
  const now = new Date();
  await db.update(arenaAdvanceCalls)
    .set({
      phase: attempted ? "attention" : "claimed",
      owner: null,
      leaseUntil: attempted ? null : now,
      updatedAt: now,
    })
    .where(and(
      eq(arenaAdvanceCalls.gameId, claim.gameId),
      eq(arenaAdvanceCalls.revision, claim.revision),
      eq(arenaAdvanceCalls.callId, claim.callId),
      eq(arenaAdvanceCalls.owner, claim.owner),
      or(eq(arenaAdvanceCalls.phase, "claimed"), eq(arenaAdvanceCalls.phase, "attempting"), eq(arenaAdvanceCalls.phase, "checkpoint")),
    ));
}
