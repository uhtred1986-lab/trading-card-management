"use client";

import type { ReactNode } from "react";
import { untilWords } from "@/lib/arena/effects";
import type { Action, PlayerId } from "@/lib/arena/engine";
import type { MissingEnergyChip } from "@/lib/arena/wording";
import type { BoardView, CardView, SideView } from "@/lib/arena/view";
import type { CardState } from "../ArenaCard";
import { Counter } from "../shared";
import { Count } from "./BattleParts";
import { ZoneAnchor } from "./anchors";
import { StageCard, type Moment } from "./StageCard";

export type CardProps = (c: CardView) => {
  card: CardView;
  state: CardState;
  suppressed: boolean;
  onTap: (() => void) | undefined;
  onInspect: () => void;
  onHover: (box: DOMRect | null) => void;
  nudge: boolean;
  moment: Moment | null;
};

export function MenuSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-[10px] font-semibold uppercase tracking-[0.24em] text-space-500">{title}</h4>
      {children}
    </section>
  );
}

export function ReferenceCounts({ side }: { side: SideView }) {
  const p = side.player;
  return (
    <div className="rounded-lg border border-space-700 bg-space-800/60 px-3 py-2">
      <p className="text-sm font-semibold text-space-100">{side.name}</p>
      <dl className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-space-400 sm:text-xs">
        <span className="relative">
          <ZoneAnchor zone={`${p}:deck`} />
          <Counter label="deck" value={side.deck} />
        </span>
        <span className="relative">
          <ZoneAnchor zone={`${p}:drop`} />
          <Counter label="drop" value={side.drop} />
        </span>
        {side.zDeck > 0 && <Counter label="Z" value={side.zDeck} />}
        {side.zEnergy > 0 && <Counter label="Z energy" value={side.zEnergy} />}
        {side.warp > 0 && <Counter label="warp" value={side.warp} />}
      </dl>
    </div>
  );
}

/** One player's Battle Area, collapsed until it holds a card. */
export function BattleRow({ cards, cardProps, zone, label }: { cards: CardView[]; cardProps: CardProps; zone: string; label: string }) {
  return (
    <div className={`relative flex items-center gap-1.5 overflow-x-auto [justify-content:safe_center] sm:gap-2 lg:gap-3 ${cards.length > 0 ? "min-h-[calc(78px*var(--arena,1))]" : "min-h-[30px] justify-center"}`}>
      <ZoneAnchor zone={zone} />
      {cards.map((c) => (
        <StageCard key={c.id} {...cardProps(c)} width={52} />
      ))}
      {cards.length === 0 && (
        <div className="flex w-full items-center gap-2" aria-label={label}>
          <span className="h-px flex-1 border-t border-dashed border-space-700/80" aria-hidden />
          <p className="text-[11px] text-space-500">no Battle Cards yet</p>
          <span className="h-px flex-1 border-t border-dashed border-space-700/80" aria-hidden />
        </div>
      )}
    </div>
  );
}

/**
 * The middle of the stage: the power figures, both Combo Areas, or a quiet
 * line. This is the `inplace` staging's own picture of a fight; when a band or
 * a takeover is drawing one, those cards are up there instead and this stands
 * down to the quiet divider, so the strip keeps its height and the board does
 * not jump as a battle opens.
 */
export function ClashBand({ view, cardProps, staged = false }: { view: BoardView; cardProps: CardProps; staged?: boolean }) {
  const b = staged ? null : view.battle;
  if (!b) {
    // The divider keeps the two Battle Areas apart and says nothing else.
    // Whose turn it was used to be written here — 10 px, grey, centred between
    // two rows where nothing draws the eye — which is how the most important
    // fact on the board came to be ignored, and then contradicted by the
    // headline beneath it. `TurnStrip` says it now, and two turn indicators is
    // how the first one came to be ignored (`docs/arena-hud-spec.md` §2.1).
    return (
      <div className="my-2 flex items-center gap-3 sm:my-3" aria-hidden>
        <span className="h-px flex-1 bg-gradient-to-r from-transparent to-space-700" />
        <span className="h-1 w-1 rounded-full bg-space-700" />
        <span className="h-px flex-1 bg-gradient-to-l from-transparent to-space-700" />
      </div>
    );
  }
  const winning = b.attackPower >= b.guardPower;
  return (
    <div className="my-2 rounded-xl border border-ki-500/35 bg-gradient-to-b from-ki-500/10 to-transparent p-2 sm:my-3 sm:p-3">
      <div className="arena-clash relative flex items-center justify-center gap-3 font-mono sm:gap-6">
        <Count value={b.attackPower} className={`arena-impact relative text-2xl font-black tabular-nums sm:text-4xl lg:text-5xl ${winning ? "arena-power-win text-ki-300" : "text-space-400"}`} />
        <span className="arena-impact relative text-[10px] font-bold tracking-[0.3em] text-space-500 sm:text-xs">VS</span>
        <Count value={b.guardPower} className={`arena-impact relative text-2xl font-black tabular-nums sm:text-4xl lg:text-5xl ${!winning ? "arena-power-win text-ki-300" : "text-space-400"}`} />
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
    </div>
  );
}

/** The opponent's hand: a count, fanned, peeking over the top of the stage. */
export function HandBacks({ count }: { count: number }) {
  const shown = Math.min(count, 10);
  return (
    <div className="relative mb-1 flex items-start justify-center sm:mb-2" aria-label={`${count} cards in hand`}>
      <ZoneAnchor zone="p2:hand" />
      {Array.from({ length: shown }, (_, i) => (
        <span
          key={i}
          className="arena-card-back -ml-1.5 h-[calc(24px*var(--arena,1))] w-[calc(22px*var(--arena,1))] rounded-b-[3px] border border-space-500 first:ml-0"
          style={{ transform: `rotate(${(i - (shown - 1) / 2) * 2.5}deg)` }}
        />
      ))}
      {count === 0 && <span className="text-[10px] uppercase tracking-widest text-space-600">empty hand</span>}
    </div>
  );
}

/** A player's own corner of the table, with an anchor on every pile. */
export function SideRail({
  side,
  them = false,
  active = false,
  cardProps,
  hurt = false,
  narrator,
  lifted,
  energyChips,
  className = "",
}: {
  side: SideView;
  them?: boolean;
  /** It is this side's turn: its leader owns the room (turn-presence spec §2.3). */
  active?: boolean;
  cardProps: CardProps;
  /** This player is taking damage right now. */
  hurt?: boolean;
  narrator: { viewer: PlayerId; them: string };
  /** Cards a battle staging is drawing, which this rail must not draw twice. */
  lifted?: ReadonlySet<string>;
  energyChips?: MissingEnergyChip[];
  className?: string;
}) {
  const spent = side.energy.length - side.activeEnergy;
  const p = side.player;
  /**
   * Energy and face-up life are drawn small because they are nearly always a
   * count rather than a choice. But a prompt can name them — SD5-01's [Awaken]
   * asks for up to 2 of your energy — and `hiddenChoices` keeps a card the
   * board already draws out of the search sheet, so this row is the only place
   * such a choice can be answered. They therefore carry every prop a card in
   * the Battle Area carries, and grow to a real target while they are askable.
   * Passing only `suppressed` here left that [Awaken] with no answer on screen
   * but "Choose none".
   */
  const pile = (c: CardView) => {
    const props = cardProps(c);
    return { ...props, width: props.onTap ? 44 : 22 };
  };
  return (
    <aside
      // Keyed on `hurt` so a second hit in the same turn shakes again rather
      // than sitting still on an animation that already played.
      key={hurt ? `${p}-hurt` : p}
      className={`flex items-center gap-3 rounded-xl border border-space-700/70 bg-space-900/60 p-2 sm:rounded-2xl sm:p-3 lg:w-44 lg:flex-col lg:items-stretch lg:gap-3 xl:w-52 ${hurt ? "arena-hurt" : ""} ${className}`}
      aria-label={them ? `${side.name}'s side` : "Your side"}
    >
      <div className="relative flex shrink-0 items-end gap-1.5 lg:justify-center">
        <ZoneAnchor zone={`${p}:leader`} />
        {/* A leader up in a band is drawn there and nowhere else, but the slot
            it left keeps its shape so the rail does not collapse under it. */}
        {side.leader &&
          (lifted?.has(side.leader.id) ? (
            <span className="arena-slot" style={{ width: `calc(56px * var(--arena, 1))`, height: `calc(78px * var(--arena, 1))` }} aria-hidden />
          ) : (
            /* The footprint is reserved and the scale happens inside it, so
               the rail does not reflow when the turn flips — the same rule
               that keeps layout still between every other pair of states. */
            <span className={`arena-leader ${active ? "arena-leader-on" : "arena-leader-off"}`} style={{ width: `calc(56px * var(--arena, 1))`, height: `calc(78px * var(--arena, 1))` }}>
              <StageCard {...cardProps(side.leader)} width={56} />
              {active && <span className="arena-leader-ring" aria-hidden />}
            </span>
          ))}
        {side.unison && !lifted?.has(side.unison.id) && <StageCard {...cardProps(side.unison)} width={48} />}
      </div>

      <div className="relative min-w-0 lg:text-center">
        <ZoneAnchor zone={`${p}:life`} />
        <p className="truncate text-xs font-semibold text-space-100 sm:text-sm">{side.name}</p>
        <div className="flex items-baseline gap-1.5 lg:justify-center">
          <span className={`arena-impact font-mono text-3xl font-black leading-none tabular-nums sm:text-4xl ${side.life <= 2 ? "text-loss" : "text-space-50"}`}>{side.life}</span>
          <span className="text-[10px] uppercase tracking-widest text-space-500">life</span>
        </div>
        <span className="mt-1 flex gap-[2px] lg:justify-center">
          {Array.from({ length: 8 }, (_, i) => (
            <i key={i} className={`h-2 w-[5px] rounded-[1px] sm:h-2.5 sm:w-[6px] ${i < side.life ? "bg-gain" : "bg-space-700"}`} />
          ))}
        </span>
        {side.leader?.power != null && <p className="mt-1 font-mono text-xs font-bold text-gain sm:text-sm">{side.leader.power.toLocaleString("en")}</p>}
        {/* 3-9-2-1: a life card turned face up is open to both players, and the
            skills that read it are counting these, so they are shown. */}
        {(side.lifeFaceUp.length > 0 || side.zDeckFaceUp.length > 0) && (
          <div className="mt-1 flex flex-wrap gap-[2px] lg:justify-center">
            {[...side.lifeFaceUp, ...side.zDeckFaceUp].map((c) => (
              <StageCard key={c.id} {...pile(c)} />
            ))}
          </div>
        )}
      </div>

      <div className="relative ml-auto min-w-0 lg:ml-0">
        <ZoneAnchor zone={`${p}:deck`} />
        <ZoneAnchor zone={`${p}:drop`} />
        <ZoneAnchor zone={`${p}:energy`} />
        <div className="flex flex-wrap items-baseline gap-1 lg:justify-center">
          <span className="font-mono text-base font-bold text-ki-300 sm:text-lg">
            {side.activeEnergy}
            <span className="text-space-500">/{side.energy.length}</span>
          </span>
          <span className="text-[10px] uppercase tracking-widest text-space-500">energy</span>
          {side.energyMarkers > 0 && <span className="rounded bg-ki-500/20 px-1 font-mono text-[10px] text-ki-300">+{side.energyMarkers}</span>}
          {energyChips && energyChips.length > 0 && (
            <span className="ml-1 inline-flex flex-wrap items-center gap-1">
              {energyChips.map((chip, i) => (
                <span
                  key={i}
                  className="rounded border border-loss/30 bg-loss/15 px-1.5 py-0.5 font-mono text-[10px] font-medium leading-none text-loss whitespace-nowrap"
                  title={chip.text}
                >
                  {chip.text}
                </span>
              ))}
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-[2px] lg:justify-center">
          {side.energy.map((c) => (
            <StageCard key={c.id} {...pile(c)} upsideDown />
          ))}
          {side.energy.length === 0 && <span className="text-[10px] text-space-600">none charged</span>}
        </div>
        {spent > 0 && <p className="mt-0.5 text-[10px] text-space-500 lg:text-center">{spent} rested</p>}
        {/* Rules in force on the player rather than on a card — "can't attack
            with Battle Cards" — which no card on the table could carry. */}
        {side.rules && side.rules.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-[10px] leading-snug text-loss lg:text-center" aria-label={`Rules on ${them ? side.name : "you"}`}>
            {side.rules.map((r, i) => (
              <li key={i}>
                ⛔ {r.label} · {untilWords(r.until, { master: r.by, viewer: narrator.viewer, them: narrator.them, sourceName: r.sourceName })}
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
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
