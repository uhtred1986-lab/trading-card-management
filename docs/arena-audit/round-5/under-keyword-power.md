# Under-card keyword power (R468)

The R466 price-query investigation reproduced a preexisting rules defect: a Trunks card with printed power 5000 and Servant still had effective power 15000 under a host, before the proposed pricing helper ran. The red run is retained at `/workspace/shared/arena-support5/triggers-r466/servant-under-red.log`.

RM22-40-1 defines Servant as a Permanent keyword. RM23-2-2 negates under-card skills; RM23-2-2-4's Ultimate and explicit under-card exceptions do not include Servant. The attribute-bonus query therefore returns no effective bonus while its subject is physically underneath a host. Printed skill/keyword data remains available to an explicit under-card selector, and original power is unchanged.

The complete current keyword-definition census has exactly one `attrBonus` keyword: Servant. `under-keyword-power-5.ts` asserts that census, then checks both seats through Battle → under host → Battle with JSON reload: effective power 15000 → 5000 → 15000, original power always 5000, and a printed-Servant under-card selector still selects the card. These are native movement/attribute-query proofs, not completed under-Counter activation proofs.

The named completion boundary is **other under-card keyword hook families**. This change does not globally remove printed keywords, widen under-card permissions, fix all source lifetimes, or claim that every Barrier/other keyword hook has been audited under RM23-2-2. R466's under-Counter route remains separate work. No compiler record or serialized operation changed.
