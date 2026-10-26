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
  "BT26-071": [[/both\s+gree\s+and\s+with/g, "both green and with"]],
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
  "BT31-016": [[/from\s+its\s+owner'\s+Warp/g, "from its owner's Warp"]],
  "BT31-017": [[/at\s+5\s+or\s+lees/g, "at 5 or less"]],
  "BT31-041": [[/Whe\s+this\s+card\s+attacks/g, "When this card attacks"]],
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
  "BT7-053": [[/look\s+at\s+up\s+7\s+cards/g, "look at up to 7 cards"]],
  // The generic energy cost printed as a bare number: the source lost the braces of the orb ({1}, {3}).
  "BT6-081": [[/\[Activate:\s+Main\]\s+3,\s+choose\s+1\s+\{Display/g, "[Activate: Main] {3}, choose 1 {Display"]],
  "BT6-096": [[/\[Activate:\s+Main\]\s+1,\s+place\s+this\s+card/g, "[Activate: Main] {1}, place this card"]],
  "BT25-108": [[/to\s+your\s+hand,\s+the\s+shuffle\s+your\s+deck/g, "to your hand, then shuffle your deck"]],
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
