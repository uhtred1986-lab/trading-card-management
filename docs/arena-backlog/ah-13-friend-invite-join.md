---
title: "Phone: play a friend — share an invite link, and the guest picks a deck on the invite page itself"
issue: 369
milestone: Arena M17 — Arena home: Play and Rules Workbench
labels: backlog, ready-for-agent, enhancement, area:arena-ui, phase:arena-home, model:sonnet-5
stage: ui
status: closed
touches: src/app/arena/match/[id]/page.tsx, src/app/arena/actions.ts, src/components/arena/MatchWaiting.tsx, src/lib/arena/matches.ts
---
**Source:** `src/app/arena/match/[id]/page.tsx` (the guest reads *"Choose your own deck back on the arena page to start the game"*); `joinMatchForm` in `src/app/arena/actions.ts`; `CLAUDE.md` "1 v 1"; canvas frame `MatchPhone` (switch Host / Guest).

**Problem.** A 1 v 1 is two people on two phones, but:
- the host has no link to send;
- the guest who opens the match page is sent back to `/arena` to find the invitation in a list and pick a deck from a select.

**Build.**
1. **Host screen** (`/arena/match/[id]`, the host's view):
   - you vs *?* with both leaders, and a live *waiting* indicator (today's `MatchWaiting`);
   - the invite URL with **Share** (`navigator.share` when present, else copy to the clipboard with a confirmation);
   - one secondary **Call it off**.
2. **Guest screen** (same route, any other signed-in user):
   - the host's leader and deck;
   - a list of the guest's playable decks, using ah-03's readiness, with locked ones disabled and labelled;
   - **JOIN · FLIP THE COIN**, which calls today's `joinMatch`. The server-side lock check from ah-03 applies.
3. Invitations also appear in Games → Now (ah-05) with **Join**, which opens this page.
4. Seats and privacy are unchanged. A 1 v 1 belongs to its two seats (`CLAUDE.md`), and the invite page shows no hand or decklist beyond the leader and deck name.

**Acceptance.**
- `npm run typecheck && npm run lint && npm test && npm run build`
- Scenario: user A invites and taps Share. User B opens the link on another phone, picks a deck and joins, and both phones land on the board.
- A guest whose only decks are locked sees them disabled and cannot join.
- Phone (390×844) screenshots in the PR, each beside its canvas frame, host and guest.
