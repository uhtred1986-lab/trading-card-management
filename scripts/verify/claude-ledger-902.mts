/**
 * #902: the campaign's dated rates and its hard spending reservations, proved without a paid call,
 * a network or a database.
 *
 *   1. Rates: dated and sourced; exact integer micro-dollar charges per category (1-hour cache writes,
 *      prompt-length tiers); the reservation bound is never below an actual charge within it;
 *      unknown models fail closed; paid pricing stays refused until the owner verifies the sheet and
 *      the model's access; the input/output prices agree with `src/lib/ai/models.ts`.
 *   2. Reservations: refused when the pilot or the total cap (money or games) cannot cover them,
 *      pilot included in the total; a restart cannot change the caps; an overrun halts.
 *   3. Simultaneous workers: four processes reserving at once never exceed the cap and use it exactly.
 *   4. Crash and resume: a process killed between reserve and settle leaves its reservation counted;
 *      recovery releases one never dispatched and keeps one dispatched as ambiguous (spent) until the
 *      owner reconciles it; a torn final line is cut, a malformed line fails closed.
 *   5. Retries and failed billable calls count in the one total; a budget-limited game is incomplete.
 *   6. No secret reaches the ledger, the evidence or the manifest.
 *
 * Run from the repo root:  npx tsx scripts/verify/claude-ledger-902.mts   (part of `npm test`)
 */
import assert from "node:assert/strict";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { CAMPAIGN_RATES, chargeMicros, maxChargeMicros, promptTokenBound, rateFor, type RateSheet } from "../lib/claude-campaign-rates";
import { APPROVED_CAPS, CampaignLedger, type CampaignCaps } from "../lib/claude-campaign-ledger";
import { modelEntry } from "../../src/lib/ai/models";
import { DEFAULT_SETTINGS, playClaudeDuel } from "../lib/claude-duel";
import { fakeClaude } from "../lib/claude-duel-fake";
import { duelManifest } from "../lib/claude-duel-manifest";
import { policyFixtureBundle, POLICY_FIXTURE_REVISION } from "./arena-policy-fixture.ts";

const started = Date.now();
const scratch = mkdtempSync(path.join(existsSync("/dev/shm") ? "/dev/shm" : tmpdir(), "claude-ledger-902-"));
let n = 0;
const fresh = (caps: CampaignCaps = APPROVED_CAPS) => {
  const dir = path.join(scratch, `l${n++}`);
  return { dir, ledger: CampaignLedger.open(dir, { campaign: "test-902", caps, rateSheet: "test", dryRun: true }) };
};

// ---------------------------------------------------------------------------------------------
// 1. Rates.
{
  assert.equal(CAMPAIGN_RATES.verifiedOn, "2026-10-25");
  assert.match(CAMPAIGN_RATES.source, /^https:\/\/platform\.claude\.com\/docs\/en\/about-claude\/pricing/);
  assert.equal(CAMPAIGN_RATES.ownerVerified, false, "the agent's reading is not the owner's verification");
  const haiku = rateFor("claude-haiku-4-5", { paid: false });
  assert.ok(haiku.ok);
  const M = 1_000_000;
  assert.equal(chargeMicros(haiku.rate, { input: M, output: 0, cacheRead: 0, cacheWrite: 0 }), 1_000_000, "Haiku 4.5: $1 / MTok input");
  assert.equal(chargeMicros(haiku.rate, { input: 0, output: M, cacheRead: 0, cacheWrite: 0 }), 5_000_000, "$5 / MTok output");
  assert.equal(chargeMicros(haiku.rate, { input: 0, output: 0, cacheRead: M, cacheWrite: 0 }), 100_000, "$0.10 / MTok cache read");
  assert.equal(chargeMicros(haiku.rate, { input: 0, output: 0, cacheRead: 0, cacheWrite: M }), 2_000_000, "cache writes at the 1-hour $2 / MTok");
  assert.equal(chargeMicros(haiku.rate, { input: 1, output: 0, cacheRead: 1, cacheWrite: 0 }), 2, "rounded up, never down");
  const h55 = rateFor("claude-haiku-5-5", { paid: false });
  assert.ok(h55.ok);
  assert.equal(chargeMicros(h55.rate, { input: 100_000, output: 1000, cacheRead: 0, cacheWrite: 0 }), 10_500, "Haiku 5.5 at or under 100k prompt tokens");
  assert.equal(chargeMicros(h55.rate, { input: 100_001, output: 1000, cacheRead: 0, cacheWrite: 0 }), 52_501, "over 100k prompt tokens: the higher row for the whole request");
  const sonnet = rateFor("claude-sonnet-5-5", { paid: false });
  assert.ok(sonnet.ok);
  assert.equal(chargeMicros(sonnet.rate, { input: 0, output: 0, cacheRead: M, cacheWrite: 0 }), 100_000, "Sonnet 5.5 cache hits are 0.05x input");
  // The bound covers every charge it bounds, on every model and tier.
  let x = 12345;
  const rnd = (k: number) => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return x % k; };
  for (const m of CAMPAIGN_RATES.models) {
    const r = rateFor(m.model, { paid: false });
    assert.ok(r.ok);
    for (let i = 0; i < 300; i++) {
      const prompt = rnd(250_000), out = rnd(4000);
      const read = rnd(prompt + 1), write = rnd(prompt - read + 1);
      const usage = { input: prompt - read - write, cacheRead: read, cacheWrite: write, output: rnd(out + 1) };
      assert.ok(chargeMicros(r.rate, usage) <= maxChargeMicros(r.rate, { promptTokens: prompt, maxOutputTokens: out }), `${m.model}: the bound covers ${JSON.stringify(usage)}`);
    }
    // models.ts prices the same models for ai:spend; input and output must agree.
    const app = modelEntry(m.model);
    if (app) {
      assert.equal(app.usdPerMTok.input, m.tiers[0].usdPerMTok.input, `${m.model}: input agrees with models.ts`);
      assert.equal(app.usdPerMTok.output, m.tiers[0].usdPerMTok.output, `${m.model}: output agrees with models.ts`);
    }
  }
  assert.ok(promptTokenBound(["héllo"]) >= 6, "the bound counts UTF-8 bytes");
  // Fail closed.
  assert.ok(!rateFor("claude-future-9", { paid: false }).ok, "an unknown model has no price");
  for (const m of CAMPAIGN_RATES.models) assert.match((rateFor(m.model, { paid: true }) as { reason: string }).reason, /not owner-verified/, `${m.model}: paid stays disabled`);
  const verified: RateSheet = { ...CAMPAIGN_RATES, ownerVerified: true, models: CAMPAIGN_RATES.models.map((m) => (m.model === "claude-haiku-4-5" ? { ...m, access: "verified" as const } : m)) };
  assert.ok(rateFor("claude-haiku-4-5", { paid: true, sheet: verified }).ok, "an owner-verified sheet with verified access prices a paid call");
  assert.match((rateFor("claude-opus-5", { paid: true, sheet: verified }) as { reason: string }).reason, /access/, "but not a model whose access is unverified");
  assert.ok(!rateFor("claude-haiku-4-5", { paid: false, sheet: { ...CAMPAIGN_RATES, verifiedOn: "" } }).ok, "an undated sheet fails closed");
  assert.throws(() => rateFor("claude-haiku-4-5", { paid: false, sheet: { ...CAMPAIGN_RATES, models: [{ ...CAMPAIGN_RATES.models[0], tiers: [{ maxPromptTokens: null, usdPerMTok: { input: 0.0001, cacheWrite5m: 1, cacheWrite1h: 1, cacheRead: 1, output: 1 } }] }] } }), /multiple of \$0\.001/);
}

// ---------------------------------------------------------------------------------------------
// 2. Reservations and caps.
{
  const caps: CampaignCaps = { pilot: { micros: 1000, games: 2 }, total: { micros: 2500, games: 3 } };
  const { dir, ledger } = fresh(caps);
  assert.ok(ledger.startGame("p1", "pilot").ok);
  const a = ledger.reserve({ game: "p1", model: "m", maxMicros: 600 });
  assert.ok(a.ok);
  const b = ledger.reserve({ game: "p1", model: "m", maxMicros: 600 });
  assert.ok(!b.ok && b.code === "cap" && /pilot cap/.test(b.reason), "an open reservation already counts: the pilot cannot cover a second");
  ledger.dispatch(a.id);
  ledger.settle(a.id, { usage: { input: 10, output: 1, cacheRead: 0, cacheWrite: 0 }, micros: 150, billed: true });
  assert.ok(ledger.reserve({ game: "p1", model: "m", maxMicros: 600 }).ok, "settling below the reservation frees the difference, no more");
  assert.equal(ledger.summary().pilotCommittedMicros, 750);
  assert.ok(ledger.startGame("p2", "pilot").ok);
  assert.equal((ledger.startGame("p3", "pilot") as { code: string }).code, "games", "the pilot's game cap");
  assert.equal((ledger.startGame("p1", "full") as { code: string }).code, "state", "a game key is used once");
  assert.ok(ledger.startGame("f1", "full").ok);
  assert.equal((ledger.startGame("f2", "full") as { code: string }).code, "games", "the total's game cap counts the pilot's games");
  const big = ledger.reserve({ game: "f1", model: "m", maxMicros: 1800 });
  assert.ok(!big.ok && /total cap/.test(big.reason), "the total cap counts the pilot's spend");
  assert.ok(ledger.reserve({ game: "f1", model: "m", maxMicros: 1750 }).ok, "and exactly fills");
  assert.ok(!ledger.reserve({ game: "f1", model: "m", maxMicros: 1 }).ok, "nothing is left");
  ledger.finishGame("p2", "budget-limited");
  assert.ok(!ledger.reserve({ game: "p2", model: "m", maxMicros: 1 }).ok, "a finished game reserves nothing");
  assert.throws(() => CampaignLedger.open(dir, { campaign: "test-902", caps: { ...caps, total: { micros: 99_999_999, games: 99 } }, rateSheet: "test", dryRun: true }), /cannot change/, "a restart cannot raise the caps");
  assert.throws(() => CampaignLedger.open(dir, { campaign: "test-902", caps, rateSheet: "test", dryRun: false }), /dry-run ledger/, "a dry-run ledger is not a paid one");
  assert.throws(() => CampaignLedger.open(dir, { campaign: "other", caps, rateSheet: "test", dryRun: true }), /belongs to campaign/);
  const again = CampaignLedger.open(dir, { campaign: "test-902", caps, rateSheet: "test", dryRun: true });
  const s = again.summary();
  assert.equal(s.committedMicros, 2500, "a restart reads every reservation back");
  assert.equal(s.remaining.totalMicros, 0);

  // An overrun (a settled call above its reservation) is recorded as it is and halts the campaign.
  const o = fresh();
  o.ledger.startGame("g", "pilot");
  const r = o.ledger.reserve({ game: "g", model: "m", maxMicros: 100 });
  assert.ok(r.ok);
  o.ledger.dispatch(r.id);
  o.ledger.settle(r.id, { usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, micros: 150, billed: true });
  const halted = o.ledger.reserve({ game: "g", model: "m", maxMicros: 1 });
  assert.ok(!halted.ok && halted.code === "halted");
  assert.throws(() => o.ledger.release(r.id, "x"), /settled/, "a settled call cannot be released");
}

// ---------------------------------------------------------------------------------------------
// 3. Simultaneous workers.
const worker = (args: string[], env: Record<string, string> = {}) => spawn(process.execPath, ["--import", "tsx", "scripts/verify/claude-ledger-worker-902.mts", ...args], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
const collect = (child: ReturnType<typeof worker>) => new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
  let out = "", err = "";
  child.stdout!.on("data", (d) => (out += d));
  child.stderr!.on("data", (d) => (err += d));
  child.on("close", (code) => resolve({ code, out, err }));
});
{
  const caps: CampaignCaps = { pilot: { micros: 20_000, games: 8 }, total: { micros: 100_000, games: 40 } };
  const { dir, ledger } = fresh(caps);
  ledger.startGame("shared", "pilot");
  const env = { LEDGER_CAPS: JSON.stringify(caps) };
  const runs = await Promise.all([0, 1, 2, 3].map(() => collect(worker(["reserve", dir, "shared", "12", "1000"], env))));
  for (const r of runs) assert.equal(r.code, 0, r.err);
  const granted = runs.flatMap((r) => JSON.parse(r.out) as string[]);
  assert.equal(new Set(granted).size, granted.length, "every reservation id is unique");
  assert.equal(granted.length, 20, `four workers at once got exactly the 20 reservations the $0.02 pilot cap covers (${runs.map((r) => (JSON.parse(r.out) as string[]).length).join("+")})`);
  const s = ledger.summary();
  assert.equal(s.pilotCommittedMicros, 20_000);
  assert.ok(s.committedMicros <= caps.pilot.micros);
}

// ---------------------------------------------------------------------------------------------
// 4. Crash and resume.
{
  const { dir, ledger } = fresh();
  ledger.startGame("g", "pilot");
  const beforeDispatch = spawnSync(process.execPath, ["--import", "tsx", "scripts/verify/claude-ledger-worker-902.mts", "crash-after", dir, "g", "reserve"], { encoding: "utf8" });
  const afterDispatch = spawnSync(process.execPath, ["--import", "tsx", "scripts/verify/claude-ledger-worker-902.mts", "crash-after", dir, "g", "dispatch"], { encoding: "utf8" });
  assert.equal(beforeDispatch.signal, "SIGKILL", beforeDispatch.stderr);
  assert.equal(afterDispatch.signal, "SIGKILL", afterDispatch.stderr);
  const [unsent, sent] = [beforeDispatch.stdout, afterDispatch.stdout];
  const restarted = CampaignLedger.open(dir, { campaign: "test-902", caps: APPROVED_CAPS, rateSheet: "test", dryRun: true });
  assert.equal(restarted.summary().committedMicros, 2_000_000, "both crashed reservations still count after the restart");
  assert.equal(restarted.summary().inFlight, 2);
  const recovered = restarted.recoverOrphans();
  assert.deepEqual(recovered, { released: [unsent], ambiguous: [sent] }, "the one never sent is released; the one sent is kept");
  const s = restarted.summary();
  assert.equal(s.committedMicros, 1_000_000, "the dispatched call stays spent at its whole reservation");
  assert.equal(s.ambiguous, 1);
  assert.deepEqual(restarted.recoverOrphans(), { released: [], ambiguous: [] }, "recovery is idempotent");
  assert.throws(() => restarted.reconcile(sent, 250_000, " "), /names its source/);
  restarted.reconcile(sent, 250_000, "owner: Console usage page, 25 Oct 2026");
  assert.equal(restarted.summary().committedMicros, 250_000, "only the owner's figure replaces a kept reservation");
  assert.equal(restarted.summary().billedMicros, 250_000);

  // A torn final line (a write the crash cut short) is cut off; nothing acted on it.
  const journal = path.join(dir, "ledger.jsonl");
  appendFileSync(journal, '{"t":"reserve","id":"r-torn');
  const reopened = CampaignLedger.open(dir, { campaign: "test-902", caps: APPROVED_CAPS, rateSheet: "test", dryRun: true });
  assert.equal(reopened.summary().committedMicros, 250_000);
  assert.ok(readFileSync(journal, "utf8").endsWith("\n"), "the torn tail was cut");
  // A malformed complete line fails closed.
  const badDir = path.join(scratch, "bad");
  CampaignLedger.open(badDir, { campaign: "test-902", caps: APPROVED_CAPS, rateSheet: "test", dryRun: true });
  appendFileSync(path.join(badDir, "ledger.jsonl"), "not json\n");
  assert.throws(() => CampaignLedger.open(badDir, { campaign: "test-902", caps: APPROVED_CAPS, rateSheet: "test", dryRun: true }), /malformed line/);
  // A stale lock of a dead process is broken; a live one is waited for.
  writeFileSync(path.join(dir, "ledger.lock"), `999999\n${(await import("node:os")).hostname()}\nx\n`);
  assert.ok(reopened.summary(), "a dead holder's lock does not block the ledger");
}

// ---------------------------------------------------------------------------------------------
// 5. Retries, failed billable calls and the budget, through the runner; 6. no secrets.
{
  const SECRET = "sk-ant-api03-THIS-IS-NOT-A-REAL-KEY-902";
  const previous = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = SECRET;
  try {
    const bundle = await policyFixtureBundle();
    const rate = rateFor("claude-haiku-4-5", { paid: false });
    assert.ok(rate.ok);
    const settings = { ...DEFAULT_SETTINGS, model: "claude-haiku-4-5" };
    const { dir, ledger } = fresh({ pilot: { micros: 400_000, games: 8 }, total: { micros: 1_000_000, games: 40 } });
    const spec = (key: string) => ({ key, phase: "pilot" as const, bundle, interpreterRevision: POLICY_FIXTURE_REVISION, gameSeed: 902, policySeed: 3, claudeSeat: "p1" as const });
    const deps = (faults: Record<number, "rate" | "timeout" | "malformed">) => ({ provider: fakeClaude({ seed: 4, model: settings.model, faults }), providerKind: "fake" as const, rate: rate.rate, ledger, settings, sleep: async () => {} });
    const first = await playClaudeDuel(spec("a"), deps({ 0: "rate", 1: "timeout", 2: "malformed" }));
    const calls = first.decisions.flatMap((d) => d.calls ?? []);
    const failed = calls.filter((c) => c.error);
    assert.equal(failed.length, 2);
    for (const c of failed) assert.equal(ledger.reservation(c.reservation!)!.state, "ambiguous", "a failed call without usage keeps its reservation");
    assert.equal(ledger.reservation(calls[2].reservation!)!.state, "settled", "a malformed answer still reported usage: settled, and counted");
    const summary = ledger.summary();
    assert.equal(summary.reservations, calls.length, "retries are reservations of their own");
    assert.equal(summary.committedMicros, calls.reduce((n, c) => n + (c.error ? c.maxMicros! : c.chargedMicros!), 0), "failed and retried calls are in the one total");
    // Keep playing until the pilot cap stops a game: incomplete, never a result.
    const games = [first];
    for (let i = 0; i < 8 && games.at(-1)!.outcome !== "budget-limited"; i++) games.push(await playClaudeDuel(spec(`b${i}`), deps({})));
    const limited = games.at(-1)!;
    assert.equal(limited.outcome, "budget-limited", "the pilot cap stops the campaign");
    assert.equal(limited.winner, null);
    assert.ok(ledger.summary().pilotCommittedMicros <= 400_000, "and was never exceeded");
    const manifest = duelManifest({ id: "arena-claude-duel", version: "1", gitCommit: "b".repeat(40), dirtyTreeSha256: null }, { providerKind: "fake", settings, protocol: { test: 902 }, games: games.map((result) => ({ bundle, result })) });
    assert.equal(manifest.results.at(-1)!.outcome, "limit");
    const artifacts = [JSON.stringify(manifest), JSON.stringify(games), readFileSync(path.join(dir, "ledger.jsonl"), "utf8")];
    for (const a of artifacts) assert.ok(!a.includes(SECRET) && !a.includes("sk-ant"), "no key in the manifest, the evidence or the ledger");
  } finally {
    if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previous;
  }
}

rmSync(scratch, { recursive: true, force: true });
console.log(`claude-ledger-902 ok: rates dated ${CAMPAIGN_RATES.verifiedOn}, caps, 4 simultaneous workers, crash/resume, retries and budget stop; ${((Date.now() - started) / 1000).toFixed(1)} s`);
