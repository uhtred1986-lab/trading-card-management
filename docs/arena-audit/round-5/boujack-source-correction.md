# Boujack catalog quantity correction

On 6 November 2026, the official [BT25 card list](https://www.dbs-cardgame.com/europe-en/cardlist/?category=428025&search=true) and [BT25-083 card image](https://www.dbs-cardgame.com/images/cardlist/cardimg/BT25-083.png) both confirm a maximum of one opposing Unison for Boujack, Tournament Assault's attack Auto. The frozen catalog export omits that quantity.

`src/lib/catalog/errata.ts` restores only the missing numeral for this card. Already numbered text remains unchanged. A local check against the complete frozen card source confirms the exact one-fragment correction, idempotence and preservation of an explicit different quantity; changed-file lint passes. No database or catalog refresh runs.

This is a source correction, not admission of the historical paid-count Auto. Its complete face-up Z-Deck payment, per-card marker removal and conditional bonus still need native support. The next combined compiler scan will account for any record changes; checkpoint76's measurements predate this correction.
