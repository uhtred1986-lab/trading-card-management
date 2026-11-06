# Scoped coupon receipts precede ordinary price writes

The dedicated R515 ordinary Activate price runner returned before the generic flow runner reached R448’s saved energy-coupon guard. A duplicate receipt therefore reached the final consumer only after the material price moved; a missing receipt could evade the capture check.

The ordinary runner now calls the existing `requireEnergyCouponFrame` immediately after authenticating its original price/effect pair, before any material checks or execution. The coupon consumer and capture schema are unchanged. Expired captured coupons remain valid history and are never recreated.

The existing duplicate/missing/expired cases keep their original expectations for both seats. Additional direct-runner assertions prove malformed captures preserve both the price cursor and state and emit no events. Public saved-choice assertions verify input purity and no material movement. The focused six cases and the complete 46-case scoped coupon suite pass, along with TypeScript and focused lint. No new refusal site or card-text admission is introduced.
