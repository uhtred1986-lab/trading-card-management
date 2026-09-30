# Arena — board redesign: play feel and card review

**Status: brief, not built (30 Sep 2026).** Owner's decisions of 30 Sep 2026, written for Claude Code.
The issues are `docs/arena-backlog/rd-*.md` (milestone *Arena M16 — Board redesign: play feel and
card review*). The pictures of the destination are in `docs/arena-redesign/` — every issue names the
frames it must match, and review compares a screenshot of the real board against them.

The prototype the frames were rendered from is playable at
`https://claude.ai/artifact/Lu6XkPrinYgJjbbaRSHgXW` (phone and desktop boards, an effects lab and
the admin review screen). Its source is in `docs/arena-redesign/prototype/`. Treat it as a picture of
the destination, **not as code to port**: it is vanilla markup with a hand-written state machine,
simplified rules (4 life, 4 battle slots, no skills) and invented cards drawn in CSS. The engine,
`legalActions`/`rejectedActions`, the beat stream and `useBeatPlayer` stay exactly as they are.

---

## 1. What the owner asked for

1. **More engaging.** More animation: card reveals, explosions, shattering life, a fight that reads
   as a fight.
2. **Turns clearly visible.** Whose turn it is must be unmissable, not a line of small text.
3. **Screens focused on the play.** Debug and diagnostic information goes out of the player's
   view and into an **admin-only** place for later review.
4. **Anime sky** is the look. It is already the default skin (`src/lib/arena/skin.ts`); the
   redesign is drawn in it, and night must still look right.
5. **Reviewing cards in play with the fewest clicks on desktop**, and phone-appropriate navigation.
6. **Placing a card is drag and drop.**
7. **In the Charge phase, a tap (touch) or double-click (mouse) on a hand card charges it.**

## 2. What exists today, and what changes

Most of the board is already built. This is a delta, not a rebuild.

| Area | Today | Redesign |
|---|---|---|
| Play a card | `tapCard` in `ArenaStage.tsx`: tap sends the one legal move or opens `CardSheet` | **Drag from hand onto the battle area** (rd-03). Tap still works; drag is the headline. |
| Charge | Always through `CardSheet`, by design ("a misclick is too costly") | **Charge phase only:** a tap on touch or a double-click with a mouse charges at once (rd-04). This overrides the earlier caution — the owner's decision. Outside the Charge phase, charging still goes through the sheet. |
| Turn change | `StepBanner` names phases, never the player; turn lighting washes the room | A **"YOUR TURN" / "CLAUDE'S TURN" banner** on every turn change, a turn pill and a board edge in the acting side's colour (rd-02) |
| Inspect on desktop | `CardPreview` floats beside a hovered card (sm+) | A **docked inspector column** that follows the hover — zero clicks — plus an **In play** list of every card on both boards (rd-05) |
| Inspect on phone | Long press (450 ms, visible bar) opens `CardSheet` | The same long press opens a **review sheet you can swipe through**, with prev/next and a thumbnail strip, plus an **eye button** that opens it on the whole board (rd-06) |
| Effects | Lunges, hit, hurt, `Ghosts` to the Drop, `BattleVerdict`, speed lines on anime | **Reveal on play, explosion on a leader hit, KO shatter, life-pip shatter with a floating −1 LIFE, starburst and verdict slam in the fight** (rd-07) |
| Debug on the board | "REF" badge, "Engine reads" box, raw card ids, raw engine log, debug links — all visible to everyone | **Admin only.** A shield button opens a drawer for admins; players see narration, not internals (rd-08) |
| Review later | `/arena/[id]/debug` | A **match review** screen for flagged turns (rd-09) |
| Review tooling | None (no Playwright, no screenshots) | **Screenshots of the real board from contract fixtures, and a contrast audit, both skins, phone and desktop** — ported from gullet-cove-dm (rd-01) |

## 3. Decisions

1. **Drag is added, tap is kept.** Drag is the headline for placing a card. The existing tap flow
   (tap → one move or the sheet) stays as the fallback, and is what a keyboard or switch user gets.
   The research in `docs/arena-workflow-spec.md` §8 warned against *drag-to-target* for attacks;
   this adds drag for *placing* only. Attacks stay tap-then-tap.
2. **Drop legality comes from the engine.** A drop on the battle area sends the `play` action that
   `legalActions` already offers for that card. A drop that has none shows the first `why` from
   `rejectedActions` (`whyByCard`) — the same refusal wording as a tap. The client never decides
   that four energy is not three (contract §1).
3. **Charge-phase shortcuts only in the Charge phase.** A single tap charging in the Main phase
   would turn every review tap into a lost card.
4. **Review never costs a click on desktop.** Hover fills the docked inspector. A right-click pins it.
   The inspector keeps the last card until another is hovered, so its buttons can be reached.
5. **The phone review sheet is a pager, not a popover.** It steps through a sequence: the cards in
   play (Claude's leader, Claude's battle area, your leader, your battle area), or your hand when it
   was opened from the hand. Swipe left/right, prev/next buttons (44 px) and a tap on a thumbnail all
   move it. Swipe down or Close shuts it.
6. **Side colours come from the lighting system.** The prototype paints you orange and Claude
   violet. The real board keeps `turnVars` in `src/lib/arena/lighting.ts` (the acting leader's
   colour). Violet was chosen in the prototype only because cyan disappears on the sky. Use the
   leader colour, and fall back to that pair when a leader colour fails contrast on the sky
   (`TurnLighting.tsx` already notes Blue as the hard case).
7. **Effects follow the pace preference and reduced motion.** Every new keyframe reads the same
   duration table (`motion.ts`), scales with `pace`, and is zeroed by `prefers-reduced-motion` in
   the existing reduced-motion block. The decisive beats (clash, damage, ko, over) keep their rule of
   never being sped up.
8. **"Admin" is a new, small concept.** There is no role in the app today. An admin is a signed-in
   user whose name is listed in `ARENA_ADMINS` (comma-separated). When Basic Auth is off (local
   dev), everyone is an admin. Nothing else about auth changes.

## 4. The frames

`docs/arena-redesign/README.md` lists every frame and what it shows. Phone frames are 390×844 at 2×,
desktop 1440×900 at 1×. The important ones per issue:

| Issue | Frames |
|---|---|
| rd-02 turn clarity | `phone-02-turn-banner.jpg`, `desk-02-turn-banner.jpg`, `*-01-board-your-turn.jpg` |
| rd-03 drag to play | `phone-04-drag-to-play.jpg`, `desk-04-drag-to-play.jpg` |
| rd-04 charge phase | `phone-03-charge-phase.jpg`, `desk-03-charge-phase.jpg` |
| rd-05 desktop review | `desk-06-review-cards-in-play.jpg`, `desk-05-refusal-energy-short.jpg`, `desk-01-board-your-turn.jpg` |
| rd-06 phone review | `phone-06-review-cards-in-play.jpg`, `phone-05-refusal-energy-short.jpg` |
| rd-07 effects | `fx-lab-effects.jpg`, `*-07-clash-defend.jpg`, `*-08-clash-break-through.jpg`, `*-09-life-break.jpg`, `*-10-victory.jpg` |
| rd-08 admin debug | `phone-11-admin-debug-drawer.jpg`, `desk-11-admin-debug-drawer.jpg` |
| rd-09 match review | `admin-match-review.jpg` |
| skins | `*-12-night-skin.jpg` — the night board must stay as good as the sky |

## 5. The motion table (prototype, at 1×)

| Moment | Duration | What it is |
|---|---|---|
| Turn banner | 1300 ms | skewed colour bar sweeps in, stroked impact text slides through, both exit right |
| Card reveal (play) | 850 ms | flip from face-down with a 1.7× scale-in, light ring at 330 ms, full-board flash 460 ms |
| Explosion (leader hit) | 680–760 ms | radial flash, shock ring, 12 shards on radial paths, board shake 420 ms |
| Knock-out | 780 ms | burn white, crack and tilt, fall 34 px and fade, then the existing `Ghosts` flight to the Drop |
| Life pip shatter | 750 ms | pip flashes white, doubles, spins away; outline pip remains |
| −1 LIFE float | 950 ms | stroked red numerals scale in at the damaged side and rise |
| +1 ENERGY float | 950 ms | the same in gold beside your energy row |
| Clash in | 460 ms | top card from the upper left, bottom card from the lower right, VS slams at 180 ms |
| Clash verdict | 640 ms | ki beam 360 ms, then BREAK THROUGH / K.O. / HELD! slams; shield flare 620 ms on a hold |
| Drag snap-back | 440 ms | a refused or missed drop springs back into the hand |
| Long press | 420–450 ms | progress bar under the card; the existing 450 ms stays |

## 6. What must not change

- `legalActions`, `rejectedActions`, the `Snapshot` shape and the beat stream. If an issue needs a
  new field, it is additive and optional, and `contract:emit` + `android:test` run in the same PR
  (`docs/arena-client-contract.md` §7).
- Card sizes set by `--arena` and `ArenaCard`'s `px(n)`, except where an issue names a change.
- The night skin stays maintained. Everything new reads skin tokens; nothing new is sky-only
  unless it is scoped under `[data-skin="anime"]`.
- `ReportBug` stays available to every player — it is help, not debug.
