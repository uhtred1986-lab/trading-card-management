---
title: "Arena: delete /arena/backlog — orphaned, and its streams point at closed issues"
issue: 363
milestone: Arena M17 — Arena home: Play and Rules Workbench
labels: backlog, ready-for-agent, area:arena-workbench, phase:arena-home, model:sonnet-5
stage: ui
touches: src/app/arena/backlog/page.tsx, src/app/arena/actions.ts, src/lib/github.ts
---
**Source:** `src/app/arena/backlog/page.tsx` (does not exist since this issue deleted it); `syncBacklogAction` and `revalidatePath("/arena/backlog")` in `src/app/arena/actions.ts`; issues #177, #93, #107 (all closed).

**Problem.** `/arena/backlog` is linked from nowhere in the app. It hard-codes an epic ("Legacy arena rules-engine programme", #177) and streams such as *Move replacement — In progress* (#107) and *Wrongly-read wording audit — Ready* (#93). All three are closed. The page is a second, stale copy of the GitHub milestones. The owner ruled (30 Sep 2026) to delete rather than hide.

**Build.**
1. Delete `src/app/arena/backlog/`.
2. Remove `syncBacklogAction` and the `revalidatePath` if nothing else uses them. Keep any `src/lib/github.ts` helper still used by `/arena/feedback`; remove the rest.
3. Search for any doc that links to `/arena/backlog`, and point it at the GitHub milestones instead.

**Acceptance.**
- `npm run typecheck && npm run lint && npm test && npm run build`
- `grep -rn "arena/backlog" src docs --include=*.ts --include=*.tsx --include=*.md` finds only history (CHANGELOG-style mentions), no links.
- `/arena/backlog` answers 404.
