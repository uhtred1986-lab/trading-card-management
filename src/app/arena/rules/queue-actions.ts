"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { currentScope, isArenaAdmin, requireSl } from "@/lib/auth";
import { expireRulesHealth } from "@/lib/cache/rules-health";
import { rebuildPlanFor, rebuildScope, type RebuildPlan } from "@/lib/arena/queue-cards";
import type { Scope } from "@/lib/arena/queue";

const ADMINS_ONLY = "Only an arena admin can rebuild rules.";

function scopeOf(v: unknown): Scope {
  const s = v as Partial<Scope & { id: number }> | null;
  if (s?.kind === "catalog") return { kind: "catalog" };
  if ((s?.kind === "deck" || s?.kind === "game") && Number.isInteger(s.id) && (s.id as number) > 0) return { kind: s.kind, id: s.id as number };
  return { kind: "decks" };
}

/** What a rebuild would touch in this scope. Reads only: nothing is written. */
export async function rebuildDryRunAction(scope: Scope): Promise<{ error: string | null; plan?: RebuildPlan }> {
  await requireSl();
  if (!(await isArenaAdmin())) return { error: ADMINS_ONLY };
  return { error: null, plan: await rebuildPlanFor(db, scopeOf(scope), await currentScope()) };
}

/**
 * Re-run the compiler for the cards of this scope whose payment record predates #1066. Only rows
 * the compiler owns are rewritten (`draftCards`); approved and corrected rows are listed, never
 * touched. `card_rules` is in no cache tag (`src/lib/cache/tags.ts`: catalog, prices, meta), so
 * only the page is revalidated, plus the `rules-health` cache of the classified catalog.
 */
export async function rebuildCardsAction(scope: Scope): Promise<{ error: string | null; rebuilt?: number; remaining?: number; updated?: number; inserted?: number; protectedRows?: number }> {
  await requireSl();
  if (!(await isArenaAdmin())) return { error: ADMINS_ONLY };
  try {
    const r = await rebuildScope(db, scopeOf(scope), await currentScope());
    expireRulesHealth();
    revalidatePath("/arena/rules");
    return { error: null, rebuilt: r.rebuilt, remaining: r.remaining, updated: r.updated, inserted: r.inserted, protectedRows: r.plan.protectedRows };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "The rebuild failed." };
  }
}
