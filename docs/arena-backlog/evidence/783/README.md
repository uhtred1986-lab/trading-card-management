# #783 — a playable phone match layout (evidence)

The owner's S21 report (14 Oct 2026): too much scrolling, too many boxes, no word when a KO skill had
no target, and the leader looked like any played card. Everything here is a real local match on
`/arena/local` (no database), driven by `scripts/arena-phone-board-783.mts`: the audited SD15/SD5 pack
chosen in the page's own picker, Start match, the human's moves through the page's `LocalBoard`, the
computer's through the board's advance. Each key step is shot the first time it comes up.

Viewports: `s21` 360 × 800 (the issue's size), `s21plus` 412 × 915, `s21browser` 360 × 650 (the S21's
Chrome with its address and navigation bars shown — what the owner's screenshot actually has), `desk`
1440 × 900. Both skins. Before = `origin/main` at 03a5aa37; after = this branch. JPEG, DPR 1, quality 60.

## Page scroll during a turn (px; 0 = one screen)

| viewport | before (mulligan / main / combo / choice / end) | after |
|---|---|---|
| s21 anime | 102 / 145 / 195 / 310 / 102 | 0 / 0 / 0 / 0 / 0 |
| s21 night | 102 / 144 / 213 / 306 / 102 | 0 / 0 / 0 / 0 / 0 |
| s21plus anime | 118 / 118 / 118 / 118 / 118 | 0 / 0 / 0 / 0 / 0 |
| s21plus night | 118 / 118 / 118 / 118 / 118 | 0 / 0 / 0 / 0 / 0 |
| s21browser (both) | not shot before | 0 at every step |
| desk (both) | 0 | 0 |

Measured per shot in [`783-before.json`](783-before.json) and [`783-after.json`](783-after.json)
(`pageScroll`, `chrome`, `leaders` = the number of `[data-leader-label]` tags drawn). A constant
102/118 px of the "before" scroll was the turn wash running 14 % past the board; the rest was the
stacked boxes.

## Key frames

| step | before (360 × 800) | after (360 × 800) | after (360 × 650) |
|---|---|---|---|
| mulligan | [anime](s21-anime-mulligan-before.jpg) · [night](s21-night-mulligan-before.jpg) | [anime](s21-anime-mulligan-after.jpg) · [night](s21-night-mulligan-after.jpg) | [anime](s21browser-anime-mulligan-after.jpg) · [night](s21browser-night-mulligan-after.jpg) |
| main | [anime](s21-anime-main-before.jpg) · [night](s21-night-main-before.jpg) | [anime](s21-anime-main-after.jpg) · [night](s21-night-main-after.jpg) | [anime](s21browser-anime-main-after.jpg) · [night](s21browser-night-main-after.jpg) |
| combo | [anime](s21-anime-combo-before.jpg) · [night](s21-night-combo-before.jpg) | [anime](s21-anime-combo-after.jpg) · [night](s21-night-combo-after.jpg) | [anime](s21browser-anime-combo-after.jpg) · [night](s21browser-night-combo-after.jpg) |
| choice | [anime](s21-anime-choice-before.jpg) · [night](s21-night-choice-before.jpg) | [anime](s21-anime-choice-after.jpg) · [night](s21-night-choice-after.jpg) | [anime](s21browser-anime-choice-after.jpg) · [night](s21browser-night-choice-after.jpg) |
| end | [anime](s21-anime-end-before.jpg) · [night](s21-night-end-before.jpg) | [anime](s21-anime-end-after.jpg) · [night](s21-night-end-after.jpg) | [anime](s21browser-anime-end-after.jpg) · [night](s21browser-night-end-after.jpg) |

412 × 915 (`s21plus-*`) and 1440 × 900 (`desk-*`) have the same five steps, before and after, in both
skins. A "choice" is whichever the match met first: the search sheet, a payment or a block.

200 % text (360 × 800, anime): `s21-anime-*-text200.jpg` — no overlap; the page may scroll at 200 %,
as the issue allows.

## No-target notice

- In a real match: `*-notice-after.jpg` (e.g. [s21 anime](s21-anime-notice-after.jpg)) — the first
  notice each run met, acknowledged with OK by the driver.
- Scripted (`scripts/arena-no-target-783.mts`, dev server: the fixture preview is dev-only), 28 checks,
  both skins, two cases — the engine's `noEffect` ([anime](s21-anime-no-target-notice.jpg) ·
  [after OK](s21-anime-no-target-after-ok.jpg)) and a KO skill inside a battle followed straight by the
  clash ([anime](s21-anime-no-target-battle-notice.jpg) · [night](s21-night-no-target-battle-notice.jpg)):
  the notice names the card and the effect, OK has focus, a tap on the board lands on the scrim, no
  advance and no action is sent while it stands, Enter on OK acknowledges it and the held advance goes
  (advances 0 → 1), and a reload raises no notice for beats it did not watch.

## Offline shell

From `npm run arena:offline-shell-browser -- --shots` on the production build (the shell needs a
pinned revision, so a dev server cannot open its board): [board at 360](offline-board-360-after.jpg)
(no header, no tab bar; names legible now that the board wears the page's skin),
[board at 1440](offline-board-1440-after.jpg), [setup at 390](offline-ready-390-after.jpg) (the header
no longer sits over the title). The script now checks "the offline board shows no app header or tab bar".
