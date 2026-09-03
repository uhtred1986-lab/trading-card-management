/**
 * One database row per physical card.
 *
 * `owned_cards` has no quantity column: saying "quantity 2" on an add screen
 * writes two rows. Each row is one card you can pick up, so it can carry its
 * own finish, condition and price, and can be pointed at a particular deck
 * later without anything having to be split first.
 */

/** Nobody sleeves 100 copies of one card in one go; a typo shouldn't create 5000 rows. */
export const MAX_COPIES = 99;

export function copiesOf(quantity: number | string | null | undefined): number {
  const n = typeof quantity === "string" ? parseInt(quantity, 10) : Number(quantity);
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_COPIES, Math.max(1, Math.floor(n)));
}

/** `expand(row, 3)` → three separate rows to insert. */
export function expand<T extends object>(row: T, quantity: number | string | null | undefined): T[] {
  return Array.from({ length: copiesOf(quantity) }, () => ({ ...row }));
}
