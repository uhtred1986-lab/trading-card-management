---
title: Arena: add missing-energy chips to workflow UI
milestone: Arena M2 — Gameplay UX/HUD completion
labels: backlog, ready-for-agent, enhancement, area:arena-ui, phase:hud-workflow, model:sonnet-5
stage: ui
---
**Source:** `docs/arena-workflow-spec.md` §9 ("Not done: the missing-energy chips the prototype draws beside the energy strip") and §4 for the register; `src/lib/arena/wording.ts` (`refusal()`, `pill()`, `priceOf()`); `rejectedActions` and the `Requirement` shapes in `src/lib/arena/engine/`.

**Problem.** When a card is dead for want of energy the board shakes it and words the first requirement, but the energy strip itself says nothing. The prototype drew a chip per missing orb beside the strip — "needs {r}{r}, you have {r}" — which is the one place the player looks when deciding what to charge next turn.

**Build.**
1. From `rejectedActions`, for the card the player has selected (or the last refused tap), derive the missing orbs: total short, colours short. The arithmetic must come from the engine's `Requirement`, not be recomputed in the client (contract rule §1: no client evaluates a rule).
2. Render chips beside the energy strip in `ArenaStage.tsx`, painted from tokens only (skin rule), using `wording.ts` for the words so Android can carry the same table.
3. Hide during playback; clear when the selection changes.

**Out of scope.** Any change to `Snapshot`; if the requirement shape lacks a field the chip needs, file a contract issue rather than widening this one.

**Acceptance.**
- `npm run typecheck && npm run lint && npm test && npm run build`.
- A `wording.ts` test for the chip text over the requirement shapes in `contract/fixtures/*.json`.
- Scenario proof: screenshot at 375 px of a 3-cost card with one energy charged, both skins.
