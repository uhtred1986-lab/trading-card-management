/**
 * The Rules Workbench's one queue, as a query string (issue #360,
 * `docs/arena-home-spec.md` §2): *Cards in*, *State*, *Group by*, *Find*.
 *
 * Pure — no database, no React — so `scripts/verify-rules.ts` can hold the URL
 * contract (what a link builds is what the page reads back, and what the old
 * `/all` and `/patterns` URLs redirect to) without a server.
 */
import { mechanismOf, PHRASING_ONLY } from "./gaps";
import type { RuleSource, RuleStatus } from "./rules-store";

export const STATES: RuleStatus[] = ["open", "draft", "confirmed", "corrected"];
export const SOURCES: RuleSource[] = ["compiler", "claude", "user"];
export type GroupBy = "none" | "wording" | "reason" | "set";
export const GROUPS: GroupBy[] = ["none", "wording", "reason", "set"];

/** Whose cards the queue is about. `decks` is every deck the arena can play, whoever owns it (#364). */
export type Scope = { kind: "decks" } | { kind: "deck"; id: number } | { kind: "catalog" } | { kind: "game"; id: number };

export interface Queue {
  scope: Scope;
  /** Null until the page has counted the scope and can pick the default. */
  state: RuleStatus | null;
  group: GroupBy;
  q: string;
  /** Narrowing filters, each removable from the page. */
  set: string;
  source: RuleSource | "";
  pattern: string;
  mech: string;
  reason: "" | "diff" | "cost";
  page: number;
  rule: number | null;
}

type Raw = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const int = (v: string) => (/^\d+$/.test(v) && Number(v) > 0 ? Number(v) : null);

export function parseQueue(sp: Raw): Queue {
  const game = int(one(sp.game));
  const deck = int(one(sp.deck));
  const scope: Scope = game ? { kind: "game", id: game } : deck ? { kind: "deck", id: deck } : one(sp.scope) === "catalog" ? { kind: "catalog" } : { kind: "decks" };
  const state = one(sp.state) as RuleStatus;
  const group = one(sp.group) as GroupBy;
  const source = one(sp.source) as RuleSource;
  const reason = one(sp.reason);
  return {
    scope,
    state: STATES.includes(state) ? state : null,
    group: GROUPS.includes(group) ? group : "none",
    q: one(sp.q).trim(),
    set: one(sp.set).trim(),
    source: SOURCES.includes(source) ? source : "",
    pattern: one(sp.pattern),
    mech: one(sp.mech),
    reason: reason === "diff" || reason === "cost" ? reason : "",
    page: Math.max(0, Number(one(sp.page)) || 0),
    rule: int(one(sp.rule)),
  };
}

/** The query as URL parameters, leaving out what is the default. */
export function queueParams(qu: Queue): URLSearchParams {
  const p = new URLSearchParams();
  if (qu.scope.kind === "catalog") p.set("scope", "catalog");
  if (qu.scope.kind === "deck") p.set("deck", String(qu.scope.id));
  if (qu.scope.kind === "game") p.set("game", String(qu.scope.id));
  if (qu.state) p.set("state", qu.state);
  if (qu.group !== "none") p.set("group", qu.group);
  if (qu.q) p.set("q", qu.q);
  if (qu.set) p.set("set", qu.set);
  if (qu.source) p.set("source", qu.source);
  if (qu.pattern) p.set("pattern", qu.pattern);
  if (qu.mech) p.set("mech", qu.mech);
  if (qu.reason) p.set("reason", qu.reason);
  if (qu.page) p.set("page", String(qu.page));
  if (qu.rule) p.set("rule", String(qu.rule));
  return p;
}

export function queueHref(qu: Queue): string {
  const s = queueParams(qu).toString();
  return `/arena/rules${s ? `?${s}` : ""}`;
}

/**
 * A link from the current queue: `patch` overrides fields. Changing what the
 * queue is looking at (anything but the selected rule) resets the page and the
 * selection, since both belong to the old view.
 */
export function queueLink(qu: Queue, patch: Partial<Queue>): string {
  const refilter = Object.keys(patch).some((k) => k !== "rule" && k !== "page");
  return queueHref({ ...qu, ...(refilter ? { page: 0, rule: null } : {}), ...patch });
}

/** *Open* when the scope has any open rule, else *Draft* (spec §2). */
export function defaultState(counts: Record<RuleStatus, number>): RuleStatus {
  return counts.open > 0 ? "open" : "draft";
}

/**
 * The query the retired `/arena/rules/all` and `/arena/rules/patterns` URLs
 * now mean. Both looked over the whole catalog, so both redirect into the
 * catalog scope; `seg=all` was "every state", which is now the default state.
 */
export function legacyQueueUrl(from: "all" | "patterns", sp: Raw): string {
  const p = new URLSearchParams({ scope: "catalog" });
  if (from === "all") {
    const seg = one(sp.seg);
    if (STATES.includes(seg as RuleStatus)) p.set("state", seg);
    for (const k of ["set", "mech", "source", "pattern", "q", "page", "rule"]) if (one(sp[k])) p.set(k, one(sp[k]));
  } else {
    // The two halves were worked down differently: drafts by their reading, open by what the wording would need.
    p.set("state", one(sp.half) === "open" ? "open" : "draft");
    p.set("group", "wording");
  }
  return `/arena/rules?${p.toString()}`;
}

/** Why a rule is in the queue, for the chip on its row; null when there is nothing to flag. */
export function reasonOf(r: { status: string; source: string; unread: string[]; hasDiff?: boolean; compilerDiff?: unknown; costUnknown?: boolean }): string | null {
  if (r.hasDiff || r.compilerDiff) return "compiler reads it differently";
  if (r.status === "open") {
    const m = mechanismOf(r.unread[0] ?? "");
    return m === PHRASING_ONLY ? "phrasing only" : `unread: ${m}`;
  }
  if (r.status === "draft" && r.source === "claude") return "Claude drafted";
  if (r.costUnknown) return "specified cost unknown";
  return null;
}
