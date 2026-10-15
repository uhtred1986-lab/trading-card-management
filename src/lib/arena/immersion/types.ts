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
export type ArenaSoundCue = CombatOutcome | "draw" | "play" | "turn" | "victory" | "defeat";
