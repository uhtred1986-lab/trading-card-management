/**
 * #1187: Fusion World's bracket timing tags read as aliases of the dbs spellings. Every skill line of the 64 starter
 * cards (docs/arena-fusion-world-starters.md) is compiled; none may be unread, none of the timed tags may land on a
 * [Permanent], and each tag reads as the kind and trigger the table in the issue names.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { skillRecords } from "../../src/lib/arena/draft";
import { skillLines, parseSkills, keywordOf, FUSION_SPELLINGS } from "../../src/lib/arena/text/cards";
import { FUSION_WORLD_SPELLINGS } from "../../src/lib/arena/glossary";
import { CTX, DEFS, IMPL, card, fifty, leaderOf, zoneOf } from "./harness";
import { STARTERS, FW_DEFS, fusionContext, starterDeck, type Starter } from "./fixtures/arena-fusion-world/load.mts";
import { compileCardCached } from "../../src/lib/arena/compile";
import { energyMarkersOf } from "../../src/lib/arena/engine-state";
import type { LegalAction } from "../../src/lib/arena/types";
import { runFuzzGame, type FuzzResult } from "../lib/arena-fuzz-runner";
import { nextRandom } from "../../src/lib/arena/vm/rng";
import { localStep } from "../../src/lib/arena/policy/boundary";
import { combatPolicy, localPolicy } from "../../src/lib/arena/policy/combat";
import { uniformPolicy } from "../../src/lib/arena/policy/contract";
import { localMemory, type LocalMemory } from "../../src/lib/arena/policy/main";
import { policyRng } from "../../src/lib/arena/policy/rng";
import { resolveOutcome } from "../../src/lib/arena/outcome";
import type { PinnedMatch } from "../../src/lib/arena/browser";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { comboPriceOf } from "../../src/lib/arena/vm/battle";
import type { Action, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { EngineState } from "../../src/lib/arena/engines";
import type { CardDef } from "../../src/lib/arena/types";

void CTX;
const doc = readFileSync("docs/arena-fusion-world-starters.md", "utf8");
const REMINDER = /\((?:After an opponent's attack|When this card inflicts|This card inflicts|A maximum of 4)[^)]*\)/g;

/** A space between two bracket groups, or a full stop before one, starts a new skill line: "[Critical] [When Attacking] …". */
function linesOf(text: string): string[] {
  return text.replace(/\]\s+(?=\[)/g, "]<br>").replace(/\.\s+(?=\[)/g, ".<br>").split("<br>").map((l) => l.trim()).filter(Boolean);
}

/** Cards whose skills stay unread, with the reason. None: FS02-03 and FS03-13 read since F1-10 (#1208). */
const KNOWN_UNREAD: Record<string, string> = {};

type Row = { id: string; side: string; line: string; kind: string; trigger: string; cost: string; unread: number };
const rows: Row[] = [];
const cards: { id: string; type: string; faces: string[] }[] = [];
for (const m of doc.matchAll(/^(FS0[1-4]-\d\d) \| [^|]+ \| (\w+) \| [^|]+ \| [^|]+ \| [^|]+ \| [^|]+ \| (.+)$/gm)) {
  const text = m[3].replace(/\(site shows[^)]*\)/, "").replace(REMINDER, "").trim();
  if (text === "(no skill text)") { cards.push({ id: m[1], type: m[2], faces: [] }); continue; }
  const leader = /^FRONT:\s*(.*?)\s*\/\/\s*BACK:\s*(.*)$/.exec(text);
  cards.push({ id: m[1], type: m[2], faces: leader ? [leader[1], leader[2]] : [text] });
}
assert.equal(cards.length, 64, "the 64 starter cards");

for (const c of cards) {
  const def = { id: c.id, name: c.id, type: c.type.toUpperCase(), colors: ["Red"], energyCost: 1, zEnergyCost: null, power: 10000, comboCost: 0, comboPower: 5000, skill: null, characters: [c.id], traits: [] } as unknown as CardDef;
  c.faces.forEach((face, i) => {
    const text = linesOf(face).join("<br>");
    const made = skillRecords({ ...def, skill: i === 0 ? text : null, back: i === 1 ? { skill: text } : undefined } as CardDef);
    const lines = linesOf(face);
    // A bare keyword line ("[Critical]") prints no effect and has no record; its tags must be keywords.
    for (const l of lines) if (!made.some((r) => r.printed === l)) assert.ok([...l.matchAll(/\[([^\]]+)\]/g)].every((m) => keywordOf(m[1])), `${c.id}: "${l}" is bare keywords`);
    made.forEach((r) => {
      rows.push({ id: c.id, side: c.faces.length > 1 ? (i ? "back" : "front") : "", line: r.printed, kind: r.kind, trigger: r.trigger.join("+") || "-", cost: r.cost?.readable === false ? "UNREAD" : r.cost?.program ? "price" : "-", unread: r.unread.length });
    });
  });
}

const unreadRows = rows.filter((r) => r.unread);
assert.deepEqual(unreadRows.map((r) => r.id), Object.keys(KNOWN_UNREAD), `unread skills: ${unreadRows.map((r) => `${r.id} "${r.line}"`).join("; ")}`);

for (const r of rows) {
  const tags = [...r.line.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].toLowerCase());
  const has = (t: string) => tags.includes(t);
  if (["on play", "when attacking", "when ko'd", "end of your turn"].some(has)) assert.equal(r.kind, "auto", `${r.id}: "${r.line}" is an auto, not ${r.kind}`);
  if (has("on play")) assert.equal(r.trigger, "played", `${r.id}: [On Play] triggers on played`);
  if (has("when attacking")) assert.equal(r.trigger, "attacks", `${r.id}: [When Attacking] triggers on attacks`);
  if (has("when ko'd")) assert.equal(r.trigger, "koed", `${r.id}: [When KO'd] triggers on koed`);
  if (has("end of your turn")) assert.equal(r.trigger, "turnEnd", `${r.id}: [End of Your Turn] triggers on turnEnd`);
  if (has("permanent")) assert.equal(r.kind, "permanent", `${r.id}: [Permanent] stays permanent`);
  if (has("activate:main")) assert.equal(r.kind, "activate:main", r.id);
  if (has("activate:battle")) assert.equal(r.kind, "activate:battle", r.id);
  if (has("auto") && has("opponent's turn")) assert.equal(r.trigger, "comboUsed", `${r.id}: the Super Combo auto triggers on comboUsed`);
}

// The two colon-priced skills carry a price record.
for (const [id, side] of [["FS03-01", "back"], ["FS02-16", ""]] as const) {
  const r = rows.find((x) => x.id === id && x.side === side && / : /.test(x.line) && /\[Activate:Main\]/.test(x.line));
  assert.ok(r, `${id}: the colon-priced line`);
  assert.equal(r.cost, "price", `${id}: "${r.line}" has a price record`);
}

assert.ok(!rows.some((r) => r.cost === "UNREAD"), "no price is left unread");
assert.deepEqual(rows.filter((r) => r.cost === "price").map((r) => r.id), ["FS02-16", "FS03-01"], "only the two colon-priced lines carry a price");

// The keyword tags read as keywords, [Double Strike] as Strike x2.
assert.deepEqual(keywordOf("Double Strike"), { name: "Strike", x: 2 });
for (const t of ["Critical", "Blocker", "Super Combo", "Awaken"]) assert.ok(keywordOf(t), t);
assert.equal(parseSkills("[Activate:Main][Once Per Turn] Draw 1 card.")[0].oncePerTurn, true);

// A Fusion World line and the dbs sentence it stands for read the same.
const same = (fw: string, dbs: string) => {
  const a = parseSkills(fw)[0], b = parseSkills(dbs)[0];
  assert.deepEqual([a.kind, a.tags, a.effect], [b.kind, b.tags, b.effect], `${fw} reads as ${dbs}`);
};
same("[On Play] Draw 1 card.", "[Auto] When this card is played, draw 1 card.");
same("[When Attacking] Draw 1 card.", "[Auto] When this card attacks, draw 1 card.");
same("[When KO'd] Draw 1 card.", "[Auto] When this card is KO'd, draw 1 card.");
same("[End of Your Turn] Draw 1 card.", "[Auto] At the end of your turn, draw 1 card.");
same("[Permanent][Your Turn] This card gets +5000 power.", "[Permanent] During your turn, this card gets +5000 power.");
same("[Permanent][Opponent's Turn] This card gets +5000 power.", "[Permanent] During your opponent's turn, this card gets +5000 power.");

// The glossary lists every alias.
const entry = JSON.stringify(FUSION_WORLD_SPELLINGS);
for (const f of FUSION_SPELLINGS) assert.ok(entry.includes(`[${f.tag}]`), `glossary lists [${f.tag}]`);

if (process.env.FW_TABLE) for (const r of rows) console.log(`| ${r.id}${r.side ? " " + r.side : ""} | ${r.line.replace(/\|/g, "\\|").slice(0, 70)} | ${r.kind} | ${r.trigger} | ${r.cost} | ${r.unread} |`);
// F1-03 (#1186): the two rules the engine does natively — a combo has no price, power 0 is not a KO.
{
const definitionOf = (game: "dbs" | "fusion") => {
  const loaded = rulesetFor(game);
  assert.ok(loaded.ok, `${game} loads`);
  return loaded.definition;
};
assert.equal(comboPriceOf(definitionOf("fusion")), null, "the fusion definition declares no combo price");
assert.equal(comboPriceOf(definitionOf("dbs")), "combo", "the dbs definition declares one");

DEFS["FW-COMBO"] = card("FW-COMBO", { energyCost: 1, power: 5000, comboCost: 3, comboPower: 10000, skill: "" });
DEFS["FW-LOWER"] = card("FW-LOWER", { energyCost: 0, power: 5000, skill: "[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards and it gets -5000 power for the duration of the turn." });
DEFS["FW-TARGET"] = card("FW-TARGET", { energyCost: 1, power: 5000, skill: "[Auto] When this card is KO'd, draw 1 card." });

function newGame(game: "fusion" | "dbs"): EngineState {
  let r = IMPL.createGame(CTX, { seed: 7, game, p1: { name: "You", leader: "L-RED", main: fifty("V1") }, p2: { name: "Claude", leader: "L-BLUE", main: fifty("V-BLUE") } }).state;
  const chooser = (r.prompt as { player: PlayerId }).player;
  const steps: Action[] = [
    { type: "chooseFirst", player: chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null }, { type: "endMain", player: "p1" },
    { type: "charge", player: "p2", card: null }, { type: "endMain", player: "p2" },
    { type: "charge", player: "p1", card: null },
  ];
  for (const a of steps) r = IMPL.apply(CTX, r, a).state;
  assert.equal(r.prompt.kind, "main");
  return r;
}

function stage(state: EngineState, owner: PlayerId, cardId: string, area: "hand" | "battle"): string {
  const filler = owner === "p1" ? "V1" : "V-BLUE";
  const id = zoneOf(state, owner, "deck").find((x) => state.cards[x].cardId === filler);
  assert.ok(id);
  state.sides[owner].zones.deck = zoneOf(state, owner, "deck").filter((x) => x !== id);
  state.cards[id].cardId = cardId;
  zoneOf(state, owner, area).push(id);
  if (area === "battle") state.cards[id].mode = "active";
  return id;
}

function take(state: EngineState, action: Action): { state: EngineState; events: GameEvent[] } {
  assert.ok(IMPL.legalActions(CTX, state).some((row) => JSON.stringify(row.action) === JSON.stringify(action)), `expected legal ${JSON.stringify(action)} at ${state.prompt.kind}`);
  return IMPL.apply(CTX, state, action);
}

const restedEnergy = (s: EngineState, p: PlayerId) => zoneOf(s, p, "energy").filter((id) => s.cards[id].mode === "rest").length;

// (a) Combo without a price.
for (const game of ["fusion", "dbs"] as const) {
  let state = newGame(game);
  const combo = stage(state, "p1", "FW-COMBO", "hand");
  for (const id of zoneOf(state, "p1", "energy")) state.cards[id].mode = "rest"; // nothing left to pay with
  const rested = restedEnergy(state, "p1");
  state = take(state, { type: "attack", player: "p1", attacker: leaderOf(state, "p1")!, target: leaderOf(state, "p2")! }).state;
  const offered = IMPL.legalActions(CTX, state).some((a) => a.action.type === "combo" && a.action.card === combo);
  assert.equal(offered, game === "fusion", `${game}: a 3-cost combo with no energy is ${game === "fusion" ? "offered free" : "refused"}`);
  if (game === "dbs") continue;
  const joined = take(state, { type: "combo", player: "p1", card: combo });
  assert.notEqual(joined.state.prompt.kind, "payCost", "no payment prompt");
  assert.equal(restedEnergy(joined.state, "p1"), rested, "no energy rested");
  assert.ok(zoneOf(joined.state, "p1", "combo").includes(combo), "the card is in the Combo Area");
  state = joined.state;
  for (let i = 0; i < 12 && state.prompt.kind !== "main" && state.phase !== "over"; i++) {
    const prompt = state.prompt as { kind: string; player: PlayerId };
    assert.equal(prompt.kind, "combo", `battle stopped at ${prompt.kind}`);
    state = take(state, { type: "pass", player: prompt.player }).state;
  }
  assert.ok(zoneOf(state, "p1", "drop").includes(combo), "the combo card is in the Drop at the end of the battle");
}

// (b) Power 0 is not a KO.
for (const game of ["fusion", "dbs"] as const) {
  let state = newGame(game);
  const target = stage(state, "p2", "FW-TARGET", "battle");
  const lower = stage(state, "p1", "FW-LOWER", "hand");
  const handBefore = zoneOf(state, "p2", "hand").length;
  const result = take(state, { type: "play", player: "p1", card: lower });
  state = result.state;
  const events = [...result.events];
  for (let i = 0; i < 6 && state.prompt.kind !== "main"; i++) {
    const rows = IMPL.legalActions(CTX, state);
    const pick = rows.find((r) => r.action.type === "choose" || r.action.type === "chooseMode") ?? rows[0];
    const next = IMPL.apply(CTX, state, pick.action);
    state = next.state;
    events.push(...next.events);
  }
  assert.equal(state.prompt.kind, "main", `${game}: back at the Main Phase`);
  assert.ok(zoneOf(state, "p2", "drop").includes(target), `${game}: the power-0 card is in its owner's Drop`);
  assert.ok(!zoneOf(state, "p2", "battle").includes(target));
  assert.equal(zoneOf(state, "p2", "hand").length, handBefore, `${game}: its "when KO'd" draw did not fire`);
  assert.ok(!state.pending.some((p) => p.card === target), `${game}: nothing pends on it`);
  assert.ok(!events.some((e) => e.type === "ko" && e.card === target), `${game}: no KO is logged for it`);
}
}


// F1-07 (#1190): the four starters, played. Fixtures, compiled programs, scripted scenarios, full games.
const FC = fusionContext();
type Pick = (rows: LegalAction[], state: EngineState) => LegalAction | undefined;
const by = (state: EngineState, a: Action) => IMPL.legalActions(FC, state).find((row) => JSON.stringify(row.action) === JSON.stringify(a));
const ftake = (state: EngineState, action: Action): { state: EngineState; events: GameEvent[] } => {
  assert.ok(by(state, action), `expected legal ${JSON.stringify(action)} at ${JSON.stringify(state.prompt)}; offered: ${IMPL.legalActions(FC, state).map((r) => r.label).join(" | ")}`);
  return IMPL.apply(FC, state, action);
};
/** Opening to the first question: p1 goes first, both keep their hands. */
function opening(a: Starter, b: Starter, seed = 7): EngineState {
  let r = IMPL.createGame(FC, { seed, game: "fusion", p1: starterDeck(a, a), p2: starterDeck(b, b) }).state;
  r = IMPL.apply(FC, r, { type: "chooseFirst", player: (r.prompt as { player: PlayerId }).player, first: "p1" }).state;
  for (const p of ["p1", "p2"] as const) r = IMPL.apply(FC, r, { type: "mulligan", player: p, redraw: false }).state;
  return r;
}
/** Charges the first card of the hand (a skipped charge when the hand is empty) for the player asked. */
function charge(state: EngineState): EngineState {
  const p = (state.prompt as { player: PlayerId }).player;
  const row = IMPL.legalActions(FC, state).find((x) => x.action.type === "charge" && x.action.card);
  return IMPL.apply(FC, state, row?.action ?? { type: "charge", player: p, card: null }).state;
}
/** To p1's Main Phase of turn 3: p1 has charged twice, p2 once and holds its marker. */
function mainOf(a: Starter, b: Starter, seed = 7): EngineState {
  let r = charge(opening(a, b, seed));
  r = IMPL.apply(FC, r, { type: "endMain", player: "p1" }).state;
  r = charge(r);
  r = IMPL.apply(FC, r, { type: "endMain", player: "p2" }).state;
  r = charge(r);
  assert.equal(r.prompt.kind, "main");
  assert.equal(r.turn, 3);
  return r;
}
/** Swaps a card of the owner's deck for `cardId` and puts it in `area`; battle cards come in Active. */
function put(state: EngineState, owner: PlayerId, cardId: string, area: "hand" | "battle"): string {
  const id = zoneOf(state, owner, "deck")[0];
  state.sides[owner].zones.deck = zoneOf(state, owner, "deck").filter((x) => x !== id);
  state.cards[id].cardId = cardId;
  zoneOf(state, owner, area).push(id);
  if (area === "battle") state.cards[id].mode = "active";
  return id;
}
/** Plays the prompts out with `pick` (the first legal answer by default) until the Main Phase or the end of the game. */
function settle(state: EngineState, events: GameEvent[] = [], pick: Pick = (rows) => rows[0]): { state: EngineState; events: GameEvent[] } {
  const all = [...events];
  for (let i = 0; i < 30 && state.prompt.kind !== "main" && state.phase !== "over"; i++) {
    const rows = IMPL.legalActions(FC, state);
    const row = pick(rows, state) ?? rows[0];
    const next = IMPL.apply(FC, state, row.action);
    state = next.state;
    all.push(...next.events);
  }
  return { state, events: all };
}
const passing: Pick = (rows) => rows.find((r) => r.action.type === "block" && !r.action.card) ?? rows.find((r) => r.action.type === "pass") ?? rows.find((r) => r.action.type === "choose" || r.action.type === "chooseMode");
const lifeOf = (s: EngineState, p: PlayerId) => zoneOf(s, p, "life").length;
const skillsOf = (events: GameEvent[], card: string) => events.filter((e) => e.type === "skill" && e.card === card);
const attack = (s: EngineState, attacker: string, target: string, pick: Pick = passing) => {
  const r = ftake(s, { type: "attack", player: "p1", attacker, target });
  return settle(r.state, r.events, pick);
};

{
// Fixtures: the 64 definitions, four lists of 50, and every program read.
assert.equal(Object.keys(FW_DEFS).length, 64, "the 64 starter cards");
for (const code of STARTERS) {
  const deck = starterDeck(code);
  assert.equal(deck.main.length, 50, `${code}: 50 main-deck cards`);
  assert.ok(deck.main.every((id) => FW_DEFS[id] && FW_DEFS[id].type !== "LEADER"), `${code}: only main-deck cards`);
  assert.equal(FW_DEFS[deck.leader].type, "LEADER");
  const copies = new Map<string, number>();
  for (const id of deck.main) copies.set(id, (copies.get(id) ?? 0) + 1);
  assert.ok([...copies.values()].every((n) => n <= 4), `${code}: at most 4 copies`);
  assert.ok(deck.main.filter((id) => (FC.scripts?.[id]?.bySkill ? Object.values(FC.scripts[id].bySkill).some((sc) => (sc as { kind: string }).kind === "keyword") : false) && /\[Super Combo\]/.test(FW_DEFS[id].skill ?? "")).length <= 4, `${code}: at most 4 [Super Combo]`);
}
for (const def of Object.values(FW_DEFS)) {
  assert.equal(def.comboCost, null, `${def.id}: no combo price`);
  assert.equal(def.specifiedCost, undefined, `${def.id}: no specified cost until F1-08`);
  for (const side of def.back ? (["front", "back"] as const) : (["front"] as const)) {
    const compiled = compileCardCached(def, side);
    const unread = Object.entries(compiled.bySkill).filter(([, sc]) => (sc as { unsupported: string[] }).unsupported.length).map(([i]) => i);
    if (unread.length) assert.ok(def.id in KNOWN_UNREAD, `${def.id} ${side}: skills ${unread} are unread`);
    else assert.ok(!(def.id in KNOWN_UNREAD), `${def.id} is read now: take it off KNOWN_UNREAD`);
  }
}
}

// Setup.
{
  const created = IMPL.createGame(FC, { seed: 7, game: "fusion", p1: starterDeck("FS01"), p2: starterDeck("FS02") }).state;
  assert.equal(created.game, "fusion");
  let state = opening("FS01", "FS02");
  for (const p of ["p1", "p2"] as const) {
    assert.equal(zoneOf(state, p, "hand").length, 6, `${p}: a 6-card hand`);
    assert.equal(lifeOf(state, p), 8, `${p}: 8 life`);
    assert.equal(zoneOf(state, p, "deck").length, 36, `${p}: 50 - 6 - 8 left in the deck`);
    assert.equal(zoneOf(state, p, "zDeck").length + zoneOf(state, p, "zEnergy").length, 0, `${p}: no Z-Deck`);
  }
  assert.equal(energyMarkersOf(state, "p1"), 0, "the first player has no energy marker");
  assert.equal(energyMarkersOf(state, "p2"), 1, "the second player has one energy marker");
  state = charge(state);
  assert.equal(state.prompt.kind, "main");
  assert.equal(zoneOf(state, "p1", "energy").length, 1, "the charged card is the first energy");
  assert.ok(!IMPL.legalActions(FC, state).some((r) => r.action.type === "attack"), "the first player cannot attack on turn 1");
}

// Charge and play: a 1-cost card paid by resting one energy; a marker paying a cost.
{
  let state = mainOf("FS01", "FS02");
  const roshi = put(state, "p1", "FS01-03", "hand");
  const rested = (s: EngineState, p: PlayerId) => zoneOf(s, p, "energy").filter((id) => s.cards[id].mode === "rest").length;
  const before = rested(state, "p1");
  const played = ftake(state, { type: "play", player: "p1", card: roshi });
  assert.equal(played.state.prompt.kind, "main");
  assert.ok(zoneOf(played.state, "p1", "battle").includes(roshi), "Master Roshi is on the field");
  assert.equal(rested(played.state, "p1"), before + 1, "one energy rested for the 1-cost card");
  assert.equal(energyMarkersOf(played.state, "p1"), 0);
  // Seat 2: one energy and the marker pay a 2-cost card; the marker is spent.
  state = IMPL.apply(FC, charge(opening("FS01", "FS02")), { type: "endMain", player: "p1" }).state;
  state = charge(state);
  assert.equal((state.prompt as { player: PlayerId; kind: string }).kind, "main");
  assert.equal((state.prompt as { player: PlayerId }).player, "p2");
  const energy = zoneOf(state, "p2", "energy").length;
  const two = put(state, "p2", "FS02-06", "hand");
  assert.equal(energyMarkersOf(state, "p2"), 1, "the marker is still there");
  const paid = ftake(state, { type: "play", player: "p2", card: two });
  const out = settle(paid.state, paid.events);
  assert.ok(zoneOf(out.state, "p2", "battle").includes(two), "the 2-cost card is played");
  assert.equal(energyMarkersOf(out.state, "p2"), 0, "the marker paid and is gone");
  assert.equal(rested(out.state, "p2"), energy, "the other cost came from resting energy");
}


// Attack and damage.
{
  let state = mainOf("FS01", "FS02");
  const [mine, theirs] = [leaderOf(state, "p1")!, leaderOf(state, "p2")!];
  const [life, hand] = [lifeOf(state, "p2"), zoneOf(state, "p2", "hand").length];
  const top = zoneOf(state, "p2", "life")[0];
  const hit = attack(state, mine, theirs);
  assert.equal(hit.state.prompt.kind, "main");
  assert.equal(lifeOf(hit.state, "p2"), life - 1, "a leader hit takes one life card");
  assert.equal(zoneOf(hit.state, "p2", "hand").length, hand + 1, "…into the defender's hand");
  assert.ok(zoneOf(hit.state, "p2", "hand").includes(top) && !zoneOf(hit.state, "p2", "drop").includes(top), "the top life card, not the Drop");

  // A rested battle card attacked and KO'd (15000 leader against 5000), then a tie (15000 against 15000: the attacker wins).
  state = mainOf("FS01", "FS02");
  const weak = put(state, "p2", "FS02-08", "battle"); // Trunks : Youth, 5000
  const even = put(state, "p2", "FS02-05", "battle"); // Son Goten, 15000
  state.cards[weak].mode = "rest";
  state.cards[even].mode = "rest";
  const ko1 = attack(state, leaderOf(state, "p1")!, weak);
  assert.ok(ko1.events.some((e) => e.type === "ko" && e.card === weak), "the 5000 card is KO'd");
  assert.ok(zoneOf(ko1.state, "p2", "drop").includes(weak), "…to the Drop");
  assert.equal(lifeOf(ko1.state, "p2"), 8, "no life is lost when a battle card is hit");
  const tie = attack(state, leaderOf(state, "p1")!, even);
  assert.ok(tie.events.some((e) => e.type === "ko" && e.card === even), "15000 against 15000: the defender is KO'd");
  assert.ok(!tie.events.some((e) => e.type === "ko" && e.card === leaderOf(state, "p1")), "the attacker survives a tie");
}


// Combo: a card from the hand and an active battle card of the field, nothing paid, both in the Drop at the end of the battle.
{
  let state = mainOf("FS01", "FS02");
  const attacker = put(state, "p1", "FS01-10", "battle"); // Tien Shinhan, 15000
  const fromHand = put(state, "p1", "FS01-02", "hand"); // Whis, combo power 10000
  const fromField = put(state, "p1", "FS01-13", "battle"); // Frieza, combo power 10000
  const guard = put(state, "p2", "FS02-04", "battle"); // Son Goku, 30000, rested
  state.cards[guard].mode = "rest";
  const energyBefore = zoneOf(state, "p1", "energy").map((id) => state.cards[id].mode).join();
  let r = ftake(state, { type: "attack", player: "p1", attacker, target: guard });
  state = r.state;
  assert.equal(state.prompt.kind, "combo");
  const offered = IMPL.legalActions(FC, state).filter((x) => x.action.type === "combo").map((x) => (x.action as { card: string }).card);
  assert.ok(offered.includes(fromHand) && offered.includes(fromField), "the hand card and the active field card are offered");
  assert.ok(!offered.includes(attacker), "the attacker is not");
  const pay = (s: EngineState) => zoneOf(s, "p1", "energy").map((id) => s.cards[id].mode).join();
  for (const card of [fromHand, fromField]) {
    r = ftake(state, { type: "combo", player: "p1", card });
    state = r.state;
    assert.ok(zoneOf(state, "p1", "combo").includes(card), "in the Combo Area");
    assert.equal(pay(state), energyBefore, "no payment: not one energy rested");
    assert.notEqual(state.prompt.kind, "payCost");
  }
  const done = settle(state, [], (rows) => rows.find((x) => x.action.type === "pass") ?? rows[0]);
  assert.equal(done.state.prompt.kind, "main");
  assert.ok(zoneOf(done.state, "p1", "drop").includes(fromHand) && zoneOf(done.state, "p1", "drop").includes(fromField), "both combo cards are in the Drop after the battle");
  assert.ok(done.events.some((e) => e.type === "ko" && e.card === guard), "15000 + 10000 + 10000 beats 30000");
}

// [Blocker] redirects; [Critical] sends the life card to the Drop; [Double Strike] takes two.
{
  const state = mainOf("FS01", "FS02");
  const blocker = put(state, "p2", "FS02-12", "battle"); // Bulma, 5000, [Blocker]
  const target = leaderOf(state, "p2")!;
  const attacker = put(state, "p1", "FS01-10", "battle"); // vanilla 15000
  const asked = ftake(state, { type: "attack", player: "p1", attacker, target });
  assert.equal(asked.state.prompt.kind, "blocker");
  const blocked = settle(ftake(asked.state, { type: "block", player: "p2", card: blocker }).state, [], passing);
  assert.equal(lifeOf(blocked.state, "p2"), 8, "the blocker took the hit, not the leader");
  assert.ok(zoneOf(blocked.state, "p2", "drop").includes(blocker), "Bulma (5000) lost to 15000 and is in the Drop");
  assert.equal(blocked.state.cards[blocker].owner, "p2");
}
{
  const state = mainOf("FS01", "FS02");
  const crit = put(state, "p1", "FS01-14", "battle"); // Vegeta, [Critical]
  const top = zoneOf(state, "p2", "life")[0];
  const hit = attack(state, crit, leaderOf(state, "p2")!);
  assert.equal(lifeOf(hit.state, "p2"), 7);
  assert.ok(zoneOf(hit.state, "p2", "drop").includes(top), "[Critical]: the life card goes to the Drop");
  assert.ok(!zoneOf(hit.state, "p2", "hand").includes(top));
}
{
  const state = mainOf("FS01", "FS02");
  const double = put(state, "p1", "FS01-08", "battle"); // Son Goku (SR), [Double Strike]
  const hand = zoneOf(state, "p2", "hand").length;
  const hit = attack(state, double, leaderOf(state, "p2")!);
  assert.equal(lifeOf(hit.state, "p2"), 6, "[Double Strike]: two life cards");
  assert.equal(zoneOf(hit.state, "p2", "hand").length, hand + 2, "…both into the hand");
}


// [On Play], [When Attacking], [When KO'd] and [End of Your Turn], each once, at the right moment.
{
  const state = mainOf("FS01", "FS04");
  const roshi = put(state, "p1", "FS01-03", "hand"); // [On Play] Draw 1 card.
  const hand = zoneOf(state, "p1", "hand").length;
  const played = settle(ftake(state, { type: "play", player: "p1", card: roshi }).state, ftake(state, { type: "play", player: "p1", card: roshi }).events);
  assert.equal(skillsOf(played.events, roshi).length, 1, "[On Play] fires once, on playing");
  assert.equal(zoneOf(played.state, "p1", "hand").length, hand, "one card played, one drawn");

  // [When Attacking] on the front of FS01-01: the leader's attack draws, once, and the draw happens at the attack.
  const leader = leaderOf(state, "p1")!;
  const [before, target] = [zoneOf(state, "p1", "hand").length, leaderOf(state, "p2")!];
  const declared = ftake(state, { type: "attack", player: "p1", attacker: leader, target });
  const mid = zoneOf(declared.state, "p1", "hand").length;
  const swung = settle(declared.state, declared.events, passing);
  assert.equal(skillsOf(swung.events, leader).length, 1, "[When Attacking] fires once");
  assert.equal(zoneOf(swung.state, "p1", "hand").length, before + 1, "the leader's attack drew one card");
  assert.ok(mid <= before + 1);

  // [When KO'd]: Cui (FS04-02) is KO'd by a 30000 card and draws for its owner.
  const cui = put(state, "p2", "FS04-02", "battle");
  state.cards[cui].mode = "rest";
  const owner = zoneOf(state, "p2", "hand").length;
  const ko = attack(state, put(state, "p1", "FS01-13", "battle"), cui); // Frieza, 30000
  assert.ok(ko.events.some((e) => e.type === "ko" && e.card === cui), "Cui (20000) is KO'd by 30000");
  assert.equal(skillsOf(ko.events, cui).length, 1, "[When KO'd] fires once");
  assert.equal(zoneOf(ko.state, "p2", "hand").length, owner + 1, "…and draws one for its owner");
}
{
  // [End of Your Turn] on the back of FS04-01: up to 2 battle cards go Active at the end of the turn, not before.
  const state = mainOf("FS04", "FS01");
  const leader = leaderOf(state, "p1")!;
  state.cards[leader].flipped = true;
  const [a, b] = [put(state, "p1", "FS04-08", "battle"), put(state, "p1", "FS04-13", "battle")];
  state.cards[a].mode = state.cards[b].mode = "rest";
  const ended = ftake(state, { type: "endMain", player: "p1" });
  const out = settle(ended.state, ended.events, (rows) => rows.find((x) => x.action.type === "choose") ?? rows[0]);
  assert.equal(skillsOf(out.events, leader).length, 1, "[End of Your Turn] fires once");
  assert.equal(out.state.cards[a].mode, "active", "the first battle card is Active again");
  assert.equal(out.state.cards[b].mode, "active", "…and the second");
}

// F1-10 (#1208): the two effects the shared readers could not take. A shared aside for two named picks, and a look-at-N reveal of a name or a type.
{
  // FS02-03 Gotenks [On Play]: if 7 or fewer cards are in the hand, add up to 1 <Son Goten> and up to 1 <Trunks : Youth>, both cost 2 or less, from the Drop.
  const withEnergy = (state: EngineState, owner: PlayerId, n: number) => {
    for (let i = 0; i < n; i++) {
      const id = zoneOf(state, owner, "deck")[0];
      state.sides[owner].zones.deck = zoneOf(state, owner, "deck").filter((x) => x !== id);
      state.cards[id].mode = "active";
      zoneOf(state, owner, "energy").push(id);
    }
  };
  const drop = (state: EngineState, owner: PlayerId, cardId: string) => {
    const id = put(state, owner, cardId, "hand");
    state.sides[owner].zones.hand = zoneOf(state, owner, "hand").filter((x) => x !== id);
    zoneOf(state, owner, "drop").push(id);
    return id;
  };
  const gotenks = (hand: number) => {
    const state = mainOf("FS02", "FS01");
    withEnergy(state, "p1", 4);
    const [goten, trunks, big] = [drop(state, "p1", "FS02-06"), drop(state, "p1", "FS02-09"), drop(state, "p1", "FS02-05")];
    const card = put(state, "p1", "FS02-03", "hand");
    // `hand` cards in all, Gotenks among them; the condition is asked after it has left the hand.
    state.sides.p1.zones.hand = zoneOf(state, "p1", "hand").filter((x) => x === card).concat(zoneOf(state, "p1", "hand").filter((x) => x !== card).slice(0, hand - 1));
    while (zoneOf(state, "p1", "hand").length < hand) zoneOf(state, "p1", "hand").push(zoneOf(state, "p1", "deck").shift()!);
    const played = ftake(state, { type: "play", player: "p1", card });
    const out = settle(played.state, played.events, (rows) => rows.find((r) => r.action.type === "choose") ?? rows[0]);
    return { out, goten, trunks, big };
  };
  const { out, goten, trunks } = gotenks(8); // 7 left after Gotenks is played: the limit
  assert.ok(zoneOf(out.state, "p1", "hand").includes(goten) && zoneOf(out.state, "p1", "hand").includes(trunks), "FS02-03 adds both the <Son Goten> and the <Trunks : Youth> from the Drop");
  assert.equal(skillsOf(out.events, zoneOf(out.state, "p1", "battle").find((id) => out.state.cards[id].cardId === "FS02-03")!).length, 1, "[On Play] fires once");
  const full = gotenks(9); // 8 left after Gotenks is played
  assert.ok(!zoneOf(full.out.state, "p1", "hand").includes(full.goten), "with more than 7 cards in the hand FS02-03 adds nothing");

  // FS03-13 Moah [On Play]: look at 5, reveal up to 1 <Paragus> or up to 1 Extra, add it; the rest go to the bottom of the deck.
  for (const [want, label] of [["FS03-06", "a <Paragus>"], ["FS03-15", "an Extra"]] as const) {
    const state = mainOf("FS03", "FS01");
    const moah = put(state, "p1", "FS03-13", "hand");
    const top = zoneOf(state, "p1", "deck").slice(0, 5);
    state.cards[top[0]].cardId = "FS03-06";
    state.cards[top[1]].cardId = "FS03-15";
    const deckBefore = zoneOf(state, "p1", "deck").length;
    const handBefore = zoneOf(state, "p1", "hand").length;
    const played = ftake(state, { type: "play", player: "p1", card: moah });
    const out = settle(played.state, played.events, (rows) => rows.find((r) => r.action.type === "choose" && JSON.stringify(r.action).includes(want === "FS03-06" ? top[0] : top[1])) ?? rows.find((r) => r.action.type === "choose") ?? rows[0]);
    const taken = want === "FS03-06" ? top[0] : top[1];
    assert.ok(zoneOf(out.state, "p1", "hand").includes(taken), `FS03-13 reveals and adds ${label}`);
    assert.equal(zoneOf(out.state, "p1", "hand").length, handBefore, "one card played, one added");
    assert.equal(zoneOf(out.state, "p1", "deck").length, deckBefore - 1, "only the added card left the deck");
    const rest = top.filter((id) => id !== taken);
    assert.deepEqual(zoneOf(out.state, "p1", "deck").slice(-4).sort(), [...rest].sort(), "the other four are at the bottom of the deck");
  }
}

// [Awaken] at life 4 or less: offered in the Main Phase, draws, flips; not offered above.
{
  const state = mainOf("FS01", "FS02");
  const leader = leaderOf(state, "p1")!;
  const awakenRows = (s: EngineState) => IMPL.legalActions(FC, s).filter((x) => /^Awaken/.test(x.label));
  assert.equal(awakenRows(state).length, 0, "not at 8 life");
  for (const id of zoneOf(state, "p1", "life").slice(5)) { state.sides.p1.zones.life = zoneOf(state, "p1", "life").filter((x) => x !== id); zoneOf(state, "p1", "drop").push(id); }
  assert.equal(lifeOf(state, "p1"), 5);
  assert.equal(awakenRows(state).length, 0, "not at 5 life");
  const last = zoneOf(state, "p1", "life")[0];
  state.sides.p1.zones.life = zoneOf(state, "p1", "life").slice(1);
  zoneOf(state, "p1", "drop").push(last);
  assert.equal(lifeOf(state, "p1"), 4);
  assert.equal(awakenRows(state).length, 1, "offered at 4 life, in the Main Phase");
  const hand = zoneOf(state, "p1", "hand").length;
  const done = settle(ftake(state, awakenRows(state)[0].action).state);
  assert.equal(zoneOf(done.state, "p1", "hand").length, hand + 1, "[Awaken] draws 1");
  assert.equal(done.state.cards[leader].flipped, true, "…and flips the leader");
  assert.equal(awakenRows(done.state).length, 0, "an awakened leader cannot awaken again");
}

// The game ends: life-out and deck-out.
{
  const state = mainOf("FS01", "FS02");
  state.sides.p2.zones.life = zoneOf(state, "p2", "life").slice(0, 1);
  const end = attack(state, leaderOf(state, "p1")!, leaderOf(state, "p2")!);
  assert.equal(end.state.phase, "over");
  assert.equal(lifeOf(end.state, "p2"), 0);
  assert.equal(end.state.winner, "p1", "the attacker wins on life-out");
  assert.match(end.state.overReason ?? "", /Life Area/, "WIN lifeOut");
}
{
  const state = mainOf("FS01", "FS02");
  state.sides.p2.zones.deck = [];
  const end = IMPL.apply(FC, state, { type: "endMain", player: "p1" });
  const over = end.state.phase === "over" ? end : settle(end.state, end.events);
  assert.equal(over.state.phase, "over", "an empty deck ends the game");
  assert.equal(over.state.winner, "p1");
  assert.match(over.state.overReason ?? "", /Deck Area/, "WIN deckOut");
}


// Full games. Forty random complete games (200 locally: `npm run arena:fuzz -- 200 --game fusion`): no crash, no stall, and an interruption.
const FUZZ_GAMES = 40;
{
  let rng = 12345;
  const rand = () => { const r = nextRandom(rng); rng = r.state; return r.value; };
  const results: FuzzResult[] = [];
  for (let g = 0; g < FUZZ_GAMES; g++) {
    const a = STARTERS[Math.floor(rand() * STARTERS.length)], b = STARTERS[Math.floor(rand() * STARTERS.length)];
    results.push(runFuzzGame(FC, { seed: Math.floor(rand() * 1e9), game: "fusion", p1: starterDeck(a, a), p2: starterDeck(b, b) }, { random: rand }));
  }
  const bad = results.filter((r) => r.status === "crash" || r.status === "action-limit" || (r.status === "interrupted" && !(r.interruption?.sourceCard && r.interruption.cardId && r.interruption.cardId in KNOWN_UNREAD)));
  assert.deepEqual(bad.map((r) => `${r.status} seed ${r.seed} turn ${r.turn} after ${r.lastAction}: ${r.error ?? r.interruption?.detail}`), [], "the fuzz games run clean");
  const done = results.filter((r) => r.status === "completed");
  assert.ok(done.length >= FUZZ_GAMES / 2, `${done.length} of ${FUZZ_GAMES} fuzz games ran to a result`);
  for (const r of done) assert.ok(r.outcome?.kind === "win" && /Life Area|Deck Area/.test(r.outcome.reason), `a result by life-out or deck-out: ${r.outcome?.reason}`);
  console.log(`arena-fusion-world: ${FUZZ_GAMES} fuzz games: ${done.length} completed, ${results.length - done.length} interrupted on known-unread cards`);
}

// Local policy: one game per pair of starters, seat 2 on `localPolicy`, run to the end or to an interruption, which fails naming the decision.
{
  const seat1 = combatPolicy(uniformPolicy), seat2 = localPolicy();
  const failures: string[] = [];
  let pair = 0;
  for (const [i, a] of STARTERS.entries()) for (const b of STARTERS.slice(i)) {
    let match: PinnedMatch = { ctx: FC, state: IMPL.createGame(FC, { seed: 100 + pair, game: "fusion", p1: starterDeck(a, a), p2: starterDeck(b, b) }).state as PinnedMatch["state"], beats: null, art: {}, names: { p1: a, p2: b } };
    const memory: Record<PlayerId, LocalMemory> = { p1: localMemory(policyRng(pair * 2 + 1)), p2: localMemory(policyRng(pair * 2 + 2)) };
    let moves = 0, stopped: string | null = null;
    for (; moves < 3000 && match.state.phase !== "over"; moves++) {
      const seat = (match.state.prompt as { player?: PlayerId }).player;
      if (!seat) { stopped = `no seat asked at ${match.state.prompt.kind}`; break; }
      const step = localStep(match, seat, moves, memory[seat], seat === "p2" ? seat2 : seat1);
      memory[seat] = step.memory;
      if (!step.ok) { stopped = `${seat} ${step.reason}: ${step.detail}`; break; }
      match = step.match;
    }
    const outcome = resolveOutcome(match.state);
    if (outcome?.kind === "interrupted") {
      const detail = (match.state.outcome?.privateContext ?? {}) as { sourceCard?: string; detail?: string };
      const cardId = detail.sourceCard ? match.state.cards[detail.sourceCard]?.cardId : undefined;
      const text = `${a} vs ${b}: interrupted at turn ${match.state.turn} on ${cardId ?? "?"} (${detail.detail ?? outcome.reason})`;
      if (cardId && cardId in KNOWN_UNREAD) console.log(`arena-fusion-world: policy ${text} — known unread`);
      else failures.push(text);
    } else if (stopped || match.state.phase !== "over") failures.push(`${a} vs ${b}: ${stopped ?? `not over after ${moves} moves`}`);
    else console.log(`arena-fusion-world: policy ${a} vs ${b}: ${outcome?.winner ?? "draw"} won after turn ${match.state.turn} (${moves} moves)`);
    pair++;
  }
  assert.deepEqual(failures, [], "the policy games finish");
}


console.log(`arena-fusion-world: ${rows.length} skill lines of 64 cards read`);
