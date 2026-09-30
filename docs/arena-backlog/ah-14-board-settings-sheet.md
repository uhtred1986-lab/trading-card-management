---
title: "Phone: board settings before a game — sky or night, pace, staging and haptics from Play's ⋯"
issue: 370
milestone: Arena M17 — Arena home: Play and Rules Workbench
labels: backlog, ready-for-agent, enhancement, area:arena-ui, phase:arena-home, model:sonnet-5
stage: ui
status: closed
touches: src/components/arena/BoardSettingsSheet.tsx, src/components/arena/SkinToggle.tsx, src/components/arena/StagingToggle.tsx, src/app/arena/actions.ts
---
**Source:** `src/components/arena/SkinToggle.tsx`, `src/components/arena/PaceToggle.tsx`, `src/components/arena/FeelToggle.tsx` and `src/components/arena/StagingToggle.tsx`, which are rendered only inside `ArenaStage` (`src/components/arena/stage/ArenaStage.tsx`); canvas frame `PlayPhone` → ⋯ → *Board settings*.

**Problem.** How the board looks and moves can only be changed mid-game, from the board's own menu. The preferences are already per device: `SkinToggle` and `StagingToggle` write cookies, and `FeelToggle` writes `localStorage`. Nothing about them is per game except the `gameId` they pass for revalidation.

**Build.**
1. ⋯ → **Board settings** on Play opens a sheet with the same four controls as segmented rows: Sky / Night, pace, staging, haptics on / off.
2. Make `gameId` optional on the toggles, or wrap their actions so they work with no game. They still write the same cookies and `localStorage` keys, so the next game opens with them.
3. The in-game controls stay where M16 puts them. This adds a second door; it does not move them.

**Acceptance.**
- `npm run typecheck && npm run lint && npm test && npm run build`
- Scenario: choose Night in the sheet, start a game, and the board opens in night on the first paint (no flash).
