"use client";

import { useState, useTransition } from "react";
import { act } from "@/app/arena/actions";
import type { Action, LegalAction } from "@/lib/arena/engine";
import type { BoardView, CardView, SideView, Tappable } from "@/lib/arena/view";
import { ArenaCard, type CardState } from "./ArenaCard";

/**
 * The board, phone first: the opponent compressed at the top, the middle band
 * as the stage where a battle plays out, your side full size, one prompt bar
 * that asks the only question there is, and the hand as a sheet at the bottom.
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
  playable,
}: {
  gameId: number;
  view: BoardView;
  legal: LegalAction[];
  taps: Tappable;
  log: string[];
  /** False for a finished or abandoned game: the board is then read-only. */
  playable: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<number[] | null>(null);
  const [inspect, setInspect] = useState<CardView | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  const send = (action: Action) => {
    setMenu(null);
    setSelected(null);
    setError(null);
    startTransition(async () => {
      const r = await act(gameId, action);
      if (r.error) setError(r.error);
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
    if (taps.byCard[id]?.length) return "legal";
    return "plain";
  };

  const cardProps = (c: CardView) => ({
    card: c,
    state: stateOf(c.id),
    onTap: taps.byCard[c.id]?.length || isTargeting ? () => tapCard(c.id) : undefined,
    onInspect: () => setInspect(c),
  });

  const bare = taps.bare.map((i) => ({ i, l: legal[i] }));
  const yourTurn = view.prompt.player === view.you.player;

  return (
    <div className="relative flex min-h-[calc(100dvh-8rem)] flex-col gap-2">
      <PhaseStrip view={view} />

      {/* The opponent's side, compressed. */}
      <section className="rounded-xl border border-space-700/70 bg-space-900/60 p-2" aria-label={`${view.them.name}'s side`}>
        <SideSummary side={view.them} them />
        <div className="mt-2 flex items-end gap-1.5 overflow-x-auto pb-1">
          {view.them.leader && <ArenaCard {...cardProps(view.them.leader)} width={44} />}
          {view.them.unison && <ArenaCard {...cardProps(view.them.unison)} width={40} />}
          <span className="w-1" />
          {view.them.battle.map((c) => (
            <ArenaCard key={c.id} {...cardProps(c)} width={40} />
          ))}
          {view.them.battle.length === 0 && <span className="self-center text-[10px] text-space-500">no Battle Cards</span>}
          <span className="ml-auto flex gap-[2px] self-center">
            {Array.from({ length: Math.min(view.them.handCount, 8) }, (_, i) => (
              <span key={i} className="h-8 w-[18px] rounded-[2px] border border-space-600 bg-[radial-gradient(circle_at_50%_50%,#f28c0f_0_10%,#0f1220_11%)]" />
            ))}
          </span>
        </div>
        <EnergyRow side={view.them} small />
      </section>

      {/* The middle band: both Combo Areas and the power figures during a battle. */}
      {view.battle ? (
        <section className="rounded-xl border border-ki-500/35 bg-gradient-to-b from-ki-500/10 to-transparent p-2" aria-label="Battle">
          <div className="flex items-baseline justify-center gap-3 font-mono">
            <span className={`text-xl font-bold ${view.battle.attackPower >= view.battle.guardPower ? "text-ki-300" : "text-space-300"}`}>{view.battle.attackPower.toLocaleString("en")}</span>
            <span className="text-[10px] tracking-widest text-space-500">VS</span>
            <span className={`text-lg ${view.battle.guardPower > view.battle.attackPower ? "text-ki-300" : "text-space-300"}`}>{view.battle.guardPower.toLocaleString("en")}</span>
          </div>
          <div className="mt-1 flex items-end justify-between">
            <div className="flex items-end gap-1">
              <span className="self-center text-[9px] uppercase tracking-wider text-space-500">{view.them.name}</span>
              {view.them.combo.map((c) => (
                <ArenaCard key={c.id} card={c} width={32} onInspect={() => setInspect(c)} />
              ))}
            </div>
            <div className="flex items-end gap-1">
              {view.you.combo.map((c) => (
                <ArenaCard key={c.id} card={c} width={32} onInspect={() => setInspect(c)} />
              ))}
              <span className="self-center text-[9px] uppercase tracking-wider text-space-500">you</span>
            </div>
          </div>
        </section>
      ) : (
        <div className="h-px bg-gradient-to-r from-transparent via-space-700 to-transparent" />
      )}

      {/* Your side. */}
      <section className="rounded-xl border border-space-700/70 bg-space-900/60 p-2" aria-label="Your side">
        <div className="flex items-end gap-1.5 overflow-x-auto pb-1">
          {view.you.leader && <ArenaCard {...cardProps(view.you.leader)} width={54} />}
          {view.you.unison && <ArenaCard {...cardProps(view.you.unison)} width={48} />}
          <span className="w-1" />
          {view.you.battle.map((c) => (
            <ArenaCard key={c.id} {...cardProps(c)} width={48} />
          ))}
          {view.you.battle.length === 0 && <span className="self-center text-[10px] text-space-500">no Battle Cards</span>}
        </div>
        <SideSummary side={view.you} />
        <EnergyRow side={view.you} />
      </section>

      {/* The prompt bar: the one question being asked. */}
      <section
        className={`sticky bottom-[4.5rem] z-10 flex items-center gap-2 rounded-xl border p-2 pl-3 backdrop-blur sm:bottom-2 ${
          yourTurn && playable ? "border-ki-500 bg-space-800/95 shadow-[0_0_0_3px_rgba(242,140,15,0.12)]" : "border-space-600 bg-space-800/95"
        }`}
        aria-live="polite"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-space-50">
            {view.over ? (view.over.winner ? `${view.over.winner === view.you.player ? view.you.name : view.them.name} wins` : "A draw") : view.prompt.question}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-space-300">{view.over ? view.over.reason : (error ?? view.prompt.hint ?? "")}</p>
        </div>
        {isTargeting && (
          <button type="button" onClick={() => setSelected(null)} className="tap rounded-lg border border-space-600 px-3 py-2 text-sm text-space-100">
            Back
          </button>
        )}
        {!isTargeting &&
          playable &&
          bare.slice(0, 3).map(({ i, l }) => (
            <button
              key={i}
              type="button"
              disabled={pending}
              onClick={() => send(l.action)}
              className={`tap rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50 ${
                l.action.type === "endMain" || l.action.type === "pass" ? "border border-space-600 bg-space-700 text-space-50" : "bg-ki-500 text-space-950"
              }`}
            >
              {shortLabel(l.label)}
            </button>
          ))}
      </section>

      {/* Everything the prompt accepts that is not a card tap. */}
      {playable && !isTargeting && bare.length > 3 && (
        <div className="flex flex-wrap gap-1.5">
          {bare.slice(3).map(({ i, l }) => (
            <button
              key={i}
              type="button"
              disabled={pending}
              onClick={() => send(l.action)}
              className="tap rounded-lg border border-space-600 bg-space-800 px-3 py-1.5 text-xs text-space-100 disabled:opacity-50"
            >
              {l.label}
            </button>
          ))}
        </div>
      )}

      {/* Your hand. */}
      <section className="rounded-t-2xl border-t border-space-700 bg-space-900/95 p-2 pb-3" aria-label="Your hand">
        <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-widest text-space-400">
          <span>
            {view.you.name} · hand {view.you.handCount}
          </span>
          <button type="button" onClick={() => setLogOpen((x) => !x)} className="tap text-ki-300">
            {logOpen ? "hide log" : "log"}
          </button>
        </div>
        {logOpen ? (
          <ol className="max-h-56 space-y-0.5 overflow-y-auto font-mono text-[10px] leading-relaxed text-space-400">
            {log.slice(-80).map((line, i) => (
              <li key={i} className={line.startsWith("—") ? "mt-1 text-space-200" : ""}>
                {line}
              </li>
            ))}
            {log.length === 0 && <li>nothing has happened yet</li>}
          </ol>
        ) : (
          <div className="flex gap-1 overflow-x-auto pb-1">
            {(view.you.hand ?? []).map((c) => (
              <ArenaCard key={c.id} {...cardProps(c)} width={62} />
            ))}
            {(view.you.hand ?? []).length === 0 && <span className="py-4 text-xs text-space-500">no cards in hand</span>}
          </div>
        )}
      </section>

      {menu && (
        <Sheet onClose={() => setMenu(null)} title="What would you like to do?">
          {menu.map((i) => (
            <button
              key={i}
              type="button"
              onClick={() => send(legal[i].action)}
              className="tap w-full rounded-lg border border-space-600 bg-space-800 px-3 py-2 text-left text-sm text-space-50"
            >
              {legal[i].label}
            </button>
          ))}
        </Sheet>
      )}

      {inspect && (
        <Sheet onClose={() => setInspect(null)} title={inspect.name}>
          <p className="text-[11px] text-space-400">
            {inspect.cardId}
            {inspect.cost ? ` · cost ${inspect.cost}` : ""}
            {inspect.power != null ? ` · ${inspect.power.toLocaleString("en")} power` : ""}
            {inspect.comboPower != null ? ` · combo +${inspect.comboPower.toLocaleString("en")} for ${inspect.comboCost}` : ""}
          </p>
          {inspect.keywords.length > 0 && <p className="text-[11px] text-ki-300">{inspect.keywords.join(" · ")}</p>}
          {inspect.text && <p className="whitespace-pre-wrap text-xs leading-relaxed text-space-200">{inspect.text.replace(/<br\s*\/?>/gi, "\n")}</p>}
          <div className={`rounded-lg border-l-2 p-2 text-[11px] ${inspect.referee ? "border-dbs-yellow bg-space-800" : "border-gain bg-space-800"}`}>
            <span className="font-semibold text-space-100">{inspect.referee ? "Not fully compiled. " : "Engine reads: "}</span>
            <span className="text-space-300">
              {inspect.referee ? "Claude rules on this card's remaining text when it resolves." : inspect.reading || "no effect of its own"}
            </span>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function shortLabel(label: string): string {
  return label.replace(/^Don't /, "No ").replace(/ \(the skill does not resolve\)$/, "").slice(0, 22);
}

function PhaseStrip({ view }: { view: BoardView }) {
  const steps = ["charge", "main", "end"];
  const battleSteps = ["declared", "offense", "defense", "damage"];
  return (
    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-space-500">
      {steps.map((p) => (
        <span key={p} className={view.phase === p || (p === "main" && view.phase === "mainEnd") ? "font-bold text-ki-400" : ""}>
          {p}
        </span>
      ))}
      {view.battle && (
        <>
          <span className="mx-1 h-3 w-px bg-space-600" />
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

function SideSummary({ side, them = false }: { side: SideView; them?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-space-400">
      {them && <span className="font-semibold text-space-100">{side.name}</span>}
      <span className="flex items-center gap-1">
        life
        <span className="flex gap-[2px]">
          {Array.from({ length: 8 }, (_, i) => (
            <i key={i} className={`h-3 w-[5px] rounded-[1px] ${i < side.life ? "bg-gain" : "bg-space-700"}`} />
          ))}
        </span>
      </span>
      <span>
        deck <b className="text-space-200">{side.deck}</b>
      </span>
      <span>
        drop <b className="text-space-200">{side.drop}</b>
      </span>
      {side.zDeck + side.zEnergy > 0 && (
        <span>
          Z <b className="text-space-200">{side.zDeck}</b>
          {side.zEnergy > 0 && <span className="text-space-400"> · energy {side.zEnergy}</span>}
        </span>
      )}
      {side.warp > 0 && (
        <span>
          warp <b className="text-space-200">{side.warp}</b>
        </span>
      )}
    </div>
  );
}

function EnergyRow({ side, small = false }: { side: SideView; small?: boolean }) {
  return (
    <div className="mt-1.5 flex items-center gap-1">
      <span className="text-[10px] text-space-500">energy</span>
      {side.energy.map((c) => (
        <ArenaCard key={c.id} card={c} width={small ? 18 : 24} upsideDown />
      ))}
      {side.energyMarkers > 0 && <span className="rounded bg-ki-500/20 px-1 text-[9px] font-mono text-ki-300">+{side.energyMarkers} marker</span>}
      <span className="ml-auto text-[10px] text-space-400">
        active <b className="text-space-200">{side.activeEnergy}</b> · rest <b className="text-space-200">{side.energy.length - side.activeEnergy}</b>
      </span>
    </div>
  );
}

function Sheet({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-space-950/70 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[75dvh] w-full max-w-md space-y-2 overflow-y-auto rounded-t-2xl border border-space-700 bg-space-900 p-4 pb-8 sm:rounded-2xl sm:pb-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-space-50">{title}</h3>
          <button type="button" onClick={onClose} className="tap text-xs text-space-300">
            close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
