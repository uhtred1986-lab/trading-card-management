/**
 * The plain-English readers' nouns and areas (#478): a filter made only of
 * adjectives still names its cards, and an area reads as the game's own word.
 *
 * Tidecaller Oracle (BT21-044) prints "if there are 3 or more blue cards in
 * your Drop Area" and read "there are 3 or more blue in your drop" — the
 * sentence the block builder, the review queue and the teach panels all show
 * the owner as what the engine reads. Pure: no engine, no database. Part of
 * `npm test`; run from `scripts/verify-arena.ts`.
 */
import assert from "node:assert/strict";
import { dbsWords } from "../../src/lib/arena/board-words";
import { compileSkill } from "../../src/lib/arena/compile";
import { parseCond } from "../../src/lib/arena/lang/parse";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { parseFilter } from "../../src/lib/arena/text/filters";
import { ZONE_NOUNS, describeCond, describeFilter, describeScript, describeSelector } from "../../src/lib/arena/vm/script-schema";
import type { Selector } from "../../src/lib/arena/vm/script";

// ── the acceptance card ──────────────────────────────────────────────────────
{
  const tidecaller = parseCond('count(IN you.drop "blue") >= 3');
  assert.ok(tidecaller.ok, "Tidecaller Oracle's condition parses");
  assert.equal(describeCond(tidecaller.value), "there are 3 or more blue cards in your Drop Area");
  // …and the same sentence when the compiler reads the printed clause.
  const printed = compileSkill(parseSkills("[Auto] When you play this card, if there are 3 or more blue cards in your Drop Area, draw 1 card.")[0]);
  assert.deepEqual(printed.unsupported, []);
  assert.equal(describeScript(printed.ops), "if there are 3 or more blue cards in your Drop Area: draw 1");
}

// ── a filter's noun ─────────────────────────────────────────────────────────
{
  const sel = (filter: string, o: Partial<Selector> = {}): string => describeSelector({ side: "you", area: "drop", count: 1, filter: parseFilter(filter), ...o });
  // Colour only: the noun the filter had nothing to say about is put back.
  assert.equal(sel("blue"), "1 blue card in your Drop Area");
  assert.equal(sel("blue", { count: 2 }), "2 blue cards in your Drop Area", "any number but one is plural");
  // Type only, as the card type prints.
  assert.equal(sel("battle card", { side: "opponent" }), "1 Battle Card in your opponent's Drop Area");
  assert.equal(sel("non-leader card", { count: 99 }), "all non-Leader Cards in your Drop Area");
  // Colour and type.
  assert.equal(sel("red battle card", { area: "hand", upTo: true }), "up to 1 red Battle Card in your hand");
  // A name, a trait, and a measure hung off the noun.
  assert.equal(sel("{Angel Halo}"), "1 {Angel Halo} card in your Drop Area");
  assert.equal(sel("≪Saiyan≫ card with an energy cost of 3 or less", { area: "warp", count: 99 }), "all ≪Saiyan≫ cards with an energy cost of 3 or less in your Warp");
  assert.equal(sel("Z-extra card", { area: "battle", count: 99 }), "all Z-Extra Cards in your Battle Area");
  // No filter, and a filter that only repeats the area, name the cards alone.
  assert.equal(describeSelector({ side: "opponent", area: "battle", count: 1, upTo: true }), "up to 1 card in your opponent's Battle Area");
  assert.equal(sel("leader card", { area: "leader", count: 1 }), "1 card in your Leader Area");
  // …except in the Battle Area, where a Hidden Mode card has no card type
  // (23-5-2): "Battle Cards" there is a narrower choice than "cards".
  assert.equal(sel("battle card", { area: "battle", count: 2 }), "2 Battle Cards in your Battle Area");
  // The take: a position in the area, said as the cards it takes.
  assert.equal(describeSelector({ side: "you", area: "deck", take: 1 }), "the top 1 card in your deck");
  // "Of the cards looked at" already has its noun.
  assert.equal(describeSelector({ fromVar: "looked", count: 1, upTo: true }), "up to 1 of the cards looked at");

  // The short form is the language's own and does not move: `printFilter`
  // writes a filter in these words whenever `parseFilter` reads them back.
  assert.equal(describeFilter(parseFilter("blue")), "blue");
  assert.equal(describeFilter(parseFilter("red battle card")), "red battle card");
  assert.equal(describeFilter(parseFilter("blue"), { plural: true }), "blue cards");
  assert.equal(describeFilter(parseFilter("red battle card"), { plural: false }), "red Battle Card");
}

// ── an area's word, on each side ────────────────────────────────────────────
{
  const at = (o: Partial<Selector>): string => describeSelector({ side: "you", area: "battle", count: 99, ...o });
  assert.equal(at({}), "all cards in your Battle Area");
  assert.equal(at({ side: "opponent" }), "all cards in your opponent's Battle Area");
  assert.equal(at({ side: "both", notSelf: "card" }), "all cards in each player's Battle Area other than this card");
  assert.equal(at({ side: "opponent", area: undefined, areas: ["battle", "unison"] }), "all cards in your opponent's Battle Area or Unison Area");
  assert.equal(at({ area: "leader" }), "all cards in your Leader Area", "the Leader Area is the selector's owner's, not 'the'");
  // The routes a board never shows a card sitting in.
  assert.equal(at({ area: "play", count: 1, filter: parseFilter("<Majin Buu>") }), "1 <Majin Buu> card you have in play");
  assert.equal(at({ side: "opponent", area: "play", count: 1 }), "1 card your opponent has in play");
  assert.equal(at({ area: "under" }), "all cards under your cards");
  // A condition over two selectors, each with its own noun.
  assert.equal(
    describeCond({ kind: "every", sel: { side: "opponent", area: "energy" }, matching: { side: "opponent", area: "energy", mode: "rest" } }),
    "every card in your opponent's Energy Area is also among the cards in your opponent's Energy Area in rest mode",
  );

  // The words are a copy of `words.rules`' (the loader cannot be imported by
  // the module that builds sentences), so the copy is held to the declaration.
  const board = dbsWords().area as Record<string, string>;
  for (const [area, noun] of Object.entries(ZONE_NOUNS)) {
    assert.equal(noun, board[area]?.replace(/^(your|the) /, ""), `ZONE_NOUNS.${area} is not words.rules' word for it`);
  }
  assert.deepEqual(Object.keys(ZONE_NOUNS).sort(), Object.keys(board).filter((a) => a !== "removed").sort(), "every board area has its word");
}
