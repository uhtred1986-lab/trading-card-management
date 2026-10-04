/**
 * What /settings offers (#516), as pure functions so a check can prove the
 * pickers without a page: the tasks, how they are grouped, what each needs
 * from a model, and which models a picker may list. A task needing an image
 * never sees a text-only model; every task and every arena slot needs a
 * structured answer (the arena's answer is a move number from the legal list).
 */
import type { RunKind } from "./client";
import type { ArenaSlot } from "./settings";
import type { ModelInfo, ProviderId } from "./types";

export interface TaskInfo {
  label: string;
  group: "deck" | "scan" | "arena-opponent" | "arena-rules";
}

/** Every `RunKind`; the type makes a new kind a compile error until it is listed here. */
export const TASKS: Record<RunKind, TaskInfo> = {
  deck_summary: { label: "Deck summary", group: "deck" },
  deck_wizard: { label: "Improvement wizard", group: "deck" },
  set_review: { label: "Set review", group: "deck" },
  deck_builder: { label: "Build a deck with Claude", group: "deck" },
  deck_from_card: { label: "Deck from a card", group: "deck" },
  cart_explain: { label: "Cart explainer", group: "deck" },
  scan_identify: { label: "Card scan", group: "scan" },
  arena_move: { label: "Opponent moves", group: "arena-opponent" },
  arena_referee: { label: "Referee", group: "arena-opponent" },
  arena_clarify: { label: "Rule clarification", group: "arena-rules" },
  arena_review: { label: "Post-game review", group: "arena-rules" },
  arena_teach: { label: "Teach a rule", group: "arena-rules" },
};

export const TASK_GROUPS: { id: TaskInfo["group"]; label: string }[] = [
  { id: "deck", label: "Deck features" },
  { id: "scan", label: "Card scan" },
  { id: "arena-opponent", label: "Arena opponent" },
  { id: "arena-rules", label: "Arena rules and teaching" },
];

export const TASK_IDS = Object.keys(TASKS) as RunKind[];

export const ARENA_SLOT_INFO: Record<ArenaSlot, { label: string; note: string }> = {
  sparring: { label: "Sparring · every decision", note: "Default Claude Haiku 4.5." },
  "tournament.key": { label: "Tournament · key decisions", note: "Main, counter, blocker and combo prompts. Default Claude Opus 5, effort medium." },
  "tournament.other": { label: "Tournament · other decisions", note: "Every other Tournament prompt. Default Claude Haiku 4.5." },
};

export interface ModelNeeds {
  vision: boolean;
  json: boolean;
}

/** All calls are structured (`generateJson`); only the card scan also reads an image. */
export function needsOf(task: RunKind): ModelNeeds {
  return { vision: task === "scan_identify", json: true };
}

/** An arena slot is answered with a move number from the legal list: structured output, no image. */
export const ARENA_NEEDS: ModelNeeds = { vision: false, json: true };

export interface PickableModel extends ModelInfo {
  provider: ProviderId;
}

/** The models of every provider that can do what `needs` says. */
export function pickable(models: Record<string, ModelInfo[]>, needs: ModelNeeds): PickableModel[] {
  const out: PickableModel[] = [];
  for (const [provider, list] of Object.entries(models)) {
    for (const m of list) {
      if (needs.vision && !m.capabilities.vision) continue;
      if (needs.json && !m.capabilities.json) continue;
      out.push({ ...m, provider });
    }
  }
  return out;
}

/** Case-insensitive match on id, label or provider; every word must hit. */
export function searchModels<T extends PickableModel>(list: T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((m) => {
    const hay = `${m.id} ${m.label} ${m.provider}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** "$5 in · $25 out per M tokens · 200k context", leaving out what is not known. */
export function describeModel(m: ModelInfo): string {
  const bits: string[] = [];
  if (m.usdPerMTok) bits.push(`$${m.usdPerMTok.in} in · $${m.usdPerMTok.out} out per M tokens`);
  if (m.contextLength) bits.push(`${Math.round(m.contextLength / 1000)}k context`);
  if (m.capabilities.vision) bits.push("images");
  return bits.join(" · ");
}
