---
title: Arena: add missing-energy chips to workflow UI
milestone: Arena M2 — Gameplay UX/HUD completion
labels: done, enhancement, area:arena-ui, phase:hud-workflow, model:sonnet-5
stage: ui
status: closed
closed_at: 2026-09-10
pr: 182
---
**Source:** `docs/arena-workflow-spec.md` §9 ("Not done: the missing-energy chips the prototype draws beside the energy strip") and §4 for the register; `src/lib/arena/wording.ts` (`refusal()`, `pill()`, `priceOf()`); `rejectedActions` and the `Requirement` shapes in `src/lib/arena/engine/`.

**Problem.** When a card is dead for want of energy the board shakes it and words the first requirement, but the energy strip itself says nothing. The prototype drew a chip per missing orb beside the strip — "needs {r}{r}, you have {r}" — which is the one place the player looks when deciding what to charge next turn.

**Build.**
1. From `rejectedActions`, for the card the player has selected (or the last refused tap), derive the missing orbs: total short, colours short. The arithmetic must come from the engine's `Requirement`, not be recomputed in the client (contract rule §1: no client evaluates a rule).
2. Render chips beside the energy strip in `ArenaStage.tsx`, painted from tokens only (skin rule), using `wording.ts` for the words so Android can carry the same table.
3. Hide during playback; clear when the selection changes.

**Verification Checklist:**
- [x] 1. Missing-energy chips rendered beside the energy strip in Arena stage when a selected card or action lacks required orbs/energy.
- [x] 2. Derived from requirement arithmetic without client-side rule evaluation.
- [x] 3. Token-based styling for light and dark arena skins.
- [x] 4. Linked to PR #182 and verified with full typecheck, lint, and build suites.

**Acceptance.** Verified and closed in PR #182.
