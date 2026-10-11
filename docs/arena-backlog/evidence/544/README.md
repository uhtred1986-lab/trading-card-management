# Arena #544 evidence

The browser captures use the existing development-only `/arena/preview` route; no application route was added. The before state is a current-app UI-state comparison with a null-winner `draw` outcome, while the after state uses the typed `interrupted` outcome and displays `GAME INTERRUPTED`. These are not captures from the old application build.

The visible card faces use the existing card artwork committed in `assets/BT1-033.webp` and `assets/BT1-050.webp`. The capture harness stages them under `public/arena-design` temporarily and restores any files that were already there. For both states, both skins and both viewports, the harness checks the expected heading, loaded artwork (`complete && naturalWidth > 0`) and absence of victory rays on interruption before writing the screenshots. Screenshots show the actual Arena board and GameEnd composition.

To reproduce from a fresh checkout, start the development server:

```sh
DATABASE_URL='' npm run dev
```

In a second terminal, run the harness:

```sh
DATABASE_URL='' npx tsx scripts/arena-outcome-shots.mts
```

The harness derives two temporary snapshots from `contract/fixtures/over.json`, stages the committed art under temporary public URLs, uses the existing CDP browser driver, and cleans up in `finally`. It writes refreshed captures directly into this evidence folder. It needs the same local Chrome/Chromium setup as `scripts/arena-shots.mts` and does not install dependencies.

| View | Skin | Null-winner draw UI state | Typed interruption |
| --- | --- | --- | --- |
| 390×844 | anime | [phone-outcome-before-anime-544.jpg](phone-outcome-before-anime-544.jpg) | [phone-outcome-after-anime-544.jpg](phone-outcome-after-anime-544.jpg) |
| 390×844 | night | [phone-outcome-before-night-544.jpg](phone-outcome-before-night-544.jpg) | [phone-outcome-after-night-544.jpg](phone-outcome-after-night-544.jpg) |
| 1440×900 | anime | [desk-outcome-before-anime-544.jpg](desk-outcome-before-anime-544.jpg) | [desk-outcome-after-anime-544.jpg](desk-outcome-after-anime-544.jpg) |
| 1440×900 | night | [desk-outcome-before-night-544.jpg](desk-outcome-before-night-544.jpg) | [desk-outcome-after-night-544.jpg](desk-outcome-after-night-544.jpg) |

Local assertions also cover false-condition versus unread resolution, typed and legacy archive round-trips, both live viewer projections including log/beat privacy, abandonment over a stale winner, and a real `reviewGame` call with an instrumented fake provider that receives zero requests for interrupted state. No database service or paid model was used.
