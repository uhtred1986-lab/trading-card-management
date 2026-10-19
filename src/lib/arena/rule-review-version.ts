/** Exact review identity, including non-versioned edits and verdict changes. Browser safe. */
export function reviewVersion(row: Record<string, unknown>): string {
  const fields = ["id", "cardId", "side", "skillIndex", "printed", "kind", "trigger", "combo", "cost", "cond", "ops", "unread", "status", "source", "version", "explanation", "updatedAt"];
  return JSON.stringify(fields.map((key) => row[key] instanceof Date ? (row[key] as Date).toISOString() : row[key] ?? null));
}
