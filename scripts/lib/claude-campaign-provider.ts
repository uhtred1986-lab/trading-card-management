/**
 * #902: the one provider a paid campaign call goes through. The Anthropic API adapter, built with the
 * SDK's own retries off: the SDK would otherwise resend a 408/409/429/5xx or a dropped connection
 * twice on its own, and those resends are requests the ledger never reserved. Every retry the
 * campaign makes is the runner's, reserved like the first attempt (`claude-duel.ts`).
 *
 * The key is read from the environment when the first request is built and is held only by the SDK
 * client; nothing here returns, logs or records it. The module is loaded only on the paid path, so a
 * dry run's import graph has no vendor SDK.
 */
import type { AiProvider } from "../../src/lib/ai/types";

/** The SDK retries the campaign provider is built with. Pinned: anything but 0 sends unreserved requests. */
export const CAMPAIGN_SDK_RETRIES = 0;

export async function campaignApiProvider(): Promise<AiProvider> {
  const { createAnthropicApiProvider } = await import("../../src/lib/ai/providers/anthropic-api");
  return createAnthropicApiProvider({ maxRetries: CAMPAIGN_SDK_RETRIES });
}
