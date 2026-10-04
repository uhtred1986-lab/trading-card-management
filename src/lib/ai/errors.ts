/**
 * What can go wrong with a model call, in words no vendor owns. Adapters turn
 * their SDK's errors into these; `describeAiError` turns them into UI text.
 */
export type AiErrorKind = "auth" | "rate_limit" | "usage_limit" | "refusal" | "bad_output" | "unsupported" | "unavailable" | "timeout" | "provider";

export class AiError extends Error {
  readonly kind: AiErrorKind;
  readonly provider?: string;
  readonly status?: number;

  constructor(kind: AiErrorKind, message: string, opts: { provider?: string; status?: number; cause?: unknown } = {}) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = "AiError";
    this.kind = kind;
    this.provider = opts.provider;
    this.status = opts.status;
  }
}

/**
 * An {@link AiError} with the standard wording for its kind. `label` is the
 * provider's name as the user knows it ("Anthropic"); `detail` is the vendor's
 * own message, shown for the kinds that have nothing better to say.
 */
export function aiError(kind: AiErrorKind, label: string, opts: { provider?: string; status?: number; detail?: string; cause?: unknown } = {}): AiError {
  const detail = opts.detail ?? "";
  const text: Record<AiErrorKind, string> = {
    auth: `${label} API key was rejected.`,
    rate_limit: `Rate limited by ${label} — try again in a moment.`,
    usage_limit: `${label} usage limit reached${detail ? `: ${detail}` : "."}`,
    refusal: "The model declined this request.",
    bad_output: "The model's answer did not match the expected format — try again.",
    unsupported: detail || `${label} cannot do this.`,
    unavailable: detail || `${label} is not available.`,
    timeout: `${label} took too long to answer.`,
    provider: opts.status ? `${label} API error ${opts.status}: ${detail}` : detail || `${label} failed.`,
  };
  return new AiError(kind, text[kind], { provider: opts.provider, status: opts.status, cause: opts.cause });
}

/**
 * Friendly message for the UI. An {@link AiError} already carries its
 * wording. The second branch reads an SDK error that a feature module has not
 * been moved off yet (they carry an HTTP `status`), so the text callers show
 * does not change mid-migration; it needs no vendor import.
 */
export function describeAiError(err: unknown): string {
  if (err instanceof AiError) return err.message;
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status === "number" && err instanceof Error) {
    if (status === 401) return "Anthropic API key was rejected.";
    if (status === 429) return "Rate limited by Anthropic — try again in a moment.";
    return `Anthropic API error ${status}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}
