---
title: "Rules Workbench: cover every deck regardless of owner — All decks, not My decks"
issue: 364
milestone: Arena M17 — Arena home: Play and Rules Workbench
labels: backlog, ready-for-agent, enhancement, area:arena-workbench, phase:arena-home, model:sonnet-5
stage: ui
status: closed
closed_at: 2026-09-30
touches: src/app/arena/rules/page.tsx, src/components/arena/ArenaHeader.tsx, src/components/arena/rules/RulesHeader.tsx
---
**Source:** `docs/arena-home-spec.md` §1 decision 7; `CLAUDE.md` Architecture, "Decks belong to a login too" (the rule-coverage pages were left out of #279 on purpose); `listDecks(db, { game: "dbs" })` in `src/app/arena/rules/page.tsx`.

**Ruling (owner, 30 Sep 2026).** Deck ownership doesn't matter to Rules. A rule is per card, so the queue, its scope chips and its counts cover every deck the arena can play, whoever owns it. Today's behaviour is therefore right, but the words are wrong: the scope says *My decks*, and the KPIs say *open in your decks*.

**Build.**
1. Rename the default scope to **All decks**, and the KPIs to *open in decks* / *drafts to check* / *decks ready*.
2. Keep the rules page's `listDecks` call without `viewer`. Add a one-line comment pointing at this ruling, so nobody "fixes" it.
3. Play (`/arena`) is unchanged: it lists the viewer's own decks, as #279 made it.

**Acceptance.**
- `npm run typecheck && npm run lint && npm test && npm run build`
- `grep -rn "My decks\|in your decks" src/app/arena src/components/arena` finds nothing.
