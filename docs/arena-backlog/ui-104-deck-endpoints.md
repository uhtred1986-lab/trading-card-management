---
title: Arena: implement Android /api/v1 deck endpoints
milestone: Arena M4 — Android client enablement
labels: backlog, ready-for-agent, enhancement, area:arena-contract, area:arena-android, phase:android-client, model:sonnet-5
stage: ui
---
**Source:** `docs/arena-client-contract.md` §5 (the endpoint table; "the deck endpoints are not built yet"); `docs/arena-android-spec.md` §7 (read-only decks); `src/app/api/v1/games/route.ts` as the pattern; `src/lib/arena/api.ts`.

**Problem.** `GET /api/v1/decks?game=dbs` and `GET /api/v1/decks/{id}` are in the contract and not in the tree. The Android app's game-creation flow needs the list (id, name, leader art, built/virtual, legality, playable) and its read-only deck screen needs the detail (zones, counts, per-card flags). Everything else in the §5 table is live.

**Build.**
1. Two route handlers under `src/app/api/v1/decks/`, behind the same Basic Auth and `seatOf`/`currentUser` rules as the game routes; `game` defaults to `dbs` and the arena's `deckInputFor` decides `playable` (a Fusion World deck is listed as not playable, never hidden silently — say why in the payload).
2. Legality from `src/lib/decks/legality.ts`, never recomputed; per-card flags are the same `flags` keyed `"<zone>:<cardId>"` the web deck page shows.
3. Add both shapes to `docs/arena-client-contract.md` §5/§6, golden fixtures under `contract/fixtures/` guarded by `scripts/verify/contract.ts`, and Kotlin data classes in `android/contract` so `npm run android:test` round-trips them.

**Out of scope.** Any write endpoint (the contract forbids editing decks from the app).

**Acceptance.**
- `npm run typecheck && npm run lint && npm test && npm run build`; `npm run contract:emit` produces the two new fixtures and nothing else; `npm run android:test` green in Docker.
- Scenario proof: `curl -u … /api/v1/decks?game=dbs` lists the owner's decks with `playable` set; a `versus`-only deck id returns `not_found` to a viewer who is not one of its seats.
