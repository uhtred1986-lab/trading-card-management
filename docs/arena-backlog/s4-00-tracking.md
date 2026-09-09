---
title: Arena Stage 4 tracking — the rules engine core (vm/)
milestone: Arena M7 — Rules engine core (Stage 4)
labels: epic, backlog, area:arena-vm, phase:rules-stage4
stage: 4
tracking: true
---
Stage 4 of the rules-language programme (plan summary in `docs/arena-backlog.md` §1; Opus 5, size XL). The new engine, `src/lib/arena/vm/`, built **beside** the frozen `src/lib/arena/engine/` behind the shared `Engine` interface in `src/lib/arena/engines.ts`. It interprets the Stage 3 definition: attributes, zones, the flow runner over `STEP` programs, event-pattern trigger matching, effect layers, delayed effects, checkpoints and prompts.

**Exit criterion:** a game created on the `rules` engine runs turn to turn with **pass and concede only**, its `Snapshot` renders on the web board, and `arena:diff` replays it on the legacy engine to the same events. `ENGINE_INFO.rules.available` stays `false` until Stage 5.

**Rules that hold throughout**
- `engine/` is frozen: bug fixes only, and every bug fixed there is fixed in `vm/` in the same PR.
- Nothing in `games.ts`, `session.ts`, `snapshot.ts` or the scripts imports `./engine` to play a saved game; `engineFor(row.engine)` is the one switch.
- `stepScript` is **shared** where the op is generic; a DBS-specific case that must live in `vm/` is a sign the op should have been a macro (Stage 3).
- Every commit: `typecheck`, `lint`, `test`, `build`, `arena-fuzz 40 --engine rules` and `arena:diff` on the harness games.

Child issues:

{{children}}
