# Production offline match proof (#793)

`arena:offline-decks-browser` proves the local production build with PGlite packs and placeholder
pictures. It does not prove the deployed site's real downloaded decks. The separate driver below
uses only an existing prepared Chrome profile. It supplies no pack, art, API response, or fixture.

Prepare a **dedicated proof profile**, online, on a machine allowed to reach the production site:
launch installed Chrome with `--user-data-dir=<absolute proof profile>`, sign in using the authorized
account, download the real decks from their deck pages, and prepare `/arena/offline` until READY.
For the current acceptance, download deck 17 (The Crimson Saiyan) and deck 19 (Pride of the Saiyans).
Quit every Chrome process using that profile before running the driver. This does not use or copy
credentials from another browser. Keep the prepared profile private; never attach it to a PR.

From the checkout, with the existing lockfile dependencies and installed Chrome:

```bash
npx tsx scripts/arena-production-offline-proof.mts \
  --profile /absolute/path/to/proof-profile \
  --decks 17,19 --output /absolute/path/to/proof-evidence
```

Set `CHROME_PATH` if `scripts/lib/cdp.mts` cannot locate Chrome. There is no Playwright dependency.
The command starts a new browser on that profile with a closed loopback proxy, applies page offline
emulation before navigation, and disables QUIC. The proxy prevents all HTTP traffic, including
service-worker fetches. This is deliberate network disconnection after authorized preparation;
it cannot grant access to a destination denied by the environment. It does not change the cloud
network policy or production settings. The cached shell must open under service-worker control,
`navigator.onLine` must be false, and uncached fetches from both the page and the service worker
must reject before any match starts. A missing profile, missing deck, cache failure, interrupted
match, or timeout makes the run fail.

The matrix has eight complete matches: each marked deck against starter A in first and second
seat, plus each marked deck against the other marked deck in first and second seat. This checks
both decks as the human deck and the computer deck. The human actions use the existing deterministic
`humanPick` driver through the page's real board methods; the computer uses the real local worker.
Each result must reach `over` with an explicit `win` outcome (draws, concessions and interruptions
do not satisfy this proof) and have a saved device journal with matching decks, human seat and
final revision and at least one committed decision. Match/provider attempts, uncached successful
responses and requests for CDN art fail the run. The command adds these saved matches to the proof profile; it never removes decks,
resets the device, calls a provider, or writes to the server/database.

The existing preparation page attempts a deck freshness GET (`/api/arena/offline/decks`) on
each load even while offline. These informational reads are blocked and logged; they are not
match/provider requests and are not allowed to reach the server. Every other API/provider
attempt fails the proof.

`report.json` includes origin, service-worker URL, offline challenges, deck names, match journal
headers/traces, pinned pack facts, and response observations. A screenshot shows the offline deck
list and each final board. Reports are written after each match and at failure, so an incomplete
run remains visibly incomplete. Review evidence before posting it; the screenshots include deck
names. The profile is retained. Use `--url http://localhost:<port>` only to validate the driver
against a separately prepared local build; its report sets `productionOrigin: false` and is not
production acceptance evidence.

On 14 October 2026 this cloud environment denied the production destination at the HTTP proxy
(`CONNECT` returned 403) and did not expose the previously prepared built-in-browser profile.
Production acceptance therefore remains pending. A harness run or READY status must not close #793;
attach a successful production-origin report and final screenshots after the allowed, authenticated
preparation and the complete offline run.
