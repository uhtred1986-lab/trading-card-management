/**
 * Arena engine checks — pure, no database. Run with `tsx`.
 *
 * Synthetic cards exercise the rules one at a time; the numbers in comments
 * are Rule Manual sections.
 */
import assert from "node:assert/strict";
import { apply, createGame, defsFrom, legalActions, seedFrom, type Action, type CardDef, type GameState, type PlayerId } from "../src/lib/arena/engine";
import { parseSkills, keywordOf, orbsIn } from "../src/lib/arena/engine/cards";
import { parseFilter, matches, parseCondition } from "../src/lib/arena/engine/filters";
import { move, locate, playCost, powerOf } from "../src/lib/arena/engine/state";
import { compileSkill, describeScript, splitClauses } from "../src/lib/arena/engine/compile";

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

const DEFS: Record<string, CardDef> = defsFrom([
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
  card("DRAWER", { energyCost: 1, skill: "[Auto] When you play this card, draw 1 card." }),
  card("KILLER", { energyCost: 1, skill: "[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards and KO it." }),
  card("PUMP", { energyCost: 1, skill: "[Activate: Main] This card gets +5000 power for the turn." }),
  card("SPAWN", { energyCost: 1, skill: "[Auto] When you play this card, play 2 Saibaman tokens (10000 power, 0 combo cost, and 5000 combo power)." }),
  card("MYSTERY", { energyCost: 1, skill: "[Auto] When you play this card, bend the fabric of reality to your will." }),
  card("FORCEKILL", { energyCost: 1, skill: "[Auto] When you play this card, choose 1 of your opponent's Battle Cards and KO it." }),
  card("AUTOCOST", { energyCost: 1, skill: "[Auto]{r}: When you play this card, draw 2 cards." }),
  card("UNI2", { type: "UNISON", energyCost: "X", power: 5000, comboCost: null, comboPower: null, skill: "[-1][Activate: Main] Draw 1 card." }),
  card("XBAT", { energyCost: "X", power: 5000 }),
  card("AURA", { energyCost: 1, skill: "[Permanent] Your Battle Cards get +5000 power." }),
  card("CHEAP", { energyCost: 3, skill: "[Permanent] Reduce the energy cost of this card in your hand by 1." }),
  card("ODDAURA", { energyCost: 1, skill: "[Permanent] Your Battle Cards resonate with the will of the universe." }),
  card("DELAYKO", { energyCost: 1, skill: "[Auto] When you play this card, choose 1 of your opponent's Battle Cards. At the end of the turn, KO it." }),
  card("DELAYDRAW", { energyCost: 1, skill: "[Auto] When you play this card, at the start of your next turn, draw 2 cards." }),
  card("DELAYOPP", { energyCost: 1, skill: "[Auto] When you play this card, during your opponent's next turn, your opponent discards 1 card." }),
  card("LOCKDOWN", { energyCost: 1, skill: "[Auto] When you play this card, your opponent can't attack with Battle Cards until the start of your next turn." }),
  card("RESTLOCK", { energyCost: 1, skill: "[Auto] When you play this card, choose 1 of your opponent's Battle Cards. It can't switch to Active Mode until the end of your opponent's turn." }),
  card("NOCOPIES", { energyCost: 1, skill: "[Auto] When you play this card, you can't play copies of this card for the turn." }),
  card("TOUGH", { energyCost: 2, power: 5000, skill: "[Auto] When you play this card, this card can't be KO'd by your opponent's skills until the start of your next turn." }),
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

// A seed has to fit a signed 32-bit column so it can be stored with the game.
{
  for (const text of ["1:2:1757000000000", "", "a", "zzzzzzzzzzzzzzzzzzzz"]) {
    const seed = seedFrom(text);
    assert.ok(Number.isInteger(seed) && seed >= 0 && seed <= 2147483647, `seed ${seed} fits an integer column`);
  }
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

// ── the effect compiler ────────────────────────────────────────────────────

{
  // Clause splitting keeps card names and traits, which contain commas, in one piece.
  assert.deepEqual(splitClauses("Choose 1 {Four-Star Ball, Parasitic Darkness} from your deck, then draw 1 card"), [
    "Choose 1 {Four-Star Ball, Parasitic Darkness} from your deck",
    "draw 1 card",
  ]);
  assert.deepEqual(splitClauses("Draw 1 card and place 1 card from your hand at the bottom of your deck"), [
    "Draw 1 card",
    "place 1 card from your hand at the bottom of your deck",
  ]);

  const one = (text: string) => compileSkill(parseSkills(text)[0]);

  const draw = one("[Auto] When this card attacks, draw 1 card.");
  assert.deepEqual(draw.unsupported, []);
  assert.deepEqual(draw.ops, [{ op: "draw", n: 1 }]);

  const ko = one("[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards and KO it.");
  assert.deepEqual(ko.unsupported, []);
  assert.equal(ko.ops.length, 2);
  assert.equal(ko.ops[0].op, "choose");
  const koSel = (ko.ops[0] as { sel: { side: string; area: string; count: number; upTo: boolean } }).sel;
  assert.equal(koSel.side, "opponent");
  assert.equal(koSel.area, "battle");
  assert.equal(koSel.upTo, true);
  assert.equal(ko.ops[1].op, "ko");

  const pump = one("[Activate: Main] This card gets +5000 power for the battle.");
  assert.deepEqual(pump.ops, [{ op: "power", target: { sel: { special: "self" } }, amount: 5000, until: "battle" }]);

  const look = one(
    "[Auto] When you play this card, look at up to 7 cards from the top of your deck, choose up to 1 card among them, place it in your energy in Rest Mode, then shuffle your deck.",
  );
  assert.deepEqual(look.unsupported, []);
  assert.deepEqual(
    look.ops.map((o) => o.op),
    ["look", "choose", "moveTo", "shuffle"],
  );
  assert.equal((look.ops[2] as { to: string }).to, "energy");
  assert.equal((look.ops[2] as { mode: string }).mode, "rest");

  const grant = one("[Activate: Main] Choose up to 1 of your yellow Battle Cards and it gains [Blocker] for the turn.");
  assert.deepEqual(grant.unsupported, []);
  assert.equal(grant.ops[1].op, "grant");
  assert.deepEqual((grant.ops[1] as { keyword: { name: string } }).keyword, { name: "Blocker" });

  // Two conditions joined by "and" both have to hold — the second arrives
  // without a condition word in front of it, and used to be dropped.
  const twoConds = one("[Auto] When you combo with this card, if your Leader Card is yellow and your life is at 4 or less, draw 1 card.");
  assert.deepEqual(twoConds.unsupported, []);
  assert.deepEqual(twoConds.ops, [
    {
      op: "if",
      cond: { kind: "leaderMatches", filter: parseFilter("yellow") },
      then: [{ op: "if", cond: { kind: "life", side: "you", atMost: 4 }, then: [{ op: "draw", n: 1 }] }],
    },
  ]);

  // A keyword the engine handles itself is not "unreadable": the text after
  // the colon is the keyword's condition, which engine.ts reads for itself.
  assert.deepEqual(one("[Evolve]{2}: <Nail>").unsupported, []);
  assert.deepEqual(one("[Evolve]{2}: <Nail>").ops, []);

  // A comma between two names is not a sentence break.
  assert.deepEqual(splitClauses("choose 1 <Son Goku: GT>, <Trunks: GT>, or <Pan> with 15000 or less power"), [
    "choose 1 <Son Goku: GT>, <Trunks: GT>, or <Pan> with 15000 or less power",
  ]);

  // A clause the parser cannot read marks the whole skill for the referee.
  const partial = one("[Auto] When you play this card, draw 1 card, then rearrange the stars in the sky.");
  assert.deepEqual(partial.unsupported, ["rearrange the stars in the sky"]);

  // The reading the inspector shows.
  assert.equal(describeScript(ko.ops), "choose up to 1 in opponent's battle, KO the chosen cards");
  assert.equal(describeScript(draw.ops), "draw 1");
}

// ── the interpreter ────────────────────────────────────────────────────────

// "When you play this card, draw 1 card" runs without asking anything.
{
  let s = arena({ hand: ["DRAWER"], energy: ["V1"] });
  const c = find(s, "p1", "hand", "DRAWER");
  const before = s.players.p1.hand.length;
  s = play(s, { type: "play", player: "p1", card: c });
  assert.equal(s.players.p1.hand.length, before - 1 + 1, "played one, drew one");
  assert.equal(s.prompt.kind, "main");
}

// "choose up to 1 of your opponent's Battle Cards and KO it" asks, then KOs.
{
  let s = arena({ hand: ["KILLER"], energy: ["V1"], oppBattle: ["V-BLUE", "BIG"] });
  const c = find(s, "p1", "hand", "KILLER");
  const victim = find(s, "p2", "battle", "BIG");
  s = play(s, { type: "play", player: "p1", card: c });
  assert.equal(s.prompt.kind, "chooseCards", "two candidates, so the choice is put to the player");
  assert.equal((s.prompt as { player: PlayerId }).player, "p1");
  assert.equal((s.prompt as { choice: { min: number } }).choice.min, 0, "up to N allows none");
  s = play(s, { type: "choose", player: "p1", cards: [victim] });
  assert.ok(s.players.p2.drop.includes(victim), "5-12: the chosen card is KO'd");
  assert.equal(s.prompt.kind, "main");
  assertConsistent(s);

  // "Up to 1" with a single candidate is still a real decision — taking it or
  // not are different outcomes — so it is put to the player (5-2-4).
  let single = arena({ hand: ["KILLER"], energy: ["V1"], oppBattle: ["BIG"] });
  single = play(single, { type: "play", player: "p1", card: find(single, "p1", "hand", "KILLER") });
  assert.equal(single.prompt.kind, "chooseCards");

  // A choice with no "up to" and exactly one candidate is forced, so it is taken silently (5-2-5).
  let t = arena({ hand: ["FORCEKILL"], energy: ["V1"], oppBattle: ["BIG"] });
  const only = find(t, "p2", "battle", "BIG");
  t = play(t, { type: "play", player: "p1", card: find(t, "p1", "hand", "FORCEKILL") });
  assert.equal(t.prompt.kind, "main", "a forced choice is not put to the player");
  assert.ok(t.players.p2.drop.includes(only));

  // Choosing nothing is allowed and KOs nothing.
  let u = arena({ hand: ["KILLER"], energy: ["V1"], oppBattle: ["V-BLUE", "BIG"] });
  u = play(u, { type: "play", player: "p1", card: find(u, "p1", "hand", "KILLER") }, { type: "choose", player: "p1", cards: [] });
  assert.equal(u.players.p2.battle.length, 2);
}

// [Barrier] (22-16) takes a card out of the opponent's choices.
{
  DEFS.BARRIER = { ...DEFS.BIG, id: "BARRIER", name: "BARRIER", skill: "[Barrier]" };
  let s = arena({ hand: ["KILLER"], energy: ["V1"], oppBattle: ["BIG"] });
  const shielded = find(s, "p2", "battle", "BIG");
  s.cards[shielded].cardId = "BARRIER";
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "KILLER") });
  assert.equal(s.prompt.kind, "main", "no legal target, so nothing was asked");
  assert.ok(s.players.p2.battle.includes(shielded), "22-16: not chosen by the opponent's skill");
}

// Tokens (19) are created with the stats the text spells out.
{
  let s = arena({ hand: ["SPAWN"], energy: ["V1"] });
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "SPAWN") });
  const tokens = s.players.p1.battle.filter((id) => s.cards[id].isToken);
  assert.equal(tokens.length, 2, "two tokens entered the Battle Area");
  assert.equal(powerOf({ defs: DEFS }, s, tokens[0]), 10000);
  assertConsistent(s);
  // 19-1-7: a token that would leave play is removed from the game instead.
  const t0 = tokens[0];
  s.cards[t0].mode = "rest";
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  s.effects.push({ id: 999, target: s.players.p2.leader, kind: "power", value: 20000, until: "turn", ownerTurn: "p2", createdTurn: s.turn });
  s = play(s, { type: "attack", player: "p2", attacker: s.players.p2.leader, target: t0 }, { type: "pass", player: "p2" }, { type: "pass", player: "p1" });
  assert.ok(s.players.p1.removed.includes(t0), "19-1-7: removed, not dropped");
  assertConsistent(s);
}

// A skill the compiler cannot read is skipped when no referee is available…
{
  let s = arena({ hand: ["MYSTERY"], energy: ["V1"] });
  const before = JSON.stringify(s.players.p2);
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "MYSTERY") });
  assert.equal(s.prompt.kind, "main", "the game carries on");
  assert.equal(JSON.stringify(s.players.p2), before, "and nothing happened to the opponent");
}

// …and put to the referee when one is, whose ruling is a program in this same language.
{
  const refCtx = { defs: DEFS, referee: true };
  let s = arena({ hand: ["MYSTERY"], energy: ["V1"] });
  s = apply(refCtx, s, { type: "play", player: "p1", card: find(s, "p1", "hand", "MYSTERY") }).state;
  assert.equal(s.prompt.kind, "referee");
  const req = (s.prompt as { request: { cardId: string; unsupported: string[] } }).request;
  assert.equal(req.cardId, "MYSTERY");
  assert.deepEqual(req.unsupported, ["bend the fabric of reality to your will"]);
  assert.deepEqual(legalActions(refCtx, s), [], "no player action is legal while the referee is being asked");
  const before = s.players.p1.hand.length;
  s = apply(refCtx, s, { type: "refereeRuling", player: "p1", ops: [{ op: "draw", n: 2 }] }).state;
  assert.equal(s.players.p1.hand.length, before + 2, "the ruling ran");
  assert.equal(s.prompt.kind, "main");
  // A malformed ruling is refused rather than trusted.
  let t = arena({ hand: ["MYSTERY"], energy: ["V1"] });
  t = apply(refCtx, t, { type: "play", player: "p1", card: find(t, "p1", "hand", "MYSTERY") }).state;
  assert.throws(() => apply(refCtx, t, { type: "refereeRuling", player: "p1", ops: [{ op: "delete-the-database" }] as never }), /valid effect program/);
  // An empty ruling means "nothing happens".
  t = apply(refCtx, t, { type: "refereeRuling", player: "p1", ops: [] }).state;
  assert.equal(t.prompt.kind, "main");
}

// ── costs the rules make optional or a matter of choice ────────────────────

// 3-8-2: which energy to rest is asked only when the colours left would differ.
{
  // A combo cost has no colour (5-6-1-1), so with two colours in energy there
  // is a real choice.
  let s = arena({ hand: ["BLOCKER"], energy: ["V1", "V-BLUE"], battle: ["V1"] });
  s = play(s, { type: "attack", player: "p1", attacker: s.players.p1.leader, target: s.players.p2.leader });
  const c = find(s, "p1", "hand", "BLOCKER");
  s = play(s, { type: "combo", player: "p1", card: c });
  assert.equal(s.prompt.kind, "payCost", "two colours, one generic cost: the player picks");
  const options = (s.prompt as { options: { rest: string[] }[] }).options;
  assert.equal(options.length, 2);
  assert.ok(labels(s).some((x) => x.startsWith("Rest 1 Red")));
  assert.ok(labels(s).some((x) => x.startsWith("Rest 1 Blue")));
  const blue = options.findIndex((o) => o.rest.some((id) => s.cards[id].cardId === "V-BLUE"));
  s = play(s, { type: "payCost", player: "p1", option: blue });
  assert.equal(s.cards[find(s, "p1", "energy", "V-BLUE")].mode, "rest", "the blue energy was rested");
  assert.equal(s.cards[find(s, "p1", "energy", "V1")].mode, "active", "the red was kept");
  assert.ok(s.players.p1.combo.includes(c), "and the combo went through");
  assertConsistent(s);

  // One colour, so no question is asked.
  let mono = arena({ hand: ["BLOCKER"], energy: ["V1", "V1"], battle: ["V1"] });
  mono = play(mono, { type: "attack", player: "p1", attacker: mono.players.p1.leader, target: mono.players.p2.leader });
  mono = play(mono, { type: "combo", player: "p1", card: find(mono, "p1", "hand", "BLOCKER") });
  assert.equal(mono.prompt.kind, "combo", "identical energy, so nothing to decide");
}

// 9-6-4: an [Auto] skill's cost may be declined, and then it does not resolve.
{
  let s = arena({ hand: ["AUTOCOST"], energy: ["V1", "V1"] });
  const c = find(s, "p1", "hand", "AUTOCOST");
  const before = s.players.p1.hand.length;
  s = play(s, { type: "play", player: "p1", card: c });
  assert.equal(s.prompt.kind, "optionalCost");
  assert.equal((s.prompt as { describe: string }).describe, "1 Red energy");
  s = play(s, { type: "optionalCost", player: "p1", pay: false });
  assert.equal(s.players.p1.hand.length, before - 1, "declined, so no cards were drawn");
  assert.equal(s.players.p1.energy.filter((id) => s.cards[id].mode === "rest").length, 1, "only the play itself was paid for");
  assert.equal(s.prompt.kind, "main");

  // Paying resolves it.
  let t = arena({ hand: ["AUTOCOST"], energy: ["V1", "V1"] });
  const handBefore = t.players.p1.hand.length;
  t = play(t, { type: "play", player: "p1", card: find(t, "p1", "hand", "AUTOCOST") }, { type: "optionalCost", player: "p1", pay: true });
  assert.equal(t.players.p1.hand.length, handBefore - 1 + 2, "paid, so two cards were drawn");
  assert.equal(t.players.p1.energy.filter((id) => t.cards[id].mode === "rest").length, 2, "the skill cost was rested too");
  assertConsistent(t);
}

// 13-4: a Unison marker skill costs markers, and only one may be used per card per turn.
{
  let s = arena({ hand: ["UNI2", "UNI2"], energy: ["V1", "V1", "V1"] });
  const u = find(s, "p1", "hand", "UNI2");
  s = play(s, { type: "playUnison", player: "p1", card: u, x: 3 });
  assert.equal(s.cards[u].markers, 3);
  assert.ok(labels(s).some((x) => x.startsWith("Activate UNI2")), "the [-1] skill is offered");
  const handBefore = s.players.p1.hand.length;
  s = play(s, { type: "activate", player: "p1", card: u, skill: 0 });
  assert.equal(s.cards[u].markers, 2, "13-4-1-3: one marker was removed as the cost");
  assert.equal(s.players.p1.hand.length, handBefore + 1, "and the effect ran");
  assert.ok(!labels(s).some((x) => x.startsWith("Activate UNI2")), "13-4-2: no second marker skill on that card this turn");
  assertConsistent(s);
}

// 1-2-2-2-1: with an X cost the player picks the value.
{
  let s = arena({ hand: ["XBAT"], energy: ["V1", "V1", "V1"] });
  const x = find(s, "p1", "hand", "XBAT");
  const offers = labels(s).filter((l) => l.startsWith("Play XBAT with X ="));
  assert.deepEqual(offers, ["Play XBAT with X = 0", "Play XBAT with X = 1", "Play XBAT with X = 2", "Play XBAT with X = 3"]);
  s = play(s, { type: "play", player: "p1", card: x, x: 2 });
  assert.ok(s.players.p1.battle.includes(x));
  assert.equal(s.players.p1.energy.filter((id) => s.cards[id].mode === "rest").length, 2, "two energy paid for X = 2");
}

// 8-1-7: if the attacker leaves the Battle Area, the battle ends with no damage.
{
  let s = arena({ battle: ["V1"], hand: ["E-NEGATE"] });
  const attacker = s.players.p1.battle[0];
  s = play(s, { type: "attack", player: "p1", attacker, target: s.players.p2.leader });
  assert.equal(s.prompt.kind, "combo");
  // Something removes the attacker mid-battle.
  const ctx = { defs: DEFS };
  move(ctx, s, [], attacker, "drop", "p1");
  s = play(s, { type: "pass", player: "p1" });
  assert.equal(s.players.p2.life.length, 8, "no damage was dealt");
  assert.equal(s.battle, null, "and the battle is over");
  assert.equal(s.prompt.kind, "main");
  assertConsistent(s);
}

// ── [Permanent] skills hold on their own (9-5) ─────────────────────────────

{
  // A power buff applies to every matching card, and stops when the source leaves.
  let s = arena({ hand: ["AURA"], energy: ["V1"], battle: ["V1"] });
  const ally = s.players.p1.battle[0];
  const ctx = { defs: DEFS };
  assert.equal(powerOf(ctx, s, ally), 10000, "no buff before it is played");
  const aura = find(s, "p1", "hand", "AURA");
  s = play(s, { type: "play", player: "p1", card: aura });
  assert.equal(powerOf(ctx, s, ally), 15000, "the permanent skill holds while the card is in play");
  assert.equal(powerOf(ctx, s, s.players.p2.battle[0] ?? s.players.p2.leader), 10000, "and not for the opponent");
  move(ctx, s, [], aura, "drop", "p1");
  assert.equal(powerOf(ctx, s, ally), 10000, "9-5-1: it stops when the source leaves play");
}

{
  // 9-1-3-3: a cost reducer names the hand, so it applies there and nowhere else.
  const s = arena({ hand: ["CHEAP"], energy: ["V1", "V1"] });
  const cheap = find(s, "p1", "hand", "CHEAP");
  const ctx = { defs: DEFS };
  assert.equal(playCost(ctx, s, cheap).total, 2, "printed 3, reduced by 1");
  assert.ok(
    labels(s).some((x) => x.startsWith("Play CHEAP")),
    "so it is playable with two energy",
  );
}

{
  // A [Permanent] the compiler cannot read simply does nothing — there is no
  // moment at which the referee could be asked about it.
  const s = arena({ battle: ["ODDAURA", "V1"] });
  const ctx = { defs: DEFS };
  assert.equal(powerOf(ctx, s, find(s, "p1", "battle", "V1")), 10000);
}

// ── delayed effects (1-7-2-1-1) ────────────────────────────────────────────

{
  // The timing phrase moves the rest of the sentence into the future rather
  // than defeating the compiler, which is what used to happen.
  const one = (text: string) => compileSkill(parseSkills(text)[0]);
  const later = one("[Auto] When you play this card, choose 1 of your opponent's Battle Cards. At the end of the turn, KO it.");
  assert.deepEqual(later.unsupported, []);
  assert.equal(later.ops.length, 2);
  assert.equal(later.ops[0].op, "choose");
  const delay = later.ops[1] as { op: string; at: string; scope: string; ops: { op: string }[] };
  assert.equal(delay.op, "delay");
  assert.equal(delay.at, "turnEnd");
  assert.equal(delay.scope, "thisTurn");
  assert.deepEqual(
    delay.ops.map((o) => o.op),
    ["ko"],
    "the KO is inside the delay, not alongside it",
  );

  // Whose turn it has to be is read off the wording, not guessed.
  const mine = one("[Auto] When you play this card, at the start of your next turn, draw 2 cards.");
  assert.equal((mine.ops[0] as { at: string; scope: string }).at, "turnStart");
  assert.equal((mine.ops[0] as { scope: string }).scope, "yourNextTurn");
  const theirs = one("[Auto] When you play this card, during your opponent's next turn, your opponent discards 1 card.");
  assert.equal((theirs.ops[0] as { scope: string }).scope, "opponentNextTurn");

  // "for the turn" is a duration, not a timing, and must not become a delay.
  const pump = one("[Activate: Main] This card gets +5000 power for the turn.");
  assert.equal(pump.ops[0].op, "power");
}

{
  // The KO happens at the end of the turn, not when the skill resolves.
  let s = arena({ hand: ["DELAYKO"], energy: ["V1"], oppBattle: ["BIG"] });
  const victim = find(s, "p2", "battle", "BIG");
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "DELAYKO") });
  assert.ok(s.players.p2.battle.includes(victim), "still there while the turn runs");
  assert.equal(s.delayed.length, 1, "written down for later");
  assert.equal(s.delayed[0].at, "turnEnd");
  s = play(s, { type: "endMain", player: "p1" });
  assert.ok(s.players.p2.drop.includes(victim), "1-7-2-1-1: carried out at the end of the turn");
  assert.equal(s.delayed.length, 0, "and taken off the list");
  assertConsistent(s);
}

{
  // "At the start of your next turn" waits out the opponent's whole turn.
  let s = arena({ hand: ["DELAYDRAW"], energy: ["V1"] });
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "DELAYDRAW") });
  assert.equal(s.delayed.length, 1);
  s = play(s, { type: "endMain", player: "p1" });
  assert.equal(s.delayed.length, 1, "the opponent's turn is not yours");
  assert.equal(s.turnPlayer, "p2");
  const before = s.players.p1.hand.length;
  s = play(s, { type: "charge", player: "p2", card: null }, { type: "endMain", player: "p2" });
  assert.equal(s.turnPlayer, "p1");
  assert.equal(s.players.p1.hand.length, before + 2 + 1, "two from the skill, one from the draw step");
  assert.equal(s.delayed.length, 0);
}

{
  // The other side of the same rule: the opponent's next turn, not yours.
  let s = arena({ hand: ["DELAYOPP"], energy: ["V1"], oppHand: ["BIG", "BIG"] });
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "DELAYOPP") });
  const before = s.players.p2.hand.length;
  assert.equal(before, 2);
  s = play(s, { type: "endMain", player: "p1" });
  assert.equal(s.players.p2.hand.length, before - 1 + 1, "discarded one as their turn opened, then drew for the turn");
  assert.equal(s.delayed.length, 0);
}

{
  // An effect waiting for "the end of the turn" that never got there is
  // dropped rather than firing a turn late.
  let s = arena({ hand: ["DELAYKO"], energy: ["V1"], oppBattle: ["BIG"] });
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "DELAYKO") });
  s.delayed[0].at = "battleEnd"; // a timing this turn will never reach
  s = play(s, { type: "endMain", player: "p1" });
  assert.equal(s.delayed.length, 0, "its moment passed, so it is gone");
}

// ── prohibitions (20-14, 0-2-5) ────────────────────────────────────────────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);

  const lock = one("[Auto] When you play this card, your opponent can't attack with Battle Cards until the start of your next turn.");
  assert.deepEqual(lock.unsupported, []);
  const f = lock.ops[0] as { op: string; what: string; side: string; until: string; filter?: { type: string | null } };
  assert.equal(f.op, "forbid");
  assert.equal(f.what, "attack");
  assert.equal(f.side, "opponent");
  assert.equal(f.filter?.type, "BATTLE", "only their Battle Cards, not their Leader");

  // The rest-lock wording has to outlast the opponent's whole turn.
  const rest = one("[Auto] When you play this card, choose 1 of your opponent's Battle Cards. It can't switch to Active Mode until the end of your opponent's turn.");
  assert.deepEqual(rest.unsupported, []);
  assert.equal((rest.ops[1] as { what: string }).what, "switchToActive");
  assert.equal((rest.ops[1] as { until: string }).until, "nextTurn");

  // Deck-building rules are not rules of play, and must not be read as one.
  const deckRule = one("[Permanent] You can't include non-≪Saiyan≫ Battle Cards in your deck.");
  assert.deepEqual(deckRule.unsupported, []);
  assert.deepEqual(deckRule.ops, []);
}

{
  // The move is not offered, and 0-2-5 means it is refused if sent anyway.
  let s = arena({ hand: ["LOCKDOWN"], energy: ["V1"], oppBattle: ["BIG"] });
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "LOCKDOWN") }, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  const attacker = find(s, "p2", "battle", "BIG");
  assert.ok(
    !labels(s).some((x) => x.includes("Attack") && x.includes("BIG")),
    "20-14: their Battle Card is not offered an attack",
  );
  assert.ok(
    labels(s).some((x) => x.includes("Attack") && x.includes("L-BLUE")),
    "but their Leader still can — the rule named Battle Cards",
  );
  assert.throws(() => apply({ defs: DEFS }, s, { type: "attack", player: "p2", attacker, target: s.players.p1.leader }), /illegal attack/);
}

{
  // "It can't switch to Active Mode": the Charge Phase leaves it resting.
  let s = arena({ hand: ["RESTLOCK"], energy: ["V1"], oppBattle: ["BIG"] });
  const locked = find(s, "p2", "battle", "BIG");
  s.cards[locked].mode = "rest";
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "RESTLOCK") });
  assert.equal(s.cards[locked].mode, "rest");
  s = play(s, { type: "endMain", player: "p1" });
  assert.equal(s.cards[locked].mode, "rest", "7-2-7 did not stand it up");
  // It ends as the turn comes back round to the player who created it.
  s = play(s, { type: "charge", player: "p2", card: null }, { type: "endMain", player: "p2" });
  assert.equal(s.turnPlayer, "p1");
  assert.equal(s.effects.filter((e) => e.kind === "forbid").length, 0, "the rule has expired");
}

{
  // "You can't play copies of this card" is about the name, not the card.
  let s = arena({ hand: ["NOCOPIES", "NOCOPIES"], energy: ["V1", "V1"] });
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "NOCOPIES") });
  assert.ok(
    !labels(s).some((x) => x.startsWith("Play NOCOPIES")),
    "the second copy is not offered",
  );
  assert.throws(() => apply({ defs: DEFS }, s, { type: "play", player: "p1", card: find(s, "p1", "hand", "NOCOPIES") }), /can't be played/);
}

{
  // "Can't be KO'd by your opponent's skills" stops their skill, not the battle.
  let s = arena({ hand: ["TOUGH"], energy: ["V1", "V1"], oppHand: ["KILLER"], oppEnergy: ["V1"] });
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "TOUGH") });
  const tough = find(s, "p1", "battle", "TOUGH");
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  s = play(s, { type: "play", player: "p2", card: find(s, "p2", "hand", "KILLER") });
  assert.equal(s.prompt.kind, "chooseCards", "it is still a legal choice — the KO simply does not happen");
  s = play(s, { type: "choose", player: "p2", cards: [tough] });
  assert.ok(s.players.p1.battle.includes(tough), "22-12-like: their skill cannot KO it");
  // 21-6 still applies: a rule, not a skill, and it ignores even [Indestructible].
  s.effects.push({ id: 998, target: tough, kind: "power", value: -99000, until: "turn", ownerTurn: "p2", createdTurn: s.turn });
  s = play(s, { type: "endMain", player: "p2" });
  assert.ok(s.players.p1.drop.includes(tough), "21-6: 0 power is a rule, and rules are not skills");
}

console.log("verify-arena: all checks passed");
