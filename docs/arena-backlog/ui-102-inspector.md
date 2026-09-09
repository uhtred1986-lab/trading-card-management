---
title: Arena: implement in-fight card inspector details
milestone: Arena M3 — Battle staging and inspector
labels: backlog, enhancement, area:arena-ui, phase:battle-staging, model:sonnet-5
stage: ui
---
**Source:** `docs/arena-battle-staging-spec.md` §3.5; `src/components/arena/shared.tsx` (`Sheet`, `CardDetail`); `src/components/arena/stage/useBeatPlayer.ts`.

**Status check, 9 Sep 2026 — largely built.** `useBeatPlayer` already exposes `pause()` / `resume()` / `paused`, and `CardView` carries `text`, `reading`, `comboPower`, `comboCost` and `referee`; `BoardView.battle.contributions` exists. Verify the remaining specifics rather than rebuilding:

1. Every card in the band and the takeover is tappable and long-pressable and opens `Sheet` + `CardDetail`; opening pauses the beat player and closing resumes it.
2. For a card in a chain the detail shows its **combo power** and **combo cost**, the printed `text`, and — when it has one — its battle trigger and **what that trigger contributed**, read from `battle.contributions[cardId]`. This last figure answers "why is the total 35,000?" and is the reason the inspector is in the brief.
3. A hidden card (a counter the viewer may not see) shows no face — `maskBeats`/`revealedTo` rules apply in the inspector too.

**Out of scope.** Any new `Snapshot` field; a new sheet component.

**Acceptance.**
- `npm run typecheck && npm run lint && npm test && npm run build`.
- Scenario proof: in a Sparring game with a combo and a triggered skill, open the inspector on the combo card mid-playback — the playback pauses, the contribution figure matches the total's change, closing resumes. Screenshot attached, or a closing comment listing what was verified with file references.
