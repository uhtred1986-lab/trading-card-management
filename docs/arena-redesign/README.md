# Arena board redesign — reference frames

Pictures of the destination for `docs/arena-board-redesign-spec.md` and the `docs/arena-backlog/rd-*.md`
issues. Rendered on 30 Sep 2026 from the prototype (`prototype/`), not from the app: the cards are
invented and drawn in CSS, and the rules are simplified. Judge layout, hierarchy, motion and colour
against them — not card text or numbers.

Phone frames: 390×844 at 2× (`phone-*`). Desktop frames: 1440×900 at 1× (`desk-*`). Every frame
is in the anime sky skin except `*-12-night-skin`.

| Frame | Shows |
|---|---|
| `*-01-board-your-turn` | The resting board on your Main phase: turn pill, phase chips, both strips, glowing ready cards, the narration line in the lane, the fanned hand, one prompt line and End turn. Desktop adds the match/phase column and the docked inspector showing the hovered hand card. |
| `*-02-turn-banner` | The turn-change banner ("CLAUDE'S TURN"), frozen mid-sweep; the board edge and pill have already switched to Claude's colour. |
| `*-03-charge-phase` | The Charge phase: dashed outlines on every hand card, the prompt naming the gesture (tap / double-click), a Skip charge button. |
| `*-04-drag-to-play` | A card mid-drag over the battle area: the ghost card, the lifted card fading in the hand, the drop zone lit, the landing slot pulsing, the "Drop to play · −3 energy" tag, and the energy chips it would rest. |
| `*-05-refusal-energy-short` | A card you cannot afford: red cost disc, dashed missing chip, the refusal sentence in the prompt bar, and the review showing "1 energy short" with Play disabled. |
| `*-06-review-cards-in-play` | Reviewing Claude's card. Phone: the swipeable review sheet with the thumbnail strip, position (3 / 6), prev/next and state chips. Desktop: the docked inspector plus the In play list, with the hovered row outlined. |
| `*-07-clash-defend` | Claude attacks; you are choosing combos. The fight panel covers the field only, so the hand stays tappable; picked combos appear dashed under your power. |
| `*-08-clash-break-through` | The verdict frame: ki beam, starburst, explosion on the defender, BREAK THROUGH. |
| `*-09-life-break` | Just after the hit: the pip shattering, −1 LIFE rising, the leader shaking. |
| `*-10-victory` | The victory screen with rays and Rematch. |
| `*-11-admin-debug-drawer` | The admin drawer from the shield button: seed, phase/AI stage, Claude's hidden hand, flag-this-turn, and the beat log with Claude's reasons. Only admins see the shield. |
| `*-12-night-skin` | The same board in the night skin. |
| `fx-lab-effects` | Every effect frozen mid-flight in one sheet: reveal, explosion, KO, life break, turn banner, clash verdict. |
| `admin-match-review` | The admin match review screen: matches, flagged-turn scrubber, the beat list, and the decision detail (legal moves, the pick, why, model tier). |

## Regenerating

`prototype/render/` holds the renderer: a 60-line static runtime for the prototype's templates,
the scene set-ups, and a Playwright (Python) driver that shoots JPGs with the fonts loaded from
`@fontsource`. It needs the prototype's built `.dc.html` files and is kept here so the frames can
be re-shot after a design change — it is not part of the app, not run by `npm test`, and not the
board screenshot tool (that is rd-01).
