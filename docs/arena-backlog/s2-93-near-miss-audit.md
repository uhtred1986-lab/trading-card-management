---
title: Arena: run clause near-miss audit and fix wrong readings
milestone: Arena M1 — Rules correctness and parser coverage
labels: done, enhancement, area:arena-compiler, phase:rules-stage2, model:opus-5
stage: 2
status: closed
closed_at: 2026-09-12
---
**Source:** `docs/arena-next-session-prompt.md` §3 and §4(a); `docs/arena-tooling.md` §1; memory of the two passes already run (`docs/arena-history-lessons.md`, entries of 9 Sep 2026).

**Problem.** The failure mode that matters is a clause that **compiles and reads wrongly** — a board wipe that cleared one side, a KO offered every card, a [Counter] charged half its price, 149 skills firing whether or not their condition held. No coverage number catches these. Two systematic passes over the compiler's literal-phrase regexes have each paid for themselves; a third is the best value per hour in the programme, and it is repeatable work an agent can pick up cold.

**Build — the method, exactly.**
1. Baselines: `npm run arena:tally -- --misses 100000 > gap-before.txt` (needs network; a ~14-line result is a fetch failure — re-run) and `npm run arena:readings > read-before.txt`.
2. For every regex in `src/lib/arena/engine/compile.ts` and `filters.ts` that anchors on a literal phrase, grep the catalog for near-misses: contractions ("there's"), reversed word order ("25000 or less power" vs "25000 power or less"), singular/plural, passive/active, synonyms. Also compare printed text against reading for a measure present in one and absent in the other, and watch for side or area leakage — a reading saying "opponent" where the text never does.
3. Fix or **refuse** each family (prefer unread to wrongly read); update `src/lib/arena/glossary.ts` in the same commit, including families refused.
4. Diff both instruments; sign off every moved reading by card (`awk '/^[A-Z0-9]/{k=$0} /^  reads:/{print k" || "$0}' read-after.txt | sort`), or prove a property over the moved set and still check one named card by hand.
5. **Verify every count against the readings dump before reporting it** — one earlier audit claimed 25+ skills for a bug whose real figure was 4.

**Out of scope.** Structural fixes with their own issue (#94 side test, #95 OR, the area-inversion issue); new primitives.

**Acceptance.**
- Gate: `npm run typecheck && npm run lint && npm test && npm run build`; `npx tsx --env-file-if-exists=.env.local scripts/arena-fuzz.mts 40` = 0 crashes; `npm run contract:emit` reviewed.
- A dated history entry in `docs/arena-history-lessons.md` listing each family found, the cards, the before/after numbers, and the shapes that entered and left the gap set.
- One `scripts/verify/wordings.ts` assertion per family fixed.
