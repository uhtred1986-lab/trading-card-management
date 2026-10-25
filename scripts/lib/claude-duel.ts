/**
 * #901: the isolated local-policy versus Claude API duel — one pinned game, played offline on the
 * real rules VM (`browser.ts`'s pinned match), never through the arena's game tables.
 *
 *  - The local seat is the built-in opponent exactly as the strength proofs play it: `localStep`
 *    with `localPolicy()` under the cycle guard and its own seeded policy RNG (the same derivation
 *    as `scripts/verify/arena-policy-duel.ts`).
 *  - The Claude seat is handed the same restricted `PolicyInput` (`policyTurn`) and nothing else;
 *    the request is `claude-duel-prompt.ts`'s rendering of it. A free choice (the coin flip, the
 *    mulligan, the charge — `policy/shortcuts.ts`, the online opponent's own list) and a menu of one
 *    are taken without a call; every other decision is one menu number from the model.
 *  - The provider is called **directly** (an `AiProvider`, never `generate`/the router), with an
 *    explicit model: no tier, no subscription, no OpenRouter, no fallback. The fake provider is the
 *    same interface, so the dry run exercises every line below at $0 and without a network.
 *  - Every call is reserved in the campaign ledger (#902) before it leaves, at the most it can cost,
 *    and settled from its reported usage afterwards; a call without usage keeps its reservation.
 *    No retry is hidden inside the provider layer (`generateJson`'s own retry would be an unreserved
 *    call): each retry here is a new reserved call.
 *
 * Every stop is a typed outcome with the evidence to replay it: the decisions in order, each call's
 * request hash, raw answer, usage and ledger reservation. Replaying the recorded answers through a
 * scripted provider reproduces the game and its trace hash (`replayDuel`).
 */
import { createHash } from "node:crypto";
import type { PlayerId } from "../../src/lib/arena/types";
import type { ReplayBundleRecord } from "../../src/lib/arena/replay-core";
import { createPinnedMatch, type PinnedMatch } from "../../src/lib/arena/browser";
import { resolveOutcome } from "../../src/lib/arena/outcome";
import { applyDecision, localStep, policyTurn } from "../../src/lib/arena/policy/boundary";
import { answerFor, fingerprint, stableJson, type PolicyAnswer, type PolicyInput } from "../../src/lib/arena/policy/contract";
import { localMemory, TURN_GUARD, type LocalMemory } from "../../src/lib/arena/policy/main";
import { localPolicy } from "../../src/lib/arena/policy/combat";
import { policyRng } from "../../src/lib/arena/policy/rng";
import { shortcutFor } from "../../src/lib/arena/policy/shortcuts";
import { AiError, type AiErrorKind } from "../../src/lib/ai/errors";
import type { AiProvider, AiRequest, AiResult } from "../../src/lib/ai/types";
import { duelPrompt, duelRequest, DuelAnswerSchema, PROMPT_VERSION } from "./claude-duel-prompt";
import { chargeMicros, maxChargeMicros, promptTokenBound, type CampaignModelRate } from "./claude-campaign-rates";
import type { CampaignLedger, CampaignPhase } from "./claude-campaign-ledger";

export const DUEL_RUNNER_VERSION = 1;

/** Everything a game's limits are; pinned into the protocol revision. */
export interface DuelSettings {
  model: string;
  /** Output tokens per call (`max_tokens`, thinking included). */
  maxOutputTokens: number;
  /** A call whose prompt bound (`promptTokenBound`) is larger is not sent: `token-limit`. */
  maxPromptTokens: number;
  /** Decisions the model answers per game (free choices excluded). */
  maxClaudeDecisions: number;
  /** Provider calls per game, retries included. */
  maxCallsPerGame: number;
  /** Engine moves per game. */
  maxMoves: number;
  /** Further calls for one decision after a malformed or illegal answer, a rate error or a provider error. */
  maxRetries: number;
  /** Wall time per game. */
  wallTimeMs: number;
  /** Wall time per call. */
  callTimeoutMs: number;
  /** No progress: Claude decisions in one turn, and repeats of one position in a turn (the local cycle guard's limits by default). */
  maxDecisionsPerTurn: number;
  maxRepeats: number;
  effort?: "low" | "medium" | "high";
  thinking?: "off" | "adaptive";
}

export const DEFAULT_SETTINGS: Omit<DuelSettings, "model"> = {
  maxOutputTokens: 1500,
  maxPromptTokens: 60_000,
  maxClaudeDecisions: 120,
  maxCallsPerGame: 160,
  maxMoves: 3000,
  maxRetries: 2,
  wallTimeMs: 30 * 60_000,
  callTimeoutMs: 120_000,
  maxDecisionsPerTurn: TURN_GUARD.decisions,
  maxRepeats: TURN_GUARD.repeats,
};

export type ProviderKind = "anthropic-api" | "fake";

export interface DuelSpec {
  /** The game's ledger key: used once. */
  key: string;
  phase: CampaignPhase;
  bundle: ReplayBundleRecord;
  interpreterRevision: string;
  gameSeed: number;
  /** The local seat's policy RNG derives from this (never the game's seed). */
  policySeed: number;
  claudeSeat: PlayerId;
}

export interface DuelDeps {
  provider: AiProvider;
  providerKind: ProviderKind;
  rate: CampaignModelRate;
  ledger: CampaignLedger;
  settings: DuelSettings;
  /** Cancels the game: an in-flight call is aborted (and keeps its reservation). */
  signal?: AbortSignal;
  /** Backoff between retries; the dry run passes a no-op. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Sees every request before it is sent, with the policy input it was built from (prompt capture). */
  capture?: (c: { seat: PlayerId; revision: number; input: PolicyInput; request: AiRequest }) => void;
  /** Called before every decision with the match (tests stage engine states through it, as `playDuel`'s `observe`). */
  observe?: (match: PinnedMatch, seat: PlayerId, revision: number) => void;
}

export type DuelOutcomeKind =
  | "completed"
  | "malformed"
  | "illegal"
  | "refusal"
  | "rate-limited"
  | "provider-error"
  | "interrupted"
  | "no-progress"
  | "move-cap"
  | "decision-cap"
  | "wall-time"
  | "budget-limited"
  | "token-limit"
  | "cancelled";

/** Limits reached before a result: incomplete, never a draw or a win. */
export const LIMITED: readonly DuelOutcomeKind[] = ["move-cap", "decision-cap", "wall-time", "budget-limited", "token-limit"];

export interface CallEvidence {
  attempt: number;
  reservation: string | null;
  maxMicros: number | null;
  requestSha256: string;
  promptTokenBound: number;
  /** Raw model text, when the call answered. */
  text: string | null;
  stop: AiResult["stop"] | null;
  usage: AiResult["usage"] | null;
  chargedMicros: number | null;
  billed: boolean | null;
  /** The failure, when there was one: an `AiError` kind or the runner's own reason. */
  error: { kind: AiErrorKind | "aborted" | "model-mismatch"; message: string } | null;
  /** Why the answer was not played (malformed / illegal), when it was not. */
  rejected: string | null;
}

export interface DecisionEvidence {
  n: number;
  seat: PlayerId;
  role: "claude" | "local";
  window: string;
  at: string;
  source: "local" | "shortcut" | "single" | "claude";
  id: string | null;
  cards?: string[];
  guard?: string | null;
  calls?: CallEvidence[];
}

export interface DuelResult {
  key: string;
  outcome: DuelOutcomeKind;
  /** Only for `completed`. */
  winner: "claude" | "local" | "draw" | null;
  winnerSeat: PlayerId | null;
  reason: string | null;
  detail: string | null;
  moves: number;
  turn: number;
  claudeDecisions: number;
  calls: number;
  /** Charged in the ledger for this game's calls (reservations of ambiguous calls included). */
  chargedMicros: number;
  /** Of that, what the provider reported as billed. */
  billedMicros: number;
  damage: { toClaude: number; toLocal: number };
  localGuards: number;
  trace: string;
  pins: DuelPins;
  decisions: DecisionEvidence[];
}

export interface DuelPins {
  runner: number;
  prompt: number;
  providerKind: ProviderKind;
  model: string;
  settings: DuelSettings;
  bundleHash: string;
  interpreterRevision: string;
  gameSeed: number;
  policySeed: number;
  claudeSeat: PlayerId;
  localSeat: PlayerId;
  localPolicyRng: { seed: number; n: number };
}

const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");
const sha = (v: unknown) => createHash("sha256").update(typeof v === "string" ? v : stableJson(v)).digest("hex");
export const localSeedFor = (policySeed: number, seat: PlayerId) => policySeed * 2 + (seat === "p1" ? 1 : 2);

/** The model's JSON: bare, fenced, or with prose around it. */
function parseAnswer(text: string): { ok: true; move: number; cards?: string[] } | { ok: false; why: string } {
  const t = text.trim();
  const tries = [t];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) tries.push(fence[1].trim());
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) tries.push(t.slice(a, b + 1));
  for (const c of tries) {
    try {
      const parsed = DuelAnswerSchema.safeParse(JSON.parse(c));
      if (parsed.success) return { ok: true, move: parsed.data.move, ...(parsed.data.cards ? { cards: parsed.data.cards } : {}) };
      return { ok: false, why: `it does not match {"move": number, "cards"?: string[]}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ")}` };
    } catch { /* next candidate */ }
  }
  return { ok: false, why: "the answer is not JSON" };
}

function requestText(req: AiRequest): string[] {
  return [...req.system.map((s) => s.text), ...req.messages.flatMap((m) => m.parts.map((p) => (p.type === "text" ? p.text : p.base64)))];
}

type CallOutcome =
  | { ok: true; answer: PolicyAnswer; played: Extract<ReturnType<typeof applyDecision>, { ok: true }> }
  | { ok: false; outcome: DuelOutcomeKind; detail: string };

export async function playClaudeDuel(spec: DuelSpec, deps: DuelDeps): Promise<DuelResult> {
  const { settings, ledger, provider, rate } = deps;
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const started = now();
  const localSeat = other(spec.claudeSeat);
  const localSeed = localSeedFor(spec.policySeed, localSeat);
  const pins: DuelPins = {
    runner: DUEL_RUNNER_VERSION, prompt: PROMPT_VERSION, providerKind: deps.providerKind, model: settings.model, settings,
    bundleHash: spec.bundle.hash, interpreterRevision: spec.interpreterRevision, gameSeed: spec.gameSeed, policySeed: spec.policySeed,
    claudeSeat: spec.claudeSeat, localSeat, localPolicyRng: { seed: policyRng(localSeed).seed, n: 0 },
  };
  if (deps.providerKind === "anthropic-api" && provider.id !== "anthropic-api") throw new Error("a paid duel runs on the anthropic-api provider only");
  if (rate.model !== settings.model) throw new Error(`the rate ${rate.model} does not price the selected model ${settings.model}`);

  const decisions: DecisionEvidence[] = [];
  let calls = 0, claudeDecisions = 0, charged = 0, billed = 0, localGuards = 0;
  let hash = 0x811c9dc5;
  const mix = (text: string) => { for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0; };

  const finish = (match: PinnedMatch | null, outcome: DuelOutcomeKind, detail: string | null, n: number, lifeDealt: Record<PlayerId, number> | null): DuelResult => {
    let winnerSeat: PlayerId | null = null, reason: string | null = null, winner: DuelResult["winner"] = null;
    if (outcome === "completed" && match) {
      const last = [...(match.beats?.list ?? [])].reverse().find((b) => b.t === "over") as { winner: PlayerId | null; reason: string } | undefined;
      winnerSeat = last?.winner ?? null;
      reason = last?.reason ?? null;
      winner = winnerSeat === null ? "draw" : winnerSeat === spec.claudeSeat ? "claude" : "local";
    }
    const life = (p: PlayerId) => match?.state.sides[p].zones.life?.length ?? 0;
    const dealt = lifeDealt ?? { p1: life("p1"), p2: life("p2") };
    if (gameStarted) ledger.finishGame(spec.key, outcome);
    return {
      key: spec.key, outcome, winner, winnerSeat, reason, detail, moves: n, turn: match?.state.turn ?? 0, claudeDecisions, calls,
      chargedMicros: charged, billedMicros: billed,
      damage: { toClaude: Math.max(0, dealt[spec.claudeSeat] - life(spec.claudeSeat)), toLocal: Math.max(0, dealt[localSeat] - life(localSeat)) },
      localGuards, trace: hash.toString(16).padStart(8, "0"), pins, decisions,
    };
  };

  let gameStarted = false;
  const startedGame = ledger.startGame(spec.key, spec.phase);
  gameStarted = startedGame.ok;
  if (!startedGame.ok) return finish(null, startedGame.code === "games" || startedGame.code === "cap" ? "budget-limited" : "interrupted", startedGame.reason, 0, null);

  let { match } = await createPinnedMatch({ bundle: spec.bundle, seed: spec.gameSeed, interpreterRevision: spec.interpreterRevision });
  let memory: LocalMemory = localMemory(policyRng(localSeed));
  let lifeDealt: Record<PlayerId, number> | null = null;
  const claudeTurn = { turn: -1, decisions: 0, seen: {} as Record<string, number> };

  /** One provider call for this decision, reserved before and settled after. */
  async function ask(seat: PlayerId, revision: number, input: PolicyInput, key: ReturnType<typeof policyTurn>["key"], evidence: CallEvidence[]): Promise<CallOutcome> {
    const prompt = duelPrompt(input, match.ctx.defs);
    const feedback: { text: string; why: string }[] = [];
    let lastFailure: { outcome: DuelOutcomeKind; detail: string } = { outcome: "provider-error", detail: "no call was made" };
    for (let attempt = 0; attempt <= settings.maxRetries; attempt++) {
      if (deps.signal?.aborted) return { ok: false, outcome: "cancelled", detail: "cancelled before the call" };
      if (now() - started > settings.wallTimeMs) return { ok: false, outcome: "wall-time", detail: `${settings.wallTimeMs} ms of wall time used` };
      if (calls >= settings.maxCallsPerGame) return { ok: false, outcome: "decision-cap", detail: `${settings.maxCallsPerGame} calls this game` };
      const base = duelRequest(prompt, settings);
      const request: AiRequest = feedback.length
        ? { ...base, messages: [...base.messages, ...feedback.flatMap((f) => [{ role: "assistant" as const, parts: [{ type: "text" as const, text: f.text }] }, { role: "user" as const, parts: [{ type: "text" as const, text: `Your answer was rejected: ${f.why}\nAnswer again with only the corrected JSON.` }] }])] }
        : base;
      const bound = promptTokenBound(requestText(request));
      const call: CallEvidence = { attempt, reservation: null, maxMicros: null, requestSha256: sha(requestText(request).join("\u0000")), promptTokenBound: bound, text: null, stop: null, usage: null, chargedMicros: null, billed: null, error: null, rejected: null };
      evidence.push(call);
      if (bound > settings.maxPromptTokens) return { ok: false, outcome: "token-limit", detail: `the prompt bound ${bound} exceeds ${settings.maxPromptTokens} tokens` };
      const maxMicros = maxChargeMicros(rate, { promptTokens: bound, maxOutputTokens: settings.maxOutputTokens });
      const reserved = ledger.reserve({ game: spec.key, model: settings.model, maxMicros });
      if (!reserved.ok) return { ok: false, outcome: "budget-limited", detail: reserved.reason };
      call.reservation = reserved.id;
      call.maxMicros = maxMicros;
      deps.capture?.({ seat, revision, input, request });
      ledger.dispatch(reserved.id);
      calls++;
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), settings.callTimeoutMs);
      const onCancel = () => timeout.abort();
      deps.signal?.addEventListener("abort", onCancel);
      if (deps.signal?.aborted) timeout.abort();
      let result: AiResult;
      try {
        // Raced against the signal too, so a provider that ignores it still stops on time or on cancel.
        result = await Promise.race([
          new Promise<never>((_, reject) => {
            const fail = () => reject(new AiError("timeout", deps.signal?.aborted ? "cancelled" : `no answer in ${settings.callTimeoutMs} ms`));
            if (timeout.signal.aborted) fail();
            else timeout.signal.addEventListener("abort", fail, { once: true });
          }),
          provider.generate({ ...request, signal: timeout.signal }),
        ]);
      } catch (err) {
        const kind: AiErrorKind | "aborted" = deps.signal?.aborted ? "aborted" : err instanceof AiError ? err.kind : "provider";
        const message = err instanceof Error ? err.message : String(err);
        call.error = { kind, message: message.slice(0, 300) };
        // No usage came back: the call may have been billed. Keep the whole reservation.
        ledger.ambiguous(reserved.id, `${kind}: ${message.slice(0, 200)}`);
        charged += maxMicros;
        if (kind === "aborted") return { ok: false, outcome: "cancelled", detail: "cancelled during a call (its reservation is kept)" };
        if (kind === "refusal") return { ok: false, outcome: "refusal", detail: message };
        if (kind === "auth" || kind === "usage_limit" || kind === "unsupported" || kind === "unavailable") return { ok: false, outcome: "provider-error", detail: `${kind}: ${message}` };
        lastFailure = kind === "rate_limit" ? { outcome: "rate-limited", detail: message } : { outcome: "provider-error", detail: `${kind}: ${message}` };
        if (attempt < settings.maxRetries) await sleep(Math.min(60_000, 2000 * 2 ** attempt));
        continue;
      } finally {
        clearTimeout(timer);
        deps.signal?.removeEventListener("abort", onCancel);
      }
      const micros = chargeMicros(rate, result.usage);
      ledger.settle(reserved.id, { usage: result.usage, micros, billed: result.billed });
      charged += micros;
      if (result.billed) billed += micros;
      Object.assign(call, { text: result.text, stop: result.stop, usage: result.usage, chargedMicros: micros, billed: result.billed });
      if (result.provider !== provider.id || result.model !== settings.model) {
        call.error = { kind: "model-mismatch", message: `asked ${provider.id}/${settings.model}, served ${result.provider}/${result.model}` };
        return { ok: false, outcome: "provider-error", detail: call.error.message };
      }
      if (result.stop === "refusal") return { ok: false, outcome: "refusal", detail: "the model declined the request" };
      const parsed = result.stop === "max_tokens" ? { ok: false as const, why: "the answer was cut off at max_tokens" } : parseAnswer(result.text);
      if (!parsed.ok) {
        call.rejected = parsed.why;
        feedback.push({ text: result.text, why: parsed.why });
        lastFailure = { outcome: "malformed", detail: parsed.why };
        continue;
      }
      const decision = input.decisions.decisions[parsed.move];
      const why = !decision ? `move ${parsed.move} is not on the list (0–${input.decisions.decisions.length - 1})` : decision.kind === "menu" && parsed.cards?.length ? "a menu move takes no cards" : null;
      if (why) {
        call.rejected = why;
        feedback.push({ text: result.text, why });
        lastFailure = { outcome: "illegal", detail: why };
        continue;
      }
      const answer = answerFor(input.decisions, decision.id, decision.kind === "pick" ? (parsed.cards ?? []) : undefined);
      const played = applyDecision(match, key, answer);
      if (!played.ok) {
        const refused = `${played.reason}: ${played.detail}`;
        call.rejected = refused;
        feedback.push({ text: result.text, why: `the engine refused it (${refused})` });
        lastFailure = { outcome: "illegal", detail: refused };
        continue;
      }
      return { ok: true, answer, played };
    }
    return { ok: false, ...lastFailure };
  }

  let n = 0;
  for (; n < settings.maxMoves && match.state.phase !== "over"; n++) {
    if (deps.signal?.aborted) return finish(match, "cancelled", "cancelled between decisions", n, lifeDealt);
    if (now() - started > settings.wallTimeMs) return finish(match, "wall-time", `${settings.wallTimeMs} ms of wall time used`, n, lifeDealt);
    const seat = (match.state.prompt as { player?: PlayerId }).player;
    if (!seat) return finish(match, "no-progress", `no seat is asked (${match.state.prompt.kind})`, n, lifeDealt);
    if (!lifeDealt && match.state.sides.p1.zones.life?.length && match.state.sides.p2.zones.life?.length) lifeDealt = { p1: match.state.sides.p1.zones.life.length, p2: match.state.sides.p2.zones.life.length };
    deps.observe?.(match, seat, n);
    const window = match.state.prompt.kind;

    if (seat === localSeat) {
      const step = localStep(match, seat, n, memory, localPolicy());
      memory = step.memory;
      if (!step.ok) {
        decisions.push({ n, seat, role: "local", window, at: "", source: "local", id: null });
        const outcome: DuelOutcomeKind = step.reason === "interrupted" ? "interrupted" : step.reason === "notAsked" ? "no-progress" : "illegal";
        return finish(match, outcome, `local ${seat}: ${step.reason}: ${step.detail}`, n, lifeDealt);
      }
      if (step.guard) localGuards++;
      decisions.push({ n, seat, role: "local", window, at: "", source: "local", id: step.id, guard: step.guard });
      mix(`${seat}:${step.id}:${JSON.stringify(step.events)};`);
      match = step.match;
      continue;
    }

    const turn = policyTurn(match, seat, n);
    const record: DecisionEvidence = { n, seat, role: "claude", window, at: turn.input.decisions.at, source: "claude", id: null };
    decisions.push(record);
    if (turn.input.decisions.unsupported) return finish(match, "interrupted", `unsupported decision: ${turn.input.decisions.unsupported}`, n, lifeDealt);
    const open = turn.input.decisions.decisions;
    if (!open.length) return finish(match, "no-progress", `${seat} is asked but has no decision`, n, lifeDealt);
    // No progress: the Claude seat's own turn guard (the local one's limits), stopping rather than playing for it.
    if (claudeTurn.turn !== turn.input.observation.turn) Object.assign(claudeTurn, { turn: turn.input.observation.turn, decisions: 0, seen: {} });
    claudeTurn.decisions++;
    const { beats: _beats, ...board } = turn.input.observation;
    void _beats;
    const position = fingerprint(stableJson({ board, open: open.map((d) => d.id) }));
    claudeTurn.seen[position] = (claudeTurn.seen[position] ?? 0) + 1;
    if (claudeTurn.decisions > settings.maxDecisionsPerTurn || claudeTurn.seen[position] > settings.maxRepeats) {
      return finish(match, "no-progress", `Claude seat: ${claudeTurn.decisions} decisions this turn, the same position ${claudeTurn.seen[position]} times`, n, lifeDealt);
    }

    const free = shortcutFor(turn.input);
    const single = !free && open.length === 1 && open[0].kind === "menu" ? open[0] : null;
    if (free || single) {
      record.source = free ? "shortcut" : "single";
      record.id = free ? free.id : single!.id;
      const played = applyDecision(match, turn.key, answerFor(turn.input.decisions, record.id));
      if (!played.ok) return finish(match, "illegal", `free choice refused: ${played.reason}: ${played.detail}`, n, lifeDealt);
      mix(`${seat}:${played.id}:${JSON.stringify(played.events)};`);
      match = played.match;
      continue;
    }
    if (claudeDecisions >= settings.maxClaudeDecisions) return finish(match, "decision-cap", `${settings.maxClaudeDecisions} Claude decisions this game`, n, lifeDealt);
    claudeDecisions++;
    record.calls = [];
    const asked = await ask(seat, n, turn.input, turn.key, record.calls);
    if (!asked.ok) return finish(match, asked.outcome, asked.detail, n, lifeDealt);
    record.id = asked.answer.id;
    if (asked.answer.cards) record.cards = asked.answer.cards;
    mix(`${seat}:${asked.played.id}:${JSON.stringify(asked.played.events)};`);
    match = asked.played.match;
  }
  const outcome = resolveOutcome(match.state);
  if (outcome?.kind === "interrupted") return finish(match, "interrupted", outcome.reason, n, lifeDealt);
  if (match.state.phase === "over") return finish(match, "completed", null, n, lifeDealt);
  return finish(match, "move-cap", `not over after ${settings.maxMoves} moves`, n, lifeDealt);
}

/**
 * A provider that answers from a game's recorded evidence, in order: the replay half of the
 * "replayable evidence" bullet. Feeding it to `playClaudeDuel` with the same pins must reproduce
 * the decisions and the trace (wall-time stops excepted: they depend on the clock).
 */
export function recordedProvider(result: Pick<DuelResult, "decisions" | "pins">, id = "anthropic-api"): AiProvider {
  const calls = result.decisions.flatMap((d) => d.calls ?? []);
  let i = 0;
  return {
    id,
    label: "Recorded duel answers",
    capabilities: () => ({ vision: false, json: true, streaming: false, cacheHints: false, batch: false }),
    available: async () => ({ ok: true }),
    listModels: async () => [],
    async generate() {
      const c = calls[i++];
      if (!c) throw new AiError("provider", "the recorded evidence has no further call");
      if (c.error && c.error.kind !== "model-mismatch") throw new AiError(c.error.kind === "aborted" ? "timeout" : c.error.kind, c.error.message);
      const model = c.error?.kind === "model-mismatch" ? "recorded-other-model" : result.pins.model;
      return { text: c.text ?? "", stop: c.stop ?? "end", usage: c.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, provider: id, model, billed: false, latencyMs: 0 };
    },
  };
}
