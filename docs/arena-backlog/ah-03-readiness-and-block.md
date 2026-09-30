---
title: "Arena home: rule readiness per deck, and a deck with an open rule cannot start a game"
issue: 357
milestone: Arena M17 — Arena home: Play and Rules Workbench
labels: backlog, ready-for-agent, enhancement, area:arena-ui, area:arena-workbench, phase:arena-home, model:sonnet-5
stage: ui
touches: src/lib/arena/rules-store.ts, src/lib/arena/readiness.ts, src/app/arena/page.tsx, src/app/arena/actions.ts, src/lib/arena/games.ts, src/lib/arena/matches.ts, scripts/verify-db.mts
---
**Source:** `docs/arena-home-spec.md` §1 decisions 3 and 6, and §3; `coverageFor` in `src/app/arena/page.tsx`; the deck loop in `src/app/arena/rules/page.tsx`; `src/lib/arena/vm/flow.ts` (on this engine an unread skill is a note: played as blank); canvas frames `PlayPhone` (switch to *Azure Sage Control*), `PlayDesktop`.

**Problem.**
- **Wrong copy.** `/arena` says a deck's open cards are *"put to Claude when they resolve"*. On the rules engine, the default since #166, an `open` row plays as blank and the log says so. The player finds out mid-game.
- **N+1 queries.** Both `/arena` and `/arena/rules` load every deck's cards with `deckInputFor` inside a `for` loop — one round-trip per deck, and more through `loadRules`.
- **Owner's ruling (30 Sep 2026).** A deck with any `open` rule must not start a game.

**Build.**
1. `src/lib/arena/readiness.ts`: `readiness(db, deckIds)` → per deck, distinct cards counted by worst state (open > draft > corrected > confirmed), plus the open cards' ids and names. **One** SQL query joining `deck_cards` to `card_rules`, through `rows()`. Include leaders. Z cards count too.
2. **Play** (ah-02's picker) shows a stacked bar and the four counts for the selected deck.
   - With any open card: a red box *"N cards have no rule yet"* naming them, and a **Locked** badge on the deck.
     - **Computer** (`sm` and up): each name links into Rules, and **PLAY becomes FIX N CARDS TO PLAY**, linking to `/arena/rules?deck=<id>&seg=open`.
     - **Phone**: Rules is made for the computer (spec decision 6), so there is no link. The copy says *fix them in Rules on the computer*, and **PLAY becomes PICK A READY DECK**, which moves the carousel to the next ready deck, with *"N of your decks are ready"* under it. Locked decks show red carousel dots.
     - The preselected deck is always the last-played **ready** one.
   - With none: *"Every card has a rule"*, plus a muted note of the unchecked drafts. Drafts never block.
   - The Claude-plays select marks a locked deck *"(N open, locked)"* and does not allow it.
3. **The server refuses the same thing** — `startGame` (both decks), `openMatch` (host deck) and `joinMatch` (joiner's deck) — with a thrown message naming the deck and the count. A refusal is the guard; the UI is the courtesy.
4. **Delete `coverageFor`** and the per-deck loop on `/arena`. Replace the loop on `/arena/rules` with the same helper (it still needs each deck's card set for scoping: a single query, grouped).
5. `scripts/verify-db.mts`: seed two decks, one with an open row. Assert the counts, and that `startGame` refuses the open one and accepts the other.

**Out of scope.** Making drafts block (decided against). The workbench filter the link lands on (ah-06; until it lands, `?deck=` and `?seg=open` already work on `/arena/rules`).

**Acceptance.**
- `npm run typecheck && npm run lint && npm test && npm run build`
- `npm test` includes the new `verify-db` case.
- Scenario (computer): a deck with one open card shows FIX 1 CARD TO PLAY; the link lands on Rules showing that card. Draft it, go back, and PLAY returns.
- Scenario (phone, 390×844): the same deck shows Locked and PICK A READY DECK, and one tap lands on a ready deck with PLAY.
- `grep -n "put to Claude when they resolve" -r src` finds nothing.
- Phone (390×844) and desktop (1440×900) screenshots in the PR, each beside its canvas frame, including the locked state.
