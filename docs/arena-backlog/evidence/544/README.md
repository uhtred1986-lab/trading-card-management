# Arena #544 evidence

The browser captures use the existing development-only `/arena/preview` route; no application route was added. The four before captures run the unchanged `origin/main` baseline at `74701713f89012b0dc89957d9bcb92d4803b7275`. Their temporary snapshot contains the old null-winner `NOT_YET`-prefix reason without a typed `kind`; that baseline UI displays `DRAW`. The four after captures run this PR's typed `interrupted` outcome and display `GAME INTERRUPTED`.

The visible card faces use the existing card artwork committed in `assets/BT1-033.webp` and `assets/BT1-050.webp`. The capture harness stages them under `public/arena-design` temporarily and restores any files that were already there. For both states, both skins and both viewports, the harness checks the expected heading, loaded artwork (`complete && naturalWidth > 0`) and absence of victory rays on interruption before writing the screenshots. Screenshots show the actual Arena board and GameEnd composition.

To reproduce both sides, create a separate baseline worktree at the exact old revision, then start its dev server on port 3001. The dependency lockfile matches this branch; reuse an already verified `node_modules` tree with hard links if the worktree needs dependencies:

```sh
git worktree add --detach /tmp/arena-544-before 74701713f89012b0dc89957d9bcb92d4803b7275
cmp package-lock.json /tmp/arena-544-before/package-lock.json
cp -al node_modules /tmp/arena-544-before/
cd /tmp/arena-544-before
DATABASE_URL='' npm run dev -- -p 3001
```

In a second terminal in the PR checkout, run the capture harness against the baseline server. It writes the four baseline images into this evidence folder:

```sh
DATABASE_URL='' npx tsx scripts/arena-outcome-shots.mts \
  --state before \
  --base http://localhost:3001 \
  --fixture-dir /tmp/arena-544-before/contract/fixtures \
  --public-art-dir /tmp/arena-544-before/public/arena-design
```

Then stop the baseline server and worktree, start the PR checkout's dev server on port 3000, and capture the after images:

```sh
DATABASE_URL='' npm run dev
```

```sh
DATABASE_URL='' npx tsx scripts/arena-outcome-shots.mts --state after --base http://localhost:3000
```

The harness derives one temporary snapshot from `contract/fixtures/over.json`, stages the committed art under temporary public URLs, uses the existing CDP browser driver, and cleans up in `finally`. The baseline reason is `this engine cannot finish this game — BT1-033: an unread effect interrupted resolution; #544`; the after reason is `This game was interrupted before a result was reached.` Each run asserts the expected title, all five page images loaded, and no victory rays for interruption. It needs the same local Chrome/Chromium setup as `scripts/arena-shots.mts` and does not install dependencies. After capture, remove the temporary worktree with `git worktree remove /tmp/arena-544-before`.

| View | Skin | `7470171` baseline: Draw | PR: Game interrupted |
| --- | --- | --- | --- |
| 390×844 | anime | [phone-outcome-before-anime-544.jpg](phone-outcome-before-anime-544.jpg) | [phone-outcome-after-anime-544.jpg](phone-outcome-after-anime-544.jpg) |
| 390×844 | night | [phone-outcome-before-night-544.jpg](phone-outcome-before-night-544.jpg) | [phone-outcome-after-night-544.jpg](phone-outcome-after-night-544.jpg) |
| 1440×900 | anime | [desk-outcome-before-anime-544.jpg](desk-outcome-before-anime-544.jpg) | [desk-outcome-after-anime-544.jpg](desk-outcome-after-anime-544.jpg) |
| 1440×900 | night | [desk-outcome-before-night-544.jpg](desk-outcome-before-night-544.jpg) | [desk-outcome-after-night-544.jpg](desk-outcome-after-night-544.jpg) |

Local assertions also cover false-condition versus unread resolution, typed and legacy archive round-trips, both live viewer projections including log/beat privacy, abandonment over a stale winner, and a real `reviewGame` call with an instrumented fake provider that receives zero requests for interrupted state. No database service or paid model was used.
