/**
 * #1166: skills granted in quotation marks.
 *
 * BT29-083 (Elite Teamwork) prints "[activate: main] Play up to 1 yellow
 * ≪Ginyu Force≫ card with an energy cost of 4 from your Drop, and your ≪Ginyu
 * Force≫ Leader gains the following skill for the turn-" and, on the next line,
 * the skill it grants, in quotation marks: "[auto][bond 2] ≪Ginyu Force≫ card:
 * When your ≪Ginyu Force≫ card is played by this card's skill, it gets +5000
 * power for the turn." The catalog stores that line as a row of its own
 * (BT29-083#10), which read as an unread [Permanent] of the Extra.
 *
 * Now: `parseSkills` links the two lines (`grants` / `granted`); the quoted row
 * is recorded as the skill it quotes, "granted by skill #0", and is never one
 * of the card's own skills; the granting line compiles to `copySkills(quoted:
 * true)` of that line onto the Leader for the turn, made before the play so
 * the Leader's new [Auto] answers to it; and "this card's skill" in the granted
 * line names BT29-083, the card whose skill granted it (`byCard` against the
 * grant's source).
 *
 * BT23-097 (Disposal of the Ringleader) shares the shape with a chosen target:
 * "Choose up to 1 ≪God≫ card in your Battle Area, and during this turn it gets
 * +5000 power and the following skill: "[Auto][Once per turn] When this card
 * attacks, choose up to 1 of your opponent's Battle Cards and KO it.""
 *
 * Proof on the exact printed texts, through stored rows (`skillRecords` → JSON →
 * `rulesFromRows`), for both seats, with the state reloaded from JSON between
 * every action.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { compileSkill } from "../../src/lib/arena/compile";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { recordContractGaps, rulesFromRows, runtimeSupportOfRow, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { skillsShowing } from "../../src/lib/arena/vm/triggers";
import { isCopiedSkill } from "../../src/lib/arena/vm/common";
import type { Op } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";

// ── the printed texts ────────────────────────────────────────────────────────
const BT29_083_0 = "[activate: main] Play up to 1 yellow ≪Ginyu Force≫ card with an energy cost of 4 from your Drop, and your ≪Ginyu Force≫ Leader gains the following skill for the turn-";
const BT29_083_10 = "\"[auto][bond 2] ≪Ginyu Force≫ card: When your ≪Ginyu Force≫ card is played by this card's skill, it gets +5000 power for the turn.\"";
const BT23_097_0 = "[Activate: Main] If your Leader is green: Choose up to 1 ≪God≫ card in your Battle Area, and during this turn it gets +5000 power and the following skill:";
const BT23_097_10 = "\"[Auto][Once per turn] When this card attacks, choose up to 1 of your opponent's Battle Cards and KO it.\"";
/** Another card's skill making the same play (no grant of its own). */
const OTHER_PLAY = "[Activate: Main] Play up to 1 ≪Ginyu Force≫ card with an energy cost of 4 from your Drop.";

const extra = (id: string, colors: CardDef["colors"], skill: string, traits: string[] = []): CardDef =>
  card(id, { type: "EXTRA", colors, energyCost: 0, power: null, comboCost: null, comboPower: null, traits, skill });
const leader = (id: string, colors: CardDef["colors"], traits: string[]): CardDef =>
  card(id, { type: "LEADER", colors, energyCost: null, comboCost: null, comboPower: null, traits });

const defs: Record<string, CardDef> = { ...DEFS,
  "BT29-083": extra("BT29-083", ["Yellow"], `${BT29_083_0}\n${BT29_083_10}`, ["Ginyu Force"]),
  "BT23-097": extra("BT23-097", ["Green"], `${BT23_097_0}\n${BT23_097_10}`),
  "L-GINYU": leader("L-GINYU", ["Yellow"], ["Ginyu Force"]),
  "L-GREEN": leader("L-GREEN", ["Green"], []),
  GINYU4: card("GINYU4", { colors: ["Yellow"], energyCost: 4, power: 10000, traits: ["Ginyu Force"] }),
  GINYU0: card("GINYU0", { colors: ["Yellow"], energyCost: 0, power: 10000, traits: ["Ginyu Force"] }),
  GINYU_OTHER: card("GINYU_OTHER", { colors: ["Yellow"], energyCost: 0, traits: ["Ginyu Force"], skill: OTHER_PLAY }),
  GOD: card("GOD", { colors: ["Green"], energyCost: 0, power: 10000, traits: ["God"] }),
  PLAIN: card("PLAIN", { colors: ["Red"], energyCost: 0, power: 5000 }),
};
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;

function opsDeep(node: unknown, out: Op[] = []): Op[] {
  if (Array.isArray(node)) for (const x of node) opsDeep(x, out);
  else if (node && typeof node === "object") {
    if (typeof (node as { op?: unknown }).op === "string") out.push(node as Op);
    for (const v of Object.values(node)) opsDeep(v, out);
  }
  return out;
}
const rowOf = (cardId: string, skillIndex: number) => {
  const row = rows.find((r) => r.cardId === cardId && r.skillIndex === skillIndex);
  assert.ok(row, `${cardId}#${skillIndex}: a stored row`);
  const back = roundtrip(row);
  assert.deepEqual(recordContractGaps(back), [], `${cardId}#${skillIndex}: the stored row needs no rebuild`);
  assert.deepEqual(runtimeSupportOfRow(back).unsupported, [], `${cardId}#${skillIndex}: the stored row is runnable`);
  return back as RuleRow & { ops: Op[]; unread: string[]; trigger: string[]; reads: string; kind: string };
};

// ── the reading ──────────────────────────────────────────────────────────────
{
  const [grant, quoted] = parseSkills(`${BT29_083_0}\n${BT29_083_10}`);
  assert.deepEqual(grant.grants?.index, 10, "BT29-083#0 grants line #10");
  assert.equal(quoted.granted?.by, 0, "BT29-083#10 is granted by #0");
  assert.equal(quoted.kind, "permanent", "the quoted line itself stays inert to every reader that knows nothing of grants");
  assert.equal(quoted.granted?.skill.kind, "auto");
  assert.equal(quoted.granted?.skill.bond, 2);
  // Alone (as `printed` holds it) the line is not linked: only its card's text says what grants it.
  assert.equal(parseSkills(BT29_083_10)[0].granted, undefined);

  const r0 = rowOf("BT29-083", 0);
  assert.deepEqual(r0.unread, [], "BT29-083#0 is read whole");
  const copy = r0.ops[0] as Extract<Op, { op: "copySkills" }>;
  assert.equal(copy.op, "copySkills", "the grant is made first, before the play");
  assert.deepEqual([copy.quoted, copy.skill, copy.until, JSON.stringify(copy.from)], [true, 10, "turn", JSON.stringify({ sel: { special: "self" } })], "BT29-083#0: this card's quoted line #10, for the turn");
  assert.equal((copy.target as { sel: { area?: string; side?: string } }).sel.area, "leader", "onto your ≪Ginyu Force≫ Leader");
  assert.deepEqual(r0.ops.slice(1).map((o) => o.op), ["choose", "play"], "then the play from the Drop");
  assert.match(r0.reads, /quoted skill \(line 2\) for the turn/);

  const r10 = rowOf("BT29-083", 10);
  assert.equal(r10.printed, BT29_083_10, "the row keeps the printed, quoted line");
  assert.equal(r10.kind, "auto", "recorded as the [Auto] it quotes");
  assert.deepEqual(r10.trigger, ["youPlayedByThisCard"]);
  assert.deepEqual(r10.unread, []);
  assert.match(r10.reads, /^granted by skill #0, not this card's own: /, "its reading says which line grants it");
  const power = opsDeep(r10.ops).find((o) => o.op === "power") as { amount?: number; target?: { sel?: { special?: string } } } | undefined;
  assert.deepEqual([power?.amount, power?.target?.sel?.special], [5000, "subject"], "+5000 on the card played");

  const g0 = rowOf("BT23-097", 0);
  assert.deepEqual(g0.unread, []);
  const ops = opsDeep(g0.ops);
  const gcopy = ops.find((o) => o.op === "copySkills") as Extract<Op, { op: "copySkills" }> | undefined;
  assert.ok(gcopy?.quoted && gcopy.skill === 10 && gcopy.until === "turn", "BT23-097#0: the chosen card gains line #10 for the turn");
  assert.ok(JSON.stringify(gcopy.target).includes('"var"'), "the chosen card, so after the choice");
  assert.ok(ops.findIndex((o) => o.op === "choose") < ops.indexOf(gcopy!), "the choice comes first");
  const g10 = rowOf("BT23-097", 10);
  assert.deepEqual([g10.kind, g10.trigger], ["auto", ["attacks"]]);

  // Refusals in the card's own words, never a guess (#1166's classification).
  const unread = (lines: string[]) => skillRecords(card("X", { skill: lines.join("\n") })).map((r) => r.unread);
  assert.match(unread(["[activate: main] Your Leader gains the following skill until the start of your turn:", "\"[Auto] When this card attacks, draw 1 card.\""])[0].join(" "), /duration "until the start of your turn" is not read/, "BT23-077's duration is refused, not read as the turn");
  assert.match(unread(["[permanent] Your opponent's Leader gains the following skill—", "\"[activate: main]{2}: Draw 1 card.\""])[0].join(" "), /\[Permanent\] granting/, "BT22-080's standing grant is refused");
  const absorb = unread(["[activate: main] Choose up to 1 of your green <Majin Buu> cards with an energy cost of 4 and it gains the following skill for the turn—", "\"[union absorb][once per turn] If your opponent has 2 or more energy, choose 1 Battle Card in your Drop and place it under this card: Play up to 1 green <Majin Buu> card with an energy cost of 6 from your Drop on top of this card in Active Mode.\""]);
  assert.match(absorb[0].join(" "), /granted skill \(line 2\) is not read/, "BT30-064: a granted [Union-Absorb] refuses the grant");
  assert.match(absorb[1].join(" "), /keyword skill granted in quotation marks/);
  const parentUnread = unread(["[permanent] Your opponent's Leader gains the following skill—", "\"[activate: main]{2}: Draw 1 card.\""]);
  assert.match(parentUnread[1].join(" "), /the skill that grants it \(#0\) is not read/, "a quoted line whose grant is unread is not read either");
  // A quoted line compiled alone (no line before it) stays the unread line it was.
  assert.ok(compileSkill(parseSkills(BT29_083_10)[0]).unsupported.length > 0);
}

// ── the VM, both seats ───────────────────────────────────────────────────────
let events: GameEvent[] = [];
function take(s: VmState, action: Action): VmState {
  const r = RULES.apply(ctx, roundtrip(s), action);
  events = events.concat(r.events as GameEvent[]);
  return roundtrip(r.state as VmState);
}
/** `p` in its second Main Phase, with `lead` as its Leader. */
function fresh(p: PlayerId, lead: string): VmState {
  const o: PlayerId = p === "p1" ? "p2" : "p1";
  const decks = { [p]: { name: "Me", leader: lead, main: fifty("V1") }, [o]: { name: "Foe", leader: "L-BLUE", main: fifty("V-BLUE") } } as Record<PlayerId, { name: string; leader: string; main: string[] }>;
  let s = RULES.createGame(ctx, { seed: 1166, p1: decks.p1, p2: decks.p2 }).state as VmState;
  for (const action of [
    { type: "chooseFirst", player: s.chooser, first: p },
    { type: "mulligan", player: p, redraw: false }, { type: "mulligan", player: o, redraw: false },
    { type: "charge", player: p, card: null }, { type: "endMain", player: p }, { type: "charge", player: o, card: null },
    { type: "endMain", player: o }, { type: "charge", player: p, card: null },
  ] as Action[]) s = take(s, action);
  assert.equal(s.prompt.kind, "main");
  return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: string): string {
  const id = area === "hand" ? s.sides[p].zones.hand.find((x) => !["BT29-083", "BT23-097", "GINYU0"].includes(s.cards[x].cardId))! : s.sides[p].zones.deck[0];
  s.cards[id].cardId = def;
  if (area !== "hand") assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (area === "battle" || area === "energy") s.cards[id].mode = "active";
  return id;
}
function until(s: VmState, kind: string, who: PlayerId): VmState {
  for (let i = 0; i < 80; i++) {
    const q = s.prompt as { kind: string; player: PlayerId; choice?: { candidates: string[]; min: number; max?: number } };
    if (q.kind === kind && q.player === who && !s.battle) return s;
    if (q.kind === "counter") s = take(s, { type: "counter", player: q.player, card: null });
    else if (q.kind === "blocker" || q.kind === "combo") s = take(s, { type: "pass", player: q.player } as Action);
    else if (q.kind === "chooseCards") s = take(s, { type: "choose", player: q.player, cards: q.choice!.candidates.slice(0, Math.max(q.choice!.min, Math.min(q.choice!.max ?? 1, q.choice!.candidates.length))) });
    else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: q.player, index: 0 });
    else throw new Error(`waiting for ${kind} of ${who}: unexpected prompt ${q.kind} of ${q.player}`);
  }
  throw new Error(`never reached ${kind} of ${who}`);
}
const activateIn = (s: VmState, id: string) => {
  const act = RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && (l.action as { card?: string }).card === id);
  assert.ok(act, `${s.cards[id].cardId} is offered`);
  return act.action;
};
const bonusOn = (s: VmState, id: string) => s.effects.filter((e) => e.kind === "power" && e.target === id && e.value === 5000).length;
const grantsOn = (s: VmState, id: string) => s.effects.filter((e) => e.kind === "copiedSkills" && e.target === id && e.copied?.quoted);

for (const p of ["p1", "p2"] as PlayerId[]) {
  const o: PlayerId = p === "p1" ? "p2" : "p1";

  // 1. BT29-083 end to end: the Leader gains the [Auto] for the turn, the card
  //    played by BT29-083's skill gets +5000, nothing else does, and it ends
  //    at the end of the turn.
  {
    let s = fresh(p, "L-GINYU");
    const ld = s.sides[p].zones.leader[0];
    const ex = stage(s, p, "BT29-083", "hand");
    stage(s, p, "GINYU0", "battle"); // the second ≪Ginyu Force≫ card [Bond 2] counts
    const played = stage(s, p, "GINYU4", "drop");
    assert.equal(skillsShowing(ctx, s, ex).skills.some((sk) => sk.index === 10), false, `${p}: BT29-083 never has the quoted line itself`);
    events = [];
    s = until(take(s, activateIn(s, ex)), "main", p);
    assert.ok(s.sides[p].zones.battle.includes(played), `${p}: the ≪Ginyu Force≫ card is played from the Drop`);
    assert.equal(grantsOn(s, ld).length, 1, `${p}: the Leader gains the quoted skill`);
    assert.equal(grantsOn(s, ld)[0].until, "turn", `${p}: for the turn`);
    const leaderSkills = skillsShowing(ctx, s, ld).skills.filter((sk) => isCopiedSkill(sk.index));
    assert.deepEqual(leaderSkills.map((sk) => [sk.kind, sk.bond]), [["auto", 2]], `${p}: the Leader holds the [Auto][Bond 2] itself`);
    assert.equal(bonusOn(s, played), 1, `${p}: the card played by BT29-083's skill gets +5000`);
    assert.equal(bonusOn(s, ld) + bonusOn(s, ex), 0, `${p}: neither the Leader nor BT29-083 gets it`);
    assert.ok(events.some((e) => e.type === "skill" && (e as { card?: string }).card === ld), `${p}: the Leader's granted [Auto] resolved`);

    // Another card's skill playing a ≪Ginyu Force≫ card: not "this card's skill".
    const other = stage(s, p, "GINYU_OTHER", "battle");
    const second = stage(s, p, "GINYU4", "drop");
    s = until(take(s, activateIn(s, other)), "main", p);
    assert.ok(s.sides[p].zones.battle.includes(second), `${p}: GINYU_OTHER plays a ≪Ginyu Force≫ card`);
    assert.equal(bonusOn(s, second), 0, `${p}: played by another card's skill, it gets nothing`);
    // Played from the hand by its player: not a play by a skill at all.
    const fromHand = stage(s, p, "GINYU0", "hand");
    const play = RULES.legalActions(ctx, s).find((l) => l.action.type === "play" && (l.action as { card?: string }).card === fromHand);
    assert.ok(play, `${p}: the hand card is playable`);
    s = until(take(s, play.action), "main", p);
    assert.equal(bonusOn(s, fromHand), 0, `${p}: played from the hand, it gets nothing`);

    // The grant ends with the turn.
    s = take(s, { type: "endMain", player: p });
    s = until(s, "charge", o);
    assert.equal(grantsOn(s, ld).length, 0, `${p}: the grant has ended at the end of the turn`);
    assert.equal(skillsShowing(ctx, s, ld).skills.some((sk) => isCopiedSkill(sk.index)), false, `${p}: the Leader no longer has the skill`);
    assert.equal(bonusOn(s, played), 0, `${p}: and the +5000 was for the turn`);
  }

  // 2. A Leader that is no ≪Ginyu Force≫ card gains nothing, and the play earns nothing.
  {
    let s = fresh(p, "L-RED");
    const ld = s.sides[p].zones.leader[0];
    const ex = stage(s, p, "BT29-083", "hand");
    stage(s, p, "GINYU0", "battle");
    const played = stage(s, p, "GINYU4", "drop");
    s = until(take(s, activateIn(s, ex)), "main", p);
    assert.ok(s.sides[p].zones.battle.includes(played), `${p}: the play still happens`);
    assert.equal(grantsOn(s, ld).length, 0, `${p}: a Leader that is no ≪Ginyu Force≫ card gains nothing`);
    assert.equal(bonusOn(s, played), 0, `${p}: so the play earns nothing`);
  }

  // 3. [Bond 2] short: the Leader has the skill, but only the played card is a ≪Ginyu Force≫ Battle Card.
  {
    let s = fresh(p, "L-GINYU");
    const ex = stage(s, p, "BT29-083", "hand");
    const played = stage(s, p, "GINYU4", "drop");
    s = until(take(s, activateIn(s, ex)), "main", p);
    assert.ok(s.sides[p].zones.battle.includes(played));
    assert.equal(bonusOn(s, played), 0, `${p}: with [Bond 2] short, nothing`);
  }

  // 4. BT23-097: the chosen ≪God≫ card gets +5000 and the [Auto] for the turn; when it attacks it KOs; the Extra never has it.
  {
    let s = fresh(p, "L-GREEN");
    const ex = stage(s, p, "BT23-097", "hand");
    const god = stage(s, p, "GOD", "battle");
    const victim = stage(s, o, "PLAIN", "battle");
    s.cards[victim].mode = "rest";
    s = until(take(s, activateIn(s, ex)), "main", p);
    assert.equal(grantsOn(s, god).length, 1, `${p}: the chosen ≪God≫ card gains the quoted skill`);
    assert.equal(bonusOn(s, god), 1, `${p}: and +5000`);
    assert.equal(skillsShowing(ctx, s, ex).skills.some((sk) => sk.kind === "auto"), false, `${p}: BT23-097 itself never has it`);
    const attack = RULES.legalActions(ctx, s).find((l) => l.action.type === "attack" && (l.action as { attacker?: string }).attacker === god && (l.action as { target?: string }).target === s.sides[o].zones.leader[0]);
    assert.ok(attack, `${p}: the ≪God≫ card can attack the Leader`);
    s = until(take(s, attack.action), "main", p);
    assert.ok(s.sides[o].zones.drop.includes(victim), `${p}: its granted [Auto] KO'd the opponent's Battle Card when it attacked`);
    s = take(s, { type: "endMain", player: p });
    s = until(s, "charge", o);
    assert.equal(grantsOn(s, god).length, 0, `${p}: the grant has ended with the turn`);
  }
}

console.log("quoted-grants-1166: a skill granted in quotation marks is the grant's program, never the granting card's own; BT29-083's Leader gains the [Auto] for the turn and the card its skill played gets +5000; BT23-097 grants its chosen card a KO on attack; both seats, stored rows, JSON reload");
