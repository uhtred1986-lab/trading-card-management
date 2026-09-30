---
title: Arena board redesign tracking — play feel and card review
milestone: Arena M16 — Board redesign: play feel and card review
labels: epic, backlog, area:arena-ui, phase:board-redesign
stage: ui
tracking: true
---
**Source:** `docs/arena-board-redesign-spec.md`; `docs/arena-redesign/README.md` (the reference frames).

The owner's redesign of the arena board, decided 30 Sep 2026. The goals: more engaging (reveals, explosions, a fight that reads as a fight), turns that are unmissable, a board focused on the play with debug moved to an admin-only place, card review with the fewest clicks on desktop and pager navigation on the phone, drag and drop to place a card, and tap or double-click to charge in the Charge phase. The look is the anime sky, which is already the default skin.

Every issue names the frames in `docs/arena-redesign/` that it must match. **rd-01 goes first**: it gives every later PR a screenshot of the real board, from a contract fixture, in both skins at phone and desktop size, to put beside those frames.

**Order and hot files** (`docs/arena-backlog.md` §7):
- **Group A — hand and stage**, sequential in one session: rd-02 → rd-03 → rd-04. All three edit `ArenaStage.tsx`, `Hand.tsx` and `PromptPanel.tsx`.
- **Group B — review**, sequential in one session: rd-05 → rd-06. Both edit the inspector in `shared-sheets.tsx` and `shared-display.tsx`.
- **Group C — effects**: rd-07. It owns `globals.css` keyframes and `StageCard.tsx` moments, so rebase it after group A.
- **Group D — admin**: rd-08 → rd-09. Both touch `src/lib/auth/` and the debug route.

Groups B and D can run in parallel with A. C follows A.

Review rule for every PR in this milestone: attach the rd-01 screenshots of the states the issue changes. Put each beside its reference frame, in both skins, at phone and desktop size.

Child issues:

{{children}}
