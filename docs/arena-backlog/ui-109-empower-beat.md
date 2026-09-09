---
title: Arena: add Empower inheritance transfer beat and board animation
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: backlog, ready-for-agent, enhancement, area:arena-contract, area:arena-ui, phase:capability-gap, model:sonnet-5
stage: ui
---
**Source:** `docs/arena-markers-stage-scope.md` §3 and §4 step C; `docs/arena-client-contract.md` (a `Snapshot` change is a contract change); `src/lib/arena/beats.ts`, `narration.ts`, `src/components/arena/stage/ArenaStage.tsx`.

**Problem.** [Empower] emits one `markers` beat with the final total on the new Unison and a `move` of the old one to the Drop. Nothing says the markers came *from* the card that just left, so the board counts them up in place; the feel of the keyword is the markers flying across.

**Build.**
1. A beat naming both cards — either a new kind `{ t: "markersMoved"; from; to; count }` or `from?` on the existing `markers` beat; choose the one that keeps `toBeats` simplest and record it in `docs/arena-client-contract.md` §3.2. Marker counts on a Unison are public, so `maskBeats` passes it through unchanged — say so in the test.
2. `narration.ts`: one sentence ("3 markers move from ⟨old⟩ to ⟨new⟩"); `motion.ts`: one duration; `ArenaStage.tsx`: the markers fly on `layoutId` from the leaving card to the arriving one; a `Ghosts` entry if the old card is already gone.
3. `npm run contract:emit` (an `all-beats.json` change is expected), Kotlin mirror in `android/contract`, `npm run android:test`.

**Depends on** #108's verification (the count in the beat is the chosen count).

**Acceptance.**
- Gate; `contract:emit` diff is exactly the new beat; `android:test` green.
- `scripts/verify/contract.ts` or `text.ts`: the beat narrates, masks correctly for both viewers, and appears once per [Empower] resolution.
- Scenario proof: a screen recording of a Unison replaced with markers carried, both skins.
