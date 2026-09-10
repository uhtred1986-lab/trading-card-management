"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Spotlight } from "@/lib/arena/games";
import type { BoardView, CardView } from "@/lib/arena/view";
import { CardDetail } from "./shared-sheets";
import { DEFAULT_NARRATOR, plainText, type Narrator } from "./shared-model";

export function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-1 rounded bg-space-950/50 px-1.5 py-0.5">
      <dt className="text-space-500">{label}</dt>
      <dd className="font-mono font-bold text-space-100">{value}</dd>
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

/** Charge, Main, End and the four battle steps, with the live one lit. */
export function TopStrip({ view }: { view: BoardView }) {
  const steps = ["charge", "main", "end"];
  const battleSteps = ["declared", "offense", "defense", "damage"];
  return (
    <div className="arena-strip flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-space-500 sm:gap-3 sm:text-xs lg:text-sm">
      {steps.map((p) => (
        <span key={p} className={view.phase === p || (p === "main" && view.phase === "mainEnd") ? "font-bold text-ki-400" : ""}>
          {p}
        </span>
      ))}
      {view.battle && (
        <>
          <span className="mx-1 h-3 w-px bg-space-600 sm:h-4" />
          {battleSteps.map((b) => (
            <span key={b} className={view.battle!.step === b ? "font-bold text-ki-400" : ""}>
              {b === "declared" ? "attack" : b}
            </span>
          ))}
        </>
      )}
    </div>
  );
}

export function TurnStrip({ view, yours, moves }: { view: BoardView; yours: boolean; moves: number }) {
  return (
    <div
      className={`arena-turnstrip ${yours ? "arena-turnstrip-you" : "arena-turnstrip-them"} flex items-center gap-2 rounded-lg px-2.5 py-1 sm:gap-3 sm:rounded-xl sm:px-3 sm:py-1.5`}
      aria-live="polite"
    >
      <span className="truncate text-xs font-black uppercase italic tracking-wide sm:text-sm">{yours ? "Your move" : `${view.them.name}'s move`}</span>
      {yours && moves > 0 && (
        <span className="arena-turnstrip-pill shrink-0 rounded-full px-1.5 font-mono text-[10px] tabular-nums sm:text-[11px]">
          {moves} {moves === 1 ? "move" : "moves"}
        </span>
      )}
      {!yours && <span className="arena-turnstrip-dot h-2 w-2 shrink-0 rounded-full" aria-hidden />}
      <span className="arena-turnstrip-turn ml-auto shrink-0 font-mono text-[10px] tabular-nums sm:text-[11px]">turn {view.turn}</span>
    </div>
  );
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

export function StepBanner({ step }: { step: string }) {
  const [shown, setShown] = useState<{ key: number; text: string } | null>(null);
  const prev = useRef<string | null>(null);

  useEffect(() => {
    if (prev.current === step) return;
    const first = prev.current === null;
    prev.current = step;
    const text = STEP_LABELS[step];
    if (first || !text) return;
    setShown({ key: Date.now(), text });
    const t = setTimeout(() => setShown(null), 1500);
    return () => clearTimeout(t);
  }, [step]);

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
    <div className="fixed left-2 top-24 z-40 w-[19rem] sm:left-4 sm:top-28 sm:w-[23rem]" style={{ transform: offset.x || offset.y ? `translate(${offset.x}px, ${offset.y}px)` : undefined }} aria-live="polite">
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
        <div className="flex min-w-0 flex-1 cursor-grab touch-none select-none gap-2 active:cursor-grabbing" onPointerDown={startDrag} onPointerMove={onDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
          {shown.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- transient overlay, art already loaded by the board.
            <img src={shown.imageUrl} alt="" className="card-aspect h-16 shrink-0 rounded object-cover sm:h-20" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-space-50">{shown.name}</p>
            <span className="mt-0.5 inline-block rounded bg-ki-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ki-300">{shown.label}</span>
            <p className={`mt-1 whitespace-pre-wrap text-[11px] leading-snug text-space-200 sm:text-xs ${expanded ? "max-h-48 overflow-y-auto pr-1" : "line-clamp-3"}`}>{plainText(shown.text)}</p>
            {shown.unread && <p className="mt-1 text-[10px] font-semibold text-dbs-yellow">Claude ruled on this one.</p>}
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
    <div className="arena-float pointer-events-none fixed z-40 hidden max-h-[calc(100dvh-1.75rem)] overflow-hidden rounded-2xl border border-space-600 bg-space-900/95 p-3 backdrop-blur sm:block" style={{ left, width, ...edge }} aria-hidden>
      {card.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- transient overlay; the board has already loaded this URL.
        <img src={card.imageUrl} alt="" className="card-aspect mb-2 w-full rounded-lg object-cover" />
      )}
      <CardDetail card={card} withName narrator={narrator} />
    </div>
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
