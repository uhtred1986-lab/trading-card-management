/**
 * The mechanical half of `RULES_PRIMER`, generated from the definition
 * rather than hand-written, so it cannot say a turn goes a way the engine no
 * longer plays it (#160). What follows in the prompt — that trading up in
 * power matters, how to read a combo exchange, when to hold a life card — is
 * judgement about how to play well, not a fact about the rules, and stays
 * hand-written in `opponent.ts`'s own `DOCTRINE`; only the phases, the zones
 * and the win condition are generated.
 *
 * `game.rules` is the only file this reads — there is no separate
 * `turn.rules` (`docs/arena-backlog/s8-02-primer-prompts-view.md` names one;
 * the turn is declared inside `game.rules` alongside the game itself).
 */
import type { GameDefinition } from "../rulesets";

function phaseName(id: string): string {
  return `${id.charAt(0).toUpperCase()}${id.slice(1)} Phase`;
}

/** A declaration's `text:`, without the manual's own section citations — "(7-2-1, 7-2-6)" is for a person reading the file, not for Claude mid-game. */
function plain(text: string | undefined): string {
  return (text ?? "")
    .replace(/\s*\([^()]*\d[^()]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** "How a turn goes: Charge Phase (...) → Main Phase (...) → End Phase (...)." — every announced phase of the turn, in the order `DEFINE GAME` lists them. */
export function turnStructure(def: GameDefinition): string {
  const order = def.game?.phases ?? [];
  const sentences = order
    .map((name) => def.phases[name])
    .filter((p): p is NonNullable<typeof p> => !!p && p.announce !== false)
    .map((p) => `${phaseName(p.name)} (${plain(p.text)})`);
  return `How a turn goes: ${sentences.join(" → ")}.`;
}

/** "Winning: you lose when ...; the same is true for your opponent." — every `DEFINE WIN` that ends the game for the player it names. */
export function winCondition(def: GameDefinition): string {
  const clauses = Object.values(def.wins)
    .filter((w) => w.result === "lose" && w.who === "you")
    .map((w) => plain(w.text))
    .filter(Boolean);
  if (!clauses.length) return "";
  return `Winning: you lose when ${clauses.join(", or when ")}. The same is true for your opponent.`;
}

/** Every zone the definition declares as a place a card can be, for the areas line of the primer. */
export function zoneNames(def: GameDefinition): string[] {
  return Object.values(def.zones)
    .filter((z) => z.place !== false)
    .map((z) => z.name);
}

/** "The areas: ..." — named so the acceptance bullet ("a primer that names every zone the definition declares") is checkable directly, not just implied by the turn/win sentences. */
export function areasLine(def: GameDefinition): string {
  return `The areas of the game: ${zoneNames(def).join(", ")}.`;
}

/** The generated half of the primer: what `game.rules`/`zones.rules` actually declare, nothing judged. */
export function generatedPrimer(def: GameDefinition): string {
  return [`You are playing ${def.game?.title ?? "the game"} against a human, through a rules engine.`, turnStructure(def), areasLine(def), winCondition(def)].filter(Boolean).join("\n\n");
}
