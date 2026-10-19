/**
 * Replay a saved game's action log from its seed and compare what comes out
 * with what the row holds.
 *
 *   npm run arena:diff -- <gameId> [--all]
 *
 * A game is its seed plus its actions (`docs/arena-client-contract.md`), so a
 * replay on the rules engine must land on the very same state. The first action
 * the engine refuses, or whose resulting state differs, is what is reported, not
 * a bare "differs". A row the legacy engine wrote (none survive the 0050
 * migration) is reported and skipped.
 *
 * The decks are read as they are now. A deck edited since the game was played
 * changes the shuffle, and the report says so rather than blaming an engine.
 * Needs DATABASE_URL.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "../src/db";
import { arenaGames } from "../src/db/schema";
import { IllegalAction } from "../src/lib/arena/vm/common";
import { type Action, type EngineContext } from "../src/lib/arena/types";
import { isVmState } from "../src/lib/arena/engines";
import { RULES } from "../src/lib/arena/vm";
import { deckInputFor, defsForCards } from "../src/lib/arena/load";
import { rulesFor } from "../src/lib/arena/rules-store";
import { formatDiffReport, groupDiffOutcomes, type DiffOutcome } from "./lib/arena-diff-report";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

/** The shape `scripts/lib/arena-diff-report.ts` groups and formats — see there for field meanings. */
type Report = DiffOutcome;

/**
 * Postgres hands jsonb back with its keys in its own order, so two equal
 * states can stringify differently. Compare them with the keys sorted, and
 * when they differ say where, because "differs" alone is nothing to act on.
 */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]));
  return v;
}

function firstDiff(a: unknown, b: unknown, at = "state"): string | null {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${at}: ${a.length} items against ${b.length} on the row`;
    for (let i = 0; i < a.length; i++) {
      const d = firstDiff(a[i], b[i], `${at}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const k of keys) {
      const d = firstDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${at}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return a === b || (a === undefined && b === null) || (a === null && b === undefined) ? null : `${at}: ${JSON.stringify(a)} against ${JSON.stringify(b)} on the row`;
}

async function replay(id: number): Promise<Report | null> {
  const row = await db.query.arenaGames.findFirst({ where: eq(arenaGames.id, id) });
  if (!row) return null;
  if (!isVmState(row.state)) throw new Error(`game ${id}: saved on the retired legacy engine, nothing to replay`);
  const engine = RULES;
  const stored = row.state;
  const actions = (row.actions as Action[]) ?? [];
  if (row.p1DeckId == null || row.p2DeckId == null) throw new Error(`game ${id}: a deck is gone, nothing to replay from`);
  const a = await deckInputFor(db, row.p1DeckId);
  const b = await deckInputFor(db, row.p2DeckId);
  if (!a || !b) throw new Error(`game ${id}: a deck no longer loads`);
  const defs = await defsForCards(db, [...new Set([...a.cardIds, ...b.cardIds])]);
  // The referee is off: a replay must not ask Claude anything, and every
  // ruling a game needed is already in its action log as `refereeRuling`.
  const ctx: EngineContext = { defs, scripts: await rulesFor(db, defs) };
  let state = engine.createGame(ctx, { seed: row.seed, p1: a.input, p2: b.input }).state;
  const countOf = (p: "p1" | "p2") => [...state.sides[p].zones.deck, ...state.sides[p].zones.hand, ...state.sides[p].zones.life].length;
  const deckChanged = countOf("p1") !== a.cardIds.length - 1 || countOf("p2") !== b.cardIds.length - 1;
  let divergence: Report["divergence"] = null;
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    try {
      state = engine.apply(ctx, state, action).state;
    } catch (err) {
      divergence = { at: i, why: err instanceof IllegalAction ? `refused: ${err.message}` : `threw: ${err instanceof Error ? err.message : String(err)}` };
      break;
    }
  }
  const diff = firstDiff(canonical(state), canonical(stored));
  const same = diff === null;
  if (!divergence && !same) divergence = { at: actions.length, why: `after every action, ${diff}` };
  return { id, engine: "rules", actions: actions.length, divergence, same, deckChanged };
}

function say(r: Report): void {
  const verdict = r.same ? "same state" : r.divergence ? `diverges at action ${r.divergence.at}/${r.actions}: ${r.divergence.why}` : "differs";
  console.log(`game ${r.id} on ${r.engine}: ${r.actions} actions — ${verdict}${r.deckChanged ? " (a deck was edited since the game, so the shuffle differs)" : ""}`);
}

if (flag("all")) {
  const rows = await db.select({ id: arenaGames.id }).from(arenaGames).orderBy(desc(arenaGames.id)).limit(Number(value("limit") ?? 50) || 50);
  const outcomes: DiffOutcome[] = [];
  for (const { id } of rows) {
    const r = await replay(id).catch((err: unknown) => {
      console.log(String(err instanceof Error ? err.message : err));
      return null;
    });
    if (r) outcomes.push(r);
  }
  // Grouped by cause rather than dumped one line per game (docs/arena-tooling.md §4): two games
  // hitting the same bug report the identical first differing prompt or refused action, and a
  // deck edited since it was played is set apart, since its shuffle — not the engine — is why it
  // might not match.
  for (const line of formatDiffReport(groupDiffOutcomes(outcomes))) console.log(line);
} else {
  const id = Number(args.find((a) => /^\d+$/.test(a)));
  if (!Number.isInteger(id)) throw new Error("usage: arena:diff -- <gameId> | --all [--limit N]");
  const r = await replay(id);
  if (!r) throw new Error(`no game ${id}`);
  say(r);
}
process.exit(0);
