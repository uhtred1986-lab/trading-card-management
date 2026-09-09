---
title: Arena: verify/rulesets.ts — the DBS definition is complete against the legacy engine
milestone: Arena M6 — Definitions in the language (Stage 3)
labels: backlog, ready-for-agent, enhancement, area:arena-rulesets, phase:rules-stage3, model:sonnet-5
stage: 3
---
**Source:** plan Stage 3 ("completeness against the old engine's unions"); `scripts/verify-arena.ts` and `scripts/verify/*.ts` (the twelve suites `docs/arena-tooling.md` §2 explains); `src/lib/arena/engine/types.ts` (`Area`, `Phase`, `Trigger`, `Prompt`), `script.ts` (`AREAS`, `KEYWORD_NAMES`).

**Problem.** Nothing would notice a zone, a trigger or a keyword the definition forgot until Stage 4 fails to play a card that uses it. The legacy engine's unions are the ground truth for what the game *has*; the definition must declare all of it and nothing else.

**Build.**
1. `scripts/verify/rulesets.ts`, wired into `scripts/verify-arena.ts` (part of `npm test`, DB-free): load the DBS ruleset and assert set equality with `AREAS`/`Area`, `Phase`, `Trigger`, `KEYWORD_NAMES`, `Prompt["kind"]`, and every `CardDef` attribute; report the difference in both directions by name.
2. Assert the loader's own guarantees on fixtures (dangling reference, duplicate, unknown hook) and that `printDefinitions(loadRuleset(files))` re-parses equal — the round-trip promise for whole files.
3. Add the suite to `docs/arena-tooling.md` §2's list with one line on what a failure means.

**Out of scope.** Semantics.

**Acceptance.**
- `npm test` runs the suite; removing one `ZONE` from `zones.rules` makes it fail naming the zone.
- `docs/arena-tooling.md` §2 updated.
