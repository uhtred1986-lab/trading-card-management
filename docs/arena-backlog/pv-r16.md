---
title: [P1] Arena: apply effective colours to energy payment planning
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: backlog, ready-for-agent, enhancement, area:arena-vm, phase:capability-gap, model:opus-5
stage: ui
issue: 626
priority: P1
touches: src/lib/arena/vm/costs.ts, src/lib/arena/vm/program.ts, src/lib/arena/vm/view.ts
---
**Source:** Manual §§1-2-3, 2-2, 5-3, 23-5-2; `src/lib/arena/vm/costs.ts` exported `cardColors`; #562's independent energy-grant/payment fixture.

**Priority:** P1. **Delivery:** Rule engine correctness, Arena M5. Serialize with #549/#595/#624 cost and keyword writers.

**Confirmed problem:** `cardColors` reads `attrsOf(def).attrs.colors` rather than effective colour layers. A printed Red energy card receiving a public Blue grant has effective Red/Blue colours (`attrsNow`), but cannot pay Senzu Bean's Blue specified cost. The #562 UI must accurately distinguish current planner payment colours from effective card colours until this is corrected.

**Build:** Verify the manual's payment-colour basis and make the shared planner use effective applicable colours without recursion, stale layers or changing original-colour keyword payments (#597). Audit callers including energy markers' Leader-colour basis and AS-energy payers. Preserve Hidden Mode's no-colour payment rule (§23-5-2), alternative payer rules and all cost/refusal consistency.

**Acceptance:**
- [ ] Printed Red gaining Blue can pay the specified Blue orb when the applicable public effect permits it; source removal and timed expiry revoke it. Ordinary payments remain unchanged.
- [ ] Real legal offer, selected payment, actual rested resource and refusal assertions agree with the displayed payment-colour projection; invalid/stale/reload cases do not pay twice.
- [ ] Hidden Mode pays only its permitted colourless portion; no hidden printed colours, hand/life identities or private frame data become public. Original-colour Arrival/Aegis/Revive tests remain unchanged.
- [ ] Marker and AS-energy payer interactions, reductions and explicit alternative colours have rule-grounded fixtures; unsupported shapes are explicit.
- [ ] Glossary, contract projection and capability inventory reflect the delivered scope; typecheck, lint, independent rules scenarios, full tests, build and generated-source checks pass. Frozen legacy expectations remain unchanged; owner real-deck checks are identified separately.

One bounded draft PR. No live database, paid calls, new dependencies or production settings. Do not combine this with Revive cost ordering #624 or a UI redesign.

