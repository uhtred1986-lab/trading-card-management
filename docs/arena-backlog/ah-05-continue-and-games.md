---
title: "Arena home: Continue the game in progress from the top, and a Games list with Rematch per row"
issue: 359
milestone: Arena M17 — Arena home: Play and Rules Workbench
labels: backlog, ready-for-agent, enhancement, area:arena-ui, phase:arena-home, model:sonnet-5
stage: ui
status: closed
touches: src/app/arena/page.tsx, src/components/arena/GamesList.tsx, src/lib/arena/games.ts
---
**Source:** `src/app/arena/page.tsx` (sections *Waiting for a player* and *Games*); `listGames`, `listOpenMatches`; canvas frames `PlayPhone` (Continue strip, Games button), `GamesPhone`, `PlayDesktop` (Games table).

**Problem.** A game in progress is one row among up to twenty finished ones, below the whole new-game form. Open 1 v 1 invitations sit between the form and the list.

**Build.**
1. **Continue strip**: the viewer's newest `playing` game, above the deck picker — "Continue vs Claude · turn 5 · your move". One tap opens it. Hidden when there is none.
2. **Games**:
   - Phone: the header's Games button opens `/arena?tab=games`, a screen of its own (frame `GamesPhone`). Two tabs:
     - **Now**: invitations, then games in progress (Continue for your move; Watch for a 1 v 1 waiting on the other seat).
     - **Finished**: Rematch per row, View for archived games.

     Each row is at least 64 px high, with a 44 px action.
   - Desktop: the table sits under the deck grid.
   - Each row shows the matchup, opponent label, turns and result, plus one action: Continue (playing), Rematch (over — reuses ah-04's action), or View (archived, #335).
   - Keep the legacy badge.
3. **Invitations**: someone else's open 1 v 1 appears as a Continue-style strip, *"Sam wants to play — Join"*, with the deck select on tap. Your own invitation shows *Waiting — call it off*.

**Acceptance.**
- `npm run typecheck && npm run lint && npm test && npm run build`
- Scenario: with one game in progress and several finished, the Continue strip is the first thing under the header on a 390×844 phone, and Rematch on a finished row starts a new game.
- Phone (390×844) and desktop (1440×900) screenshots in the PR, each beside its canvas frame.
