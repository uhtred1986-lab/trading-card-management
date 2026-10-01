"use client";

import { colourOf, turnVars, type TurnLighting } from "@/lib/arena/lighting";
import type { BoardView } from "@/lib/arena/view";
import type { TurnCall } from "./useBeatPlayer";

/**
 * Whose turn it is, said so it cannot be missed (issue #344,
 * `docs/arena-board-redesign-spec.md` §2).
 *
 * Four surfaces say the same thing — the banner when a turn begins, the pill
 * that stays, the edge round the board and the lit row — and none of them
 * decides anything. They all read the turn player off the live `BoardView`
 * (never the server-rendered prop) and take their colour from `turnVars`, the
 * one place the lighting settings are applied.
 */

/** The colour a side plays in: its leader's, through the same settings as the room. */
function sideTint(side: BoardView["you"], yours: boolean, view: BoardView, lighting: TurnLighting): string {
  const mine = colourOf(view.you.leader?.colors);
  const vars = turnVars({ colour: colourOf(side.leader?.colors), art: null, yours, mirror: !!mine && mine === colourOf(view.them.leader?.colors) }, lighting);
  // A hidden or colourless leader has no tone; the ki orange and slate are the same pair the turn strip used.
  return vars["--turn-tint"] ?? (yours ? "#f28c0f" : "#64748b");
}

export function turnWords(yours: boolean, name: string): string {
  return yours ? "YOUR TURN" : `${name.toUpperCase()}'S TURN`;
}

/**
 * "YOUR TURN" / "CLAUDE'S TURN" with "Turn N" under it. A skewed bar in the
 * acting side's colour; the text slides through it. `holdUntilTap` is step
 * pace, where the walk waits for Next instead of a timer, so the bar sweeps in
 * and stays. It never takes a pointer event.
 */
export function TurnBanner({ call, view, lighting, ms, holdUntilTap }: { call: TurnCall | null; view: BoardView; lighting: TurnLighting; ms: number; holdUntilTap: boolean }) {
  if (!call) return null;
  const yours = call.player === view.you.player;
  const side = yours ? view.you : view.them;
  return (
    <div className="pointer-events-none fixed inset-0 z-40 grid place-items-center overflow-hidden" aria-hidden data-turn-banner={yours ? "you" : "them"}>
      <div
        key={call.key}
        className={`arena-turnbanner ${holdUntilTap ? "arena-turnbanner-hold" : ""}`}
        style={{ "--tb": sideTint(side, yours, view, lighting), animationDuration: `${ms}ms` } as React.CSSProperties}
      >
        <div className="arena-turnbanner-inner" style={{ animationDuration: `${ms}ms` }}>
          <p className="arena-turnbanner-text arena-impact select-none text-4xl font-black uppercase italic tracking-tight sm:text-6xl lg:text-7xl">{turnWords(yours, side.name)}</p>
          <p className="arena-turnbanner-sub select-none text-xs font-black uppercase tracking-[0.5em] sm:text-sm">Turn {call.turn}</p>
        </div>
      </div>
    </div>
  );
}

/** "YOUR TURN  Turn 3" in the impact face, in the acting side's colour, with a blinking dot. */
export function TurnPill({ view, className = "" }: { view: BoardView; className?: string }) {
  const yours = view.turnPlayer === view.you.player;
  const name = (yours ? view.you : view.them).name;
  return (
    <div role="status" className={`arena-turnpill inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full py-1.5 pl-2 pr-2.5 sm:gap-2 sm:pl-2.5 sm:pr-3 ${className}`} data-turn={yours ? "you" : "them"}>
      <span className="arena-turnpill-dot h-2.5 w-2.5 shrink-0 rounded-full" aria-hidden />
      <span className="arena-turnpill-who truncate px-px text-[15px] uppercase leading-none sm:text-base lg:text-xl">{turnWords(yours, name)}</span>
      <span className="arena-turnpill-num shrink-0 whitespace-nowrap text-[13px] leading-none tabular-nums">Turn {view.turn}</span>
    </div>
  );
}

const CHIPS = [
  { id: "draw", label: "Draw" },
  { id: "charge", label: "Charge" },
  { id: "main", label: "Main" },
  { id: "battle", label: "Battle" },
  { id: "end", label: "End" },
] as const;

/**
 * The one chip the turn is on. The engine's Charge Phase is where the draw
 * happens, but the draw is over by the time a player can act in it, so only
 * Charge is lit there: one pill, never two (`docs/arena-redesign/` frame 03).
 */
function litChip(view: BoardView): string | null {
  if (view.battle) return "battle";
  switch (view.phase) {
    case "charge":
      return "charge";
    case "main":
    case "mainEnd":
      return "main";
    case "end":
      return "end";
    default:
      return null;
  }
}

/** Draw · Charge · Main · Battle · End as plain words with dots; only the live one is a pill. */
export function PhaseChips({ view, vertical = false, className = "" }: { view: BoardView; vertical?: boolean; className?: string }) {
  const lit = litChip(view);
  const battleStep = view.battle ? (view.battle.step === "declared" ? "attack" : view.battle.step) : null;
  return (
    <ol className={`arena-phases flex ${vertical ? "arena-phases-col flex-col gap-1.5" : "items-center justify-center gap-0.5 sm:gap-1"} ${className}`} aria-label="Phase">
      {CHIPS.map((c) => (
        <li
          key={c.id}
          aria-current={lit === c.id ? "step" : undefined}
          className={`arena-phase ${lit === c.id ? "arena-phase-on" : ""} flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-bold uppercase tracking-[0.1em] ${vertical ? "rounded-[10px] px-3 py-2 text-sm" : "sm:px-2.5"}`}
        >
          <span className="arena-phase-dot h-1.5 w-1.5 shrink-0 rounded-full" aria-hidden />
          {c.label}
          {c.id === "battle" && battleStep && <span className="normal-case tracking-normal">· {battleStep}</span>}
        </li>
      ))}
    </ol>
  );
}
