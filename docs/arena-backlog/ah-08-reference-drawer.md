---
title: "Rules Workbench: a Reference drawer — keywords, the game as files, the rule language, how to fix a card"
issue: 362
milestone: Arena M17 — Arena home: Play and Rules Workbench
labels: backlog, ready-for-agent, enhancement, area:arena-workbench, area:arena-docs, phase:arena-home, model:sonnet-5
stage: ui
touches: src/components/arena/rules/ReferenceDrawer.tsx, src/components/arena/ArenaHeader.tsx
---
**Source:** `src/app/arena/rules/keywords/page.tsx`, `src/app/arena/rules/game/page.tsx`, `src/app/arena/rules/language/page.tsx`; `RulesHeader` (links to keywords and the GitHub copy of `docs/arena-fixing-a-card.md`); canvas frame `RulesDesktop` (Reference button).

**Problem.** Four reference pages exist, but only *keywords* is linked from the Rules header. `/arena/rules/game` and `/arena/rules/language` are linked from nowhere in the UI. *How to fix a card* opens GitHub in a new tab.

**Build.**
1. A **Reference** button in the Rules side of `ArenaHeader` (ah-01). It opens a drawer (a sheet on the phone) with four entries: Keywords, The game as files, The rule language, How to fix a card.
2. Each entry opens its existing page. *How to fix a card* renders the markdown in-app if a renderer is already in the tree; otherwise it keeps the GitHub link, marked as external.
3. The WHEN/COST chips' deep links into `/keywords` (PR #322) stay as they are.

**Acceptance.**
- `npm run typecheck && npm run lint && npm test && npm run build`
- From `/arena/rules`, each of the four references is reachable in two taps.
