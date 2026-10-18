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
