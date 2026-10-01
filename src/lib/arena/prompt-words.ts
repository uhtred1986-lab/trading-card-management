/**
 * The prompt bar's fixed questions, shared by `view.ts` (legacy) and
 * `vm/view.ts` (rules) — Stage 8, issue #160.
 *
 * The words are `prompts.rules`' (`rulesets/dbs/prompts.rules`, #135): one
 * `DEFINE PROMPT` per `Prompt["kind"]`, read from the loaded definition, so a
 * question edited there reaches the player's prompt bar without a code change.
 * Nothing reads a file at request time — the definition is the generated
 * `files.ts`, parsed once.
 *
 * Both engines answer the same `Prompt` union (`vm/flow.ts`'s own comment:
 * "one union for both engines... a second spelling of the same question would
 * make one client unable to answer both"), so a prompt kind that asks a fixed
 * question — no card, no number, nothing to interpolate — is read in one place
 * rather than two.
 *
 * A prompt whose text names a card, a cost or a count (`chooseCards`,
 * `optionalCost`, `payCost`, `empowerCarry`, `referee`, …) has a *template* in
 * its declaration, in prose, not a hole a program could fill: that question is
 * built from the action being asked about, in each engine's own
 * `questionFor`/`promptView`. Its fixed *hint*, where it has one, is still the
 * declaration's (`promptHint`).
 */
import { loadDbs, type GameDefinition, type PromptDef } from "./rulesets";
import type { Prompt } from "./types";

export interface PromptWords {
  question: string;
  hint: string | null;
}

/** The kinds whose question and hint are the same words regardless of the situation. Which kinds those are is a fact about the engine's prompts, not the game's words, so it is a list here; what they say is the definition's. */
export const FIXED_PROMPT_KINDS = ["chooseFirst", "mulligan", "charge", "main", "combo", "blocker", "counter", "zEnergyFromCombo", "offering", "orderPending", "gameOver"] as const satisfies readonly Prompt["kind"][];

function declared(kind: string, from?: GameDefinition): PromptDef | undefined {
  if (from) return from.prompts[kind];
  const loaded = loadDbs();
  if (!loaded.ok) throw new Error(`the DBS ruleset does not load, so the prompt bar has no words: ${JSON.stringify(loaded.errors[0])}`);
  return loaded.definition.prompts[kind];
}

/** A fixed-question prompt's words (from `from` when a test asks the question of another definition), or undefined for a kind whose question is built at the table. */
export function fixedPrompt(kind: Prompt["kind"], from?: GameDefinition): PromptWords | undefined {
  if (!(FIXED_PROMPT_KINDS as readonly string[]).includes(kind)) return undefined;
  const d = declared(kind, from);
  return d ? { question: d.question, hint: d.hint ?? null } : undefined;
}

/** The hint a declaration carries for a kind whose question is built at the table (null when it carries none). */
export function promptHint(kind: Prompt["kind"]): string | null {
  return declared(kind)?.hint ?? null;
}
