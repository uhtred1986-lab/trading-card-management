"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { createPortal } from "react-dom";
import { blankRuleAction, confirmRuleAction, explainRuleAction, keepMineAction, reopenRuleAction, saveRuleAction, setSpecifiedCostAction, takeCompilerAction } from "@/app/arena/actions";
import { keywordPlays } from "@/lib/arena/glossary";
import { COND_SCHEMA, OP_SCHEMA, costSentence, describeScript, programProblem, validateProgram, type Cond, type CostRecord, type Op } from "@/lib/arena/vm/script";
import type { Trigger } from "@/lib/arena/types";
import { describeTrigger } from "@/lib/arena/gaps";
import { parseRule, printRule, validateRule, type LangError, type Rule } from "@/lib/arena/lang";
import { loadDbs } from "@/lib/arena/rulesets";
import { condReading, opReading, problemsOf } from "@/lib/arena/lang/blocks";
import { RuleBlocks } from "./Blocks";

/**
 * An `expected[]` entry, linked to its row on `/arena/rules/language` when it
 * names a step or a condition. `LangError.clause` disambiguates the one name
 * ("power") that is both — `OP_SCHEMA` and `COND_SCHEMA` are only ever both
 * checked against `expected[]` from the clause that owns them, THEN for a
 * step and IF for a condition (`lang/parse.ts`'s two `Object.keys(...)` fail
 * cases), so a plain-text entry that fails both checks is a token of the
 * grammar itself (`"THEN"`, `"{Red}"`, …), not a missing row.
 */
function ExpectedItem({ item, clause }: { item: string; clause: string }) {
  const href = clause === "THEN" && item in OP_SCHEMA ? `/arena/rules/language#op-${item}` : clause === "IF" && item in COND_SCHEMA ? `/arena/rules/language#cond-${item}` : null;
  if (!href) return <span className="font-mono">{item}</span>;
  return (
    <Link href={href} target="_blank" className="font-mono text-ki-300 hover:underline">
      {item}
    </Link>
  );
}

/**
 * The record: one skill of one card, as the engine plays it — WHEN, COST, IF
 * and DO, each a row of chips — with the printed line above it and the plain
 * reading below, regenerated live while you edit. Confirming keeps it as it
 * stands; correcting by hand, the JSON view and "does nothing" write a program
 * of your own; "Explain to Claude" asks for a draft you then confirm.
 *
 * The **text view** is the whole record in the rules language, and the only
 * place WHEN and COST can be edited: the chips have no editor for either, and
 * the plan of 9 Sep 2026 deliberately gave them none. What is typed there is
 * parsed, checked and shown back as chips before it can be saved, so a rule is
 * never stored in a form the engine would read differently from the words in
 * the box.
 */
export interface RecordProps {
  id: number;
  cardId: string;
  name: string;
  setCode: string;
  side: "front" | "back";
  skillIndex: number;
  /** The skill kind in words, for the WHEN chip. */
  kind: string;
  /** …and as the row stores it ("auto", "counter:attack"), which is what the language prints and will not let you change. */
  tag: string;
  permanent: boolean;
  printed: string;
  trigger: Trigger[];
  cost: CostRecord | null;
  cond: Cond | null;
  ops: Op[];
  unread: string[];
  status: "open" | "draft" | "confirmed" | "corrected";
  source: "compiler" | "claude" | "user";
  version: number;
  explanation: string | null;
  /** The work item for teaching the compiler this wording, when one has been written. */
  brief: string | null;
  /** How often a game has actually reached this skill and put it to the referee. */
  timesSeen: number;
  pattern: string | null;
  reads: string;
  decks: string[];
  siblings: { count: number; ids: string[] };
  compilerDiff: { reads: string; unread: string[]; at: string } | null;
  mechanism: { key: string; needs: string } | null;
  /**
   * The card's specified-cost baseline (issue #255): null for a card with a
   * fixed cost, whose orbs the engine fills by convention. For an X-cost
   * card, `entered` is the `cards.specified_cost` column as written (`{u}{u}`),
   * `words` its reading ("2 blue") when it parses, and `unknown` is
   * `specifiedCostUnknown` off the def the engine plays — true means the
   * card's configuration is incomplete and the record says so.
   */
  specifiedCost: { entered: string | null; words: string | null; unknown: boolean } | null;
}

/** Where Skip and the advance after Confirm go: hrefs into the current queue. */
export interface RecordNav {
  skip: string | null;
  after: string;
}

/** The action bar's slot: the foot of the right pane on the computer, pinned above the tab bar on a phone. */
export const ACTION_BAR_ID = "record-bar";

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

/**
 * The WHEN line. A skill with no named moment is not silent: the kind says
 * when the engine looks at it, and only an [Auto] whose wording nobody could
 * place has nothing to offer.
 */
function whenLine(trigger: Trigger[], tag: string): string {
  const said = describeTrigger(trigger);
  if (said) return said;
  if (tag === "permanent") return "while this card is where the skill is valid";
  if (tag.startsWith("activate")) return "when you activate it";
  if (tag.startsWith("counter")) return "at the counter timing the tag names";
  return "the engine knows no moment for this wording";
}

/**
 * Which `triggers.rules` moments the WHEN chip names — every trigger in the
 * record's own `trigger[]` that a `DEFINE TRIGGER` actually declares, so a
 * WHEN chip can link straight to the declaration behind it on
 * `/arena/rules/game` (#163). `loadDbs()` is pure and client-safe (it reads
 * the generated `files.ts` constant, never the filesystem), so this checks
 * the real definition rather than guessing a name is declared.
 */
function triggerLinks(trigger: Trigger[]): string[] {
  const loaded = loadDbs();
  if (!loaded.ok) return [];
  return trigger.filter((t) => t in loaded.definition.triggers);
}

/**
 * Which `costs.rules` declaration a `CostRecord`'s own shape names — a price
 * is not itself a pointer to one `DEFINE COST` row, so this is a reading of
 * what it charges rather than a stored reference: orbs (including an either-
 * orb list or an X) are the `energy` cost, a marker count is `marker`, a
 * life card is `life`, a card offered to pay with is `payWith`, and the
 * catch-all `text` price is what a program with no other shape still charges
 * (20-19/21-3, `docs/arena-ruleset-spec.md` §3's own costs.rules row).
 */
function costLinks(cost: CostRecord | null): string[] {
  if (!cost) return [];
  const loaded = loadDbs();
  if (!loaded.ok) return [];
  const names = new Set<string>();
  if (Object.keys(cost.orbs).length || cost.either.length || cost.x) names.add("energy");
  if (cost.marker != null) names.add("marker");
  if (cost.burst != null) names.add("life");
  if (cost.payWith?.length) names.add("payWith");
  if (names.size === 0 && cost.text) names.add("text");
  return [...names].filter((n) => n in loaded.definition.costs);
}

/** A small "→ declaration" link beside a chip, to the printed `.rules` row it names. */
function DeclarationLinks({ define, names }: { define: string; names: string[] }) {
  if (!names.length) return null;
  return (
    <>
      {names.map((name) => (
        <Link key={name} href={`/arena/rules/game#${define}-${name}`} target="_blank" className="text-[10px] text-space-500 hover:text-ki-300 hover:underline">
          {name} →
        </Link>
      ))}
    </>
  );
}

export function RuleRecord({ nav, ...r }: RecordProps & { nav?: RecordNav }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [ops, setOps] = useState<Op[]>(r.ops);
  const [cond, setCond] = useState<Cond | null>(r.cond);
  const [trigger, setTrigger] = useState<Trigger[]>(r.trigger);
  const [cost, setCost] = useState<CostRecord | null>(r.cost);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonText, setJsonText] = useState(() => JSON.stringify(programOf(r.cond, r.ops), null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [textOpen, setTextOpen] = useState(false);
  const [text, setText] = useState("");
  const [textError, setTextError] = useState<{ kind: "parse"; error: LangError } | { kind: "invalid"; field: string; message: string } | null>(null);
  const [explainOpen, setExplainOpen] = useState(false);
  const [explanation, setExplanation] = useState("");
  const [patternWrong, setPatternWrong] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  /** Claude's one question from the last "Ask Claude", when it was not sure. */
  const [question, setQuestion] = useState<string | null>(null);
  const [orbsOpen, setOrbsOpen] = useState(false);
  const [orbs, setOrbs] = useState(r.specifiedCost?.entered ?? "");

  // The chips are state seeded from the stored record, and the record is keyed
  // by id alone — so a program written on the server (Claude's draft, the
  // compiler's reading taken) reached the page on refresh and never the chips,
  // which went on showing the old one as an unsaved edit. A new version is a
  // new stored program: take it, and drop the edit made against the old one.
  const [version, setVersion] = useState(r.version);
  if (version !== r.version) {
    setVersion(r.version);
    setOps(r.ops);
    setCond(r.cond);
    setTrigger(r.trigger);
    setCost(r.cost);
    setJsonText(JSON.stringify(programOf(r.cond, r.ops), null, 2));
    setJsonError(null);
    setTextOpen(false);
    setTextError(null);
    setEditing(false);
  }

  const rule: Rule = useMemo(() => ({ kind: r.tag, trigger, cost, cond, ops }), [r.tag, trigger, cost, cond, ops]);
  /** The block editor hands back a whole rule; the record keeps its four clauses apart. */
  const setRule = (next: Rule) => {
    setTrigger(next.trigger);
    setCost(next.cost);
    setCond(next.cond);
    setOps(next.ops);
  };
  const problems = useMemo(() => (editing ? problemsOf(rule, r.tag) : []), [editing, rule, r.tag]);
  const program = useMemo(() => programOf(cond, ops), [cond, ops]);
  const reads = useMemo(() => describeScript(program, { permanent: r.permanent }), [program, r.permanent]);
  // A keyword line whose whole program is empty is not a blank skill: the
  // keyword is the rule, and the engine plays it. `plays` is the glossary's
  // word for that, and the only place it is written down.
  const plays = r.pattern?.startsWith("keyword:") ? keywordPlays(r.pattern.slice("keyword:".length)) : null;
  // Dirty against the printed form of the record rather than its JSON: a rule
  // that came back from the text view differing only in a `false` the printer
  // leaves out is the same rule, and offering to save it would churn the
  // version for nothing.
  const dirty = printRule(rule) !== printRule({ kind: r.tag, trigger: r.trigger, cost: r.cost, cond: r.cond, ops: r.ops });

  /** `advance`: on success go on to the next rule in the queue (keeping the scroll) rather than stay on this one. */
  const run = (label: string, fn: () => Promise<{ error: string | null }>, advance = false) => {
    setError(null);
    setDone(null);
    start(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      else {
        setDone(label);
        setEditing(false);
        if (advance && nav) router.push(nav.after, { scroll: false });
        else router.refresh();
      }
    });
  };

  /**
   * Not `run`: a refusal still refreshes (the brief was written either way),
   * and Claude's question is kept beside the explanation box, whatever the
   * outcome, so it can be answered there and asked again.
   */
  const askClaude = () => {
    setError(null);
    setDone(null);
    setQuestion(null);
    start(async () => {
      const res = await explainRuleAction(r.id, explanation);
      setQuestion(res.question);
      if (res.error) setError(res.error);
      else setDone(res.question ? "Claude's draft is in the block above, but it was not sure — see its question before confirming." : "Claude's draft is in the block above — confirm it if it is right.");
      router.refresh();
    });
  };

  const confirm = () => run("Confirmed — the engine plays it exactly like this.", () => confirmRuleAction(r.id), true);
  const skip = () => {
    if (nav?.skip) router.push(nav.skip, { scroll: false });
  };
  /** The JSON view is the same program; a bad edit keeps the last valid one and says why. */
  const readJson = () => {
    try {
      const parsed: unknown = JSON.parse(jsonText);
      const bad = programProblem(parsed);
      if (bad || !validateProgram(parsed)) {
        setJsonError(`not a valid program — ${bad ?? "every step needs its required fields and known values"}`);
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

  /**
   * The text view, read back. Same contract as the JSON view — the last valid
   * rule is kept and the error says where — with two more checks, because this
   * box can change WHEN and COST: the printed skill tag may not be edited, and
   * a moment the engine never fires is refused rather than stored as a skill
   * that silently never happens.
   */
  const readText = () => {
    const parsed = parseRule(text);
    if (!parsed.ok) {
      setTextError({ kind: "parse", error: parsed.error });
      return;
    }
    const bad = validateRule(parsed.value, r.tag);
    if (bad) {
      setTextError({ kind: "invalid", field: bad.field.toUpperCase(), message: bad.message });
      return;
    }
    setTextError(null);
    setTrigger(parsed.value.trigger);
    setCost(parsed.value.cost);
    setCond(parsed.value.cond);
    setOps(parsed.value.ops);
    setEditing(true);
  };
  const openText = () => {
    if (!textOpen) {
      setText(printRule(rule));
      setTextError(null);
    }
    setTextOpen(!textOpen);
  };

  const textRef = useRef<HTMLTextAreaElement>(null);
  const editText = () => {
    if (!textOpen) openText();
    requestAnimationFrame(() => textRef.current?.focus());
  };

  // The keys the workbench listens for (`WorkbenchKeys`) arrive as events, so what a key does is what its button does.
  const keyed = useRef({ confirm, editText, pending, canConfirm: false });
  useEffect(() => {
    keyed.current = { confirm, editText, pending, canConfirm: r.status === "draft" && !editing };
  });
  useEffect(() => {
    const on = (e: Event) => {
      const k = keyed.current;
      const what = (e as CustomEvent<string>).detail;
      if (what === "confirm" && k.canConfirm && !k.pending) k.confirm();
      if (what === "edit") k.editText();
    };
    window.addEventListener("workbench:action", on);
    return () => window.removeEventListener("workbench:action", on);
  }, []);

  // The slot only exists in the browser, after the page has been laid out: null on the server, the element on the client.
  const slot = useSyncExternalStore(
    () => () => {},
    () => document.getElementById(ACTION_BAR_ID),
    () => null,
  );

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
          {r.timesSeen > 0 ? ` · a game has reached this skill ${r.timesSeen}×` : ""}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${badge.cls}`}>
            <i className={`h-2 w-2 rounded-full ${badge.dot}`} />
            {badge.label}
          </span>
          <span className="text-[11px] text-space-400">{provenance}</span>
        </div>
      </div>

      {r.specifiedCost && (
        <div className={`rounded-xl border p-3 text-xs ${r.specifiedCost.unknown ? "border-loss/50 bg-loss/5" : "border-space-700 bg-space-900/60"}`} data-testid="specified-cost">
          {r.specifiedCost.unknown ? (
            <p className="font-semibold text-loss">
              Incomplete — specified cost unknown.{" "}
              <span className="font-normal text-space-300">
                This card has an X cost and the catalog carries no cost orbs, so the engine demands no colour for it: the play is charged as if it needed none.
                {r.specifiedCost.entered ? ` The entry “${r.specifiedCost.entered}” is not orb notation and is ignored.` : ""} Enter the coloured orbs printed beside the cost circle, from the card.
              </span>
            </p>
          ) : (
            <p className="text-space-300">
              <span className="text-space-500">specified cost: </span>
              <b className="font-semibold text-space-50">{r.specifiedCost.words}</b> <span className="text-space-500">({r.specifiedCost.entered})</span> · entered by hand; the engine demands these colours when this card is played
            </p>
          )}
          {orbsOpen ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                value={orbs}
                onChange={(e) => setOrbs(e.target.value)}
                placeholder="{u}{u}"
                spellCheck={false}
                className="w-32 rounded-md border border-space-600 bg-space-900 px-2 py-1 font-mono text-xs text-space-100"
                aria-label="specified cost, as orbs"
              />
              <span className="text-[11px] text-space-500">{"{r} red · {u} blue · {g} green · {y} yellow · {k} black · {w} white — one per orb; empty clears it"}</span>
              <button type="button" disabled={pending} className={primary} onClick={() => run(orbs.trim() ? "Specified cost entered." : "Specified cost cleared — back to unknown.", () => setSpecifiedCostAction(r.cardId, orbs))}>
                Save
              </button>
              <button type="button" disabled={pending} className={btn} onClick={() => setOrbsOpen(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" disabled={pending} className={`${btn} mt-2`} onClick={() => setOrbsOpen(true)}>
              {r.specifiedCost.unknown ? "Enter the specified cost" : "Change"}
            </button>
          )}
        </div>
      )}

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

      {editing && (
        <>
          {/* The same blocks the phone builder (/arena/rules/build/[id]) is made of: one editor, not two. */}
          <RuleBlocks rule={rule} onChange={setRule} problems={problems} permanent={r.permanent} />
          <div className="rounded-xl border border-space-700 px-4 py-3 text-xs text-space-300">
            The engine will: <b className="font-semibold text-space-50">{reads || "nothing"}</b>
          </div>
        </>
      )}
      <div className={`overflow-hidden rounded-2xl border border-space-700 bg-space-900/60 ${editing ? "hidden" : ""}`}>
        <Row k="WHEN" tone="text-ki-300">
          <Chip>
            [{r.kind}] · {whenLine(trigger, r.tag)}
          </Chip>
          <DeclarationLinks define="trigger" names={triggerLinks(trigger)} />
          {!textOpen && (
            <button type="button" className="tap rounded-lg border border-dashed border-space-600 px-2 py-1 text-[11px] text-space-400" onClick={openText}>
              edit as text
            </button>
          )}
        </Row>
        {costSentence(cost) && (
          <Row k="COST" tone="text-space-300">
            <Chip>{costSentence(cost)}</Chip>
            <DeclarationLinks define="cost" names={costLinks(cost)} />
          </Row>
        )}
        {cond && (
          <Row k="IF" tone="text-dbs-blue">
            <Chip>{condReading(cond)}</Chip>
          </Row>
        )}
        <Row k="DO" tone="text-ki-300">
          {r.status === "draft" && r.source === "compiler" && !ops.length && !cond && plays ? (
            <Chip>
              <span className="text-space-300">
                played by the engine&rsquo;s <b className="font-semibold text-ki-300">{plays.tag}</b> rule
              </span>
            </Chip>
          ) : ops.length ? (
            <div className="flex w-full flex-col gap-1.5">
              {ops.map((op, i) => (
                <div key={i} className="flex items-center gap-1.5 rounded-lg border border-space-600 bg-space-800 px-2 py-1.5 text-[12px] text-space-100">
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-space-950 text-[10px] font-bold text-space-400">{i + 1}</span>
                  <span>{opReading(op, r.permanent)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-loss/50 px-2 py-1.5 text-[12px] text-loss">nothing — the engine treats this skill as blank</div>
          )}
          {r.status === "open" &&
            !dirty &&
            r.unread.map((u) => (
              <span key={u} className="inline-flex max-w-full items-center rounded-lg border border-dashed border-loss bg-loss/5 px-2.5 py-1.5 text-[12px] text-loss" title="the engine could not read this clause">
                unread: {u}
              </span>
            ))}
        </Row>
        <div className="border-t border-space-700 px-4 py-3 text-xs text-space-300">
          The engine will: <b className="font-semibold text-space-50">{reads || (plays ? `play this as ${plays.tag}` : "nothing")}</b>
          {plays && !dirty && <span className="text-space-400"> — {plays.engine}</span>}
          {r.status === "open" && !dirty && <span className="text-loss"> — the printed text says more than that.</span>}
        </div>
      </div>

      {slot &&
        createPortal(
          <div className="space-y-1.5 border-t border-space-700 bg-space-950/95 p-3 backdrop-blur" role="toolbar" aria-label="Rule actions">
            {(pending || error || done) && (
              <p className="text-[11px]" aria-live="polite">
                {pending && <span className="text-space-400">working…</span>}
                {error && <span className="text-loss">{error}</span>}
                {done && !pending && <span className="text-gain">{done}</span>}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {editing ? (
                <>
                  {problems.length > 0 && (
                    <span className="text-[11px] text-loss">
                      {problems.length} thing{problems.length === 1 ? "" : "s"} to fix in the blocks
                    </span>
                  )}
                  <button type="button" disabled={pending || !!jsonError || !!textError || problems.length > 0} className={primary} onClick={() => run("Saved as corrected.", () => saveRuleAction(r.id, rule, explanation.trim() || null, patternWrong), true)}>
                    Save as corrected
                  </button>
                  <button
                    type="button"
                    className={`${btn} border-transparent text-space-400`}
                    onClick={() => {
                      setEditing(false);
                      setOps(r.ops);
                      setCond(r.cond);
                      setTrigger(r.trigger);
                      setCost(r.cost);
                      setText(printRule({ kind: r.tag, trigger: r.trigger, cost: r.cost, cond: r.cond, ops: r.ops }));
                      setJsonError(null);
                      setTextError(null);
                    }}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  {r.status === "open" ? (
                    <button type="button" disabled={pending} className={primary} onClick={() => setExplainOpen(true)}>
                      Draft with Claude
                    </button>
                  ) : r.status === "draft" ? (
                    <button type="button" disabled={pending} className={primary} onClick={confirm} title="Confirm — plays exactly like this (c)">
                      Confirm
                    </button>
                  ) : (
                    <button type="button" disabled={pending} className={primary} onClick={() => run("Reopened — it is a draft again.", () => reopenRuleAction(r.id))}>
                      Reopen for review
                    </button>
                  )}
                  <Link href={`/arena/rules/build/${r.id}`} className={btn} title="Spell the rule out as WHEN / COST / IF / THEN blocks">
                    {r.status === "open" ? "Build in blocks" : "Edit in blocks"}
                  </Link>
                  <button type="button" className={btn} onClick={editText} title="Edit as text (e)">
                    {r.status === "open" ? "Write as text" : "Edit as text"}
                  </button>
                  <button type="button" disabled={!nav?.skip} className={`${btn} border-transparent text-space-300`} onClick={skip} title="Skip to the next (s)">
                    Skip
                  </button>
                  <details className="relative ml-auto">
                    <summary className={`${btn} cursor-pointer list-none`} aria-label="More actions">
                      ⋯
                    </summary>
                    <div className="absolute bottom-full right-0 z-30 mb-1 flex w-56 flex-col gap-1 rounded-xl border border-space-600 bg-space-900 p-2 shadow-lg">
                      <Link href={`/arena/rules/build/${r.id}`} className={`${btn} text-center`}>
                        Build in blocks (full screen)
                      </Link>
                      <button type="button" className={btn} onClick={() => setEditing(true)}>
                        Correct with blocks here
                      </button>
                      <button type="button" className={btn} onClick={() => setExplainOpen(!explainOpen)}>
                        Explain to Claude
                      </button>
                      <button type="button" className={btn} onClick={openJson}>
                        {jsonOpen ? "Hide" : "Show"} program (JSON)
                      </button>
                      <button type="button" disabled={pending} className={`${btn} border-transparent text-loss`} onClick={() => run("Stored as an empty program.", () => blankRuleAction(r.id, explanation.trim() || null), true)}>
                        Mark as does nothing
                      </button>
                    </div>
                  </details>
                </>
              )}
            </div>
          </div>,
          slot,
        )}
      <p className="text-[11px] text-space-500">
        Confirming keeps this program against the card. A later compiler change never overwrites it: the new reading lands beside yours, with a choice.
        {editing && r.pattern && r.source === "compiler" && (
          <label className="mt-1 flex items-center gap-1.5 text-space-300">
            <input type="checkbox" checked={patternWrong} onChange={(e) => setPatternWrong(e.target.checked)} />
            the pattern is wrong, not just this card — file a compiler brief with this program as the expected reading{r.siblings.count ? ` (${r.siblings.count} more cards)` : ""}
          </label>
        )}
      </p>

      {textOpen && (
        <div>
          <textarea
            ref={textRef}
            spellCheck={false}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={readText}
            rows={Math.min(24, text.split("\n").length + 1)}
            className="w-full rounded-xl border border-space-700 bg-space-950 p-3 font-mono text-[11px] leading-relaxed text-space-200"
          />
          <p className="text-[11px] text-space-500">
            {textError ? (
              <span className="text-loss">
                {textError.kind === "invalid" ? (
                  `${textError.field}: ${textError.message}`
                ) : (
                  <>
                    {textError.error.clause}, line {textError.error.line} column {textError.error.col}: {textError.error.message}
                    {textError.error.expected.length > 0 && (
                      <>
                        {" "}
                        — expected{" "}
                        {textError.error.expected.slice(0, 6).map((item, i) => (
                          <span key={item}>
                            {i > 0 && ", "}
                            <ExpectedItem item={item} clause={textError.error.clause} />
                          </span>
                        ))}
                      </>
                    )}
                  </>
                )}
                {" — the last valid rule is kept."}
              </span>
            ) : (
              <>
                The whole record in the rules language, and the only place WHEN and COST can be changed. It is read when you leave the box; the chips above follow. The skill tag in brackets comes off the card
                and cannot be edited.
              </>
            )}
          </p>
        </div>
      )}

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
            <button type="button" disabled={pending || !explanation.trim()} className={primary} onClick={askClaude}>
              {question ? "Ask Claude again" : "Ask Claude for a program"}
            </button>
            <span className="text-[11px] text-space-500">Claude answers in the engine&rsquo;s own step language and writes the brief for the compiler. You still confirm it.</span>
          </div>
          {question && (
            <p className="rounded-lg border-l-2 border-ki-500 bg-space-900/60 p-2 text-[11px] text-space-200" aria-live="polite">
              <span className="text-ki-300">Claude was not sure and asks: </span>
              {question}
              <span className="text-space-500"> — answer it in the box above and ask again.</span>
            </p>
          )}
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
      {r.brief && (
        <details className="rounded-xl border border-space-700 bg-space-950/60">
          <summary className="cursor-pointer p-2 text-[11px] text-ki-300">the work item for teaching the compiler this wording</summary>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap p-2 font-mono text-[10px] leading-relaxed text-space-300">{r.brief}</pre>
        </details>
      )}
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

