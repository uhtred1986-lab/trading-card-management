---
title: Arena: in the Charge phase, tap (touch) or double-click (mouse) a hand card to charge it
issue: 346
milestone: Arena M16 — Board redesign: play feel and card review
labels: backlog, ready-for-agent, enhancement, area:arena-ui, phase:board-redesign, model:sonnet-5
stage: ui
touches: src/components/arena/stage/ArenaStage.tsx, src/components/arena/stage/Hand.tsx, src/components/arena/stage/PromptPanel.tsx, src/lib/arena/prompt-words.ts, src/app/globals.css
status: closed
---
**Source:** `docs/arena-board-redesign-spec.md` decision 3; frames `docs/arena-redesign/phone-03-charge-phase.jpg`, `docs/arena-redesign/desk-03-charge-phase.jpg`; `src/components/arena/stage/ArenaStage.tsx` (`tapCard`: the explicit `!== "charge"` guard); `src/lib/arena/prompt-words.ts` (the Charge prompt).

**Problem.** Charging always goes through `CardSheet`, even when it is the card's only move, because "a misclick is too costly". The owner has ruled (30 Sep 2026) that **during the Charge phase** the gesture should charge directly: a tap on touch, a double-click with a mouse. Everywhere else the caution stays.

**Build.**
1. **When it applies.** Only when the engine's prompt is the Charge phase question for the viewer, and the tapped card has a legal `charge` action. Read this from the prompt and `legalActions`, never from a client phase counter (`docs/arena-workflow-spec.md` decision 5).
2. **Touch:** a tap on a hand card sends its `charge` action. Long-press review (450 ms) and drag (rd-03, 8 px threshold) still win over the tap, because both are decided before the tap fires.
3. **Mouse:** a double-click sends `charge`. A single click keeps its current meaning (select, or open the sheet). Do not delay single clicks waiting for a possible double-click; the first click's selection is harmless.
4. **Signifiers in the Charge phase:**
   - Every hand card that can be charged gets a dashed outline, ink on the sky and ki gold on night.
   - The prompt names the gesture: phone "Charge phase — tap a card to charge it (+1 energy), or drag one onto the board."; desktop "…double-click a hand card to charge it…".
   - **Skip charge** stays a visible button. It is the prompt's existing bare action, labelled plainly.
5. **Feedback.** The new energy chip pops in (`arena-chip` or equivalent) and a gold "+1 ENERGY" float rises beside your energy for 950 ms at 1×, scaled by pace. The narration says which card was charged.
6. **Refusal.** A tap or double-click on a card with no legal charge shows the `whyByCard` reason (for example, already charged this turn) and shakes the card, like any refusal.

**Out of scope.** Charging outside the Charge phase (unchanged: through the sheet), and undoing a charge.

**Acceptance.**
- `npm run typecheck && npm run lint && npm test && npm run build`.
- rd-01 shot of a Charge-phase fixture in both skins at both sizes, beside `*-03-charge-phase.jpg`. If no fixture sits in the Charge phase, add one with `contract:emit` and `android:test` in the same PR.
- **Scenario proof:**
  - Phone emulation: one tap charges, and the prompt moves on.
  - Mouse: one click does not charge, and a double-click does.
  - In the Main phase, a tap does not charge.
