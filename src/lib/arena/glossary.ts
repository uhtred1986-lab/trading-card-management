/**
 * What the arena engine knows about card wording, written down.
 *
 * The engine reads printed card text: `engine/cards.ts` turns a line into a
 * skill with a type and a keyword, `engine/filters.ts` reads the target
 * grammar, `engine/compile.ts` turns the rest into a program, and the referee
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
    meaning:
      "An Extra Card that stays on the table in Active Mode instead of going to the Drop Area. Its other skills work from there, and playing another [Field] Extra drops the one already out.",
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
      "The description is read with the target grammar, so only cards that qualify are offered — and the skill is not offered at all when none do. The stack keeps the position and the power effects of the card underneath.",
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
      "All three, with Absorb resolving its printed text like an ordinary skill rather than by names. Cards watching “when you activate a [Union] skill” fire at the activation, not at the choice that follows it.",
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
      "Offered from the Battle Area, and the swap happens. The choice is filtered by energy cost only — a [Swap] that names a character offers every cost-X Battle Card in hand, not just that character's.",
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
    meaning:
      "Drop any number of mono-green, mono-yellow or Green/Yellow Battle Cards from your Battle Area whose energy costs add up to exactly this card's printed cost, and play it from hand.",
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
    engine: "The play is blocked, with the card already out named as the reason. When two do end up in play the engine keeps the newest instead of asking which to keep — 21-11 gives that choice to the master.",
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
    meaning: "When you play this Unison Card over one whose colour matches, you may move up to Y markers from the Unison being replaced onto this one. An [Empower] naming no colour takes them from a Unison of any colour.",
    engine: "Read before the old Unison leaves play, because leaving clears its markers. The engine carries as many as it can rather than asking how many of the “up to Y” you want.",
    support: "partial",
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
    engine:
      "Only offered in the Defense Step, and only cards that can still be part of a set covering every named colour are offered — so a pick cannot dead-end after the orbs are already spent.",
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
    engine:
      "Counted by the deck checker, which marks a deck over four illegal. Nothing happens in a game beyond target descriptions that name it — “a blue non-[Super Combo] Battle Card”.",
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
    engine: "Offered in the counter window that follows the declaration.",
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
    body: "A “<br>” separates a card's skills. The options of a “Choose one—” belong to the line above them rather than being skills of their own, and a card printed without its “<br>” is split again where a sentence ends and a new skill tag opens — left joined, the second skill would be read as part of the first and never happen.",
  },
  {
    title: "Tags, then cost, then effect",
    body: "The brackets a line opens with are its tags: the skill type, the keyword, and any limit such as [Once per turn]. What follows is split at the first colon outside brackets into the cost and the effect. A keyword line whose whole body is orbs — “[Successor]{g}{y}” — is all cost, because the keyword's own rules are the effect.",
  },
  {
    title: "What the orbs mean",
    body: "{r} {u} {g} {y} {k} are red, blue, green, yellow and black — blue is u and black is k. {2} is that many orbs of any colour. {r}/{u} is one orb payable with either of the two named colours, which is not the same as one of any colour. A few sets print ③ for {3}, and it is normalised before anything reads it.",
  },
  {
    title: "The target grammar",
    body: "Descriptions such as “Blue <Baby> with an energy cost of 4 or less” or “yellow non-≪Great Ape≫ card” are read into a filter: colours, characters, traits, names, card type, energy cost, and keywords a card must or must not have. That is what lets [Evolve], [Union], [Swap], [Z-Stack] and [Z-Awaken] offer the right cards with no compiled program at all. A phrase the parser drops widens a selection rather than narrowing it, so it is written to refuse rather than to guess.",
  },
  {
    title: "Keywords that own their line",
    body: "For [Evolve], [Union], [Over Realm], [Swap], [Overlord], [Z-Awaken], [Z-Stack], [Field], [Dual Attack], [Revenge] and [Offering], the text after the tag is a condition or a description, not an effect — the keyword's own rules are the effect. The compiler leaves those lines alone instead of reading the description as a program.",
  },
  {
    title: "Read, stored, or put to the referee",
    body: "A skill counts as read only when every clause of it compiled. One clause the compiler cannot read sends the whole skill to the referee at runtime, which costs tokens, takes a moment and can be wrong. There are two ways to settle it for good: store a program for that one card, or explain the card in your own words so the wording becomes a work item for the compiler — the fix that covers every card phrased the same way.",
  },
  {
    title: "Only what it can pay for and resolve",
    body: "A skill is offered as an action only when the engine can both charge its cost and carry out its effect. That is why coverage is not the same as playability: a skill the compiler reads perfectly still does nothing until its price is one the engine can read too.",
  },
  {
    title: "Negating a keyword",
    body: "“Negate its keyword skills” means the keyword stops applying (22-1-3). A line that is nothing but keyword tags — “[Deflect][Triple Attack]” — is parsed as several skills, one per keyword, so a card can negate one of them without touching the other.",
  },
];
