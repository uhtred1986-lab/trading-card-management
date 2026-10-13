/**
 * #549: the Auto price search folds interchangeable candidates into one answer.
 *
 * Fixed expectations, independent of the legacy oracle. Every price here is
 * synthetic; no printed card is claimed. The differential block compares the
 * reduced search with the exhaustive one on small boards, so the reduction is
 * checked against the very interpreter replay it shortens.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty, rulesFromCompiler } from "./harness";
import { engineFor } from "../../src/lib/arena/engines";
import { emptyFilter } from "../../src/lib/arena/text/filters";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { run } from "../../src/lib/arena/vm/flow";
import { NotYet } from "../../src/lib/arena/vm/errors";
import { automaticPriceHost, canFinishAutomaticPrice, interchangeableCandidates } from "../../src/lib/arena/vm/auto-costs";
import { stepScript, type Op, type ScriptFrame } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";

const rules = engineFor("rules");
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const dbs = loaded.definition;
const DISTINCT = Array.from({ length: 20 }, (_, i) => `DISTINCT549_${i}`);
const defs = { ...DEFS,
  // Synthetic supported price grammar, compiled from text; no printed card is asserted.
  SEARCH549: card("SEARCH549", { energyCost: 0, skill: "[Auto] Choose 1 of your Battle Cards and switch it to Rest Mode, choose 3 cards in your hand and place them in your Drop Area, then switch this card to Rest Mode: When you play this card, draw 1 card." }),
  COPYA549: card("COPYA549", { energyCost: 0, skill: null }),
  COPYB549: card("COPYB549", { energyCost: 0, skill: null }),
  TARGETS549: card("TARGETS549", { name: "Price Target", energyCost: 0, skill: null }),
  PERMCOND549: card("PERMCOND549", { energyCost: 0, skill: "[Permanent] This card gets +1000 power." }),
  TAKE549: card("TAKE549", { energyCost: 0, skill: "[Permanent] This card gets +1000 power." }),
  ...Object.fromEntries(DISTINCT.map((id) => [id, card(id, { energyCost: 0, skill: null })])),
};
const scripts = rulesFromCompiler(defs);
// Dormant at 20 hand cards; after one departure it may replace a hand card's
// departure with standing *this Permanent* up — never the Auto's source.
scripts.PERMCOND549.bySkill[0] = { ...scripts.PERMCOND549.bySkill[0], unsupported: [], ops: [{ op: "if", cond: { kind: "count", sel: { side: "you", area: "hand" }, atMost: 19 }, then: [
  { op: "replace", event: "leave", target: { sel: { side: "you", area: "hand" } }, optional: true, with: [{ op: "switchMode", target: { sel: { special: "self" } }, mode: "active" }] },
] }] };
const takeOps = (area: "hand" | "deck"): Op[] => [{ op: "if", cond: { kind: "count", sel: { side: "you", area, take: 1 }, atLeast: 1 }, then: [{ op: "power", target: { sel: { special: "self" } }, amount: 1000 }] } as Op];
const ctx: EngineContext = { ...CTX, defs, scripts };
const reload = (s: VmState): VmState => JSON.parse(JSON.stringify(s));

function main(): VmState {
  let s = rules.createGame(ctx, { seed: 5490, p1: { name: "You", leader: "L-RED", main: fifty("V1") }, p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  s = rules.apply(ctx, s, { type: "chooseFirst", player: s.chooser, first: "p1" }).state as VmState;
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) s = rules.apply(ctx, s, { type: "pass", player: (s.prompt as { player: PlayerId }).player }).state as VmState;
  assert.equal(s.prompt.kind, "main");
  return s;
}
/** Turn a hand card into `id`, then put it in `area`. */
function stage(s: VmState, id: string, area: "hand" | "battle" | "drop" = "battle"): string {
  const physical = s.sides.p1.zones.hand[0];
  assert.ok(physical);
  s.cards[physical].cardId = id;
  if (area !== "hand") assert.ok(moveCard(s, dbs, physical, area, { owner: "p1" }).ok);
  return physical;
}
/** Exactly `ids.length` hand cards, renamed in order. */
function handOf(s: VmState, ids: string[]): string[] {
  while (s.sides.p1.zones.hand.length < ids.length) assert.ok(moveCard(s, dbs, s.sides.p1.zones.deck[0], "hand", { owner: "p1" }).ok);
  while (s.sides.p1.zones.hand.length > ids.length) assert.ok(moveCard(s, dbs, s.sides.p1.zones.hand[0], "deck", { owner: "p1" }).ok);
  const hand = s.sides.p1.zones.hand.slice();
  hand.forEach((id, i) => { s.cards[id].cardId = ids[i]; });
  return hand;
}
function frameFor(source: string, ops: Op[], vars: Record<string, string[]> = {}): ScriptFrame {
  return { ops, ip: 0, vars, card: source, master: "p1", skillIndex: 0, trigger: "played" };
}
function atPrompt(state: VmState, frame: ScriptFrame): { s: VmState; f: ScriptFrame; candidates: string[] } {
  const s = reload(state); const f = structuredClone(frame);
  s.programs = [];
  assert.equal(stepScript(automaticPriceHost(ctx, dbs, s, []), f), "wait");
  assert.equal(s.prompt.kind, "chooseCards");
  return { s, f, candidates: s.prompt.kind === "chooseCards" ? s.prompt.choice.candidates : [] };
}
function decided(state: VmState, frame: ScriptFrame, symmetry: boolean): boolean | "unknown" {
  try {
    return canFinishAutomaticPrice(ctx, dbs, state, frame, { symmetry });
  } catch (err) {
    if (err instanceof NotYet && err.issue === "#549") return "unknown";
    throw err;
  }
}
const isUnknown = (err: unknown) => err instanceof NotYet && err.issue === "#549";

const hand = (n: number, as: string, extra: Partial<{ differentNames: true }> = {}): Op => ({ op: "choose", sel: { side: "you", area: "hand", count: n, ...extra }, as });
const toDrop = (v: string): Op => ({ op: "moveTo", target: { var: v }, to: "drop" });
const restSelf: Op = { op: "switchMode", target: { sel: { special: "self" } }, mode: "rest" };
const targetsInDrop = (n: number, as: string): Op => ({ op: "choose", sel: { side: "you", area: "drop", count: n, filter: { ...emptyFilter(), names: ["Price Target"] } }, as });
const toWarp = (v: string): Op => ({ op: "moveTo", target: { var: v }, to: "warp" });
const restBattle: Op[] = [{ op: "choose", sel: { side: "you", area: "battle", count: 1 }, as: "b" }, { op: "switchMode", target: { var: "b" }, mode: "rest" }];

// 1. Soundness against the exhaustive search. Mixed copies, interleaved
// positions, both source modes, with and without a dormant replacement and a
// replacement aimed at one copy. Every reduced answer equals the full answer.
{
  const prices: Record<string, Op[]> = {
    discardThenRest: [hand(3, "h"), toDrop("h"), restSelf],
    namedTransfer: [hand(2, "h"), toDrop("h"), targetsInDrop(2, "t"), toWarp("t")],
    battleThenHand: [...restBattle, hand(2, "h"), toDrop("h"), restSelf],
    differentNames: [hand(2, "h", { differentNames: true }), toDrop("h"), targetsInDrop(1, "t"), toWarp("t")],
  };
  const hands: Record<string, string[]> = {
    grouped: ["COPYA549", "COPYA549", "COPYA549", "COPYB549", "COPYB549", "TARGETS549", "TARGETS549"],
    interleaved: ["COPYA549", "TARGETS549", "COPYB549", "COPYA549", "TARGETS549", "COPYB549", "COPYA549"],
    oneTarget: ["COPYA549", "COPYA549", "TARGETS549", "COPYA549", "COPYB549", "COPYA549", "COPYA549"],
  };
  const outcomes = new Set<string>();
  let cases = 0;
  for (const [priceName, ops] of Object.entries(prices)) {
    for (const [handName, ids] of Object.entries(hands)) {
      for (const rested of [false, true]) {
        for (const board of ["plain", "dormant", "aimed"] as const) {
          const s = main();
          const source = stage(s, "SEARCH549");
          if (board === "dormant") s.cards[stage(s, "PERMCOND549")].mode = "rest";
          const cards = handOf(s, ids);
          if (board === "aimed") addEffect(s, [], { master: "p1", source, target: cards[1], kind: "replaceLeave", value: { to: "warp", optional: true }, until: "turn" });
          if (rested) s.cards[source].mode = "rest";
          const frame = frameFor(source, ops);
          if (ops[0].op === "choose" && ops[0].sel.area === "hand") {
            const at = atPrompt(s, frame);
            assert.ok(interchangeableCandidates(ctx, dbs, at.s, at.f, at.candidates, new Set()).size > 0, `${priceName}/${handName}/${board}: copies fold at the first prompt`);
          }
          const before = JSON.stringify(s);
          const full = decided(s, frame, false);
          const reduced = decided(s, frame, true);
          assert.equal(JSON.stringify(s), before, "preflight mutates nothing");
          assert.notEqual(full, "unknown", `${priceName}/${handName}/${board}: the small exhaustive search finishes`);
          assert.equal(reduced, full, `${priceName}/${handName}/${rested ? "rested" : "active"}/${board}: reduced search equals exhaustive search`);
          outcomes.add(String(full));
          cases++;
        }
      }
    }
  }
  assert.deepEqual([...outcomes].sort(), ["false", "true"], "the matrix contains both payable and unpayable prices");
  console.log(`auto-search-549 differential: ${cases} boards, reduced = exhaustive`);
}

// 2. What makes candidates one class, and what keeps them apart.
{
  const s = main();
  const source = stage(s, "SEARCH549");
  const cards = handOf(s, ["COPYA549", "COPYA549", "COPYB549", "COPYA549", "COPYB549"]);
  const ops = [hand(2, "h"), toDrop("h"), restSelf];
  {
    const { s: at, f, candidates } = atPrompt(s, frameFor(source, ops));
    const classes = interchangeableCandidates(ctx, dbs, at, f, candidates, new Set());
    assert.deepEqual([...classes.entries()].sort(), [[cards[1], cards[0]], [cards[3], cards[0]], [cards[4], cards[2]]].sort(), "copies fold onto the first of their class");
  }
  // Different instance facts keep a copy apart.
  {
    const marked = reload(s); marked.cards[cards[1]].usedThisTurn = [0];
    const { s: at, f, candidates } = atPrompt(marked, frameFor(source, ops));
    const classes = interchangeableCandidates(ctx, dbs, at, f, candidates, new Set());
    assert.ok(!classes.has(cards[1]) && ![...classes.values()].includes(cards[1]), "a used copy is its own class");
    assert.equal(classes.get(cards[3]), cards[0]);
  }
  // A saved variable, an occurrence key or an effect names a card.
  {
    const { s: at, f, candidates } = atPrompt(s, frameFor(source, ops, { other: [cards[1]] }));
    const classes = interchangeableCandidates(ctx, dbs, at, f, candidates, new Set());
    assert.ok(!classes.has(cards[1]) && ![...classes.values()].includes(cards[1]), "a saved variable names this copy");
    const keyed = reload(s);
    (keyed.sides.p1.attrs as Record<string, unknown>).probe549 = `combo-drop:1:${cards[3]}:0`;
    const k = atPrompt(keyed, frameFor(source, ops));
    const keyedClasses = interchangeableCandidates(ctx, dbs, k.s, k.f, k.candidates, new Set());
    assert.ok(!keyedClasses.has(cards[3]) && ![...keyedClasses.values()].includes(cards[3]), "an id inside a composite string is a reference");
    assert.equal(keyedClasses.get(cards[1]), cards[0], "a prefix id is not mistaken for the longer one");
  }
  // Position guards: a bulk read of the area, a positional selector anywhere in
  // the game's programs, or a zone the interpreter reads from the top.
  {
    const bulk: Op[] = [hand(1, "h"), toDrop("h"), { op: "moveTo", target: { sel: { side: "you", area: "hand" } }, to: "deck" }];
    const b = atPrompt(s, frameFor(source, bulk));
    assert.equal(interchangeableCandidates(ctx, dbs, b.s, b.f, b.candidates, new Set()).size, 0, "a remaining bulk move sees hand order");
    const a = atPrompt(s, frameFor(source, ops));
    assert.equal(interchangeableCandidates(ctx, dbs, a.s, a.f, a.candidates, new Set(["hand"])).size, 0, "a positional hand reader disables folding");
    assert.equal(interchangeableCandidates(ctx, dbs, a.s, a.f, a.candidates, new Set(["play"])).size, 3, "an in-play positional reader leaves the hand alone");
    const life = reload(s);
    const lifeOps: Op[] = [{ op: "choose", sel: { side: "you", area: "life", count: 1 }, as: "l" }, { op: "faceUp", target: { var: "l" } }];
    const l = atPrompt(life, frameFor(source, lifeOps));
    assert.ok(l.candidates.length > 1 && l.candidates.every((id) => life.cards[id].cardId === "V1"));
    assert.equal(interchangeableCandidates(ctx, dbs, l.s, l.f, l.candidates, new Set()).size, 0, "Life order is read by damage, so identical Life cards stay apart");
  }
  // The planner collects positional readers from every card program in this
  // game: a [Permanent] reading the hand by position turns folding off, and one
  // reading the deck does not.
  {
    const old = scripts.TAKE549.bySkill[0];
    try {
      const big = main();
      const src = stage(big, "SEARCH549");
      stage(big, "TAKE549", "drop");
      handOf(big, Array(20).fill("COPYA549"));
      big.cards[src].mode = "rest";
      big.cards[stage(big, "PERMCOND549")].mode = "rest";
      handOf(big, Array(20).fill("COPYA549"));
      const frame = frameFor(src, [hand(3, "h"), toDrop("h"), restSelf]);
      scripts.TAKE549.bySkill[0] = { ...old, unsupported: [], ops: takeOps("deck") };
      assert.equal(canFinishAutomaticPrice(ctx, dbs, big, frame), false, "a deck-top reader leaves the hand foldable");
      scripts.TAKE549.bySkill[0] = { ...old, unsupported: [], ops: takeOps("hand") };
      assert.throws(() => canFinishAutomaticPrice(ctx, dbs, big, frame), isUnknown, "a hand-position reader keeps the bounded unknown");
    } finally { scripts.TAKE549.bySkill[0] = old; }
  }
}

// 3. The audit's P0 shape: a dormant conditional replacement bypasses every
// narrow proof. Twenty copies now finish exactly; twenty distinct cards still
// exceed the bound and stay typed unknown rather than unaffordable.
{
  const s = main();
  const source = stage(s, "SEARCH549");
  s.cards[stage(s, "PERMCOND549")].mode = "rest";
  handOf(s, Array(20).fill("V1"));
  s.cards[source].mode = "rest";
  const frame = frameFor(source, [hand(3, "h"), toDrop("h"), restSelf]);
  assert.throws(() => canFinishAutomaticPrice(ctx, dbs, s, frame, { symmetry: false }), isUnknown, "the exhaustive search alone exceeds the bound");
  const started = performance.now();
  assert.equal(canFinishAutomaticPrice(ctx, dbs, s, frame), false, "twenty copies: proven unpayable");
  console.log(`auto-search-549 dormant replacement, 20 copies, proven false: ${(performance.now() - started).toFixed(1)} ms`);
  const standing = reload(s); standing.cards[source].mode = "active";
  assert.equal(canFinishAutomaticPrice(ctx, dbs, standing, frame), true, "an active source pays by declining the replacement");
  const distinct = reload(s);
  handOf(distinct, DISTINCT);
  assert.throws(() => canFinishAutomaticPrice(ctx, dbs, distinct, frame), isUnknown, "twenty distinct cards remain a typed unknown, never unaffordable");
}

// 4. End to end through the real pending Auto: the compiled price is decided
// unaffordable without an interruption, and the payable board pays once.
{
  const compiled = scripts.SEARCH549.bySkill[0];
  assert.deepEqual(compiled.unsupported, []);
  assert.deepEqual(compiled.price?.ops?.map((op) => op.op), ["choose", "switchMode", "choose", "moveTo", "switchMode"]);
  scripts.SEARCH549.bySkill[0] = { ...compiled, trigger: ["played"] };
  const pend = (s: VmState, source: string): GameEvent[] => {
    s.pending.push({ card: source, master: "p1", skillIndex: 0, trigger: "played" });
    const ev: GameEvent[] = [];
    run(ctx, dbs, s, ev);
    return ev;
  };
  // Only the source can be rested first, so the final self-rest cannot pay.
  const blocked = main();
  const source = stage(blocked, "SEARCH549");
  blocked.cards[stage(blocked, "PERMCOND549")].mode = "rest";
  handOf(blocked, Array(20).fill("V1"));
  const sides = JSON.stringify(blocked.sides);
  const ev = pend(blocked, source);
  assert.equal(blocked.outcome, undefined, "no typed interruption: the search finished");
  assert.equal(blocked.prompt.kind, "main");
  assert.ok(ev.some((e) => e.type === "note" && /unaffordable/.test(e.text)), "the Auto is cancelled as unaffordable");
  assert.equal(ev.some((e) => e.type === "skill"), false);
  assert.equal(JSON.stringify(blocked.sides), sides, "nothing was paid");

  // With the Permanent active it can be the rested Battle Card instead.
  const open = main();
  const src = stage(open, "SEARCH549");
  const perm = stage(open, "PERMCOND549");
  handOf(open, Array(20).fill("V1"));
  pend(open, src);
  assert.equal(open.prompt.kind, "chooseMode", "a payable price is offered");
  let step = rules.apply(ctx, reload(open), { type: "chooseMode", player: "p1", index: 0 }) as { state: VmState; events: GameEvent[] };
  assert.equal(step.state.prompt.kind, "chooseCards");
  assert.ok(step.state.prompt.kind === "chooseCards" && JSON.stringify(step.state.prompt.choice.candidates) === JSON.stringify([perm]), "the dead source-first pick is not offered");
  const events: GameEvent[] = [];
  let replaced = 0;
  step = rules.apply(ctx, reload(step.state), { type: "choose", player: "p1", cards: [perm] }) as typeof step;
  events.push(...step.events);
  for (let i = 0; i < 12 && step.state.prompt.kind !== "main"; i++) {
    const prompt = step.state.prompt;
    if (prompt.kind === "chooseCards") step = rules.apply(ctx, reload(step.state), { type: "choose", player: "p1", cards: [prompt.choice.candidates[0]] }) as typeof step;
    else if (prompt.kind === "replaceMove") {
      replaced++;
      // The last option is "Keep going to the Drop": decline the replacement.
      step = rules.apply(ctx, reload(step.state), { type: "chooseMode", player: prompt.player, index: prompt.options.length - 1 }) as typeof step;
    }
    else assert.fail(`unexpected prompt ${prompt.kind}`);
    events.push(...step.events);
  }
  assert.equal(step.state.prompt.kind, "main");
  assert.ok(replaced >= 1, "the dormant replacement was offered and declined during payment");
  assert.equal(step.state.cards[src].mode, "rest");
  assert.equal(step.state.cards[perm].mode, "rest");
  assert.equal(step.state.sides.p1.zones.hand.length, 20 - 3 + 1, "three paid, one drawn");
  assert.equal(events.filter((e) => e.type === "skill" && e.card === src).length, 1, "the skill fires once");
  assert.equal(events.filter((e) => e.type === "draw").length, 1);
  scripts.SEARCH549.bySkill[0] = compiled;
}

console.log("auto-search-549: interchangeable-candidate price search passed");
