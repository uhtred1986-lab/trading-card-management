import type { NumberedBeat, BeatArt } from "../beats";
import type { CardView } from "../view";
import type { PlayerId } from "../types";
import { resolveCharacter } from "./characters";
import { skillMoment } from "./skills";
import type { ActionCueId, ActionFace, ActionRole, ActionSequence, ActionStaging, ArenaSoundCue, CombatCharacter, CombatMoment, CueMarker, NeutralReason } from "./types";

/** Current visible face must agree with captured public event art. Otherwise stay neutral. */
export function combatMoment(gameId: number, beat: NumberedBeat | null, cardOf: (id: string) => CardView | null, art: Record<string, BeatArt>): CombatMoment | null {
  if (!beat) return null;
  const outcome = beat.t === "attack" ? "attack" : beat.t === "block" ? "block" : beat.t === "clash" ? beat.hit ? "hit" : "repelled" : beat.t === "negated" ? "negated" : beat.t === "damage" || beat.t === "ko" ? "hit" : null;
  if (!outcome) return null;
  const id = beat.t === "attack" ? beat.attacker : beat.t === "block" ? beat.by : beat.t === "clash" ? beat.guard : beat.t === "ko" ? beat.card : null;
  const card = id ? cardOf(id) : null;
  const captured = id ? art[id] : null;
  const safe = card && !card.hidden && (!captured || (captured.cardId === card.cardId && captured.name === card.name));
  return { key: `${gameId}:${beat.n}`, outcome, caption: beat.t === "damage" ? `−${beat.amount} LIFE${beat.critical ? " · CRITICAL" : ""}` : beat.t === "ko" ? "KO" : undefined, pose: outcome === "attack" ? "attack" : outcome === "hit" ? "hit" : "guard", character: safe ? resolveCharacter(card.cardId, card.name, card.flipped) : null };
}

/** The contract cue each synthesized tone stands in for. A cue without one is silent until #1109 loads assets. */
export const SYNTH_FALLBACK: Partial<Record<ActionCueId, ArenaSoundCue>> = {
  "attack.buildup": "attack",
  "reaction.block": "block",
  "impact.hit": "hit",
  "reaction.negate": "negated",
  "reaction.repel": "repelled",
  "card.draw": "draw",
  "card.play": "play",
  "turn.yours": "turn",
  "turn.opponent": "turn",
  "match.victory": "victory",
  "match.defeat": "defeat",
};

/** The first contract cue a beat sounds, as today's synthesized tone. Same routing as before #1103. */
export function soundCue(beat: NumberedBeat | null, viewer: PlayerId): ArenaSoundCue | null {
  const first = actionCues(beat, viewer)[0];
  return first ? SYNTH_FALLBACK[first] ?? null : null;
}

/**
 * Which contract cues a single public beat may sound, in order. Reads only the beat itself, never a
 * card's identity, so it cannot reveal a hidden card. Beats with no supported cue return [].
 * Deliberately unsupported (no unambiguous public beat, owner default 25 Oct 2026): dodge, zone moves
 * (Drop/Warp/return), energy charge/payment, match start and local UI interactions.
 */
export function actionCues(beat: NumberedBeat | null, viewer: PlayerId): ActionCueId[] {
  if (!beat) return [];
  switch (beat.t) {
    case "attack": return ["attack.buildup", "attack.release"];
    case "block": return ["reaction.block"];
    case "clash": return [beat.hit ? "impact.hit" : "reaction.repel"];
    case "negated": return ["reaction.negate"];
    case "damage": return ["damage"];
    case "ko": return ["ko"];
    case "draw": return ["card.draw"];
    case "move": return beat.to === "battle" ? ["card.play"] : [];
    case "flip": return ["skill.awaken"];
    case "skill": {
      const style = skillMoment(0, beat)?.style;
      return [style === "swap" ? "skill.swap" : style === "union" ? "skill.union" : style === "evolve" ? "skill.evolve" : style === "awaken" ? "skill.awaken" : "skill.activate"];
    }
    case "phase": return beat.phase === "charge" ? [beat.player === viewer ? "turn.yours" : "turn.opponent"] : [];
    case "over":
      if (beat.winner !== null) return [beat.winner === viewer ? "match.victory" : "match.defeat"];
      return beat.kind === "draw" || (beat.kind === undefined && beat.reason === "draw") ? ["match.draw"] : [];
    default: return [];
  }
}

/**
 * Each cue's window at full length, in ms from the start of the beat's presentation. The attack's
 * buildup runs into its release; every other cue starts with its beat. A shorter presentation
 * compresses these proportionally (`actionSequence`); a longer one never stretches them.
 */
export const CUE_WINDOW_MS: Record<ActionCueId, readonly [start: number, stop: number]> = {
  "attack.buildup": [0, 300],
  "attack.release": [300, 900],
  "reaction.block": [0, 400],
  "impact.hit": [0, 700],
  "reaction.negate": [0, 500],
  "reaction.repel": [0, 500],
  damage: [0, 300],
  ko: [0, 800],
  "card.draw": [0, 300],
  "card.play": [0, 400],
  "skill.activate": [0, 500],
  "skill.swap": [0, 700],
  "skill.union": [0, 900],
  "skill.evolve": [0, 900],
  "skill.awaken": [0, 1000],
  "turn.yours": [0, 500],
  "turn.opponent": [0, 400],
  "match.victory": [0, 1600],
  "match.defeat": [0, 1300],
  "match.draw": [0, 1100],
};

/** Markers for these cues inside a presentation of `durationMs`: compressed to fit, never extended. */
export function cueMarkers(cues: readonly ActionCueId[], durationMs: number): CueMarker[] {
  const bound = Math.max(0, Number.isFinite(durationMs) ? durationMs : 0);
  const natural = Math.max(0, ...cues.map((cue) => CUE_WINDOW_MS[cue][1]));
  const scale = natural > bound ? bound / natural : 1;
  return cues.map((cue) => {
    const [start, stop] = CUE_WINDOW_MS[cue];
    return { cue, startMs: Math.round(start * scale), stopMs: Math.min(bound, Math.round(stop * scale)) };
  });
}

interface SequenceContext {
  cardOf: (id: string) => CardView | null;
  art: Record<string, BeatArt>;
  viewer: PlayerId;
  /** The beat's own presentation length (`msFor` on the stage). Markers never pass it. */
  durationMs: number;
  /** Approved exact-face technique mapping (#856/#1110). Called only for a visible, agreeing, mapped face. */
  techniqueOf?: (face: ActionFace, character: CombatCharacter) => string | null;
}

/** The card a beat stages and in what role. Damage, negate and sound-only beats name no card. */
function subjectOf(beat: NumberedBeat): { id: string | null; role: ActionRole; staging: ActionStaging } | null {
  switch (beat.t) {
    case "attack": return { id: beat.attacker, role: "attacker", staging: "combat" };
    // The actual blocker, never the original target.
    case "block": return { id: beat.by, role: "defender", staging: "combat" };
    case "clash": return { id: beat.guard, role: "defender", staging: "combat" };
    case "ko": return { id: beat.card, role: "defender", staging: "combat" };
    case "negated":
    case "damage": return { id: null, role: null, staging: "combat" };
    case "move": return ["battle", "drop", "warp"].includes(beat.to) || ["battle", "drop", "warp"].includes(beat.from) ? { id: beat.card, role: "source", staging: "motion" } : null;
    case "flip":
    case "skill": return { id: beat.card, role: "source", staging: "motion" };
    case "draw":
    case "phase":
    case "over": return { id: null, role: null, staging: "sound" };
    default: return null;
  }
}

/**
 * The single character-action sequence for one public beat, or null for a beat with no presentation.
 * Identity follows `combatMoment`'s rule: a face is used only when the current card is visible and
 * agrees with the art captured at event time, and a character only through an exact reviewed mapping.
 */
export function actionSequence(gameId: number, beat: NumberedBeat | null, context: SequenceContext): ActionSequence | null {
  if (!beat) return null;
  const subject = subjectOf(beat);
  if (!subject) return null;
  const cues = actionCues(beat, context.viewer);
  if (subject.staging === "sound" && cues.length === 0) return null;
  const durationMs = Math.max(0, Number.isFinite(context.durationMs) ? Math.round(context.durationMs) : 0);
  let face: ActionFace | null = null;
  let character: CombatCharacter | null = null;
  let neutral: NeutralReason | null = "no-subject";
  // A sound-only beat (a draw) never looks its card up, so a concealed draw stays concealed.
  if (subject.id && subject.staging !== "sound") {
    const card = context.cardOf(subject.id);
    const captured = context.art[subject.id];
    if (!card) neutral = "unknown-card";
    else if (card.hidden) neutral = "hidden";
    else if (captured && (captured.cardId !== card.cardId || captured.name !== card.name)) neutral = "face-changed";
    else {
      face = { cardId: card.cardId, name: card.name, face: card.flipped ? "back" : "front" };
      character = resolveCharacter(card.cardId, card.name, card.flipped);
      neutral = character ? null : "unmapped";
    }
  }
  const technique = face && character && context.techniqueOf ? context.techniqueOf(face, character) : null;
  return {
    key: `${gameId}:${beat.n}`,
    beat: beat.t,
    staging: subject.staging,
    role: subject.role,
    subject: subject.id,
    face,
    character,
    neutral,
    technique,
    ...(beat.t === "move" ? { motion: { from: beat.from, to: beat.to } } : {}),
    markers: cueMarkers(cues, durationMs),
    durationMs,
  };
}
