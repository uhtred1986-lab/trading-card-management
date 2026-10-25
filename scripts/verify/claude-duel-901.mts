/**
 * #901: the isolated local-policy versus Claude API duel runner (`scripts/lib/claude-duel.ts`), proved
 * with the fake provider — no network, no key, no database, $0.
 *
 *   1. Network-free: the dry-run modules import no vendor SDK, database, router or network module,
 *      and a whole game played with `fetch` and sockets trapped makes no connection.
 *   2. Hidden information: every request is a function of the seat's policy input alone (rebuilt and
 *      compared byte for byte); hidden-state twins (`permutedFor`: the cards the seat cannot see
 *      swapped, reordered and renamed) give byte-identical prompts at every position of a game for
 *      both seats, and no instance id the seat may not read appears in them; an opponent decklist
 *      that differs only in cards not yet revealed gives the same prompt (and the owner's own prompt
 *      does change — the check is not vacuous).
 *   3. Typed outcomes with replayable evidence: malformed, out-of-range and engine-refused answers,
 *      refusals, rate errors, timeouts, a wrong served model, cancellation (between and during
 *      calls), an engine interruption, no progress, the move, decision and call caps, wall time,
 *      token and budget limits — each a typed stop, never a draw or a win; retries are separate
 *      reserved calls; recorded answers replay to the same trace.
 *   4. Pins: seeds, both seat assignments, model/provider, settings and bundle hashes; the corpus
 *      pack path (`arena-corpus-freeze.mts --out`) rebuilds its bundle by hash.
 *   5. The manifest is accepted by the Testing & stats contract, carries no prompt or card text, and
 *      maps limits to `limit`.
 *
 * Run from the repo root:  npx tsx scripts/verify/claude-duel-901.mts   (part of `npm test`)
 */
import assert from "node:assert/strict";
import net from "node:net";
import path from "node:path";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { checkImportGraph, diskRead } from "../lib/import-graph.ts";
import { policyFixtureBundle, POLICY_FIXTURE_REVISION, POLICY_FIXTURE_DECKS } from "./arena-policy-fixture.ts";
import { hiddenFrom, permutedFor } from "./arena-policy-permute.ts";
import { playDuel } from "./arena-policy-duel.ts";
import type { PlayerId } from "../../src/lib/arena/types";
import type { ReplayBundleRecord } from "../../src/lib/arena/replay-core";
import { createPinnedMatch, type PinnedMatch } from "../../src/lib/arena/browser";
import { policyTurn } from "../../src/lib/arena/policy/boundary";
import { localPolicy } from "../../src/lib/arena/policy/combat";
import { validateEvaluationManifest } from "../../src/lib/arena/testing/run-manifest";
import { duelPrompt, duelRequest } from "../lib/claude-duel-prompt";
import { DEFAULT_SETTINGS, playClaudeDuel, recordedProvider, type DuelDeps, type DuelResult, type DuelSettings } from "../lib/claude-duel";
import { fakeClaude, type Fault } from "../lib/claude-duel-fake";
import { duelManifest } from "../lib/claude-duel-manifest";
import { APPROVED_CAPS, CampaignLedger, type CampaignCaps } from "../lib/claude-campaign-ledger";
import { rateFor } from "../lib/claude-campaign-rates";
import { freeze } from "../arena-corpus-freeze.mts";
import { loadSnapshot } from "../arena-deck-audit.mts";
import { duelInputs, schedule, pairBundle } from "../arena-claude-duel.mts";

const ROOT = process.cwd();
const MODEL = "claude-haiku-4-5";
const started = Date.now();
const cpu: string[] = [];
// Ledgers fsync every line; a memory-backed directory keeps that cheap where the host has one.
const scratch = mkdtempSync(path.join(existsSync("/dev/shm") ? "/dev/shm" : tmpdir(), "claude-duel-901-"));
const rate = rateFor(MODEL, { paid: false });
assert.ok(rate.ok);
const settings: DuelSettings = { ...DEFAULT_SETTINGS, model: MODEL };
const runner = { id: "arena-claude-duel" as const, version: "1", gitCommit: "a".repeat(40), dirtyTreeSha256: null };
let ledgers = 0;
const ledger = (caps: CampaignCaps = APPROVED_CAPS) => CampaignLedger.open(path.join(scratch, `l${ledgers++}`), { campaign: "test-901", caps, rateSheet: "test", dryRun: true });
const bundle = await policyFixtureBundle();
let games = 0;
async function duel(over: Partial<DuelDeps> & { faults?: Record<number, Fault>; seat?: PlayerId; seed?: number; b?: ReplayBundleRecord; rev?: string } = {}): Promise<DuelResult> {
  const { faults, seat, seed, b, rev, ...deps } = over;
  return playClaudeDuel(
    { key: `g${games++}`, phase: "pilot", bundle: b ?? bundle, interpreterRevision: rev ?? POLICY_FIXTURE_REVISION, gameSeed: seed ?? 644, policySeed: 11, claudeSeat: seat ?? "p1" },
    { provider: fakeClaude({ seed: 3, model: MODEL, faults }), providerKind: "fake", rate: rate.ok ? rate.rate : (null as never), ledger: deps.ledger ?? ledger(), settings, sleep: async () => {}, ...deps },
  );
}

// ---------------------------------------------------------------------------------------------
// 1. Network-free.
cpu.push(`1:${(process.cpuUsage().user / 1e6).toFixed(1)}`);
{
  const forbidden = /(@anthropic-ai|openai|drizzle|@neondatabase|pg$|^node:(http|https|net|tls|dgram|dns)$|^(http|https|net|tls|undici)$)/;
  for (const entry of ["scripts/lib/claude-duel.ts", "scripts/lib/claude-duel-fake.ts", "scripts/lib/claude-duel-prompt.ts", "scripts/lib/claude-campaign-ledger.ts", "scripts/lib/claude-duel-manifest.ts"]) {
    const graph = checkImportGraph(path.join(ROOT, entry), ROOT, diskRead);
    const packages = graph.violations.map((v) => /package or builtin import (.*)$/.exec(v.reason)?.[1]).filter((x): x is string => !!x);
    const bad = packages.filter((p) => forbidden.test(p));
    assert.deepEqual(bad, [], `${entry} reaches a network or vendor module: ${bad.join(", ")}`);
    const files = graph.files.filter((f) => /^src\/db\/|^src\/lib\/ai\/(router|client|core|settings|providers\/(anthropic|openrouter|agent-sdk))/.test(f));
    assert.deepEqual(files, [], `${entry} reaches the database, the router or a real provider: ${files.join(", ")}`);
  }
  const realFetch = globalThis.fetch;
  const realConnect = net.Socket.prototype.connect;
  let attempts = 0;
  globalThis.fetch = (async () => { attempts++; throw new Error("network used in a dry run"); }) as typeof fetch;
  net.Socket.prototype.connect = function () { attempts++; throw new Error("socket opened in a dry run"); } as typeof realConnect;
  try {
    const r = await duel();
    assert.equal(r.outcome, "completed", `the dry run plays a whole game (${r.outcome}: ${r.detail})`);
    assert.ok(r.calls > 0 && r.claudeDecisions > 0, "the Claude seat answered decisions through the provider");
    assert.equal(r.billedMicros, 0, "a dry run spends $0");
    assert.ok(r.chargedMicros > 0, "and still reserved and settled notional spend in its ledger");
  } finally {
    globalThis.fetch = realFetch;
    net.Socket.prototype.connect = realConnect;
  }
  assert.equal(attempts, 0, "no network attempt");
}

// ---------------------------------------------------------------------------------------------
// 2. Hidden information.
cpu.push(`2:${(process.cpuUsage().user / 1e6).toFixed(1)}`);
const promptText = (p: ReturnType<typeof duelPrompt>) => JSON.stringify(p);
const tally = { positions: 0, twins: 0, nontrivial: 0, captured: 0 };
{
  // (a) What is sent is rebuilt from the policy input alone.
  const capture: DuelDeps["capture"] = ({ input, request }) => {
    const rebuilt = duelRequest(duelPrompt(input, (match0 as PinnedMatch).ctx.defs), settings);
    const sent = { ...request, signal: undefined, messages: request.messages.slice(0, 1) };
    assert.equal(JSON.stringify({ ...rebuilt, output: null }), JSON.stringify({ ...sent, output: null }), "the request is a function of the policy input");
    tally.captured++;
  };
  const match0 = (await createPinnedMatch({ bundle, seed: 644, interpreterRevision: POLICY_FIXTURE_REVISION })).match;
  for (const seat of ["p1", "p2"] as const) await duel({ capture, seat });
  assert.ok(tally.captured > 10);

  // (b) Twins at every position of a game, both seats.
  const words = (text: string) => new Set(text.match(/p[12]#[0-9A-Za-z:_-]+/g) ?? []);
  await playDuel({
    bundle, interpreterRevision: POLICY_FIXTURE_REVISION, gameSeed: 645, policySeed: 5, testSeat: "p1", test: localPolicy(), baseline: localPolicy(), maxMoves: 400,
    observe(match, _asked, revision) {
      for (const seat of ["p1", "p2"] as const) {
        const turn = policyTurn(match, seat, revision);
        const text = promptText(duelPrompt(turn.input, match.ctx.defs));
        const hidden = hiddenFrom(match.state, seat);
        const leaked = [...words(text)].filter((id) => hidden.has(id));
        assert.deepEqual(leaked, [], `revision ${revision}: ${seat}'s prompt names hidden instances`);
        const twin = permutedFor(match, seat, revision * 7 + (seat === "p1" ? 1 : 2));
        if (hidden.size > 1 && JSON.stringify(twin.state) !== JSON.stringify(match.state)) tally.nontrivial++;
        const twinText = promptText(duelPrompt(policyTurn(twin, seat, revision).input, twin.ctx.defs));
        if (twinText !== text) {
          let i = 0;
          while (text[i] === twinText[i]) i++;
          assert.fail(`revision ${revision}: a permuted hidden state changes ${seat}'s prompt near …${text.slice(Math.max(0, i - 120), i + 60)}…`);
        }
        tally.twins++;
      }
      tally.positions++;
    },
  });
  assert.ok(tally.positions > 30 && tally.nontrivial > 30, `twins were checked on real hidden states (${JSON.stringify(tally)})`);

  // (c) The opponent's private decklist: p2's eight O2-BLOCK become O2-V; nothing is revealed at the deal.
  const variant = JSON.parse(JSON.stringify(bundle)) as ReplayBundleRecord;
  variant.decks.p2.main = POLICY_FIXTURE_DECKS.p2.main.map((id) => (id === "O2-BLOCK" ? "O2-V" : id));
  const a = (await createPinnedMatch({ bundle, seed: 646, interpreterRevision: POLICY_FIXTURE_REVISION })).match;
  const b = (await createPinnedMatch({ bundle: variant, seed: 646, interpreterRevision: POLICY_FIXTURE_REVISION })).match;
  const pa = promptText(duelPrompt(policyTurn(a, "p1", 0).input, a.ctx.defs));
  const pb = promptText(duelPrompt(policyTurn(b, "p1", 0).input, b.ctx.defs));
  assert.equal(pa, pb, "p1's prompt does not depend on p2's unrevealed decklist");
  assert.ok(!pa.includes("O2-BLOCK"), "p1's prompt never names a card only p2's private list holds");
  const qa = promptText(duelPrompt(policyTurn(a, "p2", 0).input, a.ctx.defs));
  const qb = promptText(duelPrompt(policyTurn(b, "p2", 0).input, b.ctx.defs));
  assert.notEqual(qa, qb, "p2's own prompt does see its own decklist (the check is not vacuous)");
}

// ---------------------------------------------------------------------------------------------
// 3. Typed outcomes, retries and replay.
cpu.push(`3:${(process.cpuUsage().user / 1e6).toFixed(1)}`);
const typed: Record<string, DuelResult> = {};
{
  const noRetry = { ...settings, maxRetries: 0 };
  typed.malformed = await duel({ faults: { 0: "malformed" }, settings: noRetry });
  typed.outOfRange = await duel({ faults: { 0: "out-of-range" }, settings: noRetry });
  typed.refusal = await duel({ faults: { 0: "refusal" } });
  typed.cutOff = await duel({ faults: { 0: "max-tokens" }, settings: noRetry });
  typed.rate = await duel({ faults: { 0: "rate", 1: "rate", 2: "rate" } });
  typed.timeout = await duel({ faults: { 0: "timeout" }, settings: noRetry });
  typed.wrongModel = await duel({ faults: { 0: "wrong-model" } });
  typed.moveCap = await duel({ settings: { ...settings, maxMoves: 12 } });
  typed.decisionCap = await duel({ settings: { ...settings, maxClaudeDecisions: 2 } });
  typed.callCap = await duel({ faults: { 0: "malformed", 1: "malformed" }, settings: { ...settings, maxCallsPerGame: 2 } });
  typed.noProgress = await duel({ settings: { ...settings, maxDecisionsPerTurn: 1 } });
  typed.tokenLimit = await duel({ settings: { ...settings, maxPromptTokens: 1000 } });
  typed.budget = await duel({ ledger: ledger({ pilot: { micros: 50_000, games: 8 }, total: { micros: 50_000, games: 40 } }) });
  let t = 0;
  typed.wallTime = await duel({ now: () => (t += 60_000) });
  const between = new AbortController();
  typed.cancelBetween = await duel({ signal: between.signal, observe: (_m, _s, n) => { if (n === 30) between.abort(); } });
  const during = new AbortController();
  typed.cancelDuring = await duel({ signal: during.signal, capture: () => during.abort() });
  let staged = false;
  typed.interrupted = await duel({
    observe(match) {
      // A saved continuation whose metadata the VM refuses (#907's interrupted-duel proof): an engine interruption.
      if (staged || match.state.prompt.kind !== "main") return;
      staged = true;
      const leader = match.state.sides[match.state.turnPlayer].zones.leader[0];
      match.state.programs.unshift({ card: leader, master: match.state.turnPlayer, skillIndex: 0, ops: [{ op: "draw", n: 1 }], ip: 0, vars: {} });
    },
  });
  typed.retried = await duel({ faults: { 0: "malformed", 2: "out-of-range", 4: "rate" } });

  const expect: Record<string, DuelResult["outcome"]> = {
    malformed: "malformed", outOfRange: "illegal", refusal: "refusal", cutOff: "malformed", rate: "rate-limited", timeout: "provider-error",
    wrongModel: "provider-error", moveCap: "move-cap", decisionCap: "decision-cap", callCap: "decision-cap", noProgress: "no-progress",
    tokenLimit: "token-limit", budget: "budget-limited", wallTime: "wall-time", cancelBetween: "cancelled", cancelDuring: "cancelled",
    interrupted: "interrupted", retried: "completed",
  };
  for (const [k, want] of Object.entries(expect)) {
    const r = typed[k];
    assert.equal(r.outcome, want, `${k}: ${r.outcome} (${r.detail})`);
    if (want !== "completed") {
      assert.equal(r.winner, null, `${k} is incomplete: no winner`);
      assert.ok(r.detail, `${k} says why`);
    }
  }
  // Retries are their own reserved calls; failures without usage keep their whole reservation.
  const calls = typed.retried.decisions.flatMap((d) => d.calls ?? []);
  assert.ok(calls.filter((c) => c.attempt > 0).length >= 3, "three retried calls");
  assert.ok(calls.every((c) => c.reservation && c.maxMicros), "every call was reserved");
  const rateCall = calls.find((c) => c.error?.kind === "rate_limit")!;
  assert.equal(rateCall.chargedMicros, null);
  assert.ok(typed.rate.chargedMicros >= typed.rate.decisions.flatMap((d) => d.calls ?? []).reduce((n, c) => n + (c.maxMicros ?? 0), 0), "rate-limited calls keep their reservations as spent");
  const during0 = typed.cancelDuring.decisions.flatMap((d) => d.calls ?? [])[0];
  assert.equal(during0.error?.kind, "aborted", "the in-flight call was aborted");
  assert.equal(typed.cancelDuring.chargedMicros, during0.maxMicros, "and its reservation is kept");
  assert.equal(typed.tokenLimit.calls, 0, "a prompt over the token limit is never sent");
  const budgetCalls = typed.budget.decisions.flatMap((d) => d.calls ?? []);
  assert.equal(budgetCalls.at(-1)!.reservation, null, "the call the budget cannot cover is never reserved or sent");
  assert.equal(budgetCalls.filter((c) => c.reservation).length, typed.budget.calls);
  assert.ok(typed.budget.chargedMicros <= 50_000, "the cap held");
  assert.ok(typed.budget.detail?.includes("cap"));

  // Replay: recorded answers reproduce each deterministic game.
  for (const k of ["retried", "malformed", "outOfRange", "moveCap", "decisionCap", "noProgress", "rate", "wrongModel"]) {
    const r = typed[k];
    const again = await duel({ provider: recordedProvider(r), settings: r.pins.settings });
    assert.equal(again.trace, r.trace, `${k} replays to the same trace`);
    assert.equal(again.outcome, r.outcome, `${k} replays to the same outcome`);
    assert.equal(again.moves, r.moves);
  }
}

// ---------------------------------------------------------------------------------------------
// 4. Pins, both seats, and the corpus pack inputs.
cpu.push(`4:${(process.cpuUsage().user / 1e6).toFixed(1)}`);
let packGames: { bundle: ReplayBundleRecord; result: DuelResult }[] = [];
{
  const r = typed.retried;
  assert.deepEqual(Object.keys(r.pins).sort(), ["bundleHash", "claudeSeat", "gameSeed", "interpreterRevision", "localPolicyRng", "localSeat", "model", "policySeed", "prompt", "providerKind", "runner", "settings"]);
  assert.equal(r.pins.bundleHash, bundle.hash);
  assert.equal(r.pins.providerKind, "fake");
  assert.equal(r.pins.model, MODEL);
  assert.equal(r.pins.localSeat, "p2");
  const p2 = await duel({ seat: "p2" });
  assert.equal(p2.pins.claudeSeat, "p2");
  assert.equal(p2.pins.localSeat, "p1");

  const packPath = path.join(scratch, "pack.json");
  // No admission games here (the freeze's own `--check` plays those): the qualified starters are marked admitted in this copy.
  const frozen = await freeze({ catalog: loadSnapshot(), runtime: POLICY_FIXTURE_REVISION, pairs: 0, maxMoves: 0, seedBase: 897000, catalogPath: "docs/arena-backlog/evidence/649/catalog-subset-2026-10-13.json" });
  assert.deepEqual(frozen.summary.admitted, [], "a pack with no admission games admits nothing by itself");
  const pack = { ...frozen, decks: frozen.decks.map((d) => ({ ...d, admitted: d.qualified })), summary: { ...frozen.summary, admitted: frozen.decks.filter((d) => d.qualified).map((d) => d.key) } };
  assert.ok(pack.summary.admitted.length >= 2, "both starters qualify");
  writeFileSync(packPath, JSON.stringify(pack));
  const inputs = await duelInputs(packPath);
  assert.equal(inputs.bundle.hash, pack.hashes.bundle, "the pack's bundle rebuilds by hash");
  assert.deepEqual(inputs.decks.map((d) => d.key), pack.summary.admitted, "only admitted decks");
  const plan = schedule(inputs, { pairs: 1, seedBase: 901000, policySeed: 7919, run: "t" });
  for (const g of plan.filter((x) => x.claudeSeat === "p1")) assert.ok(plan.some((y) => y.gameSeed === g.gameSeed && y.deckA === g.deckA && y.claudeSeat === "p2"), "each seed is played from both seats");
  const tampered = { ...pack, hashes: { ...pack.hashes, bundle: "0".repeat(64) } };
  writeFileSync(packPath, JSON.stringify(tampered));
  await assert.rejects(duelInputs(packPath), /does not rebuild/, "a pack whose bundle does not rebuild is refused");
  const g = plan[0];
  const real = await playClaudeDuel({ key: "starter", phase: "pilot", bundle: pairBundle(inputs.bundle, inputs.decks[0], inputs.decks[inputs.decks.length - 1]), interpreterRevision: inputs.runtime, gameSeed: g.gameSeed, policySeed: g.policySeed, claudeSeat: "p2" },
    { provider: fakeClaude({ seed: 9, model: MODEL }), providerKind: "fake", rate: rate.ok ? rate.rate : (null as never), ledger: ledger(), settings, sleep: async () => {} });
  assert.equal(real.outcome, "completed", `a starter game from the pack completes (${real.detail})`);
  packGames = [{ bundle: pairBundle(inputs.bundle, inputs.decks[0], inputs.decks[inputs.decks.length - 1]), result: real }];
}

// ---------------------------------------------------------------------------------------------
// 5. The manifest.
cpu.push(`5:${(process.cpuUsage().user / 1e6).toFixed(1)}`);
{
  const all = [...packGames, ...Object.values(typed).map((result) => ({ bundle, result }))];
  const manifest = duelManifest(runner, { providerKind: "fake", settings, protocol: { test: 901 }, games: all });
  const checked = validateEvaluationManifest(JSON.parse(JSON.stringify(manifest)));
  assert.ok(checked.ok, `the import contract accepts it: ${checked.ok ? "" : checked.reason}`);
  assert.equal(manifest.protocol.id, "arena-claude-duel-dry-v1");
  assert.equal(manifest.results.length, all.length);
  const byKey = (r: DuelResult) => manifest.results[all.findIndex((x) => x.result === r)];
  for (const k of ["moveCap", "decisionCap", "tokenLimit", "budget", "wallTime"]) assert.equal(byKey(typed[k]).outcome, "limit", `${k} is a limit, never a draw`);
  assert.equal(byKey(typed.outOfRange).outcome, "illegal");
  for (const k of ["malformed", "refusal", "rate", "cancelDuring", "interrupted", "noProgress"]) assert.equal(byKey(typed[k]).outcome, "interrupted");
  assert.ok(manifest.results.every((r) => r.reportedCostMicros === 0), "a dry run reports explicitly free");
  const text = JSON.stringify(manifest);
  for (const secret of ["LEGAL MOVES", "YOUR DECK", "Vegeta", "O2-V", "p1#", "scratch"]) assert.ok(!text.includes(secret), `the manifest carries no ${secret}`);
  const wrongProtocol = { ...JSON.parse(text), protocol: { id: "arena-corpus-compiler-v1", revision: "x" } };
  assert.ok(!validateEvaluationManifest(wrongProtocol).ok, "a duel manifest needs its own protocol");
}

rmSync(scratch, { recursive: true, force: true });
console.log(`claude-duel-901 ok: ${tally.positions} positions × 2 seats twin-checked (${tally.nontrivial} non-trivial), ${tally.captured} requests rebuilt from the policy input, ${Object.keys(typed).length} typed stops, replay equal; ${((Date.now() - started) / 1000).toFixed(1)} s (cpu at sections ${cpu.join(" ")})`);
