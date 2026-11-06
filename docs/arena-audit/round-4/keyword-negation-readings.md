# Chosen keyword negation: reading diff

Main `1d3962e4` to implementation `cdf3dd6a`, using the frozen public catalog described in [the receipt](keyword-negation-followup.md).

## changed (2)

- **BT2-048#0**
  PRINTED: [Counter: Battle Card Attack] Play this card. Then, choose 1 keyword skill of the attacking card and negate it for the duration of the turn.
  BEFORE:  choose this card, play the chosen cards, choose up to 1 keyword skill of the attacking card and negate it for the turn
  AFTER:   choose this card, play the chosen cards, choose 1 keyword skill of the attacking card and negate it for the turn
- **DB1-093#20**
  PRINTED: [auto] When you play this card, choose one- ・Your opponent chooses 1 card in their hand and places it in their Drop Area. ・Choose a keyword skill on one of your opponent's Battle Cards in Rest Mode and negate it for the duration of the turn.
  BEFORE:  choose one — opponent discards 1 / choose up to 1 keyword skill of all Battle Cards in your opponent's Battle Area in rest mode and negate it for the turn  [trigger: played]
  AFTER:   choose one — opponent discards 1 / choose 1 keyword skill of all Battle Cards in your opponent's Battle Area in rest mode and negate it for the turn  [trigger: played]
