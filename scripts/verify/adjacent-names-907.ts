/**
 * #907, census round 5, the adjacent-names misread (18 Oct 2026). Two names (or two traits) written side by
 * side with nothing between them - "if your Leader is a red <Son Goku: GT> <Vegeta: GT> card" (BT18-010 and
 * six more), "[Z-Awaken]: Yellow <Son Goku> <Vegeta>" (BT20-086), "play up to 1 <Baby> <Janemba> Battle Card"
 * (P-388), "≪Great Ape≫ ≪Bardock's Crew≫ cards" (BT18-106), "both ≪Saiyan≫ and ≪Universe 6≫" (BT15-059) - were
 * read as ANY-of, the same as "<A> or <B>". They are ALL-of.
 *
 * Evidence (see the glossary entry "Names side by side"):
 *  - Rule Manual 2-10-4 / 2-11-3: a card can have several character names and several special traits.
 *  - The catalog: the Leader BT18-001 "Son Goku & Vegeta" has the character names [Son Goku: GT, Vegeta: GT]
 *    and BT19-001 has [Son Goku, Vegeta, Trunks: Future]; a Z-Awaken line names the one Leader it sits on.
 *  - The official FAQ for BT22-138 calls that Leader "a red <Son Goku/Vegeta/Trunks: Future> card" and a Z-Leader
 *    that cannot stack on it "a red <Son Goku>-only card"; the FAQ for BT2-070 says "<Android 17> and <Android
 *    18>" gives +5000 to cards with *either*, so any-of is always written with a word between.
 *  - The same release writes the any-of next to it: BT19-010 "a <Vegeta> or <Trunks: Future> card" inside a
 *    condition on "a red <Son Goku> <Vegeta> <Trunks: Future> card".
 *
 * Rules engine only; nothing reads the database.
 */
import assert from "node:assert/strict";
import { compileSkill, parseSkills } from "./harness";
import { backCharactersOf } from "../../src/lib/arena/text/cards";
import { emptyFilter, matches, parseFilter } from "../../src/lib/arena/text/filters";
import { describeFilter, describeScript } from "../../src/lib/arena/vm/script";
import type { CardDef } from "../../src/lib/arena/types";

const def = (patch: Partial<CardDef>): CardDef =>
  ({ id: "X", name: "X", type: "BATTLE", colors: ["Red"], energyCost: 3, zEnergyCost: null, power: 10000, comboCost: 0, comboPower: 5000, skill: null, characters: [], traits: [], back: null, ...patch }) as CardDef;
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

// ── names side by side are all of them ───────────────────────────────────────
{
  const two = parseFilter("a red <Son Goku: GT> <Vegeta: GT> card");
  assert.deepEqual([two.charactersAll, two.characters, two.colors], [["Son Goku: GT", "Vegeta: GT"], [], ["Red"]], "BT18-010: both names");
  const three = parseFilter("red <Son Goku> <Vegeta> <Trunks: Future> Leader");
  assert.deepEqual(three.charactersAll, ["Son Goku", "Vegeta", "Trunks: Future"], "BT19-030: three names, one Leader");
  assert.equal(three.type, "LEADER");
  const zawaken = parseFilter("Yellow <Son Goku> <Vegeta> card");
  assert.deepEqual(zawaken.charactersAll, ["Son Goku", "Vegeta"], "BT20-086's Z-Awaken line");
  const traits = parseFilter("yellow ≪Great Ape≫ ≪Bardock's Crew≫ cards with different character names");
  assert.deepEqual([traits.traitsAll, traits.traits], [["Great Ape", "Bardock's Crew"], []], "BT18-106: both traits");
  const both = parseFilter("Battle Cards with both ≪Saiyan≫ and ≪Universe 6≫");
  assert.deepEqual([both.traitsAll, both.traits], [["Saiyan", "Universe 6"], []], "BT15-059: 'both ≪A≫ and ≪B≫' is the same list");

  // a word between them is any-of, as it always was
  for (const t of ["a red <Son Goku> or <Vegeta> card", "a red <Son Goku> and/or <Vegeta> card", "a red <Son Goku>, <Vegeta> card"]) {
    const f = parseFilter(t);
    assert.deepEqual([f.characters, f.charactersAll], [["Son Goku", "Vegeta"], []], `${t}: any-of`);
  }
  const traitsOr = parseFilter("a blue ≪Saiyan≫ or ≪Earthling≫ card");
  assert.deepEqual([traitsOr.traits, traitsOr.traitsAll ?? []], [["Saiyan", "Earthling"], []]);
  // a negated name and a trait beside it are two things, not a pair
  const neg = parseFilter("a non-≪God≫ ≪Universe 7≫ card");
  assert.deepEqual([neg.notTraits, neg.traits, neg.traitsAll ?? []], [["God"], ["Universe 7"], []], "BT15-090 / P-548: one exclusion, one trait");
  const mixed = parseFilter("a blue ≪Universe 7≫ <Vegeta> card");
  assert.deepEqual([mixed.traits, mixed.characters, mixed.charactersAll], [["Universe 7"], ["Vegeta"], []], "a trait and a character were always both required");
  // "-only" keeps the list it was read as (#932, BT29-108)
  const only = parseFilter("a ≪Saiyan≫ ≪God≫-only card");
  assert.deepEqual([only.traits, only.traitsAll ?? [], only.onlyTraits], [["Saiyan", "God"], [], true]);
  // an older stored filter has no traitsAll at all and an empty filter still writes none
  assert.ok(!("traitsAll" in emptyFilter()));
}

// ── matching: the card has every name ───────────────────────────────────────
{
  const f = parseFilter("a red <Son Goku: GT> <Vegeta: GT> card");
  assert.equal(matches(def({ characters: ["Son Goku: GT", "Vegeta: GT"] }), f), true, "BT18-001: both");
  assert.equal(matches(def({ characters: ["Son Goku: GT"] }), f), false, "a Son Goku: GT leader alone is refused");
  assert.equal(matches(def({ characters: ["Vegeta: GT"] }), f), false, "a Vegeta: GT leader alone is refused");
  assert.equal(matches(def({ characters: ["Son Goku: GT", "Vegeta: GT"], colors: ["Blue"] }), f), false, "the colour still counts");
  const g = parseFilter("yellow ≪Great Ape≫ ≪Bardock's Crew≫ cards");
  assert.equal(matches(def({ colors: ["Yellow"], traits: ["Great Ape", "Saiyan", "Bardock's Crew"] }), g), true);
  assert.equal(matches(def({ colors: ["Yellow"], traits: ["Great Ape", "Saiyan"] }), g), false, "a Great Ape alone is refused");
  assert.equal(matches(def({ colors: ["Yellow"], traits: ["Bardock's Crew"] }), g), false);

  // a Z-Awaken lands on the Leader whose back side names both: the engine reads a back side's characters off its name
  const bothLeader = def({ type: "LEADER", characters: ["Son Goku: GT", "Vegeta: GT"], back: { name: "SS4 Son Goku & SS4 Vegeta, In It Together", power: 15000, skill: null } });
  const gokuLeader = def({ type: "LEADER", characters: ["Son Goku: GT"], back: { name: "SS4 Son Goku, Returned from Hell", power: 15000, skill: null } });
  const awaken = parseFilter("Red <Son Goku: GT> <Vegeta: GT>");
  assert.equal(matches({ ...bothLeader, characters: backCharactersOf(bothLeader) }, awaken), true, "BT18-003 awakens on BT18-001");
  assert.equal(matches({ ...gokuLeader, characters: backCharactersOf(gokuLeader) }, awaken), false, "and on no other Son Goku: GT Leader");
}

// ── the reading says what it means, and says it back ────────────────────────
{
  const anyOf = describeFilter(parseFilter("a red <Son Goku> or <Vegeta> card"));
  assert.match(anyOf, /<Son Goku> or <Vegeta>/, anyOf);
  assert.deepEqual(roundtrip(parseFilter(anyOf)), roundtrip(parseFilter("a red <Son Goku> or <Vegeta> card")), "any-of reads back as any-of");
  const traitsOr = describeFilter(parseFilter("a blue ≪Saiyan≫ or ≪Earthling≫ card"));
  assert.match(traitsOr, /≪Saiyan≫ or ≪Earthling≫/, traitsOr);
  assert.deepEqual(roundtrip(parseFilter(traitsOr)), roundtrip(parseFilter("a blue ≪Saiyan≫ or ≪Earthling≫ card")));
  const allTraits = parseFilter("yellow ≪Great Ape≫ ≪Bardock's Crew≫ cards");
  assert.deepEqual(roundtrip(parseFilter(describeFilter(allTraits))), roundtrip(allTraits), "all-of traits read back as all-of");
  const allChars = parseFilter("red <Baby> <Janemba> Battle Cards");
  assert.deepEqual(roundtrip(parseFilter(describeFilter(allChars))), roundtrip(allChars), "all-of characters read back as all-of");

  const leader = describeScript(compileSkill(parseSkills("[Permanent] If your Leader is a red <Son Goku: GT> <Vegeta: GT> card, reduce the energy cost of this card in your hand by 3.")[0]).ops, { permanent: true });
  assert.match(leader, /Red <son goku: gt> <vegeta: gt>/i, leader);
  const either = describeScript(compileSkill(parseSkills("[Permanent] If your Leader is a red <Son Goku: GT> or <Vegeta: GT> card, reduce the energy cost of this card in your hand by 3.")[0]).ops, { permanent: true });
  assert.match(either, /<son goku: gt> or <vegeta: gt>/i, either);
}

// ── the printed skills (the compiler lower-cases the names it stores) ──────────────────────────────────────────────────────
function find(node: unknown, key: string, out: unknown[] = []): unknown[] {
  if (Array.isArray(node)) for (const x of node) find(x, key, out);
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === key && Array.isArray(v) && v.length) out.push(v);
      find(v, key, out);
    }
  }
  return out;
}
{
  const p382 = compileSkill(parseSkills("[Union Absorb][Once per turn] If your Leader Card is a red ≪Machine Mutant≫ card and you choose 1 of your <Vegeta: GT> cards and place it under this card: Play up to 1 <Vegeta: GT> <Baby> Battle Card with an energy cost of 4 from your deck on top of this card, then shuffle your deck.")[0]);
  assert.deepEqual(p382.unsupported, []);
  assert.deepEqual(find(p382.ops, "charactersAll"), [["vegeta: gt", "baby"]], "P-382: a Baby Vegeta, not any Baby or any Vegeta");
  const bt15059 = compileSkill(parseSkills("[Activate: Main]{u}, if your Leader Card is a ≪Universe 6≫ card: Choose all of your Battle Cards with both ≪Saiyan≫ and ≪Universe 6≫ and they get +5000 power for the turn.")[0]);
  assert.deepEqual(bt15059.unsupported, []);
  assert.deepEqual(find(bt15059.ops, "traitsAll"), [["Saiyan", "Universe 6"]], "BT15-059: a Saiyan from Universe 6 only");
  const bt31 = compileSkill(parseSkills("[Permanent] You can choose the specified Battle Cards in your Battle Area or your Drop when choosing cards to use with the [Union] skill of a red <Veku> or <Gogeta> card from your hand. If you do, send the chosen cards to their owner's Warp.")[0]);
  assert.deepEqual(find(bt31.ops, "characters"), [["Veku", "Gogeta"]], "BT31-001b keeps its 'or'");
  assert.deepEqual(find(bt31.ops, "charactersAll"), []);
}

console.log("adjacent names (#907 round 5): all-of for names and traits side by side, any-of with a word between, the reading says which");
