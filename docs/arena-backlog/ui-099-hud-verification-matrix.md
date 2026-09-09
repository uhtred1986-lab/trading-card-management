---
title: Arena: execute and document manual HUD verification matrix
milestone: Arena M2 — Gameplay UX/HUD completion
labels: backlog, ready-for-agent, documentation, area:arena-ui, phase:hud-workflow, model:sonnet-5
stage: ui
---
**Source:** `docs/arena-hud-spec.md` §4 (the by-hand list) and §6.4 (what is still owed); `CLAUDE.md` on testing on a phone (a Cloudflare tunnel to `npm run build && npm start`, since Preview needs a Vercel login as well as Basic Auth).

**Problem.** The turn strip and the whose-move invariant were built on 7 Sep 2026 and nothing has been checked by eye. Two checks matter most: **the exact state from the original screenshot** — finish a turn, let Claude move, watch the headline as the poll returns — and **an accessibility review of both strip fills** (ki-with-ink and slate-with-ink) in both skins. `npm run arena:playthrough` was also never run for this change because it plays through the one shared database, which is production — that is the owner's call.

**Build.**
1. Ask the owner (in the PR or issue) for the go-ahead to run `npm run arena:playthrough` once; the `auditWhoseMove` assertion fires on every move.
2. Run §4's list on a phone in both skins, hot-seat and Sparring: turn hand-over, Claude thinking, a counter window, a search sheet, a refusal, playback at each pace. Record each row as pass / fail with a screenshot.
3. Run the `design:accessibility-review` skill (or a manual WCAG AA contrast check) on the two strip fills.
4. Write the outcomes into `docs/arena-hud-spec.md` §6.4; file every defect as its own issue with the `Arena backlog item` template, linked from the matrix.

**Out of scope.** Fixing what the matrix finds (separate issues).

**Acceptance.**
- §6.4 lists every §4 row with a result and a date; each failure has an issue number.
- The contrast figures for both fills in both skins are recorded.
