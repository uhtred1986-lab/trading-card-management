/**
 * #907, follow-up to #1042 (`battleEnd` delays now run): the misreads in the immediate half of the skills whose
 * delayed half switched on, the six combo-entry Autos #1042 had to refuse, and "after the battle".
 *
 *  1. Leader condition (BT18-082, BT18-085, P-704 …): "a green <King Piccolo> or <Piccolo Jr.> card with an original
 *     power of 15000" is ONE description with two names; colour and power belong to both.
 *  2. Where the card is used from (BT21-049, BT23-016 …, BT18-082 …): "from under a {X}" is the pile under X (the
 *     test `onTop` already asks), "from your Drop" is the area the line is used from (9-1-3-2); "you have a <Baby> in
 *     a battle" is a card of yours IN the battle.
 *  3. P-703 and the Frieza's Army / Turles look-and-use family: the card comes from the cards looked at.
 *  4. BT22-027 and the "attacks or activates [Blocker]" family answer to the block too; "when you activate this
 *     card's [Blocker]" (BT1-087 …) is the block, not a play.
 *  5. The six refused combo-entry Autos, read: the origin, the skill that made the combo, the company in the battle;
 *     EX23-23's "in your deck or hand".
 *  6. BT1-015's "KO that card after the battle": the card attacked (before any block), at the Battle End Step.
 *
 * Rules engine only; nothing reads the database. Wordings are the catalog's text of 18 Oct 2026.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, compileSkill, fifty, parseSkills } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { attrsNow } from "../../src/lib/arena/vm/program";
import { matches } from "../../src/lib/arena/text/filters";
import { autoTriggerMatches, comboEntryFromHand, comboEntryQualifier } from "../../src/lib/arena/text/triggers";
import { describeScript, validateProgram, type Cond, type Op } from "../../src/lib/arena/vm/script";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const compile = (text: string) => compileSkill(parseSkills(text)[0]);
const clean = (text: string) => {
  const s = compile(text);
  assert.deepEqual(s.unsupported, [], `reads whole: ${text}`);
  assert.ok(validateProgram(s.ops), `valid program: ${text}`);
  return s;
};
// A program is JSON of many shapes; the checks below read it by path.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const find = (ops: unknown, op: string): Loose[] => {
  const out: Loose[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      if ((v as { op?: string }).op === op) out.push(v as Loose);
      Object.values(v).forEach(walk);
    }
  };
  walk(ops);
  return out;
};
const firstCond = (ops: Op[]): Cond => (ops[0] as { cond: Cond }).cond;
const triggers = (text: string, names: string[]) => names.filter((n) => autoTriggerMatches(parseSkills(text)[0], n as never));

// ── 1. the Leader condition ──────────────────────────────────────────────────
{
  const BT18_082 = "[Activate: Battle][Limit 1] If your Leader is a green <King Piccolo> or <Piccolo Jr.> card with an original power of 15000: Use this card in a combo from your Drop. At the end of the battle, send this card from your Drop to your Warp.";
  const s = clean(BT18_082);
  const cond = firstCond(s.ops) as Extract<Cond, { kind: "leaderMatches" }>;
  assert.equal(cond.kind, "leaderMatches", "one description, not two alternatives");
  const leader = (o: Partial<CardDef>) => card("LD907", { type: "LEADER", colors: ["Green"], characters: ["King Piccolo"], power: 15000, ...o });
  assert.ok(matches(leader({}), cond.filter), "a green King Piccolo of 15000");
  assert.ok(matches(leader({ characters: ["Piccolo Jr."] }), cond.filter), "a green Piccolo Jr. of 15000 - colour and power are shared");
  assert.ok(!matches(leader({ power: 10000 }), cond.filter), "the power is asked of King Piccolo too");
  assert.ok(!matches(leader({ characters: ["Piccolo Jr."], colors: ["Red"] }), cond.filter), "and the colour of Piccolo Jr.");
  assert.ok(!matches(leader({ characters: ["Vegeta"] }), cond.filter));
  // The same description in front of a count (P-704): the colour is shared too.
  const p704 = clean("[Permanent] If your Leader is a green <King Piccolo> or <Piccolo Jr.> card and you have 3 or more energy, reduce the energy cost of this card in your hand by 5.");
  const c704 = find(p704.ops, "if")[0].cond as Extract<Cond, { kind: "leaderMatches" }>;
  assert.equal(c704.kind, "leaderMatches");
  assert.ok(!matches(leader({ characters: ["Piccolo Jr."], colors: ["Red"] }), c704.filter));
  // "<A> or <B> card" with no qualifier to share keeps its two alternatives, and so does a colour on the second name.
  const plain = clean("[Auto][Limit 1]{g}, if your Leader is a <Zamasu> or <Goku Black> card: When this card is played, draw 1 card.");
  assert.equal((find(plain.ops, "if")[0].cond as Cond).kind, "any", "nothing to share: two alternatives as before");
  const second = clean("[Auto] If your Leader is a <Vegeta> or red <Bulma> card: When this card is played, draw 1 card.");
  assert.equal((find(second.ops, "if")[0].cond as Cond).kind, "any", "a colour of its own on the second name: two alternatives as before");
}

// ── 2. where the card is used from ───────────────────────────────────────────
{
  const UTP = "[Activate: Battle][Limit 1] If it's your opponent's turn and you have a blue <Baby> in a battle: Use this card under a {Universal Tuffleization Plan} in a Battle Area in a combo. At the end of the battle, remove this card in the Drop from the game.";
  const s = clean(UTP);
  assert.ok(find(s.ops, "inBattle").length === 0 && JSON.stringify(s.ops).includes('"kind":"inBattle"'), "a <Baby> IN the battle, not just in play");
  const host = find(s.ops, "if").find((o) => o.cond?.sel?.special === "onTop");
  assert.ok(host, "the card is used from under {Universal Tuffleization Plan}");
  assert.deepEqual(host!.cond.sel.filter.names, ["universal tuffleization plan"]);
  assert.equal(find(host!.then, "comboFrom").length, 1);
  assert.ok(JSON.stringify(s.ops).includes('"at":"battleEnd"'));
  // BT23-018's "from under a {Destroyed West City} in your Battle Area … in a combo, then choose …".
  const west = clean("[Activate: Battle][Limit 1] If your red <Son Gohan: Future> or <Trunks: Future> card is in a battle: Use this card from under a {Destroyed West City} in your Battle Area in a combo, then choose up to 1 of your opponent's Battle Cards or Unisons and it gets -5000 power for the turn.");
  assert.ok(find(west.ops, "if").some((o) => o.cond?.sel?.special === "onTop"), "BT23-018: the same test");
  // BT24-091: the host (a yellow ≪Great Ape≫ card with a cost of 4) is also in the battle.
  const ape = clean("[Activate: Battle][Limit 1][Spirit Boost 1] Use this card in a combo from under a yellow ≪Great Ape≫ card with an energy cost of 4 that's in a battle.");
  const apeIf = find(ape.ops, "if")[0];
  assert.equal(apeIf.cond.kind, "inBattle");
  assert.equal(apeIf.cond.sel.special, "onTop");
  assert.deepEqual(apeIf.cond.sel.filter.traits, ["great ape"]);
  assert.equal(apeIf.cond.sel.filter.costMin, 4);
  // "From your Drop" is where the line is used from (9-1-3-2); it was read as "this card in your Drop" and named no area.
  for (const [text, area] of [
    ["[Activate: Battle] Use this card in a combo from your Drop.", "drop"],
    ["[Activate: Battle] Use this card from your Drop in a combo.", "drop"],
    ["[Activate: Battle][Limit 1] Use this card in a combo from its owner's energy.", "energy"],
    ["[Activate: Battle][Limit 1] Choose 1 Hidden Mode card in your Battle Area, switch it to Revealed Mode, and use it in a combo with its skills negated for the turn: Use this card from your hand in a combo.", "hand"],
  ] as const) {
    const t = text.includes(": Use this") ? text : text;
    const r = clean(t);
    const op = find(r.ops, "comboFrom").find((o) => o.target?.sel?.special === "self");
    assert.equal(op?.target.sel.area, area, t);
  }
  assert.equal(find(clean("[Activate: Battle] Use this card in a combo.").ops, "comboFrom")[0].target.sel.area, undefined, "no area named, none read");
}

// ── 3. the card comes from the cards looked at ───────────────────────────────
{
  const P703 = "[auto] When this card attacks, look at up to 5 cards from the top of your deck, use up to 1 mono-green ≪Demon Clan≫ card in a combo with its skills negated for the turn, shuffle your deck, then add this card to your Z-Energy at the end of the battle.";
  const s = clean(P703);
  const pick = find(s.ops, "choose")[0];
  assert.equal(pick.sel.fromVar, "looked", "P-703 uses a card from the five looked at");
  assert.equal(find(s.ops, "comboFrom")[0].target.var, pick.as);
  assert.match(describeScript(s.ops, {}), /of the cards looked at/);
  // Without a look in front, the description still names the cards in play as it always did.
  assert.equal(find(clean("[Activate: Battle] Use up to 1 green card with 5000 combo power from your Drop in a combo with its skills negated for the battle.").ops, "choose")[0].sel.fromVar, undefined);
}

// ── 4. attacks or activates [Blocker] ────────────────────────────────────────
{
  const BT22_027 = "[auto] When this card attacks or activates a [blocker] skill, switch this card to Active Mode, and this card gets -15000 power for the turn at the end of the battle.";
  assert.deepEqual(triggers(BT22_027, ["attacks", "blockerUsed", "played"]), ["attacks", "blockerUsed"]);
  assert.deepEqual(triggers("[Auto] When this card attacks, or activates the [Blocker] skill, use up to 1 mono-blue Battle Card with 5000 combo power from your Drop in a combo with its skills negated for the turn.", ["attacks", "blockerUsed"]), ["attacks", "blockerUsed"]);
  assert.deepEqual(triggers("[Auto] When this card attacks, draw 1 card.", ["attacks", "blockerUsed"]), ["attacks"]);
  assert.deepEqual(triggers("[Auto] When this card activates [Blocker], switch it to Active Mode.", ["attacks", "blockerUsed"]), ["blockerUsed"]);
  // Another card's attack or block is not this card's.
  assert.deepEqual(triggers("[Auto][Once per turn] When your black card with a [Union] skill or black Z-Unison attacks or activates the [Blocker] skill, draw 1 card and it gets +5000 power for the turn.", ["attacks", "blockerUsed"]), []);
  // "When you activate this card's [Blocker]" was read as a play ("when you activate this card" is an Extra's own play, 12-2).
  const BT1_087 = "[Auto] When you activate this card's [Blocker], switch this card to Active Mode after the battle.";
  assert.deepEqual(triggers(BT1_087, ["played", "blockerUsed"]), ["blockerUsed"]);
  assert.deepEqual(triggers("[Auto] When you activate this card, draw 1 card.", ["played", "blockerUsed"]), ["played"], "an Extra's own activation is still a play");
}

// ── 5. the combo-entry moments ───────────────────────────────────────────────
{
  const BT7_030 = "[Auto] When you combo with this card from an Energy Area using {Meteoric Energy SSB Vegito}'s skill, play this card at the end of the battle.";
  const BT8_030 = "[auto]{u}, during your turn: When you combo with this card from your hand with an <Android 18> card in battle, play this card at the end of the battle.";
  const BT24_116 = "[Auto][Limit 1] If your Leader's back side is a black <Vegito: Xeno> card, you have 2 or more energy, and you have a <Vegeta: Xeno> card in your Combo Area: When this card is used in a combo from your hand, add this card from your Drop to your Z-Energy at the end of the battle.";
  const EX23_23 = "[Auto] If your Leader is a ≪Turles Crusher Corps≫ card: When this card in your deck or hand is used in a combo, play this card from your Drop in Rest Mode at the end of the battle.";
  const q = (t: string) => comboEntryQualifier(parseSkills(t)[0]);
  assert.deepEqual(q(BT7_030), { origins: ["energy"], viaSkillOf: "Meteoric Energy SSB Vegito" });
  assert.deepEqual(q(BT8_030), { origins: ["hand"], company: "<android 18> card" });
  assert.deepEqual(q(BT24_116), { origins: ["hand"] });
  assert.deepEqual(q(EX23_23), { origins: ["deck", "hand"] });
  for (const t of [BT7_030, BT8_030, BT24_116, EX23_23]) {
    clean(t);
    assert.ok(autoTriggerMatches(parseSkills(t)[0], "comboUsed"), `${t.slice(0, 60)} answers to the combo entry`);
  }
  // The plain wordings are NOT qualified: "in your hand" keeps its own reader, and a plain combo is any combo.
  for (const t of [
    "[auto][limit 1]{g}, if your Leader is a <Zamasu> or <Goku Black> card: When this card in your hand is used in a combo, play this card from your Drop at the end of the battle.",
    "[Auto] If your Leader Card is red and you have a red Unison Card in play: When this card is used in a combo, draw 1 card, then at the end of the battle, place this card in its owner's Drop Area.",
    "[Auto] When you combo with this card, draw 1 card.",
    "[Auto] When you combo with this card from your hand, draw 1 card.",
  ]) assert.equal(q(t), null, t);
  assert.equal(comboEntryFromHand(parseSkills("[Auto] When this card in your hand is used in a combo, draw 1 card.")[0]), true, "comboEntryFromHand is unchanged");
  assert.equal(comboEntryFromHand(parseSkills(BT24_116)[0]), false, "and unchanged for the new wording");
  // BT8-030's company is a condition on the program: one of your <Android 18> cards is in the battle.
  const company = clean(BT8_030);
  assert.ok(JSON.stringify(company.ops).includes('"kind":"inBattle"'), "an <Android 18> card of yours in the battle");
  // What nobody reads is still refused (#1042's guard).
  assert.ok(compile("[Auto] When you combo with this card from a Drop Area, play this card at the end of the battle.").unsupported.length > 0);
}

// ── 6. "after the battle" ────────────────────────────────────────────────────
{
  const BT1_015 = "[auto] When this card attacks a Battle Card, KO that card after the battle. Then, if your opponent's Leader Card has 10000 or less power, inflict 1 damage to your opponent.";
  const s = clean(BT1_015);
  const pick = find(s.ops, "choose")[0];
  assert.deepEqual(pick.sel, { special: "guard" }, "the card attacked, chosen now (before any block)");
  const delay = find(s.ops, "delay")[0];
  assert.equal(delay.at, "battleEnd");
  assert.deepEqual(delay.ops, [{ op: "ko", target: { var: pick.as } }], "only the KO waits - the damage clause is not pulled in");
  assert.equal(find(s.ops, "damage").length, 1);
  assert.equal(find(delay.ops, "damage").length, 0);
  // The sibling timing: "switch this card to Active Mode after the battle" is the same delay on this card.
  const BT1_087 = clean("[Auto] When you activate this card's [Blocker], switch this card to Active Mode after the battle.");
  assert.equal(find(BT1_087.ops, "delay")[0].at, "battleEnd");
  // A [Permanent] never resolves: P-087's feed breaks the [Dual Attack] reminder at a <br> and the tail must stay unread.
  assert.ok(compile("[Permanent] switch this card to Active Mode after the battle.)").unsupported.length > 0);
  // Only an attack on a Battle Card names the card: after any other trigger no `guard` is chosen.
  assert.equal(find(compile("[auto] When this card attacks, KO that card after the battle.").ops, "choose").filter((o) => o.sel?.special === "guard").length, 0);
}

console.log("#907 battle-end follow-ups: readings passed");

// ── the VM ───────────────────────────────────────────────────────────────────
const NEG = card("NEG907", { type: "EXTRA", colors: ["Blue"], energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Counter: Attack] Negate the attack." });
const BT1_015_TEXT = "[auto] When this card attacks a Battle Card, KO that card after the battle. Then, if your opponent's Leader Card has 10000 or less power, inflict 1 damage to your opponent.";
const BT22_027_TEXT = "[auto] When this card attacks or activates a [blocker] skill, switch this card to Active Mode, and this card gets -15000 power for the turn at the end of the battle.";
const defs: Record<string, CardDef> = { ...DEFS, NEG907: NEG,
  FROST907: card("FROST907", { energyCost: 0, power: 30000, skill: BT1_015_TEXT }),
  TARGET907: card("TARGET907", { colors: ["Blue"], energyCost: 2, power: 5000 }),
  WALL907: card("WALL907", { colors: ["Blue"], energyCost: 2, power: 50000, skill: "[Blocker]" }),
  GUARD907: card("GUARD907", { colors: ["Blue"], energyCost: 2, power: 40000, skill: BT22_027_TEXT + "\n[Blocker]" }),
  BIG907: card("BIG907", { energyCost: 0, power: 20000 }),
};
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");

function take(s: VmState, action: Action): VmState {
  return RULES.apply(ctx, roundtrip(s), action).state as VmState; // every step runs on a reloaded copy
}
function fresh(player: PlayerId): VmState {
  let s = RULES.createGame(ctx, { seed: 907, p1: { name: "First", leader: "L-RED", main: fifty("V1") }, p2: { name: "Second", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  for (const action of [
    { type: "chooseFirst", player: s.chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null }, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null },
    ...(player === "p1" ? [{ type: "endMain", player: "p2" }, { type: "charge", player: "p1", card: null }] : []),
  ] as Action[]) s = take(s, action);
  assert.equal(s.prompt.kind, "main");
  assert.equal((s.prompt as { player: PlayerId }).player, player);
  return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: string, mode: "active" | "rest" = "active"): string {
  const id = s.sides[p].zones.deck.find((x) => !Object.values(s.sides).some((side) => Object.values(side.zones).some((z) => z !== s.sides[p].zones.deck && z.includes(x)))) ?? s.sides[p].zones.deck[0];
  s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (area === "battle") s.cards[id].mode = mode;
  return id;
}
const zoneOf = (s: VmState, p: PlayerId, zone: string) => s.sides[p].zones[zone];

/** Answer whatever the battle asks until the turn player is back in the Main Phase; `blockWith` blocks, `counter` is the defender's counter. */
function fight(s: VmState, seat: PlayerId, attacker: string, target: string, o: { blockWith?: string; counter?: string } = {}, seen: (s: VmState) => void = () => undefined): VmState {
  const atk = RULES.legalActions(ctx, s).find((l) => l.action.type === "attack" && l.action.attacker === attacker && l.action.target === target);
  assert.ok(atk, "the attack is offered");
  s = take(s, atk.action);
  for (let i = 0; i < 60 && (s.battle || s.prompt.kind !== "main"); i++) {
    seen(s);
    const q = s.prompt;
    if (q.kind === "counter") {
      const pick = o.counter && q.player === other(seat) && q.candidates.includes(o.counter) ? o.counter : null;
      s = take(s, { type: "counter", player: q.player, card: pick });
    } else if (q.kind === "blocker") s = take(s, { type: "block", player: q.player, card: o.blockWith && q.player === other(seat) ? o.blockWith : null } as Action);
    else if (q.kind === "combo") s = take(s, { type: "pass", player: q.player } as Action);
    else if (q.kind === "chooseCards") s = take(s, { type: "choose", player: q.player, cards: q.choice.candidates.slice(0, Math.max(q.choice.min, 1)) });
    else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: q.player, index: 0 });
    else if (q.kind === "main") break;
    else throw new Error(`unexpected prompt ${q.kind}`);
  }
  assert.equal(s.prompt.kind, "main", "the battle is over and the turn player is back in the Main Phase");
  assert.equal(s.battle, null);
  return s;
}

for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  // BT1-015: the attacked card is KO'd after the battle; a Blocker does not change which; a negated attack still pays it.
  {
    const s = fresh(seat);
    const me = stage(s, seat, "FROST907", "battle");
    const target = stage(s, foe, "TARGET907", "battle", "rest");
    const life = zoneOf(s, foe, "life").length;
    let early = 0;
    const r = fight(s, seat, me, target, {}, (st) => {
      if (st.battle && st.battle.step !== "battleEnd") { assert.ok(zoneOf(st, foe, "battle").includes(target), `${seat}: the target stays until the battle ends`); early++; }
    });
    assert.ok(early > 0);
    assert.ok(zoneOf(r, foe, "drop").includes(target), `${seat}: the attacked card was KO'd after the battle`);
    assert.equal(zoneOf(r, foe, "life").length, life - 1, `${seat}: the damage clause is the immediate half (Leader at 10000)`);
    assert.equal(r.delayed.length, 0);
  }
  {
    const s = fresh(seat);
    const me = stage(s, seat, "FROST907", "battle");
    const target = stage(s, foe, "TARGET907", "battle", "rest");
    const wall = stage(s, foe, "WALL907", "battle", "active");
    const r = fight(s, seat, me, target, { blockWith: wall });
    assert.ok(zoneOf(r, foe, "drop").includes(target), `${seat}: FAQ BT1-015 A1: KO the original target of the attack`);
    assert.ok(zoneOf(r, foe, "battle").includes(wall), `${seat}: not the card that blocked`);
  }
  {
    const s = fresh(seat);
    const me = stage(s, seat, "FROST907", "battle");
    const target = stage(s, foe, "TARGET907", "battle", "rest");
    const neg = stage(s, foe, "NEG907", "hand");
    const r = fight(s, seat, me, target, { counter: neg });
    assert.ok(zoneOf(r, foe, "drop").includes(target), `${seat}: FAQ BT1-015 A2: a negated attack still resolves the skill`);
  }
  // BT22-027: the block is a moment of the skill too - the card wakes up and loses the power when the battle ends.
  {
    const s = fresh(seat);
    const me = stage(s, seat, "BIG907", "battle");
    const guard = stage(s, foe, "GUARD907", "battle");
    let during = -1;
    const r = fight(s, seat, me, s.sides[foe].zones.leader[0], { blockWith: guard }, (st) => {
      if (st.battle && st.battle.step === "damage") during = attrsNow(ctx, game, st, guard).power as number;
    });
    assert.ok(zoneOf(r, foe, "battle").includes(guard), `${seat}: the blocker survived (40000 against 20000)`);
    assert.equal(r.cards[guard].mode, "active", `${seat}: switched back to Active Mode by its own skill`);
    assert.equal(attrsNow(ctx, game, r, guard).power, 25000, `${seat}: and -15000 power once the battle ended`);
    assert.notEqual(during, 25000);
  }
}
console.log("#907 battle-end follow-ups: BT1-015 and BT22-027 played on both seats");
