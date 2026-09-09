---
title: Arena: implement Android battle playback and animation parity
milestone: Arena M4 — Android client enablement
labels: backlog, blocked, enhancement, area:arena-android, phase:android-client, model:sonnet-5
stage: ui
---
**Source:** `docs/arena-android-spec.md` §5 (the board), §6 (the storyboard in Compose), §11 steps 4–7; `docs/arena-client-contract.md` §6 (watching Claude think) and §3.2 (`Beats`); `src/components/arena/stage/useBeatPlayer.ts` and `motion.ts` as the reference semantics.

**Blocked on** #105 (the static board must be playable end to end first — §11 says stop and reconsider otherwise).

**Problem.** A whole opponent turn is *played back* from the beat stream on the web board, never arriving as a jump; the Android board must do the same from the same `Snapshot.beats`, with the same meaning per beat kind, so both clients tell the same story of the same game.

**Build.**
1. **Step 4**: a beat player with the web's semantics — walk the queue, lock input while it runs, `skip`, provisional beats (§5.4), pace preference — and shared-element flights on `layoutId`'s Compose equivalent. Durations mirror `motion.ts`'s single table; reduced motion is that table at zero.
2. **Step 5**: hand sheet, targeting, prompt bar; the wording tables from `src/lib/arena/wording.ts` and `narration.ts` carried in Kotlin (the web `npm test` fixtures are the reference — add a fixture diff to `android:test` so the two tables cannot drift silently).
3. **Steps 6–7**: the storyboard one row at a time; haptics, sound, wake lock, refresh rate.
4. Battle staging: consume `battle.counters`, `contributions` and the `skill` beat's `inBattle` exactly as `DuelBand.tsx` does; no client recomputes a total.

**Out of scope.** Any new beat kind or snapshot field — file a contract issue.

**Acceptance.**
- `npm run android:test` green with the wording/narration fixture check added.
- Scenario proof: the same saved Sparring game replayed on the web board and on the phone shows the same sequence of beats with the same sentences; a screen recording of Claude's turn attached.
