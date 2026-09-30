# Architecture: catalog, sync and prices

Read before touching the catalog import, errata, card images, TCGplayer or CardTrader pricing, or the cart optimiser. Moved unchanged from `CLAUDE.md` (issue #382); the text is verbatim, so a comment that says "see CLAUDE.md" means this file.

## Data sources (verified 2 Sep 2026)

| What | Source | Notes |
|---|---|---|
| Card catalog | `https://api.deckplanet.net/cardsearch/{dbs_masters_cards,fusion_world_cards}?limit=100000` | One call per game; the `dragogodev/cgs` repo the spec names is only a *pointer* to the first. 6.5k cards for the original game, ~2k for Fusion World. Alternate prints appear as top-level entries **and** in `variants[]`; `shapeCatalog` collapses them to one card per base number + a print list. The Fusion World payload differs in three ways, all handled in `deckplanet.ts`: bare rarity codes ("SR", normalised to "Super Rare[SR]" by `normaliseRarity`), no character/era lists, and a numeric energy cost. **Its skill text carries typos** — see `errata.ts` below. |
| Card images | `https://storage.googleapis.com/deckplanet_card_images/{number}.png` | Hot-linked via `next/image`; a few prints 404 and fall back to a placeholder. **Fusion World is not in this bucket at all** — its art comes from Bandai's own card list, `https://www.dbs-cardgame.com/fw/images/cards/card/en/{number}.webp` (leaders `_f`/`_b`, alternate prints `_p1`, `_p2`…; no User-Agent or Referer check). `src/lib/catalog/bandai.ts` crawls the card list's series pages for the exact image names at catalog sync and only assigns URLs that exist, since deckplanet lists ~700 more alternate prints than Bandai shows. Whatever is still null afterwards gets the matched TCGplayer product photo (`_200w.jpg` rewritten to `_in_1000x1000.jpg`) from `fillMissingImages` during the price sync. The catalog upserts therefore `coalesce` `image_url` instead of overwriting it. |
| Leader faces | deckplanet `{number}.png` / `{number}_b.png` (sets before BT19 only) → else Bandai's original-game card list, `https://www.dbs-cardgame.com/images/cardlist/cardimg/{number}.png` / `{number}_b.png` (every set, BT1 onward) → else the CardTrader blueprint image / `back_image`. All of it HEAD-verified at catalog sync **before** the import (`verifyFrontImages`, `verifyBackImages`, `applyOfficialLeaderImages`). Fusion World leaders use Bandai's `{number}_f.webp` / `_b.webp`, the back inferred from the `_f` front and HEAD-verified the same way | Stored in `cards.image_url` / `back_image_url`. The upsert lets a stored deckplanet URL yield to the fresh (possibly null) answer and otherwise `coalesce`s, so a CardTrader or price-sync backfill survives a re-sync until a catalog source has the face. **TCGplayer's photo of a leader ("Front // Back") is the awakened side** — never use it as a front. `CardFaces` shows front + awakened when present. |
| Prices | `https://tcgcsv.com/tcgplayer/{27,80}/...` | **Requires a browser-like User-Agent** (401 otherwise). Category 27 is the original game, 80 is Fusion World; 27 also carries a stray duplicate of Fusion World's FB01 group, which is skipped there. Products join to cards on the printed `Number`; SR+ cards only exist as a foil sub-type, so `priceForFinish` falls back foil↔normal — and the foil sub-type is called `Foil` in category 27 but `Holofoil` in 80 (`FOIL_SUB_TYPES`). |
| FX | `https://api.frankfurter.app/latest?from=USD&to=EUR` | Daily. |
| CardTrader | `https://api.cardtrader.com/api/v2` | **Read-only client**, and every live call is gated by `CARDTRADER_ENABLED=true` (the owner enabled it on 2 Sep 2026 after testing). Never add cart/purchase endpoints without being asked. Quirks the docs omit: `/games` returns `{"array": [...]}` (the client unwraps it); `/expansions` is a bare array; Dragon Ball Super is game id 9 and **includes Fusion World expansions** (`fb*`, `fs*`), which now cross-walk like any other set; `fixed_properties.collector_number` is `BT14-113` on newer sets but bare `049` on older ones (see `collectorNumbers`). Crosswalk covers ~98 % of cards, mostly via `tcg_player_id` = tcgcsv `productId`. Cardmarket also files Fusion World under its `DragonBallSuper` category, but **TCGplayer does not** — `externalLinks` picks the search slug per game. |
| Claude | `claude-opus-5`, adaptive thinking, Zod structured outputs via `messages.parse` | Every call is recorded in `ai_runs` with token usage. |

- **Catalog is immutable app data**: `card_sets` → `cards` → `card_prints`. Ownership
  (`owned_cards`) always references a *print* so foil/alt-art copies are distinct; deck slots
  (`deck_cards`) reference a *card*, because any print satisfies a deck slot.
- **The source's card-text typos are corrected on the way in** (`src/lib/catalog/errata.ts`) — the
  arena's compiler reads text literally, so one missing letter can cost a whole skill. **Never fix
  one with an UPDATE**: the catalog upsert sets `skill = excluded.skill`, so a hand-edited row is
  silently overwritten by the next `sync:catalog`. `syncCatalogFor` re-checks every entry against
  the fetched payload and warns if one stops matching. Only unambiguous errors are corrected, and a
  name correction is checked against Bandai's art first, never guessed.
- **No card-number prefix belongs to both games** — BT/EX/SD/TB/EB/DB/XD/P/TOKEN vs
  FB/FS/FP/SB/ST/E — so `gameOfSetCode` is a lookup, not a guess. Watch the `E`/`E01` pair in
  `sets.ts` and `normaliseNumber`'s `BARE_SET_CODES`.
- **Prices are daily snapshots** (`tcg_prices` keyed by product/sub-type/day) so movers can be
  computed; `pricesForPrints` reduces several TCGplayer products per print to one Normal + one Foil
  figure.
- **Optimiser** (`src/lib/marketplace/optimizer.ts`) is deterministic: greedy + exhaustive 1/2/3-seller
  subsets + removal local search, shipping counted once per seller.
