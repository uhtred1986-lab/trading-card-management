/**
 * The sound cue catalog's shape (#1104) and its validator. `sound-catalog.json` is data only: prompts to
 * copy into any generator by hand, licence fields to fill on import (#1107), never a runtime API call.
 * Every supported entry names the #1103 contract cue it sounds; unsupported entries are catalogued and
 * deliberately not wired.
 */
import { ACTION_CUE_IDS, type ActionCueId, type ArenaSoundCue } from "./types";
import { CUE_WINDOW_MS, SYNTH_FALLBACK } from "./events";

export type SoundCueTrigger = "supported" | "unsupported";
export type SoundCueAvailability = "missing" | "candidate" | "approved";
export type SoundCueSource = "cc0" | "generate" | "synth";

export interface SoundCueLicense {
  source: string | null;
  author: string | null;
  licence: string | null;
  url: string | null;
  retrievedAt: string | null;
  sha256: string | null;
  notes: string | null;
}

export interface SoundCatalogCue {
  cueId: string;
  category: string;
  /** The public beat that triggers it, or why none does. */
  event: string;
  contractCue: ActionCueId | null;
  trigger: SoundCueTrigger;
  unsupportedReason: string | null;
  visualMarker: string | null;
  purpose: string;
  priority: "core" | "later";
  recipe: string;
  generatedDurationSec: number;
  playback: { durationSec: number; loop: boolean; stopAtMarker: boolean };
  variations: string[];
  prompt: string;
  exclusions: string[];
  /** Optional character/technique slots: name → how to fill it. */
  parameters: Record<string, string>;
  filename: string;
  sourcePreference: SoundCueSource;
  /** `synth:<ArenaSoundCue>` (today's tone) or `silent`. */
  fallback: string;
  availability: SoundCueAvailability;
  license: SoundCueLicense;
}

export interface SoundCatalog {
  schemaVersion: 1;
  version: string;
  purpose: string;
  contract: string;
  docs: string;
  promptTemplates: { effect: string; stinger: string; tails: { oneShot: string; loop: string } };
  voicePolicy: string;
  cues: SoundCatalogCue[];
}

const SYNTH: readonly ArenaSoundCue[] = ["attack", "block", "hit", "repelled", "negated", "draw", "play", "turn", "victory", "defeat"];
const LICENSE_KEYS = ["source", "author", "licence", "url", "retrievedAt", "sha256", "notes"] as const;
const str = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const pos = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/** Every problem with a catalog, as readable lines. Empty means valid. */
export function validateSoundCatalog(input: unknown): string[] {
  const errors: string[] = [];
  const catalog = input as Partial<SoundCatalog> | null;
  if (!catalog || typeof catalog !== "object") return ["catalog is not an object"];
  if (catalog.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  for (const key of ["version", "purpose", "contract", "docs", "voicePolicy"] as const) if (!str(catalog[key])) errors.push(`${key} is missing`);
  if (!str(catalog.promptTemplates?.effect) || !str(catalog.promptTemplates?.stinger)) errors.push("promptTemplates.effect/stinger are missing");
  if (!Array.isArray(catalog.cues) || catalog.cues.length === 0) return [...errors, "cues is empty"];
  const seen = new Set<string>();
  const files = new Set<string>();
  for (const cue of catalog.cues) {
    const at = `cue ${cue?.cueId ?? "?"}`;
    if (!str(cue?.cueId) || !/^[a-z]+(\.[a-z]+)?$/.test(cue.cueId)) { errors.push(`${at}: cueId must be a stable dotted id`); continue; }
    if (seen.has(cue.cueId)) errors.push(`${at}: duplicate cueId`);
    seen.add(cue.cueId);
    for (const key of ["category", "event", "purpose", "recipe", "prompt", "filename"] as const) if (!str(cue[key])) errors.push(`${at}: ${key} is missing`);
    if (!["core", "later"].includes(cue.priority)) errors.push(`${at}: priority must be core or later`);
    if (!["cc0", "generate", "synth"].includes(cue.sourcePreference)) errors.push(`${at}: sourcePreference must be cc0, generate or synth`);
    if (!["missing", "candidate", "approved"].includes(cue.availability)) errors.push(`${at}: availability must be missing, candidate or approved`);
    if (!pos(cue.generatedDurationSec)) errors.push(`${at}: generatedDurationSec must be positive`);
    const playback = cue.playback;
    if (!playback || !pos(playback.durationSec) || typeof playback.loop !== "boolean" || typeof playback.stopAtMarker !== "boolean") errors.push(`${at}: playback needs durationSec, loop and stopAtMarker`);
    else {
      if (playback.loop && !playback.stopAtMarker) errors.push(`${at}: a loop must stop at its marker`);
      if (playback.durationSec > cue.generatedDurationSec && !playback.loop) errors.push(`${at}: playback is longer than the generated clip`);
    }
    if (!Array.isArray(cue.variations) || cue.variations.length < 2 || cue.variations.length > 3 || !cue.variations.every(str)) errors.push(`${at}: needs 2–3 variation descriptions`);
    if (!Array.isArray(cue.exclusions) || cue.exclusions.length === 0 || !cue.exclusions.every(str)) errors.push(`${at}: exclusions are missing`);
    if (!cue.parameters || typeof cue.parameters !== "object" || !Object.values(cue.parameters).every(str)) errors.push(`${at}: parameters must map names to descriptions`);
    if (str(cue.filename)) {
      if (files.has(cue.filename)) errors.push(`${at}: filename is shared with another cue`);
      files.add(cue.filename);
    }
    if (str(cue.prompt) && !/no speech|no voice/i.test(cue.prompt)) errors.push(`${at}: prompt must exclude speech`);
    if (str(cue.prompt) && cue.category !== "match" && !/no music/i.test(cue.prompt)) errors.push(`${at}: only match stingers may allow music`);
    if (!cue.license || LICENSE_KEYS.some((key) => !(key in cue.license))) errors.push(`${at}: license needs ${LICENSE_KEYS.join(", ")}`);
    else if (cue.availability === "approved" && (!str(cue.license.source) || !str(cue.license.licence))) errors.push(`${at}: an approved cue needs its licence source`);
    const fallback = cue.fallback;
    if (fallback !== "silent" && !(typeof fallback === "string" && fallback.startsWith("synth:") && SYNTH.includes(fallback.slice(6) as ArenaSoundCue))) errors.push(`${at}: fallback must be silent or synth:<tone>`);
    if (cue.trigger === "supported") {
      if (!cue.contractCue || !(ACTION_CUE_IDS as readonly string[]).includes(cue.contractCue)) { errors.push(`${at}: a supported cue must map to a contract cue`); continue; }
      if (cue.unsupportedReason !== null) errors.push(`${at}: a supported cue has no unsupportedReason`);
      if (!str(cue.visualMarker)) errors.push(`${at}: a supported cue needs its visual marker`);
      const [start, stop] = CUE_WINDOW_MS[cue.contractCue];
      if (playback && !playback.stopAtMarker && playback.durationSec * 1000 > stop - start) errors.push(`${at}: ${playback.durationSec}s does not fit ${cue.contractCue}'s ${stop - start}ms window; trim it or stop at the marker`);
      const synth = SYNTH_FALLBACK[cue.contractCue];
      const expected = synth ? `synth:${synth}` : "silent";
      if (fallback !== expected) errors.push(`${at}: fallback must be ${expected}, the tone ${cue.contractCue} plays today`);
    } else if (cue.trigger === "unsupported") {
      if (cue.contractCue !== null) errors.push(`${at}: an unsupported cue is not wired to a contract cue`);
      if (!str(cue.unsupportedReason)) errors.push(`${at}: an unsupported cue says why`);
      if (fallback !== "silent") errors.push(`${at}: an unsupported cue falls back to silence`);
    } else errors.push(`${at}: trigger must be supported or unsupported`);
  }
  return errors;
}
