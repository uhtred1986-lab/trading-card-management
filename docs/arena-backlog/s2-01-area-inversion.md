---
title: Arena: fix 'areas other than' inversion and 'non-X and non-Y' filters (BT7-129, BT16-088)
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, ready-for-agent, bug, area:arena-compiler, phase:rules-stage2, model:opus-5
stage: 2
---
**Source:** `docs/arena-rules-worklist.md`, "Fix the instrument — Stage 2, fifth increment (9 Sep 2026)"; rule manual 20-1-6.

**Problem.** Two compiler bugs were exposed by the readings instrument and deliberately left for their own commit:

- **BT7-129** prints "non-black cards in areas **other than** your deck, hand, or life" and the compiler reads "in your **deck**": the area list is inverted, so the selector searches exactly the areas the text excludes.
- **BT16-088** prints "non-<Zamasu> **and** non-<Goku Black>" and reads only the first exclusion; the same card's "for the game" is read as "for the turn".

Both compiled cleanly and looked plausible until the silent filter measures were printed. They are the failure mode `docs/arena-next-session-prompt.md` §3 describes.

**Build.**
1. In `src/lib/arena/engine/filters.ts` / `compile.ts`, read "areas other than A, B or C" as the complement over `AREAS` (`engine/script.ts`), or refuse it when the complement is not expressible. Do not guess.
2. Read a conjunction of negated measures ("non-X and non-Y") into one filter carrying both exclusions; check the same path for `notTraits`, `notNames`, `notColors`.
3. Fix the "for the game" duration on BT16-088 and grep the catalog for the same pattern (`npm run arena:tally -- --show "for the game"`).
4. Add the wordings to `scripts/verify/wordings.ts` and update `src/lib/arena/glossary.ts`.

**Out of scope.** Other filter measures; the side test (#94).

**Acceptance.**
- `npm run typecheck && npm run lint && npm test && npm run build`; `npx tsx --env-file-if-exists=.env.local scripts/arena-fuzz.mts 40` with 0 crashes.
- Gap-set and readings diffs recorded in the worklist entry; every moved reading signed off by card id.
- Scenario proof: `npm run arena:readings` shows BT7-129 excluding the areas the text names, and BT16-088 reading both exclusions with `until: game`.
- `npm run contract:emit` reviewed (expected: no change unless a harness card is touched).
