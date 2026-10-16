# Gogeta Warp permission validation

Implementation head before this evidence-only commit: `512377ba` (includes Battle Card material restriction and exact language fixture). No production writes, migrations, paid calls or layout changes.

Passed on Node24 with DATABASE_URL unset: typecheck; lint (only5existing prototype warnings); complete npmtest chain including92/92arena suites; production build. `contract:emit` passed92/92; reviewed language reference adds only permission enum/documentation, and two probe digests change while their notOffered outcomes remain unchanged. Final language fixture regenerated after expanding explanatory text; subsequent full npmtest passed.

Focused printed-card→stored-record→VM tests prove all3cards ×4material-area combinations, exact names/equal power/Battle type, foreign and stale selection rejection, self scope, wrong Leader color/opponent-energy gating, mid-choice serialization and ordinary6-energy P-286 play versus3-energy Fusion plus materials. Normal-play restriction remains enforced. Existing BT31-001 area-permission suite, language roundtrip and backlog verifier pass.

Compiler corpus:6552Masters cards/17327skills, exactly3Permanents change,3354→3351unread clauses. See gogeta-compiler-delta.json.

Limitations: #932 Saiyan-only Leader predicate is still too broad; #929 Union Counter windows/failure behavior remain incomplete. Neither #924 nor the wider #923 audit is closed. General Union material/cost/Potara/compound-tag/support/errata gaps remain in their focused issues. Database-backed fuzz and production rule refresh were not run; coordinator owns those and combined-main validation. No queued follow-up work was started after owner asked to stop.
