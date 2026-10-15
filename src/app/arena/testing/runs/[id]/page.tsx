import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { ArenaHeader } from "@/components/arena/ArenaHeader";
import { requireSlPage } from "@/lib/auth";
import { getImportedEvaluationRunDetail } from "@/lib/arena/testing/store";
import type { EvaluationManifestResult } from "@/lib/arena/testing/run-manifest";

export const dynamic = "force-dynamic";

const OUTCOMES = ["pass", "fail", "interrupted", "error", "win", "loss", "draw", "limit", "illegal"] as const;
const panel = "rounded-xl border border-space-700 bg-space-900/50 p-4";

export default async function ImportedRunDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSlPage();
  const [{ id: rawId }, query] = await Promise.all([params, searchParams]);
  const id = /^\d{1,10}$/.test(rawId) ? Number(rawId) : NaN;
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const page = /^\d{1,6}$/.test(first(query.page) ?? "") ? Number(first(query.page)) : 1;
  const fixtureKey = first(query.fixture) ?? "";
  const outcome = first(query.outcome) ?? "";
  const run = await getImportedEvaluationRunDetail(db, id, { page, fixtureKey, outcome });
  if (!run) notFound();

  const source = run.source === "policy_eval" ? `Policy evaluation · ${run.seedSet ?? "seed set unknown"}` : run.source === "decision_cases" ? "Strategy decision cases" : "Arena scenario cases";
  const formQuery = new URLSearchParams();
  if (fixtureKey) formQuery.set("fixture", fixtureKey);
  if (outcome) formQuery.set("outcome", outcome);
  const hrefForPage = (target: number) => {
    const next = new URLSearchParams(formQuery);
    next.set("page", String(target));
    return `/arena/testing/runs/${run.id}?${next.toString()}`;
  };
  const filteredCount = run.results.length;

  return <main className="mx-auto max-w-7xl min-w-0 space-y-5 overflow-x-hidden px-3 py-4 pb-24 sm:px-6 sm:py-6">
    <ArenaHeader side="testing" />
    <Link href="/arena/testing" className="tap inline-flex min-h-9 items-center text-sm text-ki-300 hover:text-ki-200">← Back to Testing &amp; stats</Link>
    <header className={panel}>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-ki-300">Imported test run</p>
      <h1 className="mt-1 text-xl font-semibold text-space-50 sm:text-2xl">{source}</h1>
      <p className="mt-1 break-all font-mono text-xs text-space-400">Run {run.requestId} · {run.resultCount} result rows · {new Date(run.recordedAt).toLocaleString()}</p>
    </header>

    <section className={panel} aria-labelledby="fixture-results-title">
      <h2 id="fixture-results-title" className="text-base font-semibold text-space-100">Outcome counts by fixture</h2>
      <p className="mt-1 text-[11px] text-space-500">Counts stay separated by fixture and result kind. Policy game outcomes are from the candidate’s perspective; no pooled win-rate claim is computed.</p>
      {run.fixtureTotals.length ? <div className="mt-2 overflow-x-auto rounded-lg border border-space-700"><table className="w-full min-w-[34rem] text-left text-xs"><thead className="bg-space-950 text-space-400"><tr><th className="px-2 py-2">Fixture</th><th className="px-2 py-2">Result kind</th><th className="px-2 py-2">Outcome</th><th className="px-2 py-2">Count</th></tr></thead><tbody>{run.fixtureTotals.map((item) => <tr key={`${item.fixtureKey}:${item.kind}:${item.outcome}`} className="border-t border-space-800"><th scope="row" className="px-2 py-2 font-mono">{item.fixtureKey}</th><td className="px-2 py-2">{item.kind.replaceAll("_", " ")}</td><td className="px-2 py-2">{item.outcome}</td><td className="px-2 py-2 tabular-nums">{item.count}</td></tr>)}</tbody></table></div> : <p className="mt-2 text-xs text-space-500">No result counts available.</p>}
    </section>

    <section className="min-w-0 space-y-3" aria-labelledby="cases-title">
      <div><h2 id="cases-title" className="text-base font-semibold text-space-100">Case results</h2><p className="text-xs text-space-400">Review every result page. Evidence is a digest only; raw replays, game state, actions, and prompts are not uploaded.</p></div>
      <form method="GET" className="grid gap-2 rounded-xl border border-space-700 bg-space-900/50 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="block space-y-1 text-xs text-space-300">Fixture
          <select name="fixture" defaultValue={fixtureKey} className="tap w-full rounded-md border border-space-700 bg-space-950 px-2 py-2 text-sm text-space-100"><option value="">All fixtures</option>{run.fixtures.map((fixture) => <option key={fixture.key} value={fixture.key}>{fixture.key} · {fixture.sourceId}</option>)}</select>
        </label>
        <label className="block space-y-1 text-xs text-space-300">Outcome
          <select name="outcome" defaultValue={outcome} className="tap w-full rounded-md border border-space-700 bg-space-950 px-2 py-2 text-sm text-space-100"><option value="">All outcomes</option>{OUTCOMES.map((item) => <option key={item}>{item}</option>)}</select>
        </label>
        <button className="tap min-h-11 rounded-md border border-space-600 px-4 text-sm text-space-100 hover:bg-space-800">Filter cases</button>
      </form>
      <p className="text-[11px] text-space-500">Showing {filteredCount} row(s) on page {run.page} of {run.pageCount} · {run.totalMatches} match these filters.</p>
      {run.results.length ? <div className="min-w-0 max-w-full overflow-x-auto rounded-xl border border-space-700"><table className="w-full min-w-[74rem] text-left text-[11px]"><thead className="bg-space-950 text-space-400"><tr><th className="px-2 py-2">Case</th><th className="px-2 py-2">Fixture</th><th className="px-2 py-2">Portal mapping</th><th className="px-2 py-2">Policy</th><th className="px-2 py-2">Seed / seat</th><th className="px-2 py-2">Outcome</th><th className="px-2 py-2">Assertions / metrics</th><th className="px-2 py-2">Evidence SHA-256</th></tr></thead>
        <tbody>{run.results.map((result) => <ResultRow key={result.key} result={result} />)}</tbody></table></div> : <p className="rounded-xl border border-dashed border-space-700 p-5 text-sm text-space-400">No cases match these filters.</p>}
      <nav aria-label="Result pages" className="flex items-center justify-between gap-3 text-sm">
        {run.page > 1 ? <Link className="tap rounded-md border border-space-700 px-3 py-2 text-space-200" href={hrefForPage(run.page - 1)}>← Previous 25</Link> : <span />}
        <span className="text-xs text-space-500">Page {run.page} / {run.pageCount}</span>
        {run.page < run.pageCount ? <Link className="tap rounded-md border border-space-700 px-3 py-2 text-space-200" href={hrefForPage(run.page + 1)}>Next 25 →</Link> : <span />}
      </nav>
    </section>

    <details className={panel}>
      <summary className="tap cursor-pointer text-base font-semibold text-space-100">Versions and reproducibility</summary>
      <div className="mt-3 grid min-w-0 gap-2 break-all text-xs text-space-300 sm:grid-cols-2">
        <p>Runner: <span className="font-mono">{run.runner.id}@{run.runner.version}</span></p>
        <p>Protocol: <span className="font-mono">{run.protocol.id}@{run.protocol.revision}</span></p>
        <p>Runner commit: <span className="font-mono">{run.runner.gitCommit}</span></p>
        <p>Worktree: {run.runner.dirtyTreeSha256 ? <span className="font-mono">dirty · {run.runner.dirtyTreeSha256}</span> : "runner declared clean"}</p>
      </div>
      <h2 className="mt-4 text-base font-semibold text-space-100">Pinned fixtures</h2>
      <div className="mt-2 grid min-w-0 gap-3 lg:grid-cols-2">{run.fixtures.map((fixture) => <article key={fixture.key} className="min-w-0 rounded-lg border border-space-700 p-3">
        <h3 className="break-words text-sm font-semibold text-space-100">{fixture.key} · {fixture.sourceId}</h3>
        <dl className="mt-2 grid grid-cols-[8rem_minmax(0,1fr)] gap-x-2 gap-y-1 break-all text-[11px] text-space-300">
          <dt>Runtime revision</dt><dd className="font-mono">{fixture.runtimeRevision ?? "unavailable; this run is unpinned"}</dd>
          <dt>Bundle SHA-256</dt><dd className="font-mono">{fixture.bundleSha256}</dd>
          <dt>Rules SHA-256</dt><dd className="font-mono">{fixture.rulesSha256 ?? "not recorded"}</dd>
          <dt>Catalog SHA-256</dt><dd className="font-mono">{fixture.catalogSha256 ?? "not recorded"}</dd>
          <dt>Programs SHA-256</dt><dd className="font-mono">{fixture.programsSha256 ?? "not recorded"}</dd>
          <dt>P1 deck</dt><dd className="font-mono">{fixture.p1RecipeId ?? "recipe unmapped"} · {fixture.p1DeckSha256 ?? "hash unavailable"}</dd>
          <dt>P2 deck</dt><dd className="font-mono">{fixture.p2RecipeId ?? "recipe unmapped"} · {fixture.p2DeckSha256 ?? "hash unavailable"}</dd>
        </dl>
      </article>)}</div>
      <h3 className="mt-4 text-sm font-semibold text-space-200">Pinned policies</h3>
      {run.policies.length ? <div className="mt-2 min-w-0 max-w-full overflow-x-auto rounded-lg border border-space-700"><table className="w-full min-w-[32rem] text-left text-xs"><thead className="bg-space-950 text-space-400"><tr><th className="px-2 py-2">Policy key</th><th className="px-2 py-2">Version</th><th className="px-2 py-2">SHA-256</th></tr></thead><tbody>{run.policies.map((policy) => <tr key={policy.key} className="border-t border-space-800"><th scope="row" className="px-2 py-2 font-mono text-space-200">{policy.key}</th><td className="px-2 py-2 text-space-300">{policy.version}</td><td className="break-all px-2 py-2 font-mono text-[10px] text-space-300">{policy.sha256}</td></tr>)}</tbody></table></div> : <p className="mt-1 text-xs text-space-500">This runner does not use a policy comparison.</p>}
    </details>
  </main>;
}

function ResultRow({ result }: { result: EvaluationManifestResult }) {
  const scenario = result.kind === "scenario_case";
  const decision = result.kind === "decision_case";
  const game = result.kind === "policy_game";
  const portalId = "portalScenarioId" in result ? result.portalScenarioId : null;
  const sourceId = "sourceScenarioId" in result ? result.sourceScenarioId : null;
  const seat = game ? `candidate ${result.candidateSeat}` : result.seat ?? "not assigned";
  const seed = result.seed;
  const policy = decision ? result.policyKey : game ? `${result.candidatePolicyKey} vs ${result.baselinePolicyKey}` : "—";
  const metrics = scenario
    ? `${result.steps} steps · ${result.differenceCount} differences · browser ${result.browserAgreement == null ? "not run" : result.browserAgreement ? "agreed" : "disagreed"}`
    : decision
      ? `acceptable-action assertion · horizon ${result.horizonSteps}`
      : `winner ${result.winner ?? "none"} · ${result.moves} moves · turn ${result.turn} · damage ${result.damageDealt}/${result.damageTaken} · guard trips ${result.guardTrips} · stop ${result.stopKind ?? "completed"} · cost ${result.reportedCostMicros == null ? "unknown" : formatMicros(result.reportedCostMicros)}`;
  const rng = "initialPolicyRng" in result ? ` · RNG P1 ${rngLabel(result.initialPolicyRng.p1)} / P2 ${rngLabel(result.initialPolicyRng.p2)}` : "";
  return <tr className="border-t border-space-800 align-top text-space-200">
    <th scope="row" className="max-w-56 break-words px-2 py-2 font-mono">{result.key}{sourceId ? <span className="mt-1 block font-sans text-space-400">{sourceId}</span> : null}</th>
    <td className="px-2 py-2 font-mono">{result.fixtureKey}</td>
    <td className="px-2 py-2">{portalId ?? "unmapped"}</td>
    <td className="max-w-48 break-words px-2 py-2 font-mono">{policy}</td>
    <td className="whitespace-nowrap px-2 py-2">{seed} / {seat}</td>
    <td className="px-2 py-2 font-semibold">{result.outcome}</td>
    <td className="max-w-96 whitespace-normal px-2 py-2">{metrics}{rng ? <span className="mt-1 block text-space-500">{rng}</span> : null}</td>
    <td className="max-w-56 break-all px-2 py-2 font-mono text-[10px] text-space-400">{result.evidenceSha256}</td>
  </tr>;
}

function rngLabel(rng: { mode: "seeded"; v: 1; seed: number; n: number } | { mode: "deterministic"; v: null; seed: null; n: null }) {
  return rng.mode === "deterministic" ? "deterministic" : `v${rng.v} seed ${rng.seed} n ${rng.n}`;
}
function formatMicros(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(value / 1_000_000); }
