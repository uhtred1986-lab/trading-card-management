/**
 * errata-official-1 (2 Nov 2026): Bandai's official errata page, applied in `src/lib/catalog/errata.ts`
 * and never by UPDATE. Representative corrections, from the catalog text as the deckplanet feed and the
 * 2 Nov 2026 catalog snapshot both print it, through `correctSkillText`: the corrected text carries the
 * page's "After" wording (docs/rules/errata-official.json), no longer the "Before", is idempotent, and
 * drift is reported (`unmatchedCorrections`). Then what the compiler and deck legality read from a few.
 *
 * The page's own spelling ("[Activate : Main]", "●", "《Saiyan》", "’") is the catalog's here
 * ("[Activate: Main]", "{y}", "≪Saiyan≫", "'"); `norm` maps the one onto the other for comparison.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { card } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { hasKeyword } from "../../src/lib/decks/cardRules";
import { CORRECTIONS, correctSkillText, unmatchedCorrections } from "../../src/lib/catalog/errata";

const official = (JSON.parse(fs.readFileSync(path.resolve("docs/rules/errata-official.json"), "utf8")) as { errata: { id: string; before: string; after: string }[] }).errata;
const norm = (s: string) =>
  s.replace(/[’‘]/g, "'").replace(/《/g, "≪").replace(/》/g, "≫").replace(/[〈＜]/g, "<").replace(/[〉＞]/g, ">").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/<br>|\[br\]/g, " ").replace(/\s+:/g, ":").replace(/\s+/g, " ").trim();
const officialOf = (id: string) => official.find((e) => e.id === id)!;

// ── 0. the snapshot itself: every entry has its text (the page heads newer ones "Before (Front)") ──
assert.equal(official.length, 161, "the 2 Nov 2026 page lists 161 errata");
assert.deepEqual(official.filter((e) => !e.before.trim() || !e.after.trim()).map((e) => e.id), [], "no entry with empty before/after (rules-sources reads the per-side columns)");

// ── 1. the corrections: catalog text -> official After wording ─────────────────────────────────
/** [card, catalog text (front, back), the page's After phrase, the page's Before phrase it replaces] */
const CASES: { id: string; front: string; back?: string; after: string[]; before: string[] }[] = [
  { id: "BT1-053", front: "[Activate: Battle] Choose up to 1 of your cards. It gains +5000 power for the duration of the turn. Then, choose up to 2 of your energy and switch them to Active Mode.",
    after: ["[Activate: Battle] If it's your opponent's turn: Choose up to 1 of your cards."], before: ["[Activate: Battle] Choose up to 1 of your cards."] },
  { id: "BT11-030", front: "[Counter: Attack] If your Leader Card is red: Negate the attack. You may choose 1 card in your hand and discard it. If you do, choose one—<br>・ Your opponent can't attack with Battle Cards with 20000 power or more for the turn.<br>・ Your opponent can't attack with Unison Cards with 20000 power or more for the turn.",
    after: ["can't attack with Battle Cards with 30000 power or more for the turn", "can't attack with Unison Cards with 30000 power or more for the turn"], before: ["20000 power"] },
  { id: "BT26-097", front: "[Deflect]\n[br]\n[Swap 5] Yellow <Son Gohan: Childhood> card with an energy cost of 5 and 20000 power.\n[br]\n[Auto] When this card attacks, play up to 1 yellow Battle Card with an original energy cost of 1 from your hand, then place this card face-up in your Z-Deck at the end of the battle.\n[br]\n[Activate: Main]{y}, if your Leader is a yellow <Son Gohan: Childhood> card and you have 2 or more energy: Play this card from your hand.",
    after: ["if your Leader's back side is a yellow <Son Gohan: Childhood> card and you have 2 or more energy: Play this card from your hand."], before: ["if your Leader is a yellow"] },
  // A new [Permanent] in front of the card's only skill.
  { id: "P-177", front: "[Auto] If your Leader Card is red: When you play this card from your hand, if your opponent has 2 or more energy in Active Mode, your opponent reveals their hand, and you choose up to 1 Battle Card from it with 20000 power or less and place it in your opponent's Drop Area.",
    after: ["[Permanent] This card can't be played by skills from any area.", "[Auto] If your Leader Card is red: When you play this card from your hand"], before: [] },
  // A skill struck from the card.
  { id: "BT21-097", front: "[Counter: Attack][Limit 1] If your Leader is a mono-green ≪Saiyan≫: Negate the attack. Additionally, if your life is at 4 or less, you may discard 1 card from your hand. If you do, your opponent can't attack for the turn unless they add 1 card from their hand to their Z-Energy.<br>[Permanent] You may activate this card's [Counter] skill from your hand without paying its energy cost by discarding 1 green card from your hand.<br>[Auto] If your Leader is a green &lt;Son Gohan: Childhood&gt;: When you activate this card's [Counter] skill from your hand, draw 1 card.",
    after: ["by discarding 1 green card from your hand."], before: ["[Auto] If your Leader is a green <Son Gohan: Childhood>"] },
  // "Now considered to have [Super Combo]": the keyword is written into the text deck legality reads.
  { id: "BT1-100", front: "[Auto] When you Combo with this card, if your Leader Card is yellow and your life is 4 or less, draw 1 card and add +10000 to this card's Combo for the duration of the turn.",
    after: ["[Super Combo]"], before: [] },
  // An orb price the page adds ("● : If …:"), in the catalog's form of an orb price with a condition.
  { id: "BT11-133", front: "[Unique]<br>[Activate: Main] If your Leader Card is a &lt;Dark Broly&gt; card and you send 6 black Battle Cards other than this card from your Drop Area to your Warp: Play this card from your Drop Area.<br>[Auto] When this card is played, send up to 1 Battle Card from your opponent's Drop Area to their Warp, then your opponent chooses 1 card in their hand and sends it to their Warp; you can't play copies of this card for the turn.",
    after: ["[Activate: Main]{b}, if your Leader Card is a <Dark Broly> card and you send 6 black Battle Cards"], before: ["[Activate: Main] If your Leader Card"] },
  { id: "P-394", front: "[activate: main][sparking 5]{r}, if your Leader Card is a red ≪Universe 7≫ card and you send this card from your Drop Area to your Warp: Your Leader Card gains [invoker] until the end of your next turn.",
    after: ["[sparking 5]{r}{r}{u}, if your Leader Card is a red ≪Universe 7≫ card"], before: ["[sparking 5]{r}, if"] },
  // A keyword line removed and the [Auto] reworded around it.
  { id: "BT9-137", front: "[Quadruple Strike]<br>[Ultimate]<br>[Deflect]<br>[Energy-Exhaust]<br>[Successor]<br>[Auto] If you have 5 or more energy: When you play this card, choose up to 3 cards in your opponent's hand, place them in their Drop Area, and this card gains [Dual Attack] for the duration of the turn.",
    after: ["When this card is played, choose up to 3 cards in your opponent's hand and discard them, and this card gains [Quadruple Strike] and [Dual Attack] for the turn."], before: ["[Quadruple Strike] [Ultimate]", "place them in their Drop Area"] },
  // Both sides; an appended sentence on the front only (the lookahead keeps it from being added twice).
  { id: "P-028",
    front: "[Permanent] When you activate an Extra Card, you may choose 1 card in your life and add it to your hand. If you do, reduce the energy cost of that Extra Card by 1 for the duration of the turn. If this reduces the energy cost of that Extra Card to less than 1, you may activate the card without paying the specified cost.<br>[Awaken] When your life is at 4 or less: You may draw 2 cards and flip this card over.",
    back: "[Permanent] When you activate an Extra Card, you may choose 1 card in your life and add it to your hand. If you do, reduce the energy cost of that Extra Card by 2 for the duration of the turn. If this reduces the energy cost of that Extra Card to less than 1, you may activate the card without paying the specified cost.<br>[Auto] When this card attacks, draw 1 card.",
    after: ["[Permanent] During your opponent's turn, when you activate an Extra Card", "If you use this skill to add a card in your life to your hand, negate this skill for the duration of the turn."], before: [] },
  // Three pairs on one card, both sides.
  { id: "SD14-01",
    front: "[Permanent] You can only play mono-black Battle Cards.<br>[Activate: Main][Once per turn][Burst 5] Draw 1 card.<br>[Awaken] When your life is at 4 or less or you have 20 or more cards in your Drop Area: You may draw 1 card, switch up to 1 of your energy to Active Mode, add cards from your life to your hand until you have 6 cards in your life, and flip this card over.",
    back: "[Permanent] You can only play mono-black Battle Cards.<br>[Permanent][Sparking 20] (This skill takes effect when you have 20 or more cards in your Drop Area.) If you would lose the game by running out of cards in your deck, shuffle your Drop Area into your deck instead.<br>[Activate: Main][Once per turn] Draw 1 card, place 5 cards from the top of your deck in your Drop Area, then choose up to 1 of your black Unison Cards and it gains [Double Strike] for the turn.",
    after: ["[Permanent] You can't play non-black Battle Cards.", "[Burst 3] Draw 1 card.", "Draw 1 card, place 3 cards from the top of your deck in your Drop Area"], before: ["You can only play mono-black Battle Cards", "[Burst 5]", "place 5 cards"] },
];
const fixed: Record<string, { front: string; back: string | null }> = {};
for (const c of CASES) {
  const e = officialOf(c.id);
  assert.ok(CORRECTIONS[c.id], `${c.id}: corrected in CORRECTIONS, not in the database`);
  const front = correctSkillText(c.id, c.front)!, back = c.back ? correctSkillText(c.id, c.back) : null;
  fixed[c.id] = { front, back };
  const both = norm(`${front} ${back ?? ""}`);
  for (const a of c.after) {
    assert.ok(both.includes(norm(a)), `${c.id}: the corrected text carries "${a}"`);
  }
  for (const b of c.before) assert.ok(!both.includes(norm(b)), `${c.id}: the corrected text no longer carries "${b}"`);
  assert.notEqual(norm(e.before), norm(e.after), `${c.id}: the page's Before and After differ`);
  assert.equal(correctSkillText(c.id, front), front, `${c.id}: applying twice changes nothing (front)`);
  if (back) assert.equal(correctSkillText(c.id, back), back, `${c.id}: applying twice changes nothing (back)`);
  const source = [c.front, c.back].filter((t): t is string => !!t);
  assert.deepEqual(unmatchedCorrections(new Map([[c.id, source]])), [], `${c.id}: every pair matches the catalog text`);
  assert.equal(unmatchedCorrections(new Map([[c.id, [front, back].filter((t): t is string => !!t)]])).length, CORRECTIONS[c.id].length, `${c.id}: reported once the source is fixed upstream`);
}
// The page's own After, sentence for sentence, where the erratum rewrites whole sentences (BT26-097's
// one orb is yellow: the page prints "●", the catalog "{y}").
for (const id of ["BT1-053", "BT26-097", "P-177", "BT9-137"]) {
  const page = norm(officialOf(id).after).replace(/●/g, "{y}");
  const ours = norm(`${fixed[id].front} ${fixed[id].back ?? ""}`);
  const sentences = page.split(/(?<=\.)\s+/).filter((s) => s.length > 30);
  assert.ok(sentences.length > 0, `${id}: the page's After has sentences to compare`);
  for (const sentence of sentences) assert.ok(ours.includes(sentence), `${id}: carries the page's "${sentence}"`);
}
// Line breaks or double spaces in the source cannot make one miss.
assert.match(correctSkillText("BT11-030", "with  20000 power or more\nfor the turn")!, /30000 power or more\s+for the turn/);
assert.equal(correctSkillText("OTHER-1", "[Activate: Battle] Choose up to 1 of your cards."), "[Activate: Battle] Choose up to 1 of your cards.", "card-specific: another card's text is untouched");

// ── 2. what the compiler and deck legality now read ─────────────────────────────────────────
const recs = (id: string, o: Parameters<typeof card>[1] = {}) => skillRecords(card(id, { skill: fixed[id].front, ...(fixed[id].back ? { back: { name: id + "b", power: 10000, skill: fixed[id].back } } : {}), ...o }));
// BT1-053: the whole skill is gated on the opponent's turn.
assert.deepEqual(recs("BT1-053", { type: "EXTRA" })[0].unread, []);
assert.match(recs("BT1-053", { type: "EXTRA" })[0].reads, /^if it is your opponent's turn: /);
// P-177: two skills now — the [Permanent] is #0 and the [Auto] moves to #10.
assert.deepEqual(recs("P-177").map((r) => [r.skillIndex, r.kind]), [[0, "permanent"], [10, "auto"]]);
// BT21-097: no [Auto] left.
assert.ok(!recs("BT21-097", { type: "EXTRA", colors: ["Green"] }).some((r) => r.kind === "auto"), "BT21-097: the struck [Auto] is gone");
// BT1-100: [Super Combo] counts toward the deck's limit of 4 (legality reads the leading tags).
assert.equal(hasKeyword({ skill: CASES.find((c) => c.id === "BT1-100")!.front }, "Super Combo"), false);
assert.equal(hasKeyword({ skill: fixed["BT1-100"].front }, "Super Combo"), true);
// BT11-133: one price — {b}, the Leader condition and the six cards sent to the Warp.
const b133 = recs("BT11-133", { colors: ["Black"] }).find((r) => r.kind === "activate:main")!;
assert.deepEqual(b133.cost!.orbs, { Black: 1 });
assert.ok(b133.cost!.condition, "BT11-133: the Leader condition is part of the price");
assert.equal((b133.cost!.program![0] as { sel: { count: number } }).sel.count, 6);
assert.deepEqual(b133.unread, []);
// P-394: red, red, blue.
assert.deepEqual(recs("P-394")[0].cost!.orbs, { Red: 2, Blue: 1 });
// BT9-137: [Quadruple Strike] is granted by the [Auto], no longer printed on its own.
assert.equal(hasKeyword({ skill: fixed["BT9-137"].front }, "Quadruple Strike"), false);
const grants = (recs("BT9-137", { colors: ["Black"] }).find((r) => r.kind === "auto")!.ops as { op: string; keyword?: { name: string; x?: number }; until?: string }[]).filter((o) => o.op === "grant");
assert.deepEqual(grants.map((g) => [g.keyword!.name, g.keyword!.x, g.until]), [["Strike", 4, "turn"], ["Attack", 2, "turn"]], "BT9-137: [Quadruple Strike] and [Dual Attack] for the turn");
// SD14-01: non-black is barred, so a black multicolour card may be played.
assert.match(recs("SD14-01", { type: "LEADER", colors: ["Black"] })[0].reads, /you can't play non-black battle card/);

// ── 3. the eight errata-official-1 held back are applied since errata-official-2 (scripts/verify/errata-official-2.ts) ──
for (const id of ["BT7-125", "BT7-126", "BT7-127", "BT7-128", "BT7-129", "BT22-001", "BT24-096", "BT15-068"]) assert.ok(CORRECTIONS[id], `${id}: corrected since errata-official-2`);

console.log(`errata-official-1: ${CASES.length} official errata through correctSkillText (After wording carried, Before gone, idempotent, drift reported), compiler and legality readings of 8`);
