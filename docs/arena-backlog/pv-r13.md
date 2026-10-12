---
title: [P1] Arena: Preserve individual skill identity for granted Heroic
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: backlog, enhancement, area:arena-vm, phase:capability-gap, model:opus-5
stage: ui
issue: 602
priority: P1
status: closed
touches: src/lib/arena/vm/program.ts, src/lib/arena/vm/hooks.ts, src/lib/arena/vm/script.ts, src/lib/arena/vm/effects.ts
---
**Source:** `docs/rules/rulemanual.txt` §§22-35-2/22-35-3 and 9-1-5; #554's granted-Heroic guard and reload fixture; `src/lib/arena/vm/program.ts` hook bodies and timed keyword grants.

**Priority:** P1. **Milestone:** Arena M5 — Engine capability gaps and advanced mechanics. **Depends on:** #554. Printed/copied Heroic once-per-turn execution remains #554; this issue owns granted-instance identity.

**Problem.** A Heroic supplied by an effect is currently represented only as a keyword value, without the individual skill identity needed by `negateOwnSkill`. Reusing a per-turn card flag or negating every Heroic copy would change the rule. #554 explicitly interrupts this unsupported case before the hook draws rather than permitting repeated payouts.

**Build.** Preserve a stable identity for each granted Heroic instance through hook capture, serialization, negation and expiry. Use normal pending-Auto timing and negate only the resolving instance through the turn. Keep printed/copied keyword identity and source-removal semantics intact.

**Acceptance.**
- [x] A granted Heroic resolves once and is individually negated for the turn; a second legal trigger is suppressed and a later legal turn can use it again.
- [x] Multiple printed/granted instances and independent source/owner cards do not consume each other's allowance. Grant expiry/source departure/regrant and JSON reload do not reuse stale identities.
- [x] Real Heroic Battle plays and paid Extra activations cover capture-before-effect and resolution-after-effect interactions, including source removal/negation. Assert costs, state, events, invalid/declined activation and no blanket keyword negation.
- [x] Remove the narrow granted-Heroic interruption only when positive runtime evidence exists; glossary/capability inventory retain precise scope. Typecheck, lint, relevant independent scenarios, npm test and build pass; frozen legacy corpus remains unchanged. Live DB/paid/fuzz checks are explicitly owner-run.

**Evidence:** `scripts/verify/granted-heroic-602.ts` covers timed, copied [Permanent], and standing grants, paid Extra ordering, owners, expiry, source and bearer reentry, JSON reload, declined and invalid activation, public projection, and older identity-less frames. `scripts/verify/heroic-554.ts` retains printed controls. Local typecheck, lint, npm test, build, contract emission and capability checks passed with `DATABASE_URL=''`; the frozen legacy probe corpus remained unchanged. Live DB, paid and database-backed fuzz checks are owner-run.

**Touch set to verify:** `src/lib/arena/vm/program.ts`, `src/lib/arena/vm/hooks.ts`, `src/lib/arena/vm/script.ts`, `src/lib/arena/vm/effects.ts` and minimum persisted effect/frame types where required. Single-writer engine/declaration/glossary/registry coordination applies. No live DB, dependencies, production changes or legacy deletion.

