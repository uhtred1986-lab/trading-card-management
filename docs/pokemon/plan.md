# Pokémon in the collection, deck and buying screens: plan

Status: **built, 14 Nov 2026**. The decisions were taken the same day, before the build (owner's
answers are in §9; the **(Q n)** marks point at them). The look and the flows are in `design.md` beside
this file. What the build changed is in §13; the code map is `docs/architecture/pokemon.md`.

## 1. Goal

The owner's daughter keeps her **Pokémon TCG** collection and her decks in this app on her phone,
finds cool cards and builds new decks around them, with Claude's help, and marks what she wishes for. The owner buys
those cards on CardTrader with the existing cart optimiser.

In scope: collection, live card search and browsing, decks with real format legality, the Claude
deck features, wishes, CardTrader buying, voice and photo input, photo override of a card's picture.
No trading feature (owner: "trading" meant buying). Out of scope: the arena, meta, leaders,
set review, news and the rules screens (Pokémon gets `arena: false` and none of those tabs).

## 2. What the owner asked for, and how the plan answers it

| Requirement | Answer |
|---|---|
| Only owned cards stored locally (the pool is ~20,000 cards per language) | No Pokémon catalog import. A card gets a row in `cards` / `card_prints` only when something refers to it: a lot, a deck line or a wish (§4). |
| Other screens load cards live while searching | Search and browse call **TCGdex** through one server route with a one-day cache (§3). |
| Phone first, above all for looking through cards | 2-column grid with endless scroll and a full-screen swipe viewer (`design.md` §3). |
| A card's picture can be replaced by a phone upload | `card_photos` table, shrunk in the browser, shown in place of the catalog image (§5). |
| Input by reading aloud or by photo | German voice entry by name or number, and the existing scan pipeline with a Pokémon prompt (§6). |
| Daughter records collection and decks, builds decks from cool cards | Pokémon deck rules with Standard / Expanded legality, "build around this card", and the Claude deck features made game-neutral (§7). |
| Owner buys through CardTrader | Wishes and deck shortfalls flow into `/cart`; an SL can open a player's wishes (§8). |

## 3. Card data source: TCGdex

Probed from this session on 14 Nov 2026 (`api.tcgdex.net/v2/{lang}/…`, no key, no SDK needed):

- German and English card data: name, category (Pokémon / Trainer / Energy), types, HP, stage,
  `evolveFrom`, attacks, weakness, retreat, rarity, `regulationMark`, `legal.standard` /
  `legal.expanded`, set with official card count, `dexId`.
- Name search with paging (`?name=like:Pika&pagination:page=…`), filter by set, type, legality.
- Images at `assets.tcgdex.net` (`…/low.webp` was 27 KB, `…/high.webp` for the viewer).
- Per variant (normal, holo, reverse): a **CardTrader id**, a Cardmarket id with **EUR prices**
  (low, trend, 7- and 30-day average) and a TCGplayer id. The Cardmarket EUR price removes the USD
  conversion for this game.

`pokemontcg.io`, the usual alternative, answered 503 during the probe and is English only.

Two things a worker proves first, because the plan leans on them:

1. That TCGdex's `thirdParty.cardtrader` number is a CardTrader **blueprint id** usable with
   `marketplace/products?blueprint_id=` (needs the CardTrader token; one read call). **Still
   unproven** (lane F had no token). Both paths are built: the direct id, and a fallback by CardTrader
   expansion and collector number that stores the corrected id on the print. Run the proof by hand:
   `CARDTRADER_API_TOKEN=… CARDTRADER_ENABLED=true npx tsx scripts/pokemon-ct-check.mts PKM-sv03.5-006`
   (or a blueprint id with `--name` / `--number`); it is read-only and prints MATCH or MISMATCH for
   name and collector number. Detail: `docs/architecture/catalog-and-sync.md`.
2. German coverage of the newest sets.

Her cards are German and English mixed (Q 2), so the search asks TCGdex in **both languages** and
merges by card id: "Glurak" and "Charizard" find the same card. The tile shows the name in the
language that matched; a language chip (DE / EN) on "Hab ich" records which printing she owns.

## 4. Data model: "materialise on reference"

`owned_cards`, `deck_cards`, `want_list` and `ct_listings` all point at `cards` by foreign key.
Keeping that is what lets reservations, the cart and the optimiser work for Pokémon unchanged. So:

- **`ensurePokemonCard(tcgdexId, lang)`** fetches the card from TCGdex and upserts one `cards` row
  and one `card_prints` row per variant, inside the same transaction as the lot, deck line or wish
  that needs it. It is the only writer of Pokémon rows in `cards`.
- Card id: `PKM-` + TCGdex id (`PKM-sv03.5-006`), one card whatever the language; print id adds
  the variant (`PKM-sv03.5-006_holo`). The language of a copy is the lot's existing
  `owned_cards.language`, so a German and an English copy are told apart without a second print. Variants are tracked apart, condition is not (Q 8). The prefix
  keeps the id space apart from Bandai's. The card row keeps both names (`details.names`).
- Column mapping: `card_type` = POKEMON / TRAINER / ENERGY, `colors` = types, `power` = HP,
  `skill` = abilities and attacks as text, `rarity` as printed. Everything else Pokémon-specific
  (stage, `evolveFrom`, attacks, weakness, retreat, regulation mark, legality, dex number, language,
  third-party ids) goes into one new nullable **`cards.details jsonb`**.
- Additive only, from `db:generate` (migration 0063): `cards.details`, `card_prints.ct_blueprint_id`
  and the four `market_*` price columns, `decks.format`, `players.home_game`, and the `card_photos`
  table. Nothing existing changes shape.
- A card nobody refers to any more stays as a row (deleting catalog rows is not worth a destructive
  path); a nightly refresh skips them.
- Because Pokémon rows are written at request time, `ensurePokemonCard` expires the catalog cache
  tag (the hard rule for a new writer of a cached table).

Size: a few hundred to a few thousand rows for one child's collection, against 20,000+ for an import.

## 5. Pictures replaced from the phone

- New table `card_photos` (print id, owner, `data bytea`, mime, created). Same storage pattern as
  `scan_photos`, so **no new dependency and no Vercel setting**.
- The browser shrinks the photo on a canvas to about 750 px wide WebP (60 to 100 KB) before upload;
  the server refuses anything over 400 KB.
- `GET /api/card-photo/[id]` serves it with a long cache and an id that changes on re-upload.
  `CardImage` takes the photo when one exists, else the catalog image.
- "Local" means stored in the app's database, as opposed to loaded live (Q 4). One photo per print
  and owner; "Original wiederherstellen" removes it. An SL sees a player's photo on that player's
  cards, as with lots.
- Works for the Dragon Ball games as well, at no extra cost.

## 6. Input: voice and photo

**Voice** (free, on the device, no audio uploaded):
- `startListening` already takes a language; Pokémon uses `de-AT` with a DE / EN switch on the
  screen, since her cards are mixed (Q 2).
- The child says a name ("Glurak ex") or a number ("sechs von hundertfünfundsechzig"). The text goes
  to the live search; number and set size narrow it. The answer is a row of pictures to tap, never a
  silent guess, since one name has dozens of printings.
- After a tap: big ± for the quantity, variant chips (normal / holo / reverse), then the mic
  reopens. Same loop shape as quick capture.

**Photo** (uses the existing paid scan pipeline at run time, as the Dragon Ball scan does):
- `src/lib/ai/scan.ts` gets a per-game system prompt and instruction. For Pokémon the model reads
  name, collector number (`006/165`), set code and regulation mark from the bottom edge.
- Matching: number + set size + name against TCGdex instead of the local `cards` table, then
  `ensurePokemonCard` on confirm.
- A binder page (9 cards in one photo) goes through the existing scan batch; a single card through
  quick capture.
- Building and testing this needs no paid call: the matcher is tested on recorded detections. One
  real photo test is the owner's to ask for.

## 7. Decks

- `GAME_INFO.pokemon.deck`: exactly 60 cards, no leader, no Z-Deck, 4 copies **by card name**
  (not by number), basic Energy unlimited, ACE SPEC and Radiant one per deck, at least one Basic
  Pokémon.
- **Real format legality** (Q 7): each deck has a format, Standard (default) or Expanded. A card
  outside the format is flagged from TCGdex's `legal` flags and regulation mark, refreshed nightly
  for referenced cards so a rotation shows up without a deploy.
- `legality(rows, game)` keeps its contract: it labels, it never blocks. Pokémon gets its own branch
  rather than more conditions in the leader-and-Z-Deck code.
- Deck builder: groups are Pokémon / Trainer / Energy; the card picker searches live and offers
  "from my collection" first.
- **Build around this card**: from a card the child likes, propose its evolution line
  (`evolveFrom`, searched live), Energy of its type and Trainers she owns, as a draft deck she
  edits. Deterministic and free.
- **Claude, built now and shared** (Q 6): deck analysis, the wizard and "Build a deck with Claude"
  become game-neutral instead of getting Pokémon copies. Each game supplies, through `GAME_INFO`
  and one small adapter, its prompt name, its deck rules as text, how a card is described to the
  model, and its **card source** (local catalog for the Dragon Ball games, live TCGdex search as a
  tool for Pokémon). Provider routing, the ledger and the UI components stay single. The hardcoded
  `dbs` / `fusion` options in `NewDeckWithClaude` go. These are paid calls at run time, as today;
  building and testing them uses recorded responses, and a live smoke test only on the owner's ask.
- Reservations, built vs. virtual decks and the over-reserve refusal apply unchanged.

## 8. Wishes, trading and buying

- **Wish**: a heart on any card in search, viewer or deck writes `want_list` for the child.
- **Owner's view**: `/cart` for an SL gains "Wünsche von ‹user name›" (owner's wording), one
  entry per player who has wishes. Today an SL sees a player's
  decks but not their wishes, so this closes a real gap for the Dragon Ball games too.
- **CardTrader**: Pokémon is a separate CardTrader game with far too many blueprints to sync.
  Instead the blueprint id arrives with the card from TCGdex (§3) and listings are fetched per
  wished card, as `refreshListingsForCard` does now. Filters: language **(Q 2)**, condition, EUR,
  seller country. The optimiser itself is already game-neutral.
- **Prices**: Cardmarket EUR from TCGdex for owned and wished cards only, refreshed by the existing
  06:00 price cron. She sees prices and the cart like any player (Q 3); cart shipping settings stay
  SL-only as today.
- No trade list (Q 5).

## 9. Decisions (owner, 14 Nov 2026)

1. **User:** she is 12 and has her own phone; she gets a player account of her own by one-time
   join code, as the app already does (`/join?c=CODE`; owner: "as in Gullet Cove").
2. **Language:** her cards are German and English mixed, so search, voice and buying handle both.
   The Pokémon screens speak **German**; the Dragon Ball screens stay English.
3. **Money:** she may see prices.
4. **Photo override:** "local" meant stored in the app's database, not live from the API.
5. **Trading:** meant buying only. No trading feature.
6. **Claude:** built in this delivery, by making the existing Claude features game-neutral and
   reusing them.
7. **Format:** real legality.
8. **Variants** tracked apart; **condition** not needed.
9. **Start screen:** per-user home game, opening on her collection.

## 10. Code improvements proposed alongside

From the code map made for this plan. Items 1 to 4 are needed for Pokémon anyway; 5 to 8 are worth
doing while the files are open; 9 to 11 were suggestions. **All eleven are in this delivery** (owner,
14 Nov 2026).

1. **Per-game capabilities in `GAME_INFO`**, not branches. About 25 places test for `"fusion"` or
   `"dbs"` (card types, colours, deck zones, stat labels, external links, catalog and price source).
   Moving these into `GAME_INFO` makes the third game data, and a fourth one cheap.
2. **Sync loops ask for the games that have that source.** `syncCatalog`, `syncPrices` and the meta
   sync iterate all of `GAMES` with `Record<Game, …>`; Pokémon has no deckplanet path or tcgcsv
   category. A `catalog.kind` of `sync` or `live` replaces the assumption.
3. **`gameOr` and `gameOfSetCode` fall back to `"dbs"` silently.** With a third game an unknown
   value should be an error in tests and a visible "unknown game" in the UI, not Dragon Ball.
4. **Card detail and tiles driven by a per-game stat list** (Energy / Power / Combo today) instead of
   fixed fields, so `cards/[id]` and `CardTile` need no game checks.
5. **SLs can open a player's wishes** (§8).
6. **Image hosts listed once.** `next.config.ts` `remotePatterns` and `public/sw.js` `ART_HOSTS`
   repeat the same list by hand; generate the second from the first.
7. **Voice language per user**, not the `en-US` default.
8. **The PWA name and start URL** ("DBS Card Companion", `/arena`) become neutral, with the start
   screen chosen per user.
9. **One game-neutral Claude layer** (§7), so prompts, tools and deck rules for a game live in one
   adapter and a fix to the wizard reaches every game.
10. **One reusable swipe viewer.** Built here for Pokémon, then offered on `/cards` and `/collection`
   for the Dragon Ball games.
11. **Collection and decks offline.** Only the arena works offline today; a child's phone is often
    without signal. In this delivery (lane J): the service worker keeps the last-seen collection,
    decks, wishes and their card pictures readable without a network; adding and editing still need
    one and say so.

## 11. Delivery: one run, one PR

Owner's wish: cheaper models do the work in one go and one PR, with a stronger model coordinating.

- **Coordinator:** this session (it holds the plan, the code map and the owner's answers), or an
  Opus session started from these two files if this one is gone. The coordinator writes the
  foundation commit and the briefs, reviews every diff against its acceptance, integrates and runs
  the gate. It writes no feature code beyond the foundation.
- **Workers:** Sonnet, the repo's default for UI, features and tests. Haiku for the docs and
  bookkeeping lane. At most three at a time, each in its own worktree, each told it is a worker.
- **One integration branch, one PR.** Workers branch from the integration branch and the coordinator
  merges their branches into it. This departs from "one PR per issue" in `docs/agent-brief.md` on
  the owner's instruction; the PR lists the lanes and their evidence one by one instead.

| Wave | Lane | Model | Owns (hot files in bold) |
|---|---|---|---|
| 0 | Foundation: third game in **`games.ts`**, capability fields, **`schema.ts`** + generated migration, id helpers, fix every `Record<Game>` so typecheck is green | coordinator | serial, before anything else |
| 1 | A. TCGdex client, `/api/pokemon/search`, `ensurePokemonCard`, cache tag | Sonnet | `src/lib/pokemon/*` (new) |
| 1 | B. Pokémon legality, zones, `add.ts`, deck queries | Sonnet | **`legality.ts`**, `decks/*` |
| 1 | C. Photo override: table use, upload action, route, `CardImage` | Sonnet | `CardImage.tsx`, new route |
| 2 | D. Browse grid, swipe viewer, home game, navigation, German copy | Sonnet | `src/app/pokemon/*` or game-aware `/cards`, **`navigation.ts`** |
| 2 | E. Voice (de-AT) and photo scan for Pokémon | Sonnet | `scan/*`, `ai/scan.ts` |
| 2 | F. Wishes for SL, CardTrader by blueprint id and language, EUR prices | Sonnet | `marketplace/*`, `cart/*` |
| 3 | G. Deck builder UI, format picker and "build around this card" | Sonnet | `DeckBuilder.tsx`, after B and D |
| 3 | I. Claude features game-neutral: per-game adapter, TCGdex search tool, analysis, wizard, "Build a deck with Claude" | Sonnet, coordinator reviews the adapter shape first | `src/lib/ai/*`, `NewDeckWithClaude.tsx`, after A and B |
| 3 | J. Collection, decks and wishes readable offline (service worker cache, offline notice) | Sonnet | `public/sw.js`, `ServiceWorker.tsx`, after D |
| 3 | H. Docs (`CLAUDE.md`, architecture pages), `verify-rules` / `verify-db` cases, guards | Haiku | docs, `scripts/verify*` |

Gate, once, on the combined head: `npm run checks -- full` with `--build`, `npm run shots:compare`
for every touched route at 390 and 1440, a live read against TCGdex, the CardTrader blueprint proof
(§3), and the migration SQL read for anything destructive. Merging deploys and migrates production,
so the PR stays a draft until the owner has seen the screenshots.

Needs the owner's say-so before the run: the go-ahead itself. The owner is reading the plan and
design first (14 Nov 2026). No new npm dependency, no
destructive migration and no Vercel setting. A paid photo-scan test only if the owner asks for it.

## 12. Risks

- **TCGdex is a community service.** One-day cache on every read, and owned cards never depend on
  it once materialised. If it is down, search says so; collection and decks keep working.
- **CardTrader id mapping** unproven until §3 step 1. Fallback: match by expansion and collector
  number, as the Dragon Ball crosswalk does.
- **German speech recognition of Pokémon names** is uneven. The tap-to-confirm row and the number
  path are the answer; a typed search stays one tap away.
- **`cards` now holds rows written at request time.** The catalog cache and the errata rule
  ("fixed in `errata.ts`, never by UPDATE") were designed for a synced catalog; lane A documents
  the Pokémon exception in `catalog-and-sync.md`.
- **Database size** from photos: about 100 KB each. A thousand overrides is 100 MB on Neon; the
  upload action counts and refuses beyond a ceiling the owner can raise.

## 13. Built: what differs from this plan

Written after the build (14 Nov 2026). Each line names the file that shows the difference. Lines marked
*partly* did not reach the whole of the plan item.

**Differences in the build**

1. **`ensurePokemonCard` takes `(db, tcgdexId, opts)`**, not `(tcgdexId, lang)`. It reads both languages
   and also writes the set row `card_sets` (`PKM-<setId>`, `line = "pokemon"`), which §4 did not list.
   `src/lib/pokemon/store.ts`.
2. **`legality(rows, game, format)`** takes the deck's format. §7 kept `legality(rows, game)`.
   `src/lib/decks/legality.ts`.
3. **The Pokémon scan prompt** is in `src/lib/ai/scan-prompts.ts` (`scanPromptFor`), not in `src/lib/ai/scan.ts`,
   which carries only the Pokémon read (`readPokemonPhoto`). §6 put it in `scan.ts`.
   `src/lib/ai/scan-prompts.ts`, `src/lib/ai/scan.ts`.
4. **A binder-page photo is a kept scan batch** (closed after the first build, lane K2, 14 Nov 2026). The first build
   kept the page only in the screen, because the scan-batch tables assumed local catalog cards. It now reuses
   `scan_batches`, `scan_photos` and `scan_items` with three additive columns (`scan_batches.game`, `scan_items.variant`,
   `language`, `saved_at`; `drizzle/0064_*.sql`), the Pokémon detection and chosen hit living in the existing jsonb columns,
   so a page started on the phone is finished on the PC as §6 said. A single card stays unpersisted (quick capture).
   `src/lib/pokemon/scan-batch.ts`, `src/components/pokemon/PokemonPageBatch.tsx`, `src/app/api/pokemon/scan/batch/route.ts`.
5. **CardTrader has two paths**, a direct blueprint id and a fallback by expansion and collector number that
   stores the corrected id on the print. §3 step 1 asked for the id to be proved first. **The mapping is
   unproven**: `scripts/pokemon-ct-check.mts` has not been run with a token. `src/lib/marketplace/cardtrader-pokemon.ts`.
6. **Printed set codes and letter collector IDs** ("MEW 006/165", "SWSH062", "TG12/TG30") are understood in
   search, voice and the photo match. §3 and §6 did not list them. `src/lib/pokemon/card-id.ts`,
   `src/lib/pokemon/voice.ts` (`spokenCodeLetters`), `src/lib/pokemon/scan-match.ts` (`parsePrintedNumber`).
7. **The photo ceiling is a constant**: `MAX_PHOTOS_PER_OWNER = 1000` in `src/lib/collection/photos.ts`. §12
   said the owner could raise it; no screen does that. The browser still scales the photo to 750 px wide
   (`src/components/PhotoOverride.tsx`) and the server refuses over 400 KB.
8. **The Claude card source adds a tool**: the model gets the viewer's own cards plus three TCGdex lookups
   (`search_cards`, `evolves_from`, `get_card`). §7 named only a live search. `src/lib/ai/games/pokemon-source.ts`.
9. **Language on the lot** is as §4 planned (`owned_cards.language`, `DE` or `EN`); the print id carries only
   the variant. `src/lib/pokemon/types.ts`, `src/lib/pokemon/collection.ts` (`PokemonLotLanguage`).

**§10 improvements, as built**

10. Item 1, per-game fields in `GAME_INFO`: *partly*. `GAME_INFO` holds the game's catalog kind, screen
    language, card types, deck rules and art. Game tests remain in `src/lib/marketplace/cardtrader.ts`,
    `src/lib/pricing/tcgcsv.ts`, `src/lib/catalog/deckplanet.ts`, `src/app/decks/[id]/page.tsx` and the arena
    files (`grep -rn 'game === "' src`).
11. Item 2, sync loops over `SYNCED_GAMES`, and `catalog: "sync" | "live"`: done. `src/lib/catalog/games.ts`,
    `src/lib/catalog/deckplanet.ts`, `src/lib/pricing/tcgcsv.ts`, `src/lib/meta/sync.ts`.
12. Item 3, unknown game: *partly*. `strictGame` throws on unknown values for write paths; `gameOr` still falls
    back to Dragon Ball on reads. `src/lib/catalog/games.ts`.
13. Item 4, per-game stat list: *partly*. `cardStats` (per game) drives the shared card page;
    the tile components were not part of this check. `src/lib/catalog/card-stats.ts`,
    `src/app/cards/[id]/page.tsx`.
14. Item 5, SLs open a player's wishes: done. `src/app/cart/page.tsx` (`?for=`), `src/lib/marketplace/wishes.ts`.
15. Item 6, image hosts listed once: *partly*. The list is still written twice by hand; a test fails when
    `next.config.ts` and `ART_HOSTS` in `public/sw.js` differ. `scripts/verify/image-hosts.ts`.
16. Item 7, voice language: *partly*. The default follows the game's screen language and the last choice is
    remembered per device, not per user. `src/lib/scan/speech-lang.ts`.
17. Item 8, PWA name and start URL: done. The name is "Card Companion" and the start URL is `/?source=pwa`.
    The root `/` sends a Pokémon player to `/pokemon`; a `?source=pwa` launch goes to `/arena` for everyone
    else. `src/app/manifest.ts`, `src/app/page.tsx`.
18. Item 9, one game-neutral Claude layer: done. `src/lib/ai/games/index.ts`, `src/lib/ai/games/pokemon.ts`.
19. Item 10, one swipe viewer: done. `src/components/CardSwipeViewer.tsx`, used by `src/components/CardViewer.tsx`
    on `/cards` and `/collection`, and by `src/components/pokemon/PokemonViewer.tsx`.
20. Item 11, offline reading: done, with the limits in `docs/architecture/collection-and-decks.md`
    ("Offline reading"). `public/sw.js`, `src/lib/offline-pages.ts`, `scripts/verify/offline-reading.mts`.

**Gaps closed afterwards** (the polish lane; each was reported against `design.md`)

21. Zoom in the swipe viewer (§3 "double tap: zoom"): done, in the generic viewer. `src/components/CardSwipeViewer.tsx`, `src/lib/viewer-zoom.ts`.
22. Evolves from / into as tappable pictures in the detail sheet (§3): done. `src/lib/pokemon/evolutions.ts`, `src/app/api/pokemon/card/[id]/evolutions/route.ts`, `PokemonViewer.tsx`.
23. Desktop: the detail as a fixed right column from `lg` (§3): done for the Pokémon viewer, `/cards` and `/collection` (`detailColumn`).
24. The reason line on wishes (§8): done, derived from her decks and copies. `src/lib/pokemon/views.ts`, `deck-logic.ts`.
25. A Pokémon deck row on the shared `/decks` links to its German page and shows its format: done. `src/app/decks/page.tsx`.
26. Source down (§9): search and set tiles share a retry panel; offline says "Kein Internet". `DiscoverScreen.tsx` (`DownPanel`).
27. Desktop screenshots at 1280 px: `docs/pokemon/shots/*-1280.webp`; the viewer zoomed and the evolutions at 390 px.
28. **Undo on the voice screen also takes back the deck copies** that line added, never below what the deck held before.
    `undoPokemonDeckAdd` in `src/lib/pokemon/collection.ts`; the photo screen's single-card undo does the same.

**Not checked in this delivery**

- A real phone, real speech recognition, a real model run on a Pokémon photo or deck, and a real CardTrader
  call. The tests use recorded TCGdex responses (`scripts/verify/fixtures/pokemon/`), a stubbed `fetch` and a
  synthetic CardTrader fixture (`scripts/verify/pokemon-cart.mts`).
- Pinch and double tap on a real phone: they were driven with synthetic touch events in Chromium (items 21),
  and the Dragon Ball viewer's detail column was only compiled, no Dragon Ball cards being in the throwaway database.
- The mapping of TCGdex's CardTrader number to a blueprint id (item 5).
