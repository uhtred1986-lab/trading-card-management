---
title: [P2] Arena: Preview a gameplan without committing moves
milestone: Arena M2 — Gameplay UX/HUD completion
labels: backlog, ready-for-agent, enhancement, area:arena-ui, phase:hud-workflow, model:sonnet-5, performance
stage: ui
issue: 570
priority: P2
touches: src/lib/arena/snapshot.ts, src/components/arena/stage/PromptPanel.tsx
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P2. **Delivery:** Measured speed and gameplan. **Plan key:** S06.

**Depends on:** #558 (U01), #564 (U07), #547 (T05)

**Build.** Provide optional server-validated hypothetical payment/sequence preview and resource budget from public/own information. Pause at opponent responses, random draws/searches or unknown outcomes. Do not mutate match, advance RNG, call paid AI or imply a guaranteed win.

**Files to verify first:** `src/lib/arena/snapshot.ts`, `src/components/arena/stage/PromptPanel.tsx`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [ ] A two-action plan previews remaining coloured energy; a counter/draw stops assumptions; abandoning plan leaves revision, RNG, action history and AI usage unchanged.
- [ ] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions.
- [ ] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable.
- [ ] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/snapshot.ts`, `src/components/arena/stage/PromptPanel.tsx` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
