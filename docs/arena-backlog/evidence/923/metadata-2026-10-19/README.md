# Exact eleven-row metadata proposal

Preparation only. No live database connection or write was performed. Applying this proposal requires separate explicit owner approval of its exact digest; approval of the separate #825 proposal does not authorize it.

The public `cards.json` and `programs.json` pin three catalog identities and eleven existing compiler-owned draft records. The proposal adds only versioned usage and validity metadata. Existing costs, combo contracts, effects, conditions, triggers, printed source, readings, statuses, review fields and private fields are preserved. A successful write increments each changed row version once and updates its timestamp. No effect recompilation or confirmation occurs.

`proposal.json` is a safe preview of the full private readback snapshot. Its digest binds full-row snapshot hashes without exposing private reviewer fields. The private source and payload remain outside the checkout. The writer locks and compares all eleven full rule rows and all three full catalog rows in one atomic guarded statement; any source, private-field or program race refuses every write. Stale approvals and replay cannot apply again.

All eleven projected rows admit through the existing stored-rule loader. This is metadata admission, not a whole-deck qualification: **BT3-070/front/0 still has a separate native Union-Absorb identity authority residual**. No VM or policy behavior changes in this proposal.

Run the default dry-run with `scripts/arena-metadata-923.mts --snapshot <full-private-readback>`. The optional private payload must be outside every checkout. Offline mode cannot apply. The focused `scripts/verify/metadata-923.mts` proof uses local PGlite and synthetic private fields; it makes no live connection.
