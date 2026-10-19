# Typed defensive decisions: official source check

Retrieved 2026-10-19 UTC. Exact card-page URLs, response bytes and SHA-256 are in `online-sources.json`; both returned HTTP 200. These are public official Masters sources. No account, provider call or database was used.

- [BT31-142 Cell’s Kamehameha](https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=BT31-142): Activate Main/Battle; draw 1, then choose up to 1 own white Battle Card for +10000 power for the turn. The additional opponent-Battle-Card Drop effect applies on the activating player's turn. The defensive proof is on the opponent's turn; that conditional effect is inactive.
- [DB1-019 Niagara Drop](https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=DB1-019): Activate Battle; requires a red Saiyan Leader; choose one own Leader or Battle Card for +5000 power for the turn. At life 3 or less on the opponent's turn, additionally ready up to one red energy and draw one. The target proof uses life above 3 and verifies both Leader and Battle modes.

The official card pages encode timing tags and specified costs as images; stripping HTML alone loses those symbols. The implementation uses the committed catalog definitions and stored executable records, rather than scraping these pages at runtime.

## Rules and errata cross-check

Reused the same-day official retrieval recorded in `../../907/evolution-identity-2026-10-19/online-sources-receipt.json` (no second fetch needed):

- [Masters manual v4.00](https://www.dbs-cardgame.com/pdf/rulemanual.pdf?ver_4.00), retrieved 13:07:11Z, 2941038 bytes, SHA-256 `e1d1ddac037833bee4dd4e7ac8d3efe96f0fdfbffb91cada673b31fc38d77706`. Sections 9-4-2 through 9-4-5 distinguish declaring the selected skill, paying its cost, Counter timing and resolving its effects; 9-7 and 22-10 define Counter timing and types. Facts must describe the selected offered skill and actual payment route.
- [Official card FAQ](https://www.dbs-cardgame.com/us-en/rule/card_faq.php), retrieved 13:07:20Z, SHA-256 `75233787a3b2d245ff4fc34971c3a78e8402e12d29b4ee8d73b96e3315362001`.
- [Official errata](https://www.dbs-cardgame.com/us-en/rule/errata-cards.php), retrieved 13:07:25Z, SHA-256 `0ae8e4f719e4b263ec4ec85cbf14b6bf423d7021417ae109760c93be8897b696`.

Neither fetched FAQ nor errata HTML contained either exact card ID. This is an exact-ID search result, not a claim that no broader ruling could apply. No new timing interpretation or card effect is introduced: these checks confirm the printed defensive amounts/targets while policy authority comes from the executable program. Hidden-dependent, dynamic and unsupported paths remain unknown. No community source is treated as rules authority.
