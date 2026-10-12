---
title: [P2] Arena: Skip unchanged snapshot loads with revision-aware polling
milestone: Arena M2 — Gameplay UX/HUD completion
labels: backlog, ready-for-agent, enhancement, area:arena-contract, phase:hud-workflow, model:sonnet-5, performance
stage: ui
issue: 568
priority: P2
status: closed
touches: src/app/api/v1/games/[id]/route.ts, src/lib/arena/session.ts, src/components/arena/stage/liveGamePolling.ts, scripts/verify/revision-polling-568.mts
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P2. **Delivery:** Measured speed and gameplan. **Plan key:** S04.

**Depends on:** #545 (T03), #565 (S01)

**Build.** Return unchanged by revision/ETag before expensive full game projection; reduce idle beat-counter reads and transfer while keeping authenticated access and terminal updates. Measure before/after. Consider push transport only in a separate measured proposal.

**Delivered:** `src/app/api/v1/games/[id]/route.ts` uses an authorized exact-revision 204 fast path; `src/lib/arena/session.ts` distinguishes unchanged from changed/missing revision observations; `src/components/arena/stage/liveGamePolling.ts` preserves revision and beat cursors on 204. See `scripts/verify/revision-polling-568.mts` and the transport contract in `docs/arena-client-contract.md`.

**Acceptance.**
- [x] Idle viewers avoid complete game projection on an exact unchanged revision; no-beat status changes, reconnects, missing rows, and old/ahead cursors have explicit route and client checks. The measured route read count is 19 → 18 total SELECTs for the 15-second authorized fixture; the 17 revision checks remain unchanged. The avoided snapshot was 2,097 bytes and its projection measured p50 0.357 ms in seven local PGlite samples.
- [x] PGlite cases cover equal, changed, old, ahead, and missing revisions; the client preserves both cursors on 204 and resumes full reads. The existing live-polling lifecycle suite also passes.
- [x] `DATABASE_URL='' npm run typecheck`, `DATABASE_URL='' npm run lint`, `DATABASE_URL='' npm test`, and `DATABASE_URL='' npm run build` pass. Lint reports five existing prototype warnings. No rules/compiler acceptance applies.
- [x] Bounded implementation and verification are in PR #568. Live database, hosted p95, paid AI, and physical-device checks remain owner-run and are not claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. The route/session/polling files above were updated in this bounded change. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
