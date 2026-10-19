/** #897: narrow offline provenance and exact stored-program VM proof. No DB or provider. */
import assert from "node:assert/strict";
import { programProvenance, normalizeRows, type ExportedRule } from "../arena-corpus-provenance.mts";
import { freeze } from "../arena-corpus-freeze.mts";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { CTX, DEFS, IMPL, card, stagedG, findG, zoneOf } from "./harness";
import { loadSnapshot } from "../arena-deck-audit.mts";

const def = card("PROVENANCE-897", { skill: "[Activate: Main] Draw 1 card.", back: { name: "Back", power: 15000, skill: "[Activate: Main] Draw 2 cards." } });
const defs = { [def.id]: def };
const rows = skillRecords(def).map((r) => ({ ...r, status: "draft", source: "compiler", version: 1 })) as ExportedRule[];
const current = programProvenance(defs, "stored", rows);
assert.equal(current.manifest.length, 2);
assert.ok(current.manifest.every((s) => s.freshness === "current" && s.executable && s.humanReview?.confirmed === false), "current drafts are executable and unconfirmed");
const stale = structuredClone(rows);
stale[0].printed = "[Activate: Main] Draw 9 cards.";
stale[0].status = "confirmed";
const staleResult = programProvenance(defs, "stored", stale).manifest[0];
assert.equal(staleResult.freshness, "stale", "confirmation cannot establish current source identity");
assert.equal(staleResult.executable, false);
assert.ok(staleResult.blockers.includes("stored record stale"));
const missingBack = programProvenance(defs, "stored", rows.slice(0, 1)).manifest[1];
assert.equal(missingBack.freshness, "missing", "front record cannot cover back skill");
assert.equal(missingBack.executable, false);
assert.ok(missingBack.blockers.includes("stored record missing"));
assert.ok(programProvenance(defs, "stored", [rows[0], ...rows]).manifest[0].blockers.includes("stored record duplicate"));

// Combo qualifications now cross the same real match-loader boundary as prices.
// A stale export is still physical evidence, but cannot become an executable
// self-combo Auto by deriving its qualification from the printed wording.
const comboDef = card("PROVENANCE-COMBO", { skill: "[Auto] When this card is used in a combo during your turn, draw 1 card." });
const qualifiedRows = skillRecords(comboDef).map((r) => ({ ...r, status: "draft", source: "compiler", version: 1 })) as ExportedRule[];
const comboReport = programProvenance({ [comboDef.id]: comboDef }, "stored", qualifiedRows);
assert.equal(comboReport.manifest[0].executable, true);
assert.ok(!comboReport.manifest[0].blockers.some((s) => s.includes("derived from printed text")));
assert.equal(comboReport.scripts[comboDef.id].bySkill[0].combo?.turn, "controller");
const changedCombo = structuredClone(qualifiedRows);
(changedCombo[0].combo as Record<string, unknown>).turn = "opponent";
const changedComboReport = programProvenance({ [comboDef.id]: comboDef }, "stored", changedCombo);
assert.equal(changedComboReport.manifest[0].executable, true);
assert.equal(changedComboReport.manifest[0].differsFromCompiler, true);
assert.equal(changedComboReport.scripts[comboDef.id].bySkill[0].combo?.turn, "opponent");
const obsoleteCombo = structuredClone(qualifiedRows);
delete obsoleteCombo[0].combo;
const obsoleteComboReport = programProvenance({ [comboDef.id]: comboDef }, "stored", obsoleteCombo);
assert.equal(obsoleteComboReport.manifest[0].executable, false);
assert.ok([...obsoleteComboReport.malformed, ...obsoleteComboReport.manifest[0].blockers].some((s) => /combo.*regenerate/.test(s)));
assert.ok(normalizeRows([{ ...qualifiedRows[0], combo: { version: 1, timing: "entry", subject: "self", origins: [], turn: "any" } }]).malformed.length);
assert.ok(normalizeRows([{ ...rows[0], card_id: "CONFLICT" }]).malformed.length);
assert.ok(normalizeRows([{ ...rows[0], ops: [null] }]).malformed.length, "nested malformed executable rejected explicitly");
const partial = { ...rows[0] }; delete partial.cost;
assert.ok(normalizeRows([partial]).malformed.length, "incomplete export cannot masquerade as full rows");
const flagged = programProvenance(defs, "stored", [{ ...rows[0], status: "confirmed", reviewFlag: "suspected misread" }, rows[1]]);
assert.equal(flagged.manifest[0].humanReview?.confirmed, false);

// The per-turn ceiling is an executable record field, even when the stored
// author deliberately differs from the display tag. Missing metadata blocks.
const usageDef = card("PROVENANCE-USAGE", { skill: "[Activate: Main][Once per turn] Draw 1 card." });
const usageRows = skillRecords(usageDef).map((r) => ({ ...r, status: "draft", source: "compiler", version: 1 })) as ExportedRule[];
const usageDefs = { [usageDef.id]: usageDef };
const currentUsage = programProvenance(usageDefs, "stored", usageRows);
assert.equal(currentUsage.manifest[0].executable, true);
assert.equal(currentUsage.scripts[usageDef.id].bySkill[0].usage?.oncePerTurn, true);
assert.ok(!currentUsage.manifest[0].blockers.some((s) => /oncePerTurn.*printed text/.test(s)));
const changedUsage = structuredClone(usageRows);
(changedUsage[0].usage as Record<string, unknown>).oncePerTurn = false;
const changedUsageReport = programProvenance(usageDefs, "stored", changedUsage);
assert.equal(changedUsageReport.manifest[0].executable, true);
assert.equal(changedUsageReport.manifest[0].differsFromCompiler, true);
assert.equal(changedUsageReport.scripts[usageDef.id].bySkill[0].usage?.oncePerTurn, false);
const oldUsage = structuredClone(usageRows); delete oldUsage[0].usage;
const oldUsageReport = programProvenance(usageDefs, "stored", oldUsage);
assert.equal(oldUsageReport.manifest[0].executable, false);
assert.ok([...oldUsageReport.malformed, ...oldUsageReport.manifest[0].blockers].some((s) => /typed skill usage.*regenerate/.test(s)));
assert.ok(normalizeRows([{ ...usageRows[0], usage: { version: 1, oncePerTurn: "true", limit: null } }]).malformed.length);
// Sparking is executable validity, not a catalog reminder re-read by the VM.
const sparkDef = card("PROVENANCE-SPARK", { skill: "[Auto][Sparking 3] When this card is played, draw 1 card." });
const sparkRows = skillRecords(sparkDef).map(r => ({ ...r, status: "draft", source: "compiler", version: 1 })) as ExportedRule[];
const sparkDefs = { [sparkDef.id]: sparkDef };
const currentSpark = programProvenance(sparkDefs, "stored", sparkRows);
assert.equal(currentSpark.manifest[0].executable, true);
assert.equal(currentSpark.scripts[sparkDef.id].bySkill[0].validity?.sparking, 3);
assert.ok(!currentSpark.manifest[0].blockers.some(s => /sparking.*printed text/.test(s)));
const changedSpark = structuredClone(sparkRows);
(changedSpark[0].validity as Record<string, unknown>).sparking = null;
const changedSparkReport = programProvenance(sparkDefs, "stored", changedSpark);
assert.equal(changedSparkReport.manifest[0].executable, true);
assert.equal(changedSparkReport.manifest[0].differsFromCompiler, true);
assert.equal(changedSparkReport.scripts[sparkDef.id].bySkill[0].validity?.sparking, null);
const oldSpark = structuredClone(sparkRows); delete oldSpark[0].validity;
const oldSparkReport = programProvenance(sparkDefs, "stored", oldSpark);
assert.equal(oldSparkReport.manifest[0].executable, false);
assert.ok([...oldSparkReport.malformed, ...oldSparkReport.manifest[0].blockers].some(s => /validity.*regenerate/.test(s)));
assert.ok(normalizeRows([{ ...sparkRows[0], validity: { version: 1, sparking: "3" } }]).malformed.length);
const snake = rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), value])));
assert.deepEqual(programProvenance(defs, "stored", snake).scripts, current.scripts, "supported export naming preserves loaded program");
assert.throws(() => programProvenance(defs, "compiler", rows), /stored mode/);
assert.throws(() => programProvenance(defs, "stored", null), /requires/);

// A deliberately different stored effect is reported and executed by the real VM.
const changed = structuredClone(rows);
changed[0].ops = [{ op: "draw", n: 3 }];
const loaded = programProvenance(defs, "stored", changed);
assert.equal(loaded.manifest[0].differsFromCompiler, true);
assert.equal(loaded.manifest[0].freshness, "current");
assert.equal(loaded.manifest[0].executable, true);
DEFS[def.id] = def;
const staged = stagedG({ battle: [def.id] });
// Materialize supporting harness records too: spreading its compiler Proxy loses
// native leader scripts, which now require explicit payment records.
const supportRows = Object.values(DEFS).flatMap(skillRecords).map((r) => ({ ...r, status: "draft", source: "compiler", version: 1 })) as RuleRow[];
const context = { ...CTX, scripts: { ...rulesFromRows(supportRows, DEFS), ...loaded.scripts } };
const action = IMPL.legalActions(context, staged).find((entry) => entry.action.type === "activate" && entry.action.card === findG(staged, "p1", "battle", def.id))!.action;
const before = zoneOf(staged, "p1", "hand").length;
const after = IMPL.apply(context, JSON.parse(JSON.stringify(staged)), action).state;
assert.equal(zoneOf(after, "p1", "hand").length, before + 3, "reloaded state executes stored Draw 3, printed fresh compiler Draw 1 is never substituted");

const priced = card("PROVENANCE-COST", { skill: "[Activate: Main] {r}: Draw 1 card." });
const addedPrice = { version: 1, readable: true, text: "added stored payment", orbs: {}, either: [], marker: null, burst: null, spiritBoost: null, condition: null, program: [{ op: "draw", n: 1 }] };
// #907 repairs the #1065 ignored-price defect: the frozen old blocker is deliberately
// replaced by a stored-authority proof, not silently rebaselined.
const addedPayment = programProvenance(defs, "stored", [{ ...rows[0], cost: addedPrice }, rows[1]]);
assert.equal(addedPayment.manifest[0].executable, true);
assert.deepEqual(addedPayment.scripts[def.id].bySkill[0].price?.ops, addedPrice.program, "stored payment survives despite empty printed cost");
const priceRows = skillRecords(priced).map((r) => ({ ...r, status: "draft", source: "compiler", version: 1 }));
const blockedCost = programProvenance({ [priced.id]: priced }, "stored", priceRows);
assert.equal(blockedCost.manifest[0].executable, true, "activated typed orbs are now honoured by the match loader");
assert.deepEqual(blockedCost.scripts[priced.id].bySkill[0].price?.payment.orbs, { Red: 1 });
const obsolete = structuredClone(priceRows);
delete (obsolete[0].cost as unknown as Record<string, unknown>).version;
const obsoleteReport = programProvenance({ [priced.id]: priced }, "stored", obsolete);
assert.equal(obsoleteReport.manifest[0].executable, false);
assert.ok([...obsoleteReport.malformed, ...obsoleteReport.manifest[0].blockers].some((s) => /typed.*payment|regenerate/.test(s)), "obsolete payment records have an explicit rebuild blocker");
const native = card("PROVENANCE-NATIVE", { skill: "[Over Realm 3]{1}<br>[Blocker]" });
const nativeReport = programProvenance({ [native.id]: native }, "stored", []);
assert.equal(nativeReport.manifest[0].requiredRow, true, "native activated keywords now require persisted payment records");
assert.equal(nativeReport.manifest[0].executable, false, "row-free keyword must not bypass printed payment/material boundary");
assert.equal(nativeReport.manifest[1].executable, true, "ordinary native keyword contract remains identified by pinned ruleset");
const combo = card("PROVENANCE-TRIGGER", { skill: "[Auto] When this card is used in a combo from your hand, draw 1 card." });
const comboRows = skillRecords(combo).map((r) => ({ ...r, status: "draft", source: "compiler", version: 1 }));
const handCombo = programProvenance({ [combo.id]: combo }, "stored", comboRows);
assert.equal(handCombo.manifest[0].executable, true, "the former runtime-English blocker is replaced by an executable typed origin contract");
assert.deepEqual(handCombo.scripts[combo.id].bySkill[0].combo?.origins, ["hand"]);

// Frozen runner reports exact stored bytes/programs and never admits zero or move-limited games.
const template = loadSnapshot().cards[0];
const catalogCard = { ...template, id: def.id, name: def.name, skill: def.skill, backName: null, backSkill: null, cardType: "BATTLE", energyCost: "1", colors: ["Red"] };
const leader = { ...catalogCard, id: "PROVENANCE-LEADER", name: "Leader", skill: null, cardType: "LEADER" };
const options = { catalog: { source: { url: "synthetic proof", retrieved: "2026-10-19" }, cards: [catalogCard, leader] }, extra: [{ key: "proof", name: "Proof", leader: leader.id, main: Array(50).fill(def.id) }], starters: false, stored: [changed[0]], runtime: "b47de15a", pairs: 0, maxMoves: 0, seedBase: 897000, catalogPath: "synthetic" };
const zero = await freeze(options);
assert.equal(zero.mode, "stored");
assert.equal(zero.programs.manifest[0].differsFromCompiler, true);
assert.deepEqual(zero.storedRules.exactExport, [changed[0]]);
assert.deepEqual(zero.programs.scripts[def.id].bySkill[0].ops, changed[0].ops);
assert.equal(zero.summary.admitted.length, 0, "zero scheduled games cannot qualify a release");
const staleDeck = await freeze({ ...options, stored: [stale[0]] });
assert.equal(staleDeck.decks[0].qualified, false);
assert.ok(staleDeck.decks[0].blockers.some((s) => s.includes("stored record stale")));
const backDeck = await freeze({ ...options, catalog: { ...options.catalog, cards: [{ ...catalogCard, backName: def.back!.name, backSkill: def.back!.skill }, leader] } });
assert.equal(backDeck.decks[0].qualified, false);
assert.ok(backDeck.decks[0].blockers.some((s) => s.includes("/back/0: stored record missing")));
const limited = await freeze({ ...options, pairs: 1 });
assert.equal(limited.summary.limited, 1, JSON.stringify(limited.games));
assert.equal(limited.summary.admitted.length, 0, "all-limited games cannot qualify a release");
const crashed = await freeze({ ...options, pairs: 1, runtime: "invalid-runtime" });
assert.equal(crashed.summary.crashed, 1);
assert.equal(crashed.summary.admitted.length, 0, "crashed games cannot qualify a release");
const missing = await freeze({ ...options, extra: [{ ...options.extra[0], main: ["MISSING"] }] });
assert.ok(missing.decks[0].blockers.some((s) => s.includes("MISSING")), "missing catalog cards refuse without a legality crash");
console.log("arena-corpus provenance: current/unconfirmed, stale confirmed, missing back skill, exact stored VM effect, cost/trigger blockers, zero/limited admission passed");
