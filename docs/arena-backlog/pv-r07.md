---
title: [P1] Arena: Enforce Heroic once-per-turn use
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: backlog, ready-for-agent, enhancement, area:arena-vm, phase:capability-gap, model:opus-5
stage: ui
issue: 554
priority: P1
status: closed
touches: src/lib/arena/vm/hooks.ts, src/lib/arena/vm/program.ts, src/lib/arena/vm/flow.ts, src/lib/arena/vm/activate.ts, src/lib/arena/vm/script.ts, src/lib/arena/vm/state.ts, src/lib/arena/vm/triggers.ts, src/lib/arena/vm/index.ts, src/lib/arena/rulesets/dbs/keywords.rules, src/lib/arena/rulesets/dbs/files.ts, src/lib/arena/glossary.ts, scripts/verify/heroic-554.ts, scripts/verify-arena.ts, scripts/verify/wordings.ts
---
**Source:** `docs/rules/rulemanual.txt` 22-35-1..3; `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Rule citation:** Rule Manual 22-35-2/3. The rules VM captures a Heroic Extra trigger only after successful payment, before its effect begins, and resolves it after that effect. Captured hooks enter the persisted 9-6-6 pending queue, so confirmative processing such as the 21-6 zero-power move completes first; the pending draw still resolves after its Heroic source leaves. Conditions bound only to event participants are evaluated at capture, while mixed board/effect conditions remain live. Whole-skill negation and "can't activate skills" cancel before an identity guard. The dedicated suite verifies printed Heroic skill identity and turn-duration self-negation; copied identity is not established by this ticket. An identity-less granted Heroic with no governing negation/prohibition still ends with an explicit terminal `NotYet` before its body or draw; follow-up #602 owns granted-skill identity support.

**Priority:** P1. **Delivery:** Rule engine correctness. **Plan key:** R07.

**Depends on:** #548 for the coupled 21-6 confirmative-processing interaction. The issue branch is stacked on `arena-548-zero-power` until root retargets it after integration.

**Build.** Implement Heroic suppression/reset per 22-35-3; account for source identity and owner turn. Extend glossary and named keyword coverage.

**Files to verify first:** `src/lib/arena/vm/hooks.ts`, `src/lib/arena/vm/keyword-do.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [x] A second eligible Heroic use in one turn is suppressed; a legal new turn resets the allowance; different owners cannot consume each other's limit.
- [x] Positive, negative, reload and interaction cases assert state, cost and events, including Extra activation, source departure, intervening negation, event-time source qualification, the 21-6-before-Heroic order, prohibition/whole-skill cancellation and the explicit granted-Heroic limitation.
- [x] Typecheck, lint, dedicated and named scenario verification, npm test and build pass; glossary and reading diff are updated. Real-deck arena:fuzz40 requires the owner's database and is owner-run.
- [x] One bounded PR with evidence per acceptance bullet; this canonical status is closed with the implementation.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/vm/hooks.ts`, `src/lib/arena/vm/keyword-do.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
