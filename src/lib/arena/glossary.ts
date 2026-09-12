/**
 * What the arena engine knows about card wording, written down.
 *
 * The engine reads printed card text: `engine/cards.ts` turns a line into a
 * skill with a type and a keyword, `engine/filters.ts` reads the target
 * grammar, `engine/compile/` turns the rest into a program, and the referee
 * takes whatever is left. Every one of those steps is a decision about
 * meaning, and until now the only way to see one was to read the code.
 *
 * This is that decision list: every keyword skill the parser recognises, the
 * keywords that are not skills, the skill types, and the rules the compiler
 * reads a line by. Two things are kept apart deliberately, because they are
 * not the same claim:
 *
 *   `meaning`  what the Rule Manual says the keyword does.
 *   `engine`   what this engine actually does with it — including the places
 *              it approximates, which are the ones worth knowing.
 *
 * `KEYWORDS` is keyed by `KeywordSkill["name"]`, so a keyword added to the
 * parser without a description here fails `npm run typecheck`. `npm test`
 * checks the other direction: every `tag` written here is a spelling
 * `keywordOf` actually reads back as that keyword, so a description cannot
 * drift onto a spelling no card parses as.
 *
 * Pure: no database, no React.
 */
import { keywordOf } from "./engine/cards";
import type { KeywordSkill, SkillKind } from "./engine/types";

/** How much of the keyword the engine carries out on its own. */
export type Support =
  /** The engine plays it: offered, paid for and resolved by its own rules. */
  | "engine"
  /** Most of it, with a stated difference or gap. */
  | "partial"
  /** A deck-building rule; nothing happens during a game. */
  | "deck";

export type KeywordGroup = "leader" | "play" | "battle" | "target" | "cost" | "deck";

export const GROUP_LABEL: Record<KeywordGroup, string> = {
  leader: "Leaders and the Z-Deck",
  play: "Playing a card",
  battle: "Battle",
  target: "Being chosen and being KO'd",
  cost: "Energy and costs",
  deck: "Deck building",
};

export const GROUP_ORDER: KeywordGroup[] = ["leader", "play", "battle", "target", "cost", "deck"];

export const SUPPORT_LABEL: Record<Support, string> = {
  engine: "the engine plays it",
  partial: "partly",
  deck: "deck rule only",
};

export interface KeywordDoc {
  /** The tag as a card prints it — the spelling `keywordOf` reads. */
  tag: string;
  /** Other spellings of the same keyword, all of which parse to it. */
  also?: string[];
  /** Rule Manual section. */
  section: string;
  /** The skill type the keyword carries (22-1-1), or a note when it is not a skill (22-1-2). */
  type: string;
  group: KeywordGroup;
  /** What the rule says. */
  meaning: string;
  /** What this engine does with it. */
  engine: string;
  support: Support;
}

export const KEYWORDS: Record<KeywordSkill["name"], KeywordDoc> = {
  // ── Leaders and the Z-Deck ───────────────────────────────────────────────
  Awaken: {
    tag: "[Awaken]",
    also: ["[Awaken: Surge]"],
    section: "22-2",
    type: "[Activate: Main/Battle]",
    group: "leader",
    meaning:
      "A Leader's own skill. Meet the printed condition, pay the cost, carry out the effect, then flip the Leader onto its awakened side. [Awaken: Surge] is the same skill under another name, and card text saying “[Awaken] skills” means both.",
    engine:
      "Offered on a face-up Leader in the Main Phase and during a battle, but only while the engine can read the printed condition (“If your life is at 4 or less” and its neighbours). The flip is queued before the effect runs, so it still happens when the effect stops to ask you something.",
    support: "engine",
  },
  Wish: {
    tag: "[Wish]",
    section: "22-25",
    type: "[Activate: Main/Battle]",
    group: "leader",
    meaning: "The same shape as [Awaken]: a condition, an effect, and then the Leader is flipped over.",
    engine: "Treated as [Awaken] throughout — the same offer, the same queued flip.",
    support: "engine",
  },
  "Z-Awaken": {
    tag: "[Z-Awaken]",
    section: "22-46",
    type: "[Activate: Main/Battle]",
    group: "leader",
    meaning:
      "From the Z-Deck, once a turn: pay the Z-Energy cost and the skill cost and place this Z-Leader on top of your already-awakened Leader, which has to match the printed description. The stack is one card from then on.",
    engine:
      "Offered when the Leader matches the description (read by card description or by character), the Z-Energy is there and the turn's one Z-Awaken is unspent. Only in the Main Phase, though 22-46-1 also allows it during a battle.",
    support: "partial",
  },
  "Z-Stack": {
    tag: "[Z-Stack X]",
    section: "22-47",
    type: "[Auto]",
    group: "leader",
    meaning:
      "When this Z-Card is placed on your Leader or into a Battle or Unison Area, put up to X cards matching the printed description from your Z-Deck underneath it. They become part of the card on top.",
    engine: "Fires on both placements; the description picks the candidates and you choose up to X of them, or none at all.",
    support: "engine",
  },

  // ── Playing a card ───────────────────────────────────────────────────────
  Field: {
    tag: "[Field]",
    section: "22-3",
    type: "[Activate: Main]",
    group: "play",
    meaning: "An Extra Card that stays on the table in Active Mode instead of going to the Drop Area. Its other skills work from there, and playing another [Field] Extra drops the one already out.",
    engine: "Offered from hand for the card's own energy cost; the engine drops your other [Field] Extras first and then places this one face-up in the Battle Area.",
    support: "engine",
  },
  Evolve: {
    tag: "[Evolve]",
    also: ["[EX-Evolve]", "[Xeno-Evolve]"],
    section: "22-5",
    type: "[Activate: Main]",
    group: "play",
    meaning:
      "From hand: pay the cost, choose one of your Battle Cards matching the printed description, and play this card on top of it. [Xeno-Evolve] sends the chosen card to the Warp instead of stacking onto it.",
    engine:
      "The description is read with the target grammar, so only cards that qualify are offered — and the skill is not offered at all when none do. The stack keeps the position and the power effects of the card underneath. Cards that say “when using this card's [Evolve] from your hand” fire at this activation.",
    support: "engine",
  },
  Union: {
    tag: "[Union-Fusion]",
    also: ["[Union-Potara]", "[Union-Absorb]"],
    section: "22-13",
    type: "[Activate: Main]",
    group: "play",
    meaning:
      "Three ways to play a Battle Card by naming characters. Fusion drops one of each named character from your hand, both of equal power. Potara plays this card on top of two named characters in your Battle Area. Absorb is activated from the Battle Area, and its text says which card is played onto this one.",
    engine:
      "All three, with Absorb resolving its printed text like an ordinary skill rather than by names. Cards watching “when you activate a [Union] skill” fire at the activation, not at the choice that follows it, and “when this card's [Union-Absorb] is activated” fires at Absorb's own activation.",
    support: "engine",
  },
  "Over Realm": {
    tag: "[Over Realm X]",
    also: ["[Dark Over Realm X]"],
    section: "22-15, 22-23",
    type: "[Activate: Main]",
    group: "play",
    meaning:
      "With X or more cards in your Drop Area — X or more black cards, for the dark one — send your whole Drop Area to the Warp as the cost and play this card from hand. The two share one activation a turn. A card played with [Over Realm] goes to the Warp at the end of that turn.",
    engine:
      "The count, the whole-Drop cost and the shared limit, which [Wormhole] raises to two. Cards that watch “played with [Over Realm]” fire here rather than on the ordinary play. The end-of-turn return to the Warp is scheduled for the dark variant too, which 22-23 does not ask for.",
    support: "partial",
  },
  Swap: {
    tag: "[Swap X]",
    section: "22-22",
    type: "[Activate: Main]",
    group: "play",
    meaning: "Return this Battle Card to your hand and play a named Battle Card with an energy cost of X from your hand in its place.",
    engine:
      "Offered from the Battle Area, and the swap happens. 22-22-3 is honoured: with no cost-X Battle Card in hand it is refused before it is offered, rather than taking its orbs and then finding nothing to choose. The choice is still filtered by energy cost only — a [Swap] that names a character offers every cost-X Battle Card in hand, not just that character's.",
    support: "partial",
  },
  Arrival: {
    tag: "[Arrival XY]",
    section: "22-29",
    type: "[Activate: Battle]",
    group: "play",
    meaning: "During a battle, when the original colours of the Battle Cards in your Combo Area cover every colour named, pay the cost and play this card from hand.",
    engine: "The colours are read off the Combo Area as it stands; playing the card then runs through the ordinary play, counter window and all.",
    support: "engine",
  },
  Successor: {
    tag: "[Successor]",
    section: "22-38",
    type: "[Activate: Main]",
    group: "play",
    meaning: "Drop any number of mono-green, mono-yellow or Green/Yellow Battle Cards from your Battle Area whose energy costs add up to exactly this card's printed cost, and play it from hand.",
    engine: "Only offered when some set of your Battle Cards really does add up; the cards are then chosen one at a time until the sum is met.",
    support: "engine",
  },
  Revive: {
    tag: "[Revive XY]",
    section: "22-34",
    type: "[Auto]",
    group: "play",
    meaning: "When this Battle Card is KO'd, drop cards from hand whose original colours cover both named colours to play it back from your Drop Area. [Revive] is then negated on it for the turn.",
    engine: "Offered on the KO, once a turn per card, and only when the hand can actually cover the colours.",
    support: "engine",
  },
  Offering: {
    tag: "[Offering]",
    section: "22-33",
    type: "[Auto]",
    group: "play",
    meaning: "When this Battle Card is played, your opponent may put one of their life cards in their Drop Area. If they don't, you draw 2 cards.",
    engine: "Put to the opponent as a prompt of their own. With no life left there is nothing to ask, so you simply draw.",
    support: "engine",
  },
  Heroic: {
    tag: "[Heroic]",
    section: "22-35",
    type: "[Auto]",
    group: "play",
    meaning: "When you play another card with [Heroic], draw 1 card; the skill is then negated on this card for the rest of the turn.",
    engine: "Pends only on another card carrying the same keyword — [Heroic] and [Villainous] do not set each other off — and negates itself once it has resolved.",
    support: "engine",
  },
  Villainous: {
    tag: "[Villainous]",
    section: "22-36",
    type: "[Auto]",
    group: "play",
    meaning: "When you play another card with [Villainous], your opponent chooses a card in their hand and drops it; the skill is then negated for the rest of the turn.",
    engine: "As [Heroic], and the discard is the ordinary one, so the card that goes is the opponent's choice rather than the end of their hand.",
    support: "engine",
  },
  Unique: {
    tag: "[Unique]",
    section: "22-39",
    type: "[Permanent]",
    group: "play",
    meaning: "While a card with [Unique] is in play you can't play another card with the same name. If two are somehow in play at once, their master keeps one and drops the rest.",
    engine:
      "The play is blocked, with the card already out named as the reason. When two do end up in play the engine keeps the newest instead of asking which to keep — 21-11 gives that choice to the master.",
    support: "partial",
  },
  Overlord: {
    tag: "[Overlord]",
    section: "22-41",
    type: "[Activate: Main]",
    group: "play",
    meaning: "Put one of your Battle Cards with [Servant] at the bottom of your deck as the cost, and draw 1 card.",
    engine: "Offered while you have a [Servant] out, and cards watching “when you activate an [Overlord] skill” fire. With several [Servant] cards the engine picks one rather than asking.",
    support: "partial",
  },
  Rejuvenate: {
    tag: "[Rejuvenate]",
    section: "22-42",
    type: "[Activate: Main]",
    group: "play",
    meaning: "A Unison Card with cards beneath it: drop one of them and pay the skill cost, then add the top card of your deck to your life.",
    engine: "Offered on a Unison in play with the markers to pay and any printed life condition met. The card that goes is the top one beneath rather than your pick.",
    support: "partial",
  },
  Empower: {
    tag: "[Empower Y]",
    also: ["[Empower Blue 2]"],
    section: "22-45",
    type: "[Permanent]",
    group: "play",
    meaning:
      "When you play this Unison Card over one whose colour matches, you may move up to Y markers from the Unison being replaced onto this one. An [Empower] naming no colour takes them from a Unison of any colour.",
    engine:
      "Read before the old Unison leaves play, because leaving clears its markers (5-13-3). “Up to Y” is asked, not assumed — the master is prompted for how many to carry, from 0 to the cap `resolvePlay` works out (colour checked, capped by what the outgoing Unison actually has), and the play does not finish until it is answered (owner's ruling, 9 Sep 2026).",
    support: "engine",
  },

  // ── Battle ───────────────────────────────────────────────────────────────
  Blocker: {
    tag: "[Blocker]",
    section: "22-4",
    type: "[Auto]",
    group: "battle",
    meaning: "When one of your other cards is attacked, switch this card to Rest Mode to become the guard card instead.",
    engine:
      "Every active, unforbidden [Blocker] is offered in the block prompt, and “when this card is attacked” triggers on it then fire. One that is resting or forbidden is listed as a refusal with its reason rather than quietly missing from the list.",
    support: "engine",
  },
  Critical: {
    tag: "[Critical]",
    section: "22-6",
    type: "[Permanent]",
    group: "battle",
    meaning: "Life damage this card deals by attacking goes to the opponent's Drop Area instead of their hand.",
    engine: "Applied during damage processing, and the “when your life is placed in your Drop Area” triggers still fire from it.",
    support: "engine",
  },
  Strike: {
    tag: "[Double Strike]",
    also: ["[Triple Strike]", "[Quadruple Strike]"],
    section: "22-7",
    type: "[Permanent]",
    group: "battle",
    meaning: "When this card would deal less than X life damage by attacking, it deals X instead — 2, 3 or 4.",
    engine: "One keyword with an X. Against a Unison Card it takes X markers off instead of one.",
    support: "engine",
  },
  Attack: {
    tag: "[Dual Attack]",
    also: ["[Triple Attack]"],
    section: "22-8",
    type: "[Auto]",
    group: "battle",
    meaning: "When this card attacks, it switches back to Active Mode at the end of the battle — X−1 times a turn.",
    engine: "Counted on the card itself, so the extra stands run out after X−1 attacks in the turn.",
    support: "engine",
  },
  Revenge: {
    tag: "[Revenge]",
    section: "22-9",
    type: "[Auto]",
    group: "battle",
    meaning: "When this card becomes the guard card, KO the attacking card at the end of the battle.",
    engine: "Marked on the battle when it becomes the guard and carried out when the battle ends, whatever happened in between.",
    support: "engine",
  },
  Alliance: {
    tag: "[Alliance XY]",
    section: "22-32",
    type: "[Auto]",
    group: "battle",
    meaning: "When this card attacks, you may switch one or more of your other Battle Cards of the named colours to Rest Mode as the cost of the printed effect.",
    engine: "The printed condition is checked before anyone is asked to rest anything, and the cards rested are bound so the effect can talk about them.",
    support: "engine",
  },
  Aegis: {
    tag: "[Aegis XY]",
    section: "22-30",
    type: "[Activate: Battle]",
    group: "battle",
    meaning: "In the Defense Step of your opponent's turn, drop cards from your hand covering the named colours to switch up to two of your energy from Rest to Active Mode.",
    engine: "Only offered in the Defense Step, and only cards that can still be part of a set covering every named colour are offered — so a pick cannot dead-end after the orbs are already spent.",
    support: "engine",
  },
  "Victory Strike": {
    tag: "[Victory Strike]",
    section: "22-18",
    type: "[Permanent]",
    group: "battle",
    meaning: "Deal life damage by attacking with this card and you win the game.",
    engine: "The game ends there, with the card named as the reason. Against a Unison Card it takes every marker instead.",
    support: "engine",
  },
  Servant: {
    tag: "[Servant]",
    section: "22-40",
    type: "[Permanent]",
    group: "battle",
    meaning: "+10000 power, and the card does not switch to Active Mode during its master's Charge Phase.",
    engine: "Both halves. The power is part of the card's power everywhere it is read, so combos and comparisons see it.",
    support: "engine",
  },

  // ── Being chosen and being KO'd ──────────────────────────────────────────
  Barrier: {
    tag: "[Barrier]",
    section: "22-16",
    type: "[Permanent]",
    group: "target",
    meaning: "This card can't be chosen by the skills of cards your opponent masters.",
    engine:
      "Taken out of the candidates of every opponent selector, and named as the reason when you tap the card anyway. “Ignoring [Barrier]” lifts it for that one choice, and a card in a hand was never in scope to begin with.",
    support: "engine",
  },
  Deflect: {
    tag: "[Deflect]",
    section: "22-20",
    type: "[Permanent]",
    group: "target",
    meaning: "This card isn't affected by your opponent's [Counter: Play] skills. Valid in every area.",
    engine: "While a [Deflect] card is being played the opponent's [Counter: Play] window holds nothing, and the refusal says which card closed it.",
    support: "engine",
  },
  Indestructible: {
    tag: "[Indestructible]",
    section: "22-12",
    type: "[Permanent]",
    group: "target",
    meaning: "This card can't be KO'd or moved out of your Battle Area by the opponent's skills or as a result of battle.",
    engine: "Honoured both by battle and by an opponent's script. A card at 0 power or less still goes to the Drop Area — that is 21-6, not a KO.",
    support: "engine",
  },

  // ── Energy and costs ─────────────────────────────────────────────────────
  "Energy-Exhaust": {
    tag: "[Energy-Exhaust]",
    section: "22-31",
    type: "[Permanent]",
    group: "cost",
    meaning: "When this card is placed in an Energy Area, it arrives in Rest Mode. Valid in every area.",
    engine: "Applied wherever a card lands in energy, from any area and by any means.",
    support: "engine",
  },
  "Warrior of Universe 7": {
    tag: "[Warrior of Universe 7]",
    section: "22-19",
    type: "[Permanent]",
    group: "cost",
    meaning: "Treat your ≪Universe 7≫ cards in every area as having no specified cost — the coloured part of a play's price.",
    engine: "Applied when the price of a play is worked out, while any card you have in play or as your Leader carries the keyword.",
    support: "engine",
  },
  Invoker: {
    tag: "[Invoker]",
    section: "22-37",
    type: "[Permanent]",
    group: "cost",
    meaning: "A Red/Blue multicolour Extra Card in your hand may be activated by switching one active Red/Blue multicolour energy to Rest Mode instead of paying its energy cost.",
    engine:
      "Offered as a separate second entry in the menu, so the ordinary price is still there. The skill's own orbs are still paid, and paid out of what is left after the energy [Invoker] is about to rest.",
    support: "engine",
  },
  Wormhole: {
    tag: "[Wormhole]",
    section: "22-24",
    type: "[Permanent]",
    group: "cost",
    meaning: "[Over Realm] and [Dark Over Realm] may be activated twice a turn between them instead of once.",
    engine: "Raises the count while any card you have in play carries it, and a refused second [Over Realm] says which limit it hit.",
    support: "engine",
  },
  "Spirit Boost": {
    tag: "[Spirit Boost X]",
    section: "22-43",
    type: "keyword (22-1-2), not a skill",
    group: "cost",
    meaning: "Part of a skill's cost: remove X markers from your Unison Card. A skill whose [Spirit Boost] can't be paid can't be activated.",
    engine:
      "Read off the tag and charged where the orbs are charged, so an unpayable one is neither offered nor resolved. It never names the skill it sits on, which is why the line keeps its own [Activate] or [Auto] type. Paying it is a moment cards watch, and those triggers fire.",
    support: "engine",
  },

  // ── Deck building ────────────────────────────────────────────────────────
  Ultimate: {
    tag: "[Ultimate]",
    section: "22-14",
    type: "[Permanent]",
    group: "deck",
    meaning: "A deck may hold at most one card with [Ultimate], and a card with it that leaves play is removed from the game rather than going anywhere else.",
    engine:
      "The removal is enforced, both in play and when the card fails to enter play. The one-per-deck limit is not: no card prints it in a wording the deck checker reads, so a second [Ultimate] card is not flagged.",
    support: "partial",
  },
  "Super Combo": {
    tag: "[Super Combo]",
    section: "22-17",
    type: "[Permanent]",
    group: "deck",
    meaning: "A deck may hold at most four cards with [Super Combo], counted across all of them.",
    engine: "Counted by the deck checker, which marks a deck over four illegal. Nothing happens in a game beyond target descriptions that name it — “a blue non-[Super Combo] Battle Card”.",
    support: "deck",
  },
  "Dragon Ball": {
    tag: "[Dragon Ball]",
    section: "22-28",
    type: "[Permanent]",
    group: "deck",
    meaning: "As many copies of a [Dragon Ball] card as you like, as long as no more than seven [Dragon Ball] cards are in the deck all told.",
    engine: "The deck checker counts the pool and lifts the four-copy limit for those cards, so six of one Dragon Ball is legal. Nothing happens in a game.",
    support: "deck",
  },
};

export type KeywordEntry = KeywordDoc & { name: string };

/**
 * What plays a skill whose whole program is empty because the keyword *is*
 * the rule — "[Z-Stack 1] Yellow <Son Goku> …", "[Triple Strike] (This card
 * inflicts 3 damage …)". Their record used to read "nothing — the engine
 * treats this skill as blank", which is the opposite of true: the engine
 * plays them, it just does not play them from a program. Null for a name no
 * keyword carries.
 */
export function keywordPlays(name: string): { tag: string; engine: string; support: Support } | null {
  const doc = (KEYWORDS as Record<string, KeywordDoc | undefined>)[name];
  return doc ? { tag: doc.tag, engine: doc.engine, support: doc.support } : null;
}

/** Every keyword, grouped for reading, in `GROUP_ORDER`. */
export function keywordsByGroup(): { group: KeywordGroup; label: string; entries: KeywordEntry[] }[] {
  const all: KeywordEntry[] = Object.entries(KEYWORDS).map(([name, doc]) => ({ ...doc, name }));
  return GROUP_ORDER.map((group) => ({ group, label: GROUP_LABEL[group], entries: all.filter((e) => e.group === group) }));
}

/**
 * Every tag written above, as `keywordOf` should read it. `npm test` walks
 * this list: a description that names a spelling no card parses as is worse
 * than no description at all.
 */
export function keywordTagSpellings(): { name: string; tag: string }[] {
  const out: { name: string; tag: string }[] = [];
  for (const [name, doc] of Object.entries(KEYWORDS)) for (const tag of [doc.tag, ...(doc.also ?? [])]) out.push({ name, tag });
  return out;
}

/** A documented tag, stripped of its brackets and its X/Y placeholders, in the form `keywordOf` takes. */
export function tagBody(tag: string): string {
  return tag
    .replace(/^\[|\]$/g, "")
    .replace(/\bXY\b/g, "Red/Blue")
    .replace(/\b[XY]\b/g, "2")
    .trim();
}

/** Whether `keywordOf` reads a documented spelling back as the keyword it documents. */
export function tagParsesTo(tag: string, name: string): boolean {
  return keywordOf(tagBody(tag))?.name === name;
}

// ── keywords that are not skills (22-1-2) ──────────────────────────────────

export interface ModifierDoc {
  tag: string;
  section: string;
  meaning: string;
  engine: string;
}

/**
 * Bracketed words that limit or price a skill without being one. They ride on
 * the line they are printed on, so the skill keeps its own type.
 */
export const MODIFIERS: ModifierDoc[] = [
  {
    tag: "[Once per turn]",
    section: "22-11",
    meaning: "The skill may be activated and resolved once in a turn. Two cards with the same skill each get their own once.",
    engine: "Counted on the card in play. Copies of the same card number are counted separately, which is right here and an approximation for [Limit X].",
  },
  {
    tag: "[Limit X]",
    section: "22-44",
    meaning: "The skill may be activated and resolved X times in a turn, counted across every copy of the same skill on cards with the same card number.",
    engine: "Counted on the card in play rather than across copies, so two copies of the same card each get X uses instead of sharing them.",
  },
  {
    tag: "[Bond X]",
    section: "22-21",
    meaning: "The skill is only valid while you have X or more Battle Cards in your Battle Area — or X or more of a named Battle Card, when one is printed.",
    engine: "Checked before the skill is offered, and the refusal names the count you have. A [Bond X] that names a card is read as the plain count of Battle Cards.",
  },
  {
    tag: "[Sparking X]",
    section: "22-26",
    meaning: "The skill is only valid while you have X or more cards in your Drop Area.",
    engine: "Checked before the skill is offered, with the count in the refusal.",
  },
  {
    tag: "[Burst X]",
    section: "22-27",
    meaning: "Part of the cost: put X cards from the top of your deck into your Drop Area. Not activatable when your deck holds fewer than X.",
    engine: "Charged where the orbs are charged, so a skill whose [Burst] cannot be paid is neither offered nor resolved.",
  },
  {
    tag: "[+X] / [−X]",
    section: "13-4",
    meaning: "A Unison Card's marker cost: add or remove that many markers to activate the skill. One marker skill per Unison per turn.",
    engine: "Only payable while the card is in the Unison Area, only with the markers to spend, and the card's marker skills are locked for the turn once one is used.",
  },
];

// ── skill types (1-5) ──────────────────────────────────────────────────────

export interface SkillTypeDoc {
  tag: string;
  section: string;
  meaning: string;
  engine: string;
}

/** Keyed by the engine's own `SkillKind`, minus the keyword lines that carry their own type (22-1-1). */
export const SKILL_TYPES: Record<Exclude<SkillKind, "keyword">, SkillTypeDoc> = {
  auto: {
    tag: "[Auto]",
    section: "1-5-6",
    meaning: "Happens on its own when the printed moment occurs — when the card is played, attacks, is KO'd, and so on.",
    engine: "The trigger puts the skill in pending and it resolves at the next checkpoint. An optional cost is put to you as a question before it resolves.",
  },
  "activate:main": {
    tag: "[Activate: Main]",
    section: "1-5-5",
    meaning: "You declare it during your Main Phase.",
    engine: "Offered only when the engine can both pay for it and carry it out; otherwise it waits for a stored program or the referee.",
  },
  "activate:battle": {
    tag: "[Activate: Battle]",
    section: "1-5-5",
    meaning: "You declare it during a battle.",
    engine: "As above, offered in the battle windows.",
  },
  "activate:main/battle": {
    tag: "[Activate: Main/Battle]",
    section: "1-5-5",
    meaning: "You declare it in either window.",
    engine: "As above, offered in both.",
  },
  permanent: {
    tag: "[Permanent]",
    section: "9-5-1",
    meaning: "In force for as long as the card is where the skill is valid. Nothing is declared and nothing is paid.",
    engine: "Re-read from the board every time it matters rather than stored, and shown on the card as a rule in force with its source named.",
  },
  "counter:play": {
    tag: "[Counter: Play]",
    section: "22-10",
    meaning: "Pends when your opponent plays a card, and may be activated from your hand during a counter timing. The card then goes to your Drop Area.",
    engine: "Offered in the counter window — unless the card being played has [Deflect], which empties it.",
  },
  "counter:attack": {
    tag: "[Counter: Attack]",
    section: "22-10",
    meaning: "Pends when your opponent declares an attack.",
    engine: "Offered in the counter window that follows the declaration. A line saying “when you activate this card's [Counter] from your hand without paying its energy cost” is its own timing and fires only on that free-from-hand path.",
  },
  "counter:battle card attack": {
    tag: "[Counter: Battle Card Attack]",
    section: "22-10",
    meaning: "Pends when your opponent attacks with a Battle Card — not with their Leader.",
    engine: "Offered only when the attacker is a Battle Card.",
  },
  "counter:counter": {
    tag: "[Counter: Counter]",
    section: "22-10",
    meaning: "Pends when your opponent activates a [Counter] skill.",
    engine: "Offered in the counter timing the opponent's counter opened.",
  },
};

// ── how the compiler reads a line ──────────────────────────────────────────

export interface ReadingRule {
  title: string;
  body: string;
}

/**
 * The rules the compiler reads printed text by. Every one of them is a place a
 * wording can be misread, which is why they are written down beside the
 * keywords rather than left in the code.
 */
export const READING_RULES: ReadingRule[] = [
  {
    title: "One skill per line",
    body: "A “<br>” separates a card's skills, and so does a bare carriage return — 307 faces of the original game use one and carry no “<br>” at all, and until the engine read it as a break every skill on those cards was fused into the first. The options of a “Choose one—” belong to the line above them rather than being skills of their own. A card printed without any separator is split again where a sentence ends and a new skill tag opens; that tag may be a type ([Auto], [Activate], [Permanent], [Counter]) or a keyword, since a keyword skill carries its own type instead of a type tag. Left joined, the second skill would be read as part of the first and never happen.",
  },
  {
    title: "Tags, then cost, then effect",
    body: "The brackets a line opens with are its tags: the skill type, the keyword, and any limit such as [Once per turn]. What follows is split at the first colon outside brackets into the cost and the effect. A keyword line whose whole body is orbs — “[Successor]{g}{y}” — is all cost, because the keyword's own rules are the effect.",
  },
  {
    title: "What a cost asks for",
    body: "A cost is orbs, a condition that has to be true (9-1-3), an action you carry out to pay (4-3-3) — or, on some 650 cards, a condition and an action at once: “If your Leader is a white <Cell> card, and you remove this card in your Drop from the game and discard 1 card from your hand”. The sentence is cut where the conditions end and the doing begins, and the cut is only taken when both halves read; a price read in half would offer the skill for free, so half a reading is treated as none. The action half is written in the second person, and the subject comes off before it is compiled like any effect. Both halves are read **once, when the card is drafted**, and stored on the rule\u2019s record as `cost.condition` and `cost.program`; a game reads them off the record and never re-reads the sentence, so what a card charges is a record you can see and correct rather than something the engine works out again mid-turn. The card's *own offer of another way to pay* — “you can activate this card's [Counter] skill from your hand without paying its energy cost **by choosing 2 other cards in your hand and discarding them**” (5-3) — is held to the same standard, and until 9 Sep 2026 it was not. That offer is read as one sentence rather than clause by clause, precisely so the half of the price after the “and” is not orphaned; but the read stripped only “you can”, and ten of the eleven cards printing such a price open with a condition of their own (“**If your life is at 3 or less,** you can…”), so it never fired for any of them. The sentence went to the clause list, the price lost its second half, and the [Counter] was offered for a choice that cost nothing. The opening condition now comes off in front and goes back on around the permission — read through the compiler's compound-condition reader, because these openers state two and three requirements at once and a single-condition read drops what is between the first and the last. A price that still cannot be read whole leaves the skill unread rather than cheap, which is what BT31-135 (“placing it under your <Hyperbolic Time Chamber> Leader”), DB2-029 and BT14-090 now do. Three more primitives of that same offer landed 9 Sep 2026. First, the waiver was only ever “none”, “life” or an action “program” — no shape for a price that is still energy, only less of it — so “you can activate this card's [Counter] skill from your hand **by paying {1}** instead of its energy cost” (BT18-088) had nowhere to go; `pay: \"energy\"` reads the orbs after “paying” the same way a printed cost's orbs are read. Second, the offer always defaulted to being about the card printing it, with no way to say otherwise or to say for how long — so “**Until the start of your next turn**, you can activate **mono-blue cards with [Counter] skills** from your hand by …” (BT11-033) could only be read as an instruction to *play* whatever the selector found, its own price's count mistaken for the selector's; `target` and `until` now let the offer be granted to other cards for a span, expiring like any other continuous effect, and the price is read from the sentence as printed rather than from whatever splitting left of it, so “…and discarding them” is not orphaned by a clause break the way it would be read piece by piece. Third, an action price naming “the cost for [Spirit Boost X]” — the marker cost that keyword spends off your Unison Card, printed as the price for something else instead of where it usually stands — compiled to a plain `removeMarker` but was never on the whitelist of prices the engine can actually promise are payable, so five [Permanent]s (BT14-019/043/083/109, BT17-109) read as nothing at all; `removeMarker` joins that whitelist. Two shapes stayed a decision rather than a gap: `flip` and a price that moves a card **under** another (`moveTo` to `\"under\"`) are still refused there, because “under” needs a host to put anything under and there is none to promise at the moment the price is checked.",
  },
  {
    title: "What the orbs mean",
    body: "{r} {u} {g} {y} {b} {w} are red, blue, green, yellow, black and white — blue is u rather than the initial it shares with black, and white is the sixth colour, which BT28 added. {k} is accepted as a second spelling of black, but the catalog never prints it: every one of 248 black orbs is written {b}, which the letter table did not recognise until 9 Sep 2026 — every skill cost, cost reduction or filter written in black was reading as an unrecognised letter and losing the whole clause with it (BT17-119's {b} activation cost, BT29-140's {b}{w} reduction). {2} is that many orbs of any colour. {r}/{u} is one orb payable with either of the two named colours, which is not the same as one of any colour. A few sets print ③ for {3}, and it is normalised before anything reads it.",
  },
  {
    title: "The target grammar",
    body: "Descriptions such as “Blue <Baby> with an energy cost of 4 or less” or “yellow non-≪Great Ape≫ card” are read into a filter: colours, characters, traits, names, card type, energy cost, and keywords a card must or must not have. That is what lets [Evolve], [Union], [Swap], [Z-Stack] and [Z-Awaken] offer the right cards with no compiled program at all. A phrase the parser drops widens a selection rather than narrowing it, so it is written to refuse rather than to guess. A phrase naming several cards puts the noun in the plural — “Battle Cards with energy **costs** of 7 or less” — and until 9 Sep 2026 the cost line only admitted the singular, so a hundred-odd selectors read no cost at all and offered every card in the area. The same day and the same shape: a power bound is printed both as “25000 **power or less**” and as “25000 **or less power**”, 41 lines use the second, and only the first was read — so some thirty-eight selectors carried no bound and were offered every card in the area. A power bound can also be measured against a card the same skill only just chose rather than the card printing the skill: “choose 1 of your Leaders or Battle Cards, choose all Battle Cards with power less than or equal to **the chosen card's** power, and KO them” (BT19-096) is the one line that prints it, and until it was read the bound was dropped entirely rather than measured against the wrong card — a KO sweep offered to every Battle Card on both boards. The two readings are the same comparison against two different subjects, so `powerRel` carries which one (`of: \"self\" | \"chosen\"`), and for `\"chosen\"` the variable it means, filled in when the clause compiling it is the one that still remembers which choice came before. **Which cards are ruled out** is part of the description too, and is read as three things at once: “other than this card” and “**except for** this card” are the same exclusion said two ways; a run of names after either — “other than this card **or your \<Caulifla\>**” — excludes every name in it rather than requiring the ones after the first; and a possessive inside that run belongs to the card being spared, not to the cards being chosen, so it does not hold a sweep to your own side. TB1-015 is where all three were wrong at once: “choose all Battle Cards with 25000 or less power other than this card or your \<Caulifla\>, and KO them” read as *your* \<Caulifla\> cards of any power — it KO'd precisely the cards it was written to spare, and nothing else. Two shapes are refused outright rather than read loosely, because each names cards by their *history* and no filter can say it: “all cards **sent to Warps by this skill**” and anything else qualified “by this skill”. A third was refused with them until 9 Sep 2026 and is now read: “the card **on top of this card**” is the card this one is under (23-2), which a selector can say because a pile is one card with everything else beneath it — so there is exactly one answer, and the description in front of it narrows as any other does (“the <Majin Buu> on top of this card”, “the Leader on top of this card”). Only the phrase that *ends* there is a target; the same words anywhere else name a **destination** (“play up to 1 green <Piccolo> card … on top of this card from your deck”) and stay refused. Before either reading, the phrase satisfied the parser's “this card” shortcut, so all fourteen [Permanent]s that grant [Barrier], [Double Strike] or power to the card above granted it to themselves. The **pile under another card** is now read as the same `under` area with a named host: “from under your <Kefla> Battle Card”, “from under your Leader Card”, “cards under {King Kai's Planet}”. The host itself is read as a selector and the choice then comes from its pile, so EX25-39 uses a card beneath <Kefla> rather than the <Kefla> itself. **Which mode the cards are in** is part of the description too, and the sets say it two ways: “1 of your opponent's Battle Cards **in Rest Mode**” and “1 of your opponent's **Rest Mode** Battle Cards” name the same card, and until 9 Sep 2026 only the first was read. Seventy skills print the second, so BT23-109's “choose up to 1 of your opponent's Rest Mode Battle Cards and KO it” was offered every Battle Card the opponent had — a KO written for a card that has already attacked, pointed at whichever you liked. The mode words also name a *destination* — “switch this card **to** Rest Mode”, “play it in Rest Mode” — which says nothing about what to pick, so the attributive reading is taken only in front of a noun, where a destination never stands.",
  },
  {
    title: "A name in whole, and a name in part",
    body: "A name in brackets is matched whole. 2-10-1-1 says so outright: <Son Goku> and <Son Goku : Childhood> are different character names however much text they share, so a card asking for one of them is answered exactly. But 162 cards in the original game ask a looser question — “≪Goku's Lineage≫ with <Son Goku> **in its character name**”, “cards with <GT> **in their character names**”, “{SS4} **in its card name**”, “a card name that **includes** {Baby}” — and that phrase is precisely what a card prints when it means every name the token appears inside. Only the phrase gets the loose reading; the bare token keeps the strict one. Read as the bare token, all 162 compiled cleanly and then matched nothing at all, which is how BT4-096 came to check its own <Son Goku: GT> leader for <Son Goku>, decide it was looking at someone else, and grant neither its +15000 nor its [Double Strike]. A name asked for in part and a name asked for whole are answered in the same breath rather than as two demands, because “<Pan> card or card with <GT> in its character name” is one choice with two ways to satisfy it; “without <Turles> in their character names” excludes instead. Three shapes deliberately stay outside it, being different measures rather than looser ones: “2 or more character names including <SH>” counts names, “shares a character name with this card” compares two cards, and “cards with different character names” asks for distinctness. A **negated** name is still a name for the purpose of cutting a sentence into clauses: “you can't play non-<Zamasu> **and** non-<Goku Black> Battle Cards for the game” was split at the “and” into two halves that each lost by it — the first became a prohibition on <Zamasu> alone, and the second, which is where “for the game” is printed, read as nothing at all, so the ban was on the wrong cards and expired at the end of the turn (BT16-088, and P-746 with two traits said the same way).",
  },
  {
    title: "What a card is also treated as",
    body: "“This card gains ≪Saiyan≫ in all areas”, “your <Son Goku> cards are also treated as red, blue, and green”, “this card is also treated as {Planet M-2} in all areas” — 20-1, and a sentence about what a card *is* rather than what it does. The engine reads it wherever the card sits, hand and Drop included, because that is what “in all areas” says and because the skills that ask are asking about cards outside play. Four things can be gained this way: a special trait, a character name, a colour, and — since 9 Sep 2026 — a whole **card name**, which eight cards print and none of which the compiler could read before. A gained card name is *also*, never instead: the card keeps its printed name and answers to both, so a skill naming {Planet M-2} finds it and a skill refusing {Planet M-2} passes it over. Everything that asks what a card is goes through one place (`cardNow`), so a gain is seen by a selector's filter, a Leader condition and an [Evolve] target alike. Two things it deliberately does not reach: “only 1 {X} can be played in your Battle Area”, which still compares printed names, and a card gaining another card's *skills*, which is a different sentence and is not read at all.",
  },
  {
    title: "Where a card is picked from",
    body: "A description says which card, and the area words in it say where to look — “from your Drop”, “in your opponent's Battle Area”. A description with no area word in it is a card on the table (20-1-6), except right after a “look at …”: “look at up to 5 cards from the top of your deck, add up to 1 white ≪King Kai's Planet≫ card to your hand” picks out of the five, and standing after the look is the only thing that says so. The older sets printed “among them”; the newer ones dropped it and mean the same, and so does “**from it**” after a look or a reveal — “your opponent reveals their hand. Choose up to 1 card with an energy cost of 7 or less from it and discard it” is the hand that was just turned up, and read as no area at all it discarded one of **your own** cards (BT16-005 and five more). Only when something is being held out: with no look or reveal behind it, “it” is a pronoun for the sentence to answer and not an area. “In all of your areas” is not an area but a span, and means every one a player has — leader, battle, unison, combo, energy, hand, deck, drop, life, warp and both Z-areas; cards removed from the game are in no area, and a card under another is in its host's. The same span is also printed as a **complement** — “in areas other than your deck, hand, or life” — and the areas it lists are the one part of the phrase that must not be read as the place to look: the area words are first-match-wins and read “your deck”, the exact inverse of the card, so the five mono-colour locks of BT7-125 to BT7-129 checked the pile their cards are least likely to be in. The complement is written out area by area, and a list naming an area the table does not know refuses the phrase rather than standing for a span wider than the card allows. Only “in”: “when a card is placed in your life face up **from** any area other than your life” says where a card came from and is a trigger, not a description of cards. A phrase that points back — “add it to your hand”, “the chosen card” — is neither, and is answered by whatever the skill already settled, except that a **plural** pointer (“them”, “those cards”) is never answered with *this card*: that is what a failed clause earlier in the sentence leaves behind, and it turned “choose … Battle Cards and Unison Cards … negate the skills of those cards” into a card negating itself. The singular pointer is answered the same way once a clause really has been refused — see “What a refused clause leaves behind”. A possessive says whose cards these are, but “**their owner's**” says nothing of the kind: it is the idiom for every card going back to whoever owns it (2-4), it is printed on 113 skills, and it lives in the *destination* half of the sentence. Read as an ordinary “their” it made the phrase say **opponent** — and said it about the source, so “play up to 4 ≪Saiyan≫ cards from **your** Warp into their owner's Drop” went looking in the opponent's Warp (BT27-015, BT29-060, BT29-095, BT29-108, P-710). It is stripped before the side is read, like the name phrases beside it. So is “**to** your opponent's Battle Area”, the same mistake in the other idiom: seven cards hand the opponent a card — “play up to 1 \<Pan: SH\> **from your deck** to **your opponent's** Battle Area” — and the destination at the end of the sentence decided where the *search* happened, so the card went hunting in the opponent's deck. That is the printed mechanic inverted, not merely narrowed. Two guards keep the strip from inverting cards it is not aimed at: never after “equal”, where the “to” belongs to a comparison (“an energy cost greater than or equal **to your opponent's** energy”), and “**in** your opponent's Battle Area” — which the sets write where they mean “into” — only where the clause has already named its source with “from your …”, since otherwise that phrase *is* the place to look. **Three bugs have now come of deciding the side by scanning the whole clause rather than the phrase that names the area**; each strip is a card-shaped patch, and `docs/arena-side-scope.md` is the structural fix. Two phrases are cards rather than searches. “Your Leader”, “your opponent's Leader” is the one card a player has there (3-1-2), and reading it as a search of a play area let a negation land on a Battle Card instead. “All **other** Battle Cards” rules out the card the skill is on, and — where the sentence names no owner, as the sets do when they mean everyone's — means both Battle Areas: read as your own, a board wipe cleared only the caster's side and took the caster with it. Since 9 Sep 2026 that holds for **every** sweep and not only the ones saying “other”: “choose all Battle Cards with energy costs of 2 or less” names nobody and means everybody. Five of the nine cards said so themselves — “ignoring [Barrier]” is dead text unless the choice reaches the opponent, 22-16-2 defining the keyword against “the skills of cards mastered by your opponent”, and BT7-037's “then all players who returned cards to their decks shuffle” presupposes both did — and the remaining four are the owner's ruling of 9 Sep 2026, recorded on their rows. The word has to be the **determiner of the cards**, though: “choose all Battle Cards with 15000 power or less-all in Rest Mode-and…” has an “all” that governs a preposition rather than a noun, so taking it as a second sweep would spread a rest-lock over both boards. EX25-35 is the one card that prints it, and it was `splitClauses` cutting the sentence in two on the “and” between its two target descriptions that cost it the possessive: “choose all of your opponent's skill-less Battle Cards **and** Battle Cards with 15000 power or less” is one choice named two ways, not two clauses, and the second half arrived with no owner of its own, so the rest-lock it ends in read as aimed at *your* board instead of your opponent's. `splitClauses` now knows this shape — a “choose … Battle Cards” that stops exactly there, followed by “and Battle Cards” continuing the same description — and leaves it whole; “skill-less” still goes unread, which is a separate, narrower gap in `parseFilter` and not this one.",
  },
  {
    title: "Where a trigger is printed",
    body: "An [Auto] says when it happens, and the engine reads that from the head of the sentence and nowhere else — a “when …”, or a moment named as a phrase (“at the end of your turn”, “at the end of the battle”). It has to be the head, because 116 skills merely *mention* a moment in the middle of an effect — “draw 1 card, and at the end of the turn, KO this card” — and mean a delayed effect by it; read as triggers, every one of them fired its whole text again at each turn end. A condition printed in front of the trigger, with a comma or with the sets' own bar, does not hide it. The one exception is a skill with no trigger at all: a delayed effect needs something to schedule it, so a card whose only moment is printed at the *end* of the sentence — “you may place 1 card from your hand in the Drop Area at the end of the battle” (BT3-103) — is triggered by that moment after all, and it is then no longer part of the effect it introduces. Two moments joined by an “or” are not read, because acting at one of them is acting at a moment the card does not name.",
  },
  {
    title: "What the board remembers",
    body: "Some conditions ask what has already happened rather than what is true now, and the board keeps only what a card actually asks for. “If this card participated in a battle during your opponent's turn” (BT3-103) is one: a card is the attack card or the guard card only until the battle ends (8-1-2-2), and the question is put *after* one has ended, so the card carries the memory instead. It lasts the turn and no longer — cleared with the rest of the turn's bookkeeping — which is what makes it a claim about the turn in progress; whose turn that was is a separate condition, asked alongside it. A card played on top of an attack or guard card inherits the role (8-1-7-1), and so inherits the memory.",
  },
  {
    title: "An offer, and what hangs on it",
    body: "A skill can offer you something rather than tell you to do it, and the sentence after it may hang on your answer: “you may place 1 card from your hand in the Drop Area. If you do so, draw 1 card”. The offer is read as a choice you may answer with nothing, not as a yes-or-no question followed by a discard — because a yes given with an empty hand pays nothing while still counting as a yes (20-16), which would buy the rest of the skill for free. Declining and having no card to give are the same answer (5-2-4), a price of 2 cards is not paid by giving one, and the cards only leave your hand once the price is met. “If you do so” is then written into that same branch rather than asked again, so the price and what it buys keep one set of conditions and one moment — a price paid “at the end of the battle” buys something that happens then too, not now. An offer whose price is not one of the wordings read this way is still wrapped in a plain yes-or-no, which is the older and looser reading.",
  },
  {
    title: "A condition can point back",
    body: "“Place up to 1 card from the top of your deck in the Drop Area. If that card is red, this card gains +5000 power” — the comma is grammar, and “that card” is what the skill itself just did. In a condition, “that card”, “it”, “the revealed card” and “the chosen card” mean the card a reveal or a look turned up, the card a choice picked, or the card a mill put in the Drop, which goes face up and so is a card both players have seen. A condition whose subject is not one of those is not this and is not read — “when this card attacks a Battle Card, if that card has 25000 power or less” means the card being attacked, which the trigger named rather than the skill. A description carrying “not”, “other than” or “except” is refused outright: the filter has no room for the negation, and reading it would make the condition hold for exactly the card the sentence excludes.",
  },
  {
    title: "Keywords that own their line",
    body: "For [Evolve], [Union], [Over Realm], [Swap], [Overlord], [Z-Awaken], [Z-Stack], [Field], [Dual Attack], [Revenge] and [Offering], the text after the tag is a condition or a description, not an effect — the keyword's own rules are the effect. The compiler leaves those lines alone instead of reading the description as a program.",
  },
  {
    title: "A condition, before or after the effect",
    body: "A condition can be printed in front of the effect — “If your Leader Card is red, draw 1 card” — or behind it: “this card gets +5000 power when all of your opponent's energy is in Rest Mode”. Both orders are read as the same rule, and the effect happens only while the condition holds. “If” is a condition wherever it stands. “When”, “while” and “as long as” are only read as one at the *end* of a [Permanent], which has no trigger and never resolves; at the end of an [Auto] the same word is the skill's trigger — “draw 1 card when this card attacks” — which fires at a different moment, so the engine refuses the line rather than reading one rule as the other.",
  },
  {
    title: "What a refused clause leaves behind",
    body:
      "A clause the compiler cannot read is not silent for the clauses after it: the sentence goes on talking about what that clause named, and nothing is bound to it. Three ways it used to be answered wrongly, all fixed on 9 Sep 2026. A pronoun after the hole was answered with **this card**, because an [Auto] seeds the antecedent to the card it is on — so P-645's “play 1 {Majin Buu, Unadulterated Destruction} from under your green <Majin Buu> card, and **it** gains [Double Strike]” gave the keyword to the card printing the skill, and P-279's “KO **it**” KO'd it. The antecedent is now marked when a clause is refused, and a back-reference that would land on the seeded self is refused with it; a clause that binds something of its own clears the mark, and where nothing was refused “it” still means this card as it always did. Second, “**if you do**” and “if you don't” point at a decision, and when the clause that would have made it went unread, dropping the hinge alone made everything hanging on it happen *every* time — BT12-042 played a 5-cost <Gogeta> without paying the {u}{u} it offers to pay. The rest of the sentence is now refused with the word that governs it. Third, a **modal option** that failed to compile left an empty branch, and the menu then offered a mode that silently did nothing (P-396): one empty option now fails the whole skill. All three cost coverage — 55 clause shapes entered the gap set and two cards left the fully-read count — and all three trade a wrong answer for an honest one (ground rule 5). Two correct readings were given up with them, BT1-002b and BT10-036, where the refused clause was itself about this card. The rule cuts both ways, and the sharpest illustration is a contraction: the sets print “**if there's** a Blue/Yellow multicolor card in your energy” as readily as “if there is”, and only the long form was read. Seven skills say it. What it cost was never the condition — “blue/yellow multicolor card” reads perfectly well — but the clause the condition governs, so BT15-146's combo-cost reduction was simply always on. Teaching the contraction reads five of them, and one of those five was not a gap but a *wrong* reading: BT15-022's first condition going unread left the second half's possessive misattributed, so a card asking for a red [Field] Extra in **your** Drop Area went looking in your opponent's. A fourth, and the largest, on 9 Sep 2026: **a clause opening with “if” is a condition whether or not this compiler can read it**, and everything after it hangs on it. Refused alone, the clauses it governed became a skill that happens *always* — BT2-018 played itself from hand for nothing whether or not \<Son Gohan: Adolescence\> was anywhere, BT15-075 granted [Blocker] with no [Field] Extra Card in play, BT10-089 offered a board wipe with no requirement at all, and “when this card attacks, **if you have more life than your opponent**, draw 1 card” drew every time. The rest of the sentence now goes with the word that governs it, exactly as “if you do” already did. It is the same reason and by far the biggest count: 149 skills stopped happening unconditionally and 119 more lost a tail they were never entitled to, 430 clauses entered the gap set — and **no card left the fully-read count**, because every one of them already had a gap elsewhere. That fourth fix left one shape of its own behind, found the same way: a **modal's own head** can be nothing but a condition, with no effect of its own before the “choose one—” that follows it — “When this card attacks, **if your Leader Card is a \<Broly\> card**, choose one— ・…” (BT6-074), “**If your Leader Card is a green \<Cheelai: Br\> card or yellow \<Broly: Br\> card**, choose one— ・…” (EX19-13, TB3-066). `parseConditionClause` reads every one of these clauses correctly — that is how each was ever split off as the head in the first place — but a condition with nothing to gate is a group whose body never fills, and the flush that turns a group into an `if` skips exactly that group empty-handed, so the read was thrown away one step after it was made. Fixed by reading the head a second time, right where the menu is built, and wrapping the whole `chooseMode` in it — but only when nothing in the head actually failed to compile, so a head that is genuinely unread still refuses rather than gaining a condition weaker than what it printed. Three skills gained their condition back; none left the gap set, for the same reason as the fourth fix itself.",
  },
  {
    title: "Read, stored, or put to the referee",
    body: "A skill counts as read only when every clause of it compiled. One clause the compiler cannot read sends the whole skill to the referee at runtime, which costs tokens, takes a moment and can be wrong. There are two ways to settle it for good: store a program for that one card, or explain the card in your own words so the wording becomes a work item for the compiler — the fix that covers every card phrased the same way.",
  },
  {
    title: "Only what it can pay for and resolve",
    body: "A skill is offered as an action only when the engine can both charge its cost and carry out its effect. That is why coverage is not the same as playability: a skill the compiler reads perfectly still does nothing until its price is one the engine can read too. Both come off the rule\u2019s record, so a skill with no record has an *unknown* price rather than a free one \u2014 it is refused, and the refusal says the text is unread. Draft the card and it plays from the next game.",
  },
  {
    title: "Negating a keyword",
    body: "“Negate its keyword skills” means the keyword stops applying (22-1-3). A line that is nothing but keyword tags — “[Deflect][Triple Attack]” — is parsed as several skills, one per keyword, so a card can negate one of them without touching the other. The sentence comes in two word orders and both are read: “negate **X's** [Energy-Exhaust] skill” and “negate the [Energy-Exhaust] skill **on** X”, the second on ten wordings that went unread until 9 Sep 2026. A tag that names a *kind* of skill rather than a keyword — “negate the [Auto] skills of …” — is let past both rules rather than turned into a keyword that does not exist; that word order is still unread.",
  },
  {
    title: "Reducing (or raising) a cost",
    body: "9-1-3-3 and 20-21 both work through one sentence, and the sets print it several ways: “reduce/increase/decrease the energy, combo or Z-Energy cost of X by N”, the possessive “this card's”/“that card's”/“its”/“their” cost, the passive “the energy cost of X is reduced by N”, “cost **on** X” beside “cost **of** X”, the plural “costs”, and a bare “cost” with no “energy”/“combo”/“Z-Energy” word, which defaults to energy. All are read as the one shape: the possessive and passive forms are rewritten to “reduce the cost of X by N” before the shared rule runs, so a pronoun subject gets the same “this card”/“that card”/“it”/“them” handling every other rule already gives it. A named area survives that rewrite too — “this card's energy cost **in your hand**” — though it says nothing a self or pronoun reference needs, since that already finds the one card regardless of where it sits. “Reduce the energy cost **and** Z-Energy cost of X by N” (BT22-085, P-476b) is one amount named for two costs at once and compiles to two ops, one per cost — the pattern the general “and” splitter would otherwise cut in half, leaving “reduce the energy cost” with no amount and “Z-Energy cost of X … by N” with no verb, neither of them a sentence (`andJoinsTwoCosts` keeps the two halves together). A **bare**, no-subject “reduce the Z-Energy cost by N” (BT22-034) reads as a continuation of whatever the sentence was already about — `c.lastTarget` — because “Z-Energy” is unambiguous about *which* cost even though it says nothing about whose; the same bare form for energy or combo stays unread, since neither noun alone says that. A **skill** or **[Evolve]** cost now reads by the same reducer too, but only when its scope reads whole — target selector plus duration — and that scope is carried to `orbTotals` so the shown price and the paid one are the same number. A skill-cost clause with an unread scope is refused whole rather than compiled unscoped. A **specified** cost keeps its own op and meaning (owner ruling, BT19-039): it changes required colours, not totals. The Z-Energy cost itself is read by `zEnergyCostOf` (`state.ts`), which the five call sites around `payZEnergy` and the Z-Deck legality gates in `engine.ts` go through instead of `d.zEnergyCost` raw, so the reducer actually changes what a Z-Card is offered for and pays rather than only what the record says. “X get −N combo cost” is the same reducer said the way “X get +N power” already is, and a pronoun subject (“their combo cost”) is read the same way there too. A trailing “, for each Y” is the amount's multiplier, not a second clause — split off, the first half compiles alone with a flat, unscaled number and the multiplier becomes an orphaned, separately unread fragment (BT27-123 reduced by a flat 1 rather than 1 per ≪Saiyan≫ in Warp), so the comma before “for each” no longer breaks the sentence in two. “For every N”, N > 1, is a genuine divisor no `Amount` shape can express yet (BT13-076, BT13-077) and stays unread rather than being read as “for each”, which would drop the N entirely. A **leading** “for each X, reduce …” (P-464) is left unread too, cap and all: the count has no verb of its own to be read as anything, and a trailing “(Up to N)” stacking cap is stripped by `stripNotes` as reminder text before it is ever seen — reading the reduction alone would apply it flatly, unconditionally and without the cap the card prints, so `compileClauseList` refuses it rather than keep it uncapped.",
  },
  {
    title: "Counted and conditional prohibitions",
    body: "A prohibition may carry a budget and an escape. “Can only attack one more time” is read as one allowed use (`uses: 1`) and then a prohibition once that use is spent; “can't … unless …” carries the condition on the prohibition (`unless`) and the legality check asks it each time, so the action is refused while the condition is false and offered again when it becomes true. Both are asked by `legalActions` and by the `whyNot*` twins from the one predicate, so the menu and the refusal cannot disagree. Two things the shapes turn on. A **budget is spent by the action happening**, not by the prohibition being read: `apply` decrements it once the move is taken, so a `uses` rule left unread never runs down, and a rule with uses remaining forbids nothing. An **escape clause is a sentence of the card that printed it**, so it is asked in *that* card's chair (the prohibition records its `master`) — reading “your opponent” from the chair of whoever is trying to act would invert every such card — and it is then said back to the player being refused in their own words, which is the one place the engine mirrors “you” and “your opponent” rather than printing them as the script wrote them. An escape the compiler cannot read takes the **whole** prohibition with it rather than leaving the half before “unless” standing: “your opponent can't attack for the turn unless they discard 1 card each time” is a cost the opponent may choose to pay (replacement territory, out of scope here), and reading only the ban is a stricter rule than the card prints. Twenty clauses of the catalog read that way before this — BT10-063, BT11-053, BT13-082, BT13-140 among them — so the compile rate falls by 15 cards where it used to over-forbid.",
  },
  {
    title: "A pronoun that answers a clause the compiler never reached",
    body: "“…and the next time you play a red <Broly> card from your Z-Deck during this turn, reduce **its** energy cost by 1” (BT29-018) names a card that does not exist yet — “the next time you X” is a deferred one-shot trigger the engine does not support, so the clause naming it is refused. Read on its own, “reduce its energy cost by 1” still resolves “its” by the ordinary pronoun rule, landing the reduction on whatever the sentence bound *before* the refused clause instead — here, a card already moved to Z-Energy two clauses earlier. `refFor`'s existing stale-antecedent guard (“What a refused clause leaves behind”) only catches this when the stale binding is the seeded self; a bound choice going stale is the same failure and is now refused too, but only where a cost reducer's own target resolves to the exact stale value (`c.stale`) rather than as a change to the shared pronoun rule, which would have refused far more than this one shape. BT11-058 and P-517 print the same “next time”-then-pronoun shape without any of the new wording and were already reading wrongly before it — this is not a new failure mode, only the first place it was checked for.",
  },
  {
    title: "A target the grammar cannot follow",
    body: "A rule that reads a clause is only as good as the target grammar underneath it, and two shapes are known to go further than that grammar can follow. “Your opponent's **Leader**” comes back as *any one card in their play area* rather than the Leader, and “all **other** Battle Cards” comes back as all of *your own*, this card included, rather than every Battle Card but this one. Both are silent: the clause compiles, reads plausibly, and aims at the wrong cards. Because of them, “negate the skills **of** X” is deliberately left unread on the seven cards that print it — seven unread beats three read wrongly (ground rule 5), and the fix belongs in the target grammar, where a Leader becomes a special target and “other” becomes the exclusion it already has a field for. A third shape is now refused outright rather than read loosely: “play up to 1 \<A\> card **and** 1 \<B\> card —both green— **from your deck**” names two *different* cards drawn from one shared source, and no primitive says that. Split at the “and”, the first name lost its source and read as a card already on the board, while the second took the source and had its side flipped by a stray “their” in “with their skills negated”. Read instead as one filter, “A and B” collapses to “A or B” — satisfied by either alone, fewer cards than printed, still not what the card says. Twelve cards left the fully-read count when it was refused, and every one of them had counted as complete only because the wrong reading hid the gap (BT20-077, BT20-079, BT24-123, EB1-32, EX23-37).",
  },
  {
    title: "For each marker, not for each card",
    body: "“For each marker on X” (13-2) counts the markers on the cards X names, added up — a different question from “for each of X”, which counts the cards themselves. Read as a card count, “for each marker on this card” asked how many cards are named *this card*, which is always exactly one: BT27-003/004/005/006 printed a flat +5000 power that never grew with the counter it names, and BT15-120 gave +5000 for every Unison Card the opponent had rather than for every marker on them. The count more often trails the effect it multiplies (“this card gets +5000 power for each marker on it”), but on the four BT27 cards and EX19-21 it leads the sentence instead, comma-joined — the reverse of a trailing duration, and read the same way: reattached to the effect before either is compiled, rather than left as two clauses that cannot see each other. EX19-21 prints the same leading count over a pronoun (“it gets +5000 power”) that the engine cannot resolve on a fresh [Permanent], and stays unread rather than answered — the leftover “this card” in “for each marker on this card, it” is exactly the substring a subject-phrase match would otherwise seize on, so a clause that fails to compile once its count is known to be a marker total refuses outright instead of falling through to a pattern that cannot tell that phrase from its own subject. A reduced cost is not read this way yet: BT15-095, BT24-139 and BT28-054 print the same “for each marker on …” but lower an energy cost rather than raise a power, which the language can now express (`markers` is one `Amount` beside `count`) but nothing yet compiles into — left split and unread, as before, rather than merged into a clause that only changes which text shows up unread.",
  },
  {
    title: "A card no skill may touch",
    body: "“This card isn't affected by your opponent's skills” (9-1-4) is read into its own operation rather than folded into a prohibition, because it is a stronger claim than “can't be chosen” — the rule covers everything a skill might do to the card, not only the moment of choosing it. The engine's reading is narrower than that: enforced once, in the same selector check that already carries [Barrier] and “can't be chosen by skills”, so it stops a card from being *picked*, and an effect that reaches it without a selector — a board-wide power change, a skill named at a player rather than at a card — is not caught. That gap is written down rather than closed by guessing, and is exactly what the family's own probe reports: staged against an opponent's KO skill, a working reading shows the card was never among the targets offered. “Non-<Gogeta: GT> skills” (BT18-019) names no side at all, and by the same convention as “all other Battle Cards” meaning both Battle Areas, that means every skill's, not only the opponent's. “The skills of opponent's cards other than Battle Cards” and “…non-Extra cards” narrow the *source*, which the plain wording never needs to say — a filter on the card doing the affecting, not the card being affected. One duration has no exact answer: “until the start of your next Main Phase” (BT9-119) is a phase later than any duration this engine can name, and is left unread rather than approximated.",
  },
  {
    title: "\"Instead\" said passively",
    body: "9-10's replacement (“if this card would leave the Battle Area, X instead”) is read in two independent halves — `parseWouldLeave` reads the opener, the clause after it reads the destination — and both were written for the active voice only. Ten cards print the destination passively: “it's sent to its owner's Warp instead” and “it is placed at the bottom of its owner's deck instead”, where every other card says “send it to its owner's Warp”. The subject is always the pronoun the opener already bound, so the passive forms are read the same `moveTo` way once the verb is recognised (BT11-095, BT12-056(+b), BT15-092(+b), BT15-097, DB3-081, DB3-130, SD14-03; the same passive destination also unblocked an unrelated clause on DB3-128 that happened to share it). Six more (BT14-153, BT14-154, BT15-153, BT15-154, BT16-107, BT17-148) print the opener itself as an accomplished fact — “if/when this card **is** removed from your Battle Area” — one word short of the “would” the opener used to require; read the same way, defaulting to `by: \"skill\"` exactly as \"would be removed from\" already does. A seventh shape, printed only on the two ≪Turles Crusher Corps≫ leaders (BT12-056(+b), BT15-092(+b)) and on BT15-097, says the same thing a third way — “a card in your Battle Area **would be placed in its owner's Drop Area** by one of your skills” — naming the ordinary route out instead of “leave”/“removed from”; also read as `by: \"skill\"`. The capability half moved too: when a scripted skill move or KO would take a card out of play, the engine can now ask the affected player which applicable replacement to use, and it carries a compiled `optional: true` on “you may … instead” so declining leaves the original move in place. Outside those two suspendable script paths, nothing new is guessed — optional replacements are ignored rather than auto-applied, and several mandatory replacements still keep the old first-match rule on routes that cannot stop to ask. Two more cards are still deliberately unread rather than folded into the same fix: P-182 (“when this card is placed in a Drop Area **from a Combo Area**, it is sent to its owner's Warp instead”) and the DB2-137/140/151/153 group (“…from a Battle Area **or Combo Area**…”) name an origin `move()` cannot see — its replacement check (`state.ts`, `wasInPlay`) only fires for a card leaving `leader`/`battle`/`unison`, never one leaving the Combo Area, so reading these as an ordinary Battle-Area departure would be wrong twice over: dead on P-182, whose only route out is the Combo Area, and over-wide on the DB2 cards, applying the redirect to any Battle-Area departure when the print gates half of it on a path the engine cannot check at all. The two public-reveal cards (BT10-031, SD18-01) remain beyond this slice too: the engine can choose the replacement, but it still does not surface the destination face up *before* the choice resolves.",
  },
  {
    title: "Conditions joined by \"or\"",
    body: "“If you have a green <Trunks> or a yellow <Vegeta> in play” names two separate conditions joined by “or”, and compiles as a disjunction (`any`) of two count conditions rather than a single filter. Read into one filter, the two colours and two character names would combine into an AND-across-fields cross product, which is wider than printed in one direction (a green <Vegeta> would satisfy it) and narrower in another. Where the two halves share a subject without introducing distinct qualifiers — “a green or yellow Battle Card” or “red or blue” — the single-filter reading is preserved.",
  },
  {
    title: "Whose cards a phrase names",
    body: "A clause routinely names more than one player: a source area, a destination area, a measure of energy, a card name, or a trait with “their”. Reading the side off a scan of the whole clause let any trailing possessive hijack the source selector — sending “play up to 1 <Pan: SH> from your deck to your opponent's Battle Area” searching the opponent's deck instead of your own (BT13-028, BT16-021, BT18-087, BT22-006, BT21-068, BT21-092), and reading “an energy cost greater than or equal to your opponent's energy” (DB1-059, EX08-06) as an energy area search. The side is now read strictly from the phrase up to and including the matched area or area pair, so destination possessives and trailing comparisons never reassign the source. The whole-clause scan is preserved solely as a fallback when no area was named at all (“up to 1 of your opponent's cards”, which 20-1-6 places in play).",
  },
];
