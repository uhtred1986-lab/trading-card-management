"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Spotlight } from "@/lib/arena/games";
import type { BoardView, CardView } from "@/lib/arena/view";
import { CardDetail, ChipRow, type InspectorChip } from "./shared-sheets";

export type { InspectorChip };
import { DEFAULT_NARRATOR, plainText, type Narrator } from "./shared-model";
import { newestFirst, type StoryLine } from "@/lib/arena/story";

export function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-1 rounded bg-space-950/50 px-1.5 py-0.5">
      <dt className="text-space-500">{label}</dt>
      <dd className="arena-num text-space-100">{value}</dd>
    </div>
  );
}

/**
 * The cards a report could be about: everything either player can see. Hidden
 * cards are left out, because naming one would say more than the board does.
 */
export function cardsOnTable(view: BoardView): { cardId: string; name: string }[] {
  const out: { cardId: string; name: string }[] = [];
  for (const side of [view.you, view.them]) {
    for (const c of [side.leader, side.unison, ...side.battle, ...side.combo, ...side.energy, ...(side.hand ?? [])]) {
      if (c && !c.hidden) out.push({ cardId: c.cardId, name: c.name });
    }
  }
  return out;
}

const STEP_LABELS: Record<string, string> = {
  "phase:charge": "Charge Phase",
  "phase:main": "Main Phase",
  "phase:mainEnd": "Main Phase",
  "phase:end": "End Phase",
  "battle:declared": "Attack!",
  "battle:offense": "Offense Step",
  "battle:defense": "Defense Step",
  "battle:damage": "Damage Step",
};

/**
 * The phase and battle-step banner. `hold` is a turn banner being on screen or
 * still due: the phase waits for it and plays straight after, so the two never
 * stack (issue #344).
 */
export function StepBanner({ step, hold = false }: { step: string; hold?: boolean }) {
  const [shown, setShown] = useState<{ key: number; text: string } | null>(null);
  const prev = useRef<string | null>(null);
  const due = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (prev.current !== step) {
      const first = prev.current === null;
      prev.current = step;
      due.current = first ? null : (STEP_LABELS[step] ?? null);
    }
    if (hold || !due.current) return;
    const text = due.current;
    due.current = null;
    setShown({ key: Date.now(), text });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(null), 1500);
  }, [step, hold]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  if (!shown) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-40 grid place-items-center" aria-hidden>
      <p key={shown.key} className="arena-banner arena-impact select-none text-4xl font-black uppercase italic tracking-tight text-space-50 sm:text-6xl lg:text-7xl">
        {shown.text}
      </p>
    </div>
  );
}

export function SkillSpotlight({ spotlight }: { spotlight: (Spotlight & { imageUrl: string | null }) | null }) {
  const [shown, setShown] = useState<(Spotlight & { imageUrl: string | null }) | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const seen = useRef<number | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<{ startX: number; startY: number; from: { x: number; y: number } } | null>(null);

  useEffect(() => {
    if (!spotlight || seen.current === spotlight.seq) return;
    seen.current = spotlight.seq;
    setShown(spotlight);
    setExpanded(false);
    setOffset({ x: 0, y: 0 });
    dismissTimer.current = setTimeout(() => setShown(null), 4000);
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, [spotlight]);

  const keepOpen = () => {
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
  };

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    keepOpen();
    drag.current = { startX: e.clientX, startY: e.clientY, from: offset };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const { startX, startY, from } = drag.current;
    setOffset({ x: from.x + (e.clientX - startX), y: from.y + (e.clientY - startY) });
  };
  const endDrag = () => {
    drag.current = null;
  };

  if (!shown) return null;
  return (
    <div
      className="fixed left-2 top-24 z-40 w-[19rem] sm:left-4 sm:top-28 sm:w-[23rem]"
      style={{ transform: offset.x || offset.y ? `translate(${offset.x}px, ${offset.y}px)` : undefined }}
      aria-live="polite"
    >
      <div className={`arena-drop arena-float relative flex gap-2 rounded-xl border-l-4 bg-space-900/95 p-2 pr-6 backdrop-blur ${shown.unread ? "border-dbs-yellow" : "border-ki-500"}`}>
        <button
          type="button"
          onClick={() => {
            keepOpen();
            setShown(null);
          }}
          className="tap absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full text-space-400 hover:bg-space-800 hover:text-space-50"
          aria-label="Dismiss"
        >
          ×
        </button>
        <div
          className="flex min-w-0 flex-1 cursor-grab touch-none select-none gap-2 active:cursor-grabbing"
          onPointerDown={startDrag}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {shown.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- transient overlay, art already loaded by the board.
            <img src={shown.imageUrl} alt="" className="card-aspect h-16 shrink-0 rounded object-cover sm:h-20" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-space-50">{shown.name}</p>
            <span className="mt-0.5 inline-block rounded bg-ki-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ki-300">{shown.label}</span>
            <p className={`mt-1 whitespace-pre-wrap text-[11px] leading-snug text-space-200 sm:text-xs ${expanded ? "max-h-48 overflow-y-auto pr-1" : "line-clamp-3"}`}>{plainText(shown.text)}</p>
            {shown.unread && <p className="mt-1 text-[10px] font-semibold text-dbs-yellow">The referee ruled on this card&apos;s text.</p>}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            keepOpen();
            setExpanded((v) => !v);
          }}
          className="tap absolute bottom-1 right-1 rounded px-1 text-[10px] font-semibold uppercase tracking-wide text-ki-300 hover:text-ki-400"
        >
          {expanded ? "less" : "more"}
        </button>
      </div>
    </div>
  );
}

export function AttackBeam({ from, to, hostRef }: { from: string; to: string; hostRef: React.RefObject<HTMLDivElement | null> }) {
  const [line, setLine] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

  useEffect(() => {
    const measure = () => {
      const host = hostRef.current;
      const a = host?.querySelector(`[data-arena-card="${CSS.escape(from)}"]`);
      const b = host?.querySelector(`[data-arena-card="${CSS.escape(to)}"]`);
      if (!host || !a || !b) return setLine(null);
      const h = host.getBoundingClientRect();
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      setLine({
        x1: ra.left + ra.width / 2 - h.left,
        y1: ra.top + ra.height / 2 - h.top,
        x2: rb.left + rb.width / 2 - h.left,
        y2: rb.top + rb.height / 2 - h.top,
      });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [from, to, hostRef]);

  if (!line) return null;
  const cx = (line.x1 + line.x2) / 2;
  const cy = (line.y1 + line.y2) / 2 - Math.max(40, Math.abs(line.x2 - line.x1) / 5);
  const d = `M ${line.x1} ${line.y1} Q ${cx} ${cy} ${line.x2} ${line.y2}`;
  return (
    <svg className="pointer-events-none absolute inset-0 z-20 h-full w-full overflow-visible" aria-hidden>
      <path d={d} fill="none" stroke="var(--color-ki-500)" strokeOpacity={0.25} strokeWidth={12} strokeLinecap="round" />
      <path d={d} fill="none" stroke="var(--color-ki-300)" strokeWidth={3} strokeLinecap="round" />
      <circle cx={line.x2} cy={line.y2} r={7} fill="var(--color-ki-400)" fillOpacity={0.35} />
      <circle cx={line.x2} cy={line.y2} r={3.5} fill="var(--color-ki-300)" />
    </svg>
  );
}

export function CardPreview({ card, box, narrator = DEFAULT_NARRATOR }: { card: CardView; box: DOMRect; narrator?: Narrator }) {
  const width = 300;
  const gap = 14;
  const toRight = box.right + gap;
  const left = toRight + width < window.innerWidth ? toRight : Math.max(gap, box.left - gap - width);
  const lower = box.top + box.height / 2 > window.innerHeight / 2;
  const edge = lower ? { bottom: gap } : { top: Math.max(gap, box.top - 40) };

  return (
    <div
      className="arena-float pointer-events-none fixed z-40 hidden max-h-[calc(100dvh-1.75rem)] overflow-hidden rounded-2xl border border-space-600 bg-space-900/95 p-3 backdrop-blur sm:block"
      style={{ left, width, ...edge }}
      aria-hidden
    >
      {card.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- transient overlay; the board has already loaded this URL.
        <img src={card.imageUrl} alt="" className="card-aspect mb-2 w-full rounded-lg object-cover" />
      )}
      <CardDetail card={card} withName narrator={narrator} />
    </div>
  );
}

/**
 * The narration log's rows (#350), newest first, a turn heading whenever the
 * turn changes. Children of an `<ol>`; empty reads as "nothing has happened yet".
 */
export function StoryList({ story }: { story: StoryLine[] }) {
  const rows = newestFirst(story);
  if (rows.length === 0) return <li>nothing has happened yet</li>;
  return (
    <>
      {rows.map((l, i) => (
        <li key={l.n}>
          {(i === 0 || rows[i - 1].turn !== l.turn) && <span className="mb-0.5 mt-1.5 block text-[10px] font-semibold uppercase tracking-widest text-space-400">Turn {l.turn}</span>}
          <span className={l.mine ? "text-space-100" : "text-space-300"}>{l.text}</span>
        </li>
      ))}
    </>
  );
}

export function NarrationRibbon({ text, n, mine, live }: { text: string; n: number; mine: boolean; live: boolean }) {
  return (
    <div className={`flex items-center gap-2 border-b border-space-700/80 px-3 py-1 text-[11.5px] leading-snug sm:px-5 sm:py-1.5 ${live ? "text-space-100" : "text-space-300"}`} aria-live="polite">
      <span className={`shrink-0 font-semibold uppercase tracking-[0.22em] ${mine ? "text-ki-300" : "text-space-500"}`}>{live ? "NOW" : "LAST"}</span>
      <span key={n} className="arena-drop min-w-0 flex-1 truncate">
        {text}
      </span>
    </div>
  );
}

/**
 * The docked card review (desktop, lg and up; `docs/arena-backlog/rd-05`).
 *
 * It draws whatever it is given and owns no state: the stage decides which
 * card is on it (hover, pin, row hover) and what its actions are, so a pager
 * for the phone (rd-06) can hand the same pieces to a different frame.
 * `actions` is an `ActionRows` list; `stats` is `StatTiles`.
 */
export function DockedInspector({
  card,
  where,
  chips,
  stats,
  actions,
  pinned,
  onUnpin,
  narrator = DEFAULT_NARRATOR,
  battle,
}: {
  card: CardView | null;
  /** "Claude's battle area", "Your hand". */
  where: string | null;
  chips: InspectorChip[];
  stats: React.ReactNode;
  actions: React.ReactNode;
  pinned: boolean;
  onUnpin: () => void;
  narrator?: Narrator;
  battle?: Parameters<typeof CardDetail>[0]["battle"];
}) {
  if (!card) {
    return (
      <div className="grid h-full place-items-center p-4 text-center text-sm text-space-300" data-arena-inspector="empty">
        Hover any card to review it — no clicks needed.
      </div>
    );
  }
  return (
    <div className="space-y-2 p-3" data-arena-inspector={card.id}>
      {card.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- the board has already loaded this URL.
        <img src={card.imageUrl} alt="" className="card-aspect mx-auto w-40 rounded-lg object-cover xl:w-48" />
      )}
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-space-200">{where}</p>
        {pinned && (
          <button
            type="button"
            onClick={onUnpin}
            className="shrink-0 rounded-full border border-space-500 px-2 py-px text-[10px] uppercase tracking-wider text-space-200 hover:border-ki-400 hover:text-ki-300"
          >
            pinned · esc
          </button>
        )}
      </div>
      <h3 className="text-lg font-black italic leading-tight text-space-50">{card.name}</h3>
      <ChipRow chips={chips} />
      {stats}
      <div className="space-y-1.5">{actions}</div>
      <CardDetail card={card} narrator={narrator} battle={battle} figures={false} />
    </div>
  );
}

/** One row of the In play list: art swatch, name, state, power. */
export interface InPlayRow {
  card: CardView;
  /** "Leader · 2 life · standing", "Rested". */
  note: string;
}

export interface InPlaySide {
  name: string;
  rows: InPlayRow[];
  /** Battle cards only, as in the reference frame: "2 in battle · 32,000 power". */
  battleCount: number;
  battlePower: number;
}

/**
 * Every card on both boards, the leader first. A row is hover-and-focus
 * reviewable (it fills the inspector and outlines the card on the board) and a
 * click pins it.
 */
export function InPlayList({
  sides,
  inspected,
  onReview,
  onPin,
}: {
  sides: InPlaySide[];
  inspected: string | null;
  /** The pointer or focus is on a row (id), or left it (null). */
  onReview: (id: string | null) => void;
  onPin: (id: string) => void;
}) {
  return (
    <div className="space-y-3 p-2">
      {sides.map((side) => (
        <div key={side.name} role="group" aria-label={`${side.name} in play`}>
          <p className="flex items-baseline justify-between gap-2 px-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-space-300">
            <span>{side.name}</span>
            <span className="font-normal normal-case tracking-normal">
              {side.battleCount} in battle · {side.battlePower.toLocaleString("en")} power
            </span>
          </p>
          <ul className="mt-1 space-y-1">
            {side.rows.map(({ card, note }) => (
              <li key={card.id}>
                <button
                  type="button"
                  data-arena-row={card.id}
                  onClick={() => onPin(card.id)}
                  onPointerEnter={(e) => e.pointerType === "mouse" && onReview(card.id)}
                  onPointerLeave={(e) => e.pointerType === "mouse" && onReview(null)}
                  onFocus={() => onReview(card.id)}
                  onBlur={() => onReview(null)}
                  aria-label={`${card.name}, ${note}`}
                  className={`flex w-full items-center gap-2 rounded-lg border px-1.5 py-1 text-left hover:border-ki-400 ${inspected === card.id ? "border-ki-400 bg-space-800" : "border-space-700 bg-space-800/50"}`}
                >
                  {card.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a list swatch; the board has already loaded this URL.
                    <img src={card.imageUrl} alt="" className="card-aspect w-7 shrink-0 rounded-[3px] object-cover" />
                  ) : (
                    <span className="card-aspect w-7 shrink-0 rounded-[3px] bg-space-700" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-space-50">{card.name}</span>
                    <span className="block truncate text-[10px] text-space-300">{note}</span>
                  </span>
                  <span className="shrink-0 arena-num text-xs tabular-nums text-ki-300">{card.power != null ? card.power.toLocaleString("en") : ""}</span>
                </button>
              </li>
            ))}
            {side.rows.length === 0 && <li className="px-1 text-[11px] text-space-400">nothing in play</li>}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * The inspector over two tabs — In play, and the log. The log is the narration
 * log (#350): the sentences the story told, newest first, under their turn.
 */
export function InspectorColumn({ inspector, inPlay, story }: { inspector: React.ReactNode; inPlay: React.ReactNode; story: StoryLine[] }) {
  const [tab, setTab] = useState<"play" | "log">("play");
  return (
    <div className="flex max-h-[calc(100dvh-5rem)] flex-col overflow-hidden rounded-xl border border-space-700/70 bg-space-900/90 lg:sticky lg:top-16" aria-label="Card review">
      {/* A fixed height, scrolling inside: the tabs below must not move when a
          taller card fills it, or a row under the pointer slides away from it. */}
      <div className="h-[min(20rem,38dvh)] shrink-0 overflow-y-auto xl:h-[min(24rem,40dvh)]">{inspector}</div>
      <div role="tablist" className="flex shrink-0 gap-1 border-y border-space-700 p-1.5 text-xs font-semibold">
        {(
          [
            ["play", "In play"],
            ["log", "Battle log"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`tap flex-1 rounded-lg border px-2 py-1 ${tab === k ? "border-ki-400 bg-space-800 text-space-50" : "border-transparent text-space-300 hover:text-space-50"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="h-[min(12rem,24dvh)] shrink-0 overflow-y-auto xl:h-[min(14rem,24dvh)]">
        {tab === "play" ? (
          inPlay
        ) : (
          <ol className="space-y-0.5 p-2 text-xs leading-relaxed text-space-300">
            <StoryList story={story} />
          </ol>
        )}
      </div>
    </div>
  );
}
