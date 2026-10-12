# Ability and decision snapshot visual regression (#558)

The change adds optional snapshot data and does not change ArenaStage rendering. These captures compare the same `contract/fixtures/play.json` board before and after the contract addition, with real Senzu Bean (BT11-053) artwork from the existing checked-in #559 preview crop. The baseline is unchanged `5f82987`; its preview fixture has no `decision` or per-card `abilities` fields. The after fixture is the generated current contract fixture. The page receives no database response or live game data.

The committed harness writes `contract/fixtures/u01-evidence.json` for the duration of a run, attaches the local artwork to V1 instances, checks that an Arena image loaded, captures both skins at 1440×900 and 390×844, plus 390×650 and 320×568 at 200% root text and reduced-motion preference, and removes the temporary fixture in `finally`. The short-phone captures are layout smoke checks; no accessibility or ability-panel behavior is claimed because the UI consumer belongs to #561.

For a fresh local reproduction, create a baseline worktree at the recorded revision and reuse the verified dependency tree for the same lockfile; do not run an install:

```sh
git worktree add /tmp/arena-558-before 5f82987
cp -al /path/to/candidate/node_modules /tmp/arena-558-before/node_modules
(cd /tmp/arena-558-before && DATABASE_URL='' npm run dev -- --port 3017)
(cd /path/to/candidate && DATABASE_URL='' npm run dev -- --port 3018)
(cd /path/to/candidate && DATABASE_URL='' npx tsx scripts/arena-ability-contract-558.mts --before --repo=/tmp/arena-558-before --base=http://localhost:3017)
(cd /path/to/candidate && DATABASE_URL='' npx tsx scripts/arena-ability-contract-558.mts --base=http://localhost:3018)
```

`before` and `after` are source/contract snapshots of the same board state, not different Arena interactions. Both use the existing development-only `/arena/preview` route. No new production route, external image request, database, or provider is involved.

| Viewport | Skin | Before | After |
|---|---|---|---|
| 1440×900 | anime | [desk-anime-before-558.jpg](desk-anime-before-558.jpg) | [desk-anime-after-558.jpg](desk-anime-after-558.jpg) |
| 1440×900 | night | [desk-night-before-558.jpg](desk-night-before-558.jpg) | [desk-night-after-558.jpg](desk-night-after-558.jpg) |
| 390×844 | anime | [phone-anime-before-558.jpg](phone-anime-before-558.jpg) | [phone-anime-after-558.jpg](phone-anime-after-558.jpg) |
| 390×844 | night | [phone-night-before-558.jpg](phone-night-before-558.jpg) | [phone-night-after-558.jpg](phone-night-after-558.jpg) |

The short and narrow phone screenshots (390×650 and 320×568) are included in both skins with the same 200% text and reduced-motion settings. They are visual smoke evidence; because the UI does not yet consume these contract fields, the captures make no claim about an ability panel or new interaction.
