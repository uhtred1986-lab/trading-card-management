/**
 * Lane I of docs/pokemon/plan.md: the game-neutral Claude layer (`src/lib/ai/games/`). No model is
 * ever called: requests are read off a recorded transport or a scripted fake provider, TCGdex answers
 * come from the recorded responses in `fixtures/pokemon/` through a stubbed `fetch`, and the database
 * is PGlite.
 *
 * 1. Dragon Ball equality: the requests the Dragon Ball features send (summary, wizard, set review,
 *    "Build a deck with Claude", deck from a card), the `ai_runs` rows and the decks they create are
 *    compared with `fixtures/ai-games/dragonball-requests.json`, recorded by `ai-games-capture.mts` on
 *    the base commit before the layer existed. Equal byte for byte, both games.
 * 2. The adapters: rules text, answer language, card description, the lookup tools.
 * 3. The lookup loop on a scripted provider.
 * 4. Pokémon: wizard, "build with Claude" (validation, creation with `ensurePokemonCard`), cleaning of
 *    a draft, and the deterministic draft around a card.
 */
import assert from "node:assert/strict";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import * as schema from "../../src/db/schema.ts";
import type { Db } from "../../src/db/index.ts";
import { AiError } from "../../src/lib/ai/errors.ts";
import { generateWithLookups } from "../../src/lib/ai/tools.ts";
import { createFakeProvider } from "../../src/lib/ai/providers/fake.ts";
import { registerProvider, resetProviders } from "../../src/lib/ai/providers/index.ts";
import { GAME_INFO } from "../../src/lib/catalog/games.ts";
import { adapterFor } from "../../src/lib/ai/games/registry.ts";
import { answerLanguageLine } from "../../src/lib/ai/games/language.ts";
import { describePokemonCard, liveSource, pokemonLookupTools, tcgdexIdFromArg } from "../../src/lib/ai/games/pokemon-source.ts";
import { pokemonAdapter, pokemonRulesText, type PokemonDeps } from "../../src/lib/ai/games/pokemon.ts";
import { cleanPokemonDraft, normaliseCardId, type KnownCard } from "../../src/lib/ai/games/pokemon-build.ts";
import { buildDeckAroundCard, buildDeckWithClaude, hasFreeDraft } from "../../src/lib/ai/games/build.ts";
import { DECK_AI_LABELS_DE, NEW_DECK_FROM_CARD_LABELS_DE, NEW_DECK_WITH_CLAUDE_LABELS_DE } from "../../src/lib/ai/games/labels-de.ts";
import { DECK_AI_LABELS_EN, NEW_DECK_FROM_CARD_LABELS_EN, NEW_DECK_WITH_CLAUDE_LABELS_EN } from "../../src/lib/ai/games/labels.ts";
import { ensurePokemonCard } from "../../src/lib/pokemon/store.ts";
import { recordFromTcgdex, type PokemonCardRecord, type TcgdexCard } from "../../src/lib/pokemon/tcgdex.ts";
import { legality } from "../../src/lib/decks/legality.ts";
import { captureDragonBallRequests, pgliteDb, seed } from "./ai-games-capture.mts";

// ── 1. Dragon Ball: the same requests as before the layer ────────────────────

const recorded = JSON.parse(fs.readFileSync(path.resolve("scripts/verify/fixtures/ai-games/dragonball-requests.json"), "utf8")) as Record<string, Record<string, unknown>>;
const now = (await captureDragonBallRequests()) as Record<string, Record<string, unknown>>;
for (const game of ["dbs", "fusion"]) {
  for (const key of Object.keys(recorded[game])) {
    assert.deepStrictEqual(now[game][key], recorded[game][key], `${game}/${key}: the request, run record or created deck differs from the one recorded on the base commit`);
  }
  assert.deepStrictEqual(Object.keys(now[game]), Object.keys(recorded[game]), `${game}: the same things were recorded`);
  const wires = ["summary", "wizard", "wizardOwned", "setReview", "builder", "fromCard"].flatMap((k) => (now[game][k] as { wire: { body: Record<string, unknown> }[] }).wire);
  assert.equal(wires.length, 6, `${game}: one request per feature, no lookup rounds`);
  for (const w of wires) {
    assert.equal(w.body.tools, undefined, `${game}: no tools are offered to a Dragon Ball model`);
    assert.ok(!JSON.stringify(w.body.system).includes("German"), `${game}: no answer-language line for an English game`);
  }
}
console.log("ai-games: Dragon Ball requests, runs and decks equal the base commit's (dbs and fusion)");

// ── 2. The adapters ──────────────────────────────────────────────────────────

assert.equal(answerLanguageLine("dbs"), null);
assert.equal(answerLanguageLine("fusion"), null);
assert.match(answerLanguageLine("pokemon") ?? "", /German/);
assert.match(answerLanguageLine("pokemon") ?? "", /12-year-old/);
for (const g of ["dbs", "fusion", "pokemon"] as const) {
  const a = adapterFor(g);
  assert.equal(a.promptName, GAME_INFO[g].promptName);
  assert.equal(a.lang, GAME_INFO[g].uiLang);
  assert.ok(a.analystSystem().includes(GAME_INFO[g].promptName));
  assert.equal(a.analystSystem().includes("German"), GAME_INFO[g].uiLang === "de", `${g}: the language line follows uiLang`);
}
assert.equal(adapterFor("nonsense").game, "dbs", "an unknown game is Dragon Ball, as gameOr does everywhere");
assert.ok(hasFreeDraft("pokemon") && !hasFreeDraft("dbs") && !hasFreeDraft("fusion"));

const rules = pokemonRulesText({ format: "expanded" });
for (const part of ["exactly 60 cards", "no Leader and no Z-Deck", "at most 4 cards with the same NAME", "basic Energy cards are unlimited", "ACE SPEC", "Radiant", "at least one Basic Pokémon", "Expanded", "flagged, never blocked"]) {
  assert.ok(rules.includes(part), `Pokémon rules text says: ${part}`);
}
assert.match(pokemonRulesText(), /format is Standard/, "no format means the game's default");
assert.match(adapterFor("pokemon").analystSystem({ format: "expanded" }), /format is Expanded/);
assert.match(adapterFor("fusion").rulesText(), /no Z-Deck at all/);
assert.match(adapterFor("dbs").rulesText(), /Z-Deck of up to 10/);

// Labels: the English sets are what the Dragon Ball screens showed; the German sets cover the same keys.
for (const [en, de] of [[NEW_DECK_WITH_CLAUDE_LABELS_EN, NEW_DECK_WITH_CLAUDE_LABELS_DE], [NEW_DECK_FROM_CARD_LABELS_EN, NEW_DECK_FROM_CARD_LABELS_DE], [DECK_AI_LABELS_EN, DECK_AI_LABELS_DE]] as const) {
  assert.deepEqual(Object.keys(de).sort(), Object.keys(en).sort(), "German labels cover every English label");
}
assert.equal(NEW_DECK_WITH_CLAUDE_LABELS_EN.gameNames.dbs, "Masters", "the Masters option keeps its name");
assert.equal(DECK_AI_LABELS_EN.presets.length, 6);

// ── The TCGdex stub (recorded responses) ─────────────────────────────────────

const FIX = path.resolve("scripts/verify/fixtures/pokemon");
const exists = (f: string) => fs.existsSync(path.join(FIX, f));
const fixture = <T,>(f: string): T => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8")) as T;
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fetched: URL[] = [];
let outage = false;
/** Per test: a card's legality as the source says it. */
const legalOverride = new Map<string, { standard: boolean; expanded: boolean }>();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  assert.equal(url.origin, "https://api.tcgdex.net", "only TCGdex is ever called");
  fetched.push(url);
  if (outage) return respond({ error: "down" }, 503);
  const [, , lang, kind, rest] = url.pathname.split("/");
  const p = url.searchParams;
  if (kind === "cards" && rest) {
    const id = decodeURIComponent(rest);
    if (!exists(`card-${id}.${lang}.json`)) return respond({ error: "not found" }, 404);
    const card = fixture<TcgdexCard>(`card-${id}.${lang}.json`);
    const o = legalOverride.get(id);
    return respond(o ? { ...card, legal: o } : card);
  }
  if (kind === "cards" && p.get("evolveFrom")) {
    const name = p.get("evolveFrom")!.replace(/^eq:/, "").toLowerCase();
    return respond(exists(`evolve-${name}.json`) ? fixture(`evolve-${name}.json`) : []);
  }
  if (kind === "cards") {
    const name = p.get("name")?.toLowerCase().replace(/\s+/g, "-");
    const set = p.get("set.id")?.replace("eq:", "");
    const file = name ? `list-${lang}-${name}${set ? `-${set}` : ""}.json` : null;
    return respond(file && exists(file) ? fixture(file) : []);
  }
  if (kind === "sets" && rest) return exists(`set-${decodeURIComponent(rest)}.${lang}.json`) ? respond(fixture(`set-${decodeURIComponent(rest)}.${lang}.json`)) : respond({ error: "not found" }, 404);
  if (kind === "sets") return respond(fixture(`sets-${lang}.json`));
  if (kind === "series" && !rest) return respond(fixture("series-de.json"));
  if (kind === "series") return exists(`series-${rest}.de.json`) ? respond(fixture(`series-${rest}.de.json`)) : respond({ id: rest, sets: [] });
  return respond({ error: "unexpected" }, 500);
}) as typeof fetch;
const calls = () => fetched.splice(0, fetched.length);

const record = (id: string): PokemonCardRecord => recordFromTcgdex(fixture<TcgdexCard>(`card-${id}.de.json`), fixture<TcgdexCard>(`card-${id}.en.json`));

// ── Describing a card and the lookup tools ───────────────────────────────────

const glurak = record("sv03.5-006");
const line = describePokemonCard({ id: glurak.hit.id, name: glurak.hit.name, cardType: glurak.category, colors: glurak.hit.types, energyCost: null, power: null, skill: glurak.skillText, details: glurak.details });
for (const part of ["PKM-sv03.5-006", "Glurak-ex / Charizard ex", "POKEMON", "Feuer", "HP 330", "Rang 2 (Stage2)", "evolves from Charmeleon", "Tapfere Flügel", "Explosiver Wirbel", "Standard no, Expanded yes", "mark G"]) {
  assert.ok(line.includes(part), `the Pokémon card line says ${part}: ${line}`);
}
const energyLine = describePokemonCard({ id: "PKM-sve-002", name: "Feuer-Energie", cardType: "ENERGY", colors: [], energyCost: null, power: null, skill: null, details: record("sve-002").details });
assert.ok(energyLine.includes("basic Energy") && energyLine.includes("Feuer-Energie / Fire Energy"), energyLine);
assert.ok(describePokemonCard({ id: "x", name: "Plain", cardType: "TRAINER", colors: [], energyCost: null, power: null, skill: "Draw 3 cards.", details: null }).endsWith("Draw 3 cards."), "a card with no details still describes (name, type, text)");

assert.equal(tcgdexIdFromArg("PKM-sv03.5-006"), "sv03.5-006");
assert.equal(tcgdexIdFromArg("PKM-sv03.5-006_holo"), "sv03.5-006");
assert.equal(tcgdexIdFromArg("sv03.5-006"), "sv03.5-006");
assert.equal(tcgdexIdFromArg(" "), null);
assert.equal(normaliseCardId("PKM-sv03.5-006_holo"), "PKM-sv03.5-006");
assert.equal(normaliseCardId("sv03.5-006"), "PKM-sv03.5-006");
assert.equal(normaliseCardId("BT18-020"), "PKM-BT18-020", "a Bandai number is not an id this game knows; it is dropped later as unknown");
assert.equal(normaliseCardId("???"), null);

const tools = Object.fromEntries(pokemonLookupTools(liveSource).map((t) => [t.name, t]));
assert.deepEqual(Object.keys(tools), ["search_cards", "evolves_from", "get_card"]);
const args = (a: Partial<{ name: string; type: string; category: string; id: string }>) => ({ name: null, type: null, category: null, id: null, ...a });
calls();
const found = await tools.search_cards.run(args({ name: "Glurak" }));
assert.ok(found.includes("PKM-sv03.5-006") && found.includes("Glurak-ex"), found);
assert.ok(calls().some((u) => u.pathname.endsWith("/cards") && u.searchParams.get("name") === "Glurak"), "a search reads the live card list by name");
assert.match(await tools.search_cards.run(args({ name: "gibt-es-nicht" })), /No cards found/);
const detail = await tools.get_card.run(args({ id: "PKM-sv03.5-006" }));
assert.ok(detail.includes("HP 330") && detail.includes("evolves from Charmeleon"), detail);
assert.match(await tools.get_card.run(args({ id: "PKM-nope-1" })), /No such card/);
assert.match(await tools.get_card.run(args({})), /Give a card id/);
const evolves = await tools.evolves_from.run(args({ name: "Charmander" }));
assert.ok(evolves.includes("Charmeleon: PKM-sv03.5-005, PKM-sv04.5-008, PKM-sv03-027"), evolves);
assert.match(await tools.evolves_from.run(args({ name: "Nothingmon" })), /Nothing evolves/);
outage = true;
assert.match(await tools.search_cards.run(args({ name: "Glurak" })), /not reachable/, "a source that is down answers in words, never throws");
assert.match(await tools.evolves_from.run(args({ name: "Charmander" })), /not reachable/);
outage = false;
console.log("ai-games: adapter rules, language, card description and the three lookup tools");

// ── 3. The lookup loop on a scripted provider ────────────────────────────────

const lookup = (tool: string, a: Partial<{ name: string; id: string }>) => ({ tool, name: null, type: null, category: null, id: null, ...a });
const answerSchema = (await import("zod")).z.object({ pick: (await import("zod")).z.string() });
{
  const fake = createFakeProvider({
    id: "anthropic-api",
    script: [
      { json: { lookups: [lookup("search_cards", { name: "Glurak" })], answer: null }, usage: { input: 100, output: 10 } },
      { json: { lookups: [lookup("get_card", { id: "PKM-sv03.5-006" }), lookup("get_card", { id: "PKM-nope-1" })], answer: null }, usage: { input: 150, output: 12 } },
      { json: { lookups: [], answer: { pick: "PKM-sv03.5-006" } }, usage: { input: 200, output: 14 } },
    ],
  });
  registerProvider(fake);
  const res = await generateWithLookups(
    { task: "deck_wizard", tier: "best", maxTokens: 1000, schema: answerSchema, system: [{ text: "RULES" }, { text: "POOL", cache: "short" }], messages: [{ role: "user", parts: [{ type: "text", text: "go" }] }] },
    pokemonLookupTools(liveSource),
  );
  assert.deepEqual(res.parsed, { pick: "PKM-sv03.5-006" }, "the answer is unwrapped");
  assert.equal(res.rounds, 2);
  assert.deepEqual(res.usage, { input: 450, output: 36, cacheRead: 0, cacheWrite: 0 }, "usage of every round is summed, so one ledger row bills the run");
  assert.deepEqual(res.lookupLog.map((l) => l.tool), ["search_cards", "get_card", "get_card"]);
  assert.equal(fake.requests.length, 3);
  const first = fake.requests[0];
  assert.deepEqual(first.system.map((s) => s.text.slice(0, 5)), ["RULES", "You c", "POOL"], "the lookup instructions sit between the rules and the cached pool");
  assert.equal(first.system[2].cache, "short", "the pool stays the cached tail");
  for (const t of ["search_cards", "evolves_from", "get_card"]) assert.ok(first.system[1].text.includes(`- ${t}:`), `the instructions describe ${t}`);
  assert.equal(first.messages.length, 1);
  const third = fake.requests[2].messages;
  assert.equal(third.length, 5, "question, answer, results, answer, results");
  assert.ok((third[2].parts[0] as { text: string }).text.startsWith("LOOKUP RESULTS:\n[1] search_cards("), "results go back as the next user turn");
  assert.ok((third[4].parts[0] as { text: string }).text.includes("No such card."));
  assert.ok((third[4].parts[0] as { text: string }).text.includes("HP 330"));
  resetProviders();
}
{
  // A model that never stops looking is cut off with a typed error, not a loop.
  const fake = createFakeProvider({ id: "anthropic-api", script: [{ json: { lookups: [lookup("search_cards", { name: "Glurak" })], answer: null } }] });
  registerProvider(fake);
  await assert.rejects(
    generateWithLookups({ task: "deck_wizard", tier: "best", maxTokens: 1000, schema: answerSchema, system: [{ text: "RULES" }], messages: [{ role: "user", parts: [{ type: "text", text: "go" }] }] }, pokemonLookupTools(liveSource), { maxRounds: 2 }),
    (e) => e instanceof AiError && e.kind === "bad_output",
  );
  assert.equal(fake.requests.length, 3, "two lookup rounds, then the forced answer round, then it stops");
  resetProviders();
}
console.log("ai-games: the lookup loop (rounds, summed usage, cache order, cut-off)");

// ── 4. Pokémon on PGlite ─────────────────────────────────────────────────────

const db: Db = await pgliteDb();
const ensured = async (id: string, owned = 0, owner: string | null = "anna") => {
  const e = await ensurePokemonCard(db, id, { record: record(id), set: null, expire: false });
  if (owned) await db.insert(schema.ownedCards).values(Array.from({ length: owned }, () => ({ printId: e.prints[0].id, cardId: e.cardId, owner })));
  return e;
};
/** A hand-made stored card, for what the fixtures do not cover (Trainers). */
async function plainCard(id: string, name: string, cardType: string, details: Record<string, unknown>, skill: string | null, owned = 0, owner: string | null = "anna") {
  await db.insert(schema.cardSets).values({ code: "PKM-test", name: "Test", game: "pokemon", line: "pokemon", sortKey: 1 }).onConflictDoNothing();
  await db.insert(schema.cards).values({ id, setCode: "PKM-test", game: "pokemon", name, cardType, colors: [], rarity: "Uncommon", rarityCode: "Uncommon", skill, details, searchText: name.toLowerCase() });
  await db.insert(schema.cardPrints).values({ id, cardId: id, suffix: "", label: "Normal", rarity: "Uncommon", isBase: true });
  if (owned) await db.insert(schema.ownedCards).values(Array.from({ length: owned }, () => ({ printId: id, cardId: id, owner })));
}
const trainerDetails = (over: Record<string, unknown> = {}) => ({ names: {}, stage: "Item", basicEnergy: false, onePerDeck: null, legal: { standard: true, expanded: true }, attacks: [], abilities: [], display: { types: [], stage: "Item", rarity: null }, ...over });

// What the stubbed writer was asked to store.
const stored: string[] = [];
const deps: PokemonDeps = {
  source: liveSource,
  ensure: async (d, id, opts) => {
    stored.push(id);
    return ensurePokemonCard(d, id, { ...opts, set: null, expire: false });
  },
};

// A Pokémon deck the viewer "anna" owns: Charmander and Charizard ex stored, one Trainer owned outside the deck.
const charmander = await ensured("sv03.5-004", 4);
const charizard = await ensured("sv03.5-006", 1);
const fireEnergy = await ensured("sve-002", 0);
await plainCard("PKM-test-001", "Bonbon", "TRAINER", trainerDetails({ names: { de: "Bonbon", en: "Rare Candy" } }), "Entwickle ein Pokémon.", 3);
await plainCard("PKM-test-002", "Alter Ball", "TRAINER", trainerDetails({ legal: { standard: false, expanded: false } }), "Verboten.", 4);
await plainCard("PKM-test-003", "Zauberkappe", "TRAINER", trainerDetails({ onePerDeck: "ace-spec" }), "ACE SPEC.", 2);
await plainCard("PKM-test-004", "Bobs Karte", "TRAINER", trainerDetails({ names: { en: "Bob Card" } }), "Gehört Bob.", 4, "bob");
const [deck] = await db.insert(schema.decks).values({ name: "Annas Feuer", game: "pokemon", format: "standard", owner: "anna", metaNotes: "Spiele oft gegen Wasser." }).returning({ id: schema.decks.id });
await db.insert(schema.deckCards).values([
  { deckId: deck.id, cardId: charmander.cardId, zone: "main", quantity: 4 },
  { deckId: deck.id, cardId: charizard.cardId, zone: "main", quantity: 2 },
  { deckId: deck.id, cardId: fireEnergy.cardId, zone: "main", quantity: 10 },
]);
calls();

// Deck analysis: the Pokémon system prompt, the German instruction, the rules check in the prompt.
{
  const { summariseDeck, runWizard } = await import("../../src/lib/ai/deck.ts");
  const fake = createFakeProvider({
    id: "anthropic-api",
    script: [
      { json: { archetype: "Feuer", gamePlan: "Angreifen.", strengths: [], weaknesses: [], goodAgainst: [], badAgainst: [], keyCards: [], legalityNotes: [] } },
    ],
  });
  registerProvider(fake);
  await summariseDeck(db, deck.id);
  const req = fake.requests[0];
  assert.equal(req.task, "deck_summary");
  assert.equal(req.system.length, 1, "one system block, as for every game");
  const sys = req.system[0].text;
  assert.ok(sys.includes(GAME_INFO.pokemon.promptName) && sys.includes("exactly 60 cards") && sys.includes("format is Standard"), sys);
  assert.ok(sys.endsWith(answerLanguageLine("pokemon")!), "the German instruction closes the system prompt");
  const prompt = (req.messages[0].parts[0] as { text: string }).text;
  assert.ok(prompt.includes("10 PKM-sve-002 Feuer-Energie"), "the decklist names the cards by id");
  assert.ok(prompt.includes("Glurak-ex / Charizard ex") && prompt.includes("RULES CHECK OF THE APP"), "cards described in both languages, with the app's rules check");
  assert.ok(prompt.includes("Noch 44 Karten bis 60"), "the German message of the checker is passed on");
  assert.ok(prompt.includes("Spiele oft gegen Wasser."), "meta notes");
  resetProviders();

  // The wizard: owned cards first in the cached block, the lookup tools, a card the model found live is stored before it is shown.
  const wizard = createFakeProvider({
    id: "anthropic-api",
    script: [
      { json: { lookups: [lookup("get_card", { id: "PKM-sv04.5-008" })], answer: null } },
      { json: { lookups: [], answer: { assessment: "Dir fehlt eine Zwischenstufe.", swaps: [{ outCardId: "PKM-sve-002", outQuantity: 3, inCardId: "PKM-sv04.5-008", inName: "Glutexo", inQuantity: 3, rationale: "Glutexo bringt dich zu Glurak.", priority: "high" }, { outCardId: "PKM-sve-002", outQuantity: 1, inCardId: "PKM-nope-9", inName: "Zz", inQuantity: 1, rationale: "gibt es nicht", priority: "low" }] } } },
    ],
  });
  registerProvider(wizard);
  const out = await runWizard(db, deck.id, "any", "Ich verliere zu oft.");
  assert.equal(wizard.requests.length, 2);
  const r0 = wizard.requests[0];
  assert.equal(r0.task, "deck_wizard");
  assert.deepEqual(r0.system.map((s) => s.cache ?? null), [null, null, "short"]);
  const pool = r0.system[2].text;
  assert.ok(pool.startsWith("THE PLAYER'S OWN CARDS OUTSIDE THIS DECK"), pool);
  assert.ok(pool.includes("OWN×3 | PKM-test-001 | Bonbon / Rare Candy"), "owned Trainers are on offer with how many she has");
  assert.ok(!pool.includes("PKM-sv03.5-004"), "cards already in the deck are not offered again");
  assert.ok(!pool.includes("Bobs Karte"), "another owner's cards are never offered (the deck owner's scope)");
  assert.ok(r0.system[1].text.includes("get_card"), "the lookup tools are described");
  assert.ok((r0.messages[0].parts[0] as { text: string }).text.includes("PKM-… card id exactly as given"), "the Pokémon swap instruction");
  assert.ok(r0.system[0].text.endsWith(answerLanguageLine("pokemon")!));
  assert.equal(out.swaps.length, 1, "a suggestion naming a card nobody can find is left out");
  assert.equal(out.swaps[0].inName, "Glutexo", "the card found by lookup is stored, so it shows with its name");
  assert.equal(out.swaps[0].inOwned, 0);
  assert.ok((await db.select().from(schema.cards).where(eq(schema.cards.id, "PKM-sv04.5-008"))).length === 1);
  const run = (await db.select().from(schema.aiRuns).where(eq(schema.aiRuns.kind, "deck_wizard")))[0];
  assert.equal(run.deckId, deck.id);
  assert.equal((run.input as { lookups: unknown[] }).lookups.length, 1, "the lookups of the run are kept on its ledger row");
  assert.equal(run.provider, "anthropic-api");
  resetProviders();

  // Owned scope: only the viewer's own cards, no lookups.
  const owned = createFakeProvider({ id: "anthropic-api", script: [{ json: { assessment: "Gut.", swaps: [] } }] });
  registerProvider(owned);
  await runWizard(db, deck.id, "owned", null);
  assert.equal(owned.requests.length, 1);
  assert.equal(owned.requests[0].system.length, 2, "no lookup block when there are no tools");
  assert.ok(owned.requests[0].system[1].text.startsWith("CANDIDATE POOL (cards the player owns"));
  resetProviders();
  const [empty] = await db.insert(schema.decks).values({ name: "Leer", game: "pokemon", owner: "carl" }).returning({ id: schema.decks.id });
  await db.insert(schema.deckCards).values({ deckId: empty.id, cardId: charmander.cardId, zone: "main", quantity: 1 });
  await assert.rejects(() => runWizard(db, empty.id, "owned", null), /Du besitzt keine passenden/);
}
calls();
console.log("ai-games: Pokémon analysis and wizard (German instruction, owned first, lookups, stored on reference)");

// cleanPokemonDraft: the rules a draft is held to.
{
  const known = new Map<string, KnownCard>([
    ["PKM-a", { name: "Glurak-ex", cardType: "POKEMON", details: { names: { en: "Charizard ex" } } }],
    ["PKM-b", { name: "Glurak-ex", cardType: "POKEMON", details: { names: { en: "Charizard ex" } } }],
    ["PKM-c", { name: "Feuer-Energie", cardType: "ENERGY", details: { basicEnergy: true, names: { en: "Fire Energy" } } }],
    ["PKM-d", { name: "Zauberkappe", cardType: "TRAINER", details: { onePerDeck: "ace-spec", names: { en: "Magic Hat" } } }],
    ["PKM-e", { name: "Zauberkappe 2", cardType: "TRAINER", details: { onePerDeck: "ace-spec", names: { en: "Magic Hat 2" } } }],
  ]);
  const c = cleanPokemonDraft(
    [
      { cardId: "PKM-a", quantity: 3 },
      { cardId: "PKM-b", quantity: 3 },
      { cardId: "PKM-a", quantity: 1 },
      { cardId: "PKM-c", quantity: 40 },
      { cardId: "PKM-d", quantity: 2 },
      { cardId: "PKM-e", quantity: 1 },
      { cardId: "PKM-zzz", quantity: 1 },
      { cardId: "garbage!", quantity: 1 },
    ],
    known,
  );
  assert.deepEqual(
    c.lines,
    [
      { cardId: "PKM-a", quantity: 4 },
      { cardId: "PKM-c", quantity: 40 },
      { cardId: "PKM-d", quantity: 1 },
    ],
    "two printings share the 4-by-name limit, basic Energy is unlimited, one ACE SPEC",
  );
  assert.deepEqual(c.dropped, ["PKM-zzz", "garbage!"]);
  assert.deepEqual(c.trimmed, ["PKM-b", "PKM-d", "PKM-e"]);
  const full = cleanPokemonDraft([{ cardId: "PKM-a", quantity: 4 }, { cardId: "PKM-c", quantity: 70 }], known);
  assert.equal(full.lines.reduce((n, l) => n + l.quantity, 0), 60, "never more than the deck size");
  assert.deepEqual(full.trimmed, ["PKM-c"]);
}

// "Build a deck with Claude" for Pokémon on a scripted model: validation and creation.
{
  stored.length = 0;
  const draft = {
    name: "Glurak Feuersturm",
    strategy: "Glutexo und Glumanda bringen Glurak-ex ins Spiel.",
    cards: [
      { cardId: "PKM-sv03.5-004", name: "Glumanda", quantity: 4 },
      { cardId: "PKM-sv03.5-005", name: "Charmeleon", quantity: 3 },
      { cardId: "PKM-sv03.5-006", name: "Glurak-ex", quantity: 6 },
      { cardId: "PKM-sve-002", name: "Feuer-Energie", quantity: 14 },
      { cardId: "PKM-test-001", name: "Rare Candy", quantity: 3 },
      { cardId: "PKM-sv03.5-099", name: "Zz", quantity: 2 },
    ],
    purchases: [{ cardId: "PKM-sv03.5-005", quantity: 3, why: "Die Zwischenstufe." }],
  };
  const fake = createFakeProvider({
    id: "anthropic-api",
    script: [
      { json: { lookups: [lookup("evolves_from", { name: "Charmander" })], answer: null } },
      { json: { lookups: [], answer: draft } },
    ],
  });
  registerProvider(fake);
  const before = (await db.select().from(schema.decks)).length;
  const r = await buildDeckWithClaude("pokemon", { seedCardId: "PKM-sv03.5-006" }, { db, owner: "anna", deps });
  assert.equal(r.mode, "claude");
  assert.ok(r.legality, "the new deck comes back labelled");
  assert.equal(r.mainCount, 4 + 3 + 4 + 14 + 3, "Charizard ex cut to 4 by the name rule; the unknown card was dropped");
  assert.deepEqual(r.notes, ["Nicht gefunden, ausgelassen: PKM-sv03.5-099"]);
  assert.equal((await db.select().from(schema.decks)).length, before + 1);
  const made = (await db.select().from(schema.decks).where(eq(schema.decks.id, r.deckId)))[0];
  assert.equal(made.game, "pokemon");
  assert.equal(made.owner, "anna", "the deck is stamped with its owner");
  assert.equal(made.format, "standard");
  assert.ok(made.name.endsWith("(Claude-Entwurf)"));
  assert.ok(made.description?.includes("Dir fehlen noch") && made.description.includes("Glutexo"), made.description ?? "");
  assert.deepEqual(stored.sort(), ["sv03.5-005"], "only the card that was not stored yet goes through ensurePokemonCard");
  assert.equal(r.legality?.status, "illegal", "Charizard ex has rotated out of Standard: flagged, the deck is still created");
  assert.ok(r.legality?.issues.some((i) => i.message.startsWith("Noch ")), "and short of 60");
  assert.ok(r.legality?.issues.some((i) => i.message.includes("nicht mehr erlaubt")));
  assert.equal(r.legality?.mainCount, r.mainCount);
  const storedRows = (await (await import("../../src/lib/decks/queries.ts")).getDeck(db, r.deckId))!.cards;
  assert.deepEqual(r.legality, legality(storedRows, "pokemon", "standard"), "the verdict is what legality(rows, game, format) says of the stored deck");
  const req = fake.requests[0];
  assert.equal(req.task, "deck_from_card", "a seeded build is the from-card task");
  assert.ok(req.system[0].text.includes("SEED") || req.system[0].text.includes("seed card"), "the seed is in the prompt");
  assert.ok(req.system[0].text.includes("Glurak-ex / Charizard ex"), "the seed card is described to the model");
  assert.ok(req.system[0].text.endsWith(answerLanguageLine("pokemon")!));
  assert.ok(req.system[2].text.includes("OWN×4 | PKM-sv03.5-004"), "the viewer's cards come first in the cached block");
  assert.ok(!req.system[2].text.includes("Bobs Karte"));
  const runs = await db.select().from(schema.aiRuns).where(eq(schema.aiRuns.kind, "deck_from_card"));
  assert.equal(runs.length, 1);
  assert.equal((runs[0].input as { lookups: unknown[]; seedCardId: string }).lookups.length, 1);
  assert.equal((runs[0].input as { seedCardId: string }).seedCardId, "PKM-sv03.5-006");
  const rows = await db.select().from(schema.deckCards).where(eq(schema.deckCards.deckId, r.deckId));
  assert.equal(rows.find((x) => x.cardId === "PKM-sv03.5-006")?.quantity, 4);
  resetProviders();

  // A wish needs words or a card; a Dragon Ball leader build needs a leader; the other game's card is refused.
  await assert.rejects(() => buildDeckWithClaude("pokemon", {}, { db, owner: "anna", deps }), /Sag mir/);
  await assert.rejects(() => buildDeckWithClaude("dbs", {}, { db, owner: null }), /Pick a Leader/);
  await assert.rejects(() => buildDeckAroundCard("dbs", "BT18-020", { db, owner: null, mode: "draft" }), /no free draft/);
  await assert.rejects(() => buildDeckAroundCard("dbs", "PKM-sv03.5-006", { db, owner: null }), /belongs to Pokémon/);
  await assert.rejects(() => buildDeckAroundCard("fusion", "PKM-sv03.5-006", { db, owner: null, mode: "claude" }), /belongs to Pokémon/);
}
console.log("ai-games: Pokémon build with Claude (cleaning, ensurePokemonCard, owner, legality, ledger)");

// Dragon Ball behaviour through the one function: Claude picks the Leader, as it always did.
{
  const dbsDb = await pgliteDb();
  const { code } = await seed(dbsDb, "dbs");
  const draft = { name: "Seeded", strategy: "Hit.", main: [10, 11, 12, 13, 14].map((n) => ({ cardId: `${code}-0${n}`, quantity: 4 })), zDeck: [], purchases: [], leaderId: `${code}-002` };
  const fake = createFakeProvider({ id: "anthropic-api", script: [{ json: draft }] });
  registerProvider(fake);
  const r = await buildDeckAroundCard("dbs", `${code}-030`, { db: dbsDb, owner: "anna" });
  assert.equal(r.mode, "claude");
  assert.equal(r.leaderName, "Red Blue Leader");
  assert.equal(fake.requests.length, 1, "one request: no lookup rounds, no tools");
  assert.equal(fake.requests[0].task, "deck_from_card");
  const made = (await dbsDb.select().from(schema.decks).where(eq(schema.decks.id, r.deckId)))[0];
  assert.equal(made.owner, "anna");
  assert.equal(made.game, "dbs");
  assert.ok(r.legality, "a Dragon Ball deck is labelled too");
  resetProviders();
  const leaderBuild = createFakeProvider({ id: "anthropic-api", script: [{ json: { ...draft, zDeck: [] } }] });
  registerProvider(leaderBuild);
  const b = await buildDeckWithClaude("dbs", { leaderId: `${code}-001` }, { db: dbsDb, owner: null });
  assert.equal(b.mode, "claude");
  assert.equal(leaderBuild.requests[0].task, "deck_builder");
  resetProviders();
}
console.log("ai-games: Dragon Ball deck from a card and from a leader through the one function");

// The deterministic draft around a card.
{
  stored.length = 0;
  calls();
  const r = await buildDeckAroundCard("pokemon", "PKM-sv03.5-006", { db, owner: "anna", deps, format: "expanded" });
  assert.equal(r.mode, "draft");
  assert.equal(calls().length > 0, true);
  const made = (await db.select().from(schema.decks).where(eq(schema.decks.id, r.deckId)))[0];
  assert.equal(made.owner, "anna");
  assert.equal(made.game, "pokemon");
  assert.equal(made.format, "expanded");
  assert.equal(made.name, "Deck um Glurak-ex");
  assert.ok(made.description?.startsWith("Das ist ein Entwurf zum Anpassen, kein fertiges Deck."), "it never claims to be complete");
  const lines = await db.select().from(schema.deckCards).where(eq(schema.deckCards.deckId, r.deckId));
  const q = (id: string) => lines.find((l) => l.cardId === id)?.quantity;
  assert.equal(q("PKM-sv03.5-004"), 4, "the Basic the viewer owns (4-3-2: four of the Basic)");
  assert.equal(q("PKM-sv03.5-005"), 3, "the middle stage, found by its English name (Charmeleon) and chosen by HP among equals");
  assert.equal(q("PKM-sv03.5-006"), 2, "the card itself: two of the final stage");
  const energy = q("PKM-sve-002") ?? 0;
  assert.ok(energy >= 12 && energy <= 16, `12 to 16 basic Energy, got ${energy}`);
  assert.equal(q("PKM-test-001"), 3, "Trainers the viewer owns, as many as she has up to four");
  assert.equal(q("PKM-test-003"), 1, "one ACE SPEC at most");
  assert.equal(q("PKM-test-002"), undefined, "a Trainer that is not legal in the format is left out");
  assert.equal(q("PKM-test-004"), undefined, "another owner's Trainer is never used");
  assert.equal(lines.filter((l) => l.zone === "main").reduce((n, l) => n + l.quantity, 0), r.mainCount);
  assert.ok(r.mainCount < 60, "no padding with cards she does not have");
  assert.equal(r.legality?.status, "incomplete", "flagged like any deck: it says how many cards are missing");
  assert.ok(r.legality?.issues.some((i) => i.message === `Noch ${60 - r.mainCount} Karten bis 60`));
  assert.deepEqual(stored, [], "everything was stored already (the Charmeleon by the build above): nothing is written twice");
  assert.equal(r.toBuy, 3 + 1, "to get: the three Charmeleon and the second Charizard ex (she owns one)");
  assert.equal(r.notes.length, 0);

  // Walking UP from a Basic, and a card the source rates standard-legal wins over an owned-nothing tie.
  stored.length = 0;
  legalOverride.set("sv04.5-008", { standard: true, expanded: true });
  legalOverride.set("sv04.5-054", { standard: true, expanded: true });
  const up = await buildDeckAroundCard("pokemon", "PKM-sv03.5-004", { db, owner: "dora", deps });
  const upLines = await db.select().from(schema.deckCards).where(and(eq(schema.deckCards.deckId, up.deckId), eq(schema.deckCards.zone, "main")));
  const uq = (id: string) => upLines.find((l) => l.cardId === id)?.quantity;
  assert.equal(uq("PKM-sv03.5-004"), 4, "the seed Basic");
  assert.equal(uq("PKM-sv04.5-008"), 3, "the standard-legal Charmeleon beats the one with more HP that has rotated");
  assert.equal(uq("PKM-sv04.5-054"), 2, "and above it the Charizard ex (evolveFrom filter), standard-legal");
  assert.equal(uq("PKM-test-001"), undefined, "dora owns no Trainers: none are added");
  assert.ok(up.notes.some((n) => n.startsWith("Du hast noch keine passenden Trainerkarten")));
  assert.equal(up.mainCount, 4 + 3 + 2 + (uq("PKM-sve-002") ?? 0));
  assert.deepEqual(stored, ["sv04.5-054"], "the card the source knew and the database did not is stored (the Charmeleon was stored by the wizard)");
  legalOverride.clear();

  // The source being down is said in words and nothing is created.
  const decksBefore = (await db.select().from(schema.decks)).length;
  outage = true;
  await assert.rejects(() => buildDeckAroundCard("pokemon", "PKM-sv03.5-004", { db, owner: "dora", deps }), /nicht erreichbar/);
  outage = false;
  assert.equal((await db.select().from(schema.decks)).length, decksBefore);
  await assert.rejects(() => buildDeckAroundCard("pokemon", "PKM-sv99-404", { db, owner: "dora", deps }), /gibt es nicht/);
  await assert.rejects(() => buildDeckAroundCard("pokemon", "PKM-sve-002", { db, owner: "dora", deps }), /Such dir ein Pokémon aus/);
  await assert.rejects(() => buildDeckAroundCard("pokemon", "BT18-020", { db, owner: "dora", deps }), /keine Pokémon-Karte|gibt es nicht/);
}
console.log("ai-games: deterministic draft around a card (line, Energy, owned Trainers, scope, flags)");

// A Pokémon adapter on its own deps never reaches the network (the checks above ran on the stub only).
assert.ok(pokemonAdapter(deps).validate([], "standard").status);
globalThis.fetch = realFetch;
resetProviders();
// ── 5. What the first live run taught (14 Nov 2026) ──────────────────────────
{
  const { cardForName, cardNames, foldCardName, nameAgrees } = await import("../../src/lib/ai/games/pokemon-names.ts");
  const { verifySwapNames } = await import("../../src/lib/ai/games/pokemon.ts");
  const { topUpEnergy, TOP_UP_LIMIT } = await import("../../src/lib/ai/games/pokemon-build.ts");

  assert.equal(foldCardName("Glurak-ex"), foldCardName("glurak EX"));
  assert.equal(foldCardName("Überreste"), "uberreste");
  const glurak = cardNames({ name: "Glurak-ex", details: { names: { de: "Glurak-ex", en: "Charizard ex" } } });
  assert.ok(nameAgrees("Charizard ex", glurak) && nameAgrees("glurak ex", glurak) && nameAgrees("Glurak-ex (151)", glurak));
  assert.ok(!nameAgrees("Wunderbonbon", glurak), "another card's name does not agree");
  assert.ok(!nameAgrees("Glurak", ["Glurak-ex"]), "the bare name is not the ex card");
  assert.ok(!nameAgrees("Glurak-ex", ["Glurak"]), "a card named Glurak is not Glurak-ex");
  assert.ok(!nameAgrees("", glurak));

  // A source with three cards: Rossana-ex under the id the model used, and Sonderbonbon twice (one rotated).
  const rec = (tcgdexId: string, de: string, en: string, standard: boolean) =>
    ({ tcgdexId, category: "TRAINER", hit: { id: `PKM-${tcgdexId}`, tcgdexId, name: de, altName: en }, details: { names: { de, en }, legal: { standard, expanded: true } } }) as unknown as PokemonCardRecord;
  const all = [rec("sv03.5-191", "Rossana-ex", "Jynx ex", false), rec("old-1", "Sonderbonbon", "Rare Candy", false), rec("sv01-191", "Sonderbonbon", "Rare Candy", true)];
  const asked: string[] = [];
  const source = {
    search: async ({ q }: { q?: string }) => {
      asked.push(q ?? "");
      return all.filter((r) => [r.hit.name, r.hit.altName].some((n) => n && foldCardName(n) === foldCardName(q ?? ""))).map((r) => r.hit);
    },
    get: async (id: string) => {
      const r = all.find((x) => x.tcgdexId === id);
      if (!r) throw new (await import("../../src/lib/pokemon/tcgdex.ts")).PokemonSourceError("no such card", "not_found", 404);
      return r;
    },
    evolvesInto: async () => [],
  } as unknown as PokemonDeps["source"];
  assert.equal((await cardForName(source, "Rare Candy", "standard"))?.tcgdexId, "sv01-191", "the printing that is legal in the deck's format");
  assert.equal((await cardForName(source, "Rare Candy", "nonsense"))?.tcgdexId, "old-1", "else the first the source lists");
  assert.equal(await cardForName(source, "Gibt es nicht", "standard"), null);
  // A near name counts only when it is unambiguous among what the search finds.
  const loose = { ...source, search: async () => all.map((r) => r.hit) } as unknown as PokemonDeps["source"];
  assert.equal((await cardForName(loose, "Sonder-Bonbon!", "standard"))?.tcgdexId, "sv01-191", "punctuation and case do not matter");
  assert.equal((await cardForName(loose, "Sonderbonbon Karte", "standard"))?.tcgdexId, "sv01-191", "one card's name inside what was said");
  const two = { ...source, search: async () => [...all.map((r) => r.hit), { ...all[1].hit, tcgdexId: "x-1", name: "Sonderbonbon Deluxe", altName: null }] } as unknown as PokemonDeps["source"];
  assert.equal(await cardForName(two, "Sonderbon", "standard"), null, "two different cards fit: no guess");

  // The wizard's swaps: the live case (Sonderbonbon given Rossana-ex's id) is put right, a right pair is kept, an unknown name is dropped.
  const swaps = [
    { outCardId: "PKM-sv03.5-025", inCardId: "PKM-sv03.5-191", inName: "Sonderbonbon", rationale: "entwickelt sofort" },
    { outCardId: "PKM-sv03.5-025", inCardId: "PKM-sv03.5-191", inName: "Jynx ex", rationale: "richtig benannt" },
    { outCardId: "PKM-sv03.5-025", inCardId: "PKM-sv03.5-191", inName: "Professors Forschung", rationale: "gibt es hier nicht" },
    { outCardId: "PKM-sv03.5-025", inCardId: "PKM-sv03.5-004", rationale: "ohne Namen: bleibt wie es ist" },
  ];
  const checked = await verifySwapNames(db, { source, ensure: deps.ensure }, swaps, "standard");
  assert.deepEqual(checked.map((s) => s.inCardId), ["PKM-sv01-191", "PKM-sv03.5-191", "PKM-sv03.5-004"]);
  assert.equal(checked[0].rationale, "entwickelt sofort", "the swap keeps its reason and gets the card the reason is about");

  // A list a few cards short gets basic Energy; one far short, or without basic Energy, is left alone.
  const known = new Map<string, KnownCard>([
    ["PKM-a", { name: "Glurak-ex", cardType: "POKEMON", details: {} }],
    ["PKM-c", { name: "Feuer-Energie", cardType: "ENERGY", details: { basicEnergy: true } }],
    ["PKM-w", { name: "Wasser-Energie", cardType: "ENERGY", details: { basicEnergy: true } }],
  ]);
  const short = [{ cardId: "PKM-a", quantity: 45 }, { cardId: "PKM-w", quantity: 2 }, { cardId: "PKM-c", quantity: 12 }];
  assert.equal(topUpEnergy(short, known), 1, "59 cards: one more of the Energy it plays most of");
  assert.deepEqual(short.map((l) => l.quantity), [45, 2, 13]);
  assert.equal(topUpEnergy(short, known), 0, "60 is 60");
  assert.equal(topUpEnergy([{ cardId: "PKM-a", quantity: 60 - TOP_UP_LIMIT - 1 }, { cardId: "PKM-c", quantity: 0 }], known), 0, "too far short: left for the checker to say");
  assert.equal(topUpEnergy([{ cardId: "PKM-a", quantity: 58 }], known), 0, "no basic Energy in the list: nothing is invented");

  // A reply that asks for more lookups than a round runs is trimmed and told so, not rejected.
  const many = Array.from({ length: 9 }, (_, i) => lookup("get_card", { id: `PKM-x-${i}` }));
  const fake = createFakeProvider({ id: "anthropic-api", script: [{ json: { lookups: many, answer: null } }, { json: { lookups: [], answer: { ok: true } } }] });
  registerProvider(fake);
  const ran: string[] = [];
  const tool = { name: "get_card", description: "one card", run: async (a: { id?: string | null }) => (ran.push(a.id ?? ""), "ok") };
  const res = await generateWithLookups({ task: "deck_wizard", tier: "best", maxTokens: 1000, schema: z.object({ ok: z.boolean() }), system: [{ text: "RULES" }], messages: [{ role: "user", parts: [{ type: "text", text: "go" }] }] }, [tool]);
  assert.deepEqual(res.parsed, { ok: true });
  assert.equal(ran.length, 8, "the first eight of nine lookups ran");
  assert.ok((fake.requests[1].messages[2].parts[0] as { text: string }).text.includes("your other 1 were not"));
  resetProviders();
  void asked;
}
console.log("ai-games: card ids checked against the names the model gives, Energy top-up, lookups over the limit");

console.log("ai-games: ok");
process.exit(0);
