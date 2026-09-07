"use client";

import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect, useState } from "react";
import { Sheet } from "../shared";
import type { BeatArt, NumberedBeat } from "@/lib/arena/beats";
import type { BoardView, CardView } from "@/lib/arena/view";
import { StageCard } from "./StageCard";
import type { CardState } from "../ArenaCard";

/**
 * The pieces a battle staging is made of, and the one place the fight is
 * worked out from the board (`docs/arena-battle-staging-spec.md` decision 1).
 *
 * `DuelBand` and `Takeover` are two layouts over this one data path. If either
 * ever grows its own answer to what is in a battle, they are two games that
 * will drift apart — which is why the parts live here and neither file
 * computes anything of its own.
 *
 * Nothing here decides a rule. Which cards are in the fight, what each is
 * contributing and whether a skill fired all arrive from the engine, in
 * `view.battle` and in the beats; this only lays them out.
 */

/** One card added to a side of the fight, in play order. */
export interface BattleLink {
  card: CardView;
  /** 1-based within its own side's chain — the ordinal badge. */
  ordinal: number;
  kind: "combo" | "counter";
  /** What the engine says this card is putting in. */
  contribution: number;
  /** A skill of this card has fired in this battle. The engine said so. */
  fired: boolean;
}

/** One side of the fight: its card, its chain and its figure. */
export interface BattleSide {
  /** The card being fought with: the attacker, or the guard. */
  main: CardView | null;
  chain: BattleLink[];
  power: number;
  /** This is the viewer's own side. Decides which way the chain runs and its colour. */
  mine: boolean;
  name: string;
}

export interface BattleShape {
  step: string;
  attack: BattleSide;
  defence: BattleSide;
  /** Is the viewer the one attacking? The band puts your side on the left. */
  attacking: boolean;
  /** Every card the staging draws, so the board can lift them out of its rows. */
  cards: CardView[];
  /** Card id → what it is contributing, for the inspector's "why is it 35,000?". */
  contributions: Record<string, number>;
}

/** A card anywhere the board can see it, including the counters now in the Drop. */
function findCard(view: BoardView, id: string): CardView | null {
  for (const side of [view.you, view.them]) {
    for (const c of [side.leader, side.unison, ...side.battle, ...side.combo, ...side.energy, ...(side.hand ?? []), side.dropTop]) if (c?.id === id) return c;
  }
  for (const c of view.battle?.counters ?? []) if (c.card.id === id) return c.card;
  return null;
}

/**
 * One side's chain, in true play order.
 *
 * A counter and a combo card are two lists with no shared order, so the engine
 * records how many combo cards a side had already added when each counter was
 * played (`after`) and they merge exactly here. Without it the numbering would
 * be a guess, and decision 4 is that the ordinal means play order.
 */
function chainFor(combo: CardView[], counters: { card: CardView; after: number }[], contributions: Record<string, number>, fired: ReadonlySet<string>): BattleLink[] {
  const out: { card: CardView; kind: BattleLink["kind"] }[] = [];
  for (let i = 0; i <= combo.length; i++) {
    for (const c of counters) if (c.after === i) out.push({ card: c.card, kind: "counter" });
    if (i < combo.length) out.push({ card: combo[i], kind: "combo" });
  }
  // A counter recorded past the end of the chain — a game saved before the
  // field existed reads as 0, and a later window can outrun the list.
  for (const c of counters) if (c.after > combo.length) out.push({ card: c.card, kind: "counter" });
  return out.map((x, i) => ({ ...x, ordinal: i + 1, contribution: contributions[x.card.id] ?? 0, fired: fired.has(x.card.id) }));
}

/**
 * The open battle, laid out.
 *
 * `fired` is the cards whose skills have fired in this battle — collected from
 * the `skill` beats the engine marked `inBattle`, never inferred from a power
 * figure moving (decision 8).
 */
export function battleShape(view: BoardView, fired: ReadonlySet<string>): BattleShape | null {
  const b = view.battle;
  if (!b) return null;
  const attacking = view.turnPlayer === view.you.player;
  const off = attacking ? view.you : view.them;
  const def = attacking ? view.them : view.you;
  const contributions = b.contributions ?? {};
  const counters = b.counters ?? [];
  const attack: BattleSide = {
    main: findCard(view, b.attacker),
    chain: chainFor(
      off.combo,
      counters.filter((c) => c.by === off.player),
      contributions,
      fired,
    ),
    power: b.attackPower,
    mine: attacking,
    name: off.name,
  };
  const defence: BattleSide = {
    main: findCard(view, b.guard),
    chain: chainFor(
      def.combo,
      counters.filter((c) => c.by === def.player),
      contributions,
      fired,
    ),
    power: b.guardPower,
    mine: !attacking,
    name: def.name,
  };
  const cards = [attack.main, defence.main, ...attack.chain.map((l) => l.card), ...defence.chain.map((l) => l.card)].filter((c): c is CardView => !!c);
  return { step: b.step, attack, defence, attacking, cards, contributions };
}

/**
 * The cards whose skills have fired in the open battle.
 *
 * Collected from the beats the engine marked `inBattle`, back to the `attack`
 * beat that opened the fight. The board only gathers what it was told; it
 * never decides that a skill fired.
 */
export function firedInBattle(list: readonly NumberedBeat[] | undefined): Set<string> {
  const out = new Set<string>();
  if (!list?.length) return out;
  let from = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].t === "attack") {
      from = i;
      break;
    }
  }
  for (let i = from; i < list.length; i++) {
    const b = list[i];
    if (b.t === "skill" && b.inBattle) out.add(b.card);
  }
  return out;
}

/** Props both stagings take, so neither can grow one of its own. */
export interface StagingProps {
  shape: BattleShape;
  cardProps: (c: CardView) => {
    card: CardView;
    state: CardState;
    suppressed: boolean;
    onTap: (() => void) | undefined;
    onInspect: () => void;
    onHover: (box: DOMRect | null) => void;
  };
  /** The beat on screen, so the resolving link can be marked and a trigger named. */
  beat: NumberedBeat | null;
  /** Where the story is, for the `beat n of m` chip. Absent when nothing is playing. */
  progress: { index: number; total: number } | null;
}

/**
 * A power figure that climbs to its new value.
 *
 * A combo card is worth counting *up* to: the number is the whole reason you
 * played it, and swapping 25,000 for 30,000 between two renders is the one
 * moment on this board where the arithmetic is the drama.
 */
export function Count({ value, className }: { value: number; className?: string }) {
  const shown = useMotionValue(value);
  const text = useTransform(shown, (v) => Math.round(v).toLocaleString("en"));
  useEffect(() => {
    const run = animate(shown, value, { duration: 0.26, ease: "easeOut" });
    return () => run.stop();
  }, [shown, value]);
  return <motion.span className={className}>{text}</motion.span>;
}

/**
 * One card in a chain: the ordinal, the stamp that says it was a counter, and
 * the mark that says a skill of it fired.
 *
 * The two questions — *when was it added* and *is it resolving now* — get two
 * channels, because one is a fact about the chain and the other moves. A
 * single highlight doing both is the Magic Arena pile this brief is against.
 */
export function ChainCard({ link, cardProps, width, mine, resolving }: { link: BattleLink; cardProps: StagingProps["cardProps"]; width: number; mine: boolean; resolving: boolean }) {
  return (
    <div className={`relative shrink-0 ${resolving ? "arena-resolving" : ""}`}>
      <StageCard {...cardProps(link.card)} width={width} />
      <span
        className={`pointer-events-none absolute -left-1 -top-1 z-10 flex h-4 w-4 items-center justify-center rounded-full font-mono text-[9px] font-bold tabular-nums sm:h-[18px] sm:w-[18px] sm:text-[10px] ${
          mine ? "bg-ki-500 text-space-950" : "bg-dbs-blue text-space-50"
        }`}
        aria-hidden
      >
        {link.ordinal}
      </span>
      {link.kind === "counter" && (
        <span className="pointer-events-none absolute -bottom-1 left-1/2 z-10 -translate-x-1/2 rounded-sm bg-loss px-1 py-px font-mono text-[7px] font-bold uppercase tracking-wider text-space-50 sm:text-[8px]">counter</span>
      )}
      {/* Grey has no honest state: nothing but the engine knows a card has a
          battle trigger before it fires, and no client may guess from its text. */}
      {link.fired && (
        <span className="arena-trigger-lit pointer-events-none absolute -right-1 -top-1 z-10 text-[10px] leading-none sm:text-xs" title="a skill of this card fired in this battle">
          ⚡
        </span>
      )}
    </div>
  );
}

/**
 * A side's chain, running outward from its card and never stacked in Z.
 *
 * Past `max` links the lane stops being readable on a 360 px screen, so the
 * oldest collapse into a `+n` chip that opens the whole chain in a sheet. The
 * cards nearest the fight are the ones still resolving, so they are the ones
 * that stay on the lane.
 */
export function Chain({ side, cardProps, width, outward, beat, max = 3 }: { side: BattleSide; cardProps: StagingProps["cardProps"]; width: number; outward: "left" | "right"; beat: NumberedBeat | null; max?: number }) {
  const [open, setOpen] = useState(false);
  if (!side.chain.length) return null;
  const resolving = beat && "card" in beat ? (beat as { card: string }).card : null;
  // Keep the latest, and always keep whatever is resolving right now.
  const hidden = Math.max(0, side.chain.length - max);
  const shown = side.chain.filter((l, i) => i >= hidden || l.card.id === resolving);
  const links = outward === "left" ? [...shown].reverse() : shown;
  const chip = hidden > 0 && (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="tap shrink-0 rounded-full border border-space-600 bg-space-800 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-space-300 hover:border-ki-500/60"
      title={`${hidden} more in this chain`}
    >
      +{hidden}
    </button>
  );
  return (
    <div className="flex shrink-0 items-center gap-1 sm:gap-1.5" aria-label={`${side.name}'s chain`}>
      {outward === "right" && chip}
      {links.map((l) => (
        <ChainCard key={l.card.id} link={l} cardProps={cardProps} width={width} mine={side.mine} resolving={l.card.id === resolving} />
      ))}
      {outward === "left" && chip}
      {open && (
        <Sheet title={`${side.name}'s chain`} eyebrow={<span className="text-[10px] uppercase tracking-widest text-ki-300">everything added, in play order</span>} onClose={() => setOpen(false)}>
          {side.chain.map((l) => (
            <div key={l.card.id} className="flex items-center gap-3 rounded-lg border border-space-700 bg-space-800/60 px-3 py-2">
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-bold tabular-nums ${side.mine ? "bg-ki-500 text-space-950" : "bg-dbs-blue text-space-50"}`}>{l.ordinal}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-space-100">{l.card.name}</span>
              {l.kind === "counter" && <span className="shrink-0 rounded-sm bg-loss px-1 py-px font-mono text-[8px] font-bold uppercase tracking-wider text-space-50">counter</span>}
              {l.fired && <span className="shrink-0 text-xs text-ki-300" title="a skill of this card fired">⚡</span>}
              <span className="shrink-0 font-mono text-xs text-ki-300">{l.contribution.toLocaleString("en")}</span>
            </div>
          ))}
        </Sheet>
      )}
    </div>
  );
}

/**
 * Both totals, as a figure and as a bar.
 *
 * Both are on screen the whole time: the figure is exact, the bar is the
 * glance (decision 5). A running total that has to be summoned is the thing
 * players patch out. `left` and `right` are the lane's own order — your side
 * is always the left — so the bigger figure is the one that glows, whether it
 * is the attack or the guard.
 */
export function Totals({ left, right, big = false }: { left: BattleSide; right: BattleSide; big?: boolean }) {
  const top = Math.max(left.power, right.power, 1);
  const ahead = left.power >= right.power;
  const figure = big ? "text-3xl sm:text-5xl" : "text-xl sm:text-3xl";
  return (
    <div className="mt-1.5 flex items-center gap-2 sm:gap-3">
      <div className="flex min-w-0 flex-1 flex-col items-end gap-1">
        <Count value={left.power} className={`arena-impact font-mono font-black tabular-nums ${figure} ${ahead ? "arena-power-win text-ki-300" : "text-space-400"}`} />
        <span className="h-1.5 w-full overflow-hidden rounded-full bg-space-800" aria-hidden>
          <motion.span className="block h-full rounded-full bg-ki-400" animate={{ width: `${(left.power / top) * 100}%` }} transition={{ duration: 0.26, ease: "easeOut" }} style={{ marginLeft: "auto" }} />
        </span>
      </div>
      <span className="shrink-0 self-start font-mono text-[9px] font-bold tracking-[0.3em] text-space-500 sm:text-xs">VS</span>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
        <Count value={right.power} className={`arena-impact font-mono font-black tabular-nums ${figure} ${!ahead ? "arena-power-win text-ki-300" : "text-space-400"}`} />
        <span className="h-1.5 w-full overflow-hidden rounded-full bg-space-800" aria-hidden>
          <motion.span className="block h-full rounded-full bg-loss" animate={{ width: `${(right.power / top) * 100}%` }} transition={{ duration: 0.26, ease: "easeOut" }} />
        </span>
      </div>
    </div>
  );
}

/**
 * A skill firing inside the fight, said on the card that fired it rather than
 * under a banner sliding over the top of it (§3.2).
 */
export function TriggerLine({ beat, name }: { beat: NumberedBeat | null; name: string | null }) {
  if (!beat || beat.t !== "skill" || !beat.inBattle) return null;
  return (
    <motion.p
      key={beat.n}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-1 truncate text-center text-[10px] leading-snug text-ki-300 sm:text-xs"
    >
      <span className="font-semibold">⚡ {name ?? beat.label}</span>
      <span className="text-space-300"> · {beat.text}</span>
    </motion.p>
  );
}

/**
 * Who won the fight, said out loud.
 *
 * A clash used to be a starburst and two numbers changing, which said *that*
 * it was decided and left the player to work out *who had won it* by comparing
 * them. This names the card — the attacker when the attack hits, the guard
 * when it is repelled — at a size that cannot be missed, and holds long enough
 * to be read (owner's decision, 7 Sep 2026).
 *
 * Rendered by the board rather than by a staging, so it appears whichever of
 * the three is chosen — and, more to the point, whether or not a band is open:
 * a whole turn of Claude's plays back against a snapshot in which the battle
 * has already closed, so the band is not there to carry it.
 *
 * It decides nothing. `hit` is the engine's verdict (8-4-5), and the two names
 * are the faces the beat brought with it. `sideOf` answers null for a card the
 * board can no longer see, and the banner is then simply uncoloured — saying
 * "theirs" because a card had left would be worse than saying nothing.
 */
export function BattleVerdict({ beat, art, sideOf }: { beat: NumberedBeat | null; art: Record<string, BeatArt>; sideOf: (card: string) => "yours" | "theirs" | null }) {
  if (!beat || (beat.t !== "clash" && beat.t !== "negated")) return null;

  if (beat.t === "negated") {
    return (
      <Banner key={beat.n} eyebrow="the attack is negated" tone="neutral" name="No battle" line="It ends here — no Offense Step, no Defense Step." />
    );
  }
  const winner = beat.hit ? beat.attacker : beat.guard;
  const name = art[winner]?.name ?? "That card";
  return (
    <Banner
      key={beat.n}
      eyebrow={beat.hit ? "the attack hits" : "the attack is repelled"}
      tone={sideOf(winner) ?? "neutral"}
      name={name}
      line={`${beat.attackPower.toLocaleString("en")} vs ${beat.guardPower.toLocaleString("en")}`}
      won
    />
  );
}

/** The verdict's one shape, so the three outcomes cannot drift apart. */
function Banner({ eyebrow, tone, name, line, won = false }: { eyebrow: string; tone: "yours" | "theirs" | "neutral"; name: string; line: string; won?: boolean }) {
  const colour = tone === "yours" ? "text-ki-300" : tone === "theirs" ? "text-loss" : "text-space-200";
  return (
    <div className="pointer-events-none fixed inset-x-0 top-1/3 z-40 flex justify-center px-3" aria-live="polite">
      <div className="arena-verdict max-w-[92vw] rounded-2xl border border-ki-500/40 px-5 py-3 text-center sm:px-8 sm:py-5">
        <p className="text-[10px] uppercase tracking-[0.3em] text-space-300 sm:text-xs">{eyebrow}</p>
        <p className={`arena-verdict-name arena-impact mt-1 text-2xl font-black leading-tight sm:text-4xl ${colour}`}>
          {name}
          {won && <span className="ml-2 align-middle text-lg sm:text-2xl">WINS</span>}
        </p>
        <p className="mt-1 font-mono text-xs tabular-nums text-space-300 sm:text-base">{line}</p>
      </div>
    </div>
  );
}

/** Which step of the battle this is, in the words the rules use. */
export const STEP_WORD: Record<string, string> = {
  declared: "attack declared",
  offense: "offense step",
  defense: "defense step",
  damage: "damage step",
  battleEnd: "end of battle",
};
