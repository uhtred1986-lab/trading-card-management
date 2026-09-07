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
  "BT3-104": [[/your\s+opponent's\s+can\s+only\s+attack/g, "your opponent can only attack"]],
  "BT4-059": [[/<Lord\s+Slug>with/g, "<Lord Slug> with"]],
  "BT6-013": [[/1\s+red&lt;Vegeta:\s+Br&gt;/g, "1 red &lt;Vegeta: Br&gt;"]],
  "BT20-083": [[/≪Saiyan≫card/g, "≪Saiyan≫ card"]],
  "BT25-032": [[/2\s+oor\s+more\s+energy/g, "2 or more energy"]],
  "BT25-054": [[/shuffle\s+your\s+dec\./g, "shuffle your deck."]],
  "BT25-061": [[/all\s+blue\s+adn\s+with/g, "all blue and with"]],
  "BT25-086": [[/Active\s+Moe/g, "Active Mode"]],
  "BT25-125": [[/send\s+this\s+card\s+rom\s+your\s+Drop/g, "send this card from your Drop"]],
  "BT25-134": [
    [/Rest\s+Moe:/g, "Rest Mode:"],
    [/up\s+to\s+5\s+crds\s+from\s+the\s+top\s+o\s+your\s+deck/g, "up to 5 cards from the top of your deck"],
  ],
  "BT25-138": [[/copies\s+of\s+thi\s+card/g, "copies of this card"]],
  "BT26-071": [[/both\s+gree\s+and\s+with/g, "both green and with"]],
  "BT26-085": [[/negated\s+fro\s+the\s+turn/g, "negated for the turn"]],
  "BT26-093": [
    [/Rest\s+Mode\s+Batle\s+Cards/g, "Rest Mode Battle Cards"],
    [/KO\s+it,\s+the\s+play\s+up\s+to\s+1/g, "KO it, then play up to 1"],
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
  "BT29-105": [[/send\s+itto\s+its\s+owner's\s+Warp/g, "send it to its owner's Warp"]],
  "BT29-106": [[/Hidden\s+Mode\s+crds/g, "Hidden Mode cards"]],
  "BT30-048": [[/bottom\s+of\s+ther\s+owner's\s+deck/g, "bottom of their owner's deck"]],
  "BT30-073": [[/your\s+opponnt's\s+Battle\s+Cards/g, "your opponent's Battle Cards"]],
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
  "BT31-150": [[/card\s+is\s+plyed/g, "card is played"]],
  "P-156": [[/2\s+or\s+more≪World\s+Tournament≫/g, "2 or more ≪World Tournament≫"]],
  "P-431": [[/\{y\}\{y\}\{3\}Yellow/g, "{y}{y}{3} Yellow"]],
  "P-620": [[/from\s+your\s+dec\s+or\s+hand/g, "from your deck or hand"]],
  "P-621": [[/If\s+your\s+Leaderis\s+a/g, "If your Leader is a"]],
  "P-751": [[/into\s+its\s+owner'\s+Drop/g, "into its owner's Drop"]],
  "TB2-065": [[/≪World\s+Tournament≫Battle\s+Cards/g, "≪World Tournament≫ Battle Cards"]],

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
