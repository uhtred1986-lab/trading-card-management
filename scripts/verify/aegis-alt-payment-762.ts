/**
 * #762 (22-30-3, 20-1-11): BT22-035 and BT22-140 print a second way to pay an
 * [Aegis] skill, "instead of discarding a card from your hand".
 *
 * Rule basis (Rule Manual): 22-30-3 puts the hand cards in the Drop as part of
 * the skill cost; 20-1-11 says a voluntary "you may (Event B) instead of
 * (Event A)" applies only if Event B is fulfilled. The manual has no rule on
 * who chooses a card in the opponent's hidden hand for BT22-140, so the
 * literal reading stands: the player activating Aegis ("you … sending")
 * chooses it. The text sends a yellow and a blue card whatever the Aegis's own
 * colours are, and so replaces the whole hand payment.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty, rulesFromCompiler } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { compileCard } from "../../src/lib/arena/compile";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import { conceal, hiddenAliases } from "../../src/lib/arena/conceal";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";

const engine = RULES;
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok);
const game = loaded.definition;

const BT22_035 = "[Permanent] If your Leader is a blue Leader with both <Son Goku> and <Vegeta> or a blue <Gogeta> Z-Leader, you can activate your [Aegis] skill by sending 1 yellow card and 1 blue card from your Drop to your Warp instead of discarding a card from your hand.";
const BT22_140 = "[Permanent] This card can't be removed from your Battle Area by your opponent's skills, and you can activate this card's [Aegis] skill by sending 1 card from your opponent's hand to the bottom of their deck instead of discarding a card from your hand.";

const leader = (id: string, type: "LEADER" | "Z-LEADER", colors: ("Blue" | "Red")[], characters: string[]): CardDef =>
  card(id, { type, colors, energyCost: null, comboCost: null, comboPower: null, power: 10000, characters, skill: null });
const defs: Record<string, CardDef> = { ...DEFS,
  LEADGV762: leader("LEADGV762", "LEADER", ["Blue"], ["Son Goku", "Vegeta"]),
  LEADGOKU762: leader("LEADGOKU762", "LEADER", ["Blue"], ["Son Goku"]),
  LEADREDGV762: leader("LEADREDGV762", "LEADER", ["Red"], ["Son Goku", "Vegeta"]),
  LEADZGOG762: leader("LEADZGOG762", "Z-LEADER", ["Blue"], ["Gogeta"]),
  GRANT762: card("GRANT762", { colors: ["Blue"], skill: BT22_035 }),
  PLAIN762: card("PLAIN762", { skill: "[Aegis red/blue]" }),
  OWN762: card("OWN762", { skill: `[Aegis red/blue]<br>${BT22_140}` }),
  RED762: card("RED762", { colors: ["Red"], skill: null }),
  BLUE762: card("BLUE762", { colors: ["Blue"], skill: null }),
  YELLOW762: card("YELLOW762", { colors: ["Yellow"], skill: null }),
  YELLOW2762: card("YELLOW2762", { colors: ["Yellow"], skill: null }),
  YB762: card("YB762", { colors: ["Yellow", "Blue"], skill: null }),
  SECRET762: card("SECRET762", { colors: ["Green"], skill: null }),
  OTHERSECRET762: card("OTHERSECRET762", { colors: ["Green"], skill: null }),
};
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromCompiler(defs) };
const reload = (s: VmState): VmState => JSON.parse(JSON.stringify(s));
function apply(s: VmState, action: Action) { return engine.apply(ctx, reload(s), action) as { state: VmState; events: GameEvent[] }; }
function play(s: VmState, ...actions: Action[]): VmState { for (const action of actions) s = apply(s, action).state; return s; }
function stage(s: VmState, p: PlayerId, id: string, area: "battle" | "energy" | "hand" | "drop"): string {
  const physical = s.sides[p].zones.deck[0]; assert.ok(physical);
  s.cards[physical].cardId = id;
  assert.ok(moveCard(s, game, physical, area, { owner: p }).ok);
  return physical;
}
interface Setup { leader?: string; battle?: string[]; hand?: string[]; drop?: string[]; foeHand?: string[] }
/** p2 attacks and p1 defends at the combo prompt (the Defense Step); p1's hand starts empty. */
function defense(o: Setup) {
  let s = engine.createGame(ctx, { seed: 762, p1: { name: "You", leader: "L-RED", main: fifty("V1") }, p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  s = play(s, { type: "chooseFirst", player: s.chooser, first: "p1" });
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) s = play(s, { type: "pass", player: (s.prompt as { player: PlayerId }).player });
  assert.equal(s.prompt.kind, "main");
  for (const id of s.sides.p1.zones.hand.slice()) assert.ok(moveCard(s, game, id, "deck", { owner: "p1" }).ok);
  for (const id of s.sides.p2.zones.hand.slice()) assert.ok(moveCard(s, game, id, "deck", { owner: "p2" }).ok);
  if (o.leader) s.cards[s.sides.p1.zones.leader[0]].cardId = o.leader;
  const battle = (o.battle ?? []).map((id) => stage(s, "p1", id, "battle"));
  const hand = (o.hand ?? []).map((id) => stage(s, "p1", id, "hand"));
  const drop = (o.drop ?? []).map((id) => stage(s, "p1", id, "drop"));
  const energy = ["RED762", "RED762", "RED762"].map((id) => stage(s, "p1", id, "energy"));
  energy.forEach((id) => { s.cards[id].mode = "rest"; });
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  // p2 has drawn for the turn: set their hand to exactly what the case needs.
  for (const id of s.sides.p2.zones.hand.slice()) assert.ok(moveCard(s, game, id, "deck", { owner: "p2" }).ok);
  const foeHand = (o.foeHand ?? []).map((id) => stage(s, "p2", id, "hand"));
  s = play(s, { type: "attack", player: "p2", attacker: s.sides.p2.zones.leader[0], target: s.sides.p1.zones.leader[0] });
  // With nothing in hand p2 has no combo to offer, so the Defense Step may already be p1's.
  for (let i = 0; i < 4 && (s.prompt as { player?: PlayerId }).player === "p2"; i++) s = play(s, { type: "pass", player: "p2" });
  assert.equal(s.prompt.kind, "combo");
  return { s, battle, hand, drop, foeHand, energy };
}
const offered = (s: VmState, id: string) => {
  const r = engine.legalActions(ctx, s).some((l) => l.action.type === "activate" && l.action.card === id);
  if (!r && process.env.DBG) console.log(JSON.stringify(engine.rejectedActions(ctx, s, engine.legalActions(ctx, s)).filter((x) => x.action.type === "activate" && x.action.card === id)).slice(0, 800));
  return r;
};
const activate = (s: VmState, id: string) => apply(s, { type: "activate", player: "p1", card: id, skill: 0 });
const choose = (s: VmState, ids: string[]) => apply(s, { type: "choose", player: "p1", cards: ids });
const mode = (s: VmState, index: number) => apply(s, { type: "chooseMode", player: "p1", index });
const skills = (ev: GameEvent[], id: string) => ev.filter((e) => e.type === "skill" && e.card === id);
const candidates = (s: VmState): string[] => (s.prompt.kind === "chooseCards" ? s.prompt.choice.candidates : []);
/** 22-30-5: the energy is asked one card at a time, up to two; stand one and decline the rest. */
const standUp = (s: VmState, id: string): VmState => { let t = choose(s, [id]).state; if (t.prompt.kind === "chooseCards") t = choose(t, []).state; return t; };
const zone = (s: VmState, p: PlayerId, area: string) => s.sides[p].zones[area];

// ── both lines compile from their printed text ──
{
  const a = compileCard(defs.GRANT762, "front");
  assert.ok(a.complete && a.bySkill[0].unsupported.length === 0, "BT22-035 reads whole");
  // "both <Son Goku> and <Vegeta>" is two conditions that hold together, each with the "or a blue <Gogeta> Z-Leader" beside it.
  type Node = { op: string; cond?: { kind: string }; then?: Node[]; what?: string; filter?: { colors: string[] } };
  let node = a.bySkill[0].ops[0] as Node; let gates = 0;
  while (node.op === "if") { gates++; assert.equal(node.cond?.kind, "any"); node = node.then![0]; }
  assert.equal(gates, 2, "under both readings of the Leader condition");
  const permit = node;
  assert.equal(permit.op, "permit"); assert.equal(permit.what, "aegisAltDrop"); assert.deepEqual(permit.filter?.colors, ["Yellow", "Blue"]);

  const b = compileCard(defs.OWN762, "front");
  assert.ok(b.complete && Object.values(b.bySkill).every((p) => p.unsupported.length === 0), "BT22-140 reads whole");
  const ops = Object.values(b.bySkill).flatMap((p) => p.ops);
  assert.ok(ops.some((o) => o.op === "forbid"), "its first sentence is still read");
  assert.ok(ops.some((o) => o.op === "permit" && o.what === "aegisAltOpponentHand"));
  // An unknown wording or scope is refused, never half-read.
  const odd = compileCard(card("ODD762", { skill: "[Permanent] You can activate this card's [Aegis] skill by sending 1 yellow card and 1 blue card from your Drop to your Warp instead of discarding a card from your hand." }), "front");
  assert.ok(odd.bySkill[0].ops.every((o) => o.op !== "permit"), "'this card's' does not go with the Drop payment");
}

// ── BT22-035: offered only while its Leader condition holds and the Drop can pay ──
{
  const base = { battle: ["GRANT762", "PLAIN762"], drop: ["YELLOW762", "BLUE762"] };
  for (const [lead, why] of [["LEADGV762", "a blue Leader with both <Son Goku> and <Vegeta>"], ["LEADZGOG762", "a blue <Gogeta> Z-Leader"]] as const) {
    const a = defense({ ...base, leader: lead });
    assert.ok(offered(a.s, a.battle[1]), `offered under ${why} with an empty hand`);
  }
  for (const [lead, why] of [["LEADREDGV762", "a red Leader"], ["LEADGOKU762", "a blue Leader with only <Son Goku>"]] as const) {
    const a = defense({ ...base, leader: lead });
    assert.ok(!offered(a.s, a.battle[1]), `not offered under ${why}`);
  }
  const noBlue = defense({ battle: base.battle, drop: ["YELLOW762", "YELLOW2762"], leader: "LEADGV762" });
  assert.ok(!offered(noBlue.s, noBlue.battle[1]), "no blue card in the Drop: nothing to send");
  const oneCard = defense({ battle: base.battle, drop: ["YB762"], leader: "LEADGV762" });
  assert.ok(!offered(oneCard.s, oneCard.battle[1]), "one yellow/blue card is one card, not two");
  const noPermanent = defense({ battle: ["PLAIN762"], drop: base.drop, leader: "LEADGV762" });
  assert.ok(!offered(noPermanent.s, noPermanent.battle[0]), "without BT22-035 in play the Drop pays nothing");
}

// ── BT22-035: paid beside the hand payment, the player's choice ──
{
  const a = defense({ battle: ["GRANT762", "PLAIN762"], hand: ["RED762", "BLUE762"], drop: ["YELLOW762", "YELLOW2762", "BLUE762"], leader: "LEADGV762" });
  const aegis = a.battle[1];
  const asked = activate(a.s, aegis);
  assert.equal(asked.state.prompt.kind, "chooseMode", "hand or Drop");
  assert.equal(skills(asked.events, aegis).length, 0, "declaring has not activated it");
  const options = (asked.state.prompt as { options: string[] }).options;
  assert.equal(options.length, 2); assert.match(options[0], /hand/i); assert.match(options[1], /yellow.*blue.*Drop.*Warp/i);
  assert.throws(() => mode(asked.state, 2), IllegalAction);

  // The Drop way: a yellow then the blue, both to the Warp; the hand is untouched.
  let s = mode(asked.state, 1).state;
  assert.equal(s.prompt.kind, "chooseCards");
  assert.deepEqual(candidates(s).sort(), [a.drop[0], a.drop[1]].sort(), "yellow cards, and only those that leave a blue partner");
  s = reload(s);
  const paid = choose(s, [a.drop[1]]); s = paid.state;
  const done = s; // the one blue card is the only partner, so it is taken without a question
  assert.ok(zone(done, "p1", "warp").includes(a.drop[1]) && zone(done, "p1", "warp").includes(a.drop[2]), "yellow and blue went to the Warp");
  assert.ok(zone(done, "p1", "drop").includes(a.drop[0]) && !zone(done, "p1", "drop").includes(a.drop[1]), "the other yellow stays");
  assert.deepEqual(a.hand.filter((id) => zone(done, "p1", "hand").includes(id)), a.hand, "no hand card was discarded");
  assert.equal(done.prompt.kind, "chooseCards", "22-30-5: the energy to stand is asked next");
  assert.equal(skills(paid.events, aegis).length, 1, "the Aegis activated once, after its payment");
  assert.equal(standUp(done, a.energy[0]).cards[a.energy[0]].mode, "active", "22-30-5");

  // The hand way is unchanged: the cards go to the Drop and the Drop is not touched.
  let h = mode(asked.state, 0).state;
  assert.deepEqual(candidates(h).sort(), a.hand.slice().sort(), "the declared hand payment, first pick");
  h = choose(h, [a.hand[0]]).state; // the other colour is then forced
  assert.ok(zone(h, "p1", "drop").includes(a.hand[0]) && zone(h, "p1", "drop").includes(a.hand[1]), "hand cards to the Drop");
  assert.equal(zone(h, "p1", "warp").length, 0, "nothing from the Drop");
}

// ── the Drop way alone needs no question; a multicolour card cannot be both ──
{
  const a = defense({ battle: ["GRANT762", "PLAIN762"], drop: ["YB762", "YELLOW762", "BLUE762"], leader: "LEADGV762" });
  const s = activate(a.s, a.battle[1]).state;
  assert.equal(s.prompt.kind, "chooseCards", "no hand to discard, so no choice of ways");
  // First pick: a yellow card that leaves a different blue partner (either multicolour or mono works here).
  assert.ok(candidates(s).includes(a.drop[1]));
  const first = choose(s, [a.drop[0]]).state; // the Yellow/Blue card taken as the yellow one
  // The same card cannot be the blue one too, so the mono-blue card is the only partner and is taken without a question.
  const second = first;
  assert.ok(zone(second, "p1", "warp").includes(a.drop[0]) && zone(second, "p1", "warp").includes(a.drop[2]));
  // A pick that is no longer in the Drop is refused and changes nothing.
  const moved = reload(s); assert.ok(moveCard(moved, game, a.drop[1], "hand", { owner: "p1" }).ok);
  assert.throws(() => apply(moved, { type: "choose", player: "p1", cards: [a.drop[1]] }), IllegalAction);
}

// ── BT22-140: only its own Aegis, from the opponent's hand to the bottom of their deck ──
{
  const a = defense({ battle: ["OWN762", "PLAIN762"], foeHand: ["SECRET762", "OTHERSECRET762"] });
  const [own, plain] = a.battle;
  assert.ok(offered(a.s, own), "its own [Aegis] is offered with an empty hand");
  assert.ok(!offered(a.s, plain), "another card's [Aegis] is not");
  const empty = defense({ battle: ["OWN762"] });
  assert.ok(!offered(empty.s, empty.battle[0]), "refused when the opponent's hand is empty (and so is ours)");

  const declared = activate(a.s, own);
  assert.equal(skills(declared.events, own).length, 0);
  let s = declared.state;
  assert.equal(s.prompt.kind, "chooseCards");
  assert.equal((s.prompt as { player: PlayerId }).player, "p1", "the player activating chooses (no rule says otherwise)");
  assert.deepEqual(candidates(s).sort(), a.foeHand.slice().sort(), "the opponent's hand cards");
  // Privacy: the activator sees positions, not identities; the opponent's view of the pick is theirs alone.
  const seenByP1 = JSON.stringify(conceal(s.prompt, hiddenAliases(s, "p1", game)));
  assert.ok(!a.foeHand.some((id) => seenByP1.includes(id)), `p1's prompt names no hidden instance id ${seenByP1}`);
  assert.ok(!seenByP1.includes("SECRET762"), "nor a card name");
  assert.match(seenByP1, /\?p2:hand:\d/);
  s = reload(s);
  const picked = a.foeHand[1];
  const done = choose(s, [picked]);
  assert.equal(zone(done.state, "p2", "deck").at(-1), picked, "the card is the bottom of their deck");
  assert.ok(!zone(done.state, "p2", "hand").includes(picked) && zone(done.state, "p2", "hand").includes(a.foeHand[0]));
  assert.equal(done.state.prompt.kind, "chooseCards", "22-30-5: then the energy");
  const events = JSON.stringify(conceal(done.events, hiddenAliases(done.state, "p1", game)));
  assert.ok(!events.includes("SECRET762"), "p1's log never names the card sent from the opponent's hand");
  assert.ok(!events.includes(picked), "nor its id");
  for (const viewer of ["p1", "p2"] as const) assert.match(hiddenAliases(done.state, viewer, game)[picked] ?? "", /^\?p2:deck:\d+$/, `${viewer} sees the card on their deck only by position`);
  assert.equal(skills(done.events, own).length, 1, "the Aegis activated once, after its payment");
  assert.equal(standUp(done.state, a.energy[0]).cards[a.energy[0]].mode, "active");
  // Stale: the picked card is gone from the hand before the answer.
  const gone = reload(s); assert.ok(moveCard(gone, game, picked, "deck", { owner: "p2" }).ok);
  assert.throws(() => apply(gone, { type: "choose", player: "p1", cards: [picked] }), IllegalAction);
  // Wrong chair.
  assert.throws(() => apply(s, { type: "choose", player: "p2", cards: [picked] }), IllegalAction);
}

// ── both ways at once: hand, Drop and the opponent's hand are three choices ──
{
  const a = defense({ battle: ["GRANT762", "OWN762"], hand: ["RED762", "BLUE762"], drop: ["YELLOW762", "BLUE762"], foeHand: ["SECRET762"], leader: "LEADGV762" });
  const s = activate(a.s, a.battle[1]).state;
  assert.equal(s.prompt.kind, "chooseMode");
  assert.equal((s.prompt as { options: string[] }).options.length, 3);
  // The opponent's-hand way pays nothing from the hand or the Drop.
  const t = mode(s, 2).state; // forced single candidate is taken without a question
  assert.equal(zone(t, "p2", "deck").at(-1), a.foeHand[0]);
  assert.equal(zone(t, "p1", "drop").filter((id) => a.drop.includes(id)).length, 2);
}

// ── the hand payment alone is exactly as before: no question, nothing new ──
{
  const a = defense({ battle: ["PLAIN762"], hand: ["RED762", "BLUE762"], leader: "LEADGV762" });
  const s = activate(a.s, a.battle[0]).state;
  assert.equal(s.prompt.kind, "chooseCards", "straight to the hand cards");
  assert.ok(candidates(s).every((id) => a.hand.includes(id)));
}

console.log("aegis-alt-payment-762: ok");
