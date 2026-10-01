/**
 * `isArenaAdmin` (issue #350): who sees the arena's engine internals.
 *
 * The decision is `isAdminUser` in `src/lib/auth/admin.ts`, pure so it needs no
 * request and no database; `isArenaAdmin()` only feeds it the real login and
 * environment. Part of `npm test`.
 */
import assert from "node:assert/strict";
import { basicAuthOn, isAdminUser, parseAdmins } from "../../src/lib/auth/admin";
import { foldStory, newestFirst } from "../../src/lib/arena/story";
import type { Beats } from "../../src/lib/arena/beats";
import { CTX, fifty } from "./harness";
import { engineFor, type EngineId } from "../../src/lib/arena/engines";
import type { Action } from "../../src/lib/arena/types";
import { replayForReview } from "../../src/lib/arena/review";
import { cleanNote } from "../../src/lib/arena/review-store";

const ON = { BASIC_AUTH_USER: "owner", BASIC_AUTH_PASSWORD: "pw" };

// ARENA_ADMINS unset, auth on: nobody is admin — not even the env login.
assert.equal(isAdminUser("owner", { ...ON }), false, "unset list: nobody is admin");
assert.equal(isAdminUser("owner", { ...ON, ARENA_ADMINS: "" }), false, "empty list: nobody is admin");
assert.equal(isAdminUser("owner", { ...ON, ARENA_ADMINS: " , ," }), false, "a list of blanks names nobody");

// Listed, unlisted; trimmed, case-insensitive.
const env = { ...ON, ARENA_ADMINS: " Owner , sam " };
assert.equal(isAdminUser("owner", env), true, "listed user");
assert.equal(isAdminUser("OWNER", env), true, "case-insensitive");
assert.equal(isAdminUser("sam", env), true, "trimmed entries");
assert.equal(isAdminUser("guest", env), false, "unlisted user");
assert.equal(isAdminUser("ow", env), false, "no partial matches");
assert.equal(isAdminUser(null, env), false, "auth on and nobody named is not admin");

// Basic Auth off (local dev): everyone is the owner, list or no list.
assert.equal(isAdminUser(null, {}), true, "auth off: admin");
assert.equal(isAdminUser(null, { ARENA_ADMINS: "sam" }), true, "auth off: admin even when a list is set");
assert.equal(isAdminUser(null, { BASIC_AUTH_USER: "owner" }), true, "only one of the pair set: the proxy is off");

// A login that came through the users table (no env pair) is still a login: listed or not.
assert.equal(isAdminUser("guest", { ARENA_ADMINS: "sam" }), false, "a named login with no env pair is checked against the list");
assert.equal(isAdminUser("sam", { ARENA_ADMINS: "sam" }), true);

assert.deepEqual(parseAdmins(" A, b ,,C "), ["a", "b", "c"]);
assert.equal(basicAuthOn(ON), true);
assert.equal(basicAuthOn({ BASIC_AUTH_USER: "x" }), false);

// The narration log: newest first, under turn numbers, each beat recorded once.
const narrator = { viewer: "p1" as const, them: "Claude", art: {} };
const beats: Beats = {
  seq: 3,
  art: {},
  list: [
    // #463: a turn beginning is the phase beat the table still hears.
    { n: 1, t: "phase", phase: "charge", player: "p1", turn: 3 },
    { n: 2, t: "say", text: "Hello" },
    { n: 3, t: "phase", phase: "charge", player: "p2", turn: 4 },
  ],
};
const story = foldStory([], beats, narrator, 9, () => "p2");
assert.deepEqual(story.map((l) => [l.n, l.turn]), [[1, 3], [2, 3], [3, 4]], "each line carries its turn");
assert.deepEqual(newestFirst(story).map((l) => l.n), [3, 2, 1], "newest first");
assert.equal(foldStory(story, beats, narrator, 9, () => "p2"), story, "a beat already recorded is not recorded twice");
assert.equal(foldStory(story, { ...beats, seq: 4, list: [...beats.list, { n: 4, t: "say", text: "Again" }] }, narrator, 9, () => "p2").length, 4, "only the new beat is added");
// A beat with nothing to say must not produce a new list, or the board, which
// sets state whenever the fold differs, would re-render without end.
const silent = { ...beats, seq: 5, list: [...beats.list, { n: 5, t: "no-such-beat" } as unknown as Beats["list"][number]] };
assert.equal(foldStory(story, silent, narrator, 9, () => "p2"), story, "a silent beat keeps the same list");

// The match review (#351): a game is replayed from its seed and actions through the
// Engine interface, with no new engine code: the board at the start of a turn and
// each move's menu come out of the same calls the saved-game layer makes.
for (const id of ["legacy", "rules"] as EngineId[]) {
  const options = { seed: 11, p1: { name: "Player", leader: "L-RED", main: fifty("V1") }, p2: { name: "Claude", leader: "L-BLUE", main: fifty("V-BLUE") } };
  const eng = engineFor(id);
  let { state } = eng.createGame(CTX, options);
  const actions: Action[] = [];
  // The first legal move each time, ending the turn as soon as the menu allows, until turn 4.
  for (let i = 0; i < 400 && state.turn < 4 && state.phase !== "over"; i++) {
    const legal = eng.legalActions(CTX, state);
    const pick = legal.find((l) => l.action.type === "endMain" || l.action.type === "pass") ?? legal[0];
    actions.push(pick.action);
    state = eng.apply(CTX, state, pick.action).state;
  }
  const names = { p1: "Player", p2: "Claude" } as const;
  const decision = { turn: 3, player: "p1", kind: "move", decidedBy: "claude", how: "because", model: "m", chosenLabel: "never matches", say: null, inputTokens: 1, outputTokens: 2, latencyMs: 3 };
  const run = (decisions: (typeof decision)[], turn?: number, acts = actions) => replayForReview({ engine: id, ctx: CTX, options, actions: acts, decisions, images: {}, names, turn });
  const r = run([decision], 3);
  assert.equal(r.drift, null, `${id}: the replay reaches the end of the log`);
  assert.ok(r.turns.length >= 3 && r.turns.includes(3), `${id}: the game's turns are listed`);
  assert.equal(r.turn, 3);
  assert.equal(r.board?.turn, 3, `${id}: the board is the one at the start of turn 3`);
  assert.ok(r.beats.length > 0, `${id}: the turn has moves`);
  assert.ok(r.beats.every((b, i) => b.turn === 3 && b.index === r.beats[0].index + i && b.n === b.index + 1), `${id}: moves are contiguous, numbered from the log`);
  assert.ok(r.beats.every((b) => b.chosenIndex !== null && b.offered[b.chosenIndex] === b.label), `${id}: every saved move is on the replayed menu and is the one picked`);
  assert.ok(r.beats.every((b) => b.decision === null), `${id}: a decision whose label matches nothing is attached to nothing`);
  // A recorded decision whose label is a move's menu label lands on that move.
  const first = r.beats[0];
  const again = run([{ ...decision, player: first.player, chosenLabel: first.label }], 3);
  assert.equal(again.beats[0].decision?.how, "because", `${id}: a matching decision is attached`);
  // The default turn is the game's last; an unknown one falls back to it rather than to nothing.
  assert.equal(run([]).turn, r.turns[r.turns.length - 1]);
  assert.equal(run([], 99).turn, r.turns[r.turns.length - 1]);
  // An action the engine refuses stops the replay and says so, keeping what came before.
  const bad = run([], undefined, [...actions.slice(0, 5), { type: "attack", player: "p2", attacker: "nope", target: "nope" }]);
  assert.match(bad.drift ?? "", /move 6 is refused/, `${id}: a refused move is named`);
}
assert.equal(cleanNote("  "), null, "a blank note is no note");
assert.equal(cleanNote(" a\n  b "), "a b", "a note is one line");

console.log("verify arena-admin: ok");
