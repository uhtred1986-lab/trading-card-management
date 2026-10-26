/**
 * The prohibition catalog (20-14, 0-2-5): the continuous rules that forbid an
 * action, read from the printed wordings the catalog still left unread, and
 * enforced where the engine offers or performs that action.
 *
 * One card per group is read whole (part 1), and each forbidden action is then
 * played on the VM from **both seats** with a JSON reload of the state in
 * between (part 2): refused or not offered while the rule holds, allowed once
 * it ends, and the player the text does not name left alone.
 *
 * The groups, by what is forbidden:
 * - several actions in one prohibition — "it can't attack **or** activate
 *   skills" (BT9-071), "…can't attack or activate the [Blocker] skill"
 *   (BT28-053): one `forbid` per action, same subject and duration;
 * - a combo (5-7) — "this card can't be used in a combo **from the Battle
 *   Area**" (EB1-21, `fromArea`), "you can't combo with cards in your Battle
 *   Area" (BT10-154), "your opponent can't combo for the duration of this
 *   card's battle" (BT3-033);
 * - "may not" as "can't" (BT4-122, P-060), and one [Counter] kind (22-10-2-1);
 * - removal from a Battle Area by skills, said four more ways (BT10-065 "by
 *   skills", BT8-040 "by your opponent's card skills", BT30-030 "by an
 *   opponent's skill", BT10-058 "by the skills of your opponent's Battle
 *   Cards") — "by skills" now binds the card's own controller too;
 * - a skill's switch to Rest Mode (`beRestedBySkill`, P-680, DB2-138);
 * - a move from a Drop Area to a Warp (`dropToWarp`, BT6-028, BT16-001) —
 *   an effect's, a price's, and [Over Realm]'s (0-2-5, 9-2-3);
 * - a KO by the opponent's attacks (`beKOdInBattle`, BT13-118);
 * - which defenders may be attacked — "…can't attack **this card**" (BT15-122,
 *   `against`), "your opponent cannot attack your other Battle Cards"
 *   (BT1-093), "the opponent cannot attack <Evil Wizard Babidi>" (BT2-023);
 * - a play — "…from their owner's hands" (EX23-05, `fromArea`), "you can't
 *   use skills to play Battle Cards" (BT20-024, `bySkill`);
 * - a card's [Blocker] (EB1-36, P-498) — a card that can't block;
 * - "KO'd by your **own** skills" (BT3-078).
 *
 * Rulings: the most literal reading the rule manual backs (20-14, 0-2-5,
 * 9-2-3); the open questions are listed in the PR.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { forbiddenBy } from "../../src/lib/arena/vm/program";
import { compileSkill } from "../../src/lib/arena/compile";
import { parseSkills } from "../../src/lib/arena/text/cards";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { Op } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";

// ── 1. readings: one printed card per group ──────────────────────────────────

const compact = (_k: string, v: unknown) => (v === null || v === false || (Array.isArray(v) && v.length === 0) ? undefined : v);
/** The ops of a printed line, with the empty filter fields left out. */
function ops(text: string): Op[] {
  const [sk] = parseSkills(text);
  const script = compileSkill(sk);
  assert.deepEqual(script.unsupported, [], `reads whole: ${text}`);
  return JSON.parse(JSON.stringify(script.ops, compact)) as Op[];
}
/** The `forbid` ops anywhere in a program, in order. */
function forbids(list: Op[]): Extract<Op, { op: "forbid" }>[] {
  const out: Extract<Op, { op: "forbid" }>[] = [];
  for (const o of list) {
    if (o.op === "forbid") out.push(o);
    if (o.op === "if") out.push(...forbids(o.then), ...forbids(o.else ?? []));
  }
  return out;
}
const unread = (text: string) => compileSkill(parseSkills(text)[0]).unsupported;
const SELF = { sel: { special: "self" } };

// Several actions in one prohibition.
{
  const f = forbids(ops("[Auto] During your opponent's turn: When you play this card, choose up to 1 of your opponent's Battle Cards and it can't attack or activate skills for the duration of the turn."));
  assert.deepEqual(f.map((x) => [x.what, x.until, JSON.stringify(x.target)]), [["attack", "turn", '{"var":"c0"}'], ["activateSkill", "turn", '{"var":"c0"}']], "BT9-071");
  const b = forbids(ops("[Activate: Main] Choose up to 2 of your opponent's Battle Cards, ignoring [Barrier], and until the end of your opponent's turn, they can't attack or activate the [Blocker] skill. Additionally, if you have a blue Z-Battle Card or blue Unison in play, draw 1 card."));
  assert.deepEqual(b.map((x) => [x.what, x.until]), [["attack", "nextTurn"], ["block", "nextTurn"]], "BT28-053: the leading duration covers both");
  const p = forbids(ops("[Activate: Main] [Once per turn] Choose up to 1 of your opponent's Battle Cards, and it can't attack or be placed in your opponent's Combo Area until the end of your opponent's next turn."));
  assert.deepEqual(p.map((x) => x.what), ["attack", "combo"], "P-145");
  // "until the end of their next turn": the opponent the skill names (BT13-054).
  assert.deepEqual(forbids(ops("[auto] When this card is played, choose up to 1 of your opponent's Battle Cards with an energy cost greater than their energy, and it can't attack or be used in a combo until the end of their next turn.")).map((x) => x.until), ["nextTurn", "nextTurn"], "BT13-054");
}
// A combo.
{
  assert.deepEqual(forbids(ops("[Permanent] This card can't be used in a combo from the Battle Area and your opponent's Clone Tokens can't attack."))[0], { op: "forbid", what: "combo", until: "game", target: SELF, fromArea: "battle" }, "EB1-21");
  assert.deepEqual(forbids(ops("[Permanent] This card can't be used in combos from Battle Areas."))[0].fromArea, "battle", "P-277");
  const bt10 = forbids(ops("[Permanent] You can't play Battle Cards, this card can't be removed from your Battle Area by skills, and you can't combo with cards in your Battle Area."));
  assert.deepEqual(bt10.map((x) => [x.what, x.side ?? null, x.fromArea ?? null]), [["play", "you", null], ["beMovedBySkill", null, null], ["combo", "you", "battle"]], "BT10-154");
  const bt3 = ops("[permanent] Your opponent can't combo for the duration of this card's battle.");
  assert.equal(bt3[0].op, "if", "BT3-033: while this card is in a battle");
  if (bt3[0].op === "if") assert.deepEqual(bt3[0].cond, { kind: "inBattle", sel: { special: "self" } });
  assert.deepEqual(forbids(ops("[Auto] When this card attacks a Battle Card, your opponent can't use a card in a combo for the battle."))[0], { op: "forbid", what: "combo", side: "opponent", until: "battle" }, "BT28-013");
}
// "May not", and a [Counter] kind.
{
  assert.deepEqual(forbids(ops("[Activate: Main] Send 3 cards from your Drop Area to your Warp: Draw 1 card, and your opponent may not activate [Counter: Play] skills for the duration of the turn."))[0], { op: "forbid", what: "activateCounter", side: "opponent", until: "turn", counterKind: "play" }, "BT4-122: a prohibition, not an offer");
  const p060 = forbids(ops("[Auto] When this card attacks during the turn you played it with [Over Realm], your opponent may not combo with Battle Cards in their Battle Area or activate [Blocker] for the duration of the battle."));
  assert.deepEqual(p060.map((x) => [x.what, x.side, x.until, x.fromArea ?? null, x.filter?.type ?? null]), [["combo", "opponent", "battle", "battle", "BATTLE"], ["block", "opponent", "battle", null, null]], "P-060");
  assert.deepEqual(forbids(ops("[Permanent] You may not play this card from any area unless your Leader Card is <Son Goku: GT>."))[0].unless, { kind: "leaderMatches", filter: { characters: ["son goku: gt"] } }, "BT4-080");
}
// Removal by skills.
{
  assert.deepEqual(forbids(ops("[Permanent] This card can't be removed from Battle Areas by skills."))[0], { op: "forbid", what: "beMovedBySkill", until: "game", target: SELF }, "BT10-065: either player's skills");
  assert.equal(forbids(ops("[permanent] This card can't be removed from a Battle Area by your opponent's card skills."))[0].side, "opponent", "BT8-040");
  assert.equal(forbids(ops("[auto][once per turn] If this card is in a battle: When your energy is placed at the bottom of its owner's deck, this card gets +11000 power for the battle, and it can't be removed from a Battle Area by an opponent's skill for the turn."))[0].side, "opponent", "BT30-030");
  assert.deepEqual(forbids(ops("[Permanent] This card can't be removed from your Battle Area by the skills of your opponent's Battle Cards."))[0].byTypes, ["BATTLE"], "BT10-058");
}
// Rest Mode, Drop to Warp, KO by attacks, KO by own skills.
{
  assert.deepEqual(forbids(ops("[Permanent] This card can't be switched to Rest Mode by your opponent's skills."))[0], { op: "forbid", what: "beRestedBySkill", until: "game", target: SELF, side: "opponent" }, "DB2-138");
  assert.equal(forbids(ops("[Permanent] Your cards can't be switched to Rest Mode by your opponent's skills."))[0].what, "beRestedBySkill", "P-680");
  assert.deepEqual(forbids(ops("[Permanent] You can't send cards from Drop Areas to Warps."))[0], { op: "forbid", what: "dropToWarp", side: "you", until: "game", fromArea: "drop" }, "BT6-028");
  assert.equal(forbids(ops("[Permanent] You can't send cards from your Drop Area to your Warp."))[0].fromOwnArea, true, "BT16-001: your own Drop");
  assert.deepEqual(forbids(ops("[Activate: Battle] Choose this card in your Drop Area and 1 card in your hand and send them to your Warp: Choose up to 1 of your mono-yellow <Trunks: Future> Battle Cards and it can't be KO'd by your opponent's attacks for the battle."))[0], { op: "forbid", what: "beKOdInBattle", until: "battle", target: { var: "c0" }, side: "opponent" }, "BT13-118");
  assert.equal(forbids(ops("[Permanent] Your Battle Cards can't be KO'd by your own skills."))[0].side, "you", "BT3-078");
}
// Which defenders may be attacked.
{
  assert.deepEqual(forbids(ops("[Permanent] Your opponent's skill-less cards can't attack this card."))[0].against, SELF, "BT15-122");
  const bt1 = forbids(ops("[Permanent] If this card is in Rest Mode, your opponent cannot attack your other Battle Cards."))[0];
  assert.equal(bt1.what, "beAttacked", "BT1-093");
  assert.equal(bt1.target && "sel" in bt1.target ? bt1.target.sel.notSelf : null, "card", "BT1-093: other than this card");
  assert.deepEqual(forbids(ops("[Permanent] If this card is in Rest Mode, the opponent cannot attack <Evil Wizard Babidi>."))[0].attackTarget, { characters: ["evil wizard babidi"] }, "BT2-023");
  assert.equal(forbids(ops("[Permanent] If you have a multicolor <Pan> card or multicolor Battle Card with <GT> in its character name in play, your opponent can't declare to attack this card."))[0].what, "beAttacked", "BT25-100");
}
// A play, a [Blocker].
{
  assert.deepEqual(forbids(ops("[permanent] You and your opponent can't play Battle Cards with 25000 power or more from their owner's hands."))[0], { op: "forbid", what: "play", side: "both", until: "game", fromArea: "hand", filter: { type: "BATTLE", powerMin: 25000 } }, "EX23-05");
  const bt20 = forbids(ops("[Permanent] You can't activate Extras, and during your turn, you can't use skills to play Battle Cards."));
  assert.deepEqual(bt20.map((x) => [x.what, x.bySkill, x.filter?.type]), [["play", true, "BATTLE"]], "BT20-024");
  assert.equal(forbids(ops("[Activate: Main] Choose up to 4 of your opponent's Battle Cards and those cards can't activate [Blocker] skills for the turn."))[0].what, "block", "EB1-36");
  assert.equal(forbids(ops("[Activate: Main][Limit 1] Choose up to 1 of your opponent's Battle Cards, ignoring [Barrier], and that card's [Blocker] can't activate for the turn."))[0].what, "block", "P-498");
}
// What stays unread rather than becoming a wider (or a wrong) rule.
{
  for (const text of [
    // A comparison no selector says (it read as "the cards under this card").
    "[Permanent] Your opponent's Battle Cards with the same keyword skills as cards under this card can't attack or switch to Active Mode.",
    // Where a play comes from and what plays it are not a description of the card.
    "[Auto] When you play this card, draw 1 card, and your opponent may not play Battle Cards from their hand with the skills of cards with [Super Combo] for the duration of the game.",
    // A moment, not a duration: the opponent's [Blocker] during this card's attack.
    "[permanent] Your opponent cannot activate [counter] against this card's attack and cannot activate [blocker] during this card's attack.",
    // A leading duration reaches only the first clause after it.
    "[activate: main] Choose up to 1 of your opponent's Battle Cards, and until the end of your opponent's turn, that card can't attack and your opponent can't activate its skills.",
    // A bare "removed from Battle Areas" would also be a KO's; an exception is not read.
    "[permanent] This card can't attack or be removed from Battle Areas.",
    "[Permanent] This card can't be removed from Battle Areas by skills other than {Jaguar's Island}'s skills.",
    // A bare "switched to Rest Mode" would also be an attack's.
    "[Permanent] This card can't be switched to Rest Mode.",
  ]) assert.ok(unread(text).length, `unread, and says so: ${text}`);
}

// ── 2. the VM, from both seats ───────────────────────────────────────────────

const C = (id: string, o: Partial<CardDef>) => card(id, { energyCost: 0, comboCost: 0, ...o });
const defs: Record<string, CardDef> = {
  ...DEFS,
  // Printed wordings (the costs and powers are the stage's own).
  BT28_053: C("BT28_053", { skill: "[Activate: Main] Choose up to 2 of your opponent's Battle Cards, ignoring [Barrier], and until the end of your opponent's turn, they can't attack or activate the [Blocker] skill." }),
  EB1_21: C("EB1_21", { skill: "[Permanent] This card can't be used in a combo from the Battle Area." }),
  BT10_154: C("BT10_154", { skill: "[Permanent] You can't combo with cards in your Battle Area." }),
  BT4_122: C("BT4_122", { skill: "[Activate: Main] Draw 1 card, and your opponent may not activate [Counter: Play] skills for the duration of the turn." }),
  BT10_065: C("BT10_065", { skill: "[Permanent] This card can't be removed from Battle Areas by skills." }),
  BT8_040: C("BT8_040", { skill: "[permanent] This card can't be removed from a Battle Area by your opponent's card skills." }),
  DB2_138: C("DB2_138", { skill: "[Permanent] This card can't be switched to Rest Mode by your opponent's skills." }),
  BT6_028: C("BT6_028", { skill: "[Permanent] You can't send cards from Drop Areas to Warps." }),
  BT16_001: C("BT16_001", { skill: "[Permanent] You can't send cards from your Drop Area to your Warp." }),
  KOWALL: C("KOWALL", { power: 5000, skill: "[Permanent] This card can't be KO'd by your opponent's attacks." }),
  BT15_122: C("BT15_122", { skill: "[Permanent] Your opponent's skill-less cards can't attack this card." }),
  BT1_093: C("BT1_093", { skill: "[Permanent] If this card is in Rest Mode, your opponent cannot attack your other Battle Cards." }),
  EX23_05: C("EX23_05", { skill: "[permanent] You and your opponent can't play Battle Cards with 25000 power or more from their owner's hands." }),
  BT3_078: C("BT3_078", { skill: "[Permanent] Your Battle Cards can't be KO'd by your own skills." }),
  // The skills that try the forbidden actions.
  BOUNCE_THEIRS: C("BOUNCE_THEIRS", { skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and return it to its owner's hand." }),
  BOUNCE_MINE: C("BOUNCE_MINE", { skill: "[Activate: Main] Choose up to 1 of your Battle Cards and return it to its owner's hand." }),
  REST_THEIRS: C("REST_THEIRS", { skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and switch it to Rest Mode." }),
  REST_MINE: C("REST_MINE", { skill: "[Activate: Main] Choose up to 1 of your Battle Cards and switch it to Rest Mode." }),
  KO_MINE: C("KO_MINE", { skill: "[Activate: Main] Choose up to 1 of your Battle Cards and KO it." }),
  WARP_ONE: C("WARP_ONE", { skill: "[Activate: Main] Choose up to 1 card in your Drop Area and send it to your Warp." }),
  WARP_PRICE: C("WARP_PRICE", { skill: "[Activate: Main] Send 1 card from your Drop Area to your Warp: Draw 1 card." }),
  REALM: C("REALM", { skill: "[Over Realm 1]" }),
  COUNTER_PLAY: C("COUNTER_PLAY", { type: "EXTRA", power: null, comboCost: null, comboPower: null, skill: "[Counter: Play] Negate the play." }),
  BIG: C("BIG", { power: 25000 }),
  SMALL: C("SMALL", { power: 20000 }),
  SKILLED: C("SKILLED", { power: 30000, skill: "[Blocker]" }),
  PLAIN: C("PLAIN", { power: 30000 }),
  BLOCK: C("BLOCK", { skill: "[Blocker]" }),
};
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(JSON.parse(JSON.stringify(rows)), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");
const take = (s: VmState, action: Action): VmState => RULES.apply(ctx, roundtrip(s), action).state as VmState;
const SEATS: PlayerId[] = ["p1", "p2"];

/** A game at the Main Phase of `turn` (p1's third turn, or p2's after it), each side with energy. */
function game3(turn: PlayerId): VmState {
  let s = RULES.createGame(ctx, { seed: 2014, p1: { name: "First", leader: "L-RED", main: fifty("V1") }, p2: { name: "Second", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  const steps: Action[] = [
    { type: "chooseFirst", player: s.chooser, first: "p1" } as Action,
    { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null }, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null },
    { type: "endMain", player: "p2" }, { type: "charge", player: "p1", card: null },
  ] as Action[];
  for (const a of steps) s = take(s, a);
  if (turn === "p2") s = endTurn(s);
  assert.equal(s.prompt.kind, "main");
  assert.equal((s.prompt as { player: PlayerId }).player, turn);
  return roundtrip(s);
}
function stage(s: VmState, p: PlayerId, def: string, area: string, mode: "active" | "rest" = "active"): string {
  const id = s.sides[p].zones.deck[0]; s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (area === "battle") s.cards[id].mode = mode;
  return id;
}
/** Answer whatever the engine asks until it is back at a Main Phase. */
function settle(s: VmState, pick: string[] = []): VmState {
  for (let i = 0; i < 40 && s.prompt.kind !== "main"; i++) {
    const q = s.prompt;
    if (q.kind === "chooseCards") {
      const want = q.choice.candidates.filter((c) => pick.includes(c));
      s = take(s, { type: "choose", player: q.player, cards: want.length ? want.slice(0, q.choice.max ?? want.length) : q.choice.candidates.slice(0, q.choice.min) });
    } else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: q.player, index: 0 });
    else if (q.kind === "counter") s = take(s, { type: "counter", player: q.player, card: null });
    else if (q.kind === "blocker" || q.kind === "combo") s = take(s, { type: "pass", player: q.player } as Action);
    else if (q.kind === "charge") s = take(s, { type: "charge", player: q.player, card: null });
    else throw new Error(`unexpected prompt ${q.kind}`);
  }
  return s;
}
/** The turn player ends the turn; the next player charges nothing and is at their Main Phase. */
function endTurn(s: VmState): VmState {
  const p = (s.prompt as { player: PlayerId }).player;
  return settle(take(s, { type: "endMain", player: p }));
}
const activations = (s: VmState, id: string) => RULES.legalActions(ctx, s).filter((l) => l.action.type === "activate" && l.action.card === id);
function activate(s: VmState, id: string, pick: string[] = []): VmState {
  const [a] = activations(s, id);
  assert.ok(a, `${s.cards[id].cardId} is offered`);
  return settle(take(s, a.action), pick);
}
/** attacker → the defenders it may be declared against, for player `p`. */
function attacks(s: VmState, p: PlayerId): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const l of RULES.legalActions(ctx, s)) {
    const a = l.action;
    if (a.type !== "attack" || a.player !== p) continue;
    if (!out.has(a.attacker)) out.set(a.attacker, new Set());
    out.get(a.attacker)!.add(a.target);
  }
  return out;
}
const zoneOf = (s: VmState, id: string) => (["p1", "p2"] as PlayerId[]).flatMap((p) => Object.entries(s.sides[p].zones).filter(([, ids]) => ids.includes(id)).map(([z]) => z))[0];

for (const me of SEATS) {
  const you = other(me);

  // Several actions: "they can't attack or activate the [Blocker] skill" until
  // the end of the opponent's turn (BT28-053) — attack and block both refused
  // through their turn, both back after it; the skill's own side is untouched.
  {
    let s = game3(me);
    const src = stage(s, me, "BT28_053", "battle");
    const theirs = stage(s, you, "BLOCK", "battle");
    const mine = stage(s, me, "BLOCK", "battle");
    s = roundtrip(activate(s, src, [theirs]));
    assert.ok(forbiddenBy(ctx, game, s, "block", { player: you, card: theirs }), `${me}: the chosen card can't block`);
    assert.ok(!forbiddenBy(ctx, game, s, "block", { player: me, card: mine }), `${me}: a card of the skill's own side still can`);
    s = roundtrip(endTurn(s));
    assert.ok(!attacks(s, you).has(theirs), `${me}: through the opponent's turn the chosen card is not offered an attack`);
    assert.throws(() => take(s, { type: "attack", player: you, attacker: theirs, target: s.sides[me].zones.leader[0] }), `${me}: and a forced attack is refused`);
    assert.ok(attacks(s, you).has(s.sides[you].zones.leader[0]), `${me}: their Leader may still attack`);
    s = roundtrip(endTurn(s));
    assert.ok(!forbiddenBy(ctx, game, s, "block", { player: you, card: theirs }) && !forbiddenBy(ctx, game, s, "attack", { player: you, card: theirs }), `${me}: after the opponent's turn both are allowed again`);
  }

  // A combo: EB1-21 from the Battle Area only; BT10-154 the player's Battle Area cards only.
  {
    const s = roundtrip(game3(me));
    const eb = stage(s, me, "EB1_21", "battle");
    assert.ok(forbiddenBy(ctx, game, s, "combo", { player: me, card: eb }), `${me}: EB1-21 can't combo from the Battle Area`);
    const back = roundtrip(s);
    assert.ok(moveCard(back, game, eb, "hand", { owner: me }).ok);
    assert.ok(!forbiddenBy(ctx, game, back, "combo", { player: me, card: eb }), `${me}: from the hand it can (the rule is the card's in play only)`);
    const s2 = roundtrip(game3(me));
    stage(s2, me, "BT10_154", "battle");
    const field = stage(s2, me, "V1", "battle");
    const hand = stage(s2, me, "V1", "hand");
    const theirs = stage(s2, you, "V1", "battle");
    const r = roundtrip(s2);
    assert.ok(forbiddenBy(ctx, game, r, "combo", { player: me, card: field }), `${me}: BT10-154 — a Battle Area card can't combo`);
    assert.ok(!forbiddenBy(ctx, game, r, "combo", { player: me, card: hand }), `${me}: a hand card can`);
    assert.ok(!forbiddenBy(ctx, game, r, "combo", { player: you, card: theirs }), `${me}: the opponent is not bound`);
  }

  // "Your opponent may not activate [Counter: Play] skills for the duration of the turn" (BT4-122).
  {
    let s = game3(me);
    const src = stage(s, me, "BT4_122", "battle");
    const cp = stage(s, you, "COUNTER_PLAY", "hand");
    const mineCp = stage(s, me, "COUNTER_PLAY", "hand");
    s = roundtrip(activate(s, src));
    assert.ok(forbiddenBy(ctx, game, s, "activateCounter", { player: you, card: cp, skillKind: "counter:play" }), `${me}: the opponent's [Counter: Play] is refused`);
    assert.ok(!forbiddenBy(ctx, game, s, "activateCounter", { player: you, card: cp, skillKind: "counter:attack" }), `${me}: another [Counter] kind is not`);
    assert.ok(!forbiddenBy(ctx, game, s, "activateCounter", { player: me, card: mineCp, skillKind: "counter:play" }), `${me}: the skill's own side is not bound`);
    s = roundtrip(endTurn(s));
    assert.ok(!forbiddenBy(ctx, game, s, "activateCounter", { player: you, card: cp, skillKind: "counter:play" }), `${me}: next turn it is allowed`);
  }

  // Removal by skills: BT10-065 ("by skills") stops both players' bounce,
  // BT8-040 ("by your opponent's card skills") only the opponent's.
  for (const [def, ownStopped] of [["BT10_065", true], ["BT8_040", false]] as const) {
    // The opponent's bounce, on their turn.
    let s = game3(you);
    const guarded = stage(s, me, def, "battle");
    const plain = stage(s, me, "V1", "battle");
    const bouncer = stage(s, you, "BOUNCE_THEIRS", "battle");
    s = roundtrip(activate(s, bouncer, [guarded]));
    assert.equal(zoneOf(s, guarded), "battle", `${me}: ${def} is not removed by the opponent's skill`);
    const bouncer2 = stage(s, you, "BOUNCE_THEIRS", "battle");
    s = roundtrip(activate(s, bouncer2, [plain]));
    assert.equal(zoneOf(s, plain), "hand", `${me}: a card with no such rule is (control)`);
    // Its controller's own bounce, on their turn.
    let t = game3(me);
    const g2 = stage(t, me, def, "battle");
    const own = stage(t, me, "BOUNCE_MINE", "battle");
    t = roundtrip(activate(t, own, [g2]));
    assert.equal(zoneOf(t, g2), ownStopped ? "battle" : "hand", `${me}: ${def} ${ownStopped ? "is not" : "is"} removed by its own controller's skill`);
  }

  // A skill's switch to Rest Mode (DB2-138): the opponent's refused, its controller's not.
  {
    let s = game3(you);
    const guarded = stage(s, me, "DB2_138", "battle");
    const plain = stage(s, me, "V1", "battle");
    s = roundtrip(activate(s, stage(s, you, "REST_THEIRS", "battle"), [guarded]));
    assert.equal(s.cards[guarded].mode, "active", `${me}: the opponent's skill does not rest it`);
    s = roundtrip(activate(s, stage(s, you, "REST_THEIRS", "battle"), [plain]));
    assert.equal(s.cards[plain].mode, "rest", `${me}: a card with no such rule is rested (control)`);
    let t = game3(me);
    const g2 = stage(t, me, "DB2_138", "battle");
    t = roundtrip(activate(t, stage(t, me, "REST_MINE", "battle"), [g2]));
    assert.equal(t.cards[g2].mode, "rest", `${me}: its controller's own skill rests it`);
  }

  // Drop to Warp (BT6-028 any Drop, BT16-001 your own): an effect's move, a
  // price, and [Over Realm] are refused for the bound player only, and come
  // back when the card leaves play.
  for (const def of ["BT6_028", "BT16_001"]) {
    let s = game3(me);
    const rule = stage(s, me, def, "battle");
    const mineDrop = stage(s, me, "V1", "drop");
    const warp = stage(s, me, "WARP_ONE", "battle");
    const price = stage(s, me, "WARP_PRICE", "battle");
    const realm = stage(s, me, "REALM", "hand");
    s = roundtrip(s);
    assert.equal(activations(s, price).length, 0, `${me} ${def}: a price that sends a Drop card to the Warp is not offered`);
    assert.ok(!RULES.legalActions(ctx, s).some((l) => l.action.type === "activate" && l.action.card === realm), `${me} ${def}: nor is [Over Realm]`);
    s = roundtrip(activate(s, warp, [mineDrop]));
    assert.equal(zoneOf(s, mineDrop), "drop", `${me} ${def}: the effect's move does not happen`);
    // The rule gone, all three are back.
    const free = roundtrip(s);
    assert.ok(moveCard(free, game, rule, "hand", { owner: me }).ok);
    assert.equal(activations(free, price).length, 1, `${me} ${def}: without the rule the price is offered`);
    assert.ok(RULES.legalActions(ctx, free).some((l) => l.action.type === "activate" && l.action.card === realm), `${me} ${def}: and [Over Realm]`);
    // The opponent is not bound: their own move, on their turn.
    let t = game3(you);
    stage(t, me, def, "battle");
    const theirDrop = stage(t, you, "V-BLUE", "drop");
    t = roundtrip(activate(t, stage(t, you, "WARP_ONE", "battle"), [theirDrop]));
    assert.equal(zoneOf(t, theirDrop), "warp", `${me} ${def}: the opponent's move happens`);
  }

  // "Can't be KO'd by your opponent's attacks": the opponent's stronger attacker does not KO it.
  for (const [def, kod] of [["KOWALL", false], ["SMALL", true]] as const) {
    let s = game3(you);
    const guard = stage(s, me, def, "battle", "rest");
    if (def === "SMALL") s.cards[guard].cardId = "V1"; // 10000 power, no rule (control)
    const attacker = stage(s, you, "PLAIN", "battle");
    s = roundtrip(settle(take(s, { type: "attack", player: you, attacker, target: guard })));
    assert.equal(zoneOf(s, guard), kod ? "drop" : "battle", `${me}: ${kod ? "a card with no such rule is KO'd (control)" : "the guard survives the battle"}`);
  }

  // "Your Battle Cards can't be KO'd by your own skills" (BT3-078).
  {
    let s = game3(me);
    stage(s, me, "BT3_078", "battle");
    const mine = stage(s, me, "V1", "battle");
    s = roundtrip(activate(s, stage(s, me, "KO_MINE", "battle"), [mine]));
    assert.equal(zoneOf(s, mine), "battle", `${me}: its own skill does not KO it`);
    assert.ok(!forbiddenBy(ctx, game, s, "beKOdBySkill", { player: you, card: mine }), `${me}: the opponent's skill is not stopped`);
  }

  // Defenders: BT15-122 (only skill-less attackers, only this card) and BT1-093 (while rested).
  {
    const s = game3(you);
    const wall = stage(s, me, "BT15_122", "battle", "rest");
    const other_ = stage(s, me, "V1", "battle", "rest");
    const bare = stage(s, you, "PLAIN", "battle");
    const skilled = stage(s, you, "SKILLED", "battle");
    const m = attacks(roundtrip(s), you);
    assert.ok(!m.get(bare)?.has(wall) && m.get(bare)?.has(other_), `${me}: a skill-less attacker may not attack it, but may attack another card`);
    assert.ok(m.get(skilled)?.has(wall), `${me}: an attacker with a skill may attack it`);
    const t = game3(you);
    const guard = stage(t, me, "BT1_093", "battle", "rest");
    const behind = stage(t, me, "V1", "battle", "rest");
    const atk = stage(t, you, "PLAIN", "battle");
    const on = attacks(roundtrip(t), you);
    assert.ok(!on.get(atk)?.has(behind) && on.get(atk)?.has(guard) && on.get(atk)?.has(t.sides[me].zones.leader[0]), `${me}: BT1-093 rested — the other Battle Cards are not offered, it and the Leader are`);
    const off = roundtrip(t); off.cards[guard].mode = "active";
    assert.ok(attacks(off, you).get(atk)?.has(behind), `${me}: BT1-093 active — the rule is off`);
  }

  // A play from the hand (EX23-05): both players, 25000 power or more, from a hand only.
  {
    const s = game3(me);
    stage(s, me, "EX23_05", "battle");
    const big = stage(s, me, "BIG", "hand");
    const small = stage(s, me, "SMALL", "hand");
    const dropBig = stage(s, me, "BIG", "drop");
    const theirBig = stage(s, you, "BIG", "hand");
    const r = roundtrip(s);
    const plays = RULES.legalActions(ctx, r).filter((l) => l.action.type === "play").map((l) => (l.action as { card: string }).card);
    assert.ok(!plays.includes(big) && plays.includes(small), `${me}: a 25000-power Battle Card is not offered from the hand, a 20000 one is`);
    assert.ok(!forbiddenBy(ctx, game, r, "play", { player: me, card: dropBig }), `${me}: not from the Drop`);
    assert.ok(forbiddenBy(ctx, game, r, "play", { player: you, card: theirBig }), `${me}: and the opponent is bound too`);
  }
}
console.log("prohibition catalog: readings for every group, and each forbidden action refused while it holds and allowed after, from both seats");
