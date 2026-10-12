---
title: [P1] Arena: Emit face-up life trigger events
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: backlog, ready-for-agent, enhancement, area:arena-vm, phase:capability-gap, model:opus-5
stage: ui
status: closed
issue: 556
priority: P1
touches: src/lib/arena/vm/zones.ts, src/lib/arena/vm/events.ts, src/lib/arena/vm/triggers.ts
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P1. **Delivery:** Rule engine correctness. **Plan key:** R09.

**Depends on:** None; ready for an isolated implementation.

**Build.** Emit face-up life moments with correct source, audience and event binding per 3-9-2-1. Evaluate downstream Autos using the same event path as ordinary life transitions.

**Files to verify first:** `src/lib/arena/vm/zones.ts`, `src/lib/arena/vm/events.ts`, `src/lib/arena/vm/triggers.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [x] Face-up transition fires the intended Auto once; already face-up or unrelated movement does not; opponent views never reveal face-down life.
- [x] Positive, negative, reload and interaction cases have explicit state/event assertions: red/blue source-color matching, controller-only watchers, event-subject binding, no-op already face-up, unrelated Life-to-hand movement, a Battle-area face-up operation with a Life-area source, reload at the choice prompt and masked face-down Life in both viewers' snapshots.
- [x] `DATABASE_URL='' npm run typecheck`, `npm run lint` (0 errors; 5 pre-existing prototype warnings), `npm test`, `npm run build`, both legacy/rules `verify-arena` engines and the dedicated #556 cases pass. The frozen probe corpus/digests are unchanged; the old named face-up rules gap is removed. Glossary documents the 3-9-2-1 moment.
- [x] One bounded PR is prepared with evidence per acceptance bullet; this canonical backlog entry records completion. Live database, paid AI and production checks were not used.

**Owner-run check:** `arena:fuzz40` uses real saved-deck rows and requires the owner's database. It was not run because `DATABASE_URL` must remain empty in this environment; no fuzz pass is claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/vm/zones.ts`, `src/lib/arena/vm/events.ts`, `src/lib/arena/vm/triggers.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
