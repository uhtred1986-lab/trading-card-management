/**
 * Pure helpers of the Card rules page (`/arena/rules/card/[cardId]`, Rules PR 3):
 * the links in and out of it, the combo qualification as readable chips, and what
 * the page says about a "Wrong" flag. No database, no React, so
 * `scripts/verify/rule-card.ts` holds them.
 */
import { FLAG_PREFIX } from "./rule-review";
import type { ComboQualification } from "./vm/combo-qualification";

/** The card page, optionally on one skill (by `card_rules.id`), with its editor open and the queue it was opened from. */
export function cardHref(cardId: string, o: { skill?: number | null; edit?: boolean; q?: string | URLSearchParams | null } = {}): string {
  const p = new URLSearchParams();
  if (o.skill) p.set("skill", String(o.skill));
  if (o.edit) p.set("edit", "1");
  // The queue rides as one parameter: its own query string, encoded.
  const q = (typeof o.q === "string" ? o.q : o.q?.toString())?.replace(/^\?/, "");
  if (q) p.set("q", q);
  const own = p.toString();
  return `/arena/rules/card/${encodeURIComponent(cardId)}${own ? `?${own}` : ""}`;
}

/** The play-test sandbox for a rule, on a board when one is named (otherwise the sandbox picks its first). */
export function playHref(cardId: string, ruleId: number, board?: string | null): string {
  const p = new URLSearchParams({ rule: String(ruleId) });
  if (board) p.set("board", board);
  return `/arena/rules/card/${encodeURIComponent(cardId)}/play?${p.toString()}`;
}

const AREA_WORDS: Record<string, string> = { hand: "hand", deck: "deck", battle: "the Battle Area", energy: "the Energy Area", drop: "the Drop", warp: "the Warp", life: "life", zEnergy: "the Z-Energy Area" };

/**
 * The "only when" chips of a combo qualification, in the order a person reads a
 * combo ("on whose turn, when, from where, with what"). Never JSON: the stored
 * record is `{turn, timing, origins, subject, version}`.
 */
export function comboChips(q: ComboQualification | null | undefined): string[] {
  if (!q || typeof q !== "object") return [];
  const out: string[] = [];
  out.push(q.turn === "opponent" ? "opponent’s turn" : q.turn === "controller" ? "your turn" : "either turn");
  out.push(q.timing === "entry" ? "when it enters by combo" : "at the end of the battle");
  out.push(q.origins?.length ? `comboed from ${q.origins.map((a) => AREA_WORDS[a] ?? a).join(" or ")}` : "comboed from any area");
  if (q.subject === "self") out.push("with this card");
  if (q.viaSkillOf) out.push(`using ${q.viaSkillOf}’s skill`);
  return out;
}

/** What the page says about a row's `review_flag`: the words, the day it was written when that is known, and whether the rule moved on since. */
export interface FlagNotice {
  /** The newest flag's words, without the screen's own prefix. */
  text: string;
  /** ISO day, or null when nothing dates the flag. */
  on: string | null;
  /** The rule was saved, re-drafted or taken from the compiler after the flag. */
  changedSince: boolean;
}

const DAY = /^(\d{4}-\d{2}-\d{2})\b/;

/**
 * `flag` is the column; `feedbackAt` the time of the feedback note the in-app
 * Wrong writes beside it (null for a flag the connector wrote, which dates its own
 * line); `updatedAt` the row's last write. The in-app Wrong touches `updated_at`
 * in the same write, so only a change a minute after the note counts as one, and
 * a flag dated only by its day counts a change on a later day.
 */
export function flagNotice(flag: string | null | undefined, feedbackAt: Date | string | null | undefined, updatedAt: Date | string): FlagNotice | null {
  const lines = (flag ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const first = lines[0];
  const text = first.startsWith(FLAG_PREFIX) ? first.slice(FLAG_PREFIX.length).replace(/^\s*·\s*/, "") || first : first.replace(DAY, "").replace(/^\s+/, "");
  const fb = feedbackAt ? new Date(feedbackAt) : null;
  const dated = lines.map((l) => DAY.exec(l)?.[1]).filter((d): d is string => !!d).sort().at(-1) ?? null;
  const at = fb && !Number.isNaN(fb.getTime()) ? fb : null;
  const on = at ? at.toISOString().slice(0, 10) : dated;
  const updated = new Date(updatedAt).getTime();
  const changedSince = at ? updated - at.getTime() > 60_000 : dated ? updated >= Date.parse(`${dated}T00:00:00Z`) + 86_400_000 : false;
  return { text: text.trim(), on, changedSince };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** `2026-10-04` as "4 Oct". */
export function shortDay(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
