/**
 * The owner's one-command paid pilot of the local-policy versus Claude API campaign (#904, inside
 * #906's approved caps: $20 / 8 games for the pilot, $100 / 40 games in all). Run it on your own
 * machine, where your Anthropic API key is: a cloud agent session has no key and must not spend.
 *
 *   npx tsx scripts/arena-claude-pilot.mts          # the paid pilot: 6 games, stops at $20
 *   npx tsx scripts/arena-claude-pilot.mts --dry    # the same games with a fake Claude: $0, no key, no network
 *
 * What it does, in order, and what it never does:
 *
 *  1. Finds your key: `ANTHROPIC_API_KEY` or `APP_ANTHROPIC_API_KEY` in the environment, else the same
 *     names in `.env.local` / `.env` in this folder. The key is never printed, logged or written.
 *  2. Shows the frozen protocol and the price lines of the rate sheet for the model, and asks you to
 *     type `yes` if your Anthropic Console shows the same prices (the owner verification the runner
 *     requires; `--prices-confirmed` answers it for a non-interactive shell).
 *  3. Checks the key can use the model with the free Models API (`GET /v1/models/<id>`). No tokens.
 *  4. Plays the games through the frozen duel runner (`arena-claude-duel.mts`): Claude in one seat
 *     with only its seat's restricted view, the actual local heuristic in the other, each deal from
 *     both seats. Every request is reserved in the spend ledger before it is sent
 *     (`~/.arena-campaign/arena-claude-duel-906`), so the caps hold across restarts.
 *  5. Writes the results to `docs/arena-backlog/evidence/904/pilot-<date>/`: `manifest.json` and
 *     `summary.md` (safe to commit), and `private-evidence.json` (Claude's raw answers and the seat's
 *     own cards — git-ignored by the folder's own `.gitignore`; share it only if you want the games
 *     analysed move by move).
 *
 * Protocol (frozen here; #903): model claude-opus-5-5, the two qualified starter controls (SD15
 * Pride of the Saiyans, SD5 The Crimson Saiyan) in their three pairings, one deal each, Claude first
 * and then second: 6 games. Engine seeds from 70,000,000 and policy seeds from 570,000,000 (a block
 * reserved in `scripts/lib/arena-seed-blocks.ts`). Reduced scope by design: the two controls only.
 */
import { createInterface } from "node:readline/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { CAMPAIGN_RATES, formatUsd, type RateSheet } from "./lib/claude-campaign-rates";
import { APPROVED_CAPS, CampaignLedger, paidLedgerDir } from "./lib/claude-campaign-ledger";
import { CAMPAIGN, runCampaign } from "./arena-claude-duel.mts";

const MODEL = "claude-opus-5-5";
const SEED_BASE = 70_000_000;
const POLICY_SEED = 570_000_000;
const PAIRS = 1;

const dry = process.argv.includes("--dry");
const date = new Date().toISOString().slice(0, 10);

function say(text = "") { console.log(text); }

/** The key, from the environment or a local env file. Returns which name held it, never the value. */
function findKey(): string | null {
  for (const name of ["ANTHROPIC_API_KEY", "APP_ANTHROPIC_API_KEY"]) if (process.env[name]) return name;
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?(ANTHROPIC_API_KEY|APP_ANTHROPIC_API_KEY)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      const value = m[2].replace(/^(['"])(.*)\1$/, "$2").trim();
      if (value) {
        process.env.APP_ANTHROPIC_API_KEY = value;
        return `${m[1]} in ${file}`;
      }
    }
  }
  return null;
}

const keyValue = () => process.env.ANTHROPIC_API_KEY || process.env.APP_ANTHROPIC_API_KEY || "";

async function accessCheck(): Promise<{ ok: boolean; detail: string }> {
  const res = await fetch(`https://api.anthropic.com/v1/models/${MODEL}`, { headers: { "x-api-key": keyValue(), "anthropic-version": "2023-06-01" } });
  if (res.ok) return { ok: true, detail: `${MODEL} is available to this key` };
  if (res.status === 401) return { ok: false, detail: "the key was refused (401): check it is a current API key" };
  if (res.status === 404) return { ok: false, detail: `this key cannot use ${MODEL} (404)` };
  return { ok: false, detail: `the Models API answered ${res.status}` };
}

function priceLines(sheet: RateSheet): string[] {
  const rate = sheet.models.find((m) => m.model === MODEL);
  if (!rate) throw new Error(`${MODEL} is not on the rate sheet`);
  return rate.tiers.map((t) => {
    const p = t.usdPerMTok;
    const bound = t.maxPromptTokens === null ? "" : ` (prompts up to ${t.maxPromptTokens.toLocaleString("en")} tokens)`;
    return `  ${rate.label}${bound}: input $${p.input}, output $${p.output}, cache read $${p.cacheRead}, cache write $${p.cacheWrite5m} (5 min) / $${p.cacheWrite1h} (1 h) — per million tokens`;
  });
}

/** The committed sheet with the owner's price confirmation and the verified access: nothing else changes. */
function confirmedSheet(): RateSheet {
  return { ...CAMPAIGN_RATES, ownerVerified: true, models: CAMPAIGN_RATES.models.map((m) => (m.model === MODEL ? { ...m, access: "verified" } : m)) };
}

async function main() {
  const commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  const outDir = join("docs", "arena-backlog", "evidence", "904", `pilot-${date}${dry ? "-dry" : ""}`);
  say(`Arena: local AI versus Claude — ${dry ? "DRY RUN (fake Claude, $0)" : "paid pilot"} at commit ${commit}`);
  say(`  ${PAIRS * 6} games: the two starter decks in all three pairings, Claude first and second; model ${MODEL}`);
  say(`  caps: the pilot stops at ${formatUsd(APPROVED_CAPS.pilot.micros)} or ${APPROVED_CAPS.pilot.games} games; the campaign at ${formatUsd(APPROVED_CAPS.total.micros)} / ${APPROVED_CAPS.total.games} games`);

  let sheet = CAMPAIGN_RATES;
  const args = ["--model", MODEL, "--phase", "pilot", "--pairs", String(PAIRS), "--seed-base", String(SEED_BASE), "--policy-seed", String(POLICY_SEED), "--run", `pilot-${date}`];
  if (!dry) {
    const where = findKey();
    if (!where) throw new Error("no API key found: set ANTHROPIC_API_KEY (PowerShell: $env:ANTHROPIC_API_KEY = \"sk-ant-...\") or put it in .env.local, then run this again");
    say(`  key: found (${where}); it is never printed or written`);
    say("");
    say(`Prices on the campaign's rate sheet (read from Anthropic's public pricing page on ${CAMPAIGN_RATES.verifiedOn}):`);
    for (const line of priceLines(CAMPAIGN_RATES)) say(line);
    if (!process.argv.includes("--prices-confirmed")) {
      if (!process.stdin.isTTY) throw new Error("the price confirmation needs a terminal; or pass --prices-confirmed if you have checked them");
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = (await rl.question("Do these match the prices in your Anthropic Console (Settings → Billing / Usage)? Type yes to continue: ")).trim().toLowerCase();
      rl.close();
      if (answer !== "yes") { say("Not confirmed: nothing was spent."); return; }
    }
    const access = await accessCheck();
    say(`  model access: ${access.detail} (free check, no tokens)`);
    if (!access.ok) throw new Error("stopping before any paid call");
    sheet = confirmedSheet();
    args.push("--provider", "anthropic-api", "--allow-paid");
    if (!existsSync(join(paidLedgerDir(CAMPAIGN), "ledger.jsonl"))) args.push("--new-campaign");
  } else {
    args.push("--ledger", join(outDir, ".dry-ledger"));
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, ".gitignore"), "private-evidence.json\n.dry-ledger/\n");
  const evidence = join(outDir, "private-evidence.json");
  const manifest = join(outDir, "manifest.json");
  args.push("--evidence-out", evidence, "--manifest-out", manifest);

  // The runner reads its flags from the command line.
  process.argv = [process.argv[0], "arena-claude-duel.mts", ...args];
  const lines: string[] = [];
  const log = console.log;
  console.log = (...parts: unknown[]) => { const text = parts.map(String).join(" "); lines.push(text); log(text); };
  try {
    await runCampaign(sheet);
  } finally {
    console.log = log;
  }

  const games = lines.filter((l) => /^pilot-.*: /.test(l));
  const ledgerLine = lines.find((l) => l.startsWith("ledger ")) ?? "";
  let spend = "";
  if (!dry) {
    const s = CampaignLedger.inspect(paidLedgerDir(CAMPAIGN)).summary();
    spend = `${formatUsd(s.committedMicros)} committed (${formatUsd(s.billedMicros)} billed so far) of ${formatUsd(s.caps.total.micros)}; ${s.games.total} of ${s.caps.total.games} games used`;
  }
  const summary = [
    `# Claude API pilot (#904), ${date}${dry ? " — DRY RUN" : ""}`,
    "",
    `- Commit: \`${commit}\`; model \`${MODEL}\`; seeds ${SEED_BASE}+ / policy ${POLICY_SEED}+; ${PAIRS} deal per pairing, both seats.`,
    `- Opponent: the local heuristic (\`localPolicy()\`) of that commit.`,
    `- Prices: ${dry ? "not used (fake provider)" : `rate sheet of ${CAMPAIGN_RATES.verifiedOn}, confirmed against the Console by the owner on ${date}`}.`,
    ...(spend ? [`- Spend: ${spend}.`] : []),
    "",
    "## Games",
    "",
    ...games.map((g) => `- ${g.replace(/^pilot-[^:]*:/, "")}`),
    "",
    ledgerLine ? `Ledger: ${ledgerLine.replace(/^ledger \S+: /, "")}` : "",
    "",
    "`manifest.json` is the allowlisted public record. `private-evidence.json` (git-ignored) holds the raw answers;",
    "replay it with `npx tsx scripts/arena-claude-duel.mts --replay <file>`.",
    "",
  ].join("\n");
  writeFileSync(join(outDir, "summary.md"), summary);
  say("");
  say(`Done. Results in ${outDir}/ — commit summary.md and manifest.json, and push.`);
  say("Share private-evidence.json too only if you want Claude's moves analysed against the local AI's.");
}

await main();
