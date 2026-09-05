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
import { move, locate, playCost, powerOf, forbids, has, cardNow, comboCostOf, skillNegated, skillsNegated } from "../src/lib/arena/engine/state";
import { compileSkill, describeScript, parseConditionClause, splitClauses } from "../src/lib/arena/engine/compile";
import { autoTriggerMatches, koCard } from "../src/lib/arena/engine/triggers";

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
  card("STACKER", { energyCost: 1, skill: "[Auto] When you play this card, choose 1 of your Battle Cards and place it under this card." }),
  card("TWOKILL", { energyCost: 1, skill: "[Auto] When you play this card, choose 2 of your opponent's Battle Cards and KO them." }),
  card("GRABBER", { energyCost: 1, skill: "[Auto] When you play this card, choose 1 of your opponent's cards and place it in its owner's drop area." }),
  card("ONCEONLY", { energyCost: 1, skill: "[Auto] When you play this card, draw 1 card and negate this skill for the game." }),
  card("STEALER", { energyCost: 1, skill: "[Auto] When you play this card, choose 1 of your opponent's Battle Cards and gain control of it." }),
  card("PERMTOUGH", { energyCost: 2, power: 5000, skill: "[Permanent] This card can't be KO'd by your opponent's skills." }),
  card("PERMLOCK", { energyCost: 2, power: 5000, skill: "[Permanent] Your opponent can't attack with Battle Cards." }),
  card("SELFMUTE", { energyCost: 2, skill: "[Blocker]\n[Permanent] Negate this card's [Blocker] skill in all areas." }),
  card("BECOMES", { energyCost: 2, skill: "[Permanent] This card gains ≪Saiyan≫ in all areas." }),
  card("SAIYANKILL", { energyCost: 1, skill: "[Auto] When you play this card, choose 1 of your opponent's ≪Saiyan≫ Battle Cards and KO it." }),
  card("CHEAPCOMBO", { energyCost: 3, comboCost: 2, comboPower: 5000, skill: "[Permanent] Reduce the combo cost of this card in your hand by 2." }),
  card("ONLYONE", { energyCost: 1, name: "ONLYONE", skill: "[Permanent] Only 1 {ONLYONE} can be played in your Battle Area." }),
  card("RESTCOND", { energyCost: 1, skill: "[Permanent] If this card is in Rest Mode, your Battle Cards get +5000 power." }),
  card("FREEPLAY", { energyCost: 2, power: 5000, skill: "[Permanent] If you have <V1> in your Battle Area or Leader Area, you can play this card from your hand without paying its energy cost." }),
  card("EXILE", { energyCost: 2, power: 5000, skill: "[Permanent] If this card would leave the Battle Area, remove it from the game instead." }),
  card("WARPER", { energyCost: 2, power: 5000, skill: "[Permanent] If this card would be removed from your Battle Area by a skill, send this card to your Warp instead." }),
  card("E-STOP", { type: "EXTRA", energyCost: 1, power: null, comboCost: null, comboPower: null, skill: "[Counter: Counter] Negate the [Counter]." }),
  card("E-LIFE", {
    type: "EXTRA",
    energyCost: 3,
    power: null,
    comboCost: null,
    comboPower: null,
    skill: "[Counter: Attack] Negate the attack.<br>[Permanent] You can activate this card's [Counter] skill from your hand by adding a card from your life to your hand instead of paying its energy cost.",
  }),
  card("MODAL", { energyCost: 1, skill: "[Auto] When you play this card, choose one-<br>・Draw 1 card.<br>・Your opponent discards 1 card." }),
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
    // 3-9 sets no ceiling on life: [Rejuvenate] and "place the top card of
    // your deck in your Life Area" can take it past the 8 it starts with.
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

// ── cards under cards (23-2) and modal choice (20-2) ───────────────────────

{
  // "Place it under this card" used to compile to a move to the Drop, which is
  // a different game entirely.
  let s = arena({ hand: ["STACKER"], energy: ["V1"], battle: ["V1"] });
  const under = find(s, "p1", "battle", "V1");
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "STACKER") });
  assert.equal(s.prompt.kind, "chooseCards", "both Battle Cards are candidates, so it asks");
  s = play(s, { type: "choose", player: "p1", cards: [under] });
  const host = find(s, "p1", "battle", "STACKER");
  assert.ok(!s.players.p1.battle.includes(under), "it is no longer a Battle Card of its own");
  assert.ok(!s.players.p1.drop.includes(under), "and it did not go to the Drop");
  assert.deepEqual(s.cards[host].under, [under]);
  assertConsistent(s);

  // 23-2-5: when the card on top leaves play, the stack goes with it.
  s.effects.push({ id: 997, target: host, kind: "power", value: -99000, until: "turn", ownerTurn: "p1", createdTurn: s.turn });
  s = play(s, { type: "endMain", player: "p1" });
  assert.ok(s.players.p1.drop.includes(under), "the card underneath followed it to the Drop");
  assertConsistent(s);
}

{
  // The options of a "Choose one—" are printed on separate lines but are not
  // skills of their own.
  const skills = parseSkills("[Auto] When you play this card, choose one-<br>・Draw 1 card.<br>・Your opponent discards 1 card.");
  assert.equal(skills.length, 1, "20-2: one skill, with two options");

  const script = compileSkill(skills[0]);
  assert.deepEqual(script.unsupported, []);
  assert.equal(script.ops.length, 1);
  const modal = script.ops[0] as { op: string; modes: { ops: { op: string }[] }[] };
  assert.equal(modal.op, "chooseMode");
  assert.deepEqual(
    modal.modes.map((mode) => mode.ops.map((o) => o.op)),
    [["draw"], ["discard"]],
  );
}

{
  // Exactly one option happens, and the player says which.
  let s = arena({ hand: ["MODAL"], energy: ["V1"], oppHand: ["BIG"] });
  const myHand = s.players.p1.hand.length;
  const theirHand = s.players.p2.hand.length;
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "MODAL") });
  assert.equal(s.prompt.kind, "chooseMode");
  assert.deepEqual(labels(s), ["Draw 1 card.", "Your opponent discards 1 card."]);
  s = play(s, { type: "chooseMode", player: "p1", index: 1 });
  assert.equal(s.players.p2.hand.length, theirHand - 1, "the option taken happened");
  assert.equal(s.players.p1.hand.length, myHand - 1, "and the one not taken did not");
  assert.equal(s.prompt.kind, "main");
}

// ── wordings the compiler learned in the first pattern pass ────────────────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);
  const ops = (text: string) => one(text).ops.map((o) => o.op);

  // Whose turn it is: the condition existed from the start and the compiler
  // had never once emitted it.
  const mine = one("[Activate: Main] If it's your turn, draw 1 card.");
  assert.deepEqual(mine.unsupported, []);
  assert.deepEqual(mine.ops, [{ op: "if", cond: { kind: "isTurnPlayer" }, then: [{ op: "draw", n: 1 }] }]);
  const theirs = one("[Activate: Battle] During your opponent's turn, draw 1 card.");
  assert.deepEqual((theirs.ops[0] as { cond: { kind: string; who?: string } }).cond, { kind: "isTurnPlayer", who: "opponent" });

  // One shape of counting condition, many areas.
  const counted = one("[Activate: Main] If your opponent has 2 or more Battle Cards in play in Rest Mode, draw 1 card.");
  assert.deepEqual(counted.unsupported, []);
  const cond = (counted.ops[0] as { cond: { kind: string; atLeast?: number; sel: { side: string; area: string; mode?: string } } }).cond;
  assert.equal(cond.kind, "count");
  assert.equal(cond.atLeast, 2);
  assert.deepEqual([cond.sel.side, cond.sel.area, cond.sel.mode], ["opponent", "battle", "rest"]);
  // "No cards" is the same shape read the other way.
  assert.equal((one("[Activate: Main] If there are no cards in your opponent's combo area, draw 1 card.").ops[0] as { cond: { atMost?: number } }).cond.atMost, 0);

  // Discarding written the long way round, and life written as a count.
  assert.deepEqual(ops("[Activate: Main] You may place 1 card from your hand in the drop area."), ["discard"]);
  assert.deepEqual(ops("[Activate: Main] Add cards from your life to your hand until you have 6 life left."), ["lifeDownTo"]);
  assert.deepEqual(ops("[Activate: Main] Both players choose 1 card from their hand."), ["discard"]);

  // A reminder of a rule the engine already applies is not an effect.
  const reminder = one("[Counter: Play] You can activate this card's [Counter] skill from your hand. Draw 1 card.");
  assert.deepEqual(reminder.unsupported, []);
  assert.deepEqual(
    reminder.ops.map((o) => o.op),
    ["draw"],
  );
  // Nor is a note in the full-width brackets some sets print.
  assert.deepEqual(one("[Auto] When you play this card, draw 1 card.（You can only include up to 4 cards with [Super Combo] in your deck）").unsupported, []);

  // A choice with no area named is a card on the table (20-1-6) — and until
  // this worked, every later "it" in the same skill had nothing to point at.
  const chain = one("[Auto] When you play this card, choose 1 of your <Son Goku>, and switch it to Rest Mode.");
  assert.deepEqual(chain.unsupported, []);
  assert.deepEqual(
    chain.ops.map((o) => o.op),
    ["choose", "switchMode"],
  );
}

// ── two conditions in front of one effect (9-1-3) ──────────────────────────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);
  const yellow = parseFilter("yellow");

  // BT5-088. Both conditions have to hold, so they nest, and the order they
  // are printed in is the order they nest in.
  const both = one("[Auto] When you combo with this card, if your Leader Card is yellow and your life is at 4 or less, draw 1 card.");
  assert.deepEqual(both.unsupported, []);
  assert.deepEqual(both.ops, [
    {
      op: "if",
      cond: { kind: "leaderMatches", filter: yellow },
      then: [{ op: "if", cond: { kind: "life", side: "you", atMost: 4 }, then: [{ op: "draw", n: 1 }] }],
    },
  ]);

  // The same card text with the conditions the other way round: same meaning,
  // and both still have to hold.
  const swapped = one("[Auto] When you combo with this card, if your life is at 4 or less and your Leader Card is yellow, draw 1 card.");
  assert.deepEqual(swapped.unsupported, []);
  assert.deepEqual(swapped.ops, [
    {
      op: "if",
      cond: { kind: "life", side: "you", atMost: 4 },
      then: [{ op: "if", cond: { kind: "leaderMatches", filter: yellow }, then: [{ op: "draw", n: 1 }] }],
    },
  ]);

  // Either half alone is the same condition without the nesting.
  assert.deepEqual(one("[Auto] When you combo with this card, if your life is at 4 or less, draw 1 card.").ops, [
    { op: "if", cond: { kind: "life", side: "you", atMost: 4 }, then: [{ op: "draw", n: 1 }] },
  ]);
  assert.deepEqual(one("[Auto] When you combo with this card, if your Leader Card is yellow, draw 1 card.").ops, [
    { op: "if", cond: { kind: "leaderMatches", filter: yellow }, then: [{ op: "draw", n: 1 }] },
  ]);

  // Whose life, and which way round the comparison goes, both change the test.
  assert.deepEqual((one("[Auto] When you combo with this card, if your opponent's life is at 4 or less, draw 1 card.").ops[0] as { cond: unknown }).cond, {
    kind: "life",
    side: "opponent",
    atMost: 4,
  });
  assert.deepEqual((one("[Auto] When you combo with this card, if your life is at 4 or more, draw 1 card.").ops[0] as { cond: unknown }).cond, {
    kind: "life",
    side: "you",
    atLeast: 4,
  });
}

// ── choosing more than one card, one tap at a time (5-2) ───────────────────

{
  // The board asks by tapping a card, so a "choose 2" is two questions. It
  // used to be offered as two separate one-card answers to a prompt that
  // demanded both at once, which the engine then refused as illegal.
  let s = arena({ hand: ["TWOKILL"], energy: ["V1"], oppBattle: ["BIG", "V-BLUE", "BLOCKER"] });
  const first = find(s, "p2", "battle", "BIG");
  const second = find(s, "p2", "battle", "BLOCKER");
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "TWOKILL") });
  assert.equal(s.prompt.kind, "chooseCards");
  assert.equal((s.prompt as { choice: { max: number } }).choice.max, 1, "one card per answer");
  // Every candidate is offered, and taking one is legal.
  assert.equal(labels(s).length, 3);
  s = play(s, { type: "choose", player: "p1", cards: [first] });
  assert.equal(s.prompt.kind, "chooseCards", "it asks again for the second");
  assert.ok(!(s.prompt as { choice: { candidates: string[] } }).choice.candidates.includes(first), "and not for the same card twice");
  s = play(s, { type: "choose", player: "p1", cards: [second] });
  assert.ok(s.players.p2.drop.includes(first) && s.players.p2.drop.includes(second), "both chosen cards were KO'd");
  assert.equal(s.prompt.kind, "main");
  assertConsistent(s);
}

{
  // 3-1-2: "your opponent's cards" includes their Leader (20-1-6), but a
  // Leader does not leave the Leader Area — and an empty Leader Area is a
  // state the rest of the engine cannot read.
  let s = arena({ hand: ["GRABBER"], energy: ["V1"] });
  const leader = s.players.p2.leader;
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "GRABBER") });
  assert.equal(s.players.p2.leader, leader, "their Leader is still there");
  assert.ok(!s.players.p2.drop.includes(leader));
  assert.equal(s.prompt.kind, "main");
  assert.ok(labels(s).length > 0, "and the game can still be played");
  assertConsistent(s);
}

// ── wordings the compiler learned in the second pattern pass ───────────────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);
  const ops = (text: string) => one(text).ops.map((o) => o.op);

  // "A marker" is one marker.
  assert.deepEqual(ops("[Auto] When you play this card, choose up to 1 of your opponent's Unison Cards and remove a marker from it."), ["choose", "removeMarker"]);

  // An [Auto] restates its trigger and then says "it": the trigger is dropped,
  // but what it was about is not.
  const carried = one("[Auto] When this card is sent to the Warp from your Battle Area or deck, add it to your hand.");
  assert.deepEqual(carried.unsupported, []);
  assert.deepEqual(carried.ops, [{ op: "moveTo", target: { sel: { special: "self" } }, to: "hand" }]);

  // A count with no number: "a" and a bare plural both mean at least one.
  const any = one("[Activate: Main] If your opponent has a Battle Card in play in Rest Mode, draw 1 card.");
  assert.deepEqual(any.unsupported, []);
  assert.deepEqual((any.ops[0] as { cond: { kind: string; atLeast?: number } }).cond.atLeast, 1);
  assert.deepEqual((one("[Activate: Main] If your opponent has Battle Cards in their Battle Area, draw 1 card.").ops[0] as { cond: { atLeast?: number } }).cond.atLeast, 1);

  // Some sets print the odd full-width letter mid-word.
  assert.deepEqual(one("[Auto] When you play this card, if your Leader Ｃard is a ≪Majin≫, draw 1 card.").unsupported, []);

  // The two life counts against each other.
  assert.deepEqual((one("[Activate: Main] If your life is less than or equal to your opponent's life, draw 1 card.").ops[0] as { cond: unknown }).cond, {
    kind: "lifeVsOpponent",
    atMost: true,
  });

  // "Choose 1 of X and 1 of Y" splits on the "and"; the second half is a
  // choice with the verb left behind.
  assert.deepEqual(ops("[Activate: Main] Choose 1 of your <Son Goku> and 1 of your opponent's Battle Cards."), ["choose", "choose"]);
}

// ── prohibitions printed as [Permanent] skills (9-5-1, 20-14) ──────────────

{
  // A [Permanent] holds for as long as the card is where the skill is valid,
  // with no duration to expire — so unlike the same sentence on an [Auto], it
  // is still true next turn, and it stops the moment the card leaves play.
  const ctx = { defs: DEFS };
  let s = arena({ battle: ["PERMTOUGH"], oppHand: ["KILLER"], oppEnergy: ["V1"] });
  const tough = find(s, "p1", "battle", "PERMTOUGH");
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  s = play(s, { type: "play", player: "p2", card: find(s, "p2", "hand", "KILLER") });
  assert.equal(s.prompt.kind, "chooseCards", "it is still a legal choice; the KO just does not happen");
  s = play(s, { type: "choose", player: "p2", cards: [tough] });
  assert.ok(s.players.p1.battle.includes(tough), "9-5-1: the permanent skill holds without being activated");
  // Take the card off the table and the rule goes with it.
  move(ctx, s, [], tough, "drop", "p1");
  assert.ok(!forbids(ctx, s, "beKOdBySkill", { player: "p2", card: tough }), "and stops when the source leaves play");
}

{
  // The same thing about a player rather than a card.
  const ctx = { defs: DEFS };
  let s = arena({ battle: ["PERMLOCK"], oppBattle: ["BIG"] });
  const lock = find(s, "p1", "battle", "PERMLOCK");
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  assert.ok(
    !labels(s).some((x) => x.includes("Attack") && x.includes("BIG")),
    "their Battle Card cannot attack while the permanent skill is in play",
  );
  assert.ok(
    labels(s).some((x) => x.includes("Attack") && x.includes("L-BLUE")),
    "their Leader still can — the rule named Battle Cards",
  );
  // 9-5-1 again: no duration to end, so removing the card is what ends it.
  move(ctx, s, [], lock, "drop", "p1");
  assert.ok(
    labels(s).some((x) => x.includes("Attack") && x.includes("BIG")),
    "with the source gone, the attack is offered again",
  );
}

// ── another way to pay (5-3) ───────────────────────────────────────────────

{
  // The card costs 3 and the defender has no energy at all, so the only way
  // it can be played is the one the card itself prints.
  let s = arena({ oppHand: ["E-LIFE"] });
  const counter = find(s, "p2", "hand", "E-LIFE");
  const lifeBefore = s.players.p2.life.length;
  const handBefore = s.players.p2.hand.length;
  s = play(s, { type: "attack", player: "p1", attacker: s.players.p1.leader, target: s.players.p2.leader });
  assert.equal(s.prompt.kind, "counter");
  assert.deepEqual((s.prompt as { candidates: string[] }).candidates, [counter], "offered although the energy is not there");
  const offers = labels(s).filter((x) => x.startsWith("Counter with"));
  assert.deepEqual(offers, ["Counter with E-LIFE (by adding 1 from your life to your hand)"], "only the cost it can actually pay");

  s = play(s, { type: "counter", player: "p2", card: counter, alt: true });
  assert.equal(s.battle, null, "the counter resolved: the attack was negated");
  assert.equal(s.players.p2.life.length, lifeBefore - 1, "one life card paid the cost");
  // The card left the hand for the Drop and one life card came in, so the hand
  // is the size it was. Losing life this way is a cost, not damage (1-13-2).
  assert.equal(s.players.p2.hand.length, handBefore, "the life card went to the hand");
  assert.ok(s.players.p2.drop.includes(counter));
  assert.equal(s.players.p2.damageTaken, 0, "paying a cost is not taking damage");
  assertConsistent(s);
}

{
  // With the energy there, both costs are offered and they are different
  // decisions — 0-2-5 does not choose for the player.
  let s = arena({ oppHand: ["E-LIFE"], oppEnergy: ["V1", "V1", "V1"] });
  s = play(s, { type: "attack", player: "p1", attacker: s.players.p1.leader, target: s.players.p2.leader });
  const offers = labels(s).filter((x) => x.startsWith("Counter with"));
  assert.equal(offers.length, 2, "the printed cost and the alternative, both on the menu");
  const before = s.players.p2.life.length;
  s = play(s, { type: "counter", player: "p2", card: find(s, "p2", "hand", "E-LIFE") });
  assert.equal(s.players.p2.life.length, before, "paying with energy leaves the life alone");
  assert.equal(s.players.p2.energy.filter((id) => s.cards[id].mode === "rest").length, 3, "it was paid with energy instead");
}

// ── what a [Permanent] can say about the card itself (9-1-5, 20-1, 20-21) ──

{
  const ctx = { defs: DEFS };
  // 9-1-5: one named keyword goes, the card keeps the rest of itself.
  const s = arena({ battle: ["SELFMUTE"] });
  const mute = find(s, "p1", "battle", "SELFMUTE");
  assert.ok(!has(ctx, s, mute, "Blocker"), "the card negated its own [Blocker]");
}

{
  const ctx = { defs: DEFS };
  // 20-1: a card that gains a trait is that trait to every skill that names
  // one — this is about what the card *is*, not what it does.
  let s = arena({ hand: ["SAIYANKILL"], energy: ["V1"], oppBattle: ["BECOMES", "BIG"] });
  const becomes = find(s, "p2", "battle", "BECOMES");
  assert.ok(cardNow(ctx, s, becomes).traits.some((t) => t.toLowerCase() === "saiyan"), "it counts as a ≪Saiyan≫");
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "SAIYANKILL") });
  // Only one card on their side is a Saiyan, so the choice is forced and taken.
  assert.ok(s.players.p2.drop.includes(becomes), "the ≪Saiyan≫ skill found it");
  assert.ok(s.players.p2.battle.includes(find(s, "p2", "battle", "BIG")), "and left the card that is not one");
}

{
  const ctx = { defs: DEFS };
  // 20-21: a reducer that names the combo cost reduces the combo cost.
  const s = arena({ hand: ["CHEAPCOMBO"] });
  const cheap = find(s, "p1", "hand", "CHEAPCOMBO");
  assert.equal(DEFS.CHEAPCOMBO.comboCost, 2, "printed");
  assert.equal(comboCostOf(ctx, s, cheap), 0, "and free after its own [Permanent]");
}

{
  // "Only 1 {ONLYONE} can be played in your Battle Area" — the rule switches
  // itself on once one is there, which a [Permanent] can say because the
  // static layer asks again every time.
  let s = arena({ hand: ["ONLYONE", "ONLYONE"], energy: ["V1", "V1"] });
  assert.ok(
    labels(s).some((x) => x.startsWith("Play ONLYONE")),
    "the first is playable",
  );
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "ONLYONE") });
  assert.ok(
    !labels(s).some((x) => x.startsWith("Play ONLYONE")),
    "the second is not, while the first is in play",
  );
}

{
  const ctx = { defs: DEFS };
  // A card's own mode as a condition, re-read every time it is asked.
  const s = arena({ battle: ["RESTCOND", "V1"] });
  const cond = find(s, "p1", "battle", "RESTCOND");
  const ally = find(s, "p1", "battle", "V1");
  assert.equal(powerOf(ctx, s, ally), 10000, "nothing while it stands");
  s.cards[cond].mode = "rest";
  assert.equal(powerOf(ctx, s, ally), 15000, "and +5000 once it is rested");
}

// ── replacement effects (9-10) ─────────────────────────────────────────────

{
  // 9-10-1-1: the move that was about to happen is treated as never having
  // happened, and the card goes where the skill says instead.
  let s = arena({ battle: ["EXILE"], oppHand: ["KILLER"], oppEnergy: ["V1"] });
  const exile = find(s, "p1", "battle", "EXILE");
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  s = play(s, { type: "play", player: "p2", card: find(s, "p2", "hand", "KILLER") }, { type: "choose", player: "p2", cards: [exile] });
  assert.ok(!s.players.p1.drop.includes(exile), "it did not go to the Drop");
  assert.ok(s.players.p1.removed.includes(exile), "9-10: it went where the skill said instead");
  assertConsistent(s);
}

{
  // "By a skill" is narrower than "would leave": a battle is not a skill.
  let s = arena({ battle: ["WARPER"], oppBattle: ["BIG"] });
  const warper = find(s, "p1", "battle", "WARPER");
  s.cards[warper].mode = "rest";
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  s = play(s, { type: "attack", player: "p2", attacker: find(s, "p2", "battle", "BIG"), target: warper }, { type: "pass", player: "p2" }, { type: "pass", player: "p1" });
  assert.ok(s.players.p1.drop.includes(warper), "KO'd in a battle, so the Drop — the skill named a skill");
  assert.ok(!s.players.p1.warp.includes(warper));
  assertConsistent(s);
}

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);
  // The sentence splits at the comma, and neither half means anything alone.
  const r = one("[Permanent] If this card would leave the Battle Area, remove it from the game instead.");
  assert.deepEqual(r.unsupported, []);
  assert.deepEqual(r.ops, [{ op: "replaceLeave", to: "removed", target: { sel: { special: "self" } } }]);

  // A rule about other cards keeps its subject rather than the "it" that follows.
  const other = one("[Permanent] When a ≪Saiyan≫ card would leave your Battle Area, you may place it in your Z-Energy instead.");
  assert.deepEqual(other.unsupported, []);
  const op = other.ops[0] as { op: string; to: string; target: { sel: { area: string; filter?: { traits: string[] } } } };
  assert.equal(op.op, "replaceLeave");
  assert.equal(op.to, "zEnergy");
  assert.deepEqual(op.target.sel.filter?.traits, ["saiyan"]);

  // "By your opponent's skills" is left unread on purpose: `move` knows a
  // skill did it but not whose, and guessing lets the wrong cards escape.
  assert.ok(one("[Permanent] If this card would be removed from your Battle Area by an opponent's skill, send it to your Warp instead.").unsupported.length > 0);
}

// ── playing a card for another price (5-3) ─────────────────────────────────

{
  // BT3-087's wording. It used to compile to an *instruction to play the
  // card*, which a [Permanent] never carries out — so the card looked handled,
  // never reached the referee, and the player paid the energy anyway.
  const one = compileSkill(parseSkills("[Permanent] If you have <V1> in your Battle Area or Leader Area, you can play this card from your hand without paying its energy cost.")[0]);
  assert.deepEqual(one.unsupported, []);
  const gate = one.ops[0] as { op: string; cond: { kind: string; sel: { area: string; filter?: { type: string | null } } }; then: { op: string; for?: string }[] };
  assert.equal(gate.op, "if");
  // "Battle Area or Leader Area" is both areas, not a Battle Area holding a
  // Leader — which is nothing, so the waiver could never have switched on.
  assert.equal(gate.cond.sel.area, "play");
  assert.equal(gate.cond.sel.filter?.type, null);
  assert.deepEqual(gate.then, [{ op: "altCost", pay: "none", for: "play" }]);
}

{
  // With the named card on the table, it plays for nothing — and there is no
  // energy at all here, so nothing else could have paid for it.
  let s = arena({ hand: ["FREEPLAY"], battle: ["V1"] });
  assert.equal(s.players.p1.energy.length, 0);
  assert.ok(
    labels(s).some((x) => x === "Play FREEPLAY (for no energy)"),
    "the printed price is offered",
  );
  const free = find(s, "p1", "hand", "FREEPLAY");
  s = play(s, { type: "play", player: "p1", card: free, alt: true });
  assert.ok(s.players.p1.battle.includes(free), "it was played");
  assert.equal(s.players.p1.energy.length, 0, "and nothing was charged for it");
  assertConsistent(s);
}

{
  // Without the card the skill names, the waiver is not on the menu, and the
  // card costs 2 like anything else.
  const s = arena({ hand: ["FREEPLAY"], energy: ["V1", "V1"] });
  assert.ok(!labels(s).some((x) => x.includes("for no energy")), "no waiver without the condition");
  assert.ok(
    labels(s).some((x) => x === "Play FREEPLAY (2)"),
    "the printed cost is still there",
  );
}

// ── a counter can be countered (9-7) ───────────────────────────────────────

{
  // Until the window below existed, no [Counter: Counter] card in the game
  // could ever be played: the only window that collects them is the one
  // opened in answer to a counter, and none was ever opened.
  let s = arena({ hand: ["E-STOP"], energy: ["V1"], oppHand: ["E-NEGATE"], oppEnergy: ["V1"] });
  // p2 holds a counter that negates attacks; p1 holds one that negates counters.
  const stop = find(s, "p1", "hand", "E-STOP");
  const neg = find(s, "p2", "hand", "E-NEGATE");
  s = play(s, { type: "attack", player: "p1", attacker: s.players.p1.leader, target: s.players.p2.leader });
  assert.equal(s.prompt.kind, "counter");
  assert.equal((s.prompt as { player: PlayerId }).player, "p2");

  s = play(s, { type: "counter", player: "p2", card: neg });
  // 9-7: their counter is now itself open to an answer.
  assert.equal(s.prompt.kind, "counter", "the counter can be countered");
  assert.equal((s.prompt as { player: PlayerId }).player, "p1");
  assert.deepEqual((s.prompt as { candidates: string[] }).candidates, [stop]);

  s = play(s, { type: "counter", player: "p1", card: stop });
  // 9-7-3: the last one played resolves first, and it negates the one under it,
  // so the attack was never negated after all.
  assert.equal(s.battle?.negated ?? false, false, "9-7-4: the countered counter did nothing");
  assert.ok(s.players.p2.drop.includes(neg), "22-10-7: it was still paid for and still in the Drop");
  assert.ok(s.players.p1.drop.includes(stop));
  assertConsistent(s);
}

{
  // Declining the answer lets the counter through, as before.
  let s = arena({ hand: ["E-STOP"], energy: ["V1"], oppHand: ["E-NEGATE"], oppEnergy: ["V1"] });
  const neg = find(s, "p2", "hand", "E-NEGATE");
  s = play(s, { type: "attack", player: "p1", attacker: s.players.p1.leader, target: s.players.p2.leader });
  s = play(s, { type: "counter", player: "p2", card: neg });
  s = play(s, { type: "counter", player: "p1", card: null });
  assert.equal(s.battle, null, "the attack was negated and the battle ended");
  assert.equal(s.players.p2.life.length, 8);
  assertConsistent(s);
}

// ── numbers read off the board, and looking at a deck (20-11) ──────────────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);

  // The `count` amount has been in the language from the start and the
  // compiler had never once emitted it.
  const each = one("[Activate: Main] Draw 1 card for each of your Battle Cards.");
  assert.deepEqual(each.unsupported, []);
  assert.deepEqual(each.ops, [{ op: "draw", n: { count: { side: "you", area: "battle", filter: undefined, count: 99, upTo: false, mode: undefined, fromVar: undefined, take: undefined, fromEnd: undefined } } }]);

  // "+5000 power for each" is a multiple of the count, not the count.
  const power = one("[Activate: Main] This card gets +5000 power for each card in your Drop Area.");
  assert.deepEqual(power.unsupported, []);
  const amt = (power.ops[0] as { amount: { count: { area: string }; times?: number } }).amount;
  assert.equal(amt.times, 5000);
  assert.equal(amt.count.area, "drop");

  // It has to be read before the power pattern, which matches on a word
  // boundary and would otherwise take the +5000 and drop the rest in silence.
  assert.notEqual(typeof (power.ops[0] as { amount: unknown }).amount, "number", "not a flat +5000");

  // "Draw cards equal to the number of …" prints no number at all.
  assert.deepEqual((one("[Activate: Main] Draw cards equal to the number of your Battle Cards.").ops[0] as { op: string }).op, "draw");

  // Looking at a deck, in the half-dozen ways the text words it.
  const look = (text: string) => one(`[Activate: Main] ${text}`).ops[0] as { op: string; n: number; side?: string; from?: string };
  assert.deepEqual(look("Look at up to 3 cards from the top of your deck."), { op: "look", n: 3, as: "looked" });
  assert.equal(look("Look at up to the top 5 cards of your deck.").n, 5, "the number can come after the word");
  assert.equal(look("Look at up to 2 cards from the top of your opponent's deck.").side, "opponent");
  assert.equal(look("Look at the bottom card of your deck.").from, "bottom");
  assert.equal(look("Look at the bottom card of your deck.").n, 1, "a card is one card");
}

{
  // Looking is not revealing (20-11): the cards are bound to a name, not moved.
  DEFS.PEEK = { ...DEFS.V1, id: "PEEK", name: "PEEK", skill: "[Auto] When you play this card, look at the bottom card of your deck." };
  let s = arena({ hand: ["PEEK"], energy: ["V1"] });
  const deckSize = s.players.p1.deck.length;
  const bottom = s.players.p1.deck[deckSize - 1];
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "PEEK") });
  assert.equal(s.players.p1.deck.length, deckSize, "nothing left the deck");
  assert.equal(s.players.p1.deck[s.players.p1.deck.length - 1], bottom, "and the bottom card is where it was");
}

// ── a keyword's cost is written after the tag, with no colon ───────────────

{
  // "[Arrival red/green] {r}", "[Successor]{g}{y}" — the orbs are what the
  // keyword costs. Read as an effect they say nothing, and the engine never
  // learns the price; this was the single commonest reason a whole skill
  // failed to compile.
  const orbs = (line: string) => parseSkills(line)[0];
  assert.deepEqual(orbs("[Successor]{g}{g}{y}").energyCost, { Green: 2, Yellow: 1 });
  assert.equal(orbs("[Successor]{g}{g}{y}").effect, "", "nothing is left over to compile");
  assert.deepEqual(orbs("[Arrival red/green] {r} (Play this card from your hand when you have red cards.)").energyCost, { Red: 1 });
  // The orbs may be followed by the keyword's validity condition.
  assert.deepEqual(orbs("[Successor]{g}{y}, if your Leader is a green <Frieza> card.").energyCost, { Green: 1, Yellow: 1 });

  // It has to begin with an orb: a skill that merely *starts* with "When" is
  // an effect, and treating it as a cost would delete the whole skill.
  const normal = parseSkills("[Auto] When this card attacks, draw 1 card.")[0];
  assert.equal(normal.cost, "");
  assert.equal(normal.effect, "When this card attacks, draw 1 card.");
}

// ── a phrase that names two areas at once ──────────────────────────────────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);

  // "Battle Cards or Unisons" is the one two-area phrase the game prints
  // often enough to be worth a selector that can hold both. Reading it as
  // either one alone would drop the other half without saying so.
  const both = one("[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards or Unisons and switch it to Rest Mode.");
  assert.deepEqual(both.unsupported, []);
  const sel = (both.ops[0] as { sel: { areas?: string[]; side: string } }).sel;
  assert.deepEqual(sel.areas, ["battle", "unison"]);
  assert.equal(sel.side, "opponent");

  // Each area alone still resolves to just that one.
  assert.equal((one("[Auto] When you play this card, choose up to 1 of your opponent's Unisons and remove 1 marker from it.").ops[0] as { sel: { area: string; areas?: string[] } }).sel.area, "unison");
  assert.equal((one("[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards and KO it.").ops[0] as { sel: { areas?: string[] } }).sel.areas, undefined);
}

{
  // And it finds cards in both areas at once.
  const ctx = { defs: DEFS };
  DEFS.RESTBOTH = { ...DEFS.V1, id: "RESTBOTH", name: "RESTBOTH", skill: "[Auto] When you play this card, choose 1 of your opponent's Battle Cards or Unisons and switch it to Rest Mode." };
  let s = arena({ hand: ["RESTBOTH"], energy: ["V1"] });
  // Their only card in either area is a Unison, so the choice is forced.
  const uni = s.players.p2.deck.find((id) => s.cards[id].cardId === "V-BLUE")!;
  s.cards[uni].cardId = "U1";
  move(ctx, s, [], uni, "unison", "p2");
  // 21-9: a Unison with no markers is dropped by rule processing before the
  // skill ever gets to look at it.
  s.cards[uni].markers = 2;
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "RESTBOTH") });
  assert.equal(s.cards[uni].mode, "rest", "a Unison was found by a phrase that also names Battle Cards");
}

// ── a skill that switches itself off, and taking a card ────────────────────

{
  // 9-1-5: an effect meant to happen once. The skill is still printed; it
  // simply never triggers again, through the same list of negated skill
  // indexes another card's negation uses.
  let s = arena({ hand: ["ONCEONLY", "ONCEONLY"], energy: ["V1", "V1"] });
  const before = s.players.p1.hand.length;
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "ONCEONLY") });
  const once = find(s, "p1", "battle", "ONCEONLY");
  assert.equal(s.players.p1.hand.length, before - 1 + 1, "played one, drew one");
  assert.deepEqual(s.cards[once].negated, [0], "the skill turned itself off — its own index, on its own instance");

  // The second copy is a different card, and its own skill still works.
  const after = s.players.p1.hand.length;
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "ONCEONLY") });
  assert.equal(s.players.p1.hand.length, after - 1 + 1, "the other copy still draws");
}

{
  // 3-1-6-1: a Battle Card may sit in either player's Battle Area, so taking
  // control is a move to your own side. The card is not replayed and keeps
  // what it had.
  let s = arena({ hand: ["STEALER"], energy: ["V1"], oppBattle: ["BIG"] });
  const prize = find(s, "p2", "battle", "BIG");
  s.cards[prize].mode = "rest";
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "STEALER") });
  assert.ok(s.players.p1.battle.includes(prize), "it is yours now");
  assert.ok(!s.players.p2.battle.includes(prize));
  assert.equal(s.cards[prize].mode, "rest", "23-3: the card itself did not change");
  assert.equal(s.cards[prize].owner, "p2", "its owner is still its owner (3-1-6)");
  assertConsistent(s);
}

// ── the second half of a sentence, left in the third person ────────────────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);

  // Splitting on the "and" leaves "places it in their Drop Area" with its
  // subject in the clause before it. Only the verbs that move a card are
  // normalised, because there the card decides what happens and the actor
  // does not matter.
  const warp = one("[Auto] When you play this card, choose 1 of your opponent's Battle Cards and sends it to their Warp.");
  assert.deepEqual(warp.unsupported, []);
  assert.deepEqual(
    warp.ops.map((o) => o.op),
    ["choose", "moveTo"],
  );
  assert.equal((warp.ops[1] as { to: string }).to, "warp");

  // "Your opponent chooses 1 card in their hand and places it in their Drop
  // Area" is one action said twice. Read as two it moved the wrong card:
  // "it" had nothing of its own to point at and fell back on this card.
  const discard = one("[Auto] When you play this card, your opponent chooses 1 card in their hand and places it in their Drop Area.");
  assert.deepEqual(discard.unsupported, []);
  assert.deepEqual(discard.ops, [{ op: "discard", n: 1, side: "opponent" }], "the discard, once");
}

// ── a clause is read whole, or not at all ──────────────────────────────────

{
  const one = (text: string) => compileSkill(parseSkills(`[Activate: Battle] ${text}`)[0]);

  // The commonest two-part clause in the game. `splitClauses` keeps "and ["
  // together on purpose so that "gains [A] and [B]" stays whole, which means
  // this arrives in one piece — and the keyword used to be dropped in silence.
  const both = one("This card gets +10000 power and [Double Strike] for the turn.");
  assert.deepEqual(both.unsupported, []);
  assert.deepEqual(
    both.ops.map((o) => o.op),
    ["power", "grant"],
  );
  assert.equal((both.ops[0] as { amount: number; until: string }).until, "turn");
  assert.equal((both.ops[1] as { keyword: { name: string } }).keyword.name, "Strike");

  // Combo power says it the same way.
  assert.deepEqual(
    one("This card gets +5000 combo power and [Barrier] for the battle.").ops.map((o) => o.op),
    ["comboPower", "grant"],
  );

  // A tail the compiler does not know must fail the whole clause rather than
  // be discarded: "during your turn" makes the bonus conditional, and reading
  // it as an unconditional +5000 would be wrong rather than incomplete.
  assert.ok(one("This card gets +5000 power during your turn.").unsupported.length > 0, "an unknown tail is an honest gap, not a silent loss");

  // The tails that really are only a duration still read.
  for (const tail of ["for the turn", "for the duration of the battle", "until the end of your opponent's turn"]) {
    assert.deepEqual(one(`This card gets +5000 power ${tail}.`).unsupported, [], tail);
  }
}

// ── §22 keywords as engine rules ───────────────────────────────────────────

const acts = (s: GameState) => legalActions({ defs: DEFS }, s).map((a) => a.action);
const canActivate = (s: GameState, card: string) => acts(s).some((a) => a.type === "activate" && a.card === card);

{
  // [Burst X] (22-27): X cards from the top of the deck to the Drop as a cost;
  // with fewer than X cards in the deck the cost cannot be paid.
  DEFS.BURSTER = { ...DEFS.V1, id: "BURSTER", name: "BURSTER", skill: "[Burst 2][Activate: Main] Draw 1 card." };
  let s = arena({ battle: ["BURSTER"] });
  const b = s.players.p1.battle[0];
  assert.ok(canActivate(s, b), "22-27: offered with a deck to burn");
  const deck = s.players.p1.deck.length;
  const hand = s.players.p1.hand.length;
  const drop = s.players.p1.drop.length;
  s = play(s, { type: "activate", player: "p1", card: b, skill: 0 });
  assert.equal(s.players.p1.drop.length, drop + 2, "22-27-2: two cards to the Drop as the cost");
  assert.equal(s.players.p1.hand.length, hand + 1, "then the skill resolves");
  assert.equal(s.players.p1.deck.length, deck - 3);
  assertConsistent(s);

  const d = arena({ battle: ["BURSTER"] });
  d.players.p1.deck.splice(1).forEach((id) => d.players.p1.drop.push(id));
  assert.ok(!canActivate(d, d.players.p1.battle[0]), "22-27-3: one card in the deck is not enough for [Burst 2]");
}

{
  // [Spirit Boost X] (22-43): X markers off your Unison as a cost.
  DEFS.SPIRIT = { ...DEFS.V1, id: "SPIRIT", name: "SPIRIT", skill: "[Spirit Boost 2][Activate: Main] Draw 1 card." };
  let s = arena({ battle: ["SPIRIT"], hand: ["U1"], energy: ["V1", "V1", "V1"] });
  const sp = s.players.p1.battle[0];
  assert.ok(!canActivate(s, sp), "22-43-3: no Unison, no Spirit Boost");
  s = play(s, { type: "playUnison", player: "p1", card: find(s, "p1", "hand", "U1"), x: 3 });
  const u = s.players.p1.unison!;
  assert.ok(canActivate(s, sp));
  const hand = s.players.p1.hand.length;
  s = play(s, { type: "activate", player: "p1", card: sp, skill: 0 });
  assert.equal(s.cards[u].markers, 1, "22-43-2: two markers removed as the cost");
  assert.equal(s.players.p1.hand.length, hand + 1);
  assert.ok(!canActivate(s, sp), "one marker left is not enough for a second use");
  assertConsistent(s);
}

{
  // [Arrival X/Y] (22-29): from hand during a battle, once cards of both
  // colours are in the Combo Area; the effect is playing the card.
  DEFS.ARRIVER = { ...DEFS.V1, id: "ARRIVER", name: "ARRIVER", energyCost: 4, power: 20000, skill: "[Arrival red/blue] {r}" };
  let s = arena({ hand: ["ARRIVER", "V1", "V-BLUE"], energy: ["V1", "V1"] });
  const arr = find(s, "p1", "hand", "ARRIVER");
  assert.ok(!canActivate(s, arr), "22-29-4: not in the Main Phase");
  s = play(s, { type: "attack", player: "p1", attacker: s.players.p1.leader, target: s.players.p2.leader });
  assert.ok(!canActivate(s, arr), "no combo cards yet");
  s = play(s, { type: "combo", player: "p1", card: find(s, "p1", "hand", "V1") });
  assert.ok(!canActivate(s, arr), "red alone is not red and blue");
  s = play(s, { type: "combo", player: "p1", card: find(s, "p1", "hand", "V-BLUE") });
  assert.ok(canActivate(s, arr), "22-29-3: both colours are in the Combo Area");
  s = play(s, { type: "activate", player: "p1", card: arr, skill: 0 });
  assert.ok(s.players.p1.battle.includes(arr), "22-29-5: the card is played");
  assert.equal(s.players.p1.energy.filter((id) => s.cards[id].mode === "rest").length, 1, "for {r}, not its printed cost");
  assert.equal(s.prompt.kind, "combo", "and the battle goes on");
  assert.equal((s.prompt as { side: string }).side, "offense");
  assertConsistent(s);
}

{
  // [Empower X Y] (22-45): a Unison replacing one of colour X keeps up to Y of its markers.
  DEFS.EMP = { ...DEFS.U1, id: "EMP", name: "EMP", skill: "[Empower Red 2]" };
  let s = arena({ hand: ["U1", "EMP"], energy: ["V1", "V1", "V1", "V1", "V1"] });
  s = play(s, { type: "playUnison", player: "p1", card: find(s, "p1", "hand", "U1"), x: 3 });
  const old = s.players.p1.unison!;
  s = play(s, { type: "playUnison", player: "p1", card: find(s, "p1", "hand", "EMP"), x: 1 });
  const emp = s.players.p1.unison!;
  assert.equal(s.cards[emp].cardId, "EMP");
  assert.ok(s.players.p1.drop.includes(old), "13-2-3: the old Unison went to the Drop");
  assert.equal(s.cards[emp].markers, 3, "22-45-2: 1 paid plus 2 carried over (of the 3 it had)");
  assertConsistent(s);
}

{
  // [Successor] (22-38): from hand by dropping green/yellow Battle Cards
  // whose costs add up exactly to this card's cost; picked one at a time,
  // and only cards that still leave a way to the exact sum are offered.
  DEFS.SUCC = { ...DEFS.V1, id: "SUCC", name: "SUCC", colors: ["Green", "Yellow"], energyCost: 5, power: 25000, skill: "[Successor]{g}{y}" };
  DEFS.G2 = { ...DEFS.V1, id: "G2", name: "G2", colors: ["Green"], energyCost: 2 };
  DEFS.Y3 = { ...DEFS.V1, id: "Y3", name: "Y3", colors: ["Yellow"], energyCost: 3 };
  DEFS.G4 = { ...DEFS.V1, id: "G4", name: "G4", colors: ["Green"], energyCost: 4 };
  let s = arena({ hand: ["SUCC"], battle: ["G2", "Y3", "G4"], energy: ["G2", "Y3"] });
  const succ = find(s, "p1", "hand", "SUCC");
  const [g2, y3, g4] = s.players.p1.battle;
  assert.ok(labels(s).some((x) => x.startsWith("Successor: play SUCC")), "22-38-2: a sum of 5 exists (2 + 3)");
  s = play(s, { type: "activate", player: "p1", card: succ, skill: 0 });
  assert.equal(s.prompt.kind, "chooseCards");
  assert.deepEqual((s.prompt as { choice: { candidates: string[] } }).choice.candidates, [g2, y3], "4 alone can never reach 5, so it is not offered");
  s = play(s, { type: "choose", player: "p1", cards: [g2] });
  assert.equal(s.prompt.kind, "chooseCards", "3 more to find");
  assert.deepEqual((s.prompt as { choice: { candidates: string[] } }).choice.candidates, [y3]);
  s = play(s, { type: "choose", player: "p1", cards: [y3] });
  assert.ok(s.players.p1.battle.includes(succ), "22-38-4: played");
  assert.ok(s.players.p1.drop.includes(g2) && s.players.p1.drop.includes(y3), "22-38-3: the chosen cards were dropped");
  assert.ok(s.players.p1.battle.includes(g4), "the rest stay");
  assert.ok(s.players.p1.energy.every((id) => s.cards[id].mode === "rest"), "{g}{y} was paid");
  assertConsistent(s);

  const n = arena({ hand: ["SUCC"], battle: ["G4", "G4"], energy: ["G2", "Y3"] });
  assert.ok(!labels(n).some((x) => x.startsWith("Successor")), "4 + 4 is not 5");
}

{
  // [Aegis X/Y] (22-30): in the Defense Step of the opponent's turn only; drop
  // one card of each colour from hand, then up to two energy go active.
  DEFS.AEG = { ...DEFS.V1, id: "AEG", name: "AEG", skill: "[Aegis red/blue] {r}" };
  let s = arena({ battle: ["AEG"], hand: ["V1", "V-BLUE"], energy: ["V1", "V1", "V1"] });
  const aeg = s.players.p1.battle[0];
  assert.ok(!canActivate(s, aeg), "22-30-4: not in your own Main Phase");
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  const [e1, e2, e3] = s.players.p1.energy;
  s.cards[e1].mode = "rest";
  s.cards[e2].mode = "rest";
  s = play(s, { type: "attack", player: "p2", attacker: s.players.p2.leader, target: s.players.p1.leader });
  assert.ok(!canActivate(s, aeg), "22-30-4: not in the Offense Step");
  s = play(s, { type: "pass", player: "p2" });
  assert.equal((s.prompt as { side: string }).side, "defense");
  assert.ok(labels(s).some((x) => x.startsWith("Aegis Red/Blue")), "22-30-4: the Defense Step of the opponent's turn");
  s = play(s, { type: "activate", player: "p1", card: aeg, skill: 0 });
  assert.equal(s.cards[e3].mode, "rest", "the {r} was paid");
  assert.equal(s.prompt.kind, "chooseCards");
  const v1 = find(s, "p1", "hand", "V1");
  const vb = find(s, "p1", "hand", "V-BLUE");
  s = play(s, { type: "choose", player: "p1", cards: [v1] });
  assert.equal(s.prompt.kind, "chooseCards", "one colour down, one to go");
  const rest = (s.prompt as { choice: { candidates: string[] } }).choice.candidates;
  assert.ok(rest.includes(vb) && !rest.includes(v1), "the picked card is off the menu");
  s = play(s, { type: "choose", player: "p1", cards: [vb] });
  assert.ok(s.players.p1.drop.includes(v1) && s.players.p1.drop.includes(vb), "22-30-3: both dropped as the cost");
  assert.equal(s.prompt.kind, "chooseCards", "22-30-5: which energy to stand");
  s = play(s, { type: "choose", player: "p1", cards: [e1] }, { type: "choose", player: "p1", cards: [e2] });
  assert.equal(s.cards[e1].mode, "active");
  assert.equal(s.cards[e2].mode, "active");
  assert.equal(s.cards[e3].mode, "rest", "up to two, not all");
  assert.equal(s.prompt.kind, "combo");
  assert.equal((s.prompt as { side: string }).side, "defense", "back to the Defense Step");
  assertConsistent(s);
}

{
  // [Revive X/Y] (22-34): KO'd, its owner may drop cards from hand covering
  // both colours to play it back from the Drop — once per card per turn.
  DEFS.REV = { ...DEFS.V1, id: "REV", name: "REV", skill: "[Revive red/blue]" };
  let s = arena({ battle: ["REV"], hand: ["V1", "V-BLUE", "V1", "V-BLUE"], oppBattle: ["DOUBLE"] });
  const rev = s.players.p1.battle[0];
  s.cards[rev].mode = "rest";
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  const dbl = s.players.p2.battle[0];
  s = play(s, { type: "attack", player: "p2", attacker: dbl, target: rev }, { type: "pass", player: "p2" }, { type: "pass", player: "p1" });
  assert.ok(s.players.p1.drop.includes(rev), "20000 into 10000: KO'd");
  assert.equal(s.prompt.kind, "chooseCards", "22-34-3: the owner is asked");
  assert.equal((s.prompt as { player: string }).player, "p1");
  const v1 = find(s, "p1", "hand", "V1");
  const vb = find(s, "p1", "hand", "V-BLUE");
  s = play(s, { type: "choose", player: "p1", cards: [v1] }, { type: "choose", player: "p1", cards: [vb] });
  assert.ok(s.players.p1.battle.includes(rev), "22-34-4: played from the Drop");
  assert.ok(s.players.p1.drop.includes(v1) && s.players.p1.drop.includes(vb), "the cost was dropped");
  assert.equal(s.prompt.kind, "main");
  assert.equal(s.turnPlayer, "p2");
  // KO'd again the same turn: [Revive] is negated on it (22-34-4), no question asked.
  s.cards[rev].mode = "rest";
  const handBefore = s.players.p1.hand.length;
  s = play(s, { type: "attack", player: "p2", attacker: s.players.p2.leader, target: rev }, { type: "pass", player: "p2" }, { type: "pass", player: "p1" });
  assert.ok(s.players.p1.drop.includes(rev), "KO'd by the 10000 leader on a tie");
  assert.equal(s.prompt.kind, "main", "no second Revive this turn");
  assert.equal(s.players.p1.hand.length, handBefore, "and nothing was dropped");
  assertConsistent(s);

  // Declining keeps the card in the Drop and the hand whole.
  let d = arena({ battle: ["REV"], hand: ["V1", "V-BLUE"], oppBattle: ["DOUBLE"] });
  const r2 = d.players.p1.battle[0];
  d.cards[r2].mode = "rest";
  d = play(d, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  d = play(d, { type: "attack", player: "p2", attacker: d.players.p2.battle[0], target: r2 }, { type: "pass", player: "p2" }, { type: "pass", player: "p1" });
  assert.equal(d.prompt.kind, "chooseCards");
  const kept = d.players.p1.hand.length;
  d = play(d, { type: "choose", player: "p1", cards: [] });
  assert.ok(d.players.p1.drop.includes(r2));
  assert.equal(d.players.p1.hand.length, kept);
}

{
  // [Rejuvenate] (22-42): a Unison drops a card from beneath itself and pays
  // the printed marker cost; the top card of the deck becomes life.
  DEFS.REJ = { ...DEFS.U1, id: "REJ", name: "REJ", skill: "[Rejuvenate] Remove 2 markers from this card." };
  let s = arena({ hand: ["REJ", "REJ"], energy: ["V1", "V1", "V1"] });
  s = play(s, { type: "playUnison", player: "p1", card: find(s, "p1", "hand", "REJ"), x: 3 });
  const u = s.players.p1.unison!;
  assert.ok(!canActivate(s, u), "22-42-3: nothing beneath it yet");
  const copy = find(s, "p1", "hand", "REJ");
  s = play(s, { type: "growUnison", player: "p1", card: copy });
  assert.equal(s.cards[u].markers, 4);
  assert.ok(labels(s).some((x) => x.startsWith("Rejuvenate: 2 markers")));
  const life = s.players.p1.life.length;
  const top = s.players.p1.deck[0];
  s = play(s, { type: "activate", player: "p1", card: u, skill: 0 });
  assert.equal(s.cards[u].markers, 2, "22-42-3: the marker cost");
  assert.deepEqual(s.cards[u].under, [], "and the card beneath");
  assert.ok(s.players.p1.drop.includes(copy));
  assert.equal(s.players.p1.life.length, life + 1, "22-42-4: the top card of the deck to life");
  assert.ok(s.players.p1.life.includes(top));
  assert.ok(!canActivate(s, u), "13-4-2: one marker skill per card per turn");
  assertConsistent(s);
}

{
  // A prompt for more than one card is answered one card at a time, with
  // "Done choosing" once the minimum is met.
  let s = arena({ hand: ["V1", "V1", "V1"] });
  const [a, b, c] = s.players.p1.hand;
  s.prompt = { kind: "chooseCards", player: "p1", choice: { reason: "test", candidates: [a, b, c], min: 1, max: 2, continuation: "swap" } };
  s.continuations.swap = { card: a };
  assert.ok(!labels(s).includes("Choose none"), "one is required");
  s = play(s, { type: "choose", player: "p1", cards: [a] });
  assert.equal(s.prompt.kind, "chooseCards");
  assert.deepEqual((s.prompt as { choice: { candidates: string[]; min: number; max: number } }).choice.candidates, [b, c]);
  assert.ok(labels(s).includes("Done choosing"), "the minimum is met");
  assert.throws(() => play(s, { type: "choose", player: "p1", cards: [a] }), /invalid choice/, "a card cannot be picked twice");
}

{
  // [Alliance X/Y] (22-32): as it attacks, its owner may rest other Battle
  // Cards of the named colours; the printed effect then reads "the total
  // power of the cards switched to Rest Mode by this skill" off those cards.
  DEFS.ALLY = { ...DEFS.V1, id: "ALLY", name: "ALLY", colors: ["Red", "Green"], energyCost: 3, skill: "[Alliance Red/Green] This card gains power equal to the total power of the cards switched to Rest Mode by this skill and [Double Strike] for the battle, then draw 1 card." };
  DEFS.GRN = { ...DEFS.V1, id: "GRN", name: "GRN", colors: ["Green"], power: 15000 };
  let s = arena({ battle: ["ALLY", "V1", "GRN", "V-BLUE"], oppBattle: ["BIG"] });
  const [ally, v1, grn] = s.players.p1.battle;
  const big = s.players.p2.battle[0];
  s.cards[big].mode = "rest";
  const hand = s.players.p1.hand.length;
  s = play(s, { type: "attack", player: "p1", attacker: ally, target: big });
  assert.equal(s.prompt.kind, "chooseCards", "22-32-3: asked which cards to rest");
  assert.deepEqual((s.prompt as { choice: { candidates: string[] } }).choice.candidates, [v1, grn], "red or green, active, and not the attacker");
  s = play(s, { type: "choose", player: "p1", cards: [v1] }, { type: "choose", player: "p1", cards: [grn] });
  assert.equal(s.cards[v1].mode, "rest");
  assert.equal(s.cards[grn].mode, "rest");
  assert.equal(s.players.p1.hand.length, hand + 1, "then draw 1 card");
  assert.equal(s.prompt.kind, "combo");
  s = play(s, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  assert.ok(s.players.p2.drop.includes(big), "10000 + (10000 + 15000) beats 25000");
  assertConsistent(s);

  // Declining rests nothing and the attack is what it was.
  let d = arena({ battle: ["ALLY", "V1"], oppBattle: ["BIG"] });
  const b2 = d.players.p2.battle[0];
  d.cards[b2].mode = "rest";
  d = play(d, { type: "attack", player: "p1", attacker: d.players.p1.battle[0], target: b2 }, { type: "choose", player: "p1", cards: [] });
  assert.equal(d.cards[d.players.p1.battle[1]].mode, "active");
  d = play(d, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  assert.ok(d.players.p2.battle.includes(b2), "10000 into 25000 does nothing");

  // Nothing of the right colours to rest: no question.
  let n = arena({ battle: ["ALLY", "V-BLUE"], oppBattle: ["BIG"] });
  n.cards[n.players.p2.battle[0]].mode = "rest";
  n = play(n, { type: "attack", player: "p1", attacker: n.players.p1.battle[0], target: n.players.p2.battle[0] });
  assert.equal(n.prompt.kind, "combo");

  // A printed condition on the keyword ("If your Leader Card is blue:") is
  // read before asking.
  DEFS.ALLYC = { ...DEFS.ALLY, id: "ALLYC", name: "ALLYC", skill: "[Alliance Red/Green] If your Leader Card is blue: This card gains power equal to the total power of the cards switched to Rest Mode by this skill for the battle." };
  let c = arena({ battle: ["ALLYC", "V1"], oppBattle: ["BIG"] });
  c.cards[c.players.p2.battle[0]].mode = "rest";
  c = play(c, { type: "attack", player: "p1", attacker: c.players.p1.battle[0], target: c.players.p2.battle[0] });
  assert.equal(c.prompt.kind, "combo", "a red Leader: the skill does not apply");
}

{
  // [Invoker] (22-37): a Red/Blue multicolour Extra can be paid for by resting
  // one active Red/Blue multicolour energy instead of its energy cost.
  DEFS.INVK = { ...DEFS.V1, id: "INVK", name: "INVK", colors: ["Red", "Blue"], skill: "[Invoker]" };
  DEFS["E-RB"] = { ...DEFS["E-DRAW"], id: "E-RB", name: "E-RB", colors: ["Red", "Blue"], energyCost: 2 };
  DEFS.RB = { ...DEFS.V1, id: "RB", name: "RB", colors: ["Red", "Blue"] };
  let s = arena({ hand: ["E-RB"], battle: ["INVK"], energy: ["RB"] });
  const e = find(s, "p1", "hand", "E-RB");
  const l = labels(s);
  assert.ok(!l.includes("Activate E-RB (2)"), "one energy cannot pay 2");
  assert.ok(l.some((x) => x.startsWith("Activate E-RB by resting a Red/Blue energy")), "22-37: [Invoker] in play and a Red/Blue energy active");
  const hand = s.players.p1.hand.length;
  s = play(s, { type: "activate", player: "p1", card: e, skill: 0, alt: true });
  assert.equal(s.cards[s.players.p1.energy[0]].mode, "rest", "the Red/Blue energy was rested");
  assert.equal(s.players.p1.hand.length, hand - 1 + 2, "and the Extra resolved");
  assert.ok(s.players.p1.drop.includes(e));
  assertConsistent(s);

  assert.ok(!labels(arena({ hand: ["E-RB"], energy: ["RB"] })).some((x) => x.includes("Invoker")), "no [Invoker] in play, no offer");
  assert.ok(!labels(arena({ hand: ["E-RB"], battle: ["INVK"], energy: ["V1"] })).some((x) => x.includes("Invoker")), "a mono-red energy will not do");
  assert.ok(!labels(arena({ hand: ["E-DRAW"], battle: ["INVK"], energy: ["RB"] })).some((x) => x.includes("Invoker")), "nor a mono-red Extra");
}

{
  // A condition written before the colon ("[Auto] If your Leader Card is
  // red: …") is part of the skill's validity (9-1-3). It used to land in
  // `cost` and be dropped, so the skill ran whatever the Leader was.
  const cond = compileSkill(parseSkills("[Auto] If your Leader Card is blue: When you play this card, draw 1 card.")[0]);
  assert.deepEqual(cond.unsupported, []);
  assert.equal(cond.ops.length, 1);
  assert.equal(cond.ops[0].op, "if");
  assert.deepEqual((cond.ops[0] as { then: unknown[] }).then, [{ op: "draw", n: 1 }]);
  // One the compiler cannot read fails the skill rather than running it anyway.
  const odd = compileSkill(parseSkills("[Auto] If the moon is full: When you play this card, draw 1 card.")[0]);
  assert.deepEqual(odd.ops, []);
  assert.ok(odd.unsupported.length > 0);

  DEFS.CONDDRAW = { ...DEFS.V1, id: "CONDDRAW", name: "CONDDRAW", energyCost: 1, skill: "[Auto] If your Leader Card is blue: When you play this card, draw 2 cards." };
  let s = arena({ hand: ["CONDDRAW"], energy: ["V1"] });
  const hand = s.players.p1.hand.length;
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "CONDDRAW") });
  assert.equal(s.players.p1.hand.length, hand - 1, "a red Leader: no draw");

  DEFS.CONDACT = { ...DEFS.V1, id: "CONDACT", name: "CONDACT", skill: "[Activate: Main] If your Leader Card is red: Draw 1 card." };
  DEFS.CONDACTB = { ...DEFS.V1, id: "CONDACTB", name: "CONDACTB", skill: "[Activate: Main] If your Leader Card is blue: Draw 1 card." };
  const a = arena({ battle: ["CONDACT", "CONDACTB"] });
  assert.ok(canActivate(a, a.players.p1.battle[0]), "the condition holds: offered");
  assert.ok(!canActivate(a, a.players.p1.battle[1]), "the condition fails: not offered");

  // The shapes the catalog prints most that used to be gaps.
  const read = (t: string) => parseConditionClause(t)?.cond;
  assert.deepEqual(read("if this card has 3 or more markers on it"), { kind: "markers", sel: { special: "self" }, atLeast: 3 });
  assert.deepEqual(read("if this card is in a battle"), { kind: "inBattle", sel: { special: "self" } });
  assert.deepEqual(read("if this card isn't in a battle"), { kind: "inBattle", sel: { special: "self" }, not: true });
  assert.equal(read("if your Leader's back side is a black <Goku> card")?.kind, "leaderMatches");
  assert.ok((read("if your Leader's back side is a black <Goku> card") as { back?: boolean }).back);
  const either = read("when your life is at 4 or less, or you have 5 or more energy");
  assert.equal(either?.kind, "any");
  assert.deepEqual((either as { conds: { kind: string }[] }).conds.map((x) => x.kind), ["life", "count"]);
  const bothOf = read("if your life is at 4 or less and you have 3 or more energy");
  assert.equal(bothOf?.kind, "all");
  assert.equal(read("if your life is at 4 or less, or the moon is full"), undefined, "one unreadable part fails the whole condition");
  assert.deepEqual(read("if your opponent's Leader Card's back is facing up"), { kind: "leaderFlipped", side: "opponent" });
  assert.deepEqual(read("if this card's power is 30000 or more"), { kind: "power", sel: { special: "self" }, atLeast: 30000 });
  const trait = read("if your Leader Card has ≪Saiyan≫ in its special trait");
  assert.equal(trait?.kind, "leaderMatches");
  assert.deepEqual((trait as { filter: { traits: string[] } }).filter.traits.map((x) => x.toLowerCase()), ["saiyan"]);
  assert.equal(read("when your life is at 4 or less or your opponent's Leader Card's back is facing up")?.kind, "any");
  // "red or blue" and "4 or less" are not alternatives.
  assert.equal(read("if your Leader Card is red or blue")?.kind, "leaderMatches");

  DEFS.CONDOR = { ...DEFS.V1, id: "CONDOR", name: "CONDOR", skill: "[Activate: Main] If your life is at 4 or less or you have 1 or more energy: Draw 1 card." };
  const o = arena({ battle: ["CONDOR"], energy: ["V1"] });
  assert.ok(canActivate(o, o.players.p1.battle[0]), "8 life, but one energy: the other half holds");
  const o2 = arena({ battle: ["CONDOR"] });
  assert.ok(!canActivate(o2, o2.players.p1.battle[0]), "neither holds");
}

{
  // "Choose up to 1 of your opponent's Battle Cards with power less than or
  // equal to this card's power" used to read "this card" as the target and
  // pick the card itself. The bound is measured where the skill runs.
  const sc = compileSkill(parseSkills("[Auto] When this card attacks, choose up to 1 of your opponent's Battle Cards with power less than or equal to this card's power, ignoring [Barrier], and KO it.")[0]);
  assert.deepEqual(sc.unsupported, []);
  const sel = (sc.ops[0] as { sel: { side?: string; area?: string; ignoreBarrier?: boolean; filter?: { powerRel: unknown } } }).sel;
  assert.equal(sel.side, "opponent");
  assert.equal(sel.area, "battle");
  assert.deepEqual(sel.filter?.powerRel, { of: "self", cmp: "<=" });
  assert.ok(sel.ignoreBarrier);

  DEFS.RELKO = { ...DEFS.V1, id: "RELKO", name: "RELKO", power: 15000, skill: "[Auto] When this card attacks, choose up to 1 of your opponent's Battle Cards with power less than or equal to this card's power and KO it." };
  let s = arena({ battle: ["RELKO"], oppBattle: ["V-BLUE", "BIG"] });
  const [small, big] = s.players.p2.battle;
  s.cards[big].mode = "rest";
  s = play(s, { type: "attack", player: "p1", attacker: s.players.p1.battle[0], target: big });
  assert.equal(s.prompt.kind, "chooseCards");
  assert.deepEqual((s.prompt as { choice: { candidates: string[] } }).choice.candidates, [small], "10000 ≤ 15000; 25000 is not");
  s = play(s, { type: "choose", player: "p1", cards: [small] });
  assert.ok(s.players.p2.drop.includes(small));
  assertConsistent(s);
}

{
  // Wordings from the top of the "one clause away" list.
  const one = (text: string) => compileSkill(parseSkills(`[Auto] When you play this card, ${text}`)[0]);
  const ops = (text: string) => one(text).ops.map((o) => o.op);

  // Several cards to several owners' areas.
  assert.deepEqual(ops("choose 2 of your opponent's Battle Cards and return them to their owners' hands."), ["choose", "moveTo"]);
  assert.deepEqual(ops("choose 2 of your opponent's Battle Cards and place them at the bottom of their owners' decks in any order."), ["choose", "moveTo"]);
  assert.equal((one("choose 2 of your opponent's Battle Cards and place them at the bottom of their owners' decks in any order.").ops[1] as { position?: string }).position, "bottom");
  assert.deepEqual(ops("choose 2 of your opponent's Battle Cards and send them to their owners' Warps."), ["choose", "moveTo"]);

  // The top of the deck to the Drop, either side.
  assert.deepEqual(one("your opponent places the top card of their deck in their Drop Area.").ops, [{ op: "mill", n: 1, side: "opponent" }]);
  assert.deepEqual(one("place the top 2 cards of your deck in your Drop Area.").ops, [{ op: "mill", n: 2 }]);

  // A delay the table did not have.
  const later = one("at the start of your opponent's next Main Phase, draw 1 card.").ops[0] as { op: string; at?: string; scope?: string };
  assert.equal(later.op, "delay");
  assert.equal(later.at, "mainStart");
  assert.equal(later.scope, "opponentNextTurn");

  // Hidden Mode (23-5).
  assert.deepEqual(ops("choose 1 of your opponent's Battle Cards and switch it to Hidden Mode."), ["choose", "hidden"]);
  DEFS.HIDER = { ...DEFS.V1, id: "HIDER", name: "HIDER", energyCost: 1, skill: "[Auto] When you play this card, choose 1 of your opponent's Battle Cards and switch it to Hidden Mode." };
  let s = arena({ hand: ["HIDER"], energy: ["V1"], oppBattle: ["V-BLUE"] });
  const vb = s.players.p2.battle[0];
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "HIDER") });
  if (s.prompt.kind === "chooseCards") s = play(s, { type: "choose", player: "p1", cards: [vb] });
  assert.equal(s.cards[vb].hidden, true, "23-5-1: face down in the Battle Area");
  assert.ok(s.players.p2.battle.includes(vb), "and still there");

  // "If you added a card to your hand" remembers what this skill did (20-16).
  const did = one("choose up to 1 card in your Drop Area and add it to your hand. If you added a card to your hand, draw 1 card.");
  assert.deepEqual(did.unsupported, []);
  const tail = did.ops[did.ops.length - 1] as { op: string; cond?: { kind: string; what?: string } };
  assert.equal(tail.op, "if");
  assert.deepEqual(tail.cond, { kind: "did", what: "addToHand" });
  DEFS.DIDDRAW = { ...DEFS.V1, id: "DIDDRAW", name: "DIDDRAW", energyCost: 1, skill: "[Auto] When you play this card, choose up to 1 card in your Drop Area and add it to your hand. If you added a card to your hand, draw 1 card." };
  let d = arena({ hand: ["DIDDRAW", "DIDDRAW"], energy: ["V1", "V1"] });
  let hand = d.players.p1.hand.length;
  d = play(d, { type: "play", player: "p1", card: find(d, "p1", "hand", "DIDDRAW") });
  if (d.prompt.kind === "chooseCards") d = play(d, { type: "choose", player: "p1", cards: [] });
  assert.equal(d.players.p1.hand.length, hand - 1, "an empty Drop: nothing added, nothing drawn");
  const dropped = d.players.p1.deck[0];
  move({ defs: DEFS }, d, [], dropped, "drop", "p1");
  hand = d.players.p1.hand.length;
  d = play(d, { type: "play", player: "p1", card: find(d, "p1", "hand", "DIDDRAW") });
  assert.equal(d.prompt.kind, "chooseCards");
  d = play(d, { type: "choose", player: "p1", cards: [dropped] });
  assert.equal(d.players.p1.hand.length, hand - 1 + 2, "the card from the Drop, then the draw it earned");
  assertConsistent(d);
}

{
  // Negation for a duration (9-1-5) is a continuous effect: it was being
  // written into the state and never read, so "negate its skills for the
  // turn" did nothing — and the card was marked negated for the game as well.
  const ctx = { defs: DEFS };
  DEFS.MUTER = { ...DEFS.V1, id: "MUTER", name: "MUTER", energyCost: 1, skill: "[Auto] When you play this card, choose 1 of your opponent's Battle Cards and negate its skills for the turn." };
  assert.deepEqual(compileSkill(parseSkills(DEFS.MUTER.skill!)[0]).unsupported, []);
  let s = arena({ hand: ["MUTER"], energy: ["V1"], oppBattle: ["BLOCKER"] });
  const blocker = s.players.p2.battle[0];
  assert.ok(has(ctx, s, blocker, "Blocker"));
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "MUTER") });
  if (s.prompt.kind === "chooseCards") s = play(s, { type: "choose", player: "p1", cards: [blocker] });
  assert.ok(!has(ctx, s, blocker, "Blocker"), "negated for the turn");
  assert.deepEqual(s.cards[blocker].negated, [], "but not marked for the game");
  s = play(s, { type: "attack", player: "p1", attacker: s.players.p1.leader, target: s.players.p2.leader });
  assert.equal(s.prompt.kind, "combo", "no [Blocker] to offer");
  s = play(s, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  assert.ok(has(ctx, s, blocker, "Blocker"), "back when the turn ends");

  // "Negate this skill for the turn" is the same idea for one skill.
  DEFS.SELFMUTET = { ...DEFS.V1, id: "SELFMUTET", name: "SELFMUTET", skill: "[Auto] When this card attacks, draw 1 card, then negate this skill for the turn." };
  const sc = compileSkill(parseSkills(DEFS.SELFMUTET.skill!)[0]);
  assert.deepEqual(sc.ops, [{ op: "draw", n: 1 }, { op: "negateOwnSkill", until: "turn" }]);
  let t = arena({ battle: ["SELFMUTET"] });
  const sm = t.players.p1.battle[0];
  const hand = t.players.p1.hand.length;
  t = play(t, { type: "attack", player: "p1", attacker: sm, target: t.players.p2.leader }, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  assert.equal(t.players.p1.hand.length, hand + 1);
  assert.ok(skillNegated(t, sm, 0), "off for the rest of the turn");
  assert.deepEqual(t.cards[sm].negated, []);
  t = play(t, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  assert.ok(!skillNegated(t, sm, 0), "and back next turn");
}

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);
  const auto = (text: string) => one(`[Auto] When you play this card, ${text}`);

  // "{r}/{u}": one orb of either colour, read as one of any colour.
  assert.deepEqual(orbsIn("{r}/{u}"), { any: 1 });
  assert.deepEqual(orbsIn("{r}/{u}{g}"), { any: 1, Green: 1 });
  const either = parseSkills("[Activate: Main]{r}/{u}: Draw 1 card.")[0];
  assert.deepEqual(either.energyCost, { any: 1 });
  assert.equal(either.effect, "Draw 1 card.");

  // A discard that ends in the Warp.
  assert.deepEqual(auto("your opponent sends 1 card from their hand to their Warp.").ops, [{ op: "discard", n: 1, side: "opponent", to: "warp" }]);
  // The opponent's deck, to their Drop.
  assert.deepEqual(auto("place the top card of your opponent's deck into its owner's Drop.").ops, [{ op: "mill", n: 1, side: "opponent" }]);
  // Placed, not played.
  const placed = auto("place up to 2 {Dragon Ball} from your Drop into the Battle Area.").ops;
  assert.deepEqual(placed.map((o) => o.op), ["choose", "moveTo"]);
  assert.equal((placed[0] as { sel: { area?: string } }).sel.area, "drop");
  assert.equal((placed[1] as { to: string }).to, "battle");
  // Shuffled in.
  assert.deepEqual(auto("choose 1 card in your Drop Area and shuffle it into your deck.").ops.map((o) => o.op), ["choose", "moveTo", "shuffle"]);
  // "isn't in play".
  const absent = auto("if {Demonic Invasion Majin Buu} isn't in play in your Battle Area, draw 1 card.").ops[0] as { op: string; cond: { kind: string; atMost?: number } };
  assert.equal(absent.op, "if");
  assert.equal(absent.cond.kind, "count");
  assert.equal(absent.cond.atMost, 0);
  // A duration on its own belongs to the clause after it.
  const lock = auto("choose 1 of your opponent's Battle Cards. Until the end of your opponent's turn, it can't attack.");
  assert.deepEqual(lock.unsupported, []);
  assert.equal((lock.ops[1] as { until?: string }).until, "nextTurn");
  // "If you don't" is the opposite of "if you do".
  const either2 = auto("you may choose 1 card in your hand and discard it. If you don't, your opponent draws 1 card.");
  assert.deepEqual(either2.unsupported, []);
  assert.equal(either2.ops[either2.ops.length - 1].op, "if");
  assert.equal(((either2.ops[either2.ops.length - 1] as { cond: { kind: string } }).cond).kind, "not");
  // Looking's housekeeping is not an effect.
  assert.deepEqual(auto("look at the top 3 cards of your deck, then put them back in any order.").ops.map((o) => o.op), ["look"]);
  // A card in the opponent's hand is a hand card.
  assert.equal((auto("choose up to 1 card in your opponent's hand and discard it.").ops[0] as { sel: { area?: string; side?: string } }).sel.area, "hand");

  // "When this card KOs an opponent's Battle Card": the KO'er is told, by battle and by skill.
  DEFS.HUNTER = { ...DEFS.V1, id: "HUNTER", name: "HUNTER", power: 20000, skill: "[Auto] When this card KOs an opponent's Battle Card, draw 1 card." };
  let s = arena({ battle: ["HUNTER"], oppBattle: ["V-BLUE"] });
  const prey = s.players.p2.battle[0];
  s.cards[prey].mode = "rest";
  const hand = s.players.p1.hand.length;
  s = play(s, { type: "attack", player: "p1", attacker: s.players.p1.battle[0], target: prey }, { type: "pass", player: "p1" }, { type: "pass", player: "p2" });
  assert.ok(s.players.p2.drop.includes(prey));
  assert.equal(s.players.p1.hand.length, hand + 1, "the KO by battle triggers it");
  assertConsistent(s);

  // "Switch the target of the attack to it" — a redirect from a skill.
  DEFS["E-DECOY"] = { ...DEFS["E-NEGATE"], id: "E-DECOY", name: "E-DECOY", skill: "[Counter: Attack] Choose 1 of your Battle Cards and switch the target of the attack to it." };
  assert.deepEqual(one(DEFS["E-DECOY"].skill!).ops.map((o) => o.op), ["choose", "redirectAttack"]);
  let r = arena({ oppHand: ["E-DECOY"], oppEnergy: ["V1"], oppBattle: ["BIG"] });
  const big = r.players.p2.battle[0];
  r = play(r, { type: "attack", player: "p1", attacker: r.players.p1.leader, target: r.players.p2.leader });
  assert.equal(r.prompt.kind, "counter", "the [Counter: Attack] window");
  const edecoy = find(r, "p2", "hand", "E-DECOY");
  r = play(r, { type: "counter", player: "p2", card: edecoy, skill: 0 });
  if (r.prompt.kind === "chooseCards") r = play(r, { type: "choose", player: "p2", cards: [big] });
  assert.equal(r.battle?.guard, big, "the attack now goes at BIG");
}

{
  // A selector resolves to every card it matches, so a move whose target has
  // a number in it has to be a choice first — "add 1 card from your Drop to
  // your hand" used to add the whole Drop.
  const sc = compileSkill(parseSkills("[Auto] When you play this card, add 1 card from your Drop to your hand.")[0]);
  assert.deepEqual(sc.ops.map((o) => o.op), ["choose", "moveTo"]);
  // A bare plural still means all of them.
  assert.deepEqual(compileSkill(parseSkills("[Auto] When you play this card, return your opponent's Battle Cards to their owners' hands.")[0]).ops.map((o) => o.op), ["moveTo"]);

  DEFS.FETCH = { ...DEFS.V1, id: "FETCH", name: "FETCH", energyCost: 1, skill: "[Auto] When you play this card, add 1 card from your Drop to your hand." };
  let s = arena({ hand: ["FETCH"], energy: ["V1"] });
  const [d1, d2] = s.players.p1.deck;
  move({ defs: DEFS }, s, [], d1, "drop", "p1");
  move({ defs: DEFS }, s, [], d2, "drop", "p1");
  const hand = s.players.p1.hand.length;
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "FETCH") });
  assert.equal(s.prompt.kind, "chooseCards", "which one is the player's to say");
  s = play(s, { type: "choose", player: "p1", cards: [d2] });
  assert.equal(s.players.p1.hand.length, hand, "one card in, one card played out");
  assert.ok(s.players.p1.hand.includes(d2));
  assert.ok(s.players.p1.drop.includes(d1), "the other stays");
  assertConsistent(s);
}

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);
  const ops = (text: string) => one(text).ops.map((o) => o.op);

  // A trigger split on its "and" is still the trigger; a condition riding on it wraps the effect.
  const kos = one("[Auto][Once per turn] When this card attacks and KOs an opponent's Battle Card, your opponent chooses 1 card in their hand and discards it.");
  assert.deepEqual(kos.unsupported, []);
  assert.deepEqual(kos.ops.map((o) => o.op), ["discard"]);
  const riding = one("[Auto] When you play this card from your hand and your Leader Card is a ≪Universe 6≫ card, draw 1 card.");
  assert.deepEqual(riding.unsupported, []);
  assert.equal(riding.ops[0].op, "if");
  assert.equal((riding.ops[0] as { cond: { kind: string } }).cond.kind, "leaderMatches");
  // "attacks and KOs" fires on the KO, not on the attack.
  const sk = parseSkills("[Auto] When this card attacks and KOs an opponent's Battle Card, draw 1 card.")[0];
  assert.ok(!autoTriggerMatches(sk, "attacks"));
  assert.ok(autoTriggerMatches(sk, "kos"));

  // Names joined by "and" are one phrase.
  assert.deepEqual(splitClauses("When your opponent plays a red Battle Card with both <Son Goku> and <Piccolo>, play this card."), ["When your opponent plays a red Battle Card with both <Son Goku> and <Piccolo>", "play this card"]);

  // Under a named host, from an area.
  const under = one("[Auto] When you play this card, place up to 1 yellow ≪Frieza Clan≫ card from your Drop under {Wickedest Clan} in your Battle Area.");
  assert.deepEqual(under.unsupported, []);
  assert.deepEqual(under.ops.map((o) => o.op), ["choose", "moveTo"]);
  assert.equal((under.ops[1] as { to: string }).to, "under");

  // A combo from the Drop.
  const cf = one("[Activate: Battle] Use up to 1 green card with 5000 combo power from your Drop in a combo with its skills negated for the battle.");
  assert.deepEqual(cf.unsupported, []);
  assert.deepEqual(cf.ops.map((o) => o.op), ["choose", "comboFrom"]);
  assert.equal((cf.ops[1] as { negated?: boolean }).negated, true);
  assert.deepEqual(ops("[Activate: Battle] Use this card from your Drop in a combo."), ["comboFrom"]);
  DEFS.GRAVE = { ...DEFS["E-DRAW"], id: "GRAVE", name: "GRAVE", skill: "[Activate: Battle] Use up to 1 card with 5000 combo power from your Drop in a combo with its skills negated for the battle." };
  let s = arena({ hand: ["GRAVE"], energy: ["V1"], battle: ["BLOCKER"] });
  const dropped = s.players.p1.deck[0];
  move({ defs: DEFS }, s, [], dropped, "drop", "p1");
  s = play(s, { type: "attack", player: "p1", attacker: s.players.p1.leader, target: s.players.p2.leader });
  assert.equal(s.prompt.kind, "combo");
  const grave = find(s, "p1", "hand", "GRAVE");
  assert.ok(acts(s).some((a) => a.type === "activate" && a.card === grave), "[Activate: Battle] from hand during the combo step");
  s = play(s, { type: "activate", player: "p1", card: grave, skill: 0 });
  if (s.prompt.kind === "chooseCards") s = play(s, { type: "choose", player: "p1", cards: [dropped] });
  assert.ok(s.players.p1.combo.includes(dropped), "5-7: in the Combo Area");
  assert.equal(s.cards[dropped].negated, "all", "with its skills negated");
  assert.equal(s.prompt.kind, "combo");
  assertConsistent(s);

  // Odds and ends from the same list.
  assert.deepEqual(ops("[Auto] When you play this card, choose 1 of your opponent's Battle Cards and negate it for the duration of the turn."), ["choose", "negateSkills"]);
  assert.deepEqual(ops("[Counter: Attack] Negate that attack."), ["negateAttack"]);
  assert.equal(parseSkills("[Auto][em][/em] When you play this card, draw 1 card.")[0].kind, "auto");
  const negatedLeader = one("[Counter: Attack] Negate the attack. If you negated a Leader Card's attack with this skill, draw 1 card.");
  assert.deepEqual(negatedLeader.unsupported, []);
  assert.deepEqual((negatedLeader.ops[1] as { cond: unknown }).cond, { kind: "did", what: "negateLeaderAttack" });
  const played = one("[Auto] At the start of your opponent's Main Phase, play up to 1 red card with an energy cost of 3 or less from under this card, and place this card under the played card.");
  assert.deepEqual(played.unsupported, []);
  // The flip is read as done, so what follows "if you do" simply follows.
  assert.deepEqual(ops("[Auto] When one of your yellow Battle Cards is switched to Rest Mode by a skill, you may flip this card over. If you do, draw 1 card."), ["flip", "draw"]);
  // On an [Awaken] the flip is the engine's, not an effect.
  assert.deepEqual(ops("[Awaken] When your life is at 4 or less: Draw 1 card and flip this card over."), ["draw"]);
}

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);
  assert.deepEqual(one("[Auto] When you play this card, draw cards until you have 4 cards in your hand.").ops, [{ op: "draw", n: { handUpTo: 4 } }]);
  assert.deepEqual(one("[Auto] When you play this card, place 2 cards from the top of your opponent's deck in their Drop Area.").ops, [{ op: "mill", n: 2, side: "opponent" }]);
  const marked = one("[Auto] When you play this card, choose 1 of your Battle Cards. Add a marker to the chosen card.");
  assert.deepEqual(marked.unsupported, []);
  assert.deepEqual(marked.ops[1], { op: "addMarker", target: { var: "c0" }, n: 1 });
  const kod = one("[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards with 10000 power or less and KO it. If you KO'd a card, draw 1 card.");
  assert.deepEqual(kod.unsupported, []);
  assert.deepEqual((kod.ops[kod.ops.length - 1] as { cond: unknown }).cond, { kind: "did", what: "ko" });
  assert.ok(autoTriggerMatches(parseSkills("[Auto] When you Combo with this card, draw 1 card.")[0], "comboed"));

  assert.deepEqual(one("[Awaken] If you have 5 or more ≪Saiyan≫ cards in your Warp: Draw 2 cards and add card from your life to you hand until you have 6 life left.").ops, [{ op: "draw", n: 2 }, { op: "lifeDownTo", n: 6 }]);
  const under = one("[Activate: Main] Choose up to 1 <Majin Buu> card from your Energy Area and play it. If you played a card, choose up to 1 Battle Card in your Drop Area and place it under the card you played with this skill.");
  assert.deepEqual(under.unsupported, []);
  const noDraw = one("[Auto] When this card attacks, look at the top card of your deck, and if it's a red card, add it to your hand. If you did not draw a card with this skill, this card gets +5000 power for the battle.");
  assert.ok(noDraw.unsupported.length <= 1, "only the look-and-add may still be a gap here");

  // "Draw until you have 4" draws what is missing, and nothing when there is nothing missing.
  DEFS.REFILL = { ...DEFS.V1, id: "REFILL", name: "REFILL", energyCost: 1, skill: "[Auto] When you play this card, draw cards until you have 4 cards in your hand." };
  let s = arena({ hand: ["REFILL"], energy: ["V1"] });
  for (const id of s.players.p1.hand.slice()) if (s.cards[id].cardId !== "REFILL") move({ defs: DEFS }, s, [], id, "deck", "p1", { position: "bottom" });
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "REFILL") });
  assert.equal(s.players.p1.hand.length, 4);
}

// ── searching a secret area (20-12), and the rest of what was looked at ────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);

  // "with an energy cost of 3 and 5000 power": the "and" joins two measures of
  // one card description, and splitting on it left both halves unreadable.
  const search = one("[Auto] When you play this card, add up to 1 yellow <Son Goku> card with an energy cost of 3 and 5000 power from your deck to your hand, then shuffle your deck.");
  assert.deepEqual(search.unsupported, []);
  assert.deepEqual(search.ops.map((o) => o.op), ["choose", "moveTo", "shuffle"]);
  const found = (search.ops[0] as { sel: { area?: string; filter?: { costMin: number | null; powerMin: number | null } } }).sel;
  assert.equal(found.area, "deck");
  assert.equal(found.filter?.costMin, 3, "the cost is read");
  assert.equal(found.filter?.powerMin, 5000, "and so is the power behind the 'and'");

  // The set prints the two measures in either order.
  const other = one("[Auto] When you play this card, add up to 1 card with 5000 power and an energy cost of 2 or less from your deck to your hand.");
  assert.deepEqual(other.unsupported, []);
  assert.equal((other.ops[0] as { sel: { filter?: { costMax: number | null; powerMax: number | null } } }).sel.filter?.costMax, 2);

  // "for each" still reads a bare power as a measure of the *target*, not of
  // the bonus: "+5000 power" must not become a filter.
  const buff = one("[Auto] When you play this card, choose 1 of your Battle Cards and it gets +5000 power for the turn.");
  assert.deepEqual(buff.unsupported, []);
  assert.equal((buff.ops[0] as { sel: { filter?: unknown } }).sel.filter, undefined, "the bonus is not a bound on the choice");

  // "Among them" names its own target and only says where to look for it.
  // Read as an "it" this became *this card*, which was silently wrong.
  const dig = one("[Auto] When you play this card, look at the top 3 cards of your deck, add up to 1 <Son Goku> card among them to your hand, and place the rest at the bottom of your deck in any order.");
  assert.deepEqual(dig.unsupported, []);
  assert.deepEqual(dig.ops.map((o) => o.op), ["look", "choose", "moveTo", "moveTo"]);
  assert.equal((dig.ops[1] as { sel: { fromVar?: string } }).sel.fromVar, "looked");
  // "The rest" is what the choice did not take, so the card added to the hand
  // is not put back at the bottom of the deck.
  assert.deepEqual((dig.ops[3] as { target: unknown }).target, { var: "looked", minus: "c0" });

  // A Z-card is the only thing said about the host, so it has to count as a
  // narrowing — without it the phrase named no area and the clause failed.
  const host = one("[Auto] When you play this card, place up to 1 red <Android 17> card from your deck under a Z-Extra in your Battle Area, then shuffle your deck.");
  assert.deepEqual(host.unsupported, []);
  assert.deepEqual(host.ops.map((o) => o.op), ["choose", "moveTo", "shuffle"]);

  // "Up to the number of cards in your Battle Area" — read off the board.
  const many = one("[Activate: Main] Look at cards from the top of your deck up to the number of cards in your Battle Area.");
  assert.deepEqual(many.unsupported, []);
  assert.equal((many.ops[0] as { n: { count?: { area?: string } } }).n.count?.area, "battle");
}

{
  // The engine side: a search offers exactly the cards that match, and the
  // rest of the look goes back to the bottom of the deck (20-12-3).
  DEFS.DIGGER = {
    ...DEFS.V1,
    id: "DIGGER",
    name: "DIGGER",
    energyCost: 1,
    skill: "[Auto] When you play this card, look at the top 3 cards of your deck, add up to 1 card among them to your hand, and place the rest at the bottom of your deck in any order.",
  };
  let s = arena({ hand: ["DIGGER"], energy: ["V1"] });
  const [t1, t2, t3] = s.players.p1.deck;
  const deckSize = s.players.p1.deck.length;
  const hand = s.players.p1.hand.length;
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "DIGGER") });
  assert.equal(s.prompt.kind, "chooseCards", "the player picks out of what was looked at");
  s = play(s, { type: "choose", player: "p1", cards: [t2] });
  assert.ok(s.players.p1.hand.includes(t2), "the chosen card is in hand");
  assert.equal(s.players.p1.hand.length, hand, "one in, one played out");
  assert.equal(s.players.p1.deck.length, deckSize - 1, "only the chosen card left the deck");
  assert.deepEqual(s.players.p1.deck.slice(-2), [t1, t3], "and they went to the bottom, not to the hand");
  assertConsistent(s);
}

// ── energy as an effect (3-8), and reading what a card turned up (20-11) ────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);

  // "The top card of your deck" is a position, not a choice — reading it as
  // one handed the player their whole deck to pick from (20-12).
  const top = one("[Auto] When you play this card, place the top card of your deck in your energy in Rest Mode.");
  assert.deepEqual(top.unsupported, []);
  assert.deepEqual(top.ops.map((o) => o.op), ["moveTo"], "no choice: the deck is not searched");
  assert.equal((top.ops[0] as { target: { sel?: { take?: number } } }).target.sel?.take, 1);

  // A number in the phrase is still a choice, and `switchMode` had never been
  // wrapped in one — "up to 1 of your energy" switched all of it.
  const sw = one("[Activate: Main] Draw 1 card, switch up to 1 of your energy to Active Mode, and add up to 1 card from your hand to your energy.");
  assert.deepEqual(sw.unsupported, []);
  assert.deepEqual(sw.ops.map((o) => o.op), ["draw", "choose", "switchMode", "choose", "moveTo"]);

  // Whose energy area, which is not always the card's owner (3-8).
  const gift = one("[Auto] When you play this card, reveal the top card of your opponent's deck. If that card is a Battle Card, place it in your opponent's energy in Rest Mode, otherwise draw 1 card.");
  assert.deepEqual(gift.unsupported, []);
  assert.deepEqual(gift.ops.map((o) => o.op), ["reveal", "if", "if"]);
  const then = (gift.ops[1] as { then: { op: string; owner?: string; mode?: string }[] }).then[0];
  assert.equal(then.owner, "opponent", "into their energy, not its owner's");
  assert.equal(then.mode, "rest");
  // "Otherwise" is the opposite of the condition just asked.
  assert.equal((gift.ops[2] as { cond: { kind: string } }).cond.kind, "not");
  assert.deepEqual((gift.ops[2] as { then: { op: string }[] }).then.map((o) => o.op), ["draw"]);

  // Looking at a hand is a whole area, not an end of a deck.
  assert.deepEqual(one("[Activate: Main] Look at your opponent's hand.").ops, [{ op: "look", n: 99, as: "looked", side: "opponent", area: "hand" }]);
}

{
  // The engine side of a reveal: the card is named in the log, stays where it
  // was, and the clause after it acts on what was turned up.
  DEFS.PEEP = {
    ...DEFS.V1,
    id: "PEEP",
    name: "PEEP",
    energyCost: 1,
    skill: "[Auto] When you play this card, reveal the top card of your opponent's deck. If that card is a Battle Card, place it in your opponent's energy in Rest Mode, otherwise draw 1 card.",
  };
  let s = arena({ hand: ["PEEP"], energy: ["V1"] });
  const top = s.players.p2.deck[0];
  const energy = s.players.p2.energy.length;
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "PEEP") });
  // Every card the arena's synthetic decks hold is a Battle Card, so the
  // "then" branch is the one that runs.
  assert.ok(s.players.p2.energy.includes(top), "it went into *their* energy");
  assert.equal(s.players.p2.energy.length, energy + 1);
  assert.equal(s.cards[top].mode, "rest", "and in Rest Mode");
  assert.equal(s.cards[top].owner, "p2");
  assertConsistent(s);
}

// ── three more things a card can forbid (20-14) ────────────────────────────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);

  // "Can't be removed from a Battle Area by your opponent's skills" is not the
  // same rule as "can't be KO'd": a move by a skill, and nothing else.
  const stay = one("[Permanent] Your green non-<Bulma> ≪Adventure≫ cards can't be removed from a Battle Area by your opponent's skills.");
  assert.deepEqual(stay.unsupported, []);
  assert.equal((stay.ops[0] as { what: string; side?: string }).what, "beMovedBySkill");
  assert.equal((stay.ops[0] as { side?: string }).side, "opponent");

  const keep = one("[Permanent] This card's skills can't be negated in any area.");
  assert.deepEqual(keep.unsupported, []);
  assert.deepEqual(keep.ops, [{ op: "forbid", what: "beNegated", until: "game", target: { sel: { special: "self" } } }]);

  const noCharge = one("[Auto] When you play this card, you can't place cards in your energy for the turn.");
  assert.deepEqual(noCharge.unsupported, []);
  assert.deepEqual(noCharge.ops, [{ op: "forbid", what: "placeEnergy", side: "you", until: "turn" }]);

  // The same rule printed as "will not" rather than "can't", and a duration
  // that has to outlive "your next turn" by one step (7-2-7).
  const lock = one("[Activate: Main] Choose 1 of your opponent's Battle Cards and switch it to Rest Mode. The chosen card will not switch to Active Mode during your next Charge Phase.");
  assert.deepEqual(lock.unsupported, []);
  assert.deepEqual(lock.ops.map((o) => o.op), ["choose", "switchMode", "forbid"]);
  assert.equal((lock.ops[2] as { until: string }).until, "afterNextCharge");

  // A [Counter: Play] asking about the card it is answering (9-6).
  const gate = parseConditionClause("if the Battle Card being played has an energy cost of 7 or less");
  assert.ok(gate, "the condition is readable even though negating a play is not");
  assert.equal((gate.cond as { sel: { special?: string; filter?: { costMax: number | null } } }).sel.special, "resolving");
  assert.equal((gate.cond as { sel: { filter?: { costMax: number | null } } }).sel.filter?.costMax, 7);

  // "If the chosen card is a <X> card" — the same reading as "that card", over
  // the choice rather than over a reveal.
  const check = one("[Auto] When you play this card, choose 1 card in your Drop Area. If the chosen card is a <Supreme Kai of Time> card, draw 1 card.");
  assert.deepEqual(check.unsupported, []);
  assert.deepEqual((check.ops[1] as { cond: { kind: string; var: string } }).cond.var, "c0");
}

{
  // A rest-lock has to survive the opponent's whole turn *and* the Active Step
  // of the next one, which is where a "nextTurn" effect would already be gone.
  DEFS.LOCKER = {
    ...DEFS.V1,
    id: "LOCKER",
    name: "LOCKER",
    energyCost: 1,
    skill: "[Auto] When you play this card, choose 1 of your opponent's Battle Cards and switch it to Rest Mode. The chosen card will not switch to Active Mode during your next Charge Phase.",
  };
  let s = arena({ hand: ["LOCKER"], energy: ["V1"], oppBattle: ["V-BLUE"] });
  const victim = s.players.p2.battle[0];
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "LOCKER") });
  if (s.prompt.kind === "chooseCards") s = play(s, { type: "choose", player: "p1", cards: [victim] });
  assert.equal(s.cards[victim].mode, "rest", "it was switched to Rest Mode");
  // Their turn: their Active Step runs and must leave it rested.
  s = play(s, { type: "endMain", player: "p1" });
  assert.equal(s.cards[victim].mode, "rest", "7-2-7 did not switch it back");
  assert.ok(!s.effects.some((e) => e.until === "afterNextCharge"), "and the rule is spent");
  assertConsistent(s);
}

{
  // A card whose skills can't be negated keeps them, and keeps its keywords.
  DEFS.STUBBORN = { ...DEFS.BLOCKER, id: "STUBBORN", name: "STUBBORN", skill: "[Blocker]<br>[Permanent] This card's skills can't be negated in any area." };
  DEFS.SILENCER = { ...DEFS.V1, id: "SILENCER", name: "SILENCER", energyCost: 1, skill: "[Auto] When you play this card, choose 1 of your opponent's Battle Cards and negate its skills for the turn." };
  let s = arena({ hand: ["SILENCER"], energy: ["V1"], oppBattle: ["STUBBORN"] });
  const stubborn = s.players.p2.battle[0];
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "SILENCER") });
  if (s.prompt.kind === "chooseCards") s = play(s, { type: "choose", player: "p1", cards: [stubborn] });
  assert.ok(!skillsNegated(s, stubborn), "0-2-5: the prohibition beats the instruction");
  assertConsistent(s);
}

{
  // "You can't place cards in your energy for the turn" is a rule about a
  // player, and the Charge Phase is the one place it bites.
  DEFS.DROUGHT = { ...DEFS.V1, id: "DROUGHT", name: "DROUGHT", energyCost: 1, skill: "[Permanent] Your opponent can't place cards in their energy." };
  let s = arena({ hand: ["DROUGHT"], energy: ["V1"] });
  assert.ok(!forbids({ defs: DEFS }, s, "placeEnergy", { player: "p2" }), "nothing forbids it yet");
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "DROUGHT") });
  assert.ok(forbids({ defs: DEFS }, s, "placeEnergy", { player: "p2" }), "the [Permanent] holds while the card is in play");
  assert.ok(!forbids({ defs: DEFS }, s, "placeEnergy", { player: "p1" }), "and only against them");
  // Their Charge Phase then offers nothing to charge.
  s = play(s, { type: "endMain", player: "p1" });
  assert.equal(s.prompt.kind, "charge", "it is their Charge Phase");
  assert.deepEqual(labels(s), ["Skip charge"], "and there is nothing to do in it");
}

// ── counting the cards under a card (23-2), and the type words ─────────────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);
  const countOf = (sc: { ops: unknown[] }) => (sc.ops[0] as { amount: { count: { area?: string; special?: string; filter?: { notType: string | null } } } }).amount.count;

  // "For each card placed under it" is about the stack. The phrase used to be
  // taken for "this card" and counted one, whatever the stack held.
  const stack = one("[Permanent] This card gets +5000 power for each card placed under it.");
  assert.deepEqual(stack.unsupported, []);
  assert.equal(countOf(stack).area, "under");
  assert.equal(countOf(stack).special, undefined, "not the card on top");

  // "Non-Leader" is the type it must *not* be — read as the type itself, the
  // filter counted Leaders and nothing else.
  const nonLeader = one("[Permanent] This card gets +5000 power for each non-Leader card under this card.");
  assert.deepEqual(nonLeader.unsupported, []);
  assert.equal(countOf(nonLeader).filter?.notType, "LEADER");
  assert.equal(matches({ ...DEFS.V1 }, parseFilter("non-Leader card")), true, "a Battle Card is a non-Leader card");
  assert.equal(matches({ ...DEFS.V1, type: "LEADER" }, parseFilter("non-Leader card")), false);

  // "Multicolor" is two colours or more, which is not what mono-colour denies.
  assert.equal(matches({ ...DEFS.V1, colors: ["Red", "Blue"] }, parseFilter("multicolor <V1> cards")), true);
  assert.equal(matches({ ...DEFS.V1, colors: ["Red"] }, parseFilter("multicolor <V1> cards")), false);
}

{
  // The engine side: the power really does follow the size of the stack.
  DEFS.PILE = { ...DEFS.V1, id: "PILE", name: "PILE", skill: "[Permanent] This card gets +5000 power for each card placed under it." };
  const s = arena({ battle: ["PILE"] });
  const pile = s.players.p1.battle[0];
  const base = powerOf({ defs: DEFS }, s, pile);
  const [a, b] = s.players.p1.deck;
  s.cards[pile].under.push(a, b);
  s.players.p1.deck = s.players.p1.deck.filter((id) => id !== a && id !== b);
  assert.equal(powerOf({ defs: DEFS }, s, pile), base + 10000, "two cards under it, +10000");
}

// ── what a replacement replaces (9-10) ─────────────────────────────────────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);

  // "Instead" is the word every replacement ends on, and it broke the anchor
  // of every move pattern but one: the same sentence without it compiled.
  const warp = one("[Permanent] If this card would be KO'd, send it to the Warp instead.");
  assert.deepEqual(warp.unsupported, []);
  assert.deepEqual(warp.ops, [{ op: "replaceLeave", to: "warp", target: { sel: { special: "self" } }, by: "ko" }]);

  // "Would be KO'd" replaces the KO and nothing else; "would leave the Battle
  // Area" replaces every departure, so it carries no cause at all.
  assert.equal((one("[Permanent] If this card would leave the Battle Area, return it to its owner's hand instead.").ops[0] as { by?: string }).by, undefined);
  assert.equal((one("[Permanent] If this card would be removed from the Battle Area by a skill, send it to the Warp instead.").ops[0] as { by?: string }).by, "skill");

  // BT30-016: other cards by filter, both causes, and the mode it arrives in.
  const earthling = one("[Permanent] If your blue ≪Earthling≫ card would be removed from a Battle Area by a skill or KO'd, add that card to your energy in Rest Mode instead.");
  assert.deepEqual(earthling.unsupported, []);
  const rep = earthling.ops[0] as { to: string; by?: string; mode?: string; target: { sel: { filter?: { traits: string[] } } } };
  assert.equal(rep.to, "energy");
  assert.equal(rep.by, "skillOrKo");
  assert.equal(rep.mode, "rest", "the replacement says how it arrives as well as where");
  assert.deepEqual(rep.target.sel.filter?.traits, ["earthling"], "and which cards it is about");
}

{
  // The engine side. A KO-only replacement sends the card to the Warp…
  DEFS.PHOENIX = { ...DEFS.V1, id: "PHOENIX", name: "PHOENIX", skill: "[Permanent] If this card would be KO'd, send it to the Warp instead." };
  const s = arena({ battle: ["PHOENIX"], oppBattle: ["BIG"] });
  const bird = s.players.p1.battle[0];
  koCard({ defs: DEFS }, s, [], bird);
  assert.ok(s.players.p1.warp.includes(bird), "9-10: it went to the Warp, not the Drop");
  assert.ok(!s.players.p1.drop.includes(bird));
  assertConsistent(s);

  // …and leaves an ordinary skill-move alone, which is what `by` is for.
  const t = arena({ battle: ["PHOENIX"] });
  const bird2 = t.players.p1.battle[0];
  move({ defs: DEFS }, t, [], bird2, "hand", "p1", { reason: "effect" });
  assert.ok(t.players.p1.hand.includes(bird2), "a return to hand is not a KO");
  assertConsistent(t);
}

{
  // A replacement that covers *other* cards by filter, and says the mode.
  DEFS.WARDEN = {
    ...DEFS.V1,
    id: "WARDEN",
    name: "WARDEN",
    skill: "[Permanent] If your ≪Earthling≫ card would be removed from a Battle Area by a skill or KO'd, add that card to your energy in Rest Mode instead.",
  };
  DEFS.PEASANT = { ...DEFS.V1, id: "PEASANT", name: "PEASANT", traits: ["Earthling"] };
  const s = arena({ battle: ["WARDEN", "PEASANT", "BIG"] });
  const peasant = s.players.p1.battle.find((id) => s.cards[id].cardId === "PEASANT")!;
  const big = s.players.p1.battle.find((id) => s.cards[id].cardId === "BIG")!;
  const energy = s.players.p1.energy.length;
  koCard({ defs: DEFS }, s, [], peasant);
  assert.ok(s.players.p1.energy.includes(peasant), "the ≪Earthling≫ card went to the energy");
  assert.equal(s.players.p1.energy.length, energy + 1);
  assert.equal(s.cards[peasant].mode, "rest", "and in Rest Mode, as printed");
  // A card the filter does not name still goes to the Drop.
  koCard({ defs: DEFS }, s, [], big);
  assert.ok(s.players.p1.drop.includes(big), "9-10 only replaces what the skill names");
  assertConsistent(s);
}

// ── what a cost reduction is about, and how much (20-21) ───────────────────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);
  const sel = (sc: { ops: unknown[] }) => (sc.ops[0] as { target: { sel?: { area?: string } } }).target.sel;

  // The area the text names is part of the target. It used to be stripped out
  // of the phrase, so a reducer for cards "in your hand" selected cards in
  // play — it compiled, and then did nothing at all.
  const hand = one("[Permanent] Reduce the energy cost of your <Son Goku> cards in your hand by 1.");
  assert.deepEqual(hand.unsupported, []);
  assert.equal(sel(hand)?.area, "hand");

  // A phrase that names no area is about the card you are about to play, not
  // about a card on the table — 20-1-6's default is the one place a cost
  // reduction can never matter.
  const named = one("[Permanent] Reduce the energy cost of a {Power Pole} by {r}.");
  assert.deepEqual(named.unsupported, []);
  assert.equal(sel(named)?.area, "hand");
  assert.equal((named.ops[0] as { amount: number }).amount, 1, "an orb is one less");

  // "For each …" is the same count amount the power statics take.
  const each = one("[Permanent] Reduce the energy cost of this card in your hand by 1 for each of your blue Battle Cards.");
  assert.deepEqual(each.unsupported, []);
  assert.equal((each.ops[0] as { amount: { count?: { area?: string } } }).amount.count?.area, "battle");
}

{
  // The engine side: the reduction is real, it follows the board, and it
  // reaches a card in hand — which is the only place it could ever apply.
  DEFS.CHEAP = { ...DEFS.V1, id: "CHEAP", name: "CHEAP", energyCost: 4 };
  DEFS.DISCOUNT = { ...DEFS.V1, id: "DISCOUNT", name: "DISCOUNT", skill: "[Permanent] Reduce the energy cost of your <CHEAP> cards in your hand by 1 for each of your blue Battle Cards." };
  DEFS.CHEAP.characters = ["CHEAP"];
  const s = arena({ hand: ["CHEAP"], battle: ["DISCOUNT"] });
  const cheap = find(s, "p1", "hand", "CHEAP");
  assert.equal(playCost({ defs: DEFS }, s, cheap).total, 4, "no blue Battle Cards yet");
  // One blue Battle Card on the board takes one off.
  const blue = s.players.p1.deck.find((id) => s.cards[id].cardId === "V-BLUE") ?? s.players.p1.deck[0];
  move({ defs: DEFS }, s, [], blue, "battle", "p1");
  s.cards[blue].cardId = "V-BLUE";
  assert.equal(playCost({ defs: DEFS }, s, cheap).total, 3, "20-21: one blue Battle Card, one less");
}

// ── negating one kind of skill, not all of them (9-1-5) ────────────────────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);

  const auto = one("[Counter: Attack] Choose 1 of your opponent's Battle Cards and negate that card's [Auto] skill for the duration of turn.");
  assert.deepEqual(auto.unsupported, []);
  assert.deepEqual(auto.ops[1], { op: "negateSkillsOfKind", target: { var: "c0" }, kind: "auto", until: "turn" });

  // A printed "[Counter]" covers every counter kind, so the stored value is a
  // prefix. And the tag must be read *before* the bare "negate … skills"
  // pattern, whose subject would otherwise swallow it and silence the card.
  assert.equal((one("[Auto] When you play this card, choose 1 of your opponent's Battle Cards and negate that card's [Counter] skills for the turn.").ops[1] as { op: string; kind?: string }).kind, "counter");
  assert.equal((one("[Auto] When you play this card, choose 1 of your opponent's Battle Cards and negate that card's skills for the turn.").ops[1] as { op: string }).op, "negateSkills", "a bare 'skills' still silences everything");

  // "Negate this skill for the battle" — the third duration, which had to be
  // an effect rather than a mark, because the skill comes back.
  const once = one("[Auto] When this card attacks, this card gets +5000 power for the battle. Negate this skill for the battle.");
  assert.deepEqual(once.unsupported, []);
  assert.deepEqual(once.ops[1], { op: "negateOwnSkill", until: "battle" });
}

{
  // The engine side: an [Auto] is silenced and an [Activate] on the same card
  // is not, which is the whole point of naming a kind.
  DEFS.TWOSKILL = {
    ...DEFS.V1,
    id: "TWOSKILL",
    name: "TWOSKILL",
    skill: "[Auto] When this card attacks, draw 1 card.<br>[Activate: Main] Draw 1 card.",
  };
  DEFS.HUSH = {
    ...DEFS.V1,
    id: "HUSH",
    name: "HUSH",
    energyCost: 1,
    skill: "[Auto] When you play this card, choose 1 of your opponent's Battle Cards and negate that card's [Auto] skill for the turn.",
  };
  let s = arena({ hand: ["HUSH"], energy: ["V1"], oppBattle: ["TWOSKILL"] });
  const quiet = s.players.p2.battle[0];
  const skills = parseSkills(DEFS.TWOSKILL.skill!);
  assert.equal(skills.length, 2, "the card really does have two skills of different kinds");
  s = play(s, { type: "play", player: "p1", card: find(s, "p1", "hand", "HUSH") });
  if (s.prompt.kind === "chooseCards") s = play(s, { type: "choose", player: "p1", cards: [quiet] });
  assert.ok(skillNegated(s, quiet, skills[0].index, skills[0].kind), "the [Auto] is negated");
  assert.ok(!skillNegated(s, quiet, skills[1].index, skills[1].kind), "the [Activate: Main] is not");
  assert.ok(!skillsNegated(s, quiet), "and the card is not silenced");
  assertConsistent(s);
}

// ── what a [Counter: Play] does to the card it answers (9-6) ───────────────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);

  const stop = one("[Counter: Play] Choose 1 Battle Card with an energy cost of 2 or less being played by your opponent. It is placed in its owner's Drop Area instead of being played.");
  assert.deepEqual(stop.unsupported, []);
  // "Being played" names the card the counter is answering — there is only
  // ever one — so it is not a choice among the cards already in play.
  assert.equal((stop.ops[0] as { sel: { special?: string } }).sel.special, "resolving");
  assert.deepEqual(stop.ops[1], { op: "resolvingPlay", instead: "drop" });

  const deck = one("[Counter: Play] If the Battle Card being played has an energy cost of 7 or less, it's placed at the bottom of its owner's deck instead of being played.");
  assert.deepEqual(deck.unsupported, []);
  assert.deepEqual((deck.ops[0] as { then: unknown[] }).then, [{ op: "resolvingPlay", instead: "deck", position: "bottom" }]);

  // Without "instead of being played" the play happens; only the manner changes.
  assert.deepEqual(one("[Counter: Play] The Battle Card being played is played in Rest Mode.").ops, [{ op: "resolvingPlay", mode: "rest" }]);
  assert.deepEqual(one("[Counter: Play] It's played with its skills negated for the turn.").ops, [{ op: "resolvingPlay", negated: true }]);
}

{
  // The engine side: the card never reaches the Battle Area, and the energy
  // stays paid — negating a play does not undo the cost (9-6).
  DEFS["E-STOP"] = { ...DEFS["E-NEGATE"], id: "E-STOP", name: "E-STOP", skill: "[Counter: Play] The Battle Card being played is placed in its owner's Drop Area instead of being played." };
  let s = arena({ hand: ["V1"], energy: ["V1", "V1"], oppHand: ["E-STOP"], oppEnergy: ["V1"] });
  const played = find(s, "p1", "hand", "V1");
  const battle = s.players.p1.battle.length;
  s = play(s, { type: "play", player: "p1", card: played });
  assert.equal(s.prompt.kind, "counter", "the [Counter: Play] window");
  s = play(s, { type: "counter", player: "p2", card: find(s, "p2", "hand", "E-STOP"), skill: 0 });
  while (s.prompt.kind === "chooseCards") s = play(s, { type: "choose", player: "p1", cards: [] });
  assert.ok(s.players.p1.drop.includes(played), "it went to the Drop");
  assert.equal(s.players.p1.battle.length, battle, "and never reached the Battle Area");
  assert.equal(s.players.p1.energy.filter((id) => s.cards[id].mode === "rest").length, 1, "the energy stays paid");
  assertConsistent(s);
}

{
  // "Played in Rest Mode" and "played with its skills negated" let the play
  // happen — the two continuations `resolvePlay` reads and nothing ever wrote.
  DEFS["E-TIRE"] = { ...DEFS["E-NEGATE"], id: "E-TIRE", name: "E-TIRE", skill: "[Counter: Play] The Battle Card being played is played in Rest Mode." };
  let s = arena({ hand: ["V1"], energy: ["V1", "V1"], oppHand: ["E-TIRE"], oppEnergy: ["V1"] });
  const played = find(s, "p1", "hand", "V1");
  s = play(s, { type: "play", player: "p1", card: played });
  s = play(s, { type: "counter", player: "p2", card: find(s, "p2", "hand", "E-TIRE"), skill: 0 });
  assert.ok(s.players.p1.battle.includes(played), "the play still happened");
  assert.equal(s.cards[played].mode, "rest", "but the card arrived rested");
  assertConsistent(s);
}

// ── three ways a sentence was being cut in the wrong place ─────────────────

{
  const one = (text: string) => compileSkill(parseSkills(text)[0]);

  // The full-width hyphen-minus after "choose one". Left out of the dash
  // class it survived into the options list as an option of its own — which
  // is where the six bare "－" clauses in the gap report came from.
  const modal = one("[Auto] When this card is played from your hand, choose one－<br>・Choose up to 1 of your opponent's Battle Cards and place it at the bottom of its owner's deck.<br>・If your Leader Card is a green <Son Goku> card, draw 1 card.");
  assert.deepEqual(modal.unsupported, []);
  const modes = (modal.ops.find((o) => o.op === "chooseMode") as { modes: { label: string; ops: unknown[] }[] } | undefined)?.modes;
  assert.equal(modes?.length, 2, "two printed options, and no dash among them");
  assert.ok(modes?.every((mode) => mode.ops.length), "both of them do something");

  // "All cards in your opponent's Battle Cards and Unisons" names two areas.
  // Split on the "and", the second half was a bare area word and the first
  // half quietly narrowed to one area.
  const both = one("[Auto] When this card attacks, choose up to 2 total cards from among all cards in your opponent's Battle Cards and Unisons and they get -15000 power for the turn.");
  assert.deepEqual(both.unsupported, []);
  assert.deepEqual((both.ops[0] as { sel: { areas?: string[] } }).sel.areas, ["battle", "unison"]);

  // "When your ≪Turtle School≫ card attacks …, **it** gets +10000 power" — a
  // trigger about a card other than this one. "It" is the trigger's subject,
  // which the engine binds; before this it pointed at nothing.
  const other = one("[Auto] When your green ≪Turtle School≫ card with an energy cost of 5 or less attacks a Battle Card, it gets +10000 power for the turn.");
  assert.deepEqual(other.unsupported, []);
  assert.deepEqual((other.ops[0] as { target: { sel?: { special?: string } } }).target.sel?.special, "subject");
  // A trigger that does name this card still means this card.
  assert.deepEqual((one("[Auto] When this card attacks, it gets +5000 power for the turn.").ops[0] as { target: { sel?: { special?: string } } }).target.sel?.special, "self");
}

console.log("verify-arena: all checks passed");
