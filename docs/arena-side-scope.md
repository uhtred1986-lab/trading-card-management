# Whose cards is this phrase about? — the side test, and why it keeps being wrong

Written 9 Sep 2026, after the third bug caused by the same mechanism.

## The mechanism

`parseTarget` (`src/lib/arena/engine/compile.ts`) decides which player's cards a
phrase names by testing **the whole clause** for a possessive:

```ts
const owner = t.replace(…strip…).replace(…strip…);
if (/\bopponent'?s\b|\byour opponent\b|\btheir\b/.test(owner)) side = "opponent";
```

A clause routinely contains more than one possessive, belonging to different
parts of the sentence — a source, a destination, a measure, a name. The test
cannot tell them apart, so **any** possessive anywhere sets the side for the
selector, and the selector is usually about the *source*.

## Three bugs, one cause

Each was fixed by stripping the offending phrase before the test runs. Each
strip is correct; none of them addresses the mechanism.

1. **"in their character names"** — a name measure. Stripped (before this
   document).
2. **"their owner's Drop/Warp"** — the idiom for a card going back to whoever
   owns it, printed on **113 skills**, always in the destination half. Read as
   an ordinary "their" it made "play 4 ≪Saiyan≫ cards **from your Warp** into
   their owner's Drop" search the opponent's Warp. Five cards fixed.
3. **"to/into your opponent's Battle Area"** — cards that hand the opponent a
   card. "Play up to 1 \<Pan: SH\> **from your deck** to **your opponent's**
   Battle Area" searched the opponent's deck: the printed mechanic inverted.
   Seven cards fixed, and two more wordings had to be handled inside that one
   fix — the sets write "**in** your opponent's Battle Area" where they mean
   "into", which collides with the ordinary source phrase, and "greater than or
   equal **to your opponent's** energy", where the "to" belongs to a comparison.

The third fix needed two guards to avoid inverting cards it was not aimed at.
That is the signal: the patches are now interacting with each other's edge cases.

## What the structural fix is

Decide the side from **the phrase that names the area**, not from the clause.
`AREA_WORDS` already finds that phrase — the same match that sets `area` knows
where in the string it matched and what possessive precedes it. The side should
come from there, with the whole-clause scan kept only as the fallback for
phrases that name no area at all ("your opponent's Battle Cards" with no area
word, which 20-1-6 makes the table).

## Why it is its own lane and not a rider

- **The readings diff will be large.** Every selector in the catalog picks a
  side through this code. The three bugs above were found because a handful of
  cards changed; a structural change moves an unknown number, and each has to be
  signed off. Expect to need a property to check them by, not a list.
- **The failure mode is silent and symmetrical.** Getting it wrong sends
  searches to the wrong board in *either* direction, and a plausible-looking
  reading is exactly what this project has learned to distrust.
- **The fallback matters as much as the rule.** A phrase with no area word must
  keep today's behaviour, or every "choose 1 of your opponent's Battle Cards"
  breaks — and that is the commonest shape in the game.

## Where to start

`arena:readings` before and after, keyed by card, and a property that says what
a legitimate change looks like: *the side moved only where the possessive the
old test used belongs to a phrase other than the source*. Cards worth watching
because they are already known to sit near this seam: BT21-092 (whose side leak
survives inside the two-name "and" bug), EX25-35 (whose possessive is lost to a
clause split, not to this test), and DB1-059 and EX08-06, which read "an energy
cost greater than or equal to your opponent's energy" as an *area* today — a
comparison misread as a place to look, and a fourth instance of the same family
that no strip has yet touched.
