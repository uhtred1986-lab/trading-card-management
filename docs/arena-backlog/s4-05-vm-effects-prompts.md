---
title: Arena: vm effect layers, delayed effects, checkpoints and prompts — stepScript shared with the legacy engine
milestone: Arena M7 — Rules engine core (Stage 4)
labels: backlog, ready-for-agent, enhancement, area:arena-vm, phase:rules-stage4, model:opus-5
stage: 4
---
**Source:** plan Stage 4 ("effect layers, delayed effects, checkpoints, prompts; `stepScript` shared with the old engine where the op is generic"); `src/lib/arena/engine/script.ts` (`stepScript`, `ScriptFrame`, `OP_SCHEMA`), `state.ts` (`ContinuousEffect`, `DelayedEffect`, `staticEffects`); `src/lib/arena/effects.ts` (the one place a rule in force becomes a label).

**Problem.** A skill's program must run on the rules engine with the same semantics as on the legacy one — the same `Op` tree from the same `card_rules` row — or the record stops meaning one thing. The plan's answer is to **share** `stepScript` for every generic op and give it an abstract state interface, so the two engines diverge only where the game does.

**Build.**
1. Extract the state operations `stepScript` uses (find cards, move, change mode, add an effect, prompt, bind a variable, read an attribute) into an interface both `engine/state.ts` and `vm/state.ts` implement; `stepScript` takes it. The legacy behaviour must not move: `arena:reprobe` = 0 and every fixture unchanged.
2. `vm/effects.ts`: `ContinuousEffect` layers over declared attributes (the derived-attribute expressions from Stage 3 evaluate through them), `DelayedEffect` at the declared moments, `[Permanent]` statics while a card is in play, expiry at `until` — with `effectEnded` events so the board's surge/settle works unchanged.
3. Prompts (`choose`, `chooseMode`, `may`, `optionalCost`, the payment prompt) as the same `Prompt` shapes the contract carries, so `view.ts` and the board need no change.
4. Macros from Stage 3 expand at load; `stepScript` sees primitives only on the `rules` engine.

**Out of scope.** Legality of actions (Stage 5); keywords (Stage 7).

**Acceptance.**
- Gate; `contract:emit` no change; `arena:reprobe` = 0 moved on legacy.
- `npm test`: every harness program runs on the `rules` engine with the probe's fixed policy and yields the same **Result** digest as on legacy for the families that need no action beyond pass (`scripts/verify/probe.ts --engine rules`).
- `arena:diff` on a scripted game with a [Permanent] power boost and a delayed KO: identical events.
