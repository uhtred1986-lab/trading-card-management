/** Unread-group refresh after #951–#972: compiler-owned open/draft rows whose fresh compile still leaves text unread (the former unreadOnly group of arena-refresh-2026-10-17.mts).
 * Read-only by default (--plan FILE BASELINE). --apply FILE BASELINE writes only the reviewed rows,
 * through applyReviewedUnreadRefresh (lock, compare, swap; status open); owned rows are reported, never written.
 *
 * BASELINE is skillRecords for every dbs card compiled at 6c8cd025 (before #951), keyed
 * card/side/skill. A row is this batch's to refresh only when its stored copy matched that
 * compile; rows that had drifted before #951 are reported, not written. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db/index.ts";
import { cards, deckCards } from "../src/db/schema.ts";
import { rows } from "../src/db/rows.ts";
import { cardDefFrom } from "../src/lib/arena/load.ts";
import { canonical, skillRecords, type SkillRecord } from "../src/lib/arena/draft.ts";
import { applyReviewedUnreadRefresh, type ReviewedUnreadRefresh } from "./lib/reviewed-rule-refresh.ts";

const [mode, file, baselineFile, ...extra] = process.argv.slice(2);
assert((mode === "--plan" || mode === "--apply") && file && baselineFile && !extra.length, "Usage: --plan|--apply FILE BASELINE");
assert(process.env.DATABASE_URL, "Explicit app DATABASE_URL required");
assert.equal(rows<{ name: string }>(await db.execute(sql`select to_regclass('public.card_rules')::text as name`))[0]?.name, "card_rules");
const baseline: Record<string, SkillRecord> = JSON.parse(fs.readFileSync(baselineFile, "utf8"));

const FIELDS = ["kind", "trigger", "cost", "cond", "ops", "unread", "pattern", "reads"] as const;
// New filter fields default to [] / null / false; a stored row without them means the same thing.
const isEmpty = (v: unknown) =>
  v == null || v === false || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v as object).length);
const strip = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === "object")
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, strip((v as Record<string, unknown>)[k])] as const).filter(([, s]) => !isEmpty(s)));
  return v ?? null;
};
const sem = (r: object | undefined) => JSON.stringify(FIELDS.map((f) => strip((r as Record<string, unknown> | undefined)?.[f])));
const key = (c: string, s: string, i: number) => `${c}/${s}/${i}`;

const catalog = await db.select().from(cards).where(eq(cards.game, "dbs"));
const raw = rows<{ record: Record<string, unknown> }>(await db.execute(
  sql`select to_jsonb(r) as record from card_rules r join cards c on c.id = r.card_id where c.game = 'dbs'`,
)).map((r) => r.record);
const stored = new Map(raw.map((r) => [key(r.card_id as string, r.side as string, r.skill_index as number), r]));
const deckIds = new Set((await db.selectDistinct({ id: deckCards.cardId }).from(deckCards)).map((r) => r.id));

type Change = "newly reads" | "newly unread" | "still unread" | "changes reading";
const applicable: { before: Record<string, unknown>; fresh: SkillRecord; change: Change }[] = [];
const unreadOnly: typeof applicable = [];
const owned: { card: string; side: string; skill: number; id: unknown; status: string; source: string; change: Change; new: string }[] = [];
const preexisting: string[] = [];
const printedChanged: string[] = [];
const missing: string[] = [];
const seen = new Set<string>();

for (const card of catalog) {
  for (const fresh of skillRecords(cardDefFrom(card))) {
    const k = key(fresh.cardId, fresh.side, fresh.skillIndex);
    seen.add(k);
    const old = stored.get(k);
    if (!old) { missing.push(k); continue; }
    if (sem(old) === sem(fresh)) continue;
    if (old.printed !== fresh.printed) { printedChanged.push(k); continue; }
    const oldUnread = (old.unread as string[]).length, newUnread = fresh.unread.length;
    const change: Change = oldUnread && !newUnread ? "newly reads" : !oldUnread && newUnread ? "newly unread" : oldUnread ? "still unread" : "changes reading";
    if (old.source !== "compiler" || !["open", "draft"].includes(old.status as string)) {
      // Owned: report only the ones whose compiler reading this batch moved.
      if (sem(baseline[k]) !== sem(fresh))
        owned.push({ card: fresh.cardId, side: fresh.side, skill: fresh.skillIndex, id: old.id, status: old.status as string, source: old.source as string, change,
          new: newUnread ? `UNREAD: ${fresh.unread.join(" | ")}` : fresh.reads });
      continue;
    }
    if (sem(old) !== sem(baseline[k])) { preexisting.push(k); continue; }
    // applyReviewedRefresh writes only records that read cleanly; the rest are reported.
    (newUnread ? unreadOnly : applicable).push({ before: old, fresh, change });
  }
}
const orphans = [...stored.keys()].filter((k) => !seen.has(k));
const refresh: ReviewedUnreadRefresh = { rules: unreadOnly.map(({ before, fresh }) => ({ before, fresh })) };

const line = (r: (typeof applicable)[number]) => ({
  card: r.fresh.cardId, side: r.fresh.side, skill: r.fresh.skillIndex, id: r.before.id, deck: deckIds.has(r.fresh.cardId), change: r.change,
  trigger: JSON.stringify(r.before.trigger) === JSON.stringify(r.fresh.trigger) ? undefined : `${(r.before.trigger as string[]).join(",")} → ${r.fresh.trigger.join(",")}`,
  old: (r.before.unread as string[]).length ? `UNREAD: ${(r.before.unread as string[]).join(" | ")}` : (r.before.reads as string),
  new: r.fresh.unread.length ? `UNREAD: ${r.fresh.unread.join(" | ")}` : r.fresh.reads,
});

if (mode === "--plan") {
  fs.writeFileSync(file, JSON.stringify(refresh, null, 2), { mode: 0o600 });
  const report = { applicable: applicable.map(line), unreadOnly: unreadOnly.map(line), owned, preexisting, printedChanged, missing, orphans };
  fs.writeFileSync(file.replace(/\.json$/, "") + ".report.json", JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({
    applicable: applicable.length, unreadOnly: unreadOnly.length, owned: owned.length, preexisting: preexisting.length,
    printedChanged: printedChanged.length, missing: missing.length, orphans: orphans.length, write: false,
  }));
} else {
  assert.deepEqual(canonical(JSON.parse(fs.readFileSync(file, "utf8"))), canonical(JSON.parse(JSON.stringify(refresh))), "Review changed; regenerate and review before applying");
  const written = await applyReviewedUnreadRefresh(db, refresh);
  console.log(JSON.stringify({ compilerRulesWritten: written }));
}
process.exit(0);
