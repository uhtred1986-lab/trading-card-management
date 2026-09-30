---
title: "Arena home: one header for Play and Rules — Play | Rules switch and a ⋯ menu"
issue: 355
milestone: Arena M17 — Arena home: Play and Rules Workbench
labels: backlog, ready-for-agent, enhancement, area:arena-ui, phase:arena-home, model:sonnet-5
stage: ui
touches: src/components/arena/ArenaHeader.tsx, src/components/arena/rules/RulesHeader.tsx, src/app/arena/page.tsx, src/app/arena/rules/page.tsx, src/app/arena/feedback/page.tsx
---
**Source:** `docs/arena-home-spec.md` §1 decision 1 and §2; `src/components/arena/rules/RulesHeader.tsx`; `src/app/arena/page.tsx` (the "What the engine reads" link row); canvas frames `PlayPhone`, `PlayDesktop`, `RulesDesktop`.

**Problem.** Play and Rules have no shared navigation.
- `/arena` has a row of five small text links: *keywords · set a card's rule · what you told me · what it cannot read*.
- `RulesHeader` has four tabs (*My decks · All cards · Patterns · Feedback*), a KPI strip and three more links.
- `/arena/feedback` and `/arena/[id]/debug` each have their own "← Arena".

None of these says where you are, and the two jobs look like ten pages.

**Build.**
1. `src/components/arena/ArenaHeader.tsx`: an **ARENA** wordmark, a two-segment **Play | Rules** switch (real links, `aria-current`, 44 px), and a ⋯ menu. The menu holds Games (ah-05), *What you told the arena* (`/arena/feedback`), Settings → Arena engine, and — only when #350's admin check passes — the admin entry. The Rules side carries the KPI strip (open in your decks · drafts to check · decks ready · catalog readable), which is today's `Kpi` from `RulesHeader`.
2. Use it on `/arena`, `/arena/rules` and `/arena/feedback`. Delete `RulesHeader`'s tab list; its KPIs move into the new header. Remove the link row from `/arena`.
3. Not on the board (`/arena/[id]`). That is full-bleed, and M16 owns it.
4. **On a phone** (below `sm`) the header is **ARENA**, a Games button and ⋯. There is **no Play | Rules switch**: the phone is the Arena (spec decision 6), and the Rules Workbench is made for the computer. ⋯ holds:
   - Games;
   - Play a friend;
   - Board settings (ah-14);
   - Report a problem;
   - under a divider, **Rules, decks and collection**, marked *made for the computer*, which links to `/arena/rules` and `/`.

   See frame `PlayPhone` → ⋯.

**Out of scope.** The contents of Play (ah-02) and Rules (ah-06), and the reference drawer (ah-08) — leave a placeholder button for it.

**Acceptance.**
- `npm run typecheck && npm run lint && npm test && npm run build`
- Keyboard: Tab reaches Play, Rules and ⋯ in order, and the active one is announced as the current page.
- Phone (390×844) and desktop (1440×900) screenshots in the PR, each beside its canvas frame.
