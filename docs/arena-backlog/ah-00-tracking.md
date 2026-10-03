---
title: Arena home tracking — Play and the Rules Workbench
issue: 366
milestone: Arena M17 — Arena home: Play and Rules Workbench
labels: epic, backlog, area:arena-ui, area:arena-workbench, phase:arena-home
stage: ui
tracking: true
status: closed
---
**Source:** `docs/arena-home-spec.md`; the "DBS Arena Redesign" canvas, rows *Arena home — launch a game in one tap* and *Rules workbench — one queue of card rules*.

The Arena pages outside the board grew to ten routes, one PR at a time. This milestone narrows them to two doors, **Play** (`/arena`) and **Rules** (`/arena/rules`). Launching a game becomes one tap from a chosen deck, and every card rule is worked from one queue. The owner decided these on 30 Sep 2026 (spec §1):
- Claude is the opponent up front.
- **The phone is the Arena**: everything around a game is designed for the phone, and Rules, decks and collection are made for the computer.
- Rules covers every deck, whoever owns it.
- A deck with an `open` rule cannot be played.
- The engine is no longer a question on the form.
- Old routes are deleted, not hidden.

The board is M16 (#352). The two milestones touch different files, apart from the ⋯ menu's admin entry (#350).

**Order and hot files** (`docs/arena-backlog.md` §7):
- **Group A — Play**, sequential: ah-01 → ah-11 → ah-02 → ah-03 → ah-12 → ah-05 → ah-14. All of them edit `src/app/arena/page.tsx`, the Arena header or the app shell.
- **Group B — Rules**, sequential: ah-06 → ah-07 → ah-08 → ah-09. All four edit `src/app/arena/rules/*` and `src/components/arena/rules/*`.
- **Group C**: ah-04 (`GameOver.tsx`). It can run beside A once ah-03's readiness query exists.
- **Group D — 1 v 1**: ah-13 (`src/app/arena/match/[id]/page.tsx`, `src/lib/arena/matches.ts`). It can run beside A after ah-03.
- ah-10 is a rename inside group B; do it with ah-06.

Group B can run in parallel with A after ah-01 lands, because ah-01 creates the shared header both groups use.

Child issues:

{{children}}
