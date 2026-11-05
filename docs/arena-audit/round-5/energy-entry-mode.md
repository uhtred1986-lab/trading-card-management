# R480: Energy mode before arrival observation

The script mover formerly placed the card, emitted its movement, then ran Energy-Exhaust's charge-limit hook. An explicit Active mode applied by the script afterward could override Exhaust. A conditional self negation could also count the arriving card in Energy, even though its condition was false immediately before entry.

The mover now observes actual Energy-Exhaust validity before placement and old-occurrence cleanup, and sets final mode in the placement operation. Exhaust makes the arrival Rest; explicit Rest remains Rest. Completed-movement receipts and arrival observers see that final mode. The captured observation survives cleanup of an old timed keyword negation. Native charge uses this script path.

The script forwards requested mode for every destination, and uses the returned actual area when deciding whether to apply its ordinary late non-Energy mode. Thus a Drop-directed move replaced with Energy still respects Exhaust and requested Rest, while an Energy-directed move replaced with Battle retains ordinary explicit-mode semantics. Other native movers remain outside this change.

Validation: `energy-entry-mode-native-5.ts` passes 88 checks across both seats: Exhaust/no Exhaust; requested Active/Rest; BT8-120 and EX18-05 with and without prior qualifying Energy; native charge after JSON roundtrip; receipt-time final mode; single movement; old-negation cleanup; unchanged non-Energy modes; and both replacement directions. The independent 26-case preparation suite also covers BT14-151's changed Drop threshold. Typecheck and touched lint pass. Scanning every shipped `.rules` file finds exactly one chargeLimit hook, the DBS Energy-Exhaust hook; Fusion has none.

This is independent of optional two-card Energy-entry procedures. It adds no optional-entry descriptor admission, cost-host exception, native suspended child or arrival-negation lifetime. The unresolved incoming-Drop self-payer ruling remains unrelated to this mode fix.

Standalone runtime patch: `/workspace/shared/arena-support5/conditions-r476/r480-mode-only.patch`, assembled from the mode-only changes through `f7785d22` plus `energy-entry-mode.ts`. It deliberately excludes optional-policy helpers, child-frame fields and preparation glossary claims. Local evidence: `mode-wire-type-final.log`, `mode-redirect-type.log`, `mode-redirect-lint.log` in the same directory.
