/**
 * Where the engine meets a policy (#644, plan O2-01) — the one module of
 * `policy/` that may read a pinned match.
 *
 * It turns a `PinnedMatch` (`browser.ts`) and a seat into the policy's whole
 * input — the seat's restricted observation and its decisions — and keeps the
 * `DecisionKey` that maps an answer back to a move for the session. A policy
 * (`contract.ts`'s `Policy`) is handed `PolicyInput` and its own RNG state and
 * nothing else: no `EngineState`, no seed, no game RNG, no context, no other
 * seat's hand or deck order. `localStep` (#646) is one whole local decision:
 * input, the local policy under `main.ts`'s cycle guard, and the move played.
 *
 * Browser-safe: this sits on `browser.ts` and the engine-neutral cores, and is
 * an entry of `scripts/verify/arena-browser-boundary.mts`.
 */
import type { Action, GameEvent, PlayerId } from "../types";
import type { GameDefinition } from "../rulesets/types";
import { applyMove, legalMoves, projectSnapshot, type PinnedMatch } from "../browser";
import { rulesetFor } from "../rulesets";
import { IllegalAction } from "../vm/common";
import { owedInFull } from "../vm/script";
import { hiddenAliases, secretAreasOf } from "../conceal";
import { isTokenCard } from "../vm/zones";
import { buildObservation, type AliasTable, type DeckEntry, type PolicyObservation, type SecretAreas } from "./observation";
import { buildDecisions, resolveAnswer, type DecisionKey, type Policy, type PolicyInput, type RefusalReason } from "./contract";
import { guardedDecide, type LocalMemory } from "./main";


function definitionOf(match: PinnedMatch): GameDefinition {
  const pinned = match.ctx.rulesetDefinition;
  if (pinned?.id === match.state.game) return pinned;
  const loaded = rulesetFor(match.state.game);
  if (!loaded.ok) throw new Error(`the ${match.state.game} ruleset does not load, so no observation can say what is hidden`);
  return loaded.definition;
}

/** The areas of each side `seat` may not read, by the ruleset's own visibility declarations (3-1-3). */
export function secretAreas(game: GameDefinition, seat: PlayerId): SecretAreas {
  return secretAreasOf(game, seat);
}

/**
 * Every card instance `seat` may not read, aliased by where it lies: its
 * owner, its zone and its index there (`?p2:hand:3`, `?p1:deck:0`). The
 * online board uses the very same table (`conceal.ts`, where it is built).
 */
export function aliasTable(match: PinnedMatch, seat: PlayerId): AliasTable {
  return hiddenAliases(match.state, seat, definitionOf(match));
}

/** The seat's own decklist as counts — leader, main deck and Z-Deck as dealt; tokens are not in a decklist. */
export function ownDeck(match: PinnedMatch, seat: PlayerId): DeckEntry[] {
  const counts = new Map<string, number>();
  for (const card of Object.values(match.state.cards)) {
    if (card.owner !== seat || isTokenCard(card.cardId)) continue;
    counts.set(card.cardId, (counts.get(card.cardId) ?? 0) + 1);
  }
  return [...counts].map(([cardId, count]) => ({ cardId, count }));
}

/**
 * Which engine question a `chooseCards` prompt is: its asker, its continuation
 * and the program step that put it. A multi-card choice asks the same question
 * once per card ("(2 more)"); a different one is a different question.
 */
function questionOf(match: PinnedMatch): string | null {
  const pr = match.state.prompt;
  if (pr.kind !== "chooseCards" || match.state.phase === "over") return null;
  const frame = match.state.programs[0];
  return JSON.stringify([pr.player, pr.choice.continuation, frame?.card ?? null, frame?.skillIndex ?? null, frame?.ip ?? null]);
}

/**
 * The open card choice, as the contract's compound pick describes it. How
 * many cards are still owed is read off the waiting `choose` step when it is a
 * plain count (`vm/script.ts`'s `want` less the cards already taken); a bound
 * read off the board or a sum leaves it unsaid (null).
 */
function cardQuestion(match: PinnedMatch): NonNullable<Parameters<typeof buildDecisions>[0]["choice"]> | null {
  const pr = match.state.prompt;
  if (pr.kind !== "chooseCards") return null;
  const frame = match.state.programs[0];
  const op = frame && frame.awaiting === pr.choice.continuation ? frame.ops[frame.ip] : undefined;
  // Named sets narrow the legal pool after each pick (slot and power), so
  // their dependent count must be answered one fresh engine offer at a time.
  const plain = op && op.op === "choose" && op.as === pr.choice.continuation && !op.namedSet && op.atMost === undefined && op.sumTo === undefined;
  const remaining = plain ? Math.max(0, (op.sel.count ?? 1) - (frame.vars[op.as]?.length ?? 0)) : null;
  return {
    reason: pr.choice.reason,
    candidates: [...pr.choice.candidates],
    // #720: a choice a taken voluntary substitute owes in full is exact.
    upTo: plain ? (!!op.sel.upTo && !owedInFull(frame, op)) || op.atMost !== undefined : pr.choice.min === 0,
    remaining,
    question: questionOf(match)!,
    ...(pr.choice.cover?.length ? { cover: [...pr.choice.cover] } : {}),
  };
}

export interface PolicyTurn {
  /** What the policy is given. */
  input: PolicyInput;
  /** What the session keeps to resolve the policy's answer. */
  key: DecisionKey;
}

/**
 * The policy's input for `seat` at this position, and the session's key.
 * `revision` must change with every move applied to the match (the session's
 * move count): it is what makes an answer to an earlier position stale even
 * when the board looks the same.
 */
export function policyTurn(match: PinnedMatch, seat: PlayerId, revision: number): PolicyTurn {
  const aliases = aliasTable(match, seat);
  const game = definitionOf(match);
  const snapshot = projectSnapshot(match, seat, { revision });
  const observation: PolicyObservation = buildObservation(snapshot, seat, ownDeck(match, seat), aliases, secretAreas(game, seat));
  const prompt = match.state.prompt;
  const actor = "player" in prompt ? prompt.player : null;
  const over = match.state.phase === "over";
  const choice = prompt.kind === "chooseCards" && actor === seat && !over ? cardQuestion(match) : null;
  const { decisions, key } = buildDecisions({
    seat,
    revision,
    observation,
    window: over ? "gameOver" : prompt.kind,
    actor: over ? null : actor,
    legal: over || actor !== seat ? [] : legalMoves(match),
    choice,
    aliases,
  });
  return { input: { observation, decisions }, key };
}

export type DecisionOutcome =
  | { ok: true; match: PinnedMatch; events: GameEvent[]; id: string }
  | { ok: false; reason: RefusalReason | "refused"; detail: string };

/**
 * Resolve a policy's answer against the key and play it, all or nothing.
 *
 * A menu decision is one engine move. A compound pick is one `choose` per
 * card, each played only while the engine is still asking the same question
 * and still offers that card; an "up to" pick that leaves the question open is
 * closed with "Choose none" (5-2-4), and an exact pick whose count the engine
 * did not say leaves it open for the next decision. Anything the engine
 * refuses — a card no longer offered, a namesake under "different names", an
 * [Aegis] colour cover (22-30-3) — comes back as `refused`, and the match
 * passed in is unchanged either way (`applyMove` never mutates its input).
 */
export function applyDecision(match: PinnedMatch, key: DecisionKey, answer: unknown): DecisionOutcome {
  const resolved = resolveAnswer(key, answer);
  if (!resolved.ok) return resolved;
  let at = match;
  const events: GameEvent[] = [];
  const play = (action: Action) => {
    const next = applyMove(at, action);
    at = next.match;
    events.push(...next.events);
  };
  try {
    for (const [i, action] of resolved.actions.entries()) {
      if (i > 0 || resolved.question) {
        const still = questionOf(at) === resolved.question;
        if (resolved.question && !still) return { ok: false, reason: "refused", detail: `the choice closed after ${i} of ${resolved.actions.length} card(s)` };
        const offered = (at.state.prompt as { choice?: { candidates: string[] } }).choice?.candidates ?? [];
        const card = (action as { cards?: string[] }).cards?.[0];
        if (resolved.question && card !== undefined && !offered.includes(card)) return { ok: false, reason: "refused", detail: `card ${i + 1} of the pick is no longer offered` };
      }
      play(action);
    }
    if (resolved.close && questionOf(at) === resolved.question) play(resolved.close);
    return { ok: true, match: at, events, id: resolved.id };
  } catch (error) {
    if (error instanceof IllegalAction) return { ok: false, reason: "refused", detail: error.message };
    throw error;
  }
}

export type LocalStep =
  | { ok: true; match: PinnedMatch; events: GameEvent[]; id: string; memory: LocalMemory; guard: string | null }
  | { ok: false; reason: RefusalReason | "refused" | "interrupted" | "notAsked"; detail: string; memory: LocalMemory };

/**
 * One local decision for `seat` (#646): its input, the local policy's answer
 * under the cycle guard (`main.ts`), and the move played — the whole of what a
 * local session does per decision. The policy sees the `PolicyInput` and its
 * own memory (RNG included) and nothing else; `memory` comes back advanced
 * whether or not the move was played. A guard that finds no way to end the turn,
 * a policy that throws `PolicyInterruption` (#650: a question no handler reads),
 * and a referee question interrupt (`interrupted`) and the match is left as it
 * was: no move and no result is invented.
 */
export function localStep(match: PinnedMatch, seat: PlayerId, revision: number, memory: LocalMemory, policy: Policy): LocalStep {
  const turn = policyTurn(match, seat, revision);
  // #650: a question the seat is asked but no decision can answer (a referee program) is a typed interruption.
  if (turn.input.decisions.actor === seat && turn.input.decisions.unsupported) return { ok: false, reason: "interrupted", detail: `unsupported decision: ${turn.input.decisions.unsupported}`, memory };
  if (turn.input.decisions.actor !== seat || !turn.input.decisions.decisions.length) return { ok: false, reason: "notAsked", detail: `${seat} has no decision to make`, memory };
  const decided = guardedDecide(policy, turn.input, memory);
  if (!decided.ok) return { ok: false, reason: "interrupted", detail: decided.interrupted, memory: decided.memory };
  const played = applyDecision(match, turn.key, decided.answer);
  if (!played.ok) return { ...played, memory: decided.memory };
  return { ...played, memory: decided.memory, guard: decided.guard };
}
