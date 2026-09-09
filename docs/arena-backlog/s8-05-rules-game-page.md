---
title: Arena: /arena/rules/game shows the .rules files, and /arena/rules/keywords renders from the definition
milestone: Arena M11 — Everything else from config (Stage 8)
labels: backlog, ready-for-agent, enhancement, area:arena-workbench, area:arena-rulesets, phase:rules-stage8, model:sonnet-5
stage: 8
---
**Source:** plan Stage 8; `src/app/arena/rules/keywords` (rendered from `glossary.ts`); the printer in `src/lib/arena/lang/print.ts` (client-safe).

**Problem.** The game is now written in files nobody can see from the app. The owner corrects cards in the workbench; the game's own rules should be readable beside them, in the same language, read-only.

**Build.**
1. `/arena/rules/game`: one section per `.rules` file, printed by the language's printer (never the raw file, so what is shown is what was parsed), with the manual sections from the comments shown as notes.
2. `/arena/rules/keywords` renders from `keywords.rules` plus the glossary's engine lines; the two must agree (the Stage 7 test).
3. A link from the record's WHEN/COST chips to the trigger or cost declaration they name.

**Out of scope.** Editing the definition in the app (owner's decision when the language settles).

**Acceptance.** Gate; the page renders every file; a Playwright-free check in `npm test` that the printed definition equals `printDefinitions(loadRuleset(...))`.
