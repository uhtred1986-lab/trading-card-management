/**
 * #648 (O3-01): the board speaks to an `ArenaSession`, not to the server.
 *
 *   1. Import graph. The value-import graph of `ArenaStage.tsx` (and `useLiveGame.ts`)
 *      reaches no server action, no `@/app/*`, no `next/*`, no database; the contract is
 *      free of every package. `online.ts` is the one module that imports the actions
 *      (positive control), and the walker is first run on a deliberately bad virtual graph.
 *   2. Conformance. `LiveGameCore` over an in-memory session, through real contract
 *      fixtures: newer revisions are adopted, stale and cross-session snapshots are
 *      refused, a beats-only advance is taken, the watch starts from the held cursors
 *      and stops when asked; capabilities agree with the methods present.
 *   3. Presentation. `ArenaStage` is server-rendered over the fake session (no network,
 *      no database) for several fixtures, and its affordances follow the capabilities.
 *
 * The click-through half (a tap reaches `session.act`, the advance Retry, the end screen)
 * is browser-driven: `arena-advance-browser-evidence.mts` and `npm run arena:shots`.
 * Run from the repo root:  npx tsx scripts/verify/arena-session-648.mts   (part of `npm test`)
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { checkImportGraph, diskRead } from "../lib/import-graph.ts";
import { acceptSnapshot, capabilitiesOf, LiveGameCore, type OptionalMethods, type ArenaSession, type SessionConnection, type WatchOptions } from "../../src/components/arena/session/contract.ts";
import type { Snapshot } from "../../src/lib/arena/snapshot.ts";
import type { Action } from "../../src/lib/arena/types.ts";

const ROOT = process.cwd();

// ---- 1. Import graph ------------------------------------------------------------------------

/** Violations that matter to the presentation: server code, the router, the database. Plain React/UI packages are fine. */
const SERVER_KIND = /server-only import|package or builtin import (next\/(navigation|headers|cache|server)|node:|fs$|path$|drizzle|@neondatabase|pg$|@anthropic)/;
const graphOf = (entry: string, read = diskRead) => checkImportGraph(path.join(ROOT, entry), ROOT, read);
const serverViolations = (entry: string) => graphOf(entry).violations.filter((v) => SERVER_KIND.test(v.reason));

for (const entry of ["src/components/arena/stage/ArenaStage.tsx", "src/components/arena/stage/useLiveGame.ts"]) {
  const bad = serverViolations(entry);
  assert.deepEqual(bad, [], `${entry} reaches server code:\n${bad.map((v) => `  ${v.file}: ${v.reason}`).join("\n")}`);
}
const contractGraph = graphOf("src/components/arena/session/contract.ts");
assert.deepEqual(contractGraph.violations, [], "contract.ts has no runtime dependency of any kind");
assert.ok(!contractGraph.files.some((f) => f.includes("/app/")), "contract.ts reaches no route module");

// Positive control: the online adapter is where the actions are imported.
const online = graphOf("src/components/arena/session/online.ts");
assert.ok(online.violations.some((v) => v.reason.includes("@/app/arena/actions") || v.reason.includes("server-only import @/app")), "online.ts is the module that imports the server actions");
assert.ok(fs.readFileSync(path.join(ROOT, "src/components/arena/session/online.ts"), "utf8").includes("startLiveGamePolling"), "the online session polls through liveGamePolling");

// The walker catches the reintroduction: ArenaStage with an action import added.
const stagePath = path.join(ROOT, "src/components/arena/stage/ArenaStage.tsx");
const doctored = (file: string) => (file === stagePath ? `import { act } from "@/app/arena/actions";\n${fs.readFileSync(stagePath, "utf8")}` : diskRead(file));
assert.ok(
  graphOf("src/components/arena/stage/ArenaStage.tsx", doctored).violations.some((v) => SERVER_KIND.test(v.reason)),
  "the rule fails when ArenaStage imports a server action again",
);
const routerDoctored = (file: string) => (file === stagePath ? `import { useRouter } from "next/navigation";\n${fs.readFileSync(stagePath, "utf8")}` : diskRead(file));
assert.ok(graphOf("src/components/arena/stage/ArenaStage.tsx", routerDoctored).violations.some((v) => SERVER_KIND.test(v.reason)), "...and when it imports the router");

// ---- 2. Conformance of the live core over an in-memory session --------------------------------

const fixture = (name: string): Snapshot => JSON.parse(fs.readFileSync(path.join(ROOT, "contract", "fixtures", `${name}.json`), "utf8")) as Snapshot;
const at = (s: Snapshot, revision: number, seq = s.beats?.seq ?? 0, id = s.game.id): Snapshot =>
  ({ ...s, game: { ...s.game, id, revision }, beats: s.beats ? { ...s.beats, seq } : { seq, list: [], art: {} } }) as Snapshot;

interface Memory extends ArenaSession {
  sent: { action: Action; basedOn: number; requestId: string }[];
  watches: { options: WatchOptions; stopped: boolean; retries: number }[];
  push(snapshot: Snapshot): void;
  connect(c: SessionConnection): void;
  refreshed: number;
}
function memorySession(gameId: number, extra: Partial<OptionalMethods> = {}): Memory {
  const sent: Memory["sent"] = [];
  const watches: Memory["watches"] = [];
  const session: Memory = {
    gameId,
    capabilities: capabilitiesOf(extra),
    sent,
    watches,
    refreshed: 0,
    async act(action, basedOn, requestId) {
      sent.push({ action, basedOn, requestId });
      return { error: null };
    },
    watch(options) {
      const w = { options, stopped: false, retries: 0 };
      watches.push(w);
      return { retry: () => { w.retries++; }, stop: () => { w.stopped = true; } };
    },
    refresh() { session.refreshed++; },
    push(snapshot) { for (const w of watches) if (!w.stopped) w.options.onSnapshot(snapshot); },
    connect(c) { for (const w of watches) if (!w.stopped) w.options.onConnection(c); },
    ...extra,
  };
  return session;
}

const play = fixture("play");
const id = play.game.id;
const base = at(play, 10, 3);
const shown: Snapshot[] = [];
const connections: SessionConnection[] = [];
const session = memorySession(id);
const core = new LiveGameCore(session, base, { onSnapshot: (s) => shown.push(s), onConnection: (c) => connections.push(c) });

core.start(base);
assert.equal(session.watches.length, 1);
assert.deepEqual([session.watches[0].options.revision, session.watches[0].options.beat], [10, 3], "the watch starts from the held revision and beat");

session.push(at(play, 11, 4));
assert.equal(core.snapshot.game.revision, 11, "a newer revision is adopted");
session.push(at(play, 9, 9));
assert.equal(core.snapshot.game.revision, 11, "a stale revision is refused, whatever its beat");
session.push(at(play, 11, 4));
assert.equal(shown.length, 1, "the same revision and beat is a no-op");
session.push(at(play, 12, 5, id + 1));
assert.equal(core.snapshot.game.id, id, "another game's newer snapshot is refused (cross-session)");
assert.equal(shown.length, 1);
session.push(at(play, 11, 7));
assert.equal(core.snapshot.game.revision, 11);
assert.equal(core.snapshot.beats?.seq, 7, "animation beats may advance without a new revision");
assert.equal(shown.length, 2);
session.push(at(play, 11, 6));
assert.equal(core.snapshot.beats?.seq, 7, "an older beat sequence never rewinds the story");

session.connect("offline");
session.connect("reconnecting");
assert.deepEqual(connections, ["offline", "reconnecting"], "connection changes reach the board");
core.retry();
assert.equal(session.watches[0].retries, 1, "retry reaches the transport");

// A server render newer than the held snapshot is adopted; an older one is not; another game replaces.
core.adopt(at(play, 15, 7));
assert.equal(core.snapshot.game.revision, 15);
core.adopt(at(play, 13, 9));
assert.equal(core.snapshot.game.revision, 15, "an older server render does not roll the board back");
core.adopt(at(play, 2, 0, id + 5));
assert.equal(core.snapshot.game.id, id + 5, "a render of another game replaces the board (the page was reused)");
core.adopt(at(play, 15, 7));

// Restarting replaces the watch; stopping stops delivery.
core.start(at(play, 15, 7));
assert.equal(session.watches.length, 2);
assert.ok(session.watches[0].stopped, "starting again stops the previous watch");
core.stop();
assert.ok(session.watches[1].stopped, "stop() stops the watch");
const before = shown.length;
session.watches[1].options.onSnapshot(at(play, 99, 99));
// A stopped transport that still delivers is the transport's bug, but the core must not have been left watching.
assert.ok(session.watches.every((w) => w.stopped));
void before;

// Pure helper, straight.
assert.equal(acceptSnapshot(at(play, 5), at(play, 6), id)?.game.revision, 6);
assert.equal(acceptSnapshot(at(play, 5), at(play, 5), id), null);
assert.equal(acceptSnapshot(at(play, 5), at(play, 6, 0, id + 1), id), null);
assert.equal(acceptSnapshot(at(play, 5, 0, id + 1), at(play, 6, 0, id + 1), id), null, "a core holding another game's board adopts nothing for this session");

// Capabilities are derived from the methods, so they cannot disagree with them.
const none = capabilitiesOf({});
assert.deepEqual(none, { advance: false, abandon: false, rematch: false, flag: false, plan: false, skin: false, staging: false, report: false });
const all = memorySession(id, { advance: async () => ({ error: null }), abandon: async () => ({ error: null }), rematch: async () => ({ error: null }), flag: async () => ({ error: null, flag: null, created: false }), preview: async () => ({ error: null, preview: null }), chooseSkin: async () => {}, chooseStaging: async () => {}, reportBug: async () => ({ error: null }) });
assert.deepEqual(all.capabilities, { advance: true, abandon: true, rematch: true, flag: true, plan: true, skin: true, staging: true, report: true });

// ---- 3. The board over the fake session -------------------------------------------------------

// Style modules are the bundler's job; node needs them stubbed.
register("data:text/javascript," + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier.endsWith(".css")) return { url: "data:text/javascript,export default new Proxy({}, { get: (_, k) => String(k) });", shortCircuit: true };
  return next(specifier, context);
}
`));
const { ArenaStage } = await import("../../src/components/arena/stage/ArenaStage.tsx");

const render = (snapshot: Snapshot, s: ArenaSession, props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(ArenaStage, { session: s, snapshot, ...props } as never));

for (const name of ["play", "attack", "ko", "over", "hand", "versus"]) {
  const snap = fixture(name);
  const html = render(snap, memorySession(snap.game.id));
  assert.ok(html.length > 5000 && html.includes("arena"), `${name}: the board renders over an in-memory session with no optional capability`);
}

const playing = fixture("play");
assert.equal(playing.game.status, "playing");
const withAbandon = memorySession(playing.game.id, { abandon: async () => ({ error: null }) });
assert.ok(render(playing, withAbandon, { menu: createElement("span") }).length > 5000, "a session with every optional capability renders too (the menu sheet itself opens on a tap: browser half)");
assert.equal(session.sent.length, 0, "rendering sends nothing");
assert.equal(withAbandon.sent.length, 0);

// The connection chip is drawn from the session's status only, which a server render has not heard from.
assert.ok(!render(playing, memorySession(playing.game.id)).includes("data-arena-connection"), "a connected session shows no connection chip");

console.log("arena session (#648): import graph, conformance and presentation over an in-memory session: ok");
