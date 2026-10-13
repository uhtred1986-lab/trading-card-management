/**
 * Issue #571's exact Auto trigger readings. These scenarios use the rules
 * engine's event declarations directly and fixed expected matches; none reads
 * the legacy oracle or database.
 */
import assert from "node:assert/strict";
import { compileSkill } from "../../src/lib/arena/compile";
import { subjectFilterOf } from "../../src/lib/arena/compile/targets";
import type { VmState } from "../../src/lib/arena/vm/state";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { matches } from "../../src/lib/arena/text/filters";
import { autoTriggerMatches } from "../../src/lib/arena/text/triggers";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { skillRecords } from "../../src/lib/arena/draft";
import { triggersOf } from "../../src/lib/arena/gaps";
import type { CardDef, PlayerId } from "../../src/lib/arena/types";
import { CTX, DEFS, card, fifty } from "./harness";

// Official text sources: BT7-003 at https://www.dbs-cardgame.com/europe-en/cardlist/?category=428007&search=true;
// SD8-09 at https://www.dbs-cardgame.com/us-en/cardlist/index.php?free=SD8-09&search=true;
// XD1-01 at https://www.dbs-cardgame.com/oceania/cardlist/?category=428501&search=true;
// BT31-116 at https://www.dbs-cardgame.com/asia/cardlist/?category=428031&search=true;
// SD15-01 at https://www.dbs-cardgame.com/us-en/cardlist/?category=428315&search=true.

const BT7_AUTO = "[Auto][Once per turn] When your opponent switches energy to Active Mode using a non-[Awaken] skill during their turn, choose up to 1 of your opponent's energy and place it in its owner's Drop Area.";
const SD8_AUTO = "[Auto][Once per turn] When your opponent switches their energy to Active Mode using a non-[Awaken] skill during their turn, choose up to 1 of your opponent's energy and place it in its owner's Drop Area.";
const XD1_AUTO = "[Auto] When a blue or yellow ≪Universe 6≫ card is played in your Battle Area, that card gets +5000 power for the duration of the turn, then choose up to 1 card in your life and add it to your hand.";
const BT31_AUTO = "[Auto] Switch 1 of your energy to Hidden Mode: When your <Cell> or <Cell Jr.> card—both white and with an energy cost of 3 or more—is played, activate an [Activate: Main/Battle] skill of up to 1 mono-white Extra with an energy cost of 2 in your hand.";
const SD15_AUTO = "[Auto][Once per turn][Spirit Boost 1] (You must remove a marker from your Unison Card to activate this skill.) When your opponent attacks your red Unison Card with a specified cost of 2, negate the attack, then choose up to 1 of your Unison Cards and it gets +6000 power for the turn.";
const AWAKEN_OWN_ENERGY = "[Awaken] When your life is at 4 or less: If you have a blue energy, you may switch 1 of your energy to Active Mode.";
const AWAKEN_OPPONENT_ENERGY = "[Awaken] When your life is at 4 or less: If you have a blue energy, you may switch 1 of your opponent's energy to Active Mode.";
const AWAKEN_SURGE_OWN_ENERGY = AWAKEN_OWN_ENERGY.replace("[Awaken]", "[Awaken: Surge]");
const AWAKEN_SURGE_OPPONENT_ENERGY = AWAKEN_OPPONENT_ENERGY.replace("[Awaken]", "[Awaken: Surge]");

function add(id: string, def: Partial<CardDef>): void {
  DEFS[id] = card(id, def);
}

add("R571-BT7", { skill: BT7_AUTO });
add("R571-SD8", { skill: SD8_AUTO });
add("R571-XD1", { type: "LEADER", colors: ["Yellow"], skill: XD1_AUTO });
add("R571-BT31", { type: "LEADER", colors: ["White"], skill: BT31_AUTO });
add("R571-SD15", { type: "LEADER", colors: ["Red"], skill: SD15_AUTO });
add("R571-GENERIC-ATTACK", { skill: "[Auto] When your opponent attacks, draw 1 card." });
add("R571-ATTACKER", { skill: null });
add("R571-ENERGY", { colors: ["Blue"], skill: null });
add("R571-CELL3", { colors: ["White"], characters: ["Cell"], energyCost: 3, skill: null });
add("R571-CELLJR4", { colors: ["White"], characters: ["Cell Jr."], energyCost: 4, skill: null });
add("R571-CELL2", { colors: ["White"], characters: ["Cell"], energyCost: 2, skill: null });
add("R571-RED-CELL3", { colors: ["Red"], characters: ["Cell"], energyCost: 3, skill: null });
add("R571-GOHAN3", { colors: ["White"], characters: ["Son Gohan"], energyCost: 3, skill: null });
add("R571-U6-BLUE", { colors: ["Blue"], traits: ["Universe 6"], skill: null });
add("R571-U6-YELLOW", { colors: ["Yellow"], traits: ["Universe 6"], skill: null });
add("R571-U6-GREEN", { colors: ["Green"], traits: ["Universe 6"], skill: null });
add("R571-U7-BLUE", { colors: ["Blue"], traits: ["Universe 7"], skill: null });
add("R571-NO-TRAIT-YELLOW", { colors: ["Yellow"], traits: [], skill: null });
add("R571-RED-U2", { type: "UNISON", colors: ["Red"], energyCost: 2, specifiedCost: { Red: 2 }, skill: null });
add("R571-RED-U1", { type: "UNISON", colors: ["Red"], energyCost: 2, specifiedCost: { Red: 1 }, skill: null });
add("R571-BLUE-U2", { type: "UNISON", colors: ["Blue"], energyCost: 2, specifiedCost: { Blue: 2 }, skill: null });
add("R571-RED-BATTLE2", { type: "BATTLE", colors: ["Red"], energyCost: 2, specifiedCost: { Red: 2 }, skill: null });
for (const [id, skill] of [
  ["R571-AWAKEN-OWN", AWAKEN_OWN_ENERGY],
  ["R571-AWAKEN-OPPONENT", AWAKEN_OPPONENT_ENERGY],
  ["R571-AWAKEN-SURGE-OWN", AWAKEN_SURGE_OWN_ENERGY],
  ["R571-AWAKEN-SURGE-OPPONENT", AWAKEN_SURGE_OPPONENT_ENERGY],
] as const) {
  add(id, { type: "LEADER", colors: ["Red"], skill, back: { name: `${id} Awakened`, power: 15000, skill: null } });
}

const loaded = rulesetFor("dbs");
assert.ok(loaded.ok, "the DBS ruleset should load with #571 trigger declarations");
const DBS = loaded.definition;
const rules = RULES;
const deck = {
  seed: 571,
  p1: { name: "P1", leader: "L-RED", main: fifty("V1") },
  p2: { name: "P2", leader: "L-BLUE", main: fifty("V-BLUE") },
};

async function main(): Promise<void> {
  try {
  // Load these after the harness has finished initializing the rules engine's
  // module graph; the battle step table and host refer to one another.
  const [{ fire }, { BATTLE_STEP_WORK }, { vmHost }, { withTokens }, { moveCard }] = await Promise.all([
    import("../../src/lib/arena/vm/events"),
    import("../../src/lib/arena/vm/battle"),
    import("../../src/lib/arena/vm/host"),
    import("../../src/lib/arena/vm/cards"),
    import("../../src/lib/arena/vm/zones"),
  ]);

function fresh(turn: PlayerId = "p2"): VmState {
  const state = rules.createGame(CTX, deck).state as VmState;
  state.turnPlayer = turn;
  state.pending = [];
  return state;
}

function stage(state: VmState, player: PlayerId, cardId: string, area: "battle" | "energy" | "unison"): string {
  const id = state.sides[player].zones.hand[0] ?? state.sides[player].zones.deck[0];
  assert.ok(id, `${player} needs a card to stage ${cardId}`);
  state.cards[id].cardId = cardId;
  const moved = moveCard(state, DBS, id, area, { owner: player });
  assert.ok(moved.ok, `could not stage ${cardId} in ${player}'s ${area}`);
  state.pending = [];
  return id;
}

function leader(state: VmState, player: PlayerId, cardId: string): string {
  const id = state.sides[player].zones.leader[0];
  assert.ok(id, `${player} needs the dealt Leader`);
  state.cards[id].cardId = cardId;
  return id;
}

function causedEnergySwitch(args: { cardId: string; actor: PlayerId; turn?: PlayerId; keyword?: "Awaken"; targetOwner?: PlayerId }): string[] {
  const state = fresh(args.turn ?? "p2");
  const watcher = stage(state, "p1", args.cardId, "battle");
  const target = stage(state, args.targetOwner ?? "p2", "R571-ENERGY", "energy");
  const actor = stage(state, args.actor, "R571-ATTACKER", "battle");
  state.cards[target].mode = "rest";
  const log: import("../../src/lib/arena/types").GameEvent[] = [];
  const switched = vmHost(CTX, DBS, state, log).setMode(target, "active", {
    card: actor,
    master: args.actor,
    ...(args.keyword ? { keyword: args.keyword } : {}),
  });
  assert.equal(switched, true, "the target was Rest and a real mode change occurred");
  return state.pending.filter((p) => p.card === watcher).map((p) => p.trigger);
}

// The two official Raditz/Whis printings differ on whether the energy owner is
// specified. BT7-003's generic wording covers either target; SD8-09's
// possessive covers only the opponent's own energy.
{
  const bt7 = parseSkills(BT7_AUTO)[0]!;
  const sd8 = parseSkills(SD8_AUTO)[0]!;
  assert.equal(bt7.oncePerTurn, true);
  assert.equal(sd8.oncePerTurn, true);
  assert.equal(autoTriggerMatches(bt7, "opponentEnergyActiveBySkill"), true);
  assert.equal(autoTriggerMatches(bt7, "opponentOwnEnergyActiveBySkill"), true);
  assert.equal(autoTriggerMatches(sd8, "opponentEnergyActiveBySkill"), false);
  assert.equal(autoTriggerMatches(sd8, "opponentOwnEnergyActiveBySkill"), true);
  const bt7Record = skillRecords(DEFS["R571-BT7"]!)[0]!;
  assert.deepEqual(bt7Record.trigger, ["opponentEnergyActiveBySkill", "opponentOwnEnergyActiveBySkill"], "the compiled WHEN record preserves both BT7 target-owner moments");
  assert.deepEqual(triggersOf(bt7), bt7Record.trigger, "the live trigger selection uses the same union stored in the compiled card record");
  const sd8Record = skillRecords(DEFS["R571-SD8"]!)[0]!;
  assert.deepEqual(sd8Record.trigger, ["opponentOwnEnergyActiveBySkill"], "the possessive SD8 reading narrows the stored trigger record");
  assert.deepEqual(compileSkill(bt7).unsupported, []);
  assert.deepEqual(compileSkill(sd8).unsupported, []);

  assert.deepEqual(causedEnergySwitch({ cardId: "R571-BT7", actor: "p2", targetOwner: "p2" }), ["opponentOwnEnergyActiveBySkill"]);
  assert.deepEqual(causedEnergySwitch({ cardId: "R571-BT7", actor: "p2", targetOwner: "p1" }), ["opponentEnergyActiveBySkill"]);
  assert.deepEqual(causedEnergySwitch({ cardId: "R571-SD8", actor: "p2", targetOwner: "p2" }), ["opponentOwnEnergyActiveBySkill"]);
  assert.deepEqual(causedEnergySwitch({ cardId: "R571-SD8", actor: "p2", targetOwner: "p1" }), [], "SD8-09 does not read a switch of your energy");
  assert.deepEqual(causedEnergySwitch({ cardId: "R571-BT7", actor: "p2", targetOwner: "p2", turn: "p1" }), [], "the skill must be used during the opponent's turn");
  assert.deepEqual(causedEnergySwitch({ cardId: "R571-BT7", actor: "p2", targetOwner: "p2", keyword: "Awaken" }), [], "[Awaken] is excluded");
  assert.deepEqual(causedEnergySwitch({ cardId: "R571-SD8", actor: "p1", targetOwner: "p2" }), [], "your own skill switching the opponent's energy is not their skill");

  for (const [id, text] of [
    ["R571-AWAKEN-OWN", AWAKEN_OWN_ENERGY],
    ["R571-AWAKEN-OPPONENT", AWAKEN_OPPONENT_ENERGY],
    ["R571-AWAKEN-SURGE-OWN", AWAKEN_SURGE_OWN_ENERGY],
    ["R571-AWAKEN-SURGE-OPPONENT", AWAKEN_SURGE_OPPONENT_ENERGY],
  ] as const) {
    const skill = parseSkills(text)[0]!;
    assert.equal(skill.keyword?.name, "Awaken");
    const ops = JSON.stringify(compileSkill(skill).ops);
    assert.match(ops, /"op":"if"[\s\S]*"op":"may"[\s\S]*"op":"choose"[\s\S]*"op":"switchMode"[\s\S]*"by":"Awaken"/, `${id} retains its source through nested if/may/choose mode switches`);
  }

  // Real legal [Awaken] and [Awaken: Surge] actions run a printed switchMode
  // effect through the keyword body. Neither may masquerade as a non-[Awaken]
  // skill to BT7-003, including when it switches the opponent's energy.
  function activateAwaken(leaderId: string, targetOwner: PlayerId): void {
    let state = rules.createGame(CTX, deck).state as VmState;
    const chooser = (state.prompt as { player: PlayerId }).player;
    const apply = (action: Parameters<typeof rules.apply>[2]): void => {
      state = rules.apply(CTX, state, action).state as VmState;
    };
    apply({ type: "chooseFirst", player: chooser, first: "p1" });
    apply({ type: "mulligan", player: "p1", redraw: false });
    apply({ type: "mulligan", player: "p2", redraw: false });
    apply({ type: "charge", player: "p1", card: null });
    apply({ type: "endMain", player: "p1" });
    apply({ type: "charge", player: "p2", card: null });
    assert.equal(state.prompt.kind, "main");

    const p2Leader = leader(state, "p2", leaderId);
    state.sides.p2.zones.life.splice(4);
    const bt7Watcher = stage(state, "p1", "R571-BT7", "battle");
    const sd8Watcher = stage(state, "p1", "R571-SD8", "battle");
    const target = stage(state, targetOwner, "R571-ENERGY", "energy");
    if (targetOwner === "p1") stage(state, "p2", "R571-ENERGY", "energy"); // condition for the opponent-target form
    state.cards[target].mode = "rest";
    state.pending = [];

    const awaken = rules.legalActions(CTX, state).find(({ action }) => action.type === "activate" && action.card === p2Leader);
    assert.ok(awaken, `${leaderId} is a legal activation on p2's turn at 4 life`);
    apply(awaken.action);
    for (let i = 0; i < 4 && state.prompt.kind !== "main"; i++) {
      const available = rules.legalActions(CTX, state);
      const mode = available.find(({ action }) => action.type === "chooseMode" && action.player === "p2");
      if (mode?.action.type === "chooseMode") {
        apply({ ...mode.action, index: 0 });
        continue;
      }
      const optional = available.find(({ action }) => action.type === "optionalCost" && action.player === "p2");
      if (optional?.action.type === "optionalCost") {
        apply({ ...optional.action, pay: true });
        continue;
      }
      const choose = available.find(({ action }) => action.type === "choose" && action.player === "p2" && action.cards.includes(target));
      if (!choose) break;
      apply(choose.action);
    }

    assert.equal(state.cards[target].mode, "active", `${leaderId} really switches the Rest energy through its printed effect`);
    assert.deepEqual(state.pending.filter((pending) => pending.card === bt7Watcher || pending.card === sd8Watcher), [], `${leaderId} is not a non-[Awaken] switch source`);
  }

  activateAwaken("R571-AWAKEN-OWN", "p2");
  activateAwaken("R571-AWAKEN-OPPONENT", "p1");
  activateAwaken("R571-AWAKEN-SURGE-OWN", "p2");
  activateAwaken("R571-AWAKEN-SURGE-OPPONENT", "p1");

  const charge = fresh("p2");
  const watcher = stage(charge, "p1", "R571-BT7", "battle");
  const target = stage(charge, "p2", "R571-ENERGY", "energy");
  charge.cards[target].mode = "active";
  const log: import("../../src/lib/arena/types").GameEvent[] = [];
  assert.equal(vmHost(CTX, DBS, charge, log).setMode(target, "active", { card: target, master: "p2" }), false, "an already Active card did not actually switch");
  fire(withTokens(CTX), DBS, charge, { event: "modeSwitched", card: target, controller: "p2", args: { in: "energy", mode: "active" } });
  assert.deepEqual(charge.pending.filter((p) => p.card === watcher), [], "ordinary Charge Phase switching carries no skill cause and never matches");
}

// BT31-116's shared dash qualification applies to both Cell alternatives.
{
  const skill = parseSkills(BT31_AUTO)[0]!;
  assert.equal(autoTriggerMatches(skill, "youPlayed"), true);
  const filter = subjectFilterOf(skill.effect.split(",")[0]!);
  assert.ok(filter, "the played-card description needs a subject filter");
  assert.deepEqual(filter.colors, ["White"]);
  assert.deepEqual(filter.characters, ["cell", "cell jr."]);
  assert.equal(filter.costMin, 3);
  for (const id of ["R571-CELL3", "R571-CELLJR4"]) assert.equal(matches(DEFS[id], filter), true, `${id} satisfies the full printed qualification`);
  for (const id of ["R571-CELL2", "R571-RED-CELL3", "R571-GOHAN3"]) assert.equal(matches(DEFS[id], filter), false, `${id} fails at least one printed qualification`);
  const compiled = compileSkill(skill);
  assert.deepEqual(compiled.unsupported, []);
  assert.deepEqual(compiled.ops.map((op) => op.op), ["invokeSkill"], "the played-card qualification is captured when its trigger pends, before the Auto cost");
  const nested = compiled.ops[0];
  assert.equal(nested?.op, "invokeSkill", "BT31-116 invokes the chosen hand Extra's skill rather than playing the card");
  if (nested?.op === "invokeSkill" && "sel" in nested) {
    assert.equal(nested.skillKind, "activate:main/battle");
    assert.deepEqual([nested.sel.side, nested.sel.area, nested.sel.count, nested.sel.upTo], ["you", "hand", 1, true]);
    assert.deepEqual([nested.sel.filter?.type, nested.sel.filter?.monoColor, nested.sel.filter?.colors, nested.sel.filter?.costMin, nested.sel.filter?.costMax], ["EXTRA", true, ["White"], 2, 2]);
  } else assert.fail("BT31-116 needs the selected-Extra invocation variant");
}

// XD1-01 remains the known `youPlayed` case: the trigger's subject filter is
// the union of blue/yellow and Universe 6, not either condition alone.
{
  const skill = parseSkills(XD1_AUTO)[0]!;
  assert.equal(autoTriggerMatches(skill, "youPlayed"), true);
  const filter = subjectFilterOf(skill.effect.split(",")[0]!);
  assert.ok(filter);
  for (const id of ["R571-U6-BLUE", "R571-U6-YELLOW"]) assert.equal(matches(DEFS[id], filter), true, `${id} is a qualifying played subject`);
  for (const id of ["R571-U6-GREEN", "R571-U7-BLUE", "R571-NO-TRAIT-YELLOW"]) assert.equal(matches(DEFS[id], filter), false, `${id} is not a qualifying played subject`);
  assert.deepEqual(compileSkill(skill).unsupported, []);
}

// SD15-01 binds the target role, with exact current target facts. The ordinary
// opponentAttacks trigger stays on role=attacker and therefore fires once.
{
  const skill = parseSkills(SD15_AUTO)[0]!;
  assert.equal(autoTriggerMatches(skill, "opponentAttacksRedUnison2"), true);
  assert.equal(autoTriggerMatches(skill, "opponentAttacks"), false, "a target-constrained attack is not the generic attacker trigger");
  assert.deepEqual(compileSkill(skill).unsupported, []);

  function declaredAttack(targetId: string, targetOwner: PlayerId = "p1", initial = true): { specific: string[]; generic: string[] } {
    const state = fresh("p2");
    const specific = leader(state, "p1", "R571-SD15");
    const generic = stage(state, "p1", "R571-GENERIC-ATTACK", "battle");
    const target = stage(state, targetOwner, targetId, targetId.includes("U") ? "unison" : "battle");
    const attacker = stage(state, "p2", "R571-ATTACKER", "battle");
    state.battle = { attacker, guard: target, target, step: "declared", negated: false, blockerOffered: false, counters: [] };
    if (!initial) {
      state.pending = [];
      fire(withTokens(CTX), DBS, state, {
        event: "attackDeclared",
        card: target,
        controller: targetOwner,
        args: { role: "target", target: "unison", initial: false, targetRed: true, targetSpecifiedCost: 2 },
      });
    } else {
      BATTLE_STEP_WORK.battleDeclare!.run(CTX, DBS, state, []);
    }
    return {
      specific: state.pending.filter((p) => p.card === specific).map((p) => p.trigger),
      generic: state.pending.filter((p) => p.card === generic).map((p) => p.trigger),
    };
  }

  assert.deepEqual(declaredAttack("R571-RED-U2"), { specific: ["opponentAttacksRedUnison2"], generic: ["opponentAttacks"] });
  assert.deepEqual(declaredAttack("R571-RED-U1").specific, [], "a red Unison with cost 1 does not qualify");
  assert.deepEqual(declaredAttack("R571-BLUE-U2").specific, [], "a blue Unison with cost 2 does not qualify");
  assert.deepEqual(declaredAttack("R571-RED-BATTLE2").specific, [], "a Battle Card with matching colour/cost is not a Unison target");
  assert.deepEqual(declaredAttack("R571-RED-U2", "p2").specific, [], "the target must be your Unison");
  assert.deepEqual(declaredAttack("R571-RED-U2", "p1", false).specific, [], "a later Blocker target change is not the original attack declaration");
}
  console.log("  #571: five official Auto readings and fixed rules-engine trigger scenarios passed");
} finally {
  // These synthetic card records are local to this suite. The verify runner
  // shares a card-definition registry, so always clean them before probe and
  // contract suites enumerate the real fixture catalog—even after a failure.
  for (const id of Object.keys(DEFS).filter((candidate) => candidate.startsWith("R571-"))) delete DEFS[id];
}
}

export default main();
