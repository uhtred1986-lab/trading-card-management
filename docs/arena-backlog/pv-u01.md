---
title: [P1] Arena: Expose authoritative ability availability and decision data
milestone: Arena M16 — Board redesign: play feel and card review
labels: backlog, ready-for-agent, enhancement, area:arena-ui, phase:board-redesign, model:sonnet-5
stage: ui
status: closed
issue: 558
priority: P1
touches: src/lib/arena/snapshot.ts, src/lib/arena/vm/view.ts, src/lib/arena/view.ts
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P1. **Delivery:** Playable board and fullscreen cards. **Plan key:** U01.

**Depends on:** #544 (T02), #545 (T03)

**Build.** Extend Snapshot with per-instance skill identity, manual availability/refusal reason, timing/zone/ownership/limit, pending Auto and passive effects; include authoritative cost/payment preview and decision actor/window. Use engine legal/rejection logic, not duplicated client timing rules. Update web/Android contract docs and fixtures.

**Files to verify first:** `src/lib/arena/snapshot.ts`, `src/lib/arena/vm/view.ts`, `src/lib/arena/view.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [x] Actual Main/Charge/Battle/Counter prompts and wrong-zone, exhausted-limit, resource and opponent-decision cases use authoritative engine evidence; hidden hand/Life identities are masked and stale actions remain rejected.
- [x] Fixed scenarios cover exact Counter line identity, read-only queries, privacy, queued/paused/cleared Autos and real #549 payment/decline/failure/reload continuations. Current same-window Counter menu selection remains first-line; other lines without an action identity are explicitly unidentified.
- [x] Web typecheck, lint, full tests, contract emission and build passed with DATABASE_URL=''; the 207 frozen probe digests remain unchanged. Android DTO fields are optional for older snapshots; Android runtime verification is unverified because Gradle could not resolve Kotlin plugin 2.1.0.
- [x] Contract-only before/after captures use committed artwork at 1440/390 in both skins plus short/200%-text/reduced-motion phone smoke captures. No visual behavior change is claimed; keyboard and new panel interaction acceptance belongs to #559/#561.
- [x] PR #615 is merged; actual cost-frame integration is verified in merged PR #616. Canonical status reflects this delivered scope.

**Evidence and limits.** `scripts/verify/ability-snapshot-558.ts`, `scripts/verify/auto-costs-549.ts`, the optional client/Android contract fields and `docs/arena-backlog/evidence/558/README.md`. No live database, paid provider or production configuration was used. Real catalog reading/fuzz and Android runtime claims are not made. This read-only projection does not expand rules support.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/snapshot.ts`, `src/lib/arena/vm/view.ts`, `src/lib/arena/view.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
