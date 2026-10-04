"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { isArenaAdmin, requireSl } from "@/lib/auth";
import { TASK_IDS } from "@/lib/ai/catalog";
import { providerPanels } from "@/lib/ai/panel";
import { getProvider, providerIds } from "@/lib/ai/providers";
import { ARENA_SLOTS } from "@/lib/ai/settings";
import { applyArenaForm, applyProviderForm, applyTasksForm, applyTiersForm, type ModelLists } from "@/lib/ai/settings-form";
import { loadSettings, saveSettings } from "@/lib/ai/settings-db";
import { testConnection } from "@/lib/ai/test-connection";

/** What a settings form shows after a post. */
export type AiFormState = { ok: boolean; message: string } | null;

async function lists(): Promise<ModelLists> {
  return Object.fromEntries((await providerPanels()).map((p) => [p.id, p.models]));
}

const text = (f: FormData, key: string): string => {
  const v = f.get(key);
  return typeof v === "string" ? v : "";
};

/** Admin-only like the rest of the AI's internals; a failed edit is shown on the form, not thrown. */
async function edit(fn: () => Promise<void>): Promise<AiFormState> {
  if (!(await isArenaAdmin())) return { ok: false, message: "Only an admin can change the AI settings." };
  try {
    await fn();
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  revalidatePath("/settings");
  return { ok: true, message: "Saved." };
}

export async function saveProviderAction(_prev: AiFormState, f: FormData): Promise<AiFormState> {
  await requireSl();
  return edit(async () => {
    const next = applyProviderForm(
      await loadSettings(db),
      { provider: text(f, "provider"), fallbackProvider: text(f, "fallbackProvider"), fallbackOnUnavailable: f.get("fallbackOnUnavailable") === "on" },
      providerIds(),
    );
    await saveSettings(db, next);
  });
}

export async function saveTiersAction(_prev: AiFormState, f: FormData): Promise<AiFormState> {
  await requireSl();
  return edit(async () => {
    const tiers: Record<string, string> = {};
    for (const [k, v] of f.entries()) if (k.startsWith("tier:") && typeof v === "string") tiers[k.slice("tier:".length)] = v;
    await saveSettings(db, applyTiersForm(await loadSettings(db), tiers, await lists()));
  });
}

export async function saveTasksAction(_prev: AiFormState, f: FormData): Promise<AiFormState> {
  await requireSl();
  return edit(async () => {
    const tasks: Record<string, { provider?: string; model?: string }> = {};
    for (const task of TASK_IDS) tasks[task] = { provider: text(f, `provider:${task}`), model: text(f, `model:${task}`) };
    await saveSettings(db, applyTasksForm(await loadSettings(db), tasks, await lists()));
  });
}

export async function saveArenaAction(_prev: AiFormState, f: FormData): Promise<AiFormState> {
  await requireSl();
  return edit(async () => {
    const slots = Object.fromEntries(ARENA_SLOTS.map((s) => [s, text(f, `arena:${s}`)]));
    await saveSettings(db, applyArenaForm(await loadSettings(db), slots, await lists()));
  });
}

export type TestState = { ok: boolean; message: string } | null;

/** One tiny prompt on one provider. A paid call on a paid provider: it runs only from the button. */
export async function testConnectionAction(_prev: TestState, f: FormData): Promise<TestState> {
  await requireSl();
  if (!(await isArenaAdmin())) return { ok: false, message: "Only an admin can test a provider." };
  const provider = getProvider(text(f, "provider"));
  if (!provider) return { ok: false, message: "There is no such provider." };
  const r = await testConnection(provider, await loadSettings(db));
  revalidatePath("/settings");
  return r.ok ? { ok: true, message: `${r.provider} · ${r.model} · ${r.latencyMs} ms · “${r.reply}”` } : { ok: false, message: r.error };
}
