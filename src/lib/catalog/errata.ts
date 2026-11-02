/**
 * Typos in the card text as the catalog source prints it.
 *
 * deckplanet's `card_skill_unstyled` carries a long tail of plain misspellings
 * — "Whe this card attacks", "the card is plyed", "gain[Blocker]" with no
 * space. They are not a display nuisance: the arena's compiler reads this text
 * literally, so one missing letter costs a whole skill. "Whe this card
 * attacks" alone is three [Auto] skills the engine parses and then never fires,
 * because `autoTriggerMatches` is looking for "when".
 *
 * The fix belongs **here rather than in the database**. `sync:catalog` upserts
 * with `skill = excluded.skill`, so a hand-edited row is overwritten by the
 * next sync and the bug comes back with no trace of why. Correcting the text
 * on the way in means a re-sync keeps the fix, and this file is the list of
 * every claim we make about the source being wrong.
 *
 * Only *unambiguous* errors are corrected. A rare word that turns out to be a
 * card name is left exactly as printed — the catalog is full of them
 * ("{Stop You Fiend!}", "<Haze Shenron>", "{Upa}", "<Mercenary Tao>"), and a
 * scan that flags them is the scan being wrong, not the card.
 */

/** Bracket tags that are markup, not keyword skills: "a card[/em]" is correct. */
const MARKUP = /^(?:br|em|\/em|li|\/li|\/?[bius])$/i;

/**
 * A keyword run up against the word before it — "they gain[Blocker]", "this
 * card's[Counter] skill". A rule rather than a per-card entry because BT31
 * keeps printing them, so the next set will bring more.
 *
 * `[/em]` and `[/li]` are the *only* tags that legitimately follow a letter,
 * which is what makes this safe to apply to every card.
 */
function spaceBeforeKeyword(text: string): string {
  return text.replace(/(['A-Za-z])\[([^\]]{1,20})\]/g, (whole, before: string, tag: string) => (MARKUP.test(tag) ? whole : `${before} [${tag}]`));
}

/**
 * Per-card corrections, as `[wrong, right]` pairs matched case-sensitively.
 *
 * Written as regexes with `\s+` for every space so that a line break or a
 * double space in the source cannot make one silently miss. Whether each one
 * still matches is checked by `unmatchedCorrections`, which `syncCatalogFor`
 * runs against the payload it just fetched — a correction that stops applying
 * because the source was fixed upstream is a line to delete, and one that
 * stops applying because the wording changed is a bug to look at. Neither can
 * be caught by `npm test`, which has no catalog to read.
 */
export const CORRECTIONS: Record<string, [RegExp, string][]> = {
  // ── Dragon Ball Super (the game the arena plays) ──────────────────────────
  // Official 2020-03-06 errata (#920), verified 2026-10-15:
  // https://www.dbs-cardgame.com/us-en/rule/errata-cards.php
  // Every removal from Battle/Combo is redirected, not only a move to Drop.
  "DB2-137": [[/When\s+this\s+card\s+is\s+placed\s+in\s+a\s+Drop\s+Area\s+from\s+a\s+Battle\s+Area\s+or\s+Combo\s+Area/g, "When this card is removed from a Battle Area or Combo Area"]],
  "DB2-140": [[/When\s+this\s+card\s+is\s+placed\s+in\s+a\s+Drop\s+Area\s+from\s+a\s+Battle\s+Area\s+or\s+Combo\s+Area/g, "When this card is removed from a Battle Area or Combo Area"]],
  "DB2-151": [[/When\s+this\s+card\s+is\s+placed\s+in\s+a\s+Drop\s+Area\s+from\s+a\s+Battle\s+Area\s+or\s+Combo\s+Area/g, "When this card is removed from a Battle Area or Combo Area"]],
  "DB2-153": [[/When\s+this\s+card\s+is\s+placed\s+in\s+a\s+Drop\s+Area\s+from\s+a\s+Battle\s+Area\s+or\s+Combo\s+Area/g, "When this card is removed from a Battle Area or Combo Area"]],

  // NOT an official erratum: a catalog misprint. BT9-126b prints "[activate main]" with no colon
  // in the source text (the printed card reads [Activate: Main]), so the line parsed as a
  // [Permanent] and its win condition could never run (#907). The parser is also tolerant of the
  // missing colon (`kindOf`); this fix keeps the stored text right for every other reader.
  "BT9-126": [[/\[activate\s+main\]/gi, "[activate: main]"]],

  // Five more official errata (#934), all re-read on the live errata page on
  // 2026-10-17 (the 15 Oct snapshot still carried the "before" wording). The
  // exact before/after strings are kept in OFFICIAL_ERRATA below for audit.
  // BT2-015's is a reminder, so the compiler reads the same either way.
  "BT2-015": [[/with\s+the\s+same\s+power\s+into\s+your\s+Drop\s+Area/g, "with the same power from your hand into your Drop Area"]],
  // The payer of the draw: the opponent's energy is the condition, YOU draw.
  "BT22-137": [[/energy\s+and\s+draws\s+2\s+cards/g, "energy and you draw 2 cards"]],
  // A required cost, not an optional one: "up to" would let it be paid with nothing.
  "BT3-070": [[/choose\s+up\s+to\s+1\s+each\s+of/g, "choose 1 each of"]],
  "BT4-108": [[/\+5000\s+power\s+for\s+each\s+card\s+in\s+your\s+Warp(?=\s*\.)/g, "+5000 power for each card in your Warp for the duration of the turn"]],
  "P-360": [[/Choose\s+up\s+to\s+1(?=\s+red\s+or\s+blue\s+\S{1,6}Saiyan\S{1,6}\s+card\s+in\s+your\s+hand\s+and\s+discard\s+it)/g, "Choose 1"]],

  "BT3-104": [[/your\s+opponent's\s+can\s+only\s+attack/g, "your opponent can only attack"]],
  "BT4-059": [[/<Lord\s+Slug>with/g, "<Lord Slug> with"]],
  // Official 2019-11-01 errata, reconfirmed 2026-10-14 (#819): World Peace
  // plays a cost-3-or-less Battle Card, regardless of current energy.
  // https://www.dbs-cardgame.com/us-en/rule/errata-cards.php (BT5-119)
  "BT5-119": [[/an\s+energy\s+cost\s+less\s+than\s+or\s+equal\s+to\s+your\s+current\s+energy/g, "an energy cost of 3 or less"]],
  "BT6-013": [[/1\s+red&lt;Vegeta:\s+Br&gt;/g, "1 red &lt;Vegeta: Br&gt;"]],
  "BT20-083": [[/≪Saiyan≫card/g, "≪Saiyan≫ card"]],
  "BT25-032": [[/2\s+oor\s+more\s+energy/g, "2 or more energy"]],
  // A typo in the catalog's copy (#930): "…on top of this card, the shuffle your
  // deck." Every sibling Absorb prints ", then shuffle your deck". Not one of the
  // official errata (no entry in OFFICIAL_ERRATA); the clause was left unread.
  "BT28-012": [[/,\s*the\s+shuffle\s+your\s+deck/g, ", then shuffle your deck"]],
  // NOT official errata: catalog misprints found by the readings audit of 2 Nov 2026 (audit-selectors-1). A missing
  // or swallowed space or letter turned "up to 1" into an exact 1 or dropped the owner (BT1-052, P-138, BT25-018,
  // BT1-042), "less or" into "lessor" (an exact cost, BT26-015), a card name into one no card has (BT27-044's {Bulma,
  // First Adventure} is BT27-053; BT28-008/009's {God of Dreams Dragon Ball} is BT28-027), "your energy" into no area
  // (BT30-050), "Warp" into "Wrap" (BT27-001's back), and "this card" into "this crd" (BT31-073). BT27-015 prints
  // "Play … from your Warp into their owner's Drop", which no card can do; BT27-018 prints the same skill with "Place".
  "BT1-052": [[/Choose\s+up\s+to\s+1card\s+from\s+your\s+hand/g, "Choose up to 1 card from your hand"]],
  "P-138": [[/choose\s+up\s+to1\s+of\s+your\s+opponent's/g, "choose up to 1 of your opponent's"]],
  "BT25-018": [[/Add\s+up\s+t\s+1\s+red\s+skill-less/g, "Add up to 1 red skill-less"]],
  "BT1-042": [[/choose\s+up\s+to\s+1opponent\s+Battle\s+Card/g, "choose up to 1 opponent Battle Card"]],
  "BT26-015": [[/energy\s+cost\s+of\s+3\s+or\s+lessor\s+up\s+to\s+mono-red\s+Extra/g, "energy cost of 3 or less or up to mono-red Extra"]],
  "BT27-044": [[/\{Bulma,\s+First\s+Adveture\}/g, "{Bulma, First Adventure}"]],
  "BT28-008": [[/\{Gods\s+of\s+Dreams\s+Dragon\s+Ball\}/g, "{God of Dreams Dragon Ball}"]],
  "BT28-009": [[/\{Gods\s+of\s+Dreams\s+Dragon\s+Ball\}/g, "{God of Dreams Dragon Ball}"]],
  "BT30-050": [[/card\s+in\s+yourenergy,/g, "card in your energy,"]],
  "BT27-001": [[/from\s+your\s+Wrap\s+in\s+a\s+combo/g, "from your Warp in a combo"]],
  "BT31-073": [[/Play\s+this\s+crd\s+from\s+your\s+hand/g, "Play this card from your hand"]],
  "BT27-015": [[/:\s+Play\s+up\s+to\s+4\s+total\s+red\s+and\/or\s+black\s+≪Saiyan≫\s+cards\s+from\s+your\s+Warp\s+into\s+their\s+owner's\s+Drop/g, ": Place up to 4 total red and/or black ≪Saiyan≫ cards from your Warp into their owner's Drop"]],
  "BT25-054": [[/shuffle\s+your\s+dec\./g, "shuffle your deck."]],
  "BT25-061": [[/all\s+blue\s+adn\s+with/g, "all blue and with"]],
  "BT25-086": [[/Active\s+Moe/g, "Active Mode"]],
  "BT25-125": [[/send\s+this\s+card\s+rom\s+your\s+Drop/g, "send this card from your Drop"]],
  "BT25-134": [
    [/Rest\s+Moe:/g, "Rest Mode:"],
    [/up\s+to\s+5\s+crds\s+from\s+the\s+top\s+o\s+your\s+deck/g, "up to 5 cards from the top of your deck"],
  ],
  "BT25-138": [[/copies\s+of\s+thi\s+card/g, "copies of this card"]],
  // "…—both mono-blue and with an energy cost of 7 or less—**form** your deck
  // to your hand": two letters transposed, and the one word in the sentence
  // that says where the search happens. `AREA_WORDS` reads "from your deck";
  // with the typo the only area word left in the clause is the destination, so
  // the card searched the **hand** it was meant to be adding to.
  "BT25-139": [[/form\s+your\s+deck\s+to\s+your\s+hand/g, "from your deck to your hand"]],
  // NOT an official erratum: the owner's ruling of 26 Oct 2026 (phrasing batch 2). The comma before
  // "Choose" is a misprinted full stop — the Leader condition gates only the draw and discard; the
  // +15000 (and its "Additionally") always happens.
  "BT26-027": [[/discard\s+2\s+cards\s+from\s+your\s+hand,\s+Choose\s+up\s+to\s+1/g, "discard 2 cards from your hand. Choose up to 1"]],
  "BT26-071": [
    [/both\s+gree\s+and\s+with/g, "both green and with"],
    // Phrasing batch 4 (26 Oct 2026): "with and energy cost".
    [/green\s+<Vegito>\s+card\s+with\s+and\s+energy\s+cost/g, "green <Vegito> card with an energy cost"],
  ],
  "BT26-085": [[/negated\s+fro\s+the\s+turn/g, "negated for the turn"]],
  "BT26-093": [
    [/Rest\s+Mode\s+Batle\s+Cards/g, "Rest Mode Battle Cards"],
    [/KO\s+it,\s+the\s+play\s+up\s+to\s+1/g, "KO it, then play up to 1"],
    // Phrasing batch 2 (26 Oct 2026).
    [/Choose\s+up\s+to\s+1of\s+your/g, "Choose up to 1 of your"],
  ],
  "BT26-123": [[/≪Prison\s+Planet≫card/g, "≪Prison Planet≫ card"]],
  "BT27-103": [[/Whe\s+this\s+card\s+attacks/g, "When this card attacks"]],
  "BT27-113": [[/Rmove\s+this\s+card/g, "Remove this card"]],
  "BT27-118": [[/\[Invoker\]\s+sill/g, "[Invoker] skill"]],
  "BT27-123": [
    [/Battle\s+Cardis\s+played/g, "Battle Card is played"],
    [/opponent's\s+Batte\s+Cards/g, "opponent's Battle Cards"],
  ],
  "BT28-055": [[/bottom\s+of\s+tis\s+owner's\s+deck/g, "bottom of its owner's deck"]],
  "BT28-074": [[/Battle\s+Areas\s+wit\s+their\s+skills/g, "Battle Areas with their skills"]],
  "BT28-141": [[/and\s+paly\s+this\s+card/g, "and play this card"]],
  "BT29-085": [[/1\s+or\s+more\s+blacks\s+cards/g, "1 or more black cards"]],
  "BT29-105": [
    [/send\s+itto\s+its\s+owner's\s+Warp/g, "send it to its owner's Warp"],
    [/-only\s+crd,/g, "-only card,"],
  ],
  "BT29-106": [[/Hidden\s+Mode\s+crds/g, "Hidden Mode cards"]],
  "BT30-048": [[/bottom\s+of\s+ther\s+owner's\s+deck/g, "bottom of their owner's deck"]],
  "BT30-073": [[/your\s+opponnt's\s+Battle\s+Cards/g, "your opponent's Battle Cards"]],
  "BT30-109": [[/switch\s+it\s+t\s+Hidden\s+Mode/g, "switch it to Hidden Mode"]],
  "BT30-126": [[/from\s+your\s+han,/g, "from your hand,"]],
  "BT30-146": [
    [/and\s+ngate\s+their\s+skills/g, "and negate their skills"],
    [/can't\s+witch\s+Battle\s+Cards/g, "can't switch Battle Cards"],
  ],
  // Audit triggers 1: "When your red Z-Card is palyed or attacks" — the play half was lost to the typo.
  "BT31-006": [[/Z-Card\s+is\s+palyed\s+or\s+attacks/g, "Z-Card is played or attacks"]],
  "BT31-016": [[/from\s+its\s+owner'\s+Warp/g, "from its owner's Warp"]],
  "BT31-017": [[/at\s+5\s+or\s+lees/g, "at 5 or less"]],
  "BT31-041": [
    [/Whe\s+this\s+card\s+attacks/g, "When this card attacks"],
    // Review of audit lane C (2 Nov 2026): the [Awaken]'s "a green Unison **wth** a specified cost of 2" lost its measure.
    [/green\s+Unison\s+wth\s+a\s+specified\s+cost/g, "green Unison with a specified cost"],
  ],
  "BT31-053": [[/from\s+their\s+hnd/g, "from their hand"]],
  "BT31-080": [[/and\s+paly\s+a\s+\{/g, "and play a {"]],
  "BT31-094": [[/Whe\s+this\s+card\s+attacks/g, "When this card attacks"]],
  // #926: the official card list prints "and you draw 3 cards" (verified 2026-10-16,
  // https://www.dbs-cardgame.com/us-en/cardlist/index.php?free=BT31-149&search=true);
  // as "your draw" the [Union-Fusion] price is unreadable.
  "BT31-149": [[/and\s+your\s+draw\s+3\s+cards/g, "and you draw 3 cards"]],
  "BT31-150": [[/card\s+is\s+plyed/g, "card is played"]],

  // Phrasing batch 2 (26 Oct 2026): plain misspellings in the open-rules export
  // of the day, each a word the compiler reads literally (a missing space, two
  // letters swapped, a dropped "from"/"to"). Only the misspelt words change.
  "BT16-098": [[/send\s+that\s+card\s+its\s+owner's\s+Warp/g, "send that card to its owner's Warp"]],
  "BT1-092": [[/\[Blocker\]\s+\]\s+\(/g, "[Blocker] ("]],
  "BT1-106": [[/negate\s+the\s+attack\.Afterwards/g, "negate the attack. Afterwards"]],
  // Mechanism batch 4: the source runs the [Permanent] into the [Auto] after it with no line break, so the [Auto] was
  // read as part of the cost reduction's sentence.
  "BT3-026": [[/in\s+your\s+hand\s+by\s+2\.\s*\[Auto\]/g, "in your hand by 2.<br>[Auto]"]],
  "BT7-053": [[/look\s+at\s+up\s+7\s+cards/g, "look at up to 7 cards"]],
  // The generic energy cost printed as a bare number: the source lost the braces of the orb ({1}, {3}).
  "BT6-081": [[/\[Activate:\s+Main\]\s+3,\s+choose\s+1\s+\{Display/g, "[Activate: Main] {3}, choose 1 {Display"]],
  "BT6-096": [[/\[Activate:\s+Main\]\s+1,\s+place\s+this\s+card/g, "[Activate: Main] {1}, place this card"]],
  "BT25-108": [[/to\s+your\s+hand,\s+the\s+shuffle\s+your\s+deck/g, "to your hand, then shuffle your deck"]],
  // Audit triggers 1 (review): "removed from a Battle Area by and opponent's skill or KO'd" — the removal half was lost to the typo.
  "BT25-113": [[/Battle\s+Area\s+by\s+and\s+opponent's\s+skill/g, "Battle Area by an opponent's skill"]],
  "BT25-141": [[/discards\s+1\s+card\s+their\s+hand/g, "discards 1 card from their hand"]],
  "BT26-022": [[/until\s+the\s+end\s+fo\s+your/g, "until the end of your"]],
  "BT26-044": [[/combo,\s+you\s+opponent\s+places/g, "combo, your opponent places"]],
  "BT26-059": [[/choose\s+up\s+to\s+1of\s+your/g, "choose up to 1 of your"]],
  "BT26-091": [[/under\s+te\s+played\s+card/g, "under the played card"]],
  "BT26-109": [[/place\s+itunder\s+your/g, "place it under your"]],
  "BT26-129": [[/if\s+your\s+Laeder\s+is/g, "if your Leader is"]],
  "BT26-133": [[/played,\s+you\s+opponent\s+sends/g, "played, your opponent sends"]],
  "BT27-040": [[/from\s+our\s+life\s+o\s+your\s+hand/g, "from your life to your hand"]],
  "BT27-074": [[/draw\s+1\s+card,t\s+hen\s+choose/g, "draw 1 card, then choose"]],
  "BT27-078": [[/\{y\},\s+fi\s+your\s+Leader/g, "{y}, if your Leader"]],
  "BT27-080": [[/if\s+you\s+Leader\s+is/g, "if your Leader is"]],
  "BT27-105": [[/and\s+sendit\s+to/g, "and send it to"]],
  "BT28-048": [[/hand,\s+andyou\s+choose/g, "hand, and you choose"]],
  "BT28-096": [[/look\s+t\s+up\s+to\s+5\s+cards/g, "look at up to 5 cards"]],
  "BT29-086": [[/does\s+not\s+caues\s+you/g, "does not cause you"]],
  "BT30-006": [[/Z-Energyunder\s+this\s+card/g, "Z-Energy under this card"]],
  "BT30-091": [[/If\s+yourLeader\s+is/g, "If your Leader is"]],
  "BT31-050": [[/card\s+an\s+you\s+have/g, "card and you have"]],
  "P-607": [
    [/choose\s+up\s+to\s+1of\s+your/g, "choose up to 1 of your"],
    [/and\s+palce\s+it/g, "and place it"],
  ],
  "P-658": [[/power\s+for\s+te\s+battle/g, "power for the battle"]],
  "P-727": [[/by\s+\{u\}\s+fo\s+the\s+turn/g, "by {u} for the turn"]],
  "P-743": [[/until\s+you\s+have\s+6life\s+left/g, "until you have 6 life left"]],
  "P-156": [[/2\s+or\s+more≪World\s+Tournament≫/g, "2 or more ≪World Tournament≫"]],
  "P-431": [[/\{y\}\{y\}\{3\}Yellow/g, "{y}{y}{3} Yellow"]],
  "P-620": [[/from\s+your\s+dec\s+or\s+hand/g, "from your deck or hand"]],
  "P-621": [[/If\s+your\s+Leaderis\s+a/g, "If your Leader is a"]],
  "P-751": [[/into\s+its\s+owner'\s+Drop/g, "into its owner's Drop"]],
  "TB2-065": [[/≪World\s+Tournament≫Battle\s+Cards/g, "≪World Tournament≫ Battle Cards"]],
  // Phrasing batch 3 (26 Oct 2026): three more misspellings the compiler reads literally.
  "BT27-031": [
    [/from\s+your\s+energy\s+to\s+you\s+hand:/g, "from your energy to your hand:"],
    [/place\s+it\s+a\s+the\s+bottom\s+of/g, "place it at the bottom of"],
  ],
  "BT28-077": [[/Multi-Form\s+Tkoens/g, "Multi-Form Tokens"]],
  "BT31-144": [[/of\s+your\s+energy\s+to\s+Activate\s+Mode/g, "of your energy to Active Mode"]],
  // Phrasing batch 4 (26 Oct 2026): more misspellings the compiler reads literally (and BT26-071's second, above).
  "BT25-114": [[/switch\s+this\s+card\s+toActive\s+Mode/g, "switch this card to Active Mode"]],
  "BT26-120": [[/Look\s+at\s+up\s+to\s+5cards\s+from/g, "Look at up to 5 cards from"]],
  "BT31-084": [[/Flip\s+up\s+ot\s+1\s+<Vegeta>/g, "Flip up to 1 <Vegeta>"]],
  "P-683": [[/\[Barrier\]\s+until\s+he\s+end\s+of/g, "[Barrier] until the end of"]],

  // ── Official errata, all of them (errata-official-1, 2 Nov 2026) ──────────
  // Bandai's errata page (https://www.dbs-cardgame.com/us-en/rule/errata-cards.php), snapshot in
  // docs/rules/errata-official.json, checked by `npm run arena:errata-check`. Each entry below is
  // the page's "After" wording where the catalog still printed the "Before", in the catalog's own
  // spelling (orbs as {y}, "[Activate: Main]", the card's own "<"/"&lt;" and tag case); the
  // page's change, and only that, is replaced. Unless a comment says otherwise the page's note is
  // "The current text of this card prevents it from being properly played" or "Read as the errata
  // when playing". Newest first, as the page lists them.
  //
  // Eight were held back by errata-official-1 because the compiler misread their new wording, and are applied since
  // errata-official-2 (2 Nov 2026), once it reads them: BT7-125…BT7-129's ban with its condition after it,
  // BT22-001's placing from the Z-Deck, BT24-096's price (R-116), and BT15-068 once BT15-067 carries its official
  // name (`FIELD_CORRECTIONS` below).
  // 2025-01-01 (the page heads it "Front"; it is the Leader's back): no Unisons.
  "BT25-001": [[/opponent's\s+Battle\s+Cards\s+or\s+Unisons\s+and\s+it\s+gets\s+-15000\s+power/g, "opponent's Battle Cards and it gets -15000 power"]],
  // 2024-09-27: the condition is the Leader's back side (a Leader whose front is not Gohan).
  "BT26-097": [[/if\s+your\s+Leader\s+is\s+a\s+yellow\s+<Son\s+Gohan:\s+Childhood>\s+card\s+and\s+you\s+have\s+2\s+or\s+more\s+energy/g, "if your Leader's back side is a yellow <Son Gohan: Childhood> card and you have 2 or more energy"]],
  "BT26-098": [[/if\s+your\s+Leader\s+is\s+a\s+yellow\s+<Son\s+Gohan:\s+Childhood>\s+card\s+and\s+you\s+have\s+2\s+or\s+more\s+energy/g, "if your Leader's back side is a yellow <Son Gohan: Childhood> card and you have 2 or more energy"]],
  // 2024-09-27: the Field's full name (BT26-094); no card is named plain {Cell Games Arena} but BT9-124.
  "BT26-119": [[/\{Cell\s+Games\s+Arena\}/g, "{Cell Games Arena, Greatest Stage}"]],
  // 2024-08-02: the card is {SS Vegeta, Rescuing a Son} (BT25-074).
  "BT25-070": [[/\{Vegeta,\s+Rescuing\s+a\s+Son\}/g, "{SS Vegeta, Rescuing a Son}"]],
  "P-549": [[/the\s+attacking\s+card\s+gets\s+\+6000\s+power,\s+then\s+switch/g, "the attacking card gets +6000 power for the turn, then switch"]],
  // 2024-04-19: switching the five cards is the price, no longer a condition — any 5 of your Active Mode yellow cards,
  // the energy included (R-010, carried over by R-116).
  "BT24-096": [[/\{y\}\{y\},\s+if\s+you\s+switch\s+5\s+yellow\s+cards\s+to\s+Rest\s+Mode:/g, "{y}{y}, switch 5 of your yellow cards to Rest Mode:"]],
  // 2024-03-01: the [Auto] is struck from the card.
  "BT21-097": [[/<br>\[Auto\]\s+If\s+your\s+Leader\s+is\s+a\s+green\s+&lt;Son\s+Gohan:\s+Childhood&gt;:\s+When\s+you\s+activate\s+this\s+card's\s+\[Counter\]\s+skill\s+from\s+your\s+hand,\s+draw\s+1\s+card\./g, ""]],
  "BT19-055": [[/\[Activate:\s+Main\]\s+Your\s+opponent\s+gains\s+control\s+of\s+this\s+card/g, "[Activate: Main] If your Leader is a blue <Son Gohan: SH> card: Your opponent gains control of this card"]],
  "BT20-086": [[/\[activate:\s+battle\]\s+If\s+there\s+are\s+7\s+or\s+more\s+cards\s+in\s+your\s+Combo\s+Area/g, "[activate: battle] If there is a {Son Goku & Vegeta, Path to Victory} under this card and there are 7 or more cards in your Combo Area"]],
  // 2023-12-08: a required price, not "up to".
  "P-566": [[/\[Activate:\s+Main\]\[Limit\s+1\]\s+Switch\s+up\s+to\s+1\s+of\s+your/g, "[Activate: Main][Limit 1] Switch 1 of your"]],
  "BT23-033": [[/when\s+your\s+opponent\s+attacks\s+with\s+a\s+non-Leader\s+card\s+during\s+that\s+turn,\s+they\s+must\s+place\s+any\s+number\s+of\s+their\s+Z-Energy\s+cards\s+in\s+their\s+Drop\s+so\s+that/g, "your opponent can't attack with a non-Leader card for the turn unless they place any number of their Z-Energy cards in their Drop each time - so that"]],
  "P-543": [[/with\s+an\s+energy\s+cost\s+of\s+1\s+to\s+your\s+hand,\s+then\s+shuffle/g, "with an energy cost of 1 from your deck to your hand, then shuffle"]],
  "P-548": [[/KO\s+it:\s+When\s+your\s+opponent\s+discards\s+1\s+card\s+from\s+their\s+hand,\s+remove\s+this\s+card/g, "KO it: Your opponent discards 1 card from their hand, then remove this card"]],
  "BT22-113": [[/place\s+under\s+it\s+up\s+to\s+1\s+card/g, "place under this card up to 1 card"]],
  "BT21-091": [[/\{g\},\s+choose\s+up\s+to\s+1\s+of\s+your\s+opponent's\s+Earthling\s+Tokens/g, "{g}, choose 1 of your opponent's Earthling Tokens"]],
  // 2023-08-25 (back): the Z-Leader is placed on top of this card, not played.
  "BT22-001": [[/and\s+play\s+up\s+to\s+1\s+red\s+&lt;Son\s+Gohan:\s+SH&gt;\s+Z-Leader/g, "and place up to 1 red &lt;Son Gohan: SH&gt; Z-Leader"]],
  "BT22-086": [[/Remove\s+this\s+card\s+from\s+the\s+game:\s+Choose\s+up\s+to\s+1\s+of\s+your\s+opponent's\s+skill-less\s+Battle\s+Cards\s+and\s+KO\s+it\s+at\s+the\s+end\s+of\s+the\s+turn\./g, "Remove this card from the game: At the end of the turn, choose up to 1 of your opponent's skill-less Battle Cards and KO it."]],
  "BT22-124": [[/add\s+up\s+to\s+1\s+<Fu>\s+card\s+from\s+your\s+Z-Deck\s+face\s+up\s+to\s+your\s+hand/g, "add up to 1 face up <Fu> card from your Z-Deck to your hand"]],
  "BT22-125": [[/add\s+1\s+<Fu>\s+card\s+from\s+your\s+Z-Deck\s+face\s+up\s+to\s+your\s+hand/g, "add 1 face up <Fu> card from your Z-Deck to your hand"]],
  "BT22-126": [[/add\s+1\s+<Fu>\s+card\s+from\s+your\s+Z-Deck\s+face\s+up\s+to\s+your\s+hand/g, "add 1 face up <Fu> card from your Z-Deck to your hand"]],
  "BT21-096": [
    [/If\s+all\s+your\s+energy\s+is\s+green\s+and\s+this\s+card/g, "If all your energy is mono-green and this card"],
    [/add\s+up\s+to\s+2\s+cards\s+to\s+your\s+life\./g, "add up to 2 cards from your life to your hand."],
  ],
  "BT21-024": [[/you\s+place\s+1\s+card\s+at\s+the\s+bottom\s+of\s+your\s+deck:/g, "you place 1 card in your hand at the bottom of your deck:"]],
  "BT21-099": [[/0\s+combo\s+power\)\s+from\s+your\s+Battle\s+Area/g, "0 combo power) in your Battle Area"]],
  "P-500": [[/2\s+or\s+more\s+energy:\s+During\s+this\s+turn,\s+you\s+can\s+activate/g, "2 or more energy: When this card is played, for the turn, you can activate"]],
  "BT21-035": [[/mono-blue\s+&lt;Vegeta&gt;\s+with\s+an\s+energy\s+cost\s+of\s+1/g, "mono-blue &lt;Vegeta: GT&gt; with an energy cost of 1"]],
  "BT21-036": [[/blue\s+<Uub>\s+Battle\s+Cards\s+under\s+a\s+blue\s+<Mr\.\s+Buu>\s+and\s+switch/g, "blue <Uub> Battle Cards with a blue <Mr. Buu> under it and switch"]],
  // 2023-06-02: the front gains a deck-building [Permanent]; the back's choice is any Battle Card.
  "BT21-068": [
    [/^\[Auto\]\s+When\s+this\s+card\s+is\s+placed\s+in\s+your\s+Leader\s+Area,\s+place\s+up\s+to\s+1\s+\{Gingertown\}/g, "[Permanent] All Battle Cards in your deck must be green ≪Android≫.<br>[Auto] When this card is placed in your Leader Area, place up to 1 {Gingertown}"],
    [/choose\s+up\s+to\s+1\s+of\s+your\s+opponent's\s+Battle\s+Cards\s+with\s+an\s+energy\s+cost\s+of\s+3\s+or\s+less\s+from\s+your\s+Drop\s+or/g, "choose up to 1 Battle Card with an energy cost of 3 or less from your Drop or"],
  ],
  "BT21-070": [[/on\s+1\s+green\s+Extra\s+with\s+both\s+\{Cell\}/g, "on 1 green Extra from your hand with both {Cell}"]],
  "BT21-074": [[/this\s+card's\s+skills\s+won't\s+negate\./g, "this card's skills can't be negated."]],
  "BT21-078": [[/When\s+this\s+card\s+is\s+played\s+under\s+a\s+\{Hyperbolic/g, "When this card is played from under a {Hyperbolic"]],
  "BT21-081": [[/When\s+this\s+card\s+is\s+played\s+under\s+a\s+\{Hyperbolic/g, "When this card is played from under a {Hyperbolic"]],
  "BT21-088": [[/\[activate:\s+main\]\s+If\s+you\s+or\s+your\s+opponent\s+removes\s+1\s+token\s+with\s+combo\s+power\s+from\s+the\s+game:/g, "[activate: main] Remove 1 of your or your opponent's tokens with combo power from the game:"]],
  "BT21-103": [[/play\s+this\s+card\s+under\s+a\s+yellow\s+&lt;Whis&gt;/g, "play this card from under a yellow &lt;Whis&gt;"]],
  "BT21-137": [[/specified\s+cost\s+of\s+3\s+and\s+a\s+marker\s+on\s+it/g, "specified cost of 3 with a marker on it"]],
  "BT21-145": [[/\{Cell's\s+Full-Power\s+Kamehameha\}\s+from\s+your\s+deck,/g, "{Cell's Full-Power Kamehameha} from your deck to your hand,"]],
  "BT21-149": [[/7\s+or\s+less,\s+send\s+it\s+to\s+your\s+Warp\s+instead/g, "7 or less, send it to its owner's Warp instead"]],
  "P-506": [[/\{SS\s+Trunks,\s+Mysterious\s+Future\s+Warrior\}\s+from\s+your\s+hand\s+under\s+the\s+chosen\s+card/g, "{SS Trunks, Mysterious Future Warrior} from your deck under the chosen card"]],
  "P-513": [[/play\s+up\s+to\s+1\s+copy\s+of\s+this\s+card\./g, "play up to 1 copy of this card from your hand."]],
  // 2023-06-02, the page's note: "This card negates strategies using 《God》 and 《Universe》 Special
  // Trait cards. Due to this wide-scale impact … we have decided to errata this card." Now an optional
  // choice of 12, and the removal only "If you do" — only when all 12 were chosen (R-117).
  "P-493": [[/choose\s+up\s+to\s+12\s+of\s+your\s+opponent's\s+Battle\s+Cards\s+with\s+≪God≫\s+or\s+≪Universe≫\s+in\s+their\s+special\s+traits,\s+ignoring\s+\[barrier\],\s+negate/g, "you may choose 12 of your opponent's Battle Cards with ≪God≫ or ≪Universe≫ in their special traits, ignoring [barrier]. If you do, negate"]],
  // 2023-03-31, both sides. The page writes "battle cards"; the catalog capitalises the card type.
  "BT20-024": [[/you\s+can't\s+use\s+skills\s+to\s+play\s+Battle\s+Cards\./g, "you can't play Battle Cards by skills."]],
  "BT20-101": [[/If\s+your\s+Leader\s+is\s+yellow,\s+and\s+has\s+both\s+<Son\s+Goku>\s+and\s+<Vegeta>\s+card\s+and/g, "If your Leader is a yellow <Son Goku> <Vegeta> card and"]],
  "BT20-099": [
    [/can't\s+attack\s+with\s+non-Leaders\s+unless/g, "can't attack with non-Leaders for the turn unless"],
    [/\[Strike\]\s+skills\s+for\s+the\s+turn\."/g, "[Strike] skills.\""],
  ],
  // 2023-01-01: life 4 or less AND five Saiyans placed (was 2 or less OR).
  "BT16-020": [[/When\s+your\s+life\s+is\s+at\s+2\s+or\s+less\s+or\s+you\s+place\s+5/g, "When your life is at 4 or less and you place 5"]],
  "BT19-019": [[/Play\s+this\s+card\s+and\s+place\s+the\s+chosen\s+cards\s+under\s+it/g, "Play this card from your hand and place the chosen cards under it"]],
  "BT19-105": [[/cards\s+in\s+your\s+Z-Deck\s+by\s+\{2\}\./g, "cards in your Z-Deck by {2} for the turn."]],
  // 2022-11-18: a deck-building rule about Battle Cards only (the page writes "Battle cards").
  "P-434": [[/You\s+can't\s+include\s+non-≪Villainous≫\s+cards\s+in\s+your\s+deck/g, "You can't include non-≪Villainous≫ Battle Cards in your deck"]],
  // 2022-11-04, the page's note: still a defensive tool for Blue decks, without its offensive use.
  "BT1-053": [[/\[Activate:\s+Battle\]\s+Choose\s+up\s+to\s+1\s+of\s+your\s+cards\./g, "[Activate: Battle] If it's your opponent's turn: Choose up to 1 of your cards."]],
  // 2022-11-04, the page's note: disrupted too many ZENKAI strategies at 20000.
  "BT11-030": [[/with\s+20000\s+power\s+or\s+more\s+for\s+the\s+turn/g, "with 30000 power or more for the turn"]],
  // 2022-11-04, the page's note: drew too many cards per turn; placing this card is now the price.
  "BT18-052": [[/includes\s+\{Super\s+Saiyan\s+Blue\s+Son\s+Goku\}:\s+Draw\s+1\s+card,\s+then\s+place\s+this\s+card\s+from\s+your\s+hand\s+in\s+your\s+energy\s+in\s+Rest\s+Mode\./g, "includes {Super Saiyan Blue Son Goku} and you place this card from your hand in your energy in Rest Mode: Draw 1 card."]],
  // 2022-11-04, the page's note: used in almost all Red decks.
  "EX13-04": [[/\[counter:\s+play\]\s+If\s+the\s+Battle\s+Card\s+being\s+played/g, "[counter: play] If your Leader Card is a <Vegito> card: If the Battle Card being played"]],
  // 2022-11-04, the page's note: too strong when played without paying its cost. A new [Permanent].
  "P-177": [[/^\[Auto\]\s+If\s+your\s+Leader\s+Card\s+is\s+red:/g, "[Permanent] This card can't be played by skills from any area.<br>[Auto] If your Leader Card is red:"]],
  "P-417": [[/\[Auto\]\s+If\s+your\s+Leader\s+is\s+a\s+yellow\s+≪Demon\s+Clan≫\s+card:\s+Look\s+at\s+up\s+to\s+5/g, "[Auto] If your Leader is a yellow ≪Demon Clan≫ card: When this card is played, look at up to 5"]],
  // 2022-06-24, both sides: non-black is barred, so a black multicolour card may be played.
  "BT8-089": [[/You\s+can\s+only\s+play\s+black\s+Battle\s+Cards/g, "You can't play non-black Battle Cards"]],
  "SD14-01": [
    [/You\s+can\s+only\s+play\s+mono-black\s+Battle\s+Cards/g, "You can't play non-black Battle Cards"],
    [/\[Burst\s+5\]\s+Draw\s+1\s+card/g, "[Burst 3] Draw 1 card"],
    [/Draw\s+1\s+card,\s+place\s+5\s+cards\s+from\s+the\s+top\s+of\s+your\s+deck\s+in\s+your\s+Drop\s+Area/g, "Draw 1 card, place 3 cards from the top of your deck in your Drop Area"],
  ],
  "P-211": [[/When\s+your\s+life\s+is\s+at\s+4\s+or\s+less,\s+or\s+you\s+have\s+a\s+blue\s+Unison\s+Card\s+with\s+a\s+specified\s+cost\s+of\s+3\s+in\s+play:/g, "When your life is at 4 or less:"]],
  // 2022-05-20: the cost is red, red, blue on a red card — the page marks the orbs so, and the
  // deckplanet feed's own errata text agrees ({r}{r}{u}); the owner kept it so (R-118).
  "P-394": [[/\[sparking\s+5\]\{r\},\s+if\s+your\s+Leader\s+Card/g, "[sparking 5]{r}{r}{u}, if your Leader Card"]],
  "BT12-082": [[/choose\s+1\s+card\s+in\s+your\s+life\s+and\s+flip\s+it\s+face\s+up/g, "choose 1 face-down card in your life and flip it face up"]],
  "P-398": [[/this\s+card\s+is\s+green\s+while\s+in\s+your\s+deck/g, "this card is also treated as mono-green while in your deck"]],
  // 2022-04-01, four [Counter: Play] Extras: the skill is activated on the declaration of a play.
  "DB2-030": [[/\[Counter:\s+Play\]\s+If\s+the\s+Battle\s+Card\s+your\s+opponent\s+is\s+playing\s+has\s+20000\s+power\s+or\s+less,\s+your\s+opponent\s+may/g, "[Counter: Play] You can activate this skill if your opponent declares they're playing a Battle Card with 20000 power or less. Your opponent may"]],
  "BT7-072": [[/If\s+your\s+Leader\s+Card\s+is\s+green:\s+Your\s+opponent\s+may\s+place/g, "If your Leader Card is green: You can activate this skill if your opponent declares they're playing a Battle Card. Your opponent may place"]],
  "BT9-101": [[/choose\s+all\s+of\s+your\s+opponent's\s+Battle\s+Cards,\s+ignoring\s+\[Barrier\],\s+and\s+they\s+get\s+-30000/g, "choose all of your opponent's non-token Battle Cards, ignoring [Barrier], and they get -30000"]],
  "BT14-087": [[/\[Counter:\s+Play\]\s+If\s+your\s+opponent\s+played\s+a\s+Unison\s+Card,\s+they\s+may\s+remove\s+a\s+marker\s+from\s+it\./g, "[Counter: Play] You can activate this skill if your opponent declares they're playing a Unison Card. Your opponent may remove a marker from the Unison Card they played."]],
  "BT14-140": [[/\[Counter:\s+Play\]\s+If\s+your\s+opponent\s+is\s+playing\s+a\s+Unison\s+Card,\s+they\s+may\s+either\s+remove\s+a\s+marker\s+from\s+it\s+for/g, "[Counter: Play] You can activate this skill if your opponent declares they're playing a Unison Card. They may either remove a marker from the Unison Card for"]],
  // 2021-08-06 and 2022-02-10 (the page's note: "Read with both errata above"): both skills need the Leader.
  "BT13-124": [
    [/\[Once\s+per\s+turn\]\s+Add\s+a\s+marker\s+to\s+this\s+card/g, "[Once per turn] If your Leader Card is a black ≪Demon Realm Race≫ card: Add a marker to this card"],
    [/\[-1\]\[Activate:\s+Main\]\s+Your\s+opponent\s+sends/g, "[-1][Activate: Main] If your Leader Card is a ≪Demon Realm Race≫ card: Your opponent sends"],
  ],
  "BT12-128": [[/^\[Deflect\]<br>/g, "[Deflect][Unique]<br>"]],
  // 2022-02-10 (back): an orb price on the [Activate: Main], and "it's your turn" on the [Activate: Battle].
  "BT11-091": [
    [/\[Activate:\s+Main\]\[Once\s+per\s+turn\]\s+Draw\s+1\s+card,\s+then\s+play\s+up\s+to\s+1\s+yellow/g, "[Activate: Main][Once per turn]{y}: Draw 1 card, then play up to 1 yellow"],
    [/in\s+a\s+battle,\s+if\s+there\s+is\s+a\s+≪Monster≫/g, "in a battle, if it's your turn and there is a ≪Monster≫"],
  ],
  // 2021-11-26: the whole sentence is reworded by the page.
  "BT15-057": [[/\[Activate:\s+Battle\]\s+Use\s+up\s+to\s+1\s+blue\s+≪Universe\s+6≫\s+card\s+from\s+your\s+Drop\s+Area\s+in\s+a\s+combo;\s+it\s+gets\s+-5000\s+combo\s+power\s+and\s+has\s+its\s+skills\s+negated\s+for\s+the\s+turn\./g, "[Activate: Battle] Choose up to 1 blue ≪Universe 6≫ Battle Card in your Drop Area. Negate its skills for the turn and use it in a combo, and it gets -5000 combo power for the turn."]],
  // 2021-11-01: the card it plays is {Kaio-Ken Son Goku, Maximum Gains} (BT15-067, its name corrected below).
  "BT15-068": [[/\{Son\s+Goku,\s+Maximum\s+Gains\}/g, "{Kaio-Ken Son Goku, Maximum Gains}"]],
  "P-337": [[/if\s+the\s+card\s+being\s+played/g, "if the Battle Card being played"]],
  "BT13-060": [[/≪Boujack\s+Brigade≫\s+card\s+or\s+a\s+mono-blue\s+card\s+and\s+you\s+choose/g, "≪Boujack Brigade≫ card and you choose"]],
  "BT11-028": [[/red\s+&lt;Broly:\s+Br&gt;\s+card\s+and\s+you\s+add\s+1\s+card/g, "red &lt;Broly: Br&gt; card, you have no Battle Cards in play, and you add 1 card"]],
  "BT11-058": [[/blue\s+&lt;Baby&gt;\s+card\s+and\s+all\s+of\s+your\s+energy/g, "blue &lt;Baby&gt; card, you have no Battle Cards in play, and all of your energy"]],
  // 2021-09-03, three Dark Broly cards: the page adds an orb price, "[Activate : Main] ● : If your
  // Leader Card is …: Play". Written as the catalog writes an orb price with a condition and an
  // action ("{y}, if your Leader is … and you …:"), which is how the compiler reads one price.
  "BT11-133": [[/\[Activate:\s+Main\]\s+If\s+your\s+Leader\s+Card\s+is\s+a\s+&lt;Dark\s+Broly&gt;/g, "[Activate: Main]{b}, if your Leader Card is a &lt;Dark Broly&gt;"]],
  "BT11-134": [[/\[Activate:\s+Main\]\s+If\s+your\s+Leader\s+Card\s+is\s+a\s+&lt;Dark\s+Broly&gt;/g, "[Activate: Main]{b}, if your Leader Card is a &lt;Dark Broly&gt;"]],
  "BT11-135": [[/\[Activate:\s+Main\]\s+If\s+your\s+Leader\s+Card\s+is\s+a\s+&lt;Dark\s+Broly&gt;/g, "[Activate: Main]{b}, if your Leader Card is a &lt;Dark Broly&gt;"]],
  // 2021-09-03: an orb price on both skills ("[Auto] ●: If …:" written as the catalog's "{r}, if …:").
  "BT13-028": [
    [/\[auto\]\s+If\s+your\s+Leader\s+Card\s+is\s+a\s+<King\s+Vegeta:\s+Br>\s+card:/g, "[auto]{r}, if your Leader Card is a <King Vegeta: Br> card:"],
    [/\[activate:\s+main\]\[once\s+per\s+turn\]\s+Add\s+up\s+to\s+1\s+card\s+from\s+your\s+life/g, "[activate: main][once per turn]{r}: Add up to 1 card from your life"],
  ],
  // 2021-08-06 (back): only an Active Mode Unison can be switched.
  "BT14-061": [[/your\s+green\s+Unison\s+Cards\s+and\s+switch\s+it\s+to\s+Rest\s+Mode/g, "your green Unison Cards in Active Mode and switch it to Rest Mode"]],
  // 2021-08-06: [Quadruple Strike] is no longer printed on its own; the [Auto] grants it with [Dual Attack].
  "BT9-137": [
    [/^\[Quadruple\s+Strike\]<br>/g, ""],
    [/When\s+you\s+play\s+this\s+card,\s+choose\s+up\s+to\s+3\s+cards\s+in\s+your\s+opponent's\s+hand,\s+place\s+them\s+in\s+their\s+Drop\s+Area,\s+and\s+this\s+card\s+gains\s+\[Dual\s+Attack\]\s+for\s+the\s+duration\s+of\s+the\s+turn\./g, "When this card is played, choose up to 3 cards in your opponent's hand and discard them, and this card gains [Quadruple Strike] and [Dual Attack] for the turn."],
  ],
  "BT11-088": [[/&lt;Evil\s+Wizard\s+Babidi&gt;\s+card\s+and\s+you\s+place\s+this\s+card/g, "&lt;Evil Wizard Babidi&gt; card, you have 3 or more energy, and you place this card"]],
  "BT9-111": [[/\[Activate:\s+Main\]\s+If\s+you\s+have\s+a\s+Red\/Blue\s+multicolor/g, "[Activate: Main][Limit 1] If you have a Red/Blue multicolor"]],
  // 2021-04-09: [Sparking 5] is a condition of an [Auto], not a skill type of its own.
  "BT13-139": [[/<br>\[Sparking\s+5\]\s+If\s+your\s+Leader\s+Card\s+is\s+black/g, "<br>[Auto][Sparking 5] If your Leader Card is black"]],
  // 2021-02-12: an [Activate: Main], not an [Auto].
  "EB1-26": [[/\[auto\](\{g\},\s+if\s+all\s+of\s+your\s+energy\s+is\s+green)/g, "[activate: main]$1"]],
  "BT11-064": [[/removed\s+from\s+this\s+card\s+by\s+a\s+skill,/g, "removed from this card by a non-keyword skill,"]],
  "BT9-076": [[/for\s+each\s+card\s+in\s+your\s+Drop\s+Area\s+and\s+Warp\./g, "for each card in your Drop Area and Warp (up to a maximum of 12)."]],
  "P-250": [[/shuffle\s+5\s+mono-blue\s+cards\s+from\s+your\s+Drop\s+Area/g, "shuffle 1 mono-blue card from your Drop Area"]],
  "BT10-153": [[/Reduce\s+the\s+energy\s+cost\s+of\s+this\s+card\s+by\s+1\s+for\s+each/g, "Reduce the energy cost of this card in your hand by 1 for each"]],
  "BT10-036": [[/in\s+your\s+energy\s+with\s+this\s+skill,/g, "in your energy with this card's skill,"]],
  "BT10-040": [[/in\s+your\s+energy\s+with\s+this\s+skill,/g, "in your energy with this card's skill,"]],
  // 2020-05-22: the life card placed in energy also stops further energy placement for the turn
  // (and "1of" is the catalog's typo of the page's "1 of").
  "BT2-036": [[/place\s+it\s+in\s+your\s+Energy\s+Area\.\s+At\s+the\s+end\s+of\s+that\s+turn,\s+choose\s+1\s*of\s+your\s+energy/g, "place it in your Energy Area, and you can't place cards in your Energy Area for the turn. At the end of that turn, choose 1 of your energy"]],
  "BT10-034": [[/\[\+1\]\[Activate:\s+Main\]\s+Add\s+1\s+card\s+in\s+your\s+life\s+to\s+your\s+hand,\s+then\s+choose/g, "[+1][Activate: Main] You may add 1 card in your life to your hand. If you do, choose"]],
  "BT10-038": [[/removed\s+from\s+a\s+Battle\s+Area\s+by\s+a\s+skill,/g, "removed from a Battle Area by an opponent's skill,"]],
  // 2020-05-22 (back): your turn only, and the card goes to your Drop Area.
  "EX09-03": [[/\[Once\s+per\s+turn\]\s+If\s+your\s+life\s+is\s+at\s+5\s+or\s+less\s+and\s+you\s+choose\s+1\s+card\s+under\s+this\s+card\s+and\s+place\s+it\s+in\s+its\s+owner's\s+Drop\s+Area:/g, "[Once per turn] If it's your turn, your life is at 5 or less, and you choose 1 card under this card and place it in your Drop Area:"]],
  // 2020-05-22: no draw after the look.
  "EX10-03": [[/look\s+at\s+the\s+top\s+card\s+of\s+your\s+deck,\s+place\s+the\s+card\s+on\s+the\s+top\s+or\s+bottom\s+of\s+your\s+deck,\s+then\s+draw\s+1\s+card\./g, "look at the top card of your deck and place it on the top or bottom of your deck."]],
  // 2020-03-04: the [Activate: Main] skill is locked for the turn, not the play of the card.
  "BT9-039": [[/you\s+can't\s+play\s+\{Cell,\s+Android\s+Absorber\}\s+for\s+the\s+duration/g, "you can't activate {Cell, Android Absorber}'s [activate: main] skill for the duration"]],
  // 2020-01-20 (back): this card or a <Broly: Br> in the Battle Area, not any of your Rest Mode cards.
  "P-092": [[/Choose\s+up\s+to\s+1\s+of\s+your\s+cards\s+in\s+Rest\s+Mode\s+and\s+switch\s+it\s+to\s+Active\s+Mode/g, "Choose this card or up to 1 &lt;Broly: Br&gt; card in your Battle Area and switch it to Active Mode"]],
  // 2019-11-01, the World Peace family (BT5-119 above): a cost of 3 or less, not the current energy.
  "TB3-064": [[/choose\s+1\s+Battle\s+Card\s+with\s+an\s+energy\s+cost\s+less\s+than\s+or\s+equal\s+to\s+your\s+current\s+energy\s+from\s+your\s+Drop\s+Area/g, "choose 1 Battle Card with an energy cost of 3 or less from your Drop Area"]],
  "TB3-046": [[/in\s+your\s+Drop\s+Area\s+with\s+an\s+energy\s+cost\s+less\s+than\s+or\s+equal\s+to\s+your\s+current\s+energy\s+and\s+play\s+it/g, "in your Drop Area with an energy cost of 3 or less and play it"]],
  // 2019-11-01: the "isn't in play" check moves from the trigger into the price.
  "BT8-110": [
    [/\[Auto\]\s+Choose\s+1\s+of\s+your\s+red\s+Battle\s+Cards\s+with\s+25000/g, "[Auto] If {SS4 Son Goku, a Heartfelt Plea} isn't in play in your Battle Area, choose 1 of your red Battle Cards with 25000"],
    [/activates\s+\[Awaken\],\s+if\s+\{SS4\s+Son\s+Goku,\s+a\s+Heartfelt\s+Plea\}\s+isn't\s+in\s+play\s+in\s+your\s+Battle\s+Area,\s+you\s+may/g, "activates [Awaken], you may"],
  ],
  "BT8-114": [[/\[ex-evolve\]\{r\}\{y\},\s+<Baby>/g, "[ex-evolve]{r}{y}: <Baby>"]],
  // 2019-11-01: [Energy-Exhaust] added.
  "XD2-09": [[/^\[Blocker\]<br>\[Auto\]/g, "[Blocker]<br>[Energy-Exhaust]<br>[Auto]"]],
  // 2019-07-24, five cards: "any color other than <colour>" — a multicolour card with that colour in it counts too.
  "BT7-125": [[/If\s+you\s+have\s+any\s+non-red\s+cards\s+in\s+areas\s+other\s+than\s+your\s+deck,\s+hand,\s+or\s+life,\s+you\s+can't\s+play\s+this\s+card\s+from\s+any\s+area\./g, "You can't play this card from any area if you have cards in areas other than your deck, hand, or life that are any color other than red."]],
  "BT7-126": [[/If\s+you\s+have\s+any\s+non-blue\s+cards\s+in\s+areas\s+other\s+than\s+your\s+deck,\s+hand,\s+or\s+life,\s+you\s+can't\s+play\s+this\s+card\s+from\s+any\s+area\./g, "You can't play this card from any area if you have cards in areas other than your deck, hand, or life that are any color other than blue."]],
  "BT7-127": [[/If\s+you\s+have\s+any\s+non-green\s+cards\s+in\s+areas\s+other\s+than\s+your\s+deck,\s+hand,\s+or\s+life,\s+you\s+can't\s+play\s+this\s+card\s+from\s+any\s+area\./g, "You can't play this card from any area if you have cards in areas other than your deck, hand, or life that are any color other than green."]],
  "BT7-128": [[/If\s+you\s+have\s+any\s+non-yellow\s+cards\s+in\s+areas\s+other\s+than\s+your\s+deck,\s+hand,\s+or\s+life,\s+you\s+can't\s+play\s+this\s+card\s+from\s+any\s+area\./g, "You can't play this card from any area if you have cards in areas other than your deck, hand, or life that are any color other than yellow."]],
  "BT7-129": [[/If\s+you\s+have\s+any\s+non-black\s+cards\s+in\s+areas\s+other\s+than\s+your\s+deck,\s+hand,\s+or\s+life,\s+you\s+can't\s+play\s+this\s+card\s+from\s+any\s+area\./g, "You can't play this card from any area if you have cards in areas other than your deck, hand, or life that are any color other than black."]],
  "EX06-18": [[/Drop\s+Areas\s+by\s+your\s+skills\./g, "Drop Areas by your Leader Card's skills."]],
  "BT5-104": [[/for\s+the\s+duration\s+of\s+the\s+battle\.\s+If\s+it's\s+your\s+turn,/g, "for the duration of the battle, and if it's your turn,"]],
  "BT6-106": [[/and\s+choose\s+20\s+cards\s+from\s+your\s+Drop\s+Area/g, "and choose 30 Battle Cards from your Drop Area"]],
  "BT1-081": [[/affected\s+by\s+your\s+Leader\s+Card\s+Broly's\s+skill/g, "affected by your &lt;Broly&gt; Leader Card's skill"]],
  "TB2-008": [[/15000\s+or\s+less\s+power,\s+add\s+them\s+to\s+your\s+hand/g, "15000 or less power, add them from your deck to your hand"]],
  "BT4-003": [[/power\s+is\s+40000\s+or\s+more,\s+your\s+opponent/g, "power is 40000 or more and your Leader Card is a red ≪Saiyan≫ card, your opponent"]],
  "EX03-16": [[/and\s+KO\s+it\.\s+If\s+they\s+don't\s+KO\s+a\s+card\s+this\s+way/g, "and KO it, and if they don't KO a card this way"]],
  // 2019-01-18: the page's "…to your hand, Then shuffle your deck." with its stray capital.
  "TB3-062": [[/from\s+your\s+deck\s+and\s+add\s+it\s+to\s+your\s+hand\./g, "from your deck and add it to your hand, then shuffle your deck."]],
  "P-073": [[/Extra\s+Card\s+from\s+your\s+deck\s+and\s+add\s+it\s+to\s+your\s+hand,\s+and\s+negate\s+this\s+skill/g, "Extra Card from your deck and add it to your hand, shuffle your deck, and negate this skill"]],
  // 2018-04-20, both sides: your opponent's turn only; the front also negates itself once used.
  "P-028": [
    [/\[Permanent\]\s+When\s+you\s+activate\s+an\s+Extra\s+Card,/g, "[Permanent] During your opponent's turn, when you activate an Extra Card,"],
    [/(by\s+1\s+for\s+the\s+duration\s+of\s+the\s+turn\.\s+If\s+this\s+reduces\s+the\s+energy\s+cost\s+of\s+that\s+Extra\s+Card\s+to\s+less\s+than\s+1,\s+you\s+may\s+activate\s+the\s+card\s+without\s+paying\s+the\s+specified\s+cost\.)(?!\s+If\s+you\s+use\s+this\s+skill)/g, "$1 If you use this skill to add a card in your life to your hand, negate this skill for the duration of the turn."],
  ],
  // 2018-02-16 (the page's note: the skill only activates when the Leader is Buu): ", then".
  "BT3-044": [[/in\s+any\s+order\.\s+Then,\s+take\s+the\s+top\s+2\s+cards/g, "in any order, then take the top 2 cards"]],
  // 2018-02-16: the page's note, "The errata will be issued from the release of series 3."
  "BT2-022": [[/\[Auto\]\s+When\s+you\s+play\s+this\s+card,\s+look\s+at\s+up\s+to\s+7/g, "[Auto] If you have 6 or more red energy, when you play this card, look at up to 7"]],
  // 2018-02-02, four cards the page "now considers to have [Super Combo]" since series 3. Deck
  // legality (`hasKeyword` → `leadingTags`) and the arena both read the keyword from this text, so
  // the tag is added here, with the reminder the catalog prints on the others (TB2-008).
  "BT1-100": [[/^\[Auto\]\s+When\s+you\s+Combo\s+with\s+this\s+card/g, "[Super Combo] (You can only include up to 4 cards with [Super Combo] in your deck.)<br>[Auto] When you Combo with this card"]],
  "BT1-069": [[/^\[Auto\]\s+When\s+you\s+Combo\s+with\s+this\s+card/g, "[Super Combo] (You can only include up to 4 cards with [Super Combo] in your deck.)<br>[Auto] When you Combo with this card"]],
  "BT1-045": [[/^\[Auto\]\s+When\s+you\s+Combo\s+with\s+this\s+card/g, "[Super Combo] (You can only include up to 4 cards with [Super Combo] in your deck.)<br>[Auto] When you Combo with this card"]],
  "BT1-010": [[/^\[Auto\]\s+When\s+you\s+Combo\s+with\s+this\s+card/g, "[Super Combo] (You can only include up to 4 cards with [Super Combo] in your deck.)<br>[Auto] When you Combo with this card"]],
  // 2017-11-27, the page's note: these cards are affected by their own player's removal effects.
  "BT2-055": [[/does\s+not\s+leave\s+the\s+Battle\s+Area\s+due\s+to\s+skills\./g, "does not leave the Battle Area due to your opponent's skills."]],
  "BT2-047": [[/does\s+not\s+leave\s+the\s+Battle\s+Area\s+due\s+to\s+skills\./g, "does not leave the Battle Area due to your opponent's skills."]],
  // 2017-10-20: the card's name is "Golden Frieza, Resurrected Terror" (BT1-086); the page's note
  // calls the old one an erroneous card name.
  "P-018": [[/\{Golden\s+Frieza,\s+The\s+Resurrected\s+Terror\}/g, "{Golden Frieza, Resurrected Terror}"]],
  "BT2-081": [[/from\s+you\s+hand\s+without/g, "from your hand without"]],
  // 2017-10-20, the page's note: "Unnecessary text. Skip the unnecessary text".
  "BT2-065": [[/choose\s+2\s+instead\.\s+Add\s+the\s+choose\s+up\s+to\s+2\s+instead\./g, "choose up to 2 instead."]],
  // 2017-07-27, the page's note: shuffling after the look was unintentionally omitted.
  "BT1-061": [[/among\s+them\s+and\s+add\s+it\s+to\s+your\s+hand\.(?!\s*Then)/g, "among them and add it to your hand. Then, shuffle your deck."]],

  // ── Fusion World (display only — the arena does not play it) ──────────────
  "FB04-032": [[/Plce\s+this\s+card/g, "Place this card"]],
  "FB04-077": [[/draw\s+1\s+cad\./g, "draw 1 card."]],
  "FB05-106": [[/damage\s+with\s+an\s+attach,/g, "damage with an attack,"]],
  "FB07-017": [[/card\s+name\s+anda\s+cost\s+of\s+2/g, "card name and a cost of 2"]],
  "FB07-027": [[/then\s+retun\s+this\s+card/g, "then return this card"]],
  "FB07-034": [[/cards\s+of\s+your\s+eck/g, "cards of your deck"]],
  "FB07-110": [[/with\s+acost\s+of\s+2/g, "with a cost of 2"]],
  "FB08-117": [[/the\s+next\s+tim\s+you\s+use/g, "the next time you use"]],
  "FB09-025": [[/draw\s+1\s+card\s+fro\s+each/g, "draw 1 card for each"]],
  "FB09-106": [[/card's\s+cst\s+is\s+6/g, "card's cost is 6"]],
  "FB09-120": [[/opponent's\s+Batle\s+Area/g, "opponent's Battle Area"]],
  "FB10-032": [[/bottom\s+of\s+their\s+owner'\s+deck/g, "bottom of their owner's deck"]],
  "FB11-051": [[/this\s+card\s+gests\s+\+10000/g, "this card gets +10000"]],
  "FB11-073": [[/or\s+less\s+fro\s+the\s+turn/g, "or less for the turn"]],
  "FP-085": [[/to\s+your\s+han\./g, "to your hand."]],
  // The only correction here that changes a *card name*, so it was checked
  // against Bandai's own art rather than guessed: the printed effect box reads
  // "without <Son Goku> in their card names".
  // https://www.dbs-cardgame.com/fw/images/cards/card/en/SB01-046.webp
  "SB01-046": [[/without\s+<Son\s+Gokue>/g, "without <Son Goku>"]],
  "SB02-047": [[/your\s+life\s+dring\s+this\s+turn/g, "your life during this turn"]],
  "SB02-054": [[/by\s+an\s+ooponent's\s+skill/g, "by an opponent's skill"]],
  "ST01-027": [[/energy,\s+duing\s+this\s+turn/g, "energy, during this turn"]],

  // Prohibition batch 5 (26 Oct 2026). NOT an official erratum: the catalog's copy runs three
  // skills into one line ("[energy-exhaust] [arrival red/yellow]{y}, if your Leader is {Super
  // Baby 2, Awakened Malevolence}: [permanent] This card can't [evolve] into other cards."), so
  // the line was read as an [Energy-Exhaust] with the [Arrival] lost and the [Permanent] left
  // unread. [Arrival] ends at its cost (22-29-2); each keyword and the [Permanent] is a skill of
  // its own, as the card prints them on lines of their own (every other [Arrival] card's copy
  // breaks the line there too). This moves the card's skill indices: [Arrival] #10,
  // [Permanent] #20, [Activate: Battle] #30.
  "EX25-37": [
    [/\[energy-exhaust\]\s+\[arrival/g, "[energy-exhaust]<br>[arrival"],
    [/(\{Super\s+Baby\s+2,\s+Awakened\s+Malevolence\}):\s+\[permanent\]/g, "$1:<br>[permanent]"],
  ],

  // Audit lane C (2 Nov 2026). NOT official errata: catalog misprints the compiler read literally, each a condition or
  // a measure lost. A name no card has ("<Suepr 17>", "{Zen-Oh, Once Who Wipes Away}" — the Leader is {Zen-Oh, One
  // Who Wipes Away}) made the skill unusable; a broken measure ("cost o 4", "power of less", "5or less") was dropped,
  // so the choice took any card. P-020's copy breaks its one [Auto] sentence in two at a <br>, and the second half
  // became a [Permanent] that gave [Double Strike] always.
  "BT26-018": [[/<Suepr\s+17>/g, "<Super 17>"]],
  "BT27-115": [[/\{Zen-Oh,\s+Once\s+Who\s+Wipes\s+Away\}/g, "{Zen-Oh, One Who Wipes Away}"]],
  "BT27-045": [[/energy\s+cost\s+o\s+4/g, "energy cost of 4"]],
  "BT30-008": [[/25000\s+power\s+of\s+less/g, "25000 power or less"]],
  "P-606": [[/energy\s+cost\s+of\s+5or\s+less/g, "energy cost of 5 or less"]],
  "P-020": [[/with\s+this\s+skill,\s*<br>\s*this\s+card\s+gains/g, "with this skill, this card gains"]],
  // Review of lane C (2 Nov 2026), the same kind of misprint: "card **wth** 5000 combo power" (P-747) lost its measure
  // (BT31-041's "wth" is with that card's other correction above), and "a red Unison with a **specific** cost of 3"
  // (BT30-014) is the specified cost (1-2-4) — read as nothing, any card or Unison passed.
  "P-747": [[/card\s+wth\s+5000\s+combo\s+power/g, "card with 5000 combo power"]],
  "BT30-014": [[/red\s+Unison\s+with\s+a\s+specific\s+cost\s+of\s+3/g, "red Unison with a specified cost of 3"]],
};

/**
 * Official errata (#934), kept as data for audit: what the catalog snapshot
 * prints (`snapshot`), what Bandai's errata page says it should read
 * (`corrected`), and the page's own before/after (`officialBefore`/`officialAfter`).
 * `snapshot` and `corrected` are the full skill clause as the catalog stores it
 * (inventory.json of #923, 15 Oct 2026; P-360 and BT4-108 are the clause the
 * errata names, which the Union audit did not list in full); `CORRECTIONS`
 * above is what makes the first become the second on every sync.
 */
export const OFFICIAL_ERRATA: {
  cardId: string;
  dated: string;
  snapshot: string;
  corrected: string;
  officialBefore: string;
  officialAfter: string;
}[] = [
  {
    cardId: "BT2-015",
    dated: "2017-10-20",
    snapshot: "[union-fusion] {r}{1}:<Son Goten> and <Trunks: Youth> (Place 1 each of the specified card with the same power into your Drop Area and play this card)",
    corrected: "[union-fusion] {r}{1}:<Son Goten> and <Trunks: Youth> (Place 1 each of the specified card with the same power from your hand into your Drop Area and play this card)",
    officialBefore: "(Place 1 each of the specified card with the same power into your Drop Area and play this card)",
    officialAfter: "(Place 1 each of the specified card with the same power from your hand into your Drop Area and play this card)",
  },
  {
    cardId: "BT22-137",
    dated: "2023-08-25",
    snapshot: "[union-fusion]{u}{y}{2}, if your opponent has 3 or more energy and draws 2 cards: Yellow <Son Goku> card with 5000 power and blue <Vegeta> card with 5000 power.",
    corrected: "[union-fusion]{u}{y}{2}, if your opponent has 3 or more energy and you draw 2 cards: Yellow <Son Goku> card with 5000 power and blue <Vegeta> card with 5000 power.",
    officialBefore: "[Union-Fusion] ● ● (2), if your opponent has 3 or more energy and draws 2 cards : Yellow <Son Goku> card with 5000 power and blue <Vegeta> card with 5000 power.",
    officialAfter: "[Union-Fusion] ● ● (2), if your opponent has 3 or more energy and you draw 2 cards : Yellow <Son Goku> card with 5000 power and blue <Vegeta> card with 5000 power.",
  },
  {
    cardId: "BT3-070",
    dated: "2018-03-02",
    snapshot: "[union absorb] {g} , choose up to 1 each of <Android 14> and <Android 15> from your Drop Area and place them under this card: Choose up to 1 <Android 13> with an energy cost of 7 from your deck and play it on top of this card. Then, shuffle your deck.",
    corrected: "[union absorb] {g} , choose 1 each of <Android 14> and <Android 15> from your Drop Area and place them under this card: Choose up to 1 <Android 13> with an energy cost of 7 from your deck and play it on top of this card. Then, shuffle your deck.",
    officialBefore: "[Union-Absorb] ● , choose up to 1 each",
    officialAfter: "[Union-Absorb] ● , choose 1 each",
  },
  {
    cardId: "BT4-108",
    dated: "2018-07-13",
    snapshot: "[auto] When this card attacks, this card gains +5000 power for each card in your Warp.",
    corrected: "[auto] When this card attacks, this card gains +5000 power for each card in your Warp for the duration of the turn.",
    officialBefore: "[Auto] When this card attacks, this card gains +5000 power for each card in your Warp.",
    officialAfter: "[Auto] When this card attacks, this card gains +5000 power for each card in your Warp for the duration of the turn .",
  },
  {
    cardId: "P-360",
    dated: "2022-02-10",
    snapshot: "[activate: battle][once per turn] Choose up to 1 red or blue ≪Saiyan≫ card in your hand and discard it: Look at up to 3 cards from the top of your deck,",
    corrected: "[activate: battle][once per turn] Choose 1 red or blue ≪Saiyan≫ card in your hand and discard it: Look at up to 3 cards from the top of your deck,",
    officialBefore: "[Activate Battle][Once per turn] Choose up to 1 red or blue 《Saiyan》 card in your hand and discard it : Look at up to 3 cards from the top of your deck,",
    officialAfter: "[Activate Battle][Once per turn] Choose 1 red or blue 《Saiyan》 card in your hand and discard it : Look at up to 3 cards from the top of your deck,",
  },
];

/** The printed text with the source's typos corrected. Safe to call twice. */
export function correctSkillText(cardId: string, text: string | null | undefined): string | null {
  if (text == null) return null;
  let out = spaceBeforeKeyword(text);
  for (const [wrong, right] of CORRECTIONS[cardId] ?? []) out = out.replace(wrong, right);
  return out;
}

/**
 * Which per-card corrections no longer match anything in the text they are
 * about, given every side of every card as `${cardId}` → its **uncorrected**
 * text, straight from the source.
 *
 * A correction is a claim that the source says something wrong. When the claim
 * stops being true the line has to go, or it sits here forever looking like it
 * is doing something.
 *
 * A card that is simply absent from the payload is not reported: each game is
 * synced on its own, so half these ids are missing every time this is asked.
 */
export function unmatchedCorrections(textsByCard: Map<string, string[]>): string[] {
  const out: string[] = [];
  for (const [cardId, pairs] of Object.entries(CORRECTIONS)) {
    const texts = textsByCard.get(cardId);
    if (!texts) continue;
    for (const [wrong] of pairs) {
      if (!texts.some((t) => new RegExp(wrong.source).test(t))) out.push(`${cardId}: /${wrong.source}/ matches nothing`);
    }
  }
  return out;
}

// ── What a card *is*: names, character names, specified cost ────────────────

/**
 * Official errata to a card's identity rather than its skill text: its card name, its back's name and its character
 * names (2-3, 2-10). The feed prints the misprint, as it prints the skill-text ones above, so the catalog sync
 * corrects these on the way in the same way (`correctCardFields`, called by `shapeCatalog`) and re-checks every claim
 * against the payload it just fetched (`unmatchedFieldCorrections`): each is a `[printed, official]` pair, and a
 * printed side that no longer matches means the source was fixed upstream (delete the line) or moved (look at it).
 *
 * Names matter to play, not only to display: "{Kaio-Ken Son Goku, Maximum Gains}" (BT15-068's corrected text) finds a
 * card by its card name, and "<Black Masked Saiyan>" a card by a character name.
 */
export const FIELD_CORRECTIONS: Record<string, { name?: [string, string]; backName?: [string, string]; characters?: [string[], string[]] }> = {
  // 2025-01-17: "The character name is Sansyo, and the card is treated as <Sansyo, Interference>" (the feed already
  // prints the character, not the card name).
  "P-642": { name: ["Sansho, Interference", "Sansyo, Interference"] },
  // 2020-06-03: "Character: 〈Vegeta/Trunks: Future〉".
  "BT10-144": { characters: [["Vegeta", "Trunks"], ["Vegeta", "Trunks: Future"]] },
  // 2019-06-28: "The correct character name is Evil Wizard Babidi".
  "P-144": { characters: [["Babidi"], ["Evil Wizard Babidi"]] },
  // 2018-11-09: "The correct character name is Black Masked Saiyan … just like any other <Black Masked Saiyan> card".
  "P-075": { characters: [["Masked Saiyan"], ["Black Masked Saiyan"]] },
  // Not on the errata page: Bandai's card list names BT15-067 "Kaio-Ken Son Goku, Maximum Gains" (checked 2026-11-02,
  // https://www.dbs-cardgame.com/us-en/cardlist/index.php?free=BT15-067&search=true), and BT15-068's erratum of
  // 2021-11-01 names it so; the feed drops the "Kaio-Ken". Without this the corrected BT15-068 would find no card.
  "BT15-067": { name: ["Son Goku, Maximum Gains", "Kaio-Ken Son Goku, Maximum Gains"] },
};

/**
 * Official specified costs, in `cards.specified_cost`'s own notation (`specified-cost.ts`). The feed carries no orbs,
 * so the sync writes these over whatever is stored; `-` is "no colour at all", Bandai's "Color Cost: -".
 */
export const SPECIFIED_COST_CORRECTIONS: Record<string, string> = {
  // 2023-12-08: "Color Cost: ● → -". Its cost of 2 is all generic; the fixed-cost convention (`specifiedCostOf`)
  // would otherwise charge one black orb.
  "BT19-140": "-",
};

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** A card's name, back name and character names with the official errata applied. Safe to call twice. */
export function correctCardFields<T extends { name: string; backName: string | null; characters: string[] }>(cardId: string, fields: T): T {
  const fix = FIELD_CORRECTIONS[cardId];
  if (!fix) return fields;
  const out = { ...fields };
  if (fix.name && out.name === fix.name[0]) out.name = fix.name[1];
  if (fix.backName && out.backName === fix.backName[0]) out.backName = fix.backName[1];
  if (fix.characters && sameList(out.characters, fix.characters[0])) out.characters = [...fix.characters[1]];
  return out;
}

/**
 * Which identity corrections no longer match the card as the source prints it (`${cardId}` → its uncorrected
 * fields). A card absent from the payload is not reported, as in `unmatchedCorrections`.
 */
export function unmatchedFieldCorrections(fieldsByCard: Map<string, { name: string; backName: string | null; characters: string[] }>): string[] {
  const out: string[] = [];
  for (const [cardId, fix] of Object.entries(FIELD_CORRECTIONS)) {
    const f = fieldsByCard.get(cardId);
    if (!f) continue;
    if (fix.name && f.name !== fix.name[0]) out.push(`${cardId}: name "${fix.name[0]}" is now "${f.name}"`);
    if (fix.backName && f.backName !== fix.backName[0]) out.push(`${cardId}: back name "${fix.backName[0]}" is now "${f.backName}"`);
    if (fix.characters && !sameList(f.characters, fix.characters[0])) out.push(`${cardId}: characters ${JSON.stringify(fix.characters[0])} are now ${JSON.stringify(f.characters)}`);
  }
  return out;
}
