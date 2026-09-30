---
title: Arena: phone card review as a pager — swipe, prev/next, thumbnail strip, and a review-the-board button
issue: 348
milestone: Arena M16 — Board redesign: play feel and card review
labels: backlog, ready-for-agent, enhancement, area:arena-ui, phase:board-redesign, model:sonnet-5
stage: ui
status: closed
touches: src/components/arena/shared-sheets.tsx, src/components/arena/stage/ArenaStage.tsx, src/components/arena/ArenaCard.tsx
---
**Source:** `docs/arena-board-redesign-spec.md` decision 5; frames `docs/arena-redesign/phone-06-review-cards-in-play.jpg`, `docs/arena-redesign/phone-05-refusal-energy-short.jpg`; `src/components/arena/shared-sheets.tsx` (`Sheet`, `CardSheet`); `src/components/arena/ArenaCard.tsx` (`startPress`, 450 ms).

**Problem.** On the phone, a long press opens one card's sheet. Reviewing the board means close, long-press, close, long-press, once per card. The owner wants phone-appropriate navigation.

**Build** (below lg):
1. **The review sheet pages.** When `CardSheet` opens on a card, it knows the sequence that card belongs to: *in play* (the opponent's leader, the opponent's battle area, your leader, your battle area) or *your hand*. It shows:
   - The position ("IN PLAY 3 / 6").
   - A thumbnail strip of the sequence, 34×46 thumbnails with a 44 px hit area and a coloured underline for the owner. The current thumbnail is raised. A tap jumps to that card.
   - Prev and next buttons, 44 px, overlapping the card's edges.
   - Swipe: left or right over 50 px moves one card, and down over 90 px closes the sheet. Mark the sheet `touch-action: pan-y`, and suppress the button click that ends a swipe.
2. **An eye button** in the phone top bar ("Review cards in play") opens the sheet on the opponent's leader.
3. **A card that cannot act, tapped, opens its review** with the reason in the chip row, instead of only a refusal line. This covers your rested card, one played this turn, and the opponent's standing card. It does not apply while targeting, where the tap means "pick this target".
4. **Same content as the desktop inspector** (rd-05): owner and zone, state chips, stat tiles, text, reason, and the actions it has now. Close is always last, with "or swipe down".
5. **Long press keeps its visible progress bar.** Opening the sheet during playback still pauses it.

**Out of scope.** Desktop (rd-05), and search sheets (`SearchSheet` keeps its own list).

**Acceptance.**
- `npm run typecheck && npm run lint && npm test && npm run build`.
- rd-01 phone shot with `--tap` on the eye button, both skins, beside `phone-06`.
- **Scenario proof** on touch emulation:
  - From the eye button, reach every card in play by swiping only.
  - A tap on a thumbnail jumps.
  - Swipe down closes.
  - A tap on a hand card in the Main phase still behaves as today, or drags per rd-03.
