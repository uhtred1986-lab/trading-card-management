/**
 * #940: "When this card is played or removed from a Battle Area by a skill" —
 * printed text -> compile -> stored-row JSON round-trip -> the real VM.
 *
 * Both halves are kept: the play, and a skill taking the card out of a Battle
 * Area (to the Drop, the hand or the Warp, by either player's skill). A KO, a
 * battle KO and a move the rules make are not "removed ... by a skill" (3-1-5),
 * and one occurrence pends the Auto once.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { koCard } from "../../src/lib/arena/vm/battle";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { attrsNow } from "../../src/lib/arena/vm/program";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { autoTriggerMatches } from "../../src/lib/arena/text/triggers";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId, Trigger } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

/** BT31-015 as printed (docs/arena-backlog/evidence/923). */
const GOGETA = "[Revenge]<br>[Union-Fusion] {r}, if you have 3 or more energy and you draw 1 card: Red <Son Goku> card and red <Vegeta> card.<br>[Auto] When this card is played or removed from a Battle Area by a skill, choose up to 1 of your opponent's Battle Cards or Unisons and it gets -20000 power for the turn.<br>[Activate: Battle] [Once per turn] Use up to 1 red card with 5000 combo power from your Warp in a combo with its skills negated for the turn.";
const REMOVERS = {
  DROP940: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and place it in its owner's Drop Area.",
  HAND940: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and return it to its owner's hand.",
  WARP940: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and send it to its owner's Warp.",
  OWNDROP940: "[Activate: Main] Choose up to 1 of your Battle Cards and place it in your Drop Area.",
  OWNHAND940: "[Activate: Main] Choose up to 1 of your Battle Cards and return it to your hand.",
  OWNWARP940: "[Activate: Main] Choose up to 1 of your Battle Cards and send it to your Warp.",
  KOSKILL940: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and KO it.",
};
const defs: Record<string, CardDef> = { ...DEFS,
  GOG940: card("GOG940", { name: "SS Gogeta, Vanquisher", energyCost: 0, power: 30000, skill: GOGETA }),
  FOE940: card("FOE940", { colors: ["Blue"], power: 30000, skill: null }),
  ...Object.fromEntries(Object.entries(REMOVERS).map(([id, skill]) => [id, card(id, { energyCost: 0, power: 10000, skill })])),
  // The same coordination read for its neighbours in the family.
  OPP940: card("OPP940", { skill: "[Auto] When this card is played or removed from a Battle Area by an opponent's skill, draw 1 card." }),
  KO940: card("KO940", { skill: "[Auto] When this card is played or KO'd, draw 1 card." }),
  KOSK940: card("KOSK940", { skill: "[Auto] When this card is played or removed from a Battle Area by a skill or KO'd, draw 1 card." }),
  PLAIN940: card("PLAIN940", { skill: "[Auto] When this card is played, draw 1 card." }),
  UNKNOWN940: card("UNKNOWN940", { skill: "[Auto] When this card is played or removed from the game by a skill, draw 1 card." }),
};
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(roundtrip(rows), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");

// ── the reading ──────────────────────────────────────────────────────────────
const gogetaRows = skillRecords(defs.GOG940).filter((r) => r.printed.includes("removed from a Battle Area"));
assert.equal(gogetaRows.length, 1);
const row = gogetaRows[0];
assert.deepEqual(row.trigger, ["played", "removedFromBattle"], "both alternatives are kept");
assert.deepEqual(row.unread, [], "and the whole Auto reads");
assert.deepEqual(row.ops.map((o) => o.op), ["choose", "power"]);
{
  const choose = row.ops[0] as { sel: { side: string; areas: string[]; count: number; upTo: boolean } };
  assert.equal(choose.sel.side, "opponent"); assert.deepEqual(choose.sel.areas, ["battle", "unison"]);
  assert.equal(choose.sel.count, 1); assert.equal(choose.sel.upTo, true, "optional choice");
  assert.deepEqual(row.ops[1], { op: "power", target: { var: "c0" }, amount: -20000, until: "turn" });
}
const triggersOf = (id: string) => [...skillRecords(defs[id]).find((r) => r.kind === "auto")!.trigger].sort();
assert.deepEqual(triggersOf("PLAIN940"), ["played"], "a plain play stays a play");
assert.deepEqual(triggersOf("OPP940"), ["played", "removedByOpponent"], "an opponent's skill alone narrows the removal half");
assert.deepEqual(triggersOf("KO940"), ["koed", "played"], "played or KO'd keeps the KO half");
assert.deepEqual(triggersOf("KOSK940"), ["koed", "played", "removedFromBattle"]);
{
  const sk = parseSkills(defs.UNKNOWN940.skill!).find((s) => s.kind === "auto")!;
  assert.ok(autoTriggerMatches(sk, "played" as Trigger));
  assert.ok(!autoTriggerMatches(sk, "removedFromBattle" as Trigger), "removal from the game is no Battle-Area removal");
  assert.ok(skillRecords(defs.UNKNOWN940)[0].unread.length > 0, "an alternative the engine cannot place stays an honest unread gap");
}

// ── the VM ───────────────────────────────────────────────────────────────────
function take(s: VmState, action: Action): VmState { return RULES.apply(ctx, roundtrip(s), action).state as VmState; }
function fresh(player: PlayerId): VmState {
  let s = RULES.createGame(ctx, { seed: 940, p1: { name: "First", leader: "L-RED", main: fifty("V1") }, p2: { name: "Second", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
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
  const id = s.sides[p].zones.deck[0]; s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok); if (area === "battle") s.cards[id].mode = mode; return id;
}
const power = (s: VmState, id: string) => attrsNow(ctx, game, s, id).power;
const has = (s: VmState, p: PlayerId, area: string, id: string) => s.sides[p].zones[area].includes(id);

/** Answer prompts until `main`, choosing `want` when a card choice is asked. Returns how many choices were asked of the Gogeta Auto. */
function settle(s: VmState, want: string | null): { s: VmState; asked: number } {
  let asked = 0;
  for (let i = 0; i < 12 && s.prompt.kind !== "main"; i++) {
    const q = s.prompt;
    if (q.kind === "chooseCards") {
      if (q.choice.candidates.includes(want ?? "")) asked++;
      s = take(s, { type: "choose", player: q.player, cards: want && q.choice.candidates.includes(want) ? [want] : [] });
    } else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: q.player, index: 0 });
    else throw new Error(`unexpected prompt ${q.kind}`);
  }
  assert.equal(s.prompt.kind, "main");
  return { s, asked };
}

for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  // 1. Played: the Auto is pended once, and its optional choice, amount and duration hold.
  {
    const s = fresh(seat);
    const gog = stage(s, seat, "GOG940", "hand"), target = stage(s, foe, "FOE940", "battle");
    const play = RULES.legalActions(ctx, s).find((l) => l.action.type === "play" && l.action.card === gog);
    assert.ok(play, "Gogeta can be played");
    const r = take(s, play.action);
    assert.equal(r.prompt.kind, "chooseCards", `${seat}: playing pends the Auto`);
    if (r.prompt.kind !== "chooseCards") throw new Error();
    assert.equal(r.prompt.choice.min, 0, "up to 1: the choice is optional");
    assert.equal(r.prompt.choice.max, 1);
    assert.ok(r.prompt.choice.candidates.includes(target));
    assert.ok(!r.prompt.choice.candidates.includes(gog), "only the opponent's cards");
    const done = settle(roundtrip(r), target);
    assert.equal(done.asked, 1, "one occurrence, one question");
    assert.equal(power(done.s, target), 10000, "-20000 for the turn");
    const declined = settle(roundtrip(r), null);
    assert.equal(power(declined.s, target), 30000, "declining the optional choice changes nothing");
    // …and the effect is for the turn only.
    let t = done.s; assert.equal(t.pending.length, 0);
    t = take(t, { type: "endMain", player: seat });
    for (let i = 0; i < 6 && t.turnPlayer === seat; i++) {
      const q = t.prompt as { kind: string; player: PlayerId };
      t = take(t, q.kind === "main" ? { type: "endMain", player: q.player } : q.kind === "charge" ? { type: "charge", player: q.player, card: null } : { type: "pass", player: q.player } as Action);
    }
    assert.equal(power(t, target), 30000, "restored once the turn is over");
  }
  // 2. Removed by a skill: to the Drop, hand and Warp; the other player's skill and the owner's own.
  for (const [remover, dest, area, byOpponent] of [
    ["DROP940", "drop", "drop", true], ["HAND940", "hand", "hand", true], ["WARP940", "warp", "warp", true],
    ["OWNDROP940", "drop", "drop", false], ["OWNHAND940", "hand", "hand", false], ["OWNWARP940", "warp", "warp", false],
  ] as const) {
    // byOpponent: the foe is Gogeta's controller and the acting seat is the remover's.
    const owner = byOpponent ? foe : seat;
    const s = fresh(seat);
    const gog = stage(s, owner, "GOG940", "battle"), rem = stage(s, seat, remover, "battle"), victim = stage(s, other(owner), "FOE940", "battle");
    const act = RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === rem);
    assert.ok(act, `${remover}: activatable`);
    let r = take(s, act.action);
    // The remover's own choice (it may also list itself): take Gogeta.
    assert.equal(r.prompt.kind, "chooseCards");
    r = take(r, { type: "choose", player: (r.prompt as { player: PlayerId }).player, cards: [gog] });
    assert.ok(has(r, owner, area, gog), `${seat}/${remover}: Gogeta moved to ${dest}`);
    assert.ok(!has(r, owner, "battle", gog));
    // Its Auto now belongs to its controller and asks about the other side's cards.
    if (r.prompt.kind === "orderPending") { assert.equal(r.pending.length, 1, "one occurrence is one pending Auto"); r = take(r, { type: "orderPending", player: r.prompt.player, index: 0 }); }
    assert.equal(r.prompt.kind, "chooseCards", `${seat}/${remover}: removal by a skill pends the Auto`);
    if (r.prompt.kind !== "chooseCards") throw new Error();
    assert.equal(r.prompt.player, owner, "the card's controller answers");
    assert.ok(r.prompt.choice.candidates.includes(victim), "the opposing card is a candidate");
    const done = settle(roundtrip(r), victim);
    assert.equal(done.asked, 1, `${seat}/${remover}: pended once, not once per event path`);
    assert.equal(power(done.s, victim), 10000, "-20000 for the turn, from the card that left");
    assert.ok(has(done.s, owner, area, gog), "and the card is where the skill put it");
  }
  // 3. Not removed by a skill: nothing is asked.
  {
    // A skill's KO is a KO (21-14), not a removal.
    const s = fresh(seat);
    const gog = stage(s, foe, "GOG940", "battle"), rem = stage(s, seat, "KOSKILL940", "battle"); stage(s, seat, "V1", "battle");
    const act = RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === rem)!;
    let r = take(s, act.action);
    if (r.prompt.kind === "chooseCards") r = take(r, { type: "choose", player: r.prompt.player, cards: [gog] });
    assert.equal(r.prompt.kind, "main", `${seat}: a KO by a skill does not pend the removal alternative`);
    assert.ok(has(r, foe, "drop", gog));
  }
  {
    // A KO outside a skill, and a move the game's own procedure makes.
    const s = fresh(seat);
    const gog = stage(s, seat, "GOG940", "battle"); stage(s, foe, "FOE940", "battle");
    const ev: GameEvent[] = [];
    koCard(ctx, game, s, ev, gog);
    assert.ok(has(s, seat, "drop", gog)); assert.equal(s.pending.length, 0, `${seat}: a plain KO pends nothing`);
    const ruled = fresh(seat);
    const g2 = stage(ruled, seat, "GOG940", "battle");
    assert.ok(moveCard(ruled, game, g2, "drop", { owner: seat }).ok);
    assert.equal(ruled.pending.length, 0, "a rules move pends nothing");
  }
  {
    // A real battle: the opponent's attack KOs Gogeta (not a skill).
    const s = fresh(foe === "p1" ? "p1" : "p2");
    const gog = stage(s, seat, "GOG940", "battle", "rest"), att = stage(s, foe, "FOE940", "battle");
    s.cards[att].mode = "active";
    const attack = RULES.legalActions(ctx, s).find((l) => l.action.type === "attack" && l.action.attacker === att && l.action.target === gog);
    assert.ok(attack, `${foe} can attack the rested Gogeta`);
    let r = take(s, attack.action);
    for (let i = 0; i < 12 && r.battle; i++) {
      const q = r.prompt as { kind: string; player: PlayerId };
      if (q.kind === "counter") r = take(r, { type: "counter", player: q.player, card: null });
      else if (q.kind === "blocker") r = take(r, { type: "pass", player: q.player } as Action);
      else if (q.kind === "combo") r = take(r, { type: "pass", player: q.player } as Action);
      else if (q.kind === "orderPending") r = take(r, { type: "orderPending", player: q.player, index: 0 });
      else break;
    }
    assert.ok(has(r, seat, "drop", gog), `${seat}: Gogeta lost the battle`);
    assert.equal(r.pending.filter((x) => x.card === gog).length, 0, "a battle KO pends no removal Auto");
    assert.equal(r.prompt.kind === "chooseCards" && r.prompt.player === seat, false, "a battle KO is not a skill's removal");
  }
  // 4. Boundary (9-6-9-2): a skill negated in its Battle Area does not trigger when the card leaves it.
  for (const boundary of ["negated"] as const) {
    const s = fresh(seat);
    const gog = stage(s, foe, "GOG940", "battle"), rem = stage(s, seat, "DROP940", "battle"); stage(s, seat, "V1", "battle");
    if (boundary === "negated") addEffect(s, [], { target: gog, kind: "negateSkills", value: 0, until: "turn", source: gog });

    const act = RULES.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === rem)!;
    let r = take(s, act.action);
    if (r.prompt.kind === "chooseCards") r = take(r, { type: "choose", player: r.prompt.player, cards: [gog] });
    assert.ok(has(r, foe, "drop", gog), `${seat}/${boundary}: it was removed`);
    assert.equal(r.prompt.kind, "main", `${seat}/${boundary}: and its Auto answers nothing`);
    assert.equal(r.pending.length, 0);
  }
}
console.log("#940 played-or-removed-by-a-skill: reading, stored rows, play, own/opponent skill to Drop/hand/Warp, KO and rules boundaries, both seats passed");
