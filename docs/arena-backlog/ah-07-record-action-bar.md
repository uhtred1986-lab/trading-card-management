---
title: "Rules Workbench: the record — one primary action per state, Skip to the next, keys on the computer"
issue: 361
milestone: Arena M17 — Arena home: Play and Rules Workbench
labels: backlog, ready-for-agent, enhancement, area:arena-workbench, phase:arena-home, model:sonnet-5
stage: ui
status: closed
closed_at: 2026-09-30
touches: src/components/arena/rules/RuleRecord.tsx, src/components/arena/rules/Workbench.tsx, src/components/arena/rules/ProbePane.tsx
---
**Source:** `src/components/arena/rules/RuleRecord.tsx`; `docs/arena-fixing-a-card.md` (the buttons it names); canvas frame `RulesDesktop`.

**Problem.** The record offers seven buttons of equal weight:
- Confirm — plays exactly like this
- Correct by hand
- Explain to Claude
- Show as text
- Show program (JSON)
- Mark as does nothing
- the Probe's Run

What you should do next depends on the state and is never the obvious one. After confirming, you go back to the list by hand.

**Build.**
1. **Sticky action bar**, primary by state:

   | State | Primary | Secondary | Tertiary |
   |---|---|---|---|
   | Open | **Draft with Claude** (today's Explain to Claude / review) | Write as text | Skip |
   | Draft | **Confirm** | Edit as text | Skip |
   | Confirmed / corrected | **Reopen for review** | Edit as text | Skip |

   Show program (JSON) and Mark as does nothing move to an overflow.
2. **Confirm and Skip advance** to the next row in the current queue (ah-06's filter), keeping the scroll position.
3. **Phone**: not designed (spec decision 6). The panes stack in one column, the action bar stays reachable, and there is no horizontal page scroll.
4. **Desktop**: three panes. The queue sits left; the record sits in the middle (printed text and card, WHEN/COST/IF/DO chips, *The engine will: …*, the pattern strip, the text view); Probe, *Used in* and History sit right, with the action bar pinned at the bottom of the right pane.
5. **Keys (desktop)**: `j`/`k` move, `c` confirm, `e` edit, `s` skip, `/` find — listed under the queue. They are scoped to the workbench and never fire inside an input or textarea.
6. **Open rows**: the unread clause shows as a red dashed chip in place, not only as a line of text.

**Acceptance.**
- `npm run typecheck && npm run lint && npm test && npm run build`
- Scenario: open the first Draft, click Confirm, and the next Draft opens without going back to the list.
- Scenario (desktop): keyboard only — `/`, type a card id, Enter, `c` — confirms that card.
- Phone (390×844) and desktop (1440×900) screenshots in the PR, each beside its canvas frame.
