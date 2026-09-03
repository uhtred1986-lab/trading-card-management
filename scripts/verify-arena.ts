/**
 * Arena engine checks — pure, no database. Run with `tsx`.
 *
 * Synthetic cards exercise the rules one at a time; the numbers in comments
 * are Rule Manual sections.
 */
import assert from "node:assert/strict";
import { apply, createGame, defsFrom, legalActions, type Action, type CardDef, type GameState, type PlayerId } from "../src/lib/arena/engine";
import { parseSkills, keywordOf, orbsIn } from "../src/lib/arena/engine/cards";
import { parseFilter, matches, parseCondition } from "../src/lib/arena/engine/filters";
import { move, locate, powerOf } from "../src/lib/arena/engine/state";

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

  const unison = parseSkills("[Empower Green 5]<br>[+1][Activate: Main] Place 1 card from your hand at the bottom of your deck: Draw 1 card.<br>[-6][Activate: Main] Your opponent discards 2 cards from their hand.");
  assert.deepEqual(unison[0].keyword, { name: "Empower", color: "Green", x: 5 });
  assert.equal(unison[1].markerCost, 1);
  assert.equal(unison[1].kind, "activate:main");
  assert.equal(unison[2].markerCost, -6);

  const counter = parseSkills("[Energy-Exhaust] (If this card is placed in an Energy Area from any area, it must be placed there in Rest Mode.)<br>[Counter: Play] The Battle Card your opponent is playing is played in Rest Mode.");
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
  const baby: CardDef = { id: "X", name: "Baby", type: "BATTLE", colors: ["Blue"], energyCost: 4, zEnergyCost: null, power: 1, comboCost: 0, comboPower: 0, skill: null, characters: ["Baby"], traits: [] };
  assert.equal(matches(baby, f), true);
  assert.equal(matches({ ...baby, energyCost: 3 }, f), false);
  assert.equal(matches({ ...baby, colors: ["Red"] }, f), false);

  assert.equal(parseCondition("When your life is at 4 or less").lifeAtMost, 4);
  assert.equal(parseCondition("If there is a total of 4 or more energy between you and your opponent").totalEnergyAtLeast, 4);
  assert.equal(parseCondition("When you have a Blue/Green multicolor card in your energy and your life is at 6 or less").recognised, false);
  assert.equal(parseCondition("When your opponent's life is at 3 or less").opponentLifeAtMost, 3);
}

// ── synthetic cards ────────────────────────────────────────────────────────

const card = (id: string, o: Partial<CardDef>): CardDef => ({
  id,
  name: id,
  type: "BATTLE",
  colors: ["Red"],
  energyCost: 1,
  zEnergyCost: null,
  power: 10000,
  comboCost: 0,
  comboPower: 5000,
  skill: null,
  characters: [id],
  traits: [],
  ...o,
});

const DEFS = defsFrom([
  card("L-RED", { type: "LEADER", energyCost: null, comboCost: null, comboPower: null, skill: "[Awaken] When your life is at 4 or less: Draw 1 card and flip this card over.", back: { name: "L-RED awakened", power: 15000, skill: null } }),
  card("L-BLUE", { type: "LEADER", colors: ["Blue"], energyCost: null, comboCost: null, comboPower: null }),
  card("V1", {}),
  card("V-BLUE", { colors: ["Blue"] }),
  card("BLOCKER", { energyCost: 2, skill: "[Blocker]", comboCost: 1, comboPower: 10000 }),
  card("CRIT", { energyCost: 3, power: 15000, skill: "[Critical]" }),
  card("DOUBLE", { energyCost: 4, power: 20000, skill: "[Double Strike]" }),
  card("DUAL", { energyCost: 3, power: 15000, skill: "[Dual Attack]" }),
  card("INDESTRUCT", { energyCost: 2, skill: "[Indestructible]" }),
  card("REVENGE", { energyCost: 2, power: 5000, skill: "[Revenge]" }),
  card("BIG", { energyCost: 5, power: 25000 }),
  card("UNIQ", { energyCost: 1, skill: "[Unique]" }),
  card("E-NEGATE", { type: "EXTRA", energyCost: 1, power: null, comboCost: null, comboPower: null, skill: "[Counter: Attack] Negate the attack." }),
  card("E-DRAW", { type: "EXTRA", energyCost: 1, power: null, comboCost: null, comboPower: null, skill: "[Activate: Main] Draw 2 cards." }),
  card("U1", { type: "UNISON", energyCost: "X", power: 5000, comboCost: null, comboPower: null, skill: "[Blocker]" }),
  card("ZB", { type: "Z-BATTLE", energyCost: 2, zEnergyCost: 1, power: 20000, comboCost: null, comboPower: null, skill: "[Z-Stack 1] Red <V1>." }),
  card("EVO", { energyCost: 3, power: 20000, skill: "[Evolve]{1}: <V1>" }),
]);

const fifty = (id: string) => Array.from({ length: 50 }, () => id);

function game(seed = 1, p1 = fifty("V1"), p2 = fifty("V-BLUE"), z: string[] = []) {
  return createGame({ defs: DEFS }, { seed, p1: { name: "You", leader: "L-RED", main: p1, z }, p2: { name: "Claude", leader: "L-BLUE", main: p2 } }).state;
}

/** Apply a list of actions, asserting each is legal. */
function play(s: GameState, ...actions: Action[]): GameState {
  for (const a of actions) s = apply({ defs: DEFS }, s, a).state;
  return s;
}

function labels(s: GameState): string[] {
  return legalActions({ defs: DEFS }, s).map((a) => a.label);
}

/** Every card instance is in exactly one area (3-1). */
function assertConsistent(s: GameState): void {
  const seen = new Map<string, number>();
  for (const p of ["p1", "p2"] as PlayerId[]) {
    const ps = s.players[p];
    const all = [ps.leader, ps.unison, ...ps.deck, ...ps.hand, ...ps.drop, ...ps.warp, ...ps.life, ...ps.battle, ...ps.combo, ...ps.energy, ...ps.zDeck, ...ps.zEnergy, ...ps.removed].filter(Boolean) as string[];
    for (const id of all) seen.set(id, (seen.get(id) ?? 0) + 1);
    for (const id of all) for (const u of s.cards[id].under) seen.set(u, (seen.get(u) ?? 0) + 1);
    assert.ok(ps.life.length <= 8, "life never exceeds 8");
  }
  for (const id of Object.keys(s.cards)) assert.equal(seen.get(id), 1, `${id} is in exactly one place (found ${seen.get(id) ?? 0})`);
}

// ── setup (6-2) ────────────────────────────────────────────────────────────

{
  let s = game();
  assert.equal(s.prompt.kind, "chooseFirst");
  const chooser = (s.prompt as { player: PlayerId }).player;
  s = play(s, { type: "chooseFirst", player: chooser, first: "p1" });
  assert.equal(s.prompt.kind, "mulligan");
  assert.equal((s.prompt as { player: PlayerId }).player, "p1");
  assert.equal(s.players.p1.hand.length, 6);
  s = play(s, { type: "mulligan", player: "p1", redraw: true });
  assert.equal(s.players.p1.hand.length, 6, "6-2-1-9-1: redraw six");
  assert.equal(s.players.p1.deck.length, 44);
  s = play(s, { type: "mulligan", player: "p2", redraw: false });
  assert.equal(s.players.p1.life.length, 8, "6-2-1-10: eight life");
  assert.equal(s.players.p2.life.length, 8);
  assert.equal(s.players.p2.energyMarkers, 1, "6-2-1-11: second player gets an energy marker");
  assert.equal(s.players.p1.energyMarkers, 0);
  assert.equal(s.turn, 1);
  assert.equal(s.turnPlayer, "p1");
  assert.equal(s.phase, "charge");
  assert.equal(s.prompt.kind, "charge");
  assert.equal(s.players.p1.hand.length, 6, "7-2-9-1: no draw on the first player's first turn");
  assertConsistent(s);

  // Charge, then Main: cost-1 plays are legal, attacks are not (7-3-4-4-1).
  const first = s.players.p1.hand[0];
  s = play(s, { type: "charge", player: "p1", card: first });
  assert.equal(s.players.p1.energy.length, 1);
  assert.equal(s.prompt.kind, "main");
  const l = labels(s);
  assert.ok(l.some((x) => x.startsWith("Play V1")), "can play a 1-cost with 1 energy");
  assert.ok(!l.some((x) => x.startsWith("Attack")), "no attack on turn 1");
  assert.ok(l.includes("End turn"));

  // Play a card: energy rests, card in battle area, still Main.
  const v = s.players.p1.hand[0];
  s = play(s, { type: "play", player: "p1", card: v });
  assert.deepEqual(s.players.p1.battle, [v]);
  assert.equal(s.cards[s.players.p1.energy[0]].mode, "rest", "5-3-1: energy switched to Rest Mode");
  assert.ok(!labels(s).some((x) => x.startsWith("Play")), "no energy left");
  s = play(s, { type: "endMain", player: "p1" });

  // p2's turn 2: draw, energy from the marker + charge.
  assert.equal(s.turn, 2);
  assert.equal(s.turnPlayer, "p2");
  assert.equal(s.players.p2.hand.length, 7, "7-2-9: the second player draws");
  assert.equal(s.cards[s.players.p1.energy[0]].mode, "rest", "opponent's energy stays rested on my turn");
  s = play(s, { type: "charge", player: "p2", card: s.players.p2.hand[0] });
  const l2 = labels(s);
  assert.ok(l2.some((x) => x.startsWith("Attack L-RED with L-BLUE")), "8-1-1: the leader can attack the leader");
  assert.ok(!l2.some((x) => x.includes(`with ${v}`)), "opponent's cards don't attack for me");
  assert.ok(!l2.some((x) => x.startsWith("Attack V1")), "8-1-1: active battle cards can't be attacked");
  assert.ok(l2.some((x) => x.startsWith("Play V-BLUE")), "1-14: an energy marker plus one energy pays cost 2? no — cost 1 with two sources");

  // Attack the leader: offense → defense → damage. 10000 vs 10000 hits (8-4-6).
  s = play(s, { type: "attack", player: "p2", attacker: s.players.p2.leader, target: s.players.p1.leader });
  assert.equal(s.cards[s.players.p2.leader].mode, "rest", "8-1-1: attacking rests the attacker");
  assert.equal(s.prompt.kind, "combo");
  assert.equal((s.prompt as { side: string }).side, "offense");
  s = play(s, { type: "pass", player: "p2" });
  assert.equal(s.prompt.kind, "combo");
  assert.equal((s.prompt as { player: PlayerId }).player, "p1");
  const lifeBefore = s.players.p1.life.length;
  const handBefore = s.players.p1.hand.length;
  s = play(s, { type: "pass", player: "p1" });
  assert.equal(s.players.p1.life.length, lifeBefore - 1, "21-3: one damage");
  assert.equal(s.players.p1.hand.length, handBefore + 1, "21-3: the life card goes to the hand");
  assert.equal(s.battle, null);
  assert.equal(s.prompt.kind, "main");
  assertConsistent(s);

  // Turn 3: p1's rested energy and leader are active again (7-2-7).
  s = play(s, { type: "endMain", player: "p2" });
  assert.equal(s.turnPlayer, "p1");
  assert.equal(s.cards[s.players.p1.energy[0]].mode, "active");
  assert.equal(s.cards[s.players.p2.leader].mode, "rest", "only the turn player's cards wake up");
}

// ── combos, blockers, counters, keywords ───────────────────────────────────

/** A game already in p1's Main Phase on turn 3 with a chosen hand and energy. */
function arena(opts: { hand?: string[]; energy?: string[]; battle?: string[]; oppHand?: string[]; oppBattle?: string[]; oppEnergy?: string[]; z?: string[] } = {}): GameState {
  let s = game(7, fifty("V1"), fifty("V-BLUE"), opts.z);
  const chooser = (s.prompt as { player: PlayerId }).player;
  s = play(s, { type: "chooseFirst", player: chooser, first: "p1" }, { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false });
  s = play(s, { type: "charge", player: "p1", card: null }, { type: "endMain", player: "p1" });
  s = play(s, { type: "charge", player: "p2", card: null }, { type: "endMain", player: "p2" });
  s = play(s, { type: "charge", player: "p1", card: null });
  assert.equal(s.prompt.kind, "main");
  // Set the table by hand: swap deck cards for the wanted definitions and move them.
  const ctx = { defs: DEFS };
  const give = (p: PlayerId, ids: string[], area: "hand" | "energy" | "battle") => {
    for (const cardId of ids) {
      const inst = s.players[p].deck.find((id) => s.cards[id].cardId === "V1" || s.cards[id].cardId === "V-BLUE")!;
      s.cards[inst].cardId = cardId;
      move(ctx, s, [], inst, area, p);
    }
  };
  give("p1", opts.hand ?? [], "hand");
  give("p1", opts.energy ?? [], "energy");
  give("p1", opts.battle ?? [], "battle");
  give("p2", opts.oppHand ?? [], "hand");
  give("p2", opts.oppEnergy ?? [], "energy");
  give("p2", opts.oppBattle ?? [], "battle");
  for (const id of s.players.p1.hand.slice()) if (s.cards[id].cardId === "V1" && !(opts.hand ?? []).includes("V1")) move(ctx, s, [], id, "deck", "p1", { position: "bottom" });
  for (const id of s.players.p2.hand.slice()) if (s.cards[id].cardId === "V-BLUE") move(ctx, s, [], id, "deck", "p2", { position: "bottom" });
  return s;
}

const find = (s: GameState, p: PlayerId, area: "hand" | "battle" | "energy" | "zDeck", cardId: string) => s.players[p][area].find((id) => s.cards[id].cardId === cardId)!;

// Combo power decides the battle (8-4-4/5); combo cards go to the Drop (8-5-8).
{
  let s = arena({ hand: ["V1", "V1"], energy: ["V1", "V1"], oppBattle: ["V-BLUE"] });
  const opp = s.players.p2.battle[0];
  s.cards[opp].mode = "rest";
  const l = labels(s);
  assert.ok(l.some((x) => x.startsWith("Attack V-BLUE with L-RED")), "8-1-1: a rested battle card is a legal target");
  s = play(s, { type: "attack", player: "p1", attacker: s.players.p1.leader, target: opp });
  // Offense: combo from hand costs 0 and adds 5000.
  const c1 = find(s, "p1", "hand", "V1");
  s = play(s, { type: "combo", player: "p1", card: c1 });
  assert.deepEqual(s.players.p1.combo, [c1]);
  assert.equal(s.prompt.kind, "combo");
  s = play(s, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  const cmp = s.battle;
  assert.equal(cmp, null);
  assert.ok(s.players.p2.drop.includes(opp), "8-4-6-2: the guard is KO'd");
  assert.ok(s.players.p1.drop.includes(c1), "8-5-8: combo cards go to the Drop");
  assertConsistent(s);
}

// Guard wins on a tie? No: attacker wins ties (8-4-6, ≥). A weaker attacker bounces.
{
  let s = arena({ battle: ["REVENGE"], oppBattle: ["BIG"] });
  const big = s.players.p2.battle[0];
  s.cards[big].mode = "rest";
  const rev = s.players.p1.battle[0];
  s = play(s, { type: "attack", player: "p1", attacker: rev, target: big }, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  assert.ok(s.players.p2.battle.includes(big), "a 5000 attack into 25000 does nothing");
  assert.ok(s.players.p1.battle.includes(rev), "the attacker is not KO'd by losing");
}

// [Blocker] (22-4): the opponent redirects the attack to an active Blocker, which rests.
{
  let s = arena({ oppBattle: ["BLOCKER"] });
  const blocker = s.players.p2.battle[0];
  s = play(s, { type: "attack", player: "p1", attacker: s.players.p1.leader, target: s.players.p2.leader });
  assert.equal(s.prompt.kind, "blocker");
  assert.deepEqual((s.prompt as { candidates: string[] }).candidates, [blocker]);
  s = play(s, { type: "block", player: "p2", card: blocker });
  assert.equal(s.battle?.guard, blocker);
  assert.equal(s.cards[blocker].mode, "rest", "22-4-2: blocking rests the card");
  s = play(s, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  assert.ok(s.players.p2.drop.includes(blocker), "10000 vs 10000: the blocker is KO'd");
  assert.equal(s.players.p2.life.length, 8, "the leader took no damage");
  // A rested Blocker is not offered.
  s = arena({ oppBattle: ["BLOCKER"] });
  s.cards[s.players.p2.battle[0]].mode = "rest";
  s = play(s, { type: "attack", player: "p1", attacker: s.players.p1.leader, target: s.players.p2.leader });
  assert.equal(s.prompt.kind, "combo", "no active Blocker → straight to the Offense Step");
}

// [Counter: Attack] "Negate the attack" (22-10-3-2, 8-1-6-1).
{
  let s = arena({ oppHand: ["E-NEGATE"], oppEnergy: ["V1"] });
  const neg = find(s, "p2", "hand", "E-NEGATE");
  s = play(s, { type: "attack", player: "p1", attacker: s.players.p1.leader, target: s.players.p2.leader });
  assert.equal(s.prompt.kind, "counter");
  assert.deepEqual((s.prompt as { candidates: string[] }).candidates, [neg]);
  s = play(s, { type: "counter", player: "p2", card: neg });
  assert.equal(s.battle, null, "the battle ended without an Offense Step");
  assert.equal(s.prompt.kind, "main");
  assert.equal(s.players.p2.life.length, 8);
  assert.ok(s.players.p2.drop.includes(neg), "22-10-7: the counter card goes to the Drop");
  assert.equal(s.cards[s.players.p1.leader].mode, "rest", "the attacker stays rested");
  assertConsistent(s);
  // Without energy the counter isn't offered.
  s = arena({ oppHand: ["E-NEGATE"] });
  s = play(s, { type: "attack", player: "p1", attacker: s.players.p1.leader, target: s.players.p2.leader });
  assert.equal(s.prompt.kind, "combo");
}

// [Critical] sends life to the Drop (22-6); [Double Strike] deals 2 (22-7).
{
  let s = arena({ battle: ["CRIT", "DOUBLE"] });
  const crit = find(s, "p1", "battle", "CRIT");
  const dbl = find(s, "p1", "battle", "DOUBLE");
  const hand = s.players.p2.hand.length;
  s = play(s, { type: "attack", player: "p1", attacker: crit, target: s.players.p2.leader }, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  assert.equal(s.players.p2.life.length, 7);
  assert.equal(s.players.p2.drop.length, 1, "22-6: the life card went to the Drop");
  assert.equal(s.players.p2.hand.length, hand, "not to the hand");
  s = play(s, { type: "attack", player: "p1", attacker: dbl, target: s.players.p2.leader }, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  assert.equal(s.players.p2.life.length, 5, "22-7: two damage");
  assert.equal(s.players.p2.hand.length, hand + 2, "both life cards went to the hand");
}

// [Dual Attack] (22-8): the attacker is active again after the battle, once per turn.
{
  let s = arena({ battle: ["DUAL"] });
  const dual = s.players.p1.battle[0];
  s = play(s, { type: "attack", player: "p1", attacker: dual, target: s.players.p2.leader }, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  assert.equal(s.cards[dual].mode, "active", "22-8-3: switched back to Active Mode at the end of the battle");
  s = play(s, { type: "attack", player: "p1", attacker: dual, target: s.players.p2.leader }, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  assert.equal(s.cards[dual].mode, "rest", "only X-1 = 1 extra attack per turn");
  assert.equal(s.players.p2.life.length, 6);
}

// [Indestructible] survives a losing battle (22-12); [Revenge] KOs the attacker (22-9).
{
  let s = arena({ battle: ["BIG"], oppBattle: ["INDESTRUCT", "REVENGE"] });
  const big = s.players.p1.battle[0];
  const ind = find(s, "p2", "battle", "INDESTRUCT");
  const rev = find(s, "p2", "battle", "REVENGE");
  s.cards[ind].mode = "rest";
  s.cards[rev].mode = "rest";
  s = play(s, { type: "attack", player: "p1", attacker: big, target: ind }, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  assert.ok(s.players.p2.battle.includes(ind), "22-12: not KO'd by battle");
  // Wake BIG up for a second attack.
  s.cards[big].mode = "active";
  s = play(s, { type: "attack", player: "p1", attacker: big, target: rev }, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  assert.ok(s.players.p2.drop.includes(rev), "the Revenge card is KO'd");
  assert.ok(s.players.p1.drop.includes(big), "22-9-4: and it KOs the attacker at the end of the battle");
}

// [Unique] (22-39): a second copy can't be played while one is in play.
{
  const s = arena({ hand: ["UNIQ"], battle: ["UNIQ"], energy: ["V1"] });
  assert.ok(!labels(s).some((x) => x.startsWith("Play UNIQ")));
}

// Extras: [Activate: Main] with a native effect from hand (12-2-2).
{
  let s = arena({ hand: ["E-DRAW"], energy: ["V1"] });
  const e = find(s, "p1", "hand", "E-DRAW");
  assert.ok(labels(s).some((x) => x.startsWith("Activate E-DRAW")));
  const before = s.players.p1.hand.length;
  s = play(s, { type: "activate", player: "p1", card: e, skill: 0 });
  assert.equal(s.players.p1.hand.length, before - 1 + 2, "card left the hand, two drawn");
  assert.ok(s.players.p1.drop.includes(e), "12-2-2-2: the Extra goes to the Drop");
  assert.equal(s.prompt.kind, "main");
}

// [Awaken] (22-2): offered only when the printed condition holds, flips the leader.
{
  let s = arena({ battle: [] });
  assert.ok(!labels(s).some((x) => x.startsWith("Awaken")), "life 8 > 4");
  s.players.p1.life.splice(4); // drop to 4 life for the test
  assertConsistentAfterDrop(s);
  assert.ok(labels(s).some((x) => x.startsWith("Awaken")), "life ≤ 4");
  const before = s.players.p1.hand.length;
  s = play(s, { type: "activate", player: "p1", card: s.players.p1.leader, skill: 0 });
  assert.equal(s.cards[s.players.p1.leader].flipped, true, "22-2-4: flipped after the effect");
  assert.equal(s.players.p1.hand.length, before + 1, "the Draw 1 in the text ran");
  assert.equal(powerOf({ defs: DEFS }, s, s.players.p1.leader), 15000, "the back side's power counts");
  assert.ok(!labels(s).some((x) => x.startsWith("Awaken")), "can't awaken twice");
}
function assertConsistentAfterDrop(s: GameState) {
  // The test removed life cards outright; put them in the drop so the invariant holds.
  const gone = Object.keys(s.cards).filter((id) => s.cards[id].owner === "p1" && !locate(s, id));
  s.players.p1.drop.push(...gone);
}

// Unison (13-2, 13-3, 13-5): X markers, growth, guard loses a marker instead of KO.
{
  let s = arena({ hand: ["U1", "U1"], energy: ["V1", "V1", "V1"] });
  const u = find(s, "p1", "hand", "U1");
  assert.ok(labels(s).some((x) => x === "Play Unison U1 with 3 markers"));
  s = play(s, { type: "playUnison", player: "p1", card: u, x: 2 });
  assert.equal(s.players.p1.unison, u);
  assert.equal(s.cards[u].markers, 2, "13-2-1-3: markers equal the energy paid");
  assert.ok(labels(s).some((x) => x.startsWith("Grow U1")), "13-3-2: a copy in hand can grow it");
  const copy = find(s, "p1", "hand", "U1");
  s = play(s, { type: "growUnison", player: "p1", card: copy });
  assert.equal(s.cards[u].markers, 3);
  assert.deepEqual(s.cards[u].under, [copy]);
  assert.ok(!labels(s).some((x) => x.startsWith("Grow")), "once per turn");
  // Opponent attacks the Unison next turn: no Defense Step, one marker off.
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  s = play(s, { type: "attack", player: "p2", attacker: s.players.p2.leader, target: u }, { type: "pass", player: "p2" });
  assert.equal(s.prompt.kind, "main", "8-2-4-3-1-1: no Defense Step against a Unison");
  assert.equal(s.cards[u].markers, 2, "13-5-2-3: one marker removed");
  assertConsistent(s);
}

// Z-cards (16-2, 22-47): Z-Energy is paid from the Z-Energy Area; Z-Stack asks which card to tuck.
{
  let s = arena({ hand: ["V1"], energy: ["V1", "V1"], z: ["ZB", "V1"] });
  // Nothing in Z-Energy yet → not playable.
  assert.ok(!labels(s).some((x) => x.includes("Z-Battle")));
  // Combo a card and send it to Z-Energy at the end of a battle (8-5-2).
  s = play(s, { type: "attack", player: "p1", attacker: s.players.p1.leader, target: s.players.p2.leader });
  const c = find(s, "p1", "hand", "V1");
  s = play(s, { type: "combo", player: "p1", card: c }, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  assert.equal(s.prompt.kind, "zEnergyFromCombo");
  s = play(s, { type: "zEnergyFromCombo", player: "p1", card: c });
  assert.deepEqual(s.players.p1.zEnergy, [c]);
  assert.ok(labels(s).some((x) => x.startsWith("Play Z-Battle ZB")), "now affordable");
  const zb = find(s, "p1", "zDeck", "ZB");
  s = play(s, { type: "playZ", player: "p1", card: zb });
  assert.equal(s.players.p1.zEnergy.length, 0, "5-4-1: Z-Energy paid to the Drop");
  assert.equal(s.prompt.kind, "chooseCards", "22-47: Z-Stack asks for the card to place under");
  const tuck = (s.prompt as { choice: { candidates: string[] } }).choice.candidates[0];
  s = play(s, { type: "choose", player: "p1", cards: [tuck] });
  assert.ok(s.players.p1.battle.includes(zb));
  assert.deepEqual(s.cards[zb].under, [tuck]);
  assert.equal(s.players.p1.zDeck.length, 0);
  assertConsistent(s);
  // A Z-card leaving play is removed from the game (14-1-4), and the tucked card goes to the Drop.
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  s.cards[zb].mode = "rest";
  s.players.p2.battle.push(...[]);
  // Give p2 something strong enough: bump the leader's power for the test.
  s.effects.push({ id: 99, target: s.players.p2.leader, kind: "power", value: 20000, until: "turn", ownerTurn: "p2", createdTurn: s.turn });
  s = play(s, { type: "attack", player: "p2", attacker: s.players.p2.leader, target: zb }, { type: "pass", player: "p2" }, { type: "pass", player: "p1" });
  assert.ok(s.players.p1.removed.includes(zb), "14-1-4: removed instead of Drop");
  assert.ok(s.players.p1.drop.includes(tuck), "23-2-5: the card under it went to the Drop");
  assertConsistent(s);
}

// [Evolve] (22-5): pay, choose the base, the stack keeps the slot.
{
  let s = arena({ hand: ["EVO"], battle: ["V1"], energy: ["V1"] });
  const evo = find(s, "p1", "hand", "EVO");
  const base = s.players.p1.battle[0];
  assert.ok(labels(s).some((x) => x.startsWith("Evolve EVO")));
  s = play(s, { type: "activate", player: "p1", card: evo, skill: 0 });
  assert.equal(s.prompt.kind, "chooseCards");
  s = play(s, { type: "choose", player: "p1", cards: [base] });
  assert.deepEqual(s.players.p1.battle, [evo]);
  assert.deepEqual(s.cards[evo].under, [base]);
  assert.equal(s.cards[s.players.p1.energy[0]].mode, "rest", "the {1} was paid");
  assertConsistent(s);
}

// Loss: no life (21-2-2-1) ends the game immediately; no deck too.
{
  let s = arena({ battle: ["DOUBLE"] });
  s.players.p2.life.splice(1).forEach((id) => s.players.p2.drop.push(id));
  const dbl = s.players.p1.battle[0];
  s = play(s, { type: "attack", player: "p1", attacker: dbl, target: s.players.p2.leader }, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  assert.equal(s.phase, "over");
  assert.equal(s.winner, "p1");
  assert.equal(s.prompt.kind, "gameOver");
  assert.throws(() => play(s, { type: "endMain", player: "p1" }));

  let d = arena();
  d.players.p1.deck.splice(0).forEach((id) => d.players.p1.drop.push(id));
  d = play(d, { type: "endMain", player: "p1" });
  assert.equal(d.phase, "over", "21-2-2-2: an empty deck loses at the next rule processing, not only when drawing");
  assert.equal(d.winner, "p2");
}

// Concede (0-1-3-4) works at any prompt.
{
  const s = play(arena(), { type: "concede", player: "p1" });
  assert.equal(s.winner, "p2");
}

// Determinism: the same seed and actions reproduce the same state.
{
  const run = () => {
    let s = game(42);
    const chooser = (s.prompt as { player: PlayerId }).player;
    s = play(s, { type: "chooseFirst", player: chooser, first: "p2" }, { type: "mulligan", player: "p2", redraw: true }, { type: "mulligan", player: "p1", redraw: false });
    s = play(s, { type: "charge", player: "p2", card: s.players.p2.hand[2] }, { type: "endMain", player: "p2" });
    return JSON.stringify(s);
  };
  assert.equal(run(), run());
}

console.log("verify-arena: all checks passed");
