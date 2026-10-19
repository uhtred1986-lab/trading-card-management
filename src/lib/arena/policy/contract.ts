/**
 * The legal-decision contract between the engine and a local policy (#644,
 * plan O2-01).
 *
 * A policy is a pure function of three things and nothing else:
 *
 *   - the seat's restricted observation (`observation.ts`);
 *   - the decisions open to that seat now (`PolicyDecisions`): every move the
 *     engine's own legal list offers, as a **menu** decision with a stable id,
 *     plus — for a "choose up to N" question (5-2) — one **compound** `pick`
 *     decision whose answer is a set of cards the contract validates against
 *     the question's own constraints;
 *   - its own randomness (`rng.ts`), never the game's.
 *
 * It answers with a `PolicyAnswer` naming one decision. The session — never the
 * policy — holds the `DecisionKey` that maps an answer back to the engine's
 * `Action`, and `resolveAnswer` refuses an answer that is malformed, for
 * another seat (foreign), for an earlier position (stale), or names a decision
 * that is not open. Ids are derived from the moves themselves (with hidden
 * instance ids replaced by their positional aliases), so the same position
 * gives the same ids however the hidden cards lie, and the whole decision set
 * survives a JSON round trip (a worker message, an IndexedDB record).
 *
 * This is the same shape the online opponent already has — Claude picks a
 * number from the menu the engine computed (`ai/opponent.ts`) — made
 * provider-independent, seat-checked and serialisable. It does not replace that
 * path: the online opponent is unchanged.
 *
 * Policy layer: value imports only from `src/lib/arena/policy/` (checked by
 * `scripts/verify/arena-policy-contract.mts`).
 */
import type { Action, ActionCost, BattleActivationSummary, CounterResponseSummary, LegalAction, PlayerId, Prompt } from "../types";
import { aliasIds, type AliasTable, type PolicyObservation } from "./observation";
import { nextInt, type PolicyRng } from "./rng";

export const DECISION_VERSION = 1;

/**
 * Every action type a policy may be offered as a menu move. `refereeRuling`
 * (a program for a skill the compiler could not read — Claude's job online,
 * and outside the local MVP) and `concede` (a button, never on the engine's
 * list) are the only two left out; the type below fails to compile if the
 * engine grows an action type that is in neither list.
 */
export const MENU_ACTION_TYPES = [
  "chooseFirst", "mulligan", "charge", "play", "playUnison", "playZ", "growUnison", "activate", "attack", "endMain",
  "combo", "pass", "block", "counter", "orderPending", "optionalCost", "payCost", "choose", "chooseMode",
  "zEnergyFromCombo", "offering", "empowerCarry",
] as const;
export type MenuActionType = (typeof MENU_ACTION_TYPES)[number];
type NotOffered = "refereeRuling" | "concede";
type UnclassifiedAction = Exclude<Action["type"], MenuActionType | NotOffered>;
/** Compile-time: every engine action type is either offered to a policy or deliberately not. */
export const ACTION_TYPES_CLASSIFIED: [UnclassifiedAction] extends [never] ? true : UnclassifiedAction = true;

/**
 * Every engine question a policy can be asked. `referee` is answered by a
 * program, not by a choice (see above), and `gameOver` asks nothing.
 */
export const DECISION_WINDOWS = [
  "chooseFirst", "mulligan", "charge", "main", "combo", "blocker", "counter", "orderPending", "chooseCards", "chooseMode",
  "replaceMove", "zEnergyFromCombo", "optionalCost", "payCost", "offering", "empowerCarry",
] as const;
export type DecisionWindow = (typeof DECISION_WINDOWS)[number];
type UnclassifiedWindow = Exclude<Prompt["kind"], DecisionWindow | "referee" | "gameOver">;
export const PROMPT_KINDS_CLASSIFIED: [UnclassifiedWindow] extends [never] ? true : UnclassifiedWindow = true;

/** One move off the engine's legal list. `action` is the engine's own, hidden ids aliased; `player` is the seat. */
export interface MenuDecision {
  kind: "menu";
  id: string;
  type: MenuActionType;
  label: string;
  action: Record<string, unknown>;
  cost?: ActionCost;
  battleActivation?: BattleActivationSummary;
  counterResponse?: CounterResponseSummary;
}

/**
 * A "choose N" / "choose up to N" question (5-2) answered with the whole set at
 * once. The rules engine asks such a question one card per answer (the menu
 * offers each card, and "Choose none" while the choice may stop), so the set is
 * played as that sequence of answers — and is refused, with the match left as
 * it was, the moment the engine's question no longer takes the next card.
 */
export interface PickDecision {
  kind: "pick";
  id: typeof PICK_ID;
  reason: string;
  /** The cards the question offers now. */
  candidates: string[];
  /** May the choice stop short — "up to" (5-2-4)? Then an empty pick declines. */
  upTo: boolean;
  /** Cards still to choose, when the engine's question says; null when it is bounded by something else (a sum, a count read off the board). */
  remaining: number | null;
  /** 22-30-3: the picks must between them cover these colours; the engine checks it. */
  cover?: string[];
}

export type Decision = MenuDecision | PickDecision;

export const PICK_ID = "pick";

/** What a policy is shown about its options. Everything in it is the seat's to know. */
export interface PolicyDecisions {
  v: typeof DECISION_VERSION;
  seat: PlayerId;
  /** Who the engine is asking; the seat has decisions only when it is the actor. */
  actor: PlayerId | null;
  window: string;
  /** The position this set belongs to; an answer quoting another is stale. */
  at: string;
  decisions: Decision[];
  /** Why there are no decisions although the seat is asked (a referee question). */
  unsupported?: string;
}

/** The session's half: how each decision id becomes the engine's move. Never handed to a policy. */
export interface DecisionKey {
  v: typeof DECISION_VERSION;
  seat: PlayerId;
  actor: PlayerId | null;
  at: string;
  menu: Record<string, Action>;
  /** `question` identifies the engine question the pick answers, so a sequence never spills into the next one. */
  pick: { candidates: Record<string, string>; upTo: boolean; remaining: number | null; question: string } | null;
}

export interface PolicyAnswer {
  v: typeof DECISION_VERSION;
  seat: PlayerId;
  at: string;
  id: string;
  /** Only for the `pick` decision: the cards chosen, by the ids/aliases it listed. */
  cards?: string[];
}

export type RefusalReason = "malformed" | "foreign" | "stale" | "unknown" | "invalid";
/**
 * A resolved answer: the engine moves to play, in order. A menu decision is one
 * move. A pick is one `choose` per card, each to be played only while the
 * engine is still asking `question`; `close` ends an "up to" choice the picks
 * left open.
 */
export type Resolution =
  | { ok: true; id: string; actions: Action[]; question?: string; close?: Action }
  | { ok: false; reason: RefusalReason; detail: string };

export interface PolicyInput {
  observation: PolicyObservation;
  decisions: PolicyDecisions;
}

/** A local policy: a pure function of what the seat may know and its own randomness. */
export type Policy = (input: PolicyInput, rng: PolicyRng) => { answer: PolicyAnswer; rng: PolicyRng };

/** Canonical JSON: object keys sorted, `undefined` members dropped. */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : stableJson(v))).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
}

/** A 53-bit string hash (cyrb53), as 14 hex digits. Synchronous and dependency-free; not a security boundary. */
export function fingerprint(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(14, "0");
}

const isMenuType = (t: string): t is MenuActionType => (MENU_ACTION_TYPES as readonly string[]).includes(t);

export interface DecisionInput {
  seat: PlayerId;
  /** The match's move count (or any value that changes with every applied move). */
  revision: number;
  observation: PolicyObservation;
  /** The engine's prompt kind and actor. */
  window: string;
  actor: PlayerId | null;
  /** The engine's legal list, in the engine's words (real instance ids). */
  legal: LegalAction[];
  /** The open `chooseCards` question, when there is one, in real ids. */
  choice: { reason: string; candidates: string[]; upTo: boolean; remaining: number | null; question: string; cover?: string[] } | null;
  aliases: AliasTable;
}

/**
 * The decisions and their key, for one seat at one position. Pure: the
 * boundary (`boundary.ts`) supplies the engine's legal list and the alias table.
 */
export function buildDecisions(input: DecisionInput): { decisions: PolicyDecisions; key: DecisionKey } {
  const { seat, actor, aliases } = input;
  const mine = actor === seat;
  const menu: Record<string, Action> = {};
  const listed: Decision[] = [];
  let pick: DecisionKey["pick"] = null;
  if (mine) {
    for (const legal of input.legal) {
      const type = legal.action.type;
      if (!isMenuType(type) || legal.action.player !== seat) continue;
      const { player: _player, ...args } = legal.action as Action & Record<string, unknown>;
      void _player;
      const shown = aliasIds(args as Record<string, unknown>, aliases);
      const id = `m:${type}:${stableJson(shown)}`;
      if (menu[id]) continue; // the engine listed the same move twice; one decision
      menu[id] = legal.action;
      const masked = stableJson(shown) !== stableJson(args);
      listed.push({
        kind: "menu",
        id,
        type,
        // A label names cards by name ("Choose Son Goku"); one that names a card the seat cannot read is reworded.
        label: masked ? `${type} ${Object.values(shown).filter((v) => typeof v === "string" && v.startsWith("?")).join(", ")}`.trim() : legal.label,
        action: shown,
        ...(legal.cost ? { cost: legal.cost } : {}),
        ...(legal.battleActivation ? { battleActivation: { ...legal.battleActivation, power: { ...legal.battleActivation.power } } } : {}),
        ...(legal.counterResponse ? { counterResponse: { ...legal.counterResponse } } : {}),
      });
    }
    listed.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (input.window === "chooseCards" && input.choice) {
      const { reason, upTo, remaining, question, cover } = input.choice;
      const candidates: Record<string, string> = {};
      for (const real of input.choice.candidates) candidates[aliasIds(real, aliases)] = real;
      pick = { candidates, upTo, remaining, question };
      listed.push({ kind: "pick", id: PICK_ID, reason: aliasedText(reason, aliases), candidates: Object.keys(candidates).sort(), upTo, remaining, ...(cover?.length ? { cover: [...cover] } : {}) });
    }
  }
  const unsupported = mine && input.window === "referee" ? "a referee question is answered with a program, not a decision" : undefined;
  const body = { v: DECISION_VERSION, seat, actor, window: input.window, decisions: listed, ...(unsupported ? { unsupported } : {}) };
  const at = fingerprint(stableJson({ seat, revision: input.revision, observation: input.observation, decisions: body }));
  return {
    decisions: { ...body, at } as PolicyDecisions,
    key: { v: DECISION_VERSION, seat, actor, at, menu, pick },
  };
}

const refuse = (reason: RefusalReason, detail: string): Resolution => ({ ok: false, reason, detail });

/**
 * Map an answer back to the engine's move, or say why not. The order of the
 * checks is the order of the questions: is this an answer at all, is it this
 * seat's, is it about this position, and is it one of the decisions open.
 */
export function resolveAnswer(key: DecisionKey, answer: unknown): Resolution {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) return refuse("malformed", "an answer is an object");
  const a = answer as Partial<PolicyAnswer> & Record<string, unknown>;
  if (a.v !== DECISION_VERSION) return refuse("malformed", `answer version ${String(a.v)} is not ${DECISION_VERSION}`);
  if (typeof a.seat !== "string" || typeof a.at !== "string" || typeof a.id !== "string") return refuse("malformed", "an answer names its seat, position and decision");
  if (a.cards !== undefined && (!Array.isArray(a.cards) || a.cards.some((c) => typeof c !== "string"))) return refuse("malformed", "cards is a list of card ids");
  if (a.seat !== key.seat) return refuse("foreign", `an answer for ${a.seat} offered to ${key.seat}'s decisions`);
  if (key.actor !== key.seat) return refuse("foreign", `${key.seat} is not being asked (${key.actor ?? "nobody"} is)`);
  if (a.at !== key.at) return refuse("stale", `the answer is for position ${a.at}, the position is ${key.at}`);
  if (a.id === PICK_ID) {
    const pick = key.pick;
    if (!pick) return refuse("unknown", "no card choice is open");
    if (a.cards === undefined) return refuse("invalid", "a pick names its cards");
    const cards = a.cards;
    if (new Set(cards).size !== cards.length) return refuse("invalid", "a card is picked twice");
    const unknown = cards.find((c) => !Object.prototype.hasOwnProperty.call(pick.candidates, c));
    if (unknown !== undefined) return refuse("invalid", `${unknown} is not a candidate`);
    if (!pick.upTo && cards.length === 0) return refuse("invalid", "this choice cannot be declined (5-2-4 applies to an \"up to\" only)");
    if (pick.remaining !== null && cards.length > pick.remaining) return refuse("invalid", `pick at most ${pick.remaining} card(s) (got ${cards.length})`);
    // 5-2-5: an exact choice takes as many as it can — all it asks for, or every candidate when fewer are offered.
    const owed = pick.remaining === null ? null : Math.min(pick.remaining, Object.keys(pick.candidates).length);
    if (!pick.upTo && owed !== null && cards.length !== owed) return refuse("invalid", `this choice takes exactly ${owed} card(s) (got ${cards.length})`);
    const choose = (ids: string[]): Action => ({ type: "choose", player: key.seat, cards: ids });
    return {
      ok: true,
      id: PICK_ID,
      actions: cards.map((c) => choose([pick.candidates[c]])),
      question: pick.question,
      ...(pick.upTo ? { close: choose([]) } : {}),
    };
  }
  const action = Object.prototype.hasOwnProperty.call(key.menu, a.id) ? key.menu[a.id] : undefined;
  if (!action) return refuse("unknown", `no open decision is called ${a.id}`);
  if (a.cards !== undefined) return refuse("invalid", "a menu decision takes no cards");
  return { ok: true, id: a.id, actions: [JSON.parse(JSON.stringify(action)) as Action] };
}

/** A reason or label naming a hidden card by its instance id ("Choose p2#10") is reworded with the alias. */
function aliasedText(text: string, aliases: AliasTable): string {
  return text.replace(/\bp[12]#[0-9A-Za-z:_-]+/g, (id) => (Object.prototype.hasOwnProperty.call(aliases, id) ? aliases[id] : id));
}

/** The answer to `decision`, for these decisions. */
export function answerFor(decisions: PolicyDecisions, id: string, cards?: string[]): PolicyAnswer {
  return { v: DECISION_VERSION, seat: decisions.seat, at: decisions.at, id, ...(cards ? { cards: [...cards] } : {}) };
}

/**
 * A question the local policy cannot answer (#650): thrown by a policy, caught
 * by the cycle guard (`main.ts`'s `guardedDecide`) and returned as an
 * interruption, so the session stops with the reason instead of a guessed move.
 * Never a model call and never a silent pass.
 */
export class PolicyInterruption extends Error {
  readonly kind = "policyInterruption" as const;
  constructor(readonly window: string, readonly reason: string) {
    super(`${window}: ${reason}`);
    this.name = "PolicyInterruption";
  }
}

/** The fallback of a policy that guesses nothing: every question it reaches interrupts. */
export const interruptingPolicy: Policy = (input) => {
  throw new PolicyInterruption(input.decisions.window, `no local handler answers this ${input.decisions.window} question (${input.decisions.decisions.length} decision(s) open)`);
};

/**
 * The reference policy: every open decision equally likely, and for a pick a
 * uniformly random legal set size and set. No strength at all — it exists to
 * prove the contract end to end (and is the floor O2-06 measures against).
 */
export const uniformPolicy: Policy = (input, rng) => {
  const open = input.decisions.decisions;
  if (input.decisions.actor !== input.decisions.seat || !open.length) throw new Error(`${input.decisions.seat} has no decision to make`);
  const chosen = nextInt(rng, open.length);
  let next = chosen.rng;
  const decision = open[chosen.value];
  if (decision.kind === "menu") return { answer: answerFor(input.decisions, decision.id), rng: next };
  // A set size the question allows: an exact choice takes what it owes (one card at a time when
  // the engine does not say how many), an "up to" anything from none to that.
  const most = Math.min(decision.remaining ?? 1, decision.candidates.length);
  let count = most;
  if (decision.upTo) {
    const size = nextInt(next, most + 1);
    next = size.rng;
    count = size.value;
  }
  const pool = [...decision.candidates];
  const cards: string[] = [];
  for (let i = 0; i < count; i++) {
    const at = nextInt(next, pool.length);
    next = at.rng;
    cards.push(pool.splice(at.value, 1)[0]);
  }
  return { answer: answerFor(input.decisions, decision.id, cards), rng: next };
};
