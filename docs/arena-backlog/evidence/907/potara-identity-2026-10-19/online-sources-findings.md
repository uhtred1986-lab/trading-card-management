# BT2-012/front/0: Potara authority feasibility

This is an offline feasibility/source audit from merged `51d6fe97`, not an
implementation, application, new ruling or game qualification. [Source receipts](online-sources.json)
pin the fresh same-day official BT2-012 cardlist and reverified saved official
manual/FAQ/errata bytes. [Excerpts](online-sources-excerpts.txt) retain the exact
Potara clauses and card-specific answers. No exact BT2-012 errata entry was found;
this scoped absence does not supersede general rules. No community ruling is
used. Raw external documents and private snapshots remain outside the repo.

## Exact current boundary

The coordinator's safe freeze contains one public CardDef and three stored rows.
Only **10297 / BT2-012/front/0 / v1 / compiler draft** is the primary target:

> [Union-Potara] {5}: <Son Goku> and <Vegeta> (Place this card in Active Mode on
> top of the 2 specified cards stacked together)

The official cardlist matches this source; its orb image is `five.png`. Actual
catalog HTML entities/circled5 normalize to the same printed record. Pure offline
`skillRecords` comparison finds no differences in printed, kind, trigger,
condition, operations, unread, reading, pattern or combo fields. Existing cost
is five generic energy with null action program/condition. Current metadata adds
cost version1/readabletrue, unlimited usage-v1 and Sparking-null validity-v1;
a future Potara contract would be an additional explicit delta. This is not a
zero-cost migration or an effect recompilation.

Actual **10298/front/10** is Triple Strike, not an Auto. Actual
**10299/front/20** is the attack-power Auto. Both lack current metadata and are
outside this one-row scope. A target-only repair cannot claim whole-card
readiness, attack payoff or deck qualification; companion lines in a proof must
be labelled as support fixtures rather than silently compiled actual rows.

## Official semantics to preserve

Manual22-13-1 makes Union Activate:Main. Section22-13-5 specifies hand activation,
full skill payment, one distinct specified character's Battle Card per slot from
your Battle Area, no activation without the complete set, then playing the hand
card on both materials in either order. There is no equal-power requirement.
The printed reminder requires Active entry. Section5-4-1 and BT2-012 FAQQ1 carry
power changes but not a granted Double Strike. Failed entry uses the existing
Drop rule and explicit return-to-hand replacement exception.

Section5-2-1/-1-1 permits specifically granted source extensions and suppresses
movement-trigger/Counter timing on their preliminary area movement. Preserve
existing #927/#930 fixtures and their labelled owner guidance for picked stack
order and nested-pile carryover; do not turn that guidance into a new official
ruling. BT2-012 FAQQ2 counts SonGoku plus Vegeta in Drop for its separate attack
Auto; it does not change this activation contract or justify migrating that row.

## Existing primitives and authority gap

Typed payment, conditions, permission filters, exact-set matching, area-extension
movement, stack construction/carryover, source/material occurrence checks and
Counter/failed-entry machinery already exist. The remaining Potara material
identity still comes from `namedCandidates` → `unionNeeds(skill)` at runtime;
`eachNamed`/`choose.namedSet` use that description, and granted Potara currently
parses its displayed line. Those cannot establish recorded material authority.

A bounded design can persist canonical keyword/Potara identity, hand activation,
Battle base, two per-name typed filters and `samePower:false`, then reuse the
existing exact-set matcher and stacking engine. Material filters/counts and
price must come from loaded/captured records; missing contracts cannot fall
back to display text. Explicit supported permission kinds must retain the old
extension controls without asserting every indexed permission/grant is typed.

One source-level negative case needs attention: the native non-Fusion candidate
`battle` flag currently includes Unison/Z-Unison types. Normal Battle pools hide
that distinction, but under-Unison source extensions can expose it. Manual5-2
requires Battle Cards, so a typed contract should explicitly check the proper
card family and prove refusal without changing accepted Battle-card controls.
No runtime reproduction or repair has been performed by this audit.

## Bounded counterexample plan and dependencies

Freeze the exact target full-row/catalog guard and proposed additive delta before
application. Prove five-energy payment, missing/wrong/duplicate materials,
unequal powers, wrong source/controller/timing/type, both material orders,
Active entry, power-only carryover and separate ordinary seven-energy play.
Use display/material/price mutations to prove record authority, plus JSON-saved
price/material/Counter continuations and source/material leave-return cases.
Old context and frame contracts must refuse even together, including after
payment has removed its captured payment line. No type-filter or source-support
expansion should be inferred from a passing base case.

Before broadening compiler identity requirements, preserve existing #925/#927/
#929/#930/#926 controls: action costs, energy/Warp/under-Unison/opponent-area
permissions, Counter failure and granted-family residuals. Additional actual
rows, card lines and application writes require explicit scope; there is no
three-row refresh assumption. No tests, games or database access were performed
for this feasibility audit.
