---
title: Arena: implement move replacement choice architecture (9-10-2/9-10-3)
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: backlog, ready-for-agent, enhancement, area:arena-engine, area:arena-compiler, phase:capability-gap, model:opus-5
stage: ui
---
**Source:** `docs/arena-move-replacement-scope.md` — read all of it, including the appendix of 48 `move()` call sites; `docs/arena-next-session-prompt.md` §4(d); rule manual 9-10-2, 9-10-3.

**Problem.** A replacement effect cannot ask a question. `move()` (`src/lib/arena/engine/state.ts`) is synchronous with 48 call sites, no frame and no `"wait"` path, so a prompt assigned inside it is silently lost; the point of no return is `detach(s, id)`. This blocks the 13 "you may … instead" clauses (9-10-3) and 9-10-2's mandated choice between two replacements. **Two facts make it less urgent than it looks:** those cards are *correctly refused* today, so this is a capability gap rather than a wrong reading; and `replacementFor` discriminates only on `opts.reason`, which is emitted both by sites that can suspend and by five in `engine.ts` that cannot, so there is no compile-time way to gate prompting on reachability.

**Build — take §4's smaller first increment, not §2's full fix, unless the owner says otherwise.**
1. **Increment 1 (9-10-2 only, mandatory replacements):** `MoveOptions.replaced`, a resumable cursor on `ScriptFrame` for the `moveTo`/`ko` loops, a pure `replacementChoicesFor` helper, a `move.replace` `FlowStep` + `Prompt` variant dispatched in `exec()`, `view.ts`'s exhaustive `Prompt.kind` switch and guards, a yes/no or pick-one control in `ArenaStage.tsx` distinct from `chooseMode`, wording and narration. Only the two suspendable sites emit the prompt; the five in `engine.ts` keep today's deterministic pick, and the commit names them.
2. **Increment 2 ("you may … instead", 9-10-3):** the `optional: true` grammar beside `parseWouldLeave`, with the refusal rule §1.4 demands (a subject that could leave play by a non-script route is refused, not downgraded) — this needs its own design note before code; and the two public-reveal cards (BT10-031, SD18-01) via `opts.reveal`.
3. Both increments: `replace(event)` from the Stage 2 issue is the op these should land on, not a second `replaceLeave`.

**Out of scope.** Rebuilding `move()` around a frame for all 48 sites.

**Acceptance.**
- Gate; `npx tsx --env-file-if-exists=.env.local scripts/arena-fuzz.mts 200` = 0 crashes (this touches `GameState`/`ScriptFrame`); `npm run arena:diff -- --all` = no divergence on every saved game; `npm run contract:emit` and `android:test` (new `Prompt` kind is a contract change).
- `verify/keywords.ts`: two mandatory replacements on one card produce a prompt with two choices; one produces none.
- Re-measure before starting (the document's own first rule); worklist entry with the numbers.
