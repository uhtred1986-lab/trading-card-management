# Milestone 23 branch validation

The integration implements #796–#802 in the production board and current rules
engine, using the approved #788 prototype as a behaviour reference. It does not
restore the removed legacy engine or change database contents.

## Browser evidence

`arena-phone-ux.mts` checks 360×800 and 360×650 in both skins: visible phase
track, no page scrolling, no dock covering the rows/hand, and no clipped target
reasons. Six core states passed; `phone-ux-combo-empty` additionally proves the
engine-supplied Counter/Block `none` markers.

`arena-phone-interactions.mts` passes full-screen arrows/swipe and staged
attack selection, visible summary, cancellation in all four phone/skin
combinations. The generic CDP tap helper auto-scrolls first; the Open hand
check touches the already visible control to avoid scrolling a sticky board.

`arena-phone-feedback.mts` passes visible hit/held/life subject cues with both
motion preferences and skins. Reduced cues have no animation. KO/phase cue
folding, privacy and duration are covered by the retained engine/cue proofs.
These screenshots do not prove physical-device rendering or timing budgets.

`arena-phone-art.mts` uses the real BT11-011/BT6-025 engine snapshots from
`evidence/798/browser`. The captures load cached artwork of those same printed
cards from the approved prototype; they do not prove remote CDN readiness.
Combat/hand layout fixtures use synthetic cards. Screenshots are from the real
dev board; the Next development indicator is absent from production.

- [Attack confirmation](attack-confirm-360x650-anime.jpg)
- [Blocker option](blocker-360x650-anime.jpg)
- [Empty response steps](combo-none-360x650-anime.jpg)
- [Printed Vegeta review](vegeta-card-360x650-anime.jpg)
- [Optional empty on-play effect](vegeta-play-anyway-360x650-anime.jpg)
- [Transcendent Strike targets/rejections](strike-targets-360x650-anime.jpg)
- [Reduced-motion held cue](held-reduced-360x650-anime.jpg)

## Checks and remaining gates

- Typecheck and targeted lint pass. Full lint has five pre-existing warnings
  in the old prototype assets.
- Contract emission passes 84/84 engine cases. Attack and defense fixtures
  include the additive, viewer-filtered response-history field.
- Target preview, exact payment, attack/block projection, response-window
  privacy and cue proofs are in the standard test command.
- A contrast audit of the changed sky surfaces led to stronger phase, energy
  gain, folded-hand and action/cost-chip text. The broad contrast audit still
  reports pre-existing card badges, inactive cards and desktop animation text;
  it is not a blanket WCAG pass.
- The final full suite, production build and required browser/release checks
  are pending revalidation against current main.
- TinyFish review has not run. Git/Vercel branch previews are disabled and the
  fixture route is dev-only, so review needs a reachable built-branch deployment.
  Do not test old production and report it as acceptance of this branch.
- Owner S21 retest remains required by tracker #795 before the milestone closes.

No milestone issue is closed by this evidence record.
