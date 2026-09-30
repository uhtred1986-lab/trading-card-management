---
title: "Rules Workbench: should the queue and deck readiness follow the deck owner? (#279 left this out)"
issue: 364
milestone: Arena M17 — Arena home: Play and Rules Workbench
labels: backlog, needs-owner-ruling, question, area:arena-workbench, phase:arena-home, model:sonnet-5
stage: ui
touches: src/app/arena/rules/page.tsx, src/lib/arena/readiness.ts
---
**Source:** `CLAUDE.md` Architecture, "Decks belong to a login too" (*"…the workbench's rule-coverage pages are deliberately out of scope"*); PR #288; `listDecks(db, { game: "dbs" })` in `src/app/arena/rules/page.tsx` (no `viewer`), against `listDecks(db, { game: "dbs", viewer })` on `/arena`.

**Problem.** Play lists the viewer's decks. Rules, "My decks", lists **every** login's decks as scope chips and counts their cards in its KPIs. With a second login, the Rules page says *"open in your decks"* about decks that aren't yours. The FIX N CARDS link from Play (ah-03) scopes by deck id, so it works either way.

**Decision needed.**
- **(a)** Scope the queue's *All my decks* and the KPIs to `viewer`. Editing a rule stays global: rules are per card, not per deck.
- **(b)** Keep it global and rename the scope *All decks*.

Recommendation: (a). It is one argument, and the readiness helper already takes deck ids.

**Acceptance (once ruled).** `npm run typecheck && npm run lint && npm test && npm run build`; with two logins, each sees only their own decks under *Cards in*.
