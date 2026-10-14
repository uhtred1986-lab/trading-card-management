# Arena phone prototype (#788)

A clickable, phone-sized prototype of the Arena that tries out answers to the S21 playtest and the
TinyFish first-time-user run. **It is not the production Arena and changes nothing in `src/`.** It is the
"prototype" step of *current Arena → prototype → TinyFish run → iteration → approved behaviour →
implementation*.

**Open it:** `docs/arena-redesign/prototype-788/index.html` in any browser. It needs no build, no server
and no network: the app's CSS, both arena fonts and the card art are in this folder. On a wide screen it
sits in a 390 × 844 phone frame; on a phone it fills the screen. `#main`, `#combo` and the other scene
names below open a state directly (`index.html#combo`).

## How it stays faithful to the current Arena

- **The app's own CSS.** `app.css` is the compiled stylesheet of `/arena/local` (Tailwind utilities,
  `globals.css`, `phone-board.module.css`), captured from a real local match at 360 × 800 on `main` @
  `e73f7ec` (the #783 phone layout). The prototype's markup uses the app's classes (`arena-topbar`,
  `arena-turnpill`, `arena-pstrip`, `arena-row`, `arena-leader-tag`, `arena-card`, `arena-lanepill`,
  `arena-bar`, `arena-ring-*`, `arena-ec`, `arena-clash-*`, `arena-verdict-*`, `arena-dragghost` …).
  Both skins work: sky (anime) by default, night when the device is in dark mode or from ☰.
- **Everything new is `proto-*`** in `proto.css` and is built from the skin's own tokens.
- **Real cards and decks.** The two audited Masters decks of the offline pack (#655): SD15 *Pride of the
  Saiyans* (Leader Vegeta) against SD5 *The Crimson Saiyan* (Leader Golden Great Ape Son Goku). Art,
  costs, power, combo power and texts come from `docs/arena-backlog/evidence/649/catalog-subset-2026-10-13.json`.
  The decklists in the Deck sheet are the pack's.
- **The real rules where a decision depends on them.** Costs against ready energy; only the Leader or a
  rested Battle Card can be attacked (8-1-1); [Barrier] stops your skills choosing a card; [Blocker];
  [Double Strike]; one [Super Combo] per battle; the defence order **counter → block → combo**, as
  `vm/battle.ts` runs it; and **ties go to the attacker** (`attackPower >= guardPower`). The engine's own
  prompt words are kept where they still work ("Keep this hand?", "You may redraw six cards once (6-2-1-9)").

What is scripted rather than played: Claude's moves (draw, charge, play Intrepid Dynasty Son Gohan,
attack your Leader with SSB Son Goku, at the Apex), Claude's one combo when you attack its Leader,
and the cards you draw. The match starts on your 6th turn after the mulligan screen and ends when
your 8th turn begins. Nothing is saved; reload or ☰ → Restart.

## What changed, against what was found

| Finding (playtest / TinyFish) | Prototype answer |
|---|---|
| Who attacks whom is hard to see | A **marching arrow** from attacker to target over the board, **ATTACKER / TARGET** tags on both cards, and a clash card in the lane that names both cards, their **role** ("Claude's Battle Card", "Your Leader") and power, in board order (Claude's line on top), with the outcome (*Gets through* / *Tie → attacker wins* / *Attack fails*) and its effect ("you take 2 damage (Double Strike) · life 6 → 4"). The power counts the attacker's own "when it attacks" bonus before you commit. |
| Leader vs Battle Card unclear in combat/targeting | The Leader sits in its own bay behind a dashed rule; every targeting state labels each candidate on the card ("Leader · tap", "Rested · tap", "✕ Active", "[Barrier]"); the card sheet and the clash say "Leader" / "Battle Card" / "Extra Card" in words. |
| On-play ability with no valid target, found out too late | Before you commit: the hand card wears **⚠ No target**, its sheet says why ("you have no red Unison Card in play, so the skill will do nothing; you still get a 10,000 Battle Card") and the button reads **Play anyway**. A drag of such a card opens the sheet instead of playing. Cards that need a target list who can be chosen and who can't, and why. |
| Glowing card didn't say "drag me"; card play affordance | Every hand card carries a chip that says what it can do now: **▲ Play**, **▲ Play · 2 targets**, **⚠ No target**, **Need 4 ⚡**, **Counter**, **Charge**. Tapping any card opens its sheet with the action button; dragging up still works and the lane names the drop ("Drop to play · −4 ⚡"). Attack-ready cards wear a ⚔ badge. |
| Counter / Block jargon | The defence is one stepper, **Defend: ① Counter ② Block ③ Combo**, with one plain question per step ("Cancel the attack with a Counter card?", "Let a [Blocker] take the hit instead?", "Add combo power to Vegeta?"). Each option is a card-sized button that says what it does and what it costs ("Cancels the attack, your Leader +5,000 · Costs 1 ⚡ · 3 ready"; "4,000 vs 25,000: it is KO'd · you lose no life"). A step with nothing to offer is skipped and marked "none". |
| Energy / payment | Both strips show **⚡ ready/total** as a number beside the chips. The play sheet shows the payment: which chips it rests, "2 ⚡ of 6 ready → 4 left", and warns when it leaves nothing for a Counter in your hand. A Counter you can't afford says why ("0 ready (spent on your turn)"). |
| Hand cards too small, costs hard to see | Hand cards are 84 px wide (66 in a defence), the cost disc is 22 px and turns red when you can't afford it; the hand scrolls sideways. |
| Phase easy to overlook | The phase track is back on phones, one 30 px row, the current phase filled in the turn's colour; the dock's first line names the phase and whose turn it is; a banner marks each turn and phase change. |
| Skip inconsistent | **Pass** is always the last button in the dock, always the same shape: the word *Pass* and, under it, what passing means here ("don't counter", "Leader stays target", "take the hit", "KO nothing", "cancel the attack"). **End turn** has the same shape. Replays use a different word in a different place: **⏩ Fast-forward** in the lane. While Claude plays, the dock says so and shows no button. |
| Card and deck inspection not discoverable | Tap any card, yours or Claude's, on the board or in hand: a half-height sheet keeps the board in view, rings the card on the board, and pages through the zone (‹ ›, swipe). Tap a player's name, energy or counts for life, energy, deck, drop and the **decklist**. The eye button lists all cards in play. The setup screen offers both decklists before the match. |
| Kept from the original | Mulligan flow, card-play animation, phase transitions, verdict explanations (with the tie rule spelled out). |

## Scenes (☰ → *Prototype · jump to a state*, or `index.html#<name>`)

`setup` · `mulligan` · `charge` · `main` · `inspect` · `play` · `notarget` · `target` · `attack` ·
`attackConfirm` · `oppturn` · `counter` · `block` · `combo`. They map to the issue's numbered states
1–10 as the menu labels show.

## Brief for the next TinyFish run

Point TinyFish at `index.html` at a phone viewport (360 × 800 and 360 × 650), fresh, no scene anchor.
Suggested goals, one per run, each with "think aloud about what you expect before you tap":

1. Start the match and play your turn: charge a card, play at least one card, attack once, end the turn.
2. Play *Vegeta, Saiyan Youth*. Before confirming, say what its skill will do.
3. Use *Transcendent Strike* on the strongest card it is allowed to KO.
4. Attack Claude's Leader. Before confirming, say who attacks whom and what will happen on a tie.
5. On Claude's turn, defend your Leader so that you lose no life. Say what Counter, Block and Combo mean.
6. Find out how many cards are in Claude's deck and what is in your own decklist.

Measure per goal: taps to complete, wrong taps, and the success-criteria questions of #788 answered
correctly from the screen alone.

## Evidence

`shots/` holds the states at 360 × 800 (both skins), 360 × 650 (a phone browser with its bars) and a
desktop frame, from a scripted run through the whole match in headless Chrome. No page scrolls at either
phone size.

## Known limits

- Scripted: Claude always does the same thing; your choices change the board, the numbers and the
  outcome, not Claude's plan.
- The card art is the catalog's 260 px scans, so printed text is not readable on the art; the sheet
  shows the text instead (as the app's review does).
- On a 360 × 650 screen during a defence, Claude's strip and the phase row step aside to make room
  for the clash; the clash says whose life changes.
- No sound, no admin drawer, no AI timing, no `Unison` cards in play.

## Regenerating `app.css`

Run a local match with `scripts/arena-phone-board-783.mts` against `next dev` (no database is needed,
see its header) and, at the `main` step, save
`[...document.styleSheets].flatMap((s) => [...s.cssRules].map((r) => r.cssText)).join("\n")`.
Drop the `@font-face` rules and the dev overlay's `nextjs` rules, and keep the header comment.
