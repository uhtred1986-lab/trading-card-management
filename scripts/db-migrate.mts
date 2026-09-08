/**
 * `npm run db:migrate:http` — apply the migrations in `drizzle/` over whichever
 * driver `DB_DRIVER` selects. `drizzle-kit migrate` (what Vercel runs) speaks
 * Postgres TCP only; in a sandbox that allows HTTPS out and nothing on 5432
 * this is the way to bring the database to the branch's schema. Same journal
 * table, same files, so the two can be mixed.
 */
import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const { db, driver } = await import("../src/db/index.ts");
if (driver === "neon-http") {
  const { migrate } = await import("drizzle-orm/neon-http/migrator");
  await migrate(db as unknown as Parameters<typeof migrate>[0], { migrationsFolder: "drizzle" });
} else {
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  await migrate(db as unknown as Parameters<typeof migrate>[0], { migrationsFolder: "drizzle" });
}
console.log(`migrations applied over ${driver}`);
process.exit(0);
