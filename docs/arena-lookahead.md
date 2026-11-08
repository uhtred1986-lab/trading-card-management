# The lookahead opponent: Normal and Hard

Owner's decisions of 8 November 2026 (chat):

- "Smart enough" means the opponent passes the 12 strategy benchmarks (`arena-strategy-validation.md`)
  **and** beats today's heuristic by a measured margin. The margin is measured by the SPRT in
  `arena-policy-sprt.md`, which replaces the decisive-pair Wilson gate.
- There are two difficulty settings, and they differ in whether the computer knows the human's decklist.
- Thinking for half a second or longer per decision is fine: "a real player would take some time".

Code: `src/lib/arena/lookahead/` (`determinize.ts`, `evaluate.ts`, `step.ts`). Proofs:
`scripts/verify/arena-lookahead.mts` and `scripts/verify/arena-local-lookahead.mts`, both in `npm test`.

## What it does

The heuristic (`policy/main.ts`, `combat.ts`, `choices.ts`, `shortcuts.ts`) scores each move on its own
with fixed numbers. The earlier search experiments (#663, #826) searched a hand-built copy of the
battle rules. That copy had no counters, triggers or future turns, and searching it made play worse.
The lookahead instead plays candidate moves forward in **the real rules engine**:

1. **Shortlist.** For a Main-Phase decision the shortlist is the heuristic's own choice, the next best
   options by the heuristic's scores (`mainRanking`, `candidates` in all), and ending the turn. There
   is no search when the heuristic already sees lethal or there is only one option.
2. **Worlds.** It builds `worlds` plausible worlds (`determinize.ts`). Every card the seat cannot see
   gets a sampled identity: the other hand, both decks, both Life areas and the other Z-Deck.
3. **Play.** In each world it plays every shortlisted option, then the rest of the turn with the
   heuristic for both seats, through the real engine. Blocks, [Counter]s, combos, triggered skills and
   Life-to-hand all happen as the rules say.
4. **Score.** It scores where each line ends from the seat's own observation (`evaluate.ts`) and takes
   the best average. It keeps the heuristic's choice unless another option is better by `margin`.

Every other window (the battle's blocker, counter and combo windows, card picks, payments, the
shortcuts) is the heuristic's answer, unchanged, including combat v4's combo-waste rule.

| | Normal | Hard |
|---|---|---|
| Knows the human's decklist (counts only) | no | yes |
| Unseen cards of the human | half a copy of a card the human has shown, half a card of its own deck as a stand-in | exactly the unseen remainder of the human's decklist, shuffled |
| Never knows | the hand, deck order, Life, the game's RNG | the same |
| Candidates / worlds / step budget | 3 (+ end turn) / 2 / 200 simulated decisions | same |
| Horizon | rest of the turn | same |

The journal records the difficulty in its policy version (`main2+combat4+choices2+look1-hard`).
`LOOKAHEAD_VERSION` must change with any change to the worlds, the search or `EVAL_WEIGHTS`, so a saved
match is only continued by the policy that recorded it.

## What a world may depend on

A world is a function of what the seat can see, its own decklist, the other decklist's counts (Hard
only) and the policy's own seed. Everything else is overwritten:

- each hidden card's identity, slot by slot;
- its per-turn history;
- its instance id, renamed canonically. An id is a decklist position, so it would name the card;
- a readable card's pointer at a hidden one (`enteredBy`);
- the game's RNG state and seed;
- the beat history, which is replaced by the seat's own masked one.

`arena-lookahead.mts` proves this on hidden-state twins: two matches the seat cannot tell apart give
byte-identical worlds and the same answer, for both difficulties. It also proves Normal's world is
unchanged when the other seat's unseen cards are different cards altogether, while Hard's is not.

## Time and determinism

The search is bounded by a deterministic count of simulated engine decisions (`maxSteps`), so Node and
a browser worker give the same answer. A host `stop()` (deadline or cancellation) and any world the
engine refuses fall back to the exact heuristic answer.

On a shared 4-vCPU cloud host, with other work running, a searched decision took 0.8–1.0 s at p50 and
about 2.3 s at most. Most decisions are not searched (other windows, one option, lethal). These
figures are not phone measurements.

What made this affordable: the policy board is now built with `previews: false`. The
attack/choice/block previews are for the human's screen, the observation never reads them, and they
were about two thirds of a policy step's cost. `arena-lookahead.mts` proves the observation identical
on 320 seat views. This also makes every ordinary local AI step faster.

The offline worker commits and shows each lookahead decision on its own, so the board shows the
computer's moves one at a time. A resume replays lookahead decisions from the journal without
searching again (`replayPolicy`). The search draws the same number of world seeds on every decision, so
the AI's memory depends only on the decision count, and the replay's trace still proves the game. A
48-decision resume took under a second.

## Strength: not yet claimed

A quick, non-gate paired run of the first version scored 22/48 against the heuristic. That version
used a short horizon that scored each option right after it resolved. It mostly swapped plays for
attacks, a measuring bias: a play's position and an attack's were compared at different points of the
turn. The defaults now score every option at the start of the other seat's turn.

The gate is the SPRT of `lookahead-normal` / `lookahead-hard` against the frozen heuristic. Its result
is recorded here when it has run, whatever it is.

Known limits:

- `EVAL_WEIGHTS` are hand-set and untuned. Tuning them (SPSA against the SPRT) is the next lever.
- Only Main-Phase choices are searched.
- The horizon ends at the turn's end, so the other seat's next turn is judged only by the exposure
  term.
- The rollouts are the heuristic's, so a line is only as good as its continuation.
