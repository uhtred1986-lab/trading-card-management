---
title: Arena: flip the arena.engine default to rules after an Opus review
milestone: Arena M12 — Parity and the flip (Stage 9)
labels: backlog, enhancement, area:arena-vm, area:arena-ui, phase:rules-stage9, model:opus-5
stage: 9
---
**Source:** `src/lib/arena/engine-setting.ts` (Settings → Arena engine), `DEFAULT_ENGINE` in `engines.ts`, the badge on rules-engine games; the plan's Stage 9.

**Blocked on** the two parity issues in this milestone being closed.

**Build.**
1. `/code-review` on Opus 5 over `src/lib/arena/vm/` and `rulesets/` before the flip; findings fixed or filed.
2. `DEFAULT_ENGINE = "rules"`; the setting's default follows; the badge disappears (or inverts to mark legacy games); `ENGINE_INFO` notes updated; `POST /api/v1/games` default follows the setting.
3. `CLAUDE.md` "Two engines, chosen per game" rewritten for the new default; `docs/arena-client-contract.md` note on `Snapshot.game.engine`.

**Acceptance.** Gate; a new game from `/arena` with no choice made is on the rules engine; existing legacy games open unchanged; owner's confirmation in the PR.
