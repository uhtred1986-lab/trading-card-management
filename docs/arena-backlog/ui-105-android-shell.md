---
title: Arena: implement Android Stage 1 app shell and snapshot polling
milestone: Arena M4 — Android client enablement
labels: backlog, ready-for-agent, enhancement, area:arena-android, phase:android-client, model:sonnet-5
stage: ui
---
**Source:** `docs/arena-android-spec.md` §3 (stack), §4 (screens), §11 (order of work, steps 2–3); `docs/arena-client-contract.md` §1, §5, §6; `android/` (only the Docker toolchain and the `contract` module exist — steps 0–1 are done).

**Problem.** The Android app is briefed and not built. Steps 2 and 3 of the order of work decide whether the whole idea works: a project skeleton that loads the games list from the real server, then a static board — `view` rendered, `legal` tappable, no animation — on which a whole hot-seat game is playable, ugly. If that is not reached, stop before a line of animation is written (§11).

**Build.**
1. **Step 2**: Gradle + Hilt project in `android/app`, theme mirroring the `space`/`ki` tokens, an auth screen that stores Basic Auth credentials in the keystore (never in plain text — the app must not prompt for or display them elsewhere), the games list from `GET /api/v1/games`. Build in the Docker image (`android/Dockerfile`) — the machine has no JDK or SDK — and extend `npm run android:test` or add `android:build` for it.
2. **Step 3**: the board from `Snapshot.view` and `Snapshot.legal` only, a move sent as an **index** into `legal` with `basedOn` (§5), long-poll `GET /api/v1/games/{id}?sinceBeat=N&wait=25`, `stale` handled by re-reading. No rule is evaluated on the device.
3. Read `docs/arena-client-contract.md` first and treat it as the contract; anything the client needs that the snapshot lacks is a contract issue, not a client workaround.

**Out of scope.** Beat playback and animation (#106); decks (#104); signing and hosting (§11 step 9).

**Acceptance.**
- `npm run android:test` still green; the app builds in Docker with one documented command.
- Scenario proof: a hot-seat game created on the web is played to its end on the phone, screenshots of the list, the board and a prompt attached to the PR.
