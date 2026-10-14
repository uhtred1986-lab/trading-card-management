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
