/**
 * Which provider runs a call. Until the settings exist (#516) the answer is
 * always `anthropic-api`, unless the request pins another one. The capability
 * check is already real: a request that needs an image or JSON from a provider
 * without them fails with `unsupported`, it is never quietly downgraded.
 */
import { AiError } from "./errors";
import { getProvider } from "./providers";
import type { AiProvider, AiRequest } from "./types";

const DEFAULT_PROVIDER = "anthropic-api";

export async function route(req: AiRequest): Promise<AiProvider> {
  const id = req.provider ?? DEFAULT_PROVIDER;
  const provider = getProvider(id);
  if (!provider) throw new AiError("unavailable", `There is no AI provider called "${id}".`, { provider: id });
  const caps = provider.capabilities();
  if (!caps.vision && req.messages.some((m) => m.parts.some((p) => p.type === "image"))) {
    throw new AiError("unsupported", `${provider.label} cannot read images.`, { provider: id });
  }
  if (!caps.json && req.output?.kind === "json") {
    throw new AiError("unsupported", `${provider.label} cannot give structured answers.`, { provider: id });
  }
  return provider;
}
