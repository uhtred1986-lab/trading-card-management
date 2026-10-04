/**
 * What the AI block on /settings shows (#516): each registered provider with
 * its status and models. Pure of the database; the page passes the settings in.
 */
import { availabilityOf, lastAvailability } from "./router";
import { getProvider, providerIds } from "./providers";
import { AGENT_SDK_ID, tokenExpiry } from "./providers/anthropic-agent-sdk";
import type { Availability, ModelInfo } from "./types";

export interface ProviderPanel {
  id: string;
  label: string;
  status: Availability;
  /** Epoch ms of the check the status came from. */
  checkedAt: number | null;
  models: ModelInfo[];
  /** A warning to show beside the provider (the plan token is close to expiring). */
  notice?: string;
}

export async function providerPanels(): Promise<ProviderPanel[]> {
  const out: ProviderPanel[] = [];
  for (const id of providerIds()) {
    const p = getProvider(id);
    if (!p) continue;
    const status = await availabilityOf(p);
    let models: ModelInfo[] = [];
    try {
      models = await p.listModels();
    } catch {
      // A vendor whose list cannot be fetched still shows its status; the pickers just have nothing of its to offer.
    }
    out.push({ id, label: p.label, status, checkedAt: lastAvailability(id)?.at ?? null, models, notice: id === AGENT_SDK_ID ? tokenExpiry(process.env.CLAUDE_CODE_OAUTH_TOKEN_CREATED)?.message : undefined });
  }
  return out;
}
