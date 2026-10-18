/** Guarded stored-rule refresh for an explicit id list (npm run arena:refresh-ids).
 *
 * Classification only reads; writes go through the existing atomic lock-and-compare writers in
 * ./reviewed-rule-refresh (applyReviewedRefresh / applyReviewedUnreadRefresh). Nothing here
 * reimplements a write, and a row that is not a compiler-owned open/draft row is never a target
 * ("Rules are records", CLAUDE.md). */
import { inArray, sql } from "drizzle-orm";
import type { Db } from "../../src/db/index";
import { cards } from "../../src/db/schema";
import { rows } from "../../src/db/rows";
import { cardDefFrom } from "../../src/lib/arena/load";
import { skillRecords, type SkillRecord } from "../../src/lib/arena/draft";
import { OFFICIAL_ERRATA } from "../../src/lib/catalog/errata";
import { applyReviewedRefresh, applyReviewedUnreadRefresh } from "./reviewed-rule-refresh";

export type Side = "front" | "back";
export interface IdSpec { cardId: string; side: Side | null; skill: number; raw: string }

/** Never refreshed by this tool, whatever its row looks like (#907: its total-across-kinds clause stays unread by design). */
export const ALWAYS_EXCLUDED: Record<string, string> = { "P-616": "P-616 is always excluded (#907)" };

/** `BT12-003#10` (front), `BT12-003#10b` / `BT12-003#10#back` / `BT12-003#back#10` (back), `BT12-003/back/10` (the scripts' key). */
export function parseSpec(token: string): IdSpec | null {
  const raw = token.trim();
  let m = /^([A-Za-z0-9]+(?:-[A-Za-z0-9]+)+)\/(front|back)\/(\d+)$/.exec(raw);
  if (m) return { cardId: m[1], side: m[2] as Side, skill: Number(m[3]), raw };
  m = /^([A-Za-z0-9]+(?:-[A-Za-z0-9]+)+)#(?:(front|back)#)?(\d+)(?:(b)|#(front|back))?$/i.exec(raw);
  if (!m) return null;
  const side = (m[2] ?? m[5])?.toLowerCase() ?? (m[4] ? "back" : null);
  return { cardId: m[1], side: side as Side | null, skill: Number(m[3]), raw };
}

export function parseIdList(text: string): { specs: IdSpec[]; bad: string[] } {
  const specs: IdSpec[] = [], bad: string[] = [];
  const seen = new Set<string>();
  for (const tok of text.split(/[\s,;]+/).filter(Boolean)) {
    const s = parseSpec(tok);
    if (!s) { bad.push(tok); continue; }
    const k = `${s.cardId}/${s.side}/${s.skill}`;
    if (!seen.has(k)) { seen.add(k); specs.push(s); }
  }
  return { specs, bad };
}

/** Best-effort: the ids written in the PR body's "refresh" section (from the first line mentioning refresh to the next heading);
 * with no such line, none. Returns the section it read so the caller can print what it found. */
export function idsFromPrBody(body: string): { specs: IdSpec[]; section: string } {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => /refresh/i.test(l));
  if (start < 0) return { specs: [], section: "" };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^#{1,6}\s/.test(lines[i])) { end = i; break; }
  const section = lines.slice(start, end).join("\n");
  const found = section.match(/\b[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+(?:#(?:front#|back#)?\d+(?:b|#front|#back)?|\/(?:front|back)\/\d+)(?![\w#])/g) ?? [];
  return { specs: parseIdList(found.join(" ")).specs, section };
}

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
/** The semantic content of a rule row or fresh record, comparable across the two. */
export const sem = (r: object | undefined) => JSON.stringify(FIELDS.map((f) => strip((r as Record<string, unknown> | undefined)?.[f])));

export interface Verdict {
  spec: IdSpec;
  /** The resolved key, `card/side/skill`. */
  key: string;
  status: "pending" | "up-to-date" | "excluded";
  reason?: string;
  note?: string;
  /** pending only: which writer takes it. */
  writer?: "clean" | "unread";
  old?: string;
  new?: string;
  before?: Record<string, unknown>;
  fresh?: SkillRecord;
}

const reading = (unread: string[], reads: string) => (unread.length ? `UNREAD: ${unread.join(" | ")}` : reads || "(nothing)");

export async function classifyIds(db: Db, specs: IdSpec[], opts: { unreadOk?: boolean } = {}): Promise<Verdict[]> {
  const ids = [...new Set(specs.map((s) => s.cardId))];
  const catalog = ids.length ? await db.select().from(cards).where(inArray(cards.id, ids)) : [];
  const byCard = new Map(catalog.map((c) => [c.id, c]));
  const raw = ids.length
    ? rows<{ record: Record<string, unknown> }>(await db.execute(
        sql`select to_jsonb(r) as record from card_rules r where r.card_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`,
      )).map((r) => r.record)
    : [];
  const stored = new Map(raw.map((r) => [`${r.card_id}/${r.side}/${r.skill_index}`, r]));
  const out: Verdict[] = [];
  for (const spec of specs) {
    const card = byCard.get(spec.cardId);
    const excl = (side: Side, reason: string, extra: Partial<Verdict> = {}): Verdict =>
      ({ spec, key: `${spec.cardId}/${side}/${spec.skill}`, status: "excluded", reason, ...extra });
    if (!card) { out.push(excl(spec.side ?? "front", "no such card in the catalog")); continue; }
    if (ALWAYS_EXCLUDED[spec.cardId]) { out.push(excl(spec.side ?? "front", ALWAYS_EXCLUDED[spec.cardId])); continue; }
    if (card.game !== "dbs") { out.push(excl(spec.side ?? "front", `game is ${card.game}; the arena plays dbs only`)); continue; }
    const records = skillRecords(cardDefFrom(card));
    let side: Side = spec.side ?? "front";
    let note: string | undefined;
    // No suffix means the front; if the front has no such skill but the back does, use the back and say so.
    if (!spec.side && !records.some((r) => r.side === "front" && r.skillIndex === spec.skill)
      && records.some((r) => r.side === "back" && r.skillIndex === spec.skill)) { side = "back"; note = "no front skill with that index; read as the back face"; }
    const fresh = records.find((r) => r.side === side && r.skillIndex === spec.skill);
    const old = stored.get(`${spec.cardId}/${side}/${spec.skill}`);
    if (!fresh) { out.push(excl(side, "the current card text has no such skill", { note })); continue; }
    if (!old) { out.push(excl(side, "no stored card_rules row", { note, new: reading(fresh.unread, fresh.reads) })); continue; }
    const key = `${spec.cardId}/${side}/${spec.skill}`;
    const base = { spec, key, note, old: reading(old.unread as string[], old.reads as string), new: reading(fresh.unread, fresh.reads) };
    if (old.source !== "compiler") { out.push({ ...base, status: "excluded", reason: `source is ${old.source}, not compiler` }); continue; }
    if (!["draft", "open"].includes(old.status as string)) { out.push({ ...base, status: "excluded", reason: `status is ${old.status}, not draft/open` }); continue; }
    if (old.confirmed_at) { out.push({ ...base, status: "excluded", reason: "confirmed_at is set" }); continue; }
    if (sem(old) === sem(fresh)) { out.push({ ...base, status: "up-to-date" }); continue; }
    let n = note;
    if (old.printed !== fresh.printed) {
      if (old.status === "draft" && OFFICIAL_ERRATA.some((e) => e.cardId === spec.cardId)) n = [note, "printed text changed by an official erratum (draft row)"].filter(Boolean).join("; ");
      else { out.push({ ...base, status: "excluded", reason: "printed text changed since the row was stored (not a draft with an erratum)" }); continue; }
    }
    if (fresh.unread.length && !opts.unreadOk) { out.push({ ...base, note: n, status: "excluded", reason: "fresh compile leaves clauses unread (pass --unread-ok to write the unread path)" }); continue; }
    out.push({ ...base, note: n, status: "pending", writer: fresh.unread.length ? "unread" : "clean", before: old, fresh });
  }
  return out;
}

export const summarize = (v: Verdict[]) => ({
  pending: v.filter((x) => x.status === "pending").length,
  upToDate: v.filter((x) => x.status === "up-to-date").length,
  excluded: v.filter((x) => x.status === "excluded").length,
});

export function formatVerdict(v: Verdict): string {
  const head = `${v.status.toUpperCase().padEnd(10)} ${v.spec.raw} (${v.key})`;
  const lines = [head];
  if (v.reason) lines.push(`    why: ${v.reason}`);
  if (v.note) lines.push(`    note: ${v.note}`);
  if (v.status === "pending") lines.push(`    ${v.old}\n    -> ${v.new}${v.writer === "unread" ? "   [unread path, status open]" : ""}`);
  return lines.join("\n");
}

/** Writes every pending verdict through the existing writers: clean reads as drafts, unread (--unread-ok) as open. Each writer is one atomic statement;
 * a stale row aborts that statement with nothing written. Returns the rule ids written. */
export async function applyPending(db: Db, verdicts: Verdict[]): Promise<{ clean: number[]; unread: number[] }> {
  const pick = (w: "clean" | "unread") => verdicts.filter((v) => v.status === "pending" && v.writer === w).map((v) => ({ before: v.before!, fresh: v.fresh! }));
  const clean = pick("clean"), unread = pick("unread");
  return {
    clean: clean.length ? await applyReviewedRefresh(db, { rules: clean }) : [],
    unread: unread.length ? await applyReviewedUnreadRefresh(db, { rules: unread }) : [],
  };
}
