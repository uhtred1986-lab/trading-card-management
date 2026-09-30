---
title: Arena: desktop card review with zero clicks — docked inspector on hover, In play list, right-click pins
issue: 347
milestone: Arena M16 — Board redesign: play feel and card review
labels: backlog, ready-for-agent, enhancement, area:arena-ui, phase:board-redesign, model:sonnet-5
stage: ui
touches: src/components/arena/stage/ArenaStage.tsx, src/components/arena/shared-display.tsx, src/components/arena/shared-sheets.tsx, src/components/arena/ArenaCard.tsx
---
**Source:** `docs/arena-board-redesign-spec.md` decision 4; frames `docs/arena-redesign/desk-06-review-cards-in-play.jpg`, `docs/arena-redesign/desk-01-board-your-turn.jpg`, `docs/arena-redesign/desk-05-refusal-energy-short.jpg`; `src/components/arena/shared-display.tsx` (`CardPreview`); `src/components/arena/shared-sheets.tsx` (`CardDetail`, `CardSheet`); `src/components/arena/stage/StageZones.tsx` (`ReferenceCounts`).

**Problem.** The owner wants to review cards in play with the fewest clicks on desktop. Today a hovered card shows a floating `CardPreview` next to it. It moves with the card, covers the board, and vanishes when the pointer moves to read it. There is no way to see every card in play at once.

**Build** (lg and up; below lg nothing changes except via rd-06):
1. **A docked inspector column** on the right of the board. It replaces the floating `CardPreview` at this width. It shows:
   - the card large, its owner and zone ("Claude's battle area")
   - state chips: Rested / Standing / Played this turn / Can attack / Valid target / "1 energy short"
   - cost, power and combo as three stat tiles, or power, life and energy for a leader
   - the card text through `CardDetail` (minus the debug parts rd-08 moves)
   - a plain sentence for anything it cannot do, from `whyByCard`
   - the actions it has right now, with their price (Play −3 energy, Charge +1, Attack with it, Attack it)
2. **Hover fills it — zero clicks.** It follows hover on any card: yours or the opponent's, in hand, in play, leaders, combo cards in a battle band. It keeps the last card until another is hovered, so the pointer can travel to its buttons. With nothing hovered yet, it shows one line: "Hover any card to review it — no clicks needed."
3. **Right-click pins** (the existing right-click opens the sheet; on lg it pins the inspector instead). A pinned card stays until another is pinned or Escape clears it, and hover no longer replaces it.
4. **In play list**, a tab beside **Battle log** under the inspector. It shows both sides, the leader first, each card as art swatch, name, state and power, with a line per side like "2 in battle · 32,000 power". Hovering a row fills the inspector *and* outlines that card on the board. Clicking a row pins it. The Battle log tab is the existing log (after rd-08, the narration log).
5. **Layout.** The desktop grid becomes: left column (both players' life and the phase chips from rd-02), board, right column (inspector over the tabs). Rails and sizes follow `desk-01`/`desk-06`. The board keeps `--arena`.

**Out of scope.** Phone and tablet (rd-06), keyboard focus order beyond making rows and cards focusable (focus should fill the inspector the same way hover does), and the admin drawer (rd-08).

**Acceptance.**
- `npm run typecheck && npm run lint && npm test && npm run build`.
- rd-01 desktop shots, both skins: the board with a hovered opponent card and the In play tab, beside `desk-06`; the refusal state beside `desk-05`.
- **Scenario proof:** reviewing three different cards (one of Claude's, one of yours in play, one in hand) takes **no clicks**, and playing the reviewed hand card from the inspector takes **one**.
- Opening the inspector during playback does not pause it. Only the sheet pauses, as today.
