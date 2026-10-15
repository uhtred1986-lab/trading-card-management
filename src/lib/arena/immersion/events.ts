import type { NumberedBeat, BeatArt } from "../beats";
import type { CardView } from "../view";
import type { PlayerId } from "../types";
import { resolveCharacter } from "./characters";
import type { ArenaSoundCue, CombatMoment } from "./types";

/** Current visible face must agree with captured public event art. Otherwise stay neutral. */
export function combatMoment(gameId: number, beat: NumberedBeat | null, cardOf: (id: string) => CardView | null, art: Record<string, BeatArt>): CombatMoment | null {
  if (!beat) return null;
  const outcome = beat.t === "attack" ? "attack" : beat.t === "block" ? "block" : beat.t === "clash" ? beat.hit ? "hit" : "repelled" : beat.t === "negated" ? "negated" : null;
  if (!outcome) return null;
  const id = beat.t === "attack" ? beat.attacker : beat.t === "block" ? beat.by : beat.t === "clash" ? beat.guard : null;
  const card = id ? cardOf(id) : null;
  const captured = id ? art[id] : null;
  const safe = card && !card.hidden && (!captured || (captured.cardId === card.cardId && captured.name === card.name));
  return { key: `${gameId}:${beat.n}`, outcome, pose: outcome === "attack" ? "attack" : outcome === "hit" ? "hit" : "guard", character: safe ? resolveCharacter(card.cardId, card.name, card.flipped) : null };
}
export function soundCue(beat: NumberedBeat | null, viewer: PlayerId): ArenaSoundCue | null {
  if (!beat) return null;
  switch (beat.t) {
    case "attack": return "attack";
    case "block": return "block";
    case "clash": return beat.hit ? "hit" : "repelled";
    case "negated": return "negated";
    case "draw": return "draw";
    case "move": return beat.to === "battle" ? "play" : null;
    case "phase": return beat.phase === "charge" ? "turn" : null;
    case "over": return beat.winner === null ? null : beat.winner === viewer ? "victory" : "defeat";
    default: return null;
  }
}
