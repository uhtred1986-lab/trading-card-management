# Conditioned Fusion materials from Drop

PR #1085 addresses the shared support clause on **EX23-36/front/20** and
**P-519/front/20**, alongside their own **front/10 Fusion activations**. It
reuses the existing named-material matcher, material-before-remaining-price
checkpoint and movement/payment machinery. Other payoff lines and whole-card
or deck qualification remain outside this four-record boundary.

## Record authority and rules

[Official findings](online-sources-findings.md), [source receipts](online-sources.json)
and [literal excerpts](online-sources-excerpts.txt) establish the exact printed
clauses. The official source-expansion rule and three analogous Hand/Warp FAQs
support mixed Hand/Drop pairs. The permission changes no named-character,
color, Battle-card or equal-power requirement and adds no shuffle.

The typed `unionFusionDropBottom` permission applies only to this card's own
Fusion from Hand, under its recorded yellow Gotenks: Adolescence Leader
condition. Its Fusion contract must explicitly opt in; the opt-in grants no
permission by itself. Drop selections go to deck bottom in the owner's chosen
order. Hand selections follow the ordinary Hand-to-Drop material cost. EX23-36
then pays draw1 and three yellow energy; P-519 keeps its typed shared Limit1.
Ordinary energy-cost play remains independent of this material permission.

The owner chooses bottom order privately under rule3-1-5-1. Private replay
retains the order; public movement animations must not expose that permutation.
Combining the new permission with existing Warp or Battle/Drop-to-Warp
permissions remains explicitly unsupported in this bounded increment. Their
existing behavior without the new permission remains the preservation control.

## Four-record application boundary

The [read-only freeze](../../930/drop-bottom-2026-10-19/reference-before.json)
contains the exact two public catalog definitions and four stored records:

| Record | Version | Proposed change |
|---|---|---|
| EX23-36/front/10,3897 | 2→3 | Typed Fusion/admission metadata; existing YYY+draw1 price and body preserved |
| EX23-36/front/20,3898 | 5→6 | Replace partial unread support with typed permission/Leader condition; open→draft |
| P-519/front/10,9887 | 1→2 | Explicit zero price, typed Fusion/admission metadata and Limit1; body preserved |
| P-519/front/20,9888 | 5→6 | Replace partial unread support with typed permission/Leader condition; open→draft |

The [proposal](proposal.json) is a **compiler program repair**, not a metadata-only
migration. [Proposed records](proposed-records.json) are the exact execution-proof
input, not an actual stored export. All four are compiler-owned, unflagged and
unconfirmed. Printed source, kind, native triggers, combo and all private review
fields stay unchanged; activation effects, conditions, readings and legacy
prices remain exact. The support rows receive fresh typed programs, condition,
reading/pattern, cleared unread clauses and draft status. No human confirmation
or unrelated record refresh is added.

`scripts/arena-fusion-drop-bottom-930.mts` defaults to read-only preview. Live
application requires a separately approved exact digest, then full raw-row and
catalog lock-and-compare in one atomic statement. Stale rows, source/catalog
changes, wrong digest and replay refuse the entire update. Private snapshots
remain outside registered worktrees. The PGlite migration proof verifies those
boundaries without contacting Neon.

**Application is not approved or performed.** Deploy reviewed code first, then
apply only the exact approved proposal and verify its actual readback. Prior
nineteen-row metadata approvals, the applied Absorb identity update and the
separately applied Potara identity update authorize none of these four program repairs.

## Validation status

[Verification receipt](verification.json) pins **116 passing provided-record cases**
through the real loader/VM, both seats with JSON restoration on each step.
[Case receipt](proposed-proof.json) includes Hand/Drop mixtures, both private
bottom orders, no shuffle, exact name/color/type/equal-power checks, no automatic
permission, stored-contract mutations, source/permission loss, explicit old-save
rebuild refusal, deck-top redirection failure with partial payment retained,
ordinary play and P-519's Limit1. Actual non-replacing Counter responses and
paid Counter-continuation mutations are covered; the original #929 suite remains
separate evidence for generic incoming-card replacements.

Original #925/#929/Fusion-authority #907 controls pass on the final runtime;
original #930 passed on the first coherent core. Typecheck and final changed-file
lint pass. Full lint passes with five existing prototype warnings. The guarded
PGlite migration proof passes; the final proposal replay is byte-identical.
Independent source/rules/tool/proof review reports no blockers. The generated
reading explicitly describes Drop-to-bottom Fusion, with no attack permission.

Strict affordability checks include replenishing an empty deck through material
payment **in the planner only**; a game already lost by deck-out cannot continue.
Real positive execution proves materials precede EX23-36's draw and remaining
price, using a normal nonempty deck.

Existing #926 has a reproduced baseline diagnostic gap; its unchanged assertion
is not a passing control. No full suite, local production build, broad catalog
sweep, game campaign or strength claim belongs to this increment. Public Snapshot
shape is unchanged; source/route capture and the movement privacy marker are
internal continuation/event metadata.
