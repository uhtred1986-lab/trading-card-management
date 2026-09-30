---
title: "Arena: a real phone entry point — today it is a 12 px header link, not a tab"
issue: 365
milestone: Arena M17 — Arena home: Play and Rules Workbench
labels: backlog, needs-owner-ruling, accessibility, area:arena-ui, phase:arena-home, model:sonnet-5
stage: ui
touches: src/lib/navigation.ts, src/components/AppShell.tsx, src/components/BottomTabs.tsx
---
**Source:** `src/lib/navigation.ts` (`NAV_ITEMS` are Home, Collection, Cards, Decks, Add; Arena is in `SECONDARY_ITEMS`); `src/components/AppShell.tsx` (secondary items render as `rounded-md px-2 py-1 text-xs` links in the phone header); `CLAUDE.md` Conventions ("Use the `tap` class on controls for 44 px targets").

**Problem.** On a phone the Arena, the part of the app built phone-first, is reached through a text link about 24 px tall in the header, squeezed beside Leaders, Meta & News and Settings. It is below the app's own 44 px rule and easy to miss.

**Decision needed.**
- **(a)** Arena replaces a bottom tab (which: Cards or Add?).
- **(b)** A sixth tab (the grid is `grid-cols-5` today).
- **(c)** Keep it in the header, but give the secondary links the `tap` class and a *More* sheet.

**Acceptance (once ruled).** `npm run typecheck && npm run lint && npm test && npm run build`; Arena is reachable from any page on a 390×844 phone with one tap on a target of at least 44×44 px.
