/**
 * The cached reads (issue #383) — see `./tags.ts` for how and why.
 *
 * | Read                   | Tags             | Tables                                  |
 * |------------------------|------------------|-----------------------------------------|
 * | `cachedListSets`       | catalog          | card_sets                               |
 * | `cachedListRarities`   | catalog          | cards                                   |
 * | `cachedListTraits`     | catalog          | cards                                   |
 * | `cachedAbilityKeywords`| catalog          | cards                                   |
 * | `cachedCardIdsWithAbility` | catalog      | cards                                   |
 * | `cachedCard`           | catalog          | cards, card_sets, card_prints           |
 * | `cachedRecentCards`    | catalog          | cards, card_sets                        |
 * | `cachedUsdEur`         | prices           | fx_rates                                |
 * | `cachedPricesForPrints`| prices           | tcg_products, tcg_prices                |
 * | `cachedTcgUrl`         | prices           | tcg_products                            |
 * | `cachedBasePricesForCards` | catalog, prices | card_prints, tcg_products, tcg_prices |
 * | `cachedPriceSource`    | prices           | fx_rates, tcg_products, tcg_prices, cards, card_prints |
 * | `cachedLeaderboard`    | meta, catalog    | meta_events, meta_results, cards        |
 * | `cachedResultCards`    | meta             | meta_result_cards                       |
 *
 * Who expires each tag:
 *
 * - `catalog`: the Settings catalog, CardTrader and price syncs
 *   (`src/app/settings/actions.ts` — the price sync backfills card art
 *   and `card_sets.released_on`, CardTrader writes leader faces), the price cron
 *   (`/api/sync/prices`, same reason), and `setSpecifiedCostAction`
 *   (`src/app/arena/actions.ts`, the one hand-written `cards` column).
 * - `prices`: `/api/sync/prices` and the Settings price sync.
 * - `meta`: `/api/sync/meta` and the Settings meta sync.
 * - All three: the 24 h TTL, for `npm run sync:*`, which run outside Next.
 *
 * Nothing here reads `owned_cards`, `decks`, arena state or a login: the cache
 * is shared by every viewer. `searchCards` stays uncached for that reason (its
 * `owned` filter reads the collection), as do `ownedLeaders` and every
 * collection or deck query. A new writer of any table above must expire its
 * tag, and a new cached read must be added to this table.
 */
import { db } from "@/db";
import type { Game } from "@/lib/catalog/games";
import { recentCards, type NewCard } from "@/lib/catalog/news";
import { cardIdsWithAbility, getCard, listAbilityKeywords, listRarities, listSets, listTraits } from "@/lib/catalog/queries";
import { leaderboard, resultCardsFor, type ResultCard } from "@/lib/meta/leaderboard";
import { latestUsdEur } from "@/lib/pricing/fx";
import { basePricesAsOf, basePricesForCards, pricesForPrints, type PriceSource, type PrintPrice } from "@/lib/pricing/queries";
import { cachedRead, datesCodec, mapCodec, reviveDates } from "./tags";

/** Today, UTC — part of the key of a read whose window is "the last N days", so the window rolls daily. */
const today = () => new Date().toISOString().slice(0, 10);

export const cachedListSets = cachedRead("listSets", ["catalog"], (game?: Game) => listSets(db, { game }));
export const cachedListRarities = cachedRead("listRarities", ["catalog"], (game?: Game) => listRarities(db, { game }));
export const cachedListTraits = cachedRead("listTraits", ["catalog"], (game?: Game) => listTraits(db, { game }));
export const cachedAbilityKeywords = cachedRead("listAbilityKeywords", ["catalog"], (game?: Game) => listAbilityKeywords(db, { game }));
export const cachedCardIdsWithAbility = cachedRead("cardIdsWithAbility", ["catalog"], (ability: string, game?: Game) => cardIdsWithAbility(db, ability, game));

type Card = Awaited<ReturnType<typeof getCard>>;
export const cachedCard = cachedRead("getCard", ["catalog"], (id: string) => getCard(db, id), {
  encode: (c: Card) => c,
  decode: (c: Card) => (c ? reviveDates(c, ["firstSeenAt", "updatedAt"]) : c),
});

const recentCardsRead = cachedRead(
  "recentCards",
  ["catalog"],
  (game: Game | undefined, days: number, day: string) => {
    void day; // key only: the window rolls with the date
    return recentCards(db, { game, days });
  },
  datesCodec<NewCard>("firstSeenAt"),
);
export const cachedRecentCards = (opts: { game?: Game; days: number }) => recentCardsRead(opts.game, opts.days, today());

export const cachedUsdEur = cachedRead("latestUsdEur", ["prices"], () => latestUsdEur(db));
export const cachedPricesForPrints = cachedRead("pricesForPrints", ["prices"], (printIds: string[]) => pricesForPrints(db, printIds), mapCodec<string, PrintPrice>());
/** The /cards grid's prices: a page of base prints at a time. */
export const cachedBasePricesForCards = cachedRead("basePricesForCards", ["catalog", "prices"], (cardIds: string[]) => basePricesForCards(db, cardIds), mapCodec<string, PrintPrice>());

const basePricesAsOfRead = cachedRead("basePricesAsOf", ["prices"], (cardIds: string[], asOf: string) => basePricesAsOf(db, cardIds, asOf), mapCodec<string, number>());

/**
 * The collection's valuation reads (`valuedLots`, `collectionCopies`,
 * `movers`) from the cache: the same three queries, held until the next
 * price sync. Only the prices are cached — which copies you own is read
 * fresh every time, so a lot added a moment ago is valued at once (its
 * print's price is a miss for the new key, and read).
 */
export const cachedPriceSource: PriceSource = { usdEur: cachedUsdEur, prices: (ids) => cachedPricesForPrints(ids), pricesAsOf: (ids, asOf) => basePricesAsOfRead(ids, asOf) };

export const cachedTcgUrl = cachedRead(
  "tcgUrl",
  ["prices"],
  async (cardId: string) => (await db.query.tcgProducts.findFirst({ where: (p, { eq }) => eq(p.cardId, cardId), columns: { url: true } }))?.url ?? null,
);

const leaderboardRead = cachedRead("leaderboard", ["meta", "catalog"], (days: number, day: string) => {
  void day; // key only: the window rolls with the date
  return leaderboard(db, { days });
});
export const cachedLeaderboard = (opts: { days: number }) => leaderboardRead(opts.days, today());
export const cachedResultCards = cachedRead("resultCardsFor", ["meta"], (resultIds: number[]) => resultCardsFor(db, resultIds), mapCodec<number, ResultCard[]>());
