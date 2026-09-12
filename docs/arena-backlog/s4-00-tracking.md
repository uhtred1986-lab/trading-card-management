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

---

## Review of 12 Sep 2026

**State of the stage on 12 Sep 2026.** `src/lib/arena/vm/` does not exist. `engineFor("rules")` throws `EngineNotBuilt` (`src/lib/arena/engines.ts` line 87). The `Engine` interface has four calls; the app still calls the legacy `boardView` (`snapshot.ts` line 164), `toBeats` (`beats.ts` line 137) and `createGame` (`probe.ts` line 261, `scripts/verify/harness.ts` line 198) directly, which is what #138 widens. Stage 4 depends on Stage 3's files (#133 zones/attributes, #134 triggers) for its data, and on #130/#137 for macro expansion in #142.

**Order:** #138 (skeleton + widened interface, no behaviour change) → #139 (attributes/zones, opening board equal to legacy from the same seed) → #140 (flow runner, pass-only games) → #141 (events + trigger patterns) → #142 (effects/prompts, shared `stepScript`) ; #143 (the `--engine` flag on every script) can run any time after #138 and should run early because #140–#142 are proven with it.
