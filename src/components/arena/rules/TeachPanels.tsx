"use client";

/**
 * The builder's two quick ways to teach a clause (#473), beside its Blocks
 * tab (#469): **In my words** — say what it means, Claude writes it in the
 * rules language and asks back when it is unclear — and **Like a card** — copy
 * the clause from a rule that already says the same thing.
 *
 * Both are self-contained panels with one contract, `TeachPanelProps`: the
 * builder says which record and which clause, and gets a `Rule` back through
 * `onRule`. Every rule handed over has passed `parseRule`/`validateRule` on
 * the server. Nothing is saved here; the owner checks the blocks and saves in
 * the builder.
 *
 * Mount them with `teachTabs`. The `…View` components take the server call
 * as a prop so a preview can drive them with a stub; the plain names wire in
 * the real actions.
 */
import { useEffect, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { likeCardsAction, teachInWordsAction, type LikeResult } from "@/app/arena/rules/teach-actions";
import type { Rule } from "@/lib/arena/lang/ast";
import type { RuleClause } from "@/lib/arena/lang/path";
import type { LikeMatch } from "@/lib/arena/teach/like";
import type { TeachOutcome, TeachTurn } from "@/lib/arena/teach/words";
import { speechSupported, startListening, type SpeechSession } from "@/lib/scan/speech";

export interface TeachPanelProps {
  ruleId: number;
  clause: RuleClause;
  onRule: (rule: Rule) => void;
}

/** The shape #469's builder mounts: `teachTabs?: TeachTab[]`. */
export interface TeachTab {
  key: string;
  label: string;
  render: (p: TeachPanelProps) => ReactNode;
}

const CLAUSE_NAME: Record<RuleClause, string> = { trigger: "WHEN", cost: "COST", cond: "IF", ops: "THEN" };

const label = "text-[11px] font-bold uppercase tracking-[0.14em] text-space-300";
const primary = "tap w-full rounded-xl bg-ki-500 px-4 text-sm font-bold text-space-950 hover:bg-ki-400 disabled:opacity-50";
const option = "tap flex w-full items-center gap-3 rounded-xl border border-space-600 bg-space-900/60 px-3 py-2 text-left text-sm font-semibold text-space-100 hover:border-ki-400 disabled:opacity-50";
const reading = "space-y-1.5 rounded-xl border border-ki-500/40 bg-ki-500/5 p-3";

// ── In my words ──────────────────────────────────────────────────────────────

export type TeachRun = (ruleId: number, clause: RuleClause, said: string, turns: TeachTurn[]) => Promise<TeachOutcome>;

export function InMyWords(p: TeachPanelProps) {
  return <InMyWordsView {...p} run={teachInWordsAction} />;
}

export function InMyWordsView({ ruleId, clause, onRule, run }: TeachPanelProps & { run: TeachRun }) {
  const [said, setSaid] = useState("");
  const [turns, setTurns] = useState<TeachTurn[]>([]);
  const [outcome, setOutcome] = useState<TeachOutcome | null>(null);
  const [own, setOwn] = useState("");
  const [pending, start] = useTransition();
  const mic = useMic((heard) => setSaid((s) => (s.trim() ? `${s.trim()} ${heard}` : heard)));

  const ask = (next: TeachTurn[]) => {
    setTurns(next);
    start(async () => {
      try {
        setOutcome(await run(ruleId, clause, said, next));
      } catch (err) {
        setOutcome({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      }
    });
  };
  const answer = (text: string) => {
    if (outcome?.kind !== "question" || !text.trim()) return;
    setOwn("");
    ask([...turns, { question: outcome.question, options: outcome.options, answer: text.trim() }]);
  };

  return (
    <div className="flex flex-col gap-3" data-testid="teach-in-my-words">
      <label className={label} htmlFor={`teach-say-${ruleId}`}>
        Say what the {CLAUSE_NAME[clause]} part means, like you’d explain it to a friend
      </label>
      <div className="relative">
        <textarea
          id={`teach-say-${ruleId}`}
          value={mic.interim ? `${said}${said ? " " : ""}${mic.interim}` : said}
          onChange={(e) => setSaid(e.target.value)}
          rows={4}
          maxLength={2000}
          className="w-full resize-none rounded-xl border border-space-600 bg-space-900/60 p-3 pr-14 text-base leading-snug text-space-50 placeholder:text-space-400"
          placeholder="Count the blue cards in my drop area. If there are 3 or more, I draw."
        />
        {mic.supported && (
          <button
            type="button"
            onClick={mic.toggle}
            aria-pressed={mic.listening}
            aria-label={mic.listening ? "Stop listening" : "Speak instead of typing"}
            className={`tap absolute bottom-2 right-2 grid w-11 place-items-center rounded-xl ${mic.listening ? "bg-loss/30 text-loss" : "bg-ki-500/15 text-ki-300"}`}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          </button>
        )}
      </div>
      {mic.error && <p className="text-xs text-loss">{mic.error}</p>}

      <button type="button" className={primary} disabled={pending || !said.trim()} onClick={() => ask([])}>
        {pending && !turns.length ? "Claude is reading the card…" : outcome ? "Turn it into a rule again" : "Turn it into a rule"}
      </button>

      {turns.length > 0 && (
        <ol className="space-y-1 text-xs text-space-300" aria-label="Your answers so far">
          {turns.map((t, i) => (
            <li key={i}>
              <span className="text-space-400">Claude asked:</span> {t.question} <span className="text-space-400">·</span> <b className="text-space-100">{t.answer}</b>
            </li>
          ))}
        </ol>
      )}

      <div aria-live="polite" className="flex flex-col gap-3">
        {pending && turns.length > 0 && <p className="text-sm text-space-300">Claude is thinking it over…</p>}

        {!pending && outcome?.kind === "question" && (
          <div className="flex flex-col gap-2.5 rounded-2xl rounded-bl-sm border border-space-600 bg-space-800 p-3">
            <span className="text-xs font-bold italic text-ki-300">Claude asks</span>
            <p className="text-base font-semibold leading-snug text-space-50">{outcome.question}</p>
            <div className="flex flex-col gap-1.5">
              {outcome.options.map((o) => (
                <button key={o} type="button" className={option} onClick={() => answer(o)}>
                  <span className="h-4 w-4 flex-none rounded-full border-2 border-space-400" aria-hidden />
                  {o}
                </button>
              ))}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                answer(own);
              }}
            >
              <input value={own} onChange={(e) => setOwn(e.target.value)} placeholder="Or answer in your own words" className="tap min-w-0 flex-1 rounded-xl border border-space-600 bg-space-900/60 px-3 text-sm text-space-100 placeholder:text-space-400" />
              <button type="submit" disabled={!own.trim()} className="tap rounded-xl border border-space-600 px-3 text-sm font-semibold text-space-100 disabled:opacity-50">
                Send
              </button>
            </form>
            <p className="text-[11px] text-space-400">Question {outcome.asked} of at most 3.</p>
          </div>
        )}

        {!pending && outcome?.kind === "rule" && (
          <div className={reading}>
            <small className={label}>The engine would read</small>
            <b className="block text-base leading-snug text-space-50">{outcome.clauseReads || outcome.reads}</b>
            {outcome.clauseReads && <p className="text-xs text-space-300">The whole skill: {outcome.reads}.</p>}
            {outcome.meaning && <p className="text-xs italic text-space-300">Claude: {outcome.meaning}</p>}
            <details className="text-xs text-space-300">
              <summary className="tap flex cursor-pointer items-center">As text</summary>
              <pre className="overflow-x-auto rounded-lg bg-space-950 p-2 font-mono text-[11px] leading-relaxed text-space-200">{outcome.text}</pre>
            </details>
            <button type="button" className="tap -mb-1 text-left text-sm font-bold text-ki-300 hover:underline" onClick={() => onRule(outcome.rule)}>
              Claude made this · adjust it in Blocks →
            </button>
          </div>
        )}

        {!pending && outcome?.kind === "error" && (
          <div className="space-y-1.5 rounded-xl border border-loss/50 bg-loss/5 p-3 text-sm text-space-100" role="alert">
            <p>{outcome.message}</p>
            {outcome.problem?.langError && (
              <p className="font-mono text-[11px] text-space-300">
                line {outcome.problem.langError.line}, col {outcome.problem.langError.col}: {outcome.problem.langError.lineText.trim()}
              </p>
            )}
            {outcome.text && (
              <details className="text-xs text-space-300">
                <summary className="tap flex cursor-pointer items-center">What Claude wrote</summary>
                <pre className="overflow-x-auto rounded-lg bg-space-950 p-2 font-mono text-[11px]">{outcome.text}</pre>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** The browser's own speech input, appending what it hears; nothing is uploaded. */
function useMic(onHeard: (text: string) => void) {
  const supported = useSyncExternalStore(
    () => () => {},
    () => speechSupported(),
    () => false,
  );
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const session = useRef<SpeechSession | null>(null);
  const heard = useRef(onHeard);
  useEffect(() => {
    heard.current = onHeard;
  });
  useEffect(() => () => session.current?.stop(), []);

  const toggle = () => {
    if (session.current) {
      session.current.stop();
      session.current = null;
      setListening(false);
      setInterim("");
      return;
    }
    setError(null);
    const s = startListening({
      onFinal: (alts) => heard.current(alts[0]),
      onInterim: setInterim,
      onError: (e) => {
        setError(e === "not-allowed" || e === "service-not-allowed" ? "Microphone permission was refused — allow it in the browser and try again." : `Speech recognition error: ${e}`);
        session.current = null;
        setListening(false);
        setInterim("");
      },
      onStop: () => {
        session.current = null;
        setListening(false);
        setInterim("");
      },
    });
    session.current = s;
    setListening(!!s);
  };
  return { supported, listening, interim, error, toggle };
}

// ── Like a card ──────────────────────────────────────────────────────────────

export type LikeLoad = (ruleId: number, clause: RuleClause, query: string) => Promise<LikeResult>;

export function LikeACard(p: TeachPanelProps) {
  return <LikeACardView {...p} load={likeCardsAction} />;
}

export function LikeACardView({ ruleId, clause, onRule, load }: TeachPanelProps & { load: LikeLoad }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<LikeResult | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [pending, start] = useTransition();

  // Typing waits a moment before searching; the first load does not.
  useEffect(() => {
    const t = setTimeout(
      () =>
        start(async () => {
          try {
            setResult(await load(ruleId, clause, query));
          } catch (err) {
            setResult({ error: err instanceof Error ? err.message : String(err), clauseWords: "", matches: [] });
          }
        }),
      query ? 350 : 0,
    );
    return () => clearTimeout(t);
  }, [load, ruleId, clause, query]);

  const chosen = result?.matches.find((m) => m.id === picked) ?? null;

  return (
    <div className="flex flex-col gap-3" data-testid="teach-like-a-card">
      <label className="sr-only" htmlFor={`teach-like-${ruleId}`}>
        Search the rules
      </label>
      <input
        id={`teach-like-${ruleId}`}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Cards the engine already reads with this wording"
        className="tap w-full rounded-xl border border-space-600 bg-space-900/60 px-3 text-base text-space-100 placeholder:text-space-400"
      />
      {result?.clauseWords && !query && (
        <p className="text-xs text-space-300">
          Rules that say <q className="text-space-100">{result.clauseWords}</q>, or close to it — the same wording first, checked rules before drafts.
        </p>
      )}
      {result?.error && (
        <p className="text-sm text-loss" role="alert">
          {result.error}
        </p>
      )}
      {pending && !result && <p className="text-sm text-space-300">Looking…</p>}
      {result && !result.error && !result.matches.length && <p className="text-sm text-space-300">{pending ? "Looking…" : "No rule says it this way yet. Try other words, or teach it in your words."}</p>}

      <ul className={`flex flex-col gap-2 ${pending ? "opacity-60" : ""}`}>
        {result?.matches.map((m) => (
          <li key={m.id}>
            <LikeRowButton m={m} on={m.id === picked} onPick={() => setPicked(m.id === picked ? null : m.id)} />
            {m.id === picked && chosen && (
              <div className={`${reading} mt-1.5`}>
                <small className={label}>Borrowed reading</small>
                <b className="block text-base leading-snug text-space-50">{chosen.reads || "nothing"}</b>
                {chosen.notes.map((n) => (
                  <p key={n} className="text-sm font-semibold text-ki-300">
                    {n}
                  </p>
                ))}
                {chosen.problem && <p className="text-sm text-loss">{chosen.problem}</p>}
                <button type="button" disabled={!chosen.rule} className={`${primary} mt-1`} onClick={() => chosen.rule && onRule(chosen.rule)}>
                  Copy this {CLAUSE_NAME[clause]} into Blocks
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function LikeRowButton({ m, on, onPick }: { m: LikeMatch; on: boolean; onPick: () => void }) {
  const [a, b] = m.highlight ?? [0, 0];
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onPick}
      className={`tap w-full rounded-xl border p-3 text-left ${on ? "border-ki-400 bg-ki-500/10" : "border-space-700 bg-space-900/60 hover:border-space-500"}`}
    >
      <span className="flex flex-wrap items-baseline gap-x-2">
        <b className="text-sm text-space-50">{m.name}</b>
        <span className="font-mono text-[11px] text-space-400">{m.cardId}</span>
      </span>
      <span className="mt-1 block text-sm leading-snug text-space-300">
        {m.highlight ? (
          <>
            {m.printed.slice(0, a)}
            <mark className="rounded bg-transparent px-0.5 text-space-50 underline decoration-ki-400 decoration-2 underline-offset-4">{m.printed.slice(a, b)}</mark>
            {m.printed.slice(b)}
          </>
        ) : (
          m.printed
        )}
      </span>
      <span className="mt-1.5 flex flex-wrap gap-1.5">
        <small className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${m.checked ? "bg-gain/15 text-gain" : "bg-dbs-blue/15 text-sky-300"}`}>{m.label}</small>
        {m.samePattern && <small className="rounded-md bg-space-800 px-1.5 py-0.5 text-[11px] font-bold text-space-300">same wording</small>}
      </span>
    </button>
  );
}

// ── the tabs, ready for the builder ─────────────────────────────────────────

/** What #469's builder takes as `teachTabs`: one entry per tab, beside its own Blocks. */
export const teachTabs: TeachTab[] = [
  { key: "words", label: "In my words", render: (p) => <InMyWords {...p} /> },
  { key: "like", label: "Like a card", render: (p) => <LikeACard {...p} /> },
];
