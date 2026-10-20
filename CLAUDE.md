# CLAUDE.md

Loaded every turn, so it holds only what every task needs. Depth lives in `docs/`; the index below
says which file to open before touching which area. Read the one you need, not all.

## What this is

A single-user Next.js companion app for Bandai's two **Dragon Ball Super Card Game** products: the
original game (legacy BT1–BT25 plus the Masters line, `game = "dbs"`) and **Fusion World**
(`"fusion"`). Collection tracking with market values, virtual vs. built decks with a reservation
system, Claude-powered deck analysis and card scanning, TCGplayer pricing, a read-only CardTrader
integration with a cart optimiser, and the **arena** (an engine that plays `dbs` decks by the
Masters rule manual). `dbs-tcg-app-feature-summary.md` is the original spec (before Fusion World).

- **The two games are kept apart by `game`** (`src/lib/catalog/games.ts`, `GAME_INFO`): on
  `card_sets`, denormalised onto `cards`, chosen once per deck. Nothing is mixed within a deck;
  lists default to both with a `GameFilter` chip row. Only the arena is `dbs`-only.
- Owner is in Austria: display currency EUR; TCGplayer prices are USD, converted at the ECB rate in
  `fx_rates`. Price paid is entered in EUR.
- **Auth** (`docs/architecture/auth.md`): SLs (admins) sign in with Google at `/login`; players join
  with a one-time code (`/join?c=CODE`). HTTP Basic Auth still works beside it (`BASIC_AUTH_*`,
  `app_users`, `/password-login`) until it is removed. With nothing configured (local dev) the app
  runs open and everyone is an SL. `/api/sync/*` and `/api/ai/agent-sdk` skip the proxy and check
  their own bearer secret; the manifest, `/icons/*` and `/sw.js` are exempt.
- **Deploys:** only `main` builds on Vercel (`vercel.json`); a production deploy runs the migrations
  (`scripts/vercel-build.mjs`). Functions are pinned to `fra1`, next to the Neon database in
  `eu-central-1`; keep them together. Env names: `.env.example`; AI provider variables:
  `docs/architecture/ai-providers.md`.

## Safety

- **Neon is one database for production, preview and dev, with a spend limit: stay off it.**
  `npm test` runs on PGlite. An agent session does not run `db:*`, `sync:*`, `arena:diff`,
  `arena:playthrough`, `arena:reprobe` or `arena:specified`; if an acceptance bullet can only be
  proved against the database, the PR says which and the owner runs it. Live reads and the owner's
  own data tasks: `docs/agent-brief.md` → "Data".
- **The cloud environment's `DATABASE_URL` is another app's database.** The SessionStart hook unsets
  it; fetch this app's URL as the brief shows. Never print, commit or paste a URL or secret.
- **Migrations are additive, from `db:generate` only** (never hand-written SQL). A pushed branch has
  migrated nothing; only a production deploy of `main` does.
- **Paid calls** (Anthropic API, `ai:smoke`, image or voice generation) only when the owner asks for
  them in the chat.
- No new npm dependency, destructive migration, production/Vercel setting change or Neon write
  without the owner's say-so in the issue or chat.

## Hard rules (detail in the docs below)

- **Every Server Function, page and route checks who is asking itself** (`requireSl`/`requireSignedIn`,
  `requireSlPage`/`requireSignedInPage`, `routeViewer`), and every read of lots, decks or wants takes
  `currentScope()`; `scripts/verify/guards.ts` fails `npm test` on a missing guard. `auth.md`
- **Reservations are computed, never stored**; over-reserving a *built* deck is the one thing
  refused; a built deck reserves only its owner's copies. `collection-and-decks.md`
- **Legality is a flag, never a block**: `legality(rows, game)` labels, it never refuses.
- **Stamp `owned_cards.owner` and `decks.owner`** on every path that creates them.
- **Errata are fixed in `errata.ts`, never by UPDATE**; keep `coalesce` on `image_url` and
  `cards.specified_cost` in the catalog upsert, or a sync erases them. `catalog-and-sync.md`
- **Catalog, price and meta reads are cached until the next sync** (`src/lib/cache/`): a new writer
  of a cached table must expire its tag.
- **Raw SQL reads go through `rows()`; bind arrays with `textArray()`.** `db.md`
- **Rules are records**: the engine never compiles card text at game time; a confirmed rule is
  never rewritten by a script. `arena.md`
- **Touch the compiler, update the glossary** (`src/lib/arena/glossary.ts`) in the same commit: any
  change to what the engine understands or does with card text (files in scope: `src/lib/arena/text/*`,
  `compile.ts`, `compile/*`, `vm/*`, `lang/*`). Nothing catches a description that has gone untrue.
- Money is integer cents + currency code (`formatCents`), never float euros. Card ids are the
  catalog's (`BT18-020`); print ids add a suffix (`BT18-020_SPR`).
- Phone and desktop from the start: `BottomTabs` on phones, `HeaderNav` from `sm`; card grids are 2
  columns on phones; `tap` class for 44 px targets.

## Commands

```powershell
npm run dev            # port 3000 (3001 if taken)
npm run checks         # typecheck + lint + only the tests the changed files reach (skill verify-changed)
npm run typecheck | lint | build
npm test               # rules, arena (both engines), db on PGlite; needs no database or network
npm run db:generate    # after editing src/db/schema.ts
npm run shots:compare -- /collection /decks   # before/after screenshots (skill screen-proof)
```

Which check, when, and by whom: `docs/agent-brief.md` → "Checking a change". There is no test
framework, only `assert` scripts run with `tsx`. Arena tooling and its scripts: `docs/arena-tooling.md`.

## Where the detail lives — open before touching the area

| Touching… | Read |
|---|---|
| Working one issue (branching, data, proof, PR), or coordinating agents | `docs/agent-brief.md` |
| Catalog import, deckplanet/Bandai/TCGplayer/CardTrader/FX sources, images, errata, prices, optimiser | `docs/architecture/catalog-and-sync.md` |
| Ownership, reservations, legality, deck/lot owners, add-to-deck, voice entry, quick capture, scan batches | `docs/architecture/collection-and-decks.md` |
| Deck analysis, wizard, card scanning, cart explainer, "Build a deck with Claude" | `docs/architecture/ai.md` |
| AI providers (API vs subscription, routing, ledger, the agent-sdk route, `AI_AGENT_SDK`) | `docs/architecture/ai-providers.md` |
| Sign-in and access: Google, join codes, guards, private collections, admin page, MCP connector | `docs/architecture/auth.md` |
| Server actions, raw SQL, `DB_DRIVER`, the SessionStart hook | `docs/architecture/db.md` |
| The arena: engines, compiler, rules language, Rules screens, UI, scripts | skill `arena-work`, then `docs/architecture/arena.md`, `docs/arena-tooling.md`, `docs/arena-code-map.md` |
| Symbol lookup, browser network/offline inspection (Windows-verified, no Playwright) | `docs/arena-agent-tools.md` |
| Reviewing open rules with the owner (MCP connector `/api/mcp`) | `docs/arena-tooling.md` §5c, `skills/dbs-rules-review/`; a batch against `card_rules`: skill `rules-review-batch` |
| Screens changed (proof) | skill `screen-proof` |

Large docs (`arena-history-lessons.md` 199 KB, `arena-code-map.md` 69 KB): grep, don't read whole.
