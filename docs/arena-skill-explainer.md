# The skill explainer

At a real table your opponent says what they do: "I swap Gohan for Goku." The arena does the same. Every skill —
the opponent's and yours — is told on the board in three parts: **the callout** (who uses what), **the steps**
(each thing it does, one at a time, while the board plays it) and **the receipt** (what changed). It is the
**Explain** pace, the default since the owner's decisions of 13 Nov 2026.

The design was reviewed as an artifact on 13 Nov 2026 ("Skill Explainer — design draft for review"); the owner
accepted all five recommendations:

| # | Decision | Accepted |
|---|---|---|
| 1 | Explain is the default pace | Yes. Slow, Normal and Step stay in the settings. |
| 2 | Yours too, or only the opponent's | Both. Yours get a shorter callout (1.6 s), since you chose the move. |
| 3 | Opponent's steps play on their own, or wait for a tap | On their own; a tap goes to the next step, a press held pauses. |
| 4 | Callout over the top of the board for ~2.6 s, or a slim banner | The callout. |
| 5 | The timing fix ships with it | Yes: a card leaving play or changing hands is a key moment at every pace, and the skill banner is no longer cut off at 1.1 s. |

## What the player sees

- **Callout** — the card lifts, the speech bubble comes from its owner's side ("I use 《Swap 2》" from the opponent,
  "You use 《Swap 2》" for yours), the printed text follows with its trigger words highlighted ("When this card
  attacks,"), and a keyword skill shows its one-line meaning from the glossary (`keyword-rules.generated.ts`:
  Evolve, Swap, Union, Awaken, Over Realm, Dual Attack…). A skill that finds nothing to act on says so.
- **Steps** — a line on the side away from the skill's owner (the bottom for the opponent's, the top for yours):
  "SWAP 2 · STEP 1 OF 2 — Adoptive Father Son Gohan returns to Claude's hand", with a dot per step. Each step is
  held at least 1.6 s, while the board plays it (the card flies, the count ticks, the power changes).
- **Receipt** — after the last step: "Swap 2 done: Adoptive Father Son Gohan in hand, Dependable Dynasty Son Goku
  in play". A skill type's own label is not repeated ("Done: 1 card drawn").

A tap moves on, a press held pauses (the step stays on screen), Skip ends the whole story. None of it changes the
game: the board underneath is already in its final state.

## Timing

| Moment | Explain | Notes |
|---|---|---|
| Opponent's callout | 2.6 s | `EXPLAIN.callout` |
| Your callout | 1.6 s | `EXPLAIN.calloutYours` |
| A step | at least 1.6 s (a shuffle 1.2 s) | the step's own dwell if longer (a KO is 2.2 s) |
| Receipt | 1.8 s | added to the moment's last beat |
| Anything else | Slow's rhythm (×1.3) | Explain is Slow outside a skill |

A Swap takes about 8 s, an attack with a draw about 6 s. In **every** pace, a card out of the Battle, Unison or
Leader Area (bar a KO's own trip to the Drop), into one of them from anywhere, or into a hand from anywhere but the
deck and the life, is a key moment (1.2 s) rather than bookkeeping (0.4 s): `changesPlay` in `stage/motion.ts`.

## How it is built

1. **The engine reports what it did not before** (`vm/`, glossary entry "Looks, searches, shuffles…"):
   - `look` — who looked at whose cards, which area, how many, which end of a deck; a deck search logs one with
     `search`. No card is named (20-11).
   - `shuffle` — beside the existing log note, for the `shuffle` op and 20-12-3's shuffle as a search ends.
   - `resume` — a card's skill that stopped for a decision goes on with the answer (`vm/flow.ts`). The answer is
     an action of its own, in a batch of its own, so without this the opponent's "search, take, shuffle" lost the
     second half of its story.
   - `stack.placed`/`from` — which card went under which: an [Evolve] becomes `move.onto` ("plays The Ultimate
     Evil, Majin Buu on top of Majin Buu"), a card a skill places under another becomes an `under` beat.
2. **Beats** (`vm/beats.ts`, contract §4): `look`, `shuffle`, `resume`, `under`, `move.onto`, and `skill.steps` /
   `resume.steps` — how many beats right after it, in its batch, are what it did. `relateBeats` counts them,
   because only a batch knows where one action's story ends.
3. **Grouping** (`src/lib/arena/explain.ts`, pure): a moment is a `skill` (or `resume`) beat and its steps. A beat
   that trails another joins its step (the draw marker after its card flew, a KO's trip to the Drop); life cards
   leaving before damage lead into it; a run of the same thing (two draws, three cards milled, two energy rested,
   two cards under one host) is one step, held on its last beat. `explainRoles` gives the beat player each beat's
   role; `explainMoment` gives the presenter its words (`narrate`/`narrateRun`).
4. **Timing** (`stage/motion.ts`): `msFor(beat, pace, chain, next, { prev, role })` applies the Explain numbers
   when the pace is Explain and the beat has a role. `useBeatPlayer` holds every dwell in a timer that a tap cuts
   short (`next`, now at every pace), a pause freezes and a resume restarts with what was left.
5. **Presenter** (`stage/SkillExplainer.tsx`): the callout, the step line and the receipt. While it tells a beat,
   the skill card (`SkillSpotlight`) and the skill banner stand down.

## What stays hidden

The explainer never shows more than the board may. The beats are masked per viewer before it reads them
(`maskBeats`, `concealBeats`): a masked skill is "I use a skill", a card the opponent takes from their deck is "a
card", and a card that went under from a hand you cannot see is "a card". A search does not reveal the card taken
(20-12); a Swap's reveal (22-22-3) is the play that follows it.

## Seeing it

`/arena/preview?fixture=explain&pace=explain&replay=1` (dev only) replays Claude playing a card whose [Auto]
searches the deck, from your chair: the callout, "Claude searches their deck", then — after the search's answer —
"Claude adds a card from the deck to hand" and "Claude shuffles their deck". The fixture is written by
`scripts/verify/contract.ts`; `scripts/verify/skill-explainer.ts` pins the grouping, the words and the timing.

## Known limits

- Step numbers restart after a decision: the part after the answer is told as its own run of steps ("step 1 of 2")
  under the same skill name, because the total is not known until the answer is given.
- Your own looks do not show the faces in the explainer; the choice dialog that follows does.
- A skill that fires inside a staged battle is also said on the card that fired it (battle staging §3.2).
