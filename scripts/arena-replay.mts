#!/usr/bin/env node
/** Replay an admin-exported Arena bundle without a database or network. */
import fs from "node:fs";
import { replayOffline } from "../src/lib/arena/offline-replay.ts";
import type { Action } from "../src/lib/arena/types.ts";
import type { EngineId } from "../src/lib/arena/engines.ts";
import type { ReplayBundle, ReplayBundleRecord } from "../src/lib/arena/replay-bundle.ts";

function usage(): never {
  console.error("Usage: DATABASE_URL='' npm run arena:replay -- <export.json> --runtime-revision <sha>");
  process.exit(2);
}

const path = process.argv[2];
const flag = process.argv.indexOf("--runtime-revision");
const runtime = flag >= 0 ? process.argv[flag + 1] : process.env.ARENA_REPLAY_RUNTIME_REVISION;
if (!path || !runtime || !/^[0-9a-f]{7,40}$/i.test(runtime)) usage();

const data = JSON.parse(fs.readFileSync(path, "utf8")) as {
  exact?: boolean;
  seed?: number;
  engine?: EngineId;
  actions?: Action[];
  decks?: ReplayBundleRecord["decks"];
  bundle?: ReplayBundle;
};
if (!data.exact || !Number.isInteger(data.seed) || !data.engine || !Array.isArray(data.actions) || !data.decks || !data.bundle) {
  throw new Error("This export is labelled unpinned or is missing replay inputs; exact offline replay is unavailable.");
}

const replay = replayOffline({
  bundle: { ...data.bundle, decks: data.decks },
  engine: data.engine,
  seed: data.seed!,
  actions: data.actions,
  interpreterRevision: runtime,
});
process.stdout.write(`${JSON.stringify({ state: replay.state, events: replay.events, legalActions: replay.legalActions }, null, 2)}\n`);
