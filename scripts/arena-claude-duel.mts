/**
 * #901/#902: the isolated local-policy versus Claude API duel runner. Supersedes `arena-vs-claude.mts`
 * (`arena:vs`, kept as the server-path smoke script it is) for every evaluation: this one never touches
 * the database or the arena's game tables, plays the actual local heuristic on the real rules VM over
 * pinned inputs, and gives the Claude seat only its restricted observation.
 *
 * Dry run (the default): a deterministic fake provider, no network, no key, $0. It still reserves and
 * settles notional spend in its own dry-run ledger, so the budget failures, manifests and replay
 * artifacts the #903 preflight checks are exercised end to end.
 *
 *   npx tsx scripts/arena-claude-duel.mts --model claude-haiku-4-5                  # starters, 1 seed pair, dry
 *   npx tsx scripts/arena-claude-duel.mts --model claude-haiku-4-5 --pack <pack.json> --pairs 2 \
 *       --evidence-out <private.json> --manifest-out <manifest.json>
 *   npx tsx scripts/arena-claude-duel.mts --replay <private.json>                   # replays recorded answers, checks traces
 *   npx tsx scripts/arena-claude-duel.mts --ledger-summary [--ledger <dir>]
 *   npx tsx scripts/arena-claude-duel.mts --recover [--ledger <dir>]                # orphaned reservations after a crash
 *   npx tsx scripts/arena-claude-duel.mts --reconcile <reservation> <micros> <source> [--ledger <dir>]
 *
 * Inputs: `--pack` is a corpus pack from `arena-corpus-freeze.mts --out` (#897/#1030); its bundle is rebuilt
 * from the pack's own defs, programs and catalog rows and must hash to the pack's `hashes.bundle`. Without
 * it the two starter controls are qualified from the committed catalog snapshot (as the freeze does).
 * Every seed is played twice, Claude at p1 then at p2. Flags: --pairs N (1), --seed-base N (901000),
 * --policy-seed N (7919), --phase pilot|full (pilot), --max-moves, --max-decisions, --max-calls,
 * --max-output-tokens, --max-prompt-tokens, --retries, --wall-minutes, --faults "3:malformed,5:rate" (dry only).
 *
 * Paid execution (`--provider anthropic-api --allow-paid`) is refused until the rate sheet is
 * owner-verified and the model's access is verified (`scripts/lib/claude-campaign-rates.ts`), and only
 * after the owner's explicit go (#906, 25 Oct 2026). Its ledger is `.arena-campaign/paid` with the
 * approved caps ($20 / 8 games pilot, $100 / 40 games in all); a restart can never change them. The API
 * key is read from the environment by the provider at call time and is written nowhere.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { bundleFor, freeze } from "./arena-corpus-freeze.mts";
import { loadSnapshot } from "./arena-deck-audit.mts";
import { evaluationRunnerPin } from "./lib/evaluation-provenance";
import { writeEvidenceFile } from "./lib/policy-evaluation-manifest";
import { canonicalJson, type ReplayBundleRecord } from "../src/lib/arena/replay-core";
import type { CardDef, PlayerId } from "../src/lib/arena/types";
import type { CatalogCard } from "../src/lib/catalog/deckplanet";
import type { AiProvider } from "../src/lib/ai/types";
import { CAMPAIGN_RATES, formatUsd, rateFor, sheetHash } from "./lib/claude-campaign-rates";
import { APPROVED_CAPS, CampaignLedger, type CampaignCaps, type CampaignPhase } from "./lib/claude-campaign-ledger";
import { DEFAULT_SETTINGS, DUEL_RUNNER_VERSION, playClaudeDuel, recordedProvider, type DuelResult, type DuelSettings, type ProviderKind } from "./lib/claude-duel";
import { fakeClaude, type Fault } from "./lib/claude-duel-fake";
import { duelManifest } from "./lib/claude-duel-manifest";

export const CAMPAIGN = "arena-claude-duel-906";

export interface DuelDeck { key: string; name: string; leader: string; main: string[]; z: string[] }
export interface DuelInputs { source: string; runtime: string; bundle: ReplayBundleRecord; decks: DuelDeck[]; packHash: string | null }

type Pack = Awaited<ReturnType<typeof freeze>>;

/** The pinned inputs: a corpus pack's admitted decks and its rebuilt bundle, or the qualified starters. */
export async function duelInputs(packPath: string | null): Promise<DuelInputs> {
  if (packPath) {
    const pack = JSON.parse(readFileSync(packPath, "utf8")) as Pack;
    const bundle = await bundleFor(pack.inputs.defs as Record<string, CardDef>, pack.inputs.catalogCards as CatalogCard[], pack.engineRevision, pack.programs.scripts);
    if (bundle.hash !== pack.hashes.bundle) throw new Error(`the pack's bundle does not rebuild: ${bundle.hash} is not ${pack.hashes.bundle}`);
    const decks = pack.decks.filter((d) => d.admitted).map((d) => ({ key: d.key, name: d.name, leader: d.deck.leader, main: d.deck.main, z: d.deck.z }));
    if (!decks.length) throw new Error("the pack admits no deck; a duel needs admitted decks");
    return { source: `corpus pack ${pack.hash}`, runtime: pack.engineRevision, bundle, decks, packHash: pack.hash };
  }
  const runtime = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  const pack = await freeze({ catalog: loadSnapshot(), runtime, pairs: 0, maxMoves: 0, seedBase: 0, catalogPath: "docs/arena-backlog/evidence/649/catalog-subset-2026-10-13.json" });
  const decks = pack.decks.filter((d) => d.qualified).map((d) => ({ key: d.key, name: d.name, leader: d.deck.leader, main: d.deck.main, z: d.deck.z }));
  const bundle = await bundleFor(pack.inputs.defs, pack.inputs.catalogCards, runtime, pack.programs.scripts);
  return { source: "qualified starter controls (no pack: compiler mode, not admitted by play)", runtime, bundle, decks, packHash: null };
}

export function pairBundle(base: ReplayBundleRecord, a: DuelDeck, b: DuelDeck): ReplayBundleRecord {
  const input = (d: DuelDeck) => ({ name: d.name, leader: d.leader, main: d.main, ...(d.z.length ? { z: d.z } : {}) });
  return { ...base, decks: { p1: input(a), p2: input(b) } } as ReplayBundleRecord;
}

export interface Schedule { key: string; bundle: ReplayBundleRecord; deckA: string; deckB: string; gameSeed: number; policySeed: number; claudeSeat: PlayerId }

/** Every pair of decks (a mirror once), each seed with Claude at p1 and then at p2: both seat assignments pinned. */
export function schedule(inputs: DuelInputs, opts: { pairs: number; seedBase: number; policySeed: number; run: string }): Schedule[] {
  const out: Schedule[] = [];
  const decks = inputs.decks;
  for (let i = 0; i < decks.length; i++) for (let j = i; j < decks.length; j++) {
    const bundle = pairBundle(inputs.bundle, decks[i], decks[j]);
    for (let k = 0; k < opts.pairs; k++) {
      const gameSeed = opts.seedBase + (i * 31 + j) * 100 + k;
      for (const claudeSeat of ["p1", "p2"] as const) {
        out.push({ key: `${opts.run}:${decks[i].key}-${decks[j].key}:${gameSeed}:${claudeSeat}`, bundle, deckA: decks[i].key, deckB: decks[j].key, gameSeed, policySeed: opts.policySeed + k, claudeSeat });
      }
    }
  }
  return out;
}

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const num = (name: string, fallback: number) => {
  const v = flag(name);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${name} takes a non-negative whole number`);
  return n;
};

export function parseFaults(text: string | undefined): Record<number, Fault> {
  const out: Record<number, Fault> = {};
  for (const part of (text ?? "").split(",").filter(Boolean)) {
    const [at, kind] = part.split(":");
    out[Number(at)] = kind as Fault;
  }
  return out;
}

export interface EvidenceFile {
  format: 1;
  runner: number;
  campaign: string;
  providerKind: ProviderKind;
  settings: DuelSettings;
  inputs: { source: string; runtime: string; bundleHash: string; packHash: string | null };
  rateSheet: { verifiedOn: string; sha256: string };
  ledger: { dir: string; caps: CampaignCaps };
  games: { schedule: Omit<Schedule, "bundle">; result: DuelResult }[];
}

async function replay(path: string) {
  const ev = JSON.parse(readFileSync(path, "utf8")) as EvidenceFile;
  const inputs = await duelInputs(flag("--pack") ?? null);
  if (inputs.bundle.hash !== ev.inputs.bundleHash) throw new Error(`replay needs the same inputs: bundle ${inputs.bundle.hash} is not ${ev.inputs.bundleHash} (pass the same --pack)`);
  const dir = mkdtempSync(join(tmpdir(), "claude-duel-replay-"));
  try {
    const ledger = CampaignLedger.open(dir, { campaign: "replay", caps: APPROVED_CAPS, rateSheet: ev.rateSheet.sha256, dryRun: true });
    const rate = rateFor(ev.settings.model, { paid: false });
    if (!rate.ok) throw new Error(rate.reason);
    let same = 0;
    for (const g of ev.games) {
      const deckOf = (k: string) => inputs.decks.find((d) => d.key === k)!;
      const bundle = pairBundle(inputs.bundle, deckOf(g.schedule.deckA), deckOf(g.schedule.deckB));
      const again = await playClaudeDuel({ key: g.schedule.key, phase: "pilot", bundle, interpreterRevision: inputs.runtime, gameSeed: g.schedule.gameSeed, policySeed: g.schedule.policySeed, claudeSeat: g.schedule.claudeSeat },
        { provider: recordedProvider(g.result), providerKind: "fake", rate: rate.rate, ledger, settings: ev.settings, sleep: async () => {} });
      const ok = again.trace === g.result.trace && again.outcome === g.result.outcome && again.moves === g.result.moves;
      console.log(`${g.schedule.key}: ${ok ? "replayed" : "DIFFERS"} (${g.result.outcome}, ${g.result.moves} moves, trace ${g.result.trace} / ${again.trace})`);
      if (ok) same++;
    }
    if (same !== ev.games.length) throw new Error(`${ev.games.length - same} game(s) did not replay`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const ledgerDirFor = (kind: ProviderKind) => flag("--ledger") ?? join(".arena-campaign", kind === "fake" ? "dry-run" : "paid");
  if (flag("--replay")) return replay(flag("--replay")!);
  if (process.argv.includes("--ledger-summary") || process.argv.includes("--recover") || flag("--reconcile")) {
    const dir = flag("--ledger") ?? join(".arena-campaign", "paid");
    const ledger = CampaignLedger.inspect(dir);
    if (process.argv.includes("--recover")) console.log(JSON.stringify(ledger.recoverOrphans()));
    if (flag("--reconcile")) {
      const i = process.argv.indexOf("--reconcile");
      ledger.reconcile(process.argv[i + 1], Number(process.argv[i + 2]), process.argv.slice(i + 3).join(" "));
    }
    const s = ledger.summary();
    console.log(JSON.stringify({ ...s, committed: formatUsd(s.committedMicros), billed: formatUsd(s.billedMicros) }, null, 1));
    return;
  }

  const model = flag("--model");
  if (!model) throw new Error("--model is required: the Claude seat's model is chosen explicitly (no tier, no default)");
  const providerKind = (flag("--provider") ?? "fake") as ProviderKind;
  if (providerKind !== "fake" && providerKind !== "anthropic-api") throw new Error("--provider is fake or anthropic-api; nothing else (no subscription, no OpenRouter)");
  const paid = providerKind === "anthropic-api";
  if (paid && !process.argv.includes("--allow-paid")) throw new Error("a paid run needs --allow-paid, and the owner's explicit go (#906)");
  const rate = rateFor(model, { paid });
  if (!rate.ok) throw new Error(rate.reason);
  const phase = (flag("--phase") ?? "pilot") as CampaignPhase;
  if (phase !== "pilot" && phase !== "full") throw new Error("--phase is pilot or full");
  const faults = parseFaults(flag("--faults"));
  if (paid && Object.keys(faults).length) throw new Error("--faults is for the dry run only");
  const settings: DuelSettings = {
    ...DEFAULT_SETTINGS,
    model,
    maxMoves: num("--max-moves", DEFAULT_SETTINGS.maxMoves),
    maxClaudeDecisions: num("--max-decisions", DEFAULT_SETTINGS.maxClaudeDecisions),
    maxCallsPerGame: num("--max-calls", DEFAULT_SETTINGS.maxCallsPerGame),
    maxOutputTokens: num("--max-output-tokens", DEFAULT_SETTINGS.maxOutputTokens),
    maxPromptTokens: num("--max-prompt-tokens", DEFAULT_SETTINGS.maxPromptTokens),
    maxRetries: num("--retries", DEFAULT_SETTINGS.maxRetries),
    wallTimeMs: num("--wall-minutes", DEFAULT_SETTINGS.wallTimeMs / 60_000) * 60_000,
  };
  const pairs = num("--pairs", 1), seedBase = num("--seed-base", 901000), policySeed = num("--policy-seed", 7919);
  const inputs = await duelInputs(flag("--pack") ?? null);
  const run = flag("--run") ?? new Date().toISOString().replace(/[:.]/g, "-");
  const games = schedule(inputs, { pairs, seedBase, policySeed, run });
  const ledgerDir = ledgerDirFor(providerKind);
  const ledger = CampaignLedger.open(ledgerDir, { campaign: paid ? CAMPAIGN : `${CAMPAIGN}-dry-run`, caps: APPROVED_CAPS, rateSheet: sheetHash(), dryRun: !paid });
  const recovered = ledger.recoverOrphans();
  if (recovered.released.length || recovered.ambiguous.length) console.log(`recovered orphans: ${recovered.released.length} released (never sent), ${recovered.ambiguous.length} ambiguous (kept as spent)`);

  let provider: AiProvider;
  if (paid) {
    // Loaded only here, so a dry run's import graph has no vendor SDK at all.
    const { createAnthropicApiProvider } = await import("../src/lib/ai/providers/anthropic-api");
    provider = createAnthropicApiProvider();
    const available = await provider.available();
    if (!available.ok) throw new Error(available.reason);
  } else {
    provider = fakeClaude({ seed: policySeed, model, faults });
  }

  const abort = new AbortController();
  process.once("SIGINT", () => { console.error("cancelling: the current call is aborted and keeps its reservation"); abort.abort(); });

  const played: EvidenceFile["games"] = [];
  for (const g of games) {
    if (abort.signal.aborted) break;
    const result = await playClaudeDuel({ key: g.key, phase, bundle: g.bundle, interpreterRevision: inputs.runtime, gameSeed: g.gameSeed, policySeed: g.policySeed, claudeSeat: g.claudeSeat },
      { provider, providerKind, rate: rate.rate, ledger, settings, signal: abort.signal, ...(paid ? {} : { sleep: async () => {} }) });
    const { bundle: _bundle, ...rest } = g;
    void _bundle;
    played.push({ schedule: rest, result });
    console.log(`${g.key}: ${result.outcome}${result.winner ? ` (${result.winner})` : ""}${result.detail ? ` — ${result.detail}` : ""}; ${result.moves} moves, ${result.claudeDecisions} Claude decisions, ${result.calls} calls, ${formatUsd(result.chargedMicros)} charged, ${formatUsd(result.billedMicros)} billed`);
    if (result.outcome === "budget-limited") break;
  }
  const s = ledger.summary();
  console.log(`ledger ${ledgerDir}: ${formatUsd(s.committedMicros)} committed (${formatUsd(s.billedMicros)} billed) of ${formatUsd(s.caps.total.micros)}; ${s.games.total} games of ${s.caps.total.games}; ${s.inFlight} in flight, ${s.ambiguous} ambiguous`);

  const evidence: EvidenceFile = {
    format: 1, runner: DUEL_RUNNER_VERSION, campaign: CAMPAIGN, providerKind, settings,
    inputs: { source: inputs.source, runtime: inputs.runtime, bundleHash: inputs.bundle.hash, packHash: inputs.packHash },
    rateSheet: { verifiedOn: CAMPAIGN_RATES.verifiedOn, sha256: sheetHash() },
    ledger: { dir: ledgerDir, caps: APPROVED_CAPS }, games: played,
  };
  const evidenceOut = flag("--evidence-out");
  // Private: it holds the prompts' hashes, the raw answers and the seat's own cards. Never a public issue.
  if (evidenceOut) { writeEvidenceFile(evidenceOut, canonicalJson(evidence) + "\n"); console.log(`wrote private evidence ${evidenceOut}`); }
  const manifestOut = flag("--manifest-out");
  if (manifestOut && played.length) {
    const manifest = duelManifest(evaluationRunnerPin("arena-claude-duel", String(DUEL_RUNNER_VERSION)), {
      providerKind, settings,
      protocol: { campaign: CAMPAIGN, settings, pairs, seedBase, policySeed, inputs: evidence.inputs, rateSheet: evidence.rateSheet, caps: APPROVED_CAPS },
      games: games.slice(0, played.length).map((g, i) => ({ bundle: g.bundle, result: played[i].result })),
    });
    writeEvidenceFile(manifestOut, JSON.stringify(manifest, null, 2) + "\n");
    console.log(`wrote allowlisted manifest ${manifestOut}; it passes no deck or scenario by itself`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
