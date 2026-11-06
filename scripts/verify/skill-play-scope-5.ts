/** R-421/R-422: complete immediate skill lifetime and bounded shared Counter windows. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, recordContractGaps, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { immediatePlayProfile, startSkillPlayScope, requireSkillEffectOrigin } from "../../src/lib/arena/vm/skill-play-scope";
import { counterBindingProblem } from "../../src/lib/arena/vm/skill-play-binding";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { Action, GameEvent, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Op } from "../../src/lib/arena/vm/script";
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const self = { sel: { special: "self" as const } };
const play: Op = { op: "play", target: self };
assert.equal(immediatePlayProfile([play]).arrivals, 1);
assert.equal(immediatePlayProfile([play, play]).arrivals, "many");
assert.equal(immediatePlayProfile([{ op: "play", target: self, activating: true }]).arrivals, 0);
assert.equal(immediatePlayProfile([{ op: "delay", at: "turnEnd", ops: [play] }]).arrivals, 0);
assert.equal(immediatePlayProfile([{ op: "may", ops: [play] }]).arrivals, 1);
assert.equal(immediatePlayProfile([{ op: "chooseMode", modes: [{ label: "one", ops: [play] }, { label: "two", ops: [play] }] }]).arrivals, 1);
assert.equal(immediatePlayProfile([{ op: "play", target: { sel: { area: "hand", count: 1 } } }]).arrivals, "many", "Ref does not enforce a choice count");
assert.equal(immediatePlayProfile([{ op: "choose", sel: { area: "hand", count: 1 }, as: "one" }, { op: "play", target: { var: "one" } }]).arrivals, 1);
assert.equal(immediatePlayProfile([{ op: "token", name: "Ghost Token", power: 15000, comboCost: null, comboPower: null, colors: [], n: 3 }]).arrivals, "many");
assert.equal(immediatePlayProfile([{ ...play, counterWindow: true }]).explicitWindow, true);
// Delayed-body migration identifies the matching body, not every frame on the same source.
{
 const delayed: Op[] = [{ op: "choose", sel: { area: "hand", count: 1 }, as: "picked" }, { op: "play", target: { var: "picked" } }];
 const source = { kind: "activate:main" as const, unsupported: [], ops: [{ op: "delay" as const, at: "turnEnd" as const, ops: delayed }] };
 const base = { ip: 1, vars: {}, card: "source", master: "p1" as const };
 assert.throws(() => requireSkillEffectOrigin({ ...base, ops: delayed }, undefined, [source]), /rebuild this saved skill/);
 assert.doesNotThrow(() => requireSkillEffectOrigin({ ...base, ops: [{ op: "draw", n: 1 }] }, undefined, [source]));
}
assert.match(counterBindingProblem([{ op: "may", ops: [{ op: "resolvingPlay", instead: "drop" }] }])!, /arrival-time choice/);
assert.equal(counterBindingProblem([{ op: "may", ops: [{ op: "draw", n: 1 }] }]), null);
const defs: Record<string, CardDef> = {
 SPS5_LEADER: card("SPS5_LEADER", { type: "LEADER", traits: ["Frieza's Army"], energyCost: null, comboCost: null, comboPower: null }),
 SPS5_FILLER: card("SPS5_FILLER", {}),
 SPS5_ENERGY: card("SPS5_ENERGY", { colors: ["Yellow"] }),
 SPS5_MAIN: card("SPS5_MAIN", { skill: "[Activate: Main] Choose up to 1 Battle Card from your hand and play it." }),
 SPS5_EXTRA: card("SPS5_EXTRA", { name: "Scope Extra", type: "EXTRA", power: null, comboCost: null, comboPower: null, energyCost: 0, skill: "[Activate: Main] Choose up to 1 Battle Card from your hand and play it." }),
 SPS5_PARENT: card("SPS5_PARENT", { skill: "[Activate: Main] Choose up to 1 {Scope Extra} from your Drop, activate it, then choose up to 1 Battle Card from your hand and play it." }),
 SPS5_COUNTER: card("SPS5_COUNTER", { energyCost: 0, skill: "[Counter: Play] Play this card." }),
 SPS5_AUTO: card("SPS5_AUTO", { skill: "[Auto] When this card is played, choose up to 1 Battle Card from your hand and play it." }),
};
defs["DB1-020"] = card("DB1-020", {"type": "EXTRA", "colors": ["Red"], "power": null, "name": "Galick Cannon", "characters": [], "traits": [], "skill": "[Counter: Play] When the Battle Card is played, choose up to 1 of those Battle Cards and it gets -15000 power for the duration of the turn.", "energyCost": 1});
defs["BT1-110"] = card("BT1-110", {"type": "EXTRA", "colors": ["Yellow"], "power": null, "name": "Crusher Ball", "characters": [], "traits": [], "skill": "[Counter: Play] The Battle Card played is played in Rest Mode.", "energyCost": 1});
defs["BT2-014"] = card("BT2-014", {"type": "BATTLE", "colors": ["Red"], "power": 20000, "name": "Ghost Attack Super Saiyan 3 Gotenks", "characters": ["Gotenks"], "traits": ["Saiyan", "Earthling"], "skill": "[evolve] {r}{r}{2}: <Gotenks><br>[permanent] If you have 4 or less cards in your hand, this card and all of your Ghost tokens gain [double strike].<br>[auto] When you play this card, play 3 Ghost tokens. (Ghost tokens have 15000 power)", "energyCost": 5});
defs["BT10-121"] = card("BT10-121", {"type": "EXTRA", "colors": ["Yellow"], "power": null, "name": "Dark Dragon-Slaying Bullet", "characters": [], "traits": [], "skill": "[Counter: Play] If you have a yellow Unison Card in play: If the Battle Card being played has an energy cost of 4 or less, it has its skills negated for the turn and is played in Rest Mode.<br>[Permanent] If all of your energy is mono-yellow, you can activate this card's [Counter] skill from your hand without paying its energy cost by choosing 2 other cards from your hand and discarding them.", "energyCost": 2});
defs["BT1-107"] = card("BT1-107", {"type": "EXTRA", "colors": ["Yellow"], "power": null, "name": "Cold Bloodlust", "characters": [], "traits": [], "skill": "[Counter: Play] If your Leader Card is \u226aFrieza's Army\u226b, the Battle Card played has its skill negated for the duration of the turn.", "energyCost": 1});
defs["DB2-040"] = card("DB2-040", {"type": "BATTLE", "colors": ["Blue"], "power": 15000, "name": "Hit, Deadly Vanguard", "characters": ["Hit"], "traits": ["Alien", "Universe 6"], "skill": "[Counter: Play] If the Battle Card being played has an energy cost of 5 or less, it is returned to its owner's hand instead of being played, then play this card.<br>[Permanent] During your opponent's turn, reduce the energy cost of this card in your hand by 2.<br>[Permanent] This card can't be returned to your hand by your skills.<br>[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards with an energy cost of 5 or less and return it to its owner's hand.", "energyCost": 5});
defs.SPS5_PLAY_UNISON = card("SPS5_PLAY_UNISON", { skill: "[Activate: Main] Choose up to 1 Unison Card from your hand and play it with a marker on it." });
defs.SPS5_MIXED_COUNTER = card("SPS5_MIXED_COUNTER", { energyCost: 0, skill: "[Counter: Play] Play this card.<br>[Counter: Counter] Negate the [Counter]." });
defs.SPS5_BLUE_ENERGY = card("SPS5_BLUE_ENERGY", { colors: ["Blue"] });
defs.SPS5_MULTI = card("SPS5_MULTI", { skill: "[Activate: Main] Choose up to 2 Battle Cards from your hand and play them." });
defs.SPS5_TOKENS = card("SPS5_TOKENS", { skill: "[Activate: Main] Play 3 Ghost Tokens. (Ghost Tokens have 15000 power)" });
defs.SPS5_DEFLECT = card("SPS5_DEFLECT", { skill: "[Deflect]" });
defs.SPS5_DRAW_AUTO = card("SPS5_DRAW_AUTO", { skill: "[Auto] When this card is played, draw 1 card." });
defs.SPS5_YELLOW_UNISON = card("SPS5_YELLOW_UNISON", { type: "UNISON", colors: ["Yellow"] });
defs["BT14-004"] = card("BT14-004", {"type": "UNISON", "colors": ["Red"], "power": 5000, "name": "Toppo, Force of Obliteration", "characters": [], "traits": [], "skill": "[Auto][Once per turn] When one of your red Battle Cards evolves, this card gets +5000 power for the turn, and add a marker to it.<br>[+1][Activate: Main] At the end of the turn, choose up to 1 red Battle Card with an energy cost of 1 in your hand and play it in Rest Mode.<br>[-7][Activate: Main] If your opponent has 3 or more life: Deal 1 damage to your opponent.", "energyCost": null});
defs["BT1-017"] = card("BT1-017", {"name": "Evolution Premonition Frost", "characters": ["Frost"], "traits": ["Alien", "Frieza Clan"], "colors": ["Red"], "skill": "[activate: main] {2}: Look at up to 7 cards from the top of your deck, choose one <Frost> with [evolve] among them and Evolve this card into it. Then, shuffle your deck."});
defs["P-018"] = card("P-018", {"name": "Occupation of Evil Frieza", "characters": ["Frieza"], "traits": ["Frieza Clan", "Frieza's Army"], "colors": ["Yellow"], "skill": "[Double Strike] (This card inflicts 2 damage instead of 1 when attacking)<br>[Activate: Main] Place 2 of your yellow Battle Cards other than this card in the Drop Area: Choose up to 1 {Golden Frieza, Resurrected Terror} from your hand and evolve this card into it. If you do so, draw 2 cards."});
defs["P-065"] = card("P-065", {"name": "Vegito, Super Warrior Reborn", "characters": ["Vegito"], "traits": ["Saiyan"], "colors": ["Green"], "skill": "[union-potara] {g}{g}{g}, draw 2 cards: <Son Goku> and <Vegeta> (Place this card in Active Mode on top of the 2 specified cards stacked together)<br>[activate: main] If your Leader Card is {Going All In, SSB Vegito}, choose 1 <Vegito> with 25000 power in your hand and evolve this card into it."});
defs["EX06-04"] = card("EX06-04", {"name": "Hit, Spacetime Transcended", "characters": ["Hit"], "traits": ["Alien", "Universe 6"], "colors": ["Red"], "skill": "[activate: main] {r}{r}{1}: Choose up to 1 red <Hit> card in your Drop Area or Warp with an energy cost of 6, evolve this card into it, and you can't play red <Hit> cards with an energy cost of 6 for the duration of the turn."});
defs.SPS5_FROST = card("SPS5_FROST", { characters: ["Frost"], skill: "[Evolve]{1}: <Frost>" });
defs.SPS5_GOLDEN = card("SPS5_GOLDEN", { name: "Golden Frieza, Resurrected Terror" });
defs.SPS5_VEGITO = card("SPS5_VEGITO", { characters: ["Vegito"], power: 25000 });
defs.SPS5_HIT = card("SPS5_HIT", { characters: ["Hit"], energyCost: 6, colors: ["Red"] });
defs.SPS5_VEGITO_LEADER = card("SPS5_VEGITO_LEADER", { type: "LEADER", name: "Going All In, SSB Vegito" });
defs.SPS5_ENTRY_FULL = card("SPS5_ENTRY_FULL", { skill: "[Activate: Main] Choose up to 1 Battle Card from your hand and play it with its skills negated for the turn." });
defs.SPS5_ENTRY_HALF = card("SPS5_ENTRY_HALF", { skill: "[Activate: Main] Choose up to 1 Battle Card from your hand and play it with its non-keyword skills negated for the turn." });
defs.SPS5_PROTECTED_BATTLE = card("SPS5_PROTECTED_BATTLE", { skill: "[Permanent] This card's skills can't be negated.<br>[Auto] When this card is played, draw 1 card." });
defs.SPS5_PROTECTED_ALL = card("SPS5_PROTECTED_ALL", { skill: "[Permanent] This card's skills can't be negated in all areas.<br>[Auto] When this card is played, draw 1 card." });
const records = Object.values(defs).flatMap(skillRecords);
assert.deepEqual(records.filter(r => r.cardId !== "BT14-004" || r.skillIndex !== 0).flatMap(r => r.unread), []);
assert.deepEqual(records.find(r => r.cardId === "BT14-004" && r.skillIndex === 0)!.unread, ["When one of your red Battle Cards evolves"], "unrelated trigger remains explicitly unread");
const ctx: EngineContext = { defs, scripts: rulesFromRows(copy(records.map((r, id) => ({ ...r, id, source: "compiler", status: "draft" }) as unknown as RuleRow)), defs) };
// A typed effect cannot be silently widened by an old or partly migrated stored record.
for (const status of ["draft", "confirmed"] as const) {
 const original = records.find(r => r.cardId === "BT1-110")!;
 const stale = { ...copy(original), id: 0, source: "compiler", status, ops: [{ op: "resolvingPlay", mode: "rest" }] } as unknown as RuleRow;
 assert.ok(recordContractGaps(stale).includes("rebuild the stored played-card type qualification"));
 const loadedStale = rulesFromRows([stale], defs);
 assert.ok(loadedStale["BT1-110"].bySkill[original.skillIndex].unsupported?.includes("rebuild the stored played-card type qualification"));
 const mixed = { ...stale, ops: [{ op: "resolvingPlay", mode: "rest", cardType: "BATTLE" }, { op: "resolvingPlay", negated: true }] } as RuleRow;
 assert.ok(recordContractGaps(mixed).includes("rebuild the stored played-card type qualification"));
}
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const other = (p: PlayerId): PlayerId => p === "p1" ? "p2" : "p1";
const events: GameEvent[] = [];
const take = (s: VmState, a: Action): VmState => { const result = RULES.apply(ctx, copy(s), a); events.push(...result.events); return copy(result.state as VmState); };
function fresh(first: PlayerId): VmState {
 let s = RULES.createGame(ctx, { seed: 421, p1: { name: "A", leader: "SPS5_LEADER", main: fifty("SPS5_FILLER") }, p2: { name: "B", leader: "SPS5_LEADER", main: fifty("SPS5_FILLER") } }).state as VmState;
 for (const a of [{ type: "chooseFirst", player: s.chooser, first }, { type: "mulligan", player: first, redraw: false }, { type: "mulligan", player: other(first), redraw: false }, { type: "charge", player: first, card: null }] as Action[]) s = take(s, a);
 return s;
}
function stage(s: VmState, p: PlayerId, def: string, zone: string): string {
 const id = s.sides[p].zones.deck.findLast(id => s.cards[id].cardId === "SPS5_FILLER")!;
 s.cards[id].cardId = def; assert.ok(moveCard(s, game, id, zone, { owner: p }).ok); return id;
}
function activate(s: VmState, id: string): VmState {
 const action = RULES.legalActions(ctx, s).map(x => x.action).find(a => a.type === "activate" && a.card === id);
 assert.ok(action); return take(s, action);
}
function choose(s: VmState, cards: string[]): VmState {
 assert.equal(s.prompt.kind, "chooseCards"); return take(s, { type: "choose", player: s.prompt.player!, cards });
}
let cases = 10;
for (const seat of ["p1", "p2"] as const) {
 let s = fresh(seat); const source = stage(s, seat, "SPS5_MAIN", "battle"); const target = stage(s, seat, "SPS5_FILLER", "hand");
 s = activate(s, source); assert.equal(s.skillPlayScopes?.length, 1); assert.equal(s.skillPlayScopes![0].source, source);
 const scope = s.skillPlayScopes![0].id; assert.ok(s.programs.some(f => f.skillPlayFinish?.scope === scope));
 const malformed = copy(s); malformed.skillPlayScopes![0].parent = scope;
 assert.throws(() => startSkillPlayScope(malformed, malformed.programs.find(f => f.skillEffectOrigin)!), /rebuild this saved skill-play ancestry/);
 const missing = copy(s); delete missing.skillPlayScopes;
 assert.throws(() => startSkillPlayScope(missing, missing.programs.find(f => f.skillEffectOrigin)!), /rebuild this saved skill-play continuation/);
 for (const broken of ["phase", "profile", "played", "window"]) {
  const bad = copy(s); const scope = bad.skillPlayScopes![0];
  if (broken === "phase") (scope as unknown as { phase: string }).phase = "finished";
  else if (broken === "profile") (scope.profile as unknown as { arrivals: number }).arrivals = 3;
  else if (broken === "played") scope.played.push({ card: target, epoch: -1 });
  else { scope.phase = "effect"; scope.window = { programs: [], resolving: null }; }
  assert.throws(() => startSkillPlayScope(bad, bad.programs.find(f => f.skillEffectOrigin)!), /rebuild this saved skill-play/);
 }
 const r421 = copy(s); const oldRoot = r421.programs.find(f => f.skillEffectOrigin)!;
 oldRoot.skillEffectOrigin!.version = 1;
 (r421.skillPlayScopes![0] as unknown as { version: number }).version = 1;
 r421.skillPlayScopes![0].phase = "effect";
 assert.throws(() => startSkillPlayScope(r421, oldRoot), /shared Counter timing version 2/);
 assert.doesNotThrow(() => startSkillPlayScope(copy(s), { ops: [{ op: "draw", n: 1 }], ip: 0, vars: {}, card: source, master: seat, skillEffectOrigin: { version: 1, kind: "activate" } }));
 cases += 2;
 const legacy = copy(s); delete legacy.programs.find(f => f.skillEffectOrigin)!.skillEffectOrigin;
 const refused = choose(legacy, [target]);
 assert.match(JSON.stringify(refused.outcome), /rebuild this saved skill effect before its Counter timing/);
 assert.ok(refused.sides[seat].zones.hand.includes(target));
 cases += 7;
 // A departed source does not cancel an already activated effect; JSON replay keeps its boundary.
 assert.ok(moveCard(s, game, source, "drop", { owner: seat }).ok); s = choose(copy(s), [target]);
 assert.ok(s.sides[seat].zones.battle.includes(target)); assert.equal(s.skillPlayScopes, undefined); assert.equal(s.prompt.kind, "main"); cases++;
 s = fresh(seat); const parent = stage(s, seat, "SPS5_PARENT", "battle"); const extra = stage(s, seat, "SPS5_EXTRA", "drop"); stage(s, seat, "SPS5_FILLER", "hand");
 s = activate(s, parent); assert.equal(s.skillPlayScopes?.length, 1); const outer = s.skillPlayScopes![0].id;
 s = choose(s, [extra]);
 if (s.prompt.kind === "chooseCards" && s.prompt.choice.continuation === "invokeCard") s = choose(s, [extra]);
 if (s.prompt.kind === "chooseMode") s = take(s, { type: "chooseMode", player: seat, index: 0 });
 assert.equal(s.skillPlayScopes?.length, 2); assert.equal(s.skillPlayScopes![1].parent, outer); assert.equal(s.skillPlayScopes![1].source, extra);
 s = choose(copy(s), []); assert.equal(s.skillPlayScopes?.length, 1); assert.equal(s.skillPlayScopes![0].id, outer);
 s = choose(s, []); assert.equal(s.skillPlayScopes, undefined); assert.equal(s.prompt.kind, "main"); cases++;
 s = fresh(seat); const autoSource = stage(s, seat, "SPS5_MAIN", "battle"); const autoTarget = stage(s, seat, "SPS5_AUTO", "hand");
 s = activate(s, autoSource); const root = s.skillPlayScopes![0].id; s = choose(s, [autoTarget]);
 assert.equal(s.skillPlayScopes?.length, 1); assert.equal(s.skillPlayScopes![0].source, autoTarget); assert.notEqual(s.skillPlayScopes![0].id, root);
 assert.equal(s.skillPlayScopes![0].parent, undefined, "played Auto activates only after outer effect's boundary");
 s = choose(s, []); assert.equal(s.skillPlayScopes, undefined); cases++;
 s = fresh(seat); const declared = stage(s, seat, "SPS5_FILLER", "hand"); const counter = stage(s, other(seat), "SPS5_COUNTER", "hand");
 s.cards[declared].cardId = "SPS5_COUNTER"; // zero energy printed Battle Card to declare
 const action = RULES.legalActions(ctx, s).map(x => x.action).find(a => a.type === "play" && a.card === declared); assert.ok(action);
 s = take(s, action); assert.equal(s.prompt.kind, "counter");
 s = take(s, { type: "counter", player: other(seat), card: counter });
 assert.equal(s.prompt.kind, "counter"); assert.equal(s.prompt.kind === "counter" && s.prompt.window, "counter");
 s = take(s, { type: "counter", player: seat, card: null });
 assert.equal(s.prompt.kind, "counter"); assert.equal(s.prompt.kind === "counter" && s.prompt.window, "play");
 s = take(s, { type: "counter", player: seat, card: null });
 assert.ok(s.sides[other(seat)].zones.battle.includes(counter)); assert.ok(s.sides[seat].zones.battle.includes(declared));
 assert.equal(s.skillPlayScopes, undefined); assert.equal(s.nextSkillPlayScope, 1, "only Counter effect, not declared play, owns a scope"); cases++;
}

function payPrompt(s: VmState): VmState {
 if (s.prompt.kind === "payCost") { const action = RULES.legalActions(ctx, s).map(x => x.action).find(a => a.type === "payCost"); assert.ok(action); return take(s, action); }
 return s;
}
function counter(s: VmState, card: string | null): VmState {
 assert.equal(s.prompt.kind, "counter"); return payPrompt(take(s, { type: "counter", player: s.prompt.player!, card }));
}
function energy(s: VmState, p: PlayerId, n: number): void { for (let i = 0; i < n; i++) stage(s, p, "SPS5_ENERGY", "energy"); }
for (const seat of ["p1", "p2"] as const) {
 const opponent = other(seat);
 for (const many of [false, true]) {
  let s = fresh(seat); const source = stage(s, seat, many ? "SPS5_MULTI" : "SPS5_MAIN", "battle");
  const targets = [stage(s, seat, "SPS5_FILLER", "hand"), ...(many ? [stage(s, seat, "SPS5_FILLER", "hand")] : [])];
  const crusher = stage(s, opponent, "BT1-110", "hand"); energy(s, opponent, 1);
  s = activate(s, source); assert.equal(s.prompt.kind, "counter", "window1 precedes card choice"); assert.ok(targets.every(id => s.sides[seat].zones.hand.includes(id)));
  // R510: lifecycle-before is not permission to forge an already-landed
  // context. Refuse before either a real Counter or pass changes the save.
  for (const answer of [null, crusher]) {
   const forged = copy(s); forged.resolving!.landed = true; const before = JSON.stringify(forged);
   assert.throws(() => RULES.apply(ctx, forged, { type: "counter", player: opponent, card: answer }), /R510/);
   assert.equal(JSON.stringify(forged), before); cases++;
  }
  s = counter(copy(s), crusher); assert.equal(s.prompt.kind, "chooseCards");
  for (const target of targets) s = choose(copy(s), [target]); assert.ok(targets.every(id => s.cards[id].mode === "rest" && s.sides[seat].zones.battle.includes(id))); assert.equal(s.skillPlayScopes, undefined); cases++;
 }
 {
  let s = fresh(seat); const source = stage(s, seat, "SPS5_TOKENS", "battle"); const crusher = stage(s, opponent, "BT1-110", "hand"); energy(s, opponent, 1);
  s = activate(s, source); s = counter(s, crusher);
  const tokens = s.sides[seat].zones.battle.filter(id => id.includes("#token")); assert.equal(tokens.length, 3); assert.ok(tokens.every(id => s.cards[id].mode === "rest")); cases++;
 }
 {
  let s = fresh(seat); const source = stage(s, seat, "SPS5_MAIN", "battle"); const target = stage(s, seat, "SPS5_DEFLECT", "hand"); const crusher = stage(s, opponent, "BT1-110", "hand"); energy(s, opponent, 1);
  s = activate(s, source); assert.equal(s.prompt.kind, "counter"); s = counter(s, crusher); s = choose(s, [target]); assert.equal(s.cards[target].mode, "active", "Deflect protects target without closing window"); cases++;
 }
}
for (const seat of ["p1", "p2"] as const) {
 const opponent = other(seat);
 let s = fresh(seat); const source = stage(s, seat, "SPS5_MAIN", "battle"); const target = stage(s, seat, "SPS5_DRAW_AUTO", "hand");
 const cold = stage(s, opponent, "BT1-107", "hand"); energy(s, opponent, 1);
 s = activate(s, source); s = counter(s, null); const hand = s.sides[seat].zones.hand.length;
 s = choose(s, [target]); assert.equal(s.prompt.kind, "counter", "after window precedes pending on-play Auto"); assert.equal(s.sides[seat].zones.hand.length, hand - 1);
 assert.ok(s.pending.some(p => p.card === target)); s = counter(copy(s), cold);
 assert.equal(s.sides[seat].zones.hand.length, hand, "Window2 negation must not erase an Auto active at entry"); cases++;
}
for (const seat of ["p1", "p2"] as const) {
 const opponent = other(seat);
 // Actual printed Gotenks Auto: declared-play timing ends before its own three-token skill starts.
 {
  let s = fresh(seat); const gotenks = stage(s, seat, "BT2-014", "hand"); const crusher = stage(s, opponent, "BT1-110", "hand");
  for (let n = 0; n < 5; n++) stage(s, seat, "SPS5_FILLER", "energy"); energy(s, opponent, 1);
  const action = RULES.legalActions(ctx, s).map(x => x.action).find(a => a.type === "play" && a.card === gotenks); assert.ok(action);
  s = payPrompt(take(s, action)); s = counter(s, null); assert.ok(s.sides[seat].zones.battle.includes(gotenks)); assert.equal(s.prompt.kind, "counter");
  assert.equal(s.resolving?.card, null); s = counter(s, crusher);
  const tokens = s.sides[seat].zones.battle.filter(id => id.includes("#token")); assert.equal(tokens.length, 3); assert.ok(tokens.every(id => s.cards[id].mode === "rest")); cases++;
 }
 // An actual delayed play starts a fresh lifetime at its scheduled time.
 {
  let s = fresh(seat); const toppo = stage(s, seat, "BT14-004", "unison"); s.cards[toppo].markers = 2;
  const target = stage(s, seat, "SPS5_FILLER", "hand"); const crusher = stage(s, opponent, "BT1-110", "hand"); energy(s, opponent, 1);
  s = activate(s, toppo); assert.equal(s.prompt.kind, "main"); assert.equal(s.skillPlayScopes, undefined);
  s = take(s, { type: "endMain", player: seat }); assert.equal(s.prompt.kind, "counter");
  assert.equal(s.skillPlayScopes?.length, 1); assert.equal(s.skillPlayScopes![0].parent, undefined);
  s = counter(copy(s), crusher); s = choose(s, [target]); assert.ok(s.sides[seat].zones.battle.includes(target)); assert.equal(s.cards[target].mode, "rest"); cases++;
 }
 for (const deflect of [false, true]) {
  let s = fresh(seat); const source = stage(s, seat, "SPS5_MAIN", "battle"); const target = stage(s, seat, deflect ? "SPS5_DEFLECT" : "SPS5_DRAW_AUTO", "hand");
  const bullet = stage(s, opponent, "BT10-121", "hand"); const unison = stage(s, opponent, "SPS5_YELLOW_UNISON", "unison"); s.cards[unison].markers = 2; energy(s, opponent, 2);
  s = activate(s, source); const hand = s.sides[seat].zones.hand.length; s = counter(s, bullet); s = choose(s, [target]);
  assert.equal(s.cards[target].mode, deflect ? "active" : "rest"); assert.equal(s.sides[seat].zones.hand.length, hand - 1, "pre-entry direct negation prevents the initial Auto"); cases++;
 }
 // Zero arrivals still reach the second timing, without a fabricated target.
 {
  let s = fresh(seat); const source = stage(s, seat, "SPS5_MAIN", "battle"); const cold = stage(s, opponent, "BT1-107", "hand"); energy(s, opponent, 1);
  s = activate(s, source); s = counter(s, null); s = choose(s, []); assert.equal(s.prompt.kind, "counter"); assert.deepEqual(s.skillPlayScopes![0].played, []);
  s = counter(s, cold); assert.equal(s.prompt.kind, "main"); assert.equal(s.skillPlayScopes, undefined); cases++;
 }
}
for (const seat of ["p1", "p2"] as const) {
 for (const counterId of ["BT1-110", "BT1-107"]) {
  let s = fresh(seat); const source = stage(s, seat, "SPS5_PLAY_UNISON", "battle");
  const target = stage(s, seat, "SPS5_YELLOW_UNISON", "hand");
  const answer = stage(s, other(seat), counterId, "hand"); energy(s, other(seat), 1);
  s = activate(s, source); assert.equal(s.prompt.kind, "counter", "Battle-only Counter remains available against a Unison-play skill");
  s = counter(s, answer); s = choose(s, [target]);
  assert.ok(s.sides[seat].zones.unison.includes(target)); assert.equal(s.cards[target].mode, "active");
  assert.ok(!s.effects.some(e => e.target === target && e.kind === "negateSkills")); cases++;
 }
}
for (const seat of ["p1", "p2"] as const) {
 const opponent = other(seat);
 {
  let s = fresh(seat); const source = stage(s, seat, "SPS5_MAIN", "battle"); const target = stage(s, seat, "SPS5_DRAW_AUTO", "hand");
  const cold = stage(s, opponent, "BT1-107", "hand"); energy(s, opponent, 1);
  s = activate(s, source); s = counter(s, null); const hand = s.sides[seat].zones.hand.length;
  s = choose(s, [target]); assert.ok(s.pending.some(p => p.card === target));
  assert.ok(moveCard(s, game, target, "drop", { owner: seat }).ok);
  s = counter(copy(s), cold); assert.equal(s.sides[seat].zones.hand.length, hand, "already pending arrival Auto survives source departure and saved replay"); cases++;
 }
 for (const reentered of [false, true]) {
  let s = fresh(seat); const source = stage(s, seat, "SPS5_MULTI", "battle");
  const first = stage(s, seat, "SPS5_FILLER", "hand"), second = stage(s, seat, "SPS5_FILLER", "hand");
  const unrelated = stage(s, seat, "SPS5_FILLER", "battle");
  const galick = stage(s, opponent, "DB1-020", "hand"); stage(s, opponent, "SPS5_FILLER", "energy");
  s = activate(s, source); s = counter(s, null); s = choose(s, [first]); s = choose(s, [second]);
  assert.equal(s.prompt.kind, "counter");
  if (reentered) { assert.ok(moveCard(s, game, first, "drop", { owner: seat }).ok); assert.ok(moveCard(s, game, first, "battle", { owner: seat }).ok); }
  s = counter(copy(s), galick); assert.equal(s.prompt.kind, "chooseCards");
  if (s.prompt.kind !== "chooseCards") throw new Error("missing arrival choice");
  assert.deepEqual(new Set(s.prompt.choice.candidates), new Set(reentered ? [second] : [first, second]));
  assert.ok(!s.prompt.choice.candidates.includes(source) && !s.prompt.choice.candidates.includes(unrelated));
  s = choose(s, [second]); assert.equal(s.prompt.kind, "main"); cases++;
 }
}
for (const seat of ["p1", "p2"] as const) {
 const opponent = other(seat);
 {
  let s = fresh(seat); const declared = stage(s, seat, "SPS5_COUNTER", "hand"); const response = stage(s, opponent, "SPS5_COUNTER", "hand");
  const epoch = s.cards[declared].zoneEpoch ?? 0; const eventStart = events.length;
  const action = RULES.legalActions(ctx, s).map(x => x.action).find(a => a.type === "play" && a.card === declared); assert.ok(action);
  s = take(s, action); s = counter(s, response); assert.equal(s.prompt.kind, "counter");
  s = counter(copy(s), declared);
  for (let i = 0; i < 12 && s.prompt.kind === "counter"; i++) s = counter(copy(s), null);
  assert.equal(s.prompt.kind, "main"); assert.ok(s.sides[seat].zones.battle.includes(declared));
  assert.equal(s.cards[declared].zoneEpoch, epoch + 2, "using the held declared card as a Counter must not replay its former hand occurrence");
  assert.equal(events.slice(eventStart).filter(e => e.type === "move" && e.card === declared && e.to === "battle").length, 1);
  assert.equal(s.skillPlayScopes, undefined); cases++;
 }
 {
  let s = fresh(seat); const declared = stage(s, seat, "SPS5_COUNTER", "hand"); const response = stage(s, opponent, "SPS5_COUNTER", "hand");
  const answer = stage(s, seat, "SPS5_MIXED_COUNTER", "hand");
  const action = RULES.legalActions(ctx, s).map(x => x.action).find(a => a.type === "play" && a.card === declared); assert.ok(action);
  s = counter(take(s, action), response);
  const lines = RULES.legalActions(ctx, s).map(x => x.action).filter(a => a.type === "counter" && a.card === answer);
  assert.equal(lines.length, 2, "combined timing preserves both printed Counter lines");
  const negate = lines.find(a => a.type === "counter" && a.skill === 10); assert.ok(negate);
  s = take(copy(s), negate);
  for (let i = 0; i < 12 && s.prompt.kind === "counter"; i++) s = counter(copy(s), null);
  assert.equal(s.prompt.kind, "main"); assert.ok(!s.sides[opponent].zones.battle.includes(response));
  assert.ok(!s.sides[seat].zones.battle.includes(answer), "selected Counter:Counter line cannot silently become Counter:Play");
  assert.ok(s.sides[seat].zones.battle.includes(declared)); cases++;
 }
}
for (const seat of ["p1", "p2"] as const) {
 for (const [sourceDef, targetDef, area] of [["BT1-017", "SPS5_FROST", "deck"], ["P-018", "SPS5_GOLDEN", "hand"], ["P-065", "SPS5_VEGITO", "hand"], ["EX06-04", "SPS5_HIT", "drop"]]) {
  let s = fresh(seat); const source = stage(s, seat, sourceDef, "battle"), target = stage(s, seat, targetDef, area);
  if (area === "deck") assert.ok(moveCard(s, game, target, "deck", { owner: seat, position: "top" }).ok);
  for (let n = 0; n < 4; n++) stage(s, seat, "SPS5_FILLER", "energy");
  if (sourceDef === "P-018") for (let n = 0; n < 2; n++) stage(s, seat, "SPS5_ENERGY", "battle");
  if (sourceDef === "P-065") s.cards[s.sides[seat].zones.leader[0]].cardId = "SPS5_VEGITO_LEADER";
  const crusher = stage(s, other(seat), "BT1-110", "hand"); energy(s, other(seat), 1);
  s = activate(s, source);
  for (let n = 0; n < 8 && s.prompt.kind !== "counter"; n++) {
   if (s.prompt.kind === "payCost") s = payPrompt(s);
   else if (s.prompt.kind === "chooseCards") s = choose(s, s.prompt.choice.candidates.slice(0, Math.max(1, s.prompt.choice.min)));
   else throw new Error(`${sourceDef} price reached ${s.prompt.kind}`);
  }
  assert.equal(s.prompt.kind, "counter", `${sourceDef} whole effect first window`);
  assert.ok(!s.sides[seat].zones.battle.includes(target)); s = counter(copy(s), crusher);
  for (let n = 0; n < 16 && s.prompt.kind !== "main"; n++) {
   if (s.prompt.kind === "chooseCards") s = choose(copy(s), s.prompt.choice.candidates.includes(target) ? [target] : s.prompt.choice.candidates.slice(0, s.prompt.choice.min));
   else if (s.prompt.kind === "counter") s = counter(s, null);
   else if (s.prompt.kind === "chooseMode") s = take(s, { type: "chooseMode", player: s.prompt.player, index: 0 });
   else throw new Error(`${sourceDef} effect reached ${s.prompt.kind}`);
  }
  assert.equal(s.prompt.kind, "main"); assert.ok(s.sides[seat].zones.battle.includes(target), `${sourceDef} evolves after shared window`);
  assert.equal(s.cards[target].mode, "rest"); assert.ok(s.cards[target].under.includes(source)); cases++;
 }
}
for (const seat of ["p1", "p2"] as const) {
 let s = fresh(seat); const source = stage(s, seat, "SPS5_MULTI", "battle"); stage(s, seat, "SPS5_FILLER", "hand");
 const hit = stage(s, other(seat), "DB2-040", "hand");
 const energyIds = Array.from({ length: 3 }, () => stage(s, other(seat), "SPS5_BLUE_ENERGY", "energy"));
 s = activate(s, source); assert.equal(s.prompt.kind, "counter");
 assert.throws(() => counter(copy(s), hit), /future-card condition|deferred effect tail/);
 assert.ok(energyIds.every(id => s.cards[id].mode === "active")); assert.ok(s.sides[other(seat)].zones.hand.includes(hit)); cases++;
}
for (const seat of ["p1", "p2"] as const) for (const status of ["draft", "confirmed"] as const) {
 let s = fresh(seat); const source = stage(s, seat, "SPS5_MAIN", "battle"); stage(s, seat, "SPS5_FILLER", "hand");
 const crusher = stage(s, other(seat), "BT1-110", "hand"), payer = stage(s, other(seat), "SPS5_ENERGY", "energy");
 s = activate(s, source); assert.equal(s.prompt.kind, "counter");
 const original = records.find(r => r.cardId === "BT1-110")!;
 const stale = { ...copy(original), id: 0, source: "compiler", status, ops: [{ op: "resolvingPlay", mode: "rest" }] } as unknown as RuleRow;
 const stored = rulesFromRows([stale], defs);
 const oldContext: EngineContext = { ...ctx, scripts: { ...ctx.scripts, "BT1-110": stored["BT1-110"] } };
 assert.throws(() => RULES.apply(oldContext, copy(s), { type: "counter", player: other(seat), card: crusher }), /rebuild|unread|unsupported|can't counter/i);
 assert.equal(s.cards[payer].mode, "active"); assert.ok(s.sides[other(seat)].zones.hand.includes(crusher)); cases++;
}
for (const seat of ["p1", "p2"] as const) for (const half of [false, true]) for (const allAreas of [false, true]) {
 let s = fresh(seat); const source = stage(s, seat, half ? "SPS5_ENTRY_HALF" : "SPS5_ENTRY_FULL", "battle");
 const target = stage(s, seat, allAreas ? "SPS5_PROTECTED_ALL" : "SPS5_PROTECTED_BATTLE", "hand");
 const hand = s.sides[seat].zones.hand.length;
 s = activate(s, source); s = choose(s, [target]);
 assert.equal(s.prompt.kind, "main"); assert.equal(s.sides[seat].zones.hand.length, hand - 1 + Number(allAreas), `entry ${half ? "partial" : "full"} negation uses protection in original area`); cases++;
}
for (const seat of ["p1", "p2"] as const) {
 let s=fresh(seat);const declared=stage(s,seat,"SPS5_COUNTER","hand"),response=stage(s,other(seat),"SPS5_COUNTER","hand"),answer=stage(s,seat,"SPS5_MIXED_COUNTER","hand");
 const action=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="play"&&a.card===declared);assert.ok(action);
 s=counter(take(s,action),response);s=counter(s,null);assert.equal(s.prompt.kind,"counter");
 assert.equal(s.resolving?.scopeWindow?.boundary,"after");
 const lines=RULES.legalActions(ctx,s).map(x=>x.action).filter(a=>a.type==="counter"&&a.card===answer);
 assert.ok(lines.length>0);assert.ok(lines.every(a=>a.type==="counter"&&a.skill!==10),"post-Counter effect timing does not offer Counter:Counter");
 assert.throws(()=>take(copy(s),{type:"counter",player:seat,card:answer,skill:10}),/no counter skill|can't counter/);
 s=counter(s,null);assert.equal(s.prompt.kind,"main");cases++;
}
console.log(`skill-play-scope-5: ${cases} cases passed`);
