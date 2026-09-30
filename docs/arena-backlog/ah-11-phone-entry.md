---
title: "Phone: the app is the Arena — an Arena shell on phones, and Arena as the first phone tab"
issue: 365
milestone: Arena M17 — Arena home: Play and Rules Workbench
labels: backlog, ready-for-agent, enhancement, accessibility, area:arena-ui, phase:arena-home, model:sonnet-5
stage: ui
status: closed
touches: src/lib/navigation.ts, src/components/AppShell.tsx, src/components/BottomTabs.tsx, src/components/arena/ArenaHeader.tsx
---
**Source:** `docs/arena-home-spec.md` §1 decision 6; `src/app/manifest.ts` (`start_url: "/arena"`, "this is installed to play"); `src/lib/navigation.ts` (`NAV_ITEMS`, `SECONDARY_ITEMS`, `isFullBleed`); `src/components/AppShell.tsx`; canvas frames `PlayPhone`, `GamesPhone`, `MatchPhone`.

**Ruling (owner, 30 Sep 2026).** *"The phone is really only there for playing the game in the arena."* Everything around a game must be designed for the phone. The rest of the app does not need to be.

**Problem.** The installed app already opens on `/arena`, but it lands in the whole app's chrome:
- a header whose phone-only secondary links (Leaders, Meta & News, Arena, Settings) are `px-2 py-1 text-xs`, about 24 px, below the app's own 44 px rule;
- a bottom tab bar (Home, Collection, Cards, Decks, Add) with no Arena tab at all.

About 114 px of a 390×844 screen goes to navigation the phone player does not use.

**Build.**
1. **Arena shell on phones.** Below `sm`, every Arena route except the board (already full-bleed) drops the app header and tab bar. That covers `/arena`, `/arena?tab=games` and `/arena/match/[id]`. These routes use `ArenaHeader` (ah-01: ARENA, Games, ⋯), with safe-area insets handled as `isFullBleed` routes do. Add an `isArenaShell(pathname)` beside `isFullBleed` in `src/lib/navigation.ts`. From `sm` up, nothing changes.
2. **Back to the rest.** ⋯ → *Rules, decks and collection* (marked made for the computer) links to `/`. The app's own pages keep their chrome.
3. **Arena first on the phone tab bar.** Outside the Arena, the phone tab bar's first tab is **Arena**, replacing *Home*. Home stays reachable from the header wordmark, and the desktop header is unchanged. Use a phone-only list in `navigation.ts` rather than changing `NAV_ITEMS` for both.
4. The remaining phone header links get the `tap` class (44 px).
5. `start_url` stays `/arena`.

**Out of scope.** Redesigning the non-Arena pages for phones.

**Acceptance.**
- `npm run typecheck && npm run lint && npm test && npm run build`
- Scenario (390×844, installed or not): `/arena` shows no app header and no tab bar. ⋯ → *Rules, decks and collection* reaches `/`, where the first tab is Arena, one tap back.
- Every control in the phone header and tab bar measures at least 44×44 px.
- Phone (390×844) screenshots in the PR, each beside its canvas frame.
