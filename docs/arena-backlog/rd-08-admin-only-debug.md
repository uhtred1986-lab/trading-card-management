---
title: Arena: move debug and engine internals off the player's board — an admin-only drawer
milestone: Arena M16 — Board redesign: play feel and card review
labels: backlog, ready-for-agent, enhancement, area:arena-ui, phase:board-redesign, model:sonnet-5
stage: ui
touches: src/lib/auth/index.ts, src/app/arena/[id]/page.tsx, src/app/arena/[id]/debug/page.tsx, src/components/arena/ArenaCard.tsx, src/components/arena/shared-sheets.tsx, src/components/arena/stage/ArenaStage.tsx, src/components/arena/stage/Hand.tsx, CLAUDE.md
---
**Source:** `docs/arena-board-redesign-spec.md` decision 8; frames `docs/arena-redesign/phone-11-admin-debug-drawer.jpg`, `docs/arena-redesign/desk-11-admin-debug-drawer.jpg`; `src/lib/auth/index.ts` (`currentUser`); `src/proxy.ts`; `src/components/arena/ArenaCard.tsx` (the REF badge); `src/components/arena/shared-sheets.tsx` (`CardDetail`'s "Engine reads" box); `src/app/arena/[id]/debug/page.tsx`.

**Problem.** A player sees engine internals on the board:
- the yellow "REF" badge
- the "Engine reads: …" / "Not fully compiled…" box and the permanent-line notes in `CardDetail`
- raw card ids
- the raw monospace engine log beside the hand
- the "how Claude played" / "what the server decided" links and the "legacy" engine badge in the game header

The owner wants the screens focused on the play, with this information hidden away **for admins, for later review**. There is no admin concept in the app today.

**Build.**
1. **`isArenaAdmin()`** in `src/lib/auth/`. It returns true when `currentUser()` is listed in `ARENA_ADMINS` (comma-separated, trimmed, case-insensitive), or when Basic Auth is off (local dev, where everyone is the owner). It is server-side only, passed to the board as a boolean prop, and never inferred on the client. Document the variable in `CLAUDE.md`'s auth paragraph in one line.
2. **For non-admins, remove from the board** (not merely hide with CSS):
   - the REF badge
   - the "Engine reads" / compile notes and raw ids in `CardDetail` — the card's own printed text stays
   - the debug links and the engine badge in the header
   - the raw engine log, which is replaced for everyone by the **narration log** (the narrated sentences `NarrationRibbon` already produces, newest first, with turn numbers)
3. **Keep for everyone:** the moves count sentence, refusal reasons (they are rules, not debug), `ReportBug` (help, not debug) and `SkillSpotlight`'s card. "Claude ruled on this one" is also kept for everyone, reworded as a rules fact.
4. **Admin drawer.** A shield button in the board's top bar, rendered only for admins, opens a right-hand drawer on desktop or a full-screen sheet on phone. It contains:
   - seed, turn, phase and prompt kind
   - engine (legacy / rules)
   - the opponent's hidden hand, labelled as hidden information
   - the raw engine log
   - the beat list with, for Claude's decisions, what was legal and why it chose (from what `/arena/[id]/debug` already shows)
   - links to the debug pages
   - **Flag this turn**, which rd-09 records — until then the button is omitted
5. **The debug route** `/arena/[id]/debug` requires `isArenaAdmin()` (404 otherwise), in addition to its current seat check.

**Out of scope.** User management and roles beyond the one list, the review screen itself (rd-09), and Android.

**Acceptance.**
- `npm run typecheck && npm run lint && npm test && npm run build`.
- rd-01 shots with an admin and a non-admin render of the same fixture. The non-admin shows no REF badge, no engine box and no raw ids; the admin shows the shield. Put the drawer shot beside `*-11-admin-debug-drawer.jpg`.
- `scripts/verify/game-page.ts` (or a new verify script) asserts `isArenaAdmin` for an unset, a listed and an unlisted user.
