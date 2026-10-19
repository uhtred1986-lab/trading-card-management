# Online rules and errata cross-check — 19 October 2026

Scope: the typed activated-payment slice, BT11-013, BT3-070, P-360 and Fusion payment timing. These are fresh online reads on **2026-10-19 UTC**, completed by 10:29 UTC, rather than conclusions copied from the 15 October #923 inventory. Requests used Python `urllib` with a browser User-Agent; official pages and the manual returned HTTP 200. SHA-256 values below identify the retrieved **response bytes**. The PDF was read with `pdftotext -layout`. No database or application write was performed for this research, and no complete source mirrors are committed.

## Findings that affect the delivery claim

1. **Existing Fusion payment timing is a known discrepancy.** The current official manual requires the specified equal-power materials to enter the Drop, **then** the necessary skill cost to be determined and paid. The existing engine/#926 scenario charges energy at declaration before asking for materials, while its draw action is paid after those materials. The typed-payment change preserves that existing sequence; it does **not** establish the full Union payment-order contract. Keep the discrepancy as a #907 blocker and repair the payment checkpoint before claiming procedural qualification. This is an exposed existing behavior, not a rule change established by this research.
2. **BT11-013 reference attribute drift:** the official card lists **20000 power**, whereas the historical #926 fixture and the initial new #907 fixture used 35000. Its Union text and payment match the reference. The coordinator is correcting the new reference fixture and rerunning its focused proof; the historical control is retained as dated evidence. This difference is source/fixture attribute drift, not evidence that a rule changed.
3. **BT3-070 must use its erratum.** The live official card list still says “choose up to 1 each,” but links to the errata page, whose correction makes that **“choose 1 each.”** The current #930 proof uses the corrected mandatory pair. Do not regenerate from the stale card-list wording without the errata overlay.
4. **P-360 has an erratum on its front-face Activate: Battle cost.** It changes “Choose up to 1” discard into “Choose 1.” This does not change the back-face Permanent granting Union-Fusion; the live back-face text and the typed-grant reference agree. The live card-list front still displays the older wording, so the errata overlay remains necessary there too.
5. **Community confirmation is limited.** Search results exposed relevant public Reddit discussions, but direct Reddit thread, old-Reddit and JSON requests returned HTTP 403. Only the indexed previews listed below were read; no inaccessible replies are asserted as rules authority. Official rules and errata determine the conclusions above.

## Official sources

### Masters Official Rule Manual

URL: [https://www.dbs-cardgame.com/pdf/rulemanual.pdf?ver_4.00](https://www.dbs-cardgame.com/pdf/rulemanual.pdf?ver_4.00)

Retrieved: 2026-10-19 UTC; HTTP 200; 2,941,038 bytes.

SHA-256: `e1d1ddac037833bee4dd4e7ac8d3efe96f0fdfbffb91cada673b31fc38d77706`.

The retrieved document identifies itself as **Masters Official Rule Manual ver.4.00**, “Last Updated: 01/09/2025.” This records the document's own date string without choosing a locale interpretation.

Relevant short excerpts:

- §22-13-4-4: “players place one of each of the specified Battle Cards with the same power from their hand in the Drop Area as the skill cost.”
- §22-13-4-4-1: “Then, if there is a necessary skill cost, determine that cost and then pay it in its entirety.”
- §22-13-6-1: “[Union-Absorb] skill cost : effect.”

Also checked: §5-8-2/-2-2 requires complete payment and complete performance of an action price; §5-8-3 prohibits declaring an unpayable action; §5-8-4 says a payment failure causes activation failure and no resolving effect. §22-13-6-2/-6-3 confines Absorb to the Battle Area and describes playing the specified target on top of its source. These support the payment/refusal and failure cases; they do not erase the Fusion sequence discrepancy above.

### BT11-013 official card listing

URL: [https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=BT11-013](https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=BT11-013)

Retrieved: 2026-10-19 UTC; HTTP 200; 131,800 bytes.

SHA-256: `661688a6a969959450d9a856a527cd81b3fc794d58cf0c0fc41abc5085823b70`.

The page labels the card “Gogeta, Fusion of the Gods.” Its HTML has three `red_ball.png` icons after `Union-Fusion.png`, then the text “, draw 2 cards : Red 〈Son Goku : Br〉 and red 〈Vegeta : Br〉.” Empty image `alt` values must not be mistaken for missing payment orbs.

Exact relevant printed attributes: BATTLE; Red; power **20000**; energy cost **5**, with **three red specified-cost icons** (Red3 + generic2); combo energy **0**; combo power **5000**; character **Gogeta : Br**; trait **Saiyan**; era **DBS : Broly Saga**. The Union activation separately costs **Red3 plus draw2**. Its other listed skills are Deflect, the cannot-be-KO'd Permanent, and the Leader-red-conditioned on-play Auto. This research checks the reference source; the synthetic materials and staged board are not a complete real deck.

### BT3-070 official card listing

URL: [https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=BT3-070](https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=BT3-070)

Retrieved: 2026-10-19 UTC; HTTP 200; 131,598 bytes.

SHA-256: `5bdedc6fb6973c02e349601030dba23d8dc03b7e290112ff6b7aa57a1a5365de`.

The live page contains the Union-Absorb green orb and the older optional-pair wording, plus an explicit link to `../rule/errata-cards.php#BT3-070`. Its printed card energy cost is 4 and power is 20000. The #930 scenario is a focused skill-text fixture with staged attributes; it must not be represented as an exact full catalog card export. The corrected text is established by the errata entry below.

### P-360 official card listing

URL: [https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=P-360](https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=P-360)

Retrieved: 2026-10-19 UTC; HTTP 200; 140,407 bytes.

SHA-256: `09ee5e9ddad20e0ab36d265d5e617793cddff5f8d031d2c8021a048fa780ad45`.

The back face “SSG Vegeta, Crimson Warrior” says red Gogeta : Br cards in hand gain a skill. The skill HTML contains `Union-Fusion.png`, `red_ball.png`, `blue_ball.png`, and `two.png`, followed by the Son Goku : Br and Vegeta : Br material description. Thus the granted activation price is **Red1 + Blue1 + generic2**, matching the stored typed grant reference. This confirmation applies to the grant, not every front/back skill of P-360.

### Official card errata

URL: [https://www.dbs-cardgame.com/us-en/rule/errata-cards.php](https://www.dbs-cardgame.com/us-en/rule/errata-cards.php)

Retrieved: 2026-10-19 UTC; HTTP 200; 356,382 bytes.

SHA-256: `0ae8e4f719e4b263ec4ec85cbf14b6bf423d7021417ae109760c93be8897b696`.

The BT3-070 entry is dated **2018.3.2** and lists Before “choose up to 1 each” / After “choose 1 each”; its note says the erratum applies from series 3's release. The P-360 entry is dated **2022.2.10**, names “Vegeta/SSG Vegeta, Crimson Warrior,” and changes the front-face Activate: Battle hand discard from optional to mandatory. No BT11-013 entry was found in this fetched errata page; this is a page-specific absence, not a claim about every possible announcement.

### Official card FAQ

URL: [https://www.dbs-cardgame.com/us-en/rule/card_faq.php](https://www.dbs-cardgame.com/us-en/rule/card_faq.php)

Retrieved: 2026-10-19 UTC; HTTP 200; 1,365,863 bytes.

SHA-256: `75233787a3b2d245ff4fc34971c3a78e8402e12d29b4ee8d73b96e3315362001`.

The fetched complete FAQ page contains a BT3-070 entry about looking through the deck during a search, including the answer “Resolve the skill as quickly as possible.” It does not establish an exception to payment timing or the mandatory material erratum. No BT11-013 or P-360 card-specific entry was found by exact card number in this fetched page. Their payment claims therefore use the manual, current card listing and relevant errata, rather than an invented card-specific FAQ.

### Official keyword reference

URL: [https://www.dbs-cardgame.com/us-en/rule/keyword-skills.php](https://www.dbs-cardgame.com/us-en/rule/keyword-skills.php)

Retrieved: 2026-10-19 UTC; HTTP 200; 40,218 bytes.

SHA-256: `d9dcfbb271b32867e4f8ebc0ed5b04ab6b9dd98bd56de72df8c451e7e9e0bedf`.

Its short Union-Fusion description requires the named cards to have the same power and be placed from hand into the Drop; the Potara entry describes stacking the two specified cards, and Absorb refers to the effect's specified area and target. These are summaries. The more precise manual controls the additional payment order; this page does not authorize charging Fusion energy ahead of the material movement.

## Public forum search and retrieval limitations

Community material is kept separate from Bandai rulings. No forum comment is used to override the official sources.

Search URL: [https://html.duckduckgo.com/html/?q=site%3Areddit.com/r/DBS_CardGame%20%22Union%20Fusion%22%20%22cost%22](https://html.duckduckgo.com/html/?q=site%3Areddit.com/r/DBS_CardGame%20%22Union%20Fusion%22%20%22cost%22)

Retrieved 2026-10-19 UTC, HTTP 200; SHA-256 `92da29982681d9d3c7c6956856b17a30929e1104879c3d15336877765dc97db2`.

Search URL: [https://html.duckduckgo.com/html/?q=%22Gogeta%2C%20Fusion%20of%20the%20Gods%22%20reddit](https://html.duckduckgo.com/html/?q=%22Gogeta%2C%20Fusion%20of%20the%20Gods%22%20reddit)

Retrieved 2026-10-19 UTC, HTTP 200; SHA-256 `4f813a920e9c51c699c00b313f0afe5e06caac2e3b1da59bebed0121dd66376b`.

Read indexed previews:

- [Union-Fusion discussion](https://www.reddit.com/r/DBS_CardGame/comments/qqs8ua/unionfusion/): the preview asks whether Fusion materials must have the same energy cost as well as the same power. The manual and official keyword entry require the same power; the preview is a question, not a ruling.
- [Union fusion question](https://www.reddit.com/r/DBS_CardGame/comments/9ropzm/union_fusion_question/): the preview similarly asks whether a Gogeta's two materials need the same cost. Its replies were not obtained.
- [Gogeta, Fusion of the Gods discussion](https://www.reddit.com/r/DBS_CardGame/comments/q0k9pb/gogeta_fusion_of_the_gods/): found by the exact card-title search, but its indexed preview contains no substantive ruling and the thread could not be read.

All three direct thread requests returned **HTTP 403 Forbidden** on 2026-10-19. Additional requests to [old Reddit search](https://old.reddit.com/r/DBS_CardGame/search?q=union+fusion+cost&restrict_sr=on) and [Reddit search JSON](https://www.reddit.com/r/DBS_CardGame/search.json?q=union%20fusion%20cost&restrict_sr=on&limit=10) also returned 403. No discussion response body was retained, so no discussion-content hash or reply quotation is available. Search-response hashes identify only the indexed previews that were actually read.

Bounded extra searches for the exact P-360 Union grant, Android 13 errata, and Fusion draw/payment terms returned no useful matching discussion. Search absence and access failure are evidence limits, not confirmation of a rule.

## Disposition

The typed payment representation agrees with the official printed costs and corrected BT3-070 mandatory material price. The source check adds an explicit existing Fusion payment-order blocker and corrects the new BT11-013 reference attribute. It does not qualify a deck, certify full Union procedure/trigger behavior, or authorize rewriting protected records. No online source found here justifies treating the earlier energy-before-material implementation as an official exception.
