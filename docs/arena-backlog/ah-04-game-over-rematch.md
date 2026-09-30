---
title: "Arena home: game over — Rematch in one tap, Change deck, and the draft rules that fired this game"
issue: 358
milestone: Arena M17 — Arena home: Play and Rules Workbench
labels: backlog, ready-for-agent, enhancement, area:arena-ui, phase:arena-home, model:sonnet-5
stage: ui
touches: src/components/arena/GameOver.tsx, src/app/arena/actions.ts, src/lib/arena/games.ts
---
**Source:** `src/components/arena/GameOver.tsx` (stats, spend, "Ask Claude what to learn from this"); `docs/arena-home-spec.md` §2; canvas frame `GameOverPhone`.

**Problem.**
- **No rematch.** When a game ends, playing again means going back to `/arena` and re-filling the form.
- **No bridge from play to rules.** The game-over panel doesn't say which unchecked rules the game relied on, which is the best moment to check them.

**Build.**
1. **REMATCH**, the one filled button. A server action `rematch(gameId)` starts a new game with the same two decks, mode and engine (`engineFor(id)`), with a new seed, and redirects. For a 1 v 1 it opens a new match invitation from the same host deck instead.
2. **Change deck** → `/arena` with this game's deck preselected.
3. **"N draft rules fired this game"** — the distinct `card_rules` rows in `draft` whose skill resolved in this game, read from the game's events (the beats already name card and skill). Show the first two names. It links to `/arena/rules?game=<id>` (ah-06's *Fired in my last game* scope). Hidden when zero.
4. Keep *What to learn* (today's review) as a secondary button, *Look at the final board*, and *Report a problem* (`ReportBug`).

**Out of scope.** The victory/defeat effects (M16 #349).

**Acceptance.**
- `npm run typecheck && npm run lint && npm test && npm run build`
- Scenario: finish a Sparring game, tap REMATCH, and a new game with the same decks opens on turn 1 with a different coin flip.
- Scenario: in a game where a draft rule fired, the link opens Rules listing exactly those cards.
- Phone (390×844) and desktop (1440×900) screenshots in the PR, each beside its canvas frame.
