# DBS Card Companion

Collection, decks, prices and AI analysis for the Dragon Ball Super Card Game (legacy + Masters).
Next.js 16 · React 19 · Tailwind 4 · Drizzle + Neon Postgres · Anthropic SDK · Vercel.

## Features

- **Catalog** — every DBS card (6.5k) with text, keywords, ban/limit status, leader back sides and
  alternate prints; search by name, number or character; filter by set, type, colour, rarity, owned.
- **Collection** — lots per print with quantity, condition, foil, language, date, price paid.
  Dashboard: value vs. spent, gain/loss, biggest movers, breakdown by set and rarity.
- **Add cards** — photo scan (one card or a whole binder page, reviewed before saving; photos are
  never stored) or a keyboard-only bulk entry table.
- **Decks** — unlimited *virtual* decks; *built* decks reserve their copies from the collection and
  can't be built if you don't own enough. Allocation (owned / reserved / available) on every card.
  Legality checks, import/export lists, duplicate.
- **AI (Claude)** — deck summary, improvement wizard with accept/reject swaps flagged owned vs.
  needs-buying, new-set reviews, cart-plan explanations.
- **Prices** — TCGplayer market prices (daily, via tcgcsv.com) shown in EUR; per print, Normal/Foil.
- **CardTrader** — read-only EU listings per card and a deterministic cheapest-sellers cart
  optimiser (`/cart?deck=ID` for a deck's missing cards).

## On iPhone

Open the deployed app in Safari and sign in. To keep it on your Home Screen,
open Safari's Share menu → **Add to Home Screen** → **Add** (enable **Open as Web App**
if offered). Launch **DBS Arena** from the new icon; collection and decks remain
available through the app's navigation. No App Store download is needed.

If the installed app asks you to sign in again, use your normal sign-in. Players
whose one-time join code has already been redeemed should request a new code for
that installation from an admin.

Collection, syncing and AI scanning need an internet connection. For offline
arena play, open **Play on this device** in the installed app and prepare the
starter decks while online first. Offline data belongs to that browser/installation;
it is not automatically shared with Safari or another device.

## Setup

```powershell
npm install
copy .env.example .env.local     # fill in DATABASE_URL, ANTHROPIC_API_KEY, …
npm run db:migrate
npm run sync:catalog
npm run sync:prices
npm run dev
```

On Vercel: add the same environment variables to the project; `vercel.json` runs migrations before
each build and a daily cron hits `/api/sync/prices` (needs `CRON_SECRET`).

## Checks

```powershell
npm run typecheck && npm run lint && npm test
```

## Arena backlog workflow

Arena rework planning and intake now live in `docs/arena-backlog.md`.
When new Arena bugs/features are found, file them as GitHub issues with the
`Arena backlog item` template and include milestone + phase/area labels so
future agents can pick them up directly.
To import the prepared Arena backlog milestones/labels/issues in one run, use
`/home/runner/work/trading-card-management/trading-card-management/scripts/import-arena-backlog.ps1`.
