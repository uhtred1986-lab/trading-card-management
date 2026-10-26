/**
 * The prohibition catalog, batch 2 (20-14, 0-2-5) — the same `forbid`
 * machinery as `prohibition-catalog.ts`, with the owner's rulings of 26 Oct
 * 2026 and the next groups of the catalog's unread prohibitions:
 *
 * - "can't be removed from a Battle Area by skills" counts a **KO by a skill**
 *   as a removal (owner ruling): every such wording is `beMovedBySkill` and
 *   `beKOdBySkill` with the same side and `byTypes` (BT10-065, BT8-040,
 *   BT10-154, BT30-030, BT10-058), and the once-per-turn shield (P-638,
 *   BT22-117) answers a skill's KO too (`skillOrKoBySkill`), never the battle's;
 * - "You can't activate Extras" (BT20-024, owner ruling): 12-1-3's
 *   activating an Extra Card, no longer skipped as a reminder;
 * - EB1-21's "your opponent's Clone Tokens can't attack": **every** Clone
 *   Token (a plural "Tokens" is all of them, as "cards" is);
 * - "you can't activate the [Activate: Main] skill on copies of this card for
 *   the turn" (BT12-031, BT12-035 and the family): `sameNameAsSelf`, one line
 *   kind (`skillKinds`);
 * - plays: "…can't be played from any area unless {Dormant Legend} is in your
 *   Drop Area" (BT7-115), "…by skills other than its own" (EB1-27,
 *   `exceptOwnSkills`), "…using skills" (BT14-152, DB3-028);
 * - moves by skills to a named place (`toArea`): DB2-040, EX06-18, BT3-078,
 *   P-672, P-676 (cards in a hand, `fromArea`); a KO is a move to the Drop
 *   Area (5-12-1), so "placed in the Drop Area" stops a skill's KO too;
 * - BT22-072's "…other than {Jaguar's Island}'s skills" (`exceptSourceName`);
 * - BT19-153's bare "can't be removed from Battle Areas" (every KO and every
 *   skill's move);
 * - the battle's KO against a description of the attacker (P-481, BT8-060,
 *   `byFilter`);
 * - "during battles when this card attacks" (BT4-094, BT14-152, TB2-050) and
 *   BT1-031's [Counter]/[Blocker] during this card's attack;
 * - BT31-111's leading duration reaching its second clause;
 * - "you can't place cards under this card, except with this card's skill"
 *   (BT25-008, BT7-022, new `placeUnder`);
 * - "can't have its attack(s) negated" in a list (DB2-033, BT5-009).
 *
 * Part 1 reads one printed card per group; part 2 plays the actions on the VM
 * from **both seats**, with a JSON reload of the state between steps.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { forbiddenBy } from "../../src/lib/arena/vm/program";
import { compileSkill } from "../../src/lib/arena/compile";
import { parseSkills } from "../../src/lib/arena/text/cards";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { Op } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";

// ── 1. readings ──────────────────────────────────────────────────────────────

const compact = (_k: string, v: unknown) => (v === null || v === false || (Array.isArray(v) && v.length === 0) ? undefined : v);
/** The first record of a printed line, as stored: a leading condition is its `cond`. */
function script(text: string) {
  const [rec] = skillRecords({ ...DEFS.V1, id: "X", skill: text } as CardDef);
  assert.deepEqual(rec.unread, [], `reads whole: ${text}`);
  const out = JSON.parse(JSON.stringify({ ops: rec.ops, cond: rec.cond }, compact)) as { ops?: Op[]; cond?: unknown };
  return { ops: out.ops ?? [], cond: out.cond };
}
const ops = (text: string): Op[] => script(text).ops;
function forbids(list: Op[]): Extract<Op, { op: "forbid" }>[] {
  const out: Extract<Op, { op: "forbid" }>[] = [];
  for (const o of list) {
    if (o.op === "forbid") out.push(o);
    if (o.op === "if") out.push(...forbids(o.then), ...forbids(o.else ?? []));
    if (o.op === "delay") out.push(...forbids(o.ops));
  }
  return out;
}
const unread = (text: string) => compileSkill(parseSkills(text)[0]).unsupported;
const SELF = { sel: { special: "self" } };
const brief = (f: Extract<Op, { op: "forbid" }>) => [f.what, f.side ?? null, f.byTypes ?? null];

// A1 (owner ruling 26 Oct 2026): a skill's KO is a removal.
{
  assert.deepEqual(forbids(ops("[Permanent] This card can't be removed from Battle Areas by skills.")), [
    { op: "forbid", what: "beMovedBySkill", until: "game", target: SELF },
    { op: "forbid", what: "beKOdBySkill", until: "game", target: SELF },
  ], "BT10-065: both players' skills, a move and a KO");
  assert.deepEqual(forbids(ops("[permanent] This card can't be removed from a Battle Area by your opponent's card skills.")).map(brief), [["beMovedBySkill", "opponent", null], ["beKOdBySkill", "opponent", null]], "BT8-040");
  assert.deepEqual(forbids(ops("[Permanent] This card can't be removed from your Battle Area by the skills of your opponent's Battle Cards.")).map(brief), [["beMovedBySkill", "opponent", ["BATTLE"]], ["beKOdBySkill", "opponent", ["BATTLE"]]], "BT10-058: a Battle Card's skill only, both ways");
  assert.deepEqual(forbids(ops("[auto][once per turn] If this card is in a battle: When your energy is placed at the bottom of its owner's deck, this card gets +11000 power for the battle, and it can't be removed from a Battle Area by an opponent's skill for the turn.")).map((f) => [f.what, f.side, f.until]), [["beMovedBySkill", "opponent", "turn"], ["beKOdBySkill", "opponent", "turn"]], "BT30-030");
  assert.deepEqual(forbids(ops("[Permanent] You can't play Battle Cards, this card can't be removed from your Battle Area by skills, and you can't combo with cards in your Battle Area.")).map((f) => f.what), ["play", "beMovedBySkill", "beKOdBySkill", "combo"], "BT10-154");
  assert.deepEqual(forbids(ops("[Auto] When this card is played, choose up to 1 of your green Battle Cards with an energy cost of 5 or less, and it can't be removed from Battle Areas by your opponent's skills until the end of their next turn.")).map((f) => [f.what, f.side, f.until, JSON.stringify(f.target)]), [["beMovedBySkill", "opponent", "nextTurn", '{"var":"c0"}'], ["beKOdBySkill", "opponent", "nextTurn", '{"var":"c0"}']], "BT19-071: \"from Battle Areas by your opponent's skills\"");
  assert.deepEqual(ops("[Permanent] Once per turn, this card can't be removed from a Battle Area by skills.")[0], { op: "replace", event: "leave", by: "skillOrKoBySkill", with: [{ op: "negateOwnSkill", until: "turn" }] }, "P-638: the once-per-turn shield takes a skill's KO too");
}
// A2: "You can't activate Extras" (BT20-024).
{
  const f = forbids(ops("[Permanent] You can't activate Extras, and during your turn, you can't use skills to play Battle Cards."));
  assert.deepEqual(f.map((x) => [x.what, x.side, x.filter?.type ?? null, x.extraCardActivation ?? null, x.bySkill ?? null]), [["activateSkill", "you", "EXTRA", true, null], ["activateCounter", "you", "EXTRA", null, null], ["play", "you", "BATTLE", null, true]], "BT20-024");
  const s = script("[Permanent] You can't activate Extras, and during your turn, you can't use skills to play Battle Cards.");
  assert.equal(s.cond, undefined, "BT20-024: \"during your turn\" is the second rule's, not the line's");
  // True reminder text is still skipped.
  assert.deepEqual(script("[Auto] When you activate this card, you can't activate {Restrain} for the duration of the turn.").ops ?? [], [], "an Extra's own once-per-name reminder");
}
// B: EB1-21 — every one of the opponent's Clone Tokens.
{
  const [, clones] = forbids(ops("[Permanent] This card can't be used in a combo from the Battle Area and your opponent's Clone Tokens can't attack."));
  assert.deepEqual(clones.target, { sel: { side: "opponent", area: "play", filter: { names: ["clone"], token: true }, count: 99 } }, "EB1-21: all of them, not one");
}
// The copies of this card (BT12-031 and its family).
{
  assert.deepEqual(forbids(ops("[Activate: Main] Draw 1 card. You can't activate the [Activate: Main] skill on copies of this card for the turn.")), [{ op: "forbid", what: "activateSkill", side: "you", until: "turn", sameNameAsSelf: true, skillKinds: ["activate:main"] }], "BT12-031");
  assert.deepEqual(forbids(ops("[Auto] When this card is played, draw 1 card. You can't activate the [Auto] skill on copies of this card for the turn.")).map((f) => f.skillKinds), [["auto"]], "EX14-04");
  assert.deepEqual(forbids(ops("[Counter: Attack] Negate the attack, and you can't activate copies of this card for the turn.")).map((f) => f.what), ["activateSkill", "activateCounter"], "BT11-118: every line");
  assert.deepEqual(forbids(ops("[Activate: Main] Draw 1 card, and you can't activate copies of this card from your hand for the turn.")).map((f) => f.fromArea), ["hand", "hand"], "BT13-030: from the hand");
  assert.deepEqual(forbids(ops("[Counter: Play] Draw 1 card. You can't activate the [counter] skill on copies of this card for the game.")).map((f) => [f.what, f.until]), [["activateCounter", "game"]], "a [Counter] line");
}
// Plays.
{
  const bt7 = forbids(ops("[permanent] Only 1 {Broly, Tragedy Foretold} can be played in your Battle Area, and you can't play this card from any area unless {Dormant Legend} is in your Drop Area."));
  assert.deepEqual(bt7[1], { op: "forbid", what: "play", side: "you", until: "game", target: SELF, unless: { kind: "count", sel: { side: "you", area: "drop", filter: { names: ["dormant legend"] } }, atLeast: 1 } }, "BT7-115");
  assert.equal(forbids(ops("[Permanent] This card can't be played from any area unless your Leader Card is yellow."))[0].unless?.kind, "leaderMatches", "P-132: no longer skipped as a reminder");
  assert.deepEqual(forbids(ops("[permanent] This card can't be played from any area by skills other than its own."))[0], { op: "forbid", what: "play", until: "game", target: SELF, bySkill: true, exceptOwnSkills: true }, "EB1-27");
  assert.equal(forbids(ops("[permanent] This card can't be played from any area by card skills except its own."))[0].exceptOwnSkills, true, "DB2-008");
  assert.deepEqual(forbids(ops("[Permanent] You can't play this card from any area using skills, and if you have 5 or more mono-red energy, reduce the energy cost of this card in your hand by 3."))[0], { op: "forbid", what: "play", side: "you", until: "game", target: SELF, bySkill: true }, "BT14-152: a skill's play only — the bare reading banned the play from the hand");
  // Owner ruling 26 Oct 2026 (batch 3): the declared play is allowed, and only [Revive] may play it by a skill.
  assert.deepEqual(forbids(ops("[permanent] You can't play this card from any area with skills other than [Revive Blue/Green]."))[0], { op: "forbid", what: "play", side: "you", until: "game", target: SELF, bySkill: true, exceptKeyword: "Revive" }, "the exception is the keyword's own play, never every play");
}
// Moves by skills to a named place.
{
  assert.deepEqual(forbids(ops("[Permanent] This card can't be returned to your hand by your skills.")), [{ op: "forbid", what: "beMovedBySkill", until: "game", target: SELF, side: "you", toArea: "hand" }], "DB2-040");
  assert.deepEqual(forbids(ops("[Permanent] Cards in your Battle Area can't be placed in their owners' Drop Areas by your skills.")).map((f) => [f.what, f.side, f.toArea ?? null]), [["beMovedBySkill", "you", "drop"], ["beKOdBySkill", "you", null]], "EX06-18: a KO is a move to the Drop (5-12-1)");
  assert.deepEqual(forbids(ops("[Permanent] Your Battle Cards can't be placed in the Drop Area by your own skills.")).map((f) => f.what), ["beMovedBySkill", "beKOdBySkill"], "BT3-078");
  assert.deepEqual(forbids(ops("[permanent] Your Battle Cards can't be placed at the bottom of their owner's deck by your opponent's skills."))[0], { op: "forbid", what: "beMovedBySkill", until: "game", target: { sel: { side: "you", area: "battle", filter: { type: "BATTLE" }, count: 99 } }, side: "opponent", toArea: "deck", toBottom: true }, "P-672");
  assert.deepEqual(forbids(ops("[permanent] Cards in your hand can't be placed into their owner's Drop by your opponent's skills."))[0].fromArea, "hand", "P-676: cards in a hand");
  // Owner ruling 26 Oct 2026 (batch 3): the hand as a zone for the turn, a card that enters it later included.
  assert.deepEqual(forbids(ops("[Counter: Play] Play this card, draw 1 card, and cards in your hand can't be returned to your deck by your opponent's skills for the turn."))[0], { op: "forbid", what: "beMovedBySkill", until: "turn", side: "opponent", cardsOf: "you", fromArea: "hand", toArea: "deck" }, "DB2-156");
  assert.deepEqual(forbids(ops("[Permanent] This card can't be removed from Battle Areas by skills other than {Jaguar's Island}'s skills.")).map((f) => [f.what, f.exceptSourceName]), [["beMovedBySkill", "jaguar's island"], ["beKOdBySkill", "jaguar's island"]], "BT22-072");
  assert.deepEqual(forbids(ops("[permanent] If you have 3 or less energy, this card can't attack or be removed from Battle Areas.")).map((f) => f.what), ["attack", "beMovedBySkill", "beKOd"], "BT19-153: no cause named — every KO");
}
// The battle's KO against a description of the attacker.
{
  assert.deepEqual(forbids(ops("[permanent] This card can't be KO'd in battle against Battle Cards with energy costs of 3 or less."))[0], { op: "forbid", what: "beKOdInBattle", until: "game", target: SELF, byFilter: { type: "BATTLE", costMax: 3 } }, "P-481");
  const bt8 = compileSkill(parseSkills("[Blocker]<br>[Auto] When this card activates [Blocker], place the top card of your deck under a {Dr.Uiro's Lab} in your Battle Area, and this card can't be KO'd in battle by Battle Cards with an original power of 15000 or less for the duration of the battle.")[1]);
  assert.deepEqual(JSON.parse(JSON.stringify(forbids(bt8.ops)[0].byFilter, compact)), { type: "BATTLE", originalPowerMax: 15000 }, "BT8-060's prohibition (its placement under a named host stays unread)");
}
// During this card's attack.
{
  const bt4 = script("[Permanent] During battles when this card attacks, your opponent may not activate [Counter] or [Blocker].");
  assert.deepEqual(bt4.cond, { kind: "inBattle", sel: { special: "self" }, role: "attacker" }, "BT4-094");
  assert.deepEqual(forbids(bt4.ops).map((f) => [f.what, f.side]), [["activateCounter", "opponent"], ["block", "opponent"]]);
  assert.deepEqual(script("[Permanent] During battles where this card is attacking a Battle Card in Rest Mode, your opponent can't combo.").cond, { kind: "all", conds: [{ kind: "inBattle", sel: { special: "self" }, role: "attacker" }, { kind: "inBattle", sel: { side: "opponent", area: "battle", filter: { type: "BATTLE" }, mode: "rest" }, role: "guard" }] }, "TB2-050");
  const bt1 = ops("[permanent] Your opponent cannot activate [counter] against this card's attack and cannot activate [blocker] during this card's attack.");
  assert.deepEqual(bt1.map((o) => (o.op === "if" ? [JSON.stringify(o.cond), forbids(o.then).map((f) => [f.what, f.side])] : null)), [
    ['{"kind":"inBattle","sel":{"special":"self"},"role":"attacker"}', [["activateCounter", "opponent"]]],
    ['{"kind":"inBattle","sel":{"special":"self"},"role":"attacker"}', [["block", "opponent"]]],
  ], "BT1-031");
}
// BT31-111, placing under, attack negation, BT15-016's price.
{
  const bt31 = forbids(ops("[activate: main/battle] Draw 1 card, then choose up to 1 of your opponent's Battle Cards, ignoring [barrier], and until the end of your opponent's turn, that card can't attack and your opponent can't activate its skills."));
  assert.deepEqual(bt31.map((f) => [f.what, f.until, JSON.stringify(f.target)]), [["attack", "nextTurn", '{"var":"c0"}'], ["activateSkill", "nextTurn", '{"var":"c0"}'], ["block", "nextTurn", '{"var":"c0"}']], "BT31-111: the leading duration covers both clauses (A2: its [Blocker] too)");
  assert.ok(unread("[activate: main] Choose up to 1 of your opponent's Battle Cards, and that card can't attack and your opponent can't activate its skills.").length, "with no duration said anywhere it stays unread");
  assert.deepEqual(forbids(ops("[Permanent] You can't place cards under this card, except with this card's skill."))[0], { op: "forbid", what: "placeUnder", side: "you", until: "game", target: SELF, exceptOwnSkills: true }, "BT25-008");
  assert.deepEqual(ops("[Activate: Main] Choose 1 of your Battle Cards: For the turn, the chosen card gets +15000 power, can attack Battle Cards in Active Mode, can't have its attacks negated, and can't attack your opponent's Leader Card.").filter((o) => o.op === "permit").map((o) => (o.op === "permit" ? o.what : null)), ["attackActive", "attackUnnegatable"], "DB2-033");
  const [bt15] = skillRecords({ ...DEFS.V1, id: "X", skill: "[Counter: Play] You can't activate [Counter: Play] skills on other cards this turn: Play this card." } as CardDef);
  assert.deepEqual(JSON.parse(JSON.stringify(bt15.cost?.program ?? [], compact)), [{ op: "forbid", what: "activateCounter", side: "you", until: "turn", counterKind: "play", otherCards: true }], "BT15-016's price");
}

// ── 2. the VM, from both seats ───────────────────────────────────────────────

const C = (id: string, o: Partial<CardDef>) => card(id, { energyCost: 0, comboCost: 0, ...o });
const defs: Record<string, CardDef> = {
  ...DEFS,
  BT10_065: C("BT10_065", { skill: "[Permanent] This card can't be removed from Battle Areas by skills." }),
  BT8_040: C("BT8_040", { skill: "[permanent] This card can't be removed from a Battle Area by your opponent's card skills." }),
  BT10_058: C("BT10_058", { skill: "[Permanent] This card can't be removed from your Battle Area by the skills of your opponent's Battle Cards." }),
  P638: C("P638", { skill: "[Permanent] Once per turn, this card can't be removed from a Battle Area by skills." }),
  BT20_024: C("BT20_024", { skill: "[Permanent] You can't activate Extras, and during your turn, you can't use skills to play Battle Cards." }),
  EB1_21: C("EB1_21", { skill: "[Permanent] This card can't be used in a combo from the Battle Area and your opponent's Clone Tokens can't attack." }),
  CLONE: C("CLONE", { name: "Clone Token", type: "TOKEN", characters: [] }),
  COPYDRAW: C("COPYDRAW", { skill: "[Activate: Main] Draw 1 card. You can't activate the [Activate: Main] skill on copies of this card for the turn." }),
  EB1_27: C("EB1_27", { skill: "[permanent] This card can't be played from any area by skills other than its own." }),
  GATED: C("GATED", { skill: "[Permanent] This card can't be played from any area unless {Dormant Legend} is in your Drop Area." }),
  DORMANT: C("DORMANT", { name: "Dormant Legend" }),
  DB2_040: C("DB2_040", { skill: "[Permanent] This card can't be returned to your hand by your skills." }),
  EX06_18: C("EX06_18", { skill: "[Permanent] Cards in your Battle Area can't be placed in their owners' Drop Areas by your skills." }),
  P676: C("P676", { skill: "[permanent] Cards in your hand can't be placed into their owner's Drop by your opponent's skills." }),
  BT22_072: C("BT22_072", { skill: "[Permanent] This card can't be removed from Battle Areas by skills other than {Jaguar's Island}'s skills." }),
  JAGUAR: C("JAGUAR", { name: "Jaguar's Island", skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and KO it." }),
  BT19_153: C("BT19_153", { power: 5000, skill: "[permanent] If you have 3 or less energy, this card can't attack or be removed from Battle Areas." }),
  P481: C("P481", { power: 5000, skill: "[permanent] This card can't be KO'd in battle against Battle Cards with energy costs of 3 or less." }),
  BT4_094: C("BT4_094", { power: 30000, skill: "[Permanent] During battles when this card attacks, your opponent may not activate [Counter] or [Blocker]." }),
  BT31_111: C("BT31_111", { skill: "[activate: main/battle] Draw 1 card, then choose up to 1 of your opponent's Battle Cards, ignoring [barrier], and until the end of your opponent's turn, that card can't attack and your opponent can't activate its skills." }),
  BT25_008: C("BT25_008", { skill: "[Permanent] You can't place cards under this card, except with this card's skill.<br>[Activate: Main] Place the top card of your deck under this card." }),
  // The skills that try the forbidden actions.
  KO_THEIRS: C("KO_THEIRS", { skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and KO it." }),
  KO_MINE: C("KO_MINE", { skill: "[Activate: Main] Choose up to 1 of your Battle Cards and KO it." }),
  BOUNCE_MINE: C("BOUNCE_MINE", { skill: "[Activate: Main] Choose up to 1 of your Battle Cards and return it to its owner's hand." }),
  BOUNCE_THEIRS: C("BOUNCE_THEIRS", { skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and return it to its owner's hand." }),
  EXTRA_KO: C("EXTRA_KO", { type: "EXTRA", power: null, comboCost: null, comboPower: null, skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and KO it." }),
  EXTRA_DRAW: C("EXTRA_DRAW", { type: "EXTRA", power: null, comboCost: null, comboPower: null, skill: "[Activate: Main] Draw 1 card." }),
  COUNTER_PLAY: C("COUNTER_PLAY", { type: "EXTRA", power: null, comboCost: null, comboPower: null, skill: "[Counter: Play] Negate the play." }),
  PLAYER: C("PLAYER", { skill: "[Activate: Main] Choose up to 1 Battle Card in your hand and play it." }),
  DISCARD_THEIRS: C("DISCARD_THEIRS", { skill: "[Activate: Main] Choose up to 1 card in your opponent's hand and place it in its owner's Drop Area." }),
  ACT: C("ACT", { skill: "[Activate: Main] Draw 1 card." }),
  CHEAP: C("CHEAP", { energyCost: 3, power: 30000 }),
  DEAR: C("DEAR", { energyCost: 4, power: 30000 }),
  PLAIN: C("PLAIN", { power: 30000 }),
  BLOCK: C("BLOCK", { skill: "[Blocker]" }),
};
const rows = Object.values(defs).flatMap((d) => skillRecords(d).map((r, id) => ({ ...r, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromRows(JSON.parse(JSON.stringify(rows)), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");
const take = (s: VmState, action: Action): VmState => RULES.apply(ctx, roundtrip(s), action).state as VmState;
const SEATS: PlayerId[] = ["p1", "p2"];

/** A game at the Main Phase of `turn` (p1's third turn, or p2's after it). */
function game3(turn: PlayerId): VmState {
  let s = RULES.createGame(ctx, { seed: 2015, p1: { name: "First", leader: "L-RED", main: fifty("V1") }, p2: { name: "Second", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  const steps: Action[] = [
    { type: "chooseFirst", player: s.chooser, first: "p1" } as Action,
    { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null }, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null },
    { type: "endMain", player: "p2" }, { type: "charge", player: "p1", card: null },
  ] as Action[];
  for (const a of steps) s = take(s, a);
  if (turn === "p2") s = endTurn(s);
  assert.equal(s.prompt.kind, "main");
  assert.equal((s.prompt as { player: PlayerId }).player, turn);
  return roundtrip(s);
}
function stage(s: VmState, p: PlayerId, def: string, area: string, mode: "active" | "rest" = "active"): string {
  const id = s.sides[p].zones.deck[0]; s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  if (area === "battle") s.cards[id].mode = mode;
  return id;
}
function settle(s: VmState, pick: string[] = []): VmState {
  for (let i = 0; i < 40 && s.prompt.kind !== "main"; i++) {
    const q = s.prompt;
    if (q.kind === "chooseCards") {
      const want = q.choice.candidates.filter((c) => pick.includes(c));
      s = take(s, { type: "choose", player: q.player, cards: want.length ? want.slice(0, q.choice.max ?? want.length) : q.choice.candidates.slice(0, q.choice.min) });
    } else if (q.kind === "orderPending") s = take(s, { type: "orderPending", player: q.player, index: 0 });
    else if (q.kind === "counter") s = take(s, { type: "counter", player: q.player, card: null });
    else if (q.kind === "blocker" || q.kind === "combo") s = take(s, { type: "pass", player: q.player } as Action);
    else if (q.kind === "charge") s = take(s, { type: "charge", player: q.player, card: null });
    else throw new Error(`unexpected prompt ${q.kind}`);
  }
  return s;
}
function endTurn(s: VmState): VmState {
  const p = (s.prompt as { player: PlayerId }).player;
  return settle(take(s, { type: "endMain", player: p }));
}
const activations = (s: VmState, id: string) => RULES.legalActions(ctx, s).filter((l) => l.action.type === "activate" && l.action.card === id);
function activate(s: VmState, id: string, pick: string[] = []): VmState {
  const [a] = activations(s, id);
  assert.ok(a, `${s.cards[id].cardId} is offered`);
  return settle(take(s, a.action), pick);
}
function attacks(s: VmState, p: PlayerId): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const l of RULES.legalActions(ctx, s)) {
    const a = l.action;
    if (a.type !== "attack" || a.player !== p) continue;
    if (!out.has(a.attacker)) out.set(a.attacker, new Set());
    out.get(a.attacker)!.add(a.target);
  }
  return out;
}
const zoneOf = (s: VmState, id: string) => (["p1", "p2"] as PlayerId[]).flatMap((p) => Object.entries(s.sides[p].zones).filter(([, ids]) => ids.includes(id)).map(([z]) => z))[0];
const plays = (s: VmState) => RULES.legalActions(ctx, s).filter((l) => l.action.type === "play").map((l) => (l.action as { card: string }).card);

for (const me of SEATS) {
  const you = other(me);

  // A1: a skill's KO under "can't be removed … by skills". BT10-065 stops
  // both players' KO, BT8-040 only the opponent's; BT10-058 only a Battle
  // Card's (an Extra's KO goes through); a plain card is KO'd (control).
  for (const [def, ownStopped] of [["BT10_065", true], ["BT8_040", false]] as const) {
    let s = game3(you);
    const guarded = stage(s, me, def, "battle");
    const plain = stage(s, me, "V1", "battle");
    s = roundtrip(activate(s, stage(s, you, "KO_THEIRS", "battle"), [guarded]));
    assert.equal(zoneOf(s, guarded), "battle", `${me}: ${def} is not KO'd by the opponent's skill`);
    s = roundtrip(activate(s, stage(s, you, "KO_THEIRS", "battle"), [plain]));
    assert.equal(zoneOf(s, plain), "drop", `${me}: a card with no such rule is KO'd (control)`);
    let t = game3(me);
    const g2 = stage(t, me, def, "battle");
    t = roundtrip(activate(t, stage(t, me, "KO_MINE", "battle"), [g2]));
    assert.equal(zoneOf(t, g2), ownStopped ? "battle" : "drop", `${me}: ${def} ${ownStopped ? "is not" : "is"} KO'd by its own controller's skill`);
  }
  {
    let s = game3(you);
    const guarded = stage(s, me, "BT10_058", "battle");
    s = roundtrip(activate(s, stage(s, you, "KO_THEIRS", "battle"), [guarded]));
    assert.equal(zoneOf(s, guarded), "battle", `${me}: BT10-058 — a Battle Card's skill does not KO it`);
    s = roundtrip(activate(s, stage(s, you, "EXTRA_KO", "hand"), [guarded]));
    assert.equal(zoneOf(s, guarded), "drop", `${me}: BT10-058 — an Extra's skill does`);
  }
  // The once-per-turn shield (P-638): the first skill KO of the turn is stood in front of, the second is not.
  {
    let s = game3(you);
    const guarded = stage(s, me, "P638", "battle");
    s = roundtrip(activate(s, stage(s, you, "KO_THEIRS", "battle"), [guarded]));
    assert.equal(zoneOf(s, guarded), "battle", `${me}: P-638 — the first skill KO this turn does not happen`);
    s = roundtrip(activate(s, stage(s, you, "KO_THEIRS", "battle"), [guarded]));
    assert.equal(zoneOf(s, guarded), "drop", `${me}: P-638 — the second one does`);
  }

  // A2: BT20-024 — the player's Extras are not activated ([Activate] not offered, [Counter] refused); the opponent's are.
  {
    const s = game3(me);
    stage(s, me, "BT20_024", "battle");
    const extra = stage(s, me, "EXTRA_DRAW", "hand");
    const counter = stage(s, me, "COUNTER_PLAY", "hand");
    const theirs = stage(s, you, "COUNTER_PLAY", "hand");
    const r = roundtrip(s);
    assert.equal(activations(r, extra).length, 0, `${me}: BT20-024 — an Extra's [Activate: Main] is not offered`);
    assert.ok(forbiddenBy(ctx, game, r, "activateCounter", { player: me, card: counter, skillKind: "counter:play" }), `${me}: nor its [Counter]`);
    assert.ok(!forbiddenBy(ctx, game, r, "activateCounter", { player: you, card: theirs, skillKind: "counter:play" }), `${me}: the opponent's Extras are not bound`);
    const free = roundtrip(s);
    free.cards[free.sides[me].zones.battle.find((id) => free.cards[id].cardId === "BT20_024")!].cardId = "V1";
    assert.equal(activations(free, extra).length, 1, `${me}: without the rule it is offered (control)`);
  }

  // B: EB1-21 — both of the opponent's Clone Tokens can't attack; their other card can.
  {
    const s = game3(you);
    stage(s, me, "EB1_21", "battle");
    const c1 = stage(s, you, "CLONE", "battle");
    const c2 = stage(s, you, "CLONE", "battle");
    const v = stage(s, you, "PLAIN", "battle");
    const m = attacks(roundtrip(s), you);
    assert.ok(!m.has(c1) && !m.has(c2), `${me}: EB1-21 — neither Clone Token is offered an attack`);
    assert.ok(m.has(v), `${me}: a card that is no Clone Token is (control)`);
    assert.throws(() => take(s, { type: "attack", player: you, attacker: c2, target: s.sides[me].zones.leader[0] }), `${me}: and a forced attack by the second is refused`);
  }

  // The copies of this card: after one activates, no copy's [Activate: Main] is offered for the turn; next turn they are.
  {
    let s = game3(me);
    const a = stage(s, me, "COPYDRAW", "battle");
    const b = stage(s, me, "COPYDRAW", "battle");
    const theirs = stage(s, you, "COPYDRAW", "battle");
    s = roundtrip(activate(s, a));
    assert.equal(activations(s, b).length + activations(s, a).length, 0, `${me}: no copy is offered again this turn`);
    assert.ok(!forbiddenBy(ctx, game, s, "activateSkill", { player: you, card: theirs, skillKind: "activate:main" }), `${me}: the opponent's copy is not bound`);
    assert.ok(!forbiddenBy(ctx, game, s, "activateSkill", { player: me, card: b, skillKind: "auto" }), `${me}: another kind of line is not`);
    s = roundtrip(endTurn(endTurn(s)));
    assert.equal(activations(s, b).length, 1, `${me}: next turn it is offered again`);
  }

  // Plays: EB1-27 by another card's skill refused, its own allowed (asked of the rule); a declared play allowed.
  {
    let s = game3(me);
    const eb = stage(s, me, "EB1_27", "hand");
    const player = stage(s, me, "PLAYER", "battle");
    s = roundtrip(s);
    assert.ok(plays(s).includes(eb), `${me}: EB1-27 is still played from the hand by its player`);
    assert.ok(!forbiddenBy(ctx, game, s, "play", { player: me, card: eb, bySkill: true, source: eb }), `${me}: by its own skill it may be played`);
    s = roundtrip(activate(s, player, [eb]));
    assert.equal(zoneOf(s, eb), "hand", `${me}: another card's skill does not play it`);
  }
  // "…unless {Dormant Legend} is in your Drop Area".
  {
    const s = game3(me);
    const gated = stage(s, me, "GATED", "hand");
    assert.ok(!plays(roundtrip(s)).includes(gated), `${me}: not offered without {Dormant Legend} in the Drop Area`);
    stage(s, me, "DORMANT", "drop");
    assert.ok(plays(roundtrip(s)).includes(gated), `${me}: offered with it`);
  }

  // Moves to a named place: DB2-040 (own bounce refused, the opponent's not),
  // EX06-18 (own KO refused, the opponent's not), P-676 (the opponent's skill
  // does not put a card of the hand in the Drop).
  {
    let s = game3(me);
    const db = stage(s, me, "DB2_040", "battle");
    s = roundtrip(activate(s, stage(s, me, "BOUNCE_MINE", "battle"), [db]));
    assert.equal(zoneOf(s, db), "battle", `${me}: DB2-040 — its controller's skill does not return it to the hand`);
    let t = game3(you);
    const db2 = stage(t, me, "DB2_040", "battle");
    t = roundtrip(activate(t, stage(t, you, "BOUNCE_THEIRS", "battle"), [db2]));
    assert.equal(zoneOf(t, db2), "hand", `${me}: DB2-040 — the opponent's skill does`);
  }
  {
    let s = game3(me);
    stage(s, me, "EX06_18", "battle");
    const mine = stage(s, me, "V1", "battle");
    s = roundtrip(activate(s, stage(s, me, "KO_MINE", "battle"), [mine]));
    assert.equal(zoneOf(s, mine), "battle", `${me}: EX06-18 — its controller's KO does not put the card in the Drop`);
    let t = game3(you);
    stage(t, me, "EX06_18", "battle");
    const mine2 = stage(t, me, "V1", "battle");
    t = roundtrip(activate(t, stage(t, you, "KO_THEIRS", "battle"), [mine2]));
    assert.equal(zoneOf(t, mine2), "drop", `${me}: EX06-18 — the opponent's KO does`);
  }
  {
    let s = game3(you);
    stage(s, me, "P676", "battle");
    const held = s.sides[me].zones.hand[0];
    s = roundtrip(activate(s, stage(s, you, "DISCARD_THEIRS", "battle"), [held]));
    assert.equal(zoneOf(s, held), "hand", `${me}: P-676 — the opponent's skill does not put a card of the hand in the Drop`);
    const t = game3(you);
    const held2 = t.sides[me].zones.hand[0];
    const u = roundtrip(activate(t, stage(t, you, "DISCARD_THEIRS", "battle"), [held2]));
    assert.equal(zoneOf(u, held2), "drop", `${me}: without the rule it does (control)`);
  }

  // BT22-072: another card's KO refused, {Jaguar's Island}'s allowed.
  {
    let s = game3(you);
    const j = stage(s, me, "BT22_072", "battle");
    s = roundtrip(activate(s, stage(s, you, "KO_THEIRS", "battle"), [j]));
    assert.equal(zoneOf(s, j), "battle", `${me}: BT22-072 — another card's skill does not KO it`);
    s = roundtrip(activate(s, stage(s, you, "JAGUAR", "battle"), [j]));
    assert.equal(zoneOf(s, j), "drop", `${me}: BT22-072 — {Jaguar's Island}'s skill does`);
  }

  // BT19-153 at 3 or less energy: the battle's KO and a skill's KO are both refused.
  {
    let s = game3(you);
    const wall = stage(s, me, "BT19_153", "battle", "rest");
    const atk = stage(s, you, "PLAIN", "battle");
    s = roundtrip(settle(take(s, { type: "attack", player: you, attacker: atk, target: wall })));
    assert.equal(zoneOf(s, wall), "battle", `${me}: BT19-153 — the battle does not KO it`);
    s = roundtrip(activate(s, stage(s, you, "KO_THEIRS", "battle"), [wall]));
    assert.equal(zoneOf(s, wall), "battle", `${me}: nor a skill`);
  }

  // P-481: an attacker with an energy cost of 3 does not KO it in battle; one of 4 does.
  for (const [attackerDef, kod] of [["CHEAP", false], ["DEAR", true]] as const) {
    let s = game3(you);
    const guard = stage(s, me, "P481", "battle", "rest");
    const atk = stage(s, you, attackerDef, "battle");
    s = roundtrip(settle(take(s, { type: "attack", player: you, attacker: atk, target: guard })));
    assert.equal(zoneOf(s, guard), kod ? "drop" : "battle", `${me}: P-481 against a cost-${attackerDef === "CHEAP" ? 3 : 4} attacker`);
  }

  // BT4-094: while it attacks, the opponent can't block or activate a [Counter]; while another card attacks, they can.
  for (const [attackerDef, bound] of [["BT4_094", true], ["PLAIN", false]] as const) {
    let s = game3(me);
    const atk = stage(s, me, attackerDef, "battle");
    const blocker = stage(s, you, "BLOCK", "battle");
    const counter = stage(s, you, "COUNTER_PLAY", "hand");
    s = roundtrip(take(s, { type: "attack", player: me, attacker: atk, target: s.sides[you].zones.leader[0] }));
    assert.ok(s.battle, `${me}: in a battle`);
    assert.equal(!!forbiddenBy(ctx, game, s, "block", { player: you, card: blocker }), bound, `${me}: BT4-094 — [Blocker] ${bound ? "refused" : "allowed"} while ${attackerDef} attacks`);
    assert.equal(!!forbiddenBy(ctx, game, s, "activateCounter", { player: you, card: counter, skillKind: "counter:play" }), bound, `${me}: and [Counter]`);
  }

  // BT31-111: the chosen card's skills can't be activated through the opponent's turn, and can after.
  {
    let s = game3(me);
    const src = stage(s, me, "BT31_111", "battle");
    const theirs = stage(s, you, "ACT", "battle");
    s = roundtrip(activate(s, src, [theirs]));
    s = roundtrip(endTurn(s));
    assert.equal(activations(s, theirs).length, 0, `${me}: BT31-111 — through the opponent's turn its skill is not offered`);
    s = roundtrip(endTurn(endTurn(s)));
    assert.ok(!forbiddenBy(ctx, game, s, "activateSkill", { player: you, card: theirs, skillKind: "activate:main" }), `${me}: after it, allowed again`);
  }

  // BT25-008: its own skill places a card under it; another card's skill would not (asked of the rule).
  {
    let s = game3(me);
    const host = stage(s, me, "BT25_008", "battle");
    const other_ = stage(s, me, "V1", "battle");
    s = roundtrip(activate(s, host));
    assert.equal(s.cards[host].under?.length ?? 0, 1, `${me}: BT25-008 — its own skill places a card under it`);
    assert.ok(forbiddenBy(ctx, game, s, "placeUnder", { player: me, card: host, source: other_ }), `${me}: another card's skill may not`);
    assert.ok(!forbiddenBy(ctx, game, s, "placeUnder", { player: you, card: host, source: s.sides[you].zones.leader[0] }), `${me}: the opponent is not bound ("you can't")`);
  }
}
console.log("prohibition catalog 2: owner rulings (KO by skill is a removal, BT20-024's Extras), EB1-21's Clone Tokens, copies of this card, plays, moves to a place, KOs in battle, this card's attack, BT31-111, placing under — read, and enforced from both seats");
