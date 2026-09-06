"use client";

import { LayoutGroup, animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect, useRef, useState, useTransition } from "react";
import { act, advanceGame } from "@/app/arena/actions";

import type { Action } from "@/lib/arena/engine";
import { feel } from "@/lib/arena/feel";
import type { Snapshot } from "@/lib/arena/snapshot";
import type { BoardView, CardView, SideView } from "@/lib/arena/view";
import { useWakeLock } from "@/lib/arena/wake";
import { type CardState } from "../ArenaCard";
import { FeelToggle } from "../FeelToggle";
import { ReportBug } from "../ReportBug";
import { AttackBeam, CardDetail, CardPreview, Counter, Sheet, SkillSpotlight, StepBanner, TopStrip, cardsOnTable, shortLabel } from "../shared";
import { ZoneAnchor } from "./anchors";
import { Ghosts } from "./Ghosts";
import { Hand } from "./Hand";
import { StageCard, type Moment } from "./StageCard";
import { useBeatPlayer } from "./useBeatPlayer";
import { useLiveGame } from "./useLiveGame";
import { useIdle } from "./useIdle";

/**
 * The motion board.
 *
 * Same pieces as the classic board and the same rule that it knows no rules —
 * everything tappable still comes from the engine's `legalActions`. What is new
 * is that it shows the *change* rather than only the result: a card flies from
 * hand to Battle Area because it is one element that changed parent, and a
 * whole opponent turn plays out beat by beat instead of arriving as a jump.
 *
 * Selected by the `boardStyle` cookie; `?board=classic` goes back.
 */
export function ArenaStage({ gameId, snapshot }: { gameId: number; snapshot: Snapshot }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<number[] | null>(null);
  const [inspect, setInspect] = useState<CardView | null>(null);
  const [hover, setHover] = useState<{ card: CardView; box: DOMRect } | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const asked = useRef(false);
  const boardRef = useRef<HTMLDivElement | null>(null);

  const waitingOnServer = snapshot.waiting === "opponent" || snapshot.waiting === "referee";

  // While the server is deciding, watch the row rather than the clock: Claude's
  // moves are committed as they are made, so they can be shown as they happen
  // instead of all at once when the request finally returns.
  const live = useLiveGame(gameId, snapshot, pending || waitingOnServer);
  const { view, legal, taps, log, spotlight, beats } = live;
  const playable = live.game.status === "playing";

  // Reduced motion is not a second code path: it simply never queues anything,
  // which is the same state the board reaches the instant you press Skip.
  const still = useReducedMotion();
  const playback = useBeatPlayer(beats, !still, boardRef);

  useWakeLock(playable && !view.over);

  // Only for arriving at a game that is already mid-turn — a normal move runs
  // the opponent's reply inside `act` itself.
  useEffect(() => {
    if (!waitingOnServer || asked.current) return;
    asked.current = true;
    startTransition(async () => {
      const r = await advanceGame(gameId);
      if (r.error) setError(r.error);
    });
  }, [waitingOnServer, gameId]);

  const send = (action: Action) => {
    setMenu(null);
    setSelected(null);
    setHover(null);
    setError(null);
    feel("tap");
    startTransition(async () => {
      const r = await act(gameId, action);
      if (r.error) {
        setError(r.error);
        feel("illegal");
      }
    });
  };

  const targetsOf = (id: string) => taps.attackTargets[id];
  const isTargeting = selected != null && !!targetsOf(selected);
  // While the story of the last turn is still being told, the board is a
  // picture rather than a control surface.
  const busy = pending || playback.playing;

  const tapCard = (id: string) => {
    if (!playable || busy) return;
    if (isTargeting) {
      const idx = targetsOf(selected!)?.[id];
      if (idx != null) return send(legal[idx].action);
      setSelected(null);
      return;
    }
    const options = taps.byCard[id];
    if (!options?.length) return;
    if (targetsOf(id)) return setSelected(id);
    if (options.length === 1) return send(legal[options[0]].action);
    setMenu(options);
  };

  const stateOf = (id: string): CardState => {
    if (isTargeting) return targetsOf(selected!)?.[id] != null ? "legal" : selected === id ? "selected" : "dim";
    if (view.battle?.attacker === id) return "attacker";
    if (view.battle?.guard === id) return "guard";
    if (!taps.byCard[id]?.length) return "plain";
    return busy ? "dim" : "legal";
  };

  const hoverOf = (c: CardView) => (box: DOMRect | null) => setHover(box ? { card: c, box } : null);

  const bare = taps.bare.map((i) => ({ i, l: legal[i] }));
  const modal = view.prompt.kind === "chooseMode";
  const yourTurn = view.prompt.player === view.you.player;
  const step = view.battle ? `battle:${view.battle.step}` : `phase:${view.phase}`;

  // After a few quiet seconds the cards that can be tapped say so. The clock
  // restarts on anything that changes what you could do, so it never nags.
  const idle = useIdle(4000, `${view.prompt.question}|${selected}|${busy}|${playback.playing}`);
  const nudging = idle && playable && yourTurn && !busy && !isTargeting;
  const choices = Object.keys(taps.byCard).length + bare.length;

  // The storyboard, driven by the beat on screen rather than by whatever a
  // re-render happens to notice. `docs/arena-ui-motion-spec.md` §7.
  const beat = playback.current;
  const mine = (id: string) => view.you.battle.some((c) => c.id === id) || view.you.leader?.id === id || view.you.unison?.id === id;
  const momentOf = (id: string): Moment | null => {
    if (!beat) return null;
    // Your side sits below theirs, so an attack of yours throws itself upward.
    if (beat.t === "attack" && beat.attacker === id) return mine(id) ? "lungeUp" : "lungeDown";
    if (beat.t === "clash" && beat.hit && beat.guard === id) return "hit";
    if (beat.t === "flip" && beat.card === id) return "awaken";
    if ((beat.t === "token" && beat.card === id) || (beat.t === "move" && beat.card === id)) return "arrive";
    return null;
  };
  const hurting = beat?.t === "damage" ? beat.player : null;

  const cardProps = (c: CardView) => ({
    card: c,
    state: stateOf(c.id),
    suppressed: playback.suppressed.has(c.id),
    nudge: nudging && !!taps.byCard[c.id]?.length,
    moment: momentOf(c.id),
    onTap: taps.byCard[c.id]?.length || isTargeting ? () => tapCard(c.id) : undefined,
    onInspect: () => setInspect(c),
    onHover: hoverOf(c),
  });

  return (
    <LayoutGroup>
      <div ref={boardRef} className="arena relative mx-auto flex w-full max-w-7xl flex-col gap-2 sm:gap-3">
        <StepBanner step={step} />
        <SkillSpotlight spotlight={spotlight} />
        <TopStrip view={view} />

        <div className="flex flex-col gap-2 lg:grid lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-start lg:gap-4">
          <SideRail side={view.them} them cardProps={cardProps} onHover={hoverOf} hurt={hurting === view.them.player} className="lg:col-start-3 lg:row-start-1" />

          <section className="arena-stage relative rounded-xl border border-space-700/70 p-2 sm:rounded-2xl sm:p-3 lg:col-start-2 lg:row-start-1 lg:p-4" aria-label="Battle Areas">
            <HandBacks count={view.them.handCount} />
            <BattleRow cards={view.them.battle} cardProps={cardProps} zone="p2:battle" label={`${view.them.name} has no Battle Cards`} />
            <ClashBand view={view} cardProps={cardProps} />
            <BattleRow cards={view.you.battle} cardProps={cardProps} zone="p1:battle" label="You have no Battle Cards" />
          </section>

          <SideRail side={view.you} cardProps={cardProps} onHover={hoverOf} hurt={hurting === view.you.player} className="lg:col-start-1 lg:row-start-1" />
        </div>

        {/* The prompt bar: the one question being asked, or the story being told. */}
        <section
          className={`sticky bottom-2 z-30 flex items-center gap-2 rounded-xl border p-2 pl-3 backdrop-blur sm:gap-3 sm:rounded-2xl sm:p-3 sm:pl-5 ${
            yourTurn && playable && !playback.playing ? "border-ki-500 bg-space-800/95 shadow-[0_0_0_3px_rgba(242,140,15,0.12)]" : "border-space-600 bg-space-800/95"
          }`}
          aria-live="polite"
        >
          {(waitingOnServer || busy) && !view.over && <span className="h-3.5 w-3.5 shrink-0 animate-pulse rounded-full bg-ki-400 shadow-[0_0_0_5px_rgba(255,167,51,0.18)]" aria-hidden />}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-space-50 sm:text-base lg:text-lg">
              {playback.playing
                ? `${view.them.name} is playing…`
                : view.over
                  ? view.over.winner
                    ? `${view.over.winner === view.you.player ? view.you.name : view.them.name} wins`
                    : "A draw"
                  : waitingOnServer
                    ? `${view.them.name} is thinking…`
                    : view.prompt.question}
            </p>
            <p className="mt-0.5 flex items-center gap-2 text-[11px] text-space-300 sm:text-sm">
              <span className="truncate">{view.over ? view.over.reason : (error ?? view.prompt.hint ?? "")}</span>
              {/* "What can I do?" answered as a number, before you have to look. */}
              {!view.over && !playback.playing && playable && yourTurn && choices > 0 && (
                <span className={`shrink-0 rounded-full border px-1.5 py-px text-[10px] tabular-nums ${nudging ? "border-ki-500/60 text-ki-300" : "border-space-600 text-space-400"}`}>
                  {choices} {choices === 1 ? "move" : "moves"}
                </span>
              )}
            </p>
          </div>

          {playback.playing && (
            <button type="button" onClick={playback.skip} className="tap shrink-0 rounded-lg border border-space-600 bg-space-700 px-3 py-2 text-sm font-semibold text-space-50 sm:px-5 sm:py-2.5">
              Skip
            </button>
          )}
          {!playback.playing && isTargeting && (
            <button type="button" onClick={() => setSelected(null)} className="tap shrink-0 rounded-lg border border-space-600 px-3 py-2 text-sm text-space-100 sm:px-5 sm:py-2.5 sm:text-base">
              Cancel
            </button>
          )}
          {!playback.playing &&
            !isTargeting &&
            playable &&
            !modal &&
            bare.slice(0, 3).map(({ i, l }) => (
              <button
                key={i}
                type="button"
                disabled={busy}
                onClick={() => send(l.action)}
                className={`tap shrink-0 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50 sm:rounded-xl sm:px-5 sm:py-2.5 sm:text-base ${
                  l.action.type === "endMain" || l.action.type === "pass" ? "border border-space-600 bg-space-700 text-space-50" : "bg-ki-500 text-space-950 hover:bg-ki-400"
                }`}
              >
                <span className="sm:hidden">{shortLabel(l.label)}</span>
                <span className="hidden sm:inline">{l.label}</span>
              </button>
            ))}
        </section>

        {playable && !playback.playing && !isTargeting && (modal || bare.length > 3) && (
          <div className="flex flex-wrap gap-1.5 sm:gap-2">
            {(modal ? bare : bare.slice(3)).map(({ i, l }) => (
              <button
                key={i}
                type="button"
                disabled={busy}
                onClick={() => send(l.action)}
                className="tap rounded-lg border border-space-600 bg-space-800 px-3 py-1.5 text-xs text-space-100 hover:border-ki-500/60 disabled:opacity-50 sm:px-4 sm:py-2 sm:text-sm"
              >
                {l.label}
              </button>
            ))}
          </div>
        )}

        <Hand
          cards={view.you.hand ?? []}
          count={view.you.handCount}
          name={view.you.name}
          cardProps={cardProps}
          controls={
            <>
              <FeelToggle />
              <ReportBug gameId={gameId} cards={cardsOnTable(view)} />
              <button type="button" onClick={() => setLogOpen((x) => !x)} className="tap uppercase tracking-widest text-ki-300 hover:text-ki-400">
                {logOpen ? "hide log" : "log"}
              </button>
            </>
          }
        >
          {/* The log no longer replaces the hand: you can read what just
              happened and look at your cards at the same time. */}
          {logOpen && (
            <ol className="mb-2 max-h-40 space-y-0.5 overflow-y-auto font-mono text-[10px] leading-relaxed text-space-400 sm:max-h-56 sm:text-xs">
              {log.slice(-80).map((line, i) => (
                <li key={i} className={line.startsWith("—") ? "mt-1 text-space-200" : ""}>
                  {line}
                </li>
              ))}
              {log.length === 0 && <li>nothing has happened yet</li>}
            </ol>
          )}
        </Hand>

        {view.battle && <AttackBeam from={view.battle.attacker} to={view.battle.guard} hostRef={boardRef} />}

        <Ghosts ghosts={playback.ghosts} art={beats?.art ?? {}} />

        {hover && !menu && !inspect && <CardPreview card={hover.card} box={hover.box} />}

        {menu && (
          <Sheet onClose={() => setMenu(null)} title="What would you like to do?">
            {menu.map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => send(legal[i].action)}
                className="tap w-full rounded-lg border border-space-600 bg-space-800 px-3 py-2 text-left text-sm text-space-50 hover:border-ki-500/60 sm:px-4 sm:py-3 sm:text-base"
              >
                {legal[i].label}
              </button>
            ))}
          </Sheet>
        )}

        {inspect && (
          <Sheet onClose={() => setInspect(null)} title={inspect.name}>
            <CardDetail card={inspect} />
          </Sheet>
        )}
      </div>
    </LayoutGroup>
  );
}

type CardProps = (c: CardView) => {
  card: CardView;
  state: CardState;
  suppressed: boolean;
  onTap: (() => void) | undefined;
  onInspect: () => void;
  onHover: (box: DOMRect | null) => void;
};

/** One player's Battle Area. The row keeps its height so the board never jumps. */
function BattleRow({ cards, cardProps, zone, label }: { cards: CardView[]; cardProps: CardProps; zone: string; label: string }) {
  return (
    <div className="relative flex min-h-[calc(78px*var(--arena,1))] items-center gap-1.5 overflow-x-auto [justify-content:safe_center] sm:gap-2 lg:gap-3">
      <ZoneAnchor zone={zone} />
      {cards.map((c) => (
        <StageCard key={c.id} {...cardProps(c)} width={52} />
      ))}
      {cards.length === 0 && (
        <div className="flex items-center gap-2" aria-label={label}>
          {Array.from({ length: 3 }, (_, i) => (
            <span key={i} className="arena-slot" style={{ width: `calc(52px * var(--arena, 1))`, height: `calc(73px * var(--arena, 1))` }} />
          ))}
        </div>
      )}
    </div>
  );
}

/** The middle of the stage: the power figures, both Combo Areas, or a quiet line. */
function ClashBand({ view, cardProps }: { view: BoardView; cardProps: CardProps }) {
  const b = view.battle;
  if (!b) {
    return (
      <div className="my-2 flex items-center gap-3 sm:my-3">
        <span className="h-px flex-1 bg-gradient-to-r from-transparent to-space-700" />
        <span className="text-[10px] uppercase tracking-[0.25em] text-space-600 sm:text-xs">
          turn {view.turn} · {view.turnPlayer === view.you.player ? "you" : view.them.name}
        </span>
        <span className="h-px flex-1 bg-gradient-to-l from-transparent to-space-700" />
      </div>
    );
  }
  const winning = b.attackPower >= b.guardPower;
  return (
    <div className="my-2 rounded-xl border border-ki-500/35 bg-gradient-to-b from-ki-500/10 to-transparent p-2 sm:my-3 sm:p-3">
      <div className="flex items-center justify-center gap-3 font-mono sm:gap-6">
        <Count value={b.attackPower} className={`text-2xl font-black tabular-nums sm:text-4xl lg:text-5xl ${winning ? "text-ki-300 drop-shadow-[0_0_12px_rgba(255,167,51,0.5)]" : "text-space-400"}`} />
        <span className="text-[10px] font-bold tracking-[0.3em] text-space-500 sm:text-xs">VS</span>
        <Count value={b.guardPower} className={`text-2xl font-black tabular-nums sm:text-4xl lg:text-5xl ${!winning ? "text-ki-300 drop-shadow-[0_0_12px_rgba(255,167,51,0.5)]" : "text-space-400"}`} />
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

/**
 * A power figure that climbs to its new value.
 *
 * A combo card is worth counting *up* to: the number is the whole reason you
 * played it, and swapping 25,000 for 30,000 between two renders is the one
 * moment on this board where the arithmetic is the drama.
 */
function Count({ value, className }: { value: number; className?: string }) {
  const shown = useMotionValue(value);
  const text = useTransform(shown, (v) => Math.round(v).toLocaleString("en"));
  useEffect(() => {
    const run = animate(shown, value, { duration: 0.25, ease: "easeOut" });
    return () => run.stop();
  }, [shown, value]);
  return <motion.span className={className}>{text}</motion.span>;
}

/** The opponent's hand: a count, fanned, peeking over the top of the stage. */
function HandBacks({ count }: { count: number }) {
  const shown = Math.min(count, 10);
  return (
    <div className="relative mb-1 flex items-start justify-center sm:mb-2" aria-label={`${count} cards in hand`}>
      <ZoneAnchor zone="p2:hand" />
      {Array.from({ length: shown }, (_, i) => (
        <span
          key={i}
          className="-ml-1.5 h-[calc(24px*var(--arena,1))] w-[calc(22px*var(--arena,1))] rounded-b-[3px] border border-space-500 bg-[radial-gradient(circle_at_50%_135%,#f28c0f_0_14%,#20273c_15%_60%,#0f1220_61%)] shadow-[0_2px_6px_rgba(0,0,0,0.5)] first:ml-0"
          style={{ transform: `rotate(${(i - (shown - 1) / 2) * 2.5}deg)` }}
        />
      ))}
      {count === 0 && <span className="text-[10px] uppercase tracking-widest text-space-600">empty hand</span>}
    </div>
  );
}

/** A player's own corner of the table, with an anchor on every pile. */
function SideRail({
  side,
  them = false,
  cardProps,
  onHover,
  hurt = false,
  className = "",
}: {
  side: SideView;
  them?: boolean;
  cardProps: CardProps;
  onHover: (c: CardView) => (box: DOMRect | null) => void;
  /** This player is taking damage right now. */
  hurt?: boolean;
  className?: string;
}) {
  const spent = side.energy.length - side.activeEnergy;
  const p = side.player;
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
        {side.leader && <StageCard {...cardProps(side.leader)} width={56} />}
        {side.unison && <StageCard {...cardProps(side.unison)} width={48} />}
      </div>

      <div className="relative min-w-0 lg:text-center">
        <ZoneAnchor zone={`${p}:life`} />
        <p className="truncate text-xs font-semibold text-space-100 sm:text-sm">{side.name}</p>
        <div className="flex items-baseline gap-1.5 lg:justify-center">
          <span className={`font-mono text-3xl font-black leading-none tabular-nums sm:text-4xl ${side.life <= 2 ? "text-loss" : "text-space-50"}`}>{side.life}</span>
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
              <StageCard key={c.id} card={c} width={22} suppressed={cardProps(c).suppressed} onHover={onHover(c)} />
            ))}
          </div>
        )}
      </div>

      <dl className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-space-400 sm:text-xs lg:justify-center">
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

      <div className="relative ml-auto min-w-0 lg:ml-0">
        <ZoneAnchor zone={`${p}:energy`} />
        <div className="flex items-baseline gap-1 lg:justify-center">
          <span className="font-mono text-base font-bold text-ki-300 sm:text-lg">
            {side.activeEnergy}
            <span className="text-space-500">/{side.energy.length}</span>
          </span>
          <span className="text-[10px] uppercase tracking-widest text-space-500">energy</span>
          {side.energyMarkers > 0 && <span className="rounded bg-ki-500/20 px-1 font-mono text-[10px] text-ki-300">+{side.energyMarkers}</span>}
        </div>
        <div className="mt-1 flex flex-wrap gap-[2px] lg:justify-center">
          {side.energy.map((c) => (
            <StageCard key={c.id} card={c} width={22} upsideDown suppressed={cardProps(c).suppressed} onHover={onHover(c)} />
          ))}
          {side.energy.length === 0 && <span className="text-[10px] text-space-600">none charged</span>}
        </div>
        {spent > 0 && <p className="mt-0.5 text-[10px] text-space-500 lg:text-center">{spent} rested</p>}
      </div>
    </aside>
  );
}
