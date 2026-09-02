/**
 * `db.execute()` returns a bare array on postgres.js but `{ rows }` on PGlite
 * (which `npm test` uses). Every raw-SQL read goes through this so the same
 * library code runs under both.
 */
export function rows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const r = result as { rows?: T[] } | null;
  return Array.isArray(r?.rows) ? r.rows : [];
}
