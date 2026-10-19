/** Exact #897 program payloads. No compileCard/rulesFromCompiler call is permitted here. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { DBS_FILES } from "../../src/lib/arena/rulesets/dbs";
import { canonicalJson, makeReplayBundle, type ReplayBundleRecord } from "../../src/lib/arena/replay-core";
import { evidenceHash, fixturePin } from "./policy-evaluation-manifest";
import type { DefenseProtocol } from "./arena-defense-contract";
export const byteHash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
export interface DefenseFixture {
  key: string; corpus: string; p1: string; p2: string; seedBase: number; fixtureIndex: number; bundle: ReplayBundleRecord;
  pin: ReturnType<typeof fixturePin>;
}
export async function defenseFixtures(protocol: DefenseProtocol): Promise<DefenseFixture[]> {
  const fixtures: DefenseFixture[] = [];
  for (const input of protocol.corpora) {
    const bytes = readFileSync(input.path); assert.equal(byteHash(bytes), input.sha256, `corpus bytes changed: ${input.key}`);
    const pack = JSON.parse(bytes.toString());
    assert.equal(pack.format, 2, "unsupported corpus pack"); assert.equal(pack.mode, input.mode);
    assert.equal(pack.issue, 897); assert.ok(pack.inputs?.defs && pack.inputs?.catalogCards && pack.programs?.scripts);
    assert.equal(evidenceHash(pack.programs.scripts), pack.programs.hash, "program script hash mismatch");
    assert.equal(evidenceHash(pack.inputs.ownerSpecifiedCosts), pack.inputs.ownerSpecifiedCostsHash, "specified-cost authority mismatch");
    const selected = input.decks.map(key => {
      const matches = pack.decks.filter((d: { key: string }) => d.key === key); assert.equal(matches.length, 1, "missing/duplicate qualified recipe");
      const deck = matches[0]; assert.equal(deck.admitted, true, `recipe not admitted: ${key}`); assert.equal(deck.qualified, true);
      assert.ok(deck.matches.games > 0 && deck.matches.completed === deck.matches.games, "qualification did not complete every game");
      assert.ok(["illegal", "interrupted", "limited", "crashed", "other"].every(k => deck.matches[k] === 0));
      const games = pack.games.filter((g: { p1: string; p2: string }) => g.p1 === key || g.p2 === key);
      assert.equal(games.length, deck.matches.games); assert.ok(games.every((g: { over: boolean; stopKind: unknown }) => g.over === true && g.stopKind === null), "qualification outcome mismatch");
      for (const id of [deck.deck.leader, ...deck.deck.main, ...(deck.deck.z ?? [])]) assert.ok(pack.inputs.defs[id] && pack.programs.scripts[id], `missing executable card ${id}`);
      return deck;
    });
    if (input.mode === "stored") {
      assert.equal(pack.storedRules?.checked, true); assert.deepEqual(pack.storedRules.malformed, []); assert.deepEqual(pack.storedRules.unexpectedRows, []);
      assert.equal(evidenceHash(pack.storedRules.exactExport), pack.storedRules.exactExportHash);
      assert.equal(evidenceHash(pack.storedRules.normalizedRows), pack.storedRules.normalizedRowsHash);
    }
    // Reconstruct the old qualification identity before rebinding unchanged
    // payload bytes to the separately declared current interpreter revision.
    const art = Object.fromEntries(Object.keys(pack.inputs.defs).map(id => {
      const card = pack.inputs.catalogCards.find((c: { id: string }) => c.id === id); assert.ok(card, `missing pinned catalog card ${id}`);
      return [id, { front: card.imageUrl, back: card.backImageUrl }];
    }));
    const qualified = await makeReplayBundle({ defs: pack.inputs.defs, scripts: pack.programs.scripts, art, rulesetFiles: DBS_FILES, runtime: pack.engineRevision });
    assert.equal(qualified.hash, pack.hashes.bundle); assert.equal(qualified.catalogHash, pack.hashes.catalog);
    assert.equal(qualified.programsHash, pack.hashes.programs); assert.equal(qualified.rulesetHash, pack.hashes.ruleset);
    const rebound = await makeReplayBundle({ ...qualified.payload, runtime: protocol.runtimeRevision });
    assert.equal(canonicalJson(rebound.payload), canonicalJson(qualified.payload), "rebinding changed executable payload");
    const deckInput = (d: typeof selected[number]) => ({ name: d.name, leader: d.deck.leader, main: d.deck.main, ...(d.deck.z?.length ? { z: d.deck.z } : {}) });
    for (const [i, pair] of [[0, 0], [0, 1], [1, 0], [1, 1]].entries()) {
      const [a, b] = pair, p1 = selected[a], p2 = selected[b];
      const key = `${input.key}-${a}v${b}`;
      const bundle: ReplayBundleRecord = { ...rebound, decks: { p1: deckInput(p1), p2: deckInput(p2) } };
      fixtures.push({ key, corpus: input.key, p1: p1.key, p2: p2.key, seedBase: input.seedBase, fixtureIndex: i, bundle,
        pin: fixturePin(key, bundle, protocol.runtimeRevision, { p1: p1.recipeId ?? null, p2: p2.recipeId ?? null }) });
    }
  }
  assert.equal(fixtures.length, 8); return fixtures;
}
