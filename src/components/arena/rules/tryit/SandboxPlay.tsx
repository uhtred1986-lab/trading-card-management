"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sandboxFixtureSeedAction, sandboxJudgeAction, sandboxSeedAction, type SandboxSeedResult } from "@/app/arena/rules/sandbox-actions";
import { ArenaStage } from "@/components/arena/stage/ArenaStage";
import { draftKey } from "@/lib/arena/sandbox/draft";
import { createSandboxSession, replayMoves, type JournalEntry, type SandboxSeed, type SandboxSession } from "@/lib/arena/sandbox/session";
import type { Should } from "@/lib/arena/sandbox/judgement";
import type { Snapshot } from "@/lib/arena/snapshot";
import type { ArenaSkin } from "@/lib/arena/skin";
import type { ArenaStaging } from "@/lib/arena/staging";
import type { TurnLighting } from "@/lib/arena/lighting";

/**
 * The play-test sandbox (Rules PR 5): the staged board of a Try it row, on the
 * real `ArenaStage`, with the builder's unsaved rule installed and the local
 * AI policy as the opponent. Everything runs in memory (`lib/arena/sandbox`);
 * the page's only server calls are the seed and the owner's judgement.
 *
 * The draft arrives through `sessionStorage` (`draftKey`), put there by the
 * "Play this board" link on a Try it row, so the edit → play → edit loop
 * survives navigation; with none, the saved rule is played.
 */
export interface SandboxPlayProps {
  /** The rule row being played; null in the development preview. */
  ruleId: number | null;
  /** The development preview's synthetic card (no database). */
  fixture?: string;
  boardKey: string | null;
  /** Where "Back to the rule" goes. */
  backHref: string;
  /** Development preview only: pretend edits, as the builder would hand them over. */
  edits?: { label: string; rule: unknown }[];
  skin?: ArenaSkin;
  staging?: ArenaStaging;
  lighting?: TurnLighting;
}

function readDraft(key: string): unknown {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const card = "rounded-xl border border-space-700/70 bg-space-900/50 p-3";
const heading = "text-[10px] font-semibold uppercase tracking-wide text-space-500";
const btn = "tap inline-flex min-h-11 items-center justify-center gap-1 whitespace-normal rounded-lg border px-3 text-[14px] font-semibold disabled:opacity-50";

export function SandboxPlay({ ruleId, fixture, boardKey, backHref, edits, skin, staging, lighting }: SandboxPlayProps) {
  const key = draftKey(ruleId, fixture);
  const [session, setSession] = useState<SandboxSession | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [seed, setSeed] = useState<SandboxSeed | null>(null);
  const [info, setInfo] = useState<SandboxSeedResult["card"]>(null);
  const [board, setBoard] = useState<string | null>(boardKey);
  const [hasEdit, setHasEdit] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [opponentStop, setOpponentStop] = useState<string | null>(null);
  const [engineStop, setEngineStop] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [verdict, setVerdict] = useState<{ state: "idle" | "asking" | "saving" | "saved"; text?: string }>({ state: "idle" });
  const [should, setShould] = useState<Should>("fire");
  const [note, setNote] = useState("");
  const current = useRef<SandboxSession | null>(null);

  const fetchSeed = useCallback(
    async (draft: unknown, boardTo: string | null): Promise<SandboxSeedResult> => {
      try {
        return fixture !== undefined ? await sandboxFixtureSeedAction(fixture, draft, boardTo) : await sandboxSeedAction(ruleId ?? 0, draft, boardTo);
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e), seed: null, card: null };
      }
    },
    [fixture, ruleId],
  );

  const attach = useCallback((next: SandboxSession, made: SandboxSeedResult, draft: unknown) => {
    current.current = next;
    setSession(next);
    setSnapshot(next.getSnapshot());
    setEntries(next.journal());
    setSeed(made.seed);
    setInfo(made.card);
    setBoard(made.seed?.boardKey ?? null);
    setHasEdit(draft != null);
    setOpponentStop(next.interruption());
    setEngineStop(next.engineInterruption());
    setVerdict({ state: "idle" });
    setGeneration((g) => g + 1);
  }, []);

  /** Re-seed from the current draft: a fresh game, or the moves already made played again. */
  const start = useCallback(
    async (mode: "fresh" | "replay", boardTo: string | null) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      const draft = readDraft(key);
      const made = await fetchSeed(draft, boardTo);
      if (made.error || !made.seed) {
        setError(made.error ?? "No board.");
        setBusy(false);
        return;
      }
      if (mode === "replay" && current.current) {
        const mine = current.current.journal().filter((e) => e.actor === "p1");
        const done = await replayMoves(made.seed, mine);
        attach(done.session, made, draft);
        setNotice(done.stop ? done.stop.message : `Replayed ${done.played} ${done.played === 1 ? "move" : "moves"} of yours with your edit.`);
      } else {
        const fresh = createSandboxSession(made.seed);
        await fresh.advance();
        attach(fresh, made, draft);
      }
      setBusy(false);
    },
    [attach, fetchSeed, key],
  );

  useEffect(() => {
    // The first board is staged once, from the browser-only draft: an external storage synchronisation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void start("fresh", boardKey);
  }, [start, boardKey]);

  useEffect(() => {
    if (!session) return;
    return session.subscribe((update) => {
      setSnapshot(update.snapshot);
      setEntries(session.journal());
      setOpponentStop(session.interruption());
      setEngineStop(session.engineInterruption());
    });
  }, [session]);

  const changeBoard = (to: string) => {
    try {
      window.history.replaceState(null, "", `?${new URLSearchParams({ ...(ruleId != null ? { rule: String(ruleId) } : {}), board: to }).toString()}`);
    } catch {
      /* the address bar is a convenience */
    }
    void start("fresh", to);
  };

  const judge = async (v: "right" | { should: Should; note: string }) => {
    if (ruleId == null || !board) return;
    setVerdict({ state: "saving" });
    try {
      const r = await sandboxJudgeAction(ruleId, readDraft(key), board, v);
      setVerdict(r.error ? { state: "idle", text: r.error } : { state: "saved", text: v === "right" ? "Kept: this is what should happen here." : "Kept: this is not what should happen here." });
    } catch (e) {
      setVerdict({ state: "idle", text: e instanceof Error ? e.message : String(e) });
    }
  };

  const draftText = useMemo(() => {
    if (!hasEdit) return null;
    const d = readDraft(key);
    try {
      return d ? JSON.stringify(d, null, 1) : null;
    } catch {
      return null;
    }
    // `generation` moves whenever the draft was read again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasEdit, key, generation]);

  const stopped = engineStop ?? opponentStop;
  const played = entries.some((e) => e.actor === "p1");

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0">
        {session && snapshot ? (
          <ArenaStage key={generation} session={session} snapshot={snapshot} skin={skin} staging={staging} lighting={lighting} menu={<Link href={backHref}>Back to the rule</Link>} />
        ) : (
          <div className={`${card} text-sm text-space-400`}>{error ?? "Setting up the board…"}</div>
        )}
      </div>

      <aside className="space-y-3 lg:sticky lg:top-3 lg:self-start" aria-label="Play-test">
        <section className={card}>
          <h2 className={heading}>What is tested</h2>
          {info && (
            <p className="mt-1 text-[14px] font-semibold leading-snug text-space-100">
              {info.name} <span className="font-normal text-space-400">· skill {info.skillIndex + 1}</span>
            </p>
          )}
          {info?.printed && <p className="mt-1 text-[12px] text-space-300">{info.printed}</p>}
          <p className={`mt-2 inline-block rounded-md px-2 py-1 text-[12px] font-semibold ${hasEdit ? "bg-ki-500/15 text-ki-300" : "bg-space-800 text-space-300"}`}>{hasEdit ? "Playing your unsaved edit" : "Playing the saved rule"}</p>
          {draftText && (
            <details className="mt-2 text-[11px] text-space-400">
              <summary className="cursor-pointer">Your unsaved edit</summary>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-space-950/60 p-2 font-mono text-[10px] text-space-300">{draftText}</pre>
            </details>
          )}
          <label className="mt-3 block text-[12px] text-space-400">
            Board
            <select className="tap mt-1 block min-h-11 w-full rounded-lg border border-space-700 bg-space-950 px-2 text-[14px] text-space-100" value={board ?? ""} disabled={busy || !seed} onChange={(e) => changeBoard(e.target.value)}>
              {(seed?.boards ?? []).map((b) => (
                <option key={b.key} value={b.key}>
                  {b.title}
                </option>
              ))}
            </select>
          </label>
          <p className="mt-2 text-[12px] text-space-400">
            Opponent: <span className="font-semibold text-space-200">Local AI</span> — the same policy the offline match uses.
          </p>
          {seed && seed.waitsFor.length > 0 && <p className="mt-1 text-[12px] text-space-400">This board is set up for you to {seed.waitsFor.join(", then ")}.</p>}
          {seed && (
            <details className="mt-2 text-[11px] text-space-400">
              <summary className="cursor-pointer">How the board is built</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {seed.input.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </details>
          )}
        </section>

        {(stopped || error || notice) && (
          <section role="status" className={`rounded-xl border p-3 text-[12px] ${stopped || error ? "border-loss/60 bg-loss/10 text-loss" : "border-ki-500/50 bg-ki-500/10 text-ki-300"}`}>
            {engineStop && <p><strong>The engine interrupted this game.</strong> {engineStop}</p>}
            {!engineStop && opponentStop && <p><strong>The local AI stopped.</strong> {opponentStop}</p>}
            {error && <p>{error}</p>}
            {notice && <p>{notice}</p>}
          </section>
        )}

        <section className={card}>
          <h2 className={heading}>Your edit</h2>
          <div className="mt-2 flex flex-col gap-1.5">
            <button type="button" className={`${btn} border-ki-500/60 text-ki-300 hover:bg-ki-500/10`} disabled={busy} onClick={() => void start("fresh", board)}>
              Reset with my edit
            </button>
            <button type="button" className={`${btn} border-space-600 text-space-200 hover:bg-space-800`} disabled={busy || !played} onClick={() => void start("replay", board)}>
              Replay my moves with my edit
            </button>
          </div>
          {edits && edits.length > 0 && (
            <div className="mt-2 border-t border-space-800 pt-2">
              <p className={heading}>Development preview: pretend edit</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {edits.map((e) => (
                  <button
                    key={e.label}
                    type="button"
                    className={`${btn} border-space-700 text-[12px] text-space-300`}
                    onClick={() => {
                      try {
                        sessionStorage.setItem(key, JSON.stringify(e.rule));
                      } catch {
                        /* storage can be blocked */
                      }
                      void start("fresh", board);
                    }}
                  >
                    {e.label}
                  </button>
                ))}
                <button
                  type="button"
                  className={`${btn} border-space-700 text-[12px] text-space-300`}
                  onClick={() => {
                    try {
                      sessionStorage.removeItem(key);
                    } catch {
                      /* storage can be blocked */
                    }
                    void start("fresh", board);
                  }}
                >
                  Clear edit
                </button>
              </div>
            </div>
          )}
        </section>

        <section className={card}>
          <h2 className={heading}>Did it play right?</h2>
          {ruleId == null ? (
            <p className="mt-1 text-[12px] text-space-500">Judging needs a saved rule; the development preview has none.</p>
          ) : verdict.state === "asking" ? (
            <div className="mt-2 space-y-2 text-[12px] text-space-300">
              <fieldset className="space-y-1">
                <legend className="sr-only">What should have happened</legend>
                {([["fire", "It should have fired here"], ["notFire", "It should have done nothing here"], ["other", "It should have done something else"]] as const).map(([v, label]) => (
                  <label key={v} className="flex min-h-11 items-center gap-2">
                    <input type="radio" name="should" checked={should === v} onChange={() => setShould(v)} />
                    {label}
                  </label>
                ))}
              </fieldset>
              <textarea className="w-full rounded-lg border border-space-700 bg-space-950 p-2 text-[13px] text-space-100" rows={2} placeholder="What should it have done? (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex gap-1.5">
                <button type="button" className={`${btn} flex-1 border-loss bg-loss/15 text-loss`} onClick={() => void judge({ should, note })}>
                  Keep as wrong
                </button>
                <button type="button" className={`${btn} border-space-600 text-space-300`} onClick={() => setVerdict({ state: "idle" })}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex gap-1.5">
              <button type="button" className={`${btn} flex-1 border-gain/50 text-gain hover:bg-gain/10`} disabled={busy || verdict.state === "saving" || !board} onClick={() => void judge("right")}>
                ✓ Played right
              </button>
              <button type="button" className={`${btn} flex-1 border-loss/50 text-loss hover:bg-loss/10`} disabled={busy || verdict.state === "saving" || !board} onClick={() => setVerdict({ state: "asking" })}>
                ✗ Played wrong
              </button>
            </div>
          )}
          {verdict.state === "saving" && <p className="mt-1 text-[12px] text-space-400">Saving…</p>}
          {verdict.text && <p className={`mt-1 text-[12px] ${verdict.state === "saved" ? "text-gain" : "text-loss"}`}>{verdict.text}</p>}
          <p className="mt-2 text-[11px] text-space-500">The judgement is about the board, not about this exact game; it is kept with the rule as Try it keeps it, and does not save your edit.</p>
        </section>

        <section className={card}>
          <h2 className={heading}>What happened</h2>
          {entries.length === 0 ? (
            <p className="mt-1 text-[12px] text-space-500">Nothing yet. Make a move on the board.</p>
          ) : (
            <ol className="mt-1 max-h-72 space-y-1.5 overflow-auto text-[12px]">
              {entries.map((e, i) => (
                <li key={i}>
                  <span className={`mr-1 rounded px-1 py-0.5 font-mono text-[10px] ${e.actor === "p1" ? "bg-space-800 text-space-300" : "bg-ki-500/15 text-ki-300"}`}>{e.actor === "p1" ? "you" : "AI"}</span>
                  {e.lines.length ? e.lines.join(" ") : e.label}
                </li>
              ))}
            </ol>
          )}
        </section>
      </aside>
    </div>
  );
}
