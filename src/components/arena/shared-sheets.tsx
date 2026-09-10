"use client";

import type { LegalAction, RejectedAction } from "@/lib/arena/engine";
import { effectLine } from "@/lib/arena/effects";
import { pill, priceOf, refusal, stepText } from "@/lib/arena/wording";
import type { CardView, PermanentView, PromptView, SideView } from "@/lib/arena/view";
import { DEFAULT_NARRATOR, plainText, type Narrator } from "./shared-model";

/** What a card is putting into the open battle, and the figure it is part of. */
export interface BattleShare {
  contribution: number;
  total: number;
  /** "attack" or "guard": which of the two figures `total` is. */
  side: "attack" | "guard";
}

/** The words each [Permanent] state wears on the sheet, and the colour. */
const PERMANENT_STATE: Record<PermanentView["state"], { word: string; className: string; note: string | null }> = {
  on: { word: "in force", className: "border-gain/60 text-gain", note: null },
  off: { word: "not now", className: "border-space-600 text-space-400", note: "Its condition does not hold at the moment, or there is nothing for it to apply to." },
  inert: { word: "not applied", className: "border-dbs-yellow/60 text-dbs-yellow", note: "The engine reads this line but cannot apply what it says yet — it does nothing in play." },
  unread: {
    word: "unread",
    className: "border-dbs-yellow/60 text-dbs-yellow",
    note: "The engine cannot read this line. A [Permanent] never resolves, so it is never put to Claude — it does nothing in play.",
  },
};

const EFFECT_COLOUR: Record<string, string> = {
  power: "text-gain",
  comboPower: "text-gain",
  keyword: "text-gain",
  cost: "text-ki-300",
  permit: "text-ki-300",
  negate: "text-loss",
  forbid: "text-loss",
  other: "text-space-100",
};

export function CardDetail({ card, withName = false, narrator = DEFAULT_NARRATOR, battle }: { card: CardView; withName?: boolean; narrator?: Narrator; battle?: BattleShare | null }) {
  const delta = card.basePower != null && card.power != null ? card.power - card.basePower : 0;
  return (
    <div className="space-y-1.5">
      {withName && <p className="text-sm font-semibold leading-tight text-space-50">{card.name}</p>}
      {battle && (
        <p className="rounded-lg border-l-2 border-ki-500 bg-space-800 p-2 text-[11px] sm:text-xs">
          <span className="text-[10px] uppercase tracking-widest text-space-400">in this battle </span>
          <span className="font-mono font-semibold text-ki-300">{battle.contribution.toLocaleString("en")}</span>
          <span className="text-space-300">
            {" "}
            of the {battle.total.toLocaleString("en")} {battle.side === "attack" ? "attacking" : "guarding"}
          </span>
        </p>
      )}
      <p className="text-[11px] text-space-400 sm:text-xs">
        {card.cardId}
        {card.cost ? ` · cost ${card.cost}` : ""}
        {card.power != null ? ` · ${card.power.toLocaleString("en")} power` : ""}
        {delta !== 0 && <span className={delta > 0 ? "text-gain" : "text-loss"}>{` (${card.basePower!.toLocaleString("en")} printed, ${delta > 0 ? "+" : ""}${delta.toLocaleString("en")})`}</span>}
        {card.comboCost != null ? ` · combo +${(card.comboPower ?? 0).toLocaleString("en")} for ${card.comboCost}` : ""}
      </p>
      {card.effects && card.effects.length > 0 && (
        <div className="rounded-lg border-l-2 border-ki-500 bg-space-800 p-2 text-[11px] sm:text-xs">
          <p className="mb-0.5 text-[10px] uppercase tracking-widest text-space-400">in force</p>
          <ul className="space-y-0.5">
            {card.effects.map((e, i) => {
              const line = effectLine(e, { viewer: narrator.viewer, them: narrator.them, self: card.id });
              const [what, ...rest] = line.split(" · ");
              return (
                <li key={i}>
                  <span className={`font-semibold ${EFFECT_COLOUR[e.kind] ?? "text-space-100"}`}>{what}</span>
                  {rest.length > 0 && <span className="text-space-400"> · {rest.join(" · ")}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {card.permanents && card.permanents.length > 0 && (
        <div className="space-y-1">
          {card.permanents.map((pm) => {
            const st = PERMANENT_STATE[pm.state];
            return (
              <div key={pm.index} className="rounded-lg border border-space-700 bg-space-800/60 p-2 text-[11px] sm:text-xs">
                <div className="flex items-start gap-2">
                  <span className={`mt-px shrink-0 rounded-full border px-1.5 py-px font-mono text-[9px] uppercase tracking-wider ${st.className}`}>∞ {st.word}</span>
                  <span className="min-w-0 flex-1 leading-snug text-space-200">{plainText(pm.text)}</span>
                </div>
                {st.note && <p className="mt-1 text-[10px] leading-snug text-space-400">{st.note}</p>}
              </div>
            );
          })}
        </div>
      )}
      {card.keywords.length > 0 && (
        <p className="flex flex-wrap gap-1">
          {card.keywords.map((k) => (
            <span key={k} className="rounded bg-ki-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ki-300">
              {k}
            </span>
          ))}
        </p>
      )}
      {card.text && <p className="whitespace-pre-wrap text-xs leading-relaxed text-space-200 sm:text-sm">{plainText(card.text)}</p>}
      <div className={`rounded-lg border-l-2 p-2 text-[11px] sm:text-xs ${card.referee ? "border-dbs-yellow bg-space-800" : "border-gain bg-space-800"}`}>
        <span className="font-semibold text-space-100">{card.referee ? "Not fully compiled. " : "Engine reads: "}</span>
        <span className="text-space-300">{card.referee ? "Claude rules on this card's remaining text when it resolves." : card.reading || "no effect of its own"}</span>
      </div>
    </div>
  );
}

export function Sheet({
  title,
  eyebrow,
  children,
  onClose,
  closeLabel = "close",
  tall = false,
}: {
  title: string;
  /** A small line above the title: the step chip, a card's tag. */
  eyebrow?: React.ReactNode;
  children: React.ReactNode;
  onClose: () => void;
  closeLabel?: string;
  /** Full height on a phone: a list to search rather than a menu to glance at. */
  tall?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center arena-scrim p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className={`flex w-full max-w-md flex-col rounded-t-2xl border border-space-700 bg-space-900 p-4 pb-8 sm:max-w-lg sm:rounded-2xl sm:pb-4 ${tall ? "h-[92dvh] sm:h-auto sm:max-h-[85dvh]" : "max-h-[75dvh]"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            {eyebrow && <div className="mb-1">{eyebrow}</div>}
            <h3 className="text-sm font-semibold text-space-50 sm:text-base">{title}</h3>
          </div>
          <button type="button" onClick={onClose} className="tap shrink-0 text-xs text-space-300 hover:text-space-50 sm:text-sm">
            {closeLabel}
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

export function StepChip({ step }: { step: PromptView["step"] }) {
  if (!step) return null;
  return <span className="inline-block whitespace-nowrap rounded-full border border-ki-500 px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-ki-300 sm:text-[10px]">{stepText(step)}</span>;
}

/** One move the sheet offers, already resolved to the card it is about. */
export interface SheetMove {
  index: number;
  legal: LegalAction;
  /** An attack with several targets is one row; picking it starts targeting. */
  targets?: number;
}

export function CardSheet({
  card,
  side,
  moves,
  rejected,
  onPick,
  onClose,
  narrator = DEFAULT_NARRATOR,
  battle,
}: {
  card: CardView;
  /** The player's own side, for the remedy in an energy refusal. */
  side: SideView | null;
  moves: SheetMove[];
  rejected: RejectedAction[];
  onPick: (move: SheetMove) => void;
  onClose: () => void;
  narrator?: Narrator;
  /** What this card is putting into the open battle, when it is in one. */
  battle?: BattleShare | null;
}) {
  const inHand = side?.hand?.some((c) => c.id === card.id) ?? false;
  const word = { side, inHand, them: narrator.them };
  return (
    <Sheet
      onClose={onClose}
      title={card.name}
      eyebrow={
        moves.length ? (
          <span className="text-[10px] uppercase tracking-widest text-ki-300">what would you like to do?</span>
        ) : rejected.length ? (
          <span className="text-[10px] uppercase tracking-widest text-loss">no move right now</span>
        ) : undefined
      }
    >
      {moves.map((m) => {
        const price = m.targets ? `${m.targets} target${m.targets === 1 ? "" : "s"}` : priceOf(m.legal.action, card, m.legal.label, m.legal.cost);
        return (
          <button key={m.index} type="button" onClick={() => onPick(m)} className="tap flex w-full items-center gap-3 rounded-lg border border-ki-500/60 bg-ki-500/10 px-3 py-2 text-left text-sm font-semibold text-space-50 hover:border-ki-400 sm:px-4 sm:py-3 sm:text-base">
            <span className="min-w-0 flex-1">{m.targets ? `Attack with ${card.name}…` : m.legal.label}</span>
            {price && <span className="shrink-0 rounded-full border border-space-600 px-2 py-px font-mono text-[10px] text-ki-300 sm:text-xs">{price}</span>}
          </button>
        );
      })}
      {rejected.map((r) => {
        const why = r.why[0];
        const w = refusal(why, { name: card.name, reaching: r.action.type, ...word });
        return (
          <div key={`${r.action.type}:${"skill" in r.action ? r.action.skill : ""}`} className="rounded-lg border border-space-700 bg-space-800/60 px-3 py-2 opacity-80 sm:px-4 sm:py-3" aria-disabled>
            <div className="flex items-center gap-3">
              <span className="min-w-0 flex-1 text-sm font-semibold text-space-300 sm:text-base">{r.label}</span>
              <span className="shrink-0 rounded-full border border-loss/50 px-2 py-px font-mono text-[10px] text-loss sm:text-xs">{pill(why)}</span>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-space-200 sm:text-xs">
              {w.fact}
              {w.remedy && <span className="text-ki-300"> {w.remedy}</span>}
            </p>
            {r.why.length > 1 && (
              <p className="mt-0.5 text-[10px] text-space-400">
                {r.why
                  .slice(1)
                  .map((q) => refusal(q, { name: card.name, reaching: r.action.type, ...word }).fact)
                  .join(" ")}
              </p>
            )}
          </div>
        );
      })}
      <div className={moves.length || rejected.length ? "border-t border-space-700 pt-2" : ""}>
        {card.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- transient sheet; the board has already loaded this URL.
          <img src={card.imageUrl} alt="" className="card-aspect float-right ml-3 mb-2 w-24 rounded-lg object-cover sm:w-28" />
        )}
        <CardDetail card={card} narrator={narrator} battle={battle} />
      </div>
    </Sheet>
  );
}

export function SearchSheet({
  prompt,
  choices,
  indexOf,
  none,
  onPick,
  onClose,
}: {
  prompt: PromptView;
  choices: CardView[];
  /** The index into `legal` that chooses this card, if any. */
  indexOf: (id: string) => number | undefined;
  /** The index of "choose none", when the prompt allows it. */
  none: number | null;
  onPick: (index: number) => void;
  onClose: () => void;
}) {
  return (
    <Sheet onClose={onClose} title={prompt.question} eyebrow={<StepChip step={prompt.step} />} closeLabel="see the board" tall>
      <p className="text-[11px] text-space-400 sm:text-xs">
        {prompt.hint} {choices.length} card{choices.length === 1 ? "" : "s"} to choose from.
      </p>
      {choices.map((c) => {
        const i = indexOf(c.id);
        return (
          <button key={c.id} type="button" disabled={i == null} onClick={() => i != null && onPick(i)} className="tap flex w-full items-center gap-3 rounded-lg border border-space-600 bg-space-800 px-2 py-2 text-left hover:border-ki-500/60 disabled:opacity-50 sm:px-3">
            {c.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- a list row; the board has already loaded this URL.
              <img src={c.imageUrl} alt="" className="card-aspect w-10 shrink-0 rounded object-cover sm:w-12" />
            ) : (
              <span className="card-aspect w-10 shrink-0 rounded bg-space-700 sm:w-12" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-space-50">{c.name}</span>
              <span className="block text-[11px] text-space-400">
                {c.cardId}
                {c.cost ? ` · cost ${c.cost}` : ""}
                {c.power != null ? ` · ${c.power.toLocaleString("en")}` : ""}
                {c.keywords.length ? ` · ${c.keywords.join(", ")}` : ""}
              </span>
            </span>
            <span className="shrink-0 rounded-full border border-ki-500/60 px-2 py-px font-mono text-[10px] text-ki-300">choose</span>
          </button>
        );
      })}
      {none != null && (
        <button type="button" onClick={() => onPick(none)} className="tap w-full rounded-lg border border-dashed border-space-500 bg-space-950 px-3 py-3 text-left text-sm font-semibold text-space-100 hover:border-ki-500/60">
          Choose none
          <span className="block text-[11px] font-normal text-space-400">The skill says “up to” — this is the way out.</span>
        </button>
      )}
    </Sheet>
  );
}
