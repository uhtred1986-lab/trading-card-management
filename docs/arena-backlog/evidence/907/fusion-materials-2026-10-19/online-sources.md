# #907 typed Fusion material contract — online source check

Scope: Current Masters rules for the standard [Union-Fusion] material set, plus the specified source permissions and granted line in #907. Fresh retrieval on **2026-10-19 UTC**. Official sources control; public discussion is secondary. This source check records the printed material and permission contract. It does not claim a card-specific ruling for every support clause or certify implementation coverage.

## Finding

For a standard [Union-Fusion] declaration, the player must have one distinct Battle Card for each specified character, and the specified cards must have equal power. The player activates [Union-Fusion] on a card in hand, reveals the complete eligible set, then moves one of each specified same-power Battle Card from hand to the Drop Area as the skill cost. If no eligible set can be revealed, the activation cannot be declared. The required type is Battle Card; the manual names no broader card-type substitute.

The manual separately recognizes card text that expands the areas from which a Fusion's materials may be chosen. Such permission changes the eligible source area for that card's Fusion; the checked wording does not say it waives the equal-power requirement. For the BT31-001 widened-source scenario already governed by the owner's 13 October 2026 ruling and #541 evidence, preserve the existing rule: the materials may be chosen across the permitted hand/Battle Area/Drop sources and equality compares printed power, including when a Battle Area material currently has a power modifier. This note does not expand that owner ruling into a new rule for every support card.

EX23-36 and P-519 currently list conditioned Drop-area choice permissions that return selected Drop materials to the bottom of the deck. Neither listing says to ignore equal power. The prior #930 inventory label “relaxed equal power (EX23-36, P-519)” is therefore misleading: no official text or FAQ located in this retrieval establishes an equal-power waiver. Their Drop-to-bottom support remains a separate, unimplemented support case; keep the standard equal-power rule unless affirmative authority changes it.

EX25-32 and P-308 each permit choosing Battle Cards in that Fusion card's owner's Warp when selecting materials from hand, then direct Warp materials to the Drop Area. They are source-and-destination extensions, not an equal-power exception. They are already covered as distinct printed Warp-permission wordings in `union-sources-930.ts`.

P-360's back-face Permanent grants red <Gogeta: Br> cards in hand a [Union-Fusion] line with the named <Son Goku: Br> and <Vegeta: Br> materials. The grant supplies another Fusion line; it does not change the manual's source, card-type, or equal-power conditions. BT17-082 is not a Fusion source extension: its back face permits cards under that Leader to pay skill costs for its Namekian [Union-Absorb] skills.

The official Card FAQ page has no entries for BT17-082, EX23-36, P-519, EX25-32, P-308, or P-360. Its BT1-107 Cold Bloodlust Q5 gives a general [Union-Fusion] Counter: Play window before the specified cards enter Drop and after; it does not address material-source permissions or equal power. The current errata page lists P-360's front-face Activate: Battle change, unrelated to the back-face grant. No card-specific FAQ ruling was found for the Drop-to-bottom interaction. This is an implementation/evidence gap for those support lines, not evidence that their printed source permission is broader than stated.

## Official sources

All sources below were fetched from Bandai's official Masters site on 2026-10-19 UTC. HTTP status, byte count, and SHA-256 identify the retrieved response bytes. The manual PDF itself prints “Masters Official Rule Manual ver.4.00” and “Last Updated: 01/09/2025”; that printed date is retained without choosing a locale interpretation.

### Masters Official Rule Manual, version 4.00

URL: [https://www.dbs-cardgame.com/pdf/rulemanual.pdf?ver_4.00](https://www.dbs-cardgame.com/pdf/rulemanual.pdf?ver_4.00)

HTTP 200; 2,941,038 bytes; SHA-256 `e1d1ddac037833bee4dd4e7ac8d3efe96f0fdfbffb91cada673b31fc38d77706`.

Relevant clauses:

- §2-1-2 lists five card types: Leader, Battle Card, Extra, Unison, and Z-Card. §22-13-4-2 specifically requires the specified character's Battle Cards.
- §22-13-4-1 says the named characters are the conditions for the [Union-Fusion] skill.
- §22-13-4-2: “can be activated by revealing 1 of each of the specified character’s Battle Cards from your hand, with each Battle Card’s power being equal. If such a set of cards can’t be revealed, you can't declare activation of [Union-Fusion].”
- §22-13-4-2-1 says text allowing Battle Cards in one of your areas to be chosen “expand[s] the conditions that can be fulfilled when choosing cards for a given keyword skill.” It does not state that other conditions are waived.
- §22-13-4-3: [Union-Fusion] can only be activated from a player's hand.
- §22-13-4-4: “players place one of each of the specified Battle Cards with the same power from their hand in the Drop Area as the skill cost.”
- §22-13-4-4-1 then requires any necessary skill cost to be determined and paid in full.

### Official Card Search listings

- [BT17-082 Piccolo, Supreme Power](https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=BT17-082): HTTP 200; 133,825 bytes; SHA-256 `7b0064f307934222ab1a065703a9f21dfec3676d8bd5a7b395ac943e1dccee74`. The back-face HTML gives the icon text as “When placing Battle Cards under other cards to pay skill costs for your 《Namekian》 [Union-Absorb] skills, you can use cards from under this card instead.” This names Absorb, not Fusion.
- [EX23-36 SS3 Gotenks, Overwhelming Power](https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=EX23-36): HTTP 200; 132,225 bytes; SHA-256 `94374b0f60d5779e55e3f8f56eda1e879c3f2a3c62c40143ce214eb6e905aa48`. Its skill names yellow Son Goten: GT and Trunks: GT; a conditioned Permanent allows choosing specified Battle Cards from Drop while choosing for this card's Union skill from hand, then places chosen cards at the bottom of the deck. It does not state that equal power is ignored.
- [P-519 SS3 Gotenks, Flying Fists](https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=P-519): HTTP 200; 132,022 bytes; SHA-256 `d0ddc8f159685bd3f03b4e7e48d5078064d06707b867526cdec7bb162acf3201`. Its skill names Son Goten: GT and Trunks: GT, both yellow; a conditioned Permanent permits choosing the specified Battle Card in Drop while choosing for this card's Union skill from hand, then places chosen cards at the bottom of the deck. No power waiver is printed.
- [EX25-32 SS4 Gogeta, Flash](https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=EX25-32): HTTP 200; 131,689 bytes; SHA-256 `27783be0b5fb7f4ec228309edc55aba699aa05d81415958992e1c619187c9bee`. Its Fusion names Son Goku: Xeno and Vegeta: Xeno. A Permanent allows choosing Battle Cards in its Warp and sends chosen Warp cards to their owner's Drop.
- [P-308 SS3 Gogeta, Thwarting the Dark Empire](https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=P-308): HTTP 200; 138,981 bytes; SHA-256 `1fe594ff9ed45a53096734c5cd2a1b0b4d6768acb8032fec0ff2fd0319937ea8`. Its Fusion names Son Goku: Xeno and Vegeta: Xeno. A Permanent allows choosing Battle Cards in its Warp and sends chosen Warp cards to the Drop. This is the earlier spelling with the same source/destination behavior as EX25-32.
- [P-360 Vegeta / SSG Vegeta, Crimson Warrior](https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=P-360): HTTP 200; 140,407 bytes; SHA-256 `09ee5e9dd20e0ab36d265d5e617793cddff5f8d031d2c8021a048fa780ad45`. The back face grants red Gogeta: Br cards in hand a [Union-Fusion] line naming Son Goku: Br and Vegeta: Br. The grant does not print a replacement material rule.

### Official Card FAQ, errata, and keyword reference

- [Official Card FAQ](https://www.dbs-cardgame.com/us-en/rule/card_faq.php): HTTP 200; 1,365,863 bytes; SHA-256 `75233787a3b2d245ff4fc34971c3a78e8402e12d29b4ee8d73b96e3315362001`. Exact-number search of the fetched page found no entries for the six card numbers above. BT1-107 Cold Bloodlust Q5 says a Counter: Play can be activated “before they place the specified card(s) in the Drop Area and play the card, or after.” It provides no card-specific ruling on the support permissions or altered-source material power.
- [Official errata list](https://www.dbs-cardgame.com/us-en/rule/errata-cards.php): HTTP 200; 356,382 bytes; SHA-256 `0ae8e4f719e4b263ec4ec85cbf14b6bf423d7021417ae109760c93be8897b696`. Exact-number checks found no entries for BT17-082, EX23-36, P-519, EX25-32, or P-308. P-360 is listed for its front-face mandatory discard wording; that entry does not concern the SSG Vegeta back-face grant.
- [Official keyword skills reference](https://www.dbs-cardgame.com/us-en/rule/keyword-skills.php): HTTP 200; 40,218 bytes; SHA-256 `d9dcfbb271b32867e4f8ebc0ed5b04ab6b9dd98bd56de72df8c451e7e9e0bedf`. Its summary describes [Union-Fusion] as placing one each of the specified same-power cards from hand into Drop and playing the Fusion card; the manual supplies the details above.

## Public forum checks

Public posts are secondary evidence and do not supersede the current manual. Reddit pages were read through a public web-content extractor on 2026-10-19 UTC; extracted-page response bytes and hashes were not exposed, so no content hash is claimed.

- [“Union fusion ruling”](https://www.reddit.com/r/DBS_CardGame/comments/uhz8m5/union_fusion_ruling/) asks whether materials are discarded or placed in Drop. A commenter quotes the older manual section and explains that a Battle Area card cannot be used absent a source extension; another commenter says Gogeta Xeno may use Warp. This is a casual explanation, not a current ruling on the extensions checked here.
- [“Union-Fusion, How it works?”](https://www.reddit.com/r/DBS_CardGame/comments/z4el6r/unionfusion_how_it_works/) asks whether 30,000 and 15,000 materials may be combined. A commenter says no, the pair must have the same power. This aligns with ordinary Fusion but does not discuss Drop-permission wording.
- [“union fusion”](https://www.reddit.com/r/DBS_CardGame/comments/reyg2c/union_fusion/) asks about SS3 Gogeta, Thwarting the Dark Empire; a commenter says the specified cards still need the same power. This concerns P-308's Warp permission generally, not a detailed answer about its mixed-area choices.

## Scope boundary

The official rule and card pages establish the standard named, one-each, Battle-Card, same-power set and the text printed on each support card. They do not supply a card-specific ruling for EX23-36/P-519's Drop-to-bottom permission, and no power waiver is printed. Keep that support behavior as an explicit implementation gap; do not turn the historical “relaxed equal power” inventory label into a rule. Existing BT31-001 owner-approved widened-source/equal-printed-power behavior remains in force for its bounded scenario. The P-360 grant and the EX25-32/P-308 Warp permissions remain separate typed clauses.
