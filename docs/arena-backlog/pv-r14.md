---
title: [P1] Arena: Reconcile Combo-to-Drop and battle-end Auto checkpoint order
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: backlog, ready-for-agent, enhancement, area:arena-vm, model:opus-5
stage: ui
issue: 609
priority: P1
touches: src/lib/arena/vm/battle.ts, src/lib/arena/vm/flow.ts
status: closed
---
**Source:** `docs/rules/rulemanual.txt` 8-5-5..8-5-10; `src/lib/arena/vm/battle.ts`; `src/lib/arena/vm/flow.ts`; `src/lib/arena/rulesets/dbs/triggers.rules`.

**Priority:** P1. **Parent:** #577. **Context:** #551 adds the ordered Z-Energy choices and 8-5-4 checkpoint; this is a distinct remaining cleanup issue.

The existing battleEnd work moves all remaining combo cards to Drop, collects their departure Autos together with battle-end triggers, and lets the runner drain them afterwards. Manual 8-5-6 says Combo-to-Drop triggers enter pending, 8-5-7 specifies a checkpoint, and 8-5-8 then moves the cards; 8-5-9/10 separately pends and resolves battle-end triggers. #551 preserves this prior grouping and explicitly limits its claim to choices/8-5-4.

**Audit evidence:** [cleanup-order-audit.md](evidence/609/cleanup-order-audit.md) records the manual sequence and current VM behavior. For an ordinary same-player Combo-to-Drop movement, §§9-6-9-1-3, 3-4-3, and 3-7-2 mean an 8-5-6 Auto that requests information about the moved card uses its new-area information, even though the 8-5-7 checkpoint precedes the physical move. This does not change live zone membership before 8-5-8; apply §9-6-9-1-2's inter-player/Battle/Unison exceptions where relevant. The repository contains a fixture for the distinct 8-5-10-1 “after you combo with this card” wording, but no actual card fixture for the generic 8-5-6 trigger; keep that evidence limitation explicit.

**Build:** reconcile the exact printed trigger semantics and official manual ordering before changing the runner. Use real card wordings where available, and identify any ambiguity requiring a ruling. Add a persisted cleanup stage for the required checkpoints only after the semantics are established. Avoid double-pending departure triggers and keep combo power expiry at 8-5-5.

**Acceptance:**
- [ ] Record rule-grounded ordering for Combo-to-Drop versus end-of-battle Autos, including source area/validity and effect conditions; do not silently reinterpret the manual.
- [x] Named fixed scenarios assert state and effect order at each checkpoint, including an Auto that pauses, JSON reload, two players, source departure/negation, and simultaneous cleanup. Each Auto resolves once.
- [x] Preserve the completed #551 Z-Energy offers, 8-5-4 power retention, public beats and viewer privacy, plus current zero-power and Heroic checkpoint behavior.
- [x] Full local tests, typecheck, lint/build and glossary/reading evidence pass with DATABASE_URL=''; frozen legacy corpus unchanged. Owner data/fuzz/ruling limitations are explicit.

One bounded PR; coordinate battle/flow with #551/#607. No paid AI, live database, new dependencies or unrelated mechanics.

**Bounded delivery — 12 Oct 2026:** The rules VM separates the 8-5-7 and 8-5-10 checkpoints with persisted cleanup stages/cursors. Generic same-player Combo-to-own-Drop Autos enter pending before physical departures; battle-end and qualifying special Combo-card Autos enter pending afterwards. [Implementation evidence](evidence/609/implementation-proof.md) records the rule basis, named scenarios and old-main saved-pause proof. Root registered the proof, added an explicit Auto-before-departure event-order assertion, updated the language-reference fixture and inventoried every new guarded or unsupported source site. Full local tests, typecheck, lint and the default production build pass with DATABASE_URL=''. No frozen gameplay Snapshot or probe-digest fixture changed.

**Remaining #609 scope:** This is a partial delivery. A replacement that keeps or redirects a pre-announced subject, or changes its destination during 8-5-7, still interrupts explicitly under #609; no new-area information is invented. The repository has no real generic 8-5-6 card fixture, so this proof uses synthetic wording. The existing non-Battle Extra cleanup fixture is preserved without claiming a new interpretation of 8-5-8. Actual catalog/deck fuzz and any owner ruling remain unverified. #609 stays open for these boundaries; the legacy engine is unchanged.

**Native replacement follow-up.** Cleanup now freezes optional/competing replacement choices with an affected-owner answer and a saved per-subject cursor. Redirects, declines and interpreter substitutes occur once; captured replacement variables survive reload. Only the active substitute's own Combo subject movement is marked as cleanup, and its actual Drop occurrence joins the 8-5-9 special group alongside battle-end Autos. Registered synthetic proof covers wrong actor/index refusal, two-subject cursor, saved question-bearing and question-free substitutes, and actual hand-origin special timing. Already-preannounced generic subjects whose replacement changes the route/information remain explicit #609 interruptions before physical movement; this does not settle that projection rule or close #609.

**Root validation of the replacement follow-up:** Focused proof, typecheck, full lint, full `npm test` (both arena lanes 57/57, rules-only zero legacy calls, registered PGlite controls), generated capability check and production build passed with `DATABASE_URL` empty. The checkpoint resume is limited to native `battleEnd` cleanup. No frozen oracle expectation changed.

**Post-checkpoint replacement increment — 13 Oct 2026.** A replacement that 8-5-7 work installs for a subject whose generic Auto already resolved no longer interrupts: 8-5-8 processes the replacing event under 9-10-1 (master's choice under 9-10-2/2-1, a substitute through the saved frame), the resolved Auto is neither reversed nor announced again, and a subject that does not reach Drop supplies no 8-5-10-1 occurrence. Basis: 8-5-7 completes before 8-5-8; the generic Auto activated and resolved with the only route then in force; no manual rule reverses a resolved effect; 9-10-1 applies when the 8-5-8 event occurs. Registered synthetic proof: an Auto-installed mandatory Warp redirect (order: generic Auto, replaced departure, battle-end Auto), an Auto-installed competing Warp/hand choice asked of the master with JSON reload, wrong-actor refusal and both viewer Snapshots free of internal cleanup data, and a saved 8-5-7 pause whose subject gains [Ultimate] before 8-5-8 (moves to Removed once, then 8-5-10). [Evidence](evidence/609/replacement-gap-proof.md). The removed NotYet sites were `arena-vm-notyet-cleanup-answer-route`, `-answer-projection` and `-changed-destination`.

**Owner ruling still needed (the last #609 boundary).** If a replacement for a Combo card's move to Drop already exists when 8-5-6 is reached (an [Ultimate] subject, a P-182-style Combo-to-Warp, or an optional/competing offer not yet answered), the manual does not say (a) whether a “when a card in your Combo Area is placed in your Drop Area” Auto is announced at 8-5-6 at all — 9-10-1-1 treats the replaced Drop placement as never happening, but 8-5-6 announces before 8-5-8 — and (b) if announced, which new area 9-6-9-1-3 lets it read. The official card and game Q&A (searched 13 Oct 2026; nearest entries BT23-114, BT25-076, BT18-082, BT18-122) have no entry for this generic wording, and no repository card prints it. The rules VM keeps `arena-vm-notyet-cleanup-projected-choice` and `-projected-replacement` as explicit #609 interruptions until that ruling. The legacy engine has no generic 8-5-6 watcher and is unchanged.
