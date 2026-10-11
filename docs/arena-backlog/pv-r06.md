---
title: [P1] Arena: Resolve static identity keyword and negation layers
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: backlog, enhancement, area:arena-vm, phase:capability-gap, model:opus-5
stage: ui
issue: 553
priority: P1
touches: src/lib/arena/vm/effects.ts, src/lib/arena/vm/program.ts, src/lib/arena/vm/script.ts, src/lib/arena/vm/script-schema.ts, src/lib/arena/compile/effects.ts, src/lib/arena/types.ts, src/lib/arena/rulesets/dbs/ops.rules, src/lib/arena/rulesets/dbs/files.ts, src/lib/arena/effects.ts, src/lib/arena/glossary.ts, scripts/verify/static-layers-553.ts, scripts/verify/compiler.ts, scripts/verify/language.ts, scripts/verify/probe.ts, scripts/verify-readiness.mts, scripts/verify-arena.ts, contract/fixtures/effect-language.txt, contract/fixtures/language-reference.txt, contract/probe-rules-parity.json
status: closed
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P1. **Delivery:** Rule engine correctness. **Plan key:** R06.

**Depends on:** None; ready for an isolated implementation.

**Build.** Audit DEFERRED_STATICS and implement the unsupported gains/list-attribute identity, keyword grants and skill-negation layering with source/duration provenance. Existing hook contract #153 remains completed; this is a runtime follow-up.

**Files to verify first:** `src/lib/arena/vm/effects.ts`, `src/lib/arena/vm/filters.ts`, `src/lib/arena/vm/hooks.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Scope and owner-run limitations.** The compiler retains the 20-1 all-area qualifier through the gains macro and all four list-attribute expansions. Previously stored compiled rows without that marker still treat a static source as play-valid only; rebuilding those rows is owner-run and no database backfill was performed. SkillKindPrefix supports Auto, Activate, Counter and Permanent, not keyword skills, so type-wide keyword negation is not claimed. Aegis's original-colour candidate eligibility remains a separate follow-up; generic selectors continue to use effective colours. A targeted public-catalog reading dump could not resolve api.deckplanet.net (EAI_AGAIN). The 40-game fuzzer requires database-backed decks; with DATABASE_URL='' it found no decks, so that check remains owner-run. No live database was accessed.

**Acceptance.**
- [x] Identity gains reach effective selectors and expire with their source/duration; keyword grants and named negation compose in the declared order; removing the source removes only its static effects. **Evidence:** scripts/verify/static-layers-553.ts asserts effective trait/colour/name selection, source removal, timed gain persistence across source departure and JSON reload, expiry, named-negation precedence/refusal, and all-skill negation agreement across hasKeyword, the public keyword attribute, skillLess, and the real skill-less selector.
- [x] Positive, negative, source-validity and interaction cases have explicit state assertions. **Evidence:** compiler tests retain allAreas:true only for explicit 20-1 “in all areas” text; off-table Permanent tests prove the explicit wording applies from hand while unqualified identity changes remain invalid under 9-1-3. The test also reproduces the Aegis hand-coverage mismatch with one originally Red card that gains Blue: effective coverage passes Red/Blue while printed colours do not. The Aegis body itself remains unchanged and requires a separate original-colour selector follow-up.
- [x] Typecheck, lint, scenario verification, npm test and build pass; contract and glossary evidence are updated. **Evidence:** DATABASE_URL='' npm test passed (legacy 29/29; rules-only 27/29, with the two oracle-based suites intentionally not run); npm run lint passed with five pre-existing prototype warnings and zero errors; npx tsc --noEmit, the dedicated scenario, ruleset checks and DATABASE_URL='' npm run build passed. Contract emission wrote zero legacy fixtures; contract/probe-digests.json stayed unchanged, and the rules parity record now shows the named-negation case as matching.
- [x] One bounded PR and canonical status updated on completion. **Evidence:** PR #___ carries this implementation and evidence. No live database, paid AI, or production checks were run.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/vm/effects.ts`, `src/lib/arena/vm/filters.ts`, `src/lib/arena/vm/hooks.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
