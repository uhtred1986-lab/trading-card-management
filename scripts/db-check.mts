/**
 * `npm run db:check` — can this machine reach the database at all, and with
 * which driver? Prints the server version and a few row counts, then exits.
 * The first thing to run in a new environment before any script that writes.
 */
import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const { sql } = await import("drizzle-orm");
const { db, driver } = await import("../src/db/index.ts");
const { rows } = await import("../src/db/rows.ts");

const started = Date.now();
const [version] = rows<{ version: string }>(await db.execute(sql`select version()`));
console.log(`driver: ${driver} · ${Date.now() - started} ms to first answer`);
console.log(version.version);

for (const table of ["cards", "decks", "card_rules", "card_text_notes", "arena_games"]) {
  const [r] = rows<{ n: number }>(await db.execute(sql.raw(`select count(*)::int as n from ${table}`)));
  console.log(`${table.padEnd(16)} ${r.n}`);
}
process.exit(0);
