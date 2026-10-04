/** The registry: provider id → provider. The router picks an id; this answers with the adapter. */
import type { AiProvider, ProviderId } from "../types";
import { createAnthropicApiProvider } from "./anthropic-api";
import { createOpenRouterProvider } from "./openrouter";

const defaults: Record<string, () => AiProvider> = {
  "anthropic-api": () => createAnthropicApiProvider(),
  openrouter: () => createOpenRouterProvider(),
};

const built = new Map<string, AiProvider>();

export function getProvider(id: ProviderId): AiProvider | undefined {
  const have = built.get(id);
  if (have) return have;
  const make = defaults[id];
  if (!make) return undefined;
  const p = make();
  built.set(id, p);
  return p;
}

export function providerIds(): string[] {
  return [...new Set([...Object.keys(defaults), ...built.keys()])];
}

/** Put `provider` in place of whatever answers to its id — a vendor adapter at start-up, or the fake in a check. */
export function registerProvider(provider: AiProvider): void {
  built.set(provider.id, provider);
}

/** Forget every registration made since start-up (the checks call this when they finish). */
export function resetProviders(): void {
  built.clear();
}
