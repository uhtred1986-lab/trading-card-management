"use client";

import { useActionState, useMemo, useState } from "react";
import type { ActorKind, MatchOutcome, MatchStats, ProgressStatus, StatRow, TestingDashboard, TestingDeck, TestingScenario } from "@/lib/arena/testing/types";
import { SubmitButton } from "@/components/SubmitButton";
import { recordTestingMatchAction, saveTestingDeckAction, saveTestingScenarioAction, type TestingActionState } from "@/app/arena/testing/actions";

const STATUS: { value: ProgressStatus; label: string; tone: string }[] = [
  { value: "planned", label: "Planned", tone: "border-space-600 text-space-300" },
  { value: "in_progress", label: "In progress", tone: "border-dbs-blue/60 text-dbs-blue" },
  { value: "blocked", label: "Blocked", tone: "border-loss/60 text-loss" },
  { value: "failed", label: "Failed", tone: "border-loss/60 bg-loss/10 text-loss" },
  { value: "passed", label: "Passed with evidence", tone: "border-ki-500/60 text-ki-300" },
];
const ACTORS: { value: ActorKind; label: string }[] = [
  { value: "human", label: "Human" },
  { value: "local_ai", label: "Local AI" },
  { value: "opus", label: "Opus" },
  { value: "other_ai", label: "Other AI" },
];
const OUTCOMES: { value: MatchOutcome; label: string }[] = [
  { value: "win", label: "Win" },
  { value: "draw", label: "Draw" },
  { value: "interrupted", label: "Interrupted" },
  { value: "abandoned", label: "Abandoned" },
  { value: "limit", label: "Reached limit" },
];
const input = "tap w-full rounded-md border border-space-700 bg-space-950 px-2 py-2 text-sm text-space-100 placeholder:text-space-500";
const select = `${input} pr-8`;
const smallLabel = "block space-y-1 text-xs text-space-300";

export function TestingPortal({ dashboard, filter, requestId }: { dashboard: TestingDashboard; filter: { actorKind?: ActorKind; model?: string; deckId?: string }; requestId: string }) {
  const [query, setQuery] = useState("");
  const [release, setRelease] = useState("all");
  const [wave, setWave] = useState("first");
  const [deckStatus, setDeckStatus] = useState("all");
  const [scenarioGroup, setScenarioGroup] = useState("all");
  const [scenarioStatus, setScenarioStatus] = useState("all");
  const recipes = useMemo(() => {
    const q = query.trim().toLowerCase();
    return dashboard.decks.filter((deck) => {
      const text = [deck.id, deck.name, deck.release, deck.leaderId, deck.leaderName, deck.category, deck.mechanics.join(" "), deck.supportCardIds.join(" "), deck.notes, deck.description, deck.linkedDeckId == null ? "" : dashboard.actualDecks.find((d) => d.id === deck.linkedDeckId)?.name].join(" ").toLowerCase();
      return (!q || text.includes(q)) && (release === "all" || deck.release === release)
        && (wave === "all" || (wave === "first" ? deck.firstWave : !deck.firstWave))
        && (deckStatus === "all" || deck.status === deckStatus);
    }).sort((a, b) => releaseSort(a.release, b.release) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }, [dashboard, query, release, wave, deckStatus]);
  const scenarios = useMemo(() => dashboard.scenarios.filter((item) => (scenarioGroup === "all" || item.group === scenarioGroup) && (scenarioStatus === "all" || item.status === scenarioStatus)), [dashboard.scenarios, scenarioGroup, scenarioStatus]);
  const deckStatusCounts = countStatuses(dashboard.decks);
  const scenarioStatusCounts = countStatuses(dashboard.scenarios);
  const recordedCost = dashboard.recordedStats.cost;

  return (
    <div className="space-y-6">
      <section aria-label="Testing budget guidance" className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-space-700 bg-space-900/60 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-space-400">Proposed test budget</p>
          <p className="mt-1 text-lg font-semibold text-space-50">$20 pilot · $100 campaign</p>
          <p className="text-xs text-space-400">The pilot is included in the campaign total.</p>
        </div>
        <div className="rounded-xl border border-space-700 bg-space-900/60 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-space-400">Reported cost, matching manual results</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-space-50">{formatUsdMicros(recordedCost.knownCostMicros)}</p>
          <p className="text-xs text-space-400">{recordedCost.pricedMatches} of {recordedCost.totalMatches} matching manual records have a reported cost. Partial manual entries, not a provider invoice, account balance, or remaining budget.</p>
        </div>
      </section>

      <section aria-labelledby="deck-coverage-title" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="deck-coverage-title" className="text-lg font-semibold text-space-50">Deck recipes</h2>
            <p className="text-xs text-space-400">{dashboard.decks.length} recipes · 62 booster shells and 2 starter controls. Statuses are manual evidence tracking, not automatic engine passes.</p>
          </div>
          <div className="flex flex-wrap gap-1 text-[11px]">{STATUS.map((item) => <span key={item.value} className={`rounded-full border px-2 py-1 ${item.tone}`}>{item.label} {deckStatusCounts[item.value]}</span>)}</div>
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(14rem,1fr)_10rem_9rem_9rem]">
          <label className={smallLabel}>Search recipe, leader, mechanic or card
            <input value={query} onChange={(event) => setQuery(event.target.value)} className={input} placeholder="Cell, BT31, Awakening…" />
          </label>
          <label className={smallLabel}>Release
            <select value={release} onChange={(event) => setRelease(event.target.value)} className={select}><option value="all">All releases</option>{[...new Set(dashboard.decks.map((d) => d.release))].sort(releaseSort).map((item) => <option key={item}>{item}</option>)}</select>
          </label>
          <label className={smallLabel}>Wave
            <select value={wave} onChange={(event) => setWave(event.target.value)} className={select}><option value="first">First wave (16)</option><option value="all">All recipes</option><option value="later">Later wave</option></select>
          </label>
          <label className={smallLabel}>Progress
            <select value={deckStatus} onChange={(event) => setDeckStatus(event.target.value)} className={select}><option value="all">All statuses</option>{STATUS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
          </label>
        </div>
        {recipes.length ? <div className="overflow-x-auto rounded-xl border border-space-700"><table className="w-full border-collapse text-left text-xs" aria-label="Deck coverage recipes">
          <thead className="hidden bg-space-950/70 text-[10px] font-semibold uppercase tracking-wider text-space-400 sm:table-header-group"><tr><th scope="col" className="px-3 py-2">Release</th><th scope="col" className="px-3 py-2">Deck and leader</th><th scope="col" className="px-3 py-2">Mechanics</th><th scope="col" className="px-3 py-2">Linked deck</th><th scope="col" className="px-3 py-2">Progress</th></tr></thead>
          <tbody>{recipes.map((deck) => <DeckRecipe key={deck.id} deck={deck} actualDecks={dashboard.actualDecks} />)}</tbody>
        </table></div> : <Empty>No deck recipes match these filters.</Empty>}
      </section>

      <section aria-labelledby="scenario-title" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div><h2 id="scenario-title" className="text-lg font-semibold text-space-50">Scenario checklists</h2><p className="text-xs text-space-400">Scenario status needs exact evidence before it can be marked passed. Rules-family coverage, general AI strategy benchmarks, and White Cell rules and strategy are separate groups.</p></div>
          <div className="flex flex-wrap gap-1 text-[11px]">{STATUS.map((item) => <span key={item.value} className={`rounded-full border px-2 py-1 ${item.tone}`}>{item.label} {scenarioStatusCounts[item.value]}</span>)}</div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className={smallLabel}>Scenario focus
            <select value={scenarioGroup} onChange={(event) => setScenarioGroup(event.target.value)} className={select}>
              <option value="all">All checklist groups</option><option value="family">Rules families</option><option value="strategy">AI strategy benchmarks</option><option value="white_cell_rule">White Cell rules (WC-R)</option><option value="white_cell_strategy">White Cell strategy (WC-A)</option>
            </select>
          </label>
          <label className={smallLabel}>Progress
            <select value={scenarioStatus} onChange={(event) => setScenarioStatus(event.target.value)} className={select}><option value="all">All statuses</option>{STATUS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
          </label>
        </div>
        {scenarios.length ? <div className="space-y-2">{scenarioGroups(scenarios).map(([group, rows]) => (
          <section key={group} className="space-y-2">
            <h3 className="pt-2 text-sm font-semibold text-space-200">{groupLabel(group)}</h3>
            {rows.map((scenario) => <ScenarioCard key={scenario.id} scenario={scenario} />)}
          </section>
        ))}</div> : <Empty>No scenarios match these filters.</Empty>}
      </section>

      <section aria-labelledby="match-stats-title" className="space-y-4">
        <div><h2 id="match-stats-title" className="text-lg font-semibold text-space-50">Match statistics</h2><p className="text-xs text-space-400">Manual results and existing server Arena games are reported separately. {dashboard.sources.local}</p></div>
        <form method="GET" action="/arena/testing" className="grid gap-2 rounded-xl border border-space-700 bg-space-900/50 p-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
          <label className={smallLabel}>Actor kind
            <select name="actor" defaultValue={filter.actorKind ?? ""} className={select}><option value="">All actors</option>{ACTORS.map((actor) => <option key={actor.value} value={actor.value}>{actor.label}</option>)}</select>
          </label>
          <label className={smallLabel}>Model (exact match)
            <input name="model" defaultValue={filter.model ?? ""} className={input} placeholder="e.g. opus-4.1" />
          </label>
          <label className={smallLabel}>Deck
            <select name="deck" defaultValue={filter.deckId ?? ""} className={select}><option value="">All decks</option><optgroup label="Manual recipe results">{dashboard.decks.map((deck) => <option key={deck.id} value={`recipe:${deck.id}`}>{deck.name}</option>)}</optgroup><optgroup label="Server Arena decks">{dashboard.actualDecks.map((deck) => <option key={deck.id} value={`actual:${deck.id}`}>{deck.name}{deck.isTesting ? " · testing" : ""}</option>)}</optgroup></select>
          </label>
          <button className="tap min-h-11 rounded-md border border-space-600 px-4 text-sm text-space-100 hover:bg-space-800">Apply filters</button>
        </form>
        <StatsSource title="Manually recorded test results" stats={dashboard.recordedStats} source={dashboard.sources.recorded} />
        <StatsSource title="Existing server Arena games" stats={dashboard.serverStats} source={dashboard.sources.server} />
      </section>

    <RecordResultForm dashboard={dashboard} requestId={requestId} />

      <section aria-labelledby="recent-records-title" className="space-y-3">
        <div><h2 id="recent-records-title" className="text-lg font-semibold text-space-50">Recent manual results</h2><p className="text-xs text-space-400">Only results entered here appear below. Offline matches remain on their device unless someone records them manually.</p></div>
        {dashboard.recentMatches.length ? <div className="space-y-2">{dashboard.recentMatches.map((match) => <article key={match.id} className="rounded-xl border border-space-700 bg-space-900/50 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-sm font-semibold text-space-100">{match.p1.name} vs {match.p2.name}</h3><span className="text-xs text-space-400">{new Date(match.recordedAt).toLocaleString()}</span></div>
          <p className="mt-1 text-xs text-space-300">{recipeName(dashboard.decks, match.p1DeckId)} vs {recipeName(dashboard.decks, match.p2DeckId)} · {outcomeLabel(match.outcome, match.winner)}</p>
          <p className="mt-1 text-[11px] text-space-400">P1 {actorLabel(match.p1)} vs P2 {actorLabel(match.p2)}</p>
          <p className="mt-1 text-[11px] text-space-500">{match.seed == null ? "Seed not recorded" : `Seed ${match.seed}`} · Rules {match.rulesRevision || "not recorded"} · {match.reportedCostMicros == null ? "Cost not reported" : `Reported cost ${formatUsdMicros(match.reportedCostMicros)} (not invoice data)`}</p>
          {match.evidence ? <p className="mt-2 break-words text-xs text-space-300">Evidence: {match.evidence}</p> : null}
          {match.note ? <p className="mt-1 break-words text-xs text-space-400">{match.note}</p> : null}
        </article>)}</div> : <Empty>No manual test results have been recorded.</Empty>}
      </section>
    </div>
  );
}

function DeckRecipe({ deck, actualDecks }: { deck: TestingDeck; actualDecks: TestingDashboard["actualDecks"] }) {
  const [expanded, setExpanded] = useState(false);
  const linked = actualDecks.find((actual) => actual.id === deck.linkedDeckId);
  const status = STATUS.find((item) => item.value === deck.status)!;
  return <>
    <tr className="block border-t border-space-700 bg-space-900/50 sm:table-row">
      <td className="flex items-start justify-between gap-3 px-3 pt-3 sm:table-cell sm:py-3"><span className="font-semibold text-space-500 sm:hidden">Release</span><span className="text-xs font-semibold text-space-300">{deck.release}{deck.firstWave ? <span className="ml-1 rounded border border-ki-500/40 px-1 text-[9px] text-ki-300">Wave 1</span> : null}</span></td>
      <th scope="row" className="block px-3 py-1 sm:table-cell sm:py-3"><span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-space-500 sm:hidden">Deck and leader</span><button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} className="tap text-left"><span className="block whitespace-normal break-words text-sm font-semibold text-space-100">{deck.name}</span><span className="block whitespace-normal break-words text-[11px] text-space-500">{deck.leaderId} · {deck.leaderName}</span><span className="sr-only">{expanded ? "Hide" : "Show"} recipe details</span></button></th>
      <td className="flex items-start justify-between gap-3 px-3 py-1 sm:table-cell sm:py-3"><span className="font-semibold text-space-500 sm:hidden">Mechanics</span><span className="flex flex-wrap justify-end gap-1 sm:justify-start">{deck.mechanics.map((mechanic) => <span key={mechanic} className="rounded-full border border-space-700 px-2 py-0.5 text-[10px] text-space-300">{mechanic}</span>)}</span></td>
      <td className="flex items-start justify-between gap-3 px-3 py-1 sm:table-cell sm:py-3"><span className="font-semibold text-space-500 sm:hidden">Linked deck</span><span className="whitespace-normal break-words text-right text-[11px] text-space-400 sm:text-left">{linked ? linked.name : "No actual deck linked"}</span></td>
      <td className="flex items-center justify-between gap-3 px-3 pb-3 pt-1 sm:table-cell sm:py-3"><span className="font-semibold text-space-500 sm:hidden">Progress</span><button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} className={`tap rounded-full border px-2 py-1 text-[10px] font-semibold ${status.tone}`}>{status.label} · {expanded ? "Hide" : "Edit"}</button></td>
    </tr>
    {expanded ? <tr className="block border-t border-space-700 sm:table-row"><td colSpan={5} className="block bg-space-900/80 p-3 sm:table-cell">
      <p className="text-xs text-space-300">{deck.description}</p>
      <p className="mt-1 text-[11px] text-space-500">Recipe {deck.id} · Source: {deck.source} · Focus cards: {deck.supportCardIds.join(", ") || "none listed"}</p>
      {deck.notes ? <p className="mt-1 text-xs text-space-400">{deck.notes}</p> : null}
      <ProgressForm key={`${deck.id}:${deck.version}`} id={deck.id} version={deck.version} status={deck.status} note={deck.note} evidence={deck.evidence} action={saveTestingDeckAction} actualDecks={actualDecks} linkedDeckId={deck.linkedDeckId} />
    </td></tr> : null}
  </>;
}

function ScenarioCard({ scenario }: { scenario: TestingScenario }) {
  const status = STATUS.find((item) => item.value === scenario.status)!;
  return <details className="rounded-xl border border-space-700 bg-space-900/50">
    <summary className="tap grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] gap-2 p-3 marker:hidden [&::-webkit-details-marker]:hidden sm:grid-cols-[5rem_minmax(0,1fr)_auto] sm:items-center">
      <span className="font-mono text-[11px] font-semibold uppercase text-ki-300">{scenario.id}</span><span className="text-sm text-space-100">{scenario.name}</span><span className={`justify-self-start rounded-full border px-2 py-1 text-[10px] font-semibold ${status.tone}`}>{status.label}</span>
    </summary>
    <div className="border-t border-space-700 p-3"><p className="text-xs leading-relaxed text-space-300">{scenario.description}</p><p className="mt-1 text-[11px] text-space-500">Source: {scenario.source}</p><ProgressForm key={`${scenario.id}:${scenario.version}`} id={scenario.id} version={scenario.version} status={scenario.status} note={scenario.note} evidence={scenario.evidence} action={saveTestingScenarioAction} /></div>
  </details>;
}

function ProgressForm({ id, version, status, note, evidence, action, actualDecks, linkedDeckId }: {
  id: string; version: number; status: ProgressStatus; note: string; evidence: string;
  action: (state: TestingActionState | null, form: FormData) => Promise<TestingActionState>;
  actualDecks?: TestingDashboard["actualDecks"]; linkedDeckId?: number | null;
}) {
  const [state, formAction] = useActionState(action, null);
  const [fields, setFields] = useState({ status, linkedDeckId: linkedDeckId == null ? "" : String(linkedDeckId), note, evidence });
  const setField = (name: keyof typeof fields, value: string) => setFields((previous) => ({ ...previous, [name]: value }));
  return <form action={formAction} className="mt-3 grid gap-2 sm:grid-cols-2">
    <input type="hidden" name="id" value={id} /><input type="hidden" name="version" value={version} />
    <label className={smallLabel}>Progress status
      <select name="status" value={fields.status} onChange={(event) => setField("status", event.target.value)} className={select}>{STATUS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
    </label>
    {actualDecks ? <label className={smallLabel}>Link an actual deck
      <select name="linkedDeckId" value={fields.linkedDeckId} onChange={(event) => setField("linkedDeckId", event.target.value)} className={select}><option value="">No actual deck linked</option>{actualDecks.filter((deck) => deck.game === "dbs").map((deck) => <option key={deck.id} value={deck.id}>{deck.name}{deck.isTesting ? " · testing" : ""}</option>)}</select>
    </label> : null}
    <label className={`${smallLabel} sm:col-span-2`}>Progress note
      <textarea name="note" value={fields.note} onChange={(event) => setField("note", event.target.value)} rows={2} maxLength={4000} className={input} placeholder="What remains, what was checked, or the blocker…" />
    </label>
    <label className={`${smallLabel} sm:col-span-2`}>Evidence <span className="text-space-500">· required to mark passed</span>
      <textarea name="evidence" value={fields.evidence} onChange={(event) => setField("evidence", event.target.value)} rows={2} maxLength={2000} className={input} placeholder="Exact test command, card/skill, revision, and assertion…" />
    </label>
    <div className="flex flex-wrap items-center gap-3 sm:col-span-2"><SubmitButton pendingLabel="Saving…" className="tap min-h-11 rounded-md bg-space-700 px-4 text-sm font-medium text-space-50 hover:bg-space-600">Save progress</SubmitButton><ActionNotice state={state} /></div>
  </form>;
}

function RecordResultForm({ dashboard, requestId }: { dashboard: TestingDashboard; requestId: string }) {
  const [state, formAction] = useActionState(recordTestingMatchAction, null);
  return <RecordResultFields key={state?.formEpoch ?? "0"} dashboard={dashboard} requestId={requestId} state={state} formAction={formAction} />;
}

function RecordResultFields({ dashboard, requestId, state, formAction }: { dashboard: TestingDashboard; requestId: string; state: TestingActionState | null; formAction: (form: FormData) => void }) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const value = (name: string, initial = "") => fields[name] ?? initial;
  const setField = (name: string, fieldValue: string) => setFields((previous) => ({ ...previous, [name]: fieldValue }));
  return <section aria-labelledby="record-result-title" className="space-y-3 rounded-xl border border-ki-500/30 bg-space-900/60 p-4">
    <div><h2 id="record-result-title" className="text-lg font-semibold text-space-50">Record a test result</h2><p className="text-xs text-space-400">Choose the catalog recipe each side used; this manual record does not change recipe status. It is not a game launcher. Local offline matches are not uploaded or imported automatically.</p></div>
    <form action={formAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <input type="hidden" name="requestId" value={requestId} />
      <ActorFields seat="p1" label="Player 1" value={value} setField={setField} />
      <ActorFields seat="p2" label="Player 2" value={value} setField={setField} />
      <label className={smallLabel}>Player 1 recipe
        <select name="p1DeckId" required value={value("p1DeckId")} onChange={(event) => setField("p1DeckId", event.target.value)} className={select}><option value="" disabled>Choose a recipe</option>{dashboard.decks.map((deck) => <option key={deck.id} value={deck.id}>{deck.name}</option>)}</select>
      </label>
      <label className={smallLabel}>Player 2 recipe
        <select name="p2DeckId" required value={value("p2DeckId")} onChange={(event) => setField("p2DeckId", event.target.value)} className={select}><option value="" disabled>Choose a recipe</option>{dashboard.decks.map((deck) => <option key={deck.id} value={deck.id}>{deck.name}</option>)}</select>
      </label>
      <label className={smallLabel}>Result
        <select name="outcome" value={value("outcome", "win")} onChange={(event) => setField("outcome", event.target.value)} className={select}>{OUTCOMES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
      </label>
      <label className={smallLabel}>Winner <span className="text-space-500">· required only for Win</span>
        <select name="winner" value={value("winner")} onChange={(event) => setField("winner", event.target.value)} className={select}><option value="">No winner / not a win</option><option value="p1">Player 1</option><option value="p2">Player 2</option></select>
      </label>
      <label className={smallLabel}>Seed <span className="text-space-500">· optional</span>
        <input name="seed" value={value("seed")} onChange={(event) => setField("seed", event.target.value)} type="number" step="1" className={input} placeholder="e.g. 641" />
      </label>
      <label className={smallLabel}>Rules revision <span className="text-space-500">· optional</span>
        <input name="rulesRevision" value={value("rulesRevision")} onChange={(event) => setField("rulesRevision", event.target.value)} maxLength={160} className={input} placeholder="Commit or interpreter revision" />
      </label>
      <label className={smallLabel}>Reported cost (USD) <span className="text-space-500">· optional, manual</span>
        <input name="reportedCostUsd" value={value("reportedCostUsd")} onChange={(event) => setField("reportedCostUsd", event.target.value)} type="number" min="0" step="0.000001" className={input} placeholder="Leave blank if unknown" />
      </label>
      <label className={`${smallLabel} sm:col-span-2 lg:col-span-3`}>Evidence
        <textarea name="evidence" value={value("evidence")} onChange={(event) => setField("evidence", event.target.value)} rows={2} maxLength={2000} className={input} placeholder="Replay file, scenario, issue, or assertion summary" />
      </label>
      <label className={`${smallLabel} sm:col-span-2 lg:col-span-3`}>Notes
        <textarea name="note" value={value("note")} onChange={(event) => setField("note", event.target.value)} rows={2} maxLength={4000} className={input} placeholder="Setup, interruptions, limits reached, or context…" />
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-3"><SubmitButton pendingLabel="Recording…" className="tap min-h-11 rounded-md bg-ki-500 px-4 text-sm font-semibold text-space-950 hover:bg-ki-400">Record manual result</SubmitButton><ActionNotice state={state} /></div>
    </form>
    <p className="text-[11px] text-space-500">Recorded cost is an amount manually entered for this result, not a provider invoice or balance. A blank cost means unknown; $0 means explicitly reported free.</p>
  </section>;
}

function ActorFields({ seat, label, value, setField }: { seat: "p1" | "p2"; label: string; value: (name: string, initial?: string) => string; setField: (name: string, fieldValue: string) => void }) {
  const kindName = `${seat}Kind`;
  const modelName = `${seat}Model`;
  const kind = value(kindName, "human");
  const modelIsRequired = kind === "opus";
  return <fieldset className="space-y-2 rounded-lg border border-space-700 p-3">
    <legend className="px-1 text-xs font-semibold text-space-200">{label}</legend>
    <label className={smallLabel}>Actor kind
      <select name={kindName} value={kind} onChange={(event) => { setField(kindName, event.target.value); if (event.target.value === "human") setField(modelName, ""); }} className={select}>{ACTORS.map((actor) => <option key={actor.value} value={actor.value}>{actor.label}</option>)}</select>
    </label>
    <label className={smallLabel}>Actor name
      <input name={`${seat}Name`} value={value(`${seat}Name`)} onChange={(event) => setField(`${seat}Name`, event.target.value)} required maxLength={120} className={input} placeholder="Person or agent label" />
    </label>
    <label className={smallLabel}>Model <span className="text-space-500">· {modelIsRequired ? "exact version required" : kind === "human" ? "not used for humans" : "optional"}</span>
      <input name={modelName} value={value(modelName)} onChange={(event) => setField(modelName, event.target.value)} required={modelIsRequired} disabled={kind === "human"} maxLength={120} className={input} placeholder={modelIsRequired ? "e.g. claude-opus-4-6" : "Exact model/version if known"} />
    </label>
  </fieldset>;
}

function StatsSource({ title, stats, source }: { title: string; stats: MatchStats; source: string }) {
  return <section className="space-y-2 rounded-xl border border-space-700 bg-space-900/50 p-3">
    <div><h3 className="text-sm font-semibold text-space-100">{title}</h3><p className="text-[11px] text-space-500">{source} · {stats.denominator}</p></div>
    <StatTable rows={[stats.matches]} summary />
    <div className="grid gap-4 lg:grid-cols-2"><div><h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-space-400">By actor and model</h4><StatTable rows={stats.byActor} /></div><div><h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-space-400">By deck</h4><StatTable rows={stats.byDeck} /></div></div>
    <div><h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-space-400">Deck · actor/model vs opponent · actor/model</h4><p className="mb-1 text-[11px] text-space-500">Each row is one oriented pairing. The sample count is distinct games; appearances also exposes mirrored games counted in both seats.</p><StatTable rows={stats.byMatchup} matchups /></div>
  </section>;
}

function StatTable({ rows, summary = false, matchups = false }: { rows: StatRow[]; summary?: boolean; matchups?: boolean }) {
  if (!rows.length) return <p className="rounded-md border border-dashed border-space-700 p-3 text-xs text-space-500">No matches for these filters.</p>;
  return <div className="overflow-x-auto rounded-lg border border-space-800"><table className="w-full min-w-[590px] text-left text-[11px]">
    <thead className="bg-space-950/70 text-space-500"><tr>{!summary ? <th className="px-2 py-2 font-medium">{matchups ? "Pairing" : "Group"}</th> : null}{!summary ? <th className="px-2 py-2 font-medium">Unique games</th> : null}<th className="px-2 py-2 font-medium">{summary ? "Matches" : "Seat appearances"}</th><th className="px-2 py-2 font-medium">{summary ? "Completed" : "Completed W/L/D"}</th><th className="px-2 py-2 font-medium">{summary ? "Draws" : "Interrupted"}</th>{!summary ? <th className="px-2 py-2 font-medium">Abandoned</th> : null}{!summary ? <th className="px-2 py-2 font-medium">Limit</th> : null}{!summary ? <th className="px-2 py-2 font-medium">Playing</th> : null}{!summary ? <th className="px-2 py-2 font-medium">Win rate*</th> : null}</tr></thead>
    <tbody>{rows.map((row) => <tr key={row.key} className="border-t border-space-800 text-space-200">{!summary ? <th scope="row" className="max-w-64 truncate px-2 py-2 font-medium" title={row.label}>{row.label}</th> : null}{!summary ? <td className="px-2 py-2 tabular-nums">{row.uniqueGames}</td> : null}<td className="px-2 py-2 tabular-nums">{summary ? row.games : row.appearances}</td><td className="px-2 py-2 tabular-nums">{summary ? row.completed : `${row.completed} · ${row.wins}/${row.losses}/${row.draws}`}</td><td className="px-2 py-2 tabular-nums">{summary ? row.draws : row.interrupted}</td>{!summary ? <td className="px-2 py-2 tabular-nums">{row.abandoned}</td> : null}{!summary ? <td className="px-2 py-2 tabular-nums">{row.limit}</td> : null}{!summary ? <td className="px-2 py-2 tabular-nums">{row.playing}</td> : null}{!summary ? <td className="px-2 py-2 tabular-nums">{row.winRate == null ? "—" : `${(row.winRate * 100).toFixed(1)}%`}</td> : null}</tr>)}</tbody>
  </table><p className="px-2 py-1 text-[10px] text-space-500">{summary ? "Match totals have no player perspective; draws are shown separately. No overall match win rate." : "* W/(W+L); draws and unfinished games excluded."}</p></div>;
}

function ActionNotice({ state }: { state: TestingActionState | null }) {
  if (!state) return null;
  return <p role={state.error ? "alert" : "status"} className={`text-xs ${state.error ? "text-loss" : "text-ki-300"}`}>{state.error ?? state.message}</p>;
}

function Empty({ children }: { children: React.ReactNode }) { return <p className="rounded-xl border border-dashed border-space-700 p-5 text-center text-sm text-space-400">{children}</p>; }

function countStatuses(rows: { status: ProgressStatus }[]) { return Object.fromEntries(STATUS.map((item) => [item.value, rows.filter((row) => row.status === item.value).length])) as Record<ProgressStatus, number>; }
function scenarioGroups(rows: TestingScenario[]) { const order: TestingScenario["group"][] = ["family", "strategy", "white_cell_rule", "white_cell_strategy"]; return order.map((group) => [group, rows.filter((row) => row.group === group)] as const).filter(([, items]) => items.length); }
function groupLabel(group: TestingScenario["group"]) { return group === "family" ? "Rules families" : group === "strategy" ? "AI strategy benchmarks" : group === "white_cell_rule" ? "White Cell rules · WC-R" : "White Cell strategy · WC-A"; }
function recipeName(decks: TestingDashboard["decks"], id: string) { return decks.find((deck) => deck.id === id)?.name ?? `Recipe ${id}`; }
function actorLabel(actor: { kind: ActorKind; name: string; model: string | null }) { return `${actor.name} · ${ACTORS.find((item) => item.value === actor.kind)?.label ?? actor.kind}${actor.model ? ` / ${actor.model}` : ""}`; }
function releaseSort(a: string, b: string) {
  const prefix = (value: string) => value.match(/^[a-z]+/i)?.[0].toUpperCase() ?? "";
  const family = (value: string) => ({ BT: 0, SD: 1 } as Record<string, number>)[value] ?? 2;
  const fa = prefix(a); const fb = prefix(b);
  return family(fa) - family(fb) || (family(fa) === 2 ? fa.localeCompare(fb) : 0)
    || Number(a.match(/\d+/)?.[0] ?? 0) - Number(b.match(/\d+/)?.[0] ?? 0) || a.localeCompare(b);
}
function formatUsdMicros(micros: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(micros / 1_000_000); }
function outcomeLabel(outcome: MatchOutcome, winner: "p1" | "p2" | null) { if (outcome === "win") return `${winner === "p1" ? "Player 1" : "Player 2"} win`; return OUTCOMES.find((item) => item.value === outcome)?.label ?? outcome; }
