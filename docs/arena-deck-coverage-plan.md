# Deck and opponent coverage programme

Owner direction, 15 October 2026: cover abilities with real decks, aim for at least
two representative decks per card release, and use selected games against Claude
Opus to find local-opponent mistakes and engine or UI problems.

The proposed release/Leader/mechanic table is in [arena-proposed-decks.md](arena-proposed-decks.md).
Implementation and coverage tracking: [#827](https://github.com/uhtred1986-lab/trading-card-management/issues/827).

## Evidence layers

1. **Mechanic scenarios.** A deterministic small board forces each ability family,
   price, timing window and meaningful interaction to execute. Check observable
   effects against printed text, the official rule manual and Q&A. Include decline,
   inability to pay, replacements, save/reload and both players' hidden views.
2. **Release deck pairs.** Record at least two legal themed Masters lists per release,
   with descriptive names, exact card/face quantities and a pinned catalog/rule revision.
   Prefer the release's distinct mechanics and leaders. A release without two sensible
   legal archetypes needs an explicit exception or a documented mixed-release support pool;
   do not manufacture legality or claim every printing introduces a new mechanic.
3. **Cross-deck games.** Run the local opponent from both seats with paired seeds,
   within each pair and against an older baseline and a different mechanic family.
   Track wins, completed games, illegal actions, typed interruptions, actual skills
   fired, costs paid/declined, replacements, choices and unseen interactions. Merely
   containing a card does not cover its skill. Preserve failed-game replay artifacts.
4. **Bounded Opus comparisons.** Give Opus the same restricted observation and legal
   decision menu as the local opponent. Treat it as a strong comparison candidate,
   not a rules oracle. Log model/version, prompt, seed, public observation, chosen
   menu ID, validation result, timing and spend. Reserve a total call/token/cost cap
   and explicit stop conditions before any paid run. Provider errors are failed runs,
   not wins or draws. The owner has proposed this phase; no paid calls have run here.
5. **Review and improve.** Classify every finding as an engine/reading/data fault,
   policy weakness, or UI problem. Reproduce engine faults as deterministic scenarios;
   add policy holdouts with fresh seed ranges. Logs can identify confusing choices,
   but validate UI findings with real browser interactions and layouts before changing
   controls. Reviewers must never infer hidden-card knowledge from Opus explanations.

## Order and scope

Start with the owner's current decks and the named blockers discovered in PR #824,
then expand release by release. Preserve the existing built-in starters and frozen
heuristic as baselines. The first search experiment failed its promotion threshold;
its next candidate needs Life-to-hand replenishment and own-combo resource modelling
before deeper search. Use the measured gate in `arena-policy-strength.md` with a new
untouched seed range, and ship a persisted difficulty only after it passes.

A coverage manifest should map **release → deck pair → printed card/face/skill →
mechanic scenario → actual fired-game evidence**. Track missing text, missing records,
unsupported operations, missing specified costs and stale rules separately. The gate
must refuse unsupported decks and show named blockers; “zero crashes” never means
“every rule was correct.” Unison/Z-Unison cost orbs come from inspected card prints,
not color guesses or Z-Energy icons.

## Tool reuse

Use the existing `arena:scenario`, `arena:fuzz --snapshot-out/--snapshot/--report`,
`arena:replay --summary --output`, policy duel/evaluation and browser-worker tools.
Keep complete private deck snapshots/replays as local admin artifacts; commit only
reviewable public card evidence and aggregate metrics. A custom MCP server is not
needed for these workflows; #665's measured evaluation is in `arena-agent-tools-evaluation.md`.

Deck names should remain user-editable and appear in the game picker. Check existing
creation/edit routes before adding another naming system. A consistent optional naming
convention is `Release — Leader / strategy`; user-chosen names remain authoritative.

## Proposed first budget and run limits

The owner reports $200 of Anthropic API credit. This is a proposed allocation, not
a claim about verified account balance or authorization to spend it immediately.

| Stage | Limit | Purpose |
|---|---:|---|
| Opus pilot | 8 games or $20, whichever comes first | Four paired matchups with seats swapped; measure cost, decisions and useful findings. |
| First Opus campaign, including pilot | 40 games or $100 total, whichever comes first | Broaden the mechanic mix only after pilot traces are valid and useful. |
| Reserved regression budget | $50 | Replay selected matchups with fresh seeds after policy/engine fixes. |
| Reserved future coverage | $50 | Later releases, difficult interactions and unexpected investigation. |

Additional proposed bounds: $3 per game, 120 paid decisions per game, 512 output
tokens per decision for the action and short explanation, and at most one repair
attempt for an invalid response (charged to the same limits). Reasoning, cache,
retry and failed-call charges must be included in the ledger. Pin the actual Opus
model ID and confirm its current input/output/cache/reasoning pricing before the
pilot. Reserve the next request's worst-case charge before dispatch, including
in-flight calls; do not treat provider spend alerts as a strict per-run cap. A
limit-ended game is recorded as budget/decision-limited, never a win or draw.
If the pilot cannot finish games within these limits, revise the context and
limits from measured evidence before extending the campaign. No game-count or
cost-per-game estimate here is a promise.

Send only the acting player's permitted observation, relevant card text and legal
action IDs. Execute forced moves without a paid decision. Cache stable rules and
card descriptions when supported, trim redundant history, and keep the local
opponent frozen during each comparison. These changes reduce cost without letting
the external opponent inspect hidden hands, Life or deck order. API calls also
send this restricted game context to Anthropic.

Before Opus, run the first eight release pairs locally for ten paired seeds each
(160 games, both seats), plus deterministic card scenarios. Local runs consume no
Anthropic credits. The campaign is diagnostic; forty heterogeneous games do not
establish a statistically reliable overall strength ranking. Promotion of an AI
change still requires the frozen-policy, fresh-holdout protocol.

## How API cost will be validated

No paid comparison has run: observed campaign spend is **$0** and cost per game is
**not measured**. The existing Anthropic adapter records input, output, cache-read
and cache-creation token counters from each response. `src/lib/ai/models.ts` has a
static price table documented as checked on 4 September 2026; that table is an
estimate source, not proof of current billing or available credits. Attempts to
retrieve the public pricing page from this environment were blocked.

Before the pilot, verify the exact accessible Opus model and current rates against
Anthropic's official pricing/account information, including the chosen cache TTL
and any reasoning/long-context/service-tier terms. Refuse an unknown model/rate;
do not silently fall back to another model's price. Persist that dated rate sheet
with the run. Calculate each call as the sum of its independently priced input,
output, cache-read and cache-write tokens, divided by one million. Reasoning
counts according to the provider's billed usage; do not add it twice if already
in the output counter.

For illustration only, the repository currently records $5 input, $25 output,
$0.50 cache-read and $6.25 cache-write per million tokens for its Opus entry. At
those unverified-current rates, 6,000 fresh input + 400 output tokens cost $0.04;
50 such decisions cost $2. A call with 1,000 fresh input + 5,000 cache-read + 400
output costs $0.0175; 50 cost $0.875, **plus cache creation and any retries**.
These examples explain the arithmetic; they do not predict game length or the
actual rate charged.

The new campaign runner must record request ID, exact model, seed/game/decision,
usage counters, calculated charge, latency and retry/outcome. Reserve the maximum
next-call cost before dispatch. Disable hidden SDK retries or reserve and record
each retry; count repairs and malformed responses even when no move was applied.
Keep an unknown-outcome request's reservation until reconciled, rather than
assuming a timeout was free. At pilot completion compare the ledger to the
Anthropic usage/cost report where account access permits; otherwise label it
usage-priced rather than invoice-verified and ask the owner to compare the report.
Record provider credits and any unrelated account usage separately from this run.

The cost report should show games attempted/completed, paid decisions, total
spend, median/p95 cost per completed game, capped/failed games and cost per useful
reproduced finding. Adjust the proposed $3/game cap only from those measurements.
The existing token ledger is reusable; a strict campaign budget reservation system
and Opus-versus-local evaluation adapter still need implementation in #827.

## Small scenario build list

These are reusable families, not a claim that one example validates every printed
ability. Give each relevant card/face/skill its own manifest entry and scenario
variants; reuse existing suites wherever possible. Start with four variants per
family (roughly 96 cases): legal success, condition/payment failure, nearest
boundary or invalid choice, and an interaction. Apply JSON reload and both-player
visibility checks to every suspended choice. Some families will require more cases.

| # | Small scenario | What must be asserted |
|---:|---|---|
| 1 | Awaken and alternate Awaken | Exact Life/board threshold; correct face, draws and energy switches; wrong threshold refuses. |
| 2 | Energy and specified costs | Correct colored orbs, generic energy and alternative payments; no partial spending on failure. |
| 3 | Optional exact-count selection | BT3-109 five Warp cards, BT6-062/SD8-03 two hand cards; all required cards or decline, never partial payment. |
| 4 | Bond | XD1-05 with one/two matching Universe 6 Battle Cards; Extras do not count; condition rechecked and real energy price retained. |
| 5 | Native multiple attacks and Revenge | BT27-093 Triple Attack gives exactly three attacks; BT7-081 Revenge KOs at the correct battle timing. |
| 6 | Strike, Critical and Blocker | Correct Life damage destinations/count; legal blocker timing; attacking player's resource gain differs after ordinary damage. |
| 7 | Counter windows and chains | Counter: Attack/Play/Counter eligibility, paid costs, decline and nested resolution order. |
| 8 | Barrier, Deflect and protection | Target selection versus non-targeting effects; protected and unprotected windows distinguished. |
| 9 | Auto timing and once-per-turn | Play/arrival/attack/KO timing; simultaneous ordering; limits shared or per-copy as printed. |
| 10 | Hidden-area Autos | Reveal only when required; decline safely; no opponent-visible hidden choices or metadata. |
| 11 | Condition versus price | SD13-05 stored condition metadata; true/false condition, actual price, preserved owner-authored effect. |
| 12 | Evolve and EX-Evolve | Correct base, cost, stacked cards and evolved-into triggers; ordinary play is not Evolve. |
| 13 | Combo-end Great Ape evolution | BT3-098/BT3-096 from hand and Battle combos; own turn, actual Drop cleanup, then Evolve and payoff. |
| 14 | Union-Fusion and Union-Potara | Exact material names/power/areas; material destination, legal play and generated movement triggers. |
| 15 | Over Realm and Warp movement | Threshold, payment, turn restriction and cleanup; BT3-112 self trigger from Battle/deck to Warp. |
| 16 | Union-Absorb and under-card stacks | Correct targets, stack order, inherited information and removal cleanup. |
| 17 | Swap and Revive | Correct returned/played cards, replacement windows and cost order; failed payment gives no play. |
| 18 | Wish/Desire and World Peace | Dragon Ball condition; World Peace energy cost at most three, independent of current energy count. |
| 19 | Unison and Spirit Boost | Specified cost, starting/changed markers, activation payment, battle damage and zero-marker removal. |
| 20 | Z-Energy, Z-Awaken and Z-Stack | Eligible combo cleanup to Z-Energy; exact Z payment, source/stack and zone transitions. |
| 21 | Aegis and multicolor payments | Correct colors and alternate payment; costs before benefits; limited activations and failure rollback. |
| 22 | Replacements and original movement information | Cooler BT29-029 original Battle holder/color/trait; BT29-040 diverted hand return must not announce an actual hand return. |
| 23 | Granted skills, negation and duration | Heroic/Villainous, gained skills and temporary traits; correct controller, expiry and interaction order. |
| 24 | AI decisions and UI/replay parity | Known lethal, avoidable loss, Life-to-hand resources, legal choices; same visible information, deterministic replay, clear browser prompts. |

Prioritize rows 3–5, 11, 13, 15 and 22 because they address observed blockers or
recent fixes. The remaining families expand the deck corpus without recreating
existing tests. Full games supply interaction evidence; deterministic scenarios
force the important abilities that random games miss. Browser checks separately
validate clarity of costs, target selection, cancel/confirm and deck-name selection.
