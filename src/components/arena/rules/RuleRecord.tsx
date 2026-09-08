"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { blankRuleAction, confirmRuleAction, explainRuleAction, keepMineAction, saveRuleAction, takeCompilerAction } from "@/app/arena/actions";
import { keywordPlays } from "@/lib/arena/glossary";
import { describeScript, validateProgram, type Cond, type Op } from "@/lib/arena/engine/script";
import { CondChip, OpList, blankCond } from "./OpEditor";

/**
 * The record: one skill of one card, as the engine plays it — WHEN, COST, IF
 * and DO, each a row of chips — with the printed line above it and the plain
 * reading below, regenerated live while you edit. Confirming keeps it as it
 * stands; correcting by hand, the JSON view and "does nothing" write a program
 * of your own; "Explain to Claude" asks for a draft you then confirm.
 */
export interface RecordProps {
  id: number;
  cardId: string;
  name: string;
  setCode: string;
  side: "front" | "back";
  skillIndex: number;
  kind: string;
  permanent: boolean;
  printed: string;
  trigger: string;
  cost: string | null;
  cond: Cond | null;
  ops: Op[];
  unread: string[];
  status: "open" | "draft" | "confirmed" | "corrected";
  source: "compiler" | "claude" | "user";
  version: number;
  explanation: string | null;
  pattern: string | null;
  reads: string;
  decks: string[];
  siblings: { count: number; ids: string[] };
  compilerDiff: { reads: string; unread: string[]; at: string } | null;
  mechanism: { key: string; needs: string } | null;
}

const BADGE: Record<RecordProps["status"], { label: string; cls: string; dot: string }> = {
  open: { label: "Open — played as blank", cls: "bg-loss/15 text-loss", dot: "bg-loss" },
  draft: { label: "Draft — compiled, not confirmed", cls: "bg-dbs-blue/20 text-space-100", dot: "bg-dbs-blue" },
  confirmed: { label: "Confirmed", cls: "bg-gain/15 text-gain", dot: "bg-gain" },
  corrected: { label: "Corrected", cls: "bg-ki-500/15 text-ki-300", dot: "bg-ki-500" },
};
const btn = "tap rounded-lg border border-space-600 px-3 py-1.5 text-xs font-semibold text-space-100 hover:border-space-300 disabled:opacity-50";
const primary = "tap rounded-lg bg-ki-500 px-3 py-1.5 text-xs font-semibold text-space-950 hover:bg-ki-400 disabled:opacity-50";

/** The whole program as the engine runs it: the hoisted condition wrapped back around the steps. */
function programOf(cond: Cond | null, ops: Op[]): Op[] {
  return cond ? [{ op: "if", cond, then: ops }] : ops;
}

export function RuleRecord(r: RecordProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [ops, setOps] = useState<Op[]>(r.ops);
  const [cond, setCond] = useState<Cond | null>(r.cond);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonText, setJsonText] = useState(() => JSON.stringify(programOf(r.cond, r.ops), null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [explainOpen, setExplainOpen] = useState(false);
  const [explanation, setExplanation] = useState("");
  const [patternWrong, setPatternWrong] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const program = useMemo(() => programOf(cond, ops), [cond, ops]);
  const reads = useMemo(() => describeScript(program, { permanent: r.permanent }), [program, r.permanent]);
  // A keyword line whose whole program is empty is not a blank skill: the
  // keyword is the rule, and the engine plays it. `plays` is the glossary's
  // word for that, and the only place it is written down.
  const plays = r.pattern?.startsWith("keyword:") ? keywordPlays(r.pattern.slice("keyword:".length)) : null;
  const dirty = JSON.stringify(program) !== JSON.stringify(programOf(r.cond, r.ops));

  const run = (label: string, fn: () => Promise<{ error: string | null }>) => {
    setError(null);
    setDone(null);
    start(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      else {
        setDone(label);
        setEditing(false);
        router.refresh();
      }
    });
  };

  /** The JSON view is the same program; a bad edit keeps the last valid one and says why. */
  const readJson = () => {
    try {
      const parsed: unknown = JSON.parse(jsonText);
      if (!validateProgram(parsed)) {
        setJsonError("not a valid program — every step needs its required fields and known values");
        return;
      }
      setJsonError(null);
      const only = parsed.length === 1 ? parsed[0] : null;
      if (only && only.op === "if" && !only.else?.length) {
        setCond(only.cond);
        setOps(only.then);
      } else {
        setCond(null);
        setOps(parsed);
      }
      setEditing(true);
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : "not JSON");
    }
  };
  const openJson = () => {
    if (!jsonOpen) setJsonText(JSON.stringify(program, null, 2));
    setJsonOpen(!jsonOpen);
  };

  const printed = r.printed.replace(/\s+/g, " ").trim();
  const mark = r.status === "open" ? r.unread[0] : null;
  const badge = BADGE[r.status];
  const provenance =
    r.source === "compiler"
      ? `compiled${r.pattern ? ` · pattern ${r.pattern}` : ""} · v${r.version}`
      : r.source === "claude"
        ? `program written by Claude${r.explanation ? " from an explanation" : ""} · v${r.version}`
        : `set by you · v${r.version}`;

  return (
    <article className="space-y-3">
      <div>
        <div className="text-[11px] text-space-400">
          Worklist / {r.setCode} / <b className="text-space-100">{r.cardId}</b> · skill {Math.floor(r.skillIndex / 10) + 1}
          {r.side === "back" ? " · awakened side" : ""}
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-space-50">{r.name}</h2>
        <p className="text-xs text-space-400">
          {r.decks.length ? `in ${r.decks.join(", ")}` : "not in a deck you play"}
          {r.siblings.count ? ` · ${r.siblings.count} other card${r.siblings.count === 1 ? "" : "s"} in the catalog phrase this the same way` : ""}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${badge.cls}`}>
            <i className={`h-2 w-2 rounded-full ${badge.dot}`} />
            {badge.label}
          </span>
          <span className="text-[11px] text-space-400">{provenance}</span>
        </div>
      </div>

      {r.compilerDiff && (
        <div className="rounded-xl border border-ki-500/40 bg-ki-500/5 p-3 text-xs">
          <p className="font-semibold text-ki-300">The compiler now reads this differently ({r.compilerDiff.at}).</p>
          <p className="mt-1 text-space-300">
            <span className="text-space-500">yours: </span>
            {r.reads || "nothing"}
          </p>
          <p className="text-space-300">
            <span className="text-space-500">the compiler&rsquo;s: </span>
            {r.compilerDiff.reads}
            {r.compilerDiff.unread.length ? <span className="text-loss"> — still unread: {r.compilerDiff.unread.join(" | ")}</span> : null}
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={pending} className={btn} onClick={() => run("Took the compiler's reading.", () => takeCompilerAction(r.id))}>
              Take the compiler&rsquo;s
            </button>
            <button type="button" disabled={pending} className={btn} onClick={() => run("Kept yours.", () => keepMineAction(r.id))}>
              Keep mine
            </button>
          </div>
        </div>
      )}

      <p className="rounded-xl border border-space-700 border-l-[3px] border-l-ki-600 bg-space-900/60 px-4 py-3 text-sm leading-relaxed text-space-100">
        {printed.split(/(\[[^\]]*\])/).map((part, i) =>
          /^\[[^\]]*\]$/.test(part) ? (
            <span key={i} className="font-semibold text-ki-300">
              {part}
            </span>
          ) : mark && part.includes(mark) ? (
            <span key={i}>
              {part.split(mark)[0]}
              <mark className="rounded bg-loss/25 px-0.5 text-space-50">{mark}</mark>
              {part.split(mark).slice(1).join(mark)}
            </span>
          ) : (
            <span key={i}>{part}</span>
          ),
        )}
      </p>

      <div className="overflow-hidden rounded-2xl border border-space-700 bg-space-900/60">
        <Row k="WHEN" tone="text-ki-300">
          <Chip>
            [{r.kind}] · {r.trigger}
          </Chip>
        </Row>
        {r.cost && (
          <Row k="COST" tone="text-space-300">
            <Chip>{r.cost}</Chip>
          </Row>
        )}
        {(cond || editing) && (
          <Row k="IF" tone="text-dbs-blue">
            {cond ? (
              <Chip>
                <CondChip cond={cond} editing={editing} onChange={setCond} onRemove={editing ? () => setCond(null) : undefined} />
              </Chip>
            ) : (
              <button type="button" className="tap rounded-lg border border-dashed border-space-600 px-2 py-1 text-xs text-space-300" onClick={() => setCond(blankCond("isTurnPlayer"))}>
                + condition
              </button>
            )}
          </Row>
        )}
        <Row k="DO" tone="text-ki-300">
          {r.status === "draft" && r.source === "compiler" && !ops.length && !cond && plays ? (
            <Chip>
              <span className="text-space-300">
                played by the engine&rsquo;s <b className="font-semibold text-ki-300">{plays.tag}</b> rule
              </span>
            </Chip>
          ) : (
            <OpList ops={ops} editing={editing} onChange={setOps} />
          )}
        </Row>
        <div className="border-t border-space-700 px-4 py-3 text-xs text-space-300">
          The engine will: <b className="font-semibold text-space-50">{reads || (plays ? `play this as ${plays.tag}` : "nothing")}</b>
          {plays && !dirty && <span className="text-space-400"> — {plays.engine}</span>}
          {r.status === "open" && !dirty && <span className="text-loss"> — the printed text says more than that.</span>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!editing && r.status !== "confirmed" && (
          <button type="button" disabled={pending} className={primary} onClick={() => run("Confirmed — the engine plays it exactly like this.", () => confirmRuleAction(r.id))}>
            Confirm — plays exactly like this
          </button>
        )}
        {editing ? (
          <>
            <button type="button" disabled={pending || !!jsonError} className={primary} onClick={() => run("Saved as corrected.", () => saveRuleAction(r.id, program, explanation.trim() || null, patternWrong))}>
              Save as corrected
            </button>
            <button
              type="button"
              className={`${btn} border-transparent text-space-400`}
              onClick={() => {
                setEditing(false);
                setOps(r.ops);
                setCond(r.cond);
                setJsonError(null);
              }}
            >
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className={btn} onClick={() => setEditing(true)}>
            Correct by hand
          </button>
        )}
        <button type="button" className={btn} onClick={() => setExplainOpen(!explainOpen)}>
          Explain to Claude
        </button>
        <button type="button" className={btn} onClick={openJson}>
          {jsonOpen ? "Hide" : "Show"} program (JSON)
        </button>
        <button type="button" disabled={pending} className={`${btn} border-transparent text-loss`} onClick={() => run("Stored as an empty program.", () => blankRuleAction(r.id, explanation.trim() || null))}>
          Mark as does nothing
        </button>
        {pending && <span className="text-[11px] text-space-400">working…</span>}
        {error && <span className="text-[11px] text-loss">{error}</span>}
        {done && !pending && <span className="text-[11px] text-gain">{done}</span>}
      </div>
      <p className="text-[11px] text-space-500">
        Confirming keeps this program against the card. A later compiler change never overwrites it: the new reading lands beside yours, with a choice.
        {editing && r.pattern && r.source === "compiler" && (
          <label className="mt-1 flex items-center gap-1.5 text-space-300">
            <input type="checkbox" checked={patternWrong} onChange={(e) => setPatternWrong(e.target.checked)} />
            the pattern is wrong, not just this card — file a compiler brief with this program as the expected reading{r.siblings.count ? ` (${r.siblings.count} more cards)` : ""}
          </label>
        )}
      </p>

      {jsonOpen && (
        <div>
          <textarea spellCheck={false} value={jsonText} onChange={(e) => setJsonText(e.target.value)} onBlur={readJson} rows={Math.min(24, jsonText.split("\n").length + 1)} className="w-full rounded-xl border border-space-700 bg-space-950 p-3 font-mono text-[11px] leading-relaxed text-space-200" />
          <p className="text-[11px] text-space-500">
            {jsonError ? <span className="text-loss">{jsonError} — the last valid program is kept.</span> : "The same program the chips show; it is checked with the engine's own validator when you leave the box, and the chips and the plain reading follow."}
          </p>
        </div>
      )}

      {explainOpen && (
        <div className="space-y-2 rounded-xl border border-space-600 bg-space-950/60 p-3">
          <label className="block text-[11px] text-space-300">
            Say what <span className="text-space-100">{r.name}</span> does, as you would to a friend at the table.
            {mark && (
              <>
                {" "}
                The part the engine could not read is <span className="text-space-100">“{mark}”</span>.
              </>
            )}
          </label>
          <textarea value={explanation} onChange={(e) => setExplanation(e.target.value)} rows={3} autoFocus className="w-full rounded-md border border-space-600 bg-space-900 p-2 text-xs text-space-100" placeholder="e.g. you pick one of your opponent's Battle Cards that costs 3 or less and put it on the bottom of their deck, but only if your leader is red" />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={pending || !explanation.trim()} className={primary} onClick={() => run("Claude's draft is in the block above — confirm it if it is right.", () => explainRuleAction(r.id, explanation))}>
              Ask Claude for a program
            </button>
            <span className="text-[11px] text-space-500">Claude answers in the engine&rsquo;s own step language and writes the brief for the compiler. You still confirm it.</span>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-space-700 bg-gradient-to-r from-ki-500/5 to-transparent p-3">
        <h3 className="text-sm font-semibold text-space-100">
          {r.siblings.count ? `${r.siblings.count + 1} cards share this wording` : "No other card phrases this the same way"}
          {r.mechanism ? <span className="text-space-400"> — mechanism: {r.mechanism.key}</span> : null}
        </h3>
        <p className="mt-1 text-xs text-space-400">
          {r.status === "open"
            ? "Confirming a program here fixes one card. Teaching the compiler the wording fixes all of them — explain the card and Claude writes the brief for compile.ts as well as the program."
            : "This program came from a compiler pattern. If you correct it, say whether the pattern is wrong (every card phrased this way) or only this card is odd."}
        </p>
        {r.siblings.ids.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {r.siblings.ids.map((id) => (
              <span key={id} className="rounded bg-space-800 px-1.5 py-0.5 font-mono text-[10px] text-space-300">
                {id}
              </span>
            ))}
            {r.siblings.count > r.siblings.ids.length && <span className="rounded bg-space-800 px-1.5 py-0.5 text-[10px] text-space-400">+{r.siblings.count - r.siblings.ids.length} more</span>}
          </div>
        )}
        {r.status === "open" && (
          <button type="button" className={`${btn} mt-2`} onClick={() => setExplainOpen(true)}>
            Write the compiler brief
          </button>
        )}
      </div>
      {r.explanation && (
        <p className="rounded-lg border-l-2 border-gain bg-space-900/60 p-2 text-[11px] text-space-300">
          <span className="text-space-500">explanation on file: </span>
          {r.explanation}
        </p>
      )}
    </article>
  );
}

function Row({ k, tone, children }: { k: string; tone: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[64px_minmax(0,1fr)] border-b border-space-700 last:border-b-0">
      <div className={`px-4 pt-3.5 text-[11px] font-bold tracking-wide ${tone}`}>{k}</div>
      <div className="flex flex-wrap items-center gap-2 py-2.5 pr-3">{children}</div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-space-600 bg-space-800 px-2.5 py-1.5 text-[12px] text-space-100">{children}</span>;
}

