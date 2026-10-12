# Arena fullscreen card review evidence (#560)

The screenshots use the local `/arena/preview` route in both `anime` and `night` skins. The main fixture starts from `contract/fixtures/play.json`, and the Charge check copies `contract/fixtures/charge.json`. The harness temporarily maps V1 to Senzu Bean BT11-053 and embeds `card-art-bt11-053.jpg`, a crop already checked into the #559 evidence set. This is preview-only evidence, not catalog data. `scripts/arena-fullscreen-review.mts` writes `contract/fixtures/u03-evidence.json` and `contract/fixtures/u03-charge-evidence.json` only for the run and removes them in `finally`.

Before images use unchanged `origin/main` revision `74701713f89012b0dc89957d9bcb92d4803b7275`. They show its seven-card fixture and existing card review opened through the card's context-menu inspection handler. After images use the same board fixture with a 20-instance hand, including duplicate card identities. The new `phone-board-*` captures are taken before opening a sheet, so the hand affordance and the board's primary action remain visible. Hand review opens from the new Inspect hand button; the swipe check walks every instance and confirms that inspection leaves the hand order intact. After phone captures show the full-art view. The desktop captures show the existing docked inspector with the new hand affordance.

`shortphone-*` uses a 390×650 viewport and `narrowphone-*` a 320×568 viewport. Both set the root text size to 200% and emulate reduced motion. The tablet captures use 768×1024 portrait and 1023×768 landscape, covering the responsive interval where the default sheet gutter could previously clip a viewport-height image. The harness checks the full-art image is loaded (`complete` and nonzero `naturalWidth`), pager/close controls are at least 44px and inside the viewport, swipes page through 20 distinct hand instances, ArrowLeft pages back while the close control is focused, and Escape restores focus to Inspect hand. It opens the board pager through the actual 44px “Review cards in play” eye control. Charge-phase and target-selection checks use PreviewStage's action-recording stub (`window.__arenaSent`): opening/closing hand review during Charge must preserve the prompt and hand IDs without sending an action, and opening/closing board review during a selected legal attack must preserve the selected attacker without sending an action. The fixture loader removes both temporary fixtures in `finally`. Baseline artwork and the current-run artwork are validated before screenshots are saved.

For a local reproduction, first create an untouched baseline worktree at the revision above and run a dev server in it on port 3010. In a second worktree at the candidate branch, start the candidate server on port 3020, then run the harness from the candidate worktree:

```sh
git worktree add /tmp/arena-560-before 74701713f89012b0dc89957d9bcb92d4803b7275
(cd /tmp/arena-560-before && DATABASE_URL='' npm run dev -- --port 3010)
(cd /path/to/candidate && DATABASE_URL='' npm run dev -- --port 3020)
(cd /path/to/candidate && DATABASE_URL='' npx tsx scripts/arena-fullscreen-review.mts --before --repo=/tmp/arena-560-before --base=http://localhost:3010)
(cd /path/to/candidate && DATABASE_URL='' npx tsx scripts/arena-fullscreen-review.mts --after --base=http://localhost:3020)
```

The baseline server needs the repository's normal Node dependencies for the same lockfile. No database or remote card service is used. The before/after captures are app-state comparisons: before retains the original seven-card fixture and old card-review entry point; after uses the temporary 20-instance fixture and the new explicit hand-inspection control.
