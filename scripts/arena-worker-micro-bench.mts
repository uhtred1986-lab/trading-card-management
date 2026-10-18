#!/usr/bin/env node
/**
 * #1009: a fast Node micro-benchmark of the local match worker's per-action cost, no browser.
 *
 * It plays the scripted local match of `scripts/verify/arena-local-worker-driver.ts` (the one
 * `arena:local-worker-browser` plays) through the in-process channel and times every message the
 * host handles (`host.handle`: the engine's applyMove + projectSnapshot + journal, which is the work
 * behind the browser script's `roundTripMs`, minus structured clone and the real Worker hop).
 * Reports p50 / p95 / max per message type over several runs after a warm-up run.
 *
 *   npx tsx scripts/arena-worker-micro-bench.mts [--runs N] [--json]
 *   npm run arena:worker-micro
 *
 * (`arena:worker-bench` is the older #643 Chrome benchmark.) Needs no database and no Chrome.
 */
import { stagedPack } from "./verify/arena-local-worker-fixture.mts";
import { inProcessChannel } from "./verify/arena-local-worker-channel.ts";
import { runScripted } from "./verify/arena-local-worker-driver.ts";
import { replayHash } from "../src/lib/arena/replay-core.ts";

const argv = process.argv.slice(2);
const at = argv.indexOf("--runs");
const RUNS = at >= 0 ? Number(argv[at + 1]) : 5;
const quantile = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.max(0, Math.ceil(q * s.length) - 1)] : NaN; };

const pack = await stagedPack();
const byType: Record<string, number[]> = {};
let finalHash = "";
let messages = 0;

for (let run = -1; run < RUNS; run++) {
  const ch = inProcessChannel();
  const handle = ch.host.handle.bind(ch.host);
  const record = run >= 0;
  ch.host.handle = (async (message: { type?: string }) => {
    const t = performance.now();
    const out = await handle(message as never);
    if (record) (byType[message?.type ?? "?"] ??= []).push(performance.now() - t);
    return out;
  }) as typeof ch.host.handle;
  const result = await runScripted("a", ch.port, ch.inject, pack);
  if (run === 0) { finalHash = await replayHash(result.final); messages = ch.posted.length; }
}

const out: Record<string, unknown> = { runs: RUNS, messages, finalHash };
for (const [type, xs] of Object.entries(byType)) {
  if (xs.length < 5) continue;
  out[type] = { n: xs.length, p50: +quantile(xs, 0.5).toFixed(2), p95: +quantile(xs, 0.95).toFixed(2), max: +Math.max(...xs).toFixed(2) };
}
if (argv.includes("--json")) console.log(JSON.stringify(out));
else {
  const fmt = (n: number) => n.toFixed(2).padStart(7);
  console.log(`arena:worker-micro  ${RUNS} runs, ${messages} messages/run, final ${finalHash.slice(0, 12)}`);
  for (const [type, v] of Object.entries(out)) {
    if (typeof v !== "object" || !v) continue;
    const d = v as { n: number; p50: number; p95: number; max: number };
    console.log(`  ${type.padEnd(10)} n=${String(d.n).padEnd(5)} p50 ${fmt(d.p50)} ms  p95 ${fmt(d.p95)} ms  max ${fmt(d.max)} ms`);
  }
}
