# Arena docs index

Cheap way to tell which `docs/arena-*.md` files are live references and which are mainly background.
No files were moved in this pass, so existing links stay stable; use the status column to decide what
to read first.

## Start here

| doc | status | what it is for |
|---|---|---|
| `docs/arena-next-session-prompt.md` | **Current — start here** | The cheapest current hand-off for a new arena session: where the programme stands and what to work on next. |
| `docs/arena-tooling.md` | **Current — start here** | What the arena scripts and test suites prove, and how to validate changes without rereading large specs. |

## Current docs

| doc | status | what it is for |
|---|---|---|
| `docs/arena-backlog.md` | **Current** | The live roadmap: milestones, phases and how arena backlog issues are tracked in GitHub. |
| `docs/arena-next-stage-spec.md` | **Current** | The detailed hand-off spec for the current rules-engine stage; read after the next-session prompt when working on compiler/engine internals. |
| `docs/arena-rules-language.md` | **Current** | The authoritative grammar and invariants for the rules language under `src/lib/arena/lang/`. |
| `docs/arena-workflow-spec.md` | **Current** | The rules-as-workflow UI spec; phases 1–3 are built and phase 4 (Android) is still open. |
| `docs/arena-rules-workbench-spec.md` | **Current** | The Rules Workbench spec and phase record for rules stored as records rather than compiled at runtime. |
| `docs/arena-client-contract.md` | **Current** | The shared `Snapshot`/API contract for arena clients; read before changing client-visible arena data. |
| `docs/arena-ui-motion-spec.md` | **Current** | The current record of the web board's motion/UI behaviour; all phases are built. |
| `docs/arena-hud-spec.md` | **Current** | The "whose move is it" HUD brief; some sections are built and later sections remain open. |
| `docs/arena-turn-presence-spec.md` | **Current** | The ambient turn-lighting/presence spec and record of what shipped. |
| `docs/arena-skin-spec.md` | **Current** | The arena skin brief and implementation record for the built skin system. |
| `docs/arena-android-spec.md` | **Current (planned)** | The Android client brief; no app code exists yet, but the contract and fixture tests it depends on do. |
| `docs/arena-battle-staging-spec.md` | **Current (planned)** | The not-yet-built brief for richer battle staging, takeover visuals and in-fight card inspection. |
| `docs/arena-refusals-spec.md` | **Current** | A focused brief for the two remaining refusal-wording gaps found by the workflow/probe work. |
| `docs/arena-side-scope.md` | **Current** | A focused scope note for the recurring "which side's cards?" parsing bug. |
| `docs/arena-move-replacement-scope.md` | **Current** | A scope/design note explaining the still-open move-replacement prompt refactor. |
| `docs/arena-markers-stage-scope.md` | **Current** | The current state and remaining work for markers, tokens and `[Empower]`. |

## Historical / background docs

| doc | status | what it is for |
|---|---|---|
| `docs/arena-design-proposal.md` | **Historical background** | The original arena vision, rationale and storyboard; useful context, but newer specs describe the current implementation and live work. |
| `docs/arena-compiler-workflow-review.md` | **Historical review** | A point-in-time review of the compiler under the workflow UI; useful for rationale and findings, not as the current source of truth. |
| `docs/arena-rules-worklist.md` | **Historical work log** | The round-by-round build history and lessons from the early rules-engine programme; use newer hand-off docs for current priorities. |
