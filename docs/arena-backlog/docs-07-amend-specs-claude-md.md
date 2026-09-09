---
title: Arena docs: amend the workbench spec, CLAUDE.md, the client contract and arena-tooling.md for the two engines and the language
milestone: Arena M14 — Rules language and ruleset documentation
labels: backlog, ready-for-agent, documentation, area:arena-docs, phase:rules-docs, model:sonnet-5
stage: docs
---
**Source:** the plan's Docs section: workbench spec §2.6/§3.6 (the DSL is a closed grammar isomorphic to the program, not a free-text page), `CLAUDE.md` (two engines and the selector, `lang/`, `rulesets/*.rules`, the glossary rule's scope now including `words.rules`, `Snapshot.engine/game`, the tally script), `docs/arena-client-contract.md`, the `games.ts` header comment, `docs/arena-tooling.md` (`--engine`, `arena:diff`, `verify/lang.ts`, `verify/rulesets.ts`).

**Build.** Go through each named place, check what has already been updated by the Stage 0–1 PRs (some of `CLAUDE.md` has), and finish the rest; the glossary rule in `CLAUDE.md` Conventions gains `words.rules` and `keywords.rules` as files in scope. Keep `docs/arena-next-session-prompt.md` the living handover: this issue does not rewrite it, but adds a pointer to the GitHub milestones as the place progress is tracked.

**Acceptance.** Each named document updated in one PR with a checklist in its description; `docs/arena-backlog.md` §4 (the filing rule) linked from `docs/arena-next-session-prompt.md`.
