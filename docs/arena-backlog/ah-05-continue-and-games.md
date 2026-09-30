---
title: "Arena home: Continue the game in progress from the top, and a Games list with Rematch per row"
issue: 359
milestone: Arena M17 — Arena home: Play and Rules Workbench
labels: backlog, ready-for-agent, enhancement, area:arena-ui, phase:arena-home, model:sonnet-5
stage: ui
touches: src/app/arena/page.tsx, src/components/arena/GamesList.tsx, src/lib/arena/games.ts
---
**Source:** `src/app/arena/page.tsx` (sections *Waiting for a player* and *Games*); `listGames`, `listOpenMatches`; canvas frames `PlayPhone` (Continue strip, Games row), `PlayDesktop` (Games table).

**Problem.** A game in progress is one row among up to twenty finished ones, below the whole new-game form. Open 1 v 1 invitations sit between the form and the list.

**Build.**
1. **Continue strip**: the viewer's newest `playing` game, above the deck picker — "Continue vs Claude · turn 5 · your move". One tap opens it. Hidden when there is none.
2. **Games**:
   - Phone: a row *"Games · N played, M in progress"* opens `/arena?tab=games`.
   - Desktop: the table sits under the deck grid.
   - Each row shows the matchup, opponent label, turns and result, plus one action: Continue (playing), Rematch (over — reuses ah-04's action), or View (archived, #335).
   - Keep the legacy badge.
3. **Invitations**: someone else's open 1 v 1 appears as a Continue-style strip, *"Sam wants to play — Join"*, with the deck select on tap. Your own invitation shows *Waiting — call it off*.

**Acceptance.**
- `npm run typecheck && npm run lint && npm test && npm run build`
- Scenario: with one game in progress and several finished, the Continue strip is the first thing under the header on a 390×844 phone, and Rematch on a finished row starts a new game.
- Phone (390×844) and desktop (1440×900) screenshots in the PR, each beside its canvas frame.
