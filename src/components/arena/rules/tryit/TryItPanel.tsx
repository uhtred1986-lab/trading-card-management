"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { expectationsAction, saveExpectationsAction, tryRuleByIdAction } from "@/app/arena/rules/probe-actions";
import type { Rule } from "@/lib/arena/lang/ast";
import type { RulePath } from "@/lib/arena/lang/path";
import type { KnobSpec } from "@/lib/arena/probe-edges";
import { fixPath, judge, ownLines, type Expectation, type JudgedStatus, type TryResult, type TryRow } from "@/lib/arena/tryit-judge";
import { BoardSheet, WrongSheet } from "./sheets";

/**
 * Try it → fix it (#470): the rule being built, tried on every board its
 * trigger and its condition call for, with the owner's word on each.
 *
 * Mounted by the block builder (#469) under the rule, through its `tryIt`
 * prop, and handed the rule as it stands — unsaved. Every change re-runs the
 * boards (debounced), so the rows are always the current rule's. The engine
 * is the one games use; the legacy engine runs beside it and a row where the
 * two disagree says so, because that is an engine bug and not the owner's.
 *
 * ✓ keeps what happened as what should; ✗ asks what should have happened.
 * A judged row keeps its judgement while the rule is edited and goes red on
 * its own when the new result no longer matches; **Fix** hands the builder
 * the block to open (`onFix`). Judgements are saved as they are made
 * (`card_rules.expectations`) — they are the rule's tests, and
 * `arena:reprobe` holds the rule to them.
 */
export function TryItPanel(props: { ruleId: number; rule: Rule; onFix: (path: RulePath) => void }) {
  return <TryItBoards {...props} api={SERVER} />;
}

/** What the panel calls: the server actions, or a stand-in where there is no database (a preview, a test). */
export interface TryItApi {
  load: typeof expectationsAction;
  run: typeof tryRuleByIdAction;
  save: typeof saveExpectationsAction;
}

const SERVER: TryItApi = { load: expectationsAction, run: tryRuleByIdAction, save: saveExpectationsAction };

/** The panel itself, with what it calls handed in. */
export function TryItBoards({ ruleId, rule, onFix, api }: { ruleId: number; rule: Rule; onFix: (path: RulePath) => void; api: TryItApi }) {
  const [result, setResult] = useState<TryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [said, setSaid] = useState<Record<string, Expectation>>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [sheet, setSheet] = useState<{ kind: "wrong" | "board"; key: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const seq = useRef(0);

  // The owner's judgements on this rule, once: they are boards to try as well.
  useEffect(() => {
    let live = true;
    api.load(ruleId).then((r) => {
      if (!live) return;
      if (r.error) setError(r.error);
      setSaid(Object.fromEntries(r.expectations.map((e) => [e.key, e])));
      setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [ruleId, api]);

  const ruleText = useMemo(() => JSON.stringify(rule), [rule]);
  const extra = useMemo(() => [...new Set([...Object.keys(said), ...added])], [said, added]);
  const extraText = extra.join("\n");

  // Re-run every board after a change, debounced; a reply to an older rule is dropped.
  useEffect(() => {
    if (!loaded) return;
    const mine = ++seq.current;
    const t = setTimeout(() => {
      setRunning(true);
      api.run(ruleId, JSON.parse(ruleText), extraText ? extraText.split("\n") : [])
        .then((r) => {
          if (mine !== seq.current) return;
          setError(r.error);
          if (r.result) setResult(r.result);
        })
        .catch((e: unknown) => mine === seq.current && setError(e instanceof Error ? e.message : String(e)))
        .finally(() => mine === seq.current && setRunning(false));
    }, 450);
    return () => clearTimeout(t);
  }, [ruleId, ruleText, extraText, loaded, api]);

  const keep = (next: Record<string, Expectation>, key: string) => {
    setSaid(next);
    setSaving(key);
    api.save(ruleId, Object.values(next))
      .then((r) => r.error && setError(r.error))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setSaving(null));
  };

  const judgeRight = (row: TryRow) =>
    keep(
      {
        ...said,
        [row.key]: {
          key: row.key,
          title: row.title,
          expected: row.rules.fires ? "fired" : "didNotFire",
          verdict: "right",
          headline: row.rules.headline,
          applied: ownLines(row.rules).map((b) => b.line),
          engine: row.rules.engine,
          at: new Date().toISOString(),
        },
      },
      row.key,
    );

  const judgeWrong = (row: TryRow, should: "fire" | "notFire" | "other", note: string) => {
    keep(
      {
        ...said,
        [row.key]: {
          key: row.key,
          title: row.title,
          expected: should === "notFire" ? "didNotFire" : "fired",
          verdict: "wrong",
          ...(should === "other" ? { other: true, headline: row.rules.headline } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
          engine: row.rules.engine,
          at: new Date().toISOString(),
        },
      },
      row.key,
    );
    setSheet(null);
  };

  const forget = (key: string) => {
    const next = { ...said };
    delete next[key];
    keep(next, key);
  };

  const rows = result?.rows ?? [];
  const sheetRow = sheet ? rows.find((r) => r.key === sheet.key) ?? null : null;
  const counts = rows.reduce(
    (n, r) => {
      const e = said[r.key];
      const st = e ? judge(r.rules, e) : null;
      if (st === "mismatch") n.red++;
      else if (st === "match") n.green++;
      return n;
    },
    { red: 0, green: 0 },
  );

  return (
    <section className="rounded-xl border border-space-700/70 bg-space-900/50 p-3" aria-label="Try it">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-space-300">Try it · the engine plays these for you</h2>
        <span className="shrink-0 text-[11px] text-space-500" aria-live="polite">
          {running ? "running…" : saving ? "saving…" : counts.red ? <span className="text-loss">{counts.red} wrong</span> : counts.green ? <span className="text-gain">{counts.green} right</span> : null}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-space-500">
        On the {result?.engines.main ?? "rules"} engine games use, with the {result?.engines.other ?? "legacy"} one beside it. Mark each board ✓ or ✗; a judged board goes red by itself when the rule stops doing what you said.
      </p>
      {error && <p className="mt-2 rounded-lg bg-loss/10 px-2 py-1.5 text-[12px] text-loss">{error}</p>}
      {result?.notes.map((n) => (
        <p key={n} className="mt-2 text-[11px] text-space-400">
          {n}
        </p>
      ))}

      {!result && !error && <p className="mt-3 text-sm text-space-400">{loaded ? "Trying the rule…" : "Reading what you said before…"}</p>}

      <ol className={`mt-3 space-y-2 transition-opacity ${running ? "opacity-70" : ""}`}>
        {rows.map((row) => (
          <BoardRow
            key={row.key}
            row={row}
            said={said[row.key] ?? null}
            canChange={!!result?.knobs.length}
            expanded={open === row.key}
            onToggle={() => setOpen(open === row.key ? null : row.key)}
            onRight={() => judgeRight(row)}
            onWrong={() => setSheet({ kind: "wrong", key: row.key })}
            onForget={() => forget(row.key)}
            onFix={() => onFix(fixPath(row, said[row.key] ?? null))}
            onChange={() => setSheet({ kind: "board", key: row.key })}
          />
        ))}
      </ol>

      {sheet?.kind === "wrong" && sheetRow && <WrongSheet row={sheetRow} onClose={() => setSheet(null)} onSave={(should, note) => judgeWrong(sheetRow, should, note)} />}
      {sheet?.kind === "board" && sheetRow && result && (
        <BoardSheet
          row={sheetRow}
          knobs={result.knobs}
          start={startingKnobs(result, sheetRow, result.knobs)}
          onClose={() => setSheet(null)}
          onAdd={(key) => {
            setAdded((a) => (a.includes(key) ? a : [...a, key]));
            setSheet(null);
          }}
        />
      )}
    </section>
  );
}

/** Where a row's "Change board" sheet starts: the row's own knobs, else the first generated board's, else each knob's least. */
function startingKnobs(result: TryResult, row: TryRow, specs: KnobSpec[]): Record<string, number | "you" | "opponent"> {
  const out: Record<string, number | "you" | "opponent"> = {};
  for (const k of specs) {
    const from = row.knobs[k.path] ?? result.rows.find((r) => r.knobs[k.path] !== undefined)?.knobs[k.path];
    out[k.path] = from ?? (k.kind === "turn" ? "you" : k.min);
  }
  return out;
}

const STATUS: Record<JudgedStatus, { ring: string; word: string; tone: string }> = {
  match: { ring: "border-gain/50", word: "as you said", tone: "text-gain" },
  mismatch: { ring: "border-loss/80 bg-loss/[0.06]", word: "not what you said", tone: "text-loss" },
  rejudge: { ring: "border-ki-500/60", word: "changed — look again", tone: "text-ki-300" },
};

const btn = "tap inline-flex min-h-11 items-center justify-center gap-1 whitespace-nowrap rounded-lg border px-3 text-[14px] font-semibold disabled:opacity-50";
/** A secondary action: a 44 px target that reads as a link. */
const link = "tap inline-flex min-h-11 items-center px-1.5 text-[12px] font-semibold text-space-400 underline-offset-2 hover:text-space-200 hover:underline";

function BoardRow({
  row,
  said,
  canChange,
  expanded,
  onToggle,
  onRight,
  onWrong,
  onForget,
  onFix,
  onChange,
}: {
  row: TryRow;
  said: Expectation | null;
  canChange: boolean;
  expanded: boolean;
  onToggle: () => void;
  onRight: () => void;
  onWrong: () => void;
  onForget: () => void;
  onFix: () => void;
  onChange: () => void;
}) {
  const run = row.rules;
  const status = said ? judge(run, said) : null;
  const look = status ? STATUS[status] : null;
  const fixable = status === "mismatch" || status === "rejudge";
  const pill = run.fires ? "bg-gain/15 text-gain" : run.outcome === "notOffered" ? "bg-ki-500/15 text-ki-300" : run.outcome === "error" ? "bg-loss/15 text-loss" : "bg-space-700/60 text-space-300";
  const own = ownLines(run);
  return (
    <li className={`rounded-xl border bg-space-950/40 p-2.5 ${look?.ring ?? "border-space-700"}`}>
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-[14px] font-semibold leading-snug text-space-100">{row.title.charAt(0).toUpperCase() + row.title.slice(1)}</p>
        <span className={`shrink-0 rounded-md px-2 py-1 text-[12px] font-bold ${pill}`}>{run.headline}</span>
      </div>

      {row.disagree && (
        <p className="mt-1.5 rounded-md bg-dbs-yellow/10 px-2 py-1 text-[11px] text-dbs-yellow">
          <span className="font-semibold">engines disagree</span> — {row.rules.engine}: {row.rules.headline} · {row.legacy.engine}: {row.legacy.headline}. An engine bug, not the rule&apos;s.
        </p>
      )}

      {said && look && (
        <p className={`mt-1.5 text-[12px] ${look.tone}`}>
          {status === "match" ? "✓ " : status === "mismatch" ? "✗ " : ""}
          {look.word}: {saidWords(said)}
        </p>
      )}

      {row.gate && (status === "mismatch" || expanded) && (
        <div className="mt-1.5 rounded-md bg-space-900 px-2 py-1.5 text-[11px] text-space-300">
          <span className="font-semibold text-space-200">Stopped at {row.gate.clause}</span>
          <ul className="mt-0.5 space-y-0.5">
            {row.gate.reasons.slice(0, expanded ? undefined : 2).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-2 flex gap-1.5">
        {status === null ? (
          <>
            <button type="button" className={`${btn} flex-1 border-gain/50 text-gain hover:bg-gain/10`} onClick={onRight} aria-label={`Right: ${row.title} → ${run.headline}`}>
              ✓ Right
            </button>
            <button type="button" className={`${btn} flex-1 border-loss/50 text-loss hover:bg-loss/10`} onClick={onWrong} aria-label={`Wrong: ${row.title} → ${run.headline}`}>
              ✗ Wrong
            </button>
          </>
        ) : (
          <>
            {fixable && (
              <button type="button" className={`${btn} flex-1 border-loss bg-loss/15 text-loss hover:bg-loss/25`} onClick={onFix}>
                Fix it
              </button>
            )}
            {status === "rejudge" && (
              <button type="button" className={`${btn} flex-1 border-gain/50 text-gain`} onClick={onRight}>
                ✓ Right now
              </button>
            )}
            {!fixable && <span className={`flex min-h-11 flex-1 items-center text-[12px] ${look?.tone ?? ""}`}>judged — kept with the rule</span>}
          </>
        )}
      </div>
      <div className="-mb-1 flex flex-wrap items-center gap-x-1">
        {canChange && (
          <button type="button" className={link} onClick={onChange}>
            Change board
          </button>
        )}
        <button type="button" className={link} onClick={onToggle} aria-expanded={expanded}>
          {expanded ? "Less" : "What happened"}
        </button>
        {status !== null && (
          <button type="button" className={`${link} ml-auto`} onClick={onForget}>
            Undo judgement
          </button>
        )}
      </div>
      {expanded && (
        <div className="mt-2 space-y-2 text-[11px]">
          <Lines title="The board" lines={run.input} />
          {own.length > 0 && (
            <div>
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-space-500">What the rule did</h3>
              <ul className="mt-0.5 space-y-1">
                {own.map((b, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-space-300">
                    <span className="shrink-0 rounded bg-space-800 px-1 py-0.5 font-mono text-[10px] text-space-400">{b.path}</span>
                    <span>{b.line}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Lines title="What changed" lines={run.result} tone="text-space-200" />
        </div>
      )}
    </li>
  );
}

/** The owner's word, back in words: "it should fire (draws 1)", "it should do nothing — not on 2 cards". */
function saidWords(e: Expectation): string {
  const note = e.note ? ` — ${e.note}` : "";
  if (e.other) return `something else, not "${e.headline ?? "that"}"${note}`;
  if (e.expected === "didNotFire") return `it should do nothing${note}`;
  return `it should fire${e.verdict === "right" && e.headline ? ` (${e.headline})` : ""}${note}`;
}

function Lines({ title, lines, tone = "text-space-400" }: { title: string; lines: string[]; tone?: string }) {
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
