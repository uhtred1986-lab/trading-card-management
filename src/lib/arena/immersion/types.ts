/** Presentation only: no engine state, hidden identities or rules decisions. */
export type CombatPose = "attack" | "guard" | "hit";
export type CombatOutcome = "attack" | "block" | "hit" | "repelled" | "negated";
export interface CombatCharacter { id: string; name: string; sheet: string }
export interface CombatMoment {
  /** Match id and monotonically numbered public presentation beat. */
  key: string;
  outcome: CombatOutcome;
  character: CombatCharacter | null;
  pose: CombatPose;
  /** Exact receipt from a damage/KO beat, never inferred from a clash. */
  caption?: string;
  /** Only an approved exact-text technique mapping may supply this. */
  technique?: string;
}
/** The synthesized fallback tones `audio.ts` can play today. */
export type ArenaSoundCue = CombatOutcome | "draw" | "play" | "turn" | "victory" | "defeat";

/* ---------------------------------------------------------------------------------------------
 * The character-action sequence contract (#1103).
 *
 * One public numbered beat describes at most one `ActionSequence`: which contract cues it may sound,
 * whose face (if any) may be staged, and when each cue starts and stops relative to the start of the
 * beat's presentation. It is a description that the existing banners and `audio.ts` read; it is not
 * a second playback engine and it never holds or lengthens playback. The sound catalog
 * (`sound-catalog.json`, #1104) maps every supported recipe onto one of these cue ids.
 * ------------------------------------------------------------------------------------------- */

/**
 * Every cue the contract can emit. Each is a distinct public moment: an attack declaration only ever
 * yields `attack.buildup`/`attack.release`; `impact.hit` needs a won clash, `damage` a damage beat and
 * `ko` a KO beat. Nothing here is inferred from an earlier beat.
 */
export const ACTION_CUE_IDS = [
  "attack.buildup", "attack.release",
  "reaction.block", "impact.hit", "reaction.negate", "reaction.repel",
  "damage", "ko",
  "card.draw", "card.play",
  "skill.activate", "skill.swap", "skill.union", "skill.evolve", "skill.awaken",
  "turn.yours", "turn.opponent",
  "match.victory", "match.defeat", "match.draw",
] as const;
export type ActionCueId = (typeof ACTION_CUE_IDS)[number];

/**
 * How a beat is staged. `combat` is the single character-action route (leader and Battle Cards alike);
 * `motion` is an actual source/destination card movement or a skill receipt, kept apart from combat
 * staging; `sound` has no picture of its own.
 */
export type ActionStaging = "combat" | "motion" | "sound";
/** Whose action the subject card performs in this beat. `null` when the beat names no card. */
export type ActionRole = "attacker" | "defender" | "source" | null;

/**
 * Why a sequence stages neutral artwork instead of a character. Neutral is the fallback inside the one
 * route, never a selectable mode.
 * - `no-subject`: the beat names no card (negate, damage to a player, turn, match end, a draw).
 * - `hidden`: the subject is concealed from this viewer.
 * - `unknown-card`: the subject is no longer in the viewer's board (KO'd, moved away).
 * - `face-changed`: the visible face no longer agrees with the art captured at event time.
 * - `unmapped`: a visible, agreeing face with no reviewed `characters.json` mapping.
 */
export type NeutralReason = "no-subject" | "hidden" | "unknown-card" | "face-changed" | "unmapped";

/** The exact public face a character was resolved from: card id + face + name, all three reviewed. */
export interface ActionFace { cardId: string; name: string; face: "front" | "back" }

/**
 * One cue's window, in milliseconds from the start of the beat's presentation. `stopMs` is where the
 * cue must be silenced (a loop is stopped, a long clip is cut with a short fade); it is never later
 * than the sequence's `durationMs`, so media length cannot extend a beat or make playback wait.
 */
export interface CueMarker { cue: ActionCueId; startMs: number; stopMs: number }

export interface ActionSequence {
  /** The consumed event key: match id + numbered public beat. Each key sounds at most once. */
  key: string;
  /** The public beat kind this sequence describes. */
  beat: string;
  staging: ActionStaging;
  role: ActionRole;
  /** The instance id the public beat already names; carries no identity of its own. */
  subject: string | null;
  /** Present only for a visible face that agrees with the captured public art. */
  face: ActionFace | null;
  /** Present only through an exact reviewed face mapping. */
  character: CombatCharacter | null;
  /** Why `character` is null; null exactly when a character was resolved. */
  neutral: NeutralReason | null;
  /** An approved technique override for this face, else null. Never derived from a name substring. */
  technique: string | null;
  /** Actual source/destination of a `motion` move beat; combat staging never carries one. */
  motion?: { from: string; to: string };
  /** Cues in start order. Empty is allowed (a motion beat with no supported sound). */
  markers: CueMarker[];
  /** The presentation length the markers are bounded by: never longer than the beat's own duration. */
  durationMs: number;
}
