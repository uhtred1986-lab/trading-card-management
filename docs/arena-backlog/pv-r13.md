---
title: [P1] Arena: Preserve individual skill identity for granted Heroic
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: backlog, blocked, enhancement, area:arena-vm, phase:capability-gap, model:opus-5
stage: ui
issue: 602
priority: P1
touches: src/lib/arena/vm/program.ts, src/lib/arena/vm/hooks.ts, src/lib/arena/vm/script.ts, src/lib/arena/vm/effects.ts
---
**Source:** `docs/rules/rulemanual.txt` §§22-35-2/22-35-3 and 9-1-5; #554's granted-Heroic guard and reload fixture; `src/lib/arena/vm/program.ts` hook bodies and timed keyword grants.

**Priority:** P1. **Milestone:** Arena M5 — Engine capability gaps and advanced mechanics. **Depends on:** #554. Printed/copied Heroic once-per-turn execution remains #554; this issue owns granted-instance identity.

**Problem.** A Heroic supplied by an effect is currently represented only as a keyword value, without the individual skill identity needed by `negateOwnSkill`. Reusing a per-turn card flag or negating every Heroic copy would change the rule. #554 explicitly interrupts this unsupported case before the hook draws rather than permitting repeated payouts.

**Build.** Preserve a stable identity for each granted Heroic instance through hook capture, serialization, negation and expiry. Use normal pending-Auto timing and negate only the resolving instance through the turn. Keep printed/copied keyword identity and source-removal semantics intact.

**Acceptance.**
- [ ] A granted Heroic resolves once and is individually negated for the turn; a second legal trigger is suppressed and a later legal turn can use it again.
- [ ] Multiple printed/granted instances and independent source/owner cards do not consume each other's allowance. Grant expiry/source departure/regrant and JSON reload do not reuse stale identities.
- [ ] Real Heroic Battle plays and paid Extra activations cover capture-before-effect and resolution-after-effect interactions, including source removal/negation. Assert costs, state, events, invalid/declined activation and no blanket keyword negation.
- [ ] Remove the narrow granted-Heroic interruption only when positive runtime evidence exists; glossary/capability inventory retain precise scope. Typecheck, lint, relevant independent scenarios, npm test and build pass; frozen legacy corpus remains unchanged. Live DB/paid/fuzz checks are explicitly owner-run.

**Touch set to verify:** `src/lib/arena/vm/program.ts`, `src/lib/arena/vm/hooks.ts`, `src/lib/arena/vm/script.ts`, `src/lib/arena/vm/effects.ts` and minimum persisted effect/frame types where required. Single-writer engine/declaration/glossary/registry coordination applies. No live DB, dependencies, production changes or legacy deletion.

