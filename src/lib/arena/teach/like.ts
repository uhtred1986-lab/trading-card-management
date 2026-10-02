/**
 * "Like a card" (#473): rules whose printed wording matches the clause being
 * taught, and that rule's clause copied into the builder — with a differing
 * number, colour or name changed to match this card, and the change said out
 * loud ("uses 3 here, not 5").
 *
 * Pure. The server action fetches a pool of rows (the same `pattern` first,
 * then a text search over `card_rules.printed`); everything about which comes
 * first, what is highlighted and what is changed is decided here, so the
 * verify script can prove it with fixture rows and no database.
 */
import { COLORS } from "../vm/script";
import { validateRule, type Rule } from "../lang";
import type { RuleClause } from "../lang/path";
import { CLAUSE_WORD, readClause } from "./common";

/** A row the search found, with the card it is on. */
export interface LikeRow {
  id: number;
  cardId: string;
  name: string;
  printed: string;
  pattern: string | null;
  status: string;
  source: string;
  rule: Rule;
}

/** The record being taught. */
export interface LikeTarget {
  id: number;
  pattern: string | null;
  /** The words of the clause being taught (`clauseText`). */
  clauseWords: string;
  rule: Rule;
}

/** One row of the panel. */
export interface LikeMatch {
  id: number;
  cardId: string;
  name: string;
  printed: string;
  /** The span of `printed` that matched, as character offsets, or null when only the search words did. */
  highlight: [number, number] | null;
  samePattern: boolean;
  /** Confirmed or corrected: a person has checked it. */
  checked: boolean;
  /** "confirmed" | "corrected" | "draft · not checked" */
  label: string;
  /** The target's rule with this row's clause copied in, ready for `onRule`; null when it cannot be. */
  rule: Rule | null;
  /** The copied clause, read back. */
  reads: string;
  /** What was changed to fit this card, said out loud. */
  notes: string[];
  /** Why it cannot be copied, when it cannot. */
  problem: string | null;
}

// ── the wording, with its slots ─────────────────────────────────────────────

/** The variable parts of a printed clause: a number, a colour, a name or trait. Everything else must match word for word. */
type SlotKind = "number" | "color" | "name";
const COLOR_WORDS = COLORS.filter((c) => c !== "Colorless").map((c) => c.toLowerCase());
const SLOT = new RegExp(`(\\d[\\d,]*)|\\b(${COLOR_WORDS.join("|")})\\b|(<[^>]*>|≪[^≫]*≫)`, "gi");

interface Slot {
  kind: SlotKind;
  text: string;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The clause as a regular expression whose slots capture whatever stands there on another card. */
export function wordingPattern(words: string): { re: RegExp; slots: Slot[] } {
  const slots: Slot[] = [];
  let src = "";
  let at = 0;
  for (const m of words.matchAll(SLOT)) {
    src += escapeRe(words.slice(at, m.index));
    const kind: SlotKind = m[1] ? "number" : m[2] ? "color" : "name";
    slots.push({ kind, text: m[0] });
    src += kind === "number" ? "(\\d[\\d,]*)" : kind === "color" ? `(${COLOR_WORDS.join("|")})` : "(<[^>]*>|≪[^≫]*≫)";
    at = (m.index ?? 0) + m[0].length;
  }
  src += escapeRe(words.slice(at));
  // Spacing and case never matter; a trailing full stop or comma is not part of a clause.
  src = src.replace(/(?:\\s|\s)+/g, "\\s+");
  return { re: new RegExp(src, "i"), slots };
}

/**
 * The SQL `ILIKE` pattern for the same wording: each slot is a wildcard, so
 * "if there are 5 or more red cards" finds "if there are 3 or more blue
 * cards". `%` and `_` in the words themselves are escaped.
 */
export function likePattern(words: string): string {
  const parts = words
    .toLowerCase()
    .split(SLOT)
    .filter((p, i) => i % 4 === 0 && p !== undefined)
    .map((p) => p.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/\s+/g, " "));
  return `%${parts.join("%")}%`.replace(/%(?:\s*%)+/g, "%");
}

/** Where the clause's wording stands in another card's printed line, and what its slots say there. */
export function findWording(printed: string, words: string): { span: [number, number]; slots: Slot[]; theirs: string[] } | null {
  const { re, slots } = wordingPattern(words);
  const m = re.exec(printed);
  if (!m) return null;
  return { span: [m.index, m.index + m[0].length], slots, theirs: m.slice(1) };
}

// ── copying a clause, and fitting it to this card ───────────────────────────

const strip = (s: string) => s.replace(/^[<≪]|[>≫]$/g, "");
const num = (s: string) => Number(s.replace(/,/g, ""));

/** Every leaf of a JSON value, with a way to set it. */
function leaves(v: unknown, visit: (value: unknown, set: (x: unknown) => void) => void): void {
  if (Array.isArray(v)) v.forEach((x, i) => (x && typeof x === "object" ? leaves(x, visit) : visit(x, (y) => (v[i] = y))));
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (x && typeof x === "object") leaves(x, visit);
      else visit(x, (y) => ((v as Record<string, unknown>)[k] = y));
    }
}

/**
 * Change what differs between the two wordings in a copied clause: a number
 * where the clause holds that number exactly as often as the wording says it,
 * a colour in its record spelling ("Red"), a name or trait as written between
 * its brackets. A difference that cannot be placed is not guessed at; it is
 * named so the owner checks it.
 */
export function fitClause<T>(clause: T, slots: Slot[], theirs: string[]): { clause: T; notes: string[] } {
  const out = structuredClone(clause);
  const notes: string[] = [];
  const done = new Set<string>();
  slots.forEach((slot, i) => {
    const mine = slot.text;
    const other = theirs[i];
    if (other === undefined || other.toLowerCase() === mine.toLowerCase()) return;
    const key = `${slot.kind}:${other.toLowerCase()}→${mine.toLowerCase()}`;
    if (done.has(key)) return;
    done.add(key);
    if (slot.kind === "number") {
      const from = num(other);
      const to = num(mine);
      const said = theirs.filter((t, j) => slots[j].kind === "number" && num(t) === from).length;
      let held = 0;
      leaves(out, (v) => {
        if (v === from) held++;
      });
      if (held === said) {
        leaves(out, (v, set) => {
          if (v === from) set(to);
        });
        notes.push(`uses ${to} here, not ${from}`);
      } else notes.push(`check the ${from}: the card says ${to}, and the copied clause holds ${from} ${held === 0 ? "nowhere" : `${held} times`}`);
      return;
    }
    const from = slot.kind === "color" ? other.toLowerCase() : strip(other);
    const to = slot.kind === "color" ? mine.toLowerCase() : strip(mine);
    const record = (s: string) => (slot.kind === "color" ? s[0].toUpperCase() + s.slice(1) : s);
    let changed = 0;
    leaves(out, (v, set) => {
      if (typeof v !== "string") return;
      if (slot.kind === "color" ? v.toLowerCase() === from : v === from) {
        set(record(to));
        changed++;
      } else if (slot.kind === "color" && v.toLowerCase().includes(from) && /\s/.test(v)) {
        // A filter printed in its own words ("red card"): the word, in place.
        set(v.replace(new RegExp(`\\b${from}\\b`, "gi"), to));
        changed++;
      }
    });
    notes.push(changed ? `${slot.kind === "name" ? mine : to} here, not ${slot.kind === "name" ? other : from}` : `check ${other}: the card says ${mine}, and the copied clause does not name it`);
  });
  return { clause: out, notes };
}

/** This row's clause copied into the target's rule, fitted, and checked against the target's tag. */
export function copyClause(target: LikeTarget, from: LikeRow, clause: RuleClause): Pick<LikeMatch, "rule" | "reads" | "notes" | "problem"> {
  const theirs = from.rule[clause];
  const empty = theirs == null || (Array.isArray(theirs) && theirs.length === 0);
  if (empty) return { rule: null, reads: "", notes: [], problem: `this rule has no ${CLAUSE_WORD[clause]} to copy` };
  const found = findWording(from.printed, target.clauseWords);
  const fitted = found ? fitClause(theirs, found.slots, found.theirs) : { clause: structuredClone(theirs), notes: ["the wording differs: check every value"] };
  const rule = { ...target.rule, [clause]: fitted.clause } as Rule;
  const bad = validateRule(rule, target.rule.kind);
  if (bad) return { rule: null, reads: readClause({ ...from.rule }, clause), notes: fitted.notes, problem: `copied here it does not check: ${bad.message}` };
  return { rule, reads: readClause(rule, clause), notes: fitted.notes, problem: null };
}

// ── the list ─────────────────────────────────────────────────────────────────

const CHECKED = new Set(["confirmed", "corrected"]);
export const LIKE_LIMIT = 20;

function labelOf(status: string): string {
  return CHECKED.has(status) ? status : "draft · not checked";
}

/**
 * The panel's list: the record's own pattern first, then the text matches;
 * inside each, rules a person checked before drafts, and a wording that lines
 * up (so it can be fitted) before one that only shares words. Open rows have
 * no program and the record itself is not its own example.
 */
export function rankLike(target: LikeTarget, rows: LikeRow[], clause: RuleClause, opts: { query?: string; limit?: number } = {}): LikeMatch[] {
  const seen = new Set<number>();
  const out: (LikeMatch & { order: number[] })[] = [];
  for (const row of rows) {
    if (row.id === target.id || row.status === "open" || seen.has(row.id)) continue;
    seen.add(row.id);
    const samePattern = !!target.pattern && row.pattern === target.pattern;
    const found = findWording(row.printed, target.clauseWords);
    const checked = CHECKED.has(row.status);
    const copied = copyClause(target, row, clause);
    out.push({
      id: row.id,
      cardId: row.cardId,
      name: row.name,
      printed: row.printed,
      highlight: found?.span ?? queryHighlight(row.printed, opts.query ?? ""),
      samePattern,
      checked,
      label: labelOf(row.status),
      ...copied,
      order: [samePattern ? 0 : 1, checked ? 0 : 1, found ? 0 : 1, copied.rule ? 0 : 1],
    });
  }
  out.sort((a, b) => {
    for (let i = 0; i < a.order.length; i++) if (a.order[i] !== b.order[i]) return a.order[i] - b.order[i];
    return a.cardId.localeCompare(b.cardId) || a.id - b.id;
  });
  return out.slice(0, opts.limit ?? LIKE_LIMIT).map(({ order, ...m }) => (void order, m));
}

/** For a row the search box found but whose wording does not line up: the search as typed, or else its longest word, where it first stands. */
function queryHighlight(printed: string, query: string): [number, number] | null {
  const phrase = query.trim().replace(/\s+/g, " ");
  const words = phrase.split(" ").filter((w) => w.length >= 2);
  const lower = printed.toLowerCase();
  for (const w of [phrase, ...words.sort((a, b) => b.length - a.length)]) {
    if (w.length < 2) continue;
    const at = lower.indexOf(w.toLowerCase());
    if (at >= 0) return [at, at + w.length];
  }
  return null;
}

/** The search box's words, as `ILIKE` patterns each must match. Two letters or more; at most six words. */
export function searchTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[\\%_]/g, (c) => `\\${c}`))
    .filter((w) => w.length >= 2)
    .slice(0, 6)
    .map((w) => `%${w}%`);
}
