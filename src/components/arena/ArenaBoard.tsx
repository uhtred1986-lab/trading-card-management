"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { act, advanceGame } from "@/app/arena/actions";
import { feel } from "@/lib/arena/feel";
import { useWakeLock } from "@/lib/arena/wake";
import { FeelToggle } from "./FeelToggle";
import { ReportBug } from "./ReportBug";
import type { Action, LegalAction } from "@/lib/arena/engine";
import type { Spotlight } from "@/lib/arena/games";
import type { BoardView, CardView, SideView, Tappable } from "@/lib/arena/view";
import { ArenaCard, type CardState } from "./ArenaCard";
import { AttackBeam, CardDetail, CardPreview, Counter, Sheet, SkillSpotlight, StepBanner, TopStrip, cardsOnTable, shortLabel } from "./shared";

/**
 * The board, laid out the way a digital card game lays one out: the two Battle
 * Areas face each other across a stage in the middle, each player's Leader
 * anchored at their own side of the table with their life beside it, and the
 * counters that are only occasionally interesting pushed out to the corners.
 * A phone gets the same pieces stacked; `--arena` (globals.css) scales the
 * cards so a laptop gets a table rather than a strip.
 *
 * Everything it can do comes from the engine's list of legal moves, so the UI
 * never has to know a rule. Tapping a card with one legal move takes it; a
 * card with several opens a short menu; an attacker asks for its target next.
 */
export function ArenaBoard({
  gameId,
  view,
  legal,
  taps,
  log,
  spotlight,
  playable,
  waitingOnServer,
}: {
  gameId: number;
  view: BoardView;
  legal: LegalAction[];
  taps: Tappable;
  log: string[];
  /** The skill that fired on the last action, with the art already resolved. */
  spotlight: (Spotlight & { imageUrl: string | null }) | null;
  /** False for a finished or abandoned game: the board is then read-only. */
  playable: boolean;
  /**
   * True when the next decision is Claude's, or a card's text has gone to the
   * referee. The page fires the server on load so a reload mid-turn recovers.
   */
  waitingOnServer: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const asked = useRef(false);
  const boardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!waitingOnServer || asked.current) return;
    asked.current = true;
    startTransition(async () => {
      const r = await advanceGame(gameId);
      if (r.error) setError(r.error);
    });
  }, [waitingOnServer, gameId]);
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<number[] | null>(null);
  const [inspect, setInspect] = useState<CardView | null>(null);
  const [hover, setHover] = useState<{ card: CardView; box: DOMRect } | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  // A game holds the screen awake: a Tournament turn can take Claude most of a
  // minute, and nobody touches the phone while it thinks.
  useWakeLock(playable && !view.over);

  const send = (action: Action) => {
    setMenu(null);
    setSelected(null);
    setHover(null);
    setError(null);
    // The tap is answered on the frame it happens, even though the move itself
    // is a server round-trip away.
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

  const tapCard = (id: string) => {
    if (!playable || pending) return;
    // Second tap of an attack: this card is the target.
    if (isTargeting) {
      const idx = targetsOf(selected!)?.[id];
      if (idx != null) return send(legal[idx].action);
      setSelected(null);
      return;
    }
    const options = taps.byCard[id];
    if (!options?.length) return;
    if (targetsOf(id)) {
      setSelected(id);
      return;
    }
    if (options.length === 1) return send(legal[options[0]].action);
    setMenu(options);
  };

  const stateOf = (id: string): CardState => {
    if (isTargeting) return targetsOf(selected!)?.[id] != null ? "legal" : selected === id ? "selected" : "dim";
    if (view.battle?.attacker === id) return "attacker";
    if (view.battle?.guard === id) return "guard";
    if (!taps.byCard[id]?.length) return "plain";
    // A tappable card still no-ops mid-request (tapCard bails on `pending`);
    // dimming it here is what tells a second tap it was seen and ignored,
    // rather than looking like the first tap never registered.
    return pending ? "dim" : "legal";
  };

  /** A mouse over any card anywhere on the board opens the same preview. */
  const hoverOf = (c: CardView) => (box: DOMRect | null) => setHover(box ? { card: c, box } : null);

  const cardProps = (c: CardView) => ({
    card: c,
    state: stateOf(c.id),
    onTap: taps.byCard[c.id]?.length || isTargeting ? () => tapCard(c.id) : undefined,
    onInspect: () => setInspect(c),
    onHover: hoverOf(c),
  });

  const bare = taps.bare.map((i) => ({ i, l: legal[i] }));
  // A "Choose one—" is a sentence per option (20-2); shortened to fit a
  // button they would read the same, so they get the full-width row below.
  const modal = view.prompt.kind === "chooseMode";
  const yourTurn = view.prompt.player === view.you.player;
  const step = view.battle ? `battle:${view.battle.step}` : `phase:${view.phase}`;

  // The two moments worth feeling without having asked for them: an attack
  // landing, and the game ending. Skipped on the first paint, like the step
  // banner, so a reload does not buzz at something that happened minutes ago.
  const lastFelt = useRef<string | null>(null);
  useEffect(() => {
    const key = view.over ? `over:${view.over.winner ?? "draw"}` : step;
    if (lastFelt.current === key) return;
    const first = lastFelt.current === null;
    lastFelt.current = key;
    if (first) return;
    if (view.over) {
      if (view.over.winner) feel(view.over.winner === view.you.player ? "win" : "loss");
      return;
    }
    if (step === "battle:damage") feel("impact");
  }, [step, view.over, view.you.player]);

  return (
    <div ref={boardRef} className="arena relative mx-auto flex w-full max-w-7xl flex-col gap-2 sm:gap-3">
      <StepBanner step={step} />
      <SkillSpotlight spotlight={spotlight} />
      <TopStrip view={view} />

      {/* Your Leader, the stage, their Leader. Stacked on a phone, in that order. */}
      <div className="flex flex-col gap-2 lg:grid lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-start lg:gap-4">
        <SidePanel side={view.them} them cardProps={cardProps} onHover={hoverOf} className="lg:col-start-3 lg:row-start-1" />

        <section className="arena-stage relative rounded-xl border border-space-700/70 p-2 sm:rounded-2xl sm:p-3 lg:col-start-2 lg:row-start-1 lg:p-4" aria-label="Battle Areas">
          <HandBacks count={view.them.handCount} />

          {/* Both Battle Areas are drawn at the same size: they face each other. */}
          <BattleRow cards={view.them.battle} cardProps={cardProps} width={52} label={`${view.them.name} has no Battle Cards`} />

          <ClashBand view={view} onInspect={setInspect} onHover={hoverOf} />

          <BattleRow cards={view.you.battle} cardProps={cardProps} width={52} label="You have no Battle Cards" />
        </section>

        <SidePanel side={view.you} cardProps={cardProps} onHover={hoverOf} className="lg:col-start-1 lg:row-start-1" />
      </div>

      {/* The prompt bar: the one question being asked. */}
      <section
        // The game route is full-bleed (`AppShell`), so there is no tab bar
        // left to clear and the bar sits at the bottom edge on every size.
        className={`sticky bottom-2 z-30 flex items-center gap-2 rounded-xl border p-2 pl-3 backdrop-blur sm:gap-3 sm:rounded-2xl sm:p-3 sm:pl-5 ${
          yourTurn && playable ? "border-ki-500 bg-space-800/95 shadow-[0_0_0_3px_rgba(242,140,15,0.12)]" : "border-space-600 bg-space-800/95"
        }`}
        aria-live="polite"
      >
        {(waitingOnServer || pending) && !view.over && <span className="h-3.5 w-3.5 shrink-0 animate-pulse rounded-full bg-ki-400 shadow-[0_0_0_5px_rgba(255,167,51,0.18)]" aria-hidden />}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-space-50 sm:text-base lg:text-lg">
            {view.over
              ? view.over.winner
                ? `${view.over.winner === view.you.player ? view.you.name : view.them.name} wins`
                : "A draw"
              : waitingOnServer
                ? `${view.them.name} is thinking…`
                : view.prompt.question}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-space-300 sm:text-sm">{view.over ? view.over.reason : (error ?? view.prompt.hint ?? "")}</p>
        </div>
        {isTargeting && (
          <button type="button" onClick={() => setSelected(null)} className="tap rounded-lg border border-space-600 px-3 py-2 text-sm text-space-100 sm:px-5 sm:py-2.5 sm:text-base">
            Back
          </button>
        )}
        {!isTargeting &&
          playable &&
          !modal &&
          bare.slice(0, 3).map(({ i, l }) => (
            <button
              key={i}
              type="button"
              disabled={pending}
              onClick={() => send(l.action)}
              className={`tap shrink-0 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50 sm:rounded-xl sm:px-5 sm:py-2.5 sm:text-base ${
                l.action.type === "endMain" || l.action.type === "pass" ? "border border-space-600 bg-space-700 text-space-50" : "bg-ki-500 text-space-950 hover:bg-ki-400"
              }`}
            >
              {/* A phone has room for the short label only; a laptop gets the whole sentence. */}
              <span className="sm:hidden">{shortLabel(l.label)}</span>
              <span className="hidden sm:inline">{l.label}</span>
            </button>
          ))}
      </section>

      {/* Everything the prompt accepts that is not a card tap. */}
      {playable && !isTargeting && (modal || bare.length > 3) && (
        <div className="flex flex-wrap gap-1.5 sm:gap-2">
          {(modal ? bare : bare.slice(3)).map(({ i, l }) => (
            <button
              key={i}
              type="button"
              disabled={pending}
              onClick={() => send(l.action)}
              className="tap rounded-lg border border-space-600 bg-space-800 px-3 py-1.5 text-xs text-space-100 hover:border-ki-500/60 disabled:opacity-50 sm:px-4 sm:py-2 sm:text-sm"
            >
              {l.label}
            </button>
          ))}
        </div>
      )}

      {/* Your hand, along the bottom edge. */}
      <section className="rounded-t-2xl border-t border-space-700 bg-space-900/95 p-2 pb-3 sm:rounded-2xl sm:border sm:border-space-700/70 sm:p-3" aria-label="Your hand">
        <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-widest text-space-400 sm:mb-2 sm:text-xs">
          <span>
            {view.you.name} · hand {view.you.handCount}
          </span>
          <div className="flex items-center gap-3 normal-case tracking-normal">
            <FeelToggle />
            <ReportBug gameId={gameId} cards={cardsOnTable(view)} />
            <button type="button" onClick={() => setLogOpen((x) => !x)} className="tap uppercase tracking-widest text-ki-300 hover:text-ki-400">
              {logOpen ? "hide log" : "log"}
            </button>
          </div>
        </div>
        {logOpen ? (
          <ol className="max-h-56 space-y-0.5 overflow-y-auto font-mono text-[10px] leading-relaxed text-space-400 sm:max-h-80 sm:text-xs">
            {log.slice(-80).map((line, i) => (
              <li key={i} className={line.startsWith("—") ? "mt-1 text-space-200" : ""}>
                {line}
              </li>
            ))}
            {log.length === 0 && <li>nothing has happened yet</li>}
          </ol>
        ) : (
          // `safe center` centres a short hand but falls back to the start once
          // it overflows — plain centring makes the first cards unreachable,
          // because overflow to the left cannot be scrolled to.
          <div className="flex gap-1 overflow-x-auto pb-1 sm:gap-2 sm:[justify-content:safe_center] lg:gap-3">
            {(view.you.hand ?? []).map((c) => (
              // The lift is what makes a hand feel like cards rather than a filmstrip.
              <div key={c.id} className="transition-transform duration-200 hover:-translate-y-2">
                <ArenaCard {...cardProps(c)} width={62} />
              </div>
            ))}
            {(view.you.hand ?? []).length === 0 && <span className="py-4 text-xs text-space-500 sm:text-sm">no cards in hand</span>}
          </div>
        )}
      </section>

      {/* The attack, drawn from the attacker to whatever it is hitting. */}
      {view.battle && <AttackBeam from={view.battle.attacker} to={view.battle.guard} hostRef={boardRef} />}

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
  );
}

type CardProps = (c: CardView) => {
  card: CardView;
  state: CardState;
  onTap: (() => void) | undefined;
  onInspect: () => void;
  onHover: (box: DOMRect | null) => void;
};

/**
 * One player's Battle Area, centred so the two rows face each other. An empty
 * row keeps its height — a board that collapses and re-expands is unreadable.
 */
function BattleRow({ cards, cardProps, width, label }: { cards: CardView[]; cardProps: CardProps; width: number; label: string }) {
  return (
    <div className="flex min-h-[calc(78px*var(--arena,1))] items-center gap-1.5 overflow-x-auto [justify-content:safe_center] sm:gap-2 lg:gap-3">
      {cards.map((c) => (
        <ArenaCard key={c.id} {...cardProps(c)} width={width} drop />
      ))}
      {cards.length === 0 && (
        <div className="flex items-center gap-2" aria-label={label}>
          {Array.from({ length: 3 }, (_, i) => (
            <span key={i} className="arena-slot" style={{ width: `calc(${width}px * var(--arena, 1))`, height: `calc(${Math.round((width * 88) / 63)}px * var(--arena, 1))` }} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The middle of the stage: the power figures while a battle is on, both Combo
 * Areas, and otherwise a quiet line saying whose turn it is.
 */
function ClashBand({ view, onInspect, onHover }: { view: BoardView; onInspect: (c: CardView) => void; onHover: (c: CardView) => (box: DOMRect | null) => void }) {
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
      <div key={`${b.attackPower}-${b.guardPower}`} className="arena-slam flex items-center justify-center gap-3 font-mono sm:gap-6">
        <span className={`text-2xl font-black tabular-nums sm:text-4xl lg:text-5xl ${winning ? "text-ki-300 drop-shadow-[0_0_12px_rgba(255,167,51,0.5)]" : "text-space-400"}`}>
          {b.attackPower.toLocaleString("en")}
        </span>
        <span className="text-[10px] font-bold tracking-[0.3em] text-space-500 sm:text-xs">VS</span>
        <span className={`text-2xl font-black tabular-nums sm:text-4xl lg:text-5xl ${!winning ? "text-ki-300 drop-shadow-[0_0_12px_rgba(255,167,51,0.5)]" : "text-space-400"}`}>
          {b.guardPower.toLocaleString("en")}
        </span>
      </div>
      {(view.them.combo.length > 0 || view.you.combo.length > 0) && (
        <div className="mt-2 flex items-end justify-between">
          <div className="flex items-end gap-1 sm:gap-2">
            <span className="self-center text-[10px] uppercase tracking-wider text-space-500 sm:text-xs">{view.them.name}</span>
            {view.them.combo.map((c) => (
              <ArenaCard key={c.id} card={c} width={32} onInspect={() => onInspect(c)} onHover={onHover(c)} />
            ))}
          </div>
          <div className="flex items-end gap-1 sm:gap-2">
            {view.you.combo.map((c) => (
              <ArenaCard key={c.id} card={c} width={32} onInspect={() => onInspect(c)} onHover={onHover(c)} />
            ))}
            <span className="self-center text-[10px] uppercase tracking-wider text-space-500 sm:text-xs">you</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** The opponent's hand: a count, fanned, peeking over the top of the stage. */
function HandBacks({ count }: { count: number }) {
  const shown = Math.min(count, 10);
  return (
    <div className="mb-1 flex items-start justify-center sm:mb-2" aria-label={`${count} cards in hand`}>
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

/**
 * A player's own corner of the table: Leader and Unison, life as a figure you
 * can read across the room, the counters, and the energy that pays for it all.
 * A column beside the stage on a laptop, a strip above or below it on a phone.
 */
function SidePanel({
  side,
  them = false,
  cardProps,
  onHover,
  className = "",
}: {
  side: SideView;
  them?: boolean;
  cardProps: CardProps;
  onHover: (c: CardView) => (box: DOMRect | null) => void;
  className?: string;
}) {
  const spent = side.energy.length - side.activeEnergy;
  return (
    <aside
      className={`flex items-center gap-3 rounded-xl border border-space-700/70 bg-space-900/60 p-2 sm:rounded-2xl sm:p-3 lg:w-44 lg:flex-col lg:items-stretch lg:gap-3 xl:w-52 ${className}`}
      aria-label={them ? `${side.name}'s side` : "Your side"}
    >
      <div className="flex shrink-0 items-end gap-1.5 lg:justify-center">
        {side.leader && <ArenaCard {...cardProps(side.leader)} width={56} />}
        {side.unison && <ArenaCard {...cardProps(side.unison)} width={48} />}
      </div>

      <div className="min-w-0 lg:text-center">
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
      </div>

      <dl className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-space-400 sm:text-xs lg:justify-center">
        <Counter label="deck" value={side.deck} />
        <Counter label="drop" value={side.drop} />
        {side.zDeck > 0 && <Counter label="Z" value={side.zDeck} />}
        {side.zEnergy > 0 && <Counter label="Z energy" value={side.zEnergy} />}
        {side.warp > 0 && <Counter label="warp" value={side.warp} />}
      </dl>

      <div className="ml-auto min-w-0 lg:ml-0">
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
            <ArenaCard key={c.id} card={c} width={22} upsideDown onHover={onHover(c)} />
          ))}
          {side.energy.length === 0 && <span className="text-[10px] text-space-600">none charged</span>}
        </div>
        {spent > 0 && <p className="mt-0.5 text-[10px] text-space-500 lg:text-center">{spent} rested</p>}
      </div>
    </aside>
  );
}

