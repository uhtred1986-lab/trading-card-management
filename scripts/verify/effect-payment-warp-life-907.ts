/**
 * #907, the second batch of unread "if you do" clauses (after #992): three
 * structures that share the same need — an action the player takes during
 * resolution, and a follow-up that runs only when the action was done.
 *
 *  (a) Effect-time energy payment: "you may pay {u}{u}. If you do, …"
 *      (BT12-042, BT13-057, P-459, P-389). Energy is paid by switching it to
 *      Rest Mode (5-5-2-1, 3-8-2), the coloured part with energy of that colour;
 *      a payment the player cannot meet is no offer, so no follow-up (20-16-1).
 *  (b) "send this card and 1 card from your hand to your Warp" (BT4-036,
 *      BT4-037; the same pair as a price in BT31-019): one action, two cards,
 *      all of it or none of it.
 *  (c) "…if you would reveal this card from your life to add it to your hand,
 *      you may … instead" (BT10-036, BT10-040, BT10-047, P-235, P-454, SD18-04):
 *      a 9-10 replacement on the damage step (21-3-2) about the printing card
 *      only, valid while it lies in the Life Area (9-1-3-3).
 *
 * Catalog text: the deckplanet feed, 18 Oct 2026. Synthetic fixtures isolate the
 * printed Auto; the compile checks use the printed text whole.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, IMPL, actsG, card, compileSkill, findG, parseSkills, playG, stageMoveG, stagedG, zoneOf } from "./harness";
import type { EngineState, PlayerId } from "./harness";
import { leaderOf } from "../../src/lib/arena/engine-state";

const read = (text: string) => compileSkill(parseSkills(text)[0]);
const ids = (s: EngineState, p: PlayerId, area: Parameters<typeof zoneOf>[2]) => zoneOf(s, p, area).map((id) => s.cards[id].cardId);
const count = (s: EngineState, p: PlayerId, area: Parameters<typeof zoneOf>[2], cardId: string) => ids(s, p, area).filter((x) => x === cardId).length;
const mode = (s: EngineState, index: number) => playG(s, { type: "chooseMode", player: "p1", index });
/** Answer pending card choices with the first candidate each time (the engine asks for an exact count one card at a time), at most `n` of them. */
const pick = (s: EngineState, n = 1): EngineState => {
  for (let i = 0; i < n && s.prompt.kind === "chooseCards"; i++) s = playG(s, { type: "choose", player: "p1", cards: s.prompt.choice.candidates.slice(0, 1) });
  return s;
};

// ── compile: the printed texts read whole ─────────────────────────────────────
const PRINTED = {
  "BT12-042": "[auto] If you have 3 or more energy: When this card is removed from your Battle Area by an opponent's skill or KO'd, activate this skill. At the start of your next Main Phase, you may pay {u}{u}. If you do, choose up to 1 blue <Gogeta> card in your hand with an energy cost of 5 and play it.",
  "BT13-057": "[auto] If your Leader Card is a blue <Vegito> card: When this card is KO'd by your opponent's attack, activate this skill. At the start of your next Main Phase, if you don't have a Unison Card in play, you may pay {u}. If you do, choose up to 1 {Gogeta, Pursuit of Power} in your hand and play it with a marker on it.",
  "P-459": "[auto] When this card attacks, it gets +5000 power for the turn, and choose one― ・Choose up to 1 of your opponent's Battle Cards with 15000 power or less and KO it. ・If this card's power is 25000 or more, it gains [double strike] for the turn. ・If you have 4 or more energy, you may pay {r}{r}. If you do, play up to 1 {SS Son Goku, Pan, & SS Trunks, Galactic Explorers} card from your hand on top of this card in Active Mode.",
  "P-389": "[activate: main/battle] Send 7 cards from your Drop Area to your Warp: Choose one― ・Activate up to 1 {Dragon Balls, Negative Energy Overflow} from your deck, then shuffle your deck. ・You may pay {4}. If you do, play up to 1 {Black Smoke Dragon, Eternal Evil} from your deck or hand, then shuffle your deck.",
  "BT4-036": "[auto] When your opponent attacks with one of their cards, if your Leader Card is a ≪Phantom Demon≫, you may send this card and 1 card from your hand to your Warp. If you do so, negate the attack, then play this card from your Warp at the start of your next Main Phase.",
  "BT4-037": "[Auto] When your opponent attacks with one of their cards, if your Leader Card is a ≪Phantom Demon≫, you may send this card and 1 card from your hand to your Warp. If you do so, negate the attack, then play this card from your Warp at the start of your next Main Phase.",
  "BT31-019": "[activate: main] [limit 1] If your Leader is a red ≪Evil Incarnate≫ card and you send this card and 1 ≪Evil Incarnate≫ card from your Drop to their owner's Warp: Choose up to 1 of your opponent's Battle Cards and it gets -5000 power for the turn.",
  "BT10-036": "[Permanent] During your opponent's turn, if all of your energy is mono-blue and you would reveal this card from your life to add it to your hand, you may place it in your energy in Rest Mode instead. If you do, draw 1 card.",
  "BT10-047": "[Permanent] During your opponent's turn, if all of your energy is mono-blue, if you would reveal this card from your life to add it to your hand, you may play it instead.",
  "P-235": "[Permanent] During your opponent's turn, if all of your energy is mono-blue and you would reveal this card from your life to add it to your hand, you may play it instead.",
  "P-454": "[permanent] During your opponent's turn, if all of your energy is mono-blue and you would reveal this card from your life and add it to your hand, you may play it instead.",
};
for (const [id, text] of Object.entries(PRINTED)) assert.deepEqual(read(text).unsupported, [], `${id} reads whole`);

// The payment is a choice of Active Mode energy of the colour, then a switch to Rest Mode, inside the offer.
{
  const ops = read("[Auto] When you play this card, you may pay {u}{u}. If you do, draw 3 cards.").ops;
  assert.deepEqual(ops.map((o) => o.op), ["may", "if"]);
  const may = ops[0] as { ops: { op: string; sel?: { area?: string; mode?: string; count?: number; filter?: { colors: string[] } } }[] };
  assert.deepEqual(may.ops.map((o) => o.op), ["choose", "switchMode"], "pay = choose the energy, rest it");
  assert.deepEqual([may.ops[0].sel?.area, may.ops[0].sel?.mode, may.ops[0].sel?.count, may.ops[0].sel?.filter?.colors], ["energy", "active", 2, ["Blue"]]);
  assert.deepEqual((ops[1] as { cond: unknown }).cond, { kind: "did", what: "may" }, "\"if you do\" reads the offer");
  // {4} is four of any colour.
  const four = (read("[Auto] When you play this card, you may pay {4}. If you do, draw 1 card.").ops[0] as { ops: { sel?: { count?: number; filter?: unknown } }[] }).ops[0].sel!;
  assert.equal(four.count, 4);
  assert.equal(four.filter, undefined, "{4} names no colour");
}
// A mixed price ({u}{1}) and a payment that is not an offer are left unread rather than half-paid.
assert.ok(read("[Auto] When you play this card, you may pay {u}{1}. If you do, draw 1 card.").unsupported.length > 0, "a mixed price stays unread");
assert.ok(read("[Auto] When you play this card, pay {u}. Draw 1 card.").unsupported.length > 0, "a compulsory payment stays unread");

// The pair of moves is one offer: the hand card is chosen first, so an empty hand makes the whole thing impossible.
{
  const ops = read(PRINTED["BT4-036"]).ops;
  const inner = ((ops[0] as { then?: { op: string }[] }).then ?? ops) as { op: string; ops?: { op: string; to?: string }[] }[];
  const may = inner.find((o) => o.op === "may")!;
  assert.deepEqual(may.ops!.map((o) => o.op), ["choose", "moveTo", "moveTo"], "choose the hand card, then both go to the Warp");
  assert.ok(may.ops!.slice(1).every((o) => o.to === "warp"));
}
// "send" goes to the Warp and "place" to the Drop Area; a mismatch is not guessed at.
assert.ok(read("[Auto] When you play this card, you may send this card and 1 card from your hand to your Drop Area. If you do, draw 1 card.").unsupported.length > 0);
assert.deepEqual(read("[Auto] When you play this card, you may place this card and 1 card from your hand in your Drop Area. If you do, draw 1 card.").unsupported, []);

// The life moment is about the printing card only.
{
  const ops = read(PRINTED["BT10-036"]).ops;
  const flat = JSON.stringify(ops);
  assert.ok(flat.includes('"event":"life"') && flat.includes('"to":"hand"'), "a life replacement to the hand");
  assert.ok(flat.includes('"target":{"sel":{"special":"self"}}'), "about this card");
  assert.ok(flat.includes('"mode":"rest"'), "arriving in Rest Mode");
}

// ── (a) play: the follow-up happens only when the energy was paid ────────────
DEFS.PAY_U2 = card("PAY_U2", { energyCost: 0, power: 5000, skill: "[Auto] When you play this card, you may pay {u}{u}. If you do, draw 3 cards." });
DEFS.PAY_G4 = card("PAY_G4", { energyCost: 0, power: 5000, skill: "[Auto] When you play this card, you may pay {4}. If you do, draw 2 cards." });

function playedWith(cardId: string, energy: string[]): EngineState {
  const s = stagedG({ hand: [cardId], energy });
  return playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", cardId) });
}
const restCount = (s: EngineState) => zoneOf(s, "p1", "energy").filter((id) => s.cards[id].mode === "rest").length;
{
  // Two blue energy: the offer is made, and taking it rests exactly those two.
  const s = playedWith("PAY_U2", ["V-BLUE", "V-BLUE", "V1"]);
  assert.equal(s.prompt.kind, "chooseMode", "two blue energy: the offer is made");
  const handBefore = ids(s, "p1", "hand").length;
  const restBefore = restCount(s);

  const declined = mode(s, 1);
  assert.equal(declined.prompt.kind, "main");
  assert.equal(restCount(declined), restBefore, "declined: no energy was rested");
  assert.equal(ids(declined, "p1", "hand").length, handBefore, "declined: nothing was drawn");

  // Exactly two blue energy: there is nothing to choose between, so they are the payment.
  const taken = mode(s, 0);
  assert.equal(taken.prompt.kind, "main");
  assert.equal(restCount(taken), restBefore + 2, "taken: the two blue energy rested");
  assert.ok(zoneOf(taken, "p1", "energy").filter((id) => taken.cards[id].cardId === "V-BLUE").every((id) => taken.cards[id].mode === "rest"));
  assert.equal(ids(taken, "p1", "hand").length, handBefore + 3, "taken: the follow-up drew 3");
}
{
  // Three blue and a red: the player picks which two blue energy pay; the red one cannot.
  const s = playedWith("PAY_U2", ["V-BLUE", "V-BLUE", "V-BLUE", "V1"]);
  let taken = mode(s, 0);
  assert.equal(taken.prompt.kind, "chooseCards", "taken: the player picks the energy that pays");
  const offered = taken.prompt.kind === "chooseCards" ? taken.prompt.choice.candidates : [];
  assert.equal(offered.length, 3, "all three blue energy are candidates");
  assert.ok(offered.every((id) => taken.cards[id].cardId === "V-BLUE"), "only blue energy can pay {u}{u}");
  const handBefore = ids(taken, "p1", "hand").length;
  taken = pick(taken, 2);
  assert.equal(taken.prompt.kind, "main");
  assert.equal(ids(taken, "p1", "hand").length, handBefore + 3, "paid: drew 3");
}
{
  // One blue energy only: the price cannot be met, so there is no offer and no follow-up.
  const s = playedWith("PAY_U2", ["V-BLUE", "V1", "V1"]);
  assert.equal(s.prompt.kind, "main", "one blue energy: nothing to offer");
  assert.equal(ids(s, "p1", "hand").length, ids(stagedG({ hand: ["PAY_U2"], energy: ["V-BLUE", "V1", "V1"] }), "p1", "hand").length - 1, "and nothing was drawn");
}
{
  // Blue energy that is already rested cannot pay (5-8-2-2).
  const staged = stagedG({ hand: ["PAY_U2"], energy: ["V-BLUE", "V-BLUE"] });
  for (const id of zoneOf(staged, "p1", "energy")) if (staged.cards[id].cardId === "V-BLUE") staged.cards[id].mode = "rest";
  const handBefore = ids(staged, "p1", "hand").length - 1;
  const s = playG(staged, { type: "play", player: "p1", card: findG(staged, "p1", "hand", "PAY_U2") });
  assert.equal(s.prompt.kind, "main", "rested energy cannot pay");
  assert.equal(ids(s, "p1", "hand").length, handBefore, "and nothing was drawn");
}
{
  // {4}: any four Active Mode energy.
  const none = playedWith("PAY_G4", ["V1", "V1", "V-BLUE"]);
  assert.equal(none.prompt.kind, "main", "three energy cannot pay {4}");
  const s = playedWith("PAY_G4", ["V1", "V1", "V-BLUE", "V-BLUE"]);
  assert.equal(s.prompt.kind, "chooseMode");
  const before = ids(s, "p1", "hand").length;
  const taken = pick(mode(s, 0), 4);
  assert.equal(ids(taken, "p1", "hand").length, before + 2, "paid: drew 2");
}

// ── (b) the pair of moves: this card and one from the hand ───────────────────
DEFS.WARP_PAIR = card("WARP_PAIR", { energyCost: 0, power: 5000, skill: "[Auto] When you play this card, you may send this card and 1 card from your hand to your Warp. If you do so, draw 2 cards." });
DEFS.PAIR_FILL = card("PAIR_FILL", { energyCost: 1, skill: null });
function pairPlayed(hand: string[]): EngineState {
  const s = stagedG({ hand: ["WARP_PAIR", ...hand] });
  return playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", "WARP_PAIR") });
}
{
  const none = pairPlayed([]);
  assert.equal(none.prompt.kind, "main", "no other card in hand: the pair cannot be sent, so no offer");
  assert.equal(count(none, "p1", "battle", "WARP_PAIR"), 1, "and this card stays in play");

  const s = pairPlayed(["PAIR_FILL"]);
  assert.equal(s.prompt.kind, "chooseMode", "a card to send: the offer is made");
  const declined = mode(s, 1);
  assert.equal(count(declined, "p1", "battle", "WARP_PAIR"), 1, "declined: this card stays");
  assert.equal(count(declined, "p1", "hand", "PAIR_FILL"), 1, "declined: the hand card stays");
  assert.equal(ids(declined, "p1", "hand").length, 1, "declined: nothing drawn");

  const taken = pick(mode(s, 0));
  assert.equal(count(taken, "p1", "warp", "WARP_PAIR"), 1, "taken: this card is in the Warp");
  assert.equal(count(taken, "p1", "warp", "PAIR_FILL"), 1, "taken: and so is the hand card");
  assert.equal(count(taken, "p1", "battle", "WARP_PAIR"), 0);
  assert.equal(ids(taken, "p1", "hand").length, 2, "\"if you do so\": two cards drawn");
}

// ── (c) the life moment: the printing card's own reveal ──────────────────────
DEFS.LIFE_REST = card("LIFE_REST", { energyCost: 1, skill: PRINTED["BT10-036"] });
DEFS.LIFE_PLAY = card("LIFE_PLAY", { energyCost: 0, power: 5000, skill: PRINTED["BT10-047"] });
/**
 * p1 attacks p2's Leader with BIG, one damage; p2's life card number `at` (0 is the top, the one taken) is
 * relabelled `cardId`, and `oppEnergy` is added to p2's (blue) energy. Returns the state at the first prompt.
 */
function hit(cardId: string, oppEnergy: string[], at = 0): { s: EngineState; life: string; top: string } {
  const staged = stagedG({ battle: ["BIG"], oppEnergy });
  const lifeCards = zoneOf(staged, "p2", "life");
  const life = lifeCards[at];
  staged.cards[life].cardId = cardId;
  const attacker = findG(staged, "p1", "battle", "BIG");
  let r = IMPL.apply(CTX, staged, { type: "attack", player: "p1", attacker, target: leaderOf(staged, "p2") });
  // Both players pass their windows (block, counter) until the damage is dealt or the offer is put.
  for (let i = 0; i < 6 && r.state.battle && r.state.prompt.kind !== "replaceMove"; i++) r = IMPL.apply(CTX, r.state, { type: "pass", player: (r.state.prompt as { player: PlayerId }).player });
  return { s: r.state, life, top: lifeCards[0] };
}
const p2 = (s: EngineState, area: Parameters<typeof zoneOf>[2]) => zoneOf(s, "p2", area);
const answer = (s: EngineState, index: number) => IMPL.apply(CTX, s, { type: "chooseMode", player: "p2", index }).state;

{
  // The rule is the top life card's own: the offer is made, to the life card's owner.
  const { s, life } = hit("LIFE_REST", ["V-BLUE"]);
  assert.equal(s.prompt.kind, "replaceMove", "9-10-3: whether to take the offer is asked");
  assert.equal((s.prompt as { player: string }).player, "p2", "the owner of the life card answers");
  assert.equal((s.prompt as { options: string[] }).options.length, 2, "the offer, and the ordinary move");
  const handBefore = p2(s, "hand").length;
  const energyBefore = p2(s, "energy").length;

  // Declined: the ordinary damage — the card goes to the hand, face down.
  const declined = answer(s, 1);
  assert.ok(p2(declined, "hand").includes(life), "declined: the card is added to the hand as usual");
  assert.equal(p2(declined, "energy").length, energyBefore, "and nothing went to the energy");

  // Taken: it goes to the energy in Rest Mode instead, and "if you do" drew a card.
  const taken = answer(s, 0);
  assert.ok(p2(taken, "energy").includes(life), "taken: the card is placed in the energy instead");
  assert.equal(taken.cards[life].mode, "rest", "in Rest Mode");
  assert.ok(!p2(taken, "hand").includes(life), "and not added to the hand");
  assert.equal(p2(taken, "hand").length, handBefore + 1, "\"if you do\": one card drawn");
}
{
  // Only mono-blue energy: with a red energy card among p2's, the condition fails and the damage is ordinary.
  const { s, life } = hit("LIFE_REST", ["V-BLUE", "V1"]);
  assert.notEqual(s.prompt.kind, "replaceMove", "a red energy card breaks \"all of your energy is mono-blue\"");
  assert.ok(p2(s, "hand").includes(life), "the life card was added to the hand");
}
{
  // "this card": a different life card taken does not answer to the rule on a card lower in the pile.
  const { s, life, top } = hit("LIFE_REST", ["V-BLUE"], 1);
  assert.notEqual(s.prompt.kind, "replaceMove", "the rule is about the card printing it, not the card being taken");
  assert.ok(p2(s, "hand").includes(top), "the top card was added to the hand");
  assert.ok(p2(s, "life").includes(life), "the printing card is still in the Life Area");
}
{
  // "you may play it instead": the life card is played into the Battle Area.
  const { s, life } = hit("LIFE_PLAY", ["V-BLUE"]);
  assert.equal(s.prompt.kind, "replaceMove");
  const taken = answer(s, 0);
  assert.ok(p2(taken, "battle").includes(life), "taken: the life card was played");
  assert.ok(!p2(taken, "hand").includes(life), "and not added to the hand");
  const declined = answer(s, 1);
  assert.ok(p2(declined, "hand").includes(life), "declined: added to the hand as usual");
}
{
  // The rule is not a standing offer on a card in play: a copy sitting in the Battle Area changes nothing for the life cards.
  const staged = stagedG({ battle: ["BIG"], oppBattle: ["LIFE_PLAY"], oppEnergy: ["V-BLUE"] });
  let r = IMPL.apply(CTX, staged, { type: "attack", player: "p1", attacker: findG(staged, "p1", "battle", "BIG"), target: leaderOf(staged, "p2") });
  for (let i = 0; i < 6 && r.state.battle && r.state.prompt.kind !== "replaceMove"; i++) r = IMPL.apply(CTX, r.state, { type: "pass", player: (r.state.prompt as { player: PlayerId }).player });
  assert.notEqual(r.state.prompt.kind, "replaceMove", "a copy in play does not offer anything");
}

// ── (a), delayed: the offer and the answer are made in the delayed program ───
// BT12-042 / BT13-057: "At the start of your next Main Phase, you may pay … If you do, …".
DEFS.DELAY_PAY = card("DELAY_PAY", { energyCost: 0, power: 5000, skill: "[Auto] When you play this card, at the start of your next Main Phase, you may pay {u}{u}. If you do, draw 2 cards." });
DEFS.DELAY_IF = card("DELAY_IF", { energyCost: 0, power: 5000, skill: "[Auto] When you play this card, at the start of your next Main Phase, if you have 3 or fewer cards in your hand, you may pay {u}. If you do, draw 2 cards." });
/** Play `cardId` with `energy`, then pass to p1's next Main Phase: the state at the first prompt of it. */
function nextMain(cardId: string, energy: string[]): EngineState {
  const s = stagedG({ hand: [cardId], energy });
  let t = playG(s, { type: "play", player: "p1", card: findG(s, "p1", "hand", cardId) });
  assert.equal(t.prompt.kind, "main", "nothing happens at once");
  t = playG(t, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null }, { type: "endMain", player: "p2" }, { type: "charge", player: "p1", card: null });
  return t;
}
{
  const s = nextMain("DELAY_PAY", ["V-BLUE", "V-BLUE", "V1"]);
  assert.equal(s.prompt.kind, "chooseMode", "at the start of the next Main Phase the offer is made");
  const handBefore = ids(s, "p1", "hand").length;
  const taken = mode(s, 0);
  assert.equal(ids(taken, "p1", "hand").length, handBefore + 2, "\"if you do\" is read inside the delayed program: two cards drawn");
  assert.equal(restCount(taken), 2, "the two blue energy are rested");
  const declined = mode(s, 1);
  assert.equal(ids(declined, "p1", "hand").length, handBefore, "declined: nothing drawn");
  assert.equal(restCount(declined), 0);

  // Not enough blue energy at that moment: no offer, no draw.
  const poor = nextMain("DELAY_PAY", ["V-BLUE", "V1", "V1"]);
  assert.equal(poor.prompt.kind, "main", "one blue energy cannot pay {u}{u}");
}
{
  // BT13-057's shape: the condition after the timing phrase is the delayed part's own, asked at the start of that Main Phase.
  const s = nextMain("DELAY_IF", ["V-BLUE", "V1"]);
  assert.equal(s.prompt.kind, "chooseMode", "the hand is small enough when the delayed part runs");
  const handBefore = ids(s, "p1", "hand").length;
  assert.equal(ids(pick(mode(s, 0)), "p1", "hand").length, handBefore + 2);
}
// A condition that follows a timing phrase no longer lets the effect happen at once (BT7-080, TB1-009, P-124, P-125, DB3-036, BT12-062 read this way).
{
  DEFS.TIMED_COND = card("TIMED_COND", { energyCost: 0, power: 5000, skill: "[Auto] When you play this card, at the start of your next Main Phase, if your Leader Card is a red card, draw 2 cards." });
  const staged = stagedG({ hand: ["TIMED_COND"] });
  const played = playG(staged, { type: "play", player: "p1", card: findG(staged, "p1", "hand", "TIMED_COND") });
  const handNow = ids(played, "p1", "hand").length;
  assert.equal(handNow, ids(staged, "p1", "hand").length - 1, "nothing is drawn when the card is played");
  const later = playG(played, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null }, { type: "endMain", player: "p2" }, { type: "charge", player: "p1", card: null });
  assert.equal(ids(later, "p1", "hand").length, handNow + 1 + 2, "at the start of the next Main Phase (after the turn's draw) two are drawn");
  const shape = JSON.stringify(read("[Auto] When you play this card, at the start of your next Main Phase, if your Leader Card is a red card, draw 2 cards.").ops);
  assert.ok(shape.indexOf('"op":"delay"') < shape.indexOf('"op":"draw"') && shape.indexOf('"op":"delay"') < shape.indexOf("leaderMatches"), "the condition is inside the delay");
}

// ── (a), modal: "choose one — … ・you may pay {r}{r}. If you do, …" (P-459, P-389) ──
DEFS.MODAL_PAY = card("MODAL_PAY", { energyCost: 0, power: 5000, skill: "[Auto] When you play this card, choose one― ・Draw 1 card. ・You may pay {u}{u}. If you do, draw 3 cards." });
{
  const staged = stagedG({ hand: ["MODAL_PAY"], energy: ["V-BLUE", "V-BLUE"] });
  const s = playG(staged, { type: "play", player: "p1", card: findG(staged, "p1", "hand", "MODAL_PAY") });
  assert.equal(s.prompt.kind, "chooseMode");
  const before = ids(s, "p1", "hand").length;
  const second = mode(s, 1);
  assert.equal(second.prompt.kind, "chooseMode", "the second option asks whether to pay");
  assert.equal(ids(mode(second, 1), "p1", "hand").length, before, "declined: nothing drawn");
  assert.equal(ids(pick(mode(second, 0)), "p1", "hand").length, before + 3, "paid: three drawn");
  assert.equal(ids(mode(s, 0), "p1", "hand").length, before + 1, "the first option never touches the energy");
}

// ── (b), as a price: both cards or the line is not offered ───────────────────
DEFS.PRICE_SELFDROP = card("PRICE_SELFDROP", { energyCost: 1, skill: "[activate: main][limit 1] Send this card to your Warp from your Drop Area: Draw 2 cards." });
DEFS.PRICE_BOTH = card("PRICE_BOTH", { energyCost: 1, skill: "[Activate: Main] Choose and send both this card from your Battle Area and a <Tapion> in your Drop Area to the Warp: Draw 2 cards." });
DEFS.PRICE_TAPION = card("PRICE_TAPION", { energyCost: 1, characters: ["Tapion"], skill: null });
DEFS.PRICE_FRIEZA = card("PRICE_FRIEZA", { energyCost: 3, colors: ["Red"], characters: ["Frieza"], skill: null });
DEFS.PRICE_P201 = card("PRICE_P201", { energyCost: 1, skill: "[activate: main]if your opponent has 3 or more energy and you choose 1 red or blue <Frieza> card with an energy cost of 3 in your Battle Area and this card in your Drop Area and send them both to their owners' Warps: Draw 2 cards." });
DEFS.PRICE_EI = card("PRICE_EI", { energyCost: 1, traits: ["Evil Incarnate"], skill: "[activate: main] [limit 1] If your Leader is a red card and you send this card and 1 ≪Evil Incarnate≫ card from your Drop to their owner's Warp: Draw 2 cards." });
DEFS.PRICE_EIMATE = card("PRICE_EIMATE", { energyCost: 1, traits: ["Evil Incarnate"], skill: null });
/** The first `activate` of `cardId` (put into `area` of an otherwise empty board), `others` beside it, and the state it is in. */
function priced(cardId: string, area: "drop" | "battle", others: { id: string; area: "drop" | "battle" }[], oppEnergy: string[] = []): { s: EngineState; act: ReturnType<typeof actsG>[number] | undefined } {
  const s = stagedG({ oppEnergy });
  const put = (id: string, a: "drop" | "battle"): string => {
    const x = findG(s, "p1", "deck", "V1");
    stageMoveG(s, x, a, "p1");
    s.cards[x].cardId = id;
    if (a === "battle") s.cards[x].mode = "active";
    return x;
  };
  const me = put(cardId, area);
  for (const o of others) put(o.id, o.area);
  return { s, act: actsG(s).find((x) => x.type === "activate" && x.card === me) };
}
function activated(cardId: string, area: "drop" | "battle", others: { id: string; area: "drop" | "battle" }[], oppEnergy: string[] = []): EngineState | null {
  const { s, act } = priced(cardId, area, others, oppEnergy);
  if (!act) return null;
  const before = ids(s, "p1", "hand").length;
  const t = pick(playG(s, act), 4);
  assert.equal(ids(t, "p1", "hand").length, before + 2, `${cardId}: the effect ran`);
  return t;
}
{
  const self = activated("PRICE_SELFDROP", "drop", []);
  assert.ok(self && count(self, "p1", "warp", "PRICE_SELFDROP") === 1, "\"send this card to your Warp from your Drop Area\": offered from the Drop, and it went");

  assert.equal(activated("PRICE_BOTH", "battle", []), null, "no ≪Tapion≫ in the Drop: the pair cannot be sent, the line is not offered");
  const both = activated("PRICE_BOTH", "battle", [{ id: "PRICE_TAPION", area: "drop" }]);
  assert.ok(both && count(both, "p1", "warp", "PRICE_BOTH") === 1 && count(both, "p1", "warp", "PRICE_TAPION") === 1, "this card from the Battle Area and the ≪Tapion≫ from the Drop are both in the Warp");

  assert.equal(activated("PRICE_P201", "drop", [], ["V-BLUE", "V-BLUE", "V-BLUE"]), null, "no <Frieza> in the Battle Area: not offered");
  const frieza = activated("PRICE_P201", "drop", [{ id: "PRICE_FRIEZA", area: "battle" }], ["V-BLUE", "V-BLUE", "V-BLUE"]);
  assert.ok(frieza && count(frieza, "p1", "warp", "PRICE_P201") === 1 && count(frieza, "p1", "warp", "PRICE_FRIEZA") === 1, "the chosen <Frieza> and this card from the Drop both went to the Warp");
  assert.equal(activated("PRICE_P201", "drop", [{ id: "PRICE_FRIEZA", area: "battle" }], []), null, "the printed condition on the opponent's energy still gates it");

  // BT31-019: the Leader condition is part of the line; the second card is another card than this one.
  assert.equal(activated("PRICE_EI", "drop", []), null, "alone in the Drop: there is no second card to send");
  const ei = activated("PRICE_EI", "drop", [{ id: "PRICE_EIMATE", area: "drop" }]);
  assert.ok(ei && count(ei, "p1", "warp", "PRICE_EI") === 1 && count(ei, "p1", "warp", "PRICE_EIMATE") === 1, "this card and the other ≪Evil Incarnate≫ card went to the Warp");
}

// ── (b), the Auto: BT4-036 whole — offer, both to the Warp, the attack negated, back at the start of the next Main Phase ──
DEFS.L_PHANTOM = card("L_PHANTOM", { type: "LEADER", colors: ["Red"], energyCost: null, comboCost: null, comboPower: null, traits: ["Phantom Demon"] });
DEFS.HIRUDEGARN = card("HIRUDEGARN", { energyCost: 1, power: 5000, skill: PRINTED["BT4-036"] });
DEFS.HIRU_FILL = card("HIRU_FILL", { energyCost: 9, skill: null });
function attacked(hand: string[], phantom = true): EngineState {
  const s = stagedG({ battle: ["HIRUDEGARN"], hand, oppBattle: ["BIG"] });
  if (phantom) s.cards[leaderOf(s, "p1")!].cardId = "L_PHANTOM";
  const t = playG(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  return IMPL.apply(CTX, t, { type: "attack", player: "p2", attacker: findG(t, "p2", "battle", "BIG"), target: leaderOf(t, "p1") }).state;
}
/** Answer p1's prompts (offer: `offer`, choices: the first candidate) and pass the rest, until the battle is over. */
function settle(s: EngineState, offer: number): EngineState {
  for (let i = 0; i < 10 && s.battle; i++) {
    const p = s.prompt as { kind: string; player: PlayerId; choice?: { candidates: string[] } };
    if (p.kind === "chooseMode") s = playG(s, { type: "chooseMode", player: p.player, index: offer });
    else if (p.kind === "chooseCards") s = playG(s, { type: "choose", player: p.player, cards: p.choice!.candidates.slice(0, 1) });
    else s = playG(s, { type: "pass", player: p.player });
  }
  return s;
}
{
  const lifeBefore = (s: EngineState) => zoneOf(s, "p1", "life").length;
  const open = attacked(["HIRU_FILL"]);
  assert.equal(open.prompt.kind, "chooseMode", "the opponent attacks: the offer is made");
  const declined = settle(open, 1);
  assert.equal(count(declined, "p1", "battle", "HIRUDEGARN"), 1, "declined: it stays in play");
  assert.equal(lifeBefore(declined), lifeBefore(open) - 1, "and the attack goes on: one damage");
  assert.equal(count(declined, "p1", "warp", "HIRU_FILL"), 0);

  const taken = settle(open, 0);
  assert.equal(count(taken, "p1", "warp", "HIRUDEGARN"), 1, "taken: this card is in the Warp");
  assert.equal(count(taken, "p1", "warp", "HIRU_FILL"), 1, "and so is the hand card");
  assert.equal(lifeBefore(taken), lifeBefore(open), "the attack was negated: no damage");
  const back = playG(taken, { type: "endMain", player: "p2" }, { type: "charge", player: "p1", card: null });
  assert.equal(count(back, "p1", "battle", "HIRUDEGARN"), 1, "at the start of the next Main Phase it is played from the Warp");

  assert.notEqual(attacked([]).prompt.kind, "chooseMode", "no other card in hand: the pair cannot be sent, so no offer");
  assert.notEqual(attacked(["HIRU_FILL"], false).prompt.kind, "chooseMode", "without a ≪Phantom Demon≫ Leader nothing is offered");
}
