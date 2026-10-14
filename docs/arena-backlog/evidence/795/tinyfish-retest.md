# TinyFish regression checklist

Baseline reports retrieved on 14 Oct 2026:

- Production Arena: `19adb0ad-72d5-47e5-8f84-bfcd567afd01`
  (14 Oct, 12:57–13:01 UTC).
- Phone prototype: `b6dc53b5-864e-4bd9-ad10-feed1e240155`
  (14 Oct, 14:40–14:41 UTC).

The following is a retest plan, not a TinyFish pass. PR #808 must be deployed
and the tested commit recorded before a regression result can be assigned.
The signed-in Arena profile is `prof_b649e73dc76e4128`.

| Earlier finding | Branch retest |
|---|---|
| Hand too small, unclear count and playable state | Inspect six- and ten-card hands; distinguish your hand count from the opponent's concealed hand count; check 84px cards, cost discs, action chips and all-visible fan. |
| Small cost indicators and low-contrast text | Read costs and availability in both skins, including unavailable cards, under phone-sized rendering. |
| Drag-only play unclear | Tap a hand card, inspect the offered action, and play; confirm ordinary drag play still works. |
| Energy/payment clutter and ambiguity | Read life separately from ready/total energy; review exact cards that rest, ready energy left, alternatives and Counter warning before committing. |
| Target explanation truncated | Inspect BT6-025's eligible and refused targets; read the complete reason for each refusal. |
| No-target feedback verbose/unclear | Inspect BT11-011 without a red Unison: distinguish an optional empty effect with Play anyway from an unavailable action. Repeat with a valid red Unison. |
| Charge popup hides hand | Select a Charge card and confirm in the dock; check that the hand remains visible. |
| Card review obscures the board | Check opponent peek and Bigger/Board; check target review. The approved design intentionally keeps your own card large, with full-screen browsing available. |
| Small review arrows, awkward card navigation | Flick/swipe, use 44px arrows and filmstrip, and filter a crowded hand; return to the same board context. |
| Leader vs Battle Card distinction | Identify both Leaders using their bays/tags without reading card text. |
| Attacker/defender and block decision unclear | Stage an attack, identify roles and arrow, read the engine power/stakes preview; cancel before commitment. During defense, read Blocker KO/no-life impact. |
| Counter jargon and Combo effect unclear | Follow Counter → Block → Combo plain questions; inspect card effects/costs/reasons and the live Combo meter, including attacker-wins-ties. |
| Missing/inconsistent Skip and Pass | Check Pass is last with a consequence in Charge, Counter, Block, Combo, optional targets and attack cancellation; distinguish End turn and lane Fast-forward. |
| Weak action/KO/life/phase feedback | Observe played-card landing, hit/held, KO, life delta and phase cues; repeat with reduced motion and verify understandable static feedback. |
| Opponent cards hard to inspect, resting state unclear | Tap opponent cards, use peek/Bigger/Board, and identify ready/rested cards. |
| Hand/board/dock overlap and excessive scrolling | Check 360×800 and 360×650 in both skins; verify both rows, resource strips, hand and active controls remain available. |

Also recheck the production report's match-setup/navigation findings. These
were not changed by Milestone 23, and must not be declared fixed merely because
the in-match board passed:

- Opponent-selection visibility and the changing Play/Invite label.
- Long second-player deck selector and Play button visibility.
- Mobile deck inspection discoverability and deck-preview art/name readability.
- Global navigation overflow and discovering/resuming current games.

For each item TinyFish should return **resolved**, **still present**,
**intentional design difference**, or **not exercised**, with the exact screen,
steps and screenshot evidence. Any new issue should be separated from the
baseline regressions. Do not substitute a prototype or old production for the
built branch, and do not infer card targeting or payment from artwork.
