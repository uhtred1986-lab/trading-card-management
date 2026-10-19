"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { confirmRuleAction, undoConfirmAction } from "@/app/arena/actions";
import { flagWrongAction, unflagWrongAction } from "@/app/arena/rules/review/actions";
import { requestExplanationAction, approveExplanationAction, retryExplanationIssueAction, reopenReviewedRuleAction } from "@/app/arena/rules/review/explanation-actions";
import { RuleExplanationPanel, type ExplanationActions } from "./RuleExplanationPanel";
import { RuleReading } from "./RuleReading";
import type { Rule } from "@/lib/arena/lang/ast";
import { CardImage } from "@/components/CardImage";
import { AdminContext, useArenaAdmin } from "@/components/arena/admin-context";
import { WRONG_REASONS, approvalProblem, builderHref, reviewText, type ClauseTag, type ReviewText, type WrongReason } from "@/lib/arena/rule-review";
import type { FlagReceipt, ReviewItem } from "@/lib/arena/rule-review-store";

/**
 * The phone's rule review (#472, design: the "Rule review on the phone" row of
 * the DBS Arena Redesign canvas): one skill at a time, its printed text large,
 * each clause the record can tie to printed words underlined in its colour
 * (WHEN blue, IF purple, DO orange, an unread one red and dashed), the rest
 * listed under the text, and one tap for a verdict. What is underlined and
 * why is `rule-review.ts`; nothing here decides a span.
 *
 * Verdicts are kept here for the sitting, so the queue does not reshuffle
 * under the thumb; the server is told at once and every verdict can be undone
 * from its toast.
 */

type ReviewProps = { items: ReviewItem[]; scope: string; backHref: string; reviewHref?: string; flagged?: number; flaggedOnly?: boolean; startId?: number | null; explanationActions?: ExplanationActions; confirmAction?: typeof confirmRuleAction; reopenAction?: typeof reopenReviewedRuleAction };
const LIVE_EXPLANATION: ExplanationActions = { request: requestExplanationAction, approve: approveExplanationAction, retry: retryExplanationIssueAction };

type Verdict = "right" | "all" | "wrong" | "skip";
type Undo =
  | { kind: "right"; at: number; id: number }
  | { kind: "all"; at: number; batchId: number; ids: number[] }
  | { kind: "wrong"; at: number; receipt: FlagReceipt }
  | { kind: "skip"; at: number };
/** A clause of the text view: `c` an index into `clauses`, `u` into `unread`. */
type Pick = `c${number}` | `u${number}`;

const TONE: Record<ClauseTag | "UNREAD", { line: string; text: string; chip: string }> = {
  WHEN: { line: "decoration-sky-500", text: "text-sky-500", chip: "bg-sky-500/15 text-sky-500" },
  COST: { line: "decoration-space-300", text: "text-space-300", chip: "bg-space-300/15 text-space-300" },
  IF: { line: "decoration-violet-500", text: "text-violet-500", chip: "bg-violet-500/15 text-violet-500" },
  DO: { line: "decoration-ki-500", text: "text-ki-500", chip: "bg-ki-500/15 text-ki-500" },
  UNREAD: { line: "decoration-loss", text: "text-loss", chip: "bg-loss/15 text-loss" },
};
const SEG: Record<Verdict, string> = { right: "bg-gain", all: "bg-gain", wrong: "bg-loss", skip: "bg-space-500" };
const actBtn = "tap flex h-[60px] min-w-0 items-center justify-center gap-1.5 whitespace-normal rounded-2xl px-2 text-sm font-semibold disabled:opacity-50";
const approvalBtn = "tap flex min-h-[60px] min-w-0 items-center justify-center gap-1.5 whitespace-normal rounded-xl border border-space-500 bg-space-900 px-3 py-2 text-sm font-semibold text-space-100 disabled:opacity-50";

function Chip({ tag, className = "" }: { tag: ClauseTag | "UNREAD"; className?: string }) {
  return <span className={`shrink-0 rounded-md px-1.5 py-1 text-[11px] font-extrabold leading-none tracking-widest ${TONE[tag].chip} ${className}`}>{tag}</span>;
}

/** What the readings panel and the Wrong sheet say about one clause. */
function partOf(t: ReviewText, pick: Pick): { tag: ClauseTag | "UNREAD"; path: string | null; words: string | null; reads: string | null } {
  if (pick.startsWith("u")) {
    const u = t.unread[Number(pick.slice(1))];
    return { tag: "UNREAD", path: null, words: u?.text ?? null, reads: null };
  }
  const c = t.clauses[Number(pick.slice(1))];
  return { tag: c?.tag ?? "DO", path: c?.path ?? null, words: c?.span ? t.printed.slice(c.span.start, c.span.end) : null, reads: c?.reads ?? null };
}

/** Every clause, in reading order: unread ones first when the skill is blank, since they are why. */
function picksOf(t: ReviewText): Pick[] {
  const c = t.clauses.map((_, i) => `c${i}` as Pick);
  const u = t.unread.map((_, i) => `u${i}` as Pick);
  return t.blank ? [...u, ...c] : [...c, ...u];
}

export function RuleReview({ admin, ...props }: ReviewProps & { admin: boolean }) {
  return (
    <AdminContext.Provider value={admin}>
      <Queue {...props} />
    </AdminContext.Provider>
  );
}

function Queue({ items: initial, scope, backHref, reviewHref = "/arena/rules/review", flagged = 0, flaggedOnly = false, startId, explanationActions = LIVE_EXPLANATION, confirmAction = confirmRuleAction, reopenAction = reopenReviewedRuleAction }: ReviewProps) {
  const admin = useArenaAdmin();
  const [items, setItems] = useState(() => {
    const first = initial.findIndex((x) => x.id === startId);
    return first > 0 ? [...initial.slice(first), ...initial.slice(0, first)] : initial;
  });
  const [at, setAt] = useState(0);
  const [step, setStep] = useState<"printed" | "interpretation">("printed");
  const [mode, setMode] = useState<"text" | "card">("text");
  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, [at, step]);
  const [pick, setPick] = useState<Pick | null>(null);
  const [verdicts, setVerdicts] = useState<Record<number, Verdict>>({});
  const [history, setHistory] = useState<Undo[]>([]);
  const [toast, setToast] = useState<{ text: string; undo: boolean } | null>(null);
  const [sheet, setSheet] = useState(false);
  const [part, setPart] = useState<Pick | null>(null);
  const [reason, setReason] = useState<WrongReason | null>(null);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [explaining, setExplaining] = useState(!!items[0]?.pendingExplanation);

  const done = at >= items.length;
  const item = done ? null : items[at];
  const text = useMemo(() => (item ? reviewText(item) : null), [item]);
  const left = items.filter((x) => !verdicts[x.id]).length;
  const picks = text ? picksOf(text) : [];
  const sel: Pick | null = pick ?? picks[0] ?? null;

  /** The next card with no verdict yet, after `from`; the end of the queue when there is none. */
  const nextFrom = (from: number, v: Record<number, Verdict>) => {
    const k = items.findIndex((x, i) => i > from && !v[x.id]);
    return k < 0 ? items.length : k;
  };
  const go = (v: Record<number, Verdict>, undo: Undo, say: string) => {
    setExplaining(false);
    setVerdicts(v);
    setHistory((h) => [...h, undo]);
    setAt(nextFrom(at, v));
    setPick(null);
    setStep("printed");
    setSheet(false);
    setReason(null);
    setNote("");
    setToast({ text: say, undo: true });
  };
  const fail = (error: string) => setToast({ text: error, undo: false });

  const right = () => {
    if (!item) return;
    start(async () => {
      if (!item.reviewVersion) return fail("Reload this skill before approving its exact interpretation.");
      const res = await confirmAction(item.id, item.reviewVersion);
      if (res.error) return fail(res.error);
      go({ ...verdicts, [item.id]: "right" }, { kind: "right", at, id: item.id }, `Approved the previous skill: ${item.name}. Interpretation saved; test evidence is separate.`);
    });
  };
  const skip = () => {
    if (!item) return;
    go({ ...verdicts, [item.id]: "skip" }, { kind: "skip", at }, `Left the previous skill for later: ${item.name}. It stays in the queue.`);
  };
  const sendWrong = () => {
    if (!item || !text || !reason) return;
    const p = partOf(text, part ?? sel ?? "c0");
    start(async () => {
      const res = await flagWrongAction(item.id, { tag: p.tag, path: p.path, reason, note });
      if (res.error || !res.receipt) return fail(res.error ?? "the flag was not saved");
      go({ ...verdicts, [item.id]: "wrong" }, { kind: "wrong", at, receipt: res.receipt }, `Mismatch reported for the previous skill: ${item.name}. Its interpretation is unchanged.`);
    });
  };
  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return setToast(null);
    start(async () => {
      let error: string | null = null;
      const v = { ...verdicts };
      if (last.kind === "right") {
        const previous = items.find((entry) => entry.id === last.id);
        if (!previous) return fail("Reload this review before undoing its approval.");
        const reopened = await reopenAction(last.id, { decks: previous.decks, firedIn: previous.firedIn });
        if (reopened.error || !reopened.item) return fail(reopened.error ?? "The reopened interpretation could not be loaded.");
        setItems((queue) => queue.map((entry) => entry.id === last.id ? reopened.item! : entry));
        setExplaining(!!reopened.item.pendingExplanation);
        delete v[last.id];
      } else if (last.kind === "all") {
        error = (await undoConfirmAction(last.batchId)).error;
        for (const id of last.ids) if (v[id] === "all") delete v[id];
      } else if (last.kind === "wrong") {
        error = (await unflagWrongAction(last.receipt)).error;
        delete v[last.receipt.ruleId];
      } else delete v[items[last.at].id];
      if (error) return fail(error);
      setVerdicts(v);
      setHistory((h) => h.slice(0, -1));
      setAt(last.at);
      setStep("interpretation");
      setPick(null);
      setToast(null);
    });
  };
  const openWrong = () => {
    setPart(sel);
    setReason(null);
    setSheet(true);
  };

  const tally = {
    right: Object.values(verdicts).filter((v) => v === "right" || v === "all").length,
    wrong: Object.values(verdicts).filter((v) => v === "wrong").length,
    skip: Object.values(verdicts).filter((v) => v === "skip").length,
  };

  return (
    // The board's text face (`layout.tsx`), without `.arena`'s board-only rules.
    <div className="mx-auto flex min-h-[calc(100dvh-1.5rem)] w-full max-w-xl flex-col sm:min-h-0" style={{ fontFamily: "var(--font-arena), system-ui, sans-serif" }}>
      <header className="flex min-h-[60px] items-center gap-1.5 border-b border-space-700/70">
        <Link href={backHref} aria-label="Choose review scope" className="tap -ml-2 flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-space-300 hover:text-space-50">
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-none stroke-current" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </Link>
        <div className="mr-auto min-w-0">
          <h2 className="arena-impact text-lg leading-tight text-space-50">Review a skill</h2>
          <p className="text-[13px] font-semibold text-space-300">
            {scope} · {left} skill{left === 1 ? "" : "s"} to review
          </p>
        </div>
        <div role="group" aria-label="View" className="flex gap-0.5 rounded-xl bg-space-800/70 p-1">
          {(["text", "card"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`tap h-10 min-w-12 rounded-lg px-3 text-sm font-bold ${mode === m ? "bg-ki-500 text-space-950" : "text-space-300"}`}
            >
              {m === "text" ? "Text" : "Card"}
            </button>
          ))}
        </div>
      </header>

      {items.length > 0 && (
        <div className="flex items-center gap-2.5 pb-1 pt-2.5">
          <div className="flex flex-1 gap-1" aria-hidden>
            {items.map((x, k) => (
              <i key={x.id} className={`h-1.5 min-w-0 flex-1 rounded-full ${verdicts[x.id] ? SEG[verdicts[x.id]] : k === at ? "bg-space-300" : "bg-space-700"}`} />
            ))}
          </div>
          <span className="text-[13px] font-bold text-space-300">{done ? "done" : `${at + 1} of ${items.length}`}</span>
        </div>
      )}

      <p className="my-2 text-sm text-space-300">Describe → Review the rule → Approve</p>
      <p className="mb-2 text-xs text-space-400">{initial.length} eligible skill{initial.length === 1 ? "" : "s"}{!flaggedOnly && flagged ? ` · ${flagged} reported mismatches excluded` : flaggedOnly ? " · reported mismatches" : ""}.</p>
      <div className="mb-2 flex flex-wrap gap-3 text-sm">
        <Link href={backHref} className="underline">Change scope / find a card</Link>
        {flagged + tally.wrong > 0 && <Link href={flaggedOnly ? reviewHref : `${reviewHref}${reviewHref.includes("?") ? "&" : "?"}flagged=1`} className="underline">{flaggedOnly ? "Return to pending review" : `Review ${flagged + tally.wrong} reported mismatches`}</Link>}
      </div>
      {toast && (
        <div role="status" className="fixed inset-x-4 bottom-[190px] z-30 mx-auto flex max-w-xl flex-wrap items-center gap-2 rounded-xl border border-space-600 bg-space-900 p-3 text-sm text-space-50 shadow-xl">
          <p className="min-w-0 flex-1">{toast.text}</p>
          {toast.undo && history.length > 0 && <button type="button" disabled={pending} onClick={undo} className="tap rounded-lg px-3 font-bold text-ki-400">Undo</button>}
          <button type="button" aria-label="Dismiss result" onClick={() => setToast(null)} className="tap px-2">×</button>
          {history.at(-1)?.kind === "wrong" && <Link className="tap w-full underline" href={builderHref(items[history.at(-1)!.at].id, `${reviewHref}${reviewHref.includes("?") ? "&" : "?"}rule=${items[history.at(-1)!.at].id}&flagged=1`)}>Correct the reported skill now</Link>}
        </div>
      )}
      {done || !item || !text ? (
        <Clear empty={items.length === 0} tally={tally} backHref={backHref} />
      ) : (
        <>
          <div className="flex flex-1 flex-col gap-3.5 pb-8 pt-3">
            <div className="flex items-center gap-3">
              {mode === "card" && <CardImage src={item.imageUrl} alt={item.name} sizes="60px" className="w-[60px] shrink-0" />}
              <div className="min-w-0">
                <h2 className="arena-impact text-2xl leading-tight text-space-50">{item.name}</h2>
                <p className="text-sm font-semibold text-space-300">
                  {item.cardId} · skill {Math.floor(item.skillIndex / 10) + 1} · {item.meta}
                  {item.side === "back" ? " · awakened side" : ""}
                </p>
                <Status item={item} />
              </div>
            </div>

            <section aria-label="Printed skill" className="rounded-xl border border-space-700 p-3">
              <h3 className="mb-2 text-sm font-bold text-space-300">Printed on the card</h3>
              <p className="whitespace-pre-wrap text-base leading-relaxed text-space-50">{item.printed}</p>
            </section>
            {!text.blank && !explaining && <>
              <RuleReading title="Current interpretation" rule={{ kind: item.tag, trigger: item.trigger, usage: item.usage, combo: item.combo, cost: item.cost, cond: item.cond, ops: item.ops } as Rule} />
              {admin && <button type="button" disabled={pending || explaining || !!approvalProblem(item) || !item.reviewVersion} onClick={right} className={approvalBtn}>Approve current interpretation</button>}
            </>}
            {admin ? <RuleExplanationPanel key={item.id} id={item.id} version={item.reviewVersion ?? ""} actions={explanationActions} initial={item.pendingExplanation} onWorking={setExplaining}
              onApproved={() => go({ ...verdicts, [item.id]: "right" }, { kind: "right", at, id: item.id }, `Approved the exact proposed skill: ${item.name}.`)} />
              : <p className="text-sm text-space-300">Read-only: only an arena admin can request or approve a rule draft.</p>}
            <button type="button" disabled={pending} onClick={skip} className={`${actBtn} border border-space-600 text-space-100`}>Review later / next skill</button>
            <details className="space-y-3 rounded-xl border border-space-700 p-3">
              <summary className="tap cursor-pointer font-semibold text-space-300">More details and manual corrections</summary>
              {!text.blank && explaining && <RuleReading title="Previous interpretation" rule={{ kind: item.tag, trigger: item.trigger, usage: item.usage, combo: item.combo, cost: item.cost, cond: item.cond, ops: item.ops } as Rule} />}
            <nav aria-label="Compare this skill" className="grid grid-cols-2 gap-2">
              <button type="button" aria-pressed={step === "printed"} onClick={() => setStep("printed")} className={`tap rounded-xl border p-2 text-sm text-space-100 ${step === "printed" ? "border-ki-500 bg-ki-500/15 ring-1 ring-ki-500" : "border-space-600"}`}>1. Printed on card</button>
              <button type="button" aria-pressed={step === "interpretation"} onClick={() => setStep("interpretation")} className={`tap rounded-xl border p-2 text-sm text-space-100 ${step === "interpretation" ? "border-ki-500 bg-ki-500/15 ring-1 ring-ki-500" : "border-space-600"}`}>2. Interpretation</button>
            </nav>
            {step === "printed" && <p className="text-sm text-space-300">Read this skill, then compare it with the interpretation. Colored tags are review annotations, not printed card text.</p>}
            <p className={`${step === "printed" ? "" : "hidden"} rounded-2xl border border-space-700 bg-space-900/50 px-4 py-4 font-semibold text-space-50 ${mode === "text" ? "text-[22px] leading-[1.75]" : "text-lg leading-[1.7]"}`}>
              {text.segments.map((s, k) => {
                if (s.kind === "plain") return <span key={k}>{s.text}</span>;
                if (s.kind === "tag")
                  return (
                    <span key={k} className="text-space-300">
                      {s.text}
                    </span>
                  );
                const key: Pick = s.kind === "clause" ? `c${s.clause}` : `u${s.unread}`;
                const tag = s.kind === "clause" ? text.clauses[s.clause].tag : "UNREAD";
                const on = sel === key;
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setPick(key)}
                    className={`inline rounded-md px-0.5 text-left box-decoration-clone ${s.kind === "unread" ? "text-loss" : ""} ${on ? "bg-space-50/15" : ""}`}
                  >
                    {/* The underline is on the words alone, so the tag after them is not underlined with them. */}
                    <span className={`underline decoration-[3px] underline-offset-[6px] ${TONE[tag].line} ${s.kind === "unread" ? "decoration-dashed" : ""}`}>{s.text}</span>
                    <span className={`ml-0.5 align-super text-[10px] font-extrabold tracking-widest ${TONE[tag].text}`}>{tag}</span>
                  </button>
                );
              })}
            </p>

            {step === "interpretation" && <>
            <p className="text-sm text-space-300">Compare every part with the printed skill, then decide what to do. Approval records your review; engine support and tests are separate.</p>
            {sel && <Reads text={text} pick={sel} />}
            {text.segments.some((s) => s.kind === "clause" || s.kind === "unread") && <p className="-mt-2 px-0.5 text-[13px] font-semibold text-space-400">Select an interpretation part below. Return to Printed on card to compare the original wording.</p>}

            <Unplaced text={text} sel={sel} onPick={setPick} />

            <div className={`rounded-2xl border px-4 py-3.5 text-[17px] font-semibold leading-snug ${text.blank ? "border-loss/40 bg-loss/10 text-loss" : "border-gain/40 bg-gain/10 text-space-50"}`}>
              <small className="mb-1 block text-xs font-extrabold uppercase tracking-[0.14em] text-space-300">Current interpretation</small>
              {text.will}
            </div>

            {admin && item.status === "draft" && item.sameWording > 0 && (
              <details className="rounded-xl border border-space-700 p-3 text-sm text-space-300">
                <summary className="tap cursor-pointer">Advanced: shared wording across the catalog</summary>
                <p>{item.sameWording + 1} unreported draft skills share this pattern across the whole catalog, including cards outside this queue. Inspect them before bulk approval.</p>
                <Link className="tap mt-2 inline-flex underline" href={`/arena/rules?scope=catalog&state=draft&pattern=${encodeURIComponent(item.pattern ?? "")}`}>Preview matching drafts in the workbench</Link>
              </details>
            )}
            </>}

            {mode === "card" && <CardFacts item={item} text={text} />}
          <div className="mt-3">
            <div className="mx-auto max-w-xl">
              {step === "interpretation" && !text.blank && <p className="mb-2 text-center text-xs text-space-300">Approve saves your review. Report records a mismatch. Later leaves it queued.</p>}
              {step === "printed" ? (
                <button type="button" onClick={() => setStep("interpretation")} className={`${actBtn} w-full bg-ki-500 font-bold text-space-950`}>Compare interpretation →</button>
              ) : !admin ? (
                <>
                  <button type="button" onClick={skip} className={`${actBtn} w-full border border-space-600 bg-space-800/60 text-space-50`}>
                    Next card
                  </button>
                  <p className="mt-1.5 text-center text-xs text-space-400">Read-only: only an arena admin can record a verdict.</p>
                </>
              ) : text.blank ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button type="button" disabled={pending} onClick={skip} className={`${actBtn} border border-space-600 bg-space-800/60 text-space-50`}>
                    Review later
                  </button>
                  <Link href={builderHref(item.id, `${reviewHref}${reviewHref.includes("?") ? "&" : "?"}rule=${item.id}${flaggedOnly ? "&flagged=1" : ""}`)} className={`${actBtn} border-[1.5px] border-violet-500/60 bg-violet-500/10 text-violet-500`}>
                    Edit interpretation
                  </Link>
                  <button type="button" disabled={pending} onClick={() => { setStep("interpretation"); document.querySelector("textarea")?.focus(); }} className={`${actBtn} arena-impact bg-violet-600 text-[17px] text-white`}>
                    Describe above to draft
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" disabled={pending} onClick={openWrong} className={`${actBtn} border-[1.5px] border-loss/60 bg-loss/10 text-loss`}>
                    Report mismatch
                  </button>
                  <button type="button" disabled={pending} onClick={skip} className={`${actBtn} border border-space-600 bg-space-800/60 text-space-50`}>
                    Review later
                  </button>
                  <button type="button" disabled={pending || explaining || !!approvalProblem(item)} onClick={right} className={`${approvalBtn} col-span-2`}>
                    Approve interpretation
                  </button>
                </div>
              )}
            </div>
          </div>

            </details>
          </div>

          {sheet && (
            <WrongSheet
              item={item}
              text={text}
              part={part ?? sel}
              onPart={setPart}
              reason={reason}
              onReason={setReason}
              returnTo={`${reviewHref}${reviewHref.includes("?") ? "&" : "?"}rule=${item.id}${flaggedOnly ? "&flagged=1" : ""}`}
              note={note}
              onNote={setNote}
              pending={pending}
              onSend={sendWrong}
              onClose={() => setSheet(false)}
            />
          )}
        </>
      )}
    </div>
  );
}

function X() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-none stroke-current" strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function Status({ item }: { item: ReviewItem }) {
  const [cls, label] =
    item.status === "open"
      ? ["bg-loss/15 text-loss", "Open · plays as blank"]
      : item.source === "claude"
        ? ["bg-violet-500/15 text-violet-500", "Claude draft · check it"]
        : item.source === "user"
          ? ["bg-ki-500/15 text-ki-500", "Draft · set by you"]
          : ["bg-space-900/80 text-space-100", "Needs review · unapproved draft"];
  return <span className={`mt-1.5 inline-flex rounded-lg px-2 py-1 text-[13px] font-extrabold ${cls}`}>{label}</span>;
}

/** "Engine reads …" for the clause in hand. */
function Reads({ text, pick }: { text: ReviewText; pick: Pick }) {
  const p = partOf(text, pick);
  const miss = p.tag === "UNREAD";
  return (
    <div className={`flex min-h-[52px] items-start gap-2.5 rounded-xl border px-3 py-2.5 ${miss ? "border-loss/50 bg-loss/10" : "border-space-700 bg-space-900/40"}`} aria-live="polite">
      <Chip tag={p.tag} />
      <p className="text-base font-semibold leading-snug text-space-300">
        <b className="block text-[17px] text-space-50">{miss ? "Not read" : p.reads}</b>
        {miss ? `The engine skips “${p.words}”, so the whole skill plays as blank.` : p.words ? `Engine reads “${p.words}”` : "No matching text link was recorded for this part. Compare it manually; a missing link alone does not mean the interpretation is wrong."}
      </p>
    </div>
  );
}

/** The clauses the record reads but cannot place on the printed words: listed, never guessed onto them. */
function Unplaced({ text, sel, onPick }: { text: ReviewText; sel: Pick | null; onPick: (p: Pick) => void }) {
  const rows = [...text.clauses.flatMap((c, i) => ([{ pick: `c${i}` as Pick, tag: c.tag as ClauseTag | "UNREAD", line: c.reads }])), ...text.unread.flatMap((u, i) => (u.span ? [] : [{ pick: `u${i}` as Pick, tag: "UNREAD" as const, line: `“${u.text}” · not read` }]))];
  if (!rows.length) return null;
  return (
    <div className="space-y-1.5">
      <h3 className="px-0.5 text-xs font-extrabold uppercase tracking-[0.14em] text-space-300">Interpretation parts</h3>
      {rows.map((r) => (
        <button
          key={r.pick}
          type="button"
          aria-pressed={sel === r.pick}
          onClick={() => onPick(r.pick)}
          className={`tap grid w-full grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-[15px] font-semibold ${sel === r.pick ? "bg-space-700/70" : "bg-space-900/40"} ${r.tag === "UNREAD" ? "text-loss" : "text-space-100"}`}
        >
          <Chip tag={r.tag} className="justify-self-start" />
          <span>{r.line}</span>
        </button>
      ))}
    </div>
  );
}

function probeLine(item: ReviewItem): string {
  if (item.firedIn != null) return `Fired in game #${item.firedIn}, the last one this deck played`;
  if (item.probe) return `Probed ${item.probe.at.slice(0, 10)}: ${item.probe.outcome}`;
  if (item.timesSeen > 0) return `Came up in games ${item.timesSeen}×`;
  return item.status === "open" ? "Not played yet · it would play as blank" : "Not played yet · no probe";
}

/** The Card view's extras: the rule record as tagged rows, its last outcome, where it came from and the decks it is in. */
function CardFacts({ item, text }: { item: ReviewItem; text: ReviewText }) {
  const source = item.source === "compiler" ? (item.status === "open" ? "Compiler · part unread" : "Compiler draft") : item.source === "claude" ? "Claude's draft" : "Set by you";
  return (
    <>
      <h3 className="mt-1 px-0.5 text-xs font-extrabold uppercase tracking-[0.14em] text-space-300">The rule record</h3>
      <div className="flex flex-col gap-1.5">
        {text.clauses.map((c) => (
          <div key={c.path} className="grid min-h-11 grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-2 rounded-xl bg-space-900/40 px-2.5 py-1.5">
            <Chip tag={c.tag} className="justify-self-start" />
            <span className="text-[15px] font-semibold text-space-100">{c.reads}</span>
          </div>
        ))}
        {text.unread.map((u, i) => (
          <div key={`u${i}`} className="grid min-h-11 grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-2 rounded-xl bg-space-900/40 px-2.5 py-1.5">
            <Chip tag="UNREAD" className="justify-self-start" />
            <span className="text-[15px] font-semibold italic text-loss">“{u.text}” · not read</span>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-1.5 text-sm font-semibold text-space-300">
        <p>⚡ {probeLine(item)}</p>
        <p>
          ▤ {source} · {item.decks.length ? `in ${item.decks.join(", ")}` : "in no deck the arena plays"}
        </p>
        {item.explanation && <p className="whitespace-pre-line text-space-400">“{item.explanation}”</p>}
      </div>
    </>
  );
}

function WrongSheet(p: {
  item: ReviewItem;
  text: ReviewText;
  part: Pick | null;
  onPart: (x: Pick) => void;
  reason: WrongReason | null;
  onReason: (r: WrongReason) => void;
  note: string;
  returnTo: string;
  onNote: (s: string) => void;
  pending: boolean;
  onSend: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-space-950/60" onClick={p.onClose} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label="Report a mismatch" className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[95dvh] max-w-xl flex-col rounded-t-3xl border-t border-space-600 bg-space-900 shadow-2xl">
        <div className="mx-auto mb-0.5 mt-2 h-1.5 w-10 rounded-full bg-space-500" aria-hidden />
        <div className="flex items-center gap-2 border-b border-space-700 py-1.5 pl-4 pr-2">
          <div className="min-w-0">
            <b className="arena-impact block text-xl text-space-50">Report a mismatch</b>
            <small className="block truncate text-[13px] font-semibold text-space-300">
              {p.item.name} · {p.item.cardId}
            </small>
          </div>
          <button type="button" aria-label="Close" onClick={p.onClose} className="tap ml-auto flex h-12 w-12 items-center justify-center rounded-xl text-space-300">
            <X />
          </button>
        </div>
        <div className="flex flex-col gap-2.5 overflow-y-auto px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
          <h3 className="text-xs font-extrabold uppercase tracking-[0.14em] text-space-300">Which part</h3>
          <div className="flex flex-col gap-1.5">
            {picksOf(p.text).map((k) => {
              const x = partOf(p.text, k);
              const on = p.part === k;
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={on}
                  onClick={() => p.onPart(k)}
                  className={`tap grid min-h-[52px] w-full grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left text-[15px] font-semibold leading-tight text-space-50 ${on ? "border-loss/60 bg-loss/10" : "border-space-700 bg-space-800/40"}`}
                >
                  <Chip tag={x.tag} className="justify-self-start" />
                  <span>
                    {x.words ? `“${x.words}”` : x.reads}
                    <small className="block text-[13px] text-space-300">engine reads: {x.tag === "UNREAD" ? "nothing" : x.reads}</small>
                  </span>
                </button>
              );
            })}
          </div>
          <h3 className="text-xs font-extrabold uppercase tracking-[0.14em] text-space-300">What’s off</h3>
          <div className="flex flex-wrap gap-1.5">
            {WRONG_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={p.reason === r}
                onClick={() => p.onReason(r)}
                className={`tap min-h-11 rounded-full border px-3.5 text-[15px] font-bold ${p.reason === r ? "border-loss/60 bg-loss/15 text-space-50" : "border-space-700 bg-space-800/40 text-space-300"}`}
              >
                {r[0].toUpperCase() + r.slice(1)}
              </button>
            ))}
          </div>
          <label htmlFor="rr-note" className="text-xs font-extrabold uppercase tracking-[0.14em] text-space-300">
            Note · optional
          </label>
          <textarea
            id="rr-note"
            value={p.note}
            onChange={(e) => p.onNote(e.target.value)}
            maxLength={500}
            placeholder="e.g. lasts for the battle, not the whole turn"
            className="h-20 w-full resize-none rounded-xl border border-space-700 bg-space-800/40 px-3 py-2.5 text-base text-space-50 placeholder:text-space-500"
          />
          <button type="button" disabled={p.pending || !p.reason} onClick={p.onSend} className="tap arena-impact mt-1 h-14 rounded-2xl bg-loss text-lg text-space-950 disabled:opacity-50">
            {p.reason ? "Save mismatch report" : "Choose a reason to continue"}
          </button>
          <p className="text-center text-[13px] font-semibold text-space-300">Saves a report, not a correction. The interpretation stays unchanged. You can correct it now or return to reported mismatches later.</p>
          <Link href={builderHref(p.item.id, p.returnTo)} className="tap flex h-[52px] items-center justify-center rounded-2xl border-[1.5px] border-violet-500/60 bg-violet-500/10 text-base font-semibold text-violet-500">
            Correct this skill now
          </Link>
        </div>
      </div>
    </>
  );
}

function Clear({ empty, tally, backHref }: { empty: boolean; tally: { right: number; wrong: number; skip: number }; backHref: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3.5 px-2 py-10 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-gain bg-gain/10 text-gain">
        <svg viewBox="0 0 24 24" className="h-10 w-10 fill-none stroke-current" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </div>
      <h2 className="arena-impact text-3xl text-space-50">{empty ? "No eligible skills" : "Review session finished"}</h2>
      <p className="max-w-72 text-base font-semibold leading-snug text-space-300">
        {empty ? "This queue has no eligible skills. Check your scope and review reported mismatches separately." : "Reports and skipped skills still need attention. Finishing this session does not mean every skill is correct or supported."}
      </p>
      {!empty && (
        <div className="grid w-full grid-cols-3 gap-2">
          {(
            [
              [tally.right, "approved"],
              [tally.wrong, "reported"],
              [tally.skip, "skipped"],
            ] as const
          ).map(([n, label]) => (
            <div key={label} className="rounded-xl border border-space-700 bg-space-900/40 px-1.5 py-3 text-[13px] font-bold text-space-300">
              <b className="arena-impact block text-2xl text-space-50">{n}</b>
              {label}
            </div>
          ))}
        </div>
      )}
      <Link href={backHref} className="tap arena-impact flex h-[60px] w-full items-center justify-center rounded-2xl bg-ki-500 text-xl text-space-950">
        Return to workbench
      </Link>
      {!empty && (
        <button type="button" onClick={() => window.location.reload()} className="tap h-11 text-[15px] font-bold text-space-300">
          Review again
        </button>
      )}
    </div>
  );
}
