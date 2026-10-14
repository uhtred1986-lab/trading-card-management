---
title: AI spend: cheaper models where Opus with thinking is overkill (scan, cart explain, summaries, arena counter/blocker)
milestone: AI providers — one contract, API or subscription, any vendor
labels: model:sonnet-5, performance, ready-for-agent
stage: ui
issue: 381
priority: P2
status: closed
---
**Source:**
- `src/lib/ai/client.ts` (`MODEL`, `FAST_MODEL`);
- `src/lib/ai/scan.ts` (the identify call);
- `src/lib/ai/cart.ts`;
- `src/lib/ai/deck.ts` (summary and set review);
- `src/lib/arena/ai/review.ts`;
- `modelFor` in `src/lib/arena/ai/opponent.ts`.

Token audit of 30 Sep 2026. Depends on the `ai_runs` cache-token issue, so the change is measured, not guessed.

**Problem.** Every call outside the arena uses the top model with adaptive thinking. Several are tasks a cheaper tier handles:

| Call | Today | Proposal |
|---|---|---|
| Scan identify (card number/name + box) | Opus, effort medium, 8000 max tokens | Sonnet, or Haiku with an Opus fallback when the number isn't in the catalog. Measure on a saved scan batch first |
| Cart explain (prose over the optimiser's numbers) | Opus, effort low | Haiku, no thinking |
| Deck summary, game review | Opus, effort medium | Sonnet |
| Arena Tournament: counter / blocker decisions | Opus, effort medium | effort low (main/combo stay medium) |
| Wizard / builder / from-card pool | Opus effort high, pool cache 5 min TTL | Keep the model. Consider a 1 h cache TTL if re-runs within the hour are common (`ai_runs` will show it) |

**Owner ruling needed:**
- Which rows to take. The arena tiers were the owner's decision on 3 Sep 2026 (`client.ts`).
- Whether scan accuracy may be traded for cost at all.

Once ruled, drop `needs-owner-ruling` and add `ready-for-agent`.

**Acceptance (once ruled).**
- `npm run typecheck && npm run lint && npm test && npm run build`.
- Each changed call keeps its Zod structured output. Haiku rejects `thinking` and `effort`, so the call shape follows `opponent.ts`'s Haiku path.
- The scan change is proved on a saved scan batch: identical card matches on at least 20 photos, listed in the PR.

## Delivery reconciliation — 11 Oct 2026

**Priority:** P2. **Depends on:** None for its bounded scope.

Owner ruling already recorded 1 Oct: cart explain → Haiku without thinking; deck summary/game review → Sonnet; scan identify → Sonnet with Opus fallback and identical matches on at least 20 saved photos. Arena counter/blocker stays unchanged. Ready under that ruling; this is distinct from atomic accounting #567 and acknowledge-before-AI #566.

Execution order and hot-file ownership: `docs/arena-delivery-plan.md`. Full review: `docs/arena-playability-review.md`.
