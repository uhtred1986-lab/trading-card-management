/**
 * #902: a child process for `claude-ledger-902.mts` — a second worker on the same ledger, or a
 * worker that dies at a chosen point. Not a test by itself.
 *
 *   tsx claude-ledger-worker-902.mts reserve <dir> <game> <count> <micros>     reserve until refused; prints the ids granted
 *   tsx claude-ledger-worker-902.mts crash-after <dir> <game> reserve|dispatch  reserve (and dispatch), then exit without settling
 */
import { writeSync } from "node:fs";
import { APPROVED_CAPS, CampaignLedger, type CampaignCaps } from "../lib/claude-campaign-ledger.ts";

const [mode, dir, game, a, b] = process.argv.slice(2);
const caps = JSON.parse(process.env.LEDGER_CAPS ?? JSON.stringify(APPROVED_CAPS)) as CampaignCaps;
const ledger = CampaignLedger.open(dir, { campaign: "test-902", caps, rateSheet: "test", dryRun: true });

if (mode === "reserve") {
  const granted: string[] = [];
  for (let i = 0; i < Number(a); i++) {
    const r = ledger.reserve({ game, model: "claude-haiku-4-5", maxMicros: Number(b) });
    if (!r.ok) break;
    granted.push(r.id);
    ledger.dispatch(r.id);
    ledger.settle(r.id, { usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, micros: Number(b), billed: false });
  }
  process.stdout.write(JSON.stringify(granted));
} else if (mode === "crash-after") {
  const r = ledger.reserve({ game, model: "claude-haiku-4-5", maxMicros: 1_000_000 });
  if (!r.ok) throw new Error(r.reason);
  if (a === "dispatch") ledger.dispatch(r.id);
  writeSync(1, r.id);
  // A crash: no settle, no cleanup, no exit handlers.
  process.kill(process.pid, "SIGKILL");
} else {
  throw new Error(`unknown mode ${mode}`);
}
