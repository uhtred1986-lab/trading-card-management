---
title: Arena: effects that make the play land — reveal on play, explosion on a hit, KO shatter, life break, clash verdict
issue: 349
milestone: Arena M16 — Board redesign: play feel and card review
labels: backlog, ready-for-agent, enhancement, area:arena-ui, phase:board-redesign, model:sonnet-5
stage: ui
status: closed
touches: src/app/globals.css, src/components/arena/stage/StageCard.tsx, src/components/arena/stage/BattleParts.tsx, src/components/arena/stage/DuelBand.tsx, src/components/arena/stage/Takeover.tsx, src/components/arena/stage/StageZones.tsx, src/components/arena/stage/motion.ts
---
**Source:** `docs/arena-board-redesign-spec.md` §5 (the motion table) and decision 7; frames `docs/arena-redesign/fx-lab-effects.jpg`, `docs/arena-redesign/phone-07-clash-defend.jpg`, `docs/arena-redesign/phone-08-clash-break-through.jpg`, `docs/arena-redesign/phone-09-life-break.jpg`, `docs/arena-redesign/desk-08-clash-break-through.jpg`, `docs/arena-redesign/phone-10-victory.jpg`; `src/components/arena/stage/StageCard.tsx` (the `Moment` type); `src/components/arena/stage/motion.ts` (`baseMs`); `src/components/arena/stage/BattleParts.tsx` (`BattleVerdict`); prototype `docs/arena-redesign/prototype/arena.css` (the keyframes named below).

**Problem.** The board does not feel engaging enough. Lunges, a hit flash, `Ghosts` sliding to the Drop and a verdict line are correct but quiet. There is no explosion, no reveal and no shattering life. The owner asked for "a lot more animation, card effects like explosion and reveals". The prototype's effects lab plays each one at the real timings.

**Build.** Each effect is a `Moment` or a staging decoration driven by an existing beat. None needs a new beat or a new `Snapshot` field.
1. **Reveal** on the `move` beat that brings a card from hand to the battle area (850 ms). It flips from face-down with a scale-in, a light ring at 330 ms, and a brief full-board flash. Prototype: `reveal`, `ring`, `flash`.
2. **Explosion** on the `damage` beat against a leader (680–760 ms): a radial flash, a shock ring and 12 shards on radial paths (`boom`, `b-flash`, `b-ring`, `shard`), plus a 420 ms board shake (`shake`). This replaces nothing — `arena-hurt` on the rail stays.
3. **Life break**, on the same beat (750 ms). The emptied life pip flashes white, doubles and spins away (`shatter`), and a stroked red **−1 LIFE** rises at that side (`floatUp`, 950 ms).
4. **KO shatter** on the `ko` beat (780 ms): burn white, crack, tilt and fall (`ko`), *then* the existing `Ghosts` flight to the Drop begins. Delay the ghost by the KO duration.
5. **Clash in the staged fight** (`DuelBand` and `Takeover`):
   - The two cards arrive from opposite corners (460 ms, `inTop`/`inBot`), and **VS** slams (`slam`).
   - The anime skin gets a slow conic starburst behind the power figures and ink speed lines; night gets a quieter ring.
   - On the verdict, a ki beam runs from attacker to defender (360 ms, `beam`), then **BREAK THROUGH** / **K.O.** / **HELD!** slams (640 ms). On a hold, a barrier flares around the defender (`shieldUp`, 620 ms).
   - Extend `BattleVerdict` rather than adding a second verdict.
6. **Victory / defeat** (`GameOver`): slow conic rays behind a slammed title.
7. **Rules for all of it:**
   - Durations come from `motion.ts` (add rows for the new moments) and scale with pace. The decisive beats keep their never-sped-up rule.
   - Every keyframe is added to the existing `prefers-reduced-motion` block.
   - Colours read skin tokens.
   - Infinite animations are never used on hand cards (`docs/arena-skin-spec.md` §6 risk). Cap simultaneous box-shadow animations; shards are transforms, not shadows.

**Out of scope.** Sound, particles on canvas or WebGL, and new beats.

**Acceptance.**
- `npm run typecheck && npm run lint && npm test && npm run build`.
- rd-01 shots of the `attack`, `ko` and `over` fixtures in both skins at both sizes, frozen mid-effect by pausing `document.getAnimations()` at a set `currentTime`, beside the matching frames.
- A short screen recording (phone emulation) of one attack that takes a life, in the PR.
- With reduced motion on, the same game is fully playable and nothing moves.
