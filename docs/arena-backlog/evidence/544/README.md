# Arena #544 evidence

The browser captures use the existing development-only `/arena/preview` route and `scripts/arena-shots.mts`; no application route was added. Temporary snapshots were derived from the `over` contract fixture, then removed. The end-screen states were: the old null-winner/prefix outcome interpreted as `DRAW`, and the typed `interrupted` outcome displayed as `GAME INTERRUPTED`. These are UI-state comparisons, not a run of the old application build.

The visible card faces use the existing local `/arena-design/BT1-033.webp` and `/arena-design/BT1-050.webp` assets from the primary checkout's `public/arena-design` folder. They were copied temporarily into this worktree's `public/arena-design` only during capture, then removed. A separate CDP check confirmed the expected heading and five loaded images (`complete && naturalWidth > 0`) for both states, both skins, at 390×844 and 1440×900. The same check confirmed the interrupted title has no victory rays. Screenshots show the actual Arena board and GameEnd composition.

To reproduce in a checkout with those local assets, temporarily copy the two image files into `public/arena-design`, create `outcome-before.json` and `outcome-after.json` beside `contract/fixtures/over.json` from that `over` snapshot, and set both snapshots' `view.you.leader.imageUrl` and `view.them.leader.imageUrl` to the corresponding `/arena-design/...` paths. Set both `view.over` and top-level `over` to `winner: null`; use kind `draw` with reason `this engine cannot finish this game` for the before state and kind `interrupted` with reason `This game was interrupted before a result was reached.` for the after state. Set the one `beats.list` entry to the same winner, reason and kind. Then run:

```sh
DATABASE_URL='' npm run dev
DATABASE_URL='' npx tsx scripts/arena-shots.mts --fixtures outcome-before,outcome-after --skins anime,night --tag 544 --settle 400
```

Remove the two temporary fixture files and copied assets after capture.

| View | Skin | Old null-winner interpretation | Typed interruption |
| --- | --- | --- | --- |
| 390×844 | anime | [phone-outcome-before-anime-544.jpg](phone-outcome-before-anime-544.jpg) | [phone-outcome-after-anime-544.jpg](phone-outcome-after-anime-544.jpg) |
| 390×844 | night | [phone-outcome-before-night-544.jpg](phone-outcome-before-night-544.jpg) | [phone-outcome-after-night-544.jpg](phone-outcome-after-night-544.jpg) |
| 1440×900 | anime | [desk-outcome-before-anime-544.jpg](desk-outcome-before-anime-544.jpg) | [desk-outcome-after-anime-544.jpg](desk-outcome-after-anime-544.jpg) |
| 1440×900 | night | [desk-outcome-before-night-544.jpg](desk-outcome-before-night-544.jpg) | [desk-outcome-after-night-544.jpg](desk-outcome-after-night-544.jpg) |

Local assertions also cover false-condition versus unread resolution, typed and legacy archive round-trips, both live viewer projections including log/beat privacy, abandonment over a stale winner, and a real `reviewGame` call with an instrumented fake provider that receives zero requests for interrupted state. No database service or paid model was used.
