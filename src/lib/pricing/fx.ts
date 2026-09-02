/**
 * USD→EUR reference rate from the ECB (via frankfurter.app, free, no key).
 * TCGplayer prices are USD; the user is in Austria and thinks in EUR.
 */
import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { fxRates } from "@/db/schema";

export async function syncFx(db: Db): Promise<{ asOf: string; usdEur: number }> {
  const res = await fetch("https://api.frankfurter.app/latest?from=USD&to=EUR");
  if (!res.ok) throw new Error(`frankfurter ${res.status}`);
  const json = (await res.json()) as { date: string; rates: { EUR: number } };
  await db
    .insert(fxRates)
    .values({ base: "USD", quote: "EUR", rate: json.rates.EUR, asOf: json.date })
    .onConflictDoUpdate({
      target: [fxRates.base, fxRates.quote, fxRates.asOf],
      set: { rate: sql`excluded.rate` },
    });
  return { asOf: json.date, usdEur: json.rates.EUR };
}

/** Latest known USD→EUR rate, or null if FX has never synced. */
export async function latestUsdEur(db: Db): Promise<number | null> {
  const [row] = await db
    .select({ rate: fxRates.rate })
    .from(fxRates)
    .where(eq(fxRates.base, "USD"))
    .orderBy(desc(fxRates.asOf))
    .limit(1);
  return row?.rate ?? null;
}
