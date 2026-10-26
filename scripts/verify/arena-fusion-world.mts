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

/**
 * Effects that stay unread, with the tag already read. Not a tag problem: the same effect spelled the dbs way
 * ("[Auto] When this card is played, if …, add up to 1 <Son Goten> and up to 1 <Trunks : Youth> —both with a cost of 2 or less—
 * from your Drop to your hand") is unread too (FS03-13 likewise), so the gap is the effect reader's (two named cards joined by "and" sharing an
 * aside; a look-at-5 reveal of a name or Extra) and out of F1-04's scope. Handed to the coordinator in the PR.
 */
const KNOWN_UNREAD: Record<string, string> = {
  "FS02-03": "two named cards from the Drop under one shared aside",
  "FS03-13": "look at 5, reveal up to 1 <Paragus> or up to 1 Extra",
};

type Row = { id: string; side: string; line: string; kind: string; trigger: string; cost: string; unread: number };
const rows: Row[] = [];
const cards: { id: string; type: string; faces: string[] }[] = [];
for (const m of doc.matchAll(/^(FS0[1-4]-\d\d) \| [^|]+ \| (\w+) \| [^|]+ \| [^|]+ \| [^|]+ \| [^|]+ \| (.+)$/gm)) {
  // FS01-12 is transcribed "it gets +5000 for the turn"; every other power line prints "power" (FS01-01, FS01-15 …), so the word the
  // site dropped is put back rather than teaching the compiler a wording no card prints (noted in the PR).
  const text = m[3].replace(/\(site shows[^)]*\)/, "").replace(REMINDER, "").replace(/(gets [+-]\d+) for the turn/g, "$1 power for the turn").trim();
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
      rows.push({ id: c.id, side: c.faces.length > 1 ? (i ? "back" : "front") : "", line: r.printed, kind: r.kind, trigger: r.trigger.join("+") || "-", cost: r.cost?.program && r.cost.readable ? "price" : r.cost?.text ? "UNREAD" : "-", unread: r.unread.length });
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

console.log(`arena-fusion-world: ${rows.length} skill lines of 64 cards read`);
