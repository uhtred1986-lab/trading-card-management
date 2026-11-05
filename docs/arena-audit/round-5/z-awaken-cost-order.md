# R-443 — Z-Awaken costs competing for Z-Energy

EX21-28#0 and BT19-003#10 now have executable stored payment records. This
batch changes their costs only; it does not claim their other skills were newly
implemented or audit every other effect on either card.

## Sources

RM 22-46-3 requires the chosen awakened Leader, native Z-Energy cost,
conditions and skill cost. Section 22-46-3-1 explicitly allows the Z-Energy
cost and skill cost in either order. RM 3-13-2 lets the player choose the
physical Z-Energy cards paid. RM 5-8-2-2 and 5-8-4 require complete payment;
a replacement preventing completion retains earlier payments but does not
activate the skill. RM 23-2-4 places newly added under-cards beneath the
existing pile. R-427 and R-428 supply the strict original-movement and
placement witnesses used here.

The complete public-catalog records were inspected, with normalized own-card
FAQ lookup and official errata review. Neither card has an own FAQ or matched
erratum changing these payments. The source brief is
`/workspace/shared/arena-support5/recovery/z-competing-intent.txt`. Its scratch
catalog adapter has no release sets, so its empty release-context section was
not treated as evidence about matching Leaders.

EX21-28 requires life at four or less, yellow energy, its native Z-Energy
cost, and two distinct Z-Energy cards matching Zamasu and Goku Black sent to
Warp. A dual-character card cannot pay both slots. BT19-003's literal
“place up to 3 of your Z-Energy under your Leader” names cards in that area;
the bounded normalization retains optional zero through three and the current
Leader host. It still owes the native Z-Energy cost and red energy.

## Runtime contract

The new saved keyword-price continuation offers feasible payment orders,
then pays each resource group and the printed action through explicit stored
cursors. Native Z-Energy and printed departures use the same strict interpreter
in affordability simulations and actual execution. Optional replacement
answers may legally prevent payment; no activation or once-per-turn use then
occurs, and successful earlier payment is retained.

Complete-cost proofs include later groups. Both script-choice and pooled
subset symmetry are disabled for these opaque future-cost proofs. Explicit
energy selections and full or partial Z-Energy prefixes are preserved, and
malformed explicit selections are rejected. The original Z-Deck source,
Leader and still-unpaid payer occurrences remain bound after JSON reload.
Partial optional card choices are stamped too. Previously completed native
departures do not invalidate later payment. A saved competing-price frame
missing its order continuation is rejected instead of paying only its action.

## Evidence

`z-awaken-cost-order-5` passes 72 both-seat stored/native/protocol scenarios:
both payment orders, optional zero through three, named/side/area/life/energy
negatives, nongreedy dual-character assignment, fixed and partial resource
requests, malformed requests, forced replacement refusal, stale source/base
and partial choices, and stale second native payer after the first paid.
The two-native-payer tests deliberately scale the native resource field and
are protocol tests, not a claim that either printed card costs two Z-Energy.
They also verify voluntary replacement failure and saved successful payment.

Passed: typecheck; changed-file eslint; prior Z-Awaken suites 60/146/28/48;
Z-Energy choice 64; Auto549; keyword-action926; typed-payment907; disjoint970;
phrasing3 (37 record + 16 runtime); lang/language/Teach; rulings (211);
capabilities (41 narrow scenarios); and CRLF-aware diff checks. The prior
Z-Awaken price suite's two obsolete unread assertions now expect the newly
supported cost records.

Offline full-record comparison uses the recovered 6,597-card public catalog
(SHA256 `d3646487f34749d905a65b2473f21aee7984e4aac640c631bc0deb319e512bfb`),
not the lost original snapshot. Against `recovery/nineteenth-full.json`,
`conditions-r443/after-full.json` changes exactly EX21-28#0 and BT19-003#10,
and only their `cost` fields. All other stored fields are identical. Read
coverage remains 12,980/13,964 with 984 unread because these were readable
bodies with blocked payment records. Full evidence is in
`/workspace/shared/arena-support5/conditions-r443/full-record-diff.json`.

No database, paid service, dependency install, full gate, build or merge ran.
