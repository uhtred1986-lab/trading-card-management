---
title: Arena: fix 'areas other than' inversion and 'non-X and non-Y' filters (BT7-129, BT16-088)
milestone: Arena M1 — Rules correctness and parser coverage
labels: done, bug, area:arena-compiler, phase:rules-stage2, model:opus-5
stage: 2
status: closed
closed_at: 2026-09-09
---
**Source:** `docs/arena-history-lessons.md`, "Fix the instrument — Stage 2, fifth increment (9 Sep 2026)"; rule manual 20-1-6.

**Problem.** Two compiler bugs were exposed by the readings instrument:
- **BT7-129** prints "non-black cards in areas **other than** your deck, hand, or life".
- **BT16-088** prints "non-<Zamasu> **and** non-<Goku Black>" and "for the game".

**Verification Checklist:**
- [x] 1. In `src/lib/arena/engine/compile.ts` lines 632-649 (`AREAS_OTHER_THAN_RE`), "areas other than A, B or C" is parsed into the complement over `ALL_AREAS` (`leader`, `battle`, `unison`, `combo`, `energy`, `drop`, `warp`, `zDeck`, `zEnergy`), cleanly excluding deck, hand, and life.
- [x] 2. In `src/lib/arena/engine/compile.ts` line 29 (`NAME_AFTER_AND`) and `filters.ts`, "non-X and non-Y" prevents clause splitting across negated name conjunctions and merges both into `notCharacters` (`["zamasu", "goku black"]`).
- [x] 3. "for the game" on BT16-088 duration parsed as `until: "game"` (`compile.ts` `durationOf`).
- [x] 4. Tests added in `scripts/verify/wordings.ts` asserting exact readings and exclusion filters for BT7-129 and BT16-088.
- [x] 5. Glossary entry in `src/lib/arena/glossary.ts` documents the negated-name conjunction rule.
- [x] 6. All tests pass (`npm test`, `npm run typecheck`, `npm run lint`, `npm run build`).

**Acceptance.** Verified and closed with all criteria satisfied.
