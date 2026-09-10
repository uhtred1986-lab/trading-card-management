---
title: Arena: implement Empower up to Y player choice
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: done, bug, area:arena-engine, phase:capability-gap, model:opus-5
stage: ui
status: closed
closed_at: 2026-09-09
---
**Source:** `docs/arena-markers-stage-scope.md` §2 item 1 and §4 step B; rule manual 22-45-3; `src/lib/arena/engine/engine.ts` (the `[Empower XY]` carry near line 637 and the `empowerCarry` prompt kind near line 2826).

**Status check, 9 Sep 2026 — an `empowerCarry` prompt already exists in the engine.**

**Verification Checklist:**
- [x] 1. `resolvePlay` prompts the player for how many markers to carry (0...min(Y, available)) via `wait(s, { kind: "empowerCarry", player: p, card, from: old, max, ... })` (`engine.ts` line 655).
- [x] 2. `view.ts` words it clearly: `[Empower]: carry up to ${pr.max} marker(s) from ${from} to ${card}?` (`view.ts` line 520).
- [x] 3. `legalActions` offers every count from 0 to `pr.max` (`engine.ts` line 1645).
- [x] 4. AI opponent answers without an API call in `freeChoice` (`src/lib/arena/ai/opponent.ts`), picking the maximum available markers.
- [x] 5. Glossary `engine` line for `[Empower]` records: "Read before the old Unison leaves play... Up to Y is asked, not assumed" with `support: "engine"` (`glossary.ts` lines 266-269).
- [x] 6. The `markers` beat carries the chosen count (`engine.ts` line 662).
- [x] 7. Keyword assertions verified in `scripts/verify/keywords.ts` lines 135-169.

**Acceptance.** Verified and closed with all criteria satisfied.
