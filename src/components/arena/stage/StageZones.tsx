"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { untilWords } from "@/lib/arena/effects";
import type { Action, PlayerId } from "@/lib/arena/types";
import type { MissingEnergyChip } from "@/lib/arena/wording";
import type { BoardView, CardView, SideView } from "@/lib/arena/view";
import type { CardState } from "../ArenaCard";
import { Counter } from "../shared";
import { Count } from "./BattleParts";
import { ZoneAnchor } from "./anchors";
import { StageCard, type Moment } from "./StageCard";
import { energySummary } from "./stakes-model";
import type { FeedbackLifeCue } from "./useFeedbackCues";

export type CardProps = (c: CardView) => {
  layoutMotion?: boolean;
  card: CardView;
  state: CardState;
  suppressed: boolean;
  onTap: (() => void) | undefined;
  onInspect: () => void;
  onHover: (box: DOMRect | null) => void;
  nudge: boolean;
  moment: Moment | null;
  outlined: boolean;
};

/**
 * Card sizes on the field, at phone scale (`--arena` multiplies them from `sm`
 * up). The redesign's (`docs/arena-redesign/prototype/arena.css`: `--lw`,
 * `--cw`): a leader 80 × 112, a Battle Card 68 × 95 — the named size change
 * spec §6 allows. The hand's 84 is in `Hand.tsx`.
 */
export const LEADER_W = 80;
export const UNIT_W = 68;
/** How many positions a Battle Area shows before it scrolls: cards, then dashed slots. */
const SLOTS = 4;
const h = (w: number) => Math.round((w * 88) / 63);
const sized = (w: number) => ({ width: `calc(${w}px * var(--arena, 1))`, height: `calc(${h(w)}px * var(--arena, 1))` });

export function MenuSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-[10px] font-semibold uppercase tracking-[0.24em] text-space-500">{title}</h4>
      {children}
    </section>
  );
}

export function ReferenceCounts({ side }: { side: SideView }) {
  return (
    <div className="rounded-lg border border-space-700 bg-space-800/60 px-3 py-2">
      <p className="text-sm font-semibold text-space-100">{side.name}</p>
      <dl className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-space-400 sm:text-xs">
        <Counter label="hand" value={side.handCount} />
        <Counter label="deck" value={side.deck} />
        <Counter label="drop" value={side.drop} />
        {side.zDeck > 0 && <Counter label="Z" value={side.zDeck} />}
        {side.zEnergy > 0 && <Counter label="Z energy" value={side.zEnergy} />}
        {side.warp > 0 && <Counter label="warp" value={side.warp} />}
      </dl>
    </div>
  );
}

/**
 * What a card being dragged out of the hand is doing to a zone that could take
 * it (rd-03). `ok` is the engine's verdict (a legal action exists); the board
 * only draws it. `hot` is the pointer being over the zone now.
 */
export interface DropState {
  ok: boolean;
  hot: boolean;
  label: string;
  /** Whether the pill is said now: always when it could land, and on a refusal only when it is news (hovered, or an energy shortfall). */
  say: boolean;
}

/** The explosion's 12 shards: angle in degrees and how far each flies, in px (the prototype's). */
const SHARDS: readonly (readonly [number, number])[] = [
  [0, 74],
  [30, 58],
  [60, 80],
  [90, 62],
  [120, 78],
  [150, 56],
  [180, 72],
  [210, 60],
  [240, 82],
  [270, 58],
  [300, 76],
  [330, 64],
];

/** Whether an element is wider than its box — so a row scrolls only when it must, and otherwise lets a lunge or a glow out. */
function useOverflows<T extends HTMLElement>(dep: unknown) {
  const ref = useRef<T | null>(null);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setOverflows(el.scrollWidth > el.clientWidth + 1);
    const ro = new ResizeObserver(measure);
    // The initial observation runs after layout. Measuring synchronously here
    // forces a second layout between React's card updates.
    ro.observe(el);
    return () => ro.disconnect();
  }, [dep]);
  return [ref, overflows] as const;
}

/**
 * One player's Battle Area, with their leader as its first card
 * (`docs/arena-redesign/` frame 01): the leader, the unison, the Battle Cards,
 * then dashed slots up to four positions, so the field keeps its shape from
 * the first turn. Nothing is written in an empty row.
 *
 * `active`: it is this side's turn, so the row carries the faint wash.
 */
export function BattleRow({
  side,
  cards,
  cardProps,
  zone,
  label,
  active = false,
  drop = null,
  lifted,
  compactLifted = false,
  hurt = false,
  hit = null,
  them = false,
  targetLabel,
  attackRole,
}: {
  side: SideView;
  /** The Battle Cards to draw (those a staging lifted are already left out). */
  cards: CardView[];
  cardProps: CardProps;
  zone: string;
  label: string;
  active?: boolean;
  drop?: DropState | null;
  /** Cards a battle staging is drawing, which this row must not draw twice. */
  lifted?: ReadonlySet<string>;
  /** Reclaim empty placeholder space while a phone hand decision uses the lifted Leader. */
  compactLifted?: boolean;
  /** This player is taking damage right now: the leader shakes. */
  hurt?: boolean;
  /**
   * The damage beat on screen against this player (rd-07): an explosion on the
   * leader. `n` is the beat's number, so a second hit in a row plays again.
   */
  hit?: { n: number; amount: number; critical: boolean } | null;
  /** The opponent's row: its Leader tag wears their colour. */
  them?: boolean;
  /** Compact current attack target guidance, from the legal menu/rejection evidence. */
  targetLabel?: (card: CardView) => string | null;
  attackRole?: { attacker: string; target: string } | null;
}) {
  const p = side.player;
  const leader = side.leader;
  const unison = side.unison && !lifted?.has(side.unison.id) ? side.unison : null;
  const filled = cards.length + (unison ? 1 : 0);
  const compact = compactLifted && !!leader && !!lifted?.has(leader.id) && filled === 0 && !drop;
  const placeholderSize = (width: number) => ({ ...sized(width), ...(compact ? { height: "calc(80px * var(--arena, 1))" } : {}) });
  const empty = Math.max(0, SLOTS - filled);
  // The landing slot is the first empty one; a full row grows one to land in.
  const slots = drop?.ok && empty === 0 ? 1 : empty;
  const [rowRef, scrolls] = useOverflows<HTMLDivElement>(`${filled}|${slots}`);
  return (
    // The outline and the pill live outside the row: the row may scroll
    // sideways and would clip a pill that sits above it.
    <div className="arena-field arena-dropzone relative" data-drop={drop ? (drop.ok ? "ok" : "no") : undefined} data-hot={drop?.hot ? "" : undefined}>
      <div
        ref={rowRef}
        aria-label={label}
        className={`arena-row ${active ? "arena-row-on" : ""} flex items-center gap-[5px] px-1.5 py-2 sm:gap-2 sm:px-3 lg:gap-3 lg:[justify-content:safe_center] ${scrolls ? "overflow-x-auto" : ""}`}
        style={{ minHeight: `calc(${compact ? 80 : h(LEADER_W)}px * var(--arena, 1) + 16px)` }}
      >
        {/* The leader's own anchor, explosion and shake, on its slot. */}
        <div key={hurt ? `${p}-hurt-${hit?.n ?? 0}` : p} className={`relative mr-[3px] shrink-0 sm:mr-1 ${hurt ? "arena-hurt" : ""}`}>
          <ZoneAnchor zone={`${p}:leader`} />
          {leader &&
            (lifted?.has(leader.id) ? (
              // A leader up in a band is drawn there and nowhere else, but the
              // slot it left keeps its shape so the row does not collapse.
              <span className="arena-slot arena-slot-lifted block" style={placeholderSize(LEADER_W)} aria-hidden />
            ) : (
              /* The footprint is reserved and the scale happens inside it, so
                 the row does not reflow when the turn flips. */
              <span className={`arena-leader ${active ? "arena-leader-on" : "arena-leader-off"}`} style={sized(LEADER_W)}>
                <StageCard {...cardProps(leader)} width={LEADER_W} />
                {attackRole?.attacker === leader.id && <span className="pointer-events-none absolute bottom-0 left-1/2 z-30 -translate-x-1/2 rounded bg-ki-500 px-1 py-px text-[8px] font-black tracking-wider text-space-950" data-attack-role="attacker">ATTACKER</span>}
                {attackRole?.target === leader.id && <span className="pointer-events-none absolute bottom-0 left-1/2 z-30 -translate-x-1/2 rounded bg-gain px-1 py-px text-[8px] font-black tracking-wider text-space-950" data-attack-role="target">TARGET</span>}
                {targetLabel?.(leader) && <span className={`pointer-events-none absolute left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded bg-space-900 px-1 py-px text-[8px] font-bold text-space-50 ${attackRole?.target === leader.id || attackRole?.attacker === leader.id ? "-bottom-7" : "-bottom-3"}`} data-target-label={leader.id}>{targetLabel(leader)}</span>}
                {active && <span className="arena-leader-ring" aria-hidden />}
                {/* Named on both sides (#783): the leader is not a card anyone played, and on a
                    phone the two look alike without a word on them. */}
                <span className="arena-leader-tag" data-leader-label={p} data-them={them ? "" : undefined}>
                  Leader
                </span>
              </span>
            ))}
          {!leader && <span className="arena-slot block" style={sized(LEADER_W)} aria-hidden />}
          {/* The explosion, centred on the leader. The pieces are transforms, not shadows. */}
          {hit && (
            <span className={`arena-boom ${hit.critical ? "arena-boom-big" : ""}`} style={{ left: `calc(${LEADER_W / 2}px * var(--arena, 1))`, top: `calc(${h(LEADER_W) / 2}px * var(--arena, 1))` }} aria-hidden>
              <span className="arena-boom-flash" />
              <span className="arena-boom-ring" />
              {SHARDS.map(([a, d]) => (
                <i key={a} className="arena-boom-shard" style={{ "--a": `${a}deg`, "--d": `${d}px` } as React.CSSProperties} />
              ))}
            </span>
          )}
        </div>
        {/* The Battle Area proper starts here, after a rule that sets the leader apart. */}
        <div className="arena-battle-cards relative flex min-w-0 items-center gap-[5px] sm:gap-2 lg:gap-3">
          <ZoneAnchor zone={zone} />
          {unison && <div className="relative"><StageCard {...cardProps(unison)} width={UNIT_W} />{attackRole?.attacker === unison.id && <span className="pointer-events-none absolute left-1/2 top-0 z-30 -translate-x-1/2 rounded bg-ki-500 px-1 py-px text-[8px] font-black tracking-wider text-space-950" data-attack-role="attacker">ATTACKER</span>}{attackRole?.target === unison.id && <span className="pointer-events-none absolute left-1/2 top-0 z-30 -translate-x-1/2 rounded bg-gain px-1 py-px text-[8px] font-black tracking-wider text-space-950" data-attack-role="target">TARGET</span>}{targetLabel?.(unison) && <span className="pointer-events-none absolute -bottom-3 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded bg-space-900 px-1 py-px text-[8px] font-bold text-space-50" data-target-label={unison.id}>{targetLabel(unison)}</span>}</div>}
          {cards.map((c) => (
            <div key={c.id} className="relative"><StageCard {...cardProps(c)} width={UNIT_W} />{attackRole?.attacker === c.id && <span className="pointer-events-none absolute left-1/2 top-0 z-30 -translate-x-1/2 rounded bg-ki-500 px-1 py-px text-[8px] font-black tracking-wider text-space-950" data-attack-role="attacker">ATTACKER</span>}{attackRole?.target === c.id && <span className="pointer-events-none absolute left-1/2 top-0 z-30 -translate-x-1/2 rounded bg-gain px-1 py-px text-[8px] font-black tracking-wider text-space-950" data-attack-role="target">TARGET</span>}{targetLabel?.(c) && <span className="pointer-events-none absolute -bottom-3 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded bg-space-900 px-1 py-px text-[8px] font-bold text-space-50" data-target-label={c.id}>{targetLabel(c)}</span>}</div>
          ))}
          {Array.from({ length: slots }, (_, i) => (
            // A slot gives way before a card does: on a narrow board the empty
            // positions shrink so the cards keep their size.
            <span
              key={`slot-${i}`}
              className={`arena-slot block ${drop?.ok && i === 0 ? "arena-slot-land" : ""}`}
              style={{ ...placeholderSize(UNIT_W), flexShrink: 1, minWidth: 18 }}
              aria-hidden
            />
          ))}
        </div>
      </div>
      {drop && (
        <>
          <span className="arena-drop-ring" aria-hidden />
          {drop.say && (
            <span className="arena-droptag" data-ok={drop.ok ? "" : undefined} role="status">
              {drop.label}
            </span>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The lane between the two Battle Areas.
 *
 * At rest it is a line with the narration pill on it — the last thing that
 * happened, said once, in the middle of the field where the eye already is
 * (`docs/arena-redesign/` frame 01). A tap on the pill opens the battle log.
 *
 * In the `inplace` staging it is also that staging's own picture of a fight:
 * the power figures and both Combo Areas. When a band or a takeover is drawing
 * the fight those cards are up there instead and the lane keeps its pill.
 */
export function Lane({
  view,
  cardProps,
  staged = false,
  narration,
  onLog,
  logOpen = false,
  fastForward,
  canFastForward = false,
  summary,
  children,
}: {
  view: BoardView;
  cardProps: CardProps;
  staged?: boolean;
  /** The sentence on the pill, and whose it is (the dot's colour). */
  narration: { text: string; n: number; mine: boolean } | null;
  onLog: () => void;
  logOpen?: boolean;
  fastForward?: () => void;
  canFastForward?: boolean;
  /** Engine outcome, displayed in the lane in place of the narration pill. */
  summary?: ReactNode;
  /** The log, when it is open: drawn over the lane. */
  children?: ReactNode;
}) {
  const b = staged ? null : view.battle;
  if (b) {
    const winning = b.attackPower >= b.guardPower;
    return (
      <div className="arena-field arena-lane-battle relative my-1 px-2 py-2 sm:my-2">
        {canFastForward && <button type="button" onClick={fastForward} className="arena-btn tap absolute right-2 top-1 z-10 min-h-11 rounded-lg border border-space-600 bg-space-900/90 px-3 text-xs font-semibold text-space-50">⏩ Fast-forward</button>}
        <div className="arena-clash relative flex items-center justify-center gap-3 sm:gap-6">
          <Count value={b.attackPower} className={`arena-impact relative text-2xl tabular-nums sm:text-4xl lg:text-5xl ${winning ? "arena-power-win text-ki-300" : "text-space-400"}`} />
          <span className="arena-impact relative text-[10px] tracking-[0.3em] text-space-500 sm:text-xs">VS</span>
          <Count value={b.guardPower} className={`arena-impact relative text-2xl tabular-nums sm:text-4xl lg:text-5xl ${!winning ? "arena-power-win text-ki-300" : "text-space-400"}`} />
        </div>
        {(view.them.combo.length > 0 || view.you.combo.length > 0) && (
          <div className="mt-2 flex items-end justify-between">
            <div className="relative flex items-end gap-1 sm:gap-2">
              <ZoneAnchor zone="p2:combo" />
              <span className="self-center text-[10px] uppercase tracking-wider text-space-500 sm:text-xs">{view.them.name}</span>
              {view.them.combo.map((c) => (
                <StageCard key={c.id} {...cardProps(c)} width={32} />
              ))}
            </div>
            <div className="relative flex items-end gap-1 sm:gap-2">
              <ZoneAnchor zone="p1:combo" />
              {view.you.combo.map((c) => (
                <StageCard key={c.id} {...cardProps(c)} width={32} />
              ))}
              <span className="self-center text-[10px] uppercase tracking-wider text-space-500 sm:text-xs">you</span>
            </div>
          </div>
        )}
        {children}
      </div>
    );
  }
  return (
    <div className="arena-field arena-lane relative flex min-h-[56px] flex-1 items-center justify-center px-3 py-1.5">
      {summary != null ? (
        <div className="relative z-[1] max-h-32 min-w-0 w-full max-w-[28rem] overflow-y-auto text-center" data-arena-outcome-summary>
          {summary}
        </div>
      ) : narration && (
        <div className="relative z-[1] flex max-w-full items-center gap-2">
          <button
            type="button"
            onClick={onLog}
            aria-expanded={logOpen}
            aria-label={`${narration.text} — open the battle log`}
            className="arena-lanepill flex min-h-11 min-w-0 max-w-full items-center gap-2 rounded-full py-2 pl-3 pr-4 text-left text-sm font-semibold leading-tight lg:text-base"
          >
            <span className="arena-lanepill-dot h-[9px] w-[9px] shrink-0 rounded-full" data-mine={narration.mine ? "" : undefined} data-them={narration.mine ? undefined : ""} aria-hidden />
            <span key={narration.n} className="arena-drop line-clamp-2 min-w-0">
              {narration.text}
            </span>
          </button>
          {canFastForward && <button type="button" onClick={fastForward} className="arena-btn tap min-h-11 shrink-0 rounded-lg border border-space-600 bg-space-900 px-2 text-[10px] font-semibold text-space-50 sm:px-3 sm:text-xs">⏩ Fast-forward</button>}
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * A player's strip: one line with the avatar, the name, the life as skewed
 * pips, the energy as chips, and the hand and deck counts at the right
 * (`docs/arena-redesign/` frame 01, `.strip`). It carries the anchors for the
 * piles a card flies to and from, and is the zone a dragged card charges into.
 *
 * Energy is chips because it is nearly always a count. When a prompt names an
 * energy card — SD5-01's [Awaken] asks for up to 2 of your energy, and
 * `hiddenChoices` keeps such a card out of the search sheet — the chips give
 * way to the cards themselves, at a size a finger can hit, for as long as the
 * question stands.
 */
export function PlayerStrip({
  side,
  them = false,
  cardProps,
  onOpenInspection,
  hit = null,
  lifeCue = null,
  narrator,
  energyChips,
  drop = null,
  willRest = 0,
  restingIds = [],
  gain = null,
  className = "",
}: {
  side: SideView;
  them?: boolean;
  cardProps: CardProps;
  /** Open the public zone/deck inspection sheet when the strip is tapped. */
  onOpenInspection?: () => void;
  /** The damage beat on screen against this player: the emptied pips shatter and -N LIFE rises. */
  hit?: { n: number; amount: number; critical: boolean } | null;
  /** Public life-loss cue, keyed by its beat number. */
  lifeCue?: FeedbackLifeCue | null;
  narrator: { viewer: PlayerId; them: string };
  energyChips?: MissingEnergyChip[];
  /** A card is being dragged and this is the zone it would charge into (rd-03). */
  drop?: DropState | null;
  /** How many of the active energy the dragged card's play would rest. */
  willRest?: number;
  /** Exact resource ids from a VM payment offer; never chosen by strip order. */
  restingIds?: readonly string[];
  /** A charge was just sent: "+1 ENERGY" rises beside the energy for `ms` (rd-04). */
  gain?: { key: number; ms: number } | null;
  className?: string;
}) {
  const p = side.player;
  // A chip that arrives pops in (rd-04). The first render is not an arrival.
  const [inspectEnergy, setInspectEnergy] = useState(false);
  const [seen, setSeen] = useState<{ ids: string[]; fresh: ReadonlySet<string> }>(() => ({ ids: side.energy.map((c) => c.id), fresh: new Set() }));
  const nowIds = side.energy.map((c) => c.id);
  if (nowIds.join("|") !== seen.ids.join("|")) setSeen({ ids: nowIds, fresh: new Set(nowIds.filter((id) => !seen.ids.includes(id))) });
  const arrived = seen.fresh;
  const resting = new Set(restingIds);
  // Active energy first, then rested, as the chips read left to right.
  const energy = [...side.energy.filter((c) => c.mode === "active"), ...side.energy.filter((c) => c.mode !== "active")];
  const askable = (c: CardView) => {
    const s = cardProps(c).state;
    return s === "legal" || s === "selected";
  };
  const energyAsked = side.energy.some(askable);
  const faceUp = [...side.lifeFaceUp, ...side.zDeckFaceUp];
  const pips = Math.max(8, side.life);
  const flag = them ? "" : undefined;
  const lifeWord = `${side.life} life`;
  const energyWord = `${side.activeEnergy} of ${side.energy.length} energy active`;

  return (
    <div className={`arena-field relative ${className}`} aria-label={them ? `${side.name}'s side` : "Your side"}>
      <div
        className={`arena-pstrip arena-dropzone relative flex h-9 min-w-0 items-center gap-2 px-3 text-xs sm:h-10 sm:gap-3 sm:text-sm lg:h-11 lg:gap-4 lg:px-[18px] ${onOpenInspection ? "cursor-pointer" : ""}`}
        data-drop={drop ? (drop.ok ? "ok" : "no") : undefined}
        data-hot={drop?.hot ? "" : undefined}
        role={onOpenInspection ? "button" : undefined}
        tabIndex={onOpenInspection ? 0 : undefined}
        aria-label={onOpenInspection ? `Inspect ${side.name}'s deck and public zones` : undefined}
        onClick={onOpenInspection}
        onKeyDown={onOpenInspection ? (event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpenInspection();
          }
        } : undefined}
      >
        <ZoneAnchor zone={`${p}:energy`} />
        <span className="flex min-w-0 flex-1 shrink items-center gap-1.5 font-bold text-space-50 lg:flex-none">
          <span className="arena-avatar grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full text-xs lg:h-7 lg:w-7 lg:text-sm" data-them={flag} aria-hidden>
            {side.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="truncate text-[13px] lg:text-base">{side.name}</span>
        </span>
        {/* The labelled number saves space on phones; desktop keeps its original life pips. */}
        <span key={`life-desktop-${lifeCue?.beat ?? "idle"}`} className={`relative hidden shrink-0 items-baseline gap-1 whitespace-nowrap tabular-nums lg:flex ${lifeCue ? "arena-feedback-life" : ""}`} role="img" aria-label={lifeWord}>
          <ZoneAnchor zone={`${p}:life`} />
          {Array.from({ length: pips }, (_, i) => (
            <i key={i} className="arena-lp relative block h-[15px] w-[9px] sm:h-[17px] sm:w-3 lg:h-[22px] lg:w-4" data-them={flag} data-gone={i < side.life ? undefined : ""}>
              {hit && i >= side.life && i < side.life + hit.amount && <b className="arena-pip-shatter" />}
            </i>
          ))}
          {lifeCue && <span className="arena-feedback-life-label pointer-events-none absolute bottom-full left-1/2 z-20 whitespace-nowrap rounded bg-space-950 px-1.5 py-0.5 text-[10px] font-black text-space-50" aria-hidden>{lifeCue.text}</span>}
        </span>
        <span className="relative flex shrink-0 items-baseline gap-1 whitespace-nowrap tabular-nums lg:hidden" aria-label={lifeWord}>
          <ZoneAnchor zone={`${p}:life`} />
          <b key={`life-${lifeCue?.beat ?? "idle"}`} className={`font-bold text-space-50 ${lifeCue ? "arena-feedback-life" : ""}`}>{side.life}</b><span>Life</span>
          {(lifeCue || hit) && (
            <span key={`life-label-${lifeCue?.beat ?? hit?.n}`} className={`${lifeCue ? "arena-feedback-life-label" : "arena-lifefloat"} pointer-events-none absolute bottom-full left-1/2 z-20 whitespace-nowrap rounded bg-space-950 px-1.5 py-0.5 text-[10px] font-black text-space-50`} aria-hidden>
              {lifeCue?.text ?? `−${hit?.amount} LIFE`}
            </span>
          )}
        </span>
        {/* Energy: active chips upright, rested ones turned and grey. */}
        {/* The chips open the energy detail (#783): one tap, where the eye already is. */}
        {!energyAsked && (
          <button
            type="button"
            className="arena-energy-toggle relative flex min-h-11 min-w-0 shrink items-center gap-[2px] sm:gap-[3px]"
            aria-label={`${energyWord} — ${inspectEnergy ? "hide" : "show"} energy detail`}
            aria-expanded={inspectEnergy}
            onClick={(event) => {
              event.stopPropagation();
              setInspectEnergy((open) => !open);
            }}
          >
            {energy.map((c) => (
              <i
                key={c.id}
                className={`arena-ec block h-[14px] w-[9px] min-w-[4px] shrink sm:h-[15px] sm:w-[10px] lg:h-[19px] lg:w-[13px] ${arrived.has(c.id) ? "arena-chip" : ""} ${resting.has(c.id) ? "arena-will" : ""}`}
                data-them={flag}
                data-off={c.mode === "active" ? undefined : ""}
              />
            ))}
            {side.energyMarkers > 0 && <span className="arena-num ml-0.5 text-[11px] text-ki-300">+{side.energyMarkers}</span>}
            {energyChips?.map((chip, i) => (
              <span key={i} className="arena-ec-miss ml-0.5 whitespace-nowrap rounded-[3px] px-1 text-[10px] font-bold leading-[13px]" title={chip.text}>
                {chip.text}
              </span>
            ))}
            <span className="ml-1 whitespace-nowrap text-[10px] font-bold tabular-nums text-space-50 sm:text-xs lg:hidden xl:inline">⚡ {side.activeEnergy}/{side.energy.length}</span>
            {gain && !them && (
              <span key={gain.key} className="arena-gain arena-num pointer-events-none absolute bottom-full left-0 z-10 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] tracking-wider" style={{ animationDuration: `${gain.ms}ms` }} aria-hidden>
                +1 ENERGY
              </span>
            )}
          </button>
        )}
        <span className="ml-auto flex shrink-0 items-baseline gap-2 whitespace-nowrap tabular-nums sm:gap-2.5">
          {them && (
            <span className="relative">
              <ZoneAnchor zone={`${p}:hand`} />
              <span className="inline-flex items-center gap-0.5 lg:hidden" aria-label={`${side.name}'s hand`}>
                <span className="inline-flex items-center gap-px" aria-hidden>
                  {Array.from({ length: Math.min(side.handCount, 4) }, (_, i) => <i key={i} className="block h-[12px] w-[8px] rounded-[2px] border border-space-300/70 shadow-sm" style={{ background: "var(--card-back)" }} />)}
                </span>
                <b className="font-bold text-space-50">{side.handCount}</b>
              </span>
              <span className="hidden lg:inline">hand <b className="font-bold text-space-50">{side.handCount}</b></span>
            </span>
          )}
          <span className="relative">
            <ZoneAnchor zone={`${p}:deck`} />
            deck <b className="font-bold text-space-50">{side.deck}</b>
          </span>
          <span className="relative hidden lg:inline">
            <ZoneAnchor zone={`${p}:drop`} />
            drop <b className="font-bold text-space-50">{side.drop}</b>
          </span>
          {/* Below lg the drop has no count on the strip, but a ghost still needs somewhere to fly. */}
          <span className="relative lg:hidden" aria-hidden>
            <ZoneAnchor zone={`${p}:drop`} />
          </span>
        </span>
        {drop && (
          <>
            <span className="arena-drop-ring" aria-hidden />
            {drop.say && (
              <span className="arena-droptag arena-droptag-energy" data-ok={drop.ok ? "" : undefined} role="status">
                {drop.label}
              </span>
            )}
          </>
        )}
      </div>

      {/* Below lg the line is behind the energy chips' one tap; from lg it is always there. */}
      <div className={`flex-wrap items-center gap-x-2 px-3 text-xs leading-snug text-space-100 ${inspectEnergy ? "flex" : "hidden lg:flex"}`} data-player-resources={side.player} data-player-resources-open={inspectEnergy || energyAsked ? "" : undefined}>
        <span className="font-semibold">Life {side.life} · Energy {side.activeEnergy}/{side.energy.length} ready</span>
        <span>{energySummary(side)}</span>
        <button type="button" className="tap min-h-11 rounded px-2 font-semibold underline underline-offset-2" aria-expanded={inspectEnergy} onClick={(event) => { event.stopPropagation(); setInspectEnergy((open) => !open); }}>Inspect energy</button>
        {willRest > 0 && <span className="w-full">Play costs {willRest} energy; remaining colours depend on the chosen payment.</span>}
      </div>

      {/* The rarer things a strip has no room for, on a line of their own and
          only while they exist: energy a prompt is asking for, face-up life
          (3-9-2-1, open to both players), and rules on the player. */}
      {(energyAsked || inspectEnergy || faceUp.length > 0 || (side.rules?.length ?? 0) > 0) && (
        <div className="mt-1 flex flex-wrap items-center gap-1 px-2">
          {inspectEnergy && <p className="w-full text-xs text-space-100">Ready/total by colour. A multicolour card counts in each colour but pays only one energy. Energy markers: {side.energyMarkers}.</p>}
          {inspectEnergy && side.energyColors?.some((row) => JSON.stringify(row.colors) !== JSON.stringify(row.paymentColors)) && <p className="w-full text-xs text-space-100">{energySummary(side, [], "effective")}. Payment colours above reflect payment restrictions and exceptions.</p>}
          {(energyAsked || inspectEnergy) &&
            energy.map((c) => (
              <span key={c.id} className={arrived.has(c.id) ? "arena-chip inline-flex" : "contents"}>
                <StageCard {...cardProps(c)} onTap={cardProps(c).onTap ?? cardProps(c).onInspect} width={44} upsideDown pulse={resting.has(c.id)} />
              </span>
            ))}
          {faceUp.map((c) => (
            <StageCard key={c.id} {...cardProps(c)} width={askable(c) ? 44 : 26} />
          ))}
          {side.rules && side.rules.length > 0 && (
            <ul className="w-full space-y-0.5 text-[11px] leading-snug text-loss" aria-label={`Rules on ${them ? side.name : "you"}`}>
              {side.rules.map((r, i) => (
                <li key={i}>
                  ⛔ {r.label} · {untilWords(r.until, { master: r.by, viewer: narrator.viewer, them: narrator.them, sourceName: r.sourceName })}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** The card an action names, read the way `Tappable` indexes it. */
export function cardIdOf(a: Action): string | null {
  const x = a as { card?: string | null; attacker?: string; cards?: string[] };
  if (typeof x.card === "string") return x.card;
  if (typeof x.attacker === "string") return x.attacker;
  if (Array.isArray(x.cards) && x.cards.length === 1) return x.cards[0];
  return null;
}

export function refusalActionType(rejected: { action: Action }[], id: string): string {
  return rejected.find((r) => cardIdOf(r.action) === id)?.action.type ?? "play";
}
