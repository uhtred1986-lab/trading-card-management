import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and set your Postgres connection string.",
  );
}

/**
 * Next.js hot-reloads modules in development, which would otherwise open a new
 * connection pool on every edit until Postgres refuses connections. Cache the
 * client on globalThis so reloads reuse it.
 */
const globalForDb = globalThis as unknown as { __dbsSql?: ReturnType<typeof postgres> };

const sql =
  globalForDb.__dbsSql ??
  postgres(connectionString, {
    max: 10,
    // Local Docker Postgres does not speak TLS.
    ssl: connectionString.includes("sslmode=require") ? "require" : false,
    // Neon's pooled (`-pooler`) endpoint is PgBouncer in transaction mode; server-side
    // prepared statements don't survive it.
    prepare: connectionString.includes("-pooler") ? false : true,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__dbsSql = sql;
}

export const db: PostgresJsDatabase<typeof schema> = drizzle(sql, { schema });
export type Db = typeof db;
export { schema };
