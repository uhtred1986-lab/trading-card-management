---
title: Arena: unmissable turns — YOUR TURN / CLAUDE'S TURN banner, turn pill and board edge
issue: 344
milestone: Arena M16 — Board redesign: play feel and card review
labels: backlog, ready-for-agent, enhancement, area:arena-ui, phase:board-redesign, model:sonnet-5
stage: ui
touches: src/components/arena/shared-display.tsx, src/components/arena/stage/ArenaStage.tsx, src/app/globals.css
---
**Source:** `docs/arena-board-redesign-spec.md` §2 and decision 6; frames `docs/arena-redesign/phone-02-turn-banner.jpg`, `docs/arena-redesign/desk-02-turn-banner.jpg`, `docs/arena-redesign/phone-01-board-your-turn.jpg`; `src/components/arena/shared-display.tsx` (`StepBanner`, `TurnStrip`, `TopStrip`); `src/lib/arena/lighting.ts` (`turnVars`).

**Problem.** The owner finds turns not clearly visible. `StepBanner` announces phases ("Charge Phase", "Attack!") but never *whose* turn it is. `TurnStrip` says "Your move" in small text above the prompt bar. Turn lighting washes the room, but that is ambient, not a signal.

**Build.**
1. **Turn-change banner.** When the acting player changes at a turn boundary, play a banner before the first phase banner: "YOUR TURN" or "<OPPONENT>'S TURN" (Claude's name in a practice game), with "Turn N" under it, for 1300 ms at 1× and scaled by pace. It is a skewed bar in the acting side's colour with stroked impact type, as in the frames. Reuse `StepBanner`'s overlay and the `arena-banner` keyframes where they fit. In the anime skin the bar gets ink rules top and bottom and the text a hard offset shadow. It must not queue behind or double up with the phase banner: when both are due, the turn banner plays and the phase banner follows.
2. **Turn pill.** The phone top bar and desktop header get a pill reading "YOUR TURN · Turn 3", filled with the acting side's colour, with a blinking dot. It replaces the "Your move" line in `TurnStrip`; keep the moves count as the prompt bar's sentence ("7 moves available — …").
3. **Board edge.** A 4–5 px inner frame in the acting side's colour around the board, which switches with the banner. It goes on the stage root, not `<html>`, and uses `turnVars`. Night gets a soft glow, anime an ink-outlined band.
4. **Active rows.** The acting side's battle row gets a faint highlight band, like the lit row in the frames. Keep the existing `arena-leader-on` ring.
5. **Phase chips.** Show the phases as a row of chips (Draw · Charge · Main · Battle · End) with the current one lit, on phone under the top bar and on desktop in the left column. This is `TopStrip`'s content made legible, not new state.

**Out of scope.** Lighting modes and the settings page (unchanged), and sound.

**Acceptance.**
- `npm run typecheck && npm run lint && npm test && npm run build`.
- rd-01 shots of the preview at a turn boundary, in both skins at both sizes, beside `*-02-turn-banner.jpg`.
- Reduced motion: the banner shows for its duration without movement, or not at all. It never blocks input.
- In step pace, the turn banner is its own step.
