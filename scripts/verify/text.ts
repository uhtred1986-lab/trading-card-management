/**
 * How card text is read before any game exists: the skill parser, the keyword
 * reference, and the filter and condition grammars.
 *
 * Part of `npm test`; run from `scripts/verify-arena.ts`, which fixes the order.
 */
import assert from "node:assert/strict";
import { KEYWORDS, keywordOf, keywordTagSpellings, keywordsByGroup, matches, orbsIn, parseCondition, parseFilter, parseSkills, tagBody, tagParsesTo } from "./harness";
import type { CardDef } from "./harness";

// ── skill text parsing ─────────────────────────────────────────────────────

{
  const cell = parseSkills(
    "[Auto] When this card is placed in your Leader Area, choose up to 1 {Cell Games Arena} from your deck, activate it.<br>[Activate: Main][Once per turn] Choose 1 green or yellow card from your hand, place it under this card: Draw 2 cards.<br>[Awaken] If there is a total of 4 or more energy between you and your opponent: You may draw 2 cards and flip this card over.",
  );
  assert.equal(cell.length, 3);
  assert.equal(cell[0].kind, "auto");
  assert.equal(cell[1].kind, "activate:main");
  assert.equal(cell[1].oncePerTurn, true);
  assert.match(cell[1].cost, /^Choose 1 green/);
  assert.equal(cell[1].effect, "Draw 2 cards.");
  assert.equal(cell[2].keyword?.name, "Awaken");
  assert.equal(cell[2].kind, "keyword");

  const vegito = parseSkills("[Deflect][Triple Attack]\n[br]\n[Permanent] If you have a Battle Card with an [Over Realm] skill in play, reduce the energy cost of this card in your Z-Deck by 2.");
  assert.equal(vegito.length, 3);
  assert.deepEqual(vegito[0].keyword, { name: "Deflect" });
  assert.deepEqual(vegito[1].keyword, { name: "Attack", x: 3 });
  assert.equal(vegito[2].kind, "permanent");
  // "[Over Realm]" inside the sentence is not a leading tag, so it is not a keyword of this line.
  assert.equal(vegito[2].keyword, null);

  const pai = parseSkills("[z-awaken]{u}: Blue <Paikuhan>. (Pay the skill cost and Z-Energy.)<br>[double strike]");
  assert.equal(pai[0].keyword?.name, "Z-Awaken");
  assert.deepEqual(pai[0].energyCost, { Blue: 1 });
  assert.match(pai[0].effect, /^Blue <Paikuhan>/);
  assert.deepEqual(pai[1].keyword, { name: "Strike", x: 2 });

  const nail = parseSkills("[evolve]{2}: <Nail>");
  assert.deepEqual(nail[0].keyword, { name: "Evolve", variant: "Evolve" });
  assert.deepEqual(nail[0].energyCost, { any: 2 });
  assert.equal(nail[0].effect, "<Nail>");

  const unison = parseSkills(
    "[Empower Green 5]<br>[+1][Activate: Main] Place 1 card from your hand at the bottom of your deck: Draw 1 card.<br>[-6][Activate: Main] Your opponent discards 2 cards from their hand.",
  );
  assert.deepEqual(unison[0].keyword, { name: "Empower", color: "Green", x: 5 });
  assert.equal(unison[1].markerCost, 1);
  assert.equal(unison[1].kind, "activate:main");
  assert.equal(unison[2].markerCost, -6);

  const counter = parseSkills(
    "[Energy-Exhaust] (If this card is placed in an Energy Area from any area, it must be placed there in Rest Mode.)<br>[Counter: Play] The Battle Card your opponent is playing is played in Rest Mode.",
  );
  assert.deepEqual(counter[0].keyword, { name: "Energy-Exhaust" });
  assert.equal(counter[1].kind, "counter:play");

  assert.deepEqual(keywordOf("Over Realm 4"), { name: "Over Realm", x: 4, dark: false });
  assert.deepEqual(keywordOf("Dark Over Realm 3"), { name: "Over Realm", x: 3, dark: true });
  assert.deepEqual(keywordOf("Arrival Red/Blue"), { name: "Arrival", colors: ["Red", "Blue"] });
  assert.deepEqual(keywordOf("Z-Stack 1"), { name: "Z-Stack", x: 1 });
  assert.deepEqual(keywordOf("Bond 2"), null);
  assert.deepEqual(orbsIn("{g}{g}, add 1 card"), { Green: 2 });
  assert.equal(parseSkills("[Auto][Bond 2] When this card attacks, draw 1 card.")[0].bond, 2);
  assert.equal(parseSkills("[Activate: Main][Limit 1] Draw 1 card.")[0].limit, 1);
}

// ── the keyword reference describes the keywords that exist ────────────────

{
  // `KEYWORDS` is keyed by the engine's own union, so a keyword the parser
  // learns without a description fails the typecheck. This is the other
  // direction: every tag the reference prints has to be a spelling the parser
  // reads back as that keyword, or the page teaches a wording no card parses.
  for (const { name, tag } of keywordTagSpellings()) {
    assert.ok(tagParsesTo(tag, name), `the keyword reference prints ${tag} for [${name}], which keywordOf reads as ${JSON.stringify(keywordOf(tagBody(tag)))}`);
  }
  // Every group in the chip row has something under it, and the groups
  // together account for every keyword — a group nothing is filed under, or a
  // keyword filed under none, would simply not be shown.
  const grouped = keywordsByGroup();
  assert.equal(
    grouped.reduce((n, g) => n + g.entries.length, 0),
    Object.keys(KEYWORDS).length,
    "every keyword belongs to exactly one group of the reference",
  );
  for (const g of grouped) assert.ok(g.entries.length > 0, `the reference has an empty group: ${g.label}`);
}

// ── filters and conditions ─────────────────────────────────────────────────

{
  const f = parseFilter("Blue <Baby> with an energy cost of 4");
  assert.deepEqual(f.colors, ["Blue"]);
  assert.deepEqual(f.characters, ["Baby"]);
  assert.equal(f.costMin, 4);
  assert.equal(f.costMax, 4);
  const g = parseFilter("yellow non-≪Great Ape≫ <Son Goku: Childhood> card with an energy cost of 3 or less");
  assert.deepEqual(g.notTraits, ["Great Ape"]);
  assert.deepEqual(g.characters, ["Son Goku: Childhood"]);
  assert.equal(g.costMax, 3);
  const baby: CardDef = {
    id: "X",
    name: "Baby",
    type: "BATTLE",
    colors: ["Blue"],
    energyCost: 4,
    zEnergyCost: null,
    power: 1,
    comboCost: 0,
    comboPower: 0,
    skill: null,
    characters: ["Baby"],
    traits: [],
  };
  assert.equal(matches(baby, f), true);
  assert.equal(matches({ ...baby, energyCost: 3 }, f), false);
  assert.equal(matches({ ...baby, colors: ["Red"] }, f), false);

  // 2-10-1-1 vs "in its character name". A bare <Son Goku> is not
  // <Son Goku : GT>; the phrase is what a card prints when it means both.
  // BT4-096 checked its own leader for one and, read as the other, granted
  // neither its +15000 nor its [Double Strike] — the whole skill did nothing.
  const gt: CardDef = {
    id: "SD5-01",
    name: "Golden Great Ape Son Goku",
    type: "LEADER",
    colors: ["Yellow"],
    energyCost: null,
    zEnergyCost: null,
    power: 10000,
    comboCost: null,
    comboPower: null,
    skill: null,
    characters: ["Son Goku: GT"],
    traits: ["Saiyan", "Goku's Lineage"],
  };
  const part = parseFilter("≪Goku's Lineage≫ with <Son Goku> in its character name");
  assert.deepEqual(part.characters, [], "the phrase takes the token out of the exact list");
  assert.deepEqual(part.charactersIncluding, ["Son Goku"]);
  assert.equal(matches(gt, part), true, "BT4-096 sees its own leader");
  assert.equal(matches(gt, parseFilter("<Son Goku> card")), false, "a bare token is still exact (2-10-1-1)");

  // One choice with two ways to satisfy it, not two requirements (BT25-068).
  const either = parseFilter("<Pan> cards and/or cards with <GT> in their character names");
  assert.deepEqual(either.characters, ["Pan"]);
  assert.deepEqual(either.charactersIncluding, ["GT"]);
  assert.equal(matches({ ...baby, characters: ["Pan"] }, either), true);
  assert.equal(matches({ ...baby, characters: ["Son Goku: GT"] }, either), true);
  assert.equal(matches({ ...baby, characters: ["Vegeta"] }, either), false);

  // "without <Turles> in their character names" (BT24-099) excludes; read as a
  // positive it would have required the one card the sentence rules out.
  const without = parseFilter("yellow ≪Turles Crusher Corps≫ cards with energy costs of 1 and without <Turles> in their character names");
  assert.deepEqual(without.charactersIncluding, []);
  assert.deepEqual(without.notCharactersIncluding, ["Turles"]);
  assert.equal(matches({ ...baby, characters: ["Turles: Xeno"], traits: ["Turles Crusher Corps"], colors: ["Yellow"], energyCost: 1 }, without), false);

  // The same measure against the printed card name (EX23-49, BT3-017).
  const inName = parseFilter("your Battle Cards with {SS4} in its card name");
  assert.deepEqual(inName.names, []);
  assert.deepEqual(inName.namesIncluding, ["SS4"]);
  assert.equal(matches({ ...baby, name: "SS4 Bardock, Prismatic Radiance" }, inName), true);
  assert.equal(matches({ ...baby, name: "Bardock, Prismatic Radiance" }, inName), false);
  assert.deepEqual(parseFilter("card whose card name includes {Baby}").namesIncluding, ["Baby"]);
  assert.deepEqual(parseFilter("Battle Card with a card name that includes {Supreme Kai}").namesIncluding, ["Supreme Kai"]);
  // "2 or more character names including <SH>" counts names rather than
  // looking inside one, and stays out of the substring reading.
  assert.deepEqual(parseFilter("Battle Cards with 2 or more character names including <SH>").charactersIncluding, []);

  // A filter written before these fields existed — from `card_rules`, or a
  // referee ruling in a saved game's action log — still reads.
  const legacy = { ...parseFilter("<Baby> card") } as Record<string, unknown>;
  for (const k of ["charactersIncluding", "notCharactersIncluding", "namesIncluding", "notNamesIncluding"]) delete legacy[k];
  assert.equal(matches(baby, legacy as unknown as ReturnType<typeof parseFilter>), true, "an old stored filter still matches");

  assert.equal(parseCondition("When your life is at 4 or less").lifeAtMost, 4);
  assert.equal(parseCondition("If there is a total of 4 or more energy between you and your opponent").totalEnergyAtLeast, 4);
  assert.equal(parseCondition("When you have a Blue/Green multicolor card in your energy and your life is at 6 or less").recognised, false);
  assert.equal(parseCondition("When your opponent's life is at 3 or less").opponentLifeAtMost, 3);
}
