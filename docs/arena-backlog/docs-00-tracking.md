---
title: Arena documentation tracking — the rules language and the ruleset
milestone: Arena M14 — Rules language and ruleset documentation
labels: epic, backlog, documentation, area:arena-docs, phase:rules-docs
stage: docs
tracking: true
---
The documentation that must exist for the rebuilt compiler to be usable by someone other than the sessions that built it. The plan names two documents — `docs/arena-rules-language.md` (grammar, literals, one example per §20 phrase, errors, the round-trip promise, row vs. text) and `docs/arena-ruleset-spec.md` (the interpreter contract: primitives, hooks, expressions; the definition files; how to add a game or a primitive; the oracle protocol; what stays code and why) — plus the amendments to the workbench spec, `CLAUDE.md`, the client contract and `docs/arena-tooling.md`.

**Rule:** a stage's code issue is not done until the documentation issue for what it added is done in the same PR or the next; the tracking issue of each stage lists its doc dependency. Documentation that a test can check (the grammar against the schema, the op list against the doc) is checked in `npm test`, as the effect-language legend is today.

Child issues:

{{children}}
