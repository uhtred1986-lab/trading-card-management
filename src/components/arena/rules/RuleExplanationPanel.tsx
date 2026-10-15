"use client";

import { useEffect, useRef, useState } from "react";
import { speechSupported, startListening, type SpeechSession } from "@/lib/scan/speech";
import type { ExplanationResult, SavedExplanation } from "@/lib/arena/rule-explanation";
import { RuleReading } from "./RuleReading";

export interface ExplanationActions {
  request(id: number, version: string, text: string): Promise<{ error: string | null; result: ExplanationResult | null }>;
  approve(id: number, proposalId: number, token: string): Promise<{ error: string | null }>;
  retry(proposalId: number): Promise<{ error: string | null; result: ExplanationResult | null }>;
}
const button = "tap min-h-11 rounded-xl border border-space-500 px-3 py-2 font-semibold text-space-50 disabled:opacity-50";

export function RuleExplanationPanel({ id, version, actions, initial, onApproved, onWorking }: {
  id: number; version: string; actions: ExplanationActions; initial?: SavedExplanation; onApproved(): void; onWorking(value: boolean): void;
}) {
  const [text, setText] = useState(initial?.explanation ?? "");
  const [result, setResult] = useState<ExplanationResult | null>(initial?.result ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [supported, setSupported] = useState(false);
  const session = useRef<SpeechSession | null>(null);
  const accepting = useRef(false);
  const alive = useRef(false);
  const generation = useRef(0);
  useEffect(() => { onWorking(!!initial); }, [initial, onWorking]);
  const stop = () => {
    generation.current++;
    accepting.current = false;
    session.current?.stop(); session.current = null;
    setListening(false); setInterim("");
  };
  useEffect(() => {
    alive.current = true;
    setSupported(speechSupported());
    const cancel = () => stop();
    const hidden = () => { if (document.hidden) stop(); };
    window.addEventListener("pagehide", cancel);
    window.addEventListener("popstate", cancel);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      alive.current = false; accepting.current = false;
      generation.current++;
      session.current?.stop(); session.current = null;
      window.removeEventListener("pagehide", cancel); window.removeEventListener("popstate", cancel);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  const edit = (value: string) => { setText(value); setResult(null); setError(null); onWorking(!!value.trim()); };
  const dictate = () => {
    if (session.current) return stop();
    setError(null); accepting.current = true;
    const epoch = ++generation.current;
    const current = () => alive.current && generation.current === epoch;
    const started = startListening({
      onFinal: (alternatives) => { if (current() && accepting.current) { setText((text) => `${text}${text ? " " : ""}${alternatives[0]}`); setResult(null); onWorking(true); } },
      onInterim: (value) => { if (current() && accepting.current) setInterim(value); },
      onError: () => { if (current()) { stop(); setError("Dictation is unavailable or permission was denied. You can keep typing your explanation."); } },
      onStop: () => { if (current()) { session.current = null; accepting.current = false; setListening(false); } },
    });
    if (!current()) { started?.stop(); return; }
    session.current = started;
    setListening(!!started);
    if (!started) { accepting.current = false; setError("Dictation could not start. Type your explanation instead."); }
  };
  const perform = async (task: () => Promise<{ error: string | null; result?: ExplanationResult | null }>) => {
    if (pending) return;
    stop(); setPending(true); setError(null); onWorking(true);
    try {
      const response = await task();
      if (!alive.current) return;
      if (response.error) setError(response.error);
      else if (response.result) setResult(response.result);
    } catch { if (alive.current) setError("The request did not finish. Your explanation is still here; try again."); }
    finally { if (alive.current) setPending(false); }
  };
  const decision = result?.decision;
  const editor = <div className="space-y-3">
    <label className="block text-sm" htmlFor={`explanation-${id}`}>Your explanation</label>
    <textarea id={`explanation-${id}`} value={text} maxLength={12000} disabled={pending} onChange={(event) => edit(event.target.value)} rows={4}
      placeholder="When does it happen, what do you pay, and what happens next?" className="w-full rounded-lg border border-space-500 bg-space-950 p-3 text-base" />
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={!supported || pending} aria-pressed={listening} onClick={dictate} className={button}>{listening ? "Stop dictation" : "Dictate"}</button>
      <button type="button" disabled={pending || !text.trim() || !version} onClick={() => perform(() => actions.request(id, version, text))} className={`${button} flex-1 bg-violet-600`}>{pending ? "Working…" : "Request rule draft"}</button>
    </div>
    {!supported && <p className="text-xs text-space-300">Dictation is not available in this browser. You can type instead.</p>}
    {interim && <p role="status" className="text-sm italic">{interim}</p>}
    {text && <button type="button" disabled={pending} onClick={() => { stop(); edit(""); }} className="tap text-sm underline">Clear explanation / return to current interpretation</button>}
  </div>;
  return <section aria-label="Explain this skill" className="space-y-3 rounded-xl border border-space-600 p-3 text-space-100">
    <h3 className="font-bold text-space-50">Describe how this skill should work</h3>
    {decision?.kind === "supported" ? <details><summary className="tap cursor-pointer text-sm underline">Edit the explanation / request a different draft</summary>{editor}</details> : editor}
    {error && <p role="alert" className="text-sm text-loss">{error}</p>}
    {decision?.kind === "question" && <div role="status" className="space-y-2 rounded-lg bg-space-800 p-3"><h4 className="font-bold">One point needs clarification</h4><p>{decision.question}</p><p className="text-sm text-space-300">Add your answer to the explanation above, including the original context, then request a new draft.</p><details><summary className="tap cursor-pointer">Claude’s reading so far</summary><p>{decision.meaning}</p></details></div>}
    {decision?.kind === "invalid" && <p role="alert" className="text-loss">Invalid AI output: {decision.error}</p>}
    {decision?.kind === "supported" && <div className="space-y-3">
      <p>{decision.meaning}</p>
      <RuleReading rule={decision.rule} title="Proposed interpretation" />
      <button type="button" disabled={pending} className={`${button} w-full bg-space-50 text-space-950`} onClick={() => perform(async () => {
        const response = await actions.approve(id, result!.proposalId!, result!.token!);
        if (!response.error && alive.current) onApproved();
        return response;
      })}>Approve this exact draft</button>
      <details className="text-sm text-space-300"><summary className="tap cursor-pointer">More details: rule language and validation</summary><p>The complete rule passed structural and known capability checks. Approval records your interpretation; it does not prove every game context.</p><pre className="overflow-auto whitespace-pre-wrap break-words">{decision.reading}</pre></details>
    </div>}
    {decision?.kind === "unsupported" && <div role="status" className="space-y-2 rounded-lg bg-space-800 p-3">
      <h4 className="font-bold">Engine coding is needed</h4><p>The interpretation was not applied. Coding feedback is saved.</p>
      {result?.issueUrl ? <a className="tap inline-block underline" href={result.issueUrl} target="_blank" rel="noreferrer">Open coding issue</a> : <><p>{result?.issueError || "GitHub sync is pending; no issue link is confirmed."}</p><button type="button" disabled={pending} onClick={() => perform(() => actions.retry(result!.proposalId!))} className={button}>Retry issue sync</button></>}
      <details><summary className="tap cursor-pointer">More details: missing capability</summary><p>{decision.meaning}</p><ul>{decision.missing.map((gap) => <li key={gap}>{gap}</li>)}</ul><pre className="overflow-auto whitespace-pre-wrap break-words">{decision.proposed}</pre></details>
    </div>}
  </section>;
}
