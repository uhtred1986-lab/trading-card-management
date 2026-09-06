"use client";

import { useEffect, useRef, useState } from "react";
import type { LegalAction, RejectedAction, Requirement } from "@/lib/arena/engine";
import type { Spotlight } from "@/lib/arena/games";
import type { BoardView, CardView, PromptView, SideView } from "@/lib/arena/view";
import { pill, priceOf, refusal, sentence, stepText } from "@/lib/arena/wording";

/**
 * The parts of the board that are the same whichever board is drawing it: the
 * step banner, the skill spotlight, the attack beam, the card inspector and
 * its sheet, and the two bits of text tidying.
 *
 * They live here rather than in either board so the classic board and the
 * motion board (the `stage/` tree) cannot drift apart on what a card says about itself,
 * and so retiring the classic one in Phase F is a deletion rather than a
 * salvage operation.
 */
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
      <span className="ml-auto text-space-600">
        T{view.turn} · {view.turnPlayer === view.you.player ? "you" : view.them.name}
      </span>
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

/**
 * The one piece of theatre: the step name slams across the stage when it
 * changes. Nothing depends on it — it is skipped on the first paint and on
 * `prefers-reduced-motion` it simply appears and goes.
 */
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

/**
 * The card whose text just fired, named with its own bracket tag and the
 * clause that resolved. This is where the engine stops being a black box: it
 * says which skill it read, and marks the ones it could not read on its own,
 * which is exactly when Claude was asked to rule instead.
 */
export function SkillSpotlight({ spotlight }: { spotlight: (Spotlight & { imageUrl: string | null }) | null }) {
  const [shown, setShown] = useState<(Spotlight & { imageUrl: string | null }) | null>(null);
  const seen = useRef<number | null>(null);

  useEffect(() => {
    if (!spotlight || seen.current === spotlight.seq) return;
    const first = seen.current === null;
    seen.current = spotlight.seq;
    // On a reload the last skill is still on the row; don't replay it.
    if (first) return;
    setShown(spotlight);
    const t = setTimeout(() => setShown(null), 4000);
    return () => clearTimeout(t);
  }, [spotlight]);

  if (!shown) return null;
  return (
    // Clear of the page header — it may overlay the board, not the game's name.
    <div className="pointer-events-none fixed left-2 top-24 z-40 w-[19rem] sm:left-4 sm:top-28 sm:w-[23rem]" aria-live="polite">
      <div
        className={`arena-drop arena-float flex gap-2 rounded-xl border-l-4 bg-space-900/95 p-2 backdrop-blur ${
          shown.unread ? "border-dbs-yellow" : "border-ki-500"
        }`}
      >
        {shown.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- transient overlay, art already loaded by the board.
          <img src={shown.imageUrl} alt="" className="card-aspect h-16 shrink-0 rounded object-cover sm:h-20" />
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-space-50">{shown.name}</p>
          <span className="mt-0.5 inline-block rounded bg-ki-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ki-300">{shown.label}</span>
          <p className="mt-1 line-clamp-3 text-[11px] leading-snug text-space-200 sm:text-xs">{plainText(shown.text)}</p>
          {shown.unread && <p className="mt-1 text-[10px] font-semibold text-dbs-yellow">Claude ruled on this one.</p>}
        </div>
      </div>
    </div>
  );
}

/**
 * The arc from the attacker to what it is attacking. Both ends are found in the
 * DOM by card id, because either one can be a Leader in a side panel or a
 * Battle Card on the stage, and they are measured again when the window moves.
 */
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

/**
 * What a mouse hovering a card shows: the art at a size that can actually be
 * read, with the same detail the long press gives on a phone. It sits beside
 * the card it belongs to and flips to the other side near an edge.
 */
export function CardPreview({ card, box }: { card: CardView; box: DOMRect }) {
  const width = 300;
  const gap = 14;
  const toRight = box.right + gap;
  const left = toRight + width < window.innerWidth ? toRight : Math.max(gap, box.left - gap - width);
  // Anchored to whichever edge the card is nearer, so a card in the hand pushes
  // the panel up off the bottom of the screen instead of running past it.
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
      <CardDetail card={card} withName />
    </div>
  );
}

/** A card's numbers, text and the engine's reading of it — shared by the preview and the inspector. */
export function CardDetail({ card, withName = false }: { card: CardView; withName?: boolean }) {
  return (
    <div className="space-y-1.5">
      {withName && <p className="text-sm font-semibold leading-tight text-space-50">{card.name}</p>}
      <p className="text-[11px] text-space-400 sm:text-xs">
        {card.cardId}
        {card.cost ? ` · cost ${card.cost}` : ""}
        {card.power != null ? ` · ${card.power.toLocaleString("en")} power` : ""}
        {card.comboCost != null ? ` · combo +${(card.comboPower ?? 0).toLocaleString("en")} for ${card.comboCost}` : ""}
      </p>
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

/**
 * Card text comes out of the catalog as HTML, so a skill naming a card type
 * arrives as `&lt;Majin Buu&gt;` and would be shown raw.
 */
export function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export function shortLabel(label: string): string {
  return label.replace(/^Don't /, "No ").replace(/ \(the skill does not resolve\)$/, "").slice(0, 22);
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-space-950/70 p-0 sm:items-center sm:p-4" onClick={onClose}>
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

/**
 * Where a prompt sits in a skill's chain, from the engine's own flow
 * (`prompt.step`) — never a client counting its taps, which is wrong the first
 * time a skill branches. "step 2" alone when the chain cannot say its length.
 */
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

/**
 * The card action sheet (`docs/arena-workflow-spec.md` §7, Phase 2): every
 * legal action on one card with its price on it, then every move the rules
 * refused with the reason worded, then the card itself. The same sheet opens
 * from a tap, a long press and a right-click, so there is one place a card
 * explains what it can and cannot do.
 */
export function CardSheet({
  card,
  side,
  moves,
  rejected,
  onPick,
  onClose,
}: {
  card: CardView;
  /** The player's own side, for the remedy in an energy refusal. */
  side: SideView | null;
  moves: SheetMove[];
  rejected: RejectedAction[];
  onPick: (move: SheetMove) => void;
  onClose: () => void;
}) {
  const inHand = side?.hand?.some((c) => c.id === card.id) ?? false;
  return (
    <Sheet onClose={onClose} title={card.name} eyebrow={moves.length ? <span className="text-[10px] uppercase tracking-widest text-ki-300">what would you like to do?</span> : rejected.length ? <span className="text-[10px] uppercase tracking-widest text-loss">no move right now</span> : undefined}>
      {moves.map((m) => {
        const price = m.targets ? `${m.targets} target${m.targets === 1 ? "" : "s"}` : priceOf(m.legal.action, card, m.legal.label);
        return (
          <button
            key={m.index}
            type="button"
            onClick={() => onPick(m)}
            className="tap flex w-full items-center gap-3 rounded-lg border border-ki-500/60 bg-ki-500/10 px-3 py-2 text-left text-sm font-semibold text-space-50 hover:border-ki-400 sm:px-4 sm:py-3 sm:text-base"
          >
            <span className="min-w-0 flex-1">{m.targets ? `Attack with ${card.name}…` : m.legal.label}</span>
            {price && <span className="shrink-0 rounded-full border border-space-600 px-2 py-px font-mono text-[10px] text-ki-300 sm:text-xs">{price}</span>}
          </button>
        );
      })}
      {rejected.map((r) => {
        const why = r.why[0];
        const w = refusal(why, { name: card.name, reaching: r.action.type, side, inHand });
        return (
          <div key={r.action.type} className="rounded-lg border border-space-700 bg-space-800/60 px-3 py-2 opacity-80 sm:px-4 sm:py-3" aria-disabled>
            <div className="flex items-center gap-3">
              <span className="min-w-0 flex-1 text-sm font-semibold text-space-300 sm:text-base">{r.label}</span>
              <span className="shrink-0 rounded-full border border-loss/50 px-2 py-px font-mono text-[10px] text-loss sm:text-xs">{pill(why)}</span>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-space-200 sm:text-xs">
              {w.fact}
              {w.remedy && <span className="text-ki-300"> {w.remedy}</span>}
            </p>
            {r.why.length > 1 && <p className="mt-0.5 text-[10px] text-space-400">{r.why.slice(1).map((q) => refusal(q, { name: card.name, reaching: r.action.type, side, inHand }).fact).join(" ")}</p>}
          </div>
        );
      })}
      <div className={moves.length || rejected.length ? "border-t border-space-700 pt-2" : ""}>
        {card.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- transient sheet; the board has already loaded this URL.
          <img src={card.imageUrl} alt="" className="card-aspect float-right ml-3 mb-2 w-24 rounded-lg object-cover sm:w-28" />
        )}
        <CardDetail card={card} />
      </div>
    </Sheet>
  );
}

/**
 * The search sheet: a `chooseCards` prompt over cards no zone draws — a deck
 * search, a look at the Drop — laid out as a list to read rather than a row of
 * thumbnails. Every row is a legal choice (the engine only names what may be
 * chosen), and a prompt with `min: 0` gets an explicit "Choose none", because
 * once a skill's cost is paid that button is the only honest way out.
 */
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

/**
 * The opponent's turn, one sentence at a time (workflow spec §7, Phase 3).
 *
 * Bound to the beat on screen while the story plays, and held afterwards —
 * dimmer, with the beat's number — so a turn that went past too fast can
 * still be read without opening the log. `mine` colours the tick for a
 * sentence about your own move, which the same stream also carries.
 */
export function NarrationRibbon({ text, n, mine, live }: { text: string; n: number; mine: boolean; live: boolean }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-2 py-1 text-[11px] leading-snug sm:text-xs ${
        mine ? "border-gain/40 bg-space-800/90" : "border-space-600 bg-space-800/90"
      } ${live ? "text-space-100" : "text-space-300"}`}
      aria-live="polite"
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${mine ? "arena-tick-you bg-gain" : "arena-tick-them bg-ki-500"} ${live ? "animate-pulse" : ""}`} aria-hidden />
      <span key={n} className="arena-drop min-w-0 flex-1 truncate">{text}</span>
      <span className="shrink-0 font-mono text-[9px] text-space-500">#{n}</span>
    </div>
  );
}

/** The one refusal line under the question, when a tap was just refused. */
export function refusalLine(why: Requirement[] | undefined, o: Parameters<typeof sentence>[1]): string | null {
  return why?.length ? sentence(why[0], o) : null;
}

