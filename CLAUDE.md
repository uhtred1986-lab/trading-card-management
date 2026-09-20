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

**Neon is one database with a spend limit, so development keeps off it** (owner's instruction,
14 Sep 2026). Three things follow. `vercel.json` builds through `scripts/vercel-build.mjs`, which
runs the migrations on *production* deploys only, and skips preview deploys altogether for the
branches agents push (`feat/*`, `arena-*`, `backlog/*`, `claude/*`, `copilot/*`, `ops/*` —
`scripts/vercel-ignore-build.mjs`; a hand-pushed branch under another name still previews).
`npm test` never touches Neon (PGlite). And an agent session does not run the scripts that need
`DATABASE_URL` — `arena:diff`, `arena:playthrough`, `arena:reprobe`, `arena:specified`,
`db:check`, `db:migrate`, `sync:*` — unless the issue's acceptance cannot be met any other way;
it says which acceptance bullet it could not verify instead, and the owner runs that one.

## Working efficiently in this repo

A `SessionStart` hook (`.claude/settings.json` → `scripts/session-start-check.mjs`) runs `npm ci`
before a fresh Claude Code on the web session's first turn whenever `node_modules` is missing or
older than `package-lock.json`, then warms the `tsx` cache — plain Node, so it works the same
under the owner's Windows/PowerShell machine and in the sandbox. It is a no-op in under a second
when `node_modules` is already current. A `Cannot find module` error from any `verify-*` or
`arena:*` script means the hook did not run (or ran and failed) — run `npm ci` by hand rather than
assuming the suite is broken.

Before opening arena docs or engine source for a specific question, start with
`docs/arena-tooling.md` (what each verify/probe/tally script proves) and
`docs/arena-next-session-prompt.md` (current state, priority order) — both are short and meant
as the entry point. There are 20+ other `docs/arena-*.md` files (several 400–900+ lines); grep
them for the term you need rather than reading multiple specs end to end. `src/lib/arena/engine/`
is large: the compiler implementation now lives under `src/lib/arena/engine/compile/`,
`compile.ts` is its stable public barrel, and `engine.ts`, `script.ts` + `script-schema.ts`,
`state.ts` are each 1,800–4,600 lines — grep for the symbol first and read a line range, don't
open these files whole. For iterating on pure rule
logic, `npx tsx scripts/verify-rules.ts` and `npx tsx scripts/verify-arena.ts` are much faster than
full `npm test` (which also runs `verify-db.mts`, spinning up PGlite + migrations every time); run
the full suite before finalizing. Never run `sync:catalog`/`sync:prices` just to inspect state —
they hit real network endpoints and take 30–50s.

## Commands

```powershell
npm run dev            # Dev server (port 3000, or 3001 if taken)
npm run build          # Production build
npm run typecheck      # tsc --noEmit
npm run lint           # ESLint
npm test               # verify-rules.ts (pure) + verify-arena.ts on both engines (docs/arena-tooling.md) + verify-db.mts (PGlite)
npm run contract:emit  # rewrite contract/fixtures/*.json after a deliberate Snapshot shape change
npm run android:test   # Kotlin round-trip of those fixtures, in Docker — no JDK on the machine
npm run db:generate    # Generate a migration after editing src/db/schema.ts
npm run db:migrate     # Apply migrations (also run on every *production* Vercel deploy via scripts/vercel-build.mjs)
npm run sync:catalog   # Import both games' catalogs from deckplanet + Fusion World art from Bandai (~50 s),
                       # then draft arena rules for every new or changed card and ask Claude about the
                       # skills the compiler could not read (--no-review, --budget N)
npm run arena:draft    # Compile the catalog offline into card_rules drafts (--card, --set, --only-open, --review)
npm run arena:rulesets # Rewrite src/lib/arena/rulesets/<game>/files.ts from the .rules files beside it
                       # (--check fails instead of writing); the loader itself reads no filesystem
npm run arena:probe    # Try stored rules on a board built for each (--card, --set, --all, --limit, --fill)
npm run arena:reprobe  # Re-run every probe a rule carries and list the ones whose answer moved (--write)
npm run arena:tally    # Compiler coverage over the live deckplanet catalog, with op/cond usage and unread
                       # clause shapes — no database needed (--misses N, --show "<a wording>")
npm run arena:specified # The specified (coloured) half of a play's price: proves the catalog feed carries
                       # no cost orbs, lists the X-cost cards whose baseline is therefore refused (--all),
                       # and — with DATABASE_URL — says per card whether one was entered, ruled on or is unknown
npm run arena:readings # The other half: what the compiler reads every skill to *mean*, printed text
                       # beside the program in words. Diff it before and after a compiler change — a
                       # clause that compiles and reads wrongly moves no coverage number (--grep, --unread)
npm run arena:diff     # Replay a saved game's action log from its seed and compare with the row
                       # (-- <gameId> [--engine legacy|rules] | --all): the oracle check between the engines
npm run db:check       # Can this machine reach the database, and over which driver?
npm run db:migrate:http # db:migrate for a sandbox that allows HTTPS only (see DB_DRIVER below)
npm run sync:prices    # Import TCGplayer products + today's prices from tcgcsv (both categories),
                       # the USD→EUR rate, and TCGplayer art for prints still without any (~35 s)
```

`npm test` needs no database or network. Everything else needs `DATABASE_URL` in `.env.local`,
except `android:test`, which needs Docker and nothing else — the Kotlin toolchain lives in a
container (`android/Dockerfile`) because the machine has no JDK, no Gradle and no Android SDK.
There is no test framework — both scripts are plain `assert` scripts run with `tsx`; extend them in
the same style. **`docs/arena-tooling.md` explains every arena instrument** — what `arena:readings`
and `arena:tally` prove and how to diff them, which of `verify-arena`'s twelve suites means what
when it fails, when `contract:emit` and the oracle `arena:diff` are required, and the practices
learned the expensive way. Read it before changing the compiler or the engine.

## Data sources (verified 2 Sep 2026)

| What | Source | Notes |
|---|---|---|
| Card catalog | `https://api.deckplanet.net/cardsearch/{dbs_masters_cards,fusion_world_cards}?limit=100000` | One call per game; the `dragogodev/cgs` repo the spec names is only a *pointer* to the first. 6.5k cards for the original game, ~2k for Fusion World. Alternate prints appear as top-level entries **and** in `variants[]`; `shapeCatalog` collapses them to one card per base number + a print list. The Fusion World payload differs in three ways, all handled in `deckplanet.ts`: bare rarity codes ("SR", normalised to "Super Rare[SR]" by `normaliseRarity`), no character/era lists, and a numeric energy cost. **Its skill text carries typos** — see `errata.ts` below. |
| Card images | `https://storage.googleapis.com/deckplanet_card_images/{number}.png` | Hot-linked via `next/image`; a few prints 404 and fall back to a placeholder. **Fusion World is not in this bucket at all** — its art comes from Bandai's own card list, `https://www.dbs-cardgame.com/fw/images/cards/card/en/{number}.webp` (leaders `_f`/`_b`, alternate prints `_p1`, `_p2`…; no User-Agent or Referer check). `src/lib/catalog/bandai.ts` crawls the card list's series pages for the exact image names at catalog sync and only assigns URLs that exist, since deckplanet lists ~700 more alternate prints than Bandai shows. Whatever is still null afterwards gets the matched TCGplayer product photo (`_200w.jpg` rewritten to `_in_1000x1000.jpg`) from `fillMissingImages` during the price sync. The catalog upserts therefore `coalesce` `image_url` instead of overwriting it. |
| Leader back sides | deckplanet `{number}_b.png` (older sets only, HEAD-verified at catalog sync) → else CardTrader blueprint `back_image` (Masters-era sets, backfilled by the CardTrader sync); Fusion World leaders use Bandai's `{number}_b.webp`, inferred from the `_f` front and HEAD-verified the same way | Stored in `cards.back_image_url`; the catalog upsert `coalesce`s so a CardTrader back survives re-syncs. `CardFaces` shows front + awakened when present. |
| Prices | `https://tcgcsv.com/tcgplayer/{27,80}/...` | **Requires a browser-like User-Agent** (401 otherwise). Category 27 is the original game, 80 is Fusion World; 27 also carries a stray duplicate of Fusion World's FB01 group, which is skipped there. Products join to cards on the printed `Number`; SR+ cards only exist as a foil sub-type, so `priceForFinish` falls back foil↔normal — and the foil sub-type is called `Foil` in category 27 but `Holofoil` in 80 (`FOIL_SUB_TYPES`). |
| FX | `https://api.frankfurter.app/latest?from=USD&to=EUR` | Daily. |
| CardTrader | `https://api.cardtrader.com/api/v2` | **Read-only client**, and every live call is gated by `CARDTRADER_ENABLED=true` (the owner enabled it on 2 Sep 2026 after testing). Never add cart/purchase endpoints without being asked. Quirks the docs omit: `/games` returns `{"array": [...]}` (the client unwraps it); `/expansions` is a bare array; Dragon Ball Super is game id 9 and **includes Fusion World expansions** (`fb*`, `fs*`), which now cross-walk like any other set; `fixed_properties.collector_number` is `BT14-113` on newer sets but bare `049` on older ones (see `collectorNumbers`). Crosswalk covers ~98 % of cards, mostly via `tcg_player_id` = tcgcsv `productId`. Cardmarket also files Fusion World under its `DragonBallSuper` category, but **TCGplayer does not** — `externalLinks` picks the search slug per game. |
| Claude | `claude-opus-5`, adaptive thinking, Zod structured outputs via `messages.parse` | Every call is recorded in `ai_runs` with token usage. |

## Architecture

- **Server actions over API routes.** Mutations live in `actions.ts` files next to their pages.
  The only API routes are the cron price sync (`/api/sync/prices`) and the scan upload
  (`/api/scan`).
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
- **Reservations are computed, never stored** (`src/lib/decks/reservations.ts`): reserved = sum of
  `deck_cards` across decks with `is_built`; available = owned − reserved. Marking a deck built is
  **blocked outright** when it would over-reserve, and `buildConflicts` lists the exact shortfall.
- **Prices are daily snapshots** (`tcg_prices` keyed by product/sub-type/day) so movers can be
  computed; `pricesForPrints` reduces several TCGplayer products per print to one Normal + one Foil
  figure.
- **Raw SQL reads go through `rows()`** (`src/db/rows.ts`) because postgres.js returns arrays and
  PGlite (used by `npm test`) returns `{ rows }`.
- **AI**: `src/lib/ai/deck.ts` (summary, wizard, set review), `src/lib/ai/scan.ts` (photo → cards,
  matched by number then name), `src/lib/ai/cart.ts` (explains the optimiser's output, never does
  the arithmetic). The wizard's pool is scoped to the leader's colours and capped at 450; every
  deck prompt is scoped to one game — only the scanner reads both at once, since a photo can mix
  them.
- **Lot owner**: every `owned_cards` row records `owner` = the Basic Auth username
  (`currentUser()`); null when the app runs open. Every path that creates lots stamps it — keep
  that true for new paths.
- **Decks belong to a login too** (`decks.owner`, issue #279): stamped from `currentOwner()` on
  every path that creates a deck — keep that true for new ones. A deck's owner also gates
  *visibility* (`listDecks`/`getDeck` hide a deck owned by someone else); a deck id that isn't
  yours answers `not_found`. Reservations do **not** follow ownership — every built deck counts
  against the shared collection regardless of owner. Deck transfer between logins and the
  workbench's rule-coverage pages are deliberately out of scope.
- **Deck legality is a flag, never a block** (`src/lib/decks/legality.ts`): a deck saves in any
  state; `legality(rows, game)` labels it **legal / incomplete / illegal** with per-card flags. The
  one thing actually *refused* is over-reserving a **built** deck — that's ownership, not legality.
  Colour differs in *kind* per game: a warning in the original game, illegal in Fusion World (which
  also has no Z-Deck).
- **"Also add to deck"** (`DeckPicker`, `src/lib/decks/add.ts`): every add path can target a deck.
  `addCardsToDeck` sorts by zone and **never caps or replaces** — an over-limit add is flagged
  rather than dropped.
- **Voice bulk entry** (`VoiceEntry`, `src/lib/scan/voice.ts`): browser speech recognition, no
  audio uploaded. `parseSpoken` returns *ordered* interpretations rather than deciding;
  `resolveSpokenAction` picks the first whose card number exists in the catalog, falling back to a
  name search.
- **Quick capture** (`/add/quick`, `POST /api/scan/quick`): phone loop — one photo → identified
  immediately (nothing stored) → quantity with big ± buttons → `addLot` → the camera re-opens.
- **Scan batches** (`src/lib/scan/batches.ts`): a scan is persisted as it happens so a batch
  started on the phone can be finished on the PC. `POST /api/scan` stores the photo *before*
  identifying so a retry never needs the phone again.
- **Leaders → "Build a deck with Claude"** (`/leaders`, `src/lib/ai/deck-builder.ts`): the draft
  gets an owned pool and a capped buy pool, runs through `sanitiseDraft`, and becomes a *virtual*
  deck with a shopping list. Owned/buy flags come from the collection, not the model.
- **Binding arrays in raw SQL:** use `textArray()` from `src/db/sqlx.ts` — `${arr}::text[]` fails
  under postgres.js with a `transformTypeCast` error.
- **Arena rules engine** (`src/lib/arena/engine/`): a game is a `GameState` plus an event log;
  `apply()` is the only mutator. `legalActions()` offers only skills the engine can pay for **and**
  resolve, and drives both the UI and Claude's move menu. Doc: `docs/arena-code-map.md`.
- **The compiler's glossary** (`src/lib/arena/glossary.ts`, `/arena/rules/keywords`): the only
  written record of what the compiler understands per keyword — part of the compiler, not
  documentation about it (Conventions below: touch the compiler, update the glossary). Doc:
  `docs/arena-code-map.md`.
- **Two engines, chosen per game** (`src/lib/arena/engines.ts`): the config-driven `rules` engine
  (`vm/`) is the **default** since 20 Sep 2026 (#166); `legacy` (`engine/`, frozen) stays the
  oracle, is what Settings → Arena engine puts new games back on, and is what a **1 v 1** is made
  on either way (`engineForMode`, #162 — never a refusal of the default path). A game keeps the
  engine it was made on — `engineFor(id)` is the one switch, and `engineOr`'s own fallback is
  `FALLBACK_ENGINE`, not the default, because an unreadable stored value is an old legacy row.
  **One rejection per card per action type, except an activation, which is one per skill line**
  (§3.2). Doc: `docs/arena-code-map.md`.
- **The rules language** (`src/lib/arena/lang/`, `docs/arena-rules-language.md`): one closed
  grammar for a card's rule. `npm test` holds it to `parse(print(x)) === x` for every op,
  condition, selector and filter. Doc: `docs/arena-code-map.md`.
- **A game is files, not code** (`src/lib/arena/rulesets/`): `loadRuleset` reads a game's `.rules`
  declarations into one `GameDefinition`; `npm run arena:rulesets` regenerates the generated
  constant — nothing reads a file at request time. Doc: `docs/arena-code-map.md`,
  `docs/arena-ruleset-spec.md`.
- **The specified-cost baseline is a column a person writes** (`cards.specified_cost`, issue
  #255): the feed carries no cost orbs, so an X-cost card's coloured price is entered by hand. The
  catalog upsert must `coalesce` this column — remove that and the next sync erases every entry.
  Doc: `docs/arena-code-map.md`.
- **The record's WHEN is the engine's WHEN** (`skillAnswersTo`, `engine/triggers.ts`): an [Auto]
  skill's trigger comes off `card_rules.trigger`; only a skill with no record falls back to the
  printed text. Doc: `docs/arena-code-map.md`.
- **Arena UI** (`/arena`, `src/components/arena/`, `docs/arena-client-contract.md`): phone-first
  board driven entirely by `legalActions()` and one `Snapshot` — no client evaluates a rule.
  **Everything the board says about who is acting reads `live.waiting`, never the `snapshot`
  prop.** Doc: `docs/arena-code-map.md`.
- **1 v 1** (mode `versus`, `src/lib/arena/matches.ts`): two people, two devices, one game. A 1 v 1
  belongs to its two seats and nobody else, over as well as playing. Doc: `docs/arena-code-map.md`.
- **Claude as the arena opponent** (`src/lib/arena/ai/`): your hand, life and decklist are
  **never** in the request. `opponent.ts` picks from the legal-move list, so an answer can be wrong
  but never illegal. Doc: `docs/arena-code-map.md`.
- **Arena debug** (`src/lib/arena/ai/debug.ts`, `/arena/[id]/debug`): every server decision is
  logged to `arena_decisions`. What the compiler cannot read is `card_rules.unread` on the rule
  itself, not a second list. Doc: `docs/arena-code-map.md`.
- **Rules are records** (`docs/arena-rules-workbench-spec.md`): the engine plays from `card_rules`
  and **never compiles card text at game time**; a row a person confirmed or corrected is never
  rewritten by a script. Doc: `docs/arena-code-map.md`.
- **The probe** (`src/lib/arena/probe.ts`): says what the engine *does* with a rule, not what it
  should. Pure — no database, no network, and **no compiler**: `draft.ts` stays the only module
  that compiles card text. Doc: `docs/arena-code-map.md`.
- **Explaining a card** (`src/lib/arena/ai/clarify.ts`): plain-language explanations become a
  draft rule. **A ruling given in conversation goes to `card_rules.explanation` first** (`npm run
  arena:rule`), and the code change is made afterwards, deliberately. Doc: `docs/arena-code-map.md`.
- **Optimiser** (`src/lib/marketplace/optimizer.ts`) is deterministic: greedy + exhaustive 1/2/3-seller
  subsets + removal local search, shipping counted once per seller.

## Environment

`.env.local` (gitignored) holds `DATABASE_URL` (Neon, pooled), `ANTHROPIC_API_KEY`,
`CARDTRADER_API_TOKEN`, `CARDTRADER_ENABLED`. `CRON_SECRET` and `XIMILAR_API_KEY` are optional.
The same variables must exist in Vercel's project settings for the deployment. See `.env.example`.
`APP_ANTHROPIC_API_KEY` is the same Anthropic key under a second name, read when the first is absent:
Claude Code on the web reserves `ANTHROPIC_API_KEY` for its own session and refuses to store it.
`DB_DRIVER=neon-http` sends queries to Neon over HTTPS instead of Postgres TCP — for sandboxes
(Claude Code on the web is one) that let 443 out and nothing on 5432; the HTTP driver has no
interactive transactions, so it is for the scripts, not the app server. The `arena:*` scripts
tolerate a missing `.env.local`, so an environment that provides the variables itself needs none.

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
- **Touch the compiler, update the glossary** (`src/lib/arena/glossary.ts`). Any change to what the
  engine understands or does with card text belongs there in the same commit: a keyword taught to
  `keywordOf`, a keyword the engine starts or stops playing itself, an approximation fixed or
  introduced, a new reading rule in `compile.ts`/`filters.ts`/`cards.ts`, a skill type or a
  bracketed non-skill keyword. The `support` badge and the `engine` line are the claims that go
  stale first — if a keyword's entry says the engine does something it no longer does, the page is
  worse than nothing. The typecheck only catches a *missing* keyword; nothing catches a
  description that has quietly become untrue, which is why this is a rule rather than a test.
  Files in scope: `src/lib/arena/engine/{cards,compile,filters,engine,state,triggers,script}.ts`,
  `src/lib/arena/lang/*.ts`.
- After a PR merges, delete the merged remote branch (`gh pr merge --delete-branch`, or the
  "Delete branch" button on GitHub) — do this unasked, but never delete a branch that hasn't
  merged (`--no-merged` in `git branch -r --merged main`). There is one Neon database for dev,
  preview and production (`DATABASE_URL` above) — no per-branch database, so a merged branch
  needs no separate cleanup in Neon.
