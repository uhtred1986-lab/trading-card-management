/**
 * #939: BT31-116 (Cell) invoking BT31-141 (Cell Jr. Summon) from the hand.
 *
 * The Leader's [Auto] activates a mono-white cost-2 hand Extra's
 * [Activate: Main/Battle] skill (official card FAQ, BT31-116 Q1: that Extra goes
 * to the Drop). BT31-141's skill then runs as a nested invocation, and its token
 * op must bind the two tokens *that invocation* made: Blocker lands on those two,
 * never on a Cell Jr. Token already in play (either side), on both seats, and
 * survives a reload. No BT31-141-specific FAQ or erratum exists (card_faq.php,
 * read 18 Oct 2026), so the reading rests on the printed text and rule 19-1.
 */
import assert from "node:assert/strict";
import { compileCard } from "../../src/lib/arena/compile";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { hasKeyword } from "../../src/lib/arena/vm/program";
import { vmHost } from "../../src/lib/arena/vm/host";
import { withTokens } from "../../src/lib/arena/vm/cards";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { stepScript, type Op, type ScriptFrame } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, PlayerId } from "../../src/lib/arena/types";
import { CTX, DEFS, card, fifty, rulesFromCompiler } from "./harness";

const AUTO = "[Auto] Switch 1 of your energy to Hidden Mode: When your <Cell> or <Cell Jr.> card—both white and with an energy cost of 3 or more—is played, activate an [Activate: Main/Battle] skill of up to 1 mono-white Extra with an energy cost of 2 in your hand.";
const SUMMON = "[Activate: Main/Battle] Play 2 Cell Jr. Tokens and they gain [Blocker] for the turn. (Cell Jr. Tokens have 10000 power, 0 combo cost, and 5000 combo power.)";
const defs = {
  ...DEFS,
  "L-CELL": card("L-CELL", { type: "LEADER", colors: ["White"], energyCost: null, comboCost: null, comboPower: null, skill: AUTO }),
  "C939-CELL": card("C939-CELL", { colors: ["White"], characters: ["Cell"], energyCost: 3, skill: null }),
  "C939-ENERGY": card("C939-ENERGY", { colors: ["White"], skill: null }),
  "C939-SUMMON": card("C939-SUMMON", { type: "EXTRA", colors: ["White"], energyCost: 2, power: null, comboCost: null, comboPower: null, skill: SUMMON }),
};
const ctx = withTokens({ ...CTX, defs, scripts: rulesFromCompiler(defs) });
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const dbs = loaded.definition;
const reload = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");
const take = (s: VmState, a: Action): VmState => {
  assert.ok(RULES.legalActions(ctx, s).some((l) => JSON.stringify(l.action) === JSON.stringify(a)), JSON.stringify({ prompt: s.prompt, a }));
  return RULES.apply(ctx, reload(s), a).state as VmState;
};
const blocker = (s: VmState, id: string) => hasKeyword(ctx, dbs, s, id, "Blocker");
const jrs = (s: VmState, p: PlayerId) => s.sides[p].zones.battle.filter((id) => ctx.defs[s.cards[id].cardId]?.name === "Cell Jr. Token");
const JR = { op: "token", name: "Cell Jr. Token", power: 10000, comboCost: 0, comboPower: 5000, colors: [] as never[], n: 1 } as Op;
function made(s: VmState, p: PlayerId): string[] {
  const before = new Set(Object.keys(s.cards));
  const frame = { ops: [JR], ip: 0, vars: {}, card: s.sides[p].zones.leader[0], master: p } as unknown as ScriptFrame;
  stepScript(vmHost(ctx, dbs, s, []), frame);
  return Object.keys(s.cards).filter((id) => !before.has(id));
}
function stage(s: VmState, p: PlayerId, id: keyof typeof defs, area: "hand" | "energy"): string {
  const physical = s.sides[p].zones.deck[0];
  s.cards[physical].cardId = id;
  assert.ok(moveCard(s, dbs, physical, area, { owner: p }).ok);
  return physical;
}

for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  const leaders = seat === "p1" ? { p1: "L-CELL", p2: "L-BLUE" } : { p1: "L-RED", p2: "L-CELL" };
  let s = RULES.createGame(ctx, { seed: 939_300, p1: { name: "One", leader: leaders.p1, main: fifty("V1") }, p2: { name: "Two", leader: leaders.p2, main: fifty("V-BLUE") } }).state as VmState;
  s = RULES.apply(ctx, s, { type: "chooseFirst", player: s.chooser, first: "p1" }).state as VmState;
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) s = RULES.apply(ctx, s, { type: "pass", player: (s.prompt as { player: PlayerId }).player }).state as VmState;
  if (seat === "p2") { s = take(s, { type: "endMain", player: "p1" }); s = take(s, { type: "charge", player: "p2", card: null }); }
  assert.equal(s.turnPlayer, seat);
  const energy = Array.from({ length: 4 }, () => stage(s, seat, "C939-ENERGY", "energy"));
  const cell = stage(s, seat, "C939-CELL", "hand");
  const extra = stage(s, seat, "C939-SUMMON", "hand");
  const oldMine = made(s, seat), oldTheirs = made(s, foe);

  s = take(s, { type: "play", player: seat, card: cell });
  if (s.prompt.kind === "payCost") s = take(s, { type: "payCost", player: seat, option: 0 });
  assert.equal(s.prompt.kind, "chooseMode", "the Leader's Auto asks for its Hidden Mode price");
  s = take(s, { type: "chooseMode", player: seat, index: 0 });
  s = take(s, { type: "choose", player: seat, cards: [energy[3]] });
  assert.equal(s.prompt.kind, "chooseCards", "up to one eligible hand Extra");
  s = reload(s); // reload before the follow-up
  s = take(s, { type: "choose", player: seat, cards: [extra] });
  assert.ok(s.sides[seat].zones.drop.includes(extra), "FAQ BT31-116 Q1: the invoked Extra goes to the Drop");
  assert.equal(s.prompt.kind, "main", "no extra choice for the tokens");
  const fresh = jrs(s, seat).filter((id) => !oldMine.includes(id));
  assert.equal(fresh.length, 2, "exactly the invocation's two tokens");
  for (const id of fresh) {
    assert.equal(blocker(s, id), true, "nested invocation: the new tokens have Blocker");
    assert.equal(s.cards[id].owner, seat);
  }
  for (const id of [...oldMine, ...oldTheirs]) assert.equal(blocker(s, id), false, "existing tokens, either side, gain nothing");
  s = reload(s);
  for (const id of fresh) assert.equal(blocker(s, id), true, "after a reload");
  assert.equal(blocker(s, oldMine[0]), false);
}
console.log("  ok  #939 BT31-116 invoking BT31-141: Blocker on exactly the invocation's two tokens");

// Neighbours: the same "play a Token … and it/that card gains …" wording with a power or a comma
// in between. Each used to give the effect to the card that played the token ("this card").
{
  const texts: Record<string, string> = {
    "BT26-079": "[Auto] When this card is played, play 1 Shadow Token, and that card gets +10000 power and [Blocker] until the end of your opponent's turn. (Shadow Tokens have 10000 power, 0 combo power, and 5000 combo power)",
    "BT28-020": "[Auto][Limit 1] When this card or your opponent's Battle Card is played, play 1 Frieza's Army Token with 10000 power, and it gains [Barrier] and [Blocker] until the end of your opponent's turn.",
    "BT31-134": "[Auto] When this card is played, play 2 Ghost Tokens with 15000 power, and they gain [Blocker] and [Revenge] for the turn.",
    "EB1-48": "[Counter: Attack] If your Leader Card is mono-yellow: Negate the attack, then play 1 Frieza's Army Token with 10000 power and it gains [Blocker] for the turn.",
    "EX22-07": "[Auto]{u}, if your Leader is a blue <Goku Black>: When this card is played, draw 1 card, play 1 Shadow Token (10000 power, 0 combo cost, and 5000 combo power), and that card gains [Blocker] for the turn.",
  };
  for (const [id, skill] of Object.entries(texts)) {
    const line = compileCard(card(`N-${id}`, { skill })).bySkill[0];
    const flat = line.ops.flatMap((o) => (o.op === "if" ? o.then : [o]));
    const tok = flat.find((o) => o.op === "token");
    assert.ok(tok && tok.op === "token" && tok.as, `${id}: the token play is named`);
    const as = tok && tok.op === "token" ? tok.as : "";
    const effects = flat.filter((o) => o.op === "grant" || o.op === "power");
    assert.ok(effects.length >= 1, `${id}: reads an effect on the token`);
    for (const g of effects) assert.deepEqual("target" in g ? g.target : null, { var: as }, `${id}: the effect is on the token, not on this card`);
  }
  console.log("  ok  #939 neighbours: 'with N power, and it/that card gains' binds the token");
}
