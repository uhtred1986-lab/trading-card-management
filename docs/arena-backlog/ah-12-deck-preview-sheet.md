---
title: "Phone: see a deck's cards from Play — a sheet with counts, art and each card's rule state"
issue: 368
milestone: Arena M17 — Arena home: Play and Rules Workbench
labels: backlog, ready-for-agent, enhancement, area:arena-ui, phase:arena-home, model:sonnet-5
stage: ui
touches: src/components/arena/DeckPreviewSheet.tsx, src/app/arena/page.tsx, src/lib/arena/readiness.ts
---
**Source:** `docs/arena-home-spec.md` §1 decision 6; `deckInputFor` in `src/lib/arena/load.ts`; canvas frame `PlayPhone` → *See the cards*.

**Problem.** On a phone, the only way to see what is in a deck is `/decks/[id]`, which is made for the computer. A player choosing a deck in the Arena cannot check its cards, or see which ones hold it back.

**Build.**
1. A **See the cards** button on the selected deck (phone carousel and desktop panel) opens a bottom sheet (a side panel on the computer).
2. The sheet groups cards by zone (Leader, Battle, Extra, Z-Deck). Each row shows the count (e.g. 4×), a thumbnail, the name, colour and cost, and a rule-state glyph with an `aria-label`: open ring, draft half, confirmed dot, corrected dot.
3. Open cards sort to the top of their group. Read-only; no editing.
4. The data comes from the readiness helper (ah-03), extended to return per-card state. It is loaded when the sheet opens, not with the page.
5. The sheet is a real dialog: focus moves in, Escape and the scrim close it, and focus returns to the button.

**Acceptance.**
- `npm run typecheck && npm run lint && npm test && npm run build`
- Scenario (390×844): open the sheet on a locked deck; its open cards are first, and each can be told apart without colour.
- Phone (390×844) screenshots in the PR, each beside its canvas frame.
