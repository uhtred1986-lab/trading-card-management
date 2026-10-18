/** #899: turn-long defensive valuation. Real printed "+N power for the turn" Extras in two prepared
 * archetypes (White Cell BT31-142, SD15 DB1-019), each as a beneficial, an unnecessary and an
 * unaffordable variant. Engine oracle lines first (survival and resources of each continuation,
 * the reviewed acceptable-action set), then the frozen heuristic and both searches through
 * policyTurn/localStep with hidden-identity twins. No database, no provider.
 * Run: env -u DATABASE_URL npx tsx scripts/verify/arena-policy-defense-899.mts [--out FILE] */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import type { Action, CardDef, GameEvent, PlayerId } from "../../src/lib/arena/types";
import { applyMove, legalMoves, type PinnedMatch } from "../../src/lib/arena/browser";
import { localStep, policyTurn } from "../../src/lib/arena/policy/boundary";
import { localPolicy, COMBAT_POLICY_VERSION } from "../../src/lib/arena/policy/combat";
import { localMemory } from "../../src/lib/arena/policy/main";
import { policyRng } from "../../src/lib/arena/policy/rng";
import { searchPolicy, SEARCH_VERSION } from "../../src/lib/arena/policy/search";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { DBS_FILES } from "../../src/lib/arena/rulesets/dbs";
import { makeReplayBundle } from "../../src/lib/arena/replay-core";
import { mainPhaseMatch, stage, type Layout } from "./arena-policy-main-fixture";
import { permutedFor } from "./arena-policy-permute";
import { instance, TACTICAL_CARDS, takeLegal, zones } from "./arena-real-card-tactics-fixture";

const SEED = 899, REVISION = "a899000000000000000000000000000000000899";
const args = process.argv.slice(2);
const outFile = args[0] === "--out" ? args[1] : null;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

// DB1-019 verbatim from the committed catalog snapshot (evidence/649), mapped to the CardDef shape.
const parsed = JSON.parse(readFileSync(new URL("../../docs/arena-backlog/evidence/649/catalog-subset-2026-10-13.json", import.meta.url), "utf8")) as Record<string, unknown>;
const subset = (Array.isArray(parsed) ? parsed : Object.values(parsed).find(Array.isArray)) as Record<string, unknown>[];
const raw = subset.find((c) => c.id === "DB1-019")!;
const niagara: CardDef = { id: "DB1-019", name: raw.name as string, type: raw.cardType as CardDef["type"], colors: raw.colors as string[], energyCost: Number(raw.energyCost), zEnergyCost: null, power: null, comboCost: null, comboPower: null, skill: raw.skill as string, characters: [], traits: [], back: null } as CardDef;
const cards = [...TACTICAL_CARDS, niagara];
const defs = Object.fromEntries(cards.map((c) => [c.id, c]));
const compiled = rulesFromCompiler(defs);
const scripts = Object.fromEntries(cards.map((c) => { assert.ok(compiled[c.id]?.complete, `${c.id} compiles`); return [c.id, compiled[c.id]]; }));
const base = await makeReplayBundle({ defs, scripts, art: Object.fromEntries(cards.map((c) => [c.id, { front: `/art/${c.id}.png`, back: null }])), rulesetFiles: DBS_FILES, runtime: REVISION });
const bundle = { ...base, decks: { p1: { name: "attacker", leader: "SD5-01", main: Array<string>(50).fill("SD5-03") }, p2: { name: "defender", leader: "BT31-116", main: Array<string>(50).fill("BT31-132") } } };
const opening = await mainPhaseMatch(bundle, SEED, REVISION);
const empty: Layout = { hand: [], energy: [], battle: [], leaderMode: "rest" };

function layout(p1: Layout, p2: Layout, leaders: [string, string]): PinnedMatch {
  const m = stage(opening, { p1, p2 });
  for (const [p, id] of [["p1", leaders[0]], ["p2", leaders[1]]] as const) {
    m.state.cards[zones(m, p, "leader")[0]].cardId = id;
    m.state.cards[zones(m, p, "leader")[0]].flipped = false;
    for (const card of [...zones(m, p, "life"), ...zones(m, p, "deck")]) m.state.cards[card].cardId = "SD5-03";
  }
  return m;
}

interface Variant {
  key: string; archetype: "white-cell" | "sd15-red-saiyan"; kind: "beneficial" | "unnecessary" | "unaffordable";
  seat: PlayerId; match: PinnedMatch; focus: string; attackerIds: string[]; horizonBattles: number;
  extra: string; combo: string; energy: number;
  /** The reviewed acceptable first answers, by what the seat spends. */
  acceptable: ("activation" | "combo" | "pass")[];
  /** Whether the guard must survive every battle of the horizon. */
  mustSurvive: boolean;
}

function defenceWindow(m: PinnedMatch, attacker: string, target: string): PinnedMatch {
  let match = takeLegal(m, (a) => a.type === "attack" && a.attacker === attacker && a.target === target).match;
  for (let n = 0; n < 8 && !(match.state.prompt.kind === "combo" && (match.state.prompt as { player?: PlayerId }).player === "p2"); n++)
    match = takeLegal(match, (a) => a.type === "pass" || a.type === "counter" && a.card === null || a.type === "block" && a.card === null).match;
  if (match.state.prompt.kind !== "combo") throw new Error("defensive Combo window not reached");
  return match;
}

function variants(): Variant[] {
  const out: Variant[] = [];
  const white = (kind: Variant["kind"], attackerCard: string, energy: number, acceptable: Variant["acceptable"], mustSurvive: boolean) => {
    const m = layout({ ...empty, battle: [{ cardId: attackerCard, mode: "active" }, { cardId: attackerCard, mode: "active" }] },
      { ...empty, hand: ["BT31-142", "BT31-132"], energy: Array<string>(energy).fill("BT31-132"), battle: [{ cardId: "BT31-129", mode: "rest" }] }, ["SD5-01", "BT31-116"]);
    m.state.cards[zones(m, "p2", "leader")[0]].flipped = true;
    const cell = instance(m, "p2", "battle", "BT31-129")!, attackers = zones(m, "p1", "battle");
    out.push({ key: `white-cell-${kind}`, archetype: "white-cell", kind, seat: "p2", match: defenceWindow(m, attackers[0], cell), focus: cell, attackerIds: [...attackers], horizonBattles: 2, extra: "BT31-142", combo: "BT31-132", energy, acceptable, mustSurvive });
  };
  white("beneficial", "SD5-03", 2, ["activation"], true);
  white("unnecessary", "SD15-03", 2, ["pass"], true);
  white("unaffordable", "SD5-03", 1, ["combo", "pass"], false);
  const sd15 = (kind: Variant["kind"], guardCard: string, energy: number, acceptable: Variant["acceptable"], mustSurvive: boolean) => {
    const m = layout({ ...empty, battle: [{ cardId: "SD15-03", mode: "active" }, { cardId: "SD15-03", mode: "active" }] },
      { ...empty, hand: ["DB1-019", "SD5-03"], energy: Array<string>(energy).fill("SD5-03"), battle: [{ cardId: guardCard, mode: "rest" }] }, ["SD5-01", "SD15-01"]);
    const guard = instance(m, "p2", "battle", guardCard)!, attackers = zones(m, "p1", "battle");
    out.push({ key: `sd15-niagara-${kind}`, archetype: "sd15-red-saiyan", kind, seat: "p2", match: defenceWindow(m, attackers[0], guard), focus: guard, attackerIds: [...attackers], horizonBattles: 2, extra: "DB1-019", combo: "SD5-03", energy, acceptable, mustSurvive });
  };
  sd15("beneficial", "SD15-03", 2, ["activation"], true);
  sd15("unnecessary", "SD5-03", 2, ["pass"], true);
  sd15("unaffordable", "SD15-03", 1, ["combo", "pass"], false);
  return out;
}

const actor = (m: PinnedMatch) => (m.state.prompt as { player?: PlayerId }).player;
const activeEnergy = (m: PinnedMatch, p: PlayerId) => zones(m, p, "energy").filter((id) => m.state.cards[id].mode === "active").length;
const present = (v: Variant, m: PinnedMatch) => zones(m, v.seat, "battle").includes(v.focus);
const handCount = (m: PinnedMatch, p: PlayerId) => zones(m, p, "hand").length;

/** Fixed adversary: the two public attackers attack the guard; every response window declines. */
function passive(m: PinnedMatch, v: Variant): Action {
  const legal = legalMoves(m).map((l) => l.action);
  if (m.state.prompt.kind === "main" && actor(m) !== v.seat) {
    const attack = legal.find((a) => a.type === "attack" && v.attackerIds.includes(a.attacker) && a.target === v.focus);
    if (attack) return attack;
  }
  const no = legal.find((a) => a.type === "pass" || a.type === "endMain" || (a.type === "counter" || a.type === "block" || a.type === "zEnergyFromCombo") && a.card === null);
  return no ?? legal.find((a) => a.type === "choose" && a.cards.length === 0 || a.type === "optionalCost" && !a.pay) ?? legal[0];
}
function oracle(m: PinnedMatch, v: Variant, line: "activation" | "combo" | "pass"): Action {
  const legal = legalMoves(m).map((l) => l.action);
  if (actor(m) !== v.seat) return passive(m, v);
  if (m.state.prompt.kind === "chooseCards") {
    const pr = m.state.prompt, chosen = pr.choice.candidates.includes(v.focus) ? v.focus : pr.choice.min > 0 ? pr.choice.candidates[0] : null;
    return legal.find((a) => a.type === "choose" && (chosen ? a.cards.includes(chosen) : a.cards.length === 0)) ?? legal[0];
  }
  if (m.state.prompt.kind === "chooseMode") {
    // "Leader Cards or Battle Cards": the oracle names the guard's kind (a Battle Card).
    const options = (m.state.prompt as unknown as { options: string[] }).options;
    const want = options.findIndex((label) => /^battle cards?$/i.test(label));
    return legal.find((a) => a.type === "chooseMode" && a.index === Math.max(0, want)) ?? legal[0];
  }
  if (line === "activation") {
    const extra = zones(m, v.seat, "hand").find((id) => m.state.cards[id].cardId === v.extra);
    const a = legal.find((x) => x.type === "activate" && x.card === extra);
    if (a) return a;
  }
  if (line === "combo" && m.state.prompt.kind === "combo" && m.state.battle?.attacker === v.attackerIds[0]) {
    const a = legal.find((x) => x.type === "combo" && m.state.cards[x.card].cardId === v.combo);
    if (a) return a;
  }
  return passive(m, v);
}
const done = (v: Variant, m: PinnedMatch, ev: GameEvent[]) => m.state.phase === "over" || m.state.turn !== v.match.state.turn ||
  ev.filter((e) => e.type === "powerCompare").length >= v.horizonBattles && !m.state.battle || !present(v, m);

interface Outcome { survived: boolean; battles: number; energySpent: number; handDelta: number; combos: number; activations: number; }
interface Step { match: PinnedMatch; events: GameEvent[]; combo?: boolean; activate?: boolean; }
const viaAction = (m: PinnedMatch, v: Variant, a: Action): Step => {
  const out = applyMove(m, a), mine = actor(m) === v.seat;
  return { match: out.match, events: out.events, combo: mine && a.type === "combo", activate: mine && a.type === "activate" && m.state.cards[a.card].cardId === v.extra };
};
function run(v: Variant, pick: (m: PinnedMatch, n: number) => Step): Outcome {
  let m = clone(v.match); const ev: GameEvent[] = []; let combos = 0, activations = 0;
  const e0 = activeEnergy(m, v.seat), h0 = handCount(m, v.seat);
  for (let n = 0; n < 80 && !done(v, m, ev); n++) {
    const s = pick(m, n);
    if (s.combo) combos++;
    if (s.activate) activations++;
    m = s.match; ev.push(...s.events);
  }
  return { survived: present(v, m), battles: ev.filter((e) => e.type === "powerCompare").length, energySpent: e0 - activeEnergy(m, v.seat), handDelta: handCount(m, v.seat) - h0, combos, activations };
}

const all = variants();
if (process.env.DBG) for (const v of all) console.log(v.key, activeEnergy(v.match, v.seat), JSON.stringify(legalMoves(v.match).filter((l) => l.action.type !== "pass").map((l) => [l.action.type, (l as { cost?: unknown }).cost])));
const lines: Record<string, Record<string, Outcome>> = {};
for (const v of all) {
  // An unaffordable Extra is not an oracle line: the policy must read the price, so it is never tried here.
  lines[v.key] = Object.fromEntries((["activation", "combo", "pass"] as const).filter((l) => l !== "activation" || v.kind !== "unaffordable").map((l) => [l, run(v, (m) => viaAction(m, v, oracle(m, v, l)))]));
  const o = lines[v.key];
  if (process.env.DBG) console.log(v.key, JSON.stringify(o));
  // Rules-derived expectations of the engine, independent of any policy.
  if (v.kind === "beneficial") {
    assert.ok(o.activation.survived && o.activation.battles === 2 && o.activation.combos === 0 && o.activation.energySpent >= 1, `${v.key}: the turn-long Extra holds both battles with no combo`);
    assert.equal(o.combo.survived, false, `${v.key}: a one-battle combo loses the second`);
    assert.equal(o.pass.survived, false, `${v.key}: passing loses the guard`);
  } else if (v.kind === "unnecessary") {
    assert.ok(o.pass.survived && o.pass.energySpent === 0 && o.pass.combos === 0, `${v.key}: the guard already holds; nothing needs spending`);
  } else {
    // The engine still lists the Extra; its typed price is what shows the seat cannot pay it.
    const offered = legalMoves(v.match).find((l) => l.action.type === "activate");
    assert.ok(offered?.cost && offered.cost.energy > activeEnergy(v.match, v.seat), `${v.key}: offered at a price above the seat's active energy`);
    assert.equal(o.pass.survived, false, `${v.key}: no payable line holds both battles`);
  }
}

const policies = [
  { key: `heuristic-combat-v${COMBAT_POLICY_VERSION}`, policy: localPolicy() },
  { key: `search-v${SEARCH_VERSION}-d2`, policy: searchPolicy({ depth: 2 }) },
  { key: `search-v${SEARCH_VERSION}-d3`, policy: searchPolicy({ depth: 3 }) },
];
const records: (Outcome & { variant: string; policy: string; first: string | null; accepted: boolean })[] = [];
let privacy = 0;
for (const v of all) for (const sel of policies) {
  const mem = { p1: localMemory(policyRng(89901)), p2: localMemory(policyRng(89902)) };
  let first: string | null = null;
  const result = run(v, (m, n) => {
    const p = actor(m)!;
    if (p !== v.seat) return viaAction(m, v, passive(m, v));
    const turn = policyTurn(m, p, n), rng = mem[p].rng, chosen = sel.policy(turn.input, rng);
    for (const salt of [8991, 8992]) {
      const twin = policyTurn(permutedFor(m, p, salt), p, n);
      assert.deepEqual(twin.input, turn.input, `${v.key}: hidden data stays outside the policy input`);
      assert.deepEqual(sel.policy(twin.input, rng), chosen, `${v.key}: hidden twins choose identically`);
    }
    privacy++;
    const step = localStep(m, p, n, mem[p], sel.policy);
    assert.ok(step.ok, `${v.key}/${sel.key}: legal answer`);
    mem[p] = step.memory;
    const taken = turn.key.menu[step.id];
    if (first === null) first = taken?.type ?? step.id;
    return { match: step.match, events: step.events, combo: taken?.type === "combo", activate: taken?.type === "activate" && m.state.cards[taken.card].cardId === v.extra };
  });
  const kind = first === "activate" ? "activation" : first === "combo" ? "combo" : "pass";
  // The first answer at the defensive window decides the line; a later pass is the engine's.
  records.push({ ...result, variant: v.key, policy: sel.key, first, accepted: v.acceptable.includes(kind) && (!v.mustSurvive || result.survived) });
}
for (const r of records) console.log(`${r.accepted ? "pass" : "FAIL"}  ${r.variant.padEnd(28)} ${r.policy.padEnd(18)} first=${r.first} survived=${r.survived} battles=${r.battles} energy=${r.energySpent} combos=${r.combos} activations=${r.activations}`);
const failed = records.filter((r) => !r.accepted);
if (outFile) writeFileSync(outFile, `${JSON.stringify({ seed: SEED, privacyPositions: privacy, lines, records }, null, 2)}\n`);
console.log(`${records.length - failed.length}/${records.length} acceptable, ${privacy} privacy-twin positions`);
assert.equal(failed.length, 0, JSON.stringify(failed, null, 2));
