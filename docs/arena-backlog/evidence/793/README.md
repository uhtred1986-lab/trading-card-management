# Offline proof driver validation

This is **local fixture evidence**, not the missing production proof for #793.

The driver at `scripts/arena-production-offline-proof.mts` cold-started a separately
prepared local production build with PGlite decks and placeholder images. All eight
cases reached a played win, persisted their final journal and displayed the expected
result. Uncached page and service-worker probes failed. No successful uncached HTTP
response, match/provider request or CDN artwork request occurred. Nine blocked deck
freshness reads were retained in the report.

- [Raw report](local-driver-report.json), explicitly `productionOrigin: false`.
- [Representative settled result](local-driver-result.png).

The source was built from `ff2b7d5`; the final driver is commit `00c2880` on the
worker branch, integrated with the equivalent cherry-pick in the consolidated PR.
The report records the pinned pack's source and build identity for each match.
Production host access and an authenticated, prepared dedicated Chrome profile
remain necessary. Follow `docs/arena-production-offline-proof.md`; do not close #793
using these local fixtures.
