/**
 * #542 follow-up: `npm run arena:fuzz -- 200` crashed 12 games in the
 * Universe 2 Maiden Squadron deck right after BT30-084 (Support Broadcast)
 * resolved, with the fuzz's invariant failing — "p2#28 (BT30-101) found 2
 * times", "p2#4 (BT3-113) found 0 times". The invariant is 3-1 (a card is in
 * exactly one place) read with 23-2-2-2 (a card under another is in that
 * pile and nowhere else), and this suite checks it after **every** step of
 * BT30-084's play, in every shape the fuzz reaches, on the printed cards.
 *
 * The play is "on top of the chosen card" (Rule Manual 23-2-1, 23-2-2):
 * the played card takes the host's place in its area and the host goes under
 * it as one card, the host's own pile after it (23-2-4). `vm/play.ts`'s
 * `stackOnto` is the one zone write in the engine that is not `moveCard`'s;
 * it spliced at `indexOf(card)` without checking, and an index of -1 there
 * removes the area's last card and adds the arrival a second time — exactly
 * the fuzz's pair. It now reads where the arrival is and refuses by name.
 *
 * What this suite does NOT prove: the production trigger. On the compiler's
 * rows (and on the 4 Oct draft, "play $c0 onto $c0") none of these shapes,
 * nor some 2,000 local random games, reach the -1; the owner's rerun of
 * `npm run arena:fuzz -- 200` will either pass or now name the case.
 *
 * Card texts are the catalog's, word for word (deckplanet, 13 Oct 2026).
 */
import assert from "node:assert/strict";
import { CTX, DEFS, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { CardScripts } from "../../src/lib/arena/vm/script";

const engine = RULES;
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok);
const game = loaded.definition;

const battle = (id: string, name: string, cost: number, power: number, traits: string[], skill: string): CardDef => ({
  id, name, type: "BATTLE", colors: ["Black"], energyCost: cost, zEnergyCost: null, power, comboCost: 0, comboPower: 5000, skill, characters: [name.split(",")[0]], traits,
});
const MAIDEN = ["Maiden Squadron", "Universe 2"];
const printed: Record<string, CardDef> = {
  "BT30-084": {
    id: "BT30-084", name: "Support Broadcast", type: "Z-EXTRA" as CardDef["type"], colors: ["Black"], energyCost: 1, zEnergyCost: 1, power: null, comboCost: null, comboPower: null, characters: [], traits: [],
    skill: "[activate: main/battle]{1}, if your opponent has 2 or more energy and you choose 1 of your black ≪Maiden Squadron≫ Battle Cards: Play up to 1 Battle Card whose card name is in the text of a skill on the chosen card from your Warp on top of the chosen card.\n[br]\n[activate: battle] {1}, remove this card from the game: Choose up to 1 of your ≪Maiden Squadron≫ Battle Cards and it gets +5000 power for the battle for every 2 ≪Universe 2≫ cards in your Warp.",
  },
  "BT30-097": battle("BT30-097", "Formation!! Brianne De Chateau", 2, 10000, MAIDEN, "[deflect]\n[br]\n[auto] [limit 1] If your Leader is a ≪Universe 2≫ card: When this card is played, draw 1 card, send up to 1 {Ribrianne, Witchy Warrior} from your Drop to your Warp, then choose up to 2 of your ≪Universe 2≫ cards and they get +5000 power for the turn."),
  "BT30-095": battle("BT30-095", "Ribrianne, Witchy Warrior", 4, 25000, MAIDEN, "[deflect] [double strike]\n[br]\n[auto] Choose 1 {Support Broadcast} in your Battle Area and switch it to Rest Mode: When this card is played, add up to 1 black ≪Maiden Squadron≫ card with an energy cost of 2 from your Drop or Warp to your hand.\n[br]\n[auto] Place 2 ≪Maiden Squadron≫ cards from your Warp at the bottom of your deck: When this card attacks, choose up to 1 of your opponent's Battle Cards and send it to its owner's Warp."),
  "BT30-103": battle("BT30-103", "Formation! Su Roas", 2, 10000, MAIDEN, "[deflect]\n[br]\n[auto] [limit 1] If your Leader is a ≪Universe 2≫ card: When this card is played, draw 1 card, send up to 1 {Rozie, Witchy Warrior} from your Drop to your Warp, add up to 1 black ≪Maiden Squadron≫ card from your Drop or Warp to your Z-Energy, then send up to 2 Battle Cards from your opponent's Drop to their owner's Warp."),
  "BT30-102": battle("BT30-102", "Rozie, Witchy Warrior", 4, 25000, MAIDEN, "[auto] [limit 1] When this card is played, choose up to 1 of your black ≪Maiden Squadron≫ Battle Cards and switch it to Active Mode.\n[br]\n[activate: battle] [once per turn] Place 2 ≪Maiden Squadron≫ cards from your Warp at the bottom of your deck: Use up to 1 card from under your ≪Maiden Squadron≫ card in a combo with its skills negated for the turn."),
  "BT30-101": battle("BT30-101", "Sanka Ku, Fighting Maiden", 1, 4000, MAIDEN, "[auto] [limit 1] When this card is played, look at up to 5 cards from the top of your deck, choose up to 2 ≪Universe 2≫ cards, add up to 1 card to your hand, send up to 1 card to your Warp, then shuffle your deck.\n[br]\n[activate: main] [limit 1] If your Leader is a ≪Universe 2≫ card and you send this card from your Drop to your Warp: Look at up to 2 cards from the top of your deck, place up to 1 card in your Drop, send up to 1 card to its owner's Warp, then place the rest at the bottom of your deck in any order."),
  "BT3-113": battle("BT3-113", "Supreme Kai of Time, World's Protector", 2, 12000, ["God"], "[Super Combo] （You can only include up to 4 cards with [Super Combo] in your deck）<br>[Auto] When you combo with this card, if there are 5 or more cards in your Warp, draw 1 card, and this card gains +10000 combo power for the duration of the turn."),
};
// Scoped to this suite, never added to the shared DEFS the probe walks.
const defs: Record<string, CardDef> = { ...DEFS, ...printed };
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromCompiler(defs) };

/** 3-1 with 23-2-2-2: every card in exactly one zone or one pile — `scripts/arena-fuzz.mts`'s `checkRules`. */
function oneEach(s: VmState, where: string): void {
  const seen = new Map<string, number>();
  for (const side of Object.values(s.sides)) for (const ids of Object.values(side.zones)) for (const id of ids) seen.set(id, (seen.get(id) ?? 0) + 1);
  for (const c of Object.values(s.cards)) for (const u of c.under) seen.set(u, (seen.get(u) ?? 0) + 1);
  for (const id of Object.keys(s.cards)) assert.equal(seen.get(id) ?? 0, 1, `${where}: ${id} (${s.cards[id].cardId}) is in ${seen.get(id) ?? 0} places, not 1 (3-1)`);
}

const reload = (s: VmState): VmState => JSON.parse(JSON.stringify(s));
let steps = 0;
/** The fuzz's loop does not reload between moves, so neither does this: `apply` clones. */
function act(c: EngineContext, s: VmState, a: Action, where: string): VmState {
  const next = engine.apply(c, s, a).state as VmState;
  oneEach(next, where);
  steps++;
  return next;
}
function stage(s: VmState, p: PlayerId, id: string, area: string): string {
  const physical = s.sides[p].zones.deck[0]; assert.ok(physical);
  s.cards[physical].cardId = id;
  assert.ok(moveCard(s, game, physical, area, { owner: p }).ok);
  return physical;
}
/** p2's first Main Phase, p1 holding 2 energy for BT30-084's "if", p2 holding 3 to pay with. */
function board(seed: number): VmState {
  let s = engine.createGame(ctx, { seed, p1: { name: "You", leader: "L-RED", main: fifty("V1") }, p2: { name: "Maiden", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  const pass = (a: Action) => { s = act(ctx, s, a, "setup"); };
  pass({ type: "chooseFirst", player: s.chooser, first: "p1" });
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) pass({ type: "pass", player: (s.prompt as { player: PlayerId }).player });
  pass({ type: "endMain", player: "p1" }); pass({ type: "charge", player: "p2", card: null });
  assert.equal(s.turnPlayer, "p2"); assert.equal(s.prompt.kind, "main");
  for (const id of s.sides.p1.zones.energy.slice()) assert.ok(moveCard(s, game, id, "deck", { owner: "p1" }).ok);
  stage(s, "p1", "V1", "energy"); stage(s, "p1", "V1", "energy");
  for (let i = 0; i < 3; i++) stage(s, "p2", "V-BLUE", "energy");
  return s;
}
const candidates = (s: VmState): string[] => (s.prompt.kind === "chooseCards" ? s.prompt.choice.candidates : []);
const choose = (c: EngineContext, s: VmState, ids: string[], where: string) => act(c, s, { type: "choose", player: "p2", cards: ids }, where);
const support = (c: EngineContext, s: VmState, sb: string) => engine.legalActions(c, s).find((l) => l.action.type === "activate" && (l.action as { card?: string }).card === sb && (l.action as { skill?: number }).skill === 0);
/** Activate BT30-084's first line and settle the {1} with the first payment offered. */
function activate(c: EngineContext, s: VmState, sb: string): VmState {
  const offer = support(c, s, sb); assert.ok(offer, "BT30-084 is offered: a black Maiden in play, the opponent at 2 energy");
  let d = act(c, s, offer.action, "activate");
  if (d.prompt.kind === "payCost") d = act(c, d, { type: "payCost", player: "p2", option: 0 }, "pay {1}");
  return d;
}
const zone = (s: VmState, p: PlayerId, z: string) => s.sides[p].zones[z];

// ── the play itself, step by step: Formation!! Brianne names {Ribrianne, Witchy Warrior} ──
{
  const s0 = board(54201);
  const sb = stage(s0, "p2", "BT30-084", "battle");
  const host = stage(s0, "p2", "BT30-097", "battle");
  const other = stage(s0, "p2", "BT30-103", "battle");
  const last = stage(s0, "p2", "BT3-113", "battle"); // last in the area: the card the fuzz lost
  const rib = stage(s0, "p2", "BT30-095", "warp");
  stage(s0, "p2", "BT30-101", "warp");
  oneEach(s0, "staged");
  const slot = zone(s0, "p2", "battle").indexOf(host);
  let d = activate(ctx, s0, sb);
  assert.deepEqual([...candidates(d)].sort(), [host, other].sort(), "the price offers your black Maiden Battle Cards, from your Battle Area only");
  d = choose(ctx, d, [host], "chose Formation!! Brianne");
  assert.deepEqual(candidates(d), [rib], "only the card its skill names in {} (2-3-2)");
  // Declining "up to 1" moves nothing.
  const declined = choose(ctx, d, [], "declined");
  assert.ok(zone(declined, "p2", "battle").includes(host) && zone(declined, "p2", "warp").includes(rib));
  // Played: on top of the chosen card, in its slot, the host under it (23-2-2-2).
  const done = choose(ctx, d, [rib], "played Ribrianne");
  const area = zone(done, "p2", "battle");
  assert.equal(area.indexOf(rib), slot, "the played card takes the host's place");
  assert.ok(!area.includes(host) && done.cards[rib].under.includes(host), "the host is under it, not beside it");
  assert.ok(area.includes(last) && area.includes(other) && area.includes(sb), "nothing else in the area moved");
  assert.ok(!zone(done, "p2", "warp").includes(rib));
  // A reload in the middle answers the same.
  assert.equal(JSON.stringify(choose(ctx, reload(d), [rib], "reloaded")), JSON.stringify(done));
}

// ── a host with a pile of its own: its pile follows it under, in order (23-2-2-1) ──
{
  const s0 = board(54202);
  const sb = stage(s0, "p2", "BT30-084", "battle");
  const host = stage(s0, "p2", "BT30-103", "battle");
  const old = stage(s0, "p2", "BT30-101", "battle");
  assert.ok(moveCard(s0, game, old, "battle", { under: host }).ok);
  stage(s0, "p2", "BT3-113", "battle");
  const rozie = stage(s0, "p2", "BT30-102", "warp");
  oneEach(s0, "staged pile");
  let d = activate(ctx, s0, sb);
  if (d.prompt.kind === "chooseCards" && d.prompt.choice.continuation === "c0") d = choose(ctx, d, [host], "chose Su Roas");
  assert.deepEqual(candidates(d), [rozie], "Formation! Su Roas names {Rozie, Witchy Warrior}");
  const done = choose(ctx, d, [rozie], "played Rozie");
  assert.deepEqual(done.cards[rozie].under, [host, old], "the host and its pile, in order, under the played card");
}

// ── a chosen card that names nothing: nothing to play, nothing moves ───────
{
  const s0 = board(54203);
  const sb = stage(s0, "p2", "BT30-084", "battle");
  const mute = stage(s0, "p2", "BT30-101", "battle");
  stage(s0, "p2", "BT3-113", "battle");
  stage(s0, "p2", "BT30-095", "warp"); stage(s0, "p2", "BT30-097", "warp");
  const before = zone(s0, "p2", "battle").slice();
  const d = activate(ctx, s0, sb); // one candidate: the price's pick is forced
  assert.equal(candidates(d).length, 0, "Sanka Ku names no card in {}");
  assert.deepEqual(zone(d, "p2", "battle"), before);
  assert.ok(zone(d, "p2", "battle").includes(mute));
}

// ── the chosen card leaves before the play: an ordinary play beside it ─────
{
  const s0 = board(54204);
  const sb = stage(s0, "p2", "BT30-084", "battle");
  const host = stage(s0, "p2", "BT30-097", "battle");
  stage(s0, "p2", "BT30-103", "battle");
  stage(s0, "p2", "BT3-113", "battle");
  const rib = stage(s0, "p2", "BT30-095", "warp");
  let d = activate(ctx, s0, sb);
  d = choose(ctx, d, [host], "chose Formation!! Brianne");
  const gone = reload(d);
  assert.ok(moveCard(gone, game, host, "drop", { owner: "p2" }).ok);
  oneEach(gone, "host left");
  const done = choose(ctx, gone, [rib], "played with the host gone");
  assert.ok(zone(done, "p2", "battle").includes(rib) && done.cards[rib].under.length === 0, "nothing to go under: the card is simply played");
  assert.ok(zone(done, "p2", "drop").includes(host));
}

// ── the 4 Oct draft, "play $c0 onto $c0": a card is never played onto itself ──
// The row the issue was filed from (docs/arena-backlog, #542 "Problem") played
// the chosen card itself. The manual has no ruling on a card played on top of
// itself (23-2 always names two cards); `resolvePlay` reads it as an ordinary
// arrival in its own area, and the card is still in one place.
{
  const compiled = ctx.scripts as Record<string, CardScripts>;
  const draft = JSON.parse(JSON.stringify(compiled["BT30-084"])) as CardScripts;
  const line = draft.bySkill[0] as { ops: { op: string; then?: unknown[] }[] };
  line.ops = [{ ...line.ops[0], then: [{ op: "play", target: { var: "c0" }, onto: { var: "c0" } }] }];
  const old: EngineContext = { ...ctx, scripts: new Proxy({}, { get: (_, k) => (k === "BT30-084" ? draft : compiled[k as string]) }) as Record<string, CardScripts> };
  const s0 = board(54205);
  const sb = stage(s0, "p2", "BT30-084", "battle");
  const host = stage(s0, "p2", "BT30-097", "battle");
  stage(s0, "p2", "BT3-113", "battle");
  const done = activate(old, s0, sb);
  assert.ok(zone(done, "p2", "battle").includes(host) && done.cards[host].under.length === 0);
}

// ── every answer, to a depth, from Main and from a battle ─────────────────
function explore(s: VmState, depth: number, trail: string[]): void {
  if (depth === 0 || (s.prompt.kind === "main" && trail.length > 1)) return;
  for (const l of engine.legalActions(ctx, s)) {
    if (l.action.type === "concede" || l.action.type === "endMain") continue;
    explore(act(ctx, s, l.action, [...trail, l.label].join(" > ")), depth - 1, [...trail, l.label]);
  }
}
{
  const s0 = board(54206);
  const sb = stage(s0, "p2", "BT30-084", "battle");
  for (const id of ["BT30-097", "BT30-103", "BT30-101"]) stage(s0, "p2", id, "battle");
  stage(s0, "p2", "BT3-113", "battle");
  for (const id of ["BT30-095", "BT30-102", "BT30-097", "BT30-101", "BT3-113"]) stage(s0, "p2", id, "warp");
  oneEach(s0, "staged explore");
  const offer = support(ctx, s0, sb); assert.ok(offer);
  explore(act(ctx, s0, offer.action, "explore"), 3, [offer.label]);
  // In a battle: a Maiden attacks and BT30-084 is used at Battle timing.
  const attack = engine.legalActions(ctx, s0).find((l) => l.action.type === "attack" && s0.cards[(l.action as { attacker: string }).attacker]?.cardId === "BT30-097");
  assert.ok(attack, "Formation!! Brianne may attack");
  explore(act(ctx, s0, attack.action, "attack"), 3, [attack.label]);
}
assert.ok(steps > 50, `the invariant was checked after ${steps} steps`);
