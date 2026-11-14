# Architecture: Pokémon

Read this before touching Pokémon code. It is the map; the detail of each part is in the sections of
`catalog-and-sync.md`, `collection-and-decks.md`, `ai.md` and `auth.md` that it links to. The decisions
are in `docs/pokemon/plan.md` (§9 is the owner's answers), the screens in `docs/pokemon/design.md`.
Built 14 Nov 2026; what the plan changed is at the end of `plan.md`.

## What it is

- Game `pokemon` in `GAME_INFO` (`src/lib/catalog/games.ts`): `catalog: "live"`, `uiLang: "de"`,
  `arena: false`, deck rules `copiesBy: "name"`, formats `standard` (default) and `expanded`.
- Scope: collection, decks, wishes and buying. No arena, meta, leaders, set review, news or rules screens.
- It is **not** in `SYNCED_GAMES`. Nothing imports a Pokémon catalog; the sync jobs skip it.

## The live source (TCGdex)

TCGdex also lists the mobile game Pokémon TCG Pocket (series `tcgp`). Those are not printed cards and never
reach a search result, the set list, an evolution row or a stored card (`isPocketCardId`, `isPocketSetId`).

Source, cache and error handling: `catalog-and-sync.md`, "Pokémon: live source (TCGdex)". Code:
`src/lib/pokemon/tcgdex.ts`. The limits that matter when changing a screen:

- A search hit is brief. It has the id, collector number, names, image and set; **no price, no variant
  list and no legality**. Category and first type are known only when the search filtered on them, else
  `null`, never a guess (`hitFromTcgdex`).
- A page is ordered picture first, newest set first (`orderHits`). Search asks German and English and
  merges by TCGdex id (`mergeSearchHits`), so "Glurak" and "Charizard" find one card.
- Printed set codes and letter IDs (`MEW 006/165`, `SWSH062`, `TG12/TG30`) are read by
  `src/lib/pokemon/card-id.ts` for search, and by `voice.ts` and `scan-match.ts` for voice and photos.
- A failed read throws `PokemonSourceError`; the routes answer 503 in German, and collection and decks
  keep working because they read only the local database (`views.ts`).

Routes (all open with `routeViewer()`, see `auth.md`):

| Route | What |
|---|---|
| `GET /api/pokemon/search` | Live search, with the viewer's own copy counts and wishes |
| `GET /api/pokemon/card/[id]` | One card, fully read (prices, variants, legality) |
| `GET /api/pokemon/card/[id]/evolutions` | The line around one card: `{ from, into }` (`src/lib/pokemon/evolutions.ts`); 503 when the source is down |
| `GET /api/pokemon/sets` | The cached set list |
| `POST /api/pokemon/scan` | One card, one photo: model read, then live match (`scan.ts`); nothing is stored |
| `POST /api/pokemon/scan/batch` | A binder page that is kept: the photo is stored, then read (`scan-batch.ts`); 404 for a batch or photo that is not the viewer's |
| `GET /api/card-photo/[id]` | A person's own photo of a print (`collection/photos.ts`) |

## Data model

- **Ids.** Card `PKM-<tcgdexId>` (`PKM-sv03.5-006`). Print `PKM-<id>` for the normal print and
  `PKM-<id>_<variant>` otherwise. Variants: `normal`, `holo`, `reverse`, `firstEdition`, `wPromo`
  (`src/lib/pokemon/types.ts`). Set `PKM-<setId>` in `card_sets`, with `line = "pokemon"`.
- **Written only by `ensurePokemonCard`** (`src/lib/pokemon/store.ts`). It reads the card in both
  languages (`loadPokemonCard`, before the transaction) and upserts `card_sets`, `cards` and one
  `card_prints` row per variant, in the same transaction as the lot, deck line or wish that needs it. It
  expires the `catalog` cache tag. The `coalesce` rule keeps a stored value the source has stopped sending.
  Nothing is hand-edited, so `errata.ts` does not apply (`catalog-and-sync.md`).
- **`cards.details`** (jsonb; null for the Bandai games) holds `PokemonDetails` (`types.ts`): names per
  language, `setNames`, `localId` and `setTotal`, stage, `basicEnergy`, `onePerDeck`, HP, `evolveFrom`,
  attacks, abilities, weakness, retreat, `regulationMark`, `legal` per format, `dexIds`, German display
  strings. `pokemonDetails()` reads it defensively.
- **Card row mapping:** `card_type` is the category (POKEMON / TRAINER / ENERGY), `colors` the German type
  names, `power` the HP, `skill` the abilities and attacks as text, `rarity` as printed.
- **Prints** carry `ct_blueprint_id` and the four `market_*` columns (`src/db/schema.ts`). Migration:
  `drizzle/0063_shocking_ronan.sql`.
- **Language is on the lot**, not in the id: `owned_cards.language` is `DE` or `EN`
  (`PokemonLotLanguage` in `collection.ts`). Condition is not tracked.
- **Other columns:** `decks.format` (`standard` | `expanded`), `players.home_game` (below) and the
  `card_photos` table.
- A row nobody refers to any more stays. The nightly refresh only re-reads cards something refers to.

## The three verbs

The same three actions on a card in every Pokémon screen (`design.md` §1):

| Verb | Action (`src/app/pokemon/actions.ts` unless noted) | Writes |
|---|---|---|
| Hab ich | `addPokemonLotAction`, `setPokemonOwnedAction` | `owned_cards` lots, via `ensurePokemonCard` |
| Wunsch | `togglePokemonWishAction` | `want_list` |
| Ins Deck | `addPokemonToDeckAction`; deck actions in `src/app/pokemon/decks/actions.ts` | `deck_cards` |

The data effects are in `src/lib/pokemon/collection.ts` and `deck-data.ts`, which take the `db` and the
viewer so the scripts can run them on PGlite. Every Server Function opens with `requireSignedIn()`;
`assertPokemonDeck` checks that the deck is the viewer's (or that the viewer is an SL) and is a Pokémon deck.

## Legality and formats

- `legality(rows, "pokemon", format)` (`src/lib/decks/legality.ts`) dispatches on
  `GAME_INFO.pokemon.deck.ruleset` to `src/lib/decks/pokemonLegality.ts`. It labels and never blocks.
- Rules: 60 cards, no Leader or Z-Deck, at most 4 per card **name**, basic Energy unlimited, one ACE SPEC
  and one Radiant, at least one Basic Pokémon. A card's legality for the format comes from
  `details.legal[format]`; no data is a warning, never a guess.
- The format is set with `setDeckFormatAction` (`src/app/decks/actions.ts`). A new Pokémon deck starts
  in `standard`.
- Screen logic: `src/lib/pokemon/deck-logic.ts` (size text, short issue lists, missing copies, the one
  refusal for a built deck). Pasted lists: `decklist.ts` (parser and resolver), `deck-source.ts` (set
  codes through TCGdex), `deck-data.ts` (`importPokemonDeckList`).
- Reservations are unchanged: `reservations.ts` counts the deck owner's copies only, and a built deck over
  its copies is refused (`collection-and-decks.md`).

## Input

- **Voice** (`src/app/pokemon/add/voice/page.tsx`, `src/components/pokemon/PokemonVoiceAdd.tsx`). Recognition
  is the browser's, through `src/lib/scan/speech.ts`. The language is `de-AT` on the German screens, with a
  DE / EN switch; `src/lib/scan/speech-lang.ts` remembers the last choice per device. `parseSpokenPokemon`
  (`voice.ts`) returns ordered interpretations, each a search query; the first one that finds cards is
  used. Server side:
  `resolveSpokenPokemonAction` (`src/app/pokemon/add/actions.ts`).
- **Photo** (`src/app/pokemon/add/photo/page.tsx`, `src/components/pokemon/PokemonPhotoAdd.tsx`). The browser
  downscales the image (`src/lib/scan/downscale.ts`). "Eine Karte" posts it to `POST /api/pokemon/scan`:
  `handlePokemonScan` (`src/lib/pokemon/scan.ts`) calls `readPokemonPhotoTiered` (`src/lib/ai/scan.ts`) with the
  Pokémon prompt and schema in `src/lib/ai/scan-prompts.ts`, recorded in the ledger as `scan_identify` with
  `game: "pokemon"`; each read is then matched live (`matchPokemon` in `scan-match.ts`: exact, likely, unsure or
  none). Candidates are shown; nothing is stored until the child confirms, and a single card stays unpersisted.
- **A binder page ("Ganze Seite") is a kept scan batch** (`src/lib/pokemon/scan-batch.ts`, screen
  `PokemonPageBatch.tsx`), so a page started on the phone is finished on the PC.
  - *Storage.* It reuses `scan_batches` (`game = "pokemon"`, `mode = "batch"`, `owner`, `deck_id`), `scan_photos` and
    `scan_items`, with three additive columns (migration `0064`): `scan_batches.game` (default `dbs`) and, on the item,
    `variant`, `language` and `saved_at`. An item's `detection` holds the `PokemonScanDetection` with its candidates as
    live-source hits (name, set, number, image), so the review draws without a network round trip; `chosen` is the
    chosen hit, `include` says confirmed or left out, `printId` stays null (a Pokémon card has no local row until it is
    stored) and `saved_at` marks an item already written. The Dragon Ball lists, review and completion look at
    `game = "dbs"` only, and `completeBatch` refuses a Pokémon batch.
  - *Flow.* `POST /api/pokemon/scan/batch` stores the photo first (`addPokemonPhoto`), then reads it
    (`readPokemonPhoto`, a failed read marks the photo `error` and is retried from the stored bytes, no phone needed).
    Several photos join one open page (`ensurePokemonBatch`: the viewer's newest open Pokémon batch). Every edit is
    saved as it is made (`updatePokemonScanItemAction`); the screen reloads when the tab comes back to the front.
    An open page is offered on `/pokemon/add` and `/pokemon/add/photo` (`pokemonBatchOffer`, `BatchOfferCard`:
    "Du hast noch eine angefangene Seite: n Karten", Weitermachen / Verwerfen); `?batch=<id>` opens one page.
  - *Save.* `completePokemonBatch` writes each confirmed item through `addPokemonLots` (`ensurePokemonCard` and one lot
    per copy, stamped with the **batch owner** even when an SL completes it, variant and language on the lot, the
    batch's deck if one was chosen). An item is claimed (`saved_at`) before it is written and released if the write
    fails, so a second tap never adds a card twice; a failed card keeps the page open. When nothing failed, the photo
    bytes are set to null and the batch is closed; the items stay, marked saved, as the record. "Verwerfen" deletes the
    batch with its photos and items.
  - *Access.* The batch, photo and item ids are checked with the helpers in `src/lib/auth/ownership.ts`
    (`assertOwnBatch` and `ownsScanPhoto` take an optional `db` so the script can run them on PGlite); another
    player's id, a missing id and a Dragon Ball batch all answer `PokemonBatchNotFound` (404 on the route). An SL may open any.
    The photo is served by the existing `GET /api/scan/photo/[id]`.
- **Undo** on the voice and photo screens takes back the copies of one line *and* the copies that line put into the
  chosen deck (`undoPokemonDeckAdd`, `undoPokemonDeckAddAction`): the deck line goes down by what the add put in, never
  below what the deck held before it (`addPokemonLots` returns `deckBefore`), so a deck she changed since keeps its other edits.
- Paid calls run only when someone scans. The tests make no model call (`pokemon-input.mts`, `pokemon-scan-batch.mts`:
  the read and the search are stubbed through the `deps` seam of `identifyPokemonCards`).

## Wishes, CardTrader and the cart

- A wish is a `want_list` row for the player. `/cart` shows a player their own wishes; an SL opens a
  player's with `?for=<owner>` (`src/app/cart/page.tsx`, `wishesOf` in `src/lib/marketplace/wishes.ts`).
  "Mark as bought" (`markBoughtAction` in `src/app/cart/actions.ts`, SL only) calls `markWishBought`:
  lots stamped with the wishing player's owner name, price in EUR, in one transaction.
- **Listings** for a Pokémon card come from `refreshPokemonListings` (`src/lib/marketplace/cardtrader-pokemon.ts`),
  by `card_prints.ct_blueprint_id`, through `refreshListingsForCard` in `cardtrader.ts`. There is no
  blueprint sync for Pokémon.
- **The id mapping is unproven.** TCGdex's CardTrader number is assumed to be a blueprint id. The code has
  a direct path and a fallback by expansion and collector number, and stores the corrected id on the print.
  Prove it with a token: `scripts/pokemon-ct-check.mts` (read-only; prints MATCH or MISMATCH). Until it has
  run, treat any Pokémon listing as unverified. Detail: `catalog-and-sync.md`, "Pokémon: CardTrader".
- Filters: `?lang=de|en` and `?cond=` apply to Pokémon listings only (`applyListingFilter` in `cart.ts`).

## Prices

- No TCGplayer product for Pokémon. `pricesForPrints` (`src/lib/pricing/queries.ts`) returns
  `card_prints.market_cents`, which is **Cardmarket EUR**, as `eurCents`. `marketValueOf` uses it without
  conversion; Dragon Ball prints stay USD x the ECB rate.
- Pokémon keeps no price history, so movers are TCGplayer-only.
- The nightly `/api/sync/prices` calls `refreshPokemonCards` (`store.ts`) after the Dragon Ball price sync,
  for referenced cards only, within a 90 s budget.

## Own photos

- `src/lib/collection/photos.ts` (all games): WebP or JPEG, at most 400 KB, one per print and owner, and a
  per-owner ceiling of `MAX_PHOTOS_PER_OWNER` (1000, a constant; the owner cannot raise it from the app).
- The browser crops and scales to 750 px (`src/components/PhotoOverride.tsx`). `saveCardPhotoAction` and
  `removeCardPhotoAction` (`src/app/cards/photo-actions.ts`) store it. `CardImage` takes a `photoId`
  (`src/components/CardImage.tsx`) and `GET /api/card-photo/[id]` serves it with an immutable cache, so a
  new upload has a new URL.
- Proof: `scripts/verify/card-photos.mts` (PGlite).

## Home game and navigation

- `players.home_game` is `pokemon` or null (Dragon Ball). It is set by an SL in **Settings → Users & access**
  (`src/app/settings/access/`, `AccessAdmin.tsx`): `setPlayerHomeGameAction` (`src/app/settings/access/actions.ts`)
  calls `setPlayerHomeGame` (`src/lib/auth/access.ts`).
- It reaches the viewer with each request (`getViewer()`, `currentHomeGame()` in `src/lib/auth/index.ts`).
  It changes navigation and the landing page only, not what a player may see.
- `/` (`src/app/page.tsx`) sends a Pokémon player to `/pokemon`. `usesPokemonNav` (`src/lib/navigation.ts`)
  picks the Pokémon tabs for that player, and for anyone inside `/pokemon`. An SL keeps the Dragon Ball
  navigation with one `POKEMON_SL_ENTRY` link; a Pokémon screen links back with `DRAGON_BALL_ENTRY`.
- The tabs (`POKEMON_NAV_ITEMS`): Sammlung, Entdecken, Hinzufügen (raised), Decks, Wünsche. A player's phone
  menu holds `/me` only (`POKEMON_PLAYER_MENU`). `AppShell` (`src/components/AppShell.tsx`) draws them.
- The installed app's start URL is `/?source=pwa` (`src/app/manifest.ts`). For a Pokémon player that
  lands on `/pokemon`; for everyone else on `/arena`.

## Skin and copy

- `src/app/pokemon/layout.tsx` sets `data-skin="pokemon"` and `lang="de"` on the Pokémon pages. The tokens
  are the `[data-skin="pokemon"]` block in `src/app/design-system.css`; the scene is
  `public/themes/route-meadow.webp`; the accent is `GAME_INFO.pokemon.art.accent`. Deck styles are
  `src/components/pokemon/pk-decks.css`.
- Every German sentence of the screens is in `src/lib/pokemon/copy.ts` (`PK`), and the add screens' in
  `src/lib/pokemon/copy-input.ts`. The German Claude labels are in `src/lib/ai/games/labels-de.ts`.
- Viewer: `src/components/CardSwipeViewer.tsx` is generic. `PokemonViewer.tsx` fills it with the three
  verbs; `CardViewer.tsx` uses it on `/cards` and `/collection` for the Dragon Ball games.
- **Zoom** is in the generic viewer, so every game has it: double tap or double click 2.2x on the card under
  the finger, pinch (or ctrl + wheel) 1x to 4x, drag to pan, `+` `-` `0`; zoomed, the rail does not scroll
  and Escape or the close button zooms out first. The state is a pure reducer, `src/lib/viewer-zoom.ts`
  (`pokemon-polish.mts`). No animation under `prefers-reduced-motion`.
- **Detail column:** `detailColumn` on `CardSwipeViewer` shows the detail as a fixed right column from `lg`
  instead of the sheet (Pokémon viewer, `/cards`, `/collection`).
- **Evolutions** ("Entwickelt sich aus / zu", tappable pictures) load lazily when the detail opens, from
  `GET /api/pokemon/card/[id]/evolutions`. `src/lib/pokemon/evolutions.ts` owns the read: evolves-from is
  `details.evolveFrom` found through the live search (same set first, else the newest printing with a
  picture), evolves-into is TCGdex's `evolveFrom` filter (moved here from `pokemon-source.ts`, which now
  imports it). A source that is down means no section. A tapped card not in the list is added to the end
  of it for that viewer session (`ctx.jumpTo`).
- **Wish reason line:** `/pokemon/wishes` says "fehlt im Deck „X“ (und n weitere)". It is derived from her
  decks against her copies (`wishReasons` in `deck-logic.ts`, read in `pokemonWishes`), not from
  `want_list.deck_id`, which keeps only the deck of the first wish.
- **Source down:** the search page and the set tiles share `DownPanel` (`DiscoverScreen.tsx`): a retry button, "Kein
  Internet" while the browser is offline, and one automatic retry when the network is back.
- `/decks` (English, shared) links a Pokémon deck to `/pokemon/decks/<id>` and shows its format (`deckListLink`).
- The stat list of the shared card page is per game (`src/lib/catalog/card-stats.ts`).

## Offline reading

- `public/sw.js` keeps the last-seen `/pokemon`, `/pokemon/wishes`, `/pokemon/decks` and
  `/pokemon/decks/<id>` for one person at a time (`x-card-who`, see `auth.md`). The page list is also in
  `src/lib/offline-pages.ts`. Full detail: `collection-and-decks.md`, "Offline reading".
- Adding and editing need a connection, and the screens say so.
- The image hosts are listed twice: `next.config.ts` `images.remotePatterns` and `ART_HOSTS` in `public/sw.js`.
  `scripts/verify/image-hosts.ts` fails `npm test` when they differ.

## The Claude adapter

- The Pokémon adapter is `src/lib/ai/games/pokemon.ts`, one of the three adapters found by `adapterFor` in
  `src/lib/ai/games/index.ts`. Its card source is `pokemon-source.ts`: the viewer's own stored cards, plus
  three lookup tools over TCGdex (`search_cards`, `evolves_from`, `get_card`).
- `pokemon-build.ts` cleans a model's deck draft (4 by name, one ACE SPEC and Radiant, never more than 60)
  and stores any new card with `ensurePokemonCard`. `pokemon-around.ts` builds the free deterministic draft
  "Neues Deck mit dieser Karte" without a model.
- The shared screen is `src/components/NewDeckWithClaude.tsx`. Detail: `ai.md`, "Per-game adapter".
- **A card the model adds comes with its name, and the id is checked against it**
  (`src/lib/ai/games/pokemon-names.ts`): a real id that is another card is resolved by name at the live source
  (`cardForName`, preferring a printing legal in the deck's format) or the entry is dropped. The model may give
  a well-known card by its English name and an empty id. Reads of the source in these paths are retried
  (`withSourceRetry`); a source that stays down ends a build with `SOURCE_DOWN`, never a half deck.
- A draft up to six cards short is topped up with its basic Energy (`topUpEnergy`); the wizard keeps the ten
  most important swaps (`MAX_SWAPS`). Lookups run in three rounds of eight (`src/lib/ai/tools.ts`); the deck
  pages allow 300 s.
- `scripts/pokemon-ai-live.mts --yes` is the live run of all of this against real models (paid; the owner's to
  ask for). What the first one found: `docs/pokemon/plan.md` §13.

## Tests

Run by `npm test` (PGlite, recorded or stubbed network, no model call, no CardTrader call):

| Script | Covers |
|---|---|
| `scripts/verify/pokemon-tcgdex.mts` | Id helpers, mappers, the German and English search merge, the collector-number query, source errors, `ensurePokemonCard`, the nightly refresh; recorded responses in `scripts/verify/fixtures/pokemon/` |
| `scripts/verify/pokemon-input.mts` | Spoken parser, card-id reader, photo matcher |
| `scripts/verify/pokemon-scan-batch.mts` | The kept binder page: stored photo, canned detection, edits, reopening as the same owner, another player refused, completing (owner, variant, language, deck, photos dropped), retry without duplicates, discard, the deck undo, and a Dragon Ball batch untouched |
| `scripts/verify/pokemon-decks.mts` | Deck data, legality, pasted lists, the built refusal |
| `scripts/verify/pokemon-cart.mts` | Wishes, mark as bought, listings with CardTrader stubbed (a synthetic fixture, not a recording) |
| `scripts/verify/pokemon-polish.mts` | Viewer zoom reducer, the choice of evolution cards (stub source), the wish reason line, the `/decks` link |
| `scripts/verify/card-photos.mts` | Own photos: save, replace, limits, scope |
| `scripts/verify/offline-reading.mts` | `public/sw.js` routing and privacy for the Pokémon pages |
| `scripts/verify/ai-games.mts` | The adapter; Dragon Ball requests byte for byte against `scripts/verify/fixtures/ai-games/` |
| `scripts/verify/image-hosts.ts` | `next.config.ts` against `ART_HOSTS` |
| `scripts/verify/guards.ts` | A guard on every new Server Function and route |

Not verified by any of these: a real phone, real speech recognition, a real model run on a Pokémon
photo or deck, a real TCGdex call from production, and a real CardTrader call (`pokemon-ct-check.mts`
needs the owner's token).
