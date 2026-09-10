import { keywordsInForce, powerOf, type EngineContext, type GameEvent, type GameState, type Op, type PlayerId } from "./engine";
import { toBeats } from "./beats";
import { describeEffect, untilWords } from "./effects";
import { keywordPlays } from "./glossary";
import { narrate } from "./narration";
import type { ProbeOutcome, ProbeRule, ProbeScenario } from "./probe-types";
import { questionFor } from "./view";

const YOU: PlayerId = "p1";
const THEM: PlayerId = "p2";

export interface ProbeStep {
  state: GameState;
  events: GameEvent[];
  ask: string | null;
  chose: string;
  /** What a `chooseCards` prompt was offering, so a card that could not be chosen can be named. */
  candidates: string[] | null;
}

/** The question, said from the chair it is asked in — the probe watches from p1's. */
export function askedQuestion(ctx: EngineContext, s: GameState): string {
  const q = questionFor(ctx, s);
  return q.player && q.player !== YOU ? `the opponent is asked: ${q.question}` : q.question;
}

export function candidatesOf(s: GameState): string[] | null {
  return s.prompt.kind === "chooseCards" ? s.prompt.choice.candidates : null;
}

/** The log, in the board's own words. */
export function logLines(ctx: EngineContext, steps: ProbeStep[], from = 0): string[] {
  const out: string[] = [];
  for (const step of steps.slice(from)) {
    const beats = toBeats(ctx, step.state, step.events, 0);
    for (const b of beats.list) {
      const said = narrate(b, { viewer: YOU, them: "Opponent", art: beats.art, ownerOf: (id) => step.state.cards[id]?.owner ?? null });
      if (said) out.push(said);
    }
  }
  return out;
}

const AREA_WORDS: Record<string, string> = {
  hand: "hand",
  drop: "the Drop",
  battle: "the Battle Area",
  combo: "the Combo Area",
  energy: "the Energy Area",
  life: "life",
  warp: "the Warp",
  unison: "the Unison Area",
  deck: "the deck",
  zDeck: "the Z-Deck",
  zEnergy: "Z-Energy",
  removed: "out of the game",
  leader: "the Leader Area",
};

/** What changed on the board, counted off the events rather than read out one by one. */
export function boardChanges(ctx: EngineContext, steps: ProbeStep[], from: number): string[] {
  const out: string[] = [];
  const drew: Record<PlayerId, number> = { p1: 0, p2: 0 };
  const damage: Record<PlayerId, number> = { p1: 0, p2: 0 };
  const named = (state: GameState, id: string) => {
    const inst = state.cards[id];
    return inst ? (ctx.defs[inst.cardId]?.name ?? inst.cardId) : id;
  };
  const who = (p: PlayerId) => (p === YOU ? "you" : "the opponent");
  for (const step of steps.slice(from)) {
    for (const e of step.events) {
      if (e.type === "draw") drew[e.player]++;
      else if (e.type === "damage") damage[e.player] += e.amount;
      else if (e.type === "ko") out.push(`${named(step.state, e.card)} is KO'd`);
      else if (e.type === "effect") {
        const label = describeEffect(e.effect).label;
        const until = untilWords(e.effect.until, { master: e.effect.master, viewer: YOU, them: "the opponent" });
        out.push(`${e.effect.target ? named(step.state, e.effect.target) : "a rule"}: ${label} ${until}`.trim());
      } else if (e.type === "move" && e.from !== e.to && e.from !== "deck") out.push(`${named(step.state, e.card)} goes from ${AREA_WORDS[e.from] ?? e.from} to ${AREA_WORDS[e.to] ?? e.to}`);
      else if (e.type === "gameOver") out.push(e.winner ? `the game ends: ${who(e.winner)} win` : "the game ends in a draw");
    }
  }
  for (const p of [YOU, THEM] as PlayerId[]) {
    if (drew[p]) out.push(`${who(p)} draw${p === YOU ? "" : "s"} ${drew[p]} card${drew[p] === 1 ? "" : "s"}`);
    if (damage[p]) out.push(`${who(p)} take${p === YOU ? "" : "s"} ${damage[p]} damage`);
  }
  return out;
}

function notesIn(ops: Op[]): string[] {
  const out: string[] = [];
  const walk = (list: unknown[]): void => {
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      if (o.op === "note" && typeof o.text === "string") out.push(o.text);
      for (const v of Object.values(o)) if (Array.isArray(v)) walk(v);
    }
  };
  walk(ops);
  return out;
}

export function assumptionsOf(ctx: EngineContext, s: GameState, card: string, rule: ProbeRule, steps: ProbeStep[]): string[] {
  const out = new Set<string>();
  for (const t of notesIn(rule.ops)) out.add(t);
  for (const step of steps) for (const e of step.events) if (e.type === "note") out.add(e.text);
  for (const clause of rule.unread) out.add(`the compiler could not read "${clause}", so that much of the line does nothing`);
  if (s.cards[card]) {
    for (const k of keywordsInForce(ctx, s, card)) {
      const plays = keywordPlays(k.name);
      if (plays && plays.support === "partial") out.add(`${plays.tag} ${plays.engine}`);
    }
  }
  return [...out];
}

/** Stable over what a run concluded, so two runs of the same scenario can be compared. */
export function digestOf(outcome: string, applied: string[], result: string[]): string {
  let h = 0x811c9dc5;
  for (const ch of [outcome, ...applied, ...result].join(" ")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** A [Permanent] or a keyword is not something that "happens": it is read off the board. */
export function staticReading(ctx: EngineContext, s: GameState, card: string, rule: ProbeRule, keyword: string | null): string[] {
  if (!s.cards[card]) return [];
  if (keyword) {
    const plays = keywordPlays(keyword);
    const inForce = keywordsInForce(ctx, s, card).map((k) => `[${k.name}]`);
    return [plays ? `${plays.tag} — ${plays.engine}` : `[${keyword}] is not a keyword the engine knows`, ...(inForce.length ? [`keywords in force: ${inForce.join(", ")}`] : [])];
  }
  if (s.players[YOU].hand.includes(card)) return ["the card is in hand, where a [Permanent] skill is not valid (9-1-3)"];
  const bare: EngineContext = { defs: ctx.defs, scripts: Object.fromEntries(Object.entries(ctx.scripts ?? {}).filter(([k]) => k !== rule.def.id && k !== `${rule.def.id}#back`)) };
  const out: string[] = [];
  const withRule = powerOf(ctx, s, card);
  const without = powerOf(bare, s, card);
  out.push(withRule === without ? `power on the board: ${withRule}` : `power on the board: ${withRule} — ${without} without this rule`);
  const keywords = keywordsInForce(ctx, s, card);
  if (keywords.length) out.push(`keywords in force: ${keywords.map((k) => `[${k.name}]`).join(", ")}`);
  return out;
}

export const IDLE_PROMPTS = ["main", "charge", "gameOver"] as const;

export const emptyProbe = (scenario: ProbeScenario, outcome: ProbeOutcome, said: string[]) => ({
  scenario,
  input: [],
  applied: [],
  result: said,
  assumptions: [],
  prompts: [],
  log: [],
  outcome,
  digest: digestOf(outcome, [], said),
});
