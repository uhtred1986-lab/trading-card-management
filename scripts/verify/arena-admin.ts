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
    { n: 1, t: "phase", phase: "main", player: "p1", turn: 3 },
    { n: 2, t: "say", text: "Hello" },
    { n: 3, t: "phase", phase: "battle", player: "p2", turn: 4 },
  ],
};
const story = foldStory([], beats, narrator, 9, () => "p2");
assert.deepEqual(story.map((l) => [l.n, l.turn]), [[1, 3], [2, 3], [3, 4]], "each line carries its turn");
assert.deepEqual(newestFirst(story).map((l) => l.n), [3, 2, 1], "newest first");
assert.equal(foldStory(story, beats, narrator, 9, () => "p2"), story, "a beat already recorded is not recorded twice");
assert.equal(foldStory(story, { ...beats, seq: 4, list: [...beats.list, { n: 4, t: "say", text: "Again" }] }, narrator, 9, () => "p2").length, 4, "only the new beat is added");

console.log("verify arena-admin: ok");
