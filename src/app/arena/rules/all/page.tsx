import Link from "next/link";
import { db } from "@/db";
import { ConfirmAll } from "@/components/arena/rules/ConfirmAll";
import { RulesHeader } from "@/components/arena/rules/RulesHeader";
import { Segments, Workbench, chipClass } from "@/components/arena/rules/Workbench";
import { MECHANISMS, PHRASING_ONLY } from "@/lib/arena/gaps";
import { deckInputFor } from "@/lib/arena/load";
import { countRules, setsWithRules, statusCounts, worklistPage, type RuleFilter, type RuleSource, type RuleStatus } from "@/lib/arena/rules-store";
import { listDecks } from "@/lib/decks/queries";
import { recentBatches } from "../../actions";
import { buildRecord, historyOf, probeScenarios } from "../record";

export const dynamic = "force-dynamic";

/**
 * The same worklist over the whole catalog: 13,563 rules, filtered by set,
 * source and mechanism, and confirmed in bulk.
 *
 * A page of rows rather than all of them — the decks page can hold its whole
 * list in memory, this one cannot — so the count under the list is what the
 * filter matches, and "Confirm all drafts in view" means exactly that filter,
 * not the 200 rows on screen.
 */
const PAGE = 200;
const STATUSES: RuleStatus[] = ["open", "draft", "confirmed", "corrected"];
const SOURCES: RuleSource[] = ["compiler", "claude", "user"];
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function AllRulesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const seg = one(sp.seg) || "all";
  const setCode = one(sp.set);
  const mech = one(sp.mech);
  const source = one(sp.source);
  const pattern = one(sp.pattern);
  const q = one(sp.q).trim();
  const page = Math.max(0, Number(one(sp.page)) || 0);
  const ruleParam = Number(one(sp.rule)) || null;

  const filter: RuleFilter = {
    status: STATUSES.includes(seg as RuleStatus) ? (seg as RuleStatus) : undefined,
    setCode: setCode || undefined,
    source: SOURCES.includes(source as RuleSource) ? (source as RuleSource) : undefined,
    pattern: pattern || undefined,
    mechanism: mech || undefined,
    q: q || undefined,
  };

  const [{ rows, total }, counts, sets, inDecks, catalog, batches] = await Promise.all([
    worklistPage(db, filter, { limit: PAGE, offset: page * PAGE }),
    statusCounts(db, filter),
    setsWithRules(db),
    deckCounts(),
    countRules(db),
    recentBatches(),
  ]);

  const selected = rows.find((r) => r.id === ruleParam) ?? rows[0] ?? null;
  const record = selected ? await buildRecord(db, selected, []) : null;
  const probe = selected ? await probeScenarios(db, selected) : null;
  const segCounts = { all: counts.open + counts.draft + counts.confirmed + counts.corrected, ...counts };

  const href = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams();
    const cur: Record<string, string> = { seg, set: setCode, mech, source, pattern, q, page: page ? String(page) : "", rule: ruleParam ? String(ruleParam) : "" };
    for (const [k, v] of Object.entries({ ...cur, ...patch })) if (v) params.set(k, v);
    const s = params.toString();
    return `/arena/rules/all${s ? `?${s}` : ""}`;
  };
  // Changing what is selected keeps the page; changing the filter never does.
  const refilter = (patch: Record<string, string | null>) => href({ ...patch, page: null, rule: null });

  const pages = Math.ceil(total / PAGE);
  const drafts = filter.mechanism ? 0 : seg === "all" || seg === "draft" ? (seg === "draft" ? total : counts.draft) : 0;

  return (
    <div className="space-y-3">
      <RulesHeader tab="/arena/rules/all" inDecks={inDecks} catalog={catalog} />
      <Workbench
        rows={rows}
        record={record}
        history={selected ? historyOf(selected) : []}
        mechanism={record?.mechanism ?? null}
        probe={probe}
        href={(id) => href({ rule: String(id) })}
        empty="No rule matches that."
        footer={
          pages > 1 ? (
            <div className="flex items-center justify-between gap-2 border-t border-space-700/70 p-2 text-[11px] text-space-400">
              <Link href={href({ page: page > 1 ? String(page - 1) : null, rule: null })} className={`tap rounded px-2 py-1 ${page === 0 ? "pointer-events-none opacity-30" : "hover:text-ki-300"}`}>
                ← newer
              </Link>
              <span>
                {page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} of {total}
              </span>
              <Link href={href({ page: String(page + 1), rule: null })} className={`tap rounded px-2 py-1 ${page + 1 >= pages ? "pointer-events-none opacity-30" : "hover:text-ki-300"}`}>
                older →
              </Link>
            </div>
          ) : (
            <p className="border-t border-space-700/70 p-2 text-center text-[11px] text-space-500">{total} rule{total === 1 ? "" : "s"}</p>
          )
        }
        head={
          <>
            <Segments seg={seg} counts={segCounts} href={(key) => refilter({ seg: key })} />
            <div className="flex flex-wrap gap-1.5">
              {SOURCES.map((s) => (
                <Link key={s} href={refilter({ source: source === s ? null : s })} className={chipClass(source === s)}>
                  {s === "compiler" ? "compiled" : s === "claude" ? "Claude's" : "yours"}
                </Link>
              ))}
              {[...MECHANISMS.map((m) => m.key), PHRASING_ONLY].map((key) => (
                <Link key={key} href={refilter({ mech: mech === key ? null : key, seg: mech === key ? seg : "open" })} className={chipClass(mech === key)}>
                  {key === PHRASING_ONLY ? "phrasing only" : key}
                </Link>
              ))}
            </div>
            {pattern && (
              <p className="truncate text-[11px] text-space-400">
                pattern <code className="text-space-200">{pattern}</code>{" "}
                <Link href={refilter({ pattern: null })} className="text-space-500 hover:text-loss">
                  ×
                </Link>
              </p>
            )}
            <form action="/arena/rules/all" className="flex flex-wrap gap-1">
              {seg !== "all" && <input type="hidden" name="seg" value={seg} />}
              {mech && <input type="hidden" name="mech" value={mech} />}
              {source && <input type="hidden" name="source" value={source} />}
              {pattern && <input type="hidden" name="pattern" value={pattern} />}
              <select name="set" defaultValue={setCode} className="rounded-md border border-space-600 bg-space-950 px-1 py-1 text-xs text-space-100">
                <option value="">every set</option>
                {sets.map((s) => (
                  <option key={s.setCode} value={s.setCode}>
                    {s.setCode} ({s.n})
                  </option>
                ))}
              </select>
              <input name="q" defaultValue={q} placeholder="find a card…" className="min-w-0 flex-1 rounded-md border border-space-600 bg-space-950 px-2 py-1 text-xs text-space-100" />
              <button type="submit" className="tap rounded-md border border-space-600 px-2 py-1 text-xs text-space-100 hover:border-space-300">
                go
              </button>
            </form>
            <ConfirmAll filter={{ ...filter, status: "draft" }} drafts={drafts} batches={batches} />
          </>
        }
      />
    </div>
  );
}

/** The KPI row is about your decks, on this page as on the other. */
async function deckCounts() {
  const decks = (await listDecks(db, { game: "dbs" })).filter((d) => d.leader && d.mainCount >= 50);
  const ids = new Set<string>();
  for (const d of decks) {
    const input = await deckInputFor(db, d.id);
    if (input) for (const id of input.cardIds) ids.add(id);
  }
  return countRules(db, [...ids]);
}
