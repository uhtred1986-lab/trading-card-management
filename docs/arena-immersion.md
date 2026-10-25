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

## Player journey (#880)

The deck picker leads with the selected leader and searchable deck tiles. Its Play action opens the existing setup; validation, turn order and opening-hand choices are unchanged. Installed local decks use device artwork in setup as well as in the match.

On the board, tapping a ready card selects its legal targets; tapping a target declares the attack. Inspect/hold still opens the complete card rules and other skills. This removes the phone review/confirm detour, not counter, blocker, combo or payment windows. Main phase has a standalone End turn button and a `?` guidance sheet. Waiting/error and actual decision controls remain visible. Exit uses the local host's save/leave path where applicable.

Combat banners distinguish declaration, actual blocker, resolved clash, negate, damage and KO. A hit does not imply a KO. Skill presentation uses named skill beats for Swap/Union/Evolve/flip motifs, and move beats for actual Battle/Drop/Warp source and destination receipts. Public card faces are displayed only when the masked view/capture agrees; concealed cards use neutral art. These are individual event presentations, not a reconstruction of unreported material stacks. The printed rules and existing skill text remain available. Routine draws and charges do not create extra banners.

Focused verification: changed-file lint, TypeScript, skill/immersion adapters, phone gesture checks in both skins, deck-selection submission and phone/desktop layout smoke. No full engine/deck suite is needed for this presentation-only change.

## Card handling (#882)

Inspection now opens an enlarged card reader with a persistent card strip. Flick horizontally, tap a thumbnail or use the arrows to browse the same visible hand/board group. Short deliberate flicks are accepted; vertical ability scrolling and native thumbnail-strip scrolling do not navigate. Reading, expanding and swiping never submit a game action. Target inspection retains the compact review so the target remains in context.

Readable boxes come from visible ability rows (or printed text when rows are absent), with the snapshot's availability. The reviewed bundled classic tutorial layouts anchor the boxes at the printed rules block. This is a block-level reading overlay, not detected per-line OCR coordinates. Unknown layouts use a tray below the image; copied abilities stay in their own tray instead of pretending to be printed. Artwork-only mode and the full details/actions panel remain available. Full-size original URLs are requested where the catalog offers them; adjacent visible cards are prefetched, never concealed faces. Dense boxes scroll and expand, and missing images retain the readable text tray.

Video basis: the attack box over Charmander's printed attack at approximately 02:04 and the card inspection/browsing throughout the supplied TCG recording. No engine changes or full deck/engine test run.

### Touch-held hand preview (#884)

The 1:30–1:42 reference lifts a card above the board while the original hand remains reachable. On phones, touching a hand card now opens that floating preview immediately; sliding across exposed cards changes it during the same pointer gesture. Holding at the hand's edge scrolls overflow cards into reach. Releasing keeps the preview readable; cancellation dismisses it. The artwork can be gently dragged/tilted and settles on release. Details & actions opens the existing inspector and its payment evidence. Desktop, targeting and combo choices retain their existing controls.

Ability boxes now use conservative reading shorthand over reviewed rules areas (including the Leader-only attack condition and once-per-turn qualifiers). Full printed text remains on expansion. Unknown layouts retain their below-card tray. Only the artwork owns free dragging; ability text retains native vertical touch scrolling. Browsing never submits a game action.

Focused proof: `scripts/arena-hand-scrub.mts` exercises continuous real touch selection before release, no submitted actions, free movement, text expansion and pointer cancellation in both themes. Existing phone attack/response checks remain applicable; no full engine/deck suite is required for these presentation changes.

### Wide rule bars and individual info controls (#886)

The lifted hand preview uses level, wide ability bars across the rules area, with a slight tilt on the artwork only. Each bar has its own 44px info button that expands the exact printed ability in a scrollable region; tapping the summary itself never activates or expands it. Available abilities retain an availability glow, while passive rules remain neutral. The large details header is replaced by a compact ellipsis control for the existing details/action/payment view. Continuous hand scrubbing and unknown-layout trays are preserved.

### Tablet and desktop card-first layout (#888)

The desktop inspector starts at 1280px. Tablets from 768–1279px keep the single touch board, with larger cards in portrait and tighter spacing in landscape. Dense decision docks scroll within 42dvh. Touch-held hand previews work even on wider tablet screens, while desktop mouse hover/focus reviews cards, clicking pins the card, and Left/Right moves through the hand. Existing mouse dragging and explicit action/payment controls remain.

Desktop inspection uses the same large CardReader, wide ability bars and individual full-text info controls as phones. Other card details are disclosed on demand; unused slot outlines are hidden, and hand labels have dedicated bottom space. Ability bar width is bounded by the reader container so it cannot overflow the side panel.

Focused checks: 768×1024/1024×768 tablet layout and 1440×900 desktop layout, full-text expansion without actions, desktop keyboard hand inspection, continuous touch across phone/tablet/1366px-wide touch screens, and tablet counter/combo dock scrolling. No engine/deck suite.

## Character-action sequence and cue contract (#1103, #1104)

`actionSequence(gameId, beat, { cardOf, art, viewer, durationMs, techniqueOf? })` in `src/lib/arena/immersion/events.ts` describes one public numbered beat as one sequence (types in `types.ts`): its consumed event key (match id + beat), staging (`combat` for the single leader/Battle Card route, `motion` for real source/destination moves and skill receipts, `sound` for draw/turn/match end), the subject's role, the exact public face (card id + face + name) and reviewed character, a neutral reason when there is none (`no-subject`, `hidden`, `unknown-card`, `face-changed`, `unmapped`), an approved technique override (only from a resolver, only for a visible mapped face), and contract cues with start/stop markers.

Cues (`ACTION_CUE_IDS`): an attack sounds only `attack.buildup` then `attack.release`; `reaction.block` follows the actual blocker; `impact.hit` and `reaction.repel` need the clash; `reaction.negate`, `damage` and `ko` come only from their own beats. Markers are milliseconds from the start of the beat's presentation (`CUE_WINDOW_MS`), compressed to fit a shorter beat and never stretched, so a clip cannot extend a turn. Dodge, zone moves, energy charge/payment and match start are deliberately unsupported (owner default, 25 Oct 2026). `soundCue` now reads the contract and plays the same synth tones as before; banners and `audio.ts` are unchanged until #1105/#1109 consume the sequence. Fixtures: `action-fixtures.ts`.

The sound catalog is `src/lib/arena/immersion/sound-catalog.json` (validator and type in `sound-catalog.ts`), readable in `docs/arena-sound-prompts.md`. `scripts/verify/arena-immersion.mts` (in the `npm test` chain) checks the fixtures, the catalog shape, that every supported cue maps to a contract cue, and that the doc carries every exact prompt.

## One character banner route (#1105)

`bannerPlan(sequence, beat)` (`src/lib/arena/immersion/banner.ts`) turns the contract sequence into the
one combat banner `CombatBanner` stages for leader and Battle Cards alike; `ArenaImmersion` is the only
caller and `ArenaStage` mounts it once for phone, tablet and desktop, so there is no second staging
route. The kind comes from the beat's own first cue (`attack.buildup` → attack, `reaction.block`,
`impact.hit`, `reaction.repel`, `reaction.negate`, `damage`, `ko`), never from an earlier beat. The
attacker winds up until the `attack.buildup` stop marker and releases, with its contact marker, at the
`attack.release` start; markers are re-timed inside the banner's own length (the beat's duration, at
most 1100 ms, compressed never stretched). A defender takes a pose only for its own block/repel (guard)
or hit/KO (hit) beat. The pose must be listed in the character's `frames` in `characters.json`;
otherwise the banner stays neutral (`unmapped`) rather than substituting one. Neutral art (an energy
emblem) carries the contract's reason in `data-neutral` (`hidden`, `unknown-card`, `face-changed`,
`unmapped`, `no-subject`; `asset-pending` while a sheet loads). An approved technique labels only the
attacker's mapped face. `SkillBanner` shares the duration cap and marks a faceless motion with the same
reason. Reduced motion renders the static result at once with no timed phase; Skip clears the beat and
its timers; a new beat key unmounts the old one. Audio is unchanged (#1109).

Visual smoke: `npx tsx scripts/arena-banner-smoke.mts --base <dev server>` opens
`/arena/preview?fixture=immersion&fx=immersion-{attack,hit,block,repel,negated,unknown}&pace=slow` at
1440, 1024 and 390, records each banner's `data-*` contract attributes (kind, role, phase sequence, pose,
neutral reason, contact) and captures the release frame from a paused static clone (the live banner
lasts at most 1100 ms, so `shots:compare`, which waits 1.5 s and disables animation, cannot see it). It
also checks OS reduced motion (no queued banner) and page overflow.
