# Union-Fusion payment order and Auto timing — 19 October 2026

Scope: Current Masters rules and public discussion relevant to the Union-Fusion payment sequence for BT11-013 Gogeta, Fusion of the Gods and the P-360 SSG Vegeta, Crimson Warrior grant. This is a fresh online retrieval on **2026-10-19 UTC**. It establishes the order of Fusion materials and any additional skill cost, and the handling of Auto skills triggered by the material move. It does not establish an unlisted checkpoint inside the payment procedure.

## Finding

The current official manual directs players to place one of each specified same-power Battle Card from hand in the Drop Area as the Union-Fusion skill cost (§22-13-4-4), **then** determine and pay any necessary additional skill cost in full (§22-13-4-4-1). That means a Fusion with an added energy cost pays its materials first and its added energy cost second. Charging that energy before moving the materials conflicts with the current printed sequence.

Autos whose trigger condition is fulfilled by the material move become pending when that condition occurs (§9-6-2; summary §1-5-6). They are activated and resolved at a checkpoint (§4-2-1; §§1-5-6-3, 9-6-3), not synchronously as part of moving a material. The manual's Union-Fusion payment sequence and general Activate procedure (§9-4) do not insert a checkpoint between material placement and determination/payment of the rest of the cost. Therefore such Autos remain pending while the additional skill cost is determined and paid. A pending Auto cannot resolve in that interval and alter the in-progress cost. Any continuous effects that apply to the skill cost at its determination point still need to be evaluated under the ordinary cost rules.

The rules identify the Auto's **next checkpoint** as its resolution point but do not name an extra checkpoint inside §22-13-4-4/4-4-1 or specify its exact next location after a completed or failed Union-Fusion attempt. Do not infer an inserted checkpoint between material movement and added-cost payment. If the additional cost cannot be paid after the materials have moved, §5-8-4 says the skill activation fails and its effect does not resolve; the separately triggered Auto is still pending for the next checkpoint.

Official Card FAQ BT1-107 Cold Bloodlust Q5 independently describes the Counter: Play window for Union-Fusion as before the specified card(s) enter the Drop Area or after the Fusion card is played. This supports the cost/effect boundary and gives no mid-cost response window. The FAQ is corroboration; the manual supplies the controlling payment order.

## Official sources

### Masters Official Rule Manual, version 4.00

URL: [https://www.dbs-cardgame.com/pdf/rulemanual.pdf?ver_4.00](https://www.dbs-cardgame.com/pdf/rulemanual.pdf?ver_4.00)

Retrieved 2026-10-19 UTC, HTTP 200, 2,941,038 bytes. SHA-256 of response bytes: `e1d1ddac037833bee4dd4e7ac8d3efe96f0fdfbffb91cada673b31fc38d77706`. The PDF identifies itself as “Masters Official Rule Manual ver.4.00” and says “Last Updated: 01/09/2025” (date retained as printed, without selecting a locale interpretation). Downloaded response was converted with `pdftotext -layout` for exact section reads.

Relevant excerpts:

- §22-13-4-4: “When activating [Union-Fusion], players place one of each of the specified Battle Cards with the same power from their hand in the Drop Area as the skill cost.”
- §22-13-4-4-1: “Then, if there is a necessary skill cost, determine that cost and then pay it in its entirety.”
- §9-4-2 / §9-4-2-1 / §9-4-3: an Activate skill is declared; any necessary skill cost is determined and paid in its entirety; then the skill is activated.
- §9-4-4 / §9-4-5: Counter timing follows activation; then the effects resolve.
- §4-2-1: “Checkpoints are moments in gameplay when rule processing (21-1-2-2) is performed, when activation of [Auto] skills (9-6) is declared/resolved, and when unresolved delayed effects are resolved.”
- §1-5-6: Autos “automatically enter pending status when the trigger condition ... is fulfilled,” and “are activated and resolved at a checkpoint.”
- §1-5-6-3: “If an [Auto] skill’s trigger condition is fulfilled outside of a checkpoint, the skill is activated and resolved at the next checkpoint that occurs.”
- §9-6-2: “If the trigger condition of an [Auto] skill is fulfilled, that [Auto] skill is made pending.”
- §9-6-3: “When a checkpoint occurs,” its master chooses and activates one pending Auto.
- §9-2-1: “from the time when the activation of a certain skill is declared until that skill’s effect is resolved—other activated skills can’t interrupt the first skill or be resolved.” (Counter skills have the separately stated counter timing.)
- §5-8-2-3: an activated effect that modifies a skill cost is treated as fully paying the cost after the modification; this does not itself insert a checkpoint in the cost procedure.
- §5-8-4: “If an effect causes an attempt to pay a skill cost to fail, the skill’s activation also fails. Skills whose activations fail don’t activate, and their effects don’t resolve.”

### Official Card FAQ

URL: [https://www.dbs-cardgame.com/us-en/rule/card_faq.php](https://www.dbs-cardgame.com/us-en/rule/card_faq.php)

Retrieved 2026-10-19 UTC, HTTP 200, 1,365,863 bytes. SHA-256: `75233787a3b2d245ff4fc34971c3a78e8402e12d29b4ee8d73b96e3315362001`.

Under BT1-107 Cold Bloodlust Q5, “When can you activate [BT1-107 Cold Bloodlust] against your opponent’s [Union-Fusion] skills?”, the answer says: “When your opponent activates and pays the cost for [Union-Fusion], you can activate [Counter: Play] either before they place the specified card(s) in the Drop Area and play the card, or after.” The answer continues that to stop the Battle Card's “when you play this card” Auto from activating, the Counter: Play skill must be activated after the Union-Fusion skill activates and before it resolves.

Exact-number checks on this fetched FAQ page found no BT11-013 or P-360 entry. No card-specific FAQ ruling is claimed for their payment/checkpoint timing.

### Official card listings and errata

- [BT11-013 Gogeta, Fusion of the Gods](https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=BT11-013): HTTP 200, 131,800 bytes, SHA-256 `661688a6a969959450d9a856a527cd81b3fc794d58cf0c0fc41abc5085823b70`. Listing gives red, power 20000, energy cost 5, and Union-Fusion text “draw 2 cards : Red 〈Son Goku : Br〉 and red 〈Vegeta : Br〉.” The listed energy cost is Red3 + generic2; the 2-card draw is the additional skill cost. The ordinary 5 energy cost of playing this Battle Card is not its skill cost.
- [P-360 Vegeta / SSG Vegeta, Crimson Warrior](https://www.dbs-cardgame.com/us-en/cardlist/?search=true&free=P-360): HTTP 200, 140,407 bytes, SHA-256 `09ee5e9dd20e0ab36d265d5e617793cddff5f8d031d2c8021a048fa780ad45`. The SSG Vegeta face grants red Gogeta : Br cards in hand the Union-Fusion skill; its displayed material line is Son Goku : Br and Vegeta : Br. This is a granted skill and does not alter the manual's payment order.
- [Official errata list](https://www.dbs-cardgame.com/us-en/rule/errata-cards.php): HTTP 200, 356,382 bytes, SHA-256 `0ae8e4f719e4b263ec4ec85cbf14b6bf423d7021417ae109760c93be8897b696`. It lists P-360's 2022-02-10 front-face Activate: Battle erratum (discard “Choose up to 1” becomes mandatory “Choose 1”). That erratum does not concern the SSG Vegeta back-face Union-Fusion grant. No BT11-013 entry was found on this fetched errata page; this is a page-specific absence only.
- [Official keyword skills page](https://www.dbs-cardgame.com/us-en/rule/keyword-skills.php): HTTP 200, 40,218 bytes, SHA-256 `d9dcfbb271b32867e4f8ebc0ed5b04ab6b9dd98bd56de72df8c451e7e9e0bedf`. Its brief definition says Union-Fusion places one each of specified same-power cards from hand into Drop and plays the card. The more detailed manual controls added-cost timing.

## Public forum checks and access limits

Public discussion is secondary evidence only; it does not override Bandai's rules. Reddit pages were extracted with a public web-content reader on 2026-10-19 UTC, which returned page text and comments for these threads:

- [“Question about SS3 Gotenks Ultimate Rookie”](https://www.reddit.com/r/DBS_CardGame/comments/z0c3tc/question_about_ss3_gotenks_ultimate_rookie/), posted 2022-11-20. The body asks whether the two Fusion materials go to Drop; a commenter explains the printed draw as part of cost and lists the energy, draw, materials and play. This is a casual explanation, not an exact ruling on event ordering or checkpoint timing.
- [“New rule changes! Details on how Cold Bloodlust and Crusher Ball works!”](https://www.reddit.com/r/DBS_CardGame/comments/7y0vbp/new_rule_changes_details_on_how_cold_bloodlust_and/), posted 2018-02-16. The post describes two Counter: Play windows around a skill that plays a Battle Card; it links to the official FAQ and uses older wording. The current official FAQ/manual above are the authority.

Direct `urllib` GETs to both Reddit URLs returned HTTP 403 on 2026-10-19. The response bodies were 1,522 bytes each; SHA-256 values were `dbd7c2e2e2c9616a108a66804661d06a3a4d725c882db442ed8b48b834b43b83` and `d4e3455df1f74bc424258f7ac78099acd658b6d0dfa2b4fc50d8b03e2ea30588` respectively. The separate content reader did expose indexed page text/comments, but it did not expose original response bytes or a content hash. Therefore the forum quotations are attributed to the extractor's rendered text, and no hash is asserted for those page bodies. Replies obtained this way do not remove the limitation on direct Reddit retrieval.

## Implementation consequence

Sequence the skill procedure as: declare the hand skill; move the chosen same-power materials from hand to Drop; mark any resulting Auto skills pending; determine and pay the additional skill cost completely; activate the Union-Fusion skill; run the specified counter timing; resolve it if activation succeeded. Do not resolve a material-triggered Auto between the material movement and added-cost payment unless a separate rule explicitly creates a checkpoint there. Keep the Auto pending until the next checkpoint required by the rules. If payment fails after materials are moved, the Fusion activation fails under §5-8-4; do not roll back already completed cost actions absent a rule that says to do so. The exact next checkpoint's position is not named in the cited Union-Fusion clauses, so preserve the engine's existing general checkpoint semantics rather than adding one ad hoc.
