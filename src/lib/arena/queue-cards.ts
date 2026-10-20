/**
 * The Rules queue, read: the scope's cards, classified, narrowed and paged. The server half of
 * `queue.ts` (which is the URL and the pure views); this one reads the database.
 *
 * `loadQueue` is what the page renders and what the card page walks: its `ordered` is the card
 * ids the queue lists, in order, for `neighbours()` (the `?q=` contract, see `queue.ts`).
 *
 * Scope "decks" is the owner's decks without testing decks, the rule of `loadProgress`
 * (rules-progress.ts): game `dbs`, `is_testing = false`, owned by `currentScope()` (an SL sees every
 * owner's), cards of the main, Z and leader zones.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import { rows } from "@/db/rows";
import type { OwnerScope } from "@/lib/collection/scope";
import { firedInGame } from "./fired";
import { defaultGroup, defaultHealth, type Queue, type Scope } from "./queue";
import { countsOf } from "./queue";
import { cardsRebuildWouldChange, draftCards } from "./draft";
import { catalogQueueCards } from "@/lib/cache/rules-health";
import { loadQueueCards, viewOfQueue, type QueueCard, type RuleHealth } from "./rules-store";

export interface ScopeDeck {
  id: number;
  name: string;
  cardIds: string[];
}

export interface ResolvedScope {
  /** The scope the page shows: a deck the owner does not have falls back to `decks`. */
  scope: Scope;
  /** The URL asked for a deck that is not among the owner's decks. */
  deckUnavailable: boolean;
  /** Every deck of the owner (the "Cards in" options). */
  decks: ScopeDeck[];
  /** The cards of the scope; undefined for the whole catalog. */
  cardIds: string[] | undefined;
  /** Names of the decks that run each card, for "in N decks". */
  decksOf: Map<string, string[]>;
  /** How early a game fired each card (0 = first); empty unless the scope is a game. */
  firedOrder: Map<string, number>;
}

export async function ownerDecks(db: Db, owner: OwnerScope): Promise<ScopeDeck[]> {
  const ownerWhere = owner === undefined ? sql`` : owner === null ? sql`and d.owner is null` : sql`and d.owner = ${owner}`;
  const found = rows<{ id: number; name: string; cardId: string }>(await db.execute(sql`
    select d.id, d.name, dc.card_id as "cardId"
    from decks d
    join deck_cards dc on dc.deck_id = d.id and dc.zone in ('main', 'z', 'leader')
    where d.game = 'dbs' and d.is_testing = false ${ownerWhere}
    order by d.name, d.id`));
  const byDeck = new Map<number, ScopeDeck>();
  for (const r of found) {
    const d = byDeck.get(r.id) ?? byDeck.set(r.id, { id: r.id, name: r.name, cardIds: [] }).get(r.id)!;
    if (!d.cardIds.includes(r.cardId)) d.cardIds.push(r.cardId);
  }
  return [...byDeck.values()];
}

export async function resolveScope(db: Db, asked: Scope, owner: OwnerScope): Promise<ResolvedScope> {
  const decks = await ownerDecks(db, owner);
  const decksOf = new Map<string, string[]>();
  for (const d of decks) for (const id of d.cardIds) decksOf.set(id, [...(decksOf.get(id) ?? []), d.name]);
  const deckUnavailable = asked.kind === "deck" && !decks.some((d) => d.id === asked.id);
  const scope: Scope = deckUnavailable ? { kind: "decks" } : asked;
  const firedOrder = new Map<string, number>();
  let cardIds: string[] | undefined;
  if (scope.kind === "catalog") cardIds = undefined;
  else if (scope.kind === "deck") cardIds = decks.find((d) => d.id === scope.id)!.cardIds;
  else if (scope.kind === "game") {
    const fired = await firedInGame(db, scope.id);
    fired.forEach((f, i) => { if (!firedOrder.has(f.cardId)) firedOrder.set(f.cardId, i); });
    cardIds = [...firedOrder.keys()];
  } else cardIds = [...decksOf.keys()];
  return { scope, deckUnavailable, decks, cardIds, decksOf, firedOrder };
}

export interface LoadedQueue {
  resolved: ResolvedScope;
  /** The tab showing (the default when the URL named none). */
  health: RuleHealth;
  /** The grouping showing (the tab's default when the URL named none). */
  group: "none" | "wording" | "reason" | "set";
  /** Tab counts, over the scope with Find and Set applied. */
  counts: Record<RuleHealth, number>;
  /** Every classified card of the scope, Find and Set applied. */
  scopeCards: QueueCard[];
  /** The cards the tab and filters keep, in queue order. */
  matched: QueueCard[];
  /** `matched`'s card ids: what Next and Previous on the card page walk. */
  ordered: string[];
}

export async function loadQueue(db: Db, qu: Queue, owner: OwnerScope): Promise<LoadedQueue> {
  const resolved = await resolveScope(db, qu.scope, owner);
  // The whole catalog is classified once and cached (cache/rules-health.ts); Find and Set narrow it in memory.
  // Decks and games are small and read fresh. In the cached list Find matches the name and the id.
  let scopeCards: QueueCard[];
  if (resolved.cardIds === undefined) {
    const needle = qu.q.toLowerCase();
    scopeCards = (await catalogQueueCards()).filter((c) => (!qu.set || c.setCode === qu.set) && (!needle || c.name.toLowerCase().includes(needle) || c.cardId.toLowerCase().includes(needle)));
  } else scopeCards = await loadQueueCards(db, { cardIds: resolved.cardIds, setCode: qu.set || undefined, q: qu.q || undefined });
  const counts = countsOf(scopeCards);
  // An unread mechanism is a property of a text-only card, so asking for one asks for that tab.
  const health = qu.health ?? (qu.mech ? "text-only" : defaultHealth(counts));
  const weight = (id: string) => (resolved.scope.kind === "game" ? 1e6 - (resolved.firedOrder.get(id) ?? 1e6) : (resolved.decksOf.get(id)?.length ?? 0));
  const matched = viewOfQueue(scopeCards, {
    health,
    family: qu.family || (qu.reason === "diff" ? "diff" : ""),
    source: qu.source,
    pattern: qu.pattern,
    mech: qu.mech,
    weight,
  });
  return { resolved, health, group: qu.group ?? defaultGroup(health), counts, scopeCards, matched, ordered: matched.map((c) => c.cardId) };
}

// ── the rebuild: cards whose payment record predates #1066 ──────────────────

export interface RebuildPlan {
  /** Cards in the scope with at least one skill that needs a rebuild. */
  cards: number;
  /** Their skill rows. */
  skills: number;
  /** Rows the compiler may rewrite: its own open or draft rows. */
  compilerDrafts: number;
  /** Approved or corrected rows. `draftCards` never rewrites these. */
  protectedRows: number;
  /** Claude or person drafts: not the compiler's, so not rewritten either. */
  otherRows: number;
  /** Cards holding a protected row (the first 60), listed for the owner to re-approve. */
  protectedCards: string[];
  /** The cards a rebuild will change: the compiler has drafts on them and records them differently now. */
  rebuildable: string[];
  /**
   * Cards that still need a rebuild but have only compiler drafts the compiler writes back
   * unchanged (a rebuild ran and nothing moved): offering "Rebuild" for them would do nothing.
   * Empty until `settlePlan` has looked.
   */
  stuck: string[];
}

export function planRebuild(cs: readonly QueueCard[]): RebuildPlan {
  const need = cs.filter((c) => c.rebuild.rows > 0);
  return {
    cards: need.length,
    skills: need.reduce((n, c) => n + c.rebuild.rows, 0),
    compilerDrafts: need.reduce((n, c) => n + c.rebuild.compiler, 0),
    protectedRows: need.reduce((n, c) => n + c.rebuild.protectedRows, 0),
    otherRows: need.reduce((n, c) => n + c.rebuild.other, 0),
    protectedCards: need.filter((c) => c.rebuild.protectedRows > 0).map((c) => c.cardId).slice(0, 60),
    rebuildable: need.filter((c) => c.rebuild.compiler > 0).map((c) => c.cardId),
    stuck: [],
  };
}

/** How many cards `settlePlan` compiles to tell a rebuild that helps from one that changes nothing (small scopes only; larger lists show the plain banner). */
const SETTLE_LIMIT = 50;

/**
 * Split `rebuildable` into the cards a rebuild would change and the ones it cannot (`stuck`):
 * runs the compiler, writes nothing (`cardsRebuildWouldChange`). Only done for at most `SETTLE_LIMIT` rebuildable cards;
 * above that the plan is returned as it is (no stuck split).
 */
export async function settlePlan(db: Db, plan: RebuildPlan): Promise<RebuildPlan> {
  // Compiling is not free: only a small list is looked at (a deck scope), never the whole catalog's thousands.
  if (plan.rebuildable.length === 0 || plan.rebuildable.length > SETTLE_LIMIT) return plan;
  const look = plan.rebuildable;
  const changes = await cardsRebuildWouldChange(db, look);
  const stuck = look.filter((id) => !changes.has(id));
  if (stuck.length === 0) return plan;
  const gone = new Set(stuck);
  const rebuildable = plan.rebuildable.filter((id) => !gone.has(id));
  // The compiler drafts on stuck cards are not "rebuildable" any more.
  return { ...plan, rebuildable, stuck, compilerDrafts: Math.max(0, plan.compilerDrafts - stuck.length) };
}

/** One click rebuilds at most this many cards, so a request stays inside the function's time; the banner says how many are left. */
export const REBUILD_BATCH = 400;

export async function rebuildPlanFor(db: Db, scope: Scope, owner: OwnerScope): Promise<RebuildPlan> {
  const resolved = await resolveScope(db, scope, owner);
  return settlePlan(db, planRebuild(await loadQueueCards(db, { cardIds: resolved.cardIds })));
}

/**
 * Re-run the compiler for the scope's cards that need it, through `draftCards` (draft.ts). That
 * writer only rewrites rows the compiler owns (`source = 'compiler'`, open or draft); a confirmed
 * or corrected row, or a Claude or person draft, keeps its record and at most gets its printed
 * line refreshed and a compiler-difference note.
 */
export async function rebuildScope(db: Db, scope: Scope, owner: OwnerScope): Promise<{ plan: RebuildPlan; rebuilt: number; remaining: number; updated: number; inserted: number }> {
  const plan = await rebuildPlanFor(db, scope, owner);
  const ids = plan.rebuildable.slice(0, REBUILD_BATCH);
  const summary = ids.length ? await draftCards(db, ids) : null;
  return { plan, rebuilt: ids.length, remaining: plan.rebuildable.length - ids.length, updated: summary?.updated ?? 0, inserted: summary?.inserted ?? 0 };
}
