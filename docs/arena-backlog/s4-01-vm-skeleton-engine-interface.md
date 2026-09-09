---
title: Arena: vm/ skeleton behind the Engine interface, and what snapshot needs from an engine
milestone: Arena M7 — Rules engine core (Stage 4)
labels: backlog, ready-for-agent, enhancement, area:arena-vm, area:arena-contract, phase:rules-stage4, model:opus-5
stage: 4
---
**Source:** `src/lib/arena/engines.ts` (`Engine` has four calls: `createGame`, `apply`, `legalActions`, `rejectedActions`; `engineFor("rules")` throws `EngineNotBuilt`); plan Stage 0 (the interface was to carry `boardView` and `toBeats` too); `src/lib/arena/{games,session,snapshot,view,beats,probe}.ts` and `scripts/verify/harness.ts` — the four places an `EngineContext` is built.

**Problem.** The rules engine has nowhere to stand. `Engine` says four calls, but `snapshot.ts` also needs a board view and a beat stream from a state it treats as opaque, and today both read the legacy `GameState` shape directly. The first `vm/` commit must settle what an engine *is* to the app, without changing what the legacy one does.

**Build.**
1. Widen `Engine` to what `snapshot.ts`, `session.ts`, `probe.ts` and the AI actually call: `boardView(ctx, state, viewer)`, `toBeats(events, …)`, `stateText` if the debug page needs it. Implement them for `legacy` as an **adapter only** (`git mv` nothing; the legacy engine's own functions are called through it). `arena:diff` and every fixture must be byte-identical afterwards.
2. `src/lib/arena/vm/index.ts` exporting a `rules` `Engine` whose `createGame` loads the DBS `GameDefinition` and returns a `VmState` (its own shape, stored as JSON like the legacy state), and whose other calls throw a pointed `NotYet(step)` until the later issues fill them. `engineFor("rules")` returns it; `ENGINE_INFO.rules.available` stays `false`.
3. `VmState` carries `engine: "rules"` and the definition's game id, so a row can never be replayed on the wrong interpreter; `games.ts` already refuses a mismatched engine — add the test.

**Out of scope.** Playing anything; any change to the `Snapshot` shape beyond what Stage 0 added.

**Acceptance.**
- Gate; `npm run contract:emit` produces no change; `npm run arena:diff -- --all` on the legacy engine unchanged.
- `npm test`: a `rules` game can be created and its state round-trips through JSON; every other call throws `NotYet` naming the issue that builds it.
