# Arena immersion: presentation contract and delivery

The current board remains authoritative. `ArenaStage` mounts one isolated `ArenaImmersion` observer of `useBeatPlayer.current`; both local and online sessions already use this board. No engine, transport, snapshot schema or playback duration changes are needed. Tutorial #839 / PR #861 owns its separate guidance layer; immersion uses z-index 42, below dialogs, and exposes a suppression input for overlays. The only shared edits are the import, Combat effects settings section and overlay mount in ArenaStage.

## Event contract

- `attack`: buildup and attacker pose. No damage implication.
- `block`: use `by` (actual blocker), not `guard` (original target).
- `clash.hit`: HIT on the guard; a failed clash says REPELLED, never HIT.
- `negated`: neutral NEGATED without inferring a character.
- Sound-only events: draw, move to battle, Charge Phase, decisive win/loss. Drawn/hidden card identities are never inspected for these sounds.

Event identity is match ID + numbered public beat. Existing bounded playback handles sequencing/reconnect and does not replay initial history. Audio consumes each current beat once, including when muted/obscured. Banners remain mounted while hidden so visibility/settings changes cannot restart the same effect. The event's captured public name must agree with the current visible card face; unknown, hidden, departed or changed identities use neutral artwork. Exact reviewed card ID + face + name mappings take priority; there is deliberately no substring-based character guess.

Animations observe existing playback; they never hold it or change rules. Attack normally lasts 460ms; reactions at most 1100ms, capped to the presentation duration. At step pace the effect still completes. “Skip effect” stops the optional visual/audio only; existing “Skip” playback controls retain their normal meaning. Mute, tab hiding, navigation and the end of a beat stop sound. Reduced motion uses existing no-motion playback (normally no queued banner), with a compact static rendering available when a host directly supplies a beat.

## Assets, budgets and follow-on tranches

Eight original AI-generated transparent sheets were prepared at the owner's request. Each has attack, guard and hit poses, with reviewed crop coordinates. `characters.json` records hashes, dimensions, provenance and exact reviewed card-art evidence. Unreviewed transformations and awakened faces remain neutral rather than borrowing the wrong costume/form. Leader and Battle sources use the same resolver; approved coverage is intentionally narrower than the full catalog.

Only the currently requested character sheet loads, not the whole catalog. Current PNG sheets are approximately 1.1–1.5 MiB each (about 10 MiB for all eight); budget is <=2 MiB per sheet, <=3 MiB for a two-character exchange. A cold/slow/failed sheet stays neutral until loaded. No external runtime audio downloads; synthesized sounds allocate at most 12 voices. GPU compositing and crop transforms animate existing images; no video codec, WebGL or new package is required. These are explicit bounded budgets, not a measured guarantee of FPS on the owner's phone.

`docs/arena-immersion-techniques.json` records exact catalog mentions of candidate special attacks and aliases. It does not enable signature attacks by character identity or pretend generic tones are authentic voices. Named signature audio/visual asset approval remains #856; missing signatures use generic effects. Tranche 2 (#850) remains a separate inventory-driven release, excluding AI-training/test decks.

## Validation and limits

Workers ran only focused checks. `scripts/verify/arena-immersion.mts` proves actual-blocker routing, resolved-hit vs repel, hidden/unknown fallback and cue semantics. Asset validation checks committed pack data; audio worker checked lazy unlock, bounded allocation, stop and mute with a mocked AudioContext. Independent review corrected Skip effect so narration continues.

Browser smoke in the actual 390×844 phone UI covered ATTACK/HIT/BLOCK/NEGATED, both skins, missing mapping fallback, character Goku attack/Frieza hit, dismiss, zero page overflow and no browser exceptions. Evidence is in `docs/arena-backlog/evidence/immersion/`. `/arena/preview?fixture=immersion&fx=immersion-hit&pace=slow&skin=anime` is a development-only presentation fixture; it borrows the synthetic attack layout and supplies two reviewed card identities. Its original synthetic rules/actions are not a playable real-card deck and are not used as rule evidence.

One final integrated typecheck/lint/test/build gate is recorded in the PR. No full-deck playthrough, fuzzing, live database test or separate engine campaign is added. Hardware audibility and real-device frame timing are not established by headless browser evidence.

Additional final smoke: 1440px desktop had no horizontal overflow; OS reduced motion produced no animated banner; user-gesture combat-sound opt-in and mute persisted successfully. This checks browser behavior, not physical speaker audibility.

## Final integration record

Combined PR #862. Final typecheck passed; full lint completed with five pre-existing warnings and no errors. The standard npm test chain passed through the tests before `arena-search-checkpoint`; its first checkpoint attempt was invalidated by changing scratch/source provenance. Scratch was excluded locally, the code committed, and only that check plus the remaining standard chain was rerun successfully. Production build passed. No second full suite was run. The reduced-motion audio observer received a final focused typecheck/lint and independent review: it baselines the first snapshot per match and coalesces only new arrivals, without replaying initial history.

Workers: GPT-6 Luna handled asset data/import tooling; GPT-6.1 Sol handled banner/audio implementation; separate Sol medium review inspected integration. Review found and corrected wrong-form candidate mappings, Skip effect clearing narration, and initial-history audio replay. Exact token/dollar telemetry was unavailable; no fabricated cost estimate is recorded.

Tutorial integration: PR #861 currently contains an earlier immersion snapshot. When reconciling after #862, retain the final `events={beats}` prop, local-only Skip effect callback, latest visibility lifecycle and reduced-motion audio observer. Keep its new `onTutorialState` callback/readiness effect. Do not reintroduce `onSkip={playback.skip}` from that older snapshot. The Tutorial host's readiness gate keeps coaching behind existing board interaction/animation.

Follow-ons: #856 retains named technique/voice approval; #850 now links 12 inventory-backed batches (#863–#874). The initial inventory found 25 eligible Masters decks and 314 distinct cards across 114 labels; no test flags or exact known-training-recipe names matched. This does not prove undocumented training decks are absent. Hardware FPS/audibility and remaining release evidence stay explicit in #858.
