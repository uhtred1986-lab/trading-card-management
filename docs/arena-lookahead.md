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
| Line score (v4) | fitted win probability (v3 model), margin 3 points; a line that wins in every world is always taken | same |

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

## Strength: v2 passes the gate (Hard, 8 Nov 2026)

**Gate 2** (`sprt-gate-2`, fresh seeds, commit `d9d8b55`, clean tree) measured `lookahead-hard` v2
against the heuristic of the same commit:

- Verdict: **PASS: H1 accepted**, at least 30 Elo stronger at α = β = 0.05, decided at 120 games.
- Record 77–43, pentanomial 6 / 0 / 31 / 0 / 23.
- Elo **+101.2** (95 %: +42.8 to +165.8).
- Integrity: 0 integrity failures; 698 hidden-twin checks, every one on a genuinely different hidden state.
- Report: [gate2-lookahead-hard.json](arena-backlog/evidence/sprt/gate2-lookahead-hard.json).

v2 changes one thing from v1: a line's end is scored by a **win probability fitted from the
heuristic's own games** (`FITTED_VALUE`, `scripts/arena-lookahead-fit.mts`) instead of the hand-set
sum.

- The fit used 360 self-play games on development seeds and 10,442 turn-start views.
- Held-out log loss is 0.556, against 0.693 for a coin; it calls 67.6 % of winners.
- Its weights value Life steeply only near the end: per point, 0.23 at full health, plus 0.49 below 3,
  plus 0.70 for the last one. A card in hand is worth 0.27.
- The hand-set value had under-rated the end of the life race. The longer it looked, the less it
  attacked (with the reply horizon it went 4–16 in 20 development games).

Before the gate, v2 went 68–40 (+92) on the development block.

| Hard plays | gate 2 Elo (95 %) | gate 1, v1 |
|---|---|---|
| SD15 v SD15 | +23 (−99 to +152) | +25 |
| SD15 v SD5 | +23 (−99 to +152) | +33 |
| SD5 v SD15 | +120 (+33 to +226) | −42 |
| SD5 v SD5 | +280 (+159 to +521) | −60 |

Every matchup is positive. The SD5 decks gain most, which is where v1 lost; the SD15 cells are each
underpowered on their own.

**Gate 3** (`sprt-gate-3`, fresh seeds, the same commit `d9d8b55`) measured `lookahead-normal` v2,
which has no decklist knowledge, against the heuristic:

- Verdict: **PASS: H1 accepted**, decided at 90 games.
- Record 61–29, pentanomial 4 / 0 / 21 / 0 / 20.
- Elo **+129.2** (95 %: +59.3 to +210.8).
- Integrity: 0 integrity failures, 531 hidden-twin checks.
- Report: [gate3-lookahead-normal.json](arena-backlog/evidence/sprt/gate3-lookahead-normal.json).
- By matchup: SD15 v SD15 +0, SD15 v SD5 +32, SD5 v SD15 +170, SD5 v SD5 +528.

Knowing the decklist is not what makes the lookahead strong: Normal's interval overlaps Hard's.

During the run, this checkout was briefly fast-forwarded to `ecb74fa`. That commit changes only docs,
gate 2's report and the seed registry's record of gate 2, none of it code the run had loaded. The
checkout was put back on `d9d8b55` before the run ended, and the report shows a clean, unchanged
source (`changedDuringRun: false`).

**v3** (8 Nov 2026) also shortlists attacks the heuristic scores as losing. That lets the search find
a combo-made lethal (AI-01), and it changes what is played, so v3 gets its own gates (`sprt-gate-4` for
Hard, `sprt-gate-5` for Normal). The results above are v2's.

**Gate 4** (`sprt-gate-4`, commit `975c3fa`, clean and unchanged during the run) measured
`lookahead-hard` v3:

- Verdict: **PASS: H1 accepted**, decided at 92 games.
- Record 62–30, Elo **+126.1** (95 %: +57.8 to +205.4).
- Integrity: 0 integrity failures, 547 hidden-twin checks.
- Report: [gate4-lookahead-hard-v3.json](arena-backlog/evidence/sprt/gate4-lookahead-hard-v3.json).
- By matchup: SD15 v SD15 −58 (−138 to +15), SD15 v SD5 +279, SD5 v SD15 +64, SD5 v SD5 +320.

**Gate 5** (`sprt-gate-5`, the same commit, clean and unchanged) measured `lookahead-normal` v3:

- Verdict: **PASS: H1 accepted**, decided at 80 games.
- Record 56–24, Elo **+147.2** (95 %: +72.8 to +237.3).
- Integrity: 0 integrity failures, 457 hidden-twin checks.
- Report: [gate5-lookahead-normal-v3.json](arena-backlog/evidence/sprt/gate5-lookahead-normal-v3.json).
- By matchup: SD15 v SD15 +70, SD15 v SD5 +70, SD5 v SD15 +191, SD5 v SD5 +301.

**Both shipped difficulties (v3) pass the gate.**

**The SD15 mirror, fixed in v4 (9 Nov 2026).** In v3 the mirror was the one cell that was never
clearly positive: +23 in gate 2, 0 in gate 3, −58 in gate 4, +70 in gate 5.

On development mirror games the lookahead's switches leaned to ending the turn early: 14 of its
changes were to `endMain`, 8 of them replacing an attack, on gaps of a few points that two sampled
worlds cannot tell from noise.

Two fixes were tried on `sprt-dev`, mirror only:

- **A refit of the value with Leader, awakened, rested and Unison features, 600 games.** Its
  held-out log loss was better (0.518 against 0.556), yet it played the mirror worse:
  - with every feature, 2–18;
  - without the awakened feature, 7–13.

  The new weights are confounded: awakened scores −1.88, because Leaders awaken when already behind.
  A value that predicts outcomes well is not automatically one that ranks moves well. The shipped
  v3 value stays.
- **Raising the margin to 3 points.** This fixed it: H1 accepted in the mirror, 45–21, Elo +132
  (+63 to +214).

A win probability is squeezed near certainty. A proven lethal (100) then sat within 3 points of
ending the turn (97.9), and margin 3 alone lost AI-01 and AI-05. So v4 also takes **a line that wins
in every world whatever the margin**, and all ten strategy rows pass again. v4 on all four matchups
(development): H1, 45–23, +117.

**Gates 6 and 7** (fresh seeds, commit `86efc19`, clean and unchanged; run side by side with two
workers each):

| Gate | Candidate | Verdict | Games | Elo (95 %) | Integrity |
|---|---|---|---|---|---|
| `sprt-gate-6` | Hard v4 | **PASS** | 96 | +104.4 (+45.0 to +170.4) | 0 failures, 541 twin checks |
| `sprt-gate-7` | Normal v4 | **PASS** | 128 | +77.2 (+27.4 to +130.5) | 0 failures, 734 twin checks |

By matchup:

| Gate | SD15 v SD15 (mirror) | SD15 v SD5 | SD5 v SD15 | SD5 v SD5 |
|---|---|---|---|---|
| 6 (Hard) | +29 | +89 | +120 | +191 |
| 7 (Normal) | **+137 (+28 to +281)** | 0 | +112 | +66 |

Every cell is now zero or positive, and the mirror is clearly positive for Normal.

Reports: [gate6-lookahead-hard-v4.json](arena-backlog/evidence/sprt/gate6-lookahead-hard-v4.json),
[gate7-lookahead-normal-v4.json](arena-backlog/evidence/sprt/gate7-lookahead-normal-v4.json).

The next weak spot is SD15 v SD5 for Normal (0 in gate 7; development also 0).

**v5: the defensive search (9 Nov 2026).** In the other seat's turn the battle's windows (combo,
block, counter) were still the heuristic's alone. With `defense`, when the heuristic would spend a card
there, the lookahead plays that and declining through the rest of the turn and keeps the better. The
search only runs when a card would be spent.

v5 against v4 itself on development seeds: H1, 44–20, **+137 over v4** (+66 to +222), every matchup
positive ([dev-v5-vs-v4.json](arena-backlog/evidence/sprt/dev-v5-vs-v4.json); not a gate).

Gates against the heuristic (fresh seeds, commit `6ea401b`, clean and unchanged):

| Gate | Candidate | Verdict | Games | Elo (95 %) | Integrity |
|---|---|---|---|---|---|
| `sprt-gate-8` | Hard v5 | **PASS** | 88 | +114.5 (+49.9 to +188.0) | 0 failures, 511 twin checks |
| `sprt-gate-9` | Normal v5 | **PASS** | 58 | +167.6 (+86.4 to +271.1) | 0 failures, 333 twin checks |

By matchup:

| Gate | SD15 v SD15 | SD15 v SD5 | SD5 v SD15 | SD5 v SD5 |
|---|---|---|---|---|
| 8 (Hard) | +97 | +261 | 0 | +132 |
| 9 (Normal) | +255 | +50 | +226 | +159 |

Reports: [gate8-lookahead-hard-v5.json](arena-backlog/evidence/sprt/gate8-lookahead-hard-v5.json),
[gate9-lookahead-normal-v5.json](arena-backlog/evidence/sprt/gate9-lookahead-normal-v5.json).

Searched decisions take about 1.3–1.4 s at p50 and up to about 3 s on an idle 4-vCPU host (one game,
Hard).

A measuring note: three times this session, two runs printed identical running tallies at the same
pair count (gates 6/7 at 40 pairs; the v5 development run and an earlier mirror run at 20 and 30). The
reports were checked each time: different seeds, different per-pair sequences, and no game trace
shared. With most pairs split or won both, equal totals come up more often than intuition says.

**The other half of "smart enough"** (owner, 8 Nov 2026) is the 12 strategy benchmarks of
`arena-strategy-validation.md`, and they are **not yet all built**. Five tactical subcases run in
`arena-policy-strategy.mts`; the heuristic now passes AI-02 too, and fails AI-01 own-combo lethal and
AI-05 Critical-first. With the lookahead (v3), all five pass on both difficulties
(`arena-lookahead-strategy.mts`), and the search changes the heuristic's first move in exactly those
two cases. The remaining nine benchmark families (AI-03, AI-04, AI-06 to AI-12) are still to be
written. Most need printed cards and a reviewed set of acceptable answers.

## Earlier: first gate result (8 Nov 2026): no gain

A quick, non-gate paired run of the first version scored 22/48 against the heuristic. That version
used a short horizon that scored each option right after it resolved. It mostly swapped plays for
attacks, a measuring bias: a play's position and an attack's were compared at different points of the
turn. The defaults now score every option at the start of the other seat's turn.

**Gate 1** (`sprt-gate-1`, fresh seeds) measured `lookahead-hard` with that turn horizon against the
heuristic of the same commit (`b7cd1a6`, clean tree):

- Verdict: **H0 accepted: no 30-Elo improvement**, decided at 334 games.
- Record 162–172, pentanomial 32 / 0 / 108 / 0 / 27.
- Elo **−10.4** (95 %: −41.9 to +20.9).
- Integrity: 0 integrity failures; 1,966 hidden-twin checks, every one on a genuinely different hidden state.
- Report: [gate1-lookahead-hard.json](arena-backlog/evidence/sprt/gate1-lookahead-hard.json).

By matchup, the lookahead gained with SD15 and lost with SD5:

| Hard plays | Elo (95 %) |
|---|---|
| SD15 v SD15 | +24.9 (−33 to +84) |
| SD15 v SD5 | +33.2 (−31 to +100) |
| SD5 v SD15 | −41.6 (−111 to +24) |
| SD5 v SD5 | −59.9 (−121 to −2) |

Each cell is underpowered on its own. The pattern points at the evaluation misjudging what the SD5
deck plays for. So the Normal and Hard difficulties are **not yet stronger than the heuristic**: they
play differently, at about the same strength.

A diagnostic on 24 searched positions (8 worlds each, development seeds) explains much of the tie:

- In 14 of them every shortlisted option ends the turn at the same score: the turn horizon cannot tell
  them apart.
- Where the search does deviate, the estimated gains are small (mostly 1–3 points).
- Two worlds disagree with eight about 10 % of the time.

The next candidate scores lines after the other seat's whole reply turn (`horizon: "reply"`). It is
being measured on the development block before any gate.

Known limits:

- `EVAL_WEIGHTS` are hand-set and untuned. Tuning them (SPSA against the SPRT) is the next lever.
- Only Main-Phase choices are searched.
- The default horizon ends at the turn's end, so the other seat's next turn is judged only by the
  exposure term (`"reply"` plays it, at several times the cost).
- The rollouts are the heuristic's, so a line is only as good as its continuation.
