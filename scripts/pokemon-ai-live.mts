/**
 * `npx tsx scripts/pokemon-ai-live.mts --yes [--only summary,wizard,around,wish,scan1,scan9] [--out <dir>]`
 *
 * A LIVE run of the Pokémon Claude features against real models: deck summary, the wizard, "build
 * around a card", "build from a wish", and the photo read of one card and of a nine-card page. It
 * makes PAID calls (or uses plan usage), so it needs `--yes`, and it is the owner's to ask for
 * (CLAUDE.md, "Paid calls"). It is not in `npm test`.
 *
 * The database is PGlite in memory, seeded here: nothing is read from or written to the app's
 * database. Cards come from the live card source (TCGdex, free). The photos are built from the
 * source's own card scans, so they are clean pictures, not a phone photograph.
 *
 * Providers: the text features run on `AI_PROVIDER` (default: the app's default, `anthropic-api`),
 * or with `--provider openrouter` everything runs on OpenRouter's Claude models (same models, paid);
 * `--scan-provider openrouter` sends the two photo reads to OpenRouter's Claude models, for a
 * session that has no Anthropic key (the plan adapter does not read images).
 *
 * Every result is written as JSON to `--out` (default: a temp directory) and summarised on stdout.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import * as schema from "../src/db/schema.ts";
import { NO_SETTINGS, setSettingsLoader, type AiSettings } from "../src/lib/ai/settings.ts";
import { summariseDeck, runWizard } from "../src/lib/ai/deck.ts";
import { buildDeckAroundCard, buildDeckWithClaude } from "../src/lib/ai/games/build.ts";
import { identifyPokemonCards } from "../src/lib/pokemon/scan.ts";
import { ensurePokemonCard } from "../src/lib/pokemon/store.ts";
import { getDeck } from "../src/lib/decks/queries.ts";
import { pokemonCardId } from "../src/lib/pokemon/types.ts";
import { pgliteDb } from "./verify/ai-games-capture.mts";

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
if (!args.includes("--yes")) {
  console.error("This makes paid model calls. Re-run with --yes.");
  process.exit(2);
}
const only = new Set((flag("only") ?? "summary,wizard,around,wish,scan1,scan9").split(","));
const out = flag("out") ?? fs.mkdtempSync(path.join(os.tmpdir(), "pokemon-ai-live-"));
fs.mkdirSync(out, { recursive: true });
const scanProvider = flag("scan-provider");

// OpenRouter has no tier table of its own: these are the models the app's own tiers name (models.ts).
const OPENROUTER_TIERS = { openrouter: { fast: "anthropic/claude-haiku-4.5", standard: "anthropic/claude-sonnet-5.5", best: "anthropic/claude-opus-5" } };
const settings: AiSettings =
  flag("provider") === "openrouter"
    ? { ...NO_SETTINGS, provider: "openrouter", tiers: OPENROUTER_TIERS }
    : scanProvider === "openrouter"
      ? { ...NO_SETTINGS, taskOverrides: { scan_identify: { provider: "openrouter" } }, tiers: OPENROUTER_TIERS }
      : NO_SETTINGS;
setSettingsLoader(async () => settings);

const OWNER = "Mila";
const db = await pgliteDb();
const save = (name: string, value: unknown) => fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(value, null, 2));

// ── Seed: her cards and one deck, from the live card source ──────────────────
const OWNED: [string, number][] = [
  ["sv03.5-004", 4], ["sv03.5-005", 1], ["sv03.5-006", 1], ["sv03.5-025", 3], ["sv03.5-133", 2], ["sv03.5-143", 1],
  ["sv03.5-001", 2], ["sv03.5-007", 1], ["sv03.5-150", 1], ["sv03.5-094", 1], ["sv03.5-160", 2], ["sv03.5-163", 3], ["sv03.5-164", 1],
];
const DECK: [string, number][] = [
  ["sv03.5-006", 2], ["sv03.5-005", 3], ["sv03.5-004", 4], ["sv03.5-025", 2], ["sv03.5-133", 2], ["sv03.5-143", 2],
  ["sv03.5-160", 4], ["sv03.5-163", 3], ["sv03.5-164", 2],
];
console.log("seeding from the live card source …");
for (const [id, n] of OWNED) {
  const card = await ensurePokemonCard(db, id, { expire: false });
  const print = card.prints.find((p) => p.isBase) ?? card.prints[0];
  await db.insert(schema.ownedCards).values(Array.from({ length: n }, () => ({ printId: print.id, cardId: card.cardId, owner: OWNER, language: "DE" })));
}
const [deck] = await db.insert(schema.decks).values({ name: "Feuerdrachen-Deck", game: "pokemon", format: "expanded", owner: OWNER }).returning({ id: schema.decks.id });
for (const [id, n] of DECK) {
  await ensurePokemonCard(db, id, { expire: false });
  await db.insert(schema.deckCards).values({ deckId: deck.id, cardId: pokemonCardId(id), zone: "main", quantity: n });
}

async function step<T>(name: string, run: () => Promise<T>): Promise<T | null> {
  if (!only.has(name)) return null;
  const t = Date.now();
  try {
    const value = await run();
    save(name, value);
    console.log(`\n== ${name}: ok in ${((Date.now() - t) / 1000).toFixed(1)} s`);
    return value;
  } catch (e) {
    const err = e as Error & { kind?: string; cause?: unknown };
    const why = err.cause instanceof Error ? err.cause.message : undefined;
    save(name, { error: err.message, kind: err.kind, why, stack: err.stack });
    console.log(`\n== ${name}: FAILED in ${((Date.now() - t) / 1000).toFixed(1)} s: ${err.message}${why ? ` (${why})` : ""}`);
    return null;
  }
}

async function deckReport(deckId: number) {
  const d = await getDeck(db, deckId, undefined);
  if (!d) return null;
  return {
    name: d.name, format: d.format, description: d.description,
    legality: { status: d.legality.status, mainCount: d.legality.mainCount, issues: d.legality.issues.map((i) => `${i.severity}: ${i.message}`) },
    cards: d.cards.map((c) => `${c.quantity}× ${c.name} [${c.cardId}] ${c.cardType}`),
  };
}

// ── The text features ────────────────────────────────────────────────────────
await step("summary", async () => (await summariseDeck(db, deck.id)).summary);
await step("wizard", async () => {
  const r = await runWizard(db, deck.id, "any");
  return { assessment: r.assessment, swaps: r.swaps };
});
await step("around", async () => {
  const r = await buildDeckAroundCard("pokemon", pokemonCardId("sv03.5-006"), { db, owner: OWNER, mode: "claude", format: "expanded" });
  return { result: { ...r, legality: undefined }, deck: await deckReport(r.deckId) };
});
await step("wish", async () => {
  const r = await buildDeckWithClaude("pokemon", { wish: "Ich mag Pikachu. Bau mir ein Elektro-Deck mit Pikachu, das im Standard-Format erlaubt ist.", format: "standard" }, { db, owner: OWNER });
  return { result: { ...r, legality: undefined }, deck: await deckReport(r.deckId) };
});

// ── The photo reads ──────────────────────────────────────────────────────────
const scan = async (lang: string, id: string) => {
  const [series, set, no] = [id.split("-")[0].replace(/[0-9.]+$/, ""), id.split("-")[0], id.split("-")[1]];
  const res = await fetch(`https://assets.tcgdex.net/${lang}/${series}/${set}/${no}/high.webp`);
  if (!res.ok) throw new Error(`no picture for ${lang} ${id}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
};
const seenOf = (d: Awaited<ReturnType<typeof identifyPokemonCards>>) =>
  d.detections.map((x) => ({ seen: x.seen, confidence: x.confidence, reason: x.reason, best: x.best ? `${x.best.id} ${x.best.name} ${x.best.localId}/${x.best.setTotal}` : null, candidates: x.candidates.slice(0, 4).map((c) => `${c.id} ${c.name}`) }));

await step("scan1", async () => {
  const photo = await sharp(await scan("de", "sv03.5-006")).jpeg({ quality: 88 }).toBuffer();
  fs.writeFileSync(path.join(out, "scan1.jpg"), photo);
  const r = await identifyPokemonCards(db, photo, "single");
  return { truth: ["PKM-sv03.5-006 (German Glurak-ex 006/165, MEW)"], unreadable: r.unreadable, detections: seenOf(r) };
});
const PAGE: [string, string][] = [["de", "sv03.5-001"], ["de", "sv03.5-004"], ["en", "sv03.5-005"], ["de", "sv03.5-025"], ["en", "sv03.5-133"], ["de", "sv03.5-143"], ["de", "sv03.5-150"], ["en", "sv03.5-094"], ["de", "sv03.5-163"]];
await step("scan9", async () => {
  const W = 480, H = 670, G = 26;
  const tiles = await Promise.all(PAGE.map(async ([l, id]) => sharp(await scan(l, id)).resize(W, H, { fit: "fill" }).toBuffer()));
  const photo = await sharp({ create: { width: 3 * W + 4 * G, height: 3 * H + 4 * G, channels: 3, background: "#2b2f36" } })
    .composite(tiles.map((input, i) => ({ input, left: G + (i % 3) * (W + G), top: G + Math.floor(i / 3) * (H + G) })))
    .jpeg({ quality: 86 }).toBuffer();
  fs.writeFileSync(path.join(out, "scan9.jpg"), photo);
  const r = await identifyPokemonCards(db, photo, "batch");
  return { truth: PAGE.map(([l, id]) => `PKM-${id} (${l})`), unreadable: r.unreadable, detections: seenOf(r) };
});

// ── What it cost ─────────────────────────────────────────────────────────────
const runs = await db.select().from(schema.aiRuns).orderBy(schema.aiRuns.id);
save("runs", runs.map((r) => ({ kind: r.kind, provider: r.provider, model: r.model, billed: r.billed, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costMicros: r.costMicros, input: r.input })));
console.log("\nruns:");
for (const r of runs) console.log(`  ${r.kind.padEnd(15)} ${String(r.provider).padEnd(20)} ${String(r.model).padEnd(28)} in=${r.inputTokens} out=${r.outputTokens} billed=${r.billed} cost=${r.costMicros != null ? (Number(r.costMicros) / 1e6).toFixed(4) : "?"} USD`);
console.log(`\nresults in ${out}`);
process.exit(0);
