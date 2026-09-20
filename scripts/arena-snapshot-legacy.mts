/**
 * Archive every legacy game (issue #335, owner's ruling #119): compute each
 * `engine = 'legacy'` row's `Snapshot`(s) through the still-live legacy
 * engine and write them to `arena_games.snapshot`, so `games.ts`'s
 * `loadArchivedGame` can answer for the row read-only forever after —
 * including once `engine/` itself is deleted, when nothing could compute
 * this again.
 *
 *   npm run arena:snapshot-legacy [-- --dry-run] [-- --only <gameId>]
 *
 * A row that already carries a snapshot is skipped: once archived, `loadGame`
 * refuses to load it at all (`games.ts`), so nothing could have moved it on
 * since — recomputing would only reproduce the same JSON. `--only` narrows
 * which *candidate* rows are considered; it does not force a re-archive of
 * one already done.
 *
 * `versus` keeps one masked `Snapshot` per seat (`snapshot.ts`'s
 * `StoredSnapshot`) rather than one shared board, because it is the one mode
 * with a real hidden-hand boundary between two logins — flattening it into a
 * single frozen render would leak one seat's hand to the other forever.
 * Every other mode has no second viewer to protect against (hot-seat is one
 * device; against Claude the human is always `p1`), so it gets one `shared`
 * board.
 *
 * Needs DATABASE_URL — run by the owner, never by an agent session
 * (CLAUDE.md's "development keeps off Neon").
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../src/db";
import { arenaGames } from "../src/db/schema";
import { isVersus, loadGame } from "../src/lib/arena/games";
import { snapshotOfGame } from "../src/lib/arena/session";
import type { StoredSnapshot } from "../src/lib/arena/snapshot";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const onlyArg = (() => {
  const i = args.indexOf("--only");
  return i >= 0 ? Number(args[i + 1]) : undefined;
})();
if (onlyArg !== undefined && !Number.isInteger(onlyArg)) throw new Error("--only needs a game id");

const rows = await db
  .select({ id: arenaGames.id, mode: arenaGames.mode, p1Name: arenaGames.p1Name, p2Name: arenaGames.p2Name })
  .from(arenaGames)
  .where(and(eq(arenaGames.engine, "legacy"), isNull(arenaGames.snapshot), ...(onlyArg !== undefined ? [eq(arenaGames.id, onlyArg)] : [])));

if (!rows.length) {
  console.log(onlyArg !== undefined ? `game ${onlyArg}: not a legacy row, or already archived` : "nothing to archive — every legacy row already carries a stored snapshot");
  process.exit(0);
}

let done = 0;
for (const row of rows) {
  const game = await loadGame(db, row.id);
  if (!game) {
    console.log(`game ${row.id}: gone since the row was listed, skipped`);
    continue;
  }
  const store: StoredSnapshot = isVersus(game.mode)
    ? { p1: await snapshotOfGame(db, game, "p1"), p2: await snapshotOfGame(db, game, "p2") }
    : { shared: await snapshotOfGame(db, game, null) };
  if (dryRun) {
    console.log(`game ${row.id} (${row.p1Name} vs ${row.p2Name}, ${row.mode}): would write ${Object.keys(store).join("+")}`);
  } else {
    await db.update(arenaGames).set({ snapshot: store }).where(eq(arenaGames.id, row.id));
    console.log(`game ${row.id} (${row.p1Name} vs ${row.p2Name}, ${row.mode}): archived (${Object.keys(store).join("+")})`);
  }
  done++;
}

console.log(`${dryRun ? "would archive" : "archived"} ${done} of ${rows.length} legacy game${rows.length === 1 ? "" : "s"}`);
process.exit(0);
