/**
 * Turning what the /settings forms post into new {@link AiSettings} (#516).
 * Pure, so a check can prove that a hand-made post cannot store a model a
 * picker would not have offered: every model is looked up in the provider's
 * own list and must have what the task or slot needs, unless that list could
 * not be fetched (an empty list restricts nothing; the pattern is
 * gullet-cove-dm's `checkSettingsInput`). A provider with no built-in tier
 * table (OpenRouter) also has to come with models: see {@link checkModelsChosen}.
 */
import { ARENA_NEEDS, needsOf, TASK_IDS, type ModelNeeds } from "./catalog";
import { TIERS } from "./models";
import type { RunKind } from "./client";
import { ARENA_SLOTS, TIER_IDS, type AiSettings, type ArenaSlot, type ModelRef, type TaskOverride } from "./settings";
import type { ModelInfo, ProviderId, Tier } from "./types";

/** provider id → its models (the registry's `listModels()` answers). */
export type ModelLists = Record<string, ModelInfo[]>;

export const encodeRef = (r: ModelRef): string => `${r.provider}|${r.model}`;

export function decodeRef(v: string | null | undefined): ModelRef | null {
  const s = (v ?? "").trim();
  const i = s.indexOf("|");
  if (i <= 0 || i === s.length - 1) return null;
  return { provider: s.slice(0, i), model: s.slice(i + 1) };
}

/** Tiers the card scan reads images on; a text-only model cannot be set there. */
export const IMAGE_TIERS: readonly Tier[] = ["standard", "best"];

function fits(lists: ModelLists, ref: ModelRef, needs: ModelNeeds): boolean {
  const list = lists[ref.provider];
  if (!list) return false;
  // A list that could not be fetched is empty: it says nothing, so it restricts nothing. A model the list does know is still held to what the task needs.
  if (list.length === 0) return true;
  const m = list.find((x) => x.id === ref.model);
  return !!m && (!needs.vision || m.capabilities.vision) && (!needs.json || m.capabilities.json);
}

/** provider id → how to name it in a message (the registry's labels); the id itself when absent. */
export type ProviderNames = Record<string, string>;

/**
 * A provider with no tier table (everything but the two Anthropic ones) has no default model, so every call
 * on it would go out without one. The global provider and the fallback need all three tiers set for them in the
 * same settings; a task override naming such a provider needs the task's model or those three tiers. Run on
 * the *resulting* settings of every form that can break it: the provider form, the tiers form (removing a tier
 * model a saved choice relies on) and the tasks form. Throws a message naming the provider.
 */
export function checkModelsChosen(s: AiSettings, names: ProviderNames = {}): void {
  const tiersSet = (p: string) => TIER_IDS.every((t) => !!s.tiers[p]?.[t]);
  const needsModels = (p: string | null | undefined): p is string => !!p && !TIERS[p] && !tiersSet(p);
  const name = (p: string) => names[p] ?? p;
  const pick = (p: string) => `Pick ${name(p)}'s models for fast, standard and best first`;
  if (needsModels(s.provider)) throw new Error(`${pick(s.provider)}: ${name(s.provider)} has no default models, so it cannot be the main provider without them.`);
  if (needsModels(s.fallbackProvider)) throw new Error(`${pick(s.fallbackProvider)}: ${name(s.fallbackProvider)} has no default models, so it cannot be the fallback without them.`);
  for (const task of TASK_IDS) {
    const o = s.taskOverrides[task];
    if (o && !o.model && needsModels(o.provider)) throw new Error(`${pick(o.provider)}, or choose its model for ${task}: ${name(o.provider)} has no default models.`);
  }
}

const clean = (v: string | null | undefined): string | null => (v && v.trim() ? v.trim() : null);

/** The global provider, the fallback and its switch. An unknown provider id is refused. */
export function applyProviderForm(s: AiSettings, f: { provider?: string | null; fallbackProvider?: string | null; fallbackOnUnavailable?: boolean }, known: ProviderId[], names: ProviderNames = {}): AiSettings {
  const pick = (v: string | null | undefined): ProviderId | null => {
    const id = clean(v);
    if (!id) return null;
    if (!known.includes(id)) throw new Error(`There is no AI provider called "${id}".`);
    return id;
  };
  const provider = pick(f.provider);
  const fallbackProvider = pick(f.fallbackProvider);
  if (provider && provider === fallbackProvider) throw new Error("The fallback has to be a different provider from the main one.");
  const next = { ...s, provider, fallbackProvider, fallbackOnUnavailable: !!f.fallbackOnUnavailable && !!fallbackProvider };
  checkModelsChosen(next, names);
  return next;
}

/** `tiers`: `"<provider>|<tier>"` → model id (empty = the table's default). */
export function applyTiersForm(s: AiSettings, tiers: Record<string, string>, lists: ModelLists, names: ProviderNames = {}): AiSettings {
  const next: AiSettings["tiers"] = {};
  for (const [key, raw] of Object.entries(tiers)) {
    const model = clean(raw);
    if (!model) continue;
    const [provider, tier] = key.split("|") as [string, Tier];
    if (!lists[provider] || !TIER_IDS.includes(tier)) throw new Error(`"${key}" is not a provider and tier.`);
    const needs: ModelNeeds = { vision: IMAGE_TIERS.includes(tier), json: true };
    if (!fits(lists, { provider, model }, needs)) throw new Error(`${model} cannot be the ${tier} model${needs.vision ? ": the card scan reads images on it" : ""}.`);
    (next[provider] ??= {})[tier] = model;
  }
  const out = { ...s, tiers: next };
  checkModelsChosen(out, names);
  return out;
}

/** `tasks[task]`: `provider` (or empty) and `model` as `"<provider>|<model>"` (or empty). */
export function applyTasksForm(s: AiSettings, tasks: Record<string, { provider?: string; model?: string }>, lists: ModelLists, names: ProviderNames = {}): AiSettings {
  const next: AiSettings["taskOverrides"] = {};
  for (const task of TASK_IDS) {
    const f = tasks[task];
    if (!f) continue;
    const ref = decodeRef(f.model);
    const provider = clean(f.provider);
    let o: TaskOverride | null = null;
    if (ref) {
      if (!fits(lists, ref, needsOf(task as RunKind))) throw new Error(`${ref.model} cannot run ${task}.`);
      o = { provider: ref.provider, model: ref.model };
    } else if (provider) {
      if (!lists[provider]) throw new Error(`There is no AI provider called "${provider}".`);
      o = { provider };
    }
    if (o) next[task] = o;
  }
  const out = { ...s, taskOverrides: next };
  checkModelsChosen(out, names);
  return out;
}

/** `slots`: slot → `"<provider>|<model>"` (empty = today's default). Only models with structured output are accepted. */
export function applyArenaForm(s: AiSettings, slots: Partial<Record<ArenaSlot, string>>, lists: ModelLists): AiSettings {
  const arena: AiSettings["arena"] = {};
  for (const slot of ARENA_SLOTS) {
    const ref = decodeRef(slots[slot]);
    if (!ref) continue;
    if (!fits(lists, ref, ARENA_NEEDS)) throw new Error(`${ref.model} cannot play the arena: it has no structured output.`);
    arena[slot] = ref;
  }
  return { ...s, arena };
}
