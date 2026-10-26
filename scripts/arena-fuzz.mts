/** Random legal games on stored rules; admin-only snapshots/replays contain private deck data. */
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { nextRandom } from "../src/lib/arena/vm/rng";
import { runFuzzGame, replayFuzzTrace, type FuzzResult, type FuzzTrace } from "./lib/arena-fuzz-runner";
import type { DeckInput, EngineContext } from "../src/lib/arena/types";

interface FuzzSnapshot {
  format: "arena-fuzz-snapshot-v1";
  decks: { id: number; name: string; input: DeckInput; cardIds: string[] }[];
  context: EngineContext;
}

const argv = process.argv.slice(2);
const positional: string[] = [];
const flags = new Map<string, string>();
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (!arg.startsWith("--")) { positional.push(arg); continue; }
  if (!["--snapshot", "--snapshot-out", "--report", "--replay", "--game"].includes(arg) || !argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error(`unknown option or missing path: ${arg}`);
  flags.set(arg, argv[++i]);
}
const game = flags.get("--game") ?? "dbs";
if (game !== "dbs" && game !== "fusion") throw new Error(`unknown game: ${game} (dbs or fusion)`);
if (game === "fusion" && (flags.has("--snapshot") || flags.has("--replay"))) throw new Error("--game fusion builds its decks from the fixtures; it takes no --snapshot or --replay");
const games = Number(positional[0] ?? 20);
const fixed = positional.length === 3 ? [Number(positional[1]), Number(positional[2])] : null;
if (!Number.isInteger(games) || games < 1 || (positional.length !== 0 && positional.length !== 1 && positional.length !== 3) || fixed?.some((id) => !Number.isInteger(id) || id < 1)) {
  throw new Error("usage: arena-fuzz.mts [games] [deckA deckB] [--game dbs|fusion] [--snapshot FILE] [--snapshot-out FILE] [--report FILE] | --replay FILE");
}
if (flags.has("--replay") && (positional.length || flags.has("--snapshot") || flags.has("--snapshot-out"))) throw new Error("--replay cannot be combined with game selection or a snapshot");

/** Private local artifacts get owner-only permissions, including when overwriting a file. */
function writePrivate(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  chmodSync(path, 0o600);
}

function summary(r: FuzzResult): string {
  const match = `${r.trace.options.p1.name} vs ${r.trace.options.p2.name}`;
  const position = `seed ${r.seed}, ${r.steps} actions, turn ${r.turn}`;
  if (r.status === "crash") return `${match}: CRASH (${position}; last action ${JSON.stringify(r.lastAction)}): ${r.error}`;
  if (r.status === "interrupted") {
    const d = r.interruption;
    return `${match}: interrupted (${position}) — ${d?.cardId ?? "unknown card"}${d?.skillIndex == null ? "" : `#${d.skillIndex}`} ${d?.issue ?? "unknown issue"}: ${d?.detail ?? "no private diagnostic recorded"}`;
  }
  if (r.status === "action-limit") return `${match}: still running (${position})`;
  const winner = r.outcome?.winner;
  return `${match}: ${winner ? r.trace.options[winner].name + " won" : "draw"} (${r.outcome?.reason}) after turn ${r.turn}`;
}

if (flags.has("--replay")) {
  const replay = replayFuzzTrace(JSON.parse(readFileSync(flags.get("--replay")!, "utf8")) as FuzzTrace);
  console.log(summary(replay));
  if (flags.has("--report")) writePrivate(flags.get("--report")!, replay);
  process.exit(replay.status === "crash" ? 1 : 0);
}

let snapshot: FuzzSnapshot;
if (game === "fusion") {
  // The four starters from scripts/verify/fixtures/arena-fusion-world: no database, no network.
  const { STARTERS, fusionContext, starterDeck } = await import("./verify/fixtures/arena-fusion-world/load.mts");
  const context = fusionContext();
  snapshot = {
    format: "arena-fuzz-snapshot-v1", context,
    decks: STARTERS.map((code, i) => { const input = starterDeck(code); return { id: i + 1, name: code, input, cardIds: [input.leader, ...new Set(input.main)] }; }),
  };
} else if (flags.has("--snapshot")) {
  snapshot = JSON.parse(readFileSync(flags.get("--snapshot")!, "utf8")) as FuzzSnapshot;
  if (snapshot.format !== "arena-fuzz-snapshot-v1" || !snapshot.decks?.length || !snapshot.context?.defs || !snapshot.context.scripts) throw new Error("invalid fuzz snapshot");
} else {
  // A cached run/replay never imports the database entry point or opens a connection.
  const [{ db }, { decks }, { deckInputFor, defsForCards }, { rulesFor }] = await Promise.all([
    import("../src/db"), import("../src/db/schema"), import("../src/lib/arena/load"), import("../src/lib/arena/rules-store"),
  ]);
  const all = await db.select({ id: decks.id, name: decks.name }).from(decks);
  const usable: FuzzSnapshot["decks"] = [];
  for (const d of all) {
    const loaded = await deckInputFor(db, d.id);
    if (loaded && loaded.input.main.length >= 50) usable.push({ ...d, input: loaded.input, cardIds: loaded.cardIds });
  }
  const defs = await defsForCards(db, usable.flatMap((d) => d.cardIds));
  snapshot = { format: "arena-fuzz-snapshot-v1", decks: usable, context: { defs, scripts: await rulesFor(db, defs) } };
}
if (!snapshot.decks.length) throw new Error("no usable Masters decks with at least 50 main-deck cards");
if (fixed?.some((id) => !snapshot.decks.some((d) => d.id === id))) throw new Error("a selected deck is not a usable Masters deck");
if (flags.has("--snapshot-out")) writePrivate(flags.get("--snapshot-out")!, snapshot);
console.log(`decks: ${snapshot.decks.map((d) => `${d.id} ${d.name}`).join(" | ")}`);

let rng = 12345;
const rand = () => { const r = nextRandom(rng); rng = r.state; return r.value; };
const notes = new Map<string, number>();
const results: FuzzResult[] = [];
for (let g = 0; g < games; g++) {
  const a = fixed ? snapshot.decks.find((d) => d.id === fixed[0])! : snapshot.decks[Math.floor(rand() * snapshot.decks.length)];
  const b = fixed ? snapshot.decks.find((d) => d.id === fixed[1])! : snapshot.decks[Math.floor(rand() * snapshot.decks.length)];
  // Keep each game's context equal to the old live fuzz: only the two decks' cards.
  const ids = [...new Set([...a.cardIds, ...b.cardIds])];
  const defs = Object.fromEntries(ids.filter((id) => snapshot.context.defs[id]).map((id) => [id, snapshot.context.defs[id]]));
  const keys = ids.flatMap((id) => [id, `${id}#back`]);
  const scripts = Object.fromEntries(keys.filter((key) => snapshot.context.scripts?.[key]).map((key) => [key, snapshot.context.scripts![key]]));
  const result = runFuzzGame({ defs, scripts }, { seed: Math.floor(rand() * 1e9), ...(game === "dbs" ? {} : { game }), p1: a.input, p2: b.input }, {
    random: rand, note: (text) => notes.set(text.slice(0, 60), (notes.get(text.slice(0, 60)) ?? 0) + 1),
  });
  results.push(result);
  console.log(summary(result));
}
const counts = Object.fromEntries(["completed", "interrupted", "action-limit", "crash"].map((status) => [status, results.filter((r) => r.status === status).length]));
console.log(`\n${games} games: ${counts.completed} completed, ${counts.interrupted} interrupted, ${counts["action-limit"]} action limits, ${counts.crash} crashes`);
const top = [...notes.entries()].sort((x, y) => y[1] - x[1]).slice(0, 12);
if (top.length) console.log("most frequent notes:\n" + top.map(([t, n]) => `  ${n}× ${t}`).join("\n"));
if (flags.has("--report")) writePrivate(flags.get("--report")!, {
  format: "arena-fuzz-report-v1", games, counts,
  results: results.map(({ trace, ...result }, index) => ({ game: index + 1, decks: { p1: trace.options.p1.name, p2: trace.options.p2.name }, ...result })),
  failures: results.flatMap((r, index) => r.status === "completed" ? [] : [{ game: index + 1, ...r }]),
});
process.exit(counts.crash ? 1 : 0);
