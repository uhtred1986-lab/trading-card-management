/**
 * #677: 20-14-1's price on activating skills — "your opponent can't activate
 * skills unless they send 1 card from their hand to their Warp each
 * time" — charged once at the successful activation boundary on a declared
 * [Activate: Main] and on an effect-invoked one (SD7-01's Desire branch), on
 * both engines. The wording is synthetic: no printed card is claimed.
 */
import assert from "node:assert/strict";
import { compileSkill } from "../../src/lib/arena/compile";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import { validateProgram } from "../../src/lib/arena/vm/script";
import type { Op } from "../../src/lib/arena/vm/script";
import type { Action, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { EngineState } from "../../src/lib/arena/engines";
import { CTX, DEFS, IMPL, stagedG, assertConsistentG, card, leaderOf, rejectedActionsG, zoneOf } from "./harness";

const TAX = "[Permanent] Your opponent can't activate skills unless they send 1 card from their hand to their Warp each time.";
const WISH = "[Activate: Main] Choose one- ・Draw 1 card. ・Choose 1 ≪Desire≫ card in your hand with an energy cost less than or equal to your current energy and activate its [Activate: Main] skill.";
const WISH_CHAIN = `${WISH.slice(0, -1)}. Then draw 2 cards.`;
const DRAW = "[Activate: Main] Draw 1 card.";

const injected = ["C677-TAXER", "C677-TAXER2", "C677-WISH", "C677-CHAIN", "C677-DESIRE", "C677-EXTRA", "C677-FODDER"] as const;
try {
  DEFS["C677-TAXER"] = card("C677-TAXER", { skill: TAX });
  DEFS["C677-TAXER2"] = card("C677-TAXER2", { skill: TAX });
  DEFS["C677-WISH"] = card("C677-WISH", { type: "LEADER", energyCost: null, comboCost: null, comboPower: null, skill: WISH });
  DEFS["C677-CHAIN"] = card("C677-CHAIN", { type: "LEADER", energyCost: null, comboCost: null, comboPower: null, skill: WISH_CHAIN });
  DEFS["C677-DESIRE"] = card("C677-DESIRE", { type: "EXTRA", energyCost: 2, power: null, comboCost: null, comboPower: null, traits: ["Desire"], skill: DRAW });
  DEFS["C677-EXTRA"] = card("C677-EXTRA", { type: "EXTRA", energyCost: 1, power: null, comboCost: null, comboPower: null, skill: DRAW });
  DEFS["C677-FODDER"] = card("C677-FODDER", { energyCost: 9 });

  // ── the wording, compiled and validated ─────────────────────────────────
  const one = (text: string) => compileSkill(parseSkills(text)[0]!);
  const taxed = one(TAX);
  assert.deepEqual(taxed.unsupported, []);
  assert.equal(validateProgram(taxed.ops), true);
  const forbid = taxed.ops.find((op) => op.op === "forbid") as Extract<Op, { op: "forbid" }> | undefined;
  assert.ok(forbid, "the tax compiles to a forbid");
  assert.deepEqual([forbid.what, forbid.side, forbid.unless], ["activateSkill", "opponent", undefined]);
  // Said from the payer's chair, and never paid with the activating card.
  assert.deepEqual(forbid.unlessPay?.map((op) => op.op), ["choose", "moveTo"]);
  const pick = forbid.unlessPay![0] as Extract<Op, { op: "choose" }>;
  assert.deepEqual([pick.sel.area, pick.sel.count, pick.sel.notSelf], ["hand", 1, "card"]);
  assert.equal((forbid.unlessPay![1] as Extract<Op, { op: "moveTo" }>).to, "warp");
  const PRICE = forbid.unlessPay!;
  // Controls: nothing else widens. A description not printed on a catalog
  // card, a card subject and a price the other player pays stay unread
  // rather than taxing what they don't name. (The price without "each time"
  // is read since EX06-35 prints it so: `activation-taxes-677.ts`.)
  for (const text of [
    "[Permanent] Your opponent can't activate [Auto] skills unless they send 1 card from their hand to their Warp each time.",
    "[Permanent] Your opponent can't activate skills of Extra Cards unless they send 1 card from their hand to their Warp each time.",
    "[Permanent] This card can't activate its skills unless you send 1 card from your hand to your Warp each time.",
    "[Permanent] Your opponent can't activate skills unless you send 1 card from your hand to your Warp each time.",
  ]) {
    assert.ok(!one(text).ops.some((op) => op.op === "forbid" && op.unlessPay), `not an activation tax: ${text}`);
  }
  // The schema takes a price on `activateSkill` now, and still refuses one on
  // an action nothing charges or one beside a condition.
  assert.equal(validateProgram([{ op: "forbid", what: "activateSkill", until: "turn", side: "opponent", unlessPay: PRICE }]), true);
  assert.equal(validateProgram([{ op: "forbid", what: "block", until: "turn", side: "opponent", unlessPay: PRICE }]), false);
  assert.equal(validateProgram([{ op: "forbid", what: "activateSkill", until: "turn", unlessPay: PRICE, unless: { kind: "isTurnPlayer" } }]), false);

  // ── helpers ────────────────────────────────────────────────────────────
  const take = (state: EngineState, action: Action): { state: EngineState; events: GameEvent[] } => {
    assert.ok(IMPL.legalActions(CTX, state).some((row) => JSON.stringify(row.action) === JSON.stringify(action)), `rules: expected ${JSON.stringify(action)} at ${state.prompt.kind}`);
    return IMPL.apply(CTX, state, action);
  };
  const ids = (state: EngineState, p: PlayerId, area: "hand" | "drop" | "warp" | "battle", cardId: string) => zoneOf(state, p, area).filter((id) => state.cards[id].cardId === cardId);
  const rested = (state: EngineState) => zoneOf(state, "p1", "energy").filter((id) => state.cards[id].mode === "rest").length;
  const draws = (events: GameEvent[]) => events.filter((e) => e.type === "draw" && e.player === "p1").length;
  const taxPaid = (events: GameEvent[], id: string) => events.findIndex((e) => e.type === "move" && e.card === id && e.from === "hand" && e.to === "warp");
  const firstDraw = (events: GameEvent[]) => events.findIndex((e) => e.type === "draw" && e.player === "p1");
  const activateOf = (state: EngineState, id: string): Action => ({ type: "activate", player: "p1", card: id, skill: parseSkills(DEFS[state.cards[id].cardId].skill!)[0]!.index });
  /** A p1 board with the given leader skill, `taxers` of p2's Battle Cards stating the tax, and the named hand and energy. */
  const board = (opts: { leader?: string; taxers?: number; hand: string[]; energy?: string[] }): EngineState => {
    const state = stagedG({ hand: opts.hand, energy: opts.energy ?? [], oppBattle: ["C677-TAXER", "C677-TAXER2"].slice(0, opts.taxers ?? 1) });
    if (opts.leader) state.cards[leaderOf(state, "p1")].cardId = opts.leader;
    return state;
  };
  const injectTax = (state: EngineState, id: number, forbidOf: Record<string, unknown>) => {
    state.effects.push({ id, target: "", kind: "forbid", value: 0, forbid: { what: "activateSkill", pay: PRICE, ...forbidOf } as never,
      until: "turn", source: leaderOf(state, "p2"), createdTurn: state.turn, ownerTurn: "p1", master: "p2" });
  };
  /** Answer a tax's own hand choice when it is asked, and any further one the same way. */
  const payWith = (step: { state: EngineState; events: GameEvent[] }, ...cards: string[]) => {
    let { state, events } = step;
    for (const id of cards) {
      if (state.prompt.kind !== "chooseCards") break;
      const next = take(state, { type: "choose", player: "p1", cards: [id] });
      state = next.state;
      events = [...events, ...next.events];
    }
    return { state, events };
  };
  // ── a declared activation, payable ──────────────────────────────────────
  // The Extra's own energy cost is paid, the Extra goes to the Drop, the tax
  // takes the one other hand card, and only then does the skill draw.
  {
    const state = board({ hand: ["C677-EXTRA", "C677-FODDER"], energy: ["V1"] });
    const extra = ids(state, "p1", "hand", "C677-EXTRA")[0];
    const fodder = ids(state, "p1", "hand", "C677-FODDER")[0];
    const offer = IMPL.legalActions(CTX, state).find((row) => row.action.type === "activate" && row.action.card === extra);
    assert.ok(offer && / — first pay: /.test(offer.label), `rules: the button names the price: ${offer?.label}`);
    const result = payWith(take(state, activateOf(state, extra)), fodder);
    assert.deepEqual(ids(result.state, "p1", "drop", "C677-EXTRA"), [extra]);
    assert.deepEqual(ids(result.state, "p1", "warp", "C677-FODDER"), [fodder], "the tax is paid once, with the other hand card");
    assert.equal(rested(result.state), 1, "the Extra's own energy cost is paid as printed");
    assert.equal(draws(result.events), 1);
    assert.equal(result.events.filter((e) => e.type === "skill" && e.card === extra).length, 1);
    assert.ok(taxPaid(result.events, fodder) >= 0 && taxPaid(result.events, fodder) < firstDraw(result.events), "the tax is paid before the skill's effect");
    assertConsistentG(result.state);
  }

  // ── a declared activation, unpayable ────────────────────────────────────
  // No other hand card: the activation is not offered, and the refusal names
  // the price. Nothing moves, nothing is spent.
  {
    const state = board({ hand: ["C677-EXTRA"], energy: ["V1"] });
    const extra = ids(state, "p1", "hand", "C677-EXTRA")[0];
    const before = JSON.stringify(state);
    assert.ok(!IMPL.legalActions(CTX, state).some((row) => row.action.type === "activate" && row.action.card === extra));
    const why = rejectedActionsG(state).find((row) => row.action.type === "activate" && row.action.card === extra)?.why[0];
    assert.equal(why?.kind, "forbidden");
    assert.match(why && "unless" in why ? String(why.unless) : "", /you pay, each time/);
    assert.throws(() => IMPL.apply(CTX, JSON.parse(before) as EngineState, activateOf(state, extra)));
    assert.equal(JSON.stringify(state), before);
  }

  // ── an invoked activation: the waiver is the printed price's only ────────
  // SD7-01's branch pays none of the Desire's printed cost (12-2-4), but the
  // external tax is still due — once, before the nested draw, and the
  // parent's "then draw 2" continues after it.
  // The rule names the Desire (a `name` condition), so the invoking Leader's
  // own activation is not taxed and the one price in play is the nested one.
  const invoking = (leader: string, hand: string[], energy = ["V1", "V1"]) => {
    const state = board({ leader, taxers: 0, hand, energy });
    injectTax(state, 6771, { player: "p1", name: "C677-DESIRE" });
    return state;
  };
  const invoke = (state: EngineState, text = WISH_CHAIN) => take(state, { type: "activate", player: "p1", card: leaderOf(state, "p1"), skill: parseSkills(text)[0]!.index });
  {
    const state = invoking("C677-CHAIN", ["C677-DESIRE", "C677-FODDER"]);
    const desire = ids(state, "p1", "hand", "C677-DESIRE")[0];
    const fodder = ids(state, "p1", "hand", "C677-FODDER")[0];
    let step = invoke(state);
    assert.equal(step.state.prompt.kind, "chooseMode");
    assert.ok(!step.events.some((e) => e.type === "move" && e.from === "hand"), "the Leader's own activation is untaxed");
    step = payWith(take(step.state, { type: "chooseMode", player: "p1", index: 1 }), fodder);
    assert.deepEqual(ids(step.state, "p1", "drop", "C677-DESIRE"), [desire]);
    assert.deepEqual(ids(step.state, "p1", "warp", "C677-FODDER"), [fodder], "the invoked activation's tax is paid once");
    assert.equal(rested(step.state), 0, "the Desire's printed energy cost stays waived");
    const nested = step.events.findIndex((e) => e.type === "skill" && e.card === desire);
    assert.ok(nested >= 0 && taxPaid(step.events, fodder) >= 0 && taxPaid(step.events, fodder) < firstDraw(step.events), "the tax is paid before the nested skill draws");
    assert.equal(draws(step.events), 3, "the nested draw and the parent's continuation both happen, once");
    assertConsistentG(step.state);
  }

  // ── an invoked activation, unpayable or declined ────────────────────────
  // With no other hand card the Desire is not eligible — its branch is not
  // offered, so nothing is moved, spent or advanced for it.
  {
    const state = invoking("C677-WISH", ["C677-DESIRE"]);
    const desire = ids(state, "p1", "hand", "C677-DESIRE")[0];
    const result = invoke(state, WISH);
    assert.notEqual(result.state.prompt.kind, "chooseMode", "the unpayable Desire branch is not offered");
    assert.deepEqual(ids(result.state, "p1", "hand", "C677-DESIRE"), [desire]);
    assert.ok(!result.events.some((e) => e.type === "skill" && e.card === desire));
    assert.ok(!result.events.some((e) => e.type === "move" && e.from === "hand"));
    assertConsistentG(result.state);
  }
  // Declining the branch (choosing the other mode) pays nothing.
  {
    const state = invoking("C677-WISH", ["C677-DESIRE", "C677-FODDER"]);
    const step = invoke(state, WISH);
    assert.equal(step.state.prompt.kind, "chooseMode");
    const result = take(step.state, { type: "chooseMode", player: "p1", index: 0 });
    assert.equal(ids(result.state, "p1", "hand", "C677-FODDER").length, 1, "a declined activation leaves its price unpaid");
    assert.equal(ids(result.state, "p1", "hand", "C677-DESIRE").length, 1);
    assert.equal(draws(result.events), 1);
    assertConsistentG(result.state);
  }

  // ── the deferred price: a real choice, reloaded, stale and departed ──────
  {
    const state = invoking("C677-CHAIN", ["C677-DESIRE", "C677-FODDER", "C677-FODDER"]);
    const desire = ids(state, "p1", "hand", "C677-DESIRE")[0];
    const fodders = ids(state, "p1", "hand", "C677-FODDER");
    let step = invoke(state);
    step = take(step.state, { type: "chooseMode", player: "p1", index: 1 });
    const asked = step.state;
    assert.equal(asked.prompt.kind, "chooseCards", "two hand cards make the price a real question");
    if (asked.prompt.kind !== "chooseCards") throw Error("tax choice missing");
    assert.deepEqual([...asked.prompt.choice.candidates].sort(), [...fodders].sort(), "never the activating Extra");
    assert.deepEqual(ids(asked, "p1", "drop", "C677-DESIRE"), [desire], "the Extra is used: in the Drop as the price is asked");
    assert.equal(draws(step.events), 0, "neither the nested skill nor the parent has resolved yet");
    // Both viewers: the opponent never sees which hand cards could pay.
    const view = (viewer: PlayerId) => JSON.stringify(buildSnapshot({ id: 677, revision: 3, mode: "versus", status: "playing",
      p1Name: "Player 1", p2Name: "Player 2", ctx: CTX, state: asked, legal: [], log: [], beats: IMPL.toBeats(CTX, asked, step.events, 0), spotlight: null,
      spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} }));
    assert.ok(!view("p2").includes("C677-FODDER"), "the opponent's view masks the price's hand candidates");
    assert.ok(view("p1").includes("C677-FODDER"), "the payer sees them");
    const saved = JSON.stringify(asked);
    const answer: Action = { type: "choose", player: "p1", cards: [fodders[1]] };
    const paid = take(JSON.parse(saved) as EngineState, answer);
    const reloaded = take(JSON.parse(saved) as EngineState, answer);
    assert.equal(JSON.stringify(reloaded.state), JSON.stringify(paid.state), "a reload at the price resolves the same");
    assert.deepEqual(reloaded.events, paid.events);
    assert.deepEqual(ids(paid.state, "p1", "warp", "C677-FODDER"), [fodders[1]]);
    assert.deepEqual(ids(paid.state, "p1", "hand", "C677-FODDER"), [fodders[0]], "charged once — the other hand card stays");
    assert.equal(paid.events.filter((e) => e.type === "move" && e.to === "warp").length, 1);
    assert.ok(taxPaid(paid.events, fodders[1]) < firstDraw(paid.events));
    assert.equal(draws(paid.events), 3, "the nested draw, then the parent's two");
    assert.equal(paid.state.prompt.kind, "main", "the parent continuation finished");
    assertConsistentG(paid.state);
    // A stale answer — the card left the hand after the question was saved —
    // is refused and leaves the stored board untouched.
    const stale = JSON.parse(saved) as EngineState;
    zoneOf(stale, "p1", "hand").splice(zoneOf(stale, "p1", "hand").indexOf(fodders[1]), 1);
    zoneOf(stale, "p1", "drop").push(fodders[1]);
    const staleBefore = JSON.stringify(stale);
    assert.throws(() => IMPL.apply(CTX, stale, answer));
    assert.equal(JSON.stringify(stale), staleBefore);
    // The rule ending (its source gone) after the price was asked: the price
    // was owed at the activation's declaration (20-14-1) and is paid once —
    // the same answer resolves exactly as it would have.
    const departed = JSON.parse(saved) as EngineState;
    departed.effects = departed.effects.filter((e) => e.id !== 6771);
    const after = take(departed, answer);
    assert.deepEqual(ids(after.state, "p1", "warp", "C677-FODDER"), [fodders[1]]);
    assert.equal(after.events.filter((e) => e.type === "move" && e.to === "warp").length, 1);
    assert.equal(draws(after.events), 3);
  }

  // ── several taxes, live and combined ────────────────────────────────────
  {
    const state = board({ taxers: 2, hand: ["C677-EXTRA", "C677-FODDER", "C677-FODDER"], energy: ["V1"] });
    const extra = ids(state, "p1", "hand", "C677-EXTRA")[0];
    const fodders = ids(state, "p1", "hand", "C677-FODDER");
    let step = take(state, activateOf(state, extra));
    // The first price asks between two cards; a reload between the two
    // prices pays the second once, not twice and not never.
    assert.equal(step.state.prompt.kind, "chooseCards");
    step = take(step.state, { type: "choose", player: "p1", cards: [fodders[0]] });
    const between = JSON.parse(JSON.stringify(step.state)) as EngineState;
    const done = payWith(step, fodders[1]);
    const doneReloaded = payWith({ state: between, events: step.events }, fodders[1]);
    assert.equal(JSON.stringify(doneReloaded.state), JSON.stringify(done.state));
    assert.deepEqual([...ids(done.state, "p1", "warp", "C677-FODDER")].sort(), [...fodders].sort(), "each tax is charged once");
    assert.equal(draws(done.events), 1);
    assertConsistentG(done.state);
  }
  {
    // Each price alone is payable with the one other card; both together are
    // not, so the activation is not offered rather than half paid.
    const state = board({ taxers: 2, hand: ["C677-EXTRA", "C677-FODDER"], energy: ["V1"] });
    const extra = ids(state, "p1", "hand", "C677-EXTRA")[0];
    assert.ok(!IMPL.legalActions(CTX, state).some((row) => row.action.type === "activate" && row.action.card === extra));
    assert.equal(rejectedActionsG(state).find((row) => row.action.type === "activate" && row.action.card === extra)?.why[0]?.kind, "forbidden");
  }

  // ── actor and counted-use conditions ────────────────────────────────────
  {
    // A rule on the other player charges this one nothing.
    const state = board({ taxers: 0, hand: ["C677-EXTRA"], energy: ["V1"] });
    injectTax(state, 6772, { player: "p2" });
    const extra = ids(state, "p1", "hand", "C677-EXTRA")[0];
    const result = take(state, activateOf(state, extra));
    assert.equal(result.state.prompt.kind, "main");
    assert.ok(!result.events.some((e) => e.type === "move" && e.to === "warp"));
    assert.equal(draws(result.events), 1);
  }
  {
    // "One more activation is free": the activation that spends the counted
    // use is untaxed, the next one pays.
    const state = board({ taxers: 0, hand: ["C677-EXTRA", "C677-EXTRA", "C677-FODDER"], energy: ["V1", "V1"] });
    injectTax(state, 6773, { player: "p1", uses: 1 });
    const [first, second] = ids(state, "p1", "hand", "C677-EXTRA");
    const fodder = ids(state, "p1", "hand", "C677-FODDER")[0];
    const free = take(state, activateOf(state, first));
    assert.ok(!free.events.some((e) => e.type === "move" && e.to === "warp"), "the counted use is spent untaxed");
    assert.equal(free.state.effects.find((e) => e.id === 6773)?.forbid?.uses, 0);
    const taxedAgain = payWith(take(free.state, activateOf(free.state, second)), fodder);
    assert.deepEqual(ids(taxedAgain.state, "p1", "warp", "C677-FODDER"), [fodder]);
    assertConsistentG(taxedAgain.state);
  }

  // The [Auto] and [Counter] activations this suite used to stop on are
  // charged now: `activation-taxes-677.ts` plays them on the catalog cards.
}
finally {
  for (const id of injected) delete DEFS[id];
}
