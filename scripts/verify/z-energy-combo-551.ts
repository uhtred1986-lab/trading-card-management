/** 8-5-2..8-5-8: each player may move one spent Battle Card to Z-Energy. */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty, rulesFromCompiler } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { run } from "../../src/lib/arena/vm/flow";
import { moveCard, newCard } from "../../src/lib/arena/vm/zones";
import { tokenCardId } from "../../src/lib/arena/vm/common";
import type { Action, GameEvent, PlayerId, Prompt } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const rules = RULES;
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok, "DBS rules failed to load");
const dbs = loaded.definition;
const ids = ["Z551_BATTLE", "Z551_OTHER", "Z551_EXTRA", "Z551_ZBATTLE", "Z551_ZLEADER", "Z551_ZUNISON", "Z551_TOKEN", "Z551_BASE", "Z551_UNDER"];
const old = new Map(ids.map((id) => [id, DEFS[id]]));
DEFS.Z551_BATTLE = card("Z551_BATTLE", {
  comboPower: 5000,
  skill: "[Auto] When this card is added to your Z-Energy, choose up to 1 of your Battle Cards in your Combo Area and draw 1 card.",
});
DEFS.Z551_OTHER = card("Z551_OTHER", { comboPower: 10000 });
DEFS.Z551_EXTRA = card("Z551_EXTRA", { type: "EXTRA", power: null, comboCost: null, comboPower: null });
DEFS.Z551_ZBATTLE = card("Z551_ZBATTLE", { type: "Z-BATTLE", zEnergyCost: 1, comboPower: 5000 });
DEFS.Z551_ZLEADER = card("Z551_ZLEADER", {
  type: "Z-LEADER",
  zEnergyCost: 1,
  power: null,
  comboCost: null,
  comboPower: null,
  skill: "[Z-Awaken] {1} : <Son Goku>",
});
DEFS.Z551_ZUNISON = card("Z551_ZUNISON", { type: "Z-UNISON", zEnergyCost: 1, power: null, comboCost: null, comboPower: null });
DEFS.Z551_TOKEN = card("Z551_TOKEN", { type: "TOKEN", power: 10000, energyCost: null, comboCost: 0, comboPower: 5000 });
DEFS.Z551_BASE = { ...DEFS["L-RED"], id: "Z551_BASE", name: "Z551 Base Leader", characters: ["Son Goku"] };
DEFS.Z551_UNDER = card("Z551_UNDER", {});
const stackCtx = { defs: DEFS, scripts: rulesFromCompiler(DEFS) };

function mainPhase(seed = 551, first: PlayerId = "p1"): VmState {
  let state = rules.createGame(CTX, {
    seed,
    p1: { name: "You", leader: "L-RED", main: fifty("V1") },
    p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") },
  }).state as VmState;
  state = rules.apply(CTX, state, { type: "chooseFirst", player: state.chooser, first }).state as VmState;
  for (let i = 0; i < 40 && !(state.prompt.kind === "main" && state.prompt.player === "p1"); i++) {
    state = rules.apply(CTX, state, { type: "pass", player: (state.prompt as { player: PlayerId }).player }).state as VmState;
  }
  assert.equal(state.prompt.kind, "main", "fixture did not reach Main Phase");
  assert.equal(state.prompt.player, "p1", "fixture did not reach p1's Main Phase");
  return state;
}

function stage(state: VmState, player: PlayerId, cardId: string, zone: string): string {
  const id = state.sides[player].zones.hand[0];
  assert.ok(id, `${player} has no card to stage`);
  state.cards[id].cardId = cardId;
  if (cardId.startsWith("Z551_Z")) state.cards[id].zCard = true;
  else delete state.cards[id].zCard;
  assert.ok(moveCard(state, dbs, id, zone, { owner: player }).ok, `could not put ${cardId} in ${zone}`);
  return id;
}

function atBattleEnd(state: VmState, attacker: string, guard: string): VmState {
  state.battle = { attacker, guard, target: guard, step: "battleEnd", negated: false, blockerOffered: false, counters: [] };
  const phase = dbs.phases.battle;
  assert.ok(phase, "DBS has no battle phase");
  const index = phase.steps.indexOf("battleEnd");
  assert.ok(index >= 0, "DBS has no battleEnd step");
  state.phase = "battle";
  state.flow.push({ phase: "battle", index, repeats: 0 });
  run(CTX, dbs, state, []);
  return state;
}

function take(state: VmState, action: Action): { state: VmState; events: GameEvent[] } {
  const result = rules.apply(CTX, state, action);
  return { state: result.state as VmState, events: result.events };
}

function cleanup(): void {
  for (const id of ids) {
    const prior = old.get(id);
    if (prior) DEFS[id] = prior;
    else delete DEFS[id];
  }
}

try {
  // Both players receive their up-to-one choice in turn-player order. The
  // first answer is persisted as JSON and the second player's decision resumes
  // without running the checkpoint between them.
  {
    let state = mainPhase();
    const attacker = stage(state, "p1", "Z551_BATTLE", "battle");
    const guard = stage(state, "p2", "Z551_BATTLE", "battle");
    const first = stage(state, "p1", "Z551_BATTLE", "combo");
    const second = stage(state, "p1", "Z551_OTHER", "combo");
    const other = stage(state, "p2", "Z551_BATTLE", "combo");
    const handBeforeChoices = state.sides.p1.zones.hand.length;
    atBattleEnd(state, attacker, guard);
    assert.deepEqual(state.prompt, { kind: "zEnergyFromCombo", player: "p1", candidates: [first, second] });
    const choices = rules.legalActions(CTX, state).map((entry) => entry.action).filter((action) => action.type === "zEnergyFromCombo");
    assert.deepEqual(choices, [
      { type: "zEnergyFromCombo", player: "p1", card: first },
      { type: "zEnergyFromCombo", player: "p1", card: second },
      { type: "zEnergyFromCombo", player: "p1", card: null },
    ]);

    const rejected = structuredClone(state);
    assert.throws(() => take(state, { type: "zEnergyFromCombo", player: "p1", card: other }), /no longer in this Combo Area/);
    assert.deepEqual(state, rejected, "an invalid choice mutated the saved state");
    const stale = structuredClone(state);
    assert.ok(moveCard(stale, dbs, first, "drop", { owner: "p1" }).ok);
    assert.throws(() => take(stale, { type: "zEnergyFromCombo", player: "p1", card: first }), /no longer in this Combo Area/);
    assert.equal(stale.sides.p1.zones.combo.includes(first), false, "the fixture made the offered answer stale");
    assert.equal(state.sides.p1.zones.combo.includes(first), true, "rejection leaves the caller's persisted state untouched");

    const selected = take(state, { type: "zEnergyFromCombo", player: "p1", card: first });
    state = selected.state as VmState;
    assert.ok(selected.events.some((event) => event.type === "move" && event.card === first && event.from === "combo" && event.to === "zEnergy"), "8-5-2 records the public Combo-to-Z-Energy move");
    assert.equal(state.sides.p1.zones.zEnergy.includes(first), true);
    assert.equal(state.sides.p1.zones.combo.includes(first), false);
    assert.deepEqual(state.prompt, { kind: "zEnergyFromCombo", player: "p2", candidates: [other] });
    assert.equal(state.pending.length, 1, "the selected card's addedToZEnergy Auto waits for the shared 8-5-4 checkpoint");
    assert.equal(state.sides.p1.zones.hand.length, handBeforeChoices, "the Auto has not resolved between the two players' choices");
    const attackView = rules.boardView(CTX, state, "p1", {}).battle;
    assert.equal(attackView?.attackPower, 25000, "the selected card's contribution remains while the second choice is pending");
    assert.equal(attackView?.contributions?.[first], 5000);

    state = JSON.parse(JSON.stringify(state)) as VmState;
    const finalChoice = take(state, { type: "zEnergyFromCombo", player: "p2", card: other });
    state = finalChoice.state as VmState;
    assert.equal(state.sides.p2.zones.zEnergy.includes(other), true);
    assert.equal(state.prompt.kind, "chooseCards", "the selected card's real addedToZEnergy Auto resolves at 8-5-4, before combo cleanup");
    assert.deepEqual((state.prompt as Extract<Prompt, { kind: "chooseCards" }>).choice.candidates, [second]);
    assert.equal((state.prompt as Extract<Prompt, { kind: "chooseCards" }>).choice.min, 0);
    assert.equal((state.prompt as Extract<Prompt, { kind: "chooseCards" }>).choice.max, 1);
    assert.ok(state.sides.p1.zones.combo.includes(second), "the unselected Battle Card is still in Combo while the Auto asks");
    const checkpointView = rules.boardView(CTX, state, "p1", {}).battle;
    assert.equal(checkpointView?.attackPower, 25000, "8-5-4 still sees the selected card's retained contribution while the unselected card remains in Combo");
    state = JSON.parse(JSON.stringify(state)) as VmState;
    state = take(state, { type: "choose", player: "p1", cards: [second] }).state as VmState;
    assert.equal(state.sides.p1.zones.hand.length, handBeforeChoices + 1, "the addedToZEnergy Auto finishes before cleanup resumes");
    assert.equal(state.sides.p1.zones.combo.includes(second), false);
    assert.equal(state.sides.p1.zones.drop.includes(second), true, "unselected combo cards are dropped");
    assert.equal(state.battle, null, "cleanup resumes through the battle's normal end");
  }

  // Declining the turn player's up-to-one choice leaves unselected cards for
  // ordinary cleanup, while a selected token is consumed once and removed by
  // the normal mover (19-1-6/7).
  {
    let state = mainPhase(552);
    const attacker = stage(state, "p1", "Z551_BATTLE", "battle");
    const guard = stage(state, "p2", "Z551_BATTLE", "battle");
    const tokenId = "p1#token551";
    const token = newCard(tokenId, tokenCardId("Combo Token", 10000, 0, 5000, ["Red"]), "p1");
    state.cards[tokenId] = token;
    assert.ok(moveCard(state, dbs, tokenId, "combo", { owner: "p1" }).ok);
    const normal = stage(state, "p1", "Z551_BATTLE", "combo");
    atBattleEnd(state, attacker, guard);
    assert.deepEqual((state.prompt as Extract<typeof state.prompt, { kind: "zEnergyFromCombo" }>).candidates, [tokenId, normal]);
    state = take(state, { type: "zEnergyFromCombo", player: "p1", card: tokenId }).state as VmState;
    assert.equal(state.sides.p1.zones.removed.includes(tokenId), true);
    assert.equal(state.sides.p1.zones.zEnergy.includes(tokenId), false);
    assert.equal(state.prompt.kind, "main", "the turn player gets no second choice after selecting one token");
    assert.equal(state.sides.p1.zones.drop.includes(normal), true);
  }

  // The non-turn player can independently decline after the turn player has
  // selected a card; neither answer consumes the other's one-card allowance.
  {
    let state = mainPhase(558);
    const attacker = stage(state, "p1", "Z551_BATTLE", "battle");
    const guard = stage(state, "p2", "Z551_BATTLE", "battle");
    const turnCard = stage(state, "p1", "Z551_BATTLE", "combo");
    const otherCard = stage(state, "p2", "Z551_BATTLE", "combo");
    atBattleEnd(state, attacker, guard);
    state = take(state, { type: "zEnergyFromCombo", player: "p1", card: turnCard }).state as VmState;
    assert.deepEqual(state.prompt, { kind: "zEnergyFromCombo", player: "p2", candidates: [otherCard] });
    state = take(state, { type: "zEnergyFromCombo", player: "p2", card: null }).state as VmState;
    assert.equal(state.sides.p1.zones.zEnergy.includes(turnCard), true);
    assert.equal(state.sides.p2.zones.drop.includes(otherCard), true, "the declined card follows 8-5-8 cleanup");
    assert.equal(state.battle, null);
  }

  // The chooser owns the Combo Area decision; the card's owner receives the
  // selected card in Z-Energy (3-1-6, 8-5-2).
  {
    let state = mainPhase(557);
    const attacker = stage(state, "p1", "Z551_BATTLE", "battle");
    const guard = stage(state, "p2", "Z551_BATTLE", "battle");
    const foreign = state.sides.p2.zones.hand[0];
    assert.ok(foreign);
    state.cards[foreign].cardId = "Z551_OTHER";
    assert.ok(moveCard(state, dbs, foreign, "combo", { owner: "p1" }).ok);
    atBattleEnd(state, attacker, guard);
    assert.deepEqual(state.prompt, { kind: "zEnergyFromCombo", player: "p1", candidates: [foreign] });
    state = take(state, { type: "zEnergyFromCombo", player: "p1", card: foreign }).state;
    assert.equal(state.sides.p2.zones.zEnergy.includes(foreign), true);
    assert.equal(state.sides.p1.zones.zEnergy.includes(foreign), false);
  }

  // 14-1-4 removes a Z-Card whenever it leaves Leader/Battle/Unison,
  // regardless of destination; 16-1-4 confirms the Battle-area case. A
  // Z-Battle already in Combo can still enter Z-Energy.
  {
    let state = mainPhase(553);
    const zBattle = stage(state, "p1", "Z551_ZBATTLE", "battle");
    const toCombo = moveCard(state, dbs, zBattle, "combo", { owner: "p1" });
    assert.ok(toCombo.ok);
    assert.equal(toCombo.move.to, "removed", "a Z-Battle leaving Battle for Combo is removed by 16-1-4");
    const zBattleToUnison = stage(state, "p1", "Z551_ZBATTLE", "battle");
    const battleToUnison = moveCard(state, dbs, zBattleToUnison, "unison", { owner: "p1" });
    assert.ok(battleToUnison.ok);
    assert.equal(battleToUnison.move.to, "removed", "14-1-4/16-1-4 remove a Z-Battle that leaves Battle even for another listed area");

    const zInCombo = stage(state, "p1", "Z551_ZBATTLE", "combo");
    const toEnergy = moveCard(state, dbs, zInCombo, "zEnergy", { owner: "p1" });
    assert.ok(toEnergy.ok);
    assert.equal(toEnergy.move.to, "zEnergy", "a Z card already in Combo is outside the 14-1-4 departure areas");

    // The same exception applies to the actual 8-5 choice after serialization.
    state = mainPhase(555);
    const attacker = stage(state, "p1", "Z551_BATTLE", "battle");
    const guard = stage(state, "p2", "Z551_BATTLE", "battle");
    const comboZBattle = stage(state, "p1", "Z551_ZBATTLE", "combo");
    atBattleEnd(state, attacker, guard);
    assert.deepEqual((state.prompt as Extract<typeof state.prompt, { kind: "zEnergyFromCombo" }>).candidates, [comboZBattle]);
    state = JSON.parse(JSON.stringify(state)) as VmState;
    const resumed = take(state, { type: "zEnergyFromCombo", player: "p1", card: comboZBattle });
    state = resumed.state;
    assert.equal(state.sides.p1.zones.zEnergy.includes(comboZBattle), true, "a selected Z-Battle in Combo reaches Z-Energy after JSON reload");
    assert.equal(state.sides.p1.zones.removed.includes(comboZBattle), false);
    assert.ok(resumed.events.some((event) => event.type === "move" && event.card === comboZBattle && event.to === "zEnergy"));

    state = mainPhase(556);
    const zLeader = stage(state, "p1", "Z551_ZLEADER", "hand");
    assert.ok(moveCard(state, dbs, state.sides.p1.zones.leader[0], "drop", { owner: "p1" }).ok);
    assert.ok(moveCard(state, dbs, zLeader, "leader", { owner: "p1" }).ok);
    const leaderToCombo = moveCard(state, dbs, zLeader, "combo", { owner: "p1" });
    assert.ok(leaderToCombo.ok);
    assert.equal(leaderToCombo.move.to, "removed", "a Z-card leaving Leader is removed by 14-1-4");

    const zLeaderToUnison = stage(state, "p1", "Z551_ZLEADER", "hand");
    const leaderToUnison = moveCard(state, dbs, zLeaderToUnison, "leader", { owner: "p1" });
    assert.ok(leaderToUnison.ok);
    const leaderToOtherListedArea = moveCard(state, dbs, zLeaderToUnison, "unison", { owner: "p1" });
    assert.ok(leaderToOtherListedArea.ok);
    assert.equal(leaderToOtherListedArea.move.to, "removed", "leaving Leader removes the Z-Card even when its destination is Unison");

    const zLeaderStays = stage(state, "p1", "Z551_ZLEADER", "hand");
    assert.ok(moveCard(state, dbs, zLeaderStays, "leader", { owner: "p1" }).ok);
    const sameLeaderArea = moveCard(state, dbs, zLeaderStays, "leader", { owner: "p1" });
    assert.ok(sameLeaderArea.ok);
    assert.equal(sameLeaderArea.move.to, "leader", "moving within the same player's Leader Area is not leaving it");

    const zUnison = stage(state, "p1", "Z551_ZUNISON", "hand");
    assert.ok(moveCard(state, dbs, zUnison, "unison", { owner: "p1" }).ok);
    const unisonToDrop = moveCard(state, dbs, zUnison, "drop", { owner: "p1" });
    assert.ok(unisonToDrop.ok);
    assert.equal(unisonToDrop.move.to, "removed", "a Z-card leaving Unison is removed by 14-1-4");

    const zUnisonToLeader = stage(state, "p1", "Z551_ZUNISON", "hand");
    assert.ok(moveCard(state, dbs, zUnisonToLeader, "unison", { owner: "p1" }).ok);
    const unisonToLeader = moveCard(state, dbs, zUnisonToLeader, "leader", { owner: "p1" });
    assert.ok(unisonToLeader.ok);
    assert.equal(unisonToLeader.move.to, "removed", "leaving Unison removes the Z-Card even when its destination is Leader");

    const zBattleTransfer = stage(state, "p1", "Z551_ZBATTLE", "battle");
    const transfer = moveCard(state, dbs, zBattleTransfer, "battle", { owner: "p2" });
    assert.ok(transfer.ok);
    assert.equal(transfer.move.to, "removed", "16-1-4 removes a Z-Battle transferred out of its controller's Battle Area to the other player's Battle Area");

    // Use the real 22-46 [Z-Awaken] action to create the stack. The old Leader
    // has awakened and carries another card underneath. The real attack
    // declaration after Z-Awaken rests the top card through the VM.
    state = mainPhase(559, "p2");
    const baseLeader = state.sides.p1.zones.leader[0];
    assert.ok(baseLeader);
    state.cards[baseLeader].cardId = "Z551_BASE";
    for (const life of state.sides.p1.zones.life.slice(0, 4)) {
      assert.ok(moveCard(state, dbs, life, "drop", { owner: "p1" }).ok);
    }
    state = rules.apply(stackCtx, state, { type: "activate", player: "p1", card: baseLeader, skill: 0 }).state as VmState;
    assert.equal(state.cards[baseLeader].flipped, true, "the underlying Leader is awakened through its real skill");
    const attached = stage(state, "p1", "Z551_UNDER", "hand");
    assert.ok(moveCard(state, dbs, attached, "drop", { under: baseLeader }).ok, "a card can be carried under the Leader");
    const orb = stage(state, "p1", "Z551_BATTLE", "hand");
    assert.ok(moveCard(state, dbs, orb, "energy", { owner: "p1" }).ok);
    const zOrb = stage(state, "p1", "Z551_OTHER", "hand");
    assert.ok(moveCard(state, dbs, zOrb, "zEnergy", { owner: "p1" }).ok);
    const stackedZLeader = stage(state, "p1", "Z551_ZLEADER", "zDeck");
    assert.ok(rules.legalActions(stackCtx, state).some((entry) => entry.action.type === "activate" && entry.action.card === stackedZLeader), "22-46 offers the Z-Awaken activation");
    state = rules.apply(stackCtx, state, { type: "activate", player: "p1", card: stackedZLeader, skill: 0 }).state as VmState;
    while (state.prompt.kind === "payCost") {
      state = rules.apply(stackCtx, state, { type: "payCost", player: state.prompt.player, option: 0 }).state as VmState;
    }
    assert.deepEqual(state.sides.p1.zones.leader, [stackedZLeader], "the Z-Leader takes the Leader Area through 22-46");
    assert.deepEqual(state.cards[stackedZLeader].under, [baseLeader, attached], "the awakened Leader and its under-card are in the real stack");
    assert.equal(state.cards[baseLeader].flipped, true, "the Leader retains its awakened face while under the Z-Leader");
    assert.equal(state.cards[stackedZLeader].mode, "active", "Z-Awaken leaves the top Z-Leader active before it attacks");
    assert.equal(state.turn, 2, "p1 is on the second turn, so the normal attack restriction does not apply");
    const leaderAttack = rules.legalActions(stackCtx, state).find((entry) => entry.action.type === "attack" && entry.action.attacker === stackedZLeader && entry.action.target === state.sides.p2.zones.leader[0]);
    assert.ok(leaderAttack, "the Z-Awakened Leader can legally attack");
    state = rules.apply(stackCtx, state, leaderAttack.action).state as VmState;
    while (state.prompt.kind !== "main" && state.prompt.kind !== "gameOver") {
      const promptPlayer = (state.prompt as { player?: "p1" | "p2" }).player ?? "p1";
      state = rules.apply(stackCtx, state, { type: "pass", player: promptPlayer }).state as VmState;
    }
    assert.equal(state.cards[stackedZLeader].mode, "rest", "the real attack rests the top Z-Leader through the VM");
    state = JSON.parse(JSON.stringify(state)) as VmState;
    const stackedDeparture = moveCard(state, dbs, stackedZLeader, "unison", { owner: "p1" });
    assert.ok(stackedDeparture.ok);
    assert.equal(stackedDeparture.move.to, "removed");
    assert.deepEqual(state.sides.p1.zones.leader, [baseLeader], "15-1-5 leaves the underlying Leader in its original Leader Area");
    assert.deepEqual(state.cards[stackedZLeader].under, [], "the removed Z-Leader no longer carries the retained Leader");
    assert.equal(state.cards[baseLeader].flipped, true, "the underlying Leader keeps its awakened face after 15-1-5");
    assert.equal(state.cards[baseLeader].mode, "rest", "the underlying Leader inherits the governing top card's Rest Mode");
    assert.deepEqual(state.cards[baseLeader].under, [attached], "the underlying Leader keeps its carried under-card");
  }

  // Non-Battle cards in Combo are ineligible and go to Drop; the Z-Energy
  // choice does not act as a blanket exemption from ordinary cleanup.
  {
    let state = mainPhase(554);
    const attacker = stage(state, "p1", "Z551_BATTLE", "battle");
    const guard = stage(state, "p2", "Z551_BATTLE", "battle");
    const extra = stage(state, "p1", "Z551_EXTRA", "combo");
    const battleCard = stage(state, "p1", "Z551_BATTLE", "combo");
    atBattleEnd(state, attacker, guard);
    assert.deepEqual((state.prompt as Extract<typeof state.prompt, { kind: "zEnergyFromCombo" }>).candidates, [battleCard]);
    state = take(state, { type: "zEnergyFromCombo", player: "p1", card: null }).state as VmState;
    assert.equal(state.sides.p1.zones.drop.includes(extra), true);
    assert.equal(state.sides.p1.zones.drop.includes(battleCard), true);
  }
} finally {
  cleanup();
}
