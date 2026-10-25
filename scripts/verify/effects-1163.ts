/**
 * #1163: two effect misreadings behind [Bond] prices, held back from production.
 *
 * 1. BT13-012#20: "…This card gets +21000 power **until the start of your next
 *    Main Phase**." compiled `until: "turn"` and ended at the End Phase of the
 *    turn it was made on. It is `nextMain` now: through the opponent's whole
 *    turn and the controller's own Charge Phase, ending as the controller's
 *    next Main Phase begins. EB1-34#20 and BT9-119#30 print the same duration
 *    and read the same.
 * 2. BT29-083#10: "When your ≪Ginyu Force≫ card is played by this card's skill,
 *    **it** gets +5000 power" — "this card's skill" is the means, and "it" is
 *    the card played. It was read as this card. The trigger is its own moment
 *    now (`youPlayedByThisCard`): a play made by the watching card's own skill.
 *    Its [Bond 2] descriptor "≪Ginyu Force≫ card" is a readable Bond selector.
 *
 * Proof on the exact printed texts, through stored rows (`skillRecords` → JSON →
 * `rulesFromRows`, the path a match loads), for both seats. BT29-083#10 is
 * stored in the repo's open-rules export inside the quotation marks of the
 * skill its Extra grants ('…gains the following skill for the turn- "[auto]…"');
 * that quoted line stays an honest gap (a granted skill), so the VM proof runs
 * the unquoted line on a Battle Card whose own [Activate: Main] makes the play.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { compileCostRecord } from "../../src/lib/arena/compile/prices";
import { compileSkill } from "../../src/lib/arena/compile";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { triggersOf } from "../../src/lib/arena/gaps";
import { bondSelector } from "../../src/lib/arena/text/bond";
import { recordContractGaps, rulesFromRows, runtimeSupportOfRow, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { untilWords } from "../../src/lib/arena/effects";
import { describeScript, type Op } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";

// ── the printed texts ────────────────────────────────────────────────────────
const BT13_012 = "[Activate: Main][Bond 3][Once per turn] If your opponent has 3 or more energy: This card gets +21000 power until the start of your next Main Phase.";
const EB1_34 = "[Activate: Main][Once per turn][Burst 2] If your opponent has 8 or more cards in their hand and 3 or more energy: This card gets +16000 power and [Double Strike] until the start of your next Main Phase.";
const BT9_119 = "[auto] Choose 3 ≪Universe 11≫ cards from your hand and/or Battle Area and place them in your Drop Area: When you play this card, it isn't affected by your opponent's skills until the start of your next Main Phase.";
/** As the repo's export stores it: inside the quotation marks of the skill BT29-083's [Activate: Main] grants. */
const BT29_083_10_STORED = "\"[auto][bond 2] ≪Ginyu Force≫ card: When your ≪Ginyu Force≫ card is played by this card's skill, it gets +5000 power for the turn.\"";
const BT29_083_10 = BT29_083_10_STORED.slice(1, -1);
/** The play the skill answers to, made by the same card's own skill (BT29-083#0's play, without its grant). */
const PLAYER_LINE = "[Activate: Main] Play up to 1 ≪Ginyu Force≫ card with an energy cost of 4 from your Drop.";

const defs: Record<string, CardDef> = { ...DEFS,
  "BT13-012": card("BT13-012", { colors: ["Red"], energyCost: 0, skill: BT13_012 }),
  "EB1-34": card("EB1-34", { colors: ["Red"], energyCost: 0, skill: EB1_34 }),
  "BT9-119": card("BT9-119", { colors: ["Red"], energyCost: 0, traits: ["Universe 11"], skill: BT9_119 }),
  // The [Auto] on a Battle Card that also makes the play, so "this card's skill" can be its own.
  GINYU_HOST: card("GINYU_HOST", { colors: ["Yellow"], energyCost: 0, traits: ["Ginyu Force"], skill: `${PLAYER_LINE}\n${BT29_083_10}` }),
  // The same two lines on a card that is no ≪Ginyu Force≫ card itself, so the
  // card played is the only one the [Bond 2] counts.
  PLAIN_HOST: card("PLAIN_HOST", { colors: ["Yellow"], energyCost: 0, skill: `${PLAYER_LINE}\n${BT29_083_10}` }),
  // The same play, made by a card without the [Auto].
  GINYU_OTHER: card("GINYU_OTHER", { colors: ["Yellow"], energyCost: 0, traits: ["Ginyu Force"], skill: PLAYER_LINE }),
  GINYU4: card("GINYU4", { colors: ["Yellow"], energyCost: 4, power: 10000, traits: ["Ginyu Force"] }),
  GINYU0: card("GINYU0", { colors: ["Yellow"], energyCost: 0, power: 10000, traits: ["Ginyu Force"] }),
  PLAIN: card("PLAIN", { colors: ["Red"], energyCost: 0 }),
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
const rowOf = (cardId: string, printed: string) => {
  const row = rows.find((r) => r.cardId === cardId && r.printed === printed);
  assert.ok(row, `${cardId}: a stored row for ${printed.slice(0, 40)}…`);
  const back = roundtrip(row);
  assert.deepEqual(recordContractGaps(back), [], `${cardId}: the stored row needs no rebuild`);
  assert.deepEqual(runtimeSupportOfRow(back).unsupported, [], `${cardId}: the stored row is runnable`);
  return back as RuleRow & { ops: Op[]; unread: string[]; trigger: string[] };
};

// ── 1. the reading: "until the start of your next Main Phase" ───────────────
for (const [id, text] of [["BT13-012", BT13_012], ["EB1-34", EB1_34], ["BT9-119", BT9_119]] as const) {
  const compiled = compileSkill(parseSkills(text)[0]);
  assert.deepEqual(compiled.unsupported, [], `${id}: the whole line is read`);
  const timed = opsDeep(compiled.ops).filter((o) => "until" in o && (o as { until?: string }).until !== undefined);
  assert.ok(timed.length, `${id}: an effect with a duration`);
  for (const o of timed) assert.equal((o as { until?: string }).until, "nextMain", `${id}: ${o.op} lasts until the start of your next Main Phase, not for the turn`);
  assert.match(describeScript(compiled.ops), /until the start of your next Main Phase/, `${id}: and says so`);
}
{
  const row = rowOf("BT13-012", BT13_012);
  assert.deepEqual(row.unread, []);
  const power = opsDeep(row.ops).find((o) => o.op === "power") as { amount?: number; until?: string; target?: { sel?: { special?: string } } } | undefined;
  assert.deepEqual([power?.amount, power?.until, power?.target?.sel?.special], [21000, "nextMain", "self"], "BT13-012#20: +21000 on this card until the start of your next Main Phase");
  assert.equal(compileCostRecord(parseSkills(BT13_012)[0]).readable, true, "BT13-012: its [Bond 3] price still reads");
}
// The board's words, from each chair.
assert.equal(untilWords("nextMain", { master: "p1", viewer: "p1", them: "Foe" }), "until the start of your next Main Phase");
assert.equal(untilWords("nextMain", { master: "p2", viewer: "p1", them: "Foe" }), "until the start of Foe's next Main Phase");

// ── 2. the reading: "it" is the card played by this card's skill ─────────────
{
  const skill = parseSkills(BT29_083_10)[0];
  assert.deepEqual(triggersOf(skill), ["youPlayedByThisCard"], "BT29-083#10: the play this card's own skill made");
  assert.deepEqual(bondSelector(skill)?.kind, "filter", "BT29-083#10: [Bond 2] counts ≪Ginyu Force≫ Battle Cards");
  assert.equal(compileCostRecord(skill).readable, true, "BT29-083#10: the Bond price reads");
  const compiled = compileSkill(skill);
  assert.deepEqual(compiled.unsupported, []);
  const power = opsDeep(compiled.ops).find((o) => o.op === "power") as { amount?: number; until?: string; target?: { sel?: { special?: string } } } | undefined;
  assert.deepEqual([power?.amount, power?.until, power?.target?.sel?.special], [5000, "turn", "subject"], "BT29-083#10: +5000 on the card played, not on this card");
  assert.ok(!opsDeep(compiled.ops).some((o) => JSON.stringify(o).includes('"special":"self"')), "BT29-083#10: nothing acts on this card");
  assert.match(describeScript(compiled.ops), /≪ginyu force≫/i, "BT29-083#10: only when the card played is a ≪Ginyu Force≫ card");
  const row = rowOf("GINYU_HOST", BT29_083_10);
  assert.deepEqual(row.trigger, ["youPlayedByThisCard"], "the stored row answers to that moment");
  // "This card" anywhere but the means still binds "it" to this card.
  assert.deepEqual(triggersOf(parseSkills("[Auto] When your ≪Ginyu Force≫ card is played by a skill, it gets +5000 power for the turn.")[0]), [], "a play by any skill is not this moment");
  // The quoted line, as the repo's export stores it, is a granted skill and stays unread — never read as this card.
  const quoted = compileSkill(parseSkills(BT29_083_10_STORED)[0]);
  assert.ok(!opsDeep(quoted.ops).some((o) => o.op === "power"), "the quoted, granted line is not read as BT29-083's own +5000");
}

// ── the VM, both seats ───────────────────────────────────────────────────────
let events: GameEvent[] = [];
function take(s: VmState, action: Action): VmState {
  const r = RULES.apply(ctx, roundtrip(s), action);
  events = events.concat(r.events as GameEvent[]);
  return r.state as VmState;
}
/** `p` in its second Main Phase. */
function fresh(p: PlayerId): VmState {
  const o: PlayerId = p === "p1" ? "p2" : "p1";
  const decks = { [p]: { name: "Me", leader: "L-RED", main: fifty("V1") }, [o]: { name: "Foe", leader: "L-BLUE", main: fifty("V-BLUE") } } as Record<PlayerId, { name: string; leader: string; main: string[] }>;
  let s = RULES.createGame(ctx, { seed: 1163, p1: decks.p1, p2: decks.p2 }).state as VmState;
  for (const action of [
    { type: "chooseFirst", player: s.chooser, first: p },
    { type: "mulligan", player: p, redraw: false }, { type: "mulligan", player: o, redraw: false },
    { type: "charge", player: p, card: null }, { type: "endMain", player: p }, { type: "charge", player: o, card: null },
    { type: "endMain", player: o }, { type: "charge", player: p, card: null },
  ] as Action[]) s = take(s, action);
  assert.equal(s.prompt.kind, "main");
  assert.equal((s.prompt as { player: PlayerId }).player, p);
  return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: string): string {
  const id = area === "hand" ? s.sides[p].zones.hand[0] : s.sides[p].zones.deck[0];
  s.cards[id].cardId = def;
  if (area !== "hand") assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (area === "battle" || area === "energy") s.cards[id].mode = "active";
  return id;
}
/** Answer every question until `kind` is asked of `who`. */
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

for (const p of ["p1", "p2"] as PlayerId[]) {
  const o: PlayerId = p === "p1" ? "p2" : "p1";

  // BT13-012: the +21000 holds through the opponent's turn and the controller's
  // Charge Phase, and ends as the controller's next Main Phase begins.
  {
    let s = fresh(p);
    const goku = stage(s, p, "BT13-012", "battle");
    stage(s, p, "PLAIN", "battle");
    stage(s, p, "PLAIN", "battle");
    for (let i = s.sides[o].zones.energy.length; i < 3; i++) stage(s, o, "PLAIN", "energy");
    const act = RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && (l.action as { card?: string }).card === goku);
    assert.ok(act, `${p}: BT13-012 is offered`);
    s = until(take(s, act.action), "main", p);
    const made = () => s.effects.filter((e) => e.target === goku && e.kind === "power" && e.value === 21000);
    assert.equal(made().length, 1, `${p}: +21000`);
    assert.equal(made()[0].until, "nextMain", `${p}: until the start of ${p}'s next Main Phase`);
    assert.equal(made()[0].master, p);
    const turn = s.turn;
    s = take(s, { type: "endMain", player: p });
    s = until(s, "charge", o);
    assert.equal(made().length, 1, `${p}: still +21000 once ${p}'s turn has ended`);
    s = take(s, { type: "charge", player: o, card: null });
    s = until(s, "main", o);
    assert.equal(made().length, 1, `${p}: still +21000 during ${o}'s Main Phase`);
    s = take(s, { type: "endMain", player: o });
    s = until(s, "charge", p);
    assert.equal(s.turn, turn + 2, `${p}: ${p}'s next turn`);
    assert.equal(made().length, 1, `${p}: still +21000 in ${p}'s own Charge Phase (not earlier)`);
    events = [];
    s = take(s, { type: "charge", player: p, card: null });
    s = until(s, "main", p);
    assert.equal(made().length, 0, `${p}: gone at the start of ${p}'s next Main Phase (not later)`);
    assert.ok(events.some((e) => e.type === "effectEnded" && (e as { effect: { target?: string } }).effect.target === goku), `${p}: and the board is told it ended`);
  }

  // BT29-083#10: the +5000 goes to the ≪Ginyu Force≫ card this card's own skill played.
  // The [Bond 2] is checked as the [Auto] resolves, with the card played
  // already in the Battle Area: the watcher and it make two.
  for (const [label, watcherDef, host, fires] of [
    ["own skill, Bond held", "GINYU_HOST", null, true],
    ["own skill, Bond short", "PLAIN_HOST", null, false],
    ["another card's skill", "GINYU_HOST", "GINYU_OTHER", false],
  ] as const) {
    let s = fresh(p);
    const watcher = stage(s, p, watcherDef, "battle");
    const player = host === null ? watcher : stage(s, p, host, "battle");
    const played = stage(s, p, "GINYU4", "drop");
    const act = RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && (l.action as { card?: string }).card === player);
    assert.ok(act, `${p} (${label}): the play is offered`);
    events = [];
    s = until(take(s, act.action), "main", p);
    assert.equal(s.sides[p].zones.battle.includes(played), true, `${p} (${label}): the ≪Ginyu Force≫ card is played from the Drop`);
    const onPlayed = s.effects.filter((e) => e.kind === "power" && e.target === played && e.value === 5000);
    assert.equal(onPlayed.length, fires ? 1 : 0, `${p} (${label}): the played card ${fires ? "gets" : "does not get"} +5000`);
    assert.equal(s.effects.filter((e) => e.kind === "power" && e.target === watcher).length, 0, `${p} (${label}): never this card`);
    assert.equal(events.some((e) => e.type === "skill" && (e as { card?: string }).card === watcher && (e as { text?: string }).text?.includes("by this card's skill")), fires, `${p} (${label}): the [Auto] ${fires ? "resolves" : "does not fire"}`);
  }
  // A ≪Ginyu Force≫ card played from the hand by its player, not by a skill: not this moment.
  {
    let s = fresh(p);
    const watcher = stage(s, p, "GINYU_HOST", "battle");
    stage(s, p, "GINYU0", "battle");
    const hand = stage(s, p, "GINYU0", "hand");
    const play = RULES.legalActions(ctx, s).find((l) => l.action.type === "play" && (l.action as { card?: string }).card === hand);
    assert.ok(play, `${p}: the hand card is playable`);
    s = until(take(s, play.action), "main", p);
    assert.equal(s.sides[p].zones.battle.includes(hand), true);
    assert.equal(s.effects.filter((e) => e.kind === "power" && (e.target === hand || e.target === watcher)).length, 0, `${p}: a declared play is not "played by this card's skill"`);
  }
}

console.log("effects-1163: \"until the start of your next Main Phase\" ends as the controller's next Main Phase begins; \"it\" after \"played by this card's skill\" is the card played; both seats, stored rows");
