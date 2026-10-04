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
The arena's engine internals (REF badge, "Engine reads", raw ids and log, `/arena/[id]/debug`) show only to an admin: `isArenaAdmin()` (`src/lib/auth/admin.ts`) is true for a login listed in `ARENA_ADMINS` (comma-separated, case-insensitive) or whenever Basic Auth is off; with auth on and the list unset, nobody is admin.

**Previews are off (only `main` deploys), so the next note matters only if that is reverted.
Vercel's own deployment protection is ON for Preview** (verified 6 Sep 2026: a preview URL
redirects to `vercel.com/sso-api`). A preview therefore needs a Vercel login *as well as* Basic
Auth, which makes preview URLs awkward to open on a phone — a Cloudflare tunnel to a local
`npm run build && npm start` is the quicker way to test on a device.

**Neon is one database with a spend limit, so development keeps off it** (owner's instruction,
14 Sep 2026). Three things follow. `vercel.json` (`git.deploymentEnabled`) deploys **`main` only** —
no branch gets a preview any more; the `web` CI job runs `npm run build` (dummy `DATABASE_URL`)
as the build check. It builds through `scripts/vercel-build.mjs`, which runs the migrations on
*production* deploys only, and `scripts/vercel-ignore-build.mjs` skips a production deploy whose
changed files are all under `docs/`, `.github/`, `.claude/` or root-level `*.md` (any git error
builds), and still skips agent-branch previews as a fallback.
`npm test` never touches Neon (PGlite). And an agent session does not run the scripts that need
`DATABASE_URL` — `arena:diff`, `arena:playthrough`, `arena:reprobe`, `arena:specified`,
`db:check`, `db:migrate`, `sync:*` — unless the issue's acceptance cannot be met any other way;
it says which acceptance bullet it could not verify instead, and the owner runs that one.


## Working efficiently in this repo

**Working one issue as an agent, or coordinating several: read `docs/agent-brief.md` first** —
branching, data, the habits that stall sessions, the PR, and the coordinator's review-and-merge loop.

A `SessionStart` hook runs `npm ci` when `node_modules` is stale; a `Cannot find module` error from a
`verify-*` or `arena:*` script means it did not run — run `npm ci` by hand. Detail:
`docs/architecture/db.md`. For arena work start with the `arena-work` skill and
`docs/arena-tooling.md`; grep the long `docs/arena-*.md` files, don't read them whole. Never run
`sync:catalog`/`sync:prices` just to inspect state. For pure rule logic,
`npx tsx scripts/verify-rules.ts` and `npx tsx scripts/verify-arena.ts` are faster than `npm test`;
run the full suite before finalizing.

## Commands

```powershell
npm run dev            # Dev server (port 3000, or 3001 if taken)
npm run build          # Production build
npm run typecheck      # tsc --noEmit
npm run lint           # ESLint
npm test               # verify-rules.ts (pure) + verify-arena.ts on both engines (docs/arena-tooling.md) + verify-db.mts (PGlite)
npm run db:generate    # Generate a migration after editing src/db/schema.ts
npm run db:migrate     # Apply migrations (also run on every *production* Vercel deploy via scripts/vercel-build.mjs)
npm run sync:catalog   # Import both games' catalogs from deckplanet + Fusion World art from Bandai (~50 s),
                       # then draft arena rules for every new or changed card and ask Claude about the
                       # skills the compiler could not read (--no-review, --budget N)
npm run db:check       # Can this machine reach the database, and over which driver?
npm run db:migrate:http # db:migrate for a sandbox that allows HTTPS only (see DB_DRIVER below)
npm run sync:prices    # Import TCGplayer products + today's prices from tcgcsv (both categories),
                       # the USD→EUR rate, and TCGplayer art for prints still without any (~35 s)
```

`npm test` needs no database or network; everything else needs `DATABASE_URL` in `.env.local`
(except `android:test`, which needs Docker). The `arena:*` scripts, `contract:emit`, `android:test`
and the rest of the arena tooling are listed with their flags in `docs/architecture/arena.md`;
`docs/arena-tooling.md` explains what each proves — read it before changing the compiler or the
engine. There is no test framework, only `assert` scripts run with `tsx`.

## Where the detail lives — open before touching the area

The Data sources and Architecture sections moved out of this file unchanged (issue #382).

| Touching… | Read |
|---|---|
| Working one issue as an agent (habits, proof, PR) | `docs/agent-brief.md` |
| Catalog import, deckplanet/Bandai/TCGplayer/CardTrader/FX sources, card images, leader faces, errata, prices, the optimiser | `docs/architecture/catalog-and-sync.md` |
| Ownership, reservations, deck legality, deck/lot owners, add-to-deck, voice entry, quick capture, scan batches | `docs/architecture/collection-and-decks.md` |
| Deck analysis, wizard, card scanning, cart explainer, "Build a deck with Claude" | `docs/architecture/ai.md` |
| The provider-neutral AI layer (API vs subscription, swapping vendors): contract, routing, ledger | `docs/architecture/ai-providers.md` |
| Server actions, raw SQL (`rows()`, `textArray()`), the SessionStart hook | `docs/architecture/db.md` |
| The arena: engines, compiler, rules language, rulesets, workbench, UI, opponent, probe, arena scripts | `docs/architecture/arena.md`, then `docs/arena-tooling.md` and `docs/arena-code-map.md` |
| Original feature spec (written before Fusion World) | `dbs-tcg-app-feature-summary.md` |

Large docs: `docs/arena-history-lessons.md` (199 KB) and `docs/arena-code-map.md` (69 KB) — grep, don't read whole.

## Hard rules (detail in the docs above)

- **Reservations are computed, never stored**; over-reserving a *built* deck is the one thing refused. `collection-and-decks.md`
- **Legality is a flag, never a block**: `legality(rows, game)` labels, it never refuses. `collection-and-decks.md`
- **Errata are fixed in `errata.ts`, never by UPDATE**: the catalog upsert overwrites `skill`. `catalog-and-sync.md`
- **Keep `coalesce` on `image_url` and `cards.specified_cost`** in the catalog upsert, or a sync erases them. `catalog-and-sync.md`
- **Stamp `owned_cards.owner` and `decks.owner`** on every path that creates them. `collection-and-decks.md`
- **Catalog, price and meta reads are cached until the next sync** (`src/lib/cache/`): a new writer of a cached table must expire its tag. `catalog-and-sync.md`
- **Raw SQL reads go through `rows()`; bind arrays with `textArray()`.** `db.md`
- **Rules are records**: the engine never compiles card text at game time; a confirmed rule is never rewritten by a script. `arena.md`
- **The two games are kept apart by `game`**; the arena only plays `dbs` decks.

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
  Files in scope: `src/lib/arena/text/{cards,filters,triggers}.ts`, `src/lib/arena/compile.ts` and
  `compile/*.ts`, `src/lib/arena/vm/*.ts` (`script.ts` is the interpreter), `src/lib/arena/lang/*.ts`,
  and the legacy `src/lib/arena/engine/{engine,state,triggers}.ts` while it exists (#118).
- After a PR merges, delete the merged remote branch (`gh pr merge --delete-branch`, or the
  "Delete branch" button on GitHub) — do this unasked, but never delete a branch that hasn't
  merged (`--no-merged` in `git branch -r --merged main`). There is one Neon database for dev,
  preview and production (`DATABASE_URL` above) — no per-branch database, so a merged branch
  needs no separate cleanup in Neon.
