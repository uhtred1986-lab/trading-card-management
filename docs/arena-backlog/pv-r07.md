---
title: [P1] Arena: Enforce Heroic once-per-turn use
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: backlog, ready-for-agent, enhancement, area:arena-vm, phase:capability-gap, model:opus-5
stage: ui
issue: 554
priority: P1
status: closed
touches: src/lib/arena/vm/hooks.ts, src/lib/arena/vm/program.ts, src/lib/arena/vm/flow.ts, src/lib/arena/vm/activate.ts, src/lib/arena/vm/script.ts, src/lib/arena/rulesets/dbs/keywords.rules, src/lib/arena/rulesets/dbs/files.ts, src/lib/arena/glossary.ts, scripts/verify/heroic-554.ts, scripts/verify-arena.ts, scripts/verify/wordings.ts
---
**Source:** `docs/rules/rulemanual.txt` 22-35-1..3; `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Rule citation:** Rule Manual 22-35-2/3. The rules VM captures a Heroic Extra trigger only after successful payment, before its effect begins, and resolves it after that effect. The dedicated suite verifies printed Heroic skill identity and turn-duration self-negation; copied identity is not established by this ticket. An identity-less granted Heroic currently ends with an explicit terminal `NotYet` before its body or draw; follow-up #602 owns granted-skill identity support.

**Priority:** P1. **Delivery:** Rule engine correctness. **Plan key:** R07.

**Depends on:** None; ready for an isolated implementation.

**Build.** Implement Heroic suppression/reset per 22-35-3; account for source identity and owner turn. Extend glossary and named keyword coverage.

**Files to verify first:** `src/lib/arena/vm/hooks.ts`, `src/lib/arena/vm/keyword-do.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [x] A second eligible Heroic use in one turn is suppressed; a legal new turn resets the allowance; different owners cannot consume each other's limit.
- [x] Positive, negative, reload and interaction cases assert state, cost and events, including Extra activation, source departure, intervening negation, and the explicit granted-Heroic limitation.
- [x] Typecheck, lint, dedicated and named scenario verification, npm test and build pass; glossary and reading diff are updated. Real-deck arena:fuzz40 requires the owner's database and is owner-run.
- [x] One bounded PR with evidence per acceptance bullet; this canonical status is closed with the implementation.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/vm/hooks.ts`, `src/lib/arena/vm/keyword-do.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
