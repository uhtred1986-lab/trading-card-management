import { sql, type SQL } from "drizzle-orm";

/**
 * A Postgres `text[]` literal from a JS array. Binding a JS array straight into
 * `${arr}::text[]` fails under postgres.js ("transformTypeCast"), so build
 * `array['a', 'b']::text[]` with one bound parameter per element instead.
 */
export function textArray(values: string[]): SQL {
  return sql`array[${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )}]::text[]`;
}
