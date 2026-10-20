/**
 * Snapshot and field-by-field diff of `card_rules` rows (`npm run rules:snapshot`). READ-ONLY.
 * A rules review takes a snapshot before every `saveRule` and diffs after, so "only ops, reads, source,
 * version and explanation differ" is one command instead of a hand-written comparison.
 */
import { asc, inArray } from "drizzle-orm";
import type { Db } from "../../src/db/index.ts";
import { cardRules } from "../../src/db/schema.ts";

export type SnapshotRow = Record<string, unknown>;
export interface Snapshot {
  takenAt: string;
  cards: string[];
  rows: Record<string, SnapshotRow>;
}

export const rowKey = (r: { cardId: unknown; side: unknown; skillIndex: unknown }) => `${r.cardId}:${r.side}:${r.skillIndex}`;

/** JSON with Dates as ISO strings, so a snapshot compares equal after a round trip through a file. */
const plain = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

export async function takeSnapshot(db: Db, cardIds: string[], now = new Date()): Promise<Snapshot> {
  const ids = [...new Set(cardIds.map((c) => c.trim()).filter(Boolean))];
  const found = ids.length ? await db.select().from(cardRules).where(inArray(cardRules.cardId, ids)).orderBy(asc(cardRules.cardId), asc(cardRules.side), asc(cardRules.skillIndex)) : [];
  const rows: Record<string, SnapshotRow> = {};
  for (const r of found) rows[rowKey(r)] = plain(r) as SnapshotRow;
  return { takenAt: now.toISOString(), cards: ids, rows };
}

/** Key-order independent, so a jsonb column that comes back with its keys in another order is not a change. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}

export interface RowChange {
  key: string;
  fields: string[];
}
export interface SnapshotDiff {
  added: string[];
  removed: string[];
  changed: RowChange[];
  /** every field that changed on any row */
  fields: string[];
}

export function diffSnapshots(before: Snapshot, after: Snapshot): SnapshotDiff {
  const added = Object.keys(after.rows).filter((k) => !(k in before.rows));
  const removed = Object.keys(before.rows).filter((k) => !(k in after.rows));
  const changed: RowChange[] = [];
  for (const [key, b] of Object.entries(before.rows)) {
    const a = after.rows[key];
    if (!a) continue;
    const fields = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((f) => stable(b[f]) !== stable(a[f])).sort();
    if (fields.length) changed.push({ key, fields });
  }
  return { added, removed, changed, fields: [...new Set(changed.flatMap((c) => c.fields))].sort() };
}

/** Fields a write always moves; never counted against `--expect`. */
export const ALWAYS_MOVES = ["updatedAt"];

/** Changed fields that are not in `expected` (and not `updatedAt`). Empty: the diff is what was meant. */
export function unexpectedFields(diff: SnapshotDiff, expected: string[]): { key: string; fields: string[] }[] {
  const ok = new Set([...expected, ...ALWAYS_MOVES]);
  return diff.changed.map((c) => ({ key: c.key, fields: c.fields.filter((f) => !ok.has(f)) })).filter((c) => c.fields.length);
}
