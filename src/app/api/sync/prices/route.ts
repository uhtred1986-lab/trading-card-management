import { NextResponse } from "next/server";
import { db } from "@/db";
import { syncFx } from "@/lib/pricing/fx";
import { refreshPokemonCards } from "@/lib/pokemon/store";
import { syncPrices } from "@/lib/pricing/tcgcsv";
import { runSync } from "@/lib/sync";
import { expireTagsFromRoute } from "@/lib/cache/tags";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily price refresh, triggered by the Vercel cron in vercel.json. Vercel
 * sends `Authorization: Bearer $CRON_SECRET`; anything else is refused so the
 * route can't be used to hammer tcgcsv from outside.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const fx = await runSync(db, "fx", () => syncFx(db));
    const prices = await runSync(db, "prices", () => syncPrices(db));
    // Pokémon cards something refers to: legality, regulation mark and Cardmarket prices from TCGdex.
    // Its failure never fails the Dragon Ball sync above (lib/pokemon/store.ts, docs/pokemon/plan.md §4).
    const pokemon = await refreshPokemonCards(db, { budgetMs: 90_000 }).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
    return NextResponse.json({ fx, prices, pokemon });
  } finally {
    // Even a sync that failed part-way may have written. `catalog` too: the
    // price sync backfills `cards.image_url` / `card_prints.image_url` and
    // `card_sets.released_on` (src/lib/cache/reads.ts).
    expireTagsFromRoute("prices", "catalog");
  }
}
