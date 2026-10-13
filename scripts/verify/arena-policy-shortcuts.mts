/**
 * #645 (plan O2-02): the online opponent's free-choice shortcuts, moved behind the policy
 * contract (`src/lib/arena/policy/shortcuts.ts`) and called back through an adapter
 * (`src/lib/arena/ai/shortcut-input.ts`), proved without a database or a provider.
 *
 *   1. Moved, not copied; and a pure layer. The rules live in the policy layer once
 *      (`opponent.ts` keeps no copy). `shortcuts.ts` loads nothing outside `policy/` and
 *      names no engine state, seed or ambient randomness — first shown to catch a
 *      deliberately added import or `Math.random`.
 *   2. Online behaviour unchanged. `fixtures/arena-policy-shortcuts/before.json` was recorded
 *      from origin/main's `freeChoice` (before this change) at every position the walk below
 *      reaches: #641's game, every #642 scenario, #644's compound-choice fixture over 8 seeds,
 *      a mixed-cost synthetic deck on both engines over 16 seeds, and three [Empower]
 *      carries. The adapter picks the same menu index with the same words at every position
 *      where there was a shortcut, and declines at every position where there was not.
 *   3. Same choices through the contract. At every pinned position the shortcut over the
 *      seat's restricted observation and decisions (`policyTurn`) picks the same engine move
 *      as the online adapter (menu in the engine's order), and with the contract's canonical
 *      order it differs only where two decisions tie.
 *   4. Hidden data and the game's RNG never reach a choice: at every position, swapping the
 *      identities of cards the seat cannot see and moving the game's seed and RNG state leaves
 *      the online choice and the contract choice unchanged. The policy's own RNG is returned
 *      untouched by a shortcut and the fallback it wraps is reproducible.
 *   5. Golden cases for each rule: empty menu, no matching shortcut, stable ties, the
 *      thresholds, the words.
 *   6. The provider path. A shortcut position costs no request and needs no provider
 *      configuration; a position with no shortcut still goes to the provider once.
 *
 * Run from the repo root:  npx tsx scripts/verify/arena-policy-shortcuts.mts --engine rules   (part of `npm test`)
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { checkImportGraph, diskRead, policyLayerRule, policyLayerSourceViolations } from "../lib/import-graph.ts";
import { collectPositions, type Position } from "./arena-policy-shortcuts-positions.mts";
import { RULES } from "../../src/lib/arena/vm";
import { canonicalJson } from "../../src/lib/arena/replay-core.ts";
import { policyTurn } from "../../src/lib/arena/policy/boundary.ts";
import { uniformPolicy } from "../../src/lib/arena/policy/contract.ts";
import { policyRng } from "../../src/lib/arena/policy/rng.ts";
import { mayShortcut, shortcutChoice, shortcutFor, shortcutInputOf, shortcutThen, SHORTCUT_WINDOWS, type ShortcutInput } from "../../src/lib/arena/policy/shortcuts.ts";
import { freeChoice, shortcutInputFromEngine } from "../../src/lib/arena/ai/shortcut-input";
import { chooseMove } from "../../src/lib/arena/ai/opponent";
import { createFakeProvider } from "../../src/lib/ai/providers/fake";
import { registerProvider, resetProviders } from "../../src/lib/ai/providers";
import { setSettingsLoader } from "../../src/lib/ai/settings";

const ROOT = process.cwd();
const started = Date.now();
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ---------------------------------------------------------------------------------------------
// 1. Moved, not copied; a pure layer.
{
  const entry = "src/lib/arena/policy/shortcuts.ts";
  const real = checkImportGraph(path.join(ROOT, entry), ROOT, diskRead, { forbidFile: policyLayerRule });
  assert.deepEqual(real.violations, [], "shortcuts.ts reaches outside the policy layer");
  for (const f of real.files) assert.deepEqual(policyLayerSourceViolations(f, fs.readFileSync(path.join(ROOT, f), "utf8")), [], `${f} names engine state or ambient randomness`);
  assert.ok(real.files.includes(entry) && real.files.every((f) => f.startsWith("src/lib/arena/policy/")), `the shortcuts load only policy modules (${real.files.join(", ")})`);

  const file = path.join(ROOT, entry);
  const base = fs.readFileSync(file, "utf8");
  const sabotaged = (extra: string) => (f: string) => (f === file ? `${base}\n${extra}\n` : diskRead(f));
  for (const [extra, expected] of [
    [`import { catalogDefOf } from "../engine-state";`, "policy layer reaches outside the policy layer src/lib/arena/engine-state.ts"],
    [`import { freeChoice } from "../ai/shortcut-input";`, "policy layer reaches outside the policy layer src/lib/arena/ai/shortcut-input.ts"],
    [`import { generateJson } from "@/lib/ai/core";`, "server-only import @/lib/ai/core"],
  ] as const) {
    const caught = checkImportGraph(file, ROOT, sabotaged(extra), { forbidFile: policyLayerRule });
    assert.ok(caught.violations.some((v) => v.file === entry && v.reason === expected), `adding \`${extra}\` to shortcuts.ts is caught as "${expected}" (got ${JSON.stringify(caught.violations)})`);
  }
  for (const [extra, expected] of [
    [`export const r = () => Math.random();`, "ambient time or randomness: Math.random"],
    [`import type { EngineState } from "../engines";\nexport type P = EngineState;`, "engine state or seed named: EngineState"],
  ] as const) assert.ok(policyLayerSourceViolations(entry, `${base}\n${extra}\n`).includes(expected), `the source scan catches "${expected}"`);

  const opponent = fs.readFileSync(path.join(ROOT, "src/lib/arena/ai/opponent.ts"), "utf8");
  for (const gone of ["function chargeChoice", "function mulliganChoice", "function freeChoice", "keeps the Z-Energy", "opening hand rule", "carries maximum"]) assert.ok(!opponent.includes(gone), `opponent.ts no longer holds the rule (${gone})`);
  assert.ok(opponent.includes(`from "./shortcut-input"`), "the online opponent calls the shortcuts through the adapter");
  const adapter = fs.readFileSync(path.join(ROOT, "src/lib/arena/ai/shortcut-input.ts"), "utf8");
  for (const gone of ["opening hand rule", "charge rule", "keeps the Z-Energy", "carries maximum"]) assert.ok(!adapter.includes(gone), `the adapter holds no rule or words (${gone})`);
}

// ---------------------------------------------------------------------------------------------
// The positions, and which of them are twins in everything the seat can see.
const positions = await collectPositions({ empower: true });
const kinds: Record<string, number> = {};
for (const p of positions) kinds[p.state.prompt.kind] = (kinds[p.state.prompt.kind] ?? 0) + 1;

type Before = { positions: number; kinds: Record<string, number>; nulls: { count: number; sha1: string }; hits: Record<string, [number, string]> };
const before = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/verify/fixtures/arena-policy-shortcuts/before.json"), "utf8")) as Before;
assert.equal(positions.length, before.positions, "the walk reaches the positions the before-snapshot recorded");
assert.deepEqual(kinds, before.kinds, "…with the same questions");

// ---------------------------------------------------------------------------------------------
// 2. The online path against the before-snapshot.
const online = new Map<string, { index: number; how: string } | null>();
{
  const nulls: string[] = [];
  const hits: Record<string, [number, string]> = {};
  for (const p of positions) {
    const r = freeChoice(p.ctx, p.state, p.legal, p.seat);
    online.set(p.label, r);
    if (r) hits[p.label] = [r.index, r.how]; else nulls.push(p.label);
    // The input is the menu's own: ids are menu indexes in menu order.
    const input = shortcutInputFromEngine(p.ctx, p.state, p.legal, p.seat);
    assert.deepEqual(input.decisions.map((d) => d.id), p.legal.map((_, i) => String(i)), `${p.label}: decisions are the menu, in order`);
  }
  for (const [label, expected] of Object.entries(before.hits)) assert.deepEqual(hits[label], expected, `${label}: the shortcut choice (index, words) is what origin/main picked`);
  assert.deepEqual(Object.keys(hits).sort(), Object.keys(before.hits).sort(), "no position gained a shortcut");
  assert.equal(nulls.length, before.nulls.count, "no position lost one");
  assert.equal(crypto.createHash("sha1").update(nulls.join("\n")).digest("hex"), before.nulls.sha1, "the positions still asked of the model are the same positions");
}

// What the walk covers.
const how: Record<string, number> = {};
for (const r of online.values()) if (r) how[r.how.replace(/\d+/, "N")] = (how[r.how.replace(/\d+/, "N")] ?? 0) + 1;
for (const h of ["only one legal move", "takes the first turn", "opening hand rule", "charge rule", "keeps the Z-Energy", "carries maximum N Empower markers"]) assert.ok((how[h] ?? 0) > 0, `the walk takes a "${h}" decision (${JSON.stringify(how)})`);
{
  const redraws = new Set<unknown>();
  for (const p of positions) {
    const r = online.get(p.label);
    if (r?.how === "opening hand rule") redraws.add((p.legal[r.index].action as { redraw: boolean }).redraw);
  }
  assert.deepEqual([...redraws].sort(), [false, true], "the mulligan rule both keeps and redraws");
}
// Positions where two decisions tie: reversing the menu changes the pick, and the first of the tied wins either way.
const tied = new Set<string>();
for (const p of positions) {
  const input = shortcutInputFromEngine(p.ctx, p.state, p.legal, p.seat);
  const forward = shortcutChoice(input);
  const backward = shortcutChoice({ ...input, decisions: [...input.decisions].reverse() });
  if (forward && backward && forward.id !== backward.id && forward.how !== "only one legal move") tied.add(p.label);
}
assert.ok(tied.size > 0, "the walk reaches tied decisions");

// ---------------------------------------------------------------------------------------------
// 3. The same choices through the contract.
let contractChecked = 0;
let canonicalDiffers = 0;
const nth = new Map(positions.map((p, i) => [p.label, i]));
const turnOf = (p: Position, match = p.match!) => policyTurn(match, p.seat, nth.get(p.label)!);
for (const p of positions) {
  if (!p.match) continue;
  const turn = turnOf(p);
  const hit = online.get(p.label) ?? null;
  const onlineAction = hit ? canonicalJson(p.legal[hit.index].action) : null;
  // The menu in the engine's own order (the order ties resolve online).
  const input = shortcutInputOf(turn.input);
  const byAction = new Map(input.decisions.map((d) => [canonicalJson(turn.key.menu[d.id]), d]));
  const ordered: ShortcutInput = { ...input, decisions: p.legal.flatMap((l) => byAction.get(canonicalJson(l.action)) ?? []) };
  const viaContract = shortcutChoice(ordered);
  assert.equal(viaContract ? canonicalJson(turn.key.menu[viaContract.id]) : null, onlineAction, `${p.label}: the restricted observation + decisions give the move the online adapter picks`);
  assert.equal(viaContract?.how ?? null, hit?.how ?? null, `${p.label}: …in the same words`);
  // The contract's own order: the same rule, ties by id.
  const canonical = shortcutFor(turn.input);
  assert.equal(canonical?.how ?? null, hit?.how ?? null, `${p.label}: the canonical order still has the same free choice`);
  if (canonical && canonical.id !== viaContract!.id) {
    canonicalDiffers++;
    assert.ok(tied.has(p.label), `${p.label}: the canonical order picks another move only between tied decisions`);
  }
  if (turn.input.decisions.actor !== p.seat) assert.equal(canonical, null);
  contractChecked++;
}
assert.ok(contractChecked > 500, `the contract path covers ${contractChecked} positions`);
// A seat that is not asked has no free choice.
{
  const p = positions.find((x) => x.match)!;
  const other = p.seat === "p1" ? "p2" : "p1";
  assert.equal(shortcutFor(policyTurn(p.match!, other, 0).input), null, "a seat that is not asked takes no shortcut");
}

// ---------------------------------------------------------------------------------------------
// 4. Hidden data and the game's RNG.
/** The same position for `seat` with every card it cannot read swapped for another (within an owner), and the game's seed and RNG moved. */
function twinOf(p: Position): Position {
  const state = clone(p.state);
  const seat = p.seat;
  const owners = ["p1", "p2"] as const;
  const area = (who: (typeof owners)[number], z: "hand" | "deck" | "life") => (state.sides[who].zones[z] ??= []);
  for (const who of owners) {
    const ids = [...(who === seat ? [] : area(who, "hand")), ...area(who, "deck"), ...area(who, "life")].filter((id) => !state.cards[id].faceUp && !state.cards[id].hidden);
    const faces = ids.map((id) => state.cards[id].cardId);
    // A fixed rotation: every hidden card takes the identity of the next, and the stacks are reversed.
    ids.forEach((id, i) => (state.cards[id].cardId = faces[(i + 1) % faces.length]));
    for (const z of ["deck", "life"] as const) area(who, z).reverse();
  }
  const bag = state as unknown as Record<string, unknown>;
  if (typeof bag.rngState === "number") bag.rngState = (bag.rngState + 0x9e3779b9) >>> 0;
  if (typeof bag.seed === "number") bag.seed = bag.seed + 12345;
  const engine = RULES;
  const legal = state.phase === "over" ? [] : engine.legalActions(p.ctx, state);
  return { ...p, state, legal, match: p.match ? { ...p.match, state: state as NonNullable<Position["match"]>["state"] } : undefined };
}
{
  let moved = 0;
  let identical = 0;
  for (const p of positions) {
    const twin = twinOf(p);
    const same = canonicalJson(twin.state) === canonicalJson(p.state);
    if (!same) moved++;
    // The own seat's view is untouched by the swap, so the menu is the same menu.
    assert.equal(canonicalJson(twin.legal.map((l) => l.action)), canonicalJson(p.legal.map((l) => l.action)), `${p.label}: the twin offers the seat the same menu`);
    const a = online.get(p.label) ?? null;
    const b = freeChoice(twin.ctx, twin.state, twin.legal, twin.seat);
    assert.deepEqual(b, a, `${p.label}: changing hidden cards and the game's RNG leaves the online shortcut unchanged`);
    if (p.match) {
      const t0 = turnOf(p);
      const t1 = turnOf(twin, twin.match);
      assert.deepEqual(shortcutFor(t1.input), shortcutFor(t0.input), `${p.label}: …and the contract's shortcut`);
    }
    if (a) identical++;
  }
  assert.ok(moved > positions.length * 0.8, `most twins really differ in hidden state (${moved} of ${positions.length})`);
  assert.ok(identical > 500, "the twins were compared at shortcut positions");
}
// The policy RNG: a shortcut draws nothing; the fallback it wraps is reproducible and seeded.
{
  const wrapped = shortcutThen(uniformPolicy);
  let shortcuts = 0;
  let deferred = 0;
  const answers = new Map<string, Set<string>>();
  for (const p of positions) {
    if (!p.match) continue;
    const turn = turnOf(p);
    if (!turn.input.decisions.decisions.length) continue;
    const rng = policyRng(7);
    const hit = shortcutFor(turn.input);
    const out = wrapped(turn.input, rng);
    assert.deepEqual(wrapped(turn.input, rng), out, `${p.label}: the same policy RNG gives the same answer`);
    if (hit) {
      shortcuts++;
      assert.equal(out.rng, rng, `${p.label}: a shortcut draws no randomness`);
      assert.equal(out.answer.id, hit.id);
    } else {
      deferred++;
      assert.deepEqual(out, uniformPolicy(turn.input, rng), `${p.label}: with no shortcut the wrapped policy is the fallback, RNG included`);
      const seen = answers.get(p.label) ?? new Set<string>();
      for (const seed of [1, 2, 3, 4, 5, 6]) seen.add(wrapped(turn.input, policyRng(seed)).answer.id);
      answers.set(p.label, seen);
    }
  }
  assert.ok(shortcuts > 100 && deferred > 100, `both paths ran (${shortcuts} shortcuts, ${deferred} deferred)`);
  assert.ok([...answers.values()].some((s) => s.size > 1), "explicit policy randomness does vary the fallback's answer with its seed");
}

// ---------------------------------------------------------------------------------------------
// 5. Golden cases.
{
  const card = (id: string, energyCost: number | null, ...colors: string[]) => ({ id, energyCost, colors });
  const mv = (type: string, action: Record<string, unknown>, id?: string) => ({ id: id ?? `${type}:${JSON.stringify(action)}`, type, action });
  const base = (window: string, decisions: ShortcutInput["decisions"], more: Partial<ShortcutInput> = {}): ShortcutInput => ({ seat: "p1", window, decisions, hand: [], leaderColors: ["Red"], carryMax: null, ...more });
  const pickOf = (i: ShortcutInput) => shortcutChoice(i);

  // Empty menu, and no matching shortcut: nothing to say, in every window.
  for (const w of [...SHORTCUT_WINDOWS, "main", "combo", "chooseCards", "somethingNew"]) assert.equal(pickOf(base(w, [])), null, `${w}: an empty menu is not a free choice`);
  assert.equal(pickOf(base("main", [mv("endMain", {}), mv("pass", {})])), null, "main: no shortcut");
  assert.equal(pickOf(base("mulligan", [mv("pass", {}), mv("endMain", {})])), null, "mulligan with no mulligan on the menu");
  assert.equal(pickOf(base("chooseFirst", [mv("chooseFirst", { first: "p2" }), mv("pass", {})])), null, "chooseFirst without taking the turn on offer");
  assert.equal(pickOf(base("charge", [mv("charge", { card: null }), mv("pass", {})])), null, "declining a charge is not the rule's choice");
  assert.equal(pickOf(base("zEnergyFromCombo", [mv("zEnergyFromCombo", { card: null }), mv("pass", {})])), null, "no card to keep as Z-Energy");
  assert.equal(pickOf(base("empowerCarry", [mv("empowerCarry", { amount: 0 }), mv("empowerCarry", { amount: 1 })], { carryMax: 2 })), null, "the maximum is not on offer");

  // Only move: any window, any move, with the words.
  for (const w of ["main", "somethingNew", "charge"]) assert.deepEqual(pickOf(base(w, [mv("endMain", {}, "only")])), { id: "only", how: "only one legal move" }, `${w}: one decision is taken`);
  assert.equal(mayShortcut("main", 1), true);
  assert.equal(mayShortcut("main", 2), false);
  assert.equal(mayShortcut("charge", 2), true);

  // First player.
  const flip = [mv("chooseFirst", { first: "p1" }, "a"), mv("chooseFirst", { first: "p2" }, "b")];
  assert.deepEqual(pickOf(base("chooseFirst", flip)), { id: "a", how: "takes the first turn" });
  assert.deepEqual(pickOf(base("chooseFirst", [...flip].reverse(), { seat: "p2" })), { id: "b", how: "takes the first turn" });

  // Mulligan: two cards costing <= 2 keep; one or none redraw; an X cost is not cheap.
  const keep = mv("mulligan", { redraw: false }, "keep");
  const redraw = mv("mulligan", { redraw: true }, "redraw");
  const hand = (...costs: (number | null)[]) => costs.map((c, i) => card(`h${i}`, c, "Red"));
  assert.equal(pickOf(base("mulligan", [keep, redraw], { hand: hand(2, 1, 6, 6) }))?.id, "keep");
  assert.equal(pickOf(base("mulligan", [redraw, keep], { hand: hand(2, 0, 6) }))?.id, "keep", "menu order does not matter");
  assert.equal(pickOf(base("mulligan", [keep, redraw], { hand: hand(2, 3, 6) }))?.id, "redraw", "one cheap card redraws");
  assert.equal(pickOf(base("mulligan", [keep, redraw], { hand: hand(3, 4, 5) }))?.id, "redraw");
  assert.equal(pickOf(base("mulligan", [keep, redraw], { hand: hand(2, null, null) }))?.id, "redraw", "an X cost is not cheap");
  assert.equal(pickOf(base("mulligan", [keep, redraw], { hand: [] }))?.id, "redraw", "an empty hand redraws");
  assert.equal(pickOf(base("mulligan", [keep, redraw], { hand: hand(2, 1) }))?.how, "opening hand rule");
  assert.equal(pickOf(base("mulligan", [keep, mv("pass", {})], { hand: hand(5, 5) })), null, "wants a redraw, none offered");

  // Charge: the dearest; off-colour adds 10; an X cost counts 9; the first of equals wins.
  const charge = (c: string | null) => mv("charge", { card: c }, `c:${c}`);
  const hnd = [card("A", 3, "Red"), card("B", 3, "Red"), card("C", 1, "Blue"), card("D", null, "Red"), card("E", 8, "Red")];
  const at = (ids: (string | null)[], more: Partial<ShortcutInput> = {}) => pickOf(base("charge", ids.map(charge), { hand: hnd, ...more }))?.id;
  assert.equal(at(["A", "B"]), "c:A", "a tie goes to the first listed");
  assert.equal(at(["B", "A"]), "c:B", "…whichever that is");
  assert.equal(at(["A", "C"]), "c:C", "an off-colour card (1 + 10) outscores a dearer on-colour one (3)");
  assert.equal(at(["C", "A"], { leaderColors: ["Red", "Blue"] }), "c:A", "…unless the leader pays for its colour");
  assert.equal(at(["A", "D"]), "c:D", "an X cost counts 9");
  assert.equal(at(["D", "E"]), "c:D", "9 beats 8");
  assert.equal(at([null, "A", "B"]), "c:A", "the decline is never chosen while a card can be charged");
  assert.equal(at([null, "E", "A"]), "c:E");
  assert.equal(at(["Z", "A"]), "c:Z", "a card the seat's hand does not show counts as 9");
  assert.equal(at([null]), "c:null", "a lone decline is the only move");
  assert.equal(pickOf(base("charge", [charge(null), mv("pass", {})], { hand: hnd })), null);
  assert.equal(pickOf(base("charge", [charge("A"), charge("B")], { hand: hnd }))?.how, "charge rule");
  assert.equal(pickOf(base("charge", [charge("A"), charge("C")], { hand: hnd, leaderColors: [] }))?.id, "c:A", "with no leader colours both are off colour: dearer wins");

  // Z-Energy.
  const z = (c: string | null) => mv("zEnergyFromCombo", { card: c }, `z:${c}`);
  assert.deepEqual(pickOf(base("zEnergyFromCombo", [z(null), z("x"), z("y")])), { id: "z:x", how: "keeps the Z-Energy" }, "the first card, never the decline");
  assert.deepEqual(pickOf(base("zEnergyFromCombo", [z("y"), z("x"), z(null)])), { id: "z:y", how: "keeps the Z-Energy" });

  // Empower.
  const e = (n: number) => mv("empowerCarry", { amount: n }, `e:${n}`);
  assert.deepEqual(pickOf(base("empowerCarry", [e(0), e(1), e(2)], { carryMax: 2 })), { id: "e:2", how: "carries maximum 2 Empower markers" });
  assert.deepEqual(pickOf(base("empowerCarry", [e(0), e(1)], { carryMax: 1 })), { id: "e:1", how: "carries maximum 1 Empower markers" });
  assert.equal(pickOf(base("empowerCarry", [e(1), e(0)], { carryMax: null }))?.id, "e:0", "an unstated maximum is 0, as origin/main read it");

  // A window with several decisions and no rule is nobody's free choice.
  assert.equal(pickOf(base("payCost", [mv("payCost", { option: 0 }), mv("payCost", { option: 1 })])), null);
  // Purity: the input is not changed.
  const frozen = base("charge", [charge("A"), charge("B")], { hand: hnd });
  const snapshot = JSON.stringify(frozen);
  shortcutChoice(frozen);
  assert.equal(JSON.stringify(frozen), snapshot, "a shortcut does not touch its input");
}

// ---------------------------------------------------------------------------------------------
// 6. The provider path.
{
  const env = { key: process.env.ANTHROPIC_API_KEY, app: process.env.APP_ANTHROPIC_API_KEY, base: process.env.ANTHROPIC_BASE_URL };
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.APP_ANTHROPIC_API_KEY;
  const noDb = {} as Parameters<typeof chooseMove>[0];
  try {
    // No provider configured at all: every shortcut position still answers, with no spend.
    let answered = 0;
    for (const p of positions) {
      if (!online.get(p.label)) continue;
      const choice = await chooseMove(noDb, p.ctx, p.state, p.legal, p.seat, "sparring");
      assert.equal(choice.spend, null, `${p.label}: a shortcut costs nothing`);
      assert.equal(choice.say, null);
      assert.deepEqual({ index: choice.index, how: choice.how }, online.get(p.label), `${p.label}: chooseMove returns the shortcut`);
      answered++;
    }
    assert.ok(answered > 700, `${answered} shortcut decisions answered with no provider configured`);

    // With one configured, a shortcut makes no request and a non-shortcut makes exactly one.
    process.env.ANTHROPIC_API_KEY = "sk-test-not-a-real-key";
    process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:9";
    setSettingsLoader(null);
    const fake = createFakeProvider({ id: "anthropic-api", script: () => ({ json: { move: 1, say: "" }, usage: { input: 10, output: 1, cacheRead: 0 } }) });
    registerProvider(fake);
    const stubDb = { insert: () => ({ values: () => ({ returning: async () => [{ id: 1 }] }) }) } as unknown as Parameters<typeof chooseMove>[0];
    for (const p of positions.filter((x) => online.get(x.label)).slice(0, 200)) await chooseMove(stubDb, p.ctx, p.state, p.legal, p.seat, "tournament");
    assert.equal(fake.requests.length, 0, "no shortcut position reached the provider");
    const open = positions.find((p) => !online.get(p.label) && p.legal.length > 2 && p.state.prompt.kind === "main")!;
    const asked = await chooseMove(stubDb, open.ctx, open.state, open.legal, open.seat, "sparring");
    assert.equal(fake.requests.length, 1, "a position with no shortcut still goes to the provider once");
    assert.equal(asked.how, "chosen by Claude");
    assert.equal(asked.index, 1);
    assert.ok(asked.spend, "…and is accounted");
  } finally {
    resetProviders();
    setSettingsLoader(null);
    for (const [k, v] of [["ANTHROPIC_API_KEY", env.key], ["APP_ANTHROPIC_API_KEY", env.app], ["ANTHROPIC_BASE_URL", env.base]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

console.log(
  `arena-policy-shortcuts: ${positions.length} positions (${online.size - [...online.values()].filter((v) => !v).length} shortcuts: ${JSON.stringify(how)}), online choices equal origin/main's at every one; ` +
    `${contractChecked} through the contract (${canonicalDiffers} differ only on ties of ${tied.size}); hidden-data twins unchanged; ${Date.now() - started} ms`,
);
