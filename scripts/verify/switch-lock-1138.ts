/**
 * #1138: "[Counter: Attack] Your Leader Card is yellow: Negate the attack, then
 * choose up to 1 of your opponent's Battle Cards in Rest Mode ignoring
 * [Barrier]. It can't switch to Active Mode until the start of your next turn"
 * (BT5-101 Time Magic). The lock is a recorded `forbid switchToActive`; it used
 * to bind only the Charge Phase's Active Step and the UI, so a skill's switch
 * to Active Mode still stood the card up.
 *
 * Now every path a skill uses to switch a card to Active Mode (`host.setMode`)
 * honours it: an [Activate], an [Auto], and [Dual Attack]'s stand at the end of
 * the battle (the card's official Q&A: neither the "when this card attacks,
 * switch this card to Active Mode" Auto nor [Dual Attack] switches the locked
 * card). When the attacker's Auto resolves relative to the counter is #1139 and
 * is not touched here: the attacker is locked first, then its Auto or [Dual
 * Attack] tries to stand it.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { forbiddenForCard } from "../../src/lib/arena/vm/program";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const TIME_MAGIC = "[Counter: Attack] Your Leader Card is yellow: Negate the attack, then choose up to 1 of your opponent's Battle Cards in Rest Mode ignoring [Barrier]. It can't switch to Active Mode until the start of your next turn.";
const defs: Record<string, CardDef> = { ...DEFS,
  "L-YEL1138": card("L-YEL1138", { type: "LEADER", colors: ["Yellow"], energyCost: null, comboCost: null, comboPower: null }),
  TM1138: card("TM1138", { type: "EXTRA", colors: ["Yellow"], energyCost: 0, power: null, comboCost: null, comboPower: null, skill: TIME_MAGIC }),
  DUAL1138: card("DUAL1138", { energyCost: 0, power: 10000, skill: "[Dual Attack]" }),
  AUTO1138: card("AUTO1138", { energyCost: 0, power: 10000, skill: "[Auto] When this card attacks, switch this card to Active Mode." }),
  PLAIN1138: card("PLAIN1138", { energyCost: 0, power: 10000 }),
  REST1138: card("REST1138", { energyCost: 0, power: 5000 }),
  STAND1138: card("STAND1138", { energyCost: 0, power: 5000, skill: "[Activate: Main] Choose up to 1 of your Battle Cards in Rest Mode and switch it to Active Mode." }),
};
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(JSON.parse(JSON.stringify(rows)), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");

function take(s: VmState, action: Action): VmState {
  return RULES.apply(ctx, roundtrip(s), action).state as VmState;
}
/** Turn 1 is p1's: p1 at its Main Phase, p2's leader made yellow so Time Magic's condition holds. */
function fresh(): VmState {
  let s = RULES.createGame(ctx, { seed: 1138, p1: { name: "First", leader: "L-RED", main: fifty("V1") }, p2: { name: "Second", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  for (const action of [
    { type: "chooseFirst", player: s.chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null }, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null },
    { type: "endMain", player: "p2" }, { type: "charge", player: "p1", card: null },
  ] as Action[]) s = take(s, action);
  assert.equal(s.prompt.kind, "main");
  assert.equal((s.prompt as { player: PlayerId }).player, "p1");
  s.cards[s.sides.p2.zones.leader[0]].cardId = "L-YEL1138";
  return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: string, mode: "active" | "rest" = "active"): string {
  const id = s.sides[p].zones.deck[0]; s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (area === "battle") s.cards[id].mode = mode;
  return id;
}
const modeOf = (s: VmState, id: string) => s.cards[id].mode;
const locked = (s: VmState, id: string) => forbiddenForCard(ctx, game, s, "switchToActive", id);

/** Answer the battle's prompts; p2 plays Time Magic at the first counter window when `counter`, choosing `pick` (or the first candidate). */
function fight(s: VmState, attacker: string, counter: boolean, pick: string | null = null): VmState {
  const target = s.sides.p2.zones.leader[0];
  const atk = RULES.legalActions(ctx, s).find((l) => l.action.type === "attack" && l.action.attacker === attacker && l.action.target === target);
  assert.ok(atk, "the attack is offered");
  s = take(s, atk.action);
  let used = false;
  for (let i = 0; i < 40 && (s.battle || s.prompt.kind !== "main"); i++) {
    const q = s.prompt;
    if (q.kind === "counter") {
      const tm = !used && counter && q.player === "p2" ? q.candidates.find((c) => s.cards[c].cardId === "TM1138") : undefined;
      if (tm) used = true;
      s = take(s, { type: "counter", player: q.player, card: tm ?? null });
    } else if (q.kind === "blocker" || q.kind === "combo") s = take(s, { type: "pass", player: q.player } as Action);
    else if (q.kind === "chooseCards") s = take(s, { type: "choose", player: q.player, cards: pick && q.choice.candidates.includes(pick) ? [pick] : q.choice.candidates.slice(0, Math.max(q.choice.min, 1)) });
    else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: q.player, index: 0 });
    else if (q.kind === "main") break;
    else throw new Error(`unexpected prompt ${q.kind}`);
  }
  assert.equal(!counter || used, true, "Time Magic was played");
  assert.equal(s.prompt.kind, "main");
  return s;
}

// 1. [Dual Attack]: the attacker is Rest at the counter window, Time Magic chooses it, and its stand at the end of the battle is refused.
{
  const control = fresh();
  const d0 = stage(control, "p1", "DUAL1138", "battle");
  const c = fight(control, d0, false);
  assert.equal(modeOf(c, d0), "active", "control: with no lock [Dual Attack] stands the card");

  const s = fresh();
  const d = stage(s, "p1", "DUAL1138", "battle");
  stage(s, "p2", "TM1138", "hand");
  const r = fight(s, d, true, d);
  assert.ok(locked(r, d), "the lock is recorded on the chosen card");
  assert.equal(modeOf(r, d), "rest", "[Dual Attack] does not switch the locked card (BT5-101 Q&A)");
}

// 2. An [Activate: Main] of the opponent's own, and the control without the lock.
{
  const control = fresh();
  const rest0 = stage(control, "p1", "REST1138", "battle", "rest");
  const src0 = stage(control, "p1", "STAND1138", "battle");
  let c = take(control, RULES.legalActions(ctx, control).find((l) => l.action.type === "activate" && l.action.card === src0)!.action);
  for (let i = 0; i < 6 && c.prompt.kind === "chooseCards"; i++) c = take(c, { type: "choose", player: c.prompt.player, cards: [rest0] });
  assert.equal(modeOf(c, rest0), "active", "control: the skill stands an unlocked Rest card");

  const s = fresh();
  const attacker = stage(s, "p1", "PLAIN1138", "battle");
  const rested = stage(s, "p1", "REST1138", "battle", "rest");
  const src = stage(s, "p1", "STAND1138", "battle");
  stage(s, "p2", "TM1138", "hand");
  let r = fight(s, attacker, true, rested);
  assert.ok(locked(r, rested));
  assert.equal(modeOf(r, rested), "rest");
  const act = RULES.legalActions(ctx, r).find((l) => l.action.type === "activate" && l.action.card === src);
  assert.ok(act, "the opponent's Activate is offered");
  {
    r = take(r, act.action);
    for (let i = 0; i < 6 && r.prompt.kind === "chooseCards"; i++) r = take(r, { type: "choose", player: r.prompt.player, cards: r.prompt.choice.candidates.includes(rested) ? [rested] : r.prompt.choice.candidates.slice(0, 1) });
  }
  assert.equal(modeOf(r, rested), "rest", "an Activate's switch to Active Mode does not stand the locked card");
  assert.ok(locked(r, rested), "and the lock holds until the start of the owner's next turn");
}

// 3. The attacker's own "when this card attacks, switch this card to Active Mode" Auto, with the lock already on it.
{
  const s = fresh();
  const first = stage(s, "p1", "PLAIN1138", "battle");
  stage(s, "p2", "TM1138", "hand");
  const r = fight(s, first, true, first);
  const lock = r.effects.find((e) => e.kind === "forbid" && e.target === first && e.forbid?.what === "switchToActive");
  assert.ok(lock, "Time Magic recorded its lock");
  const auto = stage(r, "p1", "AUTO1138", "battle");
  r.effects.push({ ...roundtrip(lock!), id: Math.max(...r.effects.map((e) => e.id)) + 1, target: auto });
  assert.ok(locked(r, auto), "the attacker is locked before it attacks");
  const done = fight(r, auto, false);
  assert.equal(modeOf(done, auto), "rest", "the Auto's switch does not stand the locked attacker (BT5-101 Q&A)");

  // The same Auto without a lock does stand it.
  const free = fresh();
  const a = stage(free, "p1", "AUTO1138", "battle");
  assert.equal(modeOf(fight(free, a, false), a), "active", "control: unlocked, the Auto stands the attacker");
}

// 4. The lock is the card's own: a different Rest card is not locked, and neither is a leader.
{
  const s = fresh();
  const attacker = stage(s, "p1", "PLAIN1138", "battle");
  const lockedCard = stage(s, "p1", "REST1138", "battle", "rest");
  const free = stage(s, "p1", "REST1138", "battle", "rest");
  stage(s, "p2", "TM1138", "hand");
  const r = fight(s, attacker, true, lockedCard);
  assert.ok(locked(r, lockedCard)); assert.ok(!locked(r, free)); assert.ok(!locked(r, r.sides[other("p2")].zones.leader[0]));
}
