/**
 * Build the offline deck pack for the two audited Masters decks (#655, plan O4-02).
 * Build-time only: it reads the committed catalog snapshot of #649
 * (`docs/arena-backlog/evidence/649/catalog-subset-2026-10-13.json`), the repo's
 * ruleset files and the repo's compiler. No database, no network, no provider.
 * The portable half — types, validation, qualification, instantiation — is
 * `src/lib/arena/local/pack.ts`; a runtime never compiles card text or fetches
 * a definition, it only reads what this script pinned.
 *
 *   npx tsx scripts/build-arena-offline-pack.mts                      # summary: hashes, size, qualification
 *   npx tsx scripts/build-arena-offline-pack.mts --check              # build twice, assert identical hashes + valid
 *   npx tsx scripts/build-arena-offline-pack.mts --out pack.json      # write the pack (canonical JSON)
 *   npx tsx scripts/build-arena-offline-pack.mts --runtime <sha>      # pin another interpreter revision (default: git HEAD)
 *   npx tsx scripts/build-arena-offline-pack.mts --specified-costs f.json
 *        # {"SD15-02":"{r}{r}", ...}: overrides the owner's `cards.specified_cost` values for the Unison cards (U7).
 *        # Default: OWNER_SPECIFIED_COSTS_PATH (owner ruling of 13 Oct 2026, migration 0049 / PR #733). An
 *        # empty object makes the pack record the Unison cards as missing inputs again.
 *
 * The blocker register below is the audit's (`docs/arena-offline-deck-audit.md` §8);
 * `scripts/verify/arena-offline-pack.mts` fails when the two disagree.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { DECKS, auditDecks, loadSnapshot, resolveDeck, UNOWNED, type DeckSpec } from "./arena-deck-audit.mts";
import { cardDefFrom } from "../src/lib/arena/load";
import { compileCard } from "../src/lib/arena/compile";
import { DBS_FILES } from "../src/lib/arena/rulesets/dbs";
import { canonicalJson, replayHash } from "../src/lib/arena/replay-core";
import {
  ISSUE_URL, makeOfflinePack, validateOfflinePack,
  type BlockerStatus, type MakeOfflinePackInput, type MissingInput, type OfflinePack, type PackBlocker, type PackDeck, type PackDependency,
} from "../src/lib/arena/local/pack";
import type { CardDef } from "../src/lib/arena/types";
import type { CardScripts } from "../src/lib/arena/vm/script";
import type { CardArt } from "../src/lib/arena/view";
import type { CatalogCard } from "../src/lib/catalog/deckplanet";

export const SNAPSHOT_PATH = "docs/arena-backlog/evidence/649/catalog-subset-2026-10-13.json";
export const AUDIT_PATH = "docs/arena-offline-deck-audit.md";
export const OWNER_SPECIFIED_COSTS_PATH = "docs/arena-backlog/evidence/655/owner-specified-costs-2026-10-13.json";
/** The owner's `cards.specified_cost` values (U7), as committed; `--specified-costs` overrides them. */
export const OWNER_SPECIFIED_COSTS: Record<string, string> = (JSON.parse(readFileSync(OWNER_SPECIFIED_COSTS_PATH, "utf8")) as { specifiedCosts: Record<string, string> }).specifiedCosts;
export const PACK_ID = "masters-sd15-vs-sd5";

/**
 * Generated or token cards a deck card can bring into play from outside its
 * decklist. The audit found none for these decks (§4 "Generated and token
 * dependencies"); `tokenWording` below refuses to build if card text starts
 * naming one without an entry here.
 */
export const DEPENDENCIES: PackDependency[] = [];
const TOKEN_WORDING = /\btokens?\b|\bgenerate[sd]?\b|\bZ-?Deck\b|\bZ-?(Card|Leader|Extra|Battle)s?\b/i;

const link = (issue: number) => ({ issue, url: `${ISSUE_URL}${issue}` });

interface BlockerSpec { id: string; decks: string[]; cards: string[] | ((cards: CatalogCard[]) => string[]); issues: number[]; status: BlockerStatus; summary?: string }

/**
 * The audit's blocker register (§8), with the decks and cards it names (deck A
 * is the owner-amended list of 13 Oct 2026, so there is no legality-decision blocker). U7's
 * status is computed: resolved when every Unison card carries the owner's
 * specified cost (it does by default since 13 Oct 2026).
 */
export const BLOCKERS: BlockerSpec[] = [
  { id: "U1", decks: ["A", "B"], cards: [], issues: [650, 651, 661, 655], status: "open" },
  { id: "U2", decks: ["A"], cards: ["SD15-01"], issues: [728], status: "resolved" },
  { id: "U3", decks: ["A"], cards: ["SD15-01", "SD15-03"], issues: [728, 549], status: "resolved" },
  { id: "U4", decks: ["B"], cards: ["BT4-079"], issues: [729], status: "resolved" },
  { id: "U5", decks: ["A"], cards: ["BT5-023", "BT6-026", "BT10-008"], issues: [716], status: "resolved" },
  { id: "U6", decks: ["B"], cards: (cards) => cards.filter((c) => /\[Swap/i.test(c.skill ?? "")).map((c) => c.id), issues: [731], status: "resolved" },
  { id: "U7", decks: ["A"], cards: ["SD15-02", "DB3-001"], issues: [655], status: "missing-input" },
  { id: "U8", decks: ["A"], cards: ["SD15-05"], issues: [730], status: "open" },
];

export interface BuildOptions {
  runtimeRevision: string;
  /** The owner's `cards.specified_cost` text by card id (`{r}{r}`); defaults to OWNER_SPECIFIED_COSTS. */
  specifiedCosts?: Record<string, string>;
}

function deckInput(spec: DeckSpec, catalog: CatalogCard[]) {
  const { rows, problems } = resolveDeck(spec, catalog);
  if (problems.length) throw new Error(`deck ${spec.key} does not resolve: ${problems.join("; ")}`);
  const expand = (zone: "leader" | "main" | "z") => rows.filter((r) => r.zone === zone).flatMap((r) => Array.from({ length: r.quantity }, () => r.card.id));
  const z = expand("z");
  return { rows, deck: { name: spec.name, leader: expand("leader")[0], main: expand("main"), ...(z.length ? { z } : {}) } };
}

/** Everything `makeOfflinePack` needs, compiled from the snapshot. Exported so the proof can alter a copy. */
export async function mastersPackInput(options: BuildOptions): Promise<MakeOfflinePackInput> {
  const snapshot = loadSnapshot();
  const catalog = snapshot.cards;
  const audits = auditDecks(catalog);
  const decks: PackDeck[] = [];
  const cards = new Map<string, CatalogCard>();
  for (const spec of DECKS) {
    const { rows, deck } = deckInput(spec, catalog);
    for (const r of rows) cards.set(r.card.id, r.card);
    const lg = audits.find((a) => a.spec.key === spec.key)!.legality;
    decks.push({
      key: spec.key,
      name: spec.name,
      source: spec.source,
      deck,
      legality: {
        status: lg.status,
        illegal: lg.issues.filter((i) => i.severity === "illegal").map((i) => i.message),
        warnings: lg.issues.filter((i) => i.severity === "warning").map((i) => i.message),
      },
    });
  }

  for (const c of cards.values()) {
    const text = `${c.skill ?? ""}\n${c.backSkill ?? ""}`;
    if (TOKEN_WORDING.test(text) && !DEPENDENCIES.some((d) => d.from === c.id)) {
      throw new Error(`${c.id} names a token or generated card; pin it in DEPENDENCIES before building`);
    }
  }

  const defs: Record<string, CardDef> = {};
  const scripts: Record<string, CardScripts> = {};
  const art: Record<string, CardArt> = {};
  for (const id of [...cards.keys()].sort()) {
    const c = cards.get(id)!;
    const def = cardDefFrom({ ...(c as never as Parameters<typeof cardDefFrom>[0]), specifiedCost: (options.specifiedCosts ?? OWNER_SPECIFIED_COSTS)[id] ?? null });
    defs[id] = def;
    scripts[id] = compileCard(def, "front");
    if (def.back) scripts[`${id}#back`] = compileCard(def, "back");
    art[id] = { front: c.imageUrl, back: def.back ? c.backImageUrl : null };
  }

  const missingInputs: MissingInput[] = Object.values(defs)
    .filter((d) => d.type === "UNISON" && !d.specifiedCost)
    .map((d) => ({ card: d.id, field: "specifiedCost" as const, source: "cards.specified_cost (owner's database; the public feed has none)", blocker: "U7" }));

  const cardsOfDecks = (keys: string[]) =>
    [...new Set(decks.filter((d) => keys.includes(d.key)).flatMap((d) => [d.deck.leader, ...d.deck.main]))].map((id) => cards.get(id)!);
  const blockers: PackBlocker[] = BLOCKERS.map((b) => ({
    id: b.id,
    summary: b.summary ?? UNOWNED[b.id],
    decks: b.decks,
    cards: typeof b.cards === "function" ? b.cards(cardsOfDecks(b.decks)).sort() : b.cards,
    issues: b.issues.map(link),
    status: b.id === "U7" ? (missingInputs.length ? "missing-input" : "resolved") : b.status,
  }));
  for (const b of blockers) if (!b.summary) throw new Error(`blocker ${b.id} has no summary`);

  return {
    id: PACK_ID,
    defs,
    scripts,
    art,
    rulesetFiles: DBS_FILES,
    runtimeRevision: options.runtimeRevision,
    source: {
      catalog: { path: SNAPSHOT_PATH, url: snapshot.source.url, retrieved: snapshot.source.retrieved, cardsHash: await replayHash(snapshot.cards) },
      audit: AUDIT_PATH,
    },
    decks,
    dependencies: DEPENDENCIES,
    missingInputs,
    blockers,
  };
}

export async function buildMastersPack(options: BuildOptions): Promise<OfflinePack> {
  return makeOfflinePack(await mastersPackInput(options));
}

/** The figures a run reports: every hash and the pack's size. */
export function packSummary(pack: OfflinePack) {
  const bytes = new TextEncoder().encode(canonicalJson(pack)).length;
  return {
    id: pack.id,
    hash: pack.hash,
    bundleHash: pack.bundle.hash,
    rulesetHash: pack.bundle.rulesetHash,
    catalogHash: pack.bundle.catalogHash,
    programsHash: pack.bundle.programsHash,
    runtimeRevision: pack.compatibility.runtimeRevision,
    bytes,
    cards: pack.manifest.cards.length,
    programs: Object.keys(pack.bundle.payload.scripts).length,
    rulesetFiles: pack.manifest.rulesetFiles.length,
    decks: pack.decks.map((d) => `${d.key} ${d.name}: ${d.deck.main.length} main, legality ${d.legality.status}`),
    missingInputs: pack.missingInputs.map((m) => `${m.card}.${m.field}`),
    playable: pack.qualification.playable,
    reasons: pack.qualification.reasons,
  };
}

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const runtimeRevision = flag("--runtime") ?? execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  const costsFile = flag("--specified-costs");
  const specifiedCosts = costsFile ? (JSON.parse(readFileSync(costsFile, "utf8")) as Record<string, string>) : undefined;
  const pack = await buildMastersPack({ runtimeRevision, specifiedCosts });
  if (process.argv.includes("--check")) {
    const again = await buildMastersPack({ runtimeRevision, specifiedCosts });
    if (again.hash !== pack.hash || canonicalJson(again) !== canonicalJson(pack)) throw new Error("two builds of the same inputs differ");
    const valid = await validateOfflinePack(JSON.parse(JSON.stringify(pack)));
    if (!valid.ok) throw new Error(`the pack does not validate: ${valid.errors.join("; ")}`);
    console.log(`build-arena-offline-pack --check ok: two builds agree on ${pack.hash}`);
  }
  const out = flag("--out");
  if (out) {
    writeFileSync(out, canonicalJson(pack) + "\n", "utf8");
    console.log(`wrote ${out}`);
  }
  console.log(JSON.stringify(packSummary(pack), null, 1));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
