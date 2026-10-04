import { createAnthropicAgentSdkProvider } from "@/lib/ai/providers/anthropic-agent-sdk";
import { serveAgentSdk } from "@/lib/ai/providers/agent-sdk-remote";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Above the adapter's 110 s timeout, under every plan's limit (docs: 300 s default with fluid compute). */
export const maxDuration = 150; // a literal for Next; equals ROUTE_MAX_DURATION_S (checked in verify/ai-agent-sdk-route.ts)

/**
 * The one function that carries the Claude Agent SDK's `claude` binary (#518; next.config.ts adds it to
 * this route only). Other functions forward their plan requests here with the `AI_AGENT_SDK_SECRET`
 * header; the secret is the guard (src/proxy.ts exempts this exact path from Basic Auth because the
 * callers are functions, not browsers). Logic and wire format: providers/agent-sdk-remote.ts.
 */
const local = createAnthropicAgentSdkProvider({ remote: false });

export async function POST(request: Request) {
  return serveAgentSdk(request, { provider: local });
}
