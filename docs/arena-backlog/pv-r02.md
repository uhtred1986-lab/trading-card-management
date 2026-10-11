---
title: [P0] Arena: Resolve Auto skill costs with pay and decline decisions
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: backlog, blocked, enhancement, area:arena-vm, phase:capability-gap, model:opus-5
stage: ui
issue: 549
priority: P0
touches: src/lib/arena/vm/flow.ts, src/lib/arena/vm/costs.ts, src/lib/arena/vm/script.ts
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P0. **Delivery:** Rule engine correctness. **Plan key:** R02.

**Depends on:** #544 (T02)

**Build.** Give pending Auto skills a complete cost-planning, payable choice, paid resolution and optional decline path. Use current trigger/source/event bindings; no silent dropping of action-price or X-price skills. Resume deterministically after prompts; document mandatory versus optional behavior from the manual.

**Files to verify first:** `src/lib/arena/vm/flow.ts`, `src/lib/arena/vm/costs.ts`, `src/lib/arena/vm/script.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [ ] A triggered priced Auto pays exactly once and resolves; unaffordable and declined cases have distinct outcomes; two pending Autos preserve source and ordering after reload.
- [ ] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions.
- [ ] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable.
- [ ] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/vm/flow.ts`, `src/lib/arena/vm/costs.ts`, `src/lib/arena/vm/script.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
