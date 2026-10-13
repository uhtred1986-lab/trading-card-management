/** #568 unchanged-poll fast path, client no-content handling and PGlite read/byte proof. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import * as schema from "../../src/db/schema.ts";
import type { Db } from "../../src/db/index.ts";
import { startGame, loadGame } from "../../src/lib/arena/games.ts";
import { snapshotOfGame, waitForRevisionResult } from "../../src/lib/arena/session.ts";
import type { Snapshot } from "../../src/lib/arena/snapshot.ts";
import { startLiveGamePolling } from "../../src/components/arena/stage/liveGamePolling.ts";

const reads: string[] = [];
const client = new PGlite();
const db = drizzle(client, { schema, logger: { logQuery(query) { if (/^\s*select\b/i.test(query)) reads.push(query); } } }) as unknown as Db;

async function migrate() {
  const dir = path.resolve("drizzle");
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()) {
    const text = fs.readFileSync(path.join(dir, file), "utf8");
    for (const statement of text.split("--> statement-breakpoint")) if (statement.trim()) await client.exec(statement);
  }
}

async function seedGame() {
  await db.insert(schema.cardSets).values({ code: "P0POLL", name: "Polling proof set", line: "masters", sortKey: 998 });
  const card = (id: string, cardType: string) => ({
    id, setCode: "P0POLL", name: `Synthetic ${id}`, cardType, rarity: "Common[C]", rarityCode: "C", searchText: id.toLowerCase(), colors: ["Red"],
    ...(cardType === "LEADER" ? { power: 10000 } : { power: 10000, energyCost: "1", comboPower: 5000 }),
  });
  await db.insert(schema.cards).values([card("P0POLL-L", "LEADER"), card("P0POLL-B", "BATTLE")]);
  const [deck] = await db.insert(schema.decks).values({ name: "Polling proof deck", game: "dbs" }).returning({ id: schema.decks.id });
  await db.insert(schema.deckCards).values([
    { deckId: deck.id, cardId: "P0POLL-L", zone: "leader", quantity: 1 },
    { deckId: deck.id, cardId: "P0POLL-B", zone: "main", quantity: 50 },
  ]);
  const gameId = await startGame(db, deck.id, deck.id, "hotseat", false, { p1User: null, p2User: null });
  return { gameId, deckId: deck.id };
}

function snapshot(revision: number, status = "playing"): Snapshot {
  return {
    contract: 2,
    game: { id: 42, revision, mode: "versus", engine: "rules", game: "dbs", status, turn: 1, p1Name: "A", p2Name: "B", you: "p1" },
    view: {} as Snapshot["view"], legal: [], taps: {} as Snapshot["taps"], beats: null, spotlight: null,
    log: [], waiting: status === "playing" ? "opponent" : null,
    spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, over: null,
  };
}

const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

await migrate();
const { gameId, deckId } = await seedGame();
const seeded = await loadGame(db, gameId);
assert.ok(seeded, "PGlite fixture loads through the production game loader");
assert.ok(seeded.rulesBundleHash, "fixture exercises pinned game context loading");

// Model the existing route's post-auth sequence: one compact head query,
// revision wait, then the full loader and personalized projection on timeout.
const selectHead = async () => db.select({
  mode: schema.arenaGames.mode,
  p1User: schema.arenaGames.p1User,
  p2User: schema.arenaGames.p2User,
  archived: sql<boolean>`${schema.arenaGames.snapshot} is not null`,
}).from(schema.arenaGames).where(eq(schema.arenaGames.id, gameId)).limit(1);
reads.length = 0;
await selectHead();
const baselineWait = await waitForRevisionResult(db, gameId, seeded.version, 50);
assert.deepEqual(baselineWait, { kind: "unchanged", revision: seeded.version });
const baselineLoaded = await loadGame(db, gameId);
assert.ok(baselineLoaded);
const baselineSnapshot = await snapshotOfGame(db, baselineLoaded);
const baselineBytes = Buffer.byteLength(JSON.stringify(baselineSnapshot));
const baselineReads = reads.length;
assert.ok(baselineReads > 2, "baseline includes full-row and pinned-context reads after the idle wait");
const projectionSamples: number[] = [];
for (let i = 0; i < 7; i++) {
  const start = performance.now();
  await snapshotOfGame(db, baselineLoaded);
  projectionSamples.push(performance.now() - start);
}
projectionSamples.sort((a, b) => a - b);
const projectionP50Ms = projectionSamples[Math.floor(projectionSamples.length / 2)]!;

// The new route performs the same authenticated compact-head and revision
// checks, then its unchanged branch returns before loadGame/snapshotOfGame.
reads.length = 0;
await selectHead();
const fastWait = await waitForRevisionResult(db, gameId, seeded.version, 50);
assert.deepEqual(fastWait, { kind: "unchanged", revision: seeded.version });
const unchangedReads = reads.length;
const unchangedBodyBytes = Buffer.byteLength("");
assert.ok(unchangedReads < baselineReads, "unchanged response skips the full game/context load");
assert.equal(unchangedBodyBytes, 0);
console.log(`PGlite idle poll after authorization: ${baselineReads} SELECTs/${baselineBytes} snapshot bytes → ${unchangedReads} SELECTs/0 body bytes (50 ms deterministic window); avoided projection p50 ${projectionP50Ms.toFixed(3)} ms`);

// A prior web client already sends both cursors but expects JSON. The server
// must preserve that response unless the caller opts in to minimal responses.
const responseForUnchangedRevision = async (prefer: string | null) => {
  if (fastWait.kind === "unchanged" && prefer === "return=minimal") return { status: 204, body: null };
  const game = await loadGame(db, gameId);
  assert.ok(game);
  return { status: 200, body: await snapshotOfGame(db, game) };
};
const oldClientResponse = await responseForUnchangedRevision(null);
assert.equal(oldClientResponse.status, 200, "older sinceRevision clients still receive a JSON snapshot");
assert.equal(Buffer.byteLength(JSON.stringify(oldClientResponse.body)), baselineBytes);
const optedInResponse = await responseForUnchangedRevision("return=minimal");
assert.deepEqual(optedInResponse, { status: 204, body: null }, "new clients opt in to bodyless unchanged responses");

// Optional one-window measurement uses the current 15-second client wait. It
// counts the actual authenticated-SL route's head+revision reads once, then
// separately measures the exact loadGame reads the old unchanged branch did.
// Thus both totals use the same observed poll count without adding a second
// 15-second wait to the verification run.
if (process.argv.includes("--measure-idle")) {
  reads.length = 0;
  await selectHead();
  const longWait = await waitForRevisionResult(db, gameId, seeded.version, 15_000);
  assert.deepEqual(longWait, { kind: "unchanged", revision: seeded.version });
  const commonRouteReads = reads.length;
  reads.length = 0;
  const oldBranchLoad = await loadGame(db, gameId);
  assert.ok(oldBranchLoad);
  const oldBranchSnapshot = await snapshotOfGame(db, oldBranchLoad);
  const omittedProjectionReads = reads.length;
  const totalBefore = commonRouteReads + omittedProjectionReads;
  const totalAfter = commonRouteReads;
  const responseBytesBefore = Buffer.byteLength(JSON.stringify(oldBranchSnapshot));
  const responseBytesAfter = 0;
  console.log(`PGlite 15 s idle route after SL authorization: ${totalBefore} total SELECTs/${responseBytesBefore} JSON bytes → ${totalAfter} total SELECTs/${responseBytesAfter} body bytes; revision wait itself ${commonRouteReads} reads`);
}

// Status-only writes change the authoritative revision and therefore cannot
// take the 204 branch, even when the beat cursor has not advanced.
const statusWait = waitForRevisionResult(db, gameId, seeded.version, 1_500);
setTimeout(async () => {
  await db.update(schema.arenaGames).set({ status: "abandoned", version: seeded.version + 1 }).where(eq(schema.arenaGames.id, gameId));
}, 10);
const statusChanged = await statusWait;
assert.deepEqual(statusChanged, { kind: "changed", revision: seeded.version + 1 });
const statusGame = await loadGame(db, gameId);
assert.ok(statusGame);
assert.equal(statusGame.status, "abandoned");
assert.equal(statusGame.version, seeded.version + 1);
const statusSnapshot = await snapshotOfGame(db, statusGame);
assert.equal(statusSnapshot.game.status, "abandoned");
assert.ok(statusSnapshot.beats === null || statusSnapshot.beats.seq === (seeded.beats?.seq ?? 0), "status-only response carries no new beats");

// Old and future cursors get a full-current-state path; an erased row remains
// a 404-class result rather than an endless 204 poll.
assert.deepEqual(await waitForRevisionResult(db, gameId, seeded.version, 50), { kind: "changed", revision: seeded.version + 1 }, "old cursor is answered authoritatively");
assert.deepEqual(await waitForRevisionResult(db, gameId, seeded.version + 50, 50), { kind: "changed", revision: seeded.version + 1 }, "cursor ahead of server gets an authoritative full-read path");
await db.delete(schema.arenaGames).where(eq(schema.arenaGames.id, gameId));
assert.deepEqual(await waitForRevisionResult(db, gameId, seeded.version + 1, 50), { kind: "missing" }, "deleted game is not reported unchanged");
await db.delete(schema.decks).where(eq(schema.decks.id, deckId));
await db.delete(schema.cards).where(eq(schema.cards.setCode, "P0POLL"));
await db.delete(schema.cardSets).where(eq(schema.cardSets.code, "P0POLL"));
await client.close();

// The unchanged early return remains strictly after request auth, game access,
// and versus-seat authorization, and before loadGame/snapshot projection.
const route = fs.readFileSync("src/app/api/v1/games/[id]/route.ts", "utf8");
const auth = route.indexOf("const auth = await routeViewer();");
const gameAccess = route.indexOf("canOpenGame(auth.viewer, id)");
const seatGate = route.indexOf("if (versus && !seat)");
const wait = route.indexOf("await waitForRevisionResult(db, id, sinceRevision, waitMs)");
const preference = route.indexOf('req.headers.get("Prefer") === "return=minimal"');
const preferenceGuard = route.indexOf('revisionWait?.kind === "unchanged" && prefersMinimal');
const unchanged = route.indexOf('status: 204, headers: { "Cache-Control": "private, no-store" }');
const fullLoad = route.indexOf("const game = await loadGame(db, id);");
assert.ok(preference >= 0 && auth >= 0 && auth < gameAccess && gameAccess < seatGate && seatGate < wait && wait < preferenceGuard && preferenceGuard < unchanged && unchanged < fullLoad,
  "the opted-in no-body response follows auth/ownership/seat checks and precedes expensive game projection");

// A 204 retains both poll cursors and the last board. The next full response
// still supplies a terminal status, so no-beat completion reaches the client.
{
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  const urls: string[] = [];
  const requestOptions: RequestInit[] = [];
  const updates: Snapshot[] = [];
  const states: string[] = [];
  let calls = 0;
  const poller = startLiveGamePolling({
    gameId: 42,
    revision: 6,
    beat: 11,
    source: {
      online: true, visible: true,
      addEventListener() {}, removeEventListener() {},
    },
    setTimer: ((fn: () => void) => { const id = ++nextTimer; timers.set(id, fn); return id as unknown as ReturnType<typeof setTimeout>; }) as typeof setTimeout,
    clearTimer: ((id: ReturnType<typeof setTimeout>) => { timers.delete(id as unknown as number); }) as typeof clearTimeout,
    fetcher: async (url, init) => {
      urls.push(String(url));
      requestOptions.push(init ?? {});
      calls++;
      return calls === 1 ? new Response(null, { status: 204 }) : new Response(JSON.stringify(snapshot(7, "abandoned")), { status: 200 });
    },
    onSnapshot: (value) => updates.push(value),
    onConnection: (value) => states.push(value),
  });
  await tick();
  assert.equal(calls, 1);
  assert.equal(updates.length, 0, "204 does not replace the current board");
  assert.equal(timers.size, 1, "204 schedules the next long poll");
  const [nextId, nextPoll] = timers.entries().next().value!;
  timers.delete(nextId);
  nextPoll();
  await tick();
  assert.equal(calls, 2);
  assert.ok(urls[0]?.includes("sinceRevision=6") && urls[0]?.includes("sinceBeat=11"));
  assert.deepEqual(requestOptions[0]?.headers, { Prefer: "return=minimal" }, "new polling client opts in to no-content responses");
  assert.ok(urls[1]?.includes("sinceRevision=6") && urls[1]?.includes("sinceBeat=11"), "204 retains revision and beat cursors");
  assert.equal(updates[0]?.game.status, "abandoned", "later status-only terminal revision is delivered");
  assert.equal(states.at(-1), "connected");
  poller.stop();
}

console.log("revision polling #568: unchanged/no-store, changed status, old/future cursor, missing row and 204 client recovery PASS");
