# Arena sheet accessibility evidence (#559)

These screenshots come from the local contract preview in both `anime` and `night` skins. The fixture starts from `contract/fixtures/play.json`; the harness temporarily maps its V1 card to Senzu Bean BT11-053 and embeds the card artwork crop `card-art-bt11-053.jpg`, taken from the existing app artwork capture `docs/arena-redesign/playability-abilities-battle-phone.jpg`. It is a screenshot-only preview fixture, not catalog data. The temporary fixture file is removed by `scripts/arena-sheet-a11y.mts` when the run ends.

`desk-play-*-u02-before.jpg` and `phone-play-*-u02-before.jpg` show the existing board at 1440px and the existing card sheet at 390px. The matching `*-after.jpg` captures show the accessible Board controls dialog at desktop and the reviewed card sheet at phone size. `shortphone-*` (390×650) and `narrowphone-*` (320×568) after captures use 200% root text and `prefers-reduced-motion: reduce`.

The harness checks that reviewed artwork is loaded (`complete` and nonzero `naturalWidth`), native modal semantics and initial focus, Tab and Shift+Tab containment, inert background, Escape closure and focus restoration, nested dialog isolation from the parent pager, keyboard paging with the close button focused, and focus restoration after swipe-close and action-pick unmounts. At short and narrow sizes it checks the 44px close target remains in the viewport.

The before captures use the parent revision of `shared-sheets.tsx`; `--capture-only` itself does not change source files. After captures are produced by the default mode, which also runs the interaction assertions.

Capture command (run from the repository root while the local dev server is running):

```sh
DATABASE_URL='' npm run dev
DATABASE_URL='' npx tsx scripts/arena-sheet-a11y.mts
```
