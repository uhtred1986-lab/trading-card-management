#!/usr/bin/env node
/** Replay an admin-exported Arena bundle without a database or network. */
import fs from "node:fs";
import { replayOffline } from "../src/lib/arena/offline-replay.ts";
import type { Action } from "../src/lib/arena/types.ts";
import type { EngineId } from "../src/lib/arena/engine-ids.ts";
import { replayHash, type ReplayBundle, type ReplayBundleRecord } from "../src/lib/arena/replay-core.ts";

function usage(): never {
  console.error("Usage: DATABASE_URL='' npm run arena:replay -- <export.json> --runtime-revision <sha> [--summary] [--output <result.json>]");
  process.exit(2);
}

const argv = process.argv.slice(2);
const inputPath = argv[0];
const valueFlag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const value = argv[i + 1];
  if (!value || value.startsWith("--")) usage();
  return value;
};
const runtime = valueFlag("--runtime-revision") ?? process.env.ARENA_REPLAY_RUNTIME_REVISION;
const outputPath = valueFlag("--output");
const summary = argv.includes("--summary");
for (const arg of argv) {
  if (arg.startsWith("--") && !["--runtime-revision", "--output", "--summary"].includes(arg)) usage();
}
if (!inputPath || inputPath.startsWith("--") || !runtime || !/^[0-9a-f]{7,40}$/i.test(runtime)) usage();

const data = JSON.parse(fs.readFileSync(inputPath, "utf8")) as {
  exact?: boolean;
  seed?: number;
  engine?: EngineId | "legacy";
  actions?: Action[];
  decks?: ReplayBundleRecord["decks"];
  bundle?: ReplayBundle;
};
if (data.engine && data.engine !== "rules") {
  throw new Error("This export was made on the retired legacy engine; only rules-engine games can be replayed (#118).");
}
if (!Number.isInteger(data.seed) || !data.engine || !Array.isArray(data.actions) || !data.decks || !data.bundle) {
  throw new Error("This export is unpinned or missing replay inputs; exact offline replay is unavailable.");
}

const replay = await replayOffline({
  bundle: { ...data.bundle, decks: data.decks },
  seed: data.seed!,
  actions: data.actions,
  interpreterRevision: runtime,
});
const result = { state: replay.state, events: replay.events, legalActions: replay.legalActions };
const serialized = `${JSON.stringify(result, null, 2)}\n`;

if (outputPath) fs.writeFileSync(outputPath, serialized);
if (summary) {
  const eventTypes = Object.fromEntries([...new Set(replay.events.map((event) => event.type))].sort().map((type) => [type, replay.events.filter((event) => event.type === type).length]));
  const legalActionTypes = [...new Set(replay.legalActions.map((legal) => legal.action.type))].sort();
  const [stateHash, eventsHash, legalActionsHash] = await Promise.all([
    replayHash(replay.state),
    replayHash(replay.events),
    replayHash(replay.legalActions),
  ]);
  process.stdout.write(`${JSON.stringify({
    engine: "rules",
    seed: data.seed,
    runtimeRevision: runtime,
    actionCount: data.actions.length,
    state: { phase: replay.state.phase, turn: replay.state.turn, turnPlayer: replay.state.turnPlayer },
    eventCount: replay.events.length,
    eventTypes,
    legalActionCount: replay.legalActions.length,
    legalActionTypes,
    hashes: { state: stateHash, events: eventsHash, legalActions: legalActionsHash },
    ...(outputPath ? { output: outputPath } : {}),
  })}\n`);
} else if (outputPath) {
  process.stdout.write(`${JSON.stringify({ output: outputPath })}\n`);
} else {
  process.stdout.write(serialized);
}
