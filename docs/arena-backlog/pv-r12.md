---
title: [P1] Arena: Use original colors for keyword payment eligibility
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: backlog, ready-for-agent, enhancement, area:arena-vm, phase:capability-gap, model:opus-5
stage: ui
issue: 597
priority: P1
touches: src/lib/arena/vm/program.ts, src/lib/arena/vm/filters.ts, src/lib/arena/vm/script.ts, src/lib/arena/vm/keyword-do.ts, src/lib/arena/rulesets/dbs/keywords.rules, src/lib/arena/rulesets/dbs/attributes.rules
---
**Source:** `docs/rules/rulemanual.txt` §§22-29-3 (Arrival), 22-30-3 (Aegis), 22-34-3 (Revive); `src/lib/arena/vm/program.ts` covers condition and `src/lib/arena/rulesets/dbs/keywords.rules`; #553's identity-layer scenarios.

**Priority:** P1. **Plan key:** R12. **Milestone:** Arena M5 — Engine capability gaps and advanced mechanics. **Depends on:** #553 and #555. Coordinate cost/keyword/parser writers. Additional Auto-cost execution remains #549; Aegis cost ordering remains #595.

**Problem.** The shared color coverage condition reads effective colors. A printed Red hand card gaining Blue in all areas satisfies effective Red/Blue coverage while its original colors fail Blue coverage. The keyword definitions reuse that condition, but these three rules explicitly require original colors. Ordinary selectors must continue seeing effective colors granted by effects.

**Build.** Add a narrow reusable original-color selector/coverage option and opt these keyword payment checks into it. Preserve ordinary effective-color filters and the current Aegis mandatory continuation. Keep the color basis in the declared rule/condition rather than special-casing card IDs.

**Acceptance.**
- [ ] A printed Red card gaining Blue still matches ordinary effective Blue selectors but cannot supply an original Blue requirement; printed Blue gaining Red remains eligible for original Blue. Demonstrate actual keyword eligibility/payment candidates, not only an isolated color-set helper.
- [ ] Arrival, Aegis and Revive have independent positive/negative original-color fixtures with the correct source area, single/multicolor combinations, reload and interaction assertions. Any remaining own-cost limitation is shown separately, never counted as paid resolution.
- [ ] Source removal and timed identity expiry change effective selectors without rewriting printed/original payment eligibility. Both viewers retain hidden-hand/life privacy.
- [ ] Glossary/declared language/capability evidence reflect the narrow behavior; typecheck, lint, relevant independent rules verification, npm test and build pass. Preserve frozen legacy digests; owner-only live/fuzz checks are recorded accurately.

**Files to verify:** `src/lib/arena/vm/program.ts`, `src/lib/arena/vm/filters.ts`, `src/lib/arena/vm/script.ts`, `src/lib/arena/vm/keyword-do.ts`, `src/lib/arena/rulesets/dbs/keywords.rules`, `src/lib/arena/rulesets/dbs/attributes.rules` and language/schema adapters where required. No live database, paid AI, production settings, new dependencies or unrelated counter/activation redesign.

