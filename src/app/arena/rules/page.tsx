import Link from "next/link";
import { db } from "@/db";
import { RuleRecord, type RecordProps } from "@/components/arena/rules/RuleRecord";
import { SKILL_LABELS } from "@/lib/arena/beats";
import { describeScript, type Op } from "@/lib/arena/engine";
import { describeCond, type Cond } from "@/lib/arena/engine/script";
import type { CostRecord } from "@/lib/arena/draft";
import { describeTrigger, mechanismNeeds, mechanismOf, PHRASING_ONLY } from "@/lib/arena/gaps";
import { deckInputFor } from "@/lib/arena/load";
import { countRules, siblingsOf, worklist, type CompilerDiff, type RuleStatus, type WorklistRow } from "@/lib/arena/rules-store";
import { listDecks } from "@/lib/decks/queries";

export const dynamic = "force-dynamic";

type Row = WorklistRow & { decks: string[] };

const SEGMENTS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "draft", label: "Drafts" },
  { key: "confirmed", label: "Confirmed" },
  { key: "corrected", label: "Corrected" },
];
const ORDER: Record<RuleStatus, number> = { open: 0, draft: 1, corrected: 2, confirmed: 3 };
const GROUP: Record<RuleStatus, string> = {
  open: "Open — the engine plays these as blank",
  draft: "Drafts — read by the compiler, not yet confirmed",
  corrected: "Corrected — a program you or Claude set",
  confirmed: "Confirmed",
};
const DOT: Record<RuleStatus, string> = { open: "bg-loss", draft: "bg-dbs-blue", confirmed: "bg-gain", corrected: "bg-ki-500" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** The parsed price as a sentence, for the COST row. */
function costSentence(cost: CostRecord | null): string | null {
  if (!cost) return null;
  const parts: string[] = [];
  for (const [c, n] of Object.entries(cost.orbs)) parts.push(`${n} ${c === "any" ? "energy" : `${c} energy`}`);
  for (const either of cost.either) parts.push(`1 ${either.join(" or ")} energy`);
  if (cost.marker != null) parts.push(cost.marker >= 0 ? `add ${cost.marker} marker${cost.marker === 1 ? "" : "s"}` : `remove ${-cost.marker} marker${cost.marker === -1 ? "" : "s"}`);
  if (cost.burst != null) parts.push(`Burst ${cost.burst}`);
  if (cost.spiritBoost != null) parts.push(`Spirit Boost ${cost.spiritBoost}`);
  if (cost.condition) parts.push(`if ${describeCond(cost.condition)}`);
  if (cost.program) parts.push(describeScript(cost.program));
  else if (cost.text && !cost.condition) parts.push(cost.text);
  return parts.join(" · ") || null;
}

/** The right pane's History, read off the row rather than a log table. */
function historyOf(r: WorklistRow): { when: string; what: string }[] {
  const day = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "");
  const out: { when: string; what: string }[] = [];
  const diff = r.compilerDiff as CompilerDiff | null;
  if (diff) out.push({ when: day(diff.at), what: `the compiler now reads this differently: “${describeScript(diff.ops) || "nothing"}”${diff.unread.length ? ` (unread: ${diff.unread.join(" | ")})` : ""}` });
  if (r.confirmedAt) out.push({ when: day(r.confirmedAt), what: "confirmed by you" });
  if (r.source !== "compiler" || r.status === "corrected") out.push({ when: day(r.updatedAt), what: r.source === "claude" ? `program written by Claude · v${r.version}` : `corrected by hand · v${r.version}` });
  else if (r.version > 1) out.push({ when: day(r.updatedAt), what: `re-drafted by the compiler · v${r.version}` });
  out.push({ when: day(r.createdAt), what: r.unread.length ? `drafted: ${r.unread.length} clause${r.unread.length === 1 ? "" : "s"} unread` : `drafted by the compiler${r.pattern ? ` · pattern ${r.pattern}` : ""}` });
  return out;
}

export default async function RulesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const seg = one(sp.seg) || "all";
  const deckParam = one(sp.deck);
  const mech = one(sp.mech);
  const claudeOnly = one(sp.claude) === "1";
  const q = one(sp.q).trim().toLowerCase();
  const ruleParam = Number(one(sp.rule)) || null;

  // The cards in the decks the arena can play: the worklist's default scope.
  const decks = (await listDecks(db, { game: "dbs" })).filter((d) => d.leader && d.mainCount >= 50);
  const deckCards = new Map<number, Set<string>>();
  const decksOf = new Map<string, string[]>();
  for (const d of decks) {
    const input = await deckInputFor(db, d.id);
    if (!input) continue;
    const ids = new Set(input.cardIds);
    deckCards.set(d.id, ids);
    for (const id of ids) decksOf.set(id, [...(decksOf.get(id) ?? []), d.name]);
  }
  const allDeckCards = [...decksOf.keys()];
  const scope = deckParam && deckCards.has(Number(deckParam)) ? [...deckCards.get(Number(deckParam))!] : allDeckCards;

  const rows: Row[] = (await worklist(db, scope)).map((r) => ({ ...r, decks: decksOf.get(r.cardId) ?? [] }));
  const mechanisms = new Map<string, number>();
  for (const r of rows) if (r.status === "open") mechanisms.set(mechanismOf(r.unread[0] ?? ""), (mechanisms.get(mechanismOf(r.unread[0] ?? "")) ?? 0) + 1);
  const claudeDrafted = rows.filter((r) => r.source === "claude" && r.status === "draft").length;

  const shown = rows
    .filter((r) => seg === "all" || r.status === seg)
    .filter((r) => !mech || (r.status === "open" && mechanismOf(r.unread[0] ?? "") === mech))
    .filter((r) => !claudeOnly || (r.source === "claude" && r.status === "draft"))
    .filter((r) => !q || r.name.toLowerCase().includes(q) || r.cardId.toLowerCase().includes(q) || r.printed.toLowerCase().includes(q))
    .sort((a, b) => ORDER[a.status as RuleStatus] - ORDER[b.status as RuleStatus] || b.decks.length - a.decks.length || a.name.localeCompare(b.name) || a.skillIndex - b.skillIndex);
  const counts = Object.fromEntries(SEGMENTS.map((s) => [s.key, s.key === "all" ? rows.length : rows.filter((r) => r.status === s.key).length]));

  const [inDecks, catalog] = await Promise.all([countRules(db, allDeckCards), countRules(db)]);
  const readable = (c: Record<RuleStatus, number>) => {
    const total = c.open + c.draft + c.confirmed + c.corrected;
    return total ? `${(Math.round(((total - c.open) / total) * 1000) / 10).toFixed(1)} %` : "—";
  };

  const selected = shown.find((r) => r.id === ruleParam) ?? shown[0] ?? null;
  let record: RecordProps | null = null;
  let mechanism: { key: string; needs: string } | null = null;
  if (selected) {
    const siblings = await siblingsOf(db, selected);
    const key = selected.status === "open" ? mechanismOf(selected.unread[0] ?? "") : null;
    mechanism = key ? { key, needs: mechanismNeeds(key) } : null;
    const diff = selected.compilerDiff as CompilerDiff | null;
    record = {
      id: selected.id,
      cardId: selected.cardId,
      name: selected.name,
      setCode: selected.setCode,
      side: selected.side === "back" ? "back" : "front",
      skillIndex: selected.skillIndex,
      kind: SKILL_LABELS[selected.kind] ?? selected.kind,
      permanent: selected.kind === "permanent",
      printed: selected.printed,
      trigger: describeTrigger(selected.trigger ?? []) || (selected.kind === "permanent" ? "while this card is where the skill is valid" : selected.kind.startsWith("activate") ? "when you activate it" : selected.kind.startsWith("counter") ? "at the counter timing the tag names" : "the engine knows no moment for this wording"),
      cost: costSentence(selected.cost as CostRecord | null),
      cond: (selected.cond as Cond | null) ?? null,
      ops: (selected.ops as Op[]) ?? [],
      unread: selected.unread,
      status: selected.status as RuleStatus,
      source: selected.source as "compiler" | "claude" | "user",
      version: selected.version,
      explanation: selected.explanation,
      pattern: selected.pattern,
      reads: selected.reads,
      decks: selected.decks,
      siblings,
      compilerDiff: diff ? { reads: describeScript(diff.ops, { permanent: selected.kind === "permanent" }) || "nothing", unread: diff.unread, at: diff.at.slice(0, 10) } : null,
      mechanism,
    };
  }

  const href = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams();
    const cur: Record<string, string> = { seg, deck: deckParam, mech, claude: claudeOnly ? "1" : "", q, rule: ruleParam ? String(ruleParam) : "" };
    for (const [k, v] of Object.entries({ ...cur, ...patch })) if (v) params.set(k, v);
    const s = params.toString();
    return `/arena/rules${s ? `?${s}` : ""}`;
  };
  const chip = (on: boolean) => `tap rounded-full border px-2.5 py-0.5 text-[11px] ${on ? "border-ki-500 text-ki-300" : "border-space-600 text-space-300 hover:text-space-100"}`;

  // Group headings are decided before rendering, once per change of status.
  const items = shown.map((r, i) => ({ r, head: i === 0 || shown[i - 1].status !== r.status }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-lg font-semibold tracking-tight text-space-50">
          Arena <span className="text-ki-300">/ Rules</span>
        </h1>
        <div className="ml-auto flex flex-wrap gap-4 text-right">
          <Kpi n={inDecks.open} label="open in your decks" tone={inDecks.open ? "text-loss" : ""} />
          <Kpi n={inDecks.draft} label="drafts to confirm" tone={inDecks.draft ? "text-ki-300" : ""} />
          <Kpi n={readable(inDecks)} label="your decks readable" />
          <Kpi n={readable(catalog)} label="catalog readable" />
        </div>
        <div className="flex gap-3 text-xs">
          <Link href="/arena/backlog" className="text-space-300 hover:text-ki-300">
            backlog
          </Link>
          <Link href="/arena/rules/keywords" className="text-space-300 hover:text-ki-300">
            keywords
          </Link>
          <Link href="/arena" className="text-space-300 hover:text-ki-300">
            ← Arena
          </Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-space-700 p-6 text-center text-sm text-space-300">
          {decks.length === 0
            ? "No deck the arena can play yet — a deck needs a leader and 50 cards."
            : "No rules drafted for the cards in your decks yet. Run `npm run arena:draft` once; after that every new card is drafted at catalog sync."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[300px_minmax(0,1fr)_280px] lg:items-start">
          {/* ── worklist ── */}
          <aside className="rounded-xl border border-space-700/70 bg-space-900/50 lg:sticky lg:top-3 lg:max-h-[calc(100vh-6rem)] lg:overflow-auto">
            <div className="sticky top-0 z-10 space-y-2 border-b border-space-700/70 bg-space-900 p-3">
              <div className="flex rounded-lg bg-space-950 p-0.5 text-[11px] font-semibold">
                {SEGMENTS.map((s) => (
                  <Link key={s.key} href={href({ seg: s.key, rule: null })} className={`tap flex-1 rounded-md px-1 py-1 text-center ${seg === s.key ? "bg-space-800 text-space-50" : "text-space-400 hover:text-space-100"}`}>
                    {s.label} <span className="text-space-500">{counts[s.key]}</span>
                  </Link>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Link href={href({ deck: null, rule: null })} className={chip(!deckParam)}>
                  My decks
                </Link>
                {decks.map((d) => (
                  <Link key={d.id} href={href({ deck: deckParam === String(d.id) ? null : String(d.id), rule: null })} className={chip(deckParam === String(d.id))}>
                    {d.name}
                  </Link>
                ))}
                {claudeDrafted > 0 && (
                  <Link href={href({ claude: claudeOnly ? null : "1", rule: null })} className={chip(claudeOnly)}>
                    Claude drafted — unconfirmed ({claudeDrafted})
                  </Link>
                )}
                {[...mechanisms.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([key, n]) => (
                    <Link key={key} href={href({ mech: mech === key ? null : key, seg: "open", rule: null })} className={chip(mech === key)}>
                      {key === PHRASING_ONLY ? "phrasing only" : `mechanism: ${key}`} ({n})
                    </Link>
                  ))}
              </div>
              <form action="/arena/rules" className="flex gap-1">
                {seg !== "all" && <input type="hidden" name="seg" value={seg} />}
                {deckParam && <input type="hidden" name="deck" value={deckParam} />}
                <input name="q" defaultValue={q} placeholder="find a card…" className="w-full rounded-md border border-space-600 bg-space-950 px-2 py-1 text-xs text-space-100" />
              </form>
            </div>
            <ol>
              {shown.length === 0 && <li className="p-4 text-center text-xs text-space-400">Nothing here.</li>}
              {items.map(({ r, head }) => {
                const on = selected?.id === r.id;
                return (
                  <li key={r.id}>
                    {head && <div className="px-3 pb-1 pt-3 text-[11px] font-semibold text-space-500">{GROUP[r.status as RuleStatus]}</div>}
                    <Link href={href({ rule: String(r.id) })} scroll={false} className={`grid grid-cols-[10px_minmax(0,1fr)_auto] items-start gap-2 border-b border-space-800 px-3 py-2 hover:bg-space-800/60 ${on ? "bg-space-800/80 shadow-[inset_3px_0_0_var(--color-ki-500)]" : ""}`}>
                      <span className={`mt-1.5 h-2.5 w-2.5 rounded-full ${DOT[r.status as RuleStatus]}`} />
                      <span className="min-w-0">
                        <span className="text-sm font-medium text-space-100">{r.name}</span>
                        <span className="ml-1.5 font-mono text-[10px] text-space-500">{r.cardId}</span>
                        <span className="block truncate text-[11px] text-space-400">{r.status === "open" ? `could not read: ${r.unread.join(" | ")}` : r.reads || "nothing"}</span>
                      </span>
                      <span className="text-[10px] text-space-500">[{SKILL_LABELS[r.kind] ?? r.kind}]</span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </aside>

          {/* ── record ── */}
          <main className="min-w-0">{record ? <RuleRecord key={record.id} {...record} /> : <p className="p-6 text-center text-sm text-space-400">Pick a rule on the left.</p>}</main>

          {/* ── right pane ── */}
          <aside className="space-y-3 lg:sticky lg:top-3">
            <section className="rounded-xl border border-space-700/70 bg-space-900/50 p-3">
              <h2 className="text-xs font-semibold text-space-300">Probe — what actually happens</h2>
              <p className="mt-2 text-[11px] text-space-500">
                Not built yet (phase 3). A probe will run the pure engine on a synthetic state built for this rule&rsquo;s trigger and print the log as Input → Applied rule → Result → Assumptions, so a
                rule can be checked without playing a game.
              </p>
            </section>
            {mechanism && (
              <section className="rounded-xl border border-space-700/70 bg-space-900/50 p-3">
                <h2 className="text-xs font-semibold text-space-300">What it would need</h2>
                <p className="mt-1 text-sm text-space-100">{mechanism.key}</p>
                <p className="mt-1 text-[11px] text-space-400">{mechanism.needs}</p>
              </section>
            )}
            {selected && (
              <section className="rounded-xl border border-space-700/70 bg-space-900/50 p-3">
                <h2 className="text-xs font-semibold text-space-300">History</h2>
                <ol className="mt-1 divide-y divide-space-800 text-[11px] text-space-400">
                  {historyOf(selected).map((h, i) => (
                    <li key={i} className="py-1.5">
                      <span className="font-mono text-space-500">{h.when}</span> — {h.what}
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function Kpi({ n, label, tone = "" }: { n: number | string; label: string; tone?: string }) {
  return (
    <div className="leading-tight">
      <div className={`text-base font-bold ${tone || "text-space-50"}`}>{n}</div>
      <div className="text-[10px] text-space-400">{label}</div>
    </div>
  );
}
