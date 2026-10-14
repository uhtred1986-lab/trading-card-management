/**
 * #655 (plan O4-02): versioned offline deck packs, without a database, a network or a provider.
 *
 *   1. Determinism: two builds of the audited pair (#649) agree byte for byte; a JSON round trip
 *      still validates.
 *   2. Completeness: removing a generated/token card, an alternate face, a program, an art item or
 *      a ruleset file fails validation — also after every hash is recomputed, so the failure is the
 *      manifest's and not only the hash's.
 *   3. Qualification: tampering, an unsupported version, a foreign interpreter revision and an
 *      unresolved mechanic each keep the pack unplayable; every audited blocker stays visible with
 *      its issue links, and the register equals the audit document's.
 *   4. Instantiation: a validated pack creates both curated decks in both seats through
 *      `browser.ts`, plays legal moves, and projects a snapshot; the pack carries no account or
 *      private-collection field (exact field sets).
 *   5. Boundary: the import graph of `src/lib/arena/local/pack.ts` reaches no database, catalog
 *      source, provider, Node builtin, package, legacy engine or `process.env`, and the module's
 *      own imports name no compiler or card-text reader (sabotaged copies prove the checks bite).
 *
 *   npx tsx scripts/verify/arena-offline-pack.mts      (part of `npm test`)
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { checkImportGraph, diskRead, offlinePackRule, scanSource } from "../lib/import-graph.ts";
import { AUDIT_PATH, buildMastersPack, mastersPackInput, packSummary } from "../build-arena-offline-pack.mts";
import {
  DEF_FIELDS, OFFLINE_PACK_FORMAT, PACK_FIELDS, instantiateOfflinePack, makeOfflinePack, packContent, privateDataViolations,
  qualifyOfflinePack, sealOfflinePack, validateOfflinePack, type OfflinePack,
} from "../../src/lib/arena/local/pack.ts";
import { applyMove, legalMoves, projectSnapshot } from "../../src/lib/arena/browser.ts";
import { canonicalJson, makeReplayBundle, replayHash } from "../../src/lib/arena/replay-core.ts";

const ROOT = process.cwd();
const REV = "a655000000000000000000000000000000000655";
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ── 1. determinism ──────────────────────────────────────────────────────────
const pack = await buildMastersPack({ runtimeRevision: REV });
const again = await buildMastersPack({ runtimeRevision: REV });
assert.equal(again.hash, pack.hash, "two builds of the same inputs have the same pack hash");
assert.equal(canonicalJson(again), canonicalJson(pack), "two builds are byte-identical");
assert.equal(again.bundle.hash, pack.bundle.hash, "and the same card-bundle hash");
const valid = await validateOfflinePack(clone(pack));
assert.deepEqual(valid.errors, [], "the built pack validates after a JSON round trip");
const other = await buildMastersPack({ runtimeRevision: "b655000000000000000000000000000000000655" });
assert.notEqual(other.hash, pack.hash, "another interpreter revision is another pack");
const summary = packSummary(pack);
assert.equal(summary.cards, 41, "41 cards: the audit's snapshot subset, every one required by a deck");
assert.equal(summary.programs, 43, "41 front programs and the two Leaders' back programs");
assert.ok(pack.manifest.cards.find((e) => e.card === "SD15-01")!.faces.includes("back") && pack.manifest.cards.find((e) => e.card === "SD5-01")!.faces.includes("back"), "both Leaders carry their second face");

/** Recompute every hash after a change, so validation judges the content, not only the seal. */
async function reseal(p: OfflinePack, mutate: (p: OfflinePack) => void): Promise<OfflinePack> {
  const next = clone(p);
  mutate(next);
  const { payload } = next.bundle;
  next.bundle = await makeReplayBundle({ defs: payload.defs, scripts: payload.scripts, art: payload.art, rulesetFiles: payload.rulesetFiles, runtime: next.bundle.runtimeRevision });
  return sealOfflinePack(packContent(next));
}
async function refused(p: OfflinePack, expected: RegExp, what: string) {
  const r = await validateOfflinePack(p);
  assert.equal(r.ok, false, `${what} fails validation`);
  assert.ok(r.errors.some((e) => expected.test(e)), `${what}: expected ${expected} in ${JSON.stringify(r.errors)}`);
  const q = await qualifyOfflinePack(p, REV);
  assert.equal(q.playable, false, `${what} is never playable`);
}

// ── 2. completeness ─────────────────────────────────────────────────────────
await refused(await reseal(pack, (p) => { delete p.bundle.payload.scripts["SD15-01#back"]; }), /SD15-01#back: no program/, "removing the Leader's back program");
await refused(await reseal(pack, (p) => { delete p.bundle.payload.scripts["BT1-014"]; }), /BT1-014: no program/, "removing a front program");
await refused(await reseal(pack, (p) => { p.bundle.payload.defs["SD5-01"].back = null; }), /SD5-01: a Leader with no second face/, "removing the Leader's alternate face");
await refused(await reseal(pack, (p) => { p.bundle.payload.art["SD15-01"].back = null; }), /SD15-01: no back art/, "removing the Leader's back art");
await refused(await reseal(pack, (p) => { delete p.bundle.payload.art["BT4-097"]; }), /BT4-097: no front art/, "removing a card's art");
await refused(await reseal(pack, (p) => { delete p.bundle.payload.defs["BT6-025"]; }), /BT6-025: no pinned definition/, "removing a deck card's definition");
await refused(await reseal(pack, (p) => { delete p.bundle.payload.rulesetFiles["costs.rules"]; }), /completeness manifest/, "removing a ruleset file");
await refused(await reseal(pack, (p) => { p.bundle.payload.defs["X-1"] = { ...p.bundle.payload.defs["BT1-014"], id: "X-1" }; }), /defs\.X-1: not in the manifest/, "an unlisted extra card");
{
  // A generated card: the audited decks have none, so a synthetic token is pinned for SD15-04.
  const input = await mastersPackInput({ runtimeRevision: REV });
  const token = { ...input.defs["BT1-014"], id: "TOKEN-655", name: "Synthetic token", skill: null };
  input.defs["TOKEN-655"] = token;
  input.scripts["TOKEN-655"] = { bySkill: {}, complete: true, unsupported: [] };
  input.art["TOKEN-655"] = { front: "https://example.invalid/TOKEN-655.png", back: null };
  input.dependencies = [{ from: "SD15-04", to: "TOKEN-655", kind: "token" }];
  const withToken = await makeOfflinePack(input);
  assert.deepEqual(withToken.manifest.cards.find((e) => e.card === "TOKEN-655")?.requiredBy, ["dependency of SD15-04"], "the token is in the transitive manifest");
  assert.ok((await validateOfflinePack(withToken)).ok, "a pack with its token pinned validates");
  await refused(await reseal(withToken, (p) => { delete p.bundle.payload.defs["TOKEN-655"]; }), /TOKEN-655: no pinned definition/, "removing a generated card");
  await refused(await reseal(withToken, (p) => { delete p.bundle.payload.art["TOKEN-655"]; }), /TOKEN-655: no front art/, "removing a generated card's art");
  const noToken = { ...input, defs: { ...input.defs } };
  delete noToken.defs["TOKEN-655"];
  await assert.rejects(makeOfflinePack(noToken), /TOKEN-655: no pinned definition/, "the builder refuses a dependency it cannot pin");
}
await refused({ ...clone(pack), bundle: { ...clone(pack.bundle), payload: { ...clone(pack.bundle.payload), scripts: Object.fromEntries(Object.entries(pack.bundle.payload.scripts).filter(([k]) => k !== "SD5-01#back")) } } }, /content-hash/, "removing a program without resealing");

// ── 3. qualification ────────────────────────────────────────────────────────
assert.equal(pack.qualification.playable, true, "the audited pair qualifies: every blocker is resolved (U1 by #757)");
assert.deepEqual(pack.qualification.reasons, [], "and no reason is left");
{
  const tampered = clone(pack);
  tampered.bundle.payload.defs["SD15-03"].power = 99999;
  await refused(tampered, /content-hash/, "a tampered definition");
  const forged = clone(pack);
  forged.qualification = { playable: false, reasons: ["forged reason"] };
  forged.hash = await replayHash({ ...packContent(forged), qualification: forged.qualification });
  await refused(forged, /recorded qualification/, "a forged qualification flag, even rehashed");
  const v2 = clone(pack);
  v2.format = OFFLINE_PACK_FORMAT + 1;
  await refused(v2, /unsupported pack format/, "an unsupported pack format");
  const vm = clone(pack);
  vm.compatibility.vmStateVersion += 1;
  await refused(vm, /vm state version/, "another VM state version");
  const foreign = await qualifyOfflinePack(clone(pack), "c655000000000000000000000000000000000655");
  assert.ok(foreign.reasons.some((r) => /not the pack's interpreter revision/.test(r)), "a foreign interpreter revision is a reason");
  const unknown = await qualifyOfflinePack(clone(pack), null);
  assert.ok(unknown.reasons.some((r) => /runtime unknown/.test(r)), "an unknown interpreter revision is a reason");
}
{
  // An explicit empty override brings the missing-input path back; the default carries the owner's values.
  const bare = await mastersPackInput({ runtimeRevision: REV, specifiedCosts: {} });
  assert.deepEqual(bare.missingInputs.map((m) => m.card).sort(), ["DB3-001", "SD15-02"], "without the owner's costs both Unison cards are missing inputs");
  assert.equal(bare.blockers.find((b) => b.id === "U7")?.status, "missing-input", "and U7 is open");
  // Every audited blocker cleared (U7's input comes by default). Since #728 no
  // program of the pair holds an unread clause, so an unread one is staged to
  // prove that an unresolved mechanic alone still keeps a pack unplayable.
  const input = await mastersPackInput({ runtimeRevision: REV });
  assert.deepEqual(input.missingInputs, [], "the owner's specified costs clear the missing inputs");
  assert.equal(input.blockers.find((b) => b.id === "U7")?.status, "resolved", "and resolve U7");
  assert.deepEqual(Object.entries(input.scripts).filter(([, s]) => s.unsupported.length).map(([k]) => k), [], "#728: no program of the pair holds an unread clause");
  input.blockers = input.blockers.map((b) => ({ ...b, status: "resolved" as const }));
  const unread = { ...input, scripts: { ...input.scripts, "SD15-03": { ...input.scripts["SD15-03"], unsupported: ["staged unread clause"] } } };
  const cleared = await makeOfflinePack(unread);
  assert.equal(cleared.qualification.playable, false, "an unresolved mechanic alone keeps a pack unplayable");
  assert.deepEqual(cleared.qualification.reasons, ["unresolved mechanic: SD15-03 has 1 unread clause(s)"], "the unread program is named");
  // …and with no unread clause and every blocker resolved, the pack would qualify on its own interpreter only.
  const staged = await makeOfflinePack(input);
  assert.equal(staged.qualification.playable, true, "a staged pack with nothing open qualifies");
  assert.equal((await qualifyOfflinePack(staged, REV)).playable, true, "on its own interpreter");
  assert.equal((await qualifyOfflinePack(staged, "c655000000000000000000000000000000000655")).playable, false, "and not on another");
}
{
  const ids = pack.blockers.map((b) => b.id);
  for (const id of ["U1", "U2", "U3", "U4", "U5", "U6", "U7", "U8"]) assert.ok(ids.includes(id), `blocker ${id} is in the pack`);
  for (const b of pack.blockers) {
    if (b.status === "resolved") continue;
    assert.ok(pack.qualification.reasons.some((r) => r.startsWith(`blocker ${b.id} (`)), `open blocker ${b.id} is a visible reason`);
    for (const i of b.issues) assert.ok(pack.qualification.reasons.some((r) => r.includes(`#${i.issue}`)), `${b.id}'s issue #${i.issue} is visible`);
  }
  assert.equal(pack.blockers.find((b) => b.id === "U5")?.status, "resolved", "U5 (resolved by #716) stays listed as resolved");
  assert.equal(pack.blockers.find((b) => b.id === "U4")?.status, "resolved", "U4 (resolved by #729: BT4-079's [Swap] price) stays listed as resolved");
  assert.equal(pack.blockers.find((b) => b.id === "U6")?.status, "resolved", "U6 (resolved by #731: [Swap] reads its printed description) stays listed as resolved");
  assert.equal(pack.blockers.find((b) => b.id === "U8")?.status, "resolved", "U8 (resolved by #730: the master chooses which [Unique] copy stays) stays listed as resolved");
  // After #728, #729, #731, #730 and #757 (U1: played scenarios for every compiled-only mechanic) no blocker is open.
  assert.deepEqual(pack.blockers.filter((b) => b.status !== "resolved").map((b) => b.id), [], "no open blocker");
  assert.equal(pack.blockers.find((b) => b.id === "U1")?.status, "resolved", "U1 (resolved by #757) stays listed as resolved");
  {
    // #729/#731 in the pinned programs: BT4-079's price record, and the
    // ruleset text whose [Swap] reads the printed description.
    const price = pack.bundle.payload.scripts["BT4-079"]?.bySkill[0]?.price;
    assert.deepEqual(price?.ops?.map((o) => o.op), ["choose", "moveTo"], "the pack pins BT4-079's [Swap] action price");
    assert.match(pack.bundle.payload.rulesetFiles["keywords.rules"] ?? "", /IN you\.hand asPrinted, as: "swapIn"/, "the pinned [Swap] reads its printed description");
  }
  assert.deepEqual(pack.missingInputs, [], "U7: the owner's ruling (migration 0049, #733) supplies both Unison costs");
  assert.equal(pack.blockers.find((b) => b.id === "U7")?.status, "resolved", "U7 is resolved in the pack");
  for (const c of ["SD15-02", "DB3-001"]) assert.deepEqual(pack.bundle.payload.defs[c].specifiedCost, { Red: 2 }, `${c} carries the owner-ruled specified cost`);
  // The register equals the audit document's (§8): the same ids, the same resolved ones.
  const doc = fs.readFileSync(AUDIT_PATH, "utf8");
  const rows = [...doc.matchAll(/^\| (U\d) \|.*\| ([^|]*) \|$/gm)].map((m) => ({ id: m[1], resolved: /\bresolved\b/i.test(m[2]) }));
  assert.ok(rows.length >= 8, `the audit register was read (${rows.length} rows)`);
  assert.deepEqual(rows.map((r) => r.id).sort(), ids.filter((i) => /^U\d$/.test(i)).sort(), "the pack's U blockers are the audit's");
  for (const r of rows) assert.equal(pack.blockers.find((b) => b.id === r.id)!.status === "resolved", r.resolved, `${r.id}: resolved in the pack iff in the audit`);
  assert.ok(!ids.includes("A-LEGALITY") && !/Deck A illegal as printed/.test(doc), "deck A is the owner-amended legal list: no legality-decision blocker in the pack or the audit");
}

// ── 4. instantiation and private data ───────────────────────────────────────
{
  assert.deepEqual(Object.keys(pack).sort(), [...PACK_FIELDS].sort(), "the pack's field set is exactly the format's");
  for (const def of Object.values(pack.bundle.payload.defs)) for (const k of Object.keys(def)) assert.ok((DEF_FIELDS as readonly string[]).includes(k), `definition field ${k} is a catalog field`);
  for (const d of pack.decks) assert.deepEqual(Object.keys(d.deck).sort(), ["leader", "main", "name"], `deck ${d.key} carries only its list`);
  assert.deepEqual(privateDataViolations(clone(pack)), [], "no private-looking field anywhere");
  const leaky = clone(pack) as unknown as { decks: Record<string, unknown>[]; bundle: { payload: { defs: Record<string, Record<string, unknown>> } } };
  leaky.decks[0].owner = "someone";
  leaky.bundle.payload.defs["BT1-014"].pricePaidCents = 120;
  const v = privateDataViolations(leaky);
  assert.ok(v.some((x) => /decks\[0\]\.owner/.test(x)) && v.some((x) => /BT1-014\.pricePaidCents/.test(x)), `an owner or price-paid field is caught (${JSON.stringify(v)})`);

  const stored = clone(pack); // as read back from storage
  // The pack qualifies on its own interpreter only: on another one it is unqualified and does not start by default.
  await assert.rejects(instantiateOfflinePack({ pack: stored, p1: "A", p2: "B", seed: 655, interpreterRevision: "c655000000000000000000000000000000000655" }), /not playable/, "an unqualified pack does not start a game by default");
  for (const [p1, p2] of [["A", "B"], ["B", "A"]] as const) {
    // Since #757 the audited pair qualifies, so both games start without allowUnqualified.
    const made = await instantiateOfflinePack({ pack: stored, p1, p2, seed: 655, interpreterRevision: REV });
    let match = made.match;
    assert.deepEqual(Object.keys(match.ctx.scripts ?? {}).sort(), Object.keys(pack.bundle.payload.scripts).sort(), "the game's programs are the pack's, nothing compiled");
    assert.deepEqual(match.ctx.defs, pack.bundle.payload.defs, "the game's definitions are the pack's");
    assert.equal(match.names.p1, pack.decks.find((d) => d.key === p1)!.name);
    for (let step = 0; step < 40 && match.state.phase !== "over"; step++) {
      const moves = legalMoves(match);
      if (!moves.length) break;
      match = applyMove(match, moves[0].action).match;
    }
    const snap = projectSnapshot(match, "p1");
    assert.ok(snap && typeof snap === "object", `${p1} v ${p2}: a snapshot is projected`);
  }
  await assert.rejects(instantiateOfflinePack({ pack: stored, p1: "A", p2: "B", seed: 655, interpreterRevision: "c655000000000000000000000000000000000655", allowUnqualified: true }), /interpreter provenance/, "a foreign interpreter cannot instantiate the pack");
  await assert.rejects(instantiateOfflinePack({ pack: stored, p1: "A", p2: "C", seed: 655, interpreterRevision: REV, allowUnqualified: true }), /no deck C/, "an unknown deck key is refused");
}

// ── 5. boundary ─────────────────────────────────────────────────────────────
{
  const entry = path.join(ROOT, "src/lib/arena/local/pack.ts");
  const real = checkImportGraph(entry, ROOT, diskRead, { forbidFile: offlinePackRule });
  for (const v of real.violations) console.error(`  forbidden from local/pack.ts: ${v.file}: ${v.reason}`);
  assert.equal(real.violations.length, 0, "local/pack.ts reaches no forbidden import");
  for (const needed of ["src/lib/arena/browser.ts", "src/lib/arena/replay-core.ts", "src/lib/arena/vm/index.ts"]) assert.ok(real.files.includes(needed), `the walker followed local/pack.ts into ${needed}`);
  const NO_CARD_TEXT = /(^|\/)(compile|text|gaps|draft|load|catalog)(\/|\.ts$|$)|^\.\.\/compile$/;
  const direct = (text: string) => scanSource(entry, text).specifiers.filter((s) => NO_CARD_TEXT.test(s.replace(/\.ts$/, "")));
  const own = fs.readFileSync(entry, "utf8");
  assert.deepEqual(direct(own), [], "local/pack.ts imports no compiler or card-text reader itself");
  assert.deepEqual(direct(`${own}\nimport { compileCard } from "../compile";`), ["../compile"], "a direct compiler import would be caught");
  for (const [extra, expected] of [
    [`import { cardDefFrom } from "../load";`, "server-side card source import src/lib/arena/load.ts"],
    [`import { fetchDeckplanet } from "@/lib/catalog/deckplanet";`, "catalog source import src/lib/catalog/deckplanet.ts"],
    [`import { db } from "@/db";`, "server-only import @/db"],
    [`export const rev = process.env.VERCEL_GIT_COMMIT_SHA;`, "process.env lookup"],
    [`import { readFileSync } from "node:fs";`, "package or builtin import node:fs"],
  ] as const) {
    const read = (file: string) => (file === entry ? `${own}\n${extra}\n` : diskRead(file));
    const caught = checkImportGraph(entry, ROOT, read, { forbidFile: offlinePackRule });
    assert.ok(caught.violations.some((v) => v.file === "src/lib/arena/local/pack.ts" && v.reason === expected), `adding \`${extra}\` is caught as "${expected}" (got ${JSON.stringify(caught.violations)})`);
  }
}

console.log(`arena-offline-pack: ok — pack ${summary.hash.slice(0, 16)}… (${summary.bytes} bytes, ${summary.cards} cards, ${summary.programs} programs), playable ${summary.playable} with ${summary.reasons.length} reason(s)`);
