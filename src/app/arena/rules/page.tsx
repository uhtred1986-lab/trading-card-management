import Link from "next/link";
import { db } from "@/db";
import { ConfirmAll } from "@/components/arena/rules/ConfirmAll";
import { ArenaHeader } from "@/components/arena/ArenaHeader";
import { Groups, type GroupView } from "@/components/arena/rules/Groups";
import { SelectLink } from "@/components/arena/rules/SelectLink";
import { FIND_ID } from "@/components/arena/rules/WorkbenchKeys";
import { Choice, StateSegments, Workbench, chipClass, type QueueRow } from "@/components/arena/rules/Workbench";
import { PHRASING_ONLY } from "@/lib/arena/gaps";
import { firedInGame } from "@/lib/arena/fired";
import { deckCardSets } from "@/lib/arena/readiness";
import { defaultState, neighbours, parseQueue, queueLink, queueParams, type GroupBy, type Queue } from "@/lib/arena/queue";
import { countRules, draftPatterns, openPatterns, reasonGroups, ruleById, ruleIdsFor, setGroups, setsWithRules, statusCounts, worklistPage, type PatternGroup, type QueueGroup, type RuleFilter, type RuleStatus } from "@/lib/arena/rules-store";
import { listDecks } from "@/lib/decks/queries";
import { lastSyncRuns } from "@/lib/sync";
import { recentBatches } from "../actions";
import { buildRecord, historyOf, probeScenarios } from "./record";

export const dynamic = "force-dynamic";

/**
 * The one queue of the Rules Workbench (issue #360, docs/arena-home-spec.md §2):
 * *Cards in* (all decks, one deck, the whole catalog, or what a game fired),
 * a state, *Group by*, and a find box. `/arena/rules/all` and `/patterns` are
 * redirects into it.
 *
 * Decks are read without a `viewer` on purpose (owner's ruling on #364,
 * 30 Sep 2026): a rule belongs to its card, so Rules covers every deck the
 * arena can play, whoever owns it. Play (`/arena`) lists the viewer's own.
 */
const PAGE = 200;

const GROUP_LABELS: { key: GroupBy; label: string }[] = [
  { key: "none", label: "Nothing" },
  { key: "wording", label: "Same wording" },
  { key: "reason", label: "Reason" },
  { key: "set", label: "Set" },
];

/** A group's link into the ungrouped list, as a change to the queue. */
function patchOf(patch: Record<string, string>): Partial<Queue> {
  const out: Partial<Queue> = { group: "none" };
  if (patch.set) out.set = patch.set;
  if (patch.source === "claude") out.source = "claude";
  if (patch.reason === "diff" || patch.reason === "cost") out.reason = patch.reason;
  if (patch.mech) out.mech = patch.mech;
  if (patch.pattern) out.pattern = patch.pattern;
  if (patch.state) out.state = patch.state as RuleStatus;
  return out;
}

export default async function RulesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const qu = parseQueue(await searchParams);

  // Every deck the arena can play, whoever owns it (see the note above).
  const decks = (await listDecks(db, { game: "dbs" })).filter((d) => d.leader && d.mainCount >= 50);
  // One query for every deck's cards (readiness.ts), not one per deck.
  const deckCards = await deckCardSets(db, decks.map((d) => d.id));
  const decksOf = new Map<string, string[]>();
  for (const d of decks) {
    for (const id of deckCards.get(d.id) ?? []) decksOf.set(id, [...(decksOf.get(id) ?? []), d.name]);
  }
  const allDeckCards = [...decksOf.keys()];

  // Cards in: a deck that is gone falls back to all decks.
  const scope = qu.scope.kind === "deck" && !deckCards.has(qu.scope.id) ? ({ kind: "decks" } as const) : qu.scope;
  const fired = scope.kind === "game" ? await firedInGame(db, scope.id) : [];
  const firedIds = scope.kind === "game" ? await ruleIdsFor(db, fired) : [];
  const firstFired = new Map(fired.map((f, i) => [`${f.cardId}\u0000${f.skillIndex}`, i]));

  const base: RuleFilter = {
    cardIds: scope.kind === "decks" ? allDeckCards : scope.kind === "deck" ? [...deckCards.get(scope.id)!] : undefined,
    ruleIds: scope.kind === "game" ? firedIds : undefined,
    setCode: qu.set || undefined,
    source: qu.source || undefined,
    pattern: qu.pattern || undefined,
    mechanism: qu.mech || undefined,
    q: qu.q || undefined,
    compilerDiff: qu.reason === "diff" || undefined,
    costUnknown: qu.reason === "cost" || undefined,
  };

  const counts = await statusCounts(db, base);
  // A mechanism is a property of an open rule, so asking for one asks for the open state.
  const state: RuleStatus = qu.mech ? "open" : (qu.state ?? defaultState(counts));
  const here: Queue = { ...qu, scope };
  const link = (patch: Partial<Queue>) => queueLink(here, patch);
  const filter: RuleFilter = { ...base, status: state };

  const [inDecks, catalog, syncs, batches, sets] = await Promise.all([countRules(db, allDeckCards), countRules(db), lastSyncRuns(db), recentBatches(), setsWithRules(db)]);
  const lastSync = syncs.latest.get("catalog")?.summary as { stillOpen?: number; cardsNew?: number; cardsChanged?: number } | null | undefined;

  // ── the list, or its groups ───────────────────────────────────────────────
  let rows: QueueRow[] = [];
  let total = 0;
  let views: GroupView[] | null = null;
  let groupNote: string | undefined;

  if (qu.group === "none") {
    let page;
    if (scope.kind === "catalog") {
      page = await worklistPage(db, filter, { limit: PAGE, offset: qu.page * PAGE });
      rows = page.rows.map((r) => ({ ...r, decks: decksOf.get(r.cardId) ?? [] }));
    } else {
      // A scope of decks or of one game is small enough to sort here: a card in more decks first,
      // and what a game fired in the order it fired it.
      page = await worklistPage(db, filter, { limit: 100000, offset: 0 });
      const withDecks = page.rows.map((r) => ({ ...r, decks: decksOf.get(r.cardId) ?? [] }));
      const order = (r: QueueRow) => firstFired.get(`${r.cardId}\u0000${r.skillIndex}`) ?? Infinity;
      withDecks.sort((a, b) => (scope.kind === "game" ? order(a) - order(b) : 0) || b.decks.length - a.decks.length || a.name.localeCompare(b.name) || a.skillIndex - b.skillIndex);
      rows = withDecks.slice(qu.page * PAGE, (qu.page + 1) * PAGE);
    }
    total = page.total;
  } else {
    const confirmable = state === "draft";
    const draftFilter: RuleFilter = { ...filter, status: "draft" };
    if (qu.group === "wording") {
      const groups: PatternGroup[] = state === "open" ? await openPatterns(db, base) : await draftPatterns(db, 60, filter);
      if (groups.length === 60 && state !== "open") groupNote = "the 60 with most rules";
      views = groups.map((g) => ({
        g,
        confirm: confirmable && g.kind === "draft" ? { ...draftFilter, pattern: g.key } : null,
        all: link(g.kind === "open" ? { group: "none", mech: g.key, state: "open" } : { group: "none", pattern: g.key }),
      }));
    } else {
      const groups: QueueGroup[] = qu.group === "reason" ? await reasonGroups(db, filter) : await setGroups(db, filter);
      views = groups.map((g) => ({
        g,
        confirm: confirmable && g.confirm ? { ...draftFilter, ...g.confirm } : null,
        all: link(patchOf(g.patch)),
      }));
    }
  }

  // ── the record ────────────────────────────────────────────────────────────
  // A rule opened from a group, or one past the page, is not among `rows`; it is read by id.
  const picked = qu.group === "none" ? (rows.find((r) => r.id === qu.rule) ?? (qu.rule ? await ruleById(db, qu.rule) : null) ?? rows[0] ?? null) : null;
  const selected = picked ? { ...picked, decks: decksOf.get(picked.cardId) ?? [] } : null;
  // Where the keys, Skip and Confirm go from here: along the rows as the queue lists them.
  const around = neighbours(rows.map((r) => r.id), selected?.id ?? null);
  const hrefOf = (id: number | null) => (id == null ? null : link({ rule: id }));
  const nav = { prev: hrefOf(around.prev), next: hrefOf(around.next), skip: hrefOf(around.skip), after: hrefOf(around.after) ?? link({ rule: null }) };
  const record = selected ? await buildRecord(db, selected, selected.decks) : null;
  const probe = selected ? await probeScenarios(db, selected) : null;

  // ── controls ──────────────────────────────────────────────────────────────
  const scopeValue = scope.kind === "deck" ? `deck:${scope.id}` : scope.kind;
  const scopeOptions = [
    { value: "decks", label: `All decks (${decks.length})`, href: link({ scope: { kind: "decks" } }) },
    ...decks.map((d) => ({ value: `deck:${d.id}`, label: d.name, href: link({ scope: { kind: "deck", id: d.id } }) })),
    { value: "catalog", label: "Whole catalog", href: link({ scope: { kind: "catalog" } }) },
    ...(scope.kind === "game" ? [{ value: "game", label: `Fired in game ${scope.id}`, href: link({ scope }) }] : []),
  ];
  const setOptions = [{ value: "", label: "Every set", href: link({ set: "" }) }, ...sets.map((s) => ({ value: s.setCode, label: `${s.setCode} (${s.n})`, href: link({ set: s.setCode }) }))];
  if (qu.set && !sets.some((s) => s.setCode === qu.set)) setOptions.push({ value: qu.set, label: qu.set, href: link({ set: qu.set }) });

  const active: { label: string; off: string }[] = [
    ...(qu.source ? [{ label: qu.source === "compiler" ? "compiled" : qu.source === "claude" ? "Claude's" : "yours", off: link({ source: "" }) }] : []),
    ...(qu.mech ? [{ label: qu.mech === PHRASING_ONLY ? "phrasing only" : `unread: ${qu.mech}`, off: link({ mech: "", state: null }) }] : []),
    ...(qu.reason ? [{ label: qu.reason === "diff" ? "compiler reads it differently" : "specified cost unknown", off: link({ reason: "" }) }] : []),
    ...(qu.pattern ? [{ label: `wording ${qu.pattern}`, off: link({ pattern: "" }) }] : []),
  ];

  // The find box is a form; everything else the queue says rides along as hidden fields.
  const carried = queueParams({ ...here, q: "", page: 0, rule: null });

  const drafts = state === "draft" ? counts.draft : 0;
  const pages = Math.ceil(total / PAGE);

  const head = (
    <>
      <div className="flex items-center gap-1.5">
        <span className="w-14 shrink-0 text-[10px] uppercase tracking-wider text-space-500">Cards in</span>
        <SelectLink label="Cards in" value={scopeValue} options={scopeOptions} />
      </div>
      <StateSegments state={state} counts={counts} href={(s) => link({ state: s })} />
      <Choice label="Group by" value={qu.group} options={GROUP_LABELS} href={(key) => link({ group: key })} />
      <div className="flex items-center gap-1.5">
        <span className="w-14 shrink-0 text-[10px] uppercase tracking-wider text-space-500">Set</span>
        <SelectLink label="Set" value={qu.set} options={setOptions} />
      </div>
      {active.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {active.map((a) => (
            <Link key={a.label} href={a.off} className={chipClass(true)} aria-label={`remove filter ${a.label}`}>
              {a.label} ×
            </Link>
          ))}
        </div>
      )}
      <form action="/arena/rules" className="flex gap-1">
        {[...carried.entries()].map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <input id={FIND_ID} name="q" defaultValue={qu.q} placeholder="find a card…" aria-label="Find a card" className="tap min-w-0 flex-1 rounded-md border border-space-600 bg-space-950 px-2 py-1 text-xs text-space-100" />
        <button type="submit" className="tap rounded-md border border-space-600 px-2 py-1 text-xs text-space-100 hover:border-space-300">
          go
        </button>
      </form>
      <ConfirmAll filter={{ ...filter, status: "draft" }} drafts={drafts} batches={batches} />
    </>
  );

  const footer =
    pages > 1 ? (
      <div className="flex items-center justify-between gap-2 border-t border-space-700/70 p-2 text-[11px] text-space-400">
        <Link href={link({ page: qu.page > 1 ? qu.page - 1 : 0 })} className={`tap rounded px-2 py-1 ${qu.page === 0 ? "pointer-events-none opacity-30" : "hover:text-ki-300"}`}>
          ← previous
        </Link>
        <span>
          {qu.page * PAGE + 1}–{Math.min(total, (qu.page + 1) * PAGE)} of {total}
        </span>
        <Link href={link({ page: qu.page + 1 })} className={`tap rounded px-2 py-1 ${qu.page + 1 >= pages ? "pointer-events-none opacity-30" : "hover:text-ki-300"}`}>
          next →
        </Link>
      </div>
    ) : (
      <p className="border-t border-space-700/70 p-2 text-center text-[11px] text-space-500">
        {total} rule{total === 1 ? "" : "s"}
      </p>
    );

  const nothingToPlay = scope.kind === "decks" && decks.length === 0;

  return (
    <div className="space-y-3">
      <ArenaHeader side="rules" kpis={{ inDecks, catalog, openSinceSync: lastSync && (lastSync.cardsNew || lastSync.cardsChanged) ? (lastSync.stillOpen ?? 0) : null }} />

      <Workbench
        rows={rows}
        record={record}
        history={selected ? historyOf(selected) : []}
        mechanism={record?.mechanism ?? null}
        probe={probe}
        href={(id) => link({ rule: id })}
        empty={nothingToPlay ? "No deck the arena can play yet — a deck needs a leader and 50 cards." : scope.kind === "game" && fired.length === 0 ? "That game fired no skill that could be read back." : "Nothing here."}
        footer={footer}
        head={head}
        nav={nav}
        grouped={views ? <Groups views={views} open={(id) => link({ group: "none", rule: id })} batches={[]} note={groupNote} /> : undefined}
      />
    </div>
  );
}
