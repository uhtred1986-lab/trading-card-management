/** Historical comparator provenance + six already-consumed defensive decision fixtures. No whole games/holdouts. */
import ts from "typescript";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { beforeDefensePolicy, frozenBaselinePin, verifyFrozenBaselineSources } from "../lib/arena-defense-baseline";
import manifest from "../fixtures/policy-before-1026/manifest.json";
import type { CardDef,PlayerId } from "../../src/lib/arena/types";
import type { PinnedMatch } from "../../src/lib/arena/browser";
import { policyTurn } from "../../src/lib/arena/policy/boundary";
import { localPolicy } from "../../src/lib/arena/policy/combat";
import { policyRng } from "../../src/lib/arena/policy/rng";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { DBS_FILES } from "../../src/lib/arena/rulesets/dbs";
import { makeReplayBundle } from "../../src/lib/arena/replay-core";
import { mainPhaseMatch, stage, type Layout } from "./arena-policy-main-fixture";
import { instance, TACTICAL_CARDS, takeLegal, zones } from "./arena-real-card-tactics-fixture";
import { permutedFor } from "./arena-policy-permute";
const SEED=899,REVISION="a899000000000000000000000000000000000899";
const clone=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
const hash=(s:string|Buffer)=>createHash("sha256").update(s).digest("hex");
const root=new URL("../../",import.meta.url);
const read=(path:string)=>readFileSync(new URL(path,root),"utf8");
for(const source of manifest.sources){
  const original=execFileSync("git",["show",`${manifest.originalCommit}:${source.originalPath}`],{cwd:root,encoding:"utf8"});
  assert.equal(hash(original),source.originalSha256);
  assert.equal(execFileSync("git",["rev-parse",`${manifest.originalCommit}:${source.originalPath}`],{cwd:root,encoding:"utf8"}).trim(),source.gitBlob);
  let reconstructed=read(source.path);for(const [oldPath,adaptedPath] of Object.entries(source.rewrites))reconstructed=reconstructed.replaceAll(adaptedPath,oldPath);
  assert.equal(reconstructed,original,"only import paths differ from exact historical blob");
}
for(const dependency of manifest.sharedDependencies){
  const original=execFileSync("git",["show",`${manifest.originalCommit}:${dependency.path}`],{cwd:root,encoding:"utf8"});
  assert.equal(hash(original),dependency.originalSha256);
  if(!dependency.reviewedChange)assert.equal(read(dependency.path),original,"shared dependency exact historical bytes");
  else {
    assert.equal(dependency.path,"src/lib/arena/policy/contract.ts");
    const runtime=(text:string)=>ts.createSourceFile("contract.ts",text,ts.ScriptTarget.Latest,true).statements.filter(statement=>
      !ts.isImportDeclaration(statement)&&!ts.isInterfaceDeclaration(statement)&&!ts.isTypeAliasDeclaration(statement)&&
      !(ts.isFunctionDeclaration(statement)&&statement.name?.text==="buildDecisions")).map(statement=>statement.getText());
    assert.deepEqual(runtime(read(dependency.path)),runtime(original),"all contract runtime declarations consumed by historical policy remain exact; only boundary metadata forwarding differs");
  }
}
verifyFrozenBaselineSources();
for(const path of [...manifest.sources,...manifest.sharedDependencies].map(s=>s.path))
  assert.throws(()=>verifyFrozenBaselineSources(p=>read(p)+(p===path?"\n// mutation":"")),/changed/,"any frozen source/shared dependency mutation must refuse");
assert.deepEqual(frozenBaselinePin(),frozenBaselinePin());
// DB1-019 verbatim from the committed catalog snapshot (evidence/649), mapped to the CardDef shape.
const parsed = JSON.parse(readFileSync(new URL("../../docs/arena-backlog/evidence/649/catalog-subset-2026-10-13.json", import.meta.url), "utf8")) as Record<string, unknown>;
const subset = (Array.isArray(parsed) ? parsed : Object.values(parsed).find(Array.isArray)) as Record<string, unknown>[];
const raw = subset.find((c) => c.id === "DB1-019")!;
const niagara: CardDef = { id: "DB1-019", name: raw.name as string, type: raw.cardType as CardDef["type"], colors: raw.colors as string[], energyCost: Number(raw.energyCost), zEnergyCost: null, power: null, comboCost: null, comboPower: null, skill: raw.skill as string, characters: [], traits: [], back: null } as CardDef;
const cards = [...TACTICAL_CARDS, niagara];
const defs = Object.fromEntries(cards.map((c) => [c.id, c]));
const compiled = rulesFromCompiler(defs);
const scripts = Object.fromEntries(cards.flatMap(c => [c.id, ...(c.back ? [`${c.id}#back`] : [])].map(id => { assert.ok(compiled[id]?.complete, `${id} compiles`); return [id, compiled[id]]; })));
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


const old=beforeDefensePolicy(),current=localPolicy();let oldAccepts=0,currentAccepts=0;
for(const v of variants()){
  const turn=policyTurn(v.match,v.seat,0),rng=policyRng(89901);
  const inputBefore=clone(turn.input),rngBefore=clone(rng);
  const historical=old(turn.input,rng);
  assert.deepEqual(old(clone(turn.input),clone(rng)),historical,"JSON round trip deterministic");
  assert.deepEqual(turn.input,inputBefore,"historical policy does not mutate restricted input");assert.deepEqual(rng,rngBefore,"historical policy does not mutate policy RNG");
  for(const salt of [8991,8992])assert.deepEqual(old(policyTurn(permutedFor(v.match,v.seat,salt),v.seat,0).input,rng),historical,"hidden twin policy answer unchanged");
  const action=(answer:ReturnType<typeof old>)=>{const a=turn.key.menu[answer.answer.id];return a?.type==="activate"?"activation":a?.type==="combo"?"combo":"pass";};
  const before=action(historical),after=action(current(turn.input,rng));
  const ok=v.acceptable.includes(before);if(ok)oldAccepts++;if(v.acceptable.includes(after))currentAccepts++;
  assert.equal(ok,v.kind!=="beneficial",`${v.key}: preserve the historical beneficial-defense failure only`);
  assert.ok(v.acceptable.includes(after),`${v.key}: current heuristic retains reviewed acceptable first action`);
}
assert.equal(oldAccepts,4);assert.equal(currentAccepts,6);
console.log("defense-baseline-899: exact Git/import reconstruction, every-source mutation refusal, purity/JSON/privacy and retained six-case first-decision baseline4/6 vs current6/6 passed");
