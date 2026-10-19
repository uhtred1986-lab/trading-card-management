/**
 * The Rules queue, as a query string, and the pure views over it (issue #360, then the Rules
 * rework PR 2): *Cards in*, *health tab*, *Group by*, *Find*.
 *
 * The queue lists CARDS, not rule rows. A card has one of four healths (`ruleHealth`,
 * rules-store.ts) and lives under that tab; its dots are its skills.
 *
 * Pure — no database, no React — so `scripts/verify/rules-queue.ts` can hold the URL contract
 * (what a link builds is what the page reads back, and what the old `state=`/`seg=` URLs mean)
 * and the grouping without a server.
 *
 * ### The `?q=` contract with the card page
 * A row's *Open ›* link is `/arena/rules/card/<cardId>?q=<queueParams(queue).toString()>`: the
 * whole queue, encoded once as a value. The card page reads it back with `queueFromParam` and
 * walks Next/Previous with `neighbours(cardIds, cardId)` over the cards the queue lists, in
 * order (`loadQueue(...).ordered` in `queue-cards.ts`). `?skill=<ruleId>` picks a skill.
 */
import { mechanismOf, PHRASING_ONLY } from "./gaps";
import type { QueueCard, ReasonFamily, RuleHealth, RuleSource, RuleStatus } from "./rules-store";

/** The tabs, in display order, with the labels the owner chose. */
export const HEALTH_TABS: { key: RuleHealth; label: string }[] = [
  { key: "text-only", label: "Text only" },
  { key: "incomplete", label: "Incomplete" },
  { key: "unchecked", label: "Read, not checked" },
  { key: "done", label: "Done" },
];
export const HEALTHS: RuleHealth[] = HEALTH_TABS.map((t) => t.key);
export const SOURCES: RuleSource[] = ["compiler", "claude", "user"];
export type GroupBy = "none" | "wording" | "reason" | "set";
export const GROUPS: GroupBy[] = ["none", "wording", "reason", "set"];

/** Why a card is Incomplete, in the order the groups are listed. */
export const FAMILIES: { key: ReasonFamily; title: string; note: string }[] = [
  { key: "wrong", title: "You marked it Wrong", note: "a phone-review “Wrong” that nobody has answered yet" },
  { key: "combo", title: "Combo qualification missing", note: "a combo skill without its typed qualification (#907)" },
  { key: "diff", title: "The compiler now reads it differently", note: "your saved rule against a newer compiler reading" },
  { key: "fusion", title: "Fusion material record incomplete", note: "the typed material contract is missing or malformed (#907)" },
  { key: "review", title: "Flagged in claude.ai review", note: "a suspected misread from a deck audit" },
  { key: "other", title: "Something else the engine cannot carry out", note: "partly read, or a record the engine refuses" },
];
const FAMILY_KEYS = FAMILIES.map((f) => f.key);

/** Whose cards the queue is about. `decks` is the owner's decks, without testing decks (rules-progress.ts). */
export type Scope = { kind: "decks" } | { kind: "deck"; id: number } | { kind: "catalog" } | { kind: "game"; id: number };

export interface Queue {
  scope: Scope;
  /** Null until the page has counted the scope and can pick the default tab. */
  health: RuleHealth | null;
  /** Null: the tab's default (by reason in Incomplete, the plain list elsewhere). */
  group: GroupBy | null;
  q: string;
  /** Narrowing filters, each removable from the page. */
  set: string;
  /** A reason family, from a group's "Show all". */
  family: ReasonFamily | "";
  source: RuleSource | "";
  /** A wording key (the worst skill's pattern). */
  pattern: string;
  /** An unread mechanism (legacy `mech=`). */
  mech: string;
  reason: "" | "diff" | "cost";
  page: number;
  /** A rule id: only ever read to redirect to the card page. */
  rule: number | null;
  /**
   * The old status tab (`open`/`draft`/`confirmed`) the health stands for, derived from `health`
   * for the guided-review route (`/arena/rules/review`), which PR 3 retires. Not a parameter.
   */
  state: RuleStatus | null;
}

type Raw = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const int = (v: string) => (/^\d+$/.test(v) && Number(v) > 0 ? Number(v) : null);

/** What the pre-health `state=`/`seg=` tabs mean now: open is text only, a draft is unchecked, a confirmed or corrected rule is done. */
export const LEGACY_HEALTH: Record<string, RuleHealth> = { open: "text-only", draft: "unchecked", confirmed: "done", corrected: "done" };
const STATE_OF: Record<RuleHealth, RuleStatus | null> = { "text-only": "open", incomplete: null, unchecked: "draft", done: "confirmed" };

export function parseQueue(sp: Raw): Queue {
  const game = int(one(sp.game));
  const deck = int(one(sp.deck));
  const scope: Scope = game ? { kind: "game", id: game } : deck ? { kind: "deck", id: deck } : one(sp.scope) === "catalog" ? { kind: "catalog" } : { kind: "decks" };
  // `health` wins; `state` is the old tab and `seg` the older name of it (`?deck=<id>&seg=open`).
  const given = one(sp.health);
  const legacy = LEGACY_HEALTH[one(sp.state)] ?? LEGACY_HEALTH[one(sp.seg)];
  const health: RuleHealth | null = HEALTHS.includes(given as RuleHealth) ? (given as RuleHealth) : (legacy ?? null);
  const group = one(sp.group) as GroupBy;
  const source = one(sp.source) as RuleSource;
  const reason = one(sp.reason);
  const family = one(sp.family) as ReasonFamily;
  return {
    scope,
    health,
    group: GROUPS.includes(group) ? group : null,
    q: one(sp.q).trim(),
    set: one(sp.set).trim(),
    family: FAMILY_KEYS.includes(family) ? family : "",
    source: SOURCES.includes(source) ? source : "",
    pattern: one(sp.pattern),
    mech: one(sp.mech),
    reason: reason === "diff" || reason === "cost" ? reason : "",
    page: Math.max(0, Number(one(sp.page)) || 0),
    rule: int(one(sp.rule)),
    state: health ? STATE_OF[health] : null,
  };
}

/** The query as URL parameters, leaving out what is the default. */
export function queueParams(qu: Queue): URLSearchParams {
  const p = new URLSearchParams();
  if (qu.scope.kind === "catalog") p.set("scope", "catalog");
  if (qu.scope.kind === "deck") p.set("deck", String(qu.scope.id));
  if (qu.scope.kind === "game") p.set("game", String(qu.scope.id));
  if (qu.health) p.set("health", qu.health);
  if (qu.group) p.set("group", qu.group);
  if (qu.q) p.set("q", qu.q);
  if (qu.set) p.set("set", qu.set);
  if (qu.family) p.set("family", qu.family);
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
 * A link from the current queue: `patch` overrides fields. Changing what the queue is looking at
 * (anything but the selected rule) resets the page and the selection, since both belong to the
 * old view. A patch that sets `health` keeps `state` in step.
 */
export function queueLink(qu: Queue, patch: Partial<Queue>): string {
  const refilter = Object.keys(patch).some((k) => k !== "rule" && k !== "page");
  const next = { ...qu, ...(refilter ? { page: 0, rule: null } : {}), ...patch };
  return queueHref("health" in patch ? { ...next, state: next.health ? STATE_OF[next.health] : null } : next);
}

/** The queue's `?q=` value on a card link: the queue's own query string, to be encoded once more by the URL. */
export function queueParam(qu: Queue): string {
  return queueParams({ ...qu, page: 0, rule: null }).toString();
}

/** Back from a card link's `?q=` value. */
export function queueFromParam(value: string | string[] | undefined): Queue {
  return parseQueue(Object.fromEntries(new URLSearchParams(one(value))));
}

/** *Open ›*: a card's page, carrying the queue so Next/Previous can walk it. */
export function cardHref(cardId: string, qu: Queue, skillRuleId?: number | null): string {
  const p = new URLSearchParams();
  const param = queueParam(qu);
  if (param) p.set("q", param);
  if (skillRuleId) p.set("skill", String(skillRuleId));
  const s = p.toString();
  return `/arena/rules/card/${encodeURIComponent(cardId)}${s ? `?${s}` : ""}`;
}

/** The tab to open on: Incomplete, or the first non-empty of Text only and Incomplete (spec); else the first with cards. */
export function defaultHealth(counts: Record<RuleHealth, number>): RuleHealth {
  if (counts.incomplete > 0) return "incomplete";
  if (counts["text-only"] > 0) return "text-only";
  if (counts.unchecked > 0) return "unchecked";
  return counts.done > 0 ? "done" : "incomplete";
}

/** Grouping when none is chosen: why they are incomplete, in Incomplete; a plain list elsewhere. */
export const defaultGroup = (health: RuleHealth): GroupBy => (health === "incomplete" ? "reason" : "none");

/**
 * The query the retired `/arena/rules/all` and `/arena/rules/patterns` URLs now mean. Both looked
 * over the whole catalog, so both redirect into the catalog scope; `seg=all` was "every state".
 */
export function legacyQueueUrl(from: "all" | "patterns", sp: Raw): string {
  const p = new URLSearchParams({ scope: "catalog" });
  if (from === "all") {
    const seg = LEGACY_HEALTH[one(sp.seg)];
    if (seg) p.set("health", seg);
    for (const k of ["set", "mech", "source", "pattern", "q", "page", "rule"]) if (one(sp[k])) p.set(k, one(sp[k]));
  } else {
    // The two halves were worked down differently: drafts by their reading, open by what the wording would need.
    p.set("health", one(sp.half) === "open" ? "text-only" : "unchecked");
    p.set("group", "wording");
  }
  return `/arena/rules?${p.toString()}`;
}

/** Why a rule is in the queue, for the chip on its row; null when there is nothing to flag. Kept for the guided review. */
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

/**
 * Where to go from the open item, in the order the queue lists them: `prev`/`next` are the
 * `k`/`j` keys, `skip` is *Skip* (the next one, wrapping to the first at the end of the list), and
 * `after` is where *Confirm* lands — the next one, or the one before it at the end of the list,
 * since the item just confirmed leaves its tab. An item not in the list (opened by id, or from
 * past the page) has the first for next. Null where there is nowhere to go. Rule ids and card ids
 * both walk it.
 */
export function neighbours<T extends string | number>(ids: T[], current: T | null): { prev: T | null; next: T | null; skip: T | null; after: T | null } {
  const i = current == null ? -1 : ids.indexOf(current);
  const prev = i > 0 ? ids[i - 1] : null;
  const next = i >= 0 ? (ids[i + 1] ?? null) : (ids[0] ?? null);
  const skip = next ?? (ids.length > 1 && ids[0] !== current ? ids[0] : null);
  return { prev, next, skip, after: next ?? prev };
}

// ── the views over classified cards (pure) ──────────────────────────────────

export const emptyCounts = (): Record<RuleHealth, number> => ({ "text-only": 0, incomplete: 0, unchecked: 0, done: 0 });

export function countsOf(cards: readonly QueueCard[]): Record<RuleHealth, number> {
  const out = emptyCounts();
  for (const c of cards) out[c.health]++;
  return out;
}

export interface CardGroup {
  key: string;
  title: string;
  note: string;
  cards: QueueCard[];
  /** The narrowing that turns this group into the ungrouped list. */
  patch: Partial<Queue>;
}

/** The text of a wording group when the key is an open mechanism rather than a pattern. */
const wordingTitle = (c: QueueCard) => c.wording ?? "No shared wording";

/**
 * The queue, grouped. `reason`: by reason family in Incomplete, else by the card's first reason in
 * plain words. `wording`: cards whose worst skill reads out as the same pattern. `set`: by set code.
 * Groups keep the queue order inside; they are ordered by size, except families and sets.
 */
export function groupCards(cards: readonly QueueCard[], by: Exclude<GroupBy, "none">, health: RuleHealth): CardGroup[] {
  const bucket = new Map<string, QueueCard[]>();
  const add = (k: string, c: QueueCard) => bucket.set(k, [...(bucket.get(k) ?? []), c]);
  if (by === "reason") {
    if (health === "incomplete") {
      for (const c of cards) add(c.family ?? "other", c);
      return FAMILIES.filter((f) => bucket.has(f.key)).map((f) => ({ key: f.key, title: f.title, note: f.note, cards: bucket.get(f.key)!, patch: { family: f.key, group: "none" as const } }));
    }
    for (const c of cards) add(c.reasons[0] ?? "Nothing to flag", c);
    return [...bucket.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([k, cs]) => ({ key: k, title: k, note: "", cards: cs, patch: { group: "none" as const } }));
  }
  if (by === "set") {
    for (const c of cards) add(c.setCode, c);
    return [...bucket.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, cs]) => ({ key: k, title: k, note: "", cards: cs, patch: { set: k, group: "none" as const } }));
  }
  for (const c of cards) add(c.wording ?? "", c);
  return [...bucket.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([k, cs]) => ({
      key: k,
      title: wordingTitle(cs[0]),
      note: cs[0].mechanism && cs[0].mechanism !== PHRASING_ONLY ? `unread: ${cs[0].mechanism}` : "",
      cards: cs,
      patch: k ? { pattern: k, group: "none" as const } : { group: "none" as const },
    }));
}
