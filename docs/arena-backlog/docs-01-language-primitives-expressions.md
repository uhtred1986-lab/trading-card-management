---
title: Arena docs: the expression grammar and every Stage 2 primitive in arena-rules-language.md
milestone: Arena M14 — Rules language and ruleset documentation
labels: backlog, ready-for-agent, documentation, area:arena-docs, area:arena-lang, phase:rules-docs, model:sonnet-5
stage: docs
---
**Source:** `docs/arena-rules-language.md` §3 (grammar), §4 (worked examples), §8 (what Stage 1 left out); the Stage 2 issues (X and expressions, copySkills, forbid uses/unless, replace, control/skip, payWith, immunity, keyword-timing triggers, primitive-or-macro).

**Build.** For each Stage 2 primitive as it lands: its line in the grammar block, a worked example in §4 taken from a real card (number cited), and its entry in the errors section if it adds a refusal; the `expr` production rewritten for the expression tree; §8 updated to say what is now in. Keep the rule that statements are never listed by hand — they come from the schema — and add the test that every `OP_SCHEMA`/`COND_SCHEMA` row's name appears in the generated reference (next issue), not in this doc.

**Acceptance.** Each Stage 2 issue's PR touches this doc or links a follow-up here; `scripts/verify/lang.ts` parses every example in §4.
