---
title: Arena: empowerCarry fallback in freeChoice should return null instead of guessing { index: legal.length - 1 }
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: done, bug, area:arena-engine, phase:capability-gap, model:sonnet-5
stage: ui
status: closed
closed_at: 2026-09-09
---
**Source:** `src/lib/arena/ai/opponent.ts` line 143 (inside `freeChoice()`).

**Problem:**
The `empowerCarry` branch in `freeChoice()` currently fell back to `{ index: legal.length - 1 }`:
```ts
if (kind === "empowerCarry") {
  // 22-45-3: carrying markers with [Empower] cannot go wrong, so take the maximum without an API call.
  const max = s.prompt.kind === "empowerCarry" ? s.prompt.max : 0;
  const i = legal.findIndex((l) => l.action.type === "empowerCarry" && l.action.amount === max);
  return i >= 0 ? { index: i, how: `carries maximum ${max} Empower markers` } : { index: legal.length - 1, how: "carries Empower markers" };
}
```

Minor: the `empowerCarry` fallback `{ index: legal.length - 1 }` guesses instead of returning `null` like every sibling in `freeChoice` — harmless today (the list is ordered 0…max) but it's the one branch there that can't decline to answer.

**Fix:**
Return `null` if `i < 0` so it behaves consistently with siblings (`charge`, `zEnergyFromCombo`):
```ts
return i >= 0 ? { index: i, how: `carries maximum ${max} Empower markers` } : null;
```

**Verification Checklist:**
- [x] 1. `freeChoice()` in `src/lib/arena/ai/opponent.ts` returns `null` when no exact matching action is found.
- [x] 2. `npm test` and `npm run typecheck` run clean.

**Acceptance.** Verified and resolved in `feat/arena-backlog-progress`.
