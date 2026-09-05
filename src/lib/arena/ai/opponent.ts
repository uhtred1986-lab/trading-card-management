/**
 * Claude as the opponent.
 *
 * The engine decides what is legal; Claude only decides what is wise. It is
 * never asked to invent a move — it picks a number from a menu the engine
 * computed, so an answer can be wrong but never illegal.
 *
 * What keeps the cost down, in the order it matters:
 *   1. Decisions that cannot go wrong never reach the API at all — one legal
 *      move, the opening coin flip, the mulligan, which card to charge.
 *   2. The rules primer and Claude's own decklist sit in a cached system
 *      prompt with a one-hour lifetime, so a game with pauses in it still
 *      pays a tenth of the price for them.
 *   3. Only the state delta is sent per decision, and only the text of cards
 *      that can actually act.
 *   4. The answer is a number plus at most one line of table talk.
 *   5. Two tiers: Sparring runs everything on Haiku 4.5; Tournament sends the
 *      Main Phase and counter windows to Opus 5 (the owner's choice).
 */
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Db } from "@/db";
import { FAST_MODEL, MODEL, anthropic, hasAnthropic, recordRun } from "@/lib/ai/client";
import { validateProgram, type EngineContext, type GameState, type LegalAction, type Op, type PlayerId } from "../engine";
import { def } from "../engine/state";
import { decklistText, movesText, stateText } from "./view";

export type Tier = "sparring" | "tournament";

export interface Choice {
  index: number;
  /** One line of table talk, or null when no model was asked. */
  say: string | null;
  /** Null when the decision was taken without an API call. */
  spend: { model: string; input: number; output: number; cached: number } | null;
  /** Why it was decided this way, for the log. */
  how: string;
}

const RULES_PRIMER = `You are playing the Dragon Ball Super Card Game (Masters) against a human, through a rules engine.

How a turn goes: Charge Phase (everything untaps, you draw, you may place one card from hand into your energy) → Main Phase (play cards, activate skills, attack, then end) → End Phase.

Attacking: switch an active card to Rest Mode to attack the opposing Leader, their Unison, or one of their Battle Cards that is already rested. Both sides may then add Combo Power from hand or from active Battle Cards; the attacker wins ties. A beaten Battle Card is KO'd; a beaten Leader loses life, which goes to that player's hand unless the attacker has [Critical].

Winning: your opponent loses when their life or their deck runs out.

What matters, roughly in order: do not let your life run out; trade up in power; keep energy of the colours you still need; a card in hand that you cannot pay for is worth less than the energy it would have been; life in the Drop is gone, life in hand is a card.

The engine enforces every rule. You will be given a numbered list of the only moves that are currently legal. Answer with one of those numbers.`;

const MoveSchema = z.object({
  move: z.number().int().describe("The number of the move you choose, from the list"),
  say: z.string().max(120).describe("At most one short sentence of table talk, in character. May be empty."),
});

/**
 * The static half of the prompt, cached for an hour so a game with pauses in
 * it still pays a tenth for it.
 *
 * Measured on 4 Sep 2026: this comes to roughly 3,200 tokens for a 50-card
 * deck. That is comfortably over Opus 5's 512-token minimum, so Tournament
 * games cache — about 45 % of input tokens were served from cache in testing.
 * It is under Haiku 4.5's 4,096-token minimum, so Sparring games do not cache
 * at all and pay full price for the prefix every decision. Haiku input is a
 * fifth of Opus's, so a Sparring decision still costs less; padding the prompt
 * to trip the threshold would be a worse trade than paying for it.
 */
function systemBlocks(ctx: EngineContext, s: GameState, p: PlayerId) {
  return [
    { type: "text" as const, text: RULES_PRIMER },
    {
      type: "text" as const,
      text: `YOUR DECK (${s.players[p].name}):\n${decklistText(ctx, s, p)}`,
      cache_control: { type: "ephemeral" as const, ttl: "1h" as const },
    },
  ];
}

// ── decisions the engine can take on its own ───────────────────────────────

/**
 * A card to charge (7-2-11). Charging is nearly always right and the choice is
 * rarely sharp, so a rule does it: give up the card you are least likely to
 * play — the most expensive one, preferring a colour the leader cannot pay for.
 */
function chargeChoice(ctx: EngineContext, s: GameState, legal: LegalAction[], p: PlayerId): number | null {
  const leaderColors = s.players[p].leader ? def(ctx, s, s.players[p].leader).colors : [];
  const scored = legal
    .map((l, i) => ({ i, card: l.action.type === "charge" ? l.action.card : null }))
    .filter((x) => x.card)
    .map((x) => {
      const d = def(ctx, s, x.card!);
      const cost = typeof d.energyCost === "number" ? d.energyCost : 9;
      const offColour = d.colors.some((c) => !leaderColors.includes(c)) ? 10 : 0;
      return { i: x.i, score: cost + offColour };
    });
  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score);
  return scored[0].i;
}

/** Keep an opening hand that can act early; otherwise take the one redraw (6-2-1-9). */
function mulliganChoice(ctx: EngineContext, s: GameState, legal: LegalAction[], p: PlayerId): number | null {
  const cheap = s.players[p].hand.filter((id) => {
    const c = def(ctx, s, id).energyCost;
    return typeof c === "number" && c <= 2;
  }).length;
  const wantRedraw = cheap < 2 && !s.players[p].mulliganed;
  const i = legal.findIndex((l) => l.action.type === "mulligan" && l.action.redraw === wantRedraw);
  return i >= 0 ? i : null;
}

/** Decisions taken without spending anything. Returns the chosen index, or null to ask. */
function freeChoice(ctx: EngineContext, s: GameState, legal: LegalAction[], p: PlayerId): { index: number; how: string } | null {
  if (legal.length === 1) return { index: 0, how: "only one legal move" };
  const kind = s.prompt.kind;
  if (kind === "chooseFirst") {
    const i = legal.findIndex((l) => l.action.type === "chooseFirst" && l.action.first === p);
    return i >= 0 ? { index: i, how: "takes the first turn" } : null;
  }
  if (kind === "mulligan") {
    const i = mulliganChoice(ctx, s, legal, p);
    return i == null ? null : { index: i, how: "opening hand rule" };
  }
  if (kind === "charge") {
    const i = chargeChoice(ctx, s, legal, p);
    return i == null ? null : { index: i, how: "charge rule" };
  }
  if (kind === "zEnergyFromCombo") {
    // Free value: a combo card that would go to the Drop becomes Z-Energy instead.
    const i = legal.findIndex((l) => l.action.type === "zEnergyFromCombo" && l.action.card);
    return i >= 0 ? { index: i, how: "keeps the Z-Energy" } : null;
  }
  return null;
}

/** Tournament sends the decisions that shape a turn to the stronger model. */
function modelFor(tier: Tier, s: GameState): { model: string; effort?: "low" | "medium" } {
  if (tier === "sparring") return { model: FAST_MODEL };
  const heavy = s.prompt.kind === "main" || s.prompt.kind === "counter" || s.prompt.kind === "blocker";
  return heavy ? { model: MODEL, effort: "medium" } : { model: FAST_MODEL };
}

// ── the decision ───────────────────────────────────────────────────────────

export async function chooseMove(db: Db, ctx: EngineContext, s: GameState, legal: LegalAction[], p: PlayerId, tier: Tier): Promise<Choice> {
  if (!legal.length) throw new Error("no legal move to choose from");
  const free = freeChoice(ctx, s, legal, p);
  if (free) return { index: free.index, say: null, spend: null, how: free.how };
  if (!hasAnthropic()) return { index: 0, say: null, spend: null, how: "no API key — took the first legal move" };

  const { model, effort } = modelFor(tier, s);
  const question = `${stateText(ctx, s, p)}\n\nYou are being asked: ${promptQuestion(s)}\n\nLEGAL MOVES:\n${movesText(legal)}\n\nAnswer with the number of your move and at most one short sentence.`;

  const res = await anthropic().messages.parse({
    model,
    max_tokens: 1500,
    // Haiku 4.5 rejects both adaptive thinking and output_config.effort.
    ...(model === MODEL ? { thinking: { type: "adaptive" as const } } : {}),
    output_config: { ...(effort ? { effort } : {}), format: zodOutputFormat(MoveSchema) },
    system: systemBlocks(ctx, s, p),
    messages: [{ role: "user", content: question }],
  });

  const { output } = await recordRun<z.infer<typeof MoveSchema>>(db, "arena_move", { prompt: s.prompt.kind, turn: s.turn, moves: legal.length }, res, undefined, model);
  // The engine still refuses anything illegal; this only keeps an out-of-range
  // answer from throwing before it gets there.
  const index = Number.isInteger(output.move) && output.move >= 0 && output.move < legal.length ? output.move : 0;
  const usage = res.usage as { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number };
  return {
    index,
    say: output.say?.trim() || null,
    spend: { model, input: usage.input_tokens, output: usage.output_tokens, cached: usage.cache_read_input_tokens ?? 0 },
    how: index === output.move ? "chosen by Claude" : `Claude answered ${output.move}, which is not on the list — took the first move`,
  };
}

function promptQuestion(s: GameState): string {
  switch (s.prompt.kind) {
    case "main":
      return "what to do in your Main Phase";
    case "combo":
      return "whether to add combo power to this battle";
    case "blocker":
      return "whether to block this attack";
    case "counter":
      return "whether to play a counter";
    case "chooseCards":
      return s.prompt.choice.reason;
    case "optionalCost":
      return `whether to pay ${s.prompt.describe}`;
    case "payCost":
      return `which energy to rest to ${s.prompt.describe}`;
    case "offering":
      return "whether to drop a life card to deny the draw";
    default:
      return "your move";
  }
}

// ── the referee (proposal §6.4) ────────────────────────────────────────────

const RulingSchema = z.object({
  program: z.string().describe("A JSON array of operations, as described. Use [] when nothing should happen."),
  why: z.string().max(200).describe("One sentence on how you read the card"),
});

export const EFFECT_LANGUAGE = `You are ruling on one skill of one card in a Dragon Ball Super Card Game engine. Answer with a JSON array of operations that carries out exactly what the skill's text says — no more, no less. The engine runs it and still enforces every rule, so an operation that would break a rule is simply refused.

Operations (each is an object with "op"):
  {"op":"draw","n":1,"side":"you"|"opponent"}
  {"op":"discard","n":1,"side":"opponent"}        cards leave a hand for the Drop
  {"op":"damage","n":1,"side":"opponent"}         life to hand
  {"op":"mill","n":2,"side":"you"}                deck to Drop
  {"op":"addLife","n":1} | {"op":"lifeDownTo","n":4}
  {"op":"shuffle"} | {"op":"energyMarker","n":1}
  {"op":"choose","sel":SELECTOR,"as":"t","reason":"..."}   binds the chosen cards to a name
  {"op":"look","n":5,"as":"looked"}               top of your deck
  {"op":"ko","target":TARGET}
  {"op":"moveTo","target":TARGET,"to":"drop"|"hand"|"deck"|"energy"|"life"|"warp"|"removed"|"battle","position":"top"|"bottom","mode":"rest"|"active"}
  {"op":"play","target":TARGET}
  {"op":"switchMode","target":TARGET,"mode":"rest"|"active"}
  {"op":"hidden","target":TARGET,"hidden":true|false}     Hidden Mode / Revealed Mode (23-5)
  {"op":"power","target":TARGET,"amount":5000,"until":"battle"|"turn"|"game"}
    an amount may also be {"count":SELECTOR,"times":5000} (so much for each card) or {"sumPower":{"var":"rested"}} (the total power of named cards)
  {"op":"comboPower","target":TARGET,"amount":5000,"until":"battle"}
  {"op":"grant","target":TARGET,"keyword":{"name":"Blocker"},"until":"turn"}
  {"op":"negateSkills","target":TARGET,"until":"turn"} | {"op":"negateAttack"}
  {"op":"negateOwnSkill"} | {"op":"negateOwnSkill","until":"turn"}     "negate this skill for the game / for the turn"
  {"op":"addMarker","target":TARGET,"n":1} | {"op":"removeMarker","target":TARGET,"n":1}
  {"op":"forbid","what":FORBIDDEN,"until":"turn","target":TARGET}        a rule about particular cards
  {"op":"forbid","what":"play","until":"turn","side":"opponent","filter":{...}}   a rule about a player
    FORBIDDEN: "attack" | "beAttacked" | "block" | "play" | "activateSkill" | "activateCounter"
             | "combo" | "beKOd" | "beKOdBySkill" | "beChosen" | "switchToActive"
    "sameNameAsSelf":true narrows a play rule to copies of this card.
    until may also be "nextTurn", which lasts through the opponent's turn and ends as yours begins.
  {"op":"token","name":"Saibaman Token","power":10000,"comboCost":0,"comboPower":5000,"colors":[],"n":2}
  {"op":"altCost","pay":"none"|"life","n":1}   [Permanent] only: another way to pay for this card's own [Counter]
  {"op":"if","cond":COND,"then":[...],"else":[...]}
  {"op":"chooseMode","modes":[{"label":"…","ops":[...]},{"label":"…","ops":[...]}]}   "Choose one— ・A ・B"
  {"op":"moveTo","target":TARGET,"to":"under","under":TARGET}    under another card; omit "under" for this card
  {"op":"delay","at":TIMING,"scope":SCOPE,"ops":[...]}   the inner operations happen later, not now

TARGET is {"var":"t"} for something chosen earlier, or {"sel":SELECTOR}.
SELECTOR: {"side":"you"|"opponent"|"both","area":"battle"|"hand"|"deck"|"drop"|"life"|"energy"|"unison"|"leader"|"warp"|"combo"|"zDeck"|"zEnergy"|"play","count":1,"upTo":true,"mode":"rest"|"active","filter":{...}}
  or {"special":"self"|"attacker"|"guard"|"leader"|"opponentLeader"} for a single known card.
  "count":99 means all of them. A filter may hold colors, characters, traits, names, costMin, costMax, powerMin, powerMax.
COND: {"kind":"life","side":"you","atMost":4} | {"kind":"count","sel":SELECTOR,"atLeast":2} | {"kind":"leaderColor","color":"Red"} | {"kind":"chose","var":"t"}
TIMING: "turnStart" | "mainStart" | "turnEnd" | "turnCleanup" | "battleEnd"
SCOPE: "thisTurn" (default) | "nextTurn" | "yourNextTurn" | "opponentNextTurn"
  "At the end of the turn, KO it" is {"op":"choose",...} then {"op":"delay","at":"turnEnd","ops":[{"op":"ko","target":{"var":"t"}}]}.
  A delayed program keeps the variables bound before it, so "it" still means the card chosen now.

Rules of thumb: "up to N" means "upTo":true; "choose 1 ... and KO it" is a choose followed by a ko on that variable; a skill that only restricts or renames something you cannot express should be an empty array rather than a guess.`;

export async function ruleOnCard(
  db: Db,
  request: { cardId: string; cardName: string; text: string; unsupported: string[] },
  situation: string,
): Promise<{ ops: Op[]; why: string; spend: { model: string; input: number; output: number; cached: number } | null }> {
  if (!hasAnthropic()) return { ops: [], why: "no API key, so the skill did nothing", spend: null };
  const res = await anthropic().messages.parse({
    model: MODEL,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: zodOutputFormat(RulingSchema) },
    system: [{ type: "text", text: EFFECT_LANGUAGE, cache_control: { type: "ephemeral", ttl: "1h" } }],
    messages: [
      {
        role: "user",
        content: `CARD: ${request.cardName} (${request.cardId})\nFULL SKILL LINE: ${request.text}\nThe parts the engine could not read: ${request.unsupported.join(" | ")}\n\nSITUATION:\n${situation}\n\nGive the operations for this skill, now.`,
      },
    ],
  });
  const { output } = await recordRun<z.infer<typeof RulingSchema>>(db, "arena_referee", { cardId: request.cardId, unsupported: request.unsupported }, res, undefined, MODEL);
  let ops: unknown;
  try {
    ops = JSON.parse(output.program);
  } catch {
    ops = [];
  }
  const usage = res.usage as { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number };
  const spend = { model: MODEL, input: usage.input_tokens, output: usage.output_tokens, cached: usage.cache_read_input_tokens ?? 0 };
  // A malformed ruling is treated as "nothing happens" rather than trusted.
  if (!validateProgram(ops)) return { ops: [], why: `${output.why} (the ruling was not a valid program, so nothing happened)`, spend };
  return { ops: ops as Op[], why: output.why, spend };
}
