/**
 * The mechanical half of `RULES_PRIMER`, generated from the definition
 * rather than hand-written, so it cannot say a turn goes a way the engine no
 * longer plays it (#160). What follows in the prompt — that trading up in
 * power matters, how to read a combo exchange, when to hold a life card — is
 * judgement about how to play well, not a fact about the rules, and stays
 * hand-written in `DOCTRINE` below; only the phases, the zones
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

/**
 * Attacking, and the doctrine for playing well — judgement about the game,
 * not a fact `game.rules`/`zones.rules` could state, so it stays hand-written
 * beside the generated half (#160). Shared by the online opponent (`opponent.ts`)
 * and the isolated Claude duel runner (#901, `scripts/lib/claude-duel.ts`).
 */
export const DOCTRINE = `Attacking: switch an active card to Rest Mode to attack the opposing Leader, their Unison, or one of their Battle Cards that is already rested. Both sides may then add Combo Power from hand or from active Battle Cards; the attacker wins ties. A beaten Battle Card is KO'd; a beaten Leader loses life, which goes to that player's hand unless the attacker has [Critical].

What matters, roughly in order: do not let your life run out; trade up in power; keep energy of the colours you still need; a card in hand that you cannot pay for is worth less than the energy it would have been; life in the Drop is gone, life in hand is a card.

Combos, which is where a hand is usually thrown away: both players may add Combo Power, but never at the same moment. The Offense Step comes first and is the attacker's; the Defense Step follows and is the defender's. So combo power you add while attacking is shown to the defender before they answer, and they answer last — they can out-bid it or simply decline, and either way you are a card down for the turn they attack you. Combo on offense only when the extra power settles something they cannot answer cheaply: you are attacking a Battle Card and the number gets you past its printed power, or the comboed card's own text pays you for it. Otherwise pass and keep the card.
On defense you already know what the attack is worth, so the question is only whether this hit is worth paying for. Add the least that holds — enough to beat the attack outright, not one card more — and only when what you save is worth more than the cards you spend. Ties go to the attacker, so matching the number is not enough. Early in the game, with life to spare, taking the hit is usually the cheaper play: a lost life card comes back to your hand, and a hand emptied on turn 3 is not there on turn 8. Late, or when the hit would be lethal or [Critical], pay whatever it takes.

The engine enforces every rule. You will be given a numbered list of the only moves that are currently legal. Answer with one of those numbers.`;
