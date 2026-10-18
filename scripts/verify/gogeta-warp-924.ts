/** #924: complete public Gogeta text → persisted compiler records → VM. */
import assert from "node:assert/strict";
import rows from "./fixtures/gogeta-warp-924.json";
import { CTX, DEFS, card, fifty } from "./harness";
import { RULES as engine } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { compileCard } from "../../src/lib/arena/compile";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, CardDef, Color, PlayerId } from "../../src/lib/arena/types";
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const defs: Record<string, CardDef> = { ...DEFS,
  LEAD924: card("LEAD924", { type: "LEADER", colors: ["Black"], traits: ["Saiyan"], power: 10000, skill: null }),
  // #932: "a black ≪Saiyan≫-only card" is a black Leader whose traits are Saiyan and nothing else.
  LEADTWO932: card("LEADTWO932", { type: "LEADER", colors: ["Black"], traits: ["Saiyan", "Earthling"], power: 10000, skill: null }),
  LEADNOSAIYAN932: card("LEADNOSAIYAN932", { type: "LEADER", colors: ["Black"], traits: ["Earthling"], power: 10000, skill: null }),
  LEADREDSAIYAN932: card("LEADREDSAIYAN932", { type: "LEADER", colors: ["Red"], traits: ["Saiyan"], power: 10000, skill: null }),
  LEADMULTI932: card("LEADMULTI932", { type: "LEADER", colors: ["Black", "Red"], traits: ["Saiyan"], power: 10000, skill: null }),
  ENERGY924: card("ENERGY924", { colors: ["Black"], skill: null }),
  GOKU924: card("GOKU924", { colors: ["Black"], characters: ["Son Goku: Xeno"], power: 10000, skill: null }),
  VEG924: card("VEG924", { colors: ["Black"], characters: ["Vegeta: Xeno"], power: 10000, skill: null }),
  EXTRAGOKU924: card("EXTRAGOKU924", { type: "EXTRA", characters: ["Son Goku: Xeno"], power: 10000, skill: null }),
  EXTRAVEG924: card("EXTRAVEG924", { type: "EXTRA", characters: ["Vegeta: Xeno"], power: 10000, skill: null }),
  VEG20924: card("VEG20924", { colors: ["Black"], characters: ["Vegeta: Xeno"], power: 20000, skill: null }),
};
for (const row of rows) defs[row.id] = card(row.id, { name: row.name, type: "BATTLE", colors: row.colors as Color[], energyCost: Number(row.energy_cost), power: row.power, comboCost: row.combo_cost, comboPower: row.combo_power, characters: row.characters, traits: row.traits, skill: row.skill });
defs.BLOCKED924 = { ...defs["P-286"], id: "BLOCKED924", skill: defs["P-286"].skill + "<br>[Permanent] This card can't be played from any area except by skills." };
defs.OTHER924 = card("OTHER924", { colors: ["Black"], skill: "[Union-Fusion]{3}: <Son Goku: Xeno> and <Vegeta: Xeno>." });
const ctx = { ...CTX, defs, scripts: rulesFromCompiler(defs) };
const reload = (s: VmState): VmState => JSON.parse(JSON.stringify(s));
const apply = (s: VmState, a: Action): VmState => engine.apply(ctx, reload(s), a).state as VmState;
function stage(s: VmState, p: PlayerId, id: string, area: "hand" | "battle" | "energy" | "warp" | "drop"): string {
  const physical = s.sides[p].zones.deck[0]; assert.ok(physical); s.cards[physical].cardId = id;
  assert.ok(moveCard(s, game, physical, area, { owner: p }).ok); return physical;
}
function board(seed: number, energy = 6): VmState {
  let s = engine.createGame(ctx, { seed, p1: { name: "Other", leader: "L-RED", main: fifty("ENERGY924") }, p2: { name: "You", leader: "LEAD924", main: fifty("ENERGY924") } }).state as VmState;
  s = apply(s, { type: "chooseFirst", player: s.chooser, first: "p1" });
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) s = apply(s, { type: "pass", player: (s.prompt as { player: PlayerId }).player });
  s = apply(s, { type: "endMain", player: "p1" }); s = apply(s, { type: "charge", player: "p2", card: null });
  assert.equal(s.prompt.kind, "main");
  for (const p of ["p1", "p2"] as const) for (const area of ["hand", "energy"] as const) for (const id of s.sides[p].zones[area].slice()) assert.ok(moveCard(s, game, id, "deck", { owner: p }).ok);
  for (let i = 0; i < energy; i++) stage(s, "p2", "ENERGY924", "energy");
  for (let i = 0; i < 2; i++) stage(s, "p1", "ENERGY924", "energy");
  return s;
}
const union = (s: VmState, id: string) => engine.legalActions(ctx, s).find(l => l.action.type === "activate" && l.action.card === id && parseSkills(defs[s.cards[id].cardId].skill).find(sk => sk.index === (l.action as Extract<Action, { type: "activate" }>).skill)?.keyword?.name === "Union");
const candidates = (s: VmState) => s.prompt.kind === "chooseCards" ? s.prompt.choice.candidates : [];
function start(s: VmState, id: string): VmState {
  const offer = union(s, id); assert.ok(offer, `Fusion offered for ${s.cards[id].cardId}`);
  let d = apply(s, offer.action);
  if (d.prompt.kind === "payCost") d = apply(d, { type: "payCost", player: "p2", option: 0 });
  return d;
}
function finish(s: VmState): VmState {
  for (let i = 0; i < 20 && s.prompt.kind !== "main"; i++) {
    if (s.prompt.kind === "chooseCards") s = apply(s, { type: "choose", player: "p2", cards: [candidates(s)[0]] });
    else s = apply(s, { type: "pass", player: (s.prompt as { player: PlayerId }).player });
  }
  return s;
}
for (const row of rows) {
  const programs = Object.values(compileCard(defs[row.id]).bySkill);
  const permission = programs.find(p => p.ops.some(o => o.op === "permit" && o.what === "unionFusionWarp"));
  assert.ok(permission); assert.deepEqual(permission.unsupported, []);
  assert.equal(permission.ops.length, 1, "both sentences are one permission, no orphan move");
  for (const [a, b] of [["hand", "hand"], ["warp", "warp"], ["hand", "warp"], ["warp", "hand"]] as const) {
    let s = board(9241); const gog = stage(s, "p2", row.id, "hand");
    const goku = stage(s, "p2", "GOKU924", a), veg = stage(s, "p2", "VEG924", b);
    const bad = stage(s, "p2", "VEG20924", "warp");
    const enemy = stage(s, "p1", "VEG924", "warp");
    s = start(s, gog);
    assert.equal(s.prompt.kind, "chooseCards");
    assert.deepEqual(candidates(s).sort(), [goku, veg].sort(), "only a complete equal-power pair from own allowed areas");
    assert.throws(() => apply(s, { type: "choose", player: "p2", cards: [bad] }), IllegalAction);
    assert.throws(() => apply(s, { type: "choose", player: "p2", cards: [enemy] }), IllegalAction);
    s = apply(s, { type: "choose", player: "p2", cards: [goku] });
    assert.deepEqual(candidates(s), [veg]);
    const stale = reload(s);
    assert.ok(moveCard(stale, game, veg, "energy", { owner: "p2" }).ok);
    assert.throws(() => apply(stale, { type: "choose", player: "p2", cards: [veg] }), IllegalAction, "a stale material moved to energy cannot be paid");
    const resolved = apply(reload(s), { type: "choose", player: "p2", cards: [veg] });
    assert.deepEqual(resolved, apply(reload(s), { type: "choose", player: "p2", cards: [veg] }), "mid-choice reload deterministic");
    s = finish(resolved);
    assert.ok(s.sides.p2.zones.drop.includes(goku) && s.sides.p2.zones.drop.includes(veg));
    assert.ok(s.sides.p2.zones.battle.includes(gog));
    assert.equal(s.cards[gog].under.length, 0, "Fusion discards materials; it does not stack them");
  }
  for (const area of ["battle", "energy", "drop"] as const) {
    const s = board(9242), gog = stage(s, "p2", row.id, "hand");
    stage(s, "p2", "GOKU924", area); stage(s, "p2", "VEG924", "warp");
    assert.equal(union(s, gog), undefined, `${area} does not become a material source`);
  }
  for (const area of ["hand", "warp"] as const) {
    const s = board(9248), gog = stage(s, "p2", row.id, "hand");
    stage(s, "p2", "EXTRAGOKU924", area); stage(s, "p2", "EXTRAVEG924", area);
    assert.equal(union(s, gog), undefined, "matching non-Battle characters cannot pay Fusion");
  }
  const s = board(9243), own = stage(s, "p2", row.id, "hand"), other = stage(s, "p2", "OTHER924", "hand");
  stage(s, "p2", "GOKU924", "warp"); stage(s, "p2", "VEG924", "warp");
  assert.ok(union(s, own)); assert.equal(union(s, other), undefined, "self permission cannot leak to another Fusion");
  s.cards[s.sides.p2.zones.leader[0]].cardId = "L-RED";
  assert.equal(union(s, own), undefined, "printed black Saiyan-only Leader condition remains required");
  // #932: the Leader matrix through the same stored rule. Only a black Leader with the Saiyan trait alone answers.
  for (const [leader, offered, why] of [
    ["LEAD924", true, "black [Saiyan] alone is allowed"],
    ["LEADMULTI932", true, "black/red [Saiyan] is still black and Saiyan-only"],
    ["LEADTWO932", false, "black [Saiyan, Earthling] is not Saiyan-only"],
    ["LEADNOSAIYAN932", false, "black without Saiyan is refused"],
    ["LEADREDSAIYAN932", false, "red [Saiyan] is the wrong colour"],
  ] as const) {
    s.cards[s.sides.p2.zones.leader[0]].cardId = leader;
    assert.equal(!!union(s, own), offered, `${row.id}: ${why}`);
  }
}
{
  let s = board(9244); const gog = stage(s, "p2", "BT12-136", "hand");
  stage(s, "p2", "GOKU924", "warp"); stage(s, "p2", "VEG924", "warp");
  for (const id of s.sides.p1.zones.energy.slice()) assert.ok(moveCard(s, game, id, "deck", { owner: "p1" }).ok);
  assert.equal(union(s, gog), undefined, "BT12-136 still requires opponent energy≥2");
  s = board(9245, 6); const p286 = stage(s, "p2", "P-286", "hand");
  const ordinary = engine.legalActions(ctx, s).find(l => l.action.type === "play" && l.action.card === p286);
  assert.ok(ordinary, "ordinary play remains available with no Fusion materials");
  assert.equal(ordinary.cost?.energy, 6); assert.equal(union(s, p286), undefined);
  stage(s, "p2", "GOKU924", "warp"); stage(s, "p2", "VEG924", "warp");
  assert.equal(union(s, p286)?.cost?.energy, 3, "Fusion is the alternate3-energy route plus materials");
  s = apply(s, ordinary.action);
  if (s.prompt.kind === "payCost") s = apply(s, { type: "payCost", player: "p2", option: 0 });
  s = finish(s); assert.ok(s.sides.p2.zones.battle.includes(p286));
  assert.equal(s.sides.p2.zones.warp.length, 2, "ordinary play spends no Fusion materials");
}
{
  const s = board(9246), blocked = stage(s, "p2", "BLOCKED924", "hand");
  assert.equal(engine.legalActions(ctx, s).find(l => l.action.type === "play" && l.action.card === blocked), undefined, "normal play still respects a printed prohibition");
  assert.throws(() => apply(s, { type: "play", player: "p2", card: blocked }), IllegalAction);
}
console.log("gogeta-warp-924: all three printed cards, four source combinations, self scope, requirements, reload and ordinary play passed");
