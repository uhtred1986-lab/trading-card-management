---
title: "Rules Workbench: one queue — scope, state and group-by replace My decks / All cards / Patterns"
issue: 360
milestone: Arena M17 — Arena home: Play and Rules Workbench
labels: backlog, ready-for-agent, enhancement, area:arena-workbench, phase:arena-home, model:sonnet-5
stage: ui
status: closed
closed_at: 2026-09-30
touches: src/app/arena/rules/page.tsx, src/app/arena/rules/all/page.tsx, src/app/arena/rules/patterns/page.tsx, src/components/arena/rules/Workbench.tsx, src/lib/arena/rules-store.ts, next.config.ts
---
**Source:** `docs/arena-home-spec.md` §1 decision 5, §2; `docs/arena-rules-workbench-spec.md` (the worklist); the three pages under `src/app/arena/rules/`; `worklist`, `worklistPage`, `draftPatterns`, `openPatterns` in `src/lib/arena/rules-store.ts`; canvas frame `RulesDesktop`.

**Problem.** One job, three pages with three layouts:
- `/arena/rules`: the decks' worklist, with deck chips, mechanism chips and a *Claude drafted* chip.
- `/arena/rules/all`: the catalog in pages of 200, with set, source and mechanism filters.
- `/arena/rules/patterns`: groups by wording, in two halves.

Each page repeats the header, filter code and `ConfirmAll`. The phone view is a wrap of chips. A rule whose card the compiler now reads differently (`compiler_diff`) shows only once the record is opened.

**Build.** `/arena/rules` becomes the only page:
1. **Cards in**: one deck · **all decks** (default; every login's, see #364) · whole catalog (paged, using `worklistPage`) · *fired in game X* (`?game=`, used by ah-04).
2. **State**, as a segmented control with the four states and their counts. Default: Open when the scope has any, else Draft.
3. **Group by**: nothing · same wording (today's patterns; confirming a group stays one action) · reason (unread mechanism · Claude drafted · compiler reads it differently · specified cost unknown) · set.
4. **Find** box, as today.
5. Sort inside a state as today (most decks first). Scope *fired in game X* sorts by first fired.
6. **Confirm all in view** stays and means exactly the filter, as `/all` says today.
7. `/arena/rules/all` and `/arena/rules/patterns` become redirects (`next.config.ts` `redirects`, or a `redirect()` page) to the matching query string, and their components go.
8. **Row**: state glyph (ring, half, filled), name, card id, reason chip and deck count. Tap or click opens the record (ah-07).

**Out of scope.** Changing what `worklist*` returns beyond the new `game` scope and the `compiler_diff` reason, and the record layout (ah-07). A phone design: the workbench is made for the computer (spec decision 6). On a phone it only has to work: no horizontal page scroll, and controls that can be reached.

**Acceptance.**
- `npm run typecheck && npm run lint && npm test && npm run build`
- `/arena/rules/all?set=BT19` and `/arena/rules/patterns?half=open` redirect to the queue with the equivalent filter.
- Scenario: *Cards in: Azure Sage Control*, *Open* lists that deck's open cards only. *Group by: same wording* on *Draft* shows the groups with one Confirm per group.
- Phone (390×844) and desktop (1440×900) screenshots in the PR, each beside its canvas frame.
