import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { drizzle as drizzleNeonHttp } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and set your Postgres connection string.");
}

/**
 * Next.js hot-reloads modules in development, which would otherwise open a new
 * connection pool on every edit until Postgres refuses connections. Cache the
 * client on globalThis so reloads reuse it.
 */
const globalForDb = globalThis as unknown as { __dbsSql?: ReturnType<typeof postgres> };

function postgresClient() {
  const sql =
    globalForDb.__dbsSql ??
    postgres(connectionString!, {
      max: 10,
      // Local Docker Postgres does not speak TLS.
      ssl: connectionString!.includes("sslmode=require") ? "require" : false,
      // Neon's pooled (`-pooler`) endpoint is PgBouncer in transaction mode; server-side
      // prepared statements don't survive it.
      prepare: connectionString!.includes("-pooler") ? false : true,
    });
  if (process.env.NODE_ENV !== "production") globalForDb.__dbsSql = sql;
  return sql;
}

/**
 * Both drivers speak to the same Neon database; only the wire differs.
 *
 * `DB_DRIVER=neon-http` sends every query over HTTPS (port 443) through Neon's
 * serverless driver instead of a Postgres TCP connection on 5432. That is for
 * environments whose egress allows HTTPS only — the sandbox Claude Code runs
 * the arena scripts in is one — and for nothing else: the HTTP driver has no
 * interactive transactions, so `db.transaction` throws there, and the app
 * server keeps postgres.js. Neon's HTTP endpoint accepts the pooled URL as-is.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export const driver: "postgres" | "neon-http" = process.env.DB_DRIVER === "neon-http" ? "neon-http" : "postgres";

export const db: Db = driver === "neon-http" ? drizzleNeonHttp(neon(connectionString), { schema }) : drizzlePostgres(postgresClient(), { schema });
export { schema };
