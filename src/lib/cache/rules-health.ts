/**
 * The classified cards of the whole catalog (`loadQueueCards(db)`), cached for the Rules queue:
 * classifying ~6,250 cards costs 8 s, filtering them in memory costs nothing. Deck and game
 * scopes are small and stay uncached.
 *
 * Tag `rules-health`, 300 s: the backstop for writers that cannot expire it. Writers of
 * `card_rules` (rebuild, and ideally saveRule, confirm*, flagWrong, draftCards' callers) call
 * `expireRulesHealth()` from a server action. Not one of `CACHE_TAGS` (tags.ts): those are
 * tables that only a sync writes; this one follows a table people edit.
 */
import { revalidateTag, unstable_cache, updateTag } from "next/cache";
import { db } from "@/db";
import { loadQueueCards, type QueueCard } from "@/lib/arena/rules-store";

export const RULES_HEALTH_TAG = "rules-health";

export const catalogQueueCards: () => Promise<QueueCard[]> = unstable_cache(() => loadQueueCards(db), ["rules-health", "catalog-queue-cards"], {
  tags: [RULES_HEALTH_TAG],
  revalidate: 300,
});

/** From a server action: the next render reads fresh rows. */
export function expireRulesHealth(): void {
  updateTag(RULES_HEALTH_TAG);
}

/** From a route handler. */
export function expireRulesHealthFromRoute(): void {
  revalidateTag(RULES_HEALTH_TAG, { expire: 0 });
}
