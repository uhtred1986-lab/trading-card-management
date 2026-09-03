# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A single-user Next.js companion app for the **Dragon Ball Super Card Game** (legacy BT1–BT25 sets and
the current Masters line; Fusion World is deliberately excluded everywhere). Collection tracking with
market values, virtual vs. built decks with a reservation system, Claude-powered deck analysis and
card scanning, TCGplayer pricing, and a read-only CardTrader integration with a cart optimiser.
`dbs-tcg-app-feature-summary.md` is the original feature spec.

Owner is in Austria: the display currency is EUR; TCGplayer prices are USD and converted at the
ECB rate stored in `fx_rates`. Price paid is entered in EUR.

**Auth is HTTP Basic Auth in `src/proxy.ts`** (same pattern as gullet-cove-dm), active only when
`BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD` are both set — they are set in Vercel for Production and
Preview, and deliberately *not* in `.env.local`, so local dev runs open. `/api/sync/*` is exempt
because the Vercel cron can't send credentials; it is guarded by `CRON_SECRET` instead. Vercel's
own deployment protection is off (it is a paid feature on the Pro plan). Removing either variable
exposes the whole database.

## Commands

```powershell
npm run dev            # Dev server (port 3000, or 3001 if taken)
npm run build          # Production build
npm run typecheck      # tsc --noEmit
npm run lint           # ESLint
npm test               # scripts/verify-rules.ts (pure) + scripts/verify-db.mts (migrations + reservation rules on PGlite)
npm run db:generate    # Generate a migration after editing src/db/schema.ts
npm run db:migrate     # Apply migrations (also run on every Vercel deploy via vercel.json)
npm run sync:catalog   # Import the card catalog from deckplanet (~17 s)
npm run sync:prices    # Import TCGplayer products + today's prices from tcgcsv + USD→EUR rate (~25 s)
```

`npm test` needs no database or network. Everything else needs `DATABASE_URL` in `.env.local`.
There is no test framework — both scripts are plain `assert` scripts run with `tsx`; extend them in
the same style.

## Data sources (verified 2 Sep 2026)

| What | Source | Notes |
|---|---|---|
| Card catalog | `https://api.deckplanet.net/cardsearch/dbs_masters_cards?limit=100000` | The `dragogodev/cgs` repo the spec names is only a *pointer* to this. 6.5k cards, all lines, no Fusion World. Alternate prints appear as top-level entries **and** in `variants[]`; `shapeCatalog` collapses them to one card per base number + a print list. |
| Card images | `https://storage.googleapis.com/deckplanet_card_images/{number}.png` | Hot-linked via `next/image`; a few prints 404 and fall back to a placeholder. |
| Leader back sides | deckplanet `{number}_b.png` (older sets only, HEAD-verified at catalog sync) → else CardTrader blueprint `back_image` (Masters-era sets, backfilled by the CardTrader sync) | Stored in `cards.back_image_url`; the catalog upsert `coalesce`s so a CardTrader back survives re-syncs. `CardFaces` shows front + awakened when present. |
| Prices | `https://tcgcsv.com/tcgplayer/27/...` | **Requires a browser-like User-Agent** (401 otherwise). Category 27 includes one Fusion World group which is skipped. Products join to cards on the printed `Number`; SR+ cards only exist as the "Foil" sub-type, so `priceForFinish` falls back foil↔normal. |
| FX | `https://api.frankfurter.app/latest?from=USD&to=EUR` | Daily. |
| CardTrader | `https://api.cardtrader.com/api/v2` | **Read-only client**, and every live call is gated by `CARDTRADER_ENABLED=true` (the owner enabled it on 2 Sep 2026 after testing). Never add cart/purchase endpoints without being asked. Quirks the docs omit: `/games` returns `{"array": [...]}` (the client unwraps it); `/expansions` is a bare array; Dragon Ball Super is game id 9 and **includes Fusion World expansions** (`fb*`, `fs*`), which stay unmatched on purpose; `fixed_properties.collector_number` is `BT14-113` on newer sets but bare `049` on older ones (see `collectorNumbers`). Crosswalk covers ~98 % of cards, mostly via `tcg_player_id` = tcgcsv `productId`. |
| Claude | `claude-opus-5`, adaptive thinking, Zod structured outputs via `messages.parse` | Every call is recorded in `ai_runs` with token usage. |

## Architecture

- **Server actions over API routes.** Mutations live in `actions.ts` files next to their pages
  (`src/app/collection/actions.ts`, `src/app/decks/actions.ts`, …). The only API routes are the
  cron price sync (`/api/sync/prices`, Bearer `CRON_SECRET`) and the scan upload (`/api/scan`).
- **Catalog is immutable app data**: `card_sets` → `cards` → `card_prints`. Ownership (`owned_cards`)
  always references a *print* so foil/alt-art copies are distinct; deck slots (`deck_cards`)
  reference a *card*, because any print satisfies a deck slot.
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
  owned-only toggle (owner's decision).
- **Lot owner**: every `owned_cards` row records `owner` = the Basic Auth username
  (`currentUser()` in `src/lib/auth.ts`, read from the `Authorization` header); null when the app
  runs open locally. Every path that creates lots (card page, bulk entry, scan batches, quick
  capture) stamps it — keep that true for new paths.
- **Deck legality is a flag, never a block** (`src/lib/decks/legality.ts`). A deck saves in any
  state; `legality()` labels it **legal / incomplete / illegal** and returns per-card `flags`
  keyed `"<zone>:<cardId>"`. *Incomplete* = still building (no leader, under 50). *Illegal* = a
  rule is broken (banned card, over the copy limit, 2+ leaders, over 50, Z-deck over 8, a card in
  the wrong zone). Off-colour cards are *warnings* and do not change the status. Shown on the deck
  page, the deck list and the leaders page. The one thing that *is* refused is over-reserving a
  **built** deck — that's ownership, not legality.
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
- **Optimiser** (`src/lib/marketplace/optimizer.ts`) is deterministic: greedy + exhaustive 1/2/3-seller
  subsets + removal local search, shipping counted once per seller.

## Environment

`.env.local` (gitignored) holds `DATABASE_URL` (Neon, pooled), `ANTHROPIC_API_KEY`,
`CARDTRADER_API_TOKEN`, `CARDTRADER_ENABLED`. `CRON_SECRET` and `XIMILAR_API_KEY` are optional.
The same variables must exist in Vercel's project settings for the deployment. See `.env.example`.

## Conventions

- Phone and desktop layouts from the start: `BottomTabs` on phones, `HeaderNav` from `sm` up;
  card grids are 2 columns on phones. Use the `tap` class on controls for 44 px targets.
- Money is integer cents + currency code; format with `formatCents`. Never float euros.
- Card numbers are the catalog's ids (`BT18-020`); print ids add a suffix (`BT18-020_SPR`).
- Keep `npm run typecheck`, `npm run lint` and `npm test` clean before committing.
