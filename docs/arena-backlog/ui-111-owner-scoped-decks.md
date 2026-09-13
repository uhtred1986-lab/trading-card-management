---
title: Decks belong to a login — an owner column on decks, filtering the web list and /api/v1/decks
milestone: Arena M4 — Android client enablement
labels: backlog, ready-for-agent, enhancement, area:arena-contract, area:arena-android, phase:android-client, model:opus-5
stage: ui
issue: 279
---
**Source:** #104 (owner's decision of 13 Sep 2026: "owner-scope decks, separate issue"); `owned_cards.owner` and `currentUser()` in `src/lib/auth/index.ts` (the lot-owner precedent in `CLAUDE.md`); `decks` in `src/db/schema.ts`; every path that creates a deck — `src/app/decks/actions.ts`, the "New deck…" path in `src/lib/decks/add.ts`, the draft in `src/lib/ai/deck-builder.ts`, scan batches' `deck_id`; `src/lib/arena/deck-api.ts` and `src/app/api/v1/decks/`; `seatOf` in `src/lib/arena/matches.ts`; `docs/arena-client-contract.md` §5.

**Problem.** Decks carry no owner. The web deck list, the leaders page, the arena's deck pickers and `GET /api/v1/decks` show every deck to every login, so #104's scenario "a deck id returns `not_found` to a viewer who is not its owner" could not be met. Seats live on `arena_games`/`arena_matches`; a deck itself belongs to nobody.

**Build.**
1. Migration: `decks.owner text null` (`npm run db:generate`), stamped from `currentUser()` on every path that creates a deck — list them in the PR and keep the list true. Existing rows stay null.
2. The rule, written once and read everywhere a deck is listed or opened: a deck is visible to its owner, and a deck with a null owner is visible to everyone — the app running open has no identity, the same hole `proxy.ts` and `seatOf` have and no wider. A deck id not yours answers `notFound()` on the web and `not_found` on `/api/v1/decks/{id}`; the list filters the same way.
3. Reservations (`src/lib/decks/reservations.ts`) still count every built deck, whoever owns it — ownership of cards is per lot already, and this issue does not change what "reserved" means; say so in the code.
4. `docs/arena-client-contract.md` §5: the visibility rule; no payload shape change expected.

**Out of scope.** Sharing or transferring a deck between logins; per-owner card lots (already `owned_cards.owner`); seats on games and matches (already).

**Acceptance.**
- Gate; `scripts/verify-db.mts` gains the scenario: two owners, each sees their own decks plus the unowned ones, and neither sees the other's.
- Scenario proof against the real database: `curl -u <login A> /api/v1/decks/<deck of B>` answers `not_found`; the web deck page does the same.
- `npm run contract:emit` no change (`deck-list.json`/`deck-detail.json` unchanged); `android:test` green.
