/**
 * The default engine after the flip, and the two things the flip must not
 * break (#166).
 *
 * `DEFAULT_ENGINE` is `rules` since 20 Sep 2026, which turns three quiet
 * assumptions into claims worth asserting:
 *
 *  1. **A new game with no choice made is on the rules engine.** The creation
 *     path's engine is `defaultEngine(db)` — the `arena.engine` setting, or
 *     the constant when nothing is stored — resolved against the mode by
 *     `engineForMode`. Both are asserted here against a settings table stood
 *     up by hand, because that is the whole of what `/arena`'s form action and
 *     `POST /api/v1/games` decide before they call `startGame`.
 *  2. **A mode the rules engine is not built for still works.** A 1 v 1's
 *     hidden-hand masking is legacy-only (#162). Before the flip that was a
 *     refusal nobody met by accident; after it, "a 1 v 1, engine unspecified"
 *     is the ordinary path, so it resolves to `FALLBACK_ENGINE` and carries
 *     the reason rather than throwing. An engine a caller *named* is still
 *     refused — `modeRefusal` is the one rule behind both.
 *  3. **Existing legacy games open unchanged.** A saved row's engine is read
 *     with `engineOr`, whose fallback is deliberately `FALLBACK_ENGINE` and
 *     not `DEFAULT_ENGINE`: a value that cannot be read is an old row, and
 *     every old state is legacy-shaped. A real legacy game is made, stored as
 *     a row would be, read back the way `loadGame` reads one, and played —
 *     the same moves, from the engine that wrote it.
 *
 * Engine-agnostic on purpose: like `vm` and `rulesets` it names the engines it
 * is asking about and ignores `harness.ts`'s `--engine`, since proving the
 * switch cannot depend on which side of it happens to be selected.
 *
 * Part of `npm test`; run from `scripts/verify-arena.ts`, which fixes the order.
 */
import assert from "node:assert/strict";
import type { Db } from "../../src/db";
import { createGame, legalActions } from "../../src/lib/arena/engine";
import { DEFAULT_ENGINE, ENGINE_INFO, FALLBACK_ENGINE, engineFor, engineOr, isVmState } from "../../src/lib/arena/engines";
import { defaultEngine } from "../../src/lib/arena/engine-setting";
import { engineForMode, modeRefusal, type ArenaMode } from "../../src/lib/arena/games";
import { CTX, fifty } from "./harness";

const MODES: ArenaMode[] = ["hotseat", "sparring", "tournament", "versus"];

// ── 1. the flip ────────────────────────────────────────────────────────────

assert.equal(DEFAULT_ENGINE, "rules", "the default engine is not the rules engine — #166 flipped it");
assert.equal(FALLBACK_ENGINE, "legacy", "the fallback engine is not the legacy one, which is the only engine built for every mode");
assert.equal(ENGINE_INFO[DEFAULT_ENGINE].available, true, "the default engine says it cannot play a game, which would strand every creation path");

// The two constants are now different questions and must not be re-conflated:
// one is what a new game gets, the other what an unreadable stored value means.
assert.notEqual(DEFAULT_ENGINE, FALLBACK_ENGINE, "the default and the fallback are the same engine again, so nothing below is actually being tested");

// ── 2. which modes each engine is built for ────────────────────────────────

// The fallback earns its name: it is refused for nothing.
for (const mode of MODES) assert.equal(modeRefusal(FALLBACK_ENGINE, mode), null, `the fallback engine is not built for ${mode}, so a mode the default cannot play has nowhere to go`);

for (const mode of MODES) {
  const why = modeRefusal("rules", mode);
  if (mode === "versus") assert.ok(why && why.includes(ENGINE_INFO.legacy.label), "a 1 v 1 on the rules engine is allowed, or does not say which engine plays it instead (#162)");
  else assert.equal(why, null, `the rules engine is refused for ${mode}, which #162 let through`);
}

// ── 3. the creation path, with no choice made ──────────────────────────────

/** Just enough `Db` for `defaultEngine`, which reads one settings row and nothing else. */
const settingsDb = (value: unknown): Db => ({ query: { settings: { findFirst: async () => (value === undefined ? undefined : { key: "arena", value }) } } }) as unknown as Db;

/**
 * `defaultEngine` is async, and a plain `.ts` file runs as CJS under `tsx`,
 * which has no top-level `await` — so this half is a promise `verify-arena.ts`
 * waits on (`export default` below), exactly as `ai-vm` does.
 */
async function creationPath(): Promise<void> {
  assert.equal(await defaultEngine(settingsDb(undefined)), "rules", "a database with no arena setting does not give a new game the rules engine");
  assert.equal(await defaultEngine(settingsDb({})), "rules", "an arena setting that names no engine does not fall back to the default");
  assert.equal(await defaultEngine(settingsDb({ engine: "nonsense" })), "rules", "an unreadable stored engine does not fall back to the default");
  // The setting is the way back, which is the reason it survived the flip.
  assert.equal(await defaultEngine(settingsDb({ engine: "legacy" })), "legacy", "the arena setting can no longer put new games back on the legacy engine");

  // What `/arena`'s form action and `POST /api/v1/games` do with that answer.
  for (const mode of ["hotseat", "sparring", "tournament"] as const) {
    const resolved = engineForMode(await defaultEngine(settingsDb(undefined)), mode);
    assert.equal(resolved.engine, "rules", `a new ${mode} game with no choice made is not on the rules engine`);
    assert.equal(resolved.note, null, `a new ${mode} game explains an engine it did not fall back from`);
  }

  // A 1 v 1 resolves rather than refusing: the default path never fails for a
  // reason the person creating the game did not choose.
  const versus = engineForMode(await defaultEngine(settingsDb(undefined)), "versus");
  assert.equal(versus.engine, "legacy", "a 1 v 1 with no choice made is not on the legacy engine, whose masking is the only one that keeps two hands hidden (#162)");
  assert.equal(versus.note, modeRefusal("rules", "versus"), "a 1 v 1 fell back to the legacy engine without saying why");

  // The setting's own answer is honoured for the modes it can be honoured for.
  assert.equal(engineForMode("legacy", "hotseat").engine, "legacy", "the setting's choice of the legacy engine was overridden by the default");
  assert.equal(engineForMode("legacy", "versus").engine, "legacy", "a 1 v 1 on the legacy engine was resolved to something else");
}

// ── 4. existing legacy games open unchanged ────────────────────────────────

// A row's engine, read as `loadGame` reads one. The fallback is what a row
// from before the column means, so it must stay legacy however the default
// moves — reading a legacy `GameState` with the rules engine's eyes is the
// failure this guards.
for (const stored of [null, undefined, "", "nonsense", 7]) {
  assert.equal(engineOr(stored), "legacy", `a saved game whose engine column reads ${JSON.stringify(stored)} would be opened on the ${engineOr(stored)} engine`);
}
assert.equal(engineOr("rules"), "rules", "a rules-engine row is not read back as one");
assert.equal(engineOr("legacy"), "legacy", "a legacy row is not read back as one");

const DECKS = { seed: 11, p1: { name: "You", leader: "L-RED", main: fifty("V1") }, p2: { name: "Claude", leader: "L-BLUE", main: fifty("V-BLUE") } };
const made = createGame(CTX, DECKS);
// The row as `arena_games` holds it: JSON state, and the engine that wrote it.
const row = JSON.parse(JSON.stringify({ engine: "legacy", state: made.state })) as { engine: string; state: unknown };

const engine = engineFor(engineOr(row.engine));
assert.equal(engine.id, "legacy", "a legacy-engine row no longer resolves to the legacy engine, so every saved game would be read by the wrong one");
assert.equal(isVmState(row.state), false, "a legacy state claims to have been written by the rules engine");
assert.deepEqual(
  engine.legalActions(CTX, row.state as never),
  legalActions(CTX, made.state),
  "a saved legacy game read back through the switch offers different moves than the engine that wrote it",
);

export default creationPath();
