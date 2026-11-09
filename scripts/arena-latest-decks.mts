/**
 * The latest Masters releases as playable decks (owner, 9 Nov 2026: "use or build decks from the latest
 * releases, as these have the most complicated game designs and mechanisms per card").
 *
 * The decklists are the prepared, reviewable recipes in `src/lib/arena/testing/prepared-recipes.json`
 * (#827) from BT27 on. The card text comes from a dated subset snapshot of the public deckplanet catalog
 * (only these decks' cards), so games are played offline: no database, no network.
 *
 *   npx tsx scripts/arena-latest-decks.mts --fetch     # read-only GETs of the public catalog; rewrites the snapshot
 *   npx tsx scripts/arena-latest-decks.mts             # offline: resolve, compile, and report per deck
 *   npx tsx scripts/arena-latest-decks.mts --json      # the same, machine-readable
 *
 * As in the #649 audit (`arena-deck-audit.mts`), the cards are compiled from their printed text with the
 * repo's compiler. These are compiler readings, not the stored `card_rules` records (which carry owner
 * corrections), so a game here proves what the engine plays from the text, not what a live game plays.
 * A card the compiler cannot read completely is reported; a deck with one is played anyway, and a game
 * that reaches an unread skill is interrupted, which the report counts.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { cardDefFrom } from "../src/lib/arena/load";
import { compileCard } from "../src/lib/arena/compile";
import { legality, type LegalityCard } from "../src/lib/decks/legality";
import type { CatalogCard } from "../src/lib/catalog/deckplanet";
import type { ReplayBundleRecord } from "../src/lib/arena/replay-core";
import type { DeckInput, PlayerId } from "../src/lib/arena/types";

export const SNAPSHOT = "docs/arena-backlog/evidence/latest-decks/catalog-subset-2026-11-09.json";
const RECIPES = "src/lib/arena/testing/prepared-recipes.json";
const SPECIFIED = "docs/arena-backlog/evidence/655/owner-specified-costs-2026-10-13.json";
/** The latest main-line releases the prepared recipes cover. */
export const LATEST_RELEASES = ["BT27", "BT28", "BT29", "BT30", "BT31"];
/** Runtime revision of these bundles (a stable label, like the #649 audit's). */
export const LATEST_RUNTIME = "b270000000000000000000000000000000000b31";

interface RecipeCard { id: string; name: string; quantity: number; zone: "leader" | "main" | "z" }
export interface Recipe { id: string; name: string; release: string; leaderId: string; leaderName: string; mainCount: number; zCount: number; catalogLegality: string; cards: RecipeCard[] }
interface Snapshot { source: { url: string; retrieved: string; rawRecords: number; note: string }; cards: CatalogCard[] }

export function latestRecipes(): Recipe[] {
  const all = (JSON.parse(readFileSync(RECIPES, "utf8")) as { recipes: Recipe[] }).recipes;
  return all.filter((r) => LATEST_RELEASES.includes(r.release));
}

/** A short key per recipe for fixture names: the release and the Leader's number ("BT31-116" -> "bt31_116"). */
export const keyOf = (r: Recipe) => r.leaderId.toLowerCase().replace("-", "_");

export function loadLatestSnapshot(): Snapshot {
  return JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Snapshot;
}

const specifiedCosts = (): Record<string, string> => (JSON.parse(readFileSync(SPECIFIED, "utf8")) as { specifiedCosts: Record<string, string> }).specifiedCosts;

export interface DeckReport {
  key: string;
  recipe: string;
  release: string;
  leader: string;
  main: number;
  z: number;
  missing: string[];
  legality: { legal: boolean; issues: string[] };
  /** Card faces whose printed text the compiler does not read completely, with the unread clauses. */
  unread: { card: string; face: "front" | "back"; name: string; unread: string[] }[];
}

/** Resolve, compile and check every latest recipe against the snapshot. */
export function reportDecks(snapshot = loadLatestSnapshot()): DeckReport[] {
  const byId = new Map(snapshot.cards.map((c) => [c.id, c]));
  const specified = specifiedCosts();
  return latestRecipes().map((r) => {
    const missing = [r.leaderId, ...r.cards.map((c) => c.id)].filter((id) => !byId.has(id));
    const withLeader: RecipeCard[] = r.cards.some((c) => c.zone === "leader") ? r.cards : [{ id: r.leaderId, name: r.leaderName, quantity: 1, zone: "leader" }, ...r.cards];
    const rows: LegalityCard[] = withLeader.filter((c) => byId.has(c.id)).map((c) => {
      const card = byId.get(c.id)!;
      return { cardId: c.id, zone: c.zone, quantity: c.quantity, name: card.name, cardType: card.cardType, colors: card.colors, limitedTo: card.limitedTo, isBanned: card.isBanned, skill: card.skill, game: "dbs" };
    });
    const lg = legality(rows, "dbs");
    const unread: DeckReport["unread"] = [];
    for (const c of withLeader) {
      const card = byId.get(c.id);
      if (!card) continue;
      const def = cardDefFrom({ ...(card as never as Parameters<typeof cardDefFrom>[0]), specifiedCost: specified[c.id] ?? null });
      for (const face of ["front", "back"] as const) {
        if (face === "back" && !def.back) continue;
        const s = compileCard(def, face);
        if (!s.complete) unread.push({ card: c.id, face, name: card.name, unread: (s.unsupported ?? []).map(String) });
      }
    }
    const issues = lg.issues.filter((i) => i.severity !== "warning").map((i) => i.message);
    return {
      key: keyOf(r), recipe: r.id, release: r.release, leader: `${r.leaderId} ${r.leaderName}`,
      main: r.cards.filter((c) => c.zone === "main").reduce((n, c) => n + c.quantity, 0),
      z: r.cards.filter((c) => c.zone === "z").reduce((n, c) => n + c.quantity, 0),
      missing, legality: { legal: lg.status === "legal", issues }, unread,
    };
  });
}

/** One bundle holding every latest deck's cards, compiled once. */
export async function latestBundle(snapshot = loadLatestSnapshot()): Promise<{ bundle: ReplayBundleRecord; decks: Record<string, DeckInput> }> {
  const [{ makeReplayBundle }, { DBS_FILES }] = await Promise.all([import("../src/lib/arena/replay-core"), import("../src/lib/arena/rulesets/dbs")]);
  const byId = new Map(snapshot.cards.map((c) => [c.id, c]));
  const specified = specifiedCosts();
  const recipes = latestRecipes();
  const ids = [...new Set(recipes.flatMap((r) => [r.leaderId, ...r.cards.map((c) => c.id)]))].filter((id) => byId.has(id)).sort();
  const defs: Record<string, ReturnType<typeof cardDefFrom>> = {};
  const scripts: Record<string, ReturnType<typeof compileCard>> = {};
  const art: Record<string, { front: string | null; back: string | null }> = {};
  for (const id of ids) {
    const card = byId.get(id)!;
    const def = cardDefFrom({ ...(card as never as Parameters<typeof cardDefFrom>[0]), specifiedCost: specified[id] ?? null });
    defs[id] = def;
    scripts[id] = compileCard(def, "front");
    if (def.back) scripts[`${id}#back`] = compileCard(def, "back");
    art[id] = { front: card.imageUrl, back: card.backImageUrl };
  }
  const bundle = (await makeReplayBundle({ defs, scripts, art, rulesetFiles: DBS_FILES, runtime: LATEST_RUNTIME })) as ReplayBundleRecord;
  const decks: Record<string, DeckInput> = {};
  for (const r of recipes) {
    const expand = (z: RecipeCard["zone"]) => r.cards.filter((c) => c.zone === z && byId.has(c.id)).flatMap((c) => Array.from({ length: c.quantity }, () => c.id));
    const z = expand("z");
    decks[keyOf(r)] = { name: r.name, leader: expand("leader")[0] ?? r.leaderId, main: expand("main"), ...(z.length ? { z } : {}) };
  }
  return { bundle: JSON.parse(JSON.stringify(bundle)) as ReplayBundleRecord, decks };
}

/** A fixture for the ordered matchup `p1 v p2` (keys from `keyOf`), named `p1~p2`. */
export async function latestFixture(name: string, cache?: Awaited<ReturnType<typeof latestBundle>>): Promise<{ name: string; bundle: ReplayBundleRecord; revision: string; seed: number }> {
  const [a, b] = name.split("~");
  const built = cache ?? (await latestBundle());
  if (!built.decks[a] || !built.decks[b]) throw new Error(`unknown latest deck in ${name} (known: ${Object.keys(built.decks).join(", ")})`);
  const decks: Record<PlayerId, DeckInput> = { p1: built.decks[a], p2: built.decks[b] };
  return { name, bundle: { ...built.bundle, decks } as ReplayBundleRecord, revision: LATEST_RUNTIME, seed: 0 };
}

async function fetchSnapshot(): Promise<void> {
  const { fetchDeckplanet, shapeCatalog, DECKPLANET_CARDS_URL } = await import("../src/lib/catalog/deckplanet");
  const raw = await fetchDeckplanet("dbs");
  const shaped = shapeCatalog(raw, "dbs");
  const want = new Set(latestRecipes().flatMap((r) => [r.leaderId, ...r.cards.map((c) => c.id)]));
  const cards = shaped.cards.filter((c) => want.has(c.id)).sort((x, y) => (x.id < y.id ? -1 : 1));
  const snap: Snapshot = {
    source: {
      url: DECKPLANET_CARDS_URL,
      retrieved: new Date().toISOString(),
      rawRecords: raw.length,
      note: `Read-only GETs of the public deckplanet Masters catalog, shaped by shapeCatalog (errata.ts applied); only the ${want.size} cards of the BT27+ prepared recipes kept (${cards.length} found).`,
    },
    cards,
  };
  mkdirSync(dirname(SNAPSHOT), { recursive: true });
  writeFileSync(SNAPSHOT, JSON.stringify(snap, null, 1) + "\n");
  console.log(`wrote ${SNAPSHOT}: ${cards.length} of ${want.size} cards (${raw.length} raw records)`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--fetch")) await fetchSnapshot();
  if (!existsSync(SNAPSHOT)) throw new Error(`no snapshot at ${SNAPSHOT}: run with --fetch first`);
  const reports = reportDecks();
  if (process.argv.includes("--json")) console.log(JSON.stringify(reports, null, 1));
  else for (const r of reports) {
    console.log(`${r.key.padEnd(9)} ${r.recipe.padEnd(44)} main ${r.main} z ${r.z} ${r.legality.legal ? "legal" : "ILLEGAL " + r.legality.issues.join("; ")}${r.missing.length ? ` missing ${r.missing.join(",")}` : ""} | unread faces ${r.unread.length}`);
    for (const u of r.unread) console.log(`    ${u.card} ${u.face} ${u.name}: ${u.unread.join(" | ").slice(0, 200)}`);
  }
}
