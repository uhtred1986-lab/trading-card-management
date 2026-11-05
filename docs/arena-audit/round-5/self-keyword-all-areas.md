# R478: self keyword negation in all areas

The 45 exact self/possessive Permanent clauses in checkpoint 42 that negate a named keyword “in all areas” all name Energy-Exhaust. The complete records match checkpoint 40. The compiler previously discarded the source-area qualification and the standing-effect walker suppressed the negation outside play.

The stored `allAreas:true` qualification now survives compilation, DSL and macro lowering. The walker projects only the qualified self negation, preserving conditional wrappers. It does not widen sibling effects or target-wide auras. Validation rejects non-self, timed and unrelated primitive uses of the qualifier. All affected legacy records, including confirmed/corrected records, require rebuilding rather than executing an unqualified operation. Hidden or negated source skills contribute no negation.

BT8-120 and EX18-05 demonstrate why future Energy entry handling must inspect keyword validity before placement: the arriving card can satisfy its own multicolor/trait condition afterward. BT14-151 demonstrates why that inspection must follow any optional payer effects: moving an Android out of Drop can change the threshold. R478 fixes observation only; native Energy mode ordering and the six optional pre-entry procedures remain separate R476 work.

Validation: `self-keyword-all-areas-5.ts` passes 48 checks, covering both seats/eight areas, stale records in all four statuses, DSL/macro round trips, invalid qualifiers and unavailable source skills. The independent R476 mode preparation suite passes 26 checks of the three actual printed conditions and explicit-mode controls. Existing negation-area (52) and static-layers-553 checks pass. Language fixtures were regenerated with targeted `language.ts --emit`; typecheck and touched ESLint pass.

Full corpus comparison against the R475 integrated baseline changes exactly 45 records, only the source qualification and its reading. Counts remain 6,597 cards, 13,964 records, 12,999 readable/965 unread. No new optional-card support, full gate, database operation or deployment is claimed.

Local evidence: `/workspace/shared/arena-support5/conditions-r476/r478-{full,diff}.json`, `all-area-keyword-census.json`, and `r478-{type-freeze,lint-last,language-emit-last,static}.log`.
