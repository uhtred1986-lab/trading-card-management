/**
 * The Pokémon polish lane: the pure parts of what the screens still lacked against docs/pokemon/design.md.
 * No network, no database, no model call.
 *
 * Covers: the swipe viewer's zoom as a reducer (double tap in and out, the 2.2x target keeping the tapped
 * point still, pinch limits 1x and 4x, the pan staying inside the picture, no pan at 1x, + and - steps,
 * a pinch that ends just above 1x settling at 1x, reset), the choice of the card an evolution points to
 * (same set first, else newest with a picture, accents and case ignored, one printing per name, a cap),
 * `loadEvolutions` on a stub source (a half answer when one side fails, all failed throws, a Trainer has
 * none), the reason line of a wish ("fehlt im Deck ..."), and where a deck row on /decks links to.
 */
import assert from "node:assert/strict";
import { deckListLink } from "../../src/lib/decks/discovery.ts";
import { reasonLine, wishReasons } from "../../src/lib/pokemon/deck-logic.ts";
import { foldName, intoCards, loadEvolutions, pickByName, pickPrinting, type EvolutionBrief, type EvolutionSource } from "../../src/lib/pokemon/evolutions.ts";
import { PokemonSourceError, type PokemonSetInfo } from "../../src/lib/pokemon/tcgdex.ts";
import type { PokemonHit } from "../../src/lib/pokemon/types.ts";
import { isZoomed, panLimit, zoomReducer, zoomTransform, ZOOM_DOUBLE, ZOOM_MAX, ZOOM_REST, type ZoomBox } from "../../src/lib/viewer-zoom.ts";

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);

// ── Zoom ─────────────────────────────────────────────────────────────────────

const box: ZoomBox = { w: 300, h: 420 };

{
  // A double tap in the middle zooms to 2.2x, a second one zooms out.
  const z1 = zoomReducer(ZOOM_REST, { type: "toggle", px: 0, py: 0, box });
  assert.equal(z1.scale, ZOOM_DOUBLE);
  assert.deepEqual([z1.x, z1.y], [0, 0]);
  assert.equal(z1.jump, true, "a double tap may animate");
  assert.ok(isZoomed(z1));
  const z2 = zoomReducer(z1, { type: "toggle", px: 40, py: 40, box });
  assert.deepEqual(z2, { scale: 1, x: 0, y: 0, jump: true });
  assert.equal(zoomTransform(z2), undefined, "no transform at 1x");

  // A tap off-centre keeps the tapped point under the finger: p = x + scale * q with q = p at 1x.
  const t = zoomReducer(ZOOM_REST, { type: "toggle", px: 60, py: -80, box });
  close(t.x, 60 - 60 * ZOOM_DOUBLE);
  close(t.y, -80 + 80 * ZOOM_DOUBLE);
  // ... and a tap at the very edge still stays inside the picture (the pan is clamped).
  const edge = zoomReducer(ZOOM_REST, { type: "toggle", px: 150, py: 210, box });
  close(Math.abs(edge.x), panLimit(box.w, ZOOM_DOUBLE));
  close(Math.abs(edge.y), panLimit(box.h, ZOOM_DOUBLE));
}

{
  // A pinch stays between 1x and 4x.
  let z = zoomReducer(ZOOM_REST, { type: "gesture", factor: 10, px: 0, py: 0, dx: 0, dy: 0, box });
  assert.equal(z.scale, ZOOM_MAX);
  assert.equal(z.jump, false, "a gesture never animates");
  z = zoomReducer(z, { type: "gesture", factor: 0.01, px: 0, py: 0, dx: 0, dy: 0, box });
  assert.deepEqual(z, { scale: 1, x: 0, y: 0, jump: false });
  // Out of range moves cannot be reached: at 1x a drag moves nothing, so a swipe is the rail's.
  const still = zoomReducer(ZOOM_REST, { type: "gesture", factor: 1, px: 0, py: 0, dx: 120, dy: 80, box });
  assert.deepEqual(still, { scale: 1, x: 0, y: 0, jump: false });
}

{
  // A drag pans while zoomed and stops at the picture's edges.
  const z = zoomReducer(ZOOM_REST, { type: "toggle", px: 0, py: 0, box });
  const moved = zoomReducer(z, { type: "gesture", factor: 1, px: 0, py: 0, dx: 30, dy: -20, box });
  assert.deepEqual([moved.x, moved.y], [30, -20]);
  const far = zoomReducer(moved, { type: "gesture", factor: 1, px: 0, py: 0, dx: 5000, dy: -5000, box });
  close(far.x, panLimit(box.w, ZOOM_DOUBLE));
  close(far.y, -panLimit(box.h, ZOOM_DOUBLE));
  // Zooming out with the picture pushed to an edge pulls the pan back inside the new limit.
  const out = zoomReducer(far, { type: "gesture", factor: 0.6, px: 0, py: 0, dx: 0, dy: 0, box });
  assert.ok(Math.abs(out.x) <= panLimit(box.w, out.scale) + 1e-9);
  assert.ok(Math.abs(out.y) <= panLimit(box.h, out.scale) + 1e-9);
  assert.match(zoomTransform(far)!, /^translate\(.+px, .+px\) scale\(2\.200\)$/);
}

{
  // + and - step around the centre, - ends at 1x, 0 and Escape reset.
  let z = zoomReducer(ZOOM_REST, { type: "step", dir: 1, box });
  close(z.scale, 1.5);
  z = zoomReducer(z, { type: "step", dir: 1, box });
  close(z.scale, 2.25);
  for (let i = 0; i < 6; i++) z = zoomReducer(z, { type: "step", dir: 1, box });
  assert.equal(z.scale, ZOOM_MAX);
  for (let i = 0; i < 8; i++) z = zoomReducer(z, { type: "step", dir: -1, box });
  assert.deepEqual(z, { scale: 1, x: 0, y: 0, jump: true });
  assert.equal(zoomReducer(ZOOM_REST, { type: "step", dir: -1, box }).scale, 1, "no zoom below 1x");
  const zoomed = zoomReducer(ZOOM_REST, { type: "toggle", px: 10, py: 10, box });
  assert.deepEqual(zoomReducer(zoomed, { type: "reset" }), { scale: 1, x: 0, y: 0, jump: true });
  assert.equal(zoomReducer(ZOOM_REST, { type: "reset" }), ZOOM_REST, "reset at rest changes nothing (no render)");
  // A pinch that ends a hair above 1x settles at 1x; one that ends clearly zoomed stays.
  const hair = zoomReducer(ZOOM_REST, { type: "gesture", factor: 1.04, px: 0, py: 0, dx: 0, dy: 0, box });
  assert.equal(zoomReducer(hair, { type: "settle" }).scale, 1);
  const real = zoomReducer(ZOOM_REST, { type: "gesture", factor: 1.6, px: 0, py: 0, dx: 0, dy: 0, box });
  assert.equal(zoomReducer(real, { type: "settle" }), real);
  // A picture with no size yet (not loaded) never leaves the origin.
  const none = zoomReducer(ZOOM_REST, { type: "toggle", px: 50, py: 50, box: { w: 0, h: 0 } });
  assert.deepEqual([none.x, none.y], [0, 0]);
}

// ── Which card an evolution points to ────────────────────────────────────────

// Newest set first: sv06 (0), sv03.5 (1), base1 (2).
const rank = new Map([
  ["sv06", 0],
  ["sv03.5", 1],
  ["base1", 2],
]);
const brief = (tcgdexId: string, name: string, image: string | null = "https://assets.tcgdex.net/x"): EvolutionBrief => ({ tcgdexId, name, localId: tcgdexId.split("-")[1], image });

assert.equal(foldName("  Flabébé "), "flabebe");
assert.equal(foldName(null), "");

{
  const list = [brief("base1-024", "Charmeleon"), brief("sv03.5-005", "Charmeleon"), brief("sv06-020", "Charmeleon")];
  assert.equal(pickPrinting(list, "sv03.5", rank)?.tcgdexId, "sv03.5-005", "the same set first");
  assert.equal(pickPrinting(list, "sv99", rank)?.tcgdexId, "sv06-020", "else the newest set");
  assert.equal(pickPrinting(list, null, rank)?.tcgdexId, "sv06-020");
  const noPicNewest = [brief("sv06-020", "Charmeleon", null), brief("base1-024", "Charmeleon")];
  assert.equal(pickPrinting(noPicNewest, "sv06", rank)?.tcgdexId, "base1-024", "a picture beats the same set");
  assert.equal(pickPrinting([brief("zz9-001", "A"), brief("zz8-001", "A")], null, rank)?.tcgdexId, "zz9-001", "unknown sets keep the source's order");
  assert.equal(pickPrinting([], "sv06", rank), null);
}

const hit = (tcgdexId: string, name: string, altName: string | null, image: string | null = "https://assets.tcgdex.net/x"): PokemonHit => ({
  id: `PKM-${tcgdexId}`,
  tcgdexId,
  name,
  altName,
  setName: "",
  localId: tcgdexId.split("-")[1],
  setTotal: null,
  category: "POKEMON",
  types: [],
  image,
  priceCents: null,
  lowCents: null,
  variants: [],
  legal: null,
});

{
  // The search also finds "Charmander" cards when asked for "Charmeleon"-like names; only the exact name counts, in either language.
  const hits = [hit("base1-046", "Charmander", null), hit("sv06-010", "Glutexo", "Charmeleon"), hit("sv03.5-005", "Glutexo", "Charmeleon"), hit("sv06-099", "Charmeleon ex", null)];
  assert.equal(pickByName(hits, "Charmeleon", "sv03.5", rank)?.tcgdexId, "sv03.5-005");
  assert.equal(pickByName(hits, "charmeleon", "sv99", rank)?.tcgdexId, "sv06-010");
  assert.equal(pickByName(hits, "Charizard", null, rank), null, "no match, no card");
  assert.equal(pickByName([hit("sv06-001", "Flabébé", null)], "Flabebe", null, rank)?.tcgdexId, "sv06-001", "accents are ignored");
}

{
  // One printing per name, in the order the names first appear, capped.
  const list = [brief("base1-005", "Charizard"), brief("sv06-001", "Charizard ex"), brief("sv03.5-006", "Charizard"), brief("sv06-002", "Charizard ex")];
  const out = intoCards(list, "sv03.5", rank);
  assert.deepEqual(
    out.map((b) => b.tcgdexId),
    ["sv03.5-006", "sv06-001"],
  );
  const many = Array.from({ length: 12 }, (_, i) => brief(`sv06-${100 + i}`, `Eevee line ${i}`));
  assert.equal(intoCards(many, null, rank).length, 8);
  assert.equal(intoCards(many, null, rank, 3).length, 3);
  assert.deepEqual(intoCards([], null, rank), []);
}

// ── loadEvolutions on a stub source ──────────────────────────────────────────

const set = (id: string, name: string, official: number): PokemonSetInfo => ({ id, name, names: {}, logo: null, symbol: null, official, total: official, releaseDate: null });
const sets = [set("sv06", "Maskerade im Zwielicht", 167), set("sv03.5", "151", 165), set("base1", "Basis-Set", 102)];
const source = (over: Partial<EvolutionSource> = {}): EvolutionSource => ({
  async search(p) {
    return p.setId === "sv03.5" ? [hit("sv03.5-004", "Glutexo", "Charmander")] : [hit("base1-046", "Glutexo", "Charmander"), hit("sv06-009", "Glutexo", "Charmander")];
  },
  async sets() {
    return sets;
  },
  async evolvesInto() {
    return [brief("base1-024", "Charmeleon"), brief("sv03.5-005", "Charmeleon")];
  },
  ...over,
});
const charmeleon = {
  hit: { ...hit("sv03.5-005", "Glutexo", "Charmeleon"), category: "POKEMON" as const },
  details: { names: { de: "Glutexo", en: "Charmeleon" }, evolveFrom: "Charmander" },
};

{
  const r = await loadEvolutions(charmeleon, source({ evolvesInto: async () => [brief("sv03.5-005", "Charmeleon"), brief("sv03.5-006", "Charizard"), brief("sv06-030", "Charizard ex")] }));
  assert.equal(r.from?.tcgdexId, "sv03.5-004", "evolves from: the same set's printing");
  assert.deepEqual(
    r.into.map((h) => h.tcgdexId),
    ["sv03.5-006", "sv06-030"],
    "evolves into: the card itself is left out",
  );
  assert.equal(r.into[0].setName, "151");
  assert.equal(r.into[0].setTotal, 165);
  assert.equal(r.into[0].image, "https://assets.tcgdex.net/x");
}

{
  // Not in the same set: the newest printing with a picture.
  const r = await loadEvolutions({ ...charmeleon, hit: { ...charmeleon.hit, tcgdexId: "xy1-9", localId: "9" } }, source());
  assert.equal(r.from?.tcgdexId, "sv06-009");
}

{
  // A Basic has nothing to evolve from; the source is asked only about "into".
  let searched = 0;
  const r = await loadEvolutions({ hit: hit("sv03.5-004", "Glutexo", "Charmander"), details: { names: { en: "Charmander" } } }, source({ search: async () => (searched++, []) }));
  assert.equal(r.from, null);
  assert.equal(searched, 0);
  assert.equal(r.into.length, 1);
}

{
  // A half answer: the evolves-into read fails, the evolves-from one is shown.
  const half = await loadEvolutions(charmeleon, source({ evolvesInto: async () => Promise.reject(new PokemonSourceError("down", "unavailable")) }));
  assert.equal(half.from?.tcgdexId, "sv03.5-004");
  assert.deepEqual(half.into, []);
  // Everything failed: the route answers 503 and the section does not appear.
  const down = new PokemonSourceError("down", "unavailable");
  await assert.rejects(loadEvolutions(charmeleon, source({ search: async () => Promise.reject(down), evolvesInto: async () => Promise.reject(down) })), (e) => e === down);
  // No set list: the choice falls back to the source's order, nothing throws.
  const noSets = await loadEvolutions(charmeleon, source({ sets: async () => Promise.reject(down) }));
  assert.equal(noSets.from?.tcgdexId, "sv03.5-004");
  // A Trainer is not asked about at all.
  let asked = 0;
  const trainer = await loadEvolutions({ hit: { ...charmeleon.hit, category: "TRAINER" }, details: {} }, source({ evolvesInto: async () => (asked++, []) }));
  assert.deepEqual(trainer, { from: null, into: [] });
  assert.equal(asked, 0);
}

// ── The reason line of a wish ────────────────────────────────────────────────

{
  const needs = [
    { deckId: 2, deckName: "Wasser", cardId: "PKM-a", quantity: 3 },
    { deckId: 1, deckName: "Feuer", cardId: "PKM-a", quantity: 2 },
    { deckId: 1, deckName: "Feuer", cardId: "PKM-a", quantity: 1 }, // another zone of the same deck: 3 in all
    { deckId: 1, deckName: "Feuer", cardId: "PKM-b", quantity: 4 },
    { deckId: 3, deckName: "Wiese", cardId: "PKM-a", quantity: 1 },
  ];
  const r = wishReasons(needs, { "PKM-a": 2, "PKM-b": 4 });
  assert.deepEqual(r.get("PKM-a"), ["Feuer", "Wasser"], "decks that hold more than she owns, oldest deck first; Wiese (1 of 2) is fine");
  assert.equal(r.has("PKM-b"), false, "owning exactly what the deck holds is not missing");
  assert.equal(wishReasons(needs, {}).get("PKM-a")?.length, 3, "owning nothing: every deck lacks it");
  assert.equal(wishReasons([], {}).size, 0);
  assert.equal(reasonLine([]), null);
  assert.equal(reasonLine(["Feuer"]), "fehlt im Deck „Feuer“");
  assert.equal(reasonLine(["Feuer", "Wasser"]), "fehlt im Deck „Feuer“ und 1 weitere");
  assert.equal(reasonLine(["Feuer", "Wasser", "Wiese"]), "fehlt im Deck „Feuer“ und 2 weitere");
}

// ── The shared deck list ─────────────────────────────────────────────────────

assert.deepEqual(deckListLink("dbs", 7), { href: "/decks/7" });
assert.deepEqual(deckListLink("fusion", "9", "x"), { href: "/decks/9" });
assert.deepEqual(deckListLink("pokemon", 12, "expanded"), { href: "/pokemon/decks/12", formatLabel: "Expanded format" });
assert.deepEqual(deckListLink("pokemon", 12, "standard"), { href: "/pokemon/decks/12", formatLabel: "Standard format" });
assert.deepEqual(deckListLink("pokemon", 12, null), { href: "/pokemon/decks/12", formatLabel: "Standard format" }, "no stored format is the game's default");

console.log("pokemon-polish: ok");
