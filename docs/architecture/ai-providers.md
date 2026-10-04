# AI providers: one contract, swappable vendors

**Status: design, milestone "AI providers — one contract, API or subscription, any vendor".**
Written 4 Oct 2026 from the code at `5a55bca`. The issues in that milestone build it; this file is
the contract they build against. Ximilar (scan recognition) is a separate integration and out of
scope.

## Why

Every Claude call already goes through `src/lib/ai/client.ts` and lands in `ai_runs` via
`recordRun`, which is good. But each feature module calls the Anthropic SDK itself:
`anthropic().messages.parse({ …, output_config: { format: zodOutputFormat(…) } })`, with
`cache_control` blocks and per-model request shapes written at the call site. So today there is one
way to run a model — pay-per-token with `ANTHROPIC_API_KEY` — and changing vendor means touching
every feature.

The owner wants, in this order:

1. **Switch between API and subscription.** The same calls run on the Anthropic API (key) or on the
   owner's Claude plan through the Claude Agent SDK (`CLAUDE_CODE_OAUTH_TOKEN` from
   `claude setup-token`).
2. **Swap the vendor.** Replacing Anthropic is writing one adapter file — and OpenRouter is built
   in this milestone, with a model picker in the settings. No page, route, Server
   Function, arena module or script changes.
3. **Both work locally and on Vercel** (the Android client is unaffected: it only talks to our
   server).

## The one rule

> **Feature code speaks the contract in `src/lib/ai/`; only `src/lib/ai/providers/*` may import a
> vendor SDK.** An ESLint `no-restricted-imports` fence enforces it (`@anthropic-ai/sdk`,
> `@anthropic-ai/sdk/helpers/*`, `@anthropic-ai/claude-agent-sdk`, any future vendor package).

## Today (what the migration must keep working)

| `RunKind` | Module | Model (`client.ts`) | Shape |
|---|---|---|---|
| `cart_explain` | `ai/cart.ts` | `FAST_MODEL` Haiku 4.5 | Zod output; **no** thinking/effort (Haiku rejects both) |
| `deck_summary` | `ai/deck.ts` | `SONNET_MODEL` | Zod output, adaptive thinking, effort `medium` |
| `deck_wizard`, `set_review` | `ai/deck.ts` | `MODEL` Opus | Zod output, cached pool block |
| `deck_builder` | `ai/deck-builder.ts` | `MODEL` | Zod output, cached pool block |
| `deck_from_card` | `ai/deck-from-card.ts` | `MODEL` | Zod output, two cached blocks |
| `scan_identify` | `ai/scan.ts` | Sonnet, Opus fallback (`needsOpusFallback`) | **image** + Zod output |
| `arena_move`, `arena_referee` | `arena/ai/opponent.ts` (via `run.ts`) | Sparring Haiku / Tournament Opus | Zod output (a legal-move number), 1 h cache on the effect language |
| `arena_clarify` | `arena/ai/clarify.ts` | `MODEL` | Zod output, 1 h cache |
| `arena_review` | `arena/ai/review.ts` | `SONNET_MODEL` | Zod output |
| `arena_teach` | `arena/ai/teach.ts` | `MODEL` | Zod output, 1 h cache |

Every call is single-turn and structured (`messages.parse` + `zodOutputFormat`); there is no
streaming, no tool loop and no Batch API in `src/` today. Money: `PRICES` and `costMicros` in
`arena/ai/run.ts`, read by `npm run ai:spend`. Errors: `describeAiError` uses
`instanceof Anthropic.*`. Scripts (`arena:vs`, `ai:scan-compare`, `scripts/verify/ai-vm.ts`) reach
the SDK through the same modules.

**Arena invariants that must not move:** the engine computes the legal moves; decisions that cannot
go wrong never reach a model (`freeChoice`, "only one legal move"); the model answers a number from
the list, so an answer can be unwise but never illegal. These live above the AI layer and stay there.

## Target layout

```
src/lib/ai/
  types.ts          the neutral contract (below) — no vendor import
  errors.ts         AiError and its kinds; describeAiError reads these
  models.ts         tiers → model per provider, per-model capabilities, list prices (PRICES moves here)
  router.ts         which provider runs this call (settings, overrides, availability, fallback)
  core.ts           generate / generateJson (Zod) on top of a provider
  client.ts         stays: recordRun, RunKind, MODEL/SONNET_MODEL/FAST_MODEL as tier aliases
  settings.ts       read/write ai_settings
  providers/
    index.ts                 registry: id → provider
    anthropic-api.ts         @anthropic-ai/sdk, ANTHROPIC_API_KEY / APP_ANTHROPIC_API_KEY
    anthropic-agent-sdk.ts   @anthropic-ai/claude-agent-sdk, CLAUDE_CODE_OAUTH_TOKEN (Claude plan)
    openrouter.ts            OpenRouter (any vendor's model through one key), OPENROUTER_API_KEY
    fake.ts                  scripted answers for npm test — never a network call
```

Feature modules change **once**: `anthropic().messages.parse({...})` becomes
`generateJson({ task, tier, system, messages, schema, maxTokens, effort })`, which returns
`{ parsed, usage, model, provider, billed, stop }` — the same fields `recordRun` reads today. After
that, a vendor swap touches no feature file.

## The contract (`src/lib/ai/types.ts`)

A sketch; the first issue settles the exact names. Nothing in it may mention a vendor.

```ts
export type ProviderId = "anthropic-api" | "anthropic-agent-sdk" | (string & {});
export type Tier = "fast" | "standard" | "best";   // fast = Haiku, standard = Sonnet, best = Opus today
export type TaskId = RunKind;                       // reuse the existing kinds
export type CacheHint = "none" | "short" | "long";  // Anthropic: 5 min / 1 h; others ignore it

export type Part =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; base64: string };

export interface AiMessage { role: "user" | "assistant"; parts: Part[] }
export interface SystemBlock { text: string; cache?: CacheHint }

export interface AiRequest {
  task: TaskId;
  tier?: Tier;
  model?: string;                       // explicit model wins over tier
  system: SystemBlock[];
  messages: AiMessage[];
  maxTokens: number;
  effort?: "low" | "medium" | "high";   // dropped where the model has none (Haiku)
  thinking?: "off" | "adaptive";        // dropped where the model has none
  output?: { kind: "text" } | { kind: "json"; schema: ZodType };
  provider?: ProviderId;                // hard pin, e.g. a future batch job
  signal?: AbortSignal;
}

export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number }

export interface AiResult<T = unknown> {
  text: string;
  parsed?: T;                           // validated against the Zod schema
  stop: "end" | "max_tokens" | "refusal";
  usage: Usage;
  provider: ProviderId;
  model: string;
  billed: boolean;                      // false on the subscription
  latencyMs: number;
}

export interface Capabilities { vision: boolean; json: boolean; streaming: boolean; cacheHints: boolean; batch: boolean }
export type Availability = { ok: true } | { ok: false; reason: string };

export interface AiProvider {
  id: ProviderId;
  label: string;
  capabilities(): Capabilities;
  available(): Promise<Availability>;   // cheap; cached by the router
  listModels(): Promise<ModelInfo[]>;   // for the settings' model picker (see below)
  generate(req: AiRequest): Promise<AiResult>;
}
```

`tools`, `stream` and a tool loop are deliberately **not** in this repo's first contract — nothing
uses them. The Gullet Cove repo has the same contract plus those, so adding them later is copying,
not designing.

**Errors** (`errors.ts`): `AiError` with `kind` ∈ `auth | rate_limit | usage_limit | refusal |
bad_output | unsupported | unavailable | timeout | provider`. `describeAiError` maps kinds to the
UI text; `recordRun`'s refusal / no-parse checks move to `refusal` / `bad_output`.

**Structured answers.** `output: json` sends the schema natively where the provider can, otherwise
asks for JSON in text; either way core validates with Zod and retries **once** with the validation
error before failing with `bad_output`. That keeps `scan.ts`'s "unparseable → Opus fallback" path
working, and makes a vendor without native structured output usable.

## Routing (`router.ts`)

The provider for a call is the first that applies:

1. `req.provider` (a hard pin in code);
2. the **per-task override** in `ai_settings` (e.g. `arena_move → anthropic-api` if the subscription
   is too slow for live turns);
3. the **global provider** in `ai_settings`;
4. env `AI_PROVIDER`;
5. `anthropic-api`.

Then two checks:

- **Capability.** A request needing something the provider lacks (an image for `scan_identify`,
  JSON) goes to `ai_settings.fallbackProvider` if set, else fails with `unsupported`. Never a silent
  downgrade.
- **Availability.** `available()` is a real self-test (credentials present, runtime OK, last health
  call succeeded), cached ~10 min. Unavailable → fallback only if
  `ai_settings.fallbackOnUnavailable` is on (logged), else `unavailable` with a readable message.

`ai_settings` is a new single-row table (Drizzle, additive): `provider`, `fallbackProvider`,
`fallbackOnUnavailable`, `taskOverrides` (jsonb: provider and/or model per task), `models` (jsonb:
provider → tier → model id), `updatedAt`. The settings page edits it; the arena
admin sees the active provider, players never do.

## Models (`models.ts`)

One table maps `tier × provider → model`; each model carries its own capabilities and list price:
`{ id, provider, effort, adaptiveThinking, vision, usdPerMTok: { in, out, cacheRead, cacheWrite } }`.
`MODEL`, `SONNET_MODEL`, `FAST_MODEL` stay as named tier aliases so the owner's model rulings (#381)
read the same. `PRICES`/`costMicros` move here; `ai:spend` reads the new home. The arena's
Sparring/Tournament choice stays a tier choice in `opponent.ts`.

## Money and the ledger

- `ai_runs` gains `provider` (text, default `anthropic-api`) and `billed` (bool, default true) —
  additive, old rows read as API calls. `recordRun` fills both from `AiResult`.
- `ai:spend` reports billed and notional cost apart, per provider.
- Prompt caching: the Anthropic API adapter maps `cache: "long"` to the 1 h TTL the arena uses today
  and `"short"` to the default; other providers ignore hints (logged once).

## The subscription adapter (`anthropic-agent-sdk.ts`)

The Agent SDK spawns a `claude` CLI subprocess (the TypeScript SDK ships the native binary as an
optional dependency) and talks to it over stdio. Rules — **verify every option name against the
installed SDK's types and docs, never from memory**:

- No Claude Code tools; one turn; our own system prompt replaces the Claude Code default.
- `settingSources: []` and `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, so this repo's `CLAUDE.md`,
  `docs/CLAUDE-TASK.md`, hooks, MCP config and auto-memory never reach an app call.
- `cwd` = an empty directory under `os.tmpdir()`; `CLAUDE_CONFIG_DIR` under `/tmp` on Vercel.
- In TypeScript `env` **replaces** the child environment: build it explicitly, keep `PATH`/`HOME`,
  set `CLAUDE_CODE_OAUTH_TOKEN`, and **strip both `ANTHROPIC_API_KEY` and `APP_ANTHROPIC_API_KEY`**
  — otherwise the CLI bills the API.
- Read the token from `CLAUDE_CODE_OAUTH_TOKEN` or `APP_CLAUDE_CODE_OAUTH_TOKEN` — the same reason
  `APP_ANTHROPIC_API_KEY` exists: Claude Code on the web reserves its own auth variables.
- Timeout + `AbortController` below the route's `maxDuration`.
- Usage-limit and 429 answers become `AiError("usage_limit")`.
- `CLAUDE_CODE_OAUTH_TOKEN_CREATED` (date) lets settings warn 30 days before the ~1-year expiry.
- Capabilities are **declared only after a test proves them**: image input (`scan_identify`) and
  JSON schema. Unproven stays `false`; the router sends that task to the fallback.
- Cache hints ignored (log once). `billed: false` on every result.

**Latency.** Every call starts a process. That is fine for a deck summary; for live arena turns it
must be measured (the spike runs a 10-decision Sparring sequence on both providers) before the owner
decides whether `arena_move` gets a per-task override to the API.

**Vercel.** Possible in principle — Node.js functions allow child processes; memory and the 300 s
default duration are enough for single-shot calls — but three things must be proven on the real
deployment: the binary is in the function bundle (`outputFileTracingIncludes`, maybe
`serverExternalPackages`), the function stays under 250 MB uncompressed (or uses the large-functions
beta, which needs the owner's go), and cold-start latency is acceptable. Only `main` deploys, so the
spike ships **inert**: an admin-only "Test connection" that does nothing unless `AI_AGENT_SDK=1` is
set. The bundling question it answers: does the binary go into every function that can call a model,
or into one internal route the adapter calls (API routes are allowed in this repo; it would be
admin/Basic-Auth-guarded like the rest)? Plan B, only with the owner's go: the SDK inside a Vercel
Sandbox.

## OpenRouter (`openrouter.ts`) — the second vendor, chosen by the owner (4 Oct 2026)

OpenRouter puts many vendors' models behind one key and one OpenAI-compatible API
(`https://openrouter.ai/api/v1`). It is built in this milestone, not later. Rules — **verify every
field against OpenRouter's docs, never from memory**:

- Key `OPENROUTER_API_KEY`, server-only, in `.env.local` and Vercel. Plain `fetch` (or the `openai`
  package pointed at the base URL) — either way only inside `providers/`.
- Mapping: system blocks → the system message; `Part`s → content parts (images as data URLs);
  `output: json` → `response_format` with a JSON schema only when the model lists
  `structured_outputs`, otherwise JSON in text plus core's one validation retry.
- `effort` → OpenRouter's `reasoning` only when the model lists it, else dropped. Cache hints are
  passed through only for model families where OpenRouter documents `cache_control` (Anthropic's);
  ignored otherwise.
- Errors: 401 → `auth`, 402 (credits used up) → `usage_limit` with a readable message, 429 →
  `rate_limit`, 5xx → `provider`.
- **Capabilities are per model**, not per provider: the router checks the *chosen model's*
  `architecture.input_modalities` and `supported_parameters`. `scan_identify` on a model without image input goes to the fallback or fails with `unsupported` — never a silent downgrade. The arena's legal-move validation applies to every model's answer unchanged.
- `listModels()` reads `GET /api/v1/models` (id, name, `context_length`, `pricing` per token,
  `architecture.input_modalities`, `supported_parameters`), cached ~1 h.
- `billed: true`; cost from the model's listed price, or OpenRouter's reported cost when the response
  carries it.
- Optional app-attribution headers as OpenRouter documents them.

## The model selector

Every provider answers `listModels(): Promise<ModelInfo[]>` with
`ModelInfo = { id, label, contextLength, capabilities: { vision, json, tools }, usdPerMTok: { in, out } }`
— the Anthropic adapters from `models.ts`, OpenRouter from its live list. The settings page has a
**model picker per tier and, optionally, per task**: searchable, showing price and context, and
filtered to models that can do what the task needs (image input for `scan_identify`; structured output preferred everywhere). The choice is stored in
`ai_settings.models` (jsonb: provider → tier → model id, plus a model in `taskOverrides`).

**Arena modes** (owner, 4 Oct 2026) get their own block on the settings page, separate from the tiers,
so changing the `fast` tier never silently changes the arena. Three slots, each `{ provider, model }`
in `ai_settings.models`:

| Slot | Decides | Default |
|---|---|---|
| `arena.sparring` | every Sparring decision | `FAST_MODEL` (Haiku 4.5) |
| `arena.tournament.key` | Tournament `main`, `counter`, `blocker`, `combo` prompts | `MODEL` (Opus 5), effort `medium` |
| `arena.tournament.other` | every other Tournament decision | `FAST_MODEL` |

`modelFor` in `arena/ai/opponent.ts` keeps the list of key prompt kinds and asks the router for the
slot's model. The pickers offer only models with structured output (the answer is a move number from
the legal list). The referee (`arena_referee`) stays an ordinary per-task override.

Model precedence for a call: `req.model` in code → the per-task model in `ai_settings` → the per-tier
model in `ai_settings` for the active provider → env (none today; `MODEL`, `SONNET_MODEL`, `FAST_MODEL` are the code defaults) → the `models.ts` default. Changing a
model never rewrites a stored answer.

## Adding a vendor later

1. `src/lib/ai/providers/<vendor>.ts` implementing `AiProvider` (messages, images, JSON schema from
   Zod, errors, usage); models and prices in `models.ts`.
2. Run the contract suite against it (`scripts/verify/ai-contract.ts`, fake transport, no network)
   and `npm run ai:smoke -- --provider <vendor>` (live, paid, the owner runs it).
3. Add it to the settings picker. Nothing else changes.

## Tests

- `npm test` never calls a model: the fake provider and recorded transports only.
- One contract suite runs against every adapter: text, image, JSON (valid; invalid → one retry →
  `bad_output`), refusal, error mapping, usage mapping, `billed`, effort/thinking dropped on models
  without them.
- Router checks: precedence, capability fallback, availability fallback on/off, no silent downgrade.
- Arena: an illegal or out-of-range answer from any provider is rejected exactly as today.
- `npm run ai:smoke` (live, paid) is the owner's to run, per provider.
