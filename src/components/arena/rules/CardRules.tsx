"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { approveFlaggedAction, confirmRuleAction, keepMineAction, rebuildCardAction, reopenRuleAction, setSpecifiedCostAction, takeCompilerAction } from "@/app/arena/actions";
import type { CardView, HistoryLine, SkillView } from "@/app/arena/rules/card/types";
import { flagWrongAction, unflagWrongAction } from "@/app/arena/rules/review/actions";
import { approveExplanationAction, requestExplanationAction, retryExplanationIssueAction } from "@/app/arena/rules/review/explanation-actions";
import { CardImage } from "@/components/CardImage";
import { playHref } from "@/lib/arena/rule-card";
import type { FlagReceipt } from "@/lib/arena/rule-review-store";
import { FlagSheet, type FlagVerdict } from "./FlagSheet";
import { RuleExplanationPanel, type ExplanationActions } from "./RuleExplanationPanel";
import { SkillEditor } from "./SkillEditor";
import { btn, HealthChip, primary, quiet, SkillPanel, type SkillActions } from "./SkillPanel";
import { TryItPanel } from "./tryit/TryItPanel";

/**
 * The Card rules page (Rules PR 3, `/arena/rules/card/[cardId]`): one card, every
 * skill of it, and what to do about each. It replaces the workbench's record pane,
 * the full-screen builder and the guided phone review: the same reading, the same
 * actions, in one place that works at either width.
 *
 * Computer: the skills on the left, the editor of the chosen skill in a column on
 * the right. Phone: the skills in one column, the editor a full-screen sheet, and
 * a bar at the foot for the thing you do most (‹ / Still wrong / Approve / ›).
 */
export interface CardWalk {
  /** Which tab and group the queue was on, in words. */
  label: string;
  index: number;
  total: number;
  prevHref: string | null;
  nextHref: string | null;
  nextName: string | null;
}

/** What the page calls: the server actions, or stand-ins where there is no database (the development preview). */
export interface CardApi {
  approve: typeof confirmRuleAction;
  approveFlagged: typeof approveFlaggedAction;
  flag: typeof flagWrongAction;
  unflag: typeof unflagWrongAction;
  reopen: typeof reopenRuleAction;
  takeCompiler: typeof takeCompilerAction;
  keepMine: typeof keepMineAction;
  setSpecifiedCost: typeof setSpecifiedCostAction;
  rebuild: typeof rebuildCardAction;
  explanation: ExplanationActions;
}

const LIVE: CardApi = {
  approve: confirmRuleAction,
  approveFlagged: approveFlaggedAction,
  flag: flagWrongAction,
  unflag: unflagWrongAction,
  reopen: reopenRuleAction,
  takeCompiler: takeCompilerAction,
  keepMine: keepMineAction,
  setSpecifiedCost: setSpecifiedCostAction,
  rebuild: rebuildCardAction,
  explanation: { request: requestExplanationAction, approve: approveExplanationAction, retry: retryExplanationIssueAction },
};

const PREVIEW_ONLY = "Preview only: nothing is saved here.";
const preview = async () => ({ error: PREVIEW_ONLY });
const FIXTURE: CardApi = {
  approve: preview,
  approveFlagged: preview,
  flag: async () => ({ error: PREVIEW_ONLY, receipt: null }),
  unflag: preview,
  reopen: preview,
  takeCompiler: preview,
  keepMine: preview,
  setSpecifiedCost: preview,
  rebuild: async () => ({ error: PREVIEW_ONLY, rebuilt: 0, added: 0, left: 0 }),
  explanation: { request: async () => ({ error: PREVIEW_ONLY, result: null }), approve: preview, retry: async () => ({ error: PREVIEW_ONLY, result: null }) },
};

const ignore = () => {};
type Msg = { kind: "ok" | "error"; text: string; undo?: () => void };

export function CardRules({ card, skills, history, walk, backHref, admin, initialSkill, initialEdit, fixture = false }: { card: CardView; skills: SkillView[]; history: HistoryLine[]; walk: CardWalk | null; backHref: string; admin: boolean; initialSkill: number | null; initialEdit: boolean; fixture?: boolean }) {
  const api = fixture ? FIXTURE : LIVE;
  const router = useRouter();
  const [pending, start] = useTransition();
  const firstOpen = skills.find((s) => s.ruleId != null && s.health !== "done") ?? skills.find((s) => s.ruleId != null) ?? skills[0];
  const [focusId, setFocusId] = useState<number | null>(initialSkill && skills.some((s) => s.ruleId === initialSkill) ? initialSkill : (firstOpen?.ruleId ?? null));
  const [editing, setEditing] = useState<{ id: number; focus: string | null } | null>(() => (initialEdit && focusId != null ? { id: focusId, focus: null } : null));
  const [asking, setAsking] = useState<number | null>(() => skills.find((s) => s.item?.pendingExplanation)?.ruleId ?? null);
  const [flagging, setFlagging] = useState<number | null>(null);
  const [flagError, setFlagError] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);

  const focus = skills.find((s) => s.ruleId === focusId) ?? null;
  const editSkill = editing ? (skills.find((s) => s.ruleId === editing.id) ?? null) : null;
  const flagSkill = flagging != null ? (skills.find((s) => s.ruleId === flagging) ?? null) : null;
  const firstRule = skills.find((s) => s.ruleId != null)?.ruleId ?? null;

  const run = (label: string, fn: () => Promise<{ error: string | null }>, after?: () => void) => {
    setMsg(null);
    start(async () => {
      const res = await fn();
      if (res.error) return setMsg({ kind: "error", text: res.error });
      setMsg({ kind: "ok", text: label });
      after?.();
      router.refresh();
    });
  };

  const actionsFor = (s: SkillView): SkillActions => {
    const id = s.ruleId!;
    const version = s.item?.reviewVersion ?? "";
    const pick = () => setFocusId(id);
    return {
      approve: () => (pick(), run(`Approved skill ${s.n}. That keeps this reading against the card; it does not prove every board.`, () => api.approve(id, version))),
      approveFlagged: () => (pick(), run(`Skill ${s.n}: the mark is answered.`, () => api.approveFlagged(id, version))),
      wrong: () => (pick(), setFlagError(null), setFlagging(id)),
      ask: () => (pick(), setAsking(asking === id ? null : id)),
      edit: () => (pick(), setEditing({ id, focus: null })),
      reopen: () => (pick(), run(`Skill ${s.n} is a draft again.`, () => api.reopen(id))),
      takeCompiler: () => run(`Skill ${s.n}: took the compiler’s reading.`, () => api.takeCompiler(id)),
      keepMine: () => run(`Skill ${s.n}: kept yours.`, () => api.keepMine(id)),
    };
  };

  const sendFlag = (s: SkillView, v: FlagVerdict) => {
    setFlagError(null);
    start(async () => {
      const res = await api.flag(s.ruleId!, v);
      if (res.error || !res.receipt) return setFlagError(res.error ?? "the mark was not saved");
      const receipt: FlagReceipt = res.receipt;
      setFlagging(null);
      setMsg({
        kind: "ok",
        text: `Marked skill ${s.n} Wrong. The rule is unchanged.`,
        undo: () =>
          start(async () => {
            const back = await api.unflag(receipt);
            setMsg(back.error ? { kind: "error", text: back.error } : { kind: "ok", text: "Took the mark back." });
            if (!back.error) router.refresh();
          }),
      });
      router.refresh();
    });
  };

  const rebuild = () => {
    setMsg(null);
    start(async () => {
      const res = await api.rebuild(card.id);
      if (res.error) return setMsg({ kind: "error", text: res.error });
      setMsg({ kind: "ok", text: `Rebuilt: ${res.rebuilt} skill${res.rebuilt === 1 ? "" : "s"} refreshed, ${res.added} added.${res.left ? ` ${res.left} still need a new payment record; those are rules you set yourself, so edit and save them.` : ""}` });
      router.refresh();
    });
  };

  const bar = useMemo(() => {
    if (!focus || focus.ruleId == null) return null;
    return { skill: focus, canApprove: admin && focus.status === "draft" && focus.unread.length === 0 };
  }, [focus, admin]);

  const stat = (k: string, v: string | number | null) => (
    <div className="flex min-w-[84px] flex-col rounded-xl border border-space-600 bg-space-800 px-3.5 py-2">
      <span className="text-[11px] font-bold uppercase tracking-wider text-space-400">{k}</span>
      <b className="text-xl tabular-nums text-space-50">{v ?? "—"}</b>
    </div>
  );

  return (
    <div className="space-y-4 pb-24 sm:pb-8">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-space-700 bg-space-900/60 px-3 py-1.5" aria-label="Where you are">
        <Link href={backHref} className="tap -ml-1 inline-flex items-center rounded-lg px-2 text-sm font-bold text-ki-400">
          ‹ Rules
        </Link>
        {walk && (
          <>
            <span className="text-[11px] font-bold uppercase tracking-wider text-space-300">{walk.label}</span>
            <span className="text-sm text-space-300">
              {walk.index} of {walk.total}
            </span>
          </>
        )}
        <span className="flex-1" />
        {walk && (
          <span className="hidden items-center gap-2 sm:flex">
            {walk.prevHref ? (
              <Link href={walk.prevHref} className={btn}>
                ‹ Previous
              </Link>
            ) : null}
            {walk.nextHref ? (
              <Link href={walk.nextHref} className={btn}>
                Next{walk.nextName ? `: ${walk.nextName}` : ""} ›
              </Link>
            ) : null}
          </span>
        )}
      </header>

      <section className="ds-panel grid grid-cols-[96px_minmax(0,1fr)] gap-x-4 gap-y-3 sm:grid-cols-[190px_minmax(0,1fr)] sm:gap-x-7" aria-label="The card">
        <div className="sm:row-span-4">
          <CardImage src={card.imageUrl} alt={`${card.name} card art`} sizes="190px" priority />
        </div>
        <div className="min-w-0 self-center sm:self-start">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-ki-400">
            {card.id} · {card.type.toLowerCase().replace(/^./, (c) => c.toUpperCase())}
            {card.colors.length > 0 ? ` · ${card.colors.map((c) => c[0].toUpperCase() + c.slice(1).toLowerCase()).join("/")}` : ""}
          </div>
          <h1 className="mt-1 text-2xl font-black italic uppercase leading-tight tracking-tight text-space-50 sm:text-4xl">{card.name}</h1>
        </div>
        <div className="col-span-2 flex flex-wrap gap-2 sm:col-span-1 sm:col-start-2">
          {stat("Cost", card.cost)}
          {stat("Power", card.power?.toLocaleString("en") ?? null)}
          {stat("Combo", card.comboPower ? `+${card.comboPower.toLocaleString("en")}` : null)}
          {card.traits.length > 0 && stat("Traits", card.traits.join(" · "))}
        </div>
        <p className="col-span-2 text-[13px] text-space-300 sm:col-span-1 sm:col-start-2">
          {card.decks.length > 0 ? (
            <>
              In {card.decks.length} of your decks:{" "}
              {card.decks.map((d, i) => (
                <span key={d.id}>
                  {i > 0 && " · "}
                  <Link href={`/decks/${d.id}`} className="text-ki-400 underline">
                    {d.name}
                  </Link>
                </span>
              ))}
            </>
          ) : (
            "Not in a deck you play"
          )}
          {" · "}seen in {card.seenIn} game{card.seenIn === 1 ? "" : "s"}
        </p>
        <div className="col-span-2 flex flex-wrap items-center gap-2.5 sm:col-span-1 sm:col-start-2 sm:self-end">
          <HealthChip health={card.health} big />
          <span className="min-w-[200px] flex-1 text-[13px] text-space-300">{card.why}</span>
          {admin && card.canRebuild && (
            <button type="button" className={btn} disabled={pending} onClick={rebuild}>
              Rebuild card
            </button>
          )}
          {firstRule != null && (
            <Link href={fixture ? "/arena/rules/play-preview" : playHref(card.id, firstRule)} className={primary}>
              Play-test ▶
            </Link>
          )}
        </div>
      </section>

      <div aria-live="polite">
        {msg && (
          <p className={`flex flex-wrap items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold ${msg.kind === "error" ? "ds-status-danger" : "ds-status-success"}`} role={msg.kind === "error" ? "alert" : "status"}>
            {msg.text}
            {msg.undo && (
              <button type="button" className="tap underline" onClick={msg.undo} disabled={pending}>
                Undo
              </button>
            )}
          </p>
        )}
      </div>

      {card.specifiedCost && <SpecifiedCost card={card} admin={admin} busy={pending} onSave={(text) => run(text.trim() ? "Specified cost entered." : "Specified cost cleared. It is unknown again.", () => api.setSpecifiedCost(card.id, text))} />}

      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-5">
          {skills.map((s) => {
            const a = s.ruleId != null ? actionsFor(s) : null;
            const noop = () => {};
            return (
              <SkillPanel
                key={`${s.side}${s.skillIndex}`}
                skill={s}
                admin={admin}
                busy={pending}
                editing={editing?.id === s.ruleId}
                actions={a ?? { approve: noop, approveFlagged: noop, wrong: noop, ask: noop, edit: noop, reopen: noop, takeCompiler: noop, keepMine: noop }}
                ask={
                  s.ruleId != null && s.item && asking === s.ruleId && admin ? (
                    <RuleExplanationPanel key={`${s.ruleId}:${s.item.reviewVersion}`} id={s.ruleId} version={s.item.reviewVersion ?? ""} actions={api.explanation} initial={s.item.pendingExplanation} onWorking={ignore} onApproved={() => (setAsking(null), setMsg({ kind: "ok", text: `Skill ${s.n}: Claude’s draft is approved.` }), router.refresh())} />
                  ) : null
                }
                tryIt={
                  s.ruleId != null && s.rule && editing?.id !== s.ruleId ? (
                    fixture ? (
                      <p className="rounded-lg bg-space-800 px-3 py-2 text-xs text-space-400">Try it boards run here on the live page; the preview has no database.</p>
                    ) : (
                      <TryItPanel ruleId={s.ruleId} rule={s.rule} onFix={(path) => setEditing({ id: s.ruleId!, focus: path })} />
                    )
                  ) : null
                }
              />
            );
          })}

          {history.length > 0 && (
            <section className="ds-panel" aria-label="History">
              <div className="mb-2.5 text-[11px] font-bold uppercase tracking-wider text-space-400">History</div>
              <ol className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3.5 gap-y-1.5 text-[13px]">
                {history.map((h, i) => (
                  <li key={i} className="contents">
                    <span className="text-space-400">{h.when}</span>
                    <span className="text-space-100">
                      {h.skill ? `${h.skill}: ` : ""}
                      {h.what}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>

        {editSkill && (
          <aside id="editor" aria-label={`Edit skill ${editSkill.n}`} className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-space-950 px-4 pb-4 pt-[max(0.75rem,env(safe-area-inset-top))] lg:sticky lg:top-20 lg:z-auto lg:max-h-[calc(100dvh-6rem)] lg:flex-[1_1_380px] lg:rounded-xl lg:border lg:border-space-700 lg:bg-space-900 lg:p-5">
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-lg font-extrabold italic uppercase text-space-50">Edit skill {editSkill.n}</h2>
              <span className="flex-1" />
              <button type="button" className={quiet} onClick={() => setEditing(null)} aria-label="Close the editor">
                Close ×
              </button>
            </div>
            <SkillEditor
              key={`${editSkill.ruleId}:${editSkill.version}`}
              skill={editing?.focus ? { ...editSkill, focus: editing.focus } : editSkill}
              cardId={card.id}
              cardName={card.name}
              canSave={admin && !fixture}
              fixture={fixture}
              onClose={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                setMsg({ kind: "ok", text: `Saved skill ${editSkill.n} as your correction. A later compiler run never overwrites it.` });
                router.refresh();
              }}
            />
          </aside>
        )}
      </div>

      {flagSkill?.item && <FlagSheet key={flagSkill.ruleId} item={flagSkill.item} busy={pending} error={flagError} onSend={(v) => sendFlag(flagSkill, v)} onClose={() => setFlagging(null)} />}

      {bar && (
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-space-700 bg-space-950/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur sm:hidden" aria-label="Review this card">
          <p className="px-2 pb-1 text-center text-[11px] text-space-400">
            Skill {bar.skill.n} · <HealthChip health={bar.skill.health} />
          </p>
          <div className="mx-auto flex max-w-xl items-center gap-1.5">
            {walk?.prevHref ? (
              <Link href={walk.prevHref} aria-label="Previous card" className={`${btn} w-12 px-0 text-lg`}>
                ‹
              </Link>
            ) : (
              <span className={`${btn} w-12 px-0 text-lg opacity-30`} aria-hidden>
                ‹
              </span>
            )}
            <button type="button" className={`${btn} flex-1`} disabled={pending || !admin} onClick={actionsFor(bar.skill).wrong}>
              Still wrong
            </button>
            <button type="button" className={`${primary} flex-1`} disabled={pending || !bar.canApprove} onClick={bar.skill.flag ? actionsFor(bar.skill).approveFlagged : actionsFor(bar.skill).approve}>
              Approve
            </button>
            {walk?.nextHref ? (
              <Link href={walk.nextHref} aria-label="Next card" className={`${btn} w-12 px-0 text-lg`}>
                ›
              </Link>
            ) : (
              <span className={`${btn} w-12 px-0 text-lg opacity-30`} aria-hidden>
                ›
              </span>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}

/** An X-cost card's specified cost: the coloured orbs printed beside the cost circle, entered by hand. */
function SpecifiedCost({ card, admin, busy, onSave }: { card: CardView; admin: boolean; busy: boolean; onSave: (text: string) => void }) {
  const sc = card.specifiedCost!;
  const [open, setOpen] = useState(false);
  const [orbs, setOrbs] = useState(sc.entered ?? "");
  return (
    <section className={`rounded-xl border p-4 text-sm ${sc.unknown ? "border-loss/50 bg-loss/5" : "border-space-700 bg-space-900/60"}`} aria-label="Specified cost" data-testid="specified-cost">
      {sc.unknown ? (
        <p className="font-semibold text-loss">
          Incomplete: the specified cost is unknown.{" "}
          <span className="font-normal text-space-300">
            This card has an X cost and the catalog carries no cost orbs, so the engine demands no colour for it.
            {sc.entered ? ` The entry “${sc.entered}” is not orb notation and is ignored.` : ""} Enter the coloured orbs printed beside the cost circle.
          </span>
        </p>
      ) : (
        <p className="text-space-300">
          <span className="text-space-400">Specified cost: </span>
          <b className="font-semibold text-space-50">{sc.words}</b> <span className="text-space-400">({sc.entered})</span> · entered by hand; the engine demands these colours when this card is played.
        </p>
      )}
      {admin &&
        (open ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input value={orbs} onChange={(e) => setOrbs(e.target.value)} placeholder="{u}{u}" spellCheck={false} className="tap w-32 rounded-md border border-space-600 bg-space-900 px-2 py-1 font-mono text-sm text-space-100" aria-label="Specified cost, as orbs" />
            <span className="text-xs text-space-400">{"{r} red · {u} blue · {g} green · {y} yellow · {k} black · {w} white. One per orb; empty clears it."}</span>
            <button type="button" disabled={busy} className={primary} onClick={() => (onSave(orbs), setOpen(false))}>
              Save
            </button>
            <button type="button" disabled={busy} className={btn} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" disabled={busy} className={`${btn} mt-2`} onClick={() => setOpen(true)}>
            {sc.unknown ? "Enter the specified cost" : "Change"}
          </button>
        ))}
    </section>
  );
}
