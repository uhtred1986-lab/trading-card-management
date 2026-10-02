"use client";

import Link from "next/link";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import { blankRuleAction, saveRuleAction } from "@/app/arena/actions";
import { parseRule, printRule, type LangError, type Rule } from "@/lib/arena/lang";
import { clauseOfPath, problemsOf, ruleReading, CLAUSE_WORDS } from "@/lib/arena/lang/blocks";
import type { RuleClause, RulePath } from "@/lib/arena/lang/path";
import { RuleBlocks } from "./Blocks";
import { ProbePane } from "./ProbePane";

/**
 * The block builder (#469): one skill's rule spelled out as WHEN · COST · IF ·
 * THEN blocks, phone first. The rule is the one piece of state — the blocks,
 * the text view, the reading at the top and the problems are all read off it —
 * so the blocks and the text can never hold two different rules.
 *
 * Two extension points other issues fill in, rendering nothing when absent:
 * `teachTabs` (#473's "In my words" and "Like a card", beside "Blocks") and
 * `tryIt` (#470's Try it → fix it, under the blocks). Until #470 lands, Try it
 * is the existing probe on the **saved** rule, on the legacy engine (#161).
 */
export interface TeachTab {
  key: string;
  label: string;
  render: (p: { ruleId: number; clause: RuleClause; onRule: (r: Rule) => void }) => ReactNode;
}

export interface RuleBuilderProps {
  ruleId: number;
  initialRule?: Rule;
  /** The block to open on: `cond`, `ops[2]`, `ops[2].ops[0]` (`lang/path.ts`). */
  focusPath?: RulePath;
  teachTabs?: TeachTab[];
  tryIt?: (p: { ruleId: number; rule: Rule; onFix: (path: RulePath) => void }) => ReactNode;
  /** The card the skill is printed on, pinned at the top, with the clause the engine could not read marked. */
  card?: { cardId: string; name: string; printed: string; unread: string[] };
  /** Boards the saved rule can be probed on, until `tryIt` replaces the probe. */
  scenarios?: { key: string; title: string }[];
  /** Where Cancel and a finished save go. */
  backHref?: string;
  /** False when the server will refuse a save (not an admin): the button says so rather than failing. */
  canSave?: boolean;
}

const btn = "tap rounded-xl border border-space-600 px-4 py-2 text-sm font-semibold text-space-100 hover:border-space-300 disabled:opacity-40";
const primary = "tap rounded-xl bg-ki-500 px-4 py-2 text-sm font-bold text-space-950 hover:bg-ki-400 disabled:bg-space-700 disabled:text-space-400";

const EMPTY_RULE: Rule = { kind: "auto", trigger: [], cost: null, cond: null, ops: [] };

export function RuleBuilder({ ruleId, initialRule, focusPath, teachTabs, tryIt, card, scenarios, backHref = `/arena/rules?rule=${ruleId}`, canSave = true }: RuleBuilderProps) {
  const start = initialRule ?? EMPTY_RULE;
  const [rule, setRule] = useState<Rule>(start);
  const [focus, setFocus] = useState<RulePath | null>(focusPath ?? null);
  const [tab, setTab] = useState<string>("blocks");
  const [text, setText] = useState("");
  const [textError, setTextError] = useState<LangError | null>(null);
  const [pending, run] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const problems = useMemo(() => problemsOf(rule, start.kind), [rule, start.kind]);
  const reading = useMemo(() => ruleReading(rule), [rule]);
  const dirty = printRule(rule) !== printRule(start);
  const clause: RuleClause = clauseOfPath(focus ?? undefined) ?? "ops";

  /** Text → blocks: parsed, or the text view stays open with the error, and the blocks keep the last rule that read. */
  const toBlocks = (): boolean => {
    const parsed = parseRule(text);
    if (!parsed.ok) {
      setTextError(parsed.error);
      return false;
    }
    if (parsed.value.kind !== start.kind) {
      setTextError({ line: 1, col: 1, clause: "WHEN", message: `the skill is [${start.kind}] — the tag comes off the card and cannot be edited here`, expected: [`[${start.kind}]`], lineText: text.split("\n")[0] ?? "" });
      return false;
    }
    setTextError(null);
    setRule(parsed.value);
    return true;
  };
  const choose = (next: string) => {
    if (tab === next) return;
    if (tab === "text" && !toBlocks()) return;
    if (next === "text") {
      setText(printRule(rule));
      setTextError(null);
    }
    setTab(next);
  };

  const save = () => {
    setError(null);
    run(async () => {
      const res = await saveRuleAction(ruleId, rule, null);
      if (res.error) setError(res.error);
      else setSaved(true);
    });
  };
  const blank = () => {
    setError(null);
    run(async () => {
      const res = await blankRuleAction(ruleId, "the block builder cannot say this card yet");
      if (res.error) setError(res.error);
      else setSaved(true);
    });
  };

  const printed = card?.printed.replace(/\s+/g, " ").trim() ?? "";
  const mark = card?.unread[0] ?? null;
  const tabs = [{ key: "blocks", label: "Blocks" }, { key: "text", label: "Text" }, ...(teachTabs ?? []).map((t) => ({ key: t.key, label: t.label }))];
  const teach = teachTabs?.find((t) => t.key === tab);

  if (saved)
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
        <p className="text-xl font-semibold text-space-50">Saved</p>
        <p className="max-w-xs text-sm text-space-300">The rule is stored as corrected by you. A later compiler run never overwrites it.</p>
        <p className="max-w-sm text-sm text-space-200">{reading}</p>
        <Link href={backHref} className={primary}>
          Back to the rule
        </Link>
      </div>
    );

  return (
    <div className="space-y-3 pb-40 sm:pb-24">
      {card && (
        <div className="sticky top-0 z-20 -mx-4 border-b border-space-700 bg-space-950/95 px-4 py-2 backdrop-blur">
          <div className="text-[11px] text-space-400">
            {card.name} · <span className="font-mono">{card.cardId}</span>
          </div>
          <p className="mt-1 max-h-28 overflow-y-auto text-[14px] leading-relaxed text-space-100" data-testid="printed">
            {mark && printed.includes(mark) ? (
              <>
                {printed.split(mark)[0]}
                <mark className="rounded bg-loss/25 px-0.5 text-space-50 underline decoration-loss decoration-dashed underline-offset-4">{mark}</mark>
                {printed.split(mark).slice(1).join(mark)}
              </>
            ) : (
              printed
            )}
          </p>
          {mark && (
            <p className="mt-1 text-[11px] text-loss">
              The engine cannot read the marked part. It is the <b>{CLAUSE_WORDS[clause]}</b> clause below.
            </p>
          )}
        </div>
      )}

      <div className="rounded-2xl border border-gain/40 bg-gain/5 px-4 py-3" aria-live="polite">
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-space-400">The engine will</div>
        <p className="mt-0.5 text-[15px] leading-snug text-space-50">{reading}</p>
      </div>

      <div role="tablist" aria-label="How to build it" className="grid gap-1 rounded-xl bg-space-900 p-1" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => choose(t.key)} className={`tap rounded-lg px-2 py-1.5 text-sm font-semibold ${tab === t.key ? "bg-ki-500/20 text-space-50 ring-1 ring-ki-500/60" : "text-space-400"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "blocks" && <RuleBlocks rule={rule} onChange={setRule} problems={problems} focusPath={focus} permanent={rule.kind === "permanent"} />}

      {tab === "text" && (
        <div>
          <textarea
            spellCheck={false}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={Math.min(24, text.split("\n").length + 2)}
            aria-label="the rule as text"
            className="w-full rounded-xl border border-space-700 bg-space-950 p-3 font-mono text-[12px] leading-relaxed text-space-200"
          />
          {textError ? (
            <p className="text-[12px] text-loss">
              {textError.clause}, line {textError.line} column {textError.col}: {textError.message}
              {textError.expected.length > 0 && ` — expected ${textError.expected.slice(0, 6).join(", ")}`}. The blocks keep the last rule that read.
            </p>
          ) : (
            <p className="text-[11px] text-space-500">The same rule, as text. Going back to Blocks reads it; if it does not read, you stay here with the error.</p>
          )}
        </div>
      )}

      {teach && teach.render({ ruleId, clause, onRule: (r) => (setRule(r), setTab("blocks")) })}

      {tryIt
        ? tryIt({ ruleId, rule, onFix: (path) => (setFocus(path), setTab("blocks")) })
        : scenarios &&
          scenarios.length > 0 && (
            <details className="rounded-xl border border-space-700 bg-space-900/60 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-space-100">Try it</summary>
              <p className="mt-1 text-[11px] text-space-400">Runs the <b>saved</b> rule, not the one being built, on the legacy engine (#161). Save first to try a change.</p>
              <div className="mt-2">
                <ProbePane ruleId={ruleId} scenarios={scenarios} />
              </div>
            </details>
          )}

      <details className="rounded-xl border border-space-700 bg-space-900/40 p-3 text-[12px] text-space-400">
        <summary className="cursor-pointer text-space-300">The card cannot be said in blocks</summary>
        <p className="mt-1">
          A piece the language has no block for yet is a language issue, not something to approximate here. Say which piece is missing on the feedback page, and store the skill as doing nothing until it exists.
        </p>
        <button type="button" disabled={pending || !canSave} className={`${btn} mt-2 border-loss/50 text-loss`} onClick={blank}>
          Mark as does nothing
        </button>
      </details>

      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 border-t border-space-700 bg-space-950/95 px-4 py-3 backdrop-blur sm:bottom-0">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <Link href={backHref} className={btn}>
            Cancel
          </Link>
          <div className="min-w-0 flex-1 text-[11px]" aria-live="polite">
            {pending ? (
              <span className="text-space-400">saving…</span>
            ) : error ? (
              <span className="text-loss">{error}</span>
            ) : !canSave ? (
              <span className="text-space-400">only an admin can save rules</span>
            ) : problems.length ? (
              <span className="text-loss">
                {problems.length} thing{problems.length === 1 ? "" : "s"} to fix
              </span>
            ) : !dirty ? (
              <span className="text-space-500">no changes</span>
            ) : null}
          </div>
          <button type="button" className={primary} disabled={pending || !canSave || problems.length > 0 || tab === "text"} onClick={save}>
            Save rule
          </button>
        </div>
      </div>
    </div>
  );
}
