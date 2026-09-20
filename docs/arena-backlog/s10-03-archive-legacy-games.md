---
title: "Arena: archive saved legacy games — store the last snapshot as JSON and show it read-only"
milestone: Arena M13 — Retire the legacy engine (Stage 10)
labels: backlog, ready-for-agent, area:arena-vm, phase:rules-stage10, model:sonnet-5
stage: 10
issue: 335
touches: src/db/schema.ts, src/lib/arena/games.ts, src/lib/arena/matches.ts
---
**Source:** `docs/arena-ruleset-spec.md` §6's Stage 10 row and its "Saved legacy games, once `engine/` retires" subsection; issue #119, decided 20 Sep 2026; `src/db/schema.ts`'s `arenaGames` (`state`, `actions`, `engine` columns); `src/lib/arena/games.ts`; `src/lib/arena/matches.ts` (the 1 v 1 case); `docs/arena-client-contract.md` (a game is its seed plus actions, which is exactly what stops being true here).

**Problem.** Stage 10 retires `src/lib/arena/engine/`, but `arena_games` rows made on it (`engine = 'legacy'`) still exist. Issue #119 put three options to the owner — replay onto the rules engine on load, read-only off the retiring engine's own `boardView`/`toBeats`, or archive — and the ruling (20 Sep 2026) is **Archive**: a legacy game's *last snapshot* is stored as JSON while `engine/` still exists to compute it, and once retired the arena list and game page show that stored snapshot read-only. Nothing replays, and a legacy game cannot be continued.

**Build.**
1. A migration adding the stored snapshot: a `snapshot jsonb` column on `arena_games` (one row, one snapshot) or a separate table keyed by game id — whichever fits `src/db/schema.ts`'s existing conventions better. Holds the rendered `Snapshot` (`docs/arena-client-contract.md`'s shape, the same `boardView`/`buildSnapshot` produce today) for a `legacy` row, null until populated.
2. A one-off script, in the shape of the other one-off `arena:*` scripts, that walks every `arena_games` row with `engine = 'legacy'`, computes its snapshot through the still-live legacy engine, and writes it to the new column/table. Needs `DATABASE_URL` — **run by the owner**, not by the agent building this issue.
3. The arena list and game page read the stored snapshot for a `legacy` row instead of computing anything through `engine/` once it is gone: a read-only board, a banner saying the game is archived and cannot be continued, and no legal actions offered — `legalActions`/`apply` must not be called for an archived row at all.
4. The 1 v 1 case: an archived `versus` game still belongs to its two seats and nobody else — visibility is checked the same way a live 1 v 1 is gated, before the stored snapshot is ever read.
5. The archive path should land before `engine/` is actually deleted, so both paths (live legacy engine still present vs. retired) work without one silently breaking the other mid-migration.

**Acceptance.** Gate; a `scripts/verify/*` case for the read-only view (an archived legacy game's stored snapshot renders with no legal actions and the archived banner; a non-archived game is unaffected); the owner's run of the one-off snapshotting script against the real database, confirming every existing `legacy` row carries a stored snapshot before `engine/` is deleted — that run, and the deletion itself, are explicitly not part of this issue's build.
