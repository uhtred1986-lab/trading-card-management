---
title: [P1] Arena: Offer eligible spent combo cards as Z-Energy
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: backlog, ready-for-agent, enhancement, area:arena-vm, phase:capability-gap, model:opus-5
stage: accepted
issue: 551
priority: P1
status: closed
touches: src/lib/arena/vm/battle.ts, src/lib/arena/vm/index.ts, src/lib/arena/vm/state.ts, src/lib/arena/vm/view.ts, src/lib/arena/vm/zones.ts, src/lib/arena/rulesets/dbs/prompts.rules, src/lib/arena/rulesets/dbs/files.ts, src/lib/arena/glossary.ts, scripts/verify/z-energy-combo-551.ts, scripts/verify-arena.ts, scripts/verify/battles.ts, scripts/verify/compiler.ts, scripts/verify/primer.ts, scripts/verify/vm.ts
---
**Source:** `docs/rules/rulemanual.txt` 8-5-1..8, 14-1-4, 16-1-4, 19-1-6/7; `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Rule citation:** At 8-5-2/3, each player in turn-player order may place up to one Battle Card from their Combo Area into its owner's Z-Energy Area. Both answers precede the 8-5-4 checkpoint; combo power ends at 8-5-5 and remaining Battle Cards are dropped at 8-5-8. Tokens are selectable under 19-1-6, but 19-1-7 removes them when they leave Combo. Rule 14-1-4 removes a Z-Card whenever it leaves Leader, Battle or Unison, regardless of destination. Rule 16-1-4 specifies a player's Z-Battle Card leaving that player's Battle Area, so a transfer to the other player's Battle Area also leaves that area. A Z-Card already in Combo may be chosen into Z-Energy. The existing cleanup still batches the Drop moves before resolving their triggers; this ticket does not claim to correct the separate 8-5-6/7 checkpoint timing.

**Priority:** P1. **Delivery:** Rule engine correctness. **Plan key:** R04.

**Depends on:** #548 for the 8-5-4 confirmative-processing checkpoint; the published implementation branch stacks on #554 to keep its source history isolated from the root integration branch.

**Build.** Implement optional combo-to-Z-Energy at battle cleanup per 8-5-2/3, both-player ordering, decline and ordinary cleanup; preserve selected combo contribution through 8-5-4 and apply the normal move rules for tokens and Z-cards.

**Files to verify first:** `src/lib/arena/vm/battle.ts`, `src/lib/arena/vm/flow.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [x] Each player receives at most one ordered choice; choosing or declining proceeds correctly, and all unchosen/ineligible cards follow normal cleanup. Selected cards use their owner's Z-Energy Area, and the saved cursor resumes after JSON reload.
- [x] Named cases assert state, legal and rejected choices, public move events, retained 8-5-4 combo power, owner-vs-area handling, token removal, Z-card departures and ordinary cleanup.
- [x] `DATABASE_URL='' npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:rules`, the dedicated `z-energy-combo-551.ts` suite and `arena-rulesets-emit.mts --check` pass. The glossary and prompt definitions/generated output are updated. No legacy oracle digest or probe parity rows changed.
- [x] One bounded draft PR carries this implementation and the canonical status is closed. Real-deck `arena:fuzz 40` was not run: it needs database deck rows, and the configured credential points to another application; this remains owner-run.

**Order and hot files.** This change uses the battle-end work cursor in `vm/state.ts` and the existing flow re-ask/checkpoint path; it does not change public Snapshot or action payload contracts. `src/lib/arena/vm/battle.ts`, `src/lib/arena/vm/state.ts` and `src/lib/arena/vm/zones.ts` must not have concurrent writers.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
