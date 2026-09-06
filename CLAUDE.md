# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A single-user Next.js companion app for Bandai's two **Dragon Ball Super Card Game** products:
the original game (legacy BT1–BT25 plus the current Masters line) and **Fusion World**. Collection
tracking with market values, virtual vs. built decks with a reservation system, Claude-powered deck
analysis and card scanning, TCGplayer pricing, and a read-only CardTrader integration with a cart
optimiser. `dbs-tcg-app-feature-summary.md` is the original feature spec, written before Fusion
World was added.

**The two games are one app, kept apart by a `game` column** (`"dbs" | "fusion"`, see
`src/lib/catalog/games.ts`): it lives on `card_sets`, is denormalised onto `cards`, and is chosen
once per deck. Everything game-specific — catalog source, TCGplayer category, deck rules, how the
model is told which game it is looking at — is in `GAME_INFO`, so a query only ever needs the id.
Lists default to **both** games with a `GameFilter` chip row; nothing is mixed within a deck.
The **arena is the exception**: its engine reads the Masters rule manual and only plays `dbs`
decks (owner's decision, 4 Sep 2026).

Owner is in Austria: the display currency is EUR; TCGplayer prices are USD and converted at the
ECB rate stored in `fx_rates`. Price paid is entered in EUR.

**Auth is HTTP Basic Auth in `src/proxy.ts`** (same pattern as gullet-cove-dm), active only when
`BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD` are both set — they are set in Vercel for Production and
Preview, and deliberately *not* in `.env.local`, so local dev runs open. `/api/sync/*` is exempt
because the Vercel cron can't send credentials; it is guarded by `CRON_SECRET` instead. The web-app
manifest, `/icons/*` and `/sw.js` are exempt too — the browser fetches them without credentials, so
behind auth the app cannot be installed at all. Removing either variable exposes the whole database.

**Vercel's own deployment protection is ON for Preview** (verified 6 Sep 2026: a preview URL
redirects to `vercel.com/sso-api`). A preview therefore needs a Vercel login *as well as* Basic
Auth, which makes preview URLs awkward to open on a phone — a Cloudflare tunnel to a local
`npm run build && npm start` is the quicker way to test on a device.

## Commands

```powershell
npm run dev            # Dev server (port 3000, or 3001 if taken)
npm run build          # Production build
npm run typecheck      # tsc --noEmit
npm run lint           # ESLint
npm test               # scripts/verify-rules.ts (pure) + scripts/verify-db.mts (migrations + reservation rules on PGlite)
npm run contract:emit  # rewrite contract/fixtures/*.json after a deliberate Snapshot shape change
npm run android:test   # Kotlin round-trip of those fixtures, in Docker — no JDK on the machine
npm run db:generate    # Generate a migration after editing src/db/schema.ts
npm run db:migrate     # Apply migrations (also run on every Vercel deploy via vercel.json)
npm run sync:catalog   # Import both games' catalogs from deckplanet + Fusion World art from Bandai (~50 s)
npm run sync:prices    # Import TCGplayer products + today's prices from tcgcsv (both categories),
                       # the USD→EUR rate, and TCGplayer art for prints still without any (~35 s)
```

`npm test` needs no database or network. Everything else needs `DATABASE_URL` in `.env.local`,
except `android:test`, which needs Docker and nothing else — the Kotlin toolchain lives in a
container (`android/Dockerfile`) because the machine has no JDK, no Gradle and no Android SDK.
There is no test framework — both scripts are plain `assert` scripts run with `tsx`; extend them in
the same style.

## Data sources (verified 2 Sep 2026)

| What | Source | Notes |
|---|---|---|
| Card catalog | `https://api.deckplanet.net/cardsearch/{dbs_masters_cards,fusion_world_cards}?limit=100000` | One call per game; the `dragogodev/cgs` repo the spec names is only a *pointer* to the first. 6.5k cards for the original game, ~2k for Fusion World. Alternate prints appear as top-level entries **and** in `variants[]`; `shapeCatalog` collapses them to one card per base number + a print list. The Fusion World payload differs in three ways, all handled in `deckplanet.ts`: bare rarity codes ("SR", normalised to "Super Rare[SR]" by `normaliseRarity`), no character/era lists, and a numeric energy cost. |
| Card images | `https://storage.googleapis.com/deckplanet_card_images/{number}.png` | Hot-linked via `next/image`; a few prints 404 and fall back to a placeholder. **Fusion World is not in this bucket at all** — its art comes from Bandai's own card list, `https://www.dbs-cardgame.com/fw/images/cards/card/en/{number}.webp` (leaders `_f`/`_b`, alternate prints `_p1`, `_p2`…; no User-Agent or Referer check). `src/lib/catalog/bandai.ts` crawls the card list's series pages for the exact image names at catalog sync and only assigns URLs that exist, since deckplanet lists ~700 more alternate prints than Bandai shows. Whatever is still null afterwards gets the matched TCGplayer product photo (`_200w.jpg` rewritten to `_in_1000x1000.jpg`) from `fillMissingImages` during the price sync. The catalog upserts therefore `coalesce` `image_url` instead of overwriting it. |
| Leader back sides | deckplanet `{number}_b.png` (older sets only, HEAD-verified at catalog sync) → else CardTrader blueprint `back_image` (Masters-era sets, backfilled by the CardTrader sync); Fusion World leaders use Bandai's `{number}_b.webp`, inferred from the `_f` front and HEAD-verified the same way | Stored in `cards.back_image_url`; the catalog upsert `coalesce`s so a CardTrader back survives re-syncs. `CardFaces` shows front + awakened when present. |
| Prices | `https://tcgcsv.com/tcgplayer/{27,80}/...` | **Requires a browser-like User-Agent** (401 otherwise). Category 27 is the original game, 80 is Fusion World; 27 also carries a stray duplicate of Fusion World's FB01 group, which is skipped there. Products join to cards on the printed `Number`; SR+ cards only exist as a foil sub-type, so `priceForFinish` falls back foil↔normal — and the foil sub-type is called `Foil` in category 27 but `Holofoil` in 80 (`FOIL_SUB_TYPES`). |
| FX | `https://api.frankfurter.app/latest?from=USD&to=EUR` | Daily. |
| CardTrader | `https://api.cardtrader.com/api/v2` | **Read-only client**, and every live call is gated by `CARDTRADER_ENABLED=true` (the owner enabled it on 2 Sep 2026 after testing). Never add cart/purchase endpoints without being asked. Quirks the docs omit: `/games` returns `{"array": [...]}` (the client unwraps it); `/expansions` is a bare array; Dragon Ball Super is game id 9 and **includes Fusion World expansions** (`fb*`, `fs*`), which now cross-walk like any other set; `fixed_properties.collector_number` is `BT14-113` on newer sets but bare `049` on older ones (see `collectorNumbers`). Crosswalk covers ~98 % of cards, mostly via `tcg_player_id` = tcgcsv `productId`. Cardmarket also files Fusion World under its `DragonBallSuper` category, but **TCGplayer does not** — `externalLinks` picks the search slug per game. |
| Claude | `claude-opus-5`, adaptive thinking, Zod structured outputs via `messages.parse` | Every call is recorded in `ai_runs` with token usage. |

## Architecture

- **Server actions over API routes.** Mutations live in `actions.ts` files next to their pages
  (`src/app/collection/actions.ts`, `src/app/decks/actions.ts`, …). The only API routes are the
  cron price sync (`/api/sync/prices`, Bearer `CRON_SECRET`) and the scan upload (`/api/scan`).
- **Catalog is immutable app data**: `card_sets` → `cards` → `card_prints`. Ownership (`owned_cards`)
  always references a *print* so foil/alt-art copies are distinct; deck slots (`deck_cards`)
  reference a *card*, because any print satisfies a deck slot.
- **No card-number prefix belongs to both games** — the original uses BT/EX/SD/TB/EB/DB/XD/P/TOKEN
  and Fusion World FB/FS/FP/SB/ST/E — so `gameOfSetCode` is a lookup, not a guess, and card ids
  never collide. Watch the `E`/`E01` pair: it is matched whole before being read as a family plus
  a number, in `sets.ts` and again in `normaliseNumber`'s `BARE_SET_CODES`.
- **Reservations are computed, never stored** (`src/lib/decks/reservations.ts`): reserved = sum of
  `deck_cards` across decks with `is_built`; available = owned − reserved. Marking a deck built is
  **blocked outright** when it would over-reserve (owner's decision), and `buildConflicts` lists the
  exact shortfall — which is also the want-list for `/cart?deck=ID`.
- **Prices are daily snapshots** (`tcg_prices` keyed by product/sub-type/day) so movers can be
  computed; `pricesForPrints` reduces several TCGplayer products per print to one Normal + one Foil
  figure.
- **Raw SQL reads go through `rows()`** (`src/db/rows.ts`) because postgres.js returns arrays and
  PGlite (used by `npm test`) returns `{ rows }`.
- **AI**: `src/lib/ai/deck.ts` (summary, improvement wizard, set review), `src/lib/ai/scan.ts`
  (photo → cards with bounding boxes, matched to the catalog by number then name; `scan-match.ts`
  holds the pure number normalisation + match-confidence rules covered by `npm test`; the client
  downscales each photo in the browser and sends one `/api/scan` request per photo), `src/lib/ai/cart.ts` (explains the
  deterministic optimiser's output — it never does the arithmetic). The wizard's candidate pool is
  scoped to the leader's colours and capped at 450 cards; default scope is "any legal card" with an
  owned-only toggle (owner's decision). Every deck prompt is built by `systemFor(game)` and every
  pool is filtered to one game, so the model is never asked to reason across the two; only the
  scanner reads both at once, because a photo can hold a mix.
- **Lot owner**: every `owned_cards` row records `owner` = the Basic Auth username
  (`currentUser()` in `src/lib/auth/index.ts`, read from the `Authorization` header); null when the app
  runs open locally. Every path that creates lots (card page, bulk entry, scan batches, quick
  capture) stamps it — keep that true for new paths.
- **Deck legality is a flag, never a block** (`src/lib/decks/legality.ts`). A deck saves in any
  state; `legality(rows, game)` labels it **legal / incomplete / illegal** and returns per-card
  `flags` keyed `"<zone>:<cardId>"`. *Incomplete* = still building (no leader, under 50).
  *Illegal* = a rule is broken (banned card, over the copy limit, 2+ leaders, over the deck
  maximum, Z-deck too big, a card in the wrong zone, a card from the **other game**, a non-deck
  card like an Energy Marker). Shown on the deck page, the deck list and the leaders page. The one
  thing that *is* refused is over-reserving a **built** deck — that's ownership, not legality.
  Per-game numbers come from `deckRules(game)`; the only rule that differs in *kind* is colour:
  off-colour is a **warning** in the original game and **illegal** in Fusion World, which also has
  no Z-Deck (`zMax: 0`, so `zonesFor` drops the zone and `zoneForType` sends Z- cards to main).
- **"Also add to deck"** (`DeckPicker`, `src/lib/decks/add.ts`): every add path can target a deck
  (existing, or "New deck…" which creates it on the spot). `addCardsToDeck` puts leaders in the
  leader slot, Z- cards in the Z-deck, everything else in main, and **never caps or replaces** —
  a sixth copy or a second leader is added and the deck is flagged, because silently dropping a
  card the user just scanned is worse. Scan batches store the target in `scan_batches.deck_id` so
  it carries to the PC.
- **Voice bulk entry** (`VoiceEntry`, `src/lib/scan/voice.ts`): speech recognition runs in the
  browser via the Web Speech API (`src/lib/scan/speech.ts`) — no audio is uploaded and there is no
  API cost; only the transcript reaches the server. `parseSpoken` never decides what was meant: it
  returns *ordered* `{cardId, quantity}` interpretations ("eighteen oh twenty" is both BT18-020 ×1
  and BT18-02 ×20) and `resolveSpokenAction` keeps the first whose card number exists, so the
  catalog is the tie-breaker. Falls back to a name search. Hit/miss are signalled by synthesised
  tones (`src/lib/scan/cue.ts`) so entry can be done without looking at the screen.
- **Quick capture** (`/add/quick`, `POST /api/scan/quick`): phone loop — one photo → identified
  immediately (nothing stored) → quantity with big ± buttons → `addLot` → the camera re-opens
  (the `click()` happens inside the save handler so it counts as a user gesture).
- **Scan batches** (`src/lib/scan/batches.ts`, tables `scan_batches`/`scan_photos`/`scan_items`): a
  scan is persisted as it happens — the downscaled photo bytes (`bytea`, exactly what Claude saw so
  crops line up), each detection, and every review edit — so a batch uploaded from the phone can be
  finished on the PC (`/add/scan` lists open batches; `/add/scan?batch=ID` resumes one). `POST /api/scan`
  stores the photo *before* identifying so a retry never needs the phone again; `GET /api/scan/photo/[id]`
  serves it. Completing a batch writes the lots and nulls the photo bytes; discarding deletes everything.
- **Leaders → "Build a deck with Claude"** (`/leaders`, `src/lib/ai/deck-builder.ts`): every owned
  LEADER card with its decks (built/virtual). The draft prompt gets two pools — owned on-colour
  cards with quantities (preferred) and a capped pool of legal cards to buy — and the answer is
  run through `sanitiseDraft` (pool membership, copy limits, Z-zone) before it becomes a *virtual*
  deck whose description carries the shopping list. Owned/buy flags come from the collection, not
  the model. ~130 s and ~$0.40 per draft.
- **Binding arrays in raw SQL:** use `textArray()` from `src/db/sqlx.ts` — `${arr}::text[]` fails
  under postgres.js with a `transformTypeCast` error.
- **Arena rules engine** (`src/lib/arena/engine/`, branch `feature/arena`): **Dragon Ball Super
  only — it does not play Fusion World**, so `deckInputFor` returns null for such a deck and the
  arena's deck lists ask for `game: "dbs"`. Pure TypeScript, no React,
  no database. A game is a `GameState` plus an append-only event log; `apply(ctx, state, action)` is the
  only mutator and runs the flow (a data step list in `state.flow`) until the next `prompt`, so a game
  is storable mid-decision and reproducible from seed + actions. `legalActions()` drives both the UI
  and, later, Claude's move menu. Card text is *read*, not interpreted: `cards.ts` parses skill
  types, keyword skills (§22 of `docs/rules/rulemanual.txt`) and orb costs; `filters.ts` reads the
  fixed target grammar ("Blue <Baby> with an energy cost of 4"); `effects.ts` handles a few fixed
  phrasings natively and logs a note for everything else, which is where the phase-3 compiled
  scripts and the runtime referee plug in. Only skills the engine can both pay for and resolve are
  offered as actions. Design and decisions: `docs/arena-design-proposal.md`; history and
  lessons: `docs/arena-rules-worklist.md`; **the current work brief with code map, checklists
  and backlog: `docs/arena-next-stage-spec.md`** — read it before touching the compiler. Tests:
  `scripts/verify-arena.ts` (part of `npm test`), synthetic cards, sections cited in messages.
- **Arena UI** (`/arena`, `src/components/arena/`, `src/lib/arena/{games,view}.ts`): phone-first
  hot-seat board. A game is one `arena_games` row holding the seed, the action log (the
  reproducible source) and a state snapshot; `applyToGame` is the only writer. The board is drawn
  from `boardView`, which hides what the player may not see (3-1-3), and every tappable thing comes
  from the engine's `legalActions`, so the UI knows no rules. `npm run arena:playthrough` plays a
  whole game through the database, and `npm run arena:coverage` reports how much card text the
  compiler reads. The board is `src/components/arena/stage/` — motion-first, cards fly between zones
  on `layoutId`, and a whole opponent turn is *played back* from the beat stream rather than
  arriving as a jump. Everything it renders comes from one `Snapshot`
  (`src/lib/arena/session.ts` + `snapshot.ts`), which `/api/v1` serves to the planned Android app as
  well, so no client ever evaluates a rule. **`docs/arena-client-contract.md`** is that contract and
  is read first; `docs/arena-ui-motion-spec.md` records the web board and
  `docs/arena-android-spec.md` briefs the Android app, which is not built.
  `docs/arena-workflow-spec.md` is the current work brief for making every rule a
  visible workflow — read it before touching `legalActions` or the `Snapshot` shape.
  Phases 1–3 of it are built: `rejectedActions` beside `legalActions` (a `whyNot*` twin per
  predicate, never an edit to one), `taps.whyByCard`, `view.you.choices` for a search of a
  hidden zone, `prompt.min/max/step/cost`, `owner` on the `skill` beat — and on the web board the
  card action sheet, the refusal line, the search sheet, the step chip and the narration ribbon.
  `src/lib/arena/wording.ts` is the only place a `Requirement` becomes a sentence and
  `src/lib/arena/narration.ts` the only place a beat does; both are pure and under `npm test`.
  **Skins** (`docs/arena-skin-spec.md`): the board has two, `anime` (default) and `night`, chosen
  by the `arenaSkin` cookie and `?skin=` for one load, applied as `data-skin` on the board's root.
  A skin is paint only: the theme's `--color-*` tokens are redefined under that attribute in
  `globals.css`, so every Tailwind utility on the board follows. Keep it that way — no colour
  literals in `src/components/arena/` (they are named classes painted from tokens), no card size or
  logic behind a skin check, and card faces keep the night palette under both.
  **Pace** (`src/lib/arena/pace.ts`): how fast a turn plays back is a remembered preference —
  slow (default), normal, or step (tap *Next* between beats); while it plays, the prompt bar's
  headline is the narration sentence and a card from a hidden pile flies in as a ghost.
- **Claude as the arena opponent** (`src/lib/arena/ai/`): `view.ts` builds what Claude may see —
  its own hand and decklist plus public state; your hand, life and decklist are never in the
  request. `opponent.ts` picks a number from the engine's legal-move list, so an answer can be
  wrong but never illegal, and takes the decisions that cannot go wrong (one legal move, the coin
  flip, the mulligan, which card to charge) without an API call at all. Two tiers, the owner's
  choice: Sparring on Haiku 4.5, Tournament sending the Main Phase and counter windows to Opus 5.
  The same module holds the **referee**, which answers with a program in the effect language when
  a card's text defeats the compiler. `run.ts` drives Claude's side and totals what it spent onto
  the game row. Caching note: the cached prefix is ~3,200 tokens, over Opus 5's 512-token minimum
  but under Haiku 4.5's 4,096, so Tournament games cache and Sparring games do not.
- **Arena debug and backlog** (`src/lib/arena/ai/debug.ts`): every decision the server takes is
  written to `arena_decisions` — the prompt kind, the whole menu offered, what was chosen, whether a
  rule or Claude decided it, the model, tokens, cost and latency, plus the exact prompt text when
  the game has `debug` on. `/arena/[id]/debug` reads it back. Clauses the compiler cannot read go
  to `card_text_notes`, grouped by clause shape at `/arena/backlog`: the referee bumps a row when
  the text actually comes up and stores the program Claude produced as a worked example, and
  "scan my decks again" fills it from the decks you play. That page is the to-do list for
  `compile.ts` — one rule usually clears a whole group.
- **Explaining a card** (`src/lib/arena/ai/clarify.ts`, `/arena/backlog`): you say what a card does in
  plain words; Claude returns a program in the effect language, saved to `card_scripts`, and a
  markdown work item for teaching `compile.ts` the *wording*. `src/lib/arena/scripts.ts` lays stored
  programs over the compiler's own reading through `ctx.scripts`, so an explained card plays
  correctly from the next game — no referee call, no tokens — while the work item is what fixes
  every card phrased the same way. The two are not the same fix and the page says so.
- **Optimiser** (`src/lib/marketplace/optimizer.ts`) is deterministic: greedy + exhaustive 1/2/3-seller
  subsets + removal local search, shipping counted once per seller.

## Environment

`.env.local` (gitignored) holds `DATABASE_URL` (Neon, pooled), `ANTHROPIC_API_KEY`,
`CARDTRADER_API_TOKEN`, `CARDTRADER_ENABLED`. `CRON_SECRET` and `XIMILAR_API_KEY` are optional.
The same variables must exist in Vercel's project settings for the deployment. See `.env.example`.

The Neon database is in **`eu-central-1`** (AWS Frankfurt), so `vercel.json` pins functions to
**`fra1`**, the Vercel region co-located with it. That pin used to live only in the Vercel dashboard,
where nothing in the repo recorded it and nothing would catch it drifting back to the `iad1`
default — which would put the Atlantic in the middle of every database round-trip.

## Conventions

- Phone and desktop layouts from the start: `BottomTabs` on phones, `HeaderNav` from `sm` up;
  card grids are 2 columns on phones. Use the `tap` class on controls for 44 px targets.
- Money is integer cents + currency code; format with `formatCents`. Never float euros.
- Card numbers are the catalog's ids (`BT18-020`); print ids add a suffix (`BT18-020_SPR`).
- Keep `npm run typecheck`, `npm run lint` and `npm test` clean before committing.
- After a PR merges, delete the merged remote branch (`gh pr merge --delete-branch`, or the
  "Delete branch" button on GitHub) — do this unasked, but never delete a branch that hasn't
  merged (`--no-merged` in `git branch -r --merged main`). There is one Neon database for dev,
  preview and production (`DATABASE_URL` above) — no per-branch database, so a merged branch
  needs no separate cleanup in Neon.
