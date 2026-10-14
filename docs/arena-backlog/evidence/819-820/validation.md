# Consolidated validation, 14 October 2026

Code head: `b079d13`, including main `e2a40e8` (#822). The subsequent evidence-only commit records these results.

- `env -u DATABASE_URL npm run typecheck`: passed.
- `env -u DATABASE_URL npm run lint`: passed, with five existing prototype warnings.
- `env -u DATABASE_URL npm test`: complete chain passed on this code head, including 87/87 arena suites and 108 builder round-trips.
- `env -u DATABASE_URL npm run build`: passed on the same final code.
- `contract:emit`: 87/87 suites passed; reviewed four-line language-reference addition for `minCount`.
- Saved 27-row review compiler-shape check: passed. This is not a gameplay proof of its three held rows.
- Offline driver: eight complete matches against a separately prepared local production build; see `../793/README.md`. This is not production-origin evidence.

No production database writes were made. The required real-deck fuzz gate remains unrun: the environment denies `api.vercel.com`, needed to retrieve this app's database connection; the inherited database URL belongs to another app. Full catalog comparison also remains unavailable (`api.deckplanet.net` resolution failed); `scoped-readings.json` records two expected changed cards and seven unchanged controls.

Production offline proof still requires permitted access to the production site and an authenticated, prepared dedicated Chrome profile. The new driver supplies real offline disconnection without the built-in browser toggle. Follow `docs/arena-production-offline-proof.md` and retain the production report before closing #793.

Keep the consolidated PR draft and issues #819/#820/#793 open pending the remaining acceptance evidence. Revalidate the 27 live draft rows before any proposed database changes; the saved audit is a historical snapshot.


# Merge review, 15 October 2026

This section supersedes the environment blockers and draft recommendation above. The owner
explicitly deferred #793’s production-origin offline test to after deployment on 15 October.
Its local fixture proof remains labelled local, and #793 stays open.

The reviewer found a payment bug introduced by reading the bounded selector before an Auto’s
colon: the strict payment host still owed the ceiling (two), rejecting a legal payment of one.
Commit `e4043742` fixes affordability and payment completion to require the minimum, and
uses that same minimum for voluntary replacement offers. The new regression fails on the
previous code and passes on the fix, covering one/two, decline, one available and zero
unavailable; a named full BT8-025 Auto checks the power effect after either payment.

Evidence:

- [Full catalog comparison](full-readings-diff.json): all 6,552 production-catalog DBS cards,
  13,615 skill records, against main `5b22945a` (compiler records unchanged from `e2a40e88`); eight changed records reviewed individually,
  13,607 identical. Includes the four changed Auto payment records (both BT9-128 faces),
  BT7-127’s Life effect, and EX07-11’s remaining unread dual-character play.
- [Live rule audit](live-rule-audit.json): all 27 historical candidates still compiler-owned
  drafts with current printed text; explicit face identifiers prevent confusing BT29-029’s
  back-side draft with its user-corrected front Awaken. The two separate investigation rows
  are still stored with their old readings. No catalog or rule rows were written.
- [Fuzz-40 summary](fuzz-40.json): 40 real-deck games, zero crashes, 32 wins and eight typed
  unsupported-mechanic interruptions. The same 40 seeded outcomes are identical on main;
  no new interruption or unfinished-at-limit game. Uses stored records, not fresh compilation.
- Editor reviewed before/after at [390](editor-before-390.png) / [390](editor-after-390.png)
  and [1440](editor-before-1440.png) / [1440](editor-after-1440.png). Existing layout preserved.
  [Bounded phone chip](editor-range-390.png) and [desktop chip](editor-range-1440.png) display
  “1 to 2”; a CDP interaction verifies changing to up-to removes MIN in the serialized rule.

Final integrated code head: `2316e8abb8d7f41074ac381fe76044841b789c7a`, including
main `5b22945a` (#808). All passed on that code: typecheck, lint (zero errors,
five existing prototype warnings), the complete `npm test` chain (87/87 arena suites,
108 builder round-trips, including the new phone/combat checks), production build,
and `contract:emit` (87/87). Emission introduced no further fixture changes; this PR’s
only contract diff is the reviewed four-line `minCount` language-reference addition.
The authenticated 244-file backlog drift/path check is clean. Subsequent changes only
record these results and update evidence; source, scripts, dependencies and contract
are identical to this validated code head.
Catalog/stored-rule refresh remains a separate reviewed operation and must recheck row versions
at write time. The three historical partial-payment candidates remain held.
