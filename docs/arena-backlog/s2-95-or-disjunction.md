---
title: Arena: fix OR disjunction handling in parseConditionClause
milestone: Arena M1 — Rules correctness and parser coverage
labels: done, bug, area:arena-compiler, phase:rules-stage2, model:opus-5
stage: 2
status: closed
closed_at: 2026-09-10
---
**Source:** `docs/arena-next-session-prompt.md` §4(c), first bullet; `parseConditionClause` in `src/lib/arena/engine/compile.ts`; the `any`/`all` condition kinds in `COND_SCHEMA`.

**Problem.** "If you have a green X **or** a yellow Y in play" is merged into **one** filter carrying both colours and both descriptions as an AND across fields, which is *wider* than printed in one direction (a green Y satisfies it) and narrower in another. Found while fixing something else and deliberately not fixed there. Ground rule 5 (`docs/arena-next-stage-spec.md` §2) forbids a silent widening.

**Build.**
1. Read "A or B" in a condition clause as a disjunction of two conditions (the `any` kind already exists in `COND_SCHEMA`; use it rather than adding a kind). Where the two halves share a subject ("a green or yellow Battle Card") keep the single-filter reading — that one is correct and common.
2. Measure the family first: `npm run arena:tally -- --show " or "` limited to condition clauses, and list the cards in the worklist entry.
3. `describeCondition` words the disjunction; glossary entry under conditions.

**Out of scope.** "Or" inside a *target* ("choose 1 Battle Card or Leader") — check whether the same bug exists there, and file it separately if it does.

**Acceptance.**
- Gate + `contract:emit` reviewed.
- Readings diff: every moved line is a condition gaining an "or"; sign off by card. Gap-set diff: no shape enters unless refused on purpose.
- `scripts/verify/wordings.ts`: a green X alone, a yellow Y alone, and a green Y — the first two satisfy, the third does not.

**Verification Checklist:**
- [x] 1. Implemented `splitDisjunction` preserving semantic boundaries (colors, areas, numbers).
- [x] 2. Refactored `parseConditionClause` and `parseCountCondition` to use `splitDisjunction` and produce `{ kind: "any", conds }`.
- [x] 3. Added glossary entry in `src/lib/arena/glossary.ts`.
- [x] 4. Unit verification test added in `scripts/verify/wordings.ts` testing Green X alone (passes), Yellow Y alone (passes), and Green Y cross (fails).
- [x] 5. Emitted contract fixtures and probe digests via `npm run contract:emit`.
- [x] 6. All tests and lint pass cleanly.

