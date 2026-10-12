---
title: Arena: Replace AI presentation oracle with fixed expectations
milestone: Arena M13 — Retire the legacy engine (Stage 10)
labels: enhancement, backlog, ready-for-agent, area:arena-vm, phase:rules-stage10, model:opus-5
stage: 10
issue: 601
priority: P2
status: closed
touches: scripts/verify/ai-vm.ts, scripts/verify/fixtures/ai-vm, docs/arena-backlog/evidence/601
---
**Source:** #459; `scripts/verify/ai-vm.ts`; `docs/arena-tooling.md`; `docs/agent-brief.md`.

**Parent:** #459. **Milestone:** Arena M13 — Retire the legacy engine. This is a bounded test migration; `vm.ts` and legacy deletion #118 remain open.

**Build.** Replace the AI rules-engine suite's live legacy state/text/menu/request oracle with checked-in, independently reviewed expectations. Preserve its existing request-shape, fake-provider and shortcut assertions. Run it under `--rules-only` after the coordinator releases the suite registry.

**Acceptance.**

- [x] All 21 dynamic cross-engine parity checks retain equivalent fixed state/text/decklist/question/system/menu assertions; count loops separately from source call sites. Fixture rationale and an assertion-mapping table explain each replacement.
- [x] Main-phase and mid-battle fixtures use reviewed card/zone/turn facts, full strings where meaningful and exact legal move sets. No legacy engine is invoked to compute expectations during the test, and a meaningful altered fixture fails.
- [x] Existing fake-provider/transport request and shortcut assertions remain; no paid call or live database. Frozen legacy probe corpus and #118 saved-game coverage remain unchanged.
- [x] Focused AI suite, `--rules-only`, typecheck, lint, `npm test` and build pass; evidence is reviewed and status is updated. #459 remains open.

**Touch set.** `scripts/verify/ai-vm.ts`, `scripts/verify/fixtures/ai-vm/*`, `docs/arena-backlog/evidence/601/README.md`, this file and the #459 audit link. `scripts/verify-arena.ts` and the oracle registry are coordinator-owned; no runtime engine/compiler edits, schema changes, dependencies, settings or legacy corpus updates.

**Evidence:** `docs/arena-backlog/evidence/601/README.md`.
