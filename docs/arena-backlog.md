# Arena backlog seed and tracking model

This document seeds the Arena rework backlog from the current specs and defines how new work is filed.

## 1) Milestones to create

Create these milestones in GitHub and assign every Arena issue to one milestone.

1. **Arena M1 — Rules correctness and parser coverage**
   - Source: `docs/arena-next-session-prompt.md`, `docs/arena-next-stage-spec.md`, `docs/arena-side-scope.md`
2. **Arena M2 — Gameplay UX/HUD completion**
   - Source: `docs/arena-hud-spec.md`, `docs/arena-workflow-spec.md`
3. **Arena M3 — Battle staging and inspector**
   - Source: `docs/arena-battle-staging-spec.md`
4. **Arena M4 — Android client enablement**
   - Source: `docs/arena-android-spec.md`, `docs/arena-client-contract.md`
5. **Arena M5 — Engine capability gaps and advanced mechanics**
   - Source: `docs/arena-move-replacement-scope.md`, `docs/arena-markers-stage-scope.md`

## 2) Labels to create

Create these labels (in addition to existing `bug` / `enhancement` / `documentation`):

### Area labels
- `area:arena-compiler`
- `area:arena-engine`
- `area:arena-ui`
- `area:arena-contract`
- `area:arena-android`
- `area:arena-workbench`

### Phase labels
- `phase:rules-stage2`
- `phase:hud-workflow`
- `phase:battle-staging`
- `phase:android-client`
- `phase:capability-gap`

### Workflow labels
- `backlog`
- `ready-for-agent`
- `needs-owner-ruling`
- `blocked`

## 3) Backlog issue drafts

Open one GitHub issue per row and copy the title/scope.

| Title | Milestone | Labels | Source spec | Scope summary |
|---|---|---|---|---|
| Arena: run clause near-miss audit and fix wrong readings | Arena M1 — Rules correctness and parser coverage | backlog, ready-for-agent, enhancement, area:arena-compiler, phase:rules-stage2 | `docs/arena-next-session-prompt.md` §4(a) | Systematically audit regex near-misses, prefer unread over wrong read, and land verified fixes with reading diffs. |
| Arena: implement structural side parsing fix in `parseTarget` | Arena M1 — Rules correctness and parser coverage | backlog, ready-for-agent, bug, area:arena-compiler, phase:rules-stage2 | `docs/arena-side-scope.md` | Stop whole-clause possessive side inference; derive side from area phrase match with safe fallback. |
| Arena: fix OR disjunction handling in `parseConditionClause` | Arena M1 — Rules correctness and parser coverage | backlog, ready-for-agent, bug, area:arena-compiler, phase:rules-stage2 | `docs/arena-next-session-prompt.md` §4(c) | Fix "green X or yellow Y" being parsed as AND across fields. |
| Arena: implement specified-cost reducer mechanics | Arena M1 — Rules correctness and parser coverage | backlog, ready-for-agent, enhancement, area:arena-engine, area:arena-compiler, phase:rules-stage2 | `docs/arena-next-session-prompt.md` §4(c), `docs/arena-markers-stage-scope.md` §2/§4 | Make specified-cost reductions affect coloured requirements (not total cost) and integrate with play-cost payment logic. |
| Arena: implement skill-cost reduction family (orbTotals + scope safety) | Arena M1 — Rules correctness and parser coverage | backlog, ready-for-agent, enhancement, area:arena-engine, area:arena-compiler, phase:rules-stage2 | `docs/arena-next-session-prompt.md` §4(c), `docs/arena-next-stage-spec.md` §6.6 | Add safe handling for "reduce skill cost" effects, including scoped application. |
| Arena: finish HUD spec sections 2.2–2.6 | Arena M2 — Gameplay UX/HUD completion | backlog, ready-for-agent, enhancement, area:arena-ui, phase:hud-workflow | `docs/arena-hud-spec.md` §2.2–§2.6 | Merge last+ask card, normalize ghost/filled actions, hint row cleanup, settings overflow menu, collapsed empty battle area. |
| Arena: execute and document manual HUD verification matrix | Arena M2 — Gameplay UX/HUD completion | backlog, ready-for-agent, documentation, area:arena-ui, phase:hud-workflow | `docs/arena-hud-spec.md` §4, §6.4 | Run by-hand phone checks (both skins), capture outcomes, and record any defects as child issues. |
| Arena: add missing-energy chips to workflow UI | Arena M2 — Gameplay UX/HUD completion | backlog, ready-for-agent, enhancement, area:arena-ui, phase:hud-workflow | `docs/arena-workflow-spec.md` §9 (not done note) | Implement missing-energy affordance referenced as outstanding in workflow build notes. |
| Arena: implement battle counters/combos staged duel band | Arena M3 — Battle staging and inspector | backlog, ready-for-agent, enhancement, area:arena-ui, area:arena-contract, phase:battle-staging | `docs/arena-battle-staging-spec.md` §3.1–§3.4 | Add battle payload and beats for counters/combos and render dual staging with takeover compatibility. |
| Arena: implement in-fight card inspector details | Arena M3 — Battle staging and inspector | backlog, ready-for-agent, enhancement, area:arena-ui, phase:battle-staging | `docs/arena-battle-staging-spec.md` §3.5 | Ensure any battle card can open inspector with combo stats, printed text, and engine reading context. |
| Arena: add battle staging preference and persistence | Arena M3 — Battle staging and inspector | backlog, ready-for-agent, enhancement, area:arena-ui, phase:battle-staging | `docs/arena-battle-staging-spec.md` §3.6 | Persist staging mode and ensure safe fallback across sessions/devices. |
| Arena: implement Android `/api/v1` deck endpoints | Arena M4 — Android client enablement | backlog, ready-for-agent, enhancement, area:arena-contract, area:arena-android, phase:android-client | `docs/arena-client-contract.md` §5 | Build not-yet-implemented deck endpoints needed for Android read-only deck flows. |
| Arena: implement Android Stage 1 app shell and snapshot polling | Arena M4 — Android client enablement | backlog, ready-for-agent, enhancement, area:arena-android, phase:android-client | `docs/arena-android-spec.md` §11 | Build initial Android app modules, auth, board shell, and live snapshot consumption. |
| Arena: implement Android battle playback and animation parity | Arena M4 — Android client enablement | backlog, ready-for-agent, enhancement, area:arena-android, phase:android-client | `docs/arena-android-spec.md` §5/§6 | Add beat playback and board animation behavior aligned with web semantics and contract. |
| Arena: implement move replacement choice architecture (9-10-2/9-10-3) | Arena M5 — Engine capability gaps and advanced mechanics | backlog, ready-for-agent, enhancement, area:arena-engine, area:arena-compiler, phase:capability-gap | `docs/arena-move-replacement-scope.md` | Add prompt-capable replacement selection path at suspendable call sites; preserve deterministic behavior elsewhere. |
| Arena: implement Empower “up to Y” player choice | Arena M5 — Engine capability gaps and advanced mechanics | backlog, ready-for-agent, bug, area:arena-engine, phase:capability-gap | `docs/arena-markers-stage-scope.md` §2/§4 | Replace auto-carry with explicit player choice for marker inheritance up to Y. |
| Arena: add Empower inheritance transfer beat and board animation | Arena M5 — Engine capability gaps and advanced mechanics | backlog, ready-for-agent, enhancement, area:arena-contract, area:arena-ui, phase:capability-gap | `docs/arena-markers-stage-scope.md` §3/§4 | Introduce beat naming source+target card for marker transfer and animate transfer on board. |
| Arena: support keyword parse for `[Empower XY/ZY]` | Arena M5 — Engine capability gaps and advanced mechanics | backlog, ready-for-agent, enhancement, area:arena-compiler, phase:capability-gap | `docs/arena-markers-stage-scope.md` §2 | Extend keyword parser for two-colour Empower syntax; keep low priority until cards require it. |

## 4) Rule for future bugs/features (mandatory)

Going forward, **do not leave Arena work as chat-only notes**.

For every new Arena bug, feature, or rules/ruling follow-up:

1. Create a GitHub issue using the `Arena backlog item` template.
2. Link the exact source of truth (`docs/...` section, rule manual section, replay id, card id(s)).
3. Add at least one `area:*` label and one `phase:*` label.
4. Assign one Arena milestone from this document.
5. Add explicit acceptance checks (commands + scenario proof).
6. Mark `ready-for-agent` only when the issue is pickup-ready.

If an item is not ready for implementation, keep it in backlog with `needs-owner-ruling` or `blocked` and state the missing decision.
