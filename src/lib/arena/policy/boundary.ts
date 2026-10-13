/**
 * Where the engine meets a policy (#644, plan O2-01) — the one module of
 * `policy/` that may read a pinned match.
 *
 * It turns a `PinnedMatch` (`browser.ts`) and a seat into the policy's whole
 * input — the seat's restricted observation and its decisions — and keeps the
 * `DecisionKey` that maps an answer back to a move for the session. A policy
 * (`contract.ts`'s `Policy`) is handed `PolicyInput` and its own RNG state and
 * nothing else: no `EngineState`, no seed, no game RNG, no context, no other
 * seat's hand or deck order.
 *
 * Browser-safe: this sits on `browser.ts` and the engine-neutral cores, and is
 * an entry of `scripts/verify/arena-browser-boundary.mts`.
 */
import type { Action, GameEvent, PlayerId } from "../types";
import type { GameDefinition } from "../rulesets/types";
import { applyMove, legalMoves, projectSnapshot, type PinnedMatch } from "../browser";
import { rulesetFor } from "../rulesets";
import { IllegalAction } from "../vm/common";
import { vmRevealedTo } from "../vm/view";
import { isTokenCard } from "../vm/zones";
import { buildObservation, type AliasTable, type DeckEntry, type PolicyObservation, type SecretAreas } from "./observation";
import { buildDecisions, resolveAnswer, type DecisionKey, type PolicyInput, type RefusalReason } from "./contract";

const SEATS: PlayerId[] = ["p1", "p2"];

function definitionOf(match: PinnedMatch): GameDefinition {
  const pinned = match.ctx.rulesetDefinition;
  if (pinned?.id === match.state.game) return pinned;
  const loaded = rulesetFor(match.state.game);
  if (!loaded.ok) throw new Error(`the ${match.state.game} ruleset does not load, so no observation can say what is hidden`);
  return loaded.definition;
}

/** The areas of each side `seat` may not read, by the ruleset's own visibility declarations (3-1-3). */
export function secretAreas(game: GameDefinition, seat: PlayerId): SecretAreas {
  const of = (p: PlayerId) => Object.entries(game.zones)
    .filter(([, z]) => { const v = z.visibility ?? "none"; return !(v === "all" || (v === "owner" && p === seat) || (v === "opponent" && p !== seat)); })
    .map(([name]) => name)
    .sort();
  return { p1: of("p1"), p2: of("p2") };
}

/**
 * Every card instance `seat` may not read, aliased by where it lies: its
 * owner, its zone and its index there (`?p2:hand:3`, `?p1:deck:0`). A card in
 * no zone (one under another, when that pile is closed) is `?p2:under:<n>`,
 * numbered in its host's order. Positions are public; which card holds one is
 * not, so two positions that differ only in hidden cards alias the same.
 */
export function aliasTable(match: PinnedMatch, seat: PlayerId): AliasTable {
  const game = definitionOf(match);
  const visible = vmRevealedTo(game, match.state, seat);
  const out: Record<string, string> = {};
  const placed = new Set<string>();
  for (const p of SEATS) {
    const zones = match.state.sides[p].zones;
    for (const zone of Object.keys(zones).sort()) {
      (zones[zone] ?? []).forEach((id, i) => {
        placed.add(id);
        if (!visible.has(id)) out[id] = `?${p}:${zone}:${i}`;
      });
    }
  }
  const under: Record<PlayerId, number> = { p1: 0, p2: 0 };
  for (const p of SEATS) {
    for (const zone of Object.keys(match.state.sides[p].zones).sort()) {
      for (const host of match.state.sides[p].zones[zone] ?? []) {
        for (const id of match.state.cards[host]?.under ?? []) {
          placed.add(id);
          if (!visible.has(id)) out[id] = `?${p}:under:${under[p]++}`;
        }
      }
    }
  }
  // Anything left (a card the engine keeps outside every zone) is hidden unless shown; never named by its id.
  const rest = Object.keys(match.state.cards).filter((id) => !placed.has(id) && !visible.has(id)).sort();
  rest.forEach((id, i) => (out[id] = `?${match.state.cards[id].owner}:elsewhere:${i}`));
  return out;
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
  const plain = op && op.op === "choose" && op.as === pr.choice.continuation && op.atMost === undefined && op.sumTo === undefined;
  const remaining = plain ? Math.max(0, (op.sel.count ?? 1) - (frame.vars[op.as]?.length ?? 0)) : null;
  return {
    reason: pr.choice.reason,
    candidates: [...pr.choice.candidates],
    upTo: plain ? !!op.sel.upTo || op.atMost !== undefined : pr.choice.min === 0,
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
