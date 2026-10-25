/**
 * #901: what the Claude seat of the isolated duel runner is told — built from the seat's policy
 * input (`policy/contract.ts`'s `PolicyInput`: the restricted observation and the open decisions)
 * and the public card text of its **own** decklist, and from nothing else.
 *
 * The online opponent (`ai/opponent.ts`) reads the engine state and is careful not to print the
 * secret areas; this adapter cannot print them because it is never handed them. The observation's
 * hidden cards arrive already aliased (`?p2:hand:3`), the other seat's hand is a count, and its
 * decklist is not in the input at all. `scripts/verify/claude-duel-901.mts` proves it by hidden-state
 * twins: two positions that differ only in what the seat cannot see give byte-identical requests.
 *
 * Reused from the online path: the rules primer (`ai/primer.ts`, generated from `game.rules`, plus
 * the shared `DOCTRINE`) and its answer shape — Claude names one number from the engine's own legal
 * menu, so an answer can be wrong but never an invented move.
 */
import { z } from "zod";
import type { CardDef } from "../../src/lib/arena/types";
import type { AiRequest, SystemBlock } from "../../src/lib/ai/types";
import { DOCTRINE, generatedPrimer } from "../../src/lib/arena/ai/primer";
import { loadDbs } from "../../src/lib/arena/rulesets";
import type { Decision, PolicyInput } from "../../src/lib/arena/policy/contract";
import type { CardFacts, PolicyObservation, SideFacts } from "../../src/lib/arena/policy/observation";

export const PROMPT_VERSION = 1;

/** The answer: one menu number, and for a card choice the cards by the ids the menu lists. */
export const DuelAnswerSchema = z.object({
  move: z.number().int().describe("The number of the move you choose, from the list"),
  cards: z.array(z.string()).optional().describe("Only for a card choice: the ids of the cards you pick, from the ones it lists"),
});
export type DuelAnswer = z.infer<typeof DuelAnswerSchema>;

let primerText: string | null = null;
function rulesPrimer(): string {
  if (primerText) return primerText;
  const loaded = loadDbs();
  if (!loaded.ok) throw new Error(`the DBS ruleset does not load, so the rules primer has nothing to generate from: ${JSON.stringify(loaded.errors[0])}`);
  primerText = `${generatedPrimer(loaded.definition)}\n\n${DOCTRINE}`;
  return primerText;
}

const money = (n: number) => n.toLocaleString("en");
const flat = (text: string) => text.replace(/<br\s*\/?>/gi, " / ").replace(/\s+/g, " ").trim();

/** The seat's own decklist with each card's printed text: only cards the observation says it owns. */
export function ownDeckText(observation: PolicyObservation, defs: Readonly<Record<string, CardDef>>): string {
  const lines: string[] = [];
  for (const { cardId, count } of observation.ownDeck) {
    const d = defs[cardId];
    if (!d) { lines.push(`${count}× ${cardId}`); continue; }
    const head = `${count}× ${d.name} (${d.id}) — ${d.type.toLowerCase()}, ${d.colors.join("/")}, cost ${d.energyCost ?? "—"}, ${d.power ?? "—"} power${d.comboPower != null ? `, combo +${money(d.comboPower)} for ${d.comboCost}` : ""}`;
    lines.push(d.skill ? `${head}\n   ${flat(d.skill)}` : head);
  }
  return lines.sort().join("\n");
}

function card(c: CardFacts, withText: boolean): string {
  if (c.hidden) return `${c.id} face-down card`;
  const bits = [`${c.id} ${c.name} (${c.cardId})`];
  if (c.power != null) bits.push(`${money(c.power)} power${c.basePower != null ? ` (printed ${money(c.basePower)})` : ""}`);
  bits.push(c.mode);
  if (c.energyCost != null) bits.push(`cost ${c.energyCost}`);
  if (c.comboPower != null && c.comboCost != null) bits.push(`combo +${money(c.comboPower)} for ${c.comboCost}`);
  if (c.markers) bits.push(`${c.markers} markers`);
  if (c.underCount) bits.push(`${c.underCount} under`);
  if (c.keywords.length) bits.push(`[${c.keywords.join("][")}]`);
  for (const e of c.effects ?? []) bits.push(`effect: ${e.label} (until ${e.until})`);
  let line = bits.join(", ");
  if (withText && c.text) line += `\n      text: ${flat(c.text).slice(0, 300)}`;
  return line;
}

function list(label: string, cards: CardFacts[], withText: boolean): string | null {
  return cards.length ? `  ${label}:\n${cards.map((c) => `    ${card(c, withText)}`).join("\n")}` : null;
}

function side(s: SideFacts, mine: boolean): string {
  const lines = [
    `${mine ? "YOU" : "OPPONENT"} (${s.player}): life ${s.life}, deck ${s.deck}, hand ${s.handCount}, drop ${s.drop}, warp ${s.warp}, Z-Deck ${s.zDeck}, energy ${s.activeEnergy} active of ${s.energy.length}${s.zEnergy ? `, Z-Energy ${s.zEnergy}` : ""}${s.energyMarkers ? `, ${s.energyMarkers} energy markers` : ""}`,
    s.leader ? `  leader: ${card(s.leader, true)}` : null,
    s.unison ? `  unison: ${card(s.unison, true)}` : null,
    list("battle area", s.battle, true),
    list("combo area", s.combo, false),
    s.energyColors.length ? `  energy colours: ${s.energyColors.map((e) => e.colors.join("/") || "colourless").join(", ")}` : null,
    s.hand ? list("hand", s.hand, true) : null,
    list("face-up life", s.lifeFaceUp, false),
    list("face-up Z-Deck", s.zDeckFaceUp, true),
    list("drop (top first)", s.dropCards.slice(0, 12), false),
    list("warp", s.warpCards, false),
    s.rules.length ? `  rules in force: ${s.rules.map((r) => `${r.label} (until ${r.until})`).join("; ")}` : null,
  ];
  return lines.filter(Boolean).join("\n");
}

/** Every card the seat may read, by id, so a card choice can name what it offers. */
function readable(o: PolicyObservation): Map<string, CardFacts> {
  const out = new Map<string, CardFacts>();
  const add = (c: CardFacts | null | undefined) => { if (c && !c.hidden) out.set(c.id, c); };
  for (const s of [o.you, o.them]) {
    add(s.leader); add(s.unison);
    for (const z of [s.battle, s.combo, s.energy, s.hand ?? [], s.lifeFaceUp, s.zDeckFaceUp, s.dropCards, s.warpCards, s.zEnergyCards]) z.forEach(add);
  }
  if (o.prompt.mine) o.prompt.choices.forEach(add);
  return out;
}

function decisionLine(d: Decision, i: number, known: Map<string, CardFacts>): string {
  if (d.kind === "menu") {
    const cost = d.cost ? ` [cost: ${JSON.stringify(d.cost)}]` : "";
    return `${i}. ${d.label}${cost}`;
  }
  const names = d.candidates.map((id) => { const c = known.get(id); return c ? `${id} ${c.name} (${c.cardId})` : `${id} face-down card`; });
  const how = d.upTo ? (d.remaining !== null ? `up to ${d.remaining}` : "any number") : d.remaining !== null ? `exactly ${d.remaining}` : "as many as the question owes";
  return `${i}. CHOOSE CARDS (${d.reason}): pick ${how} from: ${names.join("; ")}. Answer with this number and "cards": [the ids].${d.cover?.length ? ` The picks must cover the colours ${d.cover.join(", ")}.` : ""}`;
}

function question(o: PolicyObservation): string {
  const p = o.prompt;
  if (!p.mine) return `nothing (${p.kind})`;
  return [p.question, p.hint, p.cost ? `cost: ${p.cost}` : null, p.passConsequence ? `if you pass: ${p.passConsequence}` : null].filter(Boolean).join(" — ");
}

export interface DuelPrompt {
  system: SystemBlock[];
  user: string;
}

/**
 * The request text for one decision. `defs` is consulted only for the card ids of
 * `input.observation.ownDeck` (the seat's own list, which it knows).
 */
export function duelPrompt(input: PolicyInput, defs: Readonly<Record<string, CardDef>>): DuelPrompt {
  const o = input.observation;
  const known = readable(o);
  const battle = o.battle
    ? `BATTLE (${o.battle.step}): ${known.get(o.battle.attacker)?.name ?? o.battle.attacker} [${money(o.battle.attackPower)}] attacks ${known.get(o.battle.guard)?.name ?? o.battle.guard} [${money(o.battle.guardPower)}].`
    : null;
  const user = [
    `Turn ${o.turn}, ${o.turnPlayer === o.seat ? "your turn" : "opponent's turn"}, phase ${o.phase}. You are ${o.seat}.`,
    battle,
    side(o.you, true),
    side(o.them, false),
    `You are being asked: ${question(o)}`,
    `LEGAL MOVES:\n${input.decisions.decisions.map((d, i) => decisionLine(d, i, known)).join("\n")}`,
    `Answer with JSON: {"move": <number>} — and "cards" only for a card choice.`,
  ].filter(Boolean).join("\n\n");
  return {
    system: [
      { text: rulesPrimer() },
      { text: `YOUR DECK:\n${ownDeckText(o, defs)}`, cache: "long" },
    ],
    user,
  };
}

/** The provider request for a prompt: an explicit model, never a tier or a routed provider. */
export function duelRequest(prompt: DuelPrompt, settings: { model: string; maxOutputTokens: number; effort?: "low" | "medium" | "high"; thinking?: "off" | "adaptive" }, signal?: AbortSignal): AiRequest {
  return {
    task: "arena_move",
    model: settings.model,
    provider: "anthropic-api",
    maxTokens: settings.maxOutputTokens,
    ...(settings.effort ? { effort: settings.effort } : {}),
    ...(settings.thinking ? { thinking: settings.thinking } : {}),
    system: prompt.system,
    messages: [{ role: "user", parts: [{ type: "text", text: prompt.user }] }],
    output: { kind: "json", schema: DuelAnswerSchema },
    ...(signal ? { signal } : {}),
  };
}
