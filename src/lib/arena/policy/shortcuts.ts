/**
 * The free-choice shortcuts as pure policy functions (#645, plan O2-02).
 *
 * The online opponent never asks a model about a decision that cannot go
 * wrong: one legal move, the opening coin flip, the mulligan, which card to
 * charge, whether a combo card becomes Z-Energy, how many [Empower] markers to
 * carry (`ai/opponent.ts`'s header). Those rules used to live inside that file,
 * welded to the engine's state. They live here now, over exactly what a local
 * policy may know (#644): the seat's observation and its decisions. The online
 * opponent calls these same functions (`ai/shortcut-input.ts` is its adapter:
 * the one place that reads engine state), so a local opponent and Claude make
 * the same free choices from the same position and there is one copy of the
 * rule.
 *
 * What they decide, and the words they give for it (the log shows the words):
 *
 *   one decision open            -> it                      "only one legal move"
 *   chooseFirst                  -> take the first turn     "takes the first turn"
 *   mulligan                     -> keep a hand with two cards costing <= 2,
 *                                   else the one redraw     "opening hand rule"
 *   charge                       -> the card least likely to be played: the dearest
 *                                   (an X cost counts 9), +10 if a colour is off the
 *                                   leader's                "charge rule"
 *   zEnergyFromCombo             -> keep a card, not decline "keeps the Z-Energy"
 *   empowerCarry                 -> the prompt's maximum    "carries maximum N Empower markers"
 *
 * Anything else, a window the rules do not cover, or one whose matching decision
 * is not on offer, is `null`: not a free choice, ask the policy (or the model).
 * **Ties** go to the first of the tied decisions in the order the caller lists
 * them — the engine's own menu order online, the contract's canonical id order
 * for a local policy — so the choice is a function of the position and that
 * order alone, never of hidden cards, a clock or any RNG (a shortcut draws no
 * randomness; `shortcutThen` hands the policy RNG on untouched).
 *
 * Policy layer: value imports only from `src/lib/arena/policy/` (checked by
 * `scripts/verify/arena-policy-contract.mts`).
 */
import type { PlayerId } from "../types";
import { answerFor, type Policy, type PolicyInput } from "./contract";

/** One open menu decision, as a shortcut reads it. `action` is the move's arguments (the engine's `Action`, less `player`, for a contract decision). */
export interface ShortcutDecision {
  id: string;
  type: string;
  action: Readonly<Record<string, unknown>>;
}

/** A card of the seat's own hand, as the charge and mulligan rules read it. */
export interface ShortcutCard {
  id: string;
  /** The printed cost; null for an X cost or none. */
  energyCost: number | null;
  colors: readonly string[];
}

/** Everything a shortcut reads. A `PolicyInput` gives one (`shortcutInputOf`); the online opponent builds one from its engine. */
export interface ShortcutInput {
  seat: PlayerId;
  /** The engine's question: `chooseFirst`, `mulligan`, `charge`, … */
  window: string;
  /** The menu decisions open to the seat, in the order ties resolve. */
  decisions: readonly ShortcutDecision[];
  /** The seat's own hand, in hand order. Only read by the mulligan and charge rules. */
  hand: readonly ShortcutCard[];
  /** The colours of the seat's Leader. */
  leaderColors: readonly string[];
  /** The most [Empower] markers the open question lets the seat carry. */
  carryMax: number | null;
}

export interface ShortcutChoice {
  /** The chosen decision's id. */
  id: string;
  /** Why, for the log. */
  how: string;
}

/** The windows that have a rule of their own; with one open decision, every window has the only-move rule. */
export const SHORTCUT_WINDOWS = ["chooseFirst", "mulligan", "charge", "zEnergyFromCombo", "empowerCarry"] as const;

/** Can a shortcut apply here at all? Lets a caller skip building the input for a window none covers. */
export function mayShortcut(window: string, decisionCount: number): boolean {
  return decisionCount === 1 || (SHORTCUT_WINDOWS as readonly string[]).includes(window);
}

const first = (list: readonly ShortcutDecision[], test: (d: ShortcutDecision) => boolean) => list.find(test);

/** The opening hand rule (6-2-1-9): keep a hand that can act early; otherwise take the one redraw. */
function wantsRedraw(hand: readonly ShortcutCard[]): boolean {
  // `mulliganed` is not asked: a seat is prompted for its opening hand once, so it is always false here.
  const cheap = hand.filter((c) => c.energyCost !== null && c.energyCost <= 2).length;
  return cheap < 2;
}

/**
 * A card to charge (7-2-11). Charging is nearly always right and the choice is
 * rarely sharp, so a rule does it: give up the card you are least likely to
 * play — the most expensive one, preferring a colour the leader cannot pay for.
 */
function chargeFor(input: ShortcutInput): ShortcutDecision | undefined {
  let best: ShortcutDecision | undefined;
  let bestScore = -Infinity;
  for (const d of input.decisions) {
    const id = d.type === "charge" ? d.action.card : null;
    if (typeof id !== "string" || !id) continue;
    const card = input.hand.find((c) => c.id === id);
    const cost = card && card.energyCost !== null ? card.energyCost : 9;
    const offColour = card?.colors.some((c) => !input.leaderColors.includes(c)) ? 10 : 0;
    const score = cost + offColour;
    // Strictly greater: of equal scores the earlier decision stays.
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

/** The free choice for this position, or null when it is not one. Pure: the same input gives the same answer. */
export function shortcutChoice(input: ShortcutInput): ShortcutChoice | null {
  const open = input.decisions;
  if (open.length === 1) return { id: open[0].id, how: "only one legal move" };
  switch (input.window) {
    case "chooseFirst": {
      const d = first(open, (x) => x.type === "chooseFirst" && x.action.first === input.seat);
      return d ? { id: d.id, how: "takes the first turn" } : null;
    }
    case "mulligan": {
      const redraw = wantsRedraw(input.hand);
      const d = first(open, (x) => x.type === "mulligan" && x.action.redraw === redraw);
      return d ? { id: d.id, how: "opening hand rule" } : null;
    }
    case "charge": {
      const d = chargeFor(input);
      return d ? { id: d.id, how: "charge rule" } : null;
    }
    case "zEnergyFromCombo": {
      // Free value: a combo card that would go to the Drop becomes Z-Energy instead.
      const d = first(open, (x) => x.type === "zEnergyFromCombo" && !!x.action.card);
      return d ? { id: d.id, how: "keeps the Z-Energy" } : null;
    }
    case "empowerCarry": {
      // 22-45-3: carrying markers with [Empower] cannot go wrong, so take the maximum.
      const max = input.carryMax ?? 0;
      const d = first(open, (x) => x.type === "empowerCarry" && x.action.amount === max);
      return d ? { id: d.id, how: `carries maximum ${max} Empower markers` } : null;
    }
    default:
      return null;
  }
}

/** The shortcut input a local policy has: its observation and its decisions, nothing else. */
export function shortcutInputOf(input: PolicyInput): ShortcutInput {
  const { observation, decisions } = input;
  const mine = observation.prompt.mine ? observation.prompt : null;
  // #650: the board's prompt view carries no `max` for an [Empower] carry, so the local seat reads the
  // cap off its own decisions — the engine offers every amount from none to the cap (22-45-3).
  const offered = decisions.decisions.flatMap((d) => (d.kind === "menu" && d.type === "empowerCarry" && typeof d.action.amount === "number" ? [d.action.amount] : []));
  return {
    seat: decisions.seat,
    window: decisions.window,
    decisions: decisions.decisions.flatMap((d) => (d.kind === "menu" ? [{ id: d.id, type: d.type, action: d.action }] : [])),
    hand: (observation.you.hand ?? []).map((c) => ({ id: c.id, energyCost: c.energyCost, colors: c.colors })),
    leaderColors: observation.you.leader?.colors ?? [],
    carryMax: mine?.max ?? (offered.length ? Math.max(...offered) : null),
  };
}

/** The free choice for a seat's contract input, or null. */
export function shortcutFor(input: PolicyInput): ShortcutChoice | null {
  if (input.decisions.actor !== input.decisions.seat) return null;
  return shortcutChoice(shortcutInputOf(input));
}

/**
 * A policy that takes a free choice where there is one and otherwise defers to
 * `fallback`. A free choice draws nothing: the RNG state comes back as it went in.
 */
export function shortcutThen(fallback: Policy): Policy {
  return (input, rng) => {
    const hit = shortcutFor(input);
    return hit ? { answer: answerFor(input.decisions, hit.id), rng } : fallback(input, rng);
  };
}
