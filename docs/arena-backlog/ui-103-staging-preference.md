---
title: Arena: add battle staging preference and persistence
milestone: Arena M3 — Battle staging and inspector
labels: done, enhancement, area:arena-ui, phase:battle-staging, model:sonnet-5
stage: ui
status: closed
closed_at: 2026-09-09
---
**Source:** `docs/arena-battle-staging-spec.md` §3.6; `src/lib/arena/staging.ts`.

**Status check, 9 Sep 2026 — this is built.** `staging.ts` defines `ARENA_STAGINGS = ["inplace", "band", "takeover"]`, `STAGING_COOKIE = "arenaStaging"` and `DEFAULT_STAGING = "band"`, with a server-read cookie like the skin's. The issue was filed from the spec's build list without checking the tree.

**Verify and close:**
- [x] 1. The cookie is read on the server in the game page so a reload cannot flash the wrong staging; `?staging=` pins one for one load. Verified in `src/app/arena/[id]/page.tsx` line 52 (`const staging = stagingFrom(asked.staging ?? jar.get(STAGING_COOKIE)?.value)`).
- [x] 2. The three-way control sits beside `FeelToggle`. Verified in `src/components/arena/StagingToggle.tsx` and rendered in `src/components/arena/stage/ArenaStage.tsx` line 669.
- [x] 3. An unknown cookie value falls back to `band` (the `stagingFrom` guard in `staging.ts` line 31) and a 1 v 1's two devices hold independent staging cookies as viewer preference rather than shared game state. Verified in `src/lib/arena/staging.ts` and `src/app/arena/actions.ts` (`setStaging`).

**Acceptance.** Verified and closed with all criteria satisfied.
