---
title: Arena: admin match review — flag a turn from the board, review flagged turns with Claude's legal moves and reasons
issue: 351
milestone: Arena M16 — Board redesign: play feel and card review
labels: backlog, enhancement, area:arena-ui, phase:board-redesign, model:sonnet-5
stage: ui
touches: src/app/arena/[id]/debug/page.tsx, src/db/schema.ts, drizzle, src/app/arena/actions.ts
---
**Source:** `docs/arena-board-redesign-spec.md` §2 (the Review later row); frame `docs/arena-redesign/admin-match-review.jpg`; `src/app/arena/[id]/debug/page.tsx`; `src/components/arena/ReportBug.tsx` (what a report already captures).

**Problem.** Debug information leaves the board with rd-08, and the owner wants it "for later review". Today the debug page shows one game with no notion of "the turn I want to look at again", and nothing collects those turns across games.

**Build.**
1. **Flag a turn.** rd-08's drawer gets **Flag this turn**, with an optional one-line note. It stores `{ gameId, turn, beatIndex, note, flaggedBy, at }` in a new table: a migration, generated alone, never in parallel (`docs/arena-backlog.md` §7). Flagging twice is a no-op. The drawer lists the game's flagged turns.
2. **A review screen** at `/arena/review`, admin-only, laid out like the frame:
   - left: games with flags, newest first
   - centre: a turn scrubber where flagged turns are enabled and marked, the board as it stood at the start of that turn (rebuilt from the saved seed and actions, as `arena:diff` does, or from what the debug page already reconstructs), and the beat list for the turn
   - right: the selected beat's decision — the legal moves with the pick highlighted, Claude's reason, and model tier / tokens / latency where `ai_runs` has them. For a player beat it shows what was offered and any refusal with its requirement.
3. **Reviewer note** and **Resolve** on a flag, stored on the same row. There is also a link that opens the card in the rules workbench when the beat names one.

**Out of scope.** Sharing reviews, comments between admins, and editing rules from the review screen (the workbench does that).

**Needs** rd-08 merged. It is not `ready-for-agent` until then.

**Acceptance.**
- `npm run typecheck && npm run lint && npm test && npm run build`. `npm test`'s PGlite suite covers the new table: flag, duplicate flag, resolve.
- An rd-01 shot of the review screen over a fixture game with two flags, beside `admin-match-review.jpg`.
- A non-admin gets 404 on `/arena/review` and never sees the flag button.
