import { saveArenaAction, saveProviderAction, saveTasksAction, saveTiersAction, testConnectionAction } from "@/app/settings/ai-actions";
import { ARENA_NEEDS, ARENA_SLOT_INFO, describeModel, needsOf, pickable, TASK_GROUPS, TASKS, type PickableModel } from "@/lib/ai/catalog";
import { FAST_MODEL, modelEntry, MODEL, TIERS } from "@/lib/ai/models";
import type { ProviderPanel } from "@/lib/ai/panel";
import { ARENA_SLOTS, TIER_IDS, type AiSettings } from "@/lib/ai/settings";
import { encodeRef, IMAGE_TIERS } from "@/lib/ai/settings-form";
import type { RunKind } from "@/lib/ai/client";
import { AiForm } from "./AiForm";
import { ModelSelect, type ModelOption } from "./ModelSelect";
import { TestConnection } from "./TestConnection";

const card = "rounded-xl border border-space-700/70 bg-space-900/50 p-3 text-sm";
const selectCls = "tap w-full rounded-md border border-space-600 bg-space-800 px-2 py-1 text-xs text-space-100";

const TIER_NOTE: Record<(typeof TIER_IDS)[number], string> = {
  fast: "Cart explainer. Cheap and quick.",
  standard: "Deck summary, post-game review, first pass of the card scan.",
  best: "Wizard, set review, deck builder, second pass of the card scan.",
};

function optionsOf(models: PickableModel[], several: boolean): ModelOption[] {
  return models.map((m) => ({ value: encodeRef({ provider: m.provider, model: m.id }), label: several ? `${m.label} (${m.provider})` : m.label, detail: describeModel(m) }));
}

function labelOf(provider: string, id: string | undefined): string {
  return id ? (modelEntry(id, provider)?.label ?? id) : "—";
}

function ago(at: number | null): string {
  if (!at) return "not checked yet";
  const min = Math.round((Date.now() - at) / 60000);
  return min < 1 ? "checked just now" : `checked ${min} min ago`;
}

/** The AI block on /settings: provider, fallback, tiers, per-task overrides, the arena's three slots. */
export function AiSettingsBlock({ settings, panels, admin }: { settings: AiSettings; panels: ProviderPanel[]; admin: boolean }) {
  const lists = Object.fromEntries(panels.map((p) => [p.id, p.models]));
  const several = panels.length > 1;
  const fieldset = admin ? "" : "pointer-events-none opacity-60";

  return (
    <section id="ai" className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-space-300">AI provider and models</h2>
      {!admin ? <p className={`${card} text-xs text-space-300`}>Only an admin changes these (logins listed in ARENA_ADMINS). You can see what is set.</p> : null}

      <div className={card}>
        <h3 className="font-semibold text-space-50">Providers</h3>
        <ul className="mt-2 space-y-2">
          {panels.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${p.status.ok ? "bg-gain" : "bg-loss"}`} aria-hidden />
                  <span className="font-medium text-space-100">{p.label}</span>
                  <span className="text-xs text-space-300">{p.status.ok ? "ready" : p.status.reason}</span>
                </div>
                <p className="ml-4 text-[11px] text-space-300">{ago(p.checkedAt)}</p>
                {p.notice ? <p className="ml-4 text-[11px] text-loss">{p.notice}</p> : null}
              </div>
              {admin ? <TestConnection provider={p.id} action={testConnectionAction} /> : null}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-space-300">Test connection sends one tiny prompt; on a paid provider that is a real, billed call.</p>
      </div>

      <div className={`${card} ${fieldset}`}>
        <h3 className="mb-2 font-semibold text-space-50">Which provider runs a call</h3>
        <AiForm action={saveProviderAction}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs text-space-300">
              Main provider
              <select name="provider" defaultValue={settings.provider ?? ""} className={selectCls}>
                <option value="">Default (env AI_PROVIDER, else anthropic-api)</option>
                {panels.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs text-space-300">
              Fallback provider
              <select name="fallbackProvider" defaultValue={settings.fallbackProvider ?? ""} className={selectCls}>
                <option value="">None — fail with a clear message</option>
                {panels.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="tap flex items-center gap-2 text-xs text-space-100">
            <input type="checkbox" name="fallbackOnUnavailable" defaultChecked={settings.fallbackOnUnavailable} />
            Fall back when the main provider is unavailable
          </label>
          <p className="text-[11px] text-space-300">
            A provider that cannot do the task (the card scan needs images) always goes to the fallback if there is one, and fails otherwise. A call never quietly runs on something weaker.
          </p>
        </AiForm>
      </div>

      <div className={`${card} ${fieldset}`}>
        <h3 className="mb-2 font-semibold text-space-50">Model per tier</h3>
        <AiForm action={saveTiersAction}>
          {panels.map((p) => (
            <div key={p.id} className="space-y-2">
              {several ? <h4 className="text-xs font-semibold text-space-200">{p.label}</h4> : null}
              <div className="grid gap-3 md:grid-cols-3">
                {TIER_IDS.map((t) => {
                  const need = { vision: IMAGE_TIERS.includes(t), json: true };
                  const opts = pickable({ [p.id]: p.models }, need).map((m) => ({ value: m.id, label: m.label, detail: describeModel(m) }));
                  return (
                    <div key={t} className="space-y-1">
                      <p className="text-xs font-medium capitalize text-space-100">{t}</p>
                      <p className="text-[11px] text-space-300">{TIER_NOTE[t]}</p>
                      <ModelSelect name={`tier:${p.id}|${t}`} options={opts} defaultValue={settings.tiers[p.id]?.[t] ?? ""} defaultLabel={`Default (${labelOf(p.id, TIERS[p.id]?.[t])})`} />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </AiForm>
      </div>

      <div className={`${card} ${fieldset}`}>
        <h3 className="mb-2 font-semibold text-space-50">Per task</h3>
        <p className="mb-2 text-[11px] text-space-300">Leave a task on “follow the tiers” unless it needs its own provider or model. Each picker lists only models that can do the task.</p>
        <AiForm action={saveTasksAction}>
          {TASK_GROUPS.map((g) => (
            <div key={g.id} className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-space-300">{g.label}</h4>
              {(Object.keys(TASKS) as RunKind[])
                .filter((t) => TASKS[t].group === g.id)
                .map((t) => {
                  const o = settings.taskOverrides[t];
                  const opts = optionsOf(pickable(lists, needsOf(t)), several);
                  return (
                    <div key={t} className="grid gap-2 rounded-lg border border-space-800 p-2 md:grid-cols-[10rem_1fr_1fr] md:items-start">
                      <p className="text-xs font-medium text-space-100">
                        {TASKS[t].label}
                        {t === "scan_identify" ? <span className="block text-[11px] font-normal text-space-300">needs image input</span> : null}
                      </p>
                      <select name={`provider:${t}`} defaultValue={o?.provider && !o.model ? o.provider : ""} className={selectCls} aria-label={`${TASKS[t].label} provider`}>
                        <option value="">Provider: follow the setting</option>
                        {panels.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                      <ModelSelect
                        name={`model:${t}`}
                        options={opts}
                        defaultValue={o?.provider && o.model ? encodeRef({ provider: o.provider, model: o.model }) : ""}
                        defaultLabel="Model: follow the tiers"
                      />
                    </div>
                  );
                })}
            </div>
          ))}
        </AiForm>
      </div>

      <div id="arena-models" className={`${card} ${fieldset}`}>
        <h3 className="mb-1 font-semibold text-space-50">Arena opponent</h3>
        <p className="mb-2 text-[11px] text-space-300">
          Chosen directly, not through the tiers, so changing the fast tier never changes the arena. Only models with structured output are offered: the answer is a move number from the legal list.
          The referee is a per-task setting above.
        </p>
        <AiForm action={saveArenaAction}>
          <div className="grid gap-3 md:grid-cols-3">
            {ARENA_SLOTS.map((slot) => {
              const cur = settings.arena[slot];
              const def = slot === "tournament.key" ? MODEL : FAST_MODEL;
              return (
                <div key={slot} className="space-y-1">
                  <p className="text-xs font-medium text-space-100">{ARENA_SLOT_INFO[slot].label}</p>
                  <p className="text-[11px] text-space-300">{ARENA_SLOT_INFO[slot].note}</p>
                  <ModelSelect
                    name={`arena:${slot}`}
                    options={optionsOf(pickable(lists, ARENA_NEEDS), several)}
                    defaultValue={cur ? encodeRef(cur) : ""}
                    defaultLabel={`Default (${labelOf("anthropic-api", def)})`}
                  />
                </div>
              );
            })}
          </div>
        </AiForm>
      </div>
    </section>
  );
}
