/**
 * Play-test "Set up the board" (the 20 Oct 2026 BT6-062 review): the staged
 * position can be changed before a game — Leaders, hand, Battle Area, Drop,
 * energy, life — and the changed board is the one the rule is played on.
 *
 * Proof case: BT6-062 Broly, Berserker Origins, skill 2 (owner's ruling:
 * "you may choose 2 cards from your hand and place them in your Drop Area. If
 * you do, … play" takes exactly 2; with fewer, nothing is played). The rule is
 * the real compiled program of the printed text (catalog snapshot, 15 Oct
 * 2026, as `optional-exact-538.ts` uses it); the leader, the Broly to play
 * and the hand are fixture cards. No database, no network.
 *
 * Also proved here: an Activate board can pay its price (the traced probe used
 * to instrument it away), and `did`/`chose` conditions get an edge board.
 */
import assert from "node:assert/strict";
import { card } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { ruleFrom, scenarioFromKey, scenariosFor, stagePosition, type ProbeRule } from "../../src/lib/arena/probe";
import { tryRule } from "../../src/lib/arena/tryit";
import { zoneOf } from "../../src/lib/arena/engine-state";
import { RULES } from "../../src/lib/arena/vm";
import { sanitizeSetup, SETUP_FILLER, type BoardSetup, type ResolvedSetup } from "../../src/lib/arena/sandbox/setup";
import type { Action, CardDef, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const printed =
  "[Activate: Battle][Once per turn] Choose 1 card from your hand and place it in your Drop Area: Choose up to 1 of your opponent's Battle Cards with an energy cost of 3 or less and KO it.<br>[Auto] When this card is removed from a Battle Area by a skill or KO'd, and if your Leader Card is a green ≪Frieza's Army≫ card, you may choose 2 cards from your hand and place them in your Drop Area. If you do, choose up to 1 green <Broly: Br> card with an energy cost of 6 from your hand and play it.";
const def: CardDef = card("BT6-062", { colors: ["Green"], skill: printed, characters: ["Broly: Br"] });
const GREEN_LEADER = card("SETUP-GREEN-FRIEZA", { type: "LEADER", colors: ["Green"], traits: ["Frieza's Army"], skill: null, energyCost: null });
const RED_LEADER = card("SETUP-RED-GOKU", { type: "LEADER", colors: ["Red"], traits: ["Saiyan"], skill: null, energyCost: null });
const BROLY6 = card("SETUP-BROLY-6", { colors: ["Green"], characters: ["Broly: Br"], energyCost: 6, skill: null });
const resolved = (setup: BoardSetup): ResolvedSetup => ({ setup, defs: { [GREEN_LEADER.id]: GREEN_LEADER, [RED_LEADER.id]: RED_LEADER, [BROLY6.id]: BROLY6 }, scripts: {} });

const ruleOf = (skillIndex: number): ProbeRule => {
  const r = skillRecords(def).find((x) => x.skillIndex === skillIndex);
  assert.ok(r, `BT6-062 has a record for skill ${skillIndex}`);
  assert.deepEqual(r.unread, [], "the whole printed skill reads");
  return ruleFrom(
    { side: "front", skillIndex, kind: r.kind, trigger: r.trigger, status: "confirmed", unread: r.unread, cost: r.cost, usage: r.usage, validity: r.validity, combo: r.combo, cond: r.cond },
    def,
    r.cond ? [{ op: "if", cond: r.cond, then: r.ops }] : r.ops,
  );
};

// ── 1. skill 2 on a board the owner set up ──────────────────────────────────

const auto = ruleOf(10);
const koed = scenarioFromKey(auto, "attack");
assert.ok(koed, "the KO board exists for the Auto");

/** Stage the board, let the opponent attack the (rested) Broly, and answer: take the offer and discard `discard` first, then play `play`. */
function playOut(setup: BoardSetup, answers: { accept: boolean }) {
  const st = stagePosition(auto, koed!, resolved(setup));
  let s = st.state as VmState;
  const name = (id: string) => st.ctx.defs[s.cards[id].cardId]?.name ?? s.cards[id].cardId;
  const handBefore = zoneOf(s, "p1", "hand").slice();
  const asked: string[] = [];
  for (let i = 0; i < 30; i++) {
    const legal = RULES.legalActions(st.ctx, s);
    const pr = s.prompt as { kind: string; player?: PlayerId };
    let action: Action | undefined;
    if (pr.kind === "main" && pr.player === "p2") {
      action = legal.find((l) => l.action.type === "attack" && "target" in l.action && l.action.target === st.card)?.action;
      if (!action) break;
    }
    else if (pr.kind === "main") break;
    else if (pr.kind === "combo") action = { type: "pass", player: pr.player as PlayerId };
    else if (pr.kind === "blocker") action = { type: "block", player: pr.player as PlayerId, card: null };
    else if (pr.kind === "counter") action = { type: "counter", player: pr.player as PlayerId, card: null };
    else if (pr.kind === "chooseMode") {
      asked.push("offer");
      action = { type: "chooseMode", player: pr.player as PlayerId, index: answers.accept ? 0 : 1 };
    } else if (pr.kind === "chooseCards") {
      const choice = (s.prompt as { choice: { candidates: string[]; min: number; max: number } }).choice;
      asked.push(`choose ${choice.min}-${choice.max} of ${choice.candidates.length}`);
      const pool = choice.candidates;
      // The two cards are asked one pick at a time (the engine's own shape); the third question is the Broly to play.
      const nth = asked.filter((a) => a.startsWith("choose")).length;
      const pick = nth > 2 ? pool.filter((id) => s.cards[id].cardId === BROLY6.id) : pool.filter((id) => s.cards[id].cardId !== BROLY6.id).slice(0, choice.max);
      action = { type: "choose", player: pr.player as PlayerId, cards: pick };
    } else break;
    assert.ok(action, `a move for the ${pr.kind} prompt ${JSON.stringify(pr)} ${JSON.stringify(legal.map((l) => l.action).slice(0, 4))} card=${st.card}`);
    s = RULES.apply(st.ctx, s, action).state as VmState;
  }
  const where = (area: "hand" | "drop" | "battle") => zoneOf(s, "p1", area).map(name);
  return { st, s, handBefore, asked, where };
}

// (a) one card in hand: the offer is not made at all, nothing goes to the Drop and nothing is played.
{
  const r = playOut({ leader: GREEN_LEADER.id, hand: [SETUP_FILLER] }, { accept: true});
  assert.equal(r.handBefore.length, 1, "the board holds the one card the owner set");
  assert.ok(r.st.input.some((l) => l.includes("also holds an ordinary card")), `the setup is said: ${r.st.input.join(" | ")}`);
  assert.ok(r.st.input.some((l) => l.includes("Leader is")), "the Leader is said");
  assert.ok(r.where("drop").includes("BT6-062"), "Broly was KO'd into the Drop");
  assert.equal(r.where("drop").length, 1, "only Broly is in the Drop: nothing was discarded");
  assert.equal(r.where("hand").length, 1, "the hand is untouched");
  assert.equal(r.where("battle").filter((n) => n === BROLY6.name).length, 0, "no second Broly was played");
  assert.deepEqual(r.asked, [], "with fewer than 2 cards there is no offer to take");
}

// (b) 2 cards to discard plus the Broly (3 in hand): both go to the Drop, the Broly is played.
{
  const r = playOut({ leader: GREEN_LEADER.id, hand: [SETUP_FILLER, SETUP_FILLER, BROLY6.id] }, { accept: true});
  assert.equal(r.handBefore.length, 3);
  assert.deepEqual(r.asked.slice(0, 2), ["offer", r.asked[1]], "the offer is made, then the cards are chosen");
  assert.equal(r.where("drop").length, 3, `Broly and the two discards are in the Drop: ${r.where("drop").join(", ")}`);
  assert.equal(r.where("battle").filter((n) => n === BROLY6.name).length, 1, `the green cost-6 <Broly: Br> was played: asked ${r.asked.join(" / ")}; drop ${r.where("drop")}; hand ${r.where("hand")}; battle ${r.where("battle")}`);
  assert.equal(r.where("hand").length, 0, "the hand is empty");
}

// (c) the same hand, but the offer is declined: nothing is discarded and nothing is played.
{
  const r = playOut({ leader: GREEN_LEADER.id, hand: [SETUP_FILLER, SETUP_FILLER, BROLY6.id] }, { accept: false});
  assert.equal(r.where("drop").length, 1, "declined: only Broly is in the Drop");
  assert.equal(r.where("hand").length, 3);
  assert.equal(r.where("battle").filter((n) => n === BROLY6.name).length, 0);
}

// (d) a Leader that is not green <Frieza's Army>: the whole skill is not met, whatever the hand.
{
  const r = playOut({ leader: RED_LEADER.id, hand: [SETUP_FILLER, SETUP_FILLER, BROLY6.id] }, { accept: true});
  assert.deepEqual(r.asked, [], "a red Leader is not offered the skill");
  assert.equal(r.where("hand").length, 3);
}

// ── 2. the other fields ────────────────────────────────────────────────────

{
  const st = stagePosition(auto, koed!, resolved({ leader: GREEN_LEADER.id, theirLeader: RED_LEADER.id, hand: [SETUP_FILLER], battle: [BROLY6.id], drop: [SETUP_FILLER, SETUP_FILLER], energy: { active: 2, rested: 3 }, life: { you: 3, them: 6 } }));
  const s = st.state as VmState;
  assert.equal(st.ctx.defs[s.cards[zoneOf(s, "p1", "hand")[0]].cardId].name.length > 0, true);
  assert.equal(s.cards[RULES_LEADER(s, "p1")].cardId, GREEN_LEADER.id, "your Leader");
  assert.equal(s.cards[RULES_LEADER(s, "p2")].cardId, RED_LEADER.id, "their Leader");
  assert.equal(zoneOf(s, "p1", "drop").length, 2);
  assert.ok(zoneOf(s, "p1", "battle").some((id) => s.cards[id].cardId === BROLY6.id));
  const energy = zoneOf(s, "p1", "energy");
  assert.equal(energy.length, 5);
  assert.equal(energy.filter((id) => s.cards[id].mode === "rest").length, 3, "3 rested, 2 active");
  assert.equal(zoneOf(s, "p1", "life").length, 3);
  assert.equal(zoneOf(s, "p2", "life").length, 6);
  // An unknown card is said and left out, never staged as something else.
  const odd = stagePosition(auto, koed!, resolved({ hand: ["NOT-A-CARD"] }));
  assert.ok(odd.input.some((l) => l.includes("NOT-A-CARD is not in the catalog")));
  assert.equal(zoneOf(odd.state as VmState, "p1", "hand").length, 0);
}
function RULES_LEADER(s: VmState, p: PlayerId): string {
  return s.sides[p].zones.leader[0];
}

// The setup that arrives from a client is clamped.
{
  const clean = sanitizeSetup({ leader: "BT1-001", hand: Array.from({ length: 40 }, () => SETUP_FILLER), energy: { active: 99, rested: 99 }, life: { you: 0, them: 99 }, evil: "x", battle: ["../etc", "BT2-002"] });
  assert.equal(clean.hand?.length, 12);
  assert.deepEqual(clean.battle, ["BT2-002"]);
  assert.equal(clean.energy?.active, 12);
  assert.equal(clean.energy?.rested, 0);
  assert.deepEqual(clean.life, { you: 1, them: 8 });
  assert.ok(!("evil" in clean));
}

// ── 3. Activate boards use the skill; "if you do" paths get an edge board ───

{
  const act = ruleOf(0);
  const rows = tryRule(act).rows;
  const board = rows.find((r) => r.key === "activateBattle");
  assert.ok(board, "the Activate: Battle board");
  assert.equal(board.rules.outcome, "fired", `the Activate board uses the skill: ${board.rules.headline} / ${board.rules.result.join(" | ")}`);
  assert.ok(board.rules.headline.startsWith("KOs"), `and says what it did: ${board.rules.headline}`);
  assert.ok(board.rules.input.some((l) => l.includes("in your hand")), "the board says it staged the card the price takes");

  const edges = tryRule(auto);
  const keys = edges.rows.map((r) => r.key);
  assert.ok(keys.some((k) => k.endsWith("=take")) && keys.some((k) => k.endsWith("=decline")), `an edge board for the "if you do": ${keys.join(", ")}`);
  assert.ok(!edges.notes.some((n) => n.includes("chose") || n.includes("did")), `no "no edge board for did/chose" note: ${edges.notes.join(" | ")}`);
  const declined = edges.rows.find((r) => r.key.endsWith("=decline"))!;
  assert.ok(declined.rules.input.some((l) => /decline|pass on/.test(l)), "the declined board says so");
  assert.ok(scenariosFor(auto)[0].key === "attack", "board 0 does not move");
}

console.log("rules-sandbox-setup: ok — BT6-062 skill 2 (1 card: nothing; 2 + Broly: both dropped, Broly played; declined; wrong Leader), every setup field, Activate board, answer edge boards");
