"use client";

import { motion } from "motion/react";
import { Chain, ChainCard, STEP_WORD, TriggerLine, Totals, type StagingProps } from "./BattleParts";
import { StageCard } from "./StageCard";

/**
 * The duel band: the fight lifted off the board into one lane across it.
 *
 * The default staging (`docs/arena-battle-staging-spec.md` decision 2), and
 * the research reason rather than a taste one: it is the only variant that
 * keeps the position being fought over on screen while the fight resolves.
 * The board stays mounted behind, dimmed and blurred — visible, not gone.
 *
 * One lane, laid out as `[your chain][attacker] VS [guard][their chain]`, with
 * each side's chain running *outward* from its card so nothing stacks in Z.
 * The 76 px cards against the board's 52 px are the point: the size delta is
 * what says *this one matters right now*.
 *
 * It draws `shape` and nothing else. Every card in it comes from the engine's
 * `view.battle`, every figure from `battle.contributions`, and every ⚡ from a
 * `skill` beat the engine marked `inBattle`.
 */
export function DuelBand({ shape, cardProps, beat, progress }: StagingProps) {
  const { attack, defence } = shape;
  // Your side is the left of the lane whichever way the attack runs, so the
  // lane does not swap sides between your turn and Claude's.
  const left = attack.mine ? attack : defence;
  const right = attack.mine ? defence : attack;
  const resolving = beat && "card" in beat ? (beat as { card: string }).card : null;
  const name = beat?.t === "skill" ? (shape.cards.find((c) => c.id === beat.card)?.name ?? null) : null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="arena-band pointer-events-none absolute left-2 right-2 z-20 -translate-y-1/2 rounded-2xl border border-ki-500/40 p-2 sm:p-3"
      style={{ top: "46%" }}
      aria-label="the battle"
    >
      <div className="pointer-events-auto">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[9px] uppercase tracking-[0.2em] text-space-400 sm:text-[10px]">{STEP_WORD[shape.step] ?? shape.step}</span>
          {progress && (
            <span className="shrink-0 rounded-full border border-space-600 px-1.5 py-px font-mono text-[9px] tabular-nums text-space-400 sm:text-[10px]">
              beat {progress.index + 1} of {progress.total}
            </span>
          )}
        </div>

        <div className="mt-1 flex items-center justify-center gap-1.5 overflow-x-auto [justify-content:safe_center] sm:gap-2">
          <Chain side={left} cardProps={cardProps} width={42} outward="left" beat={beat} />
          {left.main && (
            <div className={`shrink-0 ${resolving === left.main.id ? "arena-resolving" : ""}`}>
              <StageCard {...cardProps(left.main)} width={76} />
            </div>
          )}
          <span className="arena-impact shrink-0 px-0.5 font-mono text-[10px] font-bold tracking-[0.25em] text-space-500 sm:text-xs">VS</span>
          {right.main && (
            <div className={`shrink-0 ${resolving === right.main.id ? "arena-resolving" : ""}`}>
              <StageCard {...cardProps(right.main)} width={76} />
            </div>
          )}
          <Chain side={right} cardProps={cardProps} width={42} outward="right" beat={beat} />
        </div>

        <Totals left={left} right={right} />
        <TriggerLine beat={beat} name={name} />
      </div>
    </motion.div>
  );
}

/** One link, exported so the overflow sheet and the takeover draw the same card. */
export { ChainCard };
