/**
 * #542 (2-3-1-1, 2-3-2, 2-3-2-1): BT30-084's "Play up to 1 Battle Card whose
 * card name is in the text of a skill on the chosen card from your Warp on top
 * of the chosen card" — the `nameInSkillTextOf` filter, bound to the card the
 * price chose (`$c0`, #550).
 *
 * The matching rule (Rule Manual): text in `{}` brackets refers to the card
 * with that card name (2-3-2); names are equal only when all of the text is the
 * same, so a name that is a part of another is a different name (2-3-1-1,
 * "[Son Goku]" is not "[Son Goku, The Awakened Power]"); singular and plural
 * are one reference (2-3-2-1). A bare occurrence of the words is not a
 * reference, so it does not count. The manual has no further ruling on "a card
 * name in the text of a skill"; the owner's ruling of 4 Oct 2026 on the card
 * is the issue's source.
 *
 * BT30-084 is word for word. BT30-082's printed text is not in the repo (the
 * catalog is in the database), so the chosen card carries a fixture skill that
 * names {Support Broadcast} as the issue describes.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { engineFor } from "../../src/lib/arena/engines";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { compileCard } from "../../src/lib/arena/compile";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { nameInSkillText } from "../../src/lib/arena/text/filters";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";

const engine = engineFor("rules");
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok);
const game = loaded.definition;

const BT30_084 = "[Activate: Main/Battle]{1}, if your opponent has 2 or more energy and you choose 1 of your black ≪Maiden Squadron≫ Battle Cards: Play up to 1 Battle Card whose card name is in the text of a skill on the chosen card from your Warp on top of the chosen card.";
const maiden = (id: string, skill: string | null): CardDef => card(id, { colors: ["Black"], traits: ["Maiden Squadron"], skill });
const named = (id: string, name: string): CardDef => card(id, { name, colors: ["Black"], traits: ["Maiden Squadron"], skill: null, energyCost: 0 });

const defs: Record<string, CardDef> = { ...DEFS,
  USER542: card("USER542", { colors: ["Black"], skill: BT30_084 }),
  // The fixture for BT30-082: its skill names {Support Broadcast} and, in plain words only, "Broadcast Relay".
  HOST542: maiden("HOST542", "[Activate: Main] Choose 1 of your cards: Return {Support Broadcast} to your hand. Broadcast Relay is not a reference."),
  OTHERHOST542: maiden("OTHERHOST542", "[Activate: Main] Draw 1 card, then play {Relay Station}."),
  MUTE542: maiden("MUTE542", null),
  NAMED542: named("NAMED542", "Support Broadcast"),
  PLURAL542: named("PLURAL542", "Support Broadcasts"),
  LONGER542: named("LONGER542", "Support Broadcast Deluxe"),
  PART542: named("PART542", "Broadcast"),
  BARE542: named("BARE542", "Broadcast Relay"),
  RELAY542: named("RELAY542", "Relay Station"),
};
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromCompiler(defs) };

const reload = (s: VmState): VmState => JSON.parse(JSON.stringify(s));
function apply(s: VmState, action: Action) { return engine.apply(ctx, reload(s), action) as { state: VmState }; }
function stage(s: VmState, p: PlayerId, id: string, area: "battle" | "energy" | "warp"): string {
  const physical = s.sides[p].zones.deck[0]; assert.ok(physical);
  s.cards[physical].cardId = id;
  assert.ok(moveCard(s, game, physical, area, { owner: p }).ok);
  return physical;
}
const candidates = (s: VmState): string[] => (s.prompt.kind === "chooseCards" ? s.prompt.choice.candidates : []);
const choose = (s: VmState, ids: string[], player: PlayerId) => apply(s, { type: "choose", player, cards: ids });
const activation = (s: VmState, id: string) => engine.legalActions(ctx, s).find((l) => l.action.type === "activate" && l.action.card === id);

/** p2's first Main Phase (p1 went first), p1 holding 2 energy for the "if". */
function board(seed: number, hosts: string[]) {
  let s = engine.createGame(ctx, { seed, p1: { name: "You", leader: "L-RED", main: fifty("V1") }, p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  const pass = (a: Action) => { s = apply(s, a).state; };
  pass({ type: "chooseFirst", player: s.chooser, first: "p1" });
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) pass({ type: "pass", player: (s.prompt as { player: PlayerId }).player });
  pass({ type: "endMain", player: "p1" }); pass({ type: "charge", player: "p2", card: null });
  assert.equal(s.turnPlayer, "p2"); assert.equal(s.prompt.kind, "main");
  for (const id of s.sides.p1.zones.energy.slice()) assert.ok(moveCard(s, game, id, "deck", { owner: "p1" }).ok);
  stage(s, "p1", "V1", "energy"); stage(s, "p1", "V1", "energy");
  const user = stage(s, "p2", "USER542", "battle");
  const hostIds = hosts.map((h) => stage(s, "p2", h, "battle"));
  return { s, user, hostIds };
}

// ── the matching rule on its own (2-3-1-1, 2-3-2, 2-3-2-1) ─────────────────
{
  const skill = "Return {Support Broadcast} to your hand, then play {Son Goku, The Awakened Power}. Mentions Broadcast Relay and Son Goku bare.";
  assert.ok(nameInSkillText(["Support Broadcast"], skill), "a name written in {} is in the text");
  assert.ok(nameInSkillText(["support broadcast"], skill), "case is not a difference");
  assert.ok(nameInSkillText(["Son Goku, The Awakened Power"], skill), "a name with a comma is one name");
  assert.ok(!nameInSkillText(["Son Goku"], skill), "2-3-1-1: part of a name is a different name");
  assert.ok(!nameInSkillText(["Support"], skill) && !nameInSkillText(["Broadcast"], skill), "a part of the braced name is not it");
  assert.ok(!nameInSkillText(["Support Broadcast Deluxe"], skill), "a longer name is not it");
  assert.ok(!nameInSkillText(["Broadcast Relay"], skill), "2-3-2: words outside {} are not a reference");
  assert.ok(nameInSkillText(["Support Broadcasts"], skill), "2-3-2-1: plural of the braced name");
  assert.ok(nameInSkillText(["Support Broadcast"], "Play {Support Broadcasts}."), "2-3-2-1: singular of a braced plural");
  assert.ok(!nameInSkillText(["Support Broadcast"], null) && !nameInSkillText([], skill), "no text, no name: nothing");
}

// ── the reading ─────────────────────────────────────────────────────────────
{
  const line = compileCard(defs.USER542).bySkill[0];
  assert.deepEqual(line.unsupported, [], "BT30-084 reads whole");
  assert.equal((line.price?.ops?.[0] as { as?: string }).as, "c0", "the price chooses $c0 (#550)");
  const json = JSON.stringify(line.ops);
  assert.ok(json.includes('"nameInSkillTextOf":"c0"'), "the filter looks in $c0's skills");
  assert.ok(json.includes('"area":"warp"'), "from the Warp");
  assert.ok(json.includes('"onto":{"var":"c0"}'), "onto $c0");
}

// ── the play: only cards named in the chosen card's skills, onto it ─────────
{
  const { s: s0, user, hostIds: [host, other] } = board(5421, ["HOST542", "OTHERHOST542"]);
  const wp = {
    named: stage(s0, "p2", "NAMED542", "warp"), plural: stage(s0, "p2", "PLURAL542", "warp"), longer: stage(s0, "p2", "LONGER542", "warp"),
    part: stage(s0, "p2", "PART542", "warp"), bare: stage(s0, "p2", "BARE542", "warp"), relay: stage(s0, "p2", "RELAY542", "warp"),
  };
  const offer = activation(s0, user); assert.ok(offer, "offered: opponent has 2 energy and a Maiden is in play");
  let d = apply(s0, offer.action).state;
  assert.deepEqual([...candidates(d)].sort(), [host, other].sort(), "the price offers the black Maiden Battle Cards");
  d = choose(d, [host], "p2").state;
  assert.equal(d.prompt.kind, "chooseCards", "then the Warp card is asked");
  assert.deepEqual([...candidates(d)].sort(), [wp.named, wp.plural].sort(), "only names written in {} in the chosen card's skill: not Deluxe, Broadcast, Broadcast Relay, Relay Station");
  // Refusals leave the state unchanged.
  const before = JSON.stringify(d);
  for (const bad of [wp.longer, wp.part, wp.bare, wp.relay, host]) assert.throws(() => choose(d, [bad], "p2"), IllegalAction);
  assert.throws(() => choose(d, [wp.named], "p1"), IllegalAction, "only the player answers");
  assert.equal(JSON.stringify(d), before);
  // A reload before the answer resolves the same; the card lands on top of the chosen one.
  const done = choose(reload(d), [wp.named], "p2").state;
  assert.equal(JSON.stringify(choose(reload(d), [wp.named], "p2").state), JSON.stringify(done), "reload-stable");
  assert.ok(done.sides.p2.zones.battle.includes(wp.named), "the Warp card was played");
  assert.ok(!done.sides.p2.zones.warp.includes(wp.named));
  assert.ok(!done.sides.p2.zones.battle.includes(host), "the chosen card is under it (23-2)");
  assert.ok(done.cards[wp.named].under.includes(host), "…and lies under the played card, which is on top of it");
  // Choosing the other host changes the offer: {Relay Station} only.
  let e = apply(s0, offer.action).state;
  e = choose(e, [other], "p2").state;
  assert.deepEqual(candidates(e), [wp.relay], "the other host names {Relay Station}");
}

// ── nothing named, nothing offered; the "if" is unchanged ───────────────────
{
  const { s: s0, user, hostIds: [mute] } = board(5422, ["MUTE542", "MUTE542"]);
  stage(s0, "p2", "NAMED542", "warp");
  const offer = activation(s0, user); assert.ok(offer);
  const d = choose(apply(s0, offer.action).state, [mute], "p2").state;
  assert.ok(d.prompt.kind !== "chooseCards" || candidates(d).length === 0, "a chosen card with no skill text names no card");
  const poor = board(5423, ["HOST542"]);
  assert.ok(moveCard(poor.s, game, poor.s.sides.p1.zones.energy[0], "deck", { owner: "p1" }).ok);
  assert.equal(activation(poor.s, poor.user), undefined, "opponent has 1 energy: the condition fails (BT30-084's \"if\")");
}

console.log("  ok  #542 name in skill text: {}-written names only, whole-name equality, onto the chosen card");
