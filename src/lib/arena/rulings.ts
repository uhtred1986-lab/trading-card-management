/**
 * The rulings ledger: every decision about how a printed wording plays, in one place, with where
 * it came from and how sure it is. It is the durable record behind the compiler's readings — a
 * glossary entry or a verify suite says *what* the engine does; an entry here says *why*, and
 * what to revisit if the reason changes.
 *
 * - An id (`R-001`) is never reused. A ruling that changes is not edited into its opposite: add
 *   a new entry, set the old one `superseded` with `supersededBy`, and refresh the cards it named.
 * - `pending` is a best-guess reading already implemented that the owner has not confirmed yet;
 *   `npm run arena:rulings -- --pending` lists them for review.
 * - `basis` says what decided it. In order of weight: the rule manual (`manual`), Bandai's card
 *   or game Q&A (`official-qa`), an official errata (`errata`), an official answer for a card
 *   printing the same wording (`same-wording`), the owner (`owner`), and — only when every
 *   source is silent — design intent (`intent`, R-001).
 * - `cards` are the cards it was decided on (examples, not a closed list); `wording` is a
 *   case-insensitive pattern for the printed family when there is one.
 *
 * Checked by `scripts/verify/rulings.ts`; read by `npm run arena:rulings` and `arena:intent`.
 */
export type RulingBasis = "manual" | "official-qa" | "errata" | "same-wording" | "owner" | "intent";
export type RulingConfidence = "official" | "owner" | "best-guess";
export type RulingStatus = "active" | "pending" | "superseded";

export interface Ruling {
  id: string;
  /** The day it was decided (YYYY-MM-DD). */
  date: string;
  ruling: string;
  cards: string[];
  wording?: string;
  basis: RulingBasis[];
  /** Rule manual sections ("RM 9-10-3"), Q&A ("Q&A P-106"), PRs ("#1229"). */
  refs?: string[];
  confidence: RulingConfidence;
  status: RulingStatus;
  supersededBy?: string;
}

export const RULINGS: Ruling[] = [
  // ── Policy ────────────────────────────────────────────────────────────────────────────────
  { id: "R-001", date: "2026-11-02", cards: [], basis: ["owner"], confidence: "owner", status: "active",
    ruling: "When the rule manual, the card and game Q&A, the errata and official answers for cards with the same wording are all silent, decide by design intent: the reading that lets the card do its job with the Leaders of its own release and the release before it, preferring the more interactive and fun play. Long-term accuracy beats shortcuts; earlier decisions are reversible (supersede them here and refresh their cards)." },

  // ── Before 26 Oct 2026 (deck rows and phrasing batches 1–4) ───────────────────────────────
  { id: "R-002", date: "2026-10-25", cards: ["SD8-08", "P-106"], basis: ["official-qa", "owner"], refs: ["Q&A P-106"], confidence: "official", status: "active",
    ruling: "\"Cards in Rest Mode\" counts rested cards in every area that holds them — Leader, Battle and Energy Areas — Unisons included." },
  { id: "R-003", date: "2026-10-25", cards: ["BT31-025"], basis: ["owner"], confidence: "owner", status: "active",
    ruling: "BT31-025's description means a red Battle Card or any Unison (the colour binds the Battle Card only)." },
  { id: "R-004", date: "2026-10-25", cards: ["SD3-04"], basis: ["owner"], confidence: "owner", status: "active",
    ruling: "SD3-04 needs 7 or more cards in your Warp, and its discount applies while it is in your hand and in your Warp." },
  { id: "R-005", date: "2026-10-25", cards: ["BT1-073"], basis: ["owner"], confidence: "owner", status: "active",
    ruling: "BT1-073: the player may take fewer than printed; the cards taken are then picked at random." },
  { id: "R-006", date: "2026-10-25", cards: [], wording: "warp.*up to \\d+|up to \\d+.*warp", basis: ["owner"], confidence: "owner", status: "active",
    ruling: "Moving \"up to N\" cards to or from a Warp moves them one at a time." },
  { id: "R-007", date: "2026-10-25", cards: [], wording: "top or bottom", basis: ["owner"], confidence: "owner", status: "active",
    ruling: "\"Place … on the top or bottom of the deck\" is decided per card, not once for the group." },
  { id: "R-008", date: "2026-10-25", cards: ["BT26-027"], basis: ["owner", "errata"], confidence: "owner", status: "active",
    ruling: "BT26-027's comma is a full stop: the two halves are separate sentences (recorded in errata.ts)." },
  { id: "R-009", date: "2026-10-25", cards: ["BT9-100"], basis: ["owner"], refs: ["#1135"], confidence: "owner", status: "active",
    ruling: "An [Awaken]'s draw is mandatory even where a card prints \"you may draw\" (the #1135 Awaken ruling); a player practically never declines it." },
  { id: "R-010", date: "2026-10-26", cards: ["BT24-096"], basis: ["owner"], confidence: "owner", status: "active",
    ruling: "BT24-096's count includes energy and Unisons." },
  { id: "R-011", date: "2026-10-26", cards: ["BT14-154"], basis: ["owner"], confidence: "owner", status: "active",
    ruling: "BT14-154's \"that card\" is the countered card." },
  { id: "R-012", date: "2026-10-26", cards: ["P-711", "BT17-112", "BT25-068"], wording: "(?:--|[-—–―])\\s*(?:both|all)\\b", basis: ["owner"], confidence: "owner", status: "active",
    ruling: "A \"—both …—\" / \"—all …—\" aside after alternatives applies to every alternative (\"<A> or a card with <B> -- both multicolor\" is two multicolour alternatives)." },
  { id: "R-013", date: "2026-10-26", cards: [], basis: ["owner"], confidence: "owner", status: "active",
    ruling: "An exact price (\"choose 2 …\" as a cost) is never paid short: if it cannot be paid in full, the skill cannot be activated." },
  { id: "R-014", date: "2026-10-26", cards: ["DB2-126", "EX12-07"], basis: ["owner"], refs: ["#1229"], confidence: "owner", status: "active",
    ruling: "A [Counter: Play] that switches the card being played to Rest Mode waits until it lands, then makes the switch as the counter's own (so \"switched to Rest Mode\" moments fire); the counter player may choose that card." },
  { id: "R-015", date: "2026-10-26", cards: ["P-327"], wording: "keyword skills negated|negate (?:its|their) keyword skills", basis: ["owner"], refs: ["#1229", "#1232"], confidence: "owner", status: "active",
    ruling: "\"With its keyword skills negated\" negates the card's keyword skills, printed and granted, and its [Counter]s — never its other skills." },
  { id: "R-016", date: "2026-10-26", cards: ["BT26-015"], basis: ["owner"], refs: ["#1229"], confidence: "owner", status: "active",
    ruling: "\"Shuffle your Drop\" does nothing (the Drop is an open, unordered area)." },
  { id: "R-017", date: "2026-10-26", cards: [], basis: ["owner"], confidence: "owner", status: "active",
    ruling: "Energy Marker reminder lines are not skills; their card_rules rows are closed." },

  // ── Prohibitions (20-14), batches 2–6 ─────────────────────────────────────────────────────
  { id: "R-018", date: "2026-10-26", cards: ["BT10-065", "BT8-040", "BT30-030"], wording: "can'?t be removed from (?:a|the|your) battle area by", basis: ["owner"], confidence: "owner", status: "active",
    ruling: "A KO by a skill is a removal: \"can't be removed from a Battle Area by … skills\" also stops that skill's KO (and the once-per-turn shield stands in front of it), never the battle's KO." },
  { id: "R-019", date: "2026-10-26", cards: ["BT20-024"], basis: ["owner"], confidence: "owner", status: "active",
    ruling: "\"You can't activate Extras\" stops activating Extra Cards (12-1-3), their [Counter]s included." },
  { id: "R-020", date: "2026-10-26", cards: ["BT9-071", "P-093"], wording: "can'?t activate (?:its |their )?skills", basis: ["manual", "owner"], refs: ["RM 22-4"], confidence: "owner", status: "active",
    ruling: "[Blocker] is an activated skill, so \"can't activate skills\" also stops a card blocking." },
  { id: "R-021", date: "2026-10-26", cards: ["BT11-153", "BT18-109", "EX21-03"], wording: "would be removed from (?:a|the|your) battle area,", basis: ["owner"], confidence: "owner", status: "active",
    ruling: "A replacement for a removal with no cause named answers every removal a skill makes and every KO, the battle's included." },
  { id: "R-022", date: "2026-10-26", cards: ["DB2-156"], basis: ["owner"], confidence: "owner", status: "active",
    ruling: "\"Cards in your hand can't be … by your opponent's skills for the turn\" protects the hand as a zone: a card that enters it later is protected too." },
  { id: "R-023", date: "2026-10-26", cards: ["BT6-017", "BT6-023"], wording: "can'?t play [^.]*unless", basis: ["owner"], refs: ["RM 20-14-1"], confidence: "owner", status: "active",
    ruling: "A play tax binds a skill's play too, a keyword's included; the tax is asked of the card's player, and an unpaid tax leaves the card unplayed." },
  { id: "R-024", date: "2026-10-26", cards: ["BT6-023"], basis: ["owner", "manual"], refs: ["RM 22-5-7", "#1226", "#1230"], confidence: "owner", status: "active",
    ruling: "A keyword that plays its own card ([Evolve], [Union-*], [Arrival], [Successor], [Over Realm]) is not offered while a play tax on that card can't be paid after the keyword's own costs (energy, [Revive] colour cards, materials, Over Realm's Drop); [Revive] is not asked at all. A payable tax that is declined is a failed play: the card goes to the Drop and what was paid stays paid." },
  { id: "R-025", date: "2026-10-26", cards: ["BT13-030"], basis: ["manual", "owner"], refs: ["RM 20-14-1", "#1226"], confidence: "owner", status: "active",
    ruling: "BT13-030: the attacker pays the -5000 before the attack is declared, and it stays for the turn even if the attack is then negated." },
  { id: "R-026", date: "2026-10-26", cards: ["BT30-146"], basis: ["owner"], refs: ["#1226"], confidence: "owner", status: "active",
    ruling: "BT30-146's \"next Charge Phase\" is the opponent's; only cards in their Battle and Unison Areas stay rested (not energy); skills may still switch them." },
  { id: "R-027", date: "2026-10-26", cards: ["BT4-003"], basis: ["owner"], refs: ["#1226"], confidence: "owner", status: "active",
    ruling: "\"You may not activate [EX-Evolve]\" stops [EX-Evolve] only, not [Evolve] or [Xeno-Evolve]." },
  { id: "R-028", date: "2026-10-26", cards: ["BT4-104"], basis: ["owner"], refs: ["#1226"], confidence: "owner", status: "active",
    ruling: "BT4-104 stops plays from the hand made by the opponent's skills of cards with [Super Combo]; a declared play is not stopped." },
  { id: "R-029", date: "2026-10-26", cards: ["P-021"], basis: ["owner"], refs: ["#1226"], confidence: "owner", status: "active",
    ruling: "\"<A>, <B> and <C> in your Drop Area\" needs all three named cards, one of each." },
  { id: "R-030", date: "2026-10-26", cards: ["BT6-081"], basis: ["owner"], refs: ["#1226"], confidence: "owner", status: "active",
    ruling: "BT6-081 can never be used in a combo while its condition fails, from the hand or the Battle Area." },
  { id: "R-031", date: "2026-10-26", cards: ["P-676"], basis: ["owner"], refs: ["RM 13-5-2", "#1226"], confidence: "owner", status: "active",
    ruling: "P-676 stops only skills removing markers; the marker an attack on a Unison removes (13-5-2) still goes." },
  { id: "R-032", date: "2026-10-26", cards: ["BT9-087"], basis: ["owner"], refs: ["#1226"], confidence: "owner", status: "active",
    ruling: "On a [Counter: Attack], \"until the end of your next turn\" runs through the opponent's current turn and your next one; \"be placed in your opponent's Combo Area\" means \"can't be used in a combo\"." },
  { id: "R-033", date: "2026-10-26", cards: ["BT8-089"], basis: ["owner"], refs: ["#1226"], confidence: "owner", status: "active",
    ruling: "BT8-089's \"the player who attacked\" is the turn player; any token counts; their Leader and Unisons may still attack." },
  { id: "R-034", date: "2026-10-26", cards: ["EX25-37"], basis: ["owner", "errata"], refs: ["#1226"], confidence: "owner", status: "active",
    ruling: "EX25-37's catalog line is three separate skills ([Arrival], [Permanent], [Activate: Battle]); split in errata.ts." },
  { id: "R-035", date: "2026-10-27", cards: ["P-474"], basis: ["owner"], refs: ["#1230"], confidence: "owner", status: "active",
    ruling: "\"This card can't be added to a player's hand\" stops a skill's move only, not a draw or damage." },
  { id: "R-036", date: "2026-10-27", cards: ["BT12-001", "BT15-091", "EX19-08"], basis: ["owner"], refs: ["#1230"], confidence: "owner", status: "active",
    ruling: "On an awakened Leader, \"flip this card over\" turns it back to its front; a Leader-family \"flip over\" (EX19-08) stays one-way." },
  { id: "R-037", date: "2026-10-27", cards: ["BT22-113"], basis: ["owner"], refs: ["#1230"], confidence: "owner", status: "active",
    ruling: "BT22-113's \"you\" binds only its controller." },
  { id: "R-038", date: "2026-10-27", cards: ["SD14-01", "EX13-23", "P-485"], wording: "you can only play", basis: ["owner"], refs: ["#1230"], confidence: "owner", status: "active",
    ruling: "\"You can only play mono-black Battle Cards\" restricts plays of Battle Cards only; a card kind it names narrows the rule." },
  { id: "R-039", date: "2026-10-27", cards: ["P-668"], basis: ["owner"], refs: ["#1230"], confidence: "owner", status: "active",
    ruling: "P-668's power shield leaves out rules that carry an escape; taxes and the card's own power price are unaffected." },
  { id: "R-040", date: "2026-10-27", cards: ["BT25-047"], basis: ["owner"], refs: ["#1230"], confidence: "owner", status: "active",
    ruling: "\"Up to 1 of the placed cards\" may choose none." },
  { id: "R-041", date: "2026-10-27", cards: ["BT21-052"], basis: ["owner"], refs: ["#1230"], confidence: "owner", status: "active",
    ruling: "BT21-052's \"Leader Area\" means the cards under the Leader." },
  { id: "R-042", date: "2026-10-27", cards: ["EX04-04"], basis: ["owner"], refs: ["#1230"], confidence: "owner", status: "active",
    ruling: "\"KO'd by your opponent\" means any battle KO plus a KO by an opponent's skill." },
  { id: "R-043", date: "2026-10-27", cards: ["BT8-044"], basis: ["owner"], refs: ["#1230"], confidence: "owner", status: "active",
    ruling: "BT8-044's escape ends when the chosen card leaves play." },

  // ── Phrasing batches 5–6 ──────────────────────────────────────────────────────────────────
  { id: "R-044", date: "2026-10-26", cards: ["BT23-103", "BT23-109"], basis: ["owner"], refs: ["#1229"], confidence: "owner", status: "active",
    ruling: "\"When your opponent's life is added to its owner's Z-Energy by your skill\" fires once per card moved." },
  { id: "R-045", date: "2026-10-26", cards: ["BT12-057", "BT13-124", "BT12-126"], basis: ["owner"], refs: ["#1231"], confidence: "owner", status: "active",
    ruling: "A Leader (or life) condition printed in a [Rejuvenate] gates the keyword: it is not offered while the condition fails." },
  { id: "R-046", date: "2026-10-26", cards: ["P-454", "BT23-081", "P-493"], wording: "negate (?:its |their )?\\[indestructible\\]", basis: ["owner"], refs: ["#1231"], confidence: "owner", status: "active",
    ruling: "\"Negate [Indestructible], and KO it\" with no duration printed lasts for the turn, applied before the KO or move." },
  { id: "R-047", date: "2026-10-26", cards: ["BT9-037", "BT22-031", "BT24-002"], wording: "in all areas", basis: ["owner"], refs: ["#1231"], confidence: "owner", status: "active",
    ruling: "A standing keyword negation \"in all areas\" covers every area of yours: such a card placed in energy arrives in Active Mode." },
  { id: "R-048", date: "2026-10-26", cards: ["EX16-02"], basis: ["owner"], refs: ["#1231"], confidence: "owner", status: "active",
    ruling: "EX16-02 draws only if the card put at the bottom came from the hand." },
  { id: "R-049", date: "2026-10-27", cards: ["BT9-104", "EX10-03"], basis: ["owner"], refs: ["#1231"], confidence: "owner", status: "active",
    ruling: "An effect's [Energy-Exhaust] negation before placing cards in energy lasts for the turn." },
  { id: "R-050", date: "2026-10-27", cards: ["BT15-155", "BT15-095"], basis: ["owner"], refs: ["#1231"], confidence: "owner", status: "active",
    ruling: "\"In play\" with no owner in a count means both players' cards." },
  { id: "R-051", date: "2026-10-27", cards: ["BT30-030"], basis: ["owner"], refs: ["#1231"], confidence: "owner", status: "active",
    ruling: "\"When your energy is placed at the bottom of the deck\" answers a move to the bottom only." },
  { id: "R-052", date: "2026-10-27", cards: ["BT7-069", "EX06-03", "BT1-051", "EX06-13"], wording: "\\[awaken[^\\]]*\\][^.]*even (?:if|when)", basis: ["owner"], refs: ["#1231"], confidence: "owner", status: "active",
    ruling: "An [Awaken] life lift: its Leader condition is asked as the skill resolves and the lift lasts the turn; \"even if you have 5 or more life\" removes the ceiling, \"6 or less\" raises it to 6; the rest of the [Awaken] condition still holds." },
  { id: "R-053", date: "2026-10-27", cards: ["BT12-029"], basis: ["owner"], refs: ["#1231", "#1232"], confidence: "owner", status: "active",
    ruling: "BT12-029 does not answer its own return to the hand: it has left play (no 9-6-9 look-back)." },
  { id: "R-054", date: "2026-10-27", cards: ["BT31-103"], basis: ["owner"], refs: ["#1231"], confidence: "owner", status: "active",
    ruling: "\"Until the next end of the battle\" made outside a battle lasts to the end of the next battle, even in a later turn." },

  // ── Delayed and replacement effects (9-10) ────────────────────────────────────────────────
  { id: "R-055", date: "2026-10-27", cards: ["BT31-055"], basis: ["owner"], refs: ["#1233"], confidence: "owner", status: "active",
    ruling: "BT31-055b's \"would be removed from a Battle Area or Combo Area\" replaces every departure, the rules' end-of-battle move of combo cards (8-5-8) included." },
  { id: "R-056", date: "2026-10-27", cards: ["P-182", "BT18-133", "BT18-122", "BT23-099"], basis: ["owner"], refs: ["#1233"], confidence: "owner", status: "active",
    ruling: "\"Placed in a Drop from a Combo Area … instead\" replaces only a move whose destination is the Drop; a return to the hand is not replaced." },
  { id: "R-057", date: "2026-10-27", cards: ["P-207"], basis: ["owner"], refs: ["RM 8-5-8", "RM 8-5-9", "#1233"], confidence: "owner", status: "active",
    ruling: "P-207 is placed in the Drop at 8-5-8 and moved from the Drop to the Warp at 8-5-9." },
  { id: "R-058", date: "2026-10-27", cards: ["BT6-094", "EX24-37", "BT17-139"], basis: ["manual", "owner"], refs: ["RM 9-10-3", "#1233"], confidence: "owner", status: "active",
    ruling: "A \"you may … instead\" replacement can be used against a battle KO, asked at the Damage Step; with several replacements the guard's master chooses (9-10-2)." },
  { id: "R-059", date: "2026-10-27", cards: ["BT11-093", "BT11-132", "P-330"], basis: ["owner"], refs: ["#1233"], confidence: "owner", status: "active",
    ruling: "\"Your opponent can only attack with Battle Cards once during their next turn\": their Leader may still attack and only Battle Card attacks count; P-330's budget covers only Battle Cards costing 4 or less." },
  { id: "R-060", date: "2026-10-27", cards: ["BT18-133"], basis: ["owner"], refs: ["#1233"], confidence: "owner", status: "active",
    ruling: "\"Placed in your Drop from your Battle Area\" covers a battle KO and a skill KO, not a removal to the hand or the Warp." },
  { id: "R-061", date: "2026-10-27", cards: ["BT21-149"], basis: ["owner"], refs: ["#1233"], confidence: "owner", status: "active",
    ruling: "\"Send it to your Warp instead\" for an opponent's card sends it to its owner's Warp." },
  { id: "R-062", date: "2026-10-27", cards: ["P-413"], basis: ["owner"], refs: ["#1233"], confidence: "owner", status: "active",
    ruling: "\"When this card would be placed in a Drop\" covers every area it leaves (discards, mills, life), not only play." },
  { id: "R-063", date: "2026-10-27", cards: ["EX24-37"], basis: ["owner"], refs: ["#1233"], confidence: "owner", status: "active",
    ruling: "\"If your life is at 1\" means exactly 1." },

  // ── Phrasing batches 7–9 ──────────────────────────────────────────────────────────────────
  { id: "R-064", date: "2026-10-27", cards: ["BT28-001"], basis: ["owner"], refs: ["#1232"], confidence: "owner", status: "active",
    ruling: "BT28-001b's \"whose owner is your opponent\" fires when one player's card KOs the other player's card (control, not ownership; they differ only after a control change)." },
  { id: "R-065", date: "2026-10-27", cards: ["BT15-139"], basis: ["owner"], refs: ["#1232"], confidence: "owner", status: "active",
    ruling: "\"Your black Leader Cards or Battle Cards\": black applies to both kinds." },
  { id: "R-066", date: "2026-10-27", cards: ["BT15-007", "BT15-139", "BT15-001", "BT15-141"], wording: "whichever comes first", basis: ["owner"], refs: ["#1232"], confidence: "owner", status: "active",
    ruling: "\"Until the end of a battle or the end of the turn, whichever comes first\" made outside a battle ends at the next battle's end that turn, or at the turn's end." },
  { id: "R-067", date: "2026-10-27", cards: ["BT9-104"], basis: ["owner"], refs: ["#1232"], confidence: "owner", status: "active",
    ruling: "\"When one of your cards deals damage\" counts skill damage too, but not damage a skill deals to its own master." },
  { id: "R-068", date: "2026-10-27", cards: ["BT20-054"], basis: ["manual", "owner"], refs: ["RM 2-10-1-1", "#1232"], confidence: "owner", status: "active",
    ruling: "\"Without <X>\" excludes that exact character name, not names that merely include it; BT20-054b's leaving play is any cause, the card described as it was when it left." },
  { id: "R-069", date: "2026-10-27", cards: ["BT10-058"], basis: ["manual", "owner"], refs: ["RM 12-2", "#1232"], confidence: "owner", status: "active",
    ruling: "A [Field]'s \"when this card is activated\" is its play." },
  { id: "R-070", date: "2026-10-27", cards: ["BT13-005", "BT26-089", "BT30-017", "BT21-071"], basis: ["owner"], refs: ["#1235"], confidence: "owner", status: "active",
    ruling: "\"When this card deals damage\" answers its own skill's damage to the opponent, never what it makes its own master take; \"by attacking\" / \"in a battle\" wordings are battle damage only." },
  { id: "R-071", date: "2026-10-27", cards: [], wording: "when you (?:take|receive) damage(?:,|\\.|:)", basis: ["manual", "owner"], refs: ["RM 1-13-2", "#1237"], confidence: "owner", status: "active",
    ruling: "A bare \"When you take damage\" answers battle damage and skill damage." },
  { id: "R-072", date: "2026-10-27", cards: ["BT13-039", "BT14-023", "BT14-070", "BT14-104"], wording: "damage from (?:an |your |one of your )?opponent'?s (?:non-keyword )?skill", basis: ["owner"], refs: ["#1237"], confidence: "owner", status: "active",
    ruling: "\"Damage from your opponent's (non-keyword) skill\" excludes your own skill's damage to you; \"non-keyword\" is any opponent skill until a keyword that deals damage exists." },
  { id: "R-073", date: "2026-10-27", cards: ["BT12-153"], wording: "\\bmono-(?:red|blue|green|yellow|black|white) or (?:an? )?(?:red|blue|green|yellow|black|white)\\b", basis: ["owner"], refs: ["#1235", "#1237"], confidence: "owner", status: "active",
    ruling: "A Leader condition \"mono-green or (a) black ≪X≫\" is two alternatives; the trait after belongs only to the second." },
  { id: "R-074", date: "2026-10-27", cards: ["BT15-148", "BT15-019"], basis: ["manual", "owner"], refs: ["RM 6-1-5-1", "#1235"], confidence: "owner", status: "active",
    ruling: "\"A copy of this card\" is a card with the same card number." },
  { id: "R-075", date: "2026-10-27", cards: ["BT9-093", "BT7-079", "BT15-033"], basis: ["owner"], refs: ["#1235"], confidence: "owner", status: "active",
    ruling: "\"Can't activate their Leader Card's [Awaken] or/and [Wish] skills\" forbids both keywords, keyed on the keyword." },
  { id: "R-076", date: "2026-10-27", cards: ["BT24-108", "BT23-128"], basis: ["manual", "owner"], refs: ["RM 8-1-6-1", "#1235"], confidence: "owner", status: "active",
    ruling: "\"At the end of the Damage Step for that battle\": if the attack is negated there is no Damage Step and nothing happens; the price's chosen cards go under this card." },
  { id: "R-077", date: "2026-10-27", cards: ["BT30-017"], basis: ["owner"], refs: ["#1235"], confidence: "owner", status: "active",
    ruling: "\"By attacking with a blue card\" means any of your blue cards attacking, the Leader included." },
  { id: "R-078", date: "2026-10-27", cards: ["TB1-002"], basis: ["owner"], refs: ["#1235"], confidence: "owner", status: "active",
    ruling: "TB1-002 makes only your own discard \"up to\"; the opponent's discard stays." },
  { id: "R-079", date: "2026-10-27", cards: [], basis: ["owner"], refs: ["#1237"], confidence: "owner", status: "active",
    ruling: "When damage moves two life cards, \"when your life moves to another area\" answers once per card." },
  { id: "R-080", date: "2026-10-27", cards: ["EX23-52"], basis: ["owner"], refs: ["#1237"], confidence: "owner", status: "active",
    ruling: "\"If this skill makes this card's power N or more\" is checked after the raise, even if the card was already that high." },
  { id: "R-081", date: "2026-10-27", cards: ["EX09-01", "BT1-015"], basis: ["same-wording", "owner"], refs: ["Q&A BT1-015", "#1237"], confidence: "official", status: "active",
    ruling: "In a [Counter: Attack], \"that card\" is the attack's target at declaration, before any block." },
  { id: "R-082", date: "2026-10-27", cards: ["BT15-001"], basis: ["owner"], refs: ["#1237"], confidence: "owner", status: "active",
    ruling: "BT15-001b asks about the Unison in your Unison Area as the skill resolves ([Spirit Boost] always pays from that Unison)." },
  { id: "R-083", date: "2026-10-27", cards: ["P-346", "P-651", "BT20-006", "P-597"], wording: ",\\s*for (?:each|every)\\b[^,.;:]*,\\s*(?:choose|add|play|place|send|switch|ko)\\b[^.]*\\b(?:it|them)\\b", basis: ["owner"], refs: ["#1237"], confidence: "owner", status: "active",
    ruling: "In \"for every N …, choose up to 1 … and KO it\", the pronoun is the chosen card and the count bounds the choice per N, rounded down." },

  // ── Searching (20-12), energy (3-8), hidden information ───────────────────────────────────
  { id: "R-084", date: "2026-10-27", cards: [], basis: ["manual", "owner"], refs: ["RM 5-2-7", "#1236", "#1237"], confidence: "owner", status: "active",
    ruling: "A described exact pick from a secret area — deck, face-down life, hand — may come up empty (\"found nothing\"), any card description counting; matches in an open area (the Drop) must be taken; a price is never let off." },
  { id: "R-085", date: "2026-10-27", cards: [], basis: ["manual", "owner"], refs: ["RM 3-1-7", "#1236", "#1240"], confidence: "owner", status: "active",
    ruling: "A described card picked from a secret area (deck, life, hand) and moved to the hand, deck or face-down life is shown to the opponent." },
  { id: "R-086", date: "2026-10-27", cards: [], basis: ["manual", "owner"], refs: ["RM 20-12-3", "#1237"], confidence: "owner", status: "active",
    ruling: "A choice out of the whole deck shuffles it as the skill ends even when no shuffle is printed; \"look at the top N\" does not." },
  { id: "R-087", date: "2026-10-27", cards: ["BT10-054"], basis: ["manual", "owner"], refs: ["RM 3-1-4", "#1237"], confidence: "owner", status: "active",
    ruling: "A card that leaves an area and comes back is a new card." },
  { id: "R-088", date: "2026-10-27", cards: ["BT21-145"], basis: ["owner"], refs: ["#1236"], confidence: "owner", status: "active",
    ruling: "\"Add … from your deck\" with no place named adds to the hand." },
  { id: "R-089", date: "2026-10-27", cards: ["BT19-066"], basis: ["owner"], refs: ["#1236"], confidence: "owner", status: "active",
    ruling: "The second slot of a named pair search is \"up to 1\", like every pair." },
  { id: "R-090", date: "2026-10-27", cards: ["BT7-051"], basis: ["owner"], refs: ["#1236"], confidence: "owner", status: "active",
    ruling: "BT7-051 plays only the cards still in the Warp at the next Main Phase." },
  { id: "R-091", date: "2026-10-27", cards: ["P-440"], basis: ["owner"], refs: ["#1236"], confidence: "owner", status: "active",
    ruling: "\"The same name as the chosen card\" includes names a card is also treated as." },

  // ── Skill damage, keywords, cards under cards, negation ───────────────────────────────────
  { id: "R-092", date: "2026-10-27", cards: [], basis: ["owner"], refs: ["#1240"], confidence: "owner", status: "active",
    ruling: "Damage dealt by an Extra Card's skill, or by any card outside the Battle, Unison and Leader Areas, is a skill's damage." },
  { id: "R-093", date: "2026-10-27", cards: ["BT19-007"], basis: ["owner"], refs: ["#1238"], confidence: "owner", status: "active",
    ruling: "\"Negate this card's skill for the game\" (singular) negates all of this card's skills." },
  { id: "R-094", date: "2026-10-27", cards: ["BT13-096", "EX21-15"], basis: ["owner"], refs: ["#1238"], confidence: "owner", status: "active",
    ruling: "\"Negate the skills of all cards sent to Warps by this skill … and play them\": the negation carries into the play, so their \"when played\" does not resolve; they return to their owners' Battle Areas." },
  { id: "R-095", date: "2026-10-27", cards: ["EX09-06"], basis: ["owner"], refs: ["#1238"], confidence: "owner", status: "active",
    ruling: "EX09-06 may be activated and paid against a [Counter: Play]; it negates only a [Counter: Attack]." },
  { id: "R-096", date: "2026-10-27", cards: ["BT20-057", "BT20-058", "BT20-059"], basis: ["manual", "owner"], refs: ["RM 21-5-2", "RM 22-46-6-1", "#1238"], confidence: "owner", status: "active",
    ruling: "\"Place this card from under your Leader on top of your Leader\" places, not plays: mode and power effects carry over, \"when your Leader is placed\" answers, and it is not a [Z-Awaken] (no once-per-turn)." },
  { id: "R-097", date: "2026-10-27", cards: ["EX25-08", "EX25-09"], basis: ["owner"], refs: ["#1238"], confidence: "owner", status: "active",
    ruling: "\"A card with a [Sparking 7] skill\" means exactly [Sparking 7]." },
  { id: "R-098", date: "2026-10-27", cards: ["P-717"], basis: ["owner"], refs: ["#1238"], confidence: "owner", status: "active",
    ruling: "In P-717 the second \"that card\" is the Egg the first choice named." },
  { id: "R-099", date: "2026-10-27", cards: ["BT21-006"], basis: ["owner"], refs: ["#1238"], confidence: "owner", status: "active",
    ruling: "\"If a <Garlic Jr.> is under this card\" counts a card owned by either player." },
  { id: "R-100", date: "2026-10-27", cards: ["EX21-31"], basis: ["owner"], refs: ["#1239"], confidence: "owner", status: "active",
    ruling: "\"Play … from your Drop, ignoring its [Permanent] skill\": the played card's own [Permanent] is ignored for that play only; other cards' rules still apply." },

  // ── Pending: implemented best guesses awaiting the owner (mechanism batch 4, phrasing 10) ──
  { id: "R-101", date: "2026-10-28", cards: ["EX21-19"], basis: ["manual"], refs: ["RM 9-1-3-3", "#1239"], confidence: "best-guess", status: "pending",
    ruling: "\"Your <Son Goku> and <Vegeta> cards are also treated as red, blue, and green in all areas\": the [Permanent] is valid in all areas, not only while EX21-19 is in play." },
  { id: "R-102", date: "2026-10-28", cards: ["P-106", "P-110", "P-111", "BT17-148"], basis: ["official-qa"], refs: ["Q&A P-106", "#1239"], confidence: "official", status: "active",
    ruling: "\"Cards in Rest Mode\" in a count is the Leader, Battle and Energy Areas (R-002), for \"each card your opponent has in Rest Mode\" too." },
  { id: "R-103", date: "2026-10-28", cards: ["BT18-059"], basis: ["intent"], refs: ["#1239"], confidence: "best-guess", status: "pending",
    ruling: "\"For each ≪Turtle School≫ card with a different character name …, +5000 power and [Double Strike]\": only the power is counted; [Double Strike] is granted once, even with no such card." },
  { id: "R-104", date: "2026-10-28", cards: ["BT1-106"], basis: ["official-qa"], refs: ["Q&A BT1-106", "#1239"], confidence: "official", status: "active",
    ruling: "BT1-106's \"Afterwards, the opponent's Battle Cards are unable to attack\" is outside the Leader condition and names the Battle Cards in play as it resolves." },
  { id: "R-105", date: "2026-10-28", cards: ["P-671"], basis: ["manual"], refs: ["RM 8-1-4", "RM 8-1-5", "#1239"], confidence: "best-guess", status: "pending",
    ruling: "An attack [Auto]'s \"your opponent can't activate [Counter] skills\" does not close the [Counter: Attack] window of 8-1-4, which comes before it resolves; it covers later [Counter] timings in that battle." },
  { id: "R-106", date: "2026-10-28", cards: ["P-268"], basis: ["intent"], refs: ["#1239"], confidence: "best-guess", status: "pending",
    ruling: "\"At least 1 <Lavender> and 1 <Basil> card\" counts each name on its own; one card carrying both names counts for both." },
  { id: "R-107", date: "2026-10-28", cards: ["EX21-34"], basis: ["intent"], refs: ["#1239"], confidence: "best-guess", status: "pending",
    ruling: "\"Ignore this card's specified cost in all areas\" is the same as having no specified cost." },
  { id: "R-108", date: "2026-10-28", cards: ["EX21-31"], basis: ["intent"], refs: ["#1239"], confidence: "best-guess", status: "pending",
    ruling: "R-100's \"ignoring its [Permanent]\" also covers a \"can only be played if …\" condition printed on the played card (it compiles to the same self-prohibition)." },
  { id: "R-109", date: "2026-10-28", cards: ["BT7-039", "BT6-125"], wording: "you may choose all\\b", basis: ["intent"], refs: ["#1240"], confidence: "best-guess", status: "pending",
    ruling: "\"You may choose all … and place them\" is an offer of all of them, taken whole or declined; if it is taken but nothing could be placed, \"if you do\" fails." },
  { id: "R-110", date: "2026-10-28", cards: ["BT17-051", "BT24-099", "P-019", "P-724"], wording: "\\bany number of\\b", basis: ["intent"], refs: ["#1240"], confidence: "best-guess", status: "pending",
    ruling: "\"Any number of\" is a choice of how many, none included, asked before any move." },
  { id: "R-111", date: "2026-10-28", cards: ["BT31-067", "P-625"], basis: ["intent"], refs: ["#1240"], confidence: "best-guess", status: "pending",
    ruling: "\"Up to the number of cards placed … this way\" is bounded by the cards that actually reached their destination, not those chosen." },
  { id: "R-112", date: "2026-10-28", cards: ["DB3-017", "DB3-018", "DB3-019", "DB3-020", "BT10-001"], basis: ["intent"], refs: ["#1240"], confidence: "best-guess", status: "pending",
    ruling: "\"Damage from a skill on one of your Battle Cards or Unison Cards\" does not count a Leader's skill damage." },
  { id: "R-113", date: "2026-10-28", cards: ["BT14-029", "BT14-030", "BT14-090", "BT17-081"], basis: ["intent"], refs: ["#1240"], confidence: "best-guess", status: "pending",
    ruling: "[Spirit Boost X] may be paid with X = 0; \"if you removed a marker using this skill\" then fails." },
  { id: "R-114", date: "2026-10-28", cards: [], basis: ["manual"], refs: ["RM 3-1-7", "#1240"], confidence: "best-guess", status: "pending",
    ruling: "A described card from the hand placed face up in the life is not revealed separately (it is face up anyway)." },
  { id: "R-115", date: "2026-10-28", cards: ["BT30-101", "BT30-104"], basis: ["intent"], refs: ["#1240"], confidence: "best-guess", status: "pending",
    ruling: "\"Add up to 1 card to your hand, send up to 1 card to your Warp\" picks from the cards just chosen, each pick \"up to 1\": a single chosen card may go to the Warp instead of the hand." },
];
