"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LegalAction, RejectedAction } from "@/lib/arena/engine";
import { effectLine } from "@/lib/arena/effects";
import { pill, priceOf, refusal, stepText } from "@/lib/arena/wording";
import type { CardView, PermanentView, PromptView, SideView } from "@/lib/arena/view";
import { DEFAULT_NARRATOR, plainText, type Narrator } from "./shared-model";
import { useArenaAdmin } from "./admin-context";

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

export function CardDetail({
  card,
  withName = false,
  narrator = DEFAULT_NARRATOR,
  battle,
  figures = true,
}: {
  card: CardView;
  withName?: boolean;
  narrator?: Narrator;
  battle?: BattleShare | null;
  /** The id · cost · power line. The docked inspector shows those as tiles and turns it off. */
  figures?: boolean;
}) {
  const delta = card.basePower != null && card.power != null ? card.power - card.basePower : 0;
  // Engine internals — the id and the compile notes — are an admin's (#350); the engine's reading of a card lives in the admin drawer (#446).
  const admin = useArenaAdmin();
  return (
    <div className="space-y-1.5">
      {withName && <p className="text-sm font-semibold leading-tight text-space-50">{card.name}</p>}
      {battle && (
        <p className="rounded-lg border-l-2 border-ki-500 bg-space-800 p-2 text-[11px] sm:text-xs">
          <span className="text-[10px] uppercase tracking-widest text-space-300">in this battle </span>
          <span className="font-mono font-semibold text-ki-300">{battle.contribution.toLocaleString("en")}</span>
          <span className="text-space-300">
            {" "}
            of the {battle.total.toLocaleString("en")} {battle.side === "attack" ? "attacking" : "guarding"}
          </span>
        </p>
      )}
      {figures && (
        <p className="text-[11px] text-space-400 sm:text-xs">
          {admin ? card.cardId : null}
          {card.cost ? `${admin ? " · " : ""}cost ${card.cost}` : ""}
          {card.power != null ? `${admin || card.cost ? " · " : ""}${card.power.toLocaleString("en")} power` : ""}
          {delta !== 0 && <span className={delta > 0 ? "text-gain" : "text-loss"}>{` (${card.basePower!.toLocaleString("en")} printed, ${delta > 0 ? "+" : ""}${delta.toLocaleString("en")})`}</span>}
          {card.comboCost != null ? ` · combo +${(card.comboPower ?? 0).toLocaleString("en")} for ${card.comboCost}` : ""}
        </p>
      )}
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
            // "Not applied" and "unread" are the compiler's words; a player sees the line, and whether it holds.
            const showState = admin || pm.state === "on" || pm.state === "off";
            return (
              <div key={pm.index} className="rounded-lg border border-space-700 bg-space-800/60 p-2 text-[11px] sm:text-xs">
                <div className="flex items-start gap-2">
                  {showState && <span className={`mt-px shrink-0 rounded-full border px-1.5 py-px font-mono text-[9px] uppercase tracking-wider ${st.className}`}>∞ {st.word}</span>}
                  <span className="min-w-0 flex-1 leading-snug text-space-200">{plainText(pm.text)}</span>
                </div>
                {admin && st.note && <p className="mt-1 text-[10px] leading-snug text-space-400">{st.note}</p>}
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
  return (
    <span className="inline-block whitespace-nowrap rounded-full border border-ki-500 px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-ki-300 sm:text-[10px]">{stepText(step)}</span>
  );
}

/** One move the sheet offers, already resolved to the card it is about. */
export interface SheetMove {
  index: number;
  legal: LegalAction;
  /** An attack with several targets is one row; picking it starts targeting. */
  targets?: number;
  /** Wording that replaces the engine's label, for a row the inspector words itself ("Attack it"). */
  label?: string;
}

/**
 * The moves a card has right now, each with its price, then the ones it does
 * not have, each with the sentence the rules gave. One list for the action
 * sheet and the docked inspector, so the two can never word a refusal
 * differently (`docs/arena-board-redesign-spec.md` decision 2).
 */
export function ActionRows({
  card,
  side,
  moves,
  rejected,
  onPick,
  narrator = DEFAULT_NARRATOR,
  docked = false,
}: {
  card: CardView;
  side: SideView | null;
  moves: SheetMove[];
  rejected: RejectedAction[];
  onPick: (move: SheetMove) => void;
  narrator?: Narrator;
  /**
   * In the docked inspector rather than a sheet: smaller rows, and a refusal
   * drawn at full strength — it is the sentence the player came to read, and
   * the sheet's dimmed version fails contrast on both skins.
   */
  docked?: boolean;
}) {
  const inHand = side?.hand?.some((c) => c.id === card.id) ?? false;
  const word = { side, inHand, them: narrator.them };
  return (
    <>
      {moves.map((m) => {
        const price = m.targets ? `${m.targets} target${m.targets === 1 ? "" : "s"}` : priceOf(m.legal.action, card, m.legal.label, m.legal.cost);
        return (
          <button
            key={m.index}
            type="button"
            onClick={() => onPick(m)}
            className={`tap flex w-full items-center gap-3 rounded-lg border border-ki-500/60 bg-ki-500/10 px-3 py-2 text-left text-sm font-semibold text-space-50 hover:border-ki-400 ${docked ? "" : "sm:px-4 sm:py-3 sm:text-base"}`}
          >
            <span className="min-w-0 flex-1">{m.targets ? `Attack with ${card.name}…` : (m.label ?? m.legal.label)}</span>
            {price && <span className="shrink-0 rounded-full border border-space-600 px-2 py-px font-mono text-[10px] text-ki-300 sm:text-xs">{price}</span>}
          </button>
        );
      })}
      {rejected.map((r) => {
        const why = r.why[0];
        const w = refusal(why, { name: card.name, reaching: r.action.type, ...word });
        return (
          <div
            key={`${r.action.type}:${"skill" in r.action ? r.action.skill : ""}`}
            className={`rounded-lg border border-space-700 bg-space-800/60 px-3 py-2 ${docked ? "" : "opacity-80 sm:px-4 sm:py-3"}`}
            aria-disabled
          >
            <div className="flex items-center gap-3">
              <span className={`min-w-0 flex-1 text-sm font-semibold ${docked ? "text-space-100" : "text-space-300 sm:text-base"}`}>{r.label}</span>
              <span className={`shrink-0 rounded-full border border-loss/50 px-2 py-px font-mono text-[10px] sm:text-xs ${docked ? "text-space-100" : "text-loss"}`}>{pill(why)}</span>
            </div>
            <p className={`mt-1 text-[11px] leading-snug sm:text-xs ${docked ? "text-space-100" : "text-space-200"}`}>
              {w.fact}
              {w.remedy && <span className={docked ? "font-semibold" : "text-ki-300"}> {w.remedy}</span>}
            </p>
            {r.why.length > 1 && (
              <p className={`mt-0.5 text-[10px] ${docked ? "text-space-200" : "text-space-400"}`}>
                {r.why
                  .slice(1)
                  .map((q) => refusal(q, { name: card.name, reaching: r.action.type, ...word }).fact)
                  .join(" ")}
              </p>
            )}
          </div>
        );
      })}
    </>
  );
}

/** Cost, power and combo as three tiles; a leader's are power, life and energy. */
export function StatTiles({ card, leader }: { card: CardView; leader?: { life: number; energy: string } | null }) {
  const n = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("en"));
  const tiles: [string, string][] = leader
    ? [
        ["power", n(card.power)],
        ["life", String(leader.life)],
        ["energy", leader.energy],
      ]
    : [
        ["cost", card.cost ?? "—"],
        ["power", n(card.power)],
        ["combo", card.comboPower != null && card.comboPower > 0 ? `+${n(card.comboPower)}` : "—"],
      ];
  return (
    <dl className="grid grid-cols-3 gap-1.5">
      {tiles.map(([k, v]) => (
        <div key={k} className="rounded-lg border border-space-700 bg-space-800/60 px-2 py-1">
          <dt className="text-[9px] font-semibold uppercase tracking-widest text-space-300">{k}</dt>
          <dd className="font-mono text-sm font-bold tabular-nums text-space-50">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** One chip on a card review: a card's state, or what stands in the way of it. */
export interface InspectorChip {
  label: string;
  /** `bad` is red (a refusal), `good` is the ready colour, `plain` is neutral. */
  tone: "plain" | "good" | "bad";
}

const CHIP_TONE: Record<InspectorChip["tone"], string> = {
  plain: "border-space-500 text-space-100",
  good: "border-gain/70 text-gain",
  bad: "border-loss/70 text-loss",
};

/** The chip row of the docked inspector and of the phone pager. */
export function ChipRow({ chips }: { chips: InspectorChip[] }) {
  if (chips.length === 0) return null;
  return (
    <p className="flex flex-wrap gap-1">
      {chips.map((c) => (
        <span key={c.label} className={`rounded-full border px-2 py-px text-[11px] font-semibold ${CHIP_TONE[c.tone]}`}>
          {c.label}
        </span>
      ))}
    </p>
  );
}

/** The run of cards a phone review steps through, and whose each one is. */
export interface ReviewSequence {
  /** "In play", "Your hand". */
  label: string;
  items: { card: CardView; yours: boolean }[];
}

/** A left or right swipe moves one card past this many px; a downward one closes past `CLOSE_PX`. */
export const SWIPE_PX = 50;
export const CLOSE_PX = 90;

/**
 * Reads one finished gesture. Horizontal wins when it is the longer of the
 * two, so a slightly slanted swipe still pages; a downward one only closes.
 */
export function swipeOf(dx: number, dy: number): "next" | "prev" | "close" | null {
  if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "next" : "prev";
  if (dy >= CLOSE_PX && dy > Math.abs(dx)) return "close";
  return null;
}

function Thumb({ card, yours, current, index, total, onJump }: { card: CardView; yours: boolean; current: boolean; index: number; total: number; onJump: () => void }) {
  const ref = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    // Scroll the strip itself, never the page: `scrollIntoView` would drag the board.
    const el = ref.current;
    const strip = el?.parentElement;
    if (current && el && strip) strip.scrollTo({ left: el.offsetLeft - (strip.clientWidth - el.offsetWidth) / 2, behavior: "auto" });
  }, [current]);
  const face = `h-[46px] w-[34px] rounded-[4px] border transition-transform ${current ? "-translate-y-1 border-ki-400 ring-2 ring-ki-400" : "border-space-600"}`;
  return (
    <button
      ref={ref}
      type="button"
      onClick={onJump}
      data-arena-thumb={card.id}
      aria-current={current ? "true" : undefined}
      aria-label={`${card.name}, ${index + 1} of ${total}`}
      className="flex h-[56px] w-11 shrink-0 flex-col items-center justify-end gap-0.5 pb-0.5"
    >
      {card.imageUrl && !card.hidden ? (
        // eslint-disable-next-line @next/next/no-img-element -- a strip swatch; the board has already loaded this URL.
        <img src={card.imageUrl} alt="" className={`${face} object-cover`} />
      ) : (
        <span className={`${face} bg-space-700`} />
      )}
      <span className={`h-[3px] w-[30px] rounded-full ${yours ? "bg-ki-500" : "bg-[#7c5cd6]"}`} aria-hidden />
    </button>
  );
}

/**
 * The phone card review (`docs/arena-backlog/rd-06`): a sheet that pages
 * through the run of cards the open one belongs to.
 *
 * Swipe left or right steps one card, swipe down shuts it, prev and next sit on
 * the card's edges, and a thumbnail jumps. It owns no game state — the stage
 * hands it the card, the chips and the actions (`ActionRows`), the same pieces
 * the docked inspector draws on desktop. A card outside any run (an energy, a
 * life card) is reviewed alone, without the pager.
 */
export function CardSheet({
  card,
  side,
  moves,
  rejected,
  onPick,
  onClose,
  narrator = DEFAULT_NARRATOR,
  battle,
  sequence,
  where = null,
  chips = [],
  leader = null,
  onJump,
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
  /** The run this card belongs to, when it belongs to one. */
  sequence?: ReviewSequence | null;
  /** "Claude's battle area". */
  where?: string | null;
  chips?: InspectorChip[];
  /** A leader's life and energy, for its stat tiles. */
  leader?: { life: number; energy: string } | null;
  onJump?: (card: CardView) => void;
}) {
  const items = sequence?.items ?? [];
  const at = items.findIndex((i) => i.card.id === card.id);
  const pager = at >= 0 && !!onJump;
  const go = (to: number) => {
    const target = items[to];
    if (pager && target) onJump!(target.card);
  };

  // Keys, for a tablet with a keyboard: the pager has the same three moves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (pager && e.key === "ArrowRight") go(at + 1);
      else if (pager && e.key === "ArrowLeft") go(at - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // One gesture at a time, read when it ends. `touch-action: pan-y` lets a
  // horizontal move through to us untouched; a vertical one may be claimed by
  // the browser as a scroll, which ends the pointer with a cancel — so a
  // cancel is read exactly as a release, from the last point seen.
  const drag = useRef<{ x: number; y: number; lx: number; ly: number; top: boolean } | null>(null);
  const swipedAt = useRef(0);
  const body = useRef<HTMLDivElement | null>(null);
  // A body that fits has nothing to scroll, so the browser must not be offered
  // a vertical pan there — it would cancel the pointer and a swipe down could
  // not be read. One that overflows keeps `pan-y` and scrolls; a swipe down
  // then closes from the handle, the strip and the Close row instead.
  const [scrolls, setScrolls] = useState(false);
  useLayoutEffect(() => {
    const el = body.current;
    if (el) setScrolls(el.scrollHeight > el.clientHeight + 1);
  }, [card.id, moves.length, rejected.length, chips.length, items.length]);
  const begin = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, top: (body.current?.scrollTop ?? 0) <= 0 };
  };
  const move = (e: React.PointerEvent) => {
    if (drag.current) {
      drag.current.lx = e.clientX;
      drag.current.ly = e.clientY;
    }
  };
  const end = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const cancelled = e.type === "pointercancel";
    const s = swipeOf((cancelled ? d.lx : e.clientX) - d.x, (cancelled ? d.ly : e.clientY) - d.y);
    // A scrolled body scrolls; only from the top does a downward move close it.
    if (!s || (s === "close" && !d.top)) return;
    swipedAt.current = Date.now();
    if (s === "close") onClose();
    else go(at + (s === "next" ? 1 : -1));
  };

  const position = pager ? `${sequence!.label} ${at + 1} / ${items.length}` : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center arena-scrim p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={`${card.name}${position ? `, ${position}` : ""}`}
        data-arena-review={card.id}
        className="flex max-h-[88dvh] w-full max-w-md touch-none select-none flex-col overscroll-contain rounded-t-2xl border border-space-700 bg-space-900 pb-6 pt-2 sm:max-w-lg sm:rounded-2xl sm:pb-4"
        onClick={(e) => e.stopPropagation()}
        // The button a swipe ends on must not also be pressed.
        onClickCapture={(e) => {
          if (Date.now() - swipedAt.current < 200) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <span className="mx-auto mb-2 h-1 w-10 shrink-0 rounded-full bg-space-600" aria-hidden />

        {pager && (
          <div className="mb-1 flex shrink-0 items-center gap-2 px-4">
            <p className="w-[4.5rem] shrink-0 text-[10px] font-semibold uppercase leading-tight tracking-[0.18em] text-space-300" aria-live="polite">
              {sequence!.label}
              <span className="block font-mono text-lg font-black italic tracking-normal text-space-50">
                {at + 1} / {items.length}
              </span>
            </p>
            <div className="flex min-w-0 flex-1 touch-pan-x overflow-x-auto pt-1.5" role="group" aria-label={`${sequence!.label}, all cards`}>
              {items.map((it, i) => (
                <Thumb key={it.card.id} card={it.card} yours={it.yours} current={i === at} index={i} total={items.length} onJump={() => go(i)} />
              ))}
            </div>
          </div>
        )}

        <div ref={body} className={`min-h-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden px-4 ${scrolls ? "touch-pan-y" : "touch-none"}`}>
          <div className="flex gap-3">
            <div className="relative w-32 shrink-0 self-start">
              {card.imageUrl && !card.hidden ? (
                // eslint-disable-next-line @next/next/no-img-element -- transient sheet; the board has already loaded this URL.
                <img src={card.imageUrl} alt="" className="card-aspect w-full rounded-lg object-cover" />
              ) : (
                <span className="card-aspect block w-full rounded-lg bg-space-700" />
              )}
              {pager && (
                <>
                  <button
                    type="button"
                    onClick={() => go(at - 1)}
                    disabled={at <= 0}
                    aria-label="Previous card"
                    className="absolute -left-4 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border-2 border-space-500 bg-space-900 text-xl font-black leading-none text-space-50 shadow-md disabled:border-space-600 disabled:text-space-300"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    onClick={() => go(at + 1)}
                    disabled={at >= items.length - 1}
                    aria-label="Next card"
                    className="absolute -right-4 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border-2 border-space-500 bg-space-900 text-xl font-black leading-none text-space-50 shadow-md disabled:border-space-600 disabled:text-space-300"
                  >
                    ›
                  </button>
                </>
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-1.5 pl-3">
              {where && <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-space-200">{where}</p>}
              <h3 className="text-lg font-black italic leading-tight text-space-50">{card.name}</h3>
              <ChipRow chips={chips} />
              <StatTiles card={card} leader={leader} />
            </div>
          </div>
          <ActionRows card={card} side={side} moves={moves} rejected={rejected} onPick={onPick} narrator={narrator} docked />
          <CardDetail card={card} narrator={narrator} battle={battle} figures={false} />
        </div>

        <button
          type="button"
          onClick={onClose}
          className="tap mx-4 mt-3 flex w-[calc(100%-2rem)] shrink-0 items-center justify-between rounded-xl border-2 border-space-500 px-4 py-2 text-left text-sm font-bold text-space-50 hover:border-ki-400"
        >
          <span>Close</span>
          <span className="text-xs font-normal text-space-200">or swipe down</span>
        </button>
      </div>
    </div>
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
  const admin = useArenaAdmin();
  return (
    <Sheet onClose={onClose} title={prompt.question} eyebrow={<StepChip step={prompt.step} />} closeLabel="see the board" tall>
      <p className="text-[11px] text-space-400 sm:text-xs">
        {prompt.hint} {choices.length} card{choices.length === 1 ? "" : "s"} to choose from.
      </p>
      {choices.map((c) => {
        const i = indexOf(c.id);
        return (
          <button
            key={c.id}
            type="button"
            disabled={i == null}
            onClick={() => i != null && onPick(i)}
            className="tap flex w-full items-center gap-3 rounded-lg border border-space-600 bg-space-800 px-2 py-2 text-left hover:border-ki-500/60 disabled:opacity-50 sm:px-3"
          >
            {c.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- a list row; the board has already loaded this URL.
              <img src={c.imageUrl} alt="" className="card-aspect w-10 shrink-0 rounded object-cover sm:w-12" />
            ) : (
              <span className="card-aspect w-10 shrink-0 rounded bg-space-700 sm:w-12" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-space-50">{c.name}</span>
              <span className="block text-[11px] text-space-400">
                {[admin ? c.cardId : null, c.cost ? `cost ${c.cost}` : null, c.power != null ? c.power.toLocaleString("en") : null, c.keywords.length ? c.keywords.join(", ") : null].filter(Boolean).join(" · ")}
              </span>
            </span>
            <span className="shrink-0 rounded-full border border-ki-500/60 px-2 py-px font-mono text-[10px] text-ki-300">choose</span>
          </button>
        );
      })}
      {none != null && (
        <button
          type="button"
          onClick={() => onPick(none)}
          className="tap w-full rounded-lg border border-dashed border-space-500 bg-space-950 px-3 py-3 text-left text-sm font-semibold text-space-100 hover:border-ki-500/60"
        >
          Choose none
          <span className="block text-[11px] font-normal text-space-400">The skill says “up to” — this is the way out.</span>
        </button>
      )}
    </Sheet>
  );
}
