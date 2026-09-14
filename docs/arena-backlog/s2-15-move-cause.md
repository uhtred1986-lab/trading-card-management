---
title: Arena: move carries a cause — draw, damage, KO, combo and effect as one primitive (spec §2.5-2)
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, ready-for-agent, enhancement, area:arena-lang, area:arena-engine, area:arena-vm, area:arena-rulesets, phase:rules-stage2, model:opus-5
stage: 2
issue: 274
---
**Source:** #137 (owner's decision of 13 Sep 2026: each §2.5 primitive is its own issue); `docs/arena-ruleset-spec.md` §2.5-2; `src/lib/arena/rulesets/dbs/ops.rules` (the rows waiting on `cause`: `draw`, `discard`, `damage`, `mill`, `addLife`, `lifeDownTo`, `ko`, `comboFrom`); the `moveTo` row in `src/lib/arena/engine/script-schema.ts`; the legacy `move()` and `MoveOptions.reason` in `src/lib/arena/engine/state.ts`; `moveCard` in `src/lib/arena/vm/zones.ts`; `src/lib/arena/rulesets/dbs/triggers.rules` (`moved(from:, asPlay:)`).

**Problem.** `damage`, `ko`, `combo`, `effect` and a plain draw are one move told apart by its cause, and the triggers read the cause — the legacy `move()` already takes one. `moveTo` has no such field, so none of the eight rows above can lower to it without saying something the card does not.

**Build.**
1. A `cause` field on `moveTo` (an enum matching the legacy `MoveOptions.reason` values; default `effect`), a schema row and nothing else in the language: printer, parser, round trip.
2. Both interpreters pass it through — `legacyHost` to `move()`, `vm/host.ts` to `moveCard` — and the `Moment` carries it, so `triggers.rules` may say `moved(cause: ko)`; `autoTriggerMatches` (the no-record fallback) is unchanged.
3. Declare in `ops.rules` the rows this unblocks: `ko` now, and — once `$name` holes exist (the sibling issue) — `draw`, `discard`, `damage`, `mill`, `addLife`; `lifeDownTo` stays on `maths`. Update the header table.
4. Glossary: the reading rule if the compiler starts emitting a cause.

**Out of scope.** `modifyAttr` subjects, `negate`, `costModifier` (sibling issues); amounts that subtract (#122's expressions).

**Acceptance.**
- Gate; `npm run arena:fuzz -- 40` on both engines, 0 crashes; `npm run contract:emit` no change.
- `scripts/verify/lang.ts` round-trips `cause`; `scripts/verify/language.ts` lowering sweep: the declared rows expand to primitives only.
- `scripts/verify/vm.ts`: a `ko` written as the macro and as the op logs the same events on both engines.
- `npm run arena:readings` diff empty.
