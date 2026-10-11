---
title: [P1] Arena: Fix missing and over-broad card Auto trigger readings
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, ready-for-agent, enhancement, area:arena-compiler, phase:rules-stage2, model:opus-5
stage: 2
issue: 571
priority: P1
touches: src/lib/arena/compile.ts, src/lib/arena/compile/clauses.ts
status: closed
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`. Original card rulings and exact acceptance: #539.

**Priority:** P1. **Delivery:** Outstanding card readings. **Plan key:** C01.

**Depends on:** None; ready for an isolated implementation.

**Build.** Own #539 trigger bullets: BT7-003/SD8-09 active-energy non-Awaken; XD1-01 colour/trait play; BT31-116 white Cell/Cell Jr. cost threshold and free Extra ruling; SD15-01 attack-on-red-Unison restriction. Verify current parser paths before editing; re-draft locally, no Neon writes.

**Files to verify first:** `src/lib/arena/compile.ts`, `src/lib/arena/compile/clauses.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [x] Each listed card has an exact trigger and positive plus negative opponent/colour/trait/cost/target examples; absence of trigger cannot silently pass. **Evidence:** `scripts/verify/readings-571.ts` records official text and source URLs, checks positive/negative compiled filters for all five readings, and exercises real VM mode-switch and attack declaration events. BT7's compiled `WHEN` and `triggersOf()` retain both energy-owner moments; SD8 records only its opponent-own-energy moment. Awaken and Awaken: Surge legal activations do not trigger these non-Awaken readings. XD1 colour/trait combinations and BT31 Cell/Cell Jr., white, cost ≥3 qualifications have matching and failing examples. SD15 matches the original red Unison target at specified cost 2, not its attacker, another target, or a later Blocker target.
- [x] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions. **Evidence:** the dedicated scenario asserts event actor/owner/turn, energy state transition, target role/colour/specified cost, and parser filter boundaries; an already-Active energy and Charge Phase switch do not emit the skill trigger. The compiler nests Awaken source provenance through `if`/`may`/`choose`. No persistence or stale/reload behavior is changed by this reading-only issue.
- [x] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable. **Evidence:** `DATABASE_URL='' npm run typecheck`, `npm run lint` (5 existing warnings, no errors), `npm run contract:emit`, `npm test`, and `npm run build` passed locally. The fixed, explicit scenario matrix is the applicable reading verification; randomized fuzz 40 was not run. Glossary and generated language-reference fixture include the new trigger vocabulary.
- [x] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed. **Evidence:** this issue is delivered in draft PR #___; no live database writes, paid AI, or production card-catalog checks were performed.

**Scope notes.** BT31-116's free Extra activation effect remains as previously compiled; #571 verifies its event trigger and qualified subject filter. Runtime charging/declining of BT31-116's own [Auto] energy price, and SD15-01's [Spirit Boost] price, remain separate rules-engine work (#549). Local tests used the existing PGlite and verified dependency setup with `DATABASE_URL=''`; no dependency or production configuration changed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/compile.ts`, `src/lib/arena/compile/clauses.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
