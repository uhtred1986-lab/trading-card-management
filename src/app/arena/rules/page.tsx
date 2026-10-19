import Link from "next/link";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { db } from "@/db";
import { ArenaHeader } from "@/components/arena/ArenaHeader";
import { chipClass, HealthLegend, HealthTabs, QueueRow, SummaryBar } from "@/components/arena/rules/CardQueue";
import { Groups, type GroupView } from "@/components/arena/rules/Groups";
import { RebuildBanner } from "@/components/arena/rules/RebuildBanner";
import { SelectLink } from "@/components/arena/rules/SelectLink";
import { Sparkline } from "@/components/arena/rules/Sparkline";
import { FIND_ID, QueueKeys } from "@/components/arena/rules/WorkbenchKeys";
import { PageHeader, Panel } from "@/components/ui";
import { currentScope, isArenaAdmin, requireSlPage } from "@/lib/auth";
import { groupCards, parseQueue, queueLink, queueParams, type GroupBy, type Queue } from "@/lib/arena/queue";
import { loadQueue, planRebuild, REBUILD_BATCH } from "@/lib/arena/queue-cards";
import { loadProgress, readSnapshots, recordSnapshot, type SnapshotRow } from "@/lib/arena/rules-progress";
import { ruleById, setsWithRules, type RuleFilter } from "@/lib/arena/rules-store";
import { recentBatches } from "../actions";

export const dynamic = "force-dynamic";

/**
 * The Rules queue: CARDS, in four tabs by how the engine plays them (Text only · Incomplete ·
 * Read, not checked · Done), over the owner's decks by default. Design: "Rules queue — desktop"
 * and "— phone". A card opens `/arena/rules/card/<id>?q=<this queue>`; `queue.ts` documents the
 * contract. `?rule=<id>` (old links) goes to that rule's card.
 *
 * Reading is `loadQueue` (queue-cards.ts): the scope's cards are classified in JS by `ruleHealth`,
 * then narrowed and paged here. The daily snapshot is written after the response is sent
 * (`after`), never by the GET.
 */
const PAGE = 100;

const GROUP_LABELS: Record<GroupBy, string> = { none: "None", reason: "By reason", wording: "Same wording", set: "By set" };

export default async function RulesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireSlPage();
  const qu = parseQueue(await searchParams);

  if (qu.rule) {
    const r = await ruleById(db, qu.rule);
    redirect(r ? `/arena/rules/card/${encodeURIComponent(r.cardId)}?skill=${r.id}` : "/arena/rules");
  }

  const owner = await currentScope();
  const [loaded, admin, sets, batches, history] = await Promise.all([
    loadQueue(db, qu, owner),
    isArenaAdmin(),
    setsWithRules(db),
    recentBatches().catch(() => []),
    readSnapshots(db).catch(() => [] as SnapshotRow[]),
  ]);
  const { resolved, health, group, counts, scopeCards, matched } = loaded;
  const scope = resolved.scope;
  const here: Queue = { ...qu, scope, health, group: qu.group };
  const link = (patch: Partial<Queue>) => queueLink(here, patch);
  const decksOf = (id: string) => resolved.decksOf.get(id)?.length ?? 0;

  // One snapshot a day, after the page has gone out; a pure redirect or a failed write costs nothing.
  const today = new Date().toISOString().slice(0, 10);
  if (history[history.length - 1]?.date !== today) {
    after(async () => {
      try {
        await recordSnapshot(db, await loadProgress(db, owner), today);
      } catch {
        /* the strip's trend is a convenience */
      }
    });
  }

  const plan = planRebuild(scopeCards);
  const filtered = !!(qu.q || qu.set);
  const pages = Math.ceil(matched.length / PAGE);
  const rows = matched.slice(qu.page * PAGE, (qu.page + 1) * PAGE);

  // ── grouped view ──────────────────────────────────────────────────────────
  let views: GroupView[] | null = null;
  if (group !== "none") {
    views = groupCards(matched, group, health).map((g) => ({
      g,
      all: link({ ...g.patch, health }),
      confirm: health === "unchecked" && group === "wording" && g.key ? ({ cardIds: g.cards.map((c) => c.cardId), status: "draft", pattern: g.key } satisfies RuleFilter) : null,
    }));
  }

  // ── controls ──────────────────────────────────────────────────────────────
  const scopeValue = scope.kind === "deck" ? `deck:${scope.id}` : scope.kind;
  const deckOptions = [
    { value: "decks", label: `My decks · ${resolved.decks.length}`, href: link({ scope: { kind: "decks" } }) },
    ...resolved.decks.map((d) => ({ value: `deck:${d.id}`, label: d.name, href: link({ scope: { kind: "deck", id: d.id } }) })),
    { value: "catalog", label: "Whole catalog", href: link({ scope: { kind: "catalog" } }) },
    ...(scope.kind === "game" ? [{ value: "game", label: `Fired in game ${scope.id}`, href: link({ scope }) }] : []),
  ];
  const setOptions = [{ value: "", label: "Every set", href: link({ set: "" }) }, ...sets.map((s) => ({ value: s.setCode, label: `${s.setCode} (${s.n})`, href: link({ set: s.setCode }) }))];
  if (qu.set && !sets.some((s) => s.setCode === qu.set)) setOptions.push({ value: qu.set, label: qu.set, href: link({ set: qu.set }) });
  const groupOptions = (Object.keys(GROUP_LABELS) as GroupBy[]).map((k) => ({ value: k, label: GROUP_LABELS[k], href: link({ group: k }) }));

  const active: { label: string; off: string }[] = [
    ...(qu.family ? [{ label: `reason: ${qu.family}`, off: link({ family: "" }) }] : []),
    ...(qu.source ? [{ label: qu.source === "compiler" ? "compiled" : qu.source === "claude" ? "Claude's" : "yours", off: link({ source: "" }) }] : []),
    ...(qu.mech ? [{ label: `unread: ${qu.mech}`, off: link({ mech: "" }) }] : []),
    ...(qu.reason === "diff" ? [{ label: "compiler reads it differently", off: link({ reason: "" }) }] : []),
    ...(qu.pattern ? [{ label: `wording ${qu.pattern.slice(0, 40)}`, off: link({ pattern: "" }) }] : []),
  ];
  // The find box is a form; everything else the queue says rides along as hidden fields.
  const carried = queueParams({ ...here, q: "", page: 0, rule: null });
  const scopeCounts = { "text-only": 0, incomplete: 0, unchecked: 0, done: 0 };
  for (const c of scopeCards) scopeCounts[c.health]++;
  const summaryLabel = filtered ? "cards in view" : scope.kind === "decks" ? "deck cards" : scope.kind === "deck" ? "cards in this deck" : scope.kind === "game" ? "cards the game fired" : "catalog cards";

  const empty =
    scope.kind === "decks" && resolved.decks.length === 0
      ? "No deck of yours yet, so there are no deck cards. Choose Whole catalog to work through the catalog."
      : scope.kind === "game" && scopeCards.length === 0
        ? "That game fired no skill that could be read back."
        : "No card here.";

  return (
    <div className="space-y-4">
      <ArenaHeader side="rules" />
      <QueueKeys />
      <PageHeader eyebrow="Arena · Rules" title="Rules" description="Every card in your decks, sorted by how the engine plays it. Open a card to read, fix and play-test its rules." />

      {resolved.deckUnavailable && (
        <p role="status" className="text-sm text-loss">
          That deck is not one of yours, so the queue shows all your decks.
        </p>
      )}

      {plan.cards > 0 && <RebuildBanner scope={scope} plan={plan} batch={REBUILD_BATCH} admin={admin} />}

      <Panel className="space-y-3 !p-4 sm:!px-5">
        <SummaryBar counts={scopeCounts} label={summaryLabel} />
        {scope.kind === "decks" && !filtered && <Sparkline points={history} />}
      </Panel>

      <Panel className="overflow-hidden !p-0">
        <div className="space-y-2 border-b border-space-700/70 p-3 sm:px-5 sm:py-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-space-400">Cards in</span>
            <Link href={link({ scope: { kind: "decks" } })} className={chipClass(scope.kind === "decks")}>
              My decks · {resolved.decks.length}
            </Link>
            <div className="min-w-0 flex-1 basis-44 sm:max-w-64 sm:flex-none">
              <SelectLink label="One deck" value={scopeValue} options={deckOptions} />
            </div>
            <Link href={link({ scope: { kind: "catalog" } })} className={chipClass(scope.kind === "catalog")}>
              Whole catalog
            </Link>
            {scope.kind === "game" && <span className={chipClass(true)}>Fired in game {scope.id}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <form action="/arena/rules" className="flex min-w-0 flex-1 basis-56 items-center gap-2">
              {[...carried.entries()].map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              <label htmlFor={FIND_ID} className="text-[11px] font-bold uppercase tracking-wider text-space-400">
                Find
              </label>
              <input id={FIND_ID} type="search" name="q" defaultValue={qu.q} placeholder="Card, id or wording" className="tap min-w-0 flex-1 rounded-lg border border-space-600 bg-space-950 px-3 text-sm text-space-100" />
              <button type="submit" className="ds-button-secondary tap">
                Go
              </button>
            </form>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-space-400">Group</span>
              <SelectLink label="Group by" value={group} options={groupOptions} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-space-400">Set</span>
              <SelectLink label="Set" value={qu.set} options={setOptions} />
            </div>
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
        </div>

        <HealthTabs health={health} counts={counts} href={(h) => link({ health: h, group: null, family: "", page: 0 })} />
        <HealthLegend />

        {views ? (
          <Groups views={views} queue={here} decksOf={decksOf} batches={batches} />
        ) : rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-space-300">{empty}</p>
        ) : (
          <ol>
            {rows.map((c) => (
              <QueueRow key={c.cardId} card={c} queue={here} decks={decksOf(c.cardId)} />
            ))}
          </ol>
        )}

        {!views && (
          <div className="flex items-center justify-between gap-2 border-t border-space-700/70 p-2 text-xs text-space-400">
            <Link href={link({ page: qu.page > 1 ? qu.page - 1 : 0 })} className={`tap flex items-center rounded px-3 ${qu.page === 0 ? "pointer-events-none opacity-30" : "hover:text-ki-300"}`}>
              ← previous
            </Link>
            <span>
              {matched.length === 0 ? "0 cards" : `${qu.page * PAGE + 1}–${Math.min(matched.length, (qu.page + 1) * PAGE)} of ${matched.length} card${matched.length === 1 ? "" : "s"}`}
            </span>
            <Link href={link({ page: qu.page + 1 })} className={`tap flex items-center rounded px-3 ${qu.page + 1 >= pages ? "pointer-events-none opacity-30" : "hover:text-ki-300"}`}>
              next →
            </Link>
          </div>
        )}
      </Panel>
    </div>
  );
}
