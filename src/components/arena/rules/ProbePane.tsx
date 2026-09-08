"use client";

import { useState, useTransition } from "react";
import { probeAllAction, probeRuleAction } from "@/app/arena/actions";
import type { ProbeRun } from "@/lib/arena/probe";

/**
 * The probe, on the record's right: pick a board, run the rule on it, and read
 * what happened as Input → Applied rule → Result → Assumptions.
 *
 * Nothing here decides anything — the run comes back from `probe()`, which is
 * the pure engine on a staged game. "Every board" runs the edge cases beside
 * the default one and reports each outcome, which is the prototype's edge-case
 * list with the engine actually answering it.
 */
const OUTCOME: Record<ProbeRun["outcome"], { label: string; cls: string }> = {
  fired: { label: "fired", cls: "bg-gain/15 text-gain" },
  blank: { label: "played as blank", cls: "bg-loss/15 text-loss" },
  didNotFire: { label: "did not fire", cls: "bg-loss/15 text-loss" },
  notOffered: { label: "not offered", cls: "bg-ki-500/15 text-ki-300" },
  inForce: { label: "in force", cls: "bg-dbs-blue/20 text-space-100" },
  noScenario: { label: "no board to try it on", cls: "bg-space-700/50 text-space-300" },
  error: { label: "the probe broke", cls: "bg-loss/15 text-loss" },
};

const btn = "tap w-full rounded-lg border border-space-600 px-3 py-1.5 text-xs font-semibold text-space-100 hover:border-space-300 disabled:opacity-50";

export function ProbePane({ ruleId, scenarios }: { ruleId: number; scenarios: { key: string; title: string }[] }) {
  const [key, setKey] = useState(scenarios[0]?.key ?? "");
  const [run, setRun] = useState<ProbeRun | null>(null);
  const [all, setAll] = useState<{ key: string; title: string; outcome: ProbeRun["outcome"]; headline: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState(false);
  const [pending, start] = useTransition();

  const go = (fn: () => Promise<void>) => {
    setError(null);
    start(fn);
  };

  return (
    <section className="rounded-xl border border-space-700/70 bg-space-900/50 p-3">
      <h2 className="text-xs font-semibold text-space-300">Probe — what actually happens</h2>
      <select
        value={key}
        onChange={(e) => {
          setKey(e.target.value);
          setRun(null);
        }}
        className="mt-2 w-full rounded-md border border-space-600 bg-space-950 px-2 py-1.5 text-[11px] text-space-100"
      >
        {scenarios.map((s) => (
          <option key={s.key} value={s.key}>
            {s.title}
          </option>
        ))}
      </select>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <button
          className={btn}
          disabled={pending}
          onClick={() =>
            go(async () => {
              const r = await probeRuleAction(ruleId, key);
              if (r.error) setError(r.error);
              else {
                setRun(r.run);
                setAll(null);
              }
            })
          }
        >
          {pending ? "Running…" : "Run probe"}
        </button>
        <button
          className={btn}
          disabled={pending}
          onClick={() =>
            go(async () => {
              const r = await probeAllAction(ruleId);
              if (r.error) setError(r.error);
              else {
                setAll(r.runs);
                setRun(null);
              }
            })
          }
        >
          Every board
        </button>
      </div>

      {error && <p className="mt-2 text-[11px] text-loss">{error}</p>}

      {all && (
        <ol className="mt-3 divide-y divide-space-800 text-[11px]">
          {all.map((r) => (
            <li key={r.key} className="py-1.5">
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${OUTCOME[r.outcome].cls}`}>{OUTCOME[r.outcome].label}</span>
              <span className="ml-1.5 text-space-300">{r.title}</span>
              <span className="mt-0.5 block text-space-500">{r.headline}</span>
            </li>
          ))}
        </ol>
      )}

      {run && (
        <div className="mt-3 space-y-2 text-[11px]">
          <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${OUTCOME[run.outcome].cls}`}>{OUTCOME[run.outcome].label}</span>
          <Block title="Input" lines={run.input} />
          {run.prompts.length > 0 && <Block title="Asked" lines={run.prompts.map((p) => `${p.ask} → ${p.chose}`)} />}
          <Block title="Applied rule" lines={run.applied} />
          <Block title="Result" lines={run.result} tone="text-space-200" />
          <Block title="Assumptions" lines={run.assumptions} />
          {run.log.length > 0 && (
            <div>
              <button className="tap text-[11px] text-space-400 underline hover:text-space-100" onClick={() => setLog(!log)}>
                {log ? "Hide the log" : `The whole log (${run.log.length} lines)`}
              </button>
              {log && (
                <ol className="mt-1 space-y-0.5 text-space-500">
                  {run.log.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ol>
              )}
            </div>
          )}
          <p className="text-space-600">
            digest <span className="font-mono">{run.digest}</span> — what a re-probe compares
          </p>
        </div>
      )}
    </section>
  );
}

function Block({ title, lines, tone = "text-space-400" }: { title: string; lines: string[]; tone?: string }) {
  if (!lines.length) return null;
  return (
    <div>
      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-space-500">{title}</h3>
      <ul className={`mt-0.5 space-y-0.5 ${tone}`}>
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </div>
  );
}
