# Support checkpoint 81: private incremental inspection

R527 (`f5c732bc`, `3dcf0484`) supports the exact complete BT1-061#0 and EX02-01#10 Autos with one-card-at-a-time private inspection. Gohan shuffles after stopping, including at zero. Trunks orders all leftovers at one chosen deck end; its old compiler tail omitted that order prompt. Full source, native boundaries and saved-state authentication are documented in [incremental-look.md](incremental-look.md).

The complete frozen catalog comparison changes exactly two records: BT1-061#0 changes only `ops` and `reads`; EX02-01#10 changes only `ops`, `reads` and `pattern`. The other **13,964 records are field-identical**, including field sets and all sibling records. Totals remain **6,597 cards /13,966 records /13,032 readable /934 unread**. Snapshot SHA-256 is `1b07f70fe7eb56461054a66045a231c152f11925af18500f7050ea6c177714b1`. Runtime census and the complete gap-reason list are unchanged: **2 readable-but-blocked /307 additionally blocked /2,575 contextual-unknown**. These counts do not establish complete gameplay support.

Root combined verification passes 48 native/visibility, 86 saved/empty and 22 language/expanded-native inspection cases; 85 staged under-native contracts; 58 joint-fact and 14 joint-priority cases. TypeScript and changed-file lint pass. Two inherited verification defects were repaired in `78cf13f7`: the old BT19-093 unread assertion now checks the exact admitted permission (55-record suite passes), and malformed standing-history controls use explicit mutation types instead of `any` (206 cases pass). Rulings validate **300 active /166 cited**. Capability registration `cf65ed29` tracks **269 VM sites**, preserving all stable identities.

Real Chromium module-worker verification passes **232 served modules /121 steps to turn18 main**, identical to Node, with zero network requests after loading. Final hash is `d4f7c3ee11c0ed0bca30c6e0dfc91ab4176bb7a5196309e21864656227f3c09a`. This is the real-browser module count; older receipts' portable graph counts are a different measurement.

R528 Stage A (`49e5795e`) supplies reviewed native transaction/read helpers but does not yet connect the factory, loader or live writers. Abducted and its two activation lines remain unsupported. See [under-native-preparation.md](under-native-preparation.md). Stage B continues separately; this checkpoint does not claim its completion.

## Screen evidence

The repository screenshot tool compared both native inspection fixtures against `origin/main` plus only the identical new fixture files (baseline `6774b7474c73a3cc0a9771bec9e2d3fd4bcad48e`). All eight after-images and diff images were inspected. The new content remains within the prompt, with two card columns on phone and three on desktop, readable actions and no clipping. The night empty desktop diff also includes the development indicator at bottom left; that is outside product content. No database was needed. Art is intentionally absent from these fixtures; expanded printed-text interaction is not claimed by static screenshots.

| Skin | Fixture | Width | Changed pixels | Diff box (x,y,width,height) |
| --- | --- | ---: | ---: | --- |
| anime | inspection-empty | 1440 | 130684 | 392,298,656,354 |
| anime | inspection-empty | 390 | 348522 | 0,551,780,686 |
| anime | inspection-prefix | 1440 | 257104 | 392,233,656,484 |
| anime | inspection-prefix | 390 | 764767 | 0,291,780,1206 |
| night | inspection-empty | 1440 | 134353 | 1,298,1047,602 |
| night | inspection-empty | 390 | 348525 | 0,551,780,686 |
| night | inspection-prefix | 1440 | 257099 | 392,233,656,484 |
| night | inspection-prefix | 390 | 764767 | 0,291,780,1206 |

All differences persisted across two rounds. Reports and PNGs are retained in session artifacts `/workspace/shared/arena-support5/recovery/.shots-inspection-{anime,night}/`; filenames are `arena-preview-fixture-<fixture>-skin-<skin>-pace-step-<width>.{before,after,diff}.png`. Phone images use device scale 2, hence pixel boxes wider than the CSS viewport. Screenshots are not committed. Combined full gate/build remains due after the active integrations; no database writes, dependency changes, deployment or merge occurred.
