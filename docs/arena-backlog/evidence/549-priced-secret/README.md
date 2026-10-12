# #549 priced secret Auto browser proof

The fixture uses a synthetic [Auto] with a supported red-energy price. It does not represent a printed card. The artwork is the portable `BT1-053.webp` asset used only to check that a declared source has visible art; it is not the synthetic card's art.

`priced-secret-auto-browser-549.mts` applies real rules-engine `orderPending` and `chooseMode` actions, builds player-two snapshots from the resulting states and events, and sends them through a mocked game API poll. The page first mounts a pre-declaration snapshot with no beats, then receives the declaration, activated skill, or later concealed history at a greater revision. The mock returns unchanged responses after the target snapshot is displayed. This verifies browser reconciliation and presentation without a live game API or database.

The `before` captures use main `8241431` and the `after` captures use this branch. Each captures the declaration moment at 390px phone and 1440px desktop widths, in anime and night skins. The script also checks the activated label and art after payment and the absence of the hidden source's name in later replay, without adding more screenshots.

Run with a local dev server and `DATABASE_URL='' ARENA_BASE=http://localhost:<port> npx tsx scripts/verify/priced-secret-auto-browser-549.mts`. For baseline comparison, serve `8241431` separately and set `ARENA_PREVIEW_ROOT` to that worktree plus `ARENA_CAPTURE_BASELINE=1`. The script removes its temporary contract fixtures when it exits.
