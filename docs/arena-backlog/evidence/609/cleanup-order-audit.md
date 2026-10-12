# #609 cleanup-order audit

Status: **audit only; no runtime behavior changed**. The repository manual determines the order and resolves the subject-information question for a Combo-to-Drop movement trigger. The missing generic card fixture is an evidence gap, not a rule ambiguity.

## Rule sequence

The checked-in Masters Rule Manual v4.00 (`docs/rules/rulemanual.txt`) states this sequence in §8-5:

| Order | Manual instruction | Consequence for the VM |
| --- | --- | --- |
| 8-5-1 | Checkpoint | Drain existing work before cleanup choices. |
| 8-5-2, 8-5-3 | Each player, turn player first, may place up to one Battle Card from their Combo Area into its owner's Z-Energy. | Finish both choices before the next checkpoint. A card chosen here is no longer in Combo for later cleanup. |
| 8-5-4 | Checkpoint | Added-to-Z-Energy Autos resolve before combo power expires. #551 implements this boundary. |
| 8-5-5 | Combo-derived power increases/decreases on the attack/guard cards dissipate. | Do this after the 8-5-4 checkpoint and before later cleanup processing. |
| 8-5-6 | Skills triggered “when a card in your Combo Area is placed in your Drop Area” enter pending. | Capture eligible movement-trigger Autos for the remaining Combo cards before moving them. |
| 8-5-7 | Checkpoint | Resolve that pending group, with ordinary checkpoint rule processing and turn-player/non-turn-player Auto order, before the moves in 8-5-8. |
| 8-5-8 | All Battle Cards in Combo Areas are placed in their owners' Drop Areas. | Perform the departures only after 8-5-7 has drained. Each actual move can also satisfy other movement triggers. |
| 8-5-9 | “At the end of a battle” skills enter pending. | Capture the battle-end group after the Combo departures. This includes the specifically described 8-5-10-1 case when its condition is met. |
| 8-5-10 | Checkpoint | Resolve the battle-end group and movement-trigger groups caused at 8-5-8. |
| 8-5-11..13 | End each side's “for the battle” effects, then end battle. | Preserve the manual's order after the checkpoint. |

The checkpoint is not a single Auto drain: §4-2-2-1 repeats required rule processing, §4-2-2-2/3 resolve one player's pending Auto at a time with rule processing repeated between, and §9-6-2-1-1 says simultaneous trigger fulfillment still makes an Auto pending once per fulfillment. A future cursor must therefore be advanced before making work pending or moving cards, so reload/resume cannot duplicate an occurrence.

The exact clauses that control the disputed boundary are:

> 8-5-6. Skills that trigger “when a card in your Combo Area is placed in your Drop Area” enter pending.
>
> 8-5-7. A checkpoint occurs.
>
> 8-5-8. All Battle Cards in Combo Areas are placed in their owners' Drop Areas.
>
> 8-5-9. Skills that trigger “at the end of a battle” enter pending.
>
> 8-5-10. A checkpoint occurs.
>
> 8-5-10-1. If any cards with skills that trigger at “the end of the battle after you combo with this card” are placed in the Drop Area from the Combo Area during 8-5-8, those skills enter pending in 8-5-9.

Section 9-6-9-1-3 resolves what the 8-5-6 Auto sees when it requests information about the moved card:

> If an [Auto] skill (other than those described in 9-6-9-1-2 above) triggered by the movement of a card from an open area to another open area requests information of the card, use the information of the card as it is in the new area.

For the ordinary case, a card moves from a player's Combo Area to that same player's Drop Area. Both areas are open (§3-7-2 and §3-4-3), and the move is not from a Battle Area/Unison Area. Section 9-6-9-1-2's inter-player movement exception must still be applied if a particular card is moved between players' areas; do not assume every Combo departure is same-player. In the ordinary same-player case, the new area is Drop, so an Auto asking for the moved card's information uses that movement-trigger information even though §8-5-7 resolves before the physical move in §8-5-8. No external ruling is needed for that case.

This is a rule for the information recorded/read for the movement trigger, not an instruction to move the card early or to pretend that it is physically in Drop during 8-5-7. Until 8-5-8, its live zone membership remains Combo. A selector, target check, cost, or other live effect condition must use the actual game state at its own evaluation time; the subject-information exception does not make the card available in Drop early. The actual move, when it occurs, applies §3-1-4's new-card/effect-reset rule unless an exception applies.

The separate source-validity rules read:

> 9-1-3-1. Unless otherwise specified, the skills (card text) of Leader Cards are only valid in the Leader Area, the skills of Battle Cards and Z-Extra Cards are only valid in the Battle Area, and the skills of Unison Cards are only valid in the Unison Area.
>
> 9-6-9-2. If an [Auto] skill with an area movement trigger is negated in its original area by another skill, the skill does not trigger even if the card moves to a different area.
>
> 9-6-3-2. If for some reason the chosen pending [Auto] skill cannot be activated, cancel 1 of the pending [Auto] skills (of that type).
>
> 9-6-11. If an [Auto] skill activates and its trigger condition is fulfilled but the card with that skill is no longer in the same area, or if the skill has been negated, the player must still resolve that [Auto] skill. However, if the effect of that [Auto] skill has become impossible to carry out due to the change of areas, the effect fails to resolve.

These clauses mean evaluate whether the Auto source can trigger, including negation, in its original area at fulfillment. A pending Auto that cannot be activated is canceled under §9-6-3-2; do not extend §9-6-11 to an Auto that has not activated. Once activated, later source movement/negation does not cancel its resolution. The card bearing the Auto and the card whose movement fulfills its trigger have different roles, but they are not necessarily different cards: text may specify an area that makes a self-movement trigger valid.

## Current implementation evidence

In `src/lib/arena/vm/battle.ts`, `BATTLE_STEP_WORK.battleEnd` asks the two #551 Z-Energy questions, then pauses for the 8-5-4 checkpoint. After that checkpoint it clears retained combo power and loops over all remaining Combo cards, calling `moved(..., "drop")`. It then fires the `stepStart(step: battleEnd)` moment and battle-end keyword hooks. The runner in `src/lib/arena/vm/flow.ts` drains the step's queued programs and performs one checkpoint after the work returns. Thus the current work batches the Drop moves, movement-trigger pends from those moves, and battle-end pends before that checkpoint. It does not represent 8-5-6/7 separately from 8-5-9/10.

`moved()` in `flow.ts` updates the zone and emits the move moment; `events.ts::emit` appends the public movement event and calls `pendAutos`. `src/lib/arena/rulesets/dbs/triggers.rules` currently declares `comboed ON moved(from: combo)` and `battleEnd ON stepStart(step: battleEnd)`. There is no trigger declaration for the generic 8-5-6 phrase. The `comboed` event is used for the distinct wording “at the end of the battle after you combo with this card.” The VM text matcher and `COMBOBACK` scenario in `scripts/verify/harness.ts` / `scripts/verify/battles.ts` verify that special 8-5-10-1 wording. They do not verify the generic 8-5-6 watcher or the checkpoint between it and the departure.

No real card text with the generic 8-5-6 wording is present in the repository's catalog/verification fixtures. The audit therefore does not invent a card name, text, or catalog source. `P-182` is a replacement effect from Combo to Warp, not an Auto, and the glossary already identifies Combo-origin replacement handling as unsupported; it is not evidence for 8-5-6.

## Trigger validity and information binding

At 8-5-6, identify a qualifying Auto before the corresponding cards leave Combo. Apply the manual's general Auto rules: §9-6-2 makes a fulfilled Auto pending; §9-6-9-2 says a movement-trigger Auto negated in its original area does not trigger even if its card moves; and §9-6-11 says an Auto whose trigger was fulfilled and which was activated must still resolve if its source later moves or is negated. Section 9-1-3-1 ordinarily makes Battle Card skills valid only in the Battle Area unless the text specifies otherwise. These rules constrain the *skill source* and must not be replaced with a check against the moved Combo card. Cards previously selected into Z-Energy at 8-5-2/3 are not among the remaining Combo cards at 8-5-6.

The Auto's source and its movement subject are separate identities: source-area validity/negation is checked under §9-1-3-1 and §9-6-9-2, while subject information requested by the skill is read as Drop-area information under §9-6-9-1-3 for an ordinary same-player departure; §9-6-9-1-2 governs the listed exceptions. The pending trigger should retain enough internal identity to bind the occurrence to the specific remaining Combo card; it should not infer the subject from whichever card later happens to match a live selector.

This is separate from “at the end of the battle after you combo with this card”: §8-5-10-1 explicitly makes that skill pending in the 8-5-9 group if the skill-bearing card moved from Combo to Drop during 8-5-8. Its existing `COMBOBACK` test is not a substitute for the missing 8-5-6 case.

## Bounded implementation shape

Use internal, serialized battle-cleanup progress after #551's existing choices/8-5-4 boundary: expire combo power at 8-5-5; capture 8-5-6 qualifying occurrences exactly once; run the normal 8-5-7 checkpoint to completion; perform 8-5-8 departures; capture 8-5-9 battle-end triggers and the 8-5-10-1 special case; run the normal 8-5-10 checkpoint; then continue 8-5-11..13. Preserve the existing checkpoint queue and prompt/reload behavior rather than resolving Auto programs inline. Prevent ordinary move-event matching from double-pending an occurrence already captured for 8-5-6. Keep occurrence identity and cursor in internal VM state; apply §9-6-9-1-3 to movement-trigger card information without changing live area membership before 8-5-8. No public Snapshot projection should expose hidden or implementation-only data.

Required later evidence includes (a) one pending occurrence for each qualifying Combo-to-Drop trigger fulfillment (including each occurrence if the departures are treated as simultaneous under §9-6-2-1-1); (b) no occurrence for a card chosen for Z-Energy; (c) a source negated in its original area does not pend; (d) a pending Auto that activates still resolves after source departure/negation when §9-6-11 requires it; (e) Drop-area information is used for the moved card when the Auto requests it; (f) source/player order and checkpoint interactions with zero-power and Heroic work; (g) a pausing prompt and JSON reload at both checkpoints; and (h) each Auto resolves once. The dedicated `COMBOBACK` assertion should continue proving the distinct 8-5-10-1 path.

This audit does not mark #609 complete and does not authorize runtime changes. No new test or production behavior was added.
