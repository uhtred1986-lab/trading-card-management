/**
 * The prompt bar's fixed questions, shared by `view.ts` (legacy) and
 * `vm/view.ts` (rules) — Stage 8, issue #160.
 *
 * `prompts.rules` (`rulesets/dbs/prompts.rules`, #135) now declares a
 * `DEFINE PROMPT` for every one of `PROMPT_KINDS` — the owner's decision on
 * #131/#135 (20 Sep 2026) made `DEFINE PROMPT` a declaration of its own, the
 * same as `board-words.ts`'s `DEFINE WORDS`. Declared, not consumed:
 * `questionFor` still reads `PROMPT_QUESTIONS` below, not the ruleset —
 * wiring the two together is Stage 8's own follow-up (CLAUDE.md: "declare
 * only; do not move any consumer Stage 8 did not already move"). What moves
 * here instead is the *sharing*: both engines answer the same `Prompt` union
 * (`vm/flow.ts`'s own comment: "one union for both engines... a second
 * spelling of the same question would make one client unable to answer
 * both"), so a prompt kind that asks a fixed question — no card, no number,
 * nothing to interpolate — belongs in one table rather than two copies that
 * can drift, which `vm/view.ts`'s own `QUESTIONS` table used to be, five
 * entries out of the eleven a hot-seat rules-engine game can actually reach
 * today (`combo`/`blocker`/`counter` fell through to a bare "…").
 *
 * A prompt whose text names a card, a cost or a count (`chooseCards`,
 * `optionalCost`, `payCost`, `empowerCarry`, `referee`, …) is not here: that
 * text is built from the action being asked about, in each engine's own
 * `questionFor`/`promptView`, the same way it always was — a table cannot
 * hold a sentence that has not been asked yet.
 */
import type { Prompt } from "./engine/types";

export interface PromptWords {
  question: string;
  hint: string | null;
}

/** Every prompt kind whose question and hint are the same words regardless of the situation. */
export const PROMPT_QUESTIONS: Partial<Record<Prompt["kind"], PromptWords>> = {
  chooseFirst: { question: "You won the flip. Who goes first?", hint: "The second player starts with one energy marker." },
  mulligan: { question: "Keep this hand?", hint: "You may redraw six cards once (6-2-1-9)." },
  charge: { question: "Charge one card as energy?", hint: "Tap a card in hand, or skip." },
  main: { question: "Your Main Phase.", hint: "Play cards, attack, or end the turn." },
  combo: { question: "Combo? Tap a glowing card.", hint: "Each adds its combo power and costs its combo cost." },
  blocker: { question: "Block with one of these?", hint: "[Blocker] rests the card and makes it the guard instead." },
  counter: { question: "Play a counter?", hint: "Counter cards are activated from hand and go to the Drop." },
  zEnergyFromCombo: { question: "Send one combo card to Z-Energy?", hint: "At the end of a battle, one card may go there instead of the Drop." },
  offering: { question: "[Offering]: drop one life, or let them draw two?", hint: null },
  orderPending: { question: "Which skill resolves first?", hint: "Several of your skills triggered at once." },
  gameOver: { question: "The game is over.", hint: null },
};
