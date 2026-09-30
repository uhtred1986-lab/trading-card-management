---
title: "Arena home: Play in one tap — deck carousel, Claude up front, no engine or debug fields"
issue: 356
milestone: Arena M17 — Arena home: Play and Rules Workbench
labels: backlog, ready-for-agent, enhancement, area:arena-ui, phase:arena-home, model:sonnet-5
stage: ui
touches: src/app/arena/page.tsx, src/app/arena/actions.ts, src/components/arena/PlayPicker.tsx, src/lib/arena/engine-setting.ts
---
**Source:** `docs/arena-home-spec.md` §1 decisions 2 and 4, §2; `src/app/arena/page.tsx`; `startGameForm` in `src/app/arena/actions.ts`; `engineForMode` in `src/lib/arena/games.ts`; canvas frames `PlayPhone`, `PlayDesktop`.

**Problem.** Starting a game today means reading a form top to bottom:
- **Two deck selects.** The second is labelled *"Second player's deck (ignored in a 1 v 1 — they pick their own)"*, and against Claude it is silently Claude's deck.
- **Four equal mode radios** with cost notes.
- **An Engine fieldset** that repeats a decision `startGameForm` already makes (`engineForMode(engineOr(…, defaultEngine))`, #166).
- **A debug checkbox**, checked by default and shown to every player.
- **A button called "Flip the coin"** and a paragraph of rules underneath.

Nothing is remembered between games.

**Build.**
1. **Your deck.**
   - Phone: a carousel, one deck at a time, with the leader art, name, size and 44 px prev/next buttons.
   - Desktop: a three-column grid; clicking a deck selects it.
   - The list comes from the same `playable` filter as today. The last deck this viewer played is preselected (from their newest `arena_games` row; no new storage needed).
   - Fusion World decks stay out, with the one-line reason under the grid.
2. **Opponent.** Three choices: *Claude · Sparring* (default), *Claude · Tournament*, *A friend*.
   - Keep today's measured-cost wording, shortened: "~12¢" / "~25¢", or the viewer's own average when there is one.
   - *A friend* opens a second row: *On their device* (1 v 1, disabled with today's reason when `canVersus` is false) or *Pass-and-play here* (mode `hotseat`).
3. **Claude plays** (Claude opponents only). One select of playable decks, defaulting to the deck Claude last played against this viewer.
4. **One button, PLAY**, at the bottom of the phone screen, in the thumb zone. *A friend* on their own device shows **INVITE A FRIEND**. One line of hint underneath; the rules paragraph goes.
5. **Remove** the Engine fieldset (the engine is resolved server-side as today) and the debug checkbox. `startGame` is called with `debug: true` for every game; who may *read* the record is #350's admin gate.
6. `startGameForm` reads `deck`, `opponent` (`sparring|tournament|versus|hotseat`) and `claudeDeck`. Drop `p1`/`p2`/`engine`/`debug` from the form contract, and keep the server-side engine resolution.

**Out of scope.** Readiness and the block (ah-03), the Continue strip and Games list (ah-05), and join-a-match UI beyond today's (it moves under Games in ah-05).

**Acceptance.**
- `npm run typecheck && npm run lint && npm test && npm run build`
- Scenario: with two playable decks and no games, `/arena` shows the first deck, Claude · Sparring selected, and PLAY. One tap starts a Sparring game on the rules engine. Play again: the same deck is preselected.
- Scenario: choosing *A friend → On their device* opens the match wait page (`/arena/match/[id]`), as today.
- `grep -n 'name="engine"\|name="debug"' src/app/arena/page.tsx` finds nothing.
- Phone (390×844) and desktop (1440×900) screenshots in the PR, each beside its canvas frame.
