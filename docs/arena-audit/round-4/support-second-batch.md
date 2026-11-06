# Awaken payments and Extra invocation — 4 Nov 2026

PR #1249 continues toward complete support. This is an intermediate checkpoint, not completion.

## Integrated changes

**R-386, Awaken conditions (`df50abd6`).** Ten previously unread payments now retain their full printed conditions: BT19-002, BT19-100, BT20-055, BT20-114, BT29-029, BT17-001, BT10-031, BT20-054, BT14-121 and source-corrected BT26-031. A low-life alternative remains independent of the energy/material alternative. Four already-readable gates are corrected on BT19-068, BT22-054, P-434 and SD23-01. Named cards retain both colour and cost qualifiers, areas and controller; an omitted numerical bound remains unread. Sources: RM 22-2 and 9-1-3, plus the previously documented official BT26-031 image.

**R-420, Extra invocation (`e4523b9d`).** Effect-directed Extra activation supports hand, deck and Drop. A bare activation selects Main, Battle or Main/Battle; explicit skill kinds remain restrictive. Original Extra costs are waived under RM 12-2-4, while conditions, usage limits, negation and activation taxes remain. Hand/deck Extras enter Drop before resolving; Drop Extras stay there. Field activation retains priority. Saved card/line choices retain their area occurrence, and declining resumes the parent. Normal activation menus do not gain new origin permissions. Actual P-119 invokes BT5-025 from deck under P-119’s own FAQ; P-389 pays its seven-card cost and invokes BT8-137’s delayed Battle effect. The unresolved Battle-card invocation cost question is not covered by this Extra-only ruling.

## Verification and exact evidence

At combined head `df50abd6`, 130 native stored-rule Awaken scenarios, 70 Extra invocation scenarios and 52 condition scenarios pass in one process. At the preceding invocation head, the eight observational-condition and 62 actual-trigger scenarios also pass with the invocation suite in one process. Combined typecheck, Teach and rulings pass; changed-file lint and the applicable older suites passed on the workers. Invocation language roundtrips include deck, Drop and all-Activate forms. Tests include both seats, actual payment/effect resolution, negative gates, optional decline, hidden-card privacy, saved choices and same-id departure/reentry. No production data was accessed or refreshed.

Full-record artifact: `/tmp/arena-support5/combined/second-full.json`, SHA-256 `d83593656fe5ef3f612ec748ba0f9a23c951301cf69d9335272c6a654a7e0c77`. Against the first checkpoint, exactly **14 records change, all cost-only**, each identical to the reviewed worker result. Ten payments become readable; none becomes unreadable. [Changed-field evidence](support-second-program-diff.json). Extra invocation changes no compiled record; its improvement is runtime behavior.

Displayed reading totals remain **12,967 readable / 997 unread**. The additional readable-record runtime gaps fall from **73 to 63**; all 10 removals are restored Awaken payments. The broader runtime checker reports 379 records with extra reasons, including unread records, and 2,558 contextual unknowns that are not automatically unsupported. Reading totals alone would miss this entire checkpoint.

The previous 40-game fuzz receipt applies to its earlier head. The next combined runtime checkpoint will run fuzz again. The full integration gate remains deferred under the batch process. Surge prices, face-up-life events, paid-card references and further compiler/runtime families continue.
