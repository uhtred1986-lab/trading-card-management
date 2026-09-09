---
title: Arena: wording, narration, glossary and lighting tables read from words.rules on the rules engine
milestone: Arena M11 — Everything else from config (Stage 8)
labels: backlog, ready-for-agent, enhancement, area:arena-ui, area:arena-rulesets, phase:rules-stage8, model:sonnet-5
stage: 8
---
**Source:** plan Stage 8; `src/lib/arena/wording.ts`, `narration.ts`, `effects.ts`, `lighting.ts` (`turnVars`, the printed colour → room), `glossary.ts`; `words.rules` from Stage 3; `docs/arena-turn-presence-spec.md` (the light is never the only signal).

**Problem.** Four pure tables turn a `Requirement`, a beat, a rule in force and a turn into English and colour. Their *vocabulary* (zone names, colours, modes) is DBS's, written in TypeScript. On the rules engine it comes from `words.rules`; the sentence *shapes* stay in code (they are the interpreter's, not the game's).

**Build.**
1. Each table takes a `Words` object (from the definition on `rules`, from the current constants on `legacy`); the constants become the DBS defaults so Android's Kotlin copy is unchanged.
2. Tests in `npm test` run each table with both sources and compare: identical output for DBS.
3. `lighting.ts` reads the colour list from `attributes.rules`; the Off setting still leaves the board unambiguous (the spec's test).

**Acceptance.** Gate; the comparison tests pass; `contract:emit` no change.
