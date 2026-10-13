---
title: [P1] Arena: Implement Counter Counter response chains
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: backlog, blocked, enhancement, area:arena-vm, phase:capability-gap, model:opus-5
stage: ui
issue: 552
priority: P1
status: closed
touches: src/lib/arena/vm/flow.ts, src/lib/arena/vm/activate.ts, src/lib/arena/rulesets/dbs/battle.rules
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P1. **Delivery:** Rule engine correctness. **Plan key:** R05.

**Depends on:** #550 (R03)

**Build.** Add Counter: Counter windows and response-chain resolution per 9-7-3 using declared windows and authoritative costs. Separate opportunity, activation, negation and resolution and preserve targeting/privacy.

**Files to verify first:** `src/lib/arena/vm/flow.ts`, `src/lib/arena/vm/activate.ts`, `src/lib/arena/rulesets/dbs/battle.rules`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [ ] A Counter can be answered and negated; declining resolves the original; an unaffordable answer is unavailable; nested responses resume and expend costs once.
- [ ] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions.
- [ ] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable.
- [ ] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/vm/flow.ts`, `src/lib/arena/vm/activate.ts`, `src/lib/arena/rulesets/dbs/battle.rules` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
