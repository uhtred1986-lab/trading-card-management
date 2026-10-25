/**
 * #1169 (rules review 25 Oct 2026, batch 7, SD15-05 front 10): "When you remove
 * a marker from one of your **red** Unison Cards using a [Spirit Boost] skill"
 * is a trigger condition on the Unison that paid (Rule Manual 22-43-3, 9-6-2).
 * The moment (`spiritBoostPaid`) hands that Unison on as the subject; what the
 * watcher says about it — colour, mono-colour, <name>, ≪trait≫, {card name} —
 * is a lone IF on the subject (`special: "subject"`), and `pendAutos` reads it
 * before the Auto is pended, as it does for "when your <filter> is KO'd"
 * (#1120). A description the filter cannot read whole leaves the skill unread.
 *
 * SD15-05 and DB3-001 are the catalog's printed text (the #649 audit snapshot,
 * the text batch 7 reviewed); the `*1169` cards are synthetic and say what they
 * are for. Every record goes printed text -> `skillRecords` -> JSON ->
 * `rulesFromRows`, the stored-row path, and every board is played on both seats.
 * Run from `scripts/verify-arena.ts`, which fixes the order.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CTX, DEFS, card, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { cardDefFrom } from "../../src/lib/arena/load";
import { parseSpecifiedCost } from "../../src/lib/arena/specified-cost";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { Op } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";

const SD15_05_F10 = "[Auto] If your opponent has 2 or more energy: When you remove a marker from one of your red Unison Cards using a [Spirit Boost] skill, you may play this card from your hand.";

const snapshot = JSON.parse(readFileSync("docs/arena-backlog/evidence/649/catalog-subset-2026-10-13.json", "utf8")) as { cards: { id: string }[] };
const printed = (id: string, extra: Partial<CardDef> = {}): CardDef => {
  const row = snapshot.cards.find((c) => c.id === id);
  assert.ok(row, `${id} is in the audit snapshot`);
  return { ...cardDefFrom(row as Parameters<typeof cardDefFrom>[0]), ...extra };
};

const defs: Record<string, CardDef> = {
  ...DEFS,
  "SD15-05": printed("SD15-05"),
  // A red Unison whose own marker lines are not [Spirit Boost] ([+1], [-4]).
  "DB3-001": printed("DB3-001", { specifiedCost: parseSpecifiedCost("{r}{r}")! }),
  // The blue Unison of the batch-7 engine proof (specified cost Blue 2).
  BLUEUNI1169: card("BLUEUNI1169", { type: "UNISON", colors: ["Blue"], energyCost: "X", power: 15000, comboCost: null, comboPower: null, skill: null, specifiedCost: parseSpecifiedCost("{b}{b}")! }),
  // A red/blue Unison: red, but not mono-red.
  REDBLUEUNI1169: card("REDBLUEUNI1169", { type: "UNISON", colors: ["Red", "Blue"], energyCost: "X", power: 15000, comboCost: null, comboPower: null, traits: ["Saiyan"], skill: null, specifiedCost: parseSpecifiedCost("{r}{b}")! }),
  // A mono-red ≪Saiyan≫ Unison.
  SAIYANUNI1169: card("SAIYANUNI1169", { type: "UNISON", colors: ["Red"], energyCost: "X", power: 15000, comboCost: null, comboPower: null, traits: ["Saiyan"], skill: null, specifiedCost: parseSpecifiedCost("{r}{r}")! }),
  // The payer: a [Spirit Boost 1] line on a Battle Card (22-43-3).
  SPIRIT1169: card("SPIRIT1169", { colors: ["Red"], energyCost: 0, skill: "[Activate: Main][Spirit Boost 1] Draw 1 card." }),
  // Siblings of SD15-05's shape, in play: an ordinary effect behind a qualified payer.
  MONOSAIYAN1169: card("MONOSAIYAN1169", { colors: ["Red"], energyCost: 1, skill: "[Auto] When you remove a marker from one of your mono-red ≪Saiyan≫ Unison Cards using a [Spirit Boost] skill, draw 1 card." }),
  ANYUNI1169: card("ANYUNI1169", { colors: ["Red"], energyCost: 1, skill: "[Auto] When you remove a marker from one of your Unison Cards using a [Spirit Boost] skill, draw 1 card." }),
  NAMED1169: card("NAMED1169", { colors: ["Red"], energyCost: 1, skill: "[Auto] When you remove a marker from your {Master Roshi, Potential Unleashed} using a [Spirit Boost] skill, draw 1 card." }),
};

// ── 1. the reading, on the stored row ────────────────────────────────────────
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
const stored = JSON.parse(JSON.stringify(rows)) as RuleRow[];
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(stored, defs) };
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;

const recordOf = (id: string, kind = "auto") => skillRecords(defs[id]).find((r) => r.kind === kind)!;
{
  const r = recordOf("SD15-05");
  assert.equal(r.printed, SD15_05_F10, "SD15-05 front 10 as printed");
  assert.deepEqual(r.trigger, ["spiritBoostPaid"]);
  assert.deepEqual(r.unread, [], "SD15-05 front 10 reads in full");
  assert.equal(r.ops.length, 1, "a lone IF on the payer");
  const gate = r.ops[0] as Extract<Op, { op: "if" }>;
  assert.equal(gate.op, "if");
  assert.ok(!gate.else);
  const sel = (gate.cond as { kind: string; sel: { special?: string; filter?: { colors: string[]; type: string | null; monoColor: boolean } } });
  assert.equal(sel.kind, "count");
  assert.equal(sel.sel.special, "subject", "the condition is on the Unison that paid");
  assert.deepEqual([sel.sel.filter?.colors, sel.sel.filter?.type, sel.sel.filter?.monoColor], [["Red"], "UNISON", false], "red, a Unison, not mono-colour");
  assert.deepEqual((gate.then[0] as { op: string }).op, "may", "then the printed may-play");
  assert.equal(r.cond?.kind, "count", "the opponent's 2 energy stays the condition before the colon");
  // The stored row reloads as the same record.
  const back = stored.find((x) => (x as unknown as { cardId: string }).cardId === "SD15-05" && (x as unknown as { kind: string }).kind === "auto") as unknown as { ops: unknown };
  assert.deepEqual(back.ops, JSON.parse(JSON.stringify(r.ops)), "the JSON row carries the payer condition");

  const mono = recordOf("MONOSAIYAN1169");
  assert.deepEqual(mono.unread, []);
  assert.match(mono.reads ?? "", /mono-colour red ≪Saiyan≫ Unison Card/);
  assert.match(recordOf("NAMED1169").reads ?? "", /\{Master Roshi, Potential Unleashed\}/);
  // No qualifier: no condition, as before.
  assert.deepEqual(recordOf("ANYUNI1169").ops.map((o) => o.op), ["draw"]);
  // "from this card" (BT14's Unison wording) is the Unison's own payment: no condition.
  assert.deepEqual(skillRecords(card("SELF1169", { type: "UNISON", energyCost: "X", skill: "[Auto] When you remove a marker from this card using a [Spirit Boost] skill, draw 1 card." }))[0].ops.map((o) => o.op), ["draw"]);
  // A qualifier the filter cannot read whole leaves the trigger unread, never dropped.
  const odd = skillRecords(card("ODD1169", { skill: "[Auto] When you remove a marker from one of your glittering red Unison Cards using a [Spirit Boost] skill, draw 1 card." }))[0];
  assert.ok(odd.unread.length > 0 && odd.ops.length === 0, "an unreadable qualifier: the clause is unread");
}

// ── 2. the engine, both seats ────────────────────────────────────────────────
const reload = (s: VmState): VmState => JSON.parse(JSON.stringify(s));
const apply = (s: VmState, action: Action) => RULES.apply(ctx, reload(s), action) as { state: VmState; events: GameEvent[] };
const legal = (s: VmState) => RULES.legalActions(ctx, s);
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");
const zone = (s: VmState, p: PlayerId, z: string) => (s.sides[p].zones as Record<string, string[]>)[z] ?? [];

/** `seat`'s Main Phase with both hands emptied back into the decks. */
function mainOf(seat: PlayerId, seed: number): VmState {
  let s = RULES.createGame(ctx, { seed, p1: { name: "P1", leader: "L-RED", main: fifty("V1") }, p2: { name: "P2", leader: "L-RED", main: fifty("V1") } }).state as VmState;
  s = apply(s, { type: "chooseFirst", player: (s.prompt as { player: PlayerId }).player, first: "p1" }).state;
  s = apply(s, { type: "mulligan", player: "p1", redraw: false }).state;
  s = apply(s, { type: "mulligan", player: "p2", redraw: false }).state;
  s = apply(s, { type: "charge", player: "p1", card: null }).state;
  if (seat === "p2") {
    s = apply(s, { type: "endMain", player: "p1" }).state;
    s = apply(s, { type: "charge", player: "p2", card: null }).state;
  }
  assert.equal(s.prompt.kind, "main");
  assert.equal(s.turnPlayer, seat);
  for (const p of ["p1", "p2"] as const) for (const id of s.sides[p].zones.hand.slice()) assert.ok(moveCard(s, game, id, "deck", { owner: p }).ok);
  return s;
}
function stage(s: VmState, p: PlayerId, cardId: string, area: "battle" | "unison" | "hand" | "energy"): string {
  const id = s.sides[p].zones.deck[0];
  assert.ok(id);
  s.cards[id].cardId = cardId;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok, `could not stage ${cardId}`);
  s.pending = [];
  return id;
}
const isPlayQuestion = (s: VmState) => s.prompt.kind === "chooseMode" && (s.prompt as { reason?: string }).reason === "play this card from your hand";

interface Board { s: VmState; seat: PlayerId; unison: string; five: string; watchers: string[] }
function board(seat: PlayerId, o: { unison: string; markers?: number; oppEnergy?: number; watchers?: string[]; seed: number }): Board {
  const s = mainOf(seat, o.seed);
  const unison = stage(s, seat, o.unison, "unison");
  s.cards[unison].markers = o.markers ?? 2;
  stage(s, seat, "SPIRIT1169", "battle");
  const five = stage(s, seat, "SD15-05", "hand");
  const watchers = (o.watchers ?? []).map((w) => stage(s, seat, w, "battle"));
  for (let i = 0; i < (o.oppEnergy ?? 2); i++) stage(s, other(seat), "V1", "energy");
  return { s, seat, unison, five, watchers };
}

/**
 * Activate `skill` of `cardId` for the seat, answer everything but SD15-05's
 * own question with the first legal answer (pending order: first offered), and
 * stop at that question or back in the seat's Main Phase. Each step is a
 * reload, as a stored game would be.
 */
function activate(b: Board, cardId: string, skill = 0): { s: VmState; asked: boolean; drawn: number } {
  const id = zone(b.s, b.seat, cardId === "DB3-001" ? "unison" : "battle").find((x) => b.s.cards[x].cardId === cardId);
  assert.ok(id, `${cardId} is in play`);
  const handBefore = zone(b.s, b.seat, "hand").filter((x) => x !== b.five).length;
  const act = legal(b.s).find(({ action }) => action.type === "activate" && action.card === id && (action as { skill: number }).skill === skill);
  assert.ok(act, `${cardId}'s skill ${skill} is offered`);
  let s = apply(b.s, act.action).state;
  let asked = false;
  for (let i = 0; i < 30; i++) {
    if (isPlayQuestion(s)) { asked = true; break; }
    if (s.prompt.kind === "main" && s.turnPlayer === b.seat) break;
    const options = legal(s).filter(({ action }) => action.type !== "concede");
    const action = options.find(({ action }) => action.type === "optionalCost")?.action ?? options[0]?.action;
    assert.ok(action, `stopped at ${s.prompt.kind} with nothing to answer`);
    s = apply(s, action.type === "optionalCost" ? { ...action, pay: true } as Action : action).state;
  }
  const drawn = zone(s, b.seat, "hand").filter((x) => x !== b.five).length - handBefore;
  return { s, asked, drawn };
}
const pendedFive = (s: VmState, five: string) => s.pending.some((p) => p.card === five);

for (const seat of ["p1", "p2"] as const) {
  const seed = seat === "p1" ? 11690 : 11695;

  // A red Unison's Spirit Boost: offered, and accepting plays SD15-05.
  {
    const b = board(seat, { unison: "DB3-001", seed });
    const r = activate(b, "SPIRIT1169");
    assert.ok(r.asked, `${seat}: a red Unison's [Spirit Boost] offers SD15-05's play`);
    assert.equal(r.s.cards[b.unison].markers, 1, "the payment took one marker");
    const yes = legal(r.s).find(({ action }) => action.type === "chooseMode" && action.index === 0);
    assert.ok(yes);
    let t = apply(r.s, yes.action).state;
    for (let i = 0; i < 20 && !(t.prompt.kind === "main" && t.turnPlayer === seat); i++) {
      const options = legal(t).filter(({ action }) => action.type !== "concede");
      const pick = options.find(({ action }) => action.type === "choose" && action.cards.includes(b.five))?.action ?? options[0]?.action;
      assert.ok(pick);
      t = apply(t, pick).state;
    }
    assert.ok(zone(t, seat, "battle").includes(b.five), `${seat}: accepted, SD15-05 is played from the hand`);
  }

  // A mono-red ≪Saiyan≫ Unison is red too; a red/blue Unison is red (not mono-red).
  {
    const b = board(seat, { unison: "REDBLUEUNI1169", seed: seed + 1 });
    assert.ok(activate(b, "SPIRIT1169").asked, `${seat}: a red/blue Unison is a red Unison Card`);
  }

  // A blue Unison's Spirit Boost: the payment is no trigger for SD15-05, nothing pended.
  {
    const b = board(seat, { unison: "BLUEUNI1169", seed: seed + 2 });
    const act = legal(b.s).find(({ action }) => action.type === "activate" && b.s.cards[action.card]?.cardId === "SPIRIT1169");
    assert.ok(act);
    const first = apply(b.s, act.action).state;
    assert.ok(!pendedFive(first, b.five), `${seat}: a blue Unison's payment pends nothing for SD15-05 (9-6-2)`);
    const r = activate(b, "SPIRIT1169");
    assert.ok(!r.asked, `${seat}: a blue Unison's [Spirit Boost] does not offer the play`);
    assert.equal(r.s.cards[b.unison].markers, 1, "the payment still happened");
    assert.ok(zone(r.s, seat, "hand").includes(b.five), "SD15-05 stays in the hand");
  }

  // No Spirit Boost: DB3-001's own [-4] takes markers off a red Unison, and is not the moment.
  {
    const b = board(seat, { unison: "DB3-001", markers: 5, seed: seed + 3 });
    const r = activate(b, "DB3-001", 20);
    assert.equal(r.s.cards[b.unison].markers, 1, "[-4] took four markers");
    assert.ok(!r.asked, `${seat}: markers removed without a [Spirit Boost] offer nothing`);
  }

  // The condition before the colon still holds: 1 opposing energy, nothing offered.
  {
    const b = board(seat, { unison: "DB3-001", oppEnergy: 1, seed: seed + 4 });
    assert.ok(!activate(b, "SPIRIT1169").asked, `${seat}: with 1 opposing energy nothing is offered`);
  }

  // Siblings in play: the mono-red ≪Saiyan≫ watcher, the {name} watcher and the unqualified one.
  {
    const run = (unison: string, w: string) => activate(board(seat, { unison, watchers: [w], seed: seed + 5 }), "SPIRIT1169");
    // The Spirit Boost line draws 1 itself and a firing watcher 1 more; SD15-05, offered or not, stays in the hand (declined).
    const drew = (unison: string, w: string) => {
      const r = run(unison, w);
      let s = r.s;
      if (r.asked) {
        const no = legal(s).find(({ action }) => action.type === "chooseMode" && action.index === 1);
        assert.ok(no);
        s = apply(s, no.action).state;
        for (let i = 0; i < 20 && !(s.prompt.kind === "main" && s.turnPlayer === seat); i++) s = apply(s, legal(s).filter(({ action }) => action.type !== "concede")[0].action).state;
      }
      return zone(s, seat, "hand").length;
    };
    const base = drew("BLUEUNI1169", "ANYUNI1169");
    assert.equal(drew("BLUEUNI1169", "MONOSAIYAN1169"), base - 1, `${seat}: a blue Unison is not a mono-red ≪Saiyan≫ one`);
    assert.equal(drew("REDBLUEUNI1169", "MONOSAIYAN1169"), base - 1, `${seat}: red/blue ≪Saiyan≫ is not mono-red`);
    assert.equal(drew("SAIYANUNI1169", "MONOSAIYAN1169"), base, `${seat}: a mono-red ≪Saiyan≫ Unison fires it`);
    assert.equal(drew("DB3-001", "NAMED1169"), base, `${seat}: {Master Roshi, Potential Unleashed} fires the named watcher`);
    assert.equal(drew("SAIYANUNI1169", "NAMED1169"), base - 1, `${seat}: another name does not`);
  }
}

console.log("  #1169: [Spirit Boost] payer qualifiers (SD15-05 red Unison, mono-colour, ≪trait≫, {name}) — stored rows, both seats, reload passed");
