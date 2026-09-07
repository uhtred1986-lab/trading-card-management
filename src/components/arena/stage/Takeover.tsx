"use client";

import { motion } from "motion/react";
import { Chain, STEP_WORD, TriggerLine, Totals, type StagingProps } from "./BattleParts";
import { StageCard } from "./StageCard";

/**
 * The takeover: the same fight, given the whole screen.
 *
 * Reuse, not a rebuild (`docs/arena-battle-staging-spec.md` §3.4). It takes
 * the identical props as `DuelBand` and shares every piece with it — the
 * chain, the ordinals, the counter stamp, the trigger mark and the totals all
 * come from `BattleParts`. If these two files ever stop importing the same
 * pieces, decision 1 has been broken and one of them should be deleted rather
 * than maintained beside the other.
 *
 * It is the better staging for the fights that decide a game, and the worse
 * one for everything else: it is the only variant where the position being
 * fought over leaves the screen while the fight resolves. That is why the band
 * is the default and this is a choice.
 *
 * The prompt bar sits above it (z-30 over z-20), so the question being asked
 * is still answerable while the fight has the screen.
 */
export function Takeover({ shape, cardProps, beat, progress }: StagingProps) {
  const { attack, defence } = shape;
  const left = attack.mine ? attack : defence;
  const right = attack.mine ? defence : attack;
  const resolving = beat && "card" in beat ? (beat as { card: string }).card : null;
  const name = beat?.t === "skill" ? (shape.cards.find((c) => c.id === beat.card)?.name ?? null) : null;

  const cluster = (side: typeof left, outward: "left" | "right") => (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
      <span className="truncate text-[10px] uppercase tracking-[0.2em] text-space-400 sm:text-xs">{side.mine ? "you" : side.name}</span>
      <div className={`${resolving === side.main?.id ? "arena-resolving" : ""}`}>{side.main && <StageCard {...cardProps(side.main)} width={104} />}</div>
      <Chain side={side} cardProps={cardProps} width={48} outward={outward} beat={beat} />
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="arena-takeover fixed inset-0 z-20 flex flex-col items-center justify-center gap-3 p-3 sm:gap-5 sm:p-6"
      aria-label="the battle"
    >
      <div className="flex w-full max-w-3xl items-center justify-between gap-2">
        <span className="truncate text-[10px] uppercase tracking-[0.25em] text-space-300 sm:text-xs">{STEP_WORD[shape.step] ?? shape.step}</span>
        {progress && (
          <span className="shrink-0 rounded-full border border-space-600 px-2 py-px font-mono text-[10px] tabular-nums text-space-400 sm:text-xs">
            beat {progress.index + 1} of {progress.total}
          </span>
        )}
      </div>

      <div className="flex w-full max-w-3xl items-start justify-center gap-3 sm:gap-8">
        {cluster(left, "left")}
        {/* The wave between them: one element, so it can be found and changed. */}
        <span className="arena-wave mt-10 shrink-0 self-center font-mono text-xs font-bold tracking-[0.3em] text-space-500 sm:text-base" aria-hidden>
          VS
        </span>
        {cluster(right, "right")}
      </div>

      <div className="w-full max-w-3xl">
        <Totals left={left} right={right} big />
        <TriggerLine beat={beat} name={name} />
      </div>
    </motion.div>
  );
}
