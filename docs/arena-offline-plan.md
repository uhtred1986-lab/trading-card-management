# Offline Masters AI implementation plan

Source: the owner's uploaded `create-offline-milestones.py` and request of 12 October 2026 to create milestones and granular work for individual agents. The five phase descriptions below are preserved from the script. The script itself creates milestones only; this plan decomposes those outcomes into 27 bounded implementation issues.

## Delivery and pickup rules

- Ready now: #639 (guidance), #640 (portable replay), #649 (deck audit).
- #648 waits for active desktop-board #564. All other children are blocked on their listed predecessors, not on a blanket phase-wide gate.
- Read the assigned issue and comments, its canonical file, its tracker, `CLAUDE.md`, `docs/agent-brief.md` and the arena-work skill. Recheck symbols and dependency state at pickup.
- One bounded issue/branch/draft PR. Do not start implementation from a tracking issue. Check `touches:` and serialize shared files even where the dependency graph permits concurrent work. An issue does not authorize nested agents.
- O4 auditing starts during O1. It names exact candidate decklists and existing rule owners before policy coverage and pack qualification. A deck is not supported until its blockers and scenario gates pass.
- Preserve online behavior and #547's immutable replay provenance. Masters only; full-catalog support, Fusion World, legacy retirement and speculative MCP infrastructure are outside the MVP.
- Code changes run local typecheck/lint/tests/build and applicable engine/contract/compiler gates. Live database writers and paid-provider calls are outside these tickets. Missing hardware/live evidence remains open acceptance, not an implied pass.
- Existing area/model labels are reused. `phase:arena-home` categorizes the local-play delivery; O1–O5 identify sequencing. `model:*` is the repository's existing recommendation metadata, not a command to launch a model or agent.

## Milestone provisioning status

The cloud environment has `GH_TOKEN`, but its HTTP proxy rejects CONNECT to `api.github.com` before GitHub authentication. Connector tools can create/update issues but do not expose milestones. The five intended milestone titles are recorded in every canonical file; actual creation and assignment require allowed API network access. Do not claim that milestones exist until an API read confirms their IDs and issue associations.

## O1

**Arena O1 — Developer efficiency and offline foundations** — tracking #633.

Prerequisite foundation for offline Masters play. Correct stale agent/MCP guidance; verify TypeScript definitions/references/diagnostics and browser offline/network/worker tooling; extract portable replay-bundle logic from persistence and runtime lookup; provide a browser-safe rules-only engine entry point with import-boundary checks; add focused deterministic scenarios and compact structured evidence. Exit: browser execution and Node/browser replay/hash parity demonstrated, existing behavior preserved, tooling checks documented. Measure task time/tool calls/context where available; do not promise token savings. Broad file splitting, legacy retirement and a custom MCP server are not prerequisites.

| Issue | Work | Prerequisites |
|---|---|---|
| #639 (O1-01) | Refresh agent guidance and verify available navigation/browser tooling | Ready now |
| #640 (O1-02) | Extract portable replay serialization and hashing from server persistence | Ready now |
| #641 (O1-03) | Expose a browser-safe rules engine and snapshot entry point | #640 |
| #642 (O1-04) | Add focused deterministic scenario execution and compact evidence output | #641 |
| #643 (O1-05) | Measure browser worker latency, responsiveness and memory budgets | #642 |

## O2

**Arena O2 — Local heuristic opponent** — tracking #634.

Define a provider-independent policy and restricted observation contract; extract existing shortcuts; implement heuristic choices for all decision types reachable in the MVP decks; add tactical, full-match, both-seat and hidden-information invariance evaluation. Depends on O1 scenario tooling and portable boundaries. Exit: deterministic legal decisions and complete supported matches without model/provider calls, hidden-state access or unbounded decision loops. Keep policy randomness separate from game randomness. Establish strength baselines before setting improvement targets.

| Issue | Work | Prerequisites |
|---|---|---|
| #644 (O2-01) | Define a restricted policy observation and legal-decision contract | #641 |
| #645 (O2-02) | Extract existing free-choice heuristics into the pure policy module | #644 |
| #646 (O2-03) | Implement bounded main-phase local play and attack selection | #645, #642 |
| #647 (O2-04) | Implement local combat responses and resource-aware combos | #646 |
| #650 (O2-05) | Complete constrained choices, payments and policy decision coverage | #647, #649 |
| #651 (O2-06) | Evaluate the complete heuristic across seeds, seats and hidden states | #650, #642 |

## O3

**Arena O3 — Offline match runtime** — tracking #635.

Separate board presentation from session transport while preserving online behavior; implement a Web Worker session with revision validation, bounded work and cancellation; persist pinned inputs/state/actions/policy version/randomness in IndexedDB; connect the existing board to local play. Depends on O1 browser engine and O2 policy. Exit: start, play, save, reload and finish local matches; recovery during choices or AI turns, stale responses, storage failure and multiple-tab ownership verified without duplicate moves.

| Issue | Work | Prerequisites |
|---|---|---|
| #648 (O3-01) | Separate ArenaStage presentation from online session transport | #564 |
| #652 (O3-02) | Implement a revisioned local match worker protocol (delivered: `src/lib/arena/local/{protocol,worker,worker-entry}.ts` and the page client `src/components/arena/session/local.ts`; journal in memory until #653) | #641, #651 |
| #653 (O3-03) | Persist versioned local matches transactionally in IndexedDB (delivered: `src/lib/arena/local/storage.ts`, used by the worker entry; proofs `scripts/verify/arena-local-storage.mts` and `npm run arena:local-storage-browser`) | #652 |
| #654 (O3-04) | Recover interrupted workers and enforce one writer per local match | #653 |
| #656 (O3-05) | Connect the existing board to local start, resume and finish flows (delivered: `src/components/arena/session/{local-board.ts,LocalArena.tsx}` and `/arena/local`; proof `scripts/verify/arena-local-board-656.mts`; it plays a qualified pack only, so the real SD15/SD5 pack stays closed until U1 resolves) | #648, #654, #655 |
| #657 (O3-06) | Verify local session recovery across browser failure cases | #656 |

## O4

**Arena O4 — Verified offline MVP release** — tracking #636.

Audit two curated Masters decks early and package all required definitions, executable rules, generated-card dependencies and artwork. Reuse existing correctness issue owners for blockers. Deliver a dedicated cached offline shell, complete/versioned pack downloads, removal and local-data controls. Depends on O1-O3 for release; deck auditing can start during O1. Exit: prepared app cold-launches in airplane mode and completes supported matchups in both seats on desktop and a target phone, including reload/update/worker/storage failure cases. Measure latency, responsiveness and memory against spike-established budgets. Full-catalog support and Fusion World are outside MVP scope.

| Issue | Work | Prerequisites |
|---|---|---|
| #649 (O4-01) | Audit two curated Masters decks and map offline blockers (delivered as [`arena-offline-deck-audit.md`](arena-offline-deck-audit.md): decks, blocker register and the decision kinds #650 needs; qualification stays blocked) | Ready now |
| #655 (O4-02) | Build complete versioned offline deck packs (format and builder delivered: `src/lib/arena/local/pack.ts`, `scripts/build-arena-offline-pack.mts`; the SD15/SD5 pack validates and stays unplayable until the audit's blockers close) | #649, #640 |
| #658 (O4-03) | Install, verify and update offline packs atomically (store delivered: `src/lib/arena/local/pack-store.ts`; proofs `scripts/verify/arena-pack-store.mts` and `npm run arena:pack-store-browser`; wiring into `/arena/local` is #659/#660) | #655, #653 |
| #659 (O4-04) | Deliver a dedicated offline shell with safe service-worker updates | #648, #658 |
| #660 (O4-05) | Add offline preparation, storage and local-data controls | #656, #659 |
| #661 (O4-06) | Verify the airplane-mode MVP and publish the support matrix | #660, #657, #651, #643 |

## O5

**Arena O5 — Expanded deck coverage and stronger play** — tracking #637.

After the offline MVP, admit more Masters decks through capability and cross-deck scenario verification; fix shared mechanics through existing backlog owners. Add optional bounded search/difficulty using sampled unknown information, strict device budgets and a heuristic fallback. Exit per increment: added decks pass compatibility gates and policy improvements demonstrate measured strength without privacy, rules or performance regressions. Full-catalog support is a continuing coverage goal. Consider a small arena MCP wrapper around proven inspect/scenario/replay commands only if measured agent workflows justify it.

| Issue | Work | Prerequisites |
|---|---|---|
| #662 (O5-01) | Add a repeatable deck admission gate and qualify the next pair | #661 |
| #663 (O5-02) | Prototype bounded search using sampled unknown information | #661 |
| #664 (O5-03) | Evaluate search strength and expose evidence-backed difficulty levels | #663, #651 |
| #665 (O5-04) | Measure whether an arena MCP wrapper would improve agent workflows | #661, #639, #642 |

## Shared-file scheduling

Replay-core extraction precedes the browser entry and scenario tools. Policy contract precedes shortcut extraction, main/combat handlers and remaining choice handlers; do not assign simultaneous edits to the policy dispatcher. Worker protocol precedes storage, ownership recovery and local board wiring. Pack download/storage precedes shell/service-worker caching; one writer owns `public/sw.js` at a time. Board transport must follow #564, with one writer of `ArenaStage.tsx` and shared session hooks. Read-only deck auditing can proceed alongside foundations; correctness fixes remain with their existing issues. Check updated touch sets before dispatch rather than relying on this initial ordering alone.
