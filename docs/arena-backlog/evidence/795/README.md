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

`arena-phone-feedback.mts` passes visible hit/held/life/KO subject cues with both
motion preferences and skins. Reduced cues have no animation. Phase cue
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
- Hit: [motion](hit-normal-360x650-anime.jpg), [reduced](hit-reduced-360x650-anime.jpg)
- KO: [motion](ko-normal-360x650-anime.jpg), [reduced](ko-reduced-360x650-anime.jpg)
- Life loss: [motion](life-normal-360x650-anime.jpg), [reduced](life-reduced-360x650-anime.jpg)

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
- Full suite, typecheck, lint and production build pass on code commit
  `ad788078b2d2026bd7aa14e47d25332c633ca043`. Earlier production recovery
  passes reloads, worker termination, quota/abort and two-tab takeover,
  ending with 172 journal decisions identical to the reference. A fresh recovery
  run on that code commit was stopped at the owner’s request on 14 October;
  it is not a new pass.
- Performance acceptance remains open: the last full branch matrix
  (`b4aed13b`) passes all functional cases and frame budgets but exceeds startup
  (834.4 ms versus 770 ms) and long-task count (24 versus 12). Current main
  (`6f08002f`) also exceeds those budgets (941.8 ms and 23 tasks). The latest
  code has only a single-case probe, not a completed full release matrix.
- The browser recovery run found rejected-target rows calling a location helper
  before initialization. The helper is now hoisted; browser exceptions are
  retained in the proof output so a future render failure keeps its cause.
- The production TinyFish report's hidden phone deck-inspection button is
  now visible with a 44px tap target. Payment-preview controls also have 44px
  targets. These are source/local fixes awaiting independent browser retest.
- The complete delayed KO flight shares one sub-700ms visual budget; its burst
  and flight remain distinct and narration dwell is unchanged.
- TinyFish review of this branch has not run. The owner deferred validation
  on 14 October and will run locally. The production build was launched on
  local port 3000 and `/arena/offline` returned HTTP 200; the workspace offers
  no public forwarding URL for TinyFish. Both local processes are stopped.
  Git/Vercel branch previews are disabled and the
  fixture route is dev-only, so review needs a reachable built-branch deployment.
  Do not test old production and report it as acceptance of this branch.
  [The regression checklist](tinyfish-retest.md) identifies both baseline runs
  and includes setup/navigation findings that Milestone 23 has not addressed.
- Owner S21 retest remains required by tracker #795 before the milestone closes.

No milestone issue is closed by this evidence record.

## Owner local launch

Use Node 24 and branch `arena-m23-phone-ux-reviewed` (PR #808). On a clean
checkout, install with npm 10 if npm 11 rejects optional lockfile packages.
Run without a production database or authentication configuration:

```sh
npx --yes npm@10 ci --no-audit --no-fund
env -u DATABASE_URL npm run build
env -u DATABASE_URL -u AUTH_SECRET -u GOOGLE_CLIENT_ID -u GOOGLE_CLIENT_SECRET -u SL_EMAILS -u BASIC_AUTH_USER -u BASIC_AUTH_PASSWORD npm run start -- -p 3000
```

Open `http://localhost:3000/arena/offline` for the real production board.
The fixture review route `/arena/preview` is available only with `npm run dev`.
TinyFish runs remotely and needs a public URL forwarding to the local server.
Use the regression checklist above for its previous findings.
