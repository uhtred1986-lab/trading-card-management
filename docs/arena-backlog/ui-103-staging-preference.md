---
title: Arena: add battle staging preference and persistence
milestone: Arena M3 — Battle staging and inspector
labels: backlog, enhancement, area:arena-ui, phase:battle-staging, model:sonnet-5
stage: ui
---
**Source:** `docs/arena-battle-staging-spec.md` §3.6; `src/lib/arena/staging.ts`.

**Status check, 9 Sep 2026 — this is built.** `staging.ts` defines `ARENA_STAGINGS = ["inplace", "band", "takeover"]`, `STAGING_COOKIE = "arenaStaging"` and `DEFAULT_STAGING = "band"`, with a server-read cookie like the skin's. The issue was filed from the spec's build list without checking the tree.

**Verify and close:**
1. The cookie is read on the server in the game page so a reload cannot flash the wrong staging; `?staging=` pins one for one load.
2. The three-way control sits beside `FeelToggle` (or, once #98 §2.5 lands, inside the `⋯` sheet under *Board*).
3. An unknown cookie value falls back to `band` (the `readStaging`-style guard in `staging.ts`) and a 1 v 1's two devices can hold different stagings without affecting each other (it is a viewer preference, not game state).

**Acceptance.** A closing comment with the three items ticked and file references, or a narrowly scoped follow-up issue for anything missing.
