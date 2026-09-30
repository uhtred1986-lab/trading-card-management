---
title: Arena: drag a card from hand onto the battle area to play it, or onto energy to charge it
issue: 345
milestone: Arena M16 — Board redesign: play feel and card review
labels: backlog, ready-for-agent, enhancement, area:arena-ui, phase:board-redesign, model:sonnet-5
stage: ui
touches: src/components/arena/stage/Hand.tsx, src/components/arena/stage/ArenaStage.tsx, src/components/arena/stage/StageCard.tsx, src/components/arena/stage/StageZones.tsx, src/app/globals.css
---
**Source:** `docs/arena-board-redesign-spec.md` decisions 1–2; frames `docs/arena-redesign/phone-04-drag-to-play.jpg`, `docs/arena-redesign/desk-04-drag-to-play.jpg`, `docs/arena-redesign/phone-05-refusal-energy-short.jpg`; `src/components/arena/stage/Hand.tsx`; `src/components/arena/stage/anchors.tsx` (`data-arena-zone` rectangles); `src/components/arena/stage/ArenaStage.tsx` (`tapCard`, `taps`, `whyOf`); prototype `docs/arena-redesign/prototype/arena.js` (`dragDown` / `dragMove` / `dragUp`).

**Problem.** The owner wants to place a card by drag and drop. Today a card is played by tap: the single legal move is sent, or `CardSheet` opens. The only drag in the arena resizes the hand.

**Build.**
1. **Drag source: hand cards.** Use pointer events with pointer capture; HTML5 drag-and-drop fires nothing on touch. `motion` is already a dependency and used for the hand handle, and `motion`'s `drag` is acceptable if it does not fight the `layoutId` flight of a card leaving the hand. If it does, use a pointer-events ghost, as the prototype does. gullet-cove-dm's `BattleGrid.tsx` uses `@dnd-kit/core` and is the fallback precedent, but do not add a dependency unless neither works. The drag starts only after 8 px of movement, so tap, long-press review (450 ms) and double-click keep working. Cards get `touch-action: none` so the page does not scroll instead.
2. **Drop targets** come from the existing zone anchors: your battle area plays the card, your energy zone charges it. Hit-test with `document.elementFromPoint` or the anchor rectangles, not hard-coded coordinates.
3. **Legality is the engine's.** On drop over the battle area, send the `play` action from `legalActions` for that card id. If `play` has more than one legal option (for example a choice of payment), open `CardSheet` preselected on Play instead of guessing. If there is no legal play, show the first `whyByCard` requirement as the refusal line, shake the card and snap it back. A drop over energy does the same with `charge`.
4. **Feedback while dragging** (see the frames):
   - A ghost card follows the pointer, tilted, and straightens and grows over a valid zone.
   - The source card fades in the hand.
   - The valid zone gets a dashed outline, which turns solid with a soft fill while hovered. An invalid zone turns red while hovered.
   - The next empty battle slot pulses.
   - A pill above the zone says "Drop to play · −3 energy" or "1 energy short".
   - The energy chips that would rest pulse, and missing ones show dashed red. This uses the existing missing-energy chips.
   - The energy zone's own tag is hidden unless the pointer is over it or it is a valid target, so it does not shout "Already charged" during every play.
5. **Snap-back** (440 ms) for a drop outside any zone or a refused drop.
6. **Tap stays.** The tap flow and `CardSheet` are unchanged. The prompt text tells players about drag: "N moves available — drag a glowing card up to play it, or tap a ready card to attack."

**Out of scope.** Drag to attack or drag to target (attacks stay tap-then-tap, spec decision 1), and dragging combo cards in a battle.

**Acceptance.**
- `npm run typecheck && npm run lint && npm test && npm run build`.
- rd-01 shot of a drag in progress, using `--tap` or a scripted pointer, beside `*-04-drag-to-play.jpg`.
- **Scenario proof** (describe in the PR, on phone emulation and a mouse):
  - Drag an affordable card to the battle area and it plays with the reveal.
  - Drag an unaffordable one and it snaps back with "costs 3 — 2 energy active, 1 short".
  - A short tap still opens the sheet.
  - A 450 ms hold still opens the review.
