/** Pure helpers for `scripts/arena-selector-hosts.mts` (#1123), kept apart so they are testable without a database. */

/** Does this stored program (any depth) move a card under a host named by a selector instead of a chosen card? */
export function hasSelectorHost(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(hasSelectorHost);
  if (!node || typeof node !== "object") return false;
  const o = node as Record<string, unknown>;
  if (o.op === "moveTo" && o.to === "under" && o.under && typeof o.under === "object" && "sel" in (o.under as object)) return true;
  return Object.values(o).some(hasSelectorHost);
}

/** `CARD#SKILL` for the front, `CARD#SKILLb` for the back: the spelling `arena:refresh-ids` reads. */
export const ruleIdOf = (r: { cardId: string; side: string; skillIndex: number }) => `${r.cardId}#${r.skillIndex}${r.side === "back" ? "b" : ""}`;
