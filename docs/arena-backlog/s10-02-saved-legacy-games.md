---
title: Arena: what happens to saved legacy games — replay onto the rules engine on load, or open read-only
milestone: Arena M13 — Retire the legacy engine (Stage 10)
labels: backlog, needs-owner-ruling, area:arena-vm, phase:rules-stage10
stage: 10
---
**Source:** plan Stage 10 ("old games either replay onto `vm` on load or open read-only (owner's call then)"); `arena_games.engine`, `arena_matches.engine`; `docs/arena-client-contract.md` (a game is its seed plus actions).

**Decision needed from the owner** before Stage 10 starts. Options:
1. **Replay on load** — a legacy row is replayed from seed + actions on the rules engine the first time it is opened, its `engine` column flipped and its state rewritten; requires Stage 9's parity to be total, and a game whose deck was edited since (shuffle changed) is refused with a message. One migration path, no dead code.
2. **Read-only** — legacy games open on the board with no legal actions and a banner; the legacy engine's `boardView`/`toBeats` would have to survive, which contradicts retiring it, unless the *snapshot* is stored rather than recomputed.
3. **Archive** — legacy games are listed and their last snapshot shown from a stored JSON, nothing replays.

State the choice here; then the retire issue proceeds. Until then this issue is `needs-owner-ruling`.

**Acceptance.** The owner's decision recorded in a comment and in `docs/arena-ruleset-spec.md`; a follow-up issue for the implementation, labelled `ready-for-agent`.
