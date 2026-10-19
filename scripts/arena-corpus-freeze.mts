/**
 * #897: freeze a qualified deck corpus for the built-in opponent release. Offline only.
 *
 * No database, no network, no provider. It reads the committed catalog snapshot of #649
 * (`docs/arena-backlog/evidence/649/catalog-subset-2026-10-13.json`) or, with `--catalog`, another
 * snapshot-shaped file; the repo's compiler and engine; and the local policy. For every candidate deck:
 *
 *   1. input completeness: every card resolves, no Unison lacks its specified cost, legality is a label
 *   2. readings: every skill of every face reads fully (no unread clause), reads as something (not in the
 *      silent family of #1005, `KNOWN_SILENT` included), and is not a tier-B audit blocker
 *   3. the named runtime gaps of #825 (Cooler / Trunks / Great Ape), by card, with the stored-rule check
 *      that only the owner's database can answer (`--stored-rules`, see below)
 *   4. deterministic paired matches with the complete local policy: every qualified deck against every
 *      qualified deck (and itself), each deal played from both seats under explicit seeds and a move cap,
 *      reported as completed / illegal / interrupted / limited, apart from each other
 *
 * A deck is **admitted** only when it qualifies and every scheduled match completed (at least one).
 * Compiling is never counted as support; an open issue or a clean parse is not a pass.
 *
 *   npx tsx scripts/arena-corpus-freeze.mts                       # starters A and B: summary
 *   npx tsx scripts/arena-corpus-freeze.mts --check               # assert: starters admitted, no illegal game, replay equal
 *   npx tsx scripts/arena-corpus-freeze.mts --out pack.json       # the replayable pack (canonical JSON)
 *   flags: --mode compiler|stored (inferred from --stored-rules), --pairs N (seed pairs per matchup, default 3), --max-moves N (default 3000), --runtime <sha>
 *          --manifest-out <JSON> projects actual game metrics into the Testing & stats import contract.
 *          (engine revision; default git HEAD), --seed-base N (default 897000)
 *
 * Beyond the starters (run by the COORDINATOR, who may read the live data; this task never does):
 *   --decks decks.json     [{ "key":"X1","name":"...","leader":"BT3-001","main":["BT3-010",...],"z":[...]? }]
 *   --catalog cat.json     { "source":{url,retrieved,...}, "cards":[CatalogCard...] } covering those decks
 *                          (the same shape as the committed snapshot; `arena-deck-audit.mts --live
 *                          --write-snapshot` writes one)
 *   --stored-rules r.json  complete exported `card_rules` records, in snake_case or camelCase (all executable fields plus source/version/status)
 *   --starters=false       leave the two starter controls out
 *   Keep a pack built from private decks out of public GitHub issues (it names the cards).
 *
 *   Coordinator command for a concrete additional pair from #827 (after exporting the two lists, the
 *   catalog subset and the rows privately):
 *     npx tsx scripts/arena-corpus-freeze.mts --decks <lists.json> --catalog <catalog.json> \
 *       --stored-rules <rules.json> --out <private-pack.json>
 */
import { corpusManifest, type CorpusAttempt } from "./lib/corpus-manifest";
import { evaluationRunnerPin } from "./lib/evaluation-provenance";
import { writeEvidenceFile } from "./lib/policy-evaluation-manifest";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { DECKS, KNOWN_REFUSALS, auditCard, loadSnapshot, resolveDeck, skillTier, type DeckSpec } from "./arena-deck-audit.mts";
import { playDuel, type DuelResult } from "./verify/arena-policy-duel.ts";
import { legality, type LegalityCard } from "../src/lib/decks/legality";
import { cardDefFrom } from "../src/lib/arena/load";
import { compileCard } from "../src/lib/arena/compile";
import { KNOWN_SILENT, readsAsNothingSilently } from "../src/lib/arena/compile/silent";
import { skillsOf } from "../src/lib/arena/text/cards";
import { DBS_FILES } from "../src/lib/arena/rulesets/dbs";
import { canonicalJson, makeReplayBundle, replayHash, type ReplayBundleRecord } from "../src/lib/arena/replay-core";
import { localPolicy } from "../src/lib/arena/policy/combat";
import type { CatalogCard } from "../src/lib/catalog/deckplanet";
import { programProvenance, fileHash, treeHash, hashOf, type ProgramMode, type ExportedRule } from "./arena-corpus-provenance.mts";
import type { CardDef, PlayerId, Skill } from "../src/lib/arena/types";

const OWNER_SPECIFIED_COSTS_PATH = "docs/arena-backlog/evidence/655/owner-specified-costs-2026-10-13.json";
const SNAPSHOT_PATH = "docs/arena-backlog/evidence/649/catalog-subset-2026-10-13.json";
const OWNER_SPECIFIED_COSTS: Record<string, string> = (JSON.parse(readFileSync(OWNER_SPECIFIED_COSTS_PATH, "utf8")) as { specifiedCosts: Record<string, string> }).specifiedCosts;
export const FORMAT = 2;

/**
 * The historical #825 targets, keyed `card/face/skill`. PR #834 delivered code;
 * later application receipts must be reconciled individually, not repeated as a batch.
 * Compiler mode reports fresh readings; stored mode requires current executable rows.
 */
export const NAMED_GAPS: { key: string; card: string; face: "front" | "back"; skill: number; what: string }[] = [
  { key: "BT29-029/back/0", card: "BT29-029", face: "back", skill: 0, what: "Cooler: qualified Battle-Area-to-hand watcher" },
  { key: "BT3-112/front/10", card: "BT3-112", face: "front", skill: 10, what: "Trunks: Over Realm Battle-to-Warp self trigger" },
  { key: "BT3-096/front/10", card: "BT3-096", face: "front", skill: 10, what: "Great Ape Tora: combo-end Evolve" },
  { key: "BT3-098/front/10", card: "BT3-098", face: "front", skill: 10, what: "Great Ape Fasha: combo-end Evolve" },
  { key: "BT3-090/front/0", card: "BT3-090", face: "front", skill: 0, what: "#825 refresh target" },
  { key: "BT7-040/front/10", card: "BT7-040", face: "front", skill: 10, what: "#825 refresh target" },
  { key: "BT7-083/front/10", card: "BT7-083", face: "front", skill: 10, what: "#825 refresh target" },
  { key: "BT7-086/front/10", card: "BT7-086", face: "front", skill: 10, what: "#825 refresh target" },
];

interface Candidate { key: string; name: string; source: string; leader: string; main: string[]; z: string[]; problems: string[] }

interface SkillRecord { index: number; kind: string; read: boolean; unread: string[]; silent: boolean; structural: string | null; auditTier: string }
interface CardRecord { id: string; name: string; copies: number; missingInputs: string[]; faces: { face: "front" | "back"; skills: SkillRecord[] }[] }

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function candidatesFrom(catalog: CatalogCard[], extra: { key: string; name: string; leader: string; main: string[]; z?: string[] }[], starters: boolean): Candidate[] {
  const out: Candidate[] = [];
  if (starters) {
    for (const spec of DECKS as DeckSpec[]) {
      const { rows, problems } = resolveDeck(spec, catalog);
      const expand = (zone: "leader" | "main" | "z") => rows.filter((r) => r.zone === zone).flatMap((r) => Array.from({ length: r.quantity }, () => r.card.id));
      out.push({ key: spec.key, name: spec.name, source: `starter control: ${spec.source}`, leader: expand("leader")[0], main: expand("main"), z: expand("z"), problems });
    }
  }
  const ids = new Set(catalog.map((c) => c.id));
  for (const d of extra) {
    const missing = [d.leader, ...d.main, ...(d.z ?? [])].filter((id) => !ids.has(id));
    out.push({ key: d.key, name: d.name, source: "supplied list (--decks)", leader: d.leader, main: d.main, z: d.z ?? [], problems: [...new Set(missing)].map((id) => `${id}: not in the catalog`) });
  }
  return out;
}

const keyOf = (id: string, face: "front" | "back", idx: number) => `${id}${face === "back" ? "b" : ""}#${idx}`;

function inspectCard(card: CatalogCard, copies: number): { record: CardRecord; def: CardDef } {
  const specifiedCost = OWNER_SPECIFIED_COSTS[card.id] ?? null;
  const withCost = { ...card, specifiedCost } as CatalogCard;
  const def = cardDefFrom(withCost as never);
  const audits = auditCard(withCost);
  const faces: CardRecord["faces"] = [];
  for (const face of ["front", "back"] as const) {
    if (face === "back" && !def.back) continue;
    const scripts = compileCard(def, face);
    const skills: SkillRecord[] = [];
    for (const sk of skillsOf(def, face) as Skill[]) {
      const a = audits.find((x) => x.face === face && x.index === sk.index)!;
      const s = scripts.bySkill[sk.index];
      // A skill whose price, trigger or static layer the engine cannot read is blocked whatever the compiler says. The audit's
      // family table is NOT a gate here: a mechanic it has no family for is table drift (BT11-011's playedFromHand), kept as auditTier.
      const structural = face === "front" && KNOWN_REFUSALS[`${card.id}#${sk.index}`] ? "known refusal" : a.priceRead === false ? "price the engine cannot read" : sk.kind === "auto" && a.triggers.length === 0 ? "Auto with no readable trigger" : sk.kind === "permanent" && a.staticEmits === false ? "Permanent that emits no static op" : null;
      skills.push({ index: sk.index, kind: sk.kind, read: a.read, unread: a.unread, silent: !!s && readsAsNothingSilently(sk, s), structural, auditTier: skillTier(a) });
    }
    faces.push({ face, skills });
  }
  const missingInputs = def.type === "UNISON" && !def.specifiedCost ? ["specifiedCost"] : [];
  return { record: { id: card.id, name: card.name, copies, missingInputs, faces }, def };
}

const legalityRow = (card: CatalogCard, zone: "leader" | "main" | "z", quantity: number): LegalityCard => ({
  cardId: card.id, zone, quantity, name: card.name, cardType: card.cardType, colors: card.colors, limitedTo: card.limitedTo, isBanned: card.isBanned, skill: card.skill, game: "dbs",
});

interface DeckVerdict {
  key: string; name: string; source: string;
  deck: { leader: string; main: string[]; z: string[] };
  inputComplete: boolean; problems: string[];
  legality: { status: string; illegal: string[]; warnings: string[] };
  cards: CardRecord[];
  blockers: string[];
  namedGaps: { key: string; what: string; issue: 825; currentReading: "clean" | "blocked"; stored: "current" | "blocked" | "unverified-offline" }[];
  qualified: boolean;
}

function qualify(c: Candidate, catalog: CatalogCard[], mode: ProgramMode, provenance: ReturnType<typeof programProvenance>): { verdict: DeckVerdict; defs: Record<string, CardDef> } {
  const byId = new Map(catalog.map((x) => [x.id, x]));
  const counts = new Map<string, number>();
  for (const id of [c.leader, ...c.main, ...c.z]) counts.set(id, (counts.get(id) ?? 0) + 1);
  const cards: CardRecord[] = [];
  const defs: Record<string, CardDef> = {};
  for (const [id, n] of [...counts].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const card = byId.get(id);
    if (!card) continue;
    const { record, def } = inspectCard(card, n);
    cards.push(record);
    defs[id] = def;
  }
  const blockers: string[] = [...c.problems.map((p) => `unresolved: ${p}`)];
  for (const r of cards) {
    for (const m of r.missingInputs) blockers.push(`${r.id}: missing input ${m}`);
    for (const f of r.faces) for (const s of f.skills) {
      const at = `${r.id}/${f.face}/${s.index}`;
      if (mode === "compiler" && !s.read) blockers.push(`${at}: unread (${s.unread.join(" | ").slice(0, 120)})`);
      if (mode === "compiler" && s.silent) blockers.push(`${at}: reads as nothing, silently${KNOWN_SILENT.has(keyOf(r.id, f.face, s.index)) ? " (KNOWN_SILENT)" : ""}`);
      if (mode === "compiler" && s.structural) blockers.push(`${at}: ${s.structural}`);
    }
  }
  const namedGaps: DeckVerdict["namedGaps"] = [];
  for (const g of NAMED_GAPS) {
    const r = cards.find((x) => x.id === g.card);
    if (!r) continue;
    const sk = r.faces.find((f) => f.face === g.face)?.skills.find((s) => s.index === g.skill);
    const clean = mode === "stored" ? provenance.manifest.find((s) => s.key === g.key)?.executable === true : !!sk && sk.read && !sk.silent && !sk.structural;
    const skill = provenance.manifest.find((s) => s.key === g.key);
    const state = mode === "compiler" ? "unverified-offline" : skill?.freshness === "current" && skill.executable ? "current" : "blocked";
    namedGaps.push({ key: g.key, what: g.what, issue: 825, currentReading: clean ? "clean" : "blocked", stored: state });
    if (!clean) blockers.push(`${g.key}: named gap #825 still reads blocked`);
    if (mode === "stored" && state !== "current") blockers.push(`${g.key}: named gap #825 stored record ${state}`);
  }
  if (mode === "stored") {
    blockers.push(...provenance.malformed);
    for (const skill of provenance.manifest.filter((s) => counts.has(s.cardId))) for (const problem of skill.blockers) blockers.push(`${skill.key}: ${problem}`);
    for (const key of provenance.unexpectedRows) if (counts.has(key.split("/")[0])) blockers.push(`${key}: unexpected stored skill`);
  }
  const rows: LegalityCard[] = [...new Set(c.main)].filter((id) => byId.has(id)).map((id) => legalityRow(byId.get(id)!, "main", c.main.filter((x) => x === id).length)).filter(Boolean);
  const lg = byId.has(c.leader) ? legality([legalityRow(byId.get(c.leader)!, "leader", 1), ...rows.filter((r) => byId.has(r.cardId))], "dbs") : null;
  const verdict: DeckVerdict = {
    key: c.key, name: c.name, source: c.source, deck: { leader: c.leader, main: c.main, z: c.z },
    inputComplete: !c.problems.length && !cards.some((r) => r.missingInputs.length), problems: c.problems,
    legality: lg ? { status: lg.status, illegal: lg.issues.filter((i) => i.severity === "illegal").map((i) => i.message), warnings: lg.issues.filter((i) => i.severity === "warning").map((i) => i.message) } : { status: "unknown", illegal: ["leader not in the catalog"], warnings: [] },
    cards, blockers, namedGaps,
    qualified: false,
  };
  // Legality is a flag, never a block (CLAUDE.md): an illegal list is recorded, and the owner's amended starter A is legal anyway.
  verdict.qualified = verdict.blockers.length === 0;
  return { verdict, defs };
}

interface Game { pair: string; seed: number; p1: string; p2: string; policySeed: number; over: boolean; winnerSeat: PlayerId | "draw" | null; reason: string | null; moves: number; turn: number; stopKind: DuelResult["stopKind"] | "crashed"; stopped: string | null; trace: string }
type Class = "completed" | "illegal" | "interrupted" | "limited" | "crashed" | "other";
export const classOf = (g: Game): Class => (g.stopKind === "interrupted" ? "interrupted" : g.over ? "completed" : g.stopKind === "illegal" ? "illegal" : g.stopKind === "limit" ? "limited" : g.stopKind === "crashed" ? "crashed" : "other");

export async function bundleFor(defs: Record<string, CardDef>, catalog: CatalogCard[], runtime: string, scripts: ReturnType<typeof programProvenance>["scripts"]): Promise<ReplayBundleRecord> {
  const art: Record<string, { front: string | null; back: string | null }> = {};
  for (const id of Object.keys(defs).sort()) {
    const c = catalog.find((x) => x.id === id)!;
    art[id] = { front: c.imageUrl, back: c.backImageUrl };
  }
  const b = await makeReplayBundle({ defs, scripts, art, rulesetFiles: DBS_FILES, runtime });
  return JSON.parse(JSON.stringify({ ...b, decks: { p1: { name: "", leader: "", main: [] }, p2: { name: "", leader: "", main: [] } } }));
}

async function playGame(bundle: ReplayBundleRecord, runtime: string, a: DeckVerdict, b: DeckVerdict, pair: string, seed: number, policySeed: number, maxMoves: number, attempt?: (value: CorpusAttempt) => void): Promise<Game> {
  const policy = localPolicy();
  const input = (d: DeckVerdict) => ({ name: d.name, leader: d.deck.leader, main: d.deck.main, ...(d.deck.z.length ? { z: d.deck.z } : {}) });
  try {
  const playedBundle = { ...bundle, decks: { p1: input(a), p2: input(b) } } as ReplayBundleRecord;
  const r = await playDuel({ bundle: playedBundle, interpreterRevision: runtime, gameSeed: seed, policySeed, testSeat: "p1", test: policy, baseline: policy, maxMoves });
  attempt?.({ bundle: playedBundle, runtime, seed, policySeed, result: r });
  const winnerSeat = !r.over ? null : r.winner === "draw" ? "draw" : r.winner === "test" ? "p1" : "p2";
  return { pair, seed, p1: a.key, p2: b.key, policySeed, over: r.over, winnerSeat, reason: r.reason, moves: r.moves, turn: r.turn, stopKind: r.stopKind, stopped: r.stopped ? r.stopped.replace(/\s+/g, " ").slice(0, 240) : null, trace: r.trace };
  } catch (error) {
    attempt?.({ bundle, runtime, seed, policySeed, result: null });
    return { pair, seed, p1: a.key, p2: b.key, policySeed, over: false, winnerSeat: null, reason: null, moves: 0, turn: 0, stopKind: "crashed", stopped: String(error).slice(0, 240), trace: "" };
  }
}

export async function freeze(opts: { catalog: { source: { url: string; retrieved: string }; cards: CatalogCard[] }; extra?: Parameters<typeof candidatesFrom>[1]; starters?: boolean; stored?: ExportedRule[] | null; mode?: ProgramMode; runtime: string; pairs: number; maxMoves: number; seedBase: number; catalogPath: string; attempt?: (value: CorpusAttempt) => void }) {
  const { catalog } = opts;
  const verdicts: DeckVerdict[] = [];
  const allDefs: Record<string, CardDef> = {};
  const mode = opts.mode ?? (opts.stored ? "stored" : "compiler");
  const candidates = candidatesFrom(catalog.cards, opts.extra ?? [], opts.starters ?? true);
  for (const c of candidates) for (const id of [c.leader, ...c.main, ...c.z]) {
    const card = catalog.cards.find((row) => row.id === id);
    if (card && !allDefs[id]) allDefs[id] = inspectCard(card, 1).def;
  }
  const provenance = programProvenance(allDefs, mode, opts.stored ?? null);
  for (const c of candidates) {
    const { verdict } = qualify(c, catalog.cards, mode, provenance);
    verdicts.push(verdict);
  }
  const qualified = verdicts.filter((v) => v.qualified);
  const bundle = await bundleFor(allDefs, catalog.cards, opts.runtime, provenance.scripts);
  const games: Game[] = [];
  for (let i = 0; i < qualified.length; i++) {
    for (let j = i; j < qualified.length; j++) {
      const a = qualified[i];
      const b = qualified[j];
      const pair = `${a.key}-${b.key}`;
      for (let k = 0; k < opts.pairs; k++) {
        // One deal (seed), played from both seats: a at p1, then b at p1. A mirror has nothing to swap, so it is played once.
        const seed = opts.seedBase + (i * 31 + j) * 100 + k;
        games.push(await playGame(bundle, opts.runtime, a, b, pair, seed, 7919 + k, opts.maxMoves, opts.attempt));
        if (i !== j) games.push(await playGame(bundle, opts.runtime, b, a, pair, seed, 7919 + k, opts.maxMoves, opts.attempt));
      }
    }
  }
  const tally = (gs: Game[]) => {
    const t: Record<Class, number> = { completed: 0, illegal: 0, interrupted: 0, limited: 0, crashed: 0, other: 0 };
    for (const g of gs) t[classOf(g)]++;
    return { games: gs.length, ...t };
  };
  const decks = verdicts.map((v) => {
    const mine = games.filter((g) => g.p1 === v.key || g.p2 === v.key);
    const t = tally(mine);
    const admitted = v.qualified && t.games > 0 && t.completed === t.games;
    return { ...v, matches: t, admitted, status: admitted ? "admitted" : v.qualified ? "held: play check failed" : "held: not qualified" };
  });
  const pairs = [...new Set(games.map((g) => g.pair))].map((pair) => ({ pair, ...tally(games.filter((g) => g.pair === pair)) }));
  const interruptions = games.filter((g) => classOf(g) !== "completed").map((g) => ({ class: classOf(g), pair: g.pair, seed: g.seed, p1: g.p1, p2: g.p2, policySeed: g.policySeed, detail: g.stopped, regressionPin: "to pin: add this seed/pair to the scenario or policy proof that owns the window" }));
  const body = {
    format: FORMAT,
    mode,
    issue: 897,
    parent: 900,
    engineRevision: opts.runtime,
    versions: { engine: opts.runtime, sourceHead: execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(), engineSourceHash: treeHash("src/lib/arena"), ruleset: bundle.rulesetHash, policy: treeHash("src/lib/arena/policy"), errata: fileHash("src/lib/catalog/errata.ts"), loader: fileHash("src/lib/arena/rules-store.ts"), runner: hashOf([fileHash("scripts/arena-corpus-freeze.mts"), fileHash("scripts/arena-corpus-provenance.mts")]) },
    inputs: { catalogSource: catalog.source, catalogCards: catalog.cards.filter((c) => c.id in allDefs).sort((a, b) => a.id.localeCompare(b.id)), defs: allDefs, ownerSpecifiedCosts: OWNER_SPECIFIED_COSTS, ownerSpecifiedCostsHash: hashOf(OWNER_SPECIFIED_COSTS) },
    programs: { scripts: provenance.scripts, hash: hashOf(provenance.scripts), manifest: provenance.manifest, manifestHash: provenance.manifestHash },
    catalog: { path: opts.catalogPath, url: catalog.source.url, retrieved: catalog.source.retrieved, cardsHash: await replayHash(catalog.cards.filter((c) => c.id in allDefs).sort((a, b) => (a.id < b.id ? -1 : 1))) },
    hashes: { bundle: bundle.hash, ruleset: bundle.rulesetHash, catalog: bundle.catalogHash, programs: bundle.programsHash },
    protocol: { policy: "localPolicy() both seats", seedBase: opts.seedBase, seedPairsPerMatchup: opts.pairs, maxMoves: opts.maxMoves, seats: "each deal played with the decks swapped between p1 and p2 (a mirror once)", ownerSpecifiedCosts: OWNER_SPECIFIED_COSTS_PATH },
    storedRules: { checked: mode === "stored", exactExport: provenance.exports, exactExportHash: provenance.exportsHash, normalizedRows: provenance.rows, normalizedRowsHash: provenance.rowsHash, malformed: provenance.malformed, unexpectedRows: provenance.unexpectedRows },
    qualificationEvidence: "admitted means all scheduled matches completed; semantic skill coverage is not measured",
    measures: { expectedSkills: { total: provenance.manifest.length, meaning: "expected skills on both faces, including native skills" }, fullyParsedSkills: { total: Object.values(allDefs).flatMap((def) => inspectCard(catalog.cards.find((c) => c.id === def.id)!, 1).record.faces.flatMap((face) => face.skills)).filter((s) => s.read && !s.silent && !s.structural).length, denominator: provenance.manifest.length, meaning: "fresh compiler diagnostics only; semantic correctness not established" }, executableSkills: { total: provenance.manifest.filter((s) => s.executable).length, denominator: provenance.manifest.length }, verifiedSemanticCases: "not measured by matches", exercisedSkills: "not measured; deck membership is not execution coverage", humanReview: provenance.manifest.filter((s) => s.requiredRow).map((s) => ({ key: s.key, ...s.humanReview })) },
    evidence: { namedGaps: "#825: historical compiler/application receipts do not prove current exported records; see per-skill provenance", readings: "scripts/arena-readings.mts --silent and arena-deck-audit tiers" },
    decks,
    pairs,
    /** Every game with its explicit seeds and trace hash: replaying a seed must reproduce the trace. */
    games: games.map((g) => ({ ...g, class: classOf(g) })),
    interruptions,
    summary: { candidates: decks.length, qualified: decks.filter((d) => d.qualified).map((d) => d.key), admitted: decks.filter((d) => d.admitted).map((d) => d.key), ...tally(games) },
  };
  return { ...body, hash: await replayHash(body) };
}

async function main() {
  const runtime = flag("--runtime") ?? execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  const catalogPath = flag("--catalog") ?? SNAPSHOT_PATH;
  const catalog = catalogPath === SNAPSHOT_PATH ? loadSnapshot() : (JSON.parse(readFileSync(catalogPath, "utf8")) as ReturnType<typeof loadSnapshot>);
  const extra = flag("--decks") ? JSON.parse(readFileSync(flag("--decks")!, "utf8")) : [];
  const stored = flag("--stored-rules") ? (JSON.parse(readFileSync(flag("--stored-rules")!, "utf8")) as ExportedRule[]) : null;
  const requestedMode = flag("--mode");
  if (requestedMode && !["compiler", "stored"].includes(requestedMode)) throw new Error("--mode must be compiler or stored");
  const opts = {
    mode: requestedMode as ProgramMode | undefined,
    catalog, extra, stored, runtime, catalogPath,
    starters: !process.argv.includes("--starters=false"),
    pairs: Number(flag("--pairs") ?? 3), maxMoves: Number(flag("--max-moves") ?? 3000), seedBase: Number(flag("--seed-base") ?? 897000),
  };
  if (!Number.isInteger(opts.pairs) || opts.pairs < 0 || !Number.isInteger(opts.maxMoves) || opts.maxMoves < 0 || !Number.isSafeInteger(opts.seedBase)) throw new Error("pairs/move limit must be nonnegative integers and seed base a safe integer");
  const manifestPath = flag("--manifest-out");
  if (manifestPath && flag("--out") && resolve(manifestPath) === resolve(flag("--out")!)) throw new Error("Manifest and corpus pack require different output paths.");
  const runner = manifestPath ? evaluationRunnerPin("arena-corpus-freeze", "1") : null;
  const manifest = runner ? corpusManifest(runner, { mode: opts.mode ?? (stored ? "stored" : "compiler"), pairs: opts.pairs, maxMoves: opts.maxMoves, seedBase: opts.seedBase }) : null;
  const pack = await freeze({ ...opts, ...(manifest ? { attempt: manifest.record } : {}) });
  if (process.argv.includes("--check")) {
    const again = await freeze({ ...opts, pairs: 1 });
    for (const game of again.games) {
      const first = pack.games.find((g) => g.pair === game.pair && g.seed === game.seed && g.p1 === game.p1 && g.p2 === game.p2);
      if (!first || canonicalJson(first) !== canonicalJson(game)) throw new Error(`replay differs: ${game.pair}/${game.seed}/${game.p1}/${game.p2}`);
    }
    const replayed = again.decks.map((d) => d.key).join() === pack.decks.map((d) => d.key).join() && again.hashes.bundle === pack.hashes.bundle;
    if (!replayed) throw new Error("two builds of the same inputs disagree on the bundle");
    if (pack.summary.illegal) throw new Error(`${pack.summary.illegal} illegal game(s): ${JSON.stringify(pack.interruptions.filter((i) => i.class === "illegal"))}`);
    if (opts.starters) for (const k of ["A", "B"]) if (!pack.summary.admitted.includes(k)) throw new Error(`starter ${k} is not admitted: ${JSON.stringify(pack.decks.find((d) => d.key === k)?.blockers)}`);
    console.log(`arena-corpus-freeze --check ok: admitted ${pack.summary.admitted.join(",")}; ${pack.summary.completed}/${pack.summary.games} completed, ${pack.summary.illegal} illegal, ${pack.summary.interrupted} interrupted, ${pack.summary.limited} limited`);
  }
  if (manifestPath && manifest && runner) assertSameRunner(runner);
  const out = flag("--out");
  if (out) { writeFileSync(out, canonicalJson(pack) + "\n", "utf8"); console.log(`wrote ${out}`); }
  if (manifestPath && manifest && runner) {
    writeEvidenceFile(manifestPath, JSON.stringify(manifest.finish(), null, 2) + "\n");
    console.log(`wrote allowlisted manifest ${manifestPath}; coverage progress unchanged`);
  }
  const brief = { engineRevision: pack.engineRevision, hash: pack.hash, hashes: pack.hashes, summary: pack.summary, pairs: pack.pairs, decks: pack.decks.map((d) => ({ key: d.key, name: d.name, status: d.status, legality: d.legality.status, blockers: d.blockers, matches: d.matches })), interruptions: pack.interruptions };
  console.log(JSON.stringify(brief, null, 1));
}

function assertSameRunner(before: ReturnType<typeof evaluationRunnerPin>) {
  if (canonicalJson(before) !== canonicalJson(evaluationRunnerPin("arena-corpus-freeze", "1"))) throw new Error("Runner source changed during corpus evaluation; refuse manifest export.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
