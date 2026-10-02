/**
 * Printed trigger wording → the moment it names (9-6-2, 22).
 *
 * The compiler's own regexes for "When …" clauses, read at game time only for
 * a skill that has no record yet — the rules engine falls back to this exactly
 * where the record's WHEN is absent (`vm/triggers.ts`'s `answersTo`), and the
 * mechanism report (`gaps.ts`) groups by it. Moved out of the legacy
 * `engine/triggers.ts` (#118); nothing here reads a game.
 */
import { effectHead, maskNames, trailingTrigger } from "./cards";
import { parseFilter } from "./filters";
import type { Skill, Trigger } from "../types";

/** Keyword [Auto] skills and the events that make them pending (22). */
export function keywordTriggers(sk: Skill, trigger: Trigger): boolean {
  const k = sk.keyword;
  if (!k) return false;
  switch (k.name) {
    case "Attack":
      return trigger === "attacks";
    case "Alliance":
      return trigger === "attacks";
    case "Revenge":
      return trigger === "attacked";
    case "Offering":
      return trigger === "played";
    case "Revive":
      return trigger === "koed";
    case "Z-Stack":
      return trigger === "played" || trigger === "leaderPlaced";
    default:
      return false;
  }
}

/**
 * Both players' turns, named as one moment: "at the end of **you and your
 * opponent's turns**" (BT21-100, EX24-20, P-700), "at the end of **your or
 * your opponent's turn**" (EX07-01), "at the end of **each player's turn**".
 * And the Main Phase said the same way: "at the start of **you and your
 * opponent's Main Phases**" (BT21-109, BT21-110, BT21-114, BT31-115b,
 * EX24-29), "at the start of **your or your opponent's Main Phase**" (P-688).
 *
 * Neither wording matched the one-sided phrase either case was anchored on, so
 * twelve [Auto] skills answered to no trigger at all and never fired once —
 * a card that stands itself up every Main Phase simply stayed rested. And
 * nothing said so: the timing clause is consumed wherever it appears, whether
 * or not a trigger was found for it, so these carried no unread clause and no
 * gap to count.
 *
 * The phrase is one moment in the text and two in the engine, which is exactly
 * what this predicate is shaped for — a skill answers to both, and only one of
 * them can happen at a time (7-1), so it fires once per turn either way. The
 * same precedent as "when you play or combo with this card" below.
 */
const EVERY_TURN_END = /^at the end of (?:(?:you|your) (?:and|or) your opponent'?s turns?|each player'?s turn)\b/;
const EVERY_MAIN_START = /^at the (?:beginning|start) of (?:(?:you|your) (?:and|or) your opponent'?s main phases?|each player'?s main phase)\b/;

/** "When this card [in a Battle Area] is [played or] switched to X Mode [or Y Mode]", with no cause after it: the modes named, or "" for none. */
function switchedTo(t: string): string {
  const m = /when this card(?: in (?:a|your) battle area)? is (?:played or )?switched to ((?:revealed|hidden) mode(?: or (?:revealed|hidden) mode)?)(?! by)/.exec(t);
  return m ? m[1] : "";
}

/**
 * Read the "When …" clause of an [Auto] skill. Unrecognised wording never
 * pends — a skill the engine cannot place in time is better left out than
 * fired at the wrong moment.
 */
export function autoTriggerMatches(sk: Skill, trigger: Trigger): boolean {
  // A {name} is one word here — its comma and its "by" are the name's (P-526).
  const t = maskNames(sk.cost + " " + sk.effect).text.toLowerCase();
  /**
   * The timing triggers name a moment, and a card may equally well *mention*
   * that moment in the middle of an effect — "…, and at the end of the turn,
   * flip all face-up cards in your life face down", which is a delayed effect
   * and no trigger at all. 116 skills do exactly that, and every one of them
   * was pending its whole skill again at every turn end. A trigger is the head
   * of the sentence, so these are matched against the head and nothing else.
   *
   * The one exception is a skill with no trigger at all, where the phrase can
   * only be the trigger — see `trailingTrigger`. Reading it back onto the
   * front is all that takes, since every timing trigger below is anchored
   * there, and the phrase carries no wording the others look for.
   */
  const effect = maskNames(sk.effect);
  const printed = effectHead(effect.text);
  const trailing = trailingTrigger(sk);
  const head = trailing ? `${trailing}, ${printed}` : printed;
  switch (trigger) {
    case "played":
      // 12-2: activating an Extra *is* playing it, and the sets print both.
      // "When you play or combo with this card" and "when this card in your
      // hand is played or used in a combo" are this trigger and `comboed`
      // both — each fires at its own moment, and only one of them happens.
      return /when (?:you play this card|this card is played)|when you activate this card|when you play or combo with this card|when this card(?: in your hand)? is played(?: or used in a combo)?/.test(
        t,
      );
    case "attacks":
      // "When this card attacks and KOs an opponent's Battle Card" is the KO, not the attack.
      // "When you attack or combo with this card" is this trigger and `comboed`
      // both, like "play or combo" above: each fires at its own moment and only
      // one of them happens.
      return /when this card attacks(?! and kos?\b)|when you attack or combo with this card/.test(t);
    case "attacked":
      return /when this card is attacked/.test(t);
    // 8-1: a Battle Card watching the *Leader* be attacked. The Leader's own
    // copy of that sentence is `attacked` above — it is a card in play like
    // any other — so this is only for the ones printed elsewhere.
    case "yourLeaderAttacked":
      return /when your [^,]{0,60}leader(?: card)? is attacked/.test(head);
    // 21-3: damage from a skill, which is the only damage the `damage` op
    // deals — battle damage takes a different path — so "from a non-keyword
    // skill" is satisfied by the moment itself.
    case "youTookDamage":
      return /when you (?:take|receive) damage/.test(head);
    case "opponentTookDamage":
      return /when your opponent (?:takes|receives) damage/.test(head);
    // 3-9: a life card leaving the Life Area, however it leaves.
    case "lifeLeft":
      return /when your life (?:moves|is moved|is placed|leaves|is added)/.test(head);
    case "koed":
      // "…removed from a Battle Area by a skill **or KO'd**" is the KO half of
      // a wording whose other half is `removedFromBattle`.
      return /when this card is ko'?d|when this card is removed from [a-z' ]*battle area by [a-z' ]*skills? or ko'?d/.test(t);
    // 3-1: a move an effect caused, which is not a KO — the cards write "or
    // KO'd" when they mean both.
    case "removedFromBattle":
      return /when this card is removed from [a-z' ]*battle area by (?:a|your|one of your) skill/.test(t);
    // 3-1: the narrower wording — a skill put it out of the Battle Area *and*
    // it ended in the Drop. `removedFromBattle` covers a skill that sends it
    // anywhere, so this cannot simply widen that one: a card bounced to the
    // hand is that moment and not this.
    case "droppedFromBattle":
      return /when this card is placed in (?:a|your|its owner'?s) drop area from (?:a|your|the) battle area by (?:a|your|one of your) skill/.test(t);
    // The same sentence with no cause named at all, which is every cause: a
    // skill putting it there and a battle KO alike. Kept apart from the one
    // above because that one *does* name a cause, and a KO is not it.
    case "leftBattleToDrop":
      return /when this card is placed in (?:a|your|its owner'?s|the) drop area from (?:a|your|the) battle area(?!\s+by)/.test(head);
    // 21-14: a card of *yours* being KO'd, watched by the rest of your board —
    // "when your blue <Son Goku> card is KO'd, you may play this card from your
    // hand" — and the same from the other side of the table. `koed` is the
    // KO'd card's own skill and is not this.
    //
    // Only the plain wording. "…KO'd **by an opponent's skill**" and "…KO'd
    // **or removed from a Battle Area**" name a cause the engine cannot tell
    // apart from a battle KO, so the comma or the end of the clause is what
    // says the sentence stopped there.
    case "yourCardKoed":
      return /^when (?:your|one of your) (?!opponent)[^,]{0,70} (?:is|are) ko'd(?:,|$)/.test(head);
    case "opponentCardKoed":
      return /^when (?:your opponent's|an opponent's|one of your opponent's) [^,]{0,70} (?:is|are) ko'd(?:,|$)/.test(head);
    case "removedByOpponent":
      return /when this card is removed from [a-z' ]*battle area by (?:an? |one of )?(?:your )?opponent'?s? skill/.test(t);
    case "evolvedInto":
      return /when a card evolves into this card|when this card evolves\b/.test(t);
    case "evolveFromHandActivated":
      return /when using this card'?s \[evolve\] from your hand|when you (?:use|activate) this card'?s \[evolve\](?: skill)? from your hand/.test(t);
    case "opponentCounter":
      return /when your opponent activates a \[counter/.test(t);
    case "counterFreeFromHand":
      return /when you activate this card'?s \[counter[^\]]*\](?: skill)? from your hand without paying (?:its|the) energy cost/.test(t);
    case "kos":
      // The same moment said the other way round — "when an opponent's Battle
      // Card is KO'd **by this card's attack**" — which is still this card
      // doing the KO'ing and so still this trigger.
      return /when this card (?:attacks and )?kos? (?:an opponent's|your opponent's|one of your opponent's|a) (?:battle card|card)|when (?:an|your) opponent'?s? (?:battle )?card is ko'?d by this card'?s attack/.test(
        t,
      );
    case "leaderPlaced":
      return /when this card is placed in (?:your|a) leader area|when you place this card in (?:your|a) leader area/.test(t);
    // 7-1: whose turn it is decides whether these happen at all, and "your" is
    // the card's controller, never the turn player. One trigger covered both
    // wordings and was pended for both players, so 164 cards that act "at the
    // end of your turn" also acted at the end of the opponent's, and 13 that
    // wait for the opponent's turn fired a turn early as well.
    case "turnEnd":
      return /^at the end of (?:your|the|this) turn\b/.test(head) || EVERY_TURN_END.test(head);
    case "opponentTurnEnd":
      return /^at the end of your opponent'?s turn\b/.test(head) || EVERY_TURN_END.test(head);
    case "opponentTurnStart":
      return /^at the (?:beginning|start) of your opponent'?s turn\b/.test(head);
    case "mainStart":
      return /^at the (?:beginning|start) of (?:your|the) main phase\b/.test(head) || EVERY_MAIN_START.test(head);
    case "opponentMainStart":
      return /^at the (?:beginning|start) of your opponent'?s main phase\b/.test(head) || EVERY_MAIN_START.test(head);
    case "blockerUsed":
      return /when this card activates (?:its )?\[blocker\]/.test(t);
    // Both wordings are the same moment: "when **this card** in your life is
    // flipped face up" is the card that was flipped, "when **a** card…" is
    // watched by that player's cards in play. The colour qualifier some of
    // them add is checked in `script.ts`, where the flipping card is known.
    case "flippedFaceUp":
      return /when (?:a|this) card in your life is flipped face up/.test(t);
    // 22: a keyword skill being used, which the cards name by its own bracket.
    case "unionActivated":
      return /when you activate a \[union[^\]]*\](?: skill)?/.test(t);
    case "unionAbsorbActivated":
      return /when this card'?s \[union-absorb\] is activated/.test(t);
    case "overlordActivated":
      return /when you activate an \[overlord\](?: skill)?/.test(t);
    case "overRealmPlayed":
      return /when you play a battle card using \[over realm\]/.test(t);
    // 12-1-3: "activating an Extra Card" is using its [Activate] or [Counter]
    // skill from the hand, unless the card says otherwise — so "from your
    // hand" (BT29-029) and the bare wording are the same moment. The Extra is
    // the subject, and the description becomes a condition on it, so — like
    // `youPlayed` — one the compiler cannot read whole must not fire at all:
    // "…with an original energy cost of 2 **and the [Field] skill**", "…from
    // your hand **by paying the cost**", "the [Activate: Battle] skill on a red
    // Extra … in your hand **or Drop Area**" are left as gaps.
    case "extraActivated": {
      const m = /^when you activate (?:an?|1) ([^,:]{0,90}?\bextra(?: cards?)?\b[^,:]{0,90}?)(?:,|$)/.exec(head);
      if (!m) return false;
      const said = m[1].replace(/\s+from your hand$/, "");
      // "An energy cost of 1 **or** more" is one bound, not two kinds.
      const kinds = said.replace(/\b\d+ or (?:less|fewer|more|greater|higher|lower)\b/g, "");
      // "Original" (20-3-1) is a measure the filter reads as the current cost.
      if (/ or |\[|\bby\b|\busing\b|\bwithout\b|\bfrom\b|\bin your\b|\boriginal\b/.test(kinds)) return false;
      return !parseFilter(effect.unmask(said)).unreadable;
    }
    // 1-10: the narrower [Alliance] wording just below is read first, so a card
    // that names the keyword is not also caught by this.
    case "restedBySkill":
      return /when this card is switched to rest mode by (?:one of )?your skills?\b/.test(t);
    // The other end of the same act: your skill resting one of *theirs*,
    // watched by your cards in play. The only printed wording names their
    // Battle Cards and energy, and that is exactly where it is pended.
    case "restedTheirsBySkill":
      return /when (?:one of )?your (?:card )?skills? switch(?:es)? (?:an|your) opponent'?s/.test(head) && /rest mode/.test(head);
    case "restedByAlliance":
      return /when this card is switched to rest mode by (?:an?|one of your) \[alliance\]/.test(t);
    // 1-10-2, 23-5-2-4: the same sentence about Hidden Mode (BT28-116,
    // BT28-119), "in a Battle Area" or not.
    case "hiddenBySkill":
      return /when this card(?: in (?:a|your) battle area)? is switched to hidden mode by (?:one of )?your skills?\b/.test(t);
    // 9-6-9-3: a face-down card's own leave-play [Auto] answers only when it
    // says so — "when this Hidden Mode card in a Battle Area is placed into
    // its owner's Drop" (BT28-117, BT28-118).
    // The same switch with no cause named — any skill, either player's — and
    // "…to Revealed Mode or Hidden Mode", which is both (BT29-116, -121, -122,
    // -125, -142). "By one of your skills" is `hiddenBySkill`'s, not these.
    case "switchedRevealed":
      return /revealed/.test(switchedTo(t));
    case "switchedHidden":
      return /hidden/.test(switchedTo(t));
    // 23-2: a card going into a pile under another (BT29-140).
    case "placedUnder":
      return /when this card is placed under\b/.test(t);
    // Out of the deck or the hand into the Drop (BT29-109) — "in your deck or
    // hand", either order, or just one of them.
    case "deckOrHandToDrop":
      return /when this card in your (?:deck|hand)(?: or (?:deck|hand))? is (?:placed|put|sent) (?:in|into) (?:its owner'?s|your) drop/.test(t);
    case "hiddenToDrop":
      return /when this hidden mode card(?: in (?:a|your) battle area)? is placed (?:in|into) (?:its owner'?s|your|a) drop/.test(t);
    case "addedToZEnergy":
      return /when this card is added to (?:your )?z-energy|when you add this card to your z-energy/.test(t);
    case "chargeStart":
      return /^at the (?:beginning|start) of (?:your|the|this) (?:turn|charge phase)\b/.test(head);
    case "dealtDamage":
      return /when this card deals damage|when you deal damage/.test(t);
    case "battleEnd":
      return /^at the end of (?:the|a|this) battle\b/.test(head);
    case "comboed":
      return /when you use this card in a combo|when this card(?: in your hand)? is used in a combo|when you combo with this card|when you (?:play|attack) or combo with this card|when this card in your hand is played or used in a combo/.test(
        t,
      );
    // The card the opponent played is the subject, whichever way round the
    // sentence names it. "Plays this card" is never how a card says it.
    case "opponentPlayed":
      return /when your opponent plays (?:a|an|1|up to)\b|when your opponent's [a-z ]*card is played|when a card is played by your opponent/.test(t);
    // Your own side of `opponentPlayed`: a card of yours watching another of
    // your cards arrive. Not "this card" — that is `played`, the card's own
    // arrival — and not the opponent's.
    //
    // A trigger that names *how* the card was played ("by a [Union] skill",
    // "using [Swap]", "from your life") is left out: the engine cannot check
    // that, and firing on an ordinary play would be worse than not firing.
    case "youPlayed": {
      if (/when (?:you play this card|this card is played)/.test(t)) return false;
      if (/\bis played (?:by|using|from)\b|\bwhen you play [^,]*\b(?:using|from your)\b/.test(t)) return false;
      const spoken = /when you play ((?:an?|1|up to \d+|\d+) [^,]{0,80}?)(?:,|$)/.exec(t);
      const passive = /when (a|an|your) ([^,]{0,80}?) is played\b/.exec(t);
      if (!spoken && !passive) return false;
      const said = spoken ? spoken[1] : `${passive![1]} ${passive![2]}`;
      if (/^your opponent/.test(said)) return false;
      // This fires for *every* card that player plays, and the effect then acts
      // on it — so a description the compiler cannot turn into a filter must
      // not fire at all. "A blue **or** yellow ≪Universe 6≫ card" is the shape
      // that matters: `parseFilter` keeps one colour of the two, so the whole
      // trigger stays an honest gap rather than buffing whatever was played.
      return !/ or /.test(said);
    }
    case "opponentAttacks":
      return /when your opponent attacks\b|when your opponent's [a-z ]*cards? attacks?\b|when one of your opponent's [a-z ]*cards? attacks\b/.test(t);
    case "opponentCombos":
      return /when your opponent combos\b|when your opponent uses a card in a combo\b/.test(t);
    // Your own side of it. "When you combo with this card" is the card's own
    // skill and belongs to `comboed`, so the possessive has to be excluded
    // here or every combo card would fire twice.
    case "youCombo":
      return /when you (?:use a card in a combo|combo)\b/.test(t) && !/when you combo with this card/.test(t);
    // 5-5: placed, not played. A card that says both is caught by `played`
    // first, so this only ever adds the ones that say only this.
    case "placed":
      return /when this card is placed in (?:a|your|their|an opponent's) battle area/.test(t);
    case "energyToDrop":
      return /when a card in your energy is placed in (?:your|its owner's) drop/.test(t);
    case "unisonToDrop":
      return /when this card is placed in (?:a|your|its owner'?s) drop area from (?:a|your) unison area|when this card in a unison area is placed into its owner's drop/.test(t);
    case "markerRemoved":
      return /when a marker is removed/.test(t);
    // 22-43-3: paying [Spirit Boost X] takes markers off your Unison. These
    // cards watch for that *cost* rather than for a marker leaving, so an
    // opponent's attack knocking markers off (13-5-2) is not their moment —
    // which is why it is a trigger of its own and not the one above. Both ends
    // of it are printed: the Unison itself ("from this card") and the Battle
    // Cards watching it ("from one of your Unison Cards").
    case "spiritBoostPaid":
      return /when you remove a marker from (?:this card|(?:one of )?your (?:[a-z-]+ )?unison cards?)/.test(t) && /\[spirit boost\]/.test(t);
    case "offenseStart":
      return /^at the (?:beginning|start) of (?:your|the) offense step\b/.test(head);
    case "defenseStart":
      return /^at the (?:beginning|start) of (?:your|the) defense step\b/.test(head);
    case "damageStart":
      return /^at the (?:beginning|start) of (?:your|the) damage step\b/.test(head);
    default:
      return false;
  }
}
