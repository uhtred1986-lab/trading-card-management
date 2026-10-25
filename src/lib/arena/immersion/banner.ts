import type { NumberedBeat } from "../beats";
import { characterPoses } from "./characters";
import { cueMarkers } from "./events";
import type { ActionCueId, ActionRole, ActionSequence, CombatCharacter, CombatPose, CueMarker, NeutralReason } from "./types";

/**
 * The character banner's plan for one public beat (#1105): the single combat route for leader and
 * Battle Cards, on every screen size. Pure: it reads only the contract sequence (`actionSequence`)
 * and, for a damage receipt, the beat itself. It never looks a card up, so it cannot reveal more
 * than the sequence already allows.
 */
export type BannerKind = "attack" | "block" | "hit" | "repelled" | "negated" | "damage" | "ko";

export interface BannerPlan {
  /** The consumed event key (match id + numbered beat): one banner per key. */
  key: string;
  kind: BannerKind;
  /** `attacker` winds up and releases; `defender` reacts to its own resolved beat; null names no card. */
  role: ActionRole;
  /** The short action label: an approved technique for the attacker, else the kind's word or receipt. */
  label: string;
  /** Present only for a reviewed mapping whose sheet lists the pose. */
  character: CombatCharacter | null;
  pose: CombatPose | null;
  /** Why the banner stages neutral art; null exactly when `character` is set. */
  neutral: NeutralReason | null;
  /** Visual length: the beat's own presentation, capped at 1100 ms, never longer. */
  durationMs: number;
  /** End of the attacker's buildup (`attack.buildup` stop); 0 for a reaction. */
  windupMs: number;
  /** When the contact marker fires: `attack.release` start, or the reaction cue's start. */
  contactMs: number;
  /** The sequence's cues re-timed inside `durationMs` (compressed, never stretched). */
  markers: CueMarker[];
}

/** The banner never runs longer than this, and never longer than the beat it describes. */
export const BANNER_MAX_MS = 1100;
/** Visual length for a beat of `durationMs` (a non-finite pace falls back to the contract's defaults). */
export function bannerDuration(durationMs: number | undefined, fallback: number): number {
  return durationMs !== undefined && Number.isFinite(durationMs) ? Math.max(1, Math.min(BANNER_MAX_MS, Math.round(durationMs))) : fallback;
}

/** Which banner a contract cue opens. Only the beat's own cue decides it, never an earlier beat. */
const KIND_OF: Partial<Record<ActionCueId, BannerKind>> = {
  "attack.buildup": "attack",
  "reaction.block": "block",
  "impact.hit": "hit",
  "reaction.repel": "repelled",
  "reaction.negate": "negated",
  damage: "damage",
  ko: "ko",
};
const WORD: Record<BannerKind, string> = { attack: "ATTACK", block: "BLOCK", hit: "HIT!", repelled: "REPELLED", negated: "NEGATED", damage: "DAMAGE", ko: "KO" };

/**
 * The pose a role takes for a kind. The attacker attacks; a defender reacts only to its own resolved
 * beat: a block or repel braces, a hit or KO recoils. Negate and damage name no card, so no pose.
 */
export function bannerPose(kind: BannerKind, role: ActionRole): CombatPose | null {
  if (role === "attacker") return kind === "attack" ? "attack" : null;
  if (role !== "defender") return null;
  return kind === "block" || kind === "repelled" ? "guard" : kind === "hit" || kind === "ko" ? "hit" : null;
}

/**
 * The banner for a contract sequence, or null when the beat has no combat banner (motion, sound).
 * `posesOf` defaults to the reviewed manifest; a pose the sheet does not list stays neutral.
 */
export function bannerPlan(sequence: ActionSequence | null, beat: NumberedBeat | null, options: { durationMs?: number; posesOf?: (characterId: string) => readonly string[] } = {}): BannerPlan | null {
  if (!sequence || sequence.staging !== "combat") return null;
  const first = sequence.markers[0]?.cue;
  const kind = first ? KIND_OF[first] : undefined;
  if (!kind) return null;
  const durationMs = bannerDuration(options.durationMs ?? sequence.durationMs, kind === "attack" ? 460 : BANNER_MAX_MS);
  const markers = cueMarkers(sequence.markers.map((m) => m.cue), durationMs);
  const pose = bannerPose(kind, sequence.role);
  const posesOf = options.posesOf ?? characterPoses;
  const mapped = sequence.character && pose && posesOf(sequence.character.id).includes(pose) ? sequence.character : null;
  // A mapped face whose sheet lacks this pose is as good as unmapped for this banner: no substitute pose.
  const neutral: NeutralReason | null = mapped ? null : sequence.neutral ?? "unmapped";
  const release = markers.find((m) => m.cue === "attack.release");
  const buildup = markers.find((m) => m.cue === "attack.buildup");
  const receipt = beat && beat.t === "damage" && sequence.key.endsWith(`:${beat.n}`) ? `−${beat.amount} LIFE${beat.critical ? " · CRITICAL" : ""}` : null;
  const technique = kind === "attack" && mapped ? sequence.technique : null;
  return {
    key: sequence.key,
    kind,
    role: sequence.role,
    label: technique ?? receipt ?? WORD[kind],
    character: mapped,
    pose: mapped ? pose : null,
    neutral,
    durationMs,
    windupMs: buildup ? buildup.stopMs : 0,
    contactMs: release ? release.startMs : markers[0]?.startMs ?? 0,
    markers,
  };
}
