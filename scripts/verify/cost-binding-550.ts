import { zeroSkillPrice } from "../../src/lib/arena/vm/skill-payment";
import { typedRecords } from "./records";
/**
 * #550 (20-5-3, 4-3-3, 5-8-1, 9-7-3-2, 22-10-7): what a skill's price chose —
 * the cards it picked, and the X it fixed — is what the effect reads.
 *
 * The binding contract, for every path the rules engine pays a price on:
 *
 *   * A price program's `choose … as: "cN"` binds `$cN` on the effect's frame
 *     (`ScriptFrame.vars`). It is the same name the compiler gave the price's
 *     choice, so "the chosen card" in the effect reads `$cN` (#542 builds its
 *     BT30-084 `c0` filter on this, and adds nothing to the binding).
 *   * A `choose` carrying `bindX` fixes X to how many it took; X is carried on
 *     `ScriptFrame.x` beside the names, and an X the activation already paid in
 *     energy wins (20-5-3: one X per skill, from the payment to the effect's end).
 *   * The binding lives on frames inside `VmState`, so a JSON reload anywhere
 *     between the price's first question and the effect resolves the same, and
 *     no part of the price is charged twice.
 *
 * Paths: an [Activate] line's printed action price (`vm/activate.ts`
 * `resolveActivation`: price frame `saveVarsAs`, effect frame `pricedBy`); a
 * [Counter]'s printed action price on the strict host (`vm/battle.ts`
 * `stepCounterCost`, which before #550 handed on the names but dropped X); a
 * [Counter]'s action *alternative* (5-3, same `saveVarsAs` shape); and an
 * [Auto]'s price, which runs in the Auto's own frame and is asserted in
 * `auto-costs-549.ts` ("Variable and action-chosen X travel in the Auto's own
 * frame"). An invoked activation (12-2-4-4) waives the original skill cost, so
 * no price runs and nothing is bound; X-priced lines are not invocable
 * (`vm/activate.ts`, the SD7 picker) — covered by `duration-shuffle-574.ts`
 * and `free-extra-680.ts`.
 *
 * Printed wordings: BT28-105's [Activate] and BT28-124's [Counter]
 * alternative are the wordings `hidden.ts` quotes. No
 * printed card has a price that *chooses* X ("any number … : … X"), so those
 * fixtures supply the program and print the price shape before the colon.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { compileCard } from "../../src/lib/arena/compile";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { attrsNow } from "../../src/lib/arena/vm/program";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import type { CardScripts, Script } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";

const engine = RULES;
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok);
const game = loaded.definition;

const defs: Record<string, CardDef> = { ...DEFS,
  // BT28-105's printed wording (`hidden.ts`): the price chooses, the effect reads the chosen card.
  HIDER550: card("HIDER550", { colors: ["Blue"], skill: "[Activate: Main] Choose 1 of your white Battle Cards and switch it to Hidden Mode: Increase this card's power by the original power on the front of the card that was switched to Hidden Mode by this skill for the turn." }),
  WHITEBIG550: card("WHITEBIG550", { colors: ["White"], power: 25000, skill: null }),
  // A hand card whose identity the opponent must never learn from a price prompt.
  SECRET550: card("SECRET550", { colors: ["Blue"], skill: null }),
  // X chosen by an [Activate] action price ("any number … : … X", 20-5).
  XACT550: card("XACT550", { colors: ["Blue"], skill: "[Activate: Main][Once per turn] Place any number of cards from your hand in your Drop Area: Draw X cards." }),
  // X chosen by a [Counter]'s printed action price, paid on the strict host.
  XCNT550: card("XCNT550", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Counter: Attack] Place any number of cards from your hand in your Drop Area: Negate the attack, then draw X cards." }),
  // BT28-124's printed alternative (5-3): legal only while its "if" holds.
  ALT550: card("ALT550", { energyCost: 5, skill: "[Counter: Play][Limit 1] Play this card.<br>[Permanent] If your opponent has 1 or more energy, you can activate this card's [Counter] skill from your hand by choosing 1 Hidden Mode card in your Battle Area and placing it into its owner's Drop instead of paying its energy cost." }),
  WHITE550: card("WHITE550", { colors: ["White"], skill: null }),
  FREE550: card("FREE550", { colors: ["Blue"], energyCost: 0, skill: null }),
};

const compiled = rulesFromCompiler(defs);
const xPrice = (effect: Script["ops"]): CardScripts => ({
  bySkill: {
    0: {
      ops: effect,
      unsupported: [], ...typedRecords(),
      price: { ...zeroSkillPrice(),
        condition: null,
        ops: [
          { op: "choose", sel: { side: "you", area: "hand", count: 99, upTo: true }, as: "paid", bindX: true },
          { op: "moveTo", target: { var: "paid" }, to: "drop" },
        ],
      },
    },
  },
  complete: true,
  unsupported: [],
});
const supplied: Record<string, CardScripts> = {
  XACT550: xPrice([{ op: "draw", n: { x: true } }]),
  XCNT550: xPrice([{ op: "negateAttack" } as Script["ops"][number], { op: "draw", n: { x: true } }]),
};
const scripts = new Proxy({} as Record<string, CardScripts>, { get: (_, key) => supplied[key as string] ?? compiled[key as string] });
const ctx: EngineContext = { ...CTX, defs, scripts };

const reload = (s: VmState): VmState => JSON.parse(JSON.stringify(s));
function apply(s: VmState, action: Action) { return engine.apply(ctx, reload(s), action) as { state: VmState; events: GameEvent[] }; }
function play(s: VmState, ...actions: Action[]): VmState { for (const action of actions) s = apply(s, action).state; return s; }
function stage(s: VmState, p: PlayerId, id: string, area: "battle" | "energy" | "hand" | "drop"): string {
  const physical = s.sides[p].zones.deck[0]; assert.ok(physical);
  s.cards[physical].cardId = id;
  assert.ok(moveCard(s, game, physical, area, { owner: p }).ok);
  return physical;
}
const power = (s: VmState, id: string) => Number(attrsNow(ctx, game, s, id).power ?? 0);
const legal = (s: VmState) => engine.legalActions(ctx, s);
const choose = (s: VmState, ids: string[], player: PlayerId) => apply(s, { type: "choose", player, cards: ids });
const candidates = (s: VmState): string[] => (s.prompt.kind === "chooseCards" ? s.prompt.choice.candidates : []);
const view = (s: VmState, viewer: PlayerId) => JSON.stringify(buildSnapshot({ id: 550, revision: 1, mode: "versus", status: "playing",
  p1Name: "Player 1", p2Name: "Player 2", ctx, state: s, legal: [], log: [], beats: null, spotlight: null,
  spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} }));

/** Both players through to p2's first Main Phase (p1 went first); both hands emptied. */
function secondMain(seed: number): VmState {
  let s = engine.createGame(ctx, { seed, p1: { name: "You", leader: "L-RED", main: fifty("V1") }, p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  s = play(s, { type: "chooseFirst", player: s.chooser, first: "p1" });
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) s = play(s, { type: "pass", player: (s.prompt as { player: PlayerId }).player });
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  assert.equal(s.prompt.kind, "main"); assert.equal(s.turnPlayer, "p2");
  for (const p of ["p1", "p2"] as const) for (const id of s.sides[p].zones.hand.slice()) assert.ok(moveCard(s, game, id, "deck", { owner: p }).ok);
  return s;
}
const activation = (s: VmState, id: string) => legal(s).find((l) => l.action.type === "activate" && l.action.card === id);

// ── the reading: the price binds the name the effect uses ──────────────────
{
  const line = compileCard(defs.HIDER550).bySkill[0];
  assert.deepEqual(line.unsupported, []);
  assert.equal((line.price?.ops?.[0] as { op: string; as?: string }).as, "c0", "the price's choice is $c0");
  assert.ok(JSON.stringify(line.ops).includes('"var":"c0"'), "…and the effect reads $c0");
}

// ── [Activate]: the chosen card is the one the effect reads (4-3-3) ───────
{
  const s0 = secondMain(5501);
  const user = stage(s0, "p2", "HIDER550", "battle");
  // Two cards the price may take, with different front powers: the effect's
  // number says which one was chosen.
  const [small, big] = [stage(s0, "p2", "WHITE550", "battle"), stage(s0, "p2", "WHITEBIG550", "battle")];
  const secret = stage(s0, "p2", "SECRET550", "hand");
  const powerBefore = power(s0, user);
  const offer = activation(s0, user);
  assert.ok(offer, "offered: a white Battle Card can be switched");
  const asked = apply(s0, offer.action);
  const d = asked.state;
  assert.equal(d.prompt.kind, "chooseCards", "the price asks which card");
  assert.deepEqual([...candidates(d)].sort(), [small, big].sort(), "only the white Battle Cards, not this blue card");
  assert.equal(asked.events.filter((e) => e.type === "skill").length, 0, "announced only once the price is paid");
  // Privacy: the price chooses among public cards; the hand stays the payer's.
  assert.ok(view(d, "p2").includes("SECRET550"), "the payer sees their own hand");
  assert.ok(!view(d, "p1").includes("SECRET550"), "the opponent does not");
  // Wrong actor, a non-candidate, an empty answer to a mandatory choice: refused, unchanged.
  const before = JSON.stringify(d);
  assert.throws(() => choose(d, [big], "p1"), IllegalAction, "only the payer answers");
  assert.throws(() => choose(d, [secret], "p2"), IllegalAction, "a card the price cannot take");
  assert.throws(() => choose(d, [user], "p2"), IllegalAction, "this card is not white");
  assert.throws(() => choose(d, [], "p2"), IllegalAction, "\"choose 1\" is not optional");
  assert.equal(JSON.stringify(d), before);
  // A reload at the price resolves the same; the effect reads the card chosen.
  const paid = choose(reload(d), [big], "p2");
  const again = choose(reload(d), [big], "p2");
  assert.equal(JSON.stringify(again.state), JSON.stringify(paid.state), "a reload at the price resolves the same");
  assert.equal(JSON.stringify(again.events), JSON.stringify(paid.events));
  const p = paid.state;
  assert.equal(p.prompt.kind, "main");
  assert.equal(p.cards[big].hidden, true, "the price switched the chosen card");
  assert.ok(!p.cards[small].hidden, "and only it");
  assert.equal(power(p, user), powerBefore + 25000, "the effect read the chosen card's front power (23-5-2-4), not the other's");
  const skillAt = paid.events.findIndex((e) => e.type === "skill" && e.card === user);
  const powerAt = paid.events.findIndex((e) => e.type === "effect");
  assert.ok(skillAt >= 0 && (powerAt < 0 || skillAt < powerAt), "the price completes and the line is announced before the effect");
  assert.equal(paid.events.filter((e) => e.type === "skill" && e.card === user).length, 1, "one activation");
  assert.ok(!p.programs.some((f) => f.pricedBy || f.saveVarsAs), "no continuation left behind");
  // The same, choosing the other card: a different number — the binding is the choice.
  assert.equal(power(choose(reload(d), [small], "p2").state, user), powerBefore + 10000);
  // Stale: the chosen card left the Battle Area before the answer.
  const stale = reload(d); assert.ok(moveCard(stale, game, big, "drop", { owner: "p2" }).ok);
  const staleBefore = JSON.stringify(stale);
  assert.throws(() => choose(stale, [big], "p2"), IllegalAction);
  assert.equal(JSON.stringify(stale), staleBefore, "refused with nothing charged");
}

// ── [Activate]: X fixed by an action price that chooses (20-5-3) ──────────
{
  const s0 = secondMain(5502);
  const user = stage(s0, "p2", "XACT550", "battle");
  const hand = [stage(s0, "p2", "SECRET550", "hand"), stage(s0, "p2", "SECRET550", "hand"), stage(s0, "p2", "SECRET550", "hand")];
  const offer = activation(s0, user); assert.ok(offer);
  let d = apply(s0, offer.action).state;
  assert.equal(d.prompt.kind, "chooseCards");
  assert.ok(!view(d, "p1").includes("SECRET550"), "the opponent does not see the hand being chosen from");
  d = choose(reload(d), [hand[0]], "p2").state;
  // Saved part-way through the choice: the pick so far is on the frame.
  d = reload(d);
  assert.equal(d.prompt.kind, "chooseCards", "an up-to choice asks again");
  const deckBefore = d.sides.p2.zones.deck.length;
  const done = choose(d, [hand[1]], "p2");
  let t = done.state;
  if (t.prompt.kind === "chooseCards") t = choose(t, [], "p2").state;
  assert.equal(t.prompt.kind, "main");
  assert.ok([hand[0], hand[1]].every((id) => t.sides.p2.zones.drop.includes(id)), "the two chosen cards paid");
  assert.ok(t.sides.p2.zones.hand.includes(hand[2]), "the third was kept");
  assert.equal(deckBefore - t.sides.p2.zones.deck.length, 2, "X = 2: the effect drew what the price chose");
  assert.equal(t.sides.p2.zones.hand.length, 3, "one kept + two drawn");
  // X = 0: declining at once pays nothing and draws nothing (5-1-3).
  const z0 = apply(s0, offer.action).state;
  const zeroDeck = z0.sides.p2.zones.deck.length;
  const z = choose(z0, [], "p2").state;
  assert.equal(z.prompt.kind, "main");
  assert.equal(z.sides.p2.zones.deck.length, zeroDeck, "X = 0 draws nothing — and does not throw for an unbound X");
  assert.deepEqual([...z.sides.p2.zones.hand].sort(), [...hand].sort());
}

// ── [Counter]: X fixed by its printed action price reaches the effect ─────
{
  const s0 = secondMain(5503);
  const counterCard = stage(s0, "p1", "XCNT550", "hand");
  const paying = [stage(s0, "p1", "SECRET550", "hand"), stage(s0, "p1", "SECRET550", "hand")];
  const attacked = play(s0, { type: "attack", player: "p2", attacker: s0.sides.p2.zones.leader[0], target: s0.sides.p1.zones.leader[0] });
  assert.equal(attacked.prompt.kind, "counter");
  const declared = apply(attacked, { type: "counter", player: "p1", card: counterCard } as Action);
  let d = declared.state;
  assert.equal(d.prompt.kind, "chooseCards", "the price asks which hand cards pay");
  assert.ok(d.programs[0].counterCost, "paid on the strict host's stored continuation");
  assert.ok(d.sides.p1.zones.hand.includes(counterCard), "the [Counter] stays in hand while its price is paid (22-10-7)");
  assert.ok(!candidates(d).includes(counterCard), "and cannot pay for itself");
  assert.ok(view(d, "p1").includes("SECRET550") && !view(d, "p2").includes("SECRET550"), "the payer sees the candidates; the attacker does not");
  d = choose(reload(d), [paying[0]], "p1").state;
  d = reload(d);
  const deckBefore = d.sides.p1.zones.deck.length;
  const r = choose(d, [paying[1]], "p1");
  let t = r.state; const ev = [...r.events];
  if (t.prompt.kind === "chooseCards" && t.prompt.player === "p1") { const n = choose(t, [], "p1"); t = n.state; ev.push(...n.events); }
  assert.ok(paying.every((id) => t.sides.p1.zones.drop.includes(id)), "both chosen cards paid");
  assert.ok(t.sides.p1.zones.drop.includes(counterCard), "the [Counter] went to the Drop once paid");
  assert.equal(deckBefore - t.sides.p1.zones.deck.length, 2, "X = 2 reached the [Counter]'s effect");
  assert.equal(ev.filter((e) => e.type === "skill" && e.card === counterCard).length, 1, "activated once");
  assert.ok(ev.some((e) => e.type === "attackNegated"));
  assert.ok(!t.programs.some((f) => f.counterCost), "no payment cursor left behind");
}

// ── [Counter]: an action alternative is legal only under its stated condition (5-3) ──
{
  /** p2 plays a free card; p1 holds ALT550 with no energy and two face-down cards. */
  const window = (oppEnergy: number) => {
    const s = secondMain(5504);
    for (const id of s.sides.p1.zones.energy.slice()) assert.ok(moveCard(s, game, id, "deck", { owner: "p1" }).ok);
    for (const id of s.sides.p2.zones.energy.slice()) assert.ok(moveCard(s, game, id, "deck", { owner: "p2" }).ok);
    for (let i = 0; i < oppEnergy; i++) stage(s, "p2", "V-BLUE", "energy");
    const alt = stage(s, "p1", "ALT550", "hand");
    const down = [stage(s, "p1", "WHITE550", "battle"), stage(s, "p1", "WHITE550", "battle")];
    for (const id of down) s.cards[id].hidden = true;
    const free = stage(s, "p2", "FREE550", "hand");
    let t = play(s, { type: "play", player: "p2", card: free });
    if (t.prompt.kind === "payCost") t = play(t, legal(t)[0].action);
    return { s: t, alt, down };
  };
  const altOffer = (s: VmState, id: string) => legal(s).find((l) => l.action.type === "counter" && l.action.card === id && (l.action as { alt?: boolean }).alt);
  const none = window(0);
  assert.ok(!(none.s.prompt.kind === "counter" && altOffer(none.s, none.alt)), "opponent with no energy: the alternative's \"if\" fails, so it is not offered");
  const one = window(1);
  assert.equal(one.s.prompt.kind, "counter", "opponent with 1 energy: the window opens");
  const offer = altOffer(one.s, one.alt); assert.ok(offer, "and the alternative is offered");
  let d = apply(one.s, offer.action).state;
  assert.equal(d.prompt.kind, "chooseCards");
  assert.deepEqual([...candidates(d)].sort(), [...one.down].sort(), "only Hidden Mode cards pay");
  d = reload(d);
  const t = choose(d, [one.down[1]], "p1").state;
  assert.ok(t.sides.p1.zones.drop.includes(one.down[1]), "the chosen face-down card paid");
  assert.ok(t.sides.p1.zones.battle.includes(one.down[0]), "the other stayed");
  assert.ok(t.sides.p1.zones.battle.includes(one.alt), "and the [Counter] played the card");
}

console.log("  ok  #550 cost binding: chosen cards and X reach the effect across Activate, Counter and its alternative");
