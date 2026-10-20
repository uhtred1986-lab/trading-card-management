"use client";

import type { ReactNode } from "react";
import type { SkillView } from "@/app/arena/rules/card/types";
import { shortDay } from "@/lib/arena/rule-card";
import { approvalProblem } from "@/lib/arena/rule-review";
import type { RuleHealth } from "@/lib/arena/rules-store";

const CHIP: Record<RuleHealth, { label: string; cls: string }> = {
  "text-only": { label: "Text only", cls: "ds-status-danger" },
  incomplete: { label: "Incomplete", cls: "ds-status-warning" },
  unchecked: { label: "Read, not checked", cls: "ds-badge-neutral ring-1 ring-inset ring-space-600" },
  done: { label: "Done", cls: "ds-status-success" },
};

/** The four-way health as a chip: a word as well as a colour, so it never relies on hue alone. */
export function HealthChip({ health, big = false }: { health: RuleHealth; big?: boolean }) {
  const c = CHIP[health];
  return <span className={`inline-flex items-center rounded-full font-bold ${big ? "px-3 py-1.5 text-sm" : "px-2.5 py-0.5 text-[13px]"} ${c.cls}`}>{c.label}</span>;
}

export const btn = "tap inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border border-space-600 px-3.5 py-2 text-sm font-bold text-space-100 hover:border-space-300 disabled:opacity-50";
export const primary = "tap inline-flex min-h-11 items-center justify-center gap-1 rounded-lg bg-ki-500 px-3.5 py-2 text-sm font-bold text-space-950 hover:bg-ki-400 disabled:opacity-50";
export const quiet = "tap inline-flex min-h-11 items-center justify-center gap-1 rounded-lg px-3 py-2 text-sm font-bold text-ki-400 hover:underline disabled:opacity-50";

const SOURCE: Record<string, string> = { compiler: "compiler draft", claude: "Claude draft", user: "set by you" };

/** `v6 · compiler draft · changed 19 Oct`, or what an approved rule is instead of a draft. */
export function provenanceLine(s: Pick<SkillView, "version" | "status" | "source" | "changedAt">): string {
  const who = s.status === "confirmed" ? "approved" : s.status === "corrected" ? "corrected by you" : (SOURCE[s.source ?? ""] ?? "");
  return [`v${s.version}`, who, s.changedAt ? `changed ${shortDay(s.changedAt)}` : ""].filter(Boolean).join(" · ");
}

/** The printed line with its bracketed tags set apart. */
function Printed({ text, mark }: { text: string; mark: string | null }) {
  const flat = text.replace(/\s+/g, " ").trim();
  return (
    <p className="rounded-lg bg-space-800 px-4 py-3 text-sm leading-relaxed text-space-100">
      {flat.split(/(\[[^\]]*\])/).map((part, i) =>
        /^\[[^\]]*\]$/.test(part) ? (
          <span key={i} className="font-semibold text-ki-400">
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
  );
}

export interface SkillActions {
  approve(): void;
  approveFlagged(): void;
  wrong(): void;
  ask(): void;
  edit(): void;
  reopen(): void;
  takeCompiler(): void;
  keepMine(): void;
}

/**
 * One skill of a card: what is printed, what the engine reads, why it has the
 * health it has, and what to do about it. Presentational: the page owns the
 * actions and what opens beside or under it (`ask`, `tryIt`).
 */
export function SkillPanel({ skill: s, admin, busy, editing, actions: a, ask, tryIt }: { skill: SkillView; admin: boolean; busy: boolean; editing: boolean; actions: SkillActions; ask: ReactNode; tryIt: ReactNode }) {
  const mark = s.status === "open" ? (s.unread[0] ?? null) : null;
  const canApprove = admin && s.status === "draft" && !approvalProblem({ status: s.status, unread: s.unread });
  const flag = s.flag;
  // The flag has its own notice below; its line in the reasons would say it twice.
  const reasons = flag ? s.reasons.filter((r) => !r.startsWith("Marked wrong:")) : s.reasons;
  const plain = [...reasons, ...s.hints];
  return (
    <section className={`ds-panel flex flex-col gap-4 ${editing ? "ring-2 ring-ki-400" : ""}`} aria-label={`Skill ${s.n}`} id={s.ruleId ? `skill-${s.ruleId}` : undefined}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 className="text-xl font-extrabold italic uppercase tracking-tight text-space-50">Skill {s.n}</h2>
        <span className="text-[11px] font-bold uppercase tracking-wider text-space-400">
          [{s.kindLabel}] · {s.side === "back" ? "awakened side" : "front"}
        </span>
        <HealthChip health={s.health} />
        {s.needsRebuild && s.ruleId != null && <span className="ds-status-warning rounded-full px-2.5 py-0.5 text-[13px] font-bold">needs rebuild</span>}
        {s.ruleId != null && <span className="ml-auto text-xs text-space-400">{provenanceLine(s)}</span>}
      </div>

      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-space-400">Printed</div>
        <Printed text={s.printed} mark={mark} />
      </div>

      {s.ruleId != null && (
        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-space-400">The engine reads</div>
          <p className={`text-[15px] font-semibold ${s.reads ? "text-space-50" : "text-loss"}`}>{s.reads || "Nothing yet: the engine plays this skill as blank."}</p>
          {s.comboChips.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Combo qualification">
              <span className="text-xs text-space-400">Only when</span>
              {s.comboChips.map((c) => (
                <span key={c} className="ds-badge-neutral rounded-full px-2.5 py-0.5 text-[13px] font-bold ring-1 ring-inset ring-space-600">
                  {c}
                </span>
              ))}
            </div>
          )}
          {s.status === "open" && s.unread.length > 0 && (
            <ul className="mt-2 space-y-1">
              {s.unread.map((u) => (
                <li key={u} className="rounded-lg border border-dashed border-loss px-2.5 py-1.5 text-[13px] text-loss">
                  not read: {u}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {plain.length > 0 && (
        <ul className="space-y-1 text-[13px] text-space-300">
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
          {s.hints.map((r) => (
            <li key={r} className="text-space-400">
              {r}
            </li>
          ))}
        </ul>
      )}

      {s.ruleId == null && <p className="text-sm text-space-300">No rule record answers this printed line. Rebuild the card to have the compiler write one.</p>}

      {flag && (
        <div className="ds-status-warning flex flex-col gap-2.5 rounded-xl px-4 py-3.5" role="note">
          <div className="font-extrabold">You marked this Wrong{flag.on ? ` on ${shortDay(flag.on)}` : ""}</div>
          <div className="text-[13px]">
            {flag.changedSince ? "“" + flag.text + "”" : flag.text}
            {flag.changedSince ? " The rule changed since your flag — does it play right now?" : ""}
          </div>
          {flag.changedSince && admin && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={primary} disabled={busy || s.status === "open"} onClick={a.approveFlagged}>
                Yes, approve
              </button>
              <button type="button" className={btn} disabled={busy} onClick={a.wrong}>
                Still wrong…
              </button>
              <button type="button" className={btn} disabled={busy} onClick={a.ask}>
                Ask Claude · paid
              </button>
              <button type="button" className={quiet} disabled={busy} onClick={a.edit}>
                Edit rule
              </button>
            </div>
          )}
        </div>
      )}

      {s.compilerDiff && (
        <div className="rounded-xl border border-ki-500/40 bg-ki-500/5 p-3 text-sm">
          <p className="font-bold text-ki-400">The compiler now reads this differently ({s.compilerDiff.at}).</p>
          <p className="mt-1 text-space-300">
            <span className="text-space-400">yours: </span>
            {s.reads || "nothing"}
          </p>
          <p className="text-space-300">
            <span className="text-space-400">the compiler’s: </span>
            {s.compilerDiff.reads}
            {s.compilerDiff.unread.length > 0 && <span className="text-loss"> — still unread: {s.compilerDiff.unread.join(" | ")}</span>}
          </p>
          {admin && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={btn} disabled={busy} onClick={a.takeCompiler}>
                Take the compiler’s reading
              </button>
              <button type="button" className={btn} disabled={busy} onClick={a.keepMine}>
                Keep mine
              </button>
            </div>
          )}
        </div>
      )}

      {s.ruleId != null && s.source === "claude" && s.status === "draft" && (
        <p className="rounded-xl border border-ki-500/40 bg-ki-500/5 px-3.5 py-2.5 text-sm font-bold text-ki-400" role="note" data-testid="claude-fix">
          Claude’s proposed fix — approve or edit
          <span className="ml-1 font-normal text-space-300">Claude rewrote this skill; nothing counts until you approve it.</span>
        </p>
      )}

      {s.ruleId != null && !(flag?.changedSince && admin) && (
        <div className="flex flex-wrap items-center gap-2">
          {s.status === "draft" ? (
            <button type="button" className={primary} disabled={busy || !canApprove} onClick={flag ? a.approveFlagged : a.approve} title={approvalProblem({ status: s.status, unread: s.unread }) ?? undefined}>
              {flag ? "Approve anyway" : "Approve"}
            </button>
          ) : s.status === "confirmed" || s.status === "corrected" ? (
            <>
              <span className="ds-status-success rounded-full px-3 py-1.5 text-sm font-bold">{s.status === "confirmed" ? "Approved" : "Corrected by you"}</span>
              {flag && admin && (
                <button type="button" className={btn} disabled={busy} onClick={a.approveFlagged}>
                  The rule is right: clear the mark
                </button>
              )}
              {admin && (
                <button type="button" className={quiet} disabled={busy} onClick={a.reopen}>
                  Reopen for review
                </button>
              )}
            </>
          ) : (
            admin && (
              <button type="button" className={primary} disabled={busy} onClick={a.ask}>
                Ask Claude · paid
              </button>
            )
          )}
          {admin && (
            <>
              <button type="button" className={btn} disabled={busy} onClick={a.wrong}>
                Wrong…
              </button>
              {s.status === "draft" && (
                <button type="button" className={btn} disabled={busy} onClick={a.ask}>
                  Ask Claude · paid
                </button>
              )}
              <button type="button" className={quiet} disabled={busy} onClick={a.edit}>
                Edit rule
              </button>
            </>
          )}
          {!admin && <span className="text-xs text-space-400">Only an admin can change a rule.</span>}
        </div>
      )}
      {ask}
      {tryIt}
    </section>
  );
}
