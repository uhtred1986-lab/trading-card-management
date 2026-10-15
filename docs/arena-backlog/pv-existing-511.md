---
title: AI providers: one contract, API or subscription, any vendor (tracking)
milestone: AI providers — one contract, API or subscription, any vendor
labels: epic, area:ai
stage: ui
issue: 511
status: closed
priority: P2
tracking: true
---
**Source:** owner's request in chat, 4 Oct 2026 (switch API ↔ Claude plan, swap vendors without touching callers).

Tracking issue for the milestone. Spec: `docs/architecture/ai-providers.md` (PR #510 until merged).

- [x] #512 contract, errors, core, Anthropic API adapter, fake, contract suite — `cart.ts` as the pilot
- [x] #513 deck features and the scanner on `generateJson`
- [x] #514 arena AI and scripts on the contract; ESLint fence on
- [x] #515 `models.ts`, prices, `ai_runs.provider` + `billed`, `ai:spend` split
- [x] #516 router + `ai_settings` + settings page with a model picker per tier / task and per arena mode (Sparring; Tournament key / other decisions)
- [x] #517 subscription adapter (Agent SDK), local
- [x] #518 subscription on Vercel — owner confirms tested and working; accepted 15 October 2026.
- [x] #519 docs, env, `ai:smoke`
- [x] #520 OpenRouter adapter (owner's choice, 4 Oct 2026) — fills the model picker; after #516

## Delivery reconciliation — 11 Oct 2026

**Priority:** P2. **Depends on:** None for its bounded scope.

Implementation children #513–#520 are closed except #518, whose single binary-carrying route is implemented/merged (#531). #518 remains for owner-run production Test connection and latency verification; no fresh duplicate provider-route implementation ticket. #381 is the separate approved model-economy follow-up.

Execution order and hot-file ownership: `docs/arena-delivery-plan.md`. Full review: `docs/arena-playability-review.md`.


## Completion — 15 October 2026
All implementation children are closed. The owner accepted #518 following successful production testing. Earlier live-verification blockers are superseded.
