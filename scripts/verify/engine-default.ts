/**
 * The rules engine is the only engine (#118).
 *
 * The legacy engine, the `engineFor` switch and the `arena.engine` setting are
 * gone (owner, 13 Oct 2026). What stays worth asserting:
 *
 *  1. **The id.** `rules` is the only engine id and the default, and its info
 *     names no availability switch.
 *  2. **A new game is a rules game.** A state the engine deals is recognised by
 *     its shape (`isVmState`), which is how a saved game is read now — the
 *     `arena_games.engine` column is written `rules` and never read.
 *  3. **A stray legacy row fails closed.** The cleanup migration (`0050`,
 *     `verify-db.mts`) deletes every game saved on the legacy engine; one that
 *     slipped through is refused by name (`LegacyGameRetired`) with a clear
 *     message, never read as a rules state.
 *
 * Part of `npm test`; run from `scripts/verify-arena.ts`, which fixes the order.
 */
import assert from "node:assert/strict";
import { DEFAULT_ENGINE, ENGINE_IDS, ENGINE_INFO, LegacyGameRetired, isVmState, rulesState } from "../../src/lib/arena/engines";
import { CTX, fifty, gameG } from "./harness";

// ── 1. the id ──────────────────────────────────────────────────────────────

assert.deepEqual([...ENGINE_IDS], ["rules"], "the rules engine is not the only engine id");
assert.equal(DEFAULT_ENGINE, "rules", "the default engine is not the rules engine");
assert.equal(ENGINE_INFO.rules.id, "rules");

// ── 2. a new game is a rules game ──────────────────────────────────────────

const made = gameG(11, fifty("V1"), fifty("V-BLUE"));
assert.equal(isVmState(made), true, "a freshly dealt game is not recognised as a rules state");
// A saved row is JSON: the shape survives the round trip, and `rulesState` hands it back.
const stored = JSON.parse(JSON.stringify(made)) as unknown;
assert.equal(isVmState(stored), true, "a stored rules state is not recognised after a JSON round trip");
assert.equal(rulesState(stored).turn, made.turn, "a stored rules state is not read back as itself");
assert.ok(CTX.defs["L-RED"], "the harness context lost its fixture cards");

// ── 3. a stray legacy row fails closed ─────────────────────────────────────

// What the legacy engine wrote had `players`/`prompt` at the top level and no `engine: "rules"` marker.
const legacyShaped = { seed: 11, turn: 3, turnPlayer: "p1", phase: "main", players: { p1: {}, p2: {} }, cards: {}, prompt: { kind: "main", player: "p1" } };
assert.equal(isVmState(legacyShaped), false, "a legacy-shaped state claims to have been written by the rules engine");
assert.throws(() => rulesState(legacyShaped), LegacyGameRetired, "a legacy-shaped state was read as a rules state");
assert.throws(() => rulesState(null), LegacyGameRetired, "a missing state was read as a rules state");
assert.throws(() => rulesState({ ...legacyShaped, engine: "legacy" }), /legacy engine, which has been retired/, "the refusal does not say why");
