import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { drizzle as drizzleNeonHttp } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export const driver: "postgres" | "neon-http" = process.env.DB_DRIVER === "neon-http" ? "neon-http" : "postgres";

const globalForDb = globalThis as unknown as { __dbsSql?: ReturnType<typeof postgres> };

function postgresClient() {
  const sql =
    globalForDb.__dbsSql ??
    postgres(connectionString!, {
      max: 10,
      ssl: connectionString!.includes("sslmode=require") ? "require" : false,
      prepare: connectionString!.includes("-pooler") ? false : true,
    });
  if (process.env.NODE_ENV !== "production") globalForDb.__dbsSql = sql;
  return sql;
}

type ChainableTarget = (...args: unknown[]) => unknown;

function createMockDb(): Db {
  const chainable = (isFirst = false): unknown => {
    const target: ChainableTarget = () => chainable(isFirst);
    const handler: ProxyHandler<ChainableTarget> = {
      get: (_target, prop) => {
        if (prop === "then") {
          return (resolve: (val: unknown) => void) => resolve(isFirst ? null : []);
        }
        if (prop === "catch") {
          return () => chainable(isFirst);
        }
        if (prop === "finally") {
          return (cb?: () => void) => {
            cb?.();
            return chainable(isFirst);
          };
        }
        if (prop === "findFirst" || prop === "findUnique") {
          return () => chainable(true);
        }
        if (prop === "findMany") {
          return () => chainable(false);
        }
        return chainable(isFirst);
      },
      apply: () => chainable(isFirst),
    };
    return new Proxy(target, handler);
  };

  const mockDb = new Proxy({} as Db, {
    get: (_target, prop) => {
      if (prop === "transaction") {
        return async (cb: (tx: Db) => Promise<unknown>) => {
          try {
            return await cb(mockDb);
          } catch {
            return null;
          }
        };
      }
      if (prop === "query") {
        return new Proxy({}, {
          get: () => new Proxy({}, {
            get: (_, qProp) => {
              if (qProp === "findFirst" || qProp === "findUnique") {
                return async () => null;
              }
              return async () => [];
            },
          }),
        });
      }
      return chainable(false);
    },
  });

  return mockDb;
}

function initDb(): Db {
  if (!connectionString) {
    console.warn("[AI Studio] DATABASE_URL is not set — database mock active. Set DATABASE_URL in environment to connect to a real Postgres database.");
    return createMockDb();
  }

  try {
    return driver === "neon-http"
      ? drizzleNeonHttp(neon(connectionString), { schema })
      : drizzlePostgres(postgresClient(), { schema });
  } catch (err) {
    console.warn("[AI Studio] Failed to initialize database connection — fallback to mock:", err);
    return createMockDb();
  }
}

export const db: Db = initDb();
export { schema };
