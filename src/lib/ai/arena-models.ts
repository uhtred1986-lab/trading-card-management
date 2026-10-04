/**
 * The model a Sparring or Tournament decision runs on (#516). `arenaModel`
 * answers for one of the three slots on /settings; with a slot unset it is
 * today's behaviour: Sparring every decision on Haiku, Tournament `main`,
 * `counter`, `blocker` and `combo` on Opus (adaptive thinking, effort medium)
 * and the rest on Haiku. The list of key prompt kinds stays in code
 * ({@link TOURNAMENT_KEY_PROMPTS}); the opponent maps a prompt to a slot with
 * {@link arenaSlotFor}. Pass `await getSettings()` (or a literal in a check).
 */
import { FAST_MODEL, MODEL } from "./models";
import { NO_SETTINGS, type AiSettings, type ArenaSlot } from "./settings";
import type { ProviderId } from "./types";

export const TOURNAMENT_KEY_PROMPTS: readonly string[] = ["main", "counter", "blocker", "combo"];

export interface ArenaModel {
  provider: ProviderId;
  model: string;
  /** Sent only where the model has it; the adapter drops it otherwise. */
  effort?: "low" | "medium" | "high";
  thinking?: "adaptive";
}

const DEFAULT_PROVIDER: ProviderId = "anthropic-api";

export function arenaSlotFor(tier: "sparring" | "tournament", promptKind: string): ArenaSlot {
  if (tier === "sparring") return "sparring";
  return TOURNAMENT_KEY_PROMPTS.includes(promptKind) ? "tournament.key" : "tournament.other";
}

export function arenaModel(slot: ArenaSlot, settings: AiSettings = NO_SETTINGS): ArenaModel {
  const key = slot === "tournament.key";
  const chosen = settings.arena[slot];
  const base = chosen ?? { provider: DEFAULT_PROVIDER, model: key ? MODEL : FAST_MODEL };
  return { ...base, ...(key ? { effort: "medium" as const, thinking: "adaptive" as const } : {}) };
}
