---
title: Arena: implement in-fight card inspector details
milestone: Arena M3 — Battle staging and inspector
labels: done, enhancement, area:arena-ui, phase:battle-staging, model:sonnet-5
stage: ui
status: closed
closed_at: 2026-09-09
---
**Source:** `docs/arena-battle-staging-spec.md` §3.5; `src/components/arena/shared.tsx` (`Sheet`, `CardDetail`); `src/components/arena/stage/useBeatPlayer.ts`.

**Status check, 9 Sep 2026 — largely built.** `useBeatPlayer` already exposes `pause()` / `resume()` / `paused`, and `CardView` carries `text`, `reading`, `comboPower`, `comboCost` and `referee`; `BoardView.battle.contributions` exists.

**Verification Checklist:**
- [x] 1. In `ArenaStage.tsx` lines 228-237, opening `Sheet` pauses `playback` (`if (sheet) pause(); else resume();`), preventing the fight from advancing underneath an open card; taps on chips in `DuelBand` and `Takeover` invoke `onCard` to open the sheet.
- [x] 2. In `src/components/arena/shared.tsx` (`CardDetail`, lines 387-408), when `battle` share is passed (`shareOf(sheet.id)` from `ArenaStage.tsx`), it renders the exact contribution (`battle.contribution.toLocaleString("en") of the battle.total.toLocaleString("en") attacking/guarding`), plus `comboPower` and `comboCost`.
- [x] 3. Hidden/masked cards obey `faceUp`/`revealedTo` boundaries; inspection does not reveal unrevealed cards.
- [x] 4. Build checks clean: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all pass.

**Acceptance.** Verified and closed with all criteria satisfied.
