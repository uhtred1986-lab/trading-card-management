# Arena Motion Prototype (design reference)

Published: https://claude.ai/artifact/9RjLbeMc3K87Twei1waF3X. Open `index.html` locally (serve the folder, e.g.
`python -m http.server`) so the `cards/*.png` scans load.

Owner's direction (18 Oct 2026) for building it into the arena:
- Use the current card resolution (260×363 scans). Playability beats blur; do not chase sharper art.
- The text that matters is the text the **app** generates (skill short names, power, cost, status, captions). It must
  read well and have breathing room; it sits over the printed text, which is unreadable at these sizes anyway.
- It must feel like playing something cool: impact type, the clash/VS moment, motion with a job.

Evaluation notes to carry over: keep the zoomed card at or below ~300 px wide; the app's power number covers the
printed power (no double power); preload/decode art so a re-render never flashes black.

## Background blur (`focus-blur`, added to the prototype 18 Oct 2026)

Rule: blur what is not the point. Turn changes, a zoomed card, a skill spotlight, Claude's reveal and the review sheet
appear over a blurred, dimmed board; nothing is blurred while the player picks a target on the board. The prototype uses
one full-stage scrim (`backdrop-filter: blur(7px) saturate(.75)`, 220 ms fade). Blur strength is fixed; only the dim
varies: turn banner .3, clash .35, reveal/review .4, spotlight .5, card zoom .62 (halved in `scrim()`).

Open points from the review (19 Oct 2026) to settle when building it into the app:
- The clash takeover also blurs the board (with the hand lifted above the scrim so counters stay playable), but the
  catalogue row's trigger list omits it. Name the clash and the hand-above-blur exception in the rule.
- Reduced motion: the catalogue says static blur, no fade; the prototype still fades the scrim in 140 ms.
- Phones: board animations under the scrim (legal-card ki glow, energy blink) make the browser recompute the blur every
  frame. Pause board animations while the scrim is up.
- The app has no board blur yet; `backdrop-blur` appears only on panels (notices, bug report, rule builder).

## Desktop and tablet layout (owner, 19 Oct 2026)

From 1024 px (landscape tablets and up) the board has three columns, as the prototype's PC frame:
- **Left, game status:** both players (life, energy, hand/deck/drop counts) stacked instead of strips across the field,
  the battle log between them, and the decision (End turn, the prompt and its answers) at the foot.
- **Middle:** the field over the hand. The two Battle Areas split the field's height and their cards are sized to it
  (`useFieldFit`).
- **Right, one card:** hover previews a card, a click or tap pins it, and a pinned card pages through its group (your
  hand, your cards in play, the opponent's) with the arrows, the arrow keys, a swipe or the thumbnails, like the
  phone's review. The old In play list and Battle log tabs are gone from this column.

Portrait tablets (768-1023 px) keep the phone's touch layout.
