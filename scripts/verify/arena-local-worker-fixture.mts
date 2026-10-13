/**
 * #652: the packs the local worker proofs play, built from the committed catalog snapshot like
 * `arena-offline-pack.mts` builds them (no database, no network).
 *
 *  - `stagedPack()`: the audited SD15/SD5 pair (#649/#655) with every audit blocker marked resolved,
 *    the owner's missing specified costs supplied and the unread-clause lists emptied, so it
 *    qualifies on `LOCAL_REVISION`. TEST-ONLY: the real pack is not playable, and this one exists to
 *    drive the protocol through real cards. It is the construction `arena-offline-pack.mts` calls
 *    "staged".
 *  - `auditPack()`: the real pack as built today — valid, and refused by the worker as unplayable.
 */
import { mastersPackInput, buildMastersPack } from "../build-arena-offline-pack.mts";
import { makeOfflinePack, type OfflinePack } from "../../src/lib/arena/local/pack.ts";
import { LOCAL_REVISION } from "./arena-local-worker-driver.ts";

export { GAME_ID, LOCAL_POLICY_SEED, LOCAL_REVISION, LOCAL_SEED, OTHER_REVISION } from "./arena-local-worker-driver.ts";

export async function stagedPack(): Promise<OfflinePack> {
  const input = await mastersPackInput({ runtimeRevision: LOCAL_REVISION, specifiedCosts: { "SD15-02": "{r}{r}", "DB3-001": "{r}{r}" } });
  input.blockers = input.blockers.map((b) => ({ ...b, status: "resolved" as const }));
  for (const key of Object.keys(input.scripts)) input.scripts[key] = { ...input.scripts[key], unsupported: [] };
  const pack = await makeOfflinePack(input);
  if (!pack.qualification.playable) throw new Error(`the staged pack does not qualify: ${pack.qualification.reasons.join("; ")}`);
  return pack;
}

export function auditPack(): Promise<OfflinePack> {
  return buildMastersPack({ runtimeRevision: LOCAL_REVISION });
}

/** The audited pack with the owner's Unison specified costs (#733) withheld: a missing input again. */
export function withheldCostsPack(): Promise<OfflinePack> {
  return buildMastersPack({ runtimeRevision: LOCAL_REVISION, specifiedCosts: {} });
}
