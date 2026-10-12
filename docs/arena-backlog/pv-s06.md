---
title: [P2] Arena: Preview a gameplan without committing moves
milestone: Arena M2 — Gameplay UX/HUD completion
labels: backlog, ready-for-agent, enhancement, area:arena-ui, phase:hud-workflow, model:sonnet-5, performance
stage: ui
issue: 570
status: closed
priority: P2
touches: src/lib/arena/gameplan-preview.ts, src/lib/arena/gameplan-types.ts, src/app/arena/actions.ts, src/components/arena/stage/ArenaStage.tsx, src/components/arena/stage/PromptPanel.tsx
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P2. **Delivery:** Measured speed and gameplan. **Plan key:** S06.

**Depends on:** #558 (U01), #564 (U07), #547 (T05)

**Build.** Provide optional server-validated hypothetical payment/sequence preview and resource budget from public/own information. Pause at opponent responses, random draws/searches or unknown outcomes. Do not mutate match, advance RNG, call paid AI or imply a guaranteed win.

**Files to verify first:** `src/lib/arena/snapshot.ts`, `src/components/arena/stage/PromptPanel.tsx`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Delivered scope:** The original `touches` list was outdated: a server action and board caller are necessary to validate the acting seat and revision without committing a move. The implementation adds separate server-only simulation and client-safe move types; `snapshot.ts`, the VM, compiler, glossary and generated fixtures stay unchanged. This bounded planner projects fixed-price printed Main activations with safe public/own effects. Plays stop before a possible hidden Counter window; uncertain rules, current effects and native marker/keyword costs stop with a generic message. It does not promise a universal sequence or a win.

**Acceptance.**
- [x] A two-action plan shows 2→1→0 ready Red energy from authoritative cloned engine runs. Counter windows, draw, copied/unknown rules, marker payment and Hidden Mode identities stop before unsafe projection. Clearing the plan and server preview leave the stored revision, RNG, action history and usage unchanged.
- [x] Legacy and rules scenarios assert exact coloured budgets, applied payment/source mode events, valid follow-up legality, source immutability, hidden-hand and Hidden Mode metamorphic equality, and unsafe refusals. PGlite reloads both engines' versus rows to verify valid, stale, wrong/unseated, malformed, terminal and archived cases plus full row equality. The Next action checks signed-in ownership and minimal seat metadata before loading concealed state; PGlite exercises its pure service boundary, not the Next request context.
- [x] `DATABASE_URL=''` typecheck, lint, `npm test`, focused PGlite and build pass. Lint reports five pre-existing prototype warnings and no errors. No VM/compiler edit was made, so glossary, reading diff and fuzz 40 do not apply.
- [x] A bounded draft PR carries before/after EngineAPI board and planner screenshots at 1440×900 and 390×844 in both skins, actual local artwork, keyboard Enter, phone touch, 44 px targets and 200% overflow checks. See `evidence/570/README.md`. Live database, paid, physical-device and production checks remain owner-run and are not claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/snapshot.ts`, `src/components/arena/stage/PromptPanel.tsx` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
