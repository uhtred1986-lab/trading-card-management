/**
 * #907 "if you do" (20-16-1): "the action in the previous sentence must be taken
 * as a necessary condition to do what follows". Whatever hangs on the words is
 * read from the action itself — an offer accepted *and carried out*, a compulsory
 * move that really moved the card, a voluntary replacement whose substitute ran
 * (9-10-3-1, 20-1-11) — and never from the words alone.
 *
 * Catalog text: the deckplanet feed, 18 Oct 2026. Synthetic fixtures isolate the
 * printed Auto; the compile checks use the printed text whole.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, IMPL, card, compileSkill, findG, parseSkills, playG, stagedG, zoneOf } from "./harness";
import type { EngineState, PlayerId } from "./harness";

const read = (text: string) => compileSkill(parseSkills(text)[0]);
const ids = (s: EngineState, p: PlayerId, area: Parameters<typeof zoneOf>[2]) => zoneOf(s, p, area).map((id) => s.cards[id].cardId);
const count = (s: EngineState, p: PlayerId, area: Parameters<typeof zoneOf>[2], cardId: string) => ids(s, p, area).filter((x) => x === cardId).length;

// ── compile: the printed texts read whole ─────────────────────────────────────
const PRINTED = {
  "TB1-042": "[Auto] When you play this card, you may reveal 1 ≪Universe 9≫ from your hand and place it at the bottom of your deck. If you do so, draw 2 cards.",
  "P-015": "[Auto] When you play this card, if your Leader Card is <Zamasu> or <Goku Black>, you may inflict 2 damage to your life. If you do so, choose up to 6 of your energy and switch them to Active Mode.",
  "EX03-11": "[Auto] When you play this card, if your Leader Card is <Zamasu> or <Goku Black> and you have 5 or more energy, you may inflict 2 damage to your life. If you do so, choose up to 4 of your energy and switch them to Active Mode.",
  "BT4-119": "[Auto] When you play this card, you may place it on the top of your deck. If you do so, choose up to 1 black Battle Card with 3000 power from your deck and play it, then shuffle your deck.",
  "BT15-066": "[auto] At the end of your turn, send this card to its owner's Warp. If you do, play up to 1 {Kaio-Ken Son Goku, Confronting Invasion} from your Warp.",
  "BT26-006": "[Permanent] If your Leader is a red card with both <Son Goku: GT> and <Android 18>, and your red <Son Goku: GT> card with an energy cost of 4 or less would leave the battle area, you may discard 1 card from your hand instead. If you do, remove this card from the game.",
  "BT18-120": "[Counter: Attack] Negate the attack. Additionally, if the attacking card is a ≪Frieza Clan≫ card, place 1 of your Battle Cards in its owner's Drop. If you do, draw 1 card.",
};
for (const [id, text] of Object.entries(PRINTED)) assert.deepEqual(read(text).unsupported, [], `${id} reads whole`);

// The offer owns the whole sentence it is printed in: "reveal … AND place it …" is one offer.
{
  const ops = read(PRINTED["TB1-042"]).ops;
  assert.equal(ops[0].op, "may");
  assert.deepEqual(ops.map((o) => o.op), ["may", "moveTo", "if"], "the picked card is moved outside the offer's question, and \"if you do\" asks about the pick");
  const cond = (ops[2] as { cond: { kind: string } }).cond;
  assert.equal(cond.kind, "chose", "TB1-042 reads the card actually picked");
}
// An independent second half goes *inside* the offer: declining takes neither.
{
  const ops = read("[Auto] When you play this card, you may discard 1 card from your hand and draw 1 card. If you do, draw 2 cards.").ops;
  assert.deepEqual(ops.map((o) => o.op), ["may", "if"]);
  assert.deepEqual((ops[0] as { ops: { op: string }[] }).ops.map((o) => o.op), ["discard", "draw"], "\"and draw 1 card\" is part of the offer");
  assert.deepEqual((ops[1] as { cond: unknown }).cond, { kind: "did", what: "may" });
}
// A sentence that merely follows an offer is not part of it.
{
  const ops = read("[Auto] When you play this card, you may discard 1 card from your hand. Draw 1 card.").ops;
  assert.deepEqual(ops.map((o) => o.op), ["may", "draw"], "a new sentence stays outside the offer");
}
// A compulsory move of this card is read off the board.
{
  const ops = read("[Auto] When you play this card, send this card to its owner's Warp. If you do, draw 2 cards.").ops;
  assert.deepEqual(ops.map((o) => o.op), ["moveTo", "if"]);
  assert.equal((ops[1] as { cond: { kind: string } }).cond.kind, "count");
}
// A voluntary replacement carries the rest of the sentence as part of its substitute.
{
  const ops = read("[Permanent] If this card would be KO'd, you may discard 1 card from your hand instead. If you do, draw 1 card.").ops;
  assert.equal(ops.length, 1);
  const replace = ops[0] as { op: string; optional?: boolean; with: { op: string }[] };
  assert.equal(replace.op, "replace");
  assert.equal(replace.optional, true);
  assert.deepEqual(replace.with.map((o) => o.op), ["discard", "draw"]);
}
// "with a combo cost of 1" has no filter to say it, so the rule is refused rather than widened to every card of the name (BT19-100).
{
  const sk = read("[Permanent] When a ≪Slug's Army≫ card with a combo cost of 1 would leave your Battle Area, you may place it in your Z-Energy instead. If you do, place 1 of your Z-Energy in its owner's Drop.");
  assert.ok(sk.unsupported.length > 0 && sk.ops.length === 0, "BT19-100 stays unread, with no over-broad replacement");
}

// ── play: the follow-up happens only when the action did ─────────────────────
DEFS.IYD_REV = card("IYD_REV", { energyCost: 0, power: 5000, skill: PRINTED["TB1-042"] });
DEFS.IYD_U9 = card("IYD_U9", { traits: ["Universe 9"], skill: null });
DEFS.IYD_DISC = card("IYD_DISC", { energyCost: 0, power: 5000, skill: "[Auto] When you play this card, you may discard 1 card from your hand and draw 1 card. If you do, draw 2 cards." });
DEFS.IYD_HURT = card("IYD_HURT", { energyCost: 0, power: 5000, skill: "[Auto] When you play this card, you may inflict 2 damage to your life. If you do so, draw 3 cards." });
DEFS.IYD_SEND = card("IYD_SEND", { energyCost: 0, power: 5000, skill: "[Auto] When you play this card, send this card to its owner's Warp. If you do, draw 2 cards." });
DEFS.IYD_TOP = card("IYD_TOP", { energyCost: 0, power: 5000, skill: "[Auto] When you play this card, you may place it on the top of your deck. If you do so, draw 2 cards." });
DEFS.IYD_PILE = card("IYD_PILE", { energyCost: 2, power: 5000, skill: "[Permanent] If this card would be KO'd, you may discard 1 card from your hand instead. If you do, draw 2 cards." });
DEFS.IYD_FILL = card("IYD_FILL", { skill: null });

function played(cardId: string, hand: string[]): EngineState {
  const s = stagedG({ hand: [cardId, ...hand] });
  return playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", cardId) });
}
const mode = (s: EngineState, index: number) => playG(s, { type: "chooseMode", player: "p1", index });

// TB1-042: reveal one, put it at the bottom, draw two — only if there is a card to reveal and it was put there.
{
  const none = played("IYD_REV", []);
  assert.equal(none.prompt.kind, "main", "no ≪Universe 9≫ in hand: nothing to offer");
  assert.equal(ids(none, "p1", "hand").length, 0, "and nothing was drawn");

  const one = played("IYD_REV", ["IYD_U9"]);
  assert.equal(one.prompt.kind, "chooseMode", "one match: the offer is made");
  const declined = mode(one, 1);
  assert.equal(declined.prompt.kind, "main");
  assert.deepEqual(ids(declined, "p1", "hand"), ["IYD_U9"], "declined: the card stays and nothing is drawn");

  let taken = mode(one, 0);
  if (taken.prompt.kind === "chooseCards") taken = playG(taken, { type: "choose", player: "p1", cards: [taken.prompt.choice.candidates[0]] });
  assert.equal(taken.prompt.kind, "main");
  assert.equal(count(taken, "p1", "hand", "IYD_U9"), 0, "taken: the card left the hand");
  assert.equal(ids(taken, "p1", "hand").length, 2, "and two cards were drawn");
  assert.equal(taken.cards[zoneOf(taken, "p1", "deck").slice(-1)[0]].cardId, "IYD_U9", "at the bottom of the deck");

  // "1 card" means one card: with two matches only the picked one goes.
  const two = played("IYD_REV", ["IYD_U9", "IYD_U9"]);
  let both = mode(two, 0);
  assert.equal(both.prompt.kind, "chooseCards", "two matches: the player picks which one");
  both = playG(both, { type: "choose", player: "p1", cards: [both.prompt.kind === "chooseCards" ? both.prompt.choice.candidates[0] : ""] });
  assert.equal(count(both, "p1", "hand", "IYD_U9"), 1, "only the picked card was put at the bottom");
}

// "You may discard 1 card and draw 1 card. If you do, draw 2": declining takes neither half.
{
  const none = played("IYD_DISC", []);
  assert.equal(none.prompt.kind, "main", "an empty hand cannot take the offer");
  assert.equal(ids(none, "p1", "hand").length, 0);

  const s = played("IYD_DISC", ["IYD_FILL"]);
  assert.equal(s.prompt.kind, "chooseMode");
  const declined = mode(s, 1);
  assert.deepEqual(ids(declined, "p1", "hand"), ["IYD_FILL"], "declined: no discard and no draw (the draw is part of the offer)");

  let taken = mode(s, 0);
  if (taken.prompt.kind === "chooseCards") taken = playG(taken, { type: "choose", player: "p1", cards: [taken.prompt.choice.candidates[0]] });
  assert.equal(ids(taken, "p1", "hand").length, 3, "taken: discard 1, draw 1, then draw 2 for the \"if you do\"");
  assert.equal(count(taken, "p1", "drop", "IYD_FILL"), 1);
}

// "You may inflict 2 damage to your life. If you do": no life, no offer, no follow-up.
{
  const s = played("IYD_HURT", []);
  assert.equal(s.prompt.kind, "chooseMode");
  const declined = mode(s, 1);
  assert.equal(ids(declined, "p1", "hand").length, 0, "declined: no damage, no draw");
  const life = zoneOf(s, "p1", "life").length;
  const taken = mode(s, 0);
  assert.equal(zoneOf(taken, "p1", "life").length, life - 2, "taken: two cards from the Life Area");
  assert.equal(ids(taken, "p1", "hand").length, 2 + 3, "…into the hand, and three more drawn");

  const empty = stagedG({ hand: ["IYD_HURT"] });
  while (zoneOf(empty, "p1", "life").length) zoneOf(empty, "p1", "drop").push(zoneOf(empty, "p1", "life").pop()!);
  const noLife = playG(empty, { type: "play", player: "p1", card: findG(empty, "p1", "hand", "IYD_HURT") });
  assert.equal(noLife.prompt.kind === "chooseMode", false, "with no life there is nothing to take, so nothing to offer");
  assert.equal(ids(noLife, "p1", "hand").length, 0, "and no draw");
}

// A compulsory move of this card.
{
  const s = played("IYD_SEND", []);
  assert.equal(count(s, "p1", "warp", "IYD_SEND"), 1, "the card went to the Warp");
  assert.equal(ids(s, "p1", "hand").length, 2, "and the follow-up drew two");
}

// "You may place it on the top of your deck. If you do so, draw 2": the card left the Battle Area for the top of the deck.
{
  const s = played("IYD_TOP", []);
  assert.equal(s.prompt.kind, "chooseMode");
  const declined = mode(s, 1);
  assert.equal(count(declined, "p1", "battle", "IYD_TOP"), 1, "declined: the card stays in play");
  assert.equal(ids(declined, "p1", "hand").length, 0);
  const taken = mode(s, 0);
  assert.equal(count(taken, "p1", "battle", "IYD_TOP"), 0);
  // Placed on the top, it is the first card the draw takes back.
  assert.equal(ids(taken, "p1", "hand").length, 2, "and two drawn");
  assert.equal(count(taken, "p1", "hand", "IYD_TOP"), 1, "the first of them the card just placed on the top");
}

// ── voluntary replacement: the tail runs only if the substitute did ──────────
function killed(hand: string[]): { s: EngineState; target: string } {
  let s = stagedG({ battle: ["IYD_PILE"], hand, oppHand: ["KILLER"], oppEnergy: ["V1"] });
  const target = findG(s, "p1", "battle", "IYD_PILE");
  s = playG(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  s = playG(s, { type: "play", player: "p2", card: findG(s, "p2", "hand", "KILLER") }, { type: "choose", player: "p2", cards: [target] });
  return { s, target };
}
{
  const { s, target } = killed(["IYD_FILL"]);
  assert.equal(s.prompt.kind, "replaceMove", "the voluntary replacement is offered");
  const declined = playG(s, { type: "chooseMode", player: "p1", index: 1 });
  assert.ok(zoneOf(declined, "p1", "drop").includes(target), "declined: the card is KO'd");
  assert.equal(ids(declined, "p1", "hand").length, 1, "and nothing was discarded or drawn");

  let taken = playG(s, { type: "chooseMode", player: "p1", index: 0 });
  if (taken.prompt.kind === "chooseCards") taken = playG(taken, { type: "choose", player: "p1", cards: [taken.prompt.choice.candidates[0]] });
  assert.ok(zoneOf(taken, "p1", "battle").includes(target), "taken: the card stays");
  assert.equal(count(taken, "p1", "drop", "IYD_FILL"), 1, "the discard was paid");
  assert.equal(ids(taken, "p1", "hand").length, 2, "and \"if you do\" drew two");

  const unpayable = killed([]);
  assert.notEqual(unpayable.s.prompt.kind, "replaceMove", "an empty hand cannot take the offer");
  assert.ok(zoneOf(unpayable.s, "p1", "drop").includes(unpayable.target), "the KO happens");
  assert.equal(ids(unpayable.s, "p1", "hand").length, 0, "and nothing was drawn");
}

// ── BT18-120: the attacking card, then a Battle Card of yours, then "if you do" ─
DEFS.IYD_CNT = card("IYD_CNT", { type: "EXTRA", colors: ["Blue"], energyCost: 0, power: null, comboCost: null, comboPower: null, skill: PRINTED["BT18-120"] });
DEFS.IYD_FRIEZA = card("IYD_FRIEZA", { power: 5000, energyCost: 1, traits: ["Frieza Clan"], skill: null });
DEFS.IYD_PLAIN = card("IYD_PLAIN", { power: 5000, energyCost: 1, skill: null });
DEFS.IYD_MINE = card("IYD_MINE", { power: 5000, energyCost: 1, skill: null });
function countered(attacker: string, mine: string[]): EngineState {
  let s = stagedG({ hand: ["IYD_CNT"], battle: mine, oppBattle: [attacker] });
  s = playG(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  const attack = IMPL.legalActions(CTX, s).find((l) => l.label.startsWith("Attack") && l.label.includes(attacker) && l.label.includes("L-RED"));
  assert.ok(attack, "the foe can attack your Leader");
  s = playG(s, attack.action);
  for (let i = 0; i < 20 && s.prompt.kind !== "main" && s.battle; i++) {
    const q = s.prompt as { kind: string; player: PlayerId; candidates?: string[]; choice?: { candidates: string[]; min: number } };
    if (q.kind === "counter") s = playG(s, { type: "counter", player: q.player, card: q.player === "p1" ? (q.candidates ?? []).find((c) => s.cards[c].cardId === "IYD_CNT") ?? null : null });
    else if (q.kind === "chooseCards") s = playG(s, { type: "choose", player: q.player, cards: q.choice!.candidates.slice(0, Math.max(q.choice!.min, 1)) });
    else s = playG(s, { type: "pass", player: q.player });
  }
  return s;
}
{
  const hurt = (s: EngineState) => count(s, "p1", "drop", "IYD_MINE");
  const frieza = countered("IYD_FRIEZA", ["IYD_MINE"]);
  assert.equal(frieza.prompt.kind, "main");
  assert.equal(hurt(frieza), 1, "a ≪Frieza Clan≫ attacker: one of your Battle Cards is placed in the Drop…");
  assert.equal(ids(frieza, "p1", "hand").length, 1, "…and \"if you do\" drew a card");
  const plain = countered("IYD_PLAIN", ["IYD_MINE"]);
  assert.equal(hurt(plain), 0, "any other attacker: nothing is placed");
  assert.equal(ids(plain, "p1", "hand").length, 0, "and nothing is drawn");
  const alone = countered("IYD_FRIEZA", []);
  assert.equal(ids(alone, "p1", "hand").length, 0, "with no Battle Card to place the placement did not happen, so nothing is drawn");
}

console.log("if-you-do-907: offers, compulsory moves and voluntary replacements gate their \"if you do\" on the action");
