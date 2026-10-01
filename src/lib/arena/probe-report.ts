import { keywordsInForce as legacyKeywordsInForce, powerOf as legacyPowerOf } from "./engine";
import { specifiedCostUnknown } from "./text/cards";
import { type EngineContext, type GameEvent, type PlayerId } from "./types";
import { type Op } from "./vm/script";
import type { KeywordSkill } from "./types";
import { engineFor, FALLBACK_ENGINE, isVmState, type EngineId, type EngineState } from "./engines";
import { zoneOf } from "./engine-state";
import { rulesetFor, type GameDefinition } from "./rulesets";
import { attrsNow, keywordsInForce as vmKeywordsInForce } from "./vm/program";
import { promptView } from "./vm/view";
import { describeEffect, untilWords } from "./effects";
import { keywordPlays } from "./glossary";
import { narrate } from "./narration";
import type { ProbeOutcome, ProbeRule, ProbeScenario } from "./probe-types";
import { questionFor } from "./view";

/**
 * The rules engine's definition, for the two readings below that the engine
 * does not hand back through `Engine` (a card's power, the keywords in force).
 * Loaded once; a definition that does not load is the probe's own error, which
 * `probe()` reports rather than throwing out of a sweep.
 */
let definition: GameDefinition | null = null;
export function rulesDefinition(): GameDefinition {
  if (definition) return definition;
  const loaded = rulesetFor("dbs");
  if (!loaded.ok) throw new Error(`the DBS ruleset did not load: ${loaded.errors[0]?.message ?? "no reason given"}`);
  return (definition = loaded.definition);
}

/** A card's power on the board, on whichever engine wrote the state. */
export function powerOnBoard(ctx: EngineContext, s: EngineState, id: string): number {
  return isVmState(s) ? Number(attrsNow(ctx, rulesDefinition(), s, id).power ?? 0) : legacyPowerOf(ctx, s, id);
}

/** The keywords a card has in force, on whichever engine wrote the state. */
export function keywordsOnBoard(ctx: EngineContext, s: EngineState, id: string): KeywordSkill[] {
  return isVmState(s) ? vmKeywordsInForce(ctx, rulesDefinition(), s, id) : legacyKeywordsInForce(ctx, s, id);
}

const YOU: PlayerId = "p1";
const THEM: PlayerId = "p2";

export interface ProbeStep {
  state: EngineState;
  events: GameEvent[];
  ask: string | null;
  chose: string;
  /** What a `chooseCards` prompt was offering, so a card that could not be chosen can be named. */
  candidates: string[] | null;
}

/** The question, said from the chair it is asked in — the probe watches from p1's. */
export function askedQuestion(ctx: EngineContext, s: EngineState): string {
  const q = isVmState(s) ? vmQuestion(ctx, s) : questionFor(ctx, s);
  return q.player && q.player !== YOU ? `the opponent is asked: ${q.question}` : q.question;
}

/**
 * The rules engine's prompt view says the fixed questions; a choice names what
 * it is choosing in the prompt itself, which is what the legacy `questionFor`
 * reads too — so the probe's log reads the same on both.
 */
function vmQuestion(ctx: EngineContext, s: Extract<EngineState, { engine: "rules" }>): { player: PlayerId | null; question: string } {
  const pr = s.prompt;
  const nameOf = (id: string) => ctx.defs[s.cards[id]?.cardId ?? ""]?.name ?? id;
  if (pr.kind === "chooseCards") return { player: pr.player, question: pr.choice.reason };
  if (pr.kind === "chooseMode" || pr.kind === "replaceMove") return { player: pr.player, question: pr.reason };
  if (pr.kind === "optionalCost") return { player: pr.player, question: `Pay ${pr.describe} for ${nameOf(pr.card)}?` };
  if (pr.kind === "empowerCarry") return { player: pr.player, question: `[Empower]: carry up to ${pr.max} marker${pr.max === 1 ? "" : "s"} from ${nameOf(pr.from)} to ${nameOf(pr.card)}?` };
  return promptView(s);
}

export function candidatesOf(s: EngineState): string[] | null {
  return s.prompt.kind === "chooseCards" ? s.prompt.choice.candidates : null;
}

/** The log, in the board's own words. */
export function logLines(ctx: EngineContext, steps: ProbeStep[], from = 0, engine: EngineId = FALLBACK_ENGINE): string[] {
  const out: string[] = [];
  for (const step of steps.slice(from)) {
    const beats = engineFor(engine).toBeats(ctx, step.state, step.events, 0);
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
  const named = (state: EngineState, id: string) => {
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

export function assumptionsOf(ctx: EngineContext, s: EngineState, card: string, rule: ProbeRule, steps: ProbeStep[]): string[] {
  const out = new Set<string>();
  for (const t of notesIn(rule.ops)) out.add(t);
  for (const step of steps) for (const e of step.events) if (e.type === "note") out.add(e.text);
  for (const clause of rule.unread) out.add(`the compiler could not read "${clause}", so that much of the line does nothing`);
  // An X cost whose orbs nobody has entered (issue #255): every price on this
  // card's boards is charged as if it demanded no colour, which is lenient
  // rather than the card's, and the record is where that is fixed.
  if (specifiedCostUnknown(rule.def)) out.add(`${rule.def.name}'s specified cost is unknown — the catalog carries no cost orbs and none were entered on the record — so the engine demands no colour for it and any price here is lenient rather than the card's`);
  if (s.cards[card]) {
    for (const k of keywordsOnBoard(ctx, s, card)) {
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
export function staticReading(ctx: EngineContext, s: EngineState, card: string, rule: ProbeRule, keyword: string | null): string[] {
  if (!s.cards[card]) return [];
  if (keyword) {
    const plays = keywordPlays(keyword);
    const inForce = keywordsOnBoard(ctx, s, card).map((k) => `[${k.name}]`);
    return [plays ? `${plays.tag} — ${plays.engine}` : `[${keyword}] is not a keyword the engine knows`, ...(inForce.length ? [`keywords in force: ${inForce.join(", ")}`] : [])];
  }
  if (zoneOf(s, YOU, "hand").includes(card)) return ["the card is in hand, where a [Permanent] skill is not valid (9-1-3)"];
  const bare: EngineContext = { defs: ctx.defs, scripts: Object.fromEntries(Object.entries(ctx.scripts ?? {}).filter(([k]) => k !== rule.def.id && k !== `${rule.def.id}#back`)) };
  const out: string[] = [];
  const withRule = powerOnBoard(ctx, s, card);
  const without = powerOnBoard(bare, s, card);
  out.push(withRule === without ? `power on the board: ${withRule}` : `power on the board: ${withRule} — ${without} without this rule`);
  const keywords = keywordsOnBoard(ctx, s, card);
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
