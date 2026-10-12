---
title: [P0] Arena: Resolve Auto skill costs with pay and decline decisions
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: backlog, ready-for-agent, enhancement, area:arena-vm, phase:capability-gap, model:opus-5
stage: ui
issue: 549
priority: P0
touches: src/lib/arena/vm/flow.ts, src/lib/arena/vm/costs.ts, src/lib/arena/vm/script.ts
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P0. **Delivery:** Rule engine correctness. **Plan key:** R02.

**Depends on:** #544 (T02)

**Build.** Give pending Auto skills a complete cost-planning, payable choice, paid resolution and optional decline path. Use current trigger/source/event bindings; no silent dropping of action-price or X-price skills. Resume deterministically after prompts; document mandatory versus optional behavior from the manual.

**Files to verify first:** `src/lib/arena/vm/flow.ts`, `src/lib/arena/vm/costs.ts`, `src/lib/arena/vm/script.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [ ] A triggered priced Auto pays exactly once and resolves; unaffordable and declined cases have distinct outcomes; two pending Autos preserve source and ordering after reload.
- [ ] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions.
- [ ] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable.
- [ ] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/vm/flow.ts`, `src/lib/arena/vm/costs.ts`, `src/lib/arena/vm/script.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.


**Rule-grounded behavior (#549).** Manual 9-6-4 permits paying or declining any necessary
Auto skill cost, including printed energy and action costs. A condition that is already true
cannot itself be declined (9-6-4-1-1); cost-free/condition-only Autos retain compulsory
resolution. Unaffordable prices cancel activation under 9-6-3-2 and 5-8-2. The cost must
complete before the effect (5-8-2-2), and chosen X applies through resolution (20-5).
The private stored continuation retains source, skill index, master, trigger, subject,
cost targets, X and the paid cursor across generic option/card prompts and JSON reload.

**Local proof.** `scripts/verify/auto-costs-549.ts` uses fixed expectations rather than the
legacy oracle: a real play-triggered Auto; pay/decline/unaffordable outcomes; invalid actor,
invalid index and stale resource rejection; two source/master queues; combined orb/action
payment across reload; cost targets and action-/energy-chosen X; source departure with
subject binding; Burst and Spirit Boost; sequential double-spend/mode/cardinality refusal;
mandatory choose-three with too few cards or distinct names; safe candidate pruning;
explicit unsupported/missing price interruption; a 20-card action-price projection.
`scripts/verify/compiler.ts` independently asserts AUTOCOST pays exactly one additional
energy and draws two, while decline pays nothing further. No compiler reading is changed.

**Remaining boundaries.** Existing turn-player-first FIFO order is preserved; choosing among
simultaneous pending skills (9-6-3) remains a separate existing limitation. Supported action
prices use choose/discard/mill/switchMode/hidden/moveTo/removeMarker; unimplemented instructions
and a full-price choice search exceeding 2,000 visited states produce an explicit typed
interruption instead of free resolution or a false affordability claim. This Auto-specific
continuation does not deliver #550's broader Activate/cross-skill binding work. No public
prompt/action type changes, UI changes, dependencies or production/database writes.

**Owner-run verification.** Catalog reading snapshots require the deckplanet endpoint in this
environment; the baseline attempt failed DNS lookup (`EAI_AGAIN api.deckplanet.net`).
Fuzz 40 was attempted with `DATABASE_URL=''`, but the script requires actual deck inputs and
failed before any game at `arena-fuzz.mts:87`. Reading diff and real-deck fuzz are therefore
unverified owner-run checks, along with live database/paid-provider/production checks.
