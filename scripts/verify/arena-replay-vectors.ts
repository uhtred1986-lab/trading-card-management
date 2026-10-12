/**
 * Fixed replay-hash vectors (#640). Portable on purpose — it imports only `replay-core.ts` — so
 * the same file runs under Node (`arena-replay-core.ts`, in `npm test`) and bundled into a real
 * browser page (`arena-replay-core-browser.mts`).
 *
 * The expected hex strings were produced by the format-1 implementation that hashed with
 * `node:crypto` (origin/main at 096c4d6e, before the extraction). They are frozen: a change to
 * any of them means stored bundles would no longer validate.
 */
import type { CardDef } from "../../src/lib/arena/types";
import type { CardScripts } from "../../src/lib/arena/vm/script";
import type { CardArt } from "../../src/lib/arena/view";
import {
  assertInterpreterRevision,
  canonicalJson,
  makeReplayBundle,
  replayHash,
  validateReplayBundle,
  type ReplayBundle,
} from "../../src/lib/arena/replay-core";

export interface VectorResult { name: string; ok: boolean; actual: unknown; expected: unknown }

const RUNTIME = "a640000000000000000000000000000000000001";

/** Insertion order differs from the canonical UTF-16 order on purpose, at every level. */
function bundleInput(reordered: boolean) {
  const gokuDef = reordered
    ? { colors: ["red", "blue"], power: 15000, name: "Søn Gokû 😀", id: "BT1-001" }
    : { id: "BT1-001", name: "Søn Gokû 😀", power: 15000, colors: ["red", "blue"] };
  const defs = (reordered
    ? { "BT1-000": { id: "BT1-000", name: "Ä" }, "BT1-001": gokuDef }
    : { "BT1-001": gokuDef, "BT1-000": { name: "Ä", id: "BT1-000" } }) as unknown as Record<string, CardDef>;
  const op = reordered
    ? { target: { sel: { special: "self" } }, amount: 3000, op: "power" }
    : { op: "power", amount: 3000, target: { sel: { special: "self" } } };
  const scripts = { "BT1-001": { bySkill: [{ ops: [op] }] } } as unknown as Record<string, CardScripts>;
  const art = (reordered
    ? { "BT1-001": { imageUrl: null, name: "Søn Gokû 😀", cardId: "BT1-001" } }
    : { "BT1-001": { cardId: "BT1-001", name: "Søn Gokû 😀", imageUrl: null } }) as unknown as Record<string, CardArt>;
  const rulesetFiles = reordered
    ? { "game.rules": "# ü 😀\n", "zones.rules": "DEFINE ZONE hand\n  visibility: owner\n" }
    : { "zones.rules": "DEFINE ZONE hand\n  visibility: owner\n", "game.rules": "# ü 😀\n" };
  return { defs, scripts, art, rulesetFiles };
}

const EXPECTED = {
  unicode: "83df0f9e597b9c68bebfbbd5169e630d4110e02e9bc326c8fba681dd34b96323",
  nested: "3a3d26ec30b488d062e01d479fede3898f2da9cf176940c7c28c7372103e7980",
  rulesetHash: "182291028c74c41515fcf5d3c63bd1b02e153dce33c7628b3567269d475a1863",
  catalogHash: "31d71d6f3a32ba42a34fb1f3fcf177b19c0b9197df7ce2706247432e5aeb78fa",
  programsHash: "96f9f83a46797939cf749353ca732beecd435130c5b8e4d48b6bbcd2d285e7f1",
  pinnedHash: "f742d940830dc6fd2035a5ab112c1c641f743ecb84b64b0327627c95782cfc98",
  unpinnedHash: "c1f31ef4318fab181b7c9564ff96e6c1232e32ad7a12c0f52f3b2e65ca8f1b00",
};

/** A format-1 record exactly as `arena_rule_bundles` / an admin export would hold it. */
function storedRecord(): ReplayBundle {
  const { defs, scripts, art, rulesetFiles } = bundleInput(false);
  return {
    hash: EXPECTED.pinnedHash,
    format: 1,
    rulesetHash: EXPECTED.rulesetHash,
    catalogHash: EXPECTED.catalogHash,
    programsHash: EXPECTED.programsHash,
    runtimeRevision: RUNTIME,
    payload: { format: 1, rulesetFiles, defs, scripts, art },
  };
}

function throws(fn: () => void): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export async function runReplayVectors(): Promise<VectorResult[]> {
  const out: VectorResult[] = [];
  const check = (name: string, actual: unknown, expected: unknown) => out.push({ name, ok: actual === expected, actual, expected });

  check("canonical JSON sorts Unicode keys by UTF-16 code unit", canonicalJson({ "😀": 4, "ä": 3, a: 1, A: 2 }), '{"A":2,"a":1,"ä":3,"😀":4}');
  check("Unicode object keys", await replayHash({ "😀": 4, "ä": 3, a: 1, A: 2 }), EXPECTED.unicode);
  check("Unicode object keys, reordered", await replayHash({ A: 2, a: 1, "😀": 4, "ä": 3 }), EXPECTED.unicode);
  const nested = { z: [[3, { b: 1, a: [true, null, "ß"] }], []], "é": { y: [1.5, -0, " "] }, "\u0000k": "x", "😀": [{ "ñ": [] }] };
  const nestedReordered = { "😀": [{ "ñ": [] }], "\u0000k": "x", "é": { y: [1.5, -0, " "] }, z: [[3, { a: [true, null, "ß"], b: 1 }], []] };
  check("nested arrays and objects", await replayHash(nested), EXPECTED.nested);
  check("nested arrays and objects, reordered keys", await replayHash(nestedReordered), EXPECTED.nested);
  check("array order is significant", (await replayHash({ z: [[], [3]] })) === (await replayHash({ z: [[3], []] })), false);

  for (const reordered of [false, true]) {
    const tag = reordered ? ", reordered keys" : "";
    const pinned = await makeReplayBundle({ ...bundleInput(reordered), runtime: RUNTIME });
    check(`ruleset hash${tag}`, pinned.rulesetHash, EXPECTED.rulesetHash);
    check(`catalog hash${tag}`, pinned.catalogHash, EXPECTED.catalogHash);
    check(`program hash${tag}`, pinned.programsHash, EXPECTED.programsHash);
    check(`bundle hash, pinned runtime${tag}`, pinned.hash, EXPECTED.pinnedHash);
    const unpinned = await makeReplayBundle({ ...bundleInput(reordered), runtime: null });
    check(`bundle hash, unpinned runtime${tag}`, unpinned.hash, EXPECTED.unpinnedHash);
  }

  const record = storedRecord();
  check("stored format-1 record validates", await validateReplayBundle(record), true);
  check("stored format-1 record survives a JSON round trip", await validateReplayBundle(JSON.parse(JSON.stringify(record))), true);
  const tampered = structuredClone(record);
  (tampered.payload.defs["BT1-001"] as unknown as { name: string }).name = "Tampered";
  check("tampered catalog fails", await validateReplayBundle(tampered), false);
  const tamperedRules = structuredClone(record);
  tamperedRules.payload.rulesetFiles["zones.rules"] += " ";
  check("tampered ruleset fails", await validateReplayBundle(tamperedRules), false);
  const tamperedProgram = structuredClone(record);
  (tamperedProgram.payload.scripts["BT1-001"] as unknown as { bySkill: { ops: { amount: number }[] }[] }).bySkill[0].ops[0].amount = 5000;
  check("tampered program fails", await validateReplayBundle(tamperedProgram), false);
  check("swapped runtime revision fails", await validateReplayBundle({ ...record, runtimeRevision: "b640000000000000000000000000000000000001" }), false);
  check("malformed runtime revision fails", await validateReplayBundle({ ...record, runtimeRevision: "not-a-sha" }), false);
  check("unknown format fails", await validateReplayBundle({ ...record, format: 2 as 1 }), false);
  check("missing payload fails", await validateReplayBundle({ ...record, payload: undefined as unknown as ReplayBundle["payload"] }), false);

  check("matching interpreter revision is accepted", throws(() => assertInterpreterRevision(record, RUNTIME)), null);
  check("mismatched interpreter revision is refused", throws(() => assertInterpreterRevision(record, "b640000000000000000000000000000000000001")), "interpreter provenance is missing or does not match this replay runtime");
  check("missing local interpreter revision is refused", throws(() => assertInterpreterRevision(record, null)), "interpreter provenance is missing or does not match this replay runtime");
  check("unpinned bundle is refused", throws(() => assertInterpreterRevision({ runtimeRevision: null }, RUNTIME)), "interpreter provenance is missing or does not match this replay runtime");
  return out;
}
