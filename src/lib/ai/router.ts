/**
 * Which provider and model run a call (#516, docs/architecture/ai-providers.md).
 *
 * Provider: a hard pin in the request, then the task's override in the
 * settings, then the global setting, then env `AI_PROVIDER`, then
 * `anthropic-api`. Model: the request's own, then the task's override, then the
 * settings' per-tier choice for the provider that runs, then the table's
 * default for the tier (`models.ts`).
 *
 * Two checks follow. Capability: a provider or model that cannot read an image
 * or give a structured answer goes to the fallback provider, or fails with
 * `unsupported` — never a quiet downgrade. Availability: `available()` is
 * cached for ten minutes; an unavailable provider falls back only when the
 * owner switched that on (and it is logged), else fails with `unavailable`.
 *
 * With nothing configured the answer is `anthropic-api` on {@link TIERS}, so a
 * call is the one it was before the settings existed. A request pinned in code
 * is never rerouted: it fails instead.
 */
import { AiError, aiError } from "./errors";
import { modelEntry, TIERS } from "./models";
import { getProvider } from "./providers";
import { getSettings, type AiSettings } from "./settings";
import type { AiProvider, AiRequest, Availability, ProviderId } from "./types";

export const DEFAULT_PROVIDER: ProviderId = "anthropic-api";
/** How long a provider's `available()` answer is reused. */
export const AVAILABILITY_TTL_MS = 10 * 60 * 1000;

export interface Routed {
  provider: AiProvider;
  /** The request to send: `model` is filled from the settings and tables. */
  request: AiRequest;
  /** Why this provider ran, for the log and the admin view. */
  via: "pin" | "task" | "global" | "env" | "default" | "fallback";
}

interface Checked {
  at: number;
  provider: AiProvider;
  result: Availability;
}
const checked = new Map<string, Checked>();

/** The last answer `available()` gave for each provider (the settings page shows when it was checked). */
export function lastAvailability(id: ProviderId): { at: number; result: Availability } | undefined {
  const c = checked.get(id);
  return c ? { at: c.at, result: c.result } : undefined;
}

export function forgetAvailability(id?: ProviderId): void {
  if (id) checked.delete(id);
  else checked.clear();
}

/** Cached `available()`. A provider that throws counts as unavailable, with its message. */
export async function availabilityOf(provider: AiProvider, now = Date.now()): Promise<Availability> {
  const hit = checked.get(provider.id);
  if (hit && hit.provider === provider && now - hit.at < AVAILABILITY_TTL_MS) return hit.result;
  let result: Availability;
  try {
    result = await provider.available();
  } catch (err) {
    result = { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
  checked.set(provider.id, { at: now, provider, result });
  return result;
}

function envProvider(): ProviderId | undefined {
  return process.env.AI_PROVIDER?.trim() || undefined;
}

/** The model a provider runs for a request: the task's override if it fits this provider, else the tier's choice. */
function modelOn(provider: ProviderId, req: AiRequest, settings: AiSettings, useOverride: boolean): string | undefined {
  const own = settings.taskOverrides[req.task];
  if (useOverride && own?.model) return own.model;
  if (req.tier) return settings.tiers[provider]?.[req.tier] ?? TIERS[provider]?.[req.tier];
  return undefined;
}

/** Why a provider and model cannot take this request, if they cannot. */
function cannot(provider: AiProvider, model: string | undefined, req: AiRequest): string | undefined {
  const caps = provider.capabilities();
  const entry = model ? modelEntry(model, provider.id) : undefined;
  const wantsImage = req.messages.some((m) => m.parts.some((p) => p.type === "image"));
  if (wantsImage && !caps.vision) return `${provider.label} cannot read images.`;
  if (wantsImage && entry && !entry.vision) return `${entry.label} cannot read images.`;
  if (req.output?.kind === "json" && !caps.json) return `${provider.label} cannot give structured answers.`;
  return undefined;
}

/** Lets a provider load its per-model capabilities before the router asks about a model; never fails the call. */
async function warm(provider: AiProvider): Promise<void> {
  try {
    await provider.prepare?.();
  } catch {
    /* the capability check then works with what is known */
  }
}

export async function resolve(req: AiRequest, settings?: AiSettings): Promise<Routed> {
  const s = settings ?? (await getSettings());
  const override = s.taskOverrides[req.task];

  let id: ProviderId;
  let via: Routed["via"];
  if (req.provider) [id, via] = [req.provider, "pin"];
  else if (override?.provider) [id, via] = [override.provider, "task"];
  else if (s.provider) [id, via] = [s.provider, "global"];
  else if (envProvider()) [id, via] = [envProvider()!, "env"];
  else [id, via] = [DEFAULT_PROVIDER, "default"];

  const provider = getProvider(id);
  if (!provider) throw new AiError("unavailable", `There is no AI provider called "${id}".`, { provider: id });

  // An override that names a model but no provider belongs to whichever provider the task gets; one that names both, to its own.
  const model = req.model ?? modelOn(id, req, s, !override?.provider || override.provider === id);

  await warm(provider);
  const unfit = cannot(provider, model, req);
  const down = unfit ? undefined : await availabilityOf(provider);
  const problem = unfit ?? (down && !down.ok ? down.reason : undefined);
  if (!problem) return { provider, request: model && model !== req.model ? { ...req, model } : req, via };

  const kind = unfit ? "unsupported" : "unavailable";
  const fallbackId = s.fallbackProvider;
  // Pinned in code: the caller named this provider, so failing is the honest answer.
  const mayFallBack = !req.provider && !!fallbackId && fallbackId !== id && (!!unfit || s.fallbackOnUnavailable);
  if (!mayFallBack) throw aiError(kind, provider.label, { provider: id, detail: problem });

  const fb = getProvider(fallbackId);
  if (!fb) throw aiError(kind, provider.label, { provider: id, detail: `${problem} The fallback provider "${fallbackId}" does not exist.` });
  // A model named in code, or by the first provider's override, means nothing on another vendor; only the tier does.
  const fbModel = modelOn(fb.id, req, s, override?.provider === fb.id) ?? (req.model && modelEntry(req.model, fb.id) ? req.model : undefined);
  await warm(fb);
  const fbProblem = !fbModel && !req.tier ? "there is no model to run this on" : cannot(fb, fbModel, req);
  const fbDown = fbProblem ? undefined : await availabilityOf(fb);
  const fbWhy = fbProblem ?? (fbDown && !fbDown.ok ? fbDown.reason : undefined);
  if (fbWhy) throw aiError(kind, provider.label, { provider: id, detail: `${problem} The fallback, ${fb.label}, cannot take it either: ${fbWhy}` });

  console.warn(`[ai] ${req.task}: ${provider.label} ${unfit ? "cannot do it" : "is unavailable"} (${problem}) — running on ${fb.label}`);
  return { provider: fb, request: { ...req, model: fbModel }, via: "fallback" };
}

/** The provider for a request (the old entry point; {@link resolve} also returns the request to send). */
export async function route(req: AiRequest): Promise<AiProvider> {
  return (await resolve(req)).provider;
}
