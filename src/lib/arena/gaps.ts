/**
 * How unread card text is grouped, shared by the workbench and the CLIs.
 *
 * Two groupings: the *mechanism* a clause would need (a queue of delayed
 * effects is a different problem from a missing phrase pattern, and only the
 * first is a feature), and the *shape* of a clause with its numbers and names
 * blanked, so like wordings sit together. Plus the moments an [Auto] skill can
 * answer to, in words, for the record's WHEN line.
 */
import { autoTriggerMatches, keywordTriggers } from "./engine/triggers";
import type { Skill, Trigger } from "./engine/types";

/** Ordered: the first bucket a clause matches wins, so put the specific first. */
export const MECHANISMS: { key: string; needs: string; test: RegExp }[] = [
  {
    key: "delayed effect",
    needs: "a queue of effects that fire at a later timing (1-7-2-1-1)",
    test: /\bat the (?:end|start|beginning) of (?:your|the|their|this|your opponent's)\b|\bduring your (?:next|opponent's)\b|\buntil (?:the )?(?:end|start)\b|\bnext turn\b/,
  },
  { key: "replacement effect", needs: "replacing an event with another before it happens (9-10)", test: /\binstead\b|\bwould (?:be|leave|deal|receive|go)\b/ },
  { key: "prohibition", needs: "continuous rules that forbid an action (20-14)", test: /\bcan'?t\b|\bcannot\b|\bunable to\b|\bmay not\b/ },
  { key: "modal choice", needs: "choose one of several printed options (20-2)", test: /choose one[-—―]|・/ },
  { key: "count-based amount", needs: 'a number read off the board ("for each …")', test: /\bfor each\b|\bequal to the number\b|\btimes the number\b|\bx is\b/ },
  { key: "cards under cards", needs: "a real under-stack, not a move to the Drop (23-2)", test: /\bunder (?:this|that|the) card\b|\bplace it on top of\b|\bfrom under\b/ },
  {
    key: "static in other areas",
    needs: "permanent skills that hold outside the Battle Area (9-1-3-3)",
    test: /\bin all areas\b|\bin your hand\b.*\bgets?\b|\bwhile (?:this|you)\b|\bduring your turn\b|\bduring your opponent's turn\b/,
  },
  { key: "cost change", needs: "raising or lowering a cost as a continuous effect (20-21)", test: /\b(?:reduce|increase|add) (?:the )?(?:energy |combo |skill )?cost\b|\bcosts? \d+ (?:more|less)\b/ },
  { key: "targeting protection", needs: '"unaffected by skills" beyond [Barrier] (20-4)', test: /\bunaffected by\b|\bnot affected by\b|\bignoring\b/ },
  { key: "reveal / look at", needs: "showing cards to a player and acting on what is seen (20-11)", test: /\breveal\b|\blook at\b|\bshow\b/ },
  { key: "search a secret area", needs: "choosing from deck or life with the reveal rules (20-12)", test: /\bfrom your deck\b|\bin your life\b|\bfrom your life\b/ },
  {
    key: "keyword not implemented",
    needs: "one of the §22 keywords the engine does not carry out",
    test: /\[(?:aegis|alliance|arrival|revive|successor|rejuvenate|spirit boost|empower|invoker|heroic|villainous|burst|bond|sparking|barrier|deflect|energy-exhaust)\b/i,
  },
  { key: "skill negation", needs: "negating a named kind of skill, not all of them (9-1-5)", test: /\bnegate\b/ },
  // Only clauses that actually *do* something to energy. Merely naming an
  // energy cost is a phrasing problem, and lumping the two together inflates
  // this bucket well beyond its real size.
  {
    key: "energy manipulation",
    needs: "moving and re-orienting energy as an effect (3-8)",
    test: /\b(?:of|in|to|from|into) your (?:opponent's )?energy\b|\benergy (?:area|marker)\b|\bas energy\b|\benergy to (?:active|rest) mode\b/,
  },
  // "skips their next Charge Phase" is the commonest way a card says this, and
  // `\bskip\b` does not match "skips" — those clauses were counted as phrasing.
  { key: "turn structure", needs: "skipping or adding phases and turns (20-13)", test: /\bskips?\b|\bextra turn\b|\banother turn\b/ },
];

export const PHRASING_ONLY = "phrasing only";
const PHRASING_NEEDS = "a phrase pattern in the compiler, no new mechanism";

/** The first mechanism a clause names, or "phrasing only" when it names none. */
export function mechanismOf(clause: string): string {
  const low = clause.toLowerCase();
  return MECHANISMS.find((m) => m.test.test(low))?.key ?? PHRASING_ONLY;
}

/** What building a mechanism would take, for the record's right pane. */
export function mechanismNeeds(key: string): string {
  return MECHANISMS.find((m) => m.key === key)?.needs ?? PHRASING_NEEDS;
}

/** A clause's shape: numbers and names blanked, so like wordings group together. */
export function clauseShape(clause: string): string {
  return clause
    .toLowerCase()
    .replace(/<[^>]*>|\{[^}]*\}|≪[^≫]*≫/g, "…")
    .replace(/\d[\d,]*/g, "N")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every moment the engine knows about, in the words a card would use for it. */
const TRIGGER_IN_WORDS: Record<Trigger, string> = {
  leaderPlaced: "when your Leader is placed",
  played: "when this card is played",
  attacks: "when this card attacks",
  attacked: "when this card is attacked",
  koed: "when this card is KO'd",
  kos: "when this card KOs a card",
  yourCardKoed: "when one of your cards is KO'd",
  opponentCardKoed: "when an opponent's card is KO'd",
  dealtDamage: "when this card deals damage",
  chargeStart: "at the start of your Charge Phase",
  mainStart: "at the start of your Main Phase",
  mainEnd: "at the end of your Main Phase",
  turnEnd: "at the end of your turn",
  opponentTurnEnd: "at the end of your opponent's turn",
  opponentTurnStart: "at the start of your opponent's turn",
  battleEnd: "at the end of the battle",
  comboed: "when this card is used in a combo",
  opponentPlayed: "when your opponent plays a card",
  youPlayed: "when you play a card",
  opponentAttacks: "when your opponent attacks",
  opponentCombos: "when your opponent combos",
  youCombo: "when you combo",
  placed: "when this card is placed in a Battle Area",
  removedFromBattle: "when this card is removed from a Battle Area by a skill",
  removedByOpponent: "when this card is removed from a Battle Area by an opponent's skill",
  droppedFromBattle: "when a skill sends this card from a Battle Area to the Drop",
  leftBattleToDrop: "when this card goes from a Battle Area to the Drop",
  yourLeaderAttacked: "when your Leader is attacked",
  youTookDamage: "when you take damage from a skill",
  opponentTookDamage: "when your opponent takes damage from a skill",
  lifeLeft: "when a card leaves your life",
  evolvedInto: "when a card evolves into this card",
  opponentCounter: "when your opponent activates a [Counter] skill",
  opponentMainStart: "at the start of your opponent's Main Phase",
  blockerUsed: "when this card activates [Blocker]",
  restedByAlliance: "when this card is rested by an [Alliance] skill",
  addedToZEnergy: "when this card is added to your Z-Energy",
  energyToDrop: "when a card goes from your energy to the Drop",
  unisonToDrop: "when your Unison goes to the Drop",
  markerRemoved: "when a marker is removed from this card",
  restedBySkill: "when this card is rested by one of your skills",
  restedTheirsBySkill: "when your skill rests an opponent's card",
  unionActivated: "when you activate a [Union] skill",
  overlordActivated: "when you activate an [Overlord] skill",
  overRealmPlayed: "when you play a card using [Over Realm]",
  spiritBoostPaid: "when you pay a [Spirit Boost] cost from this card",
  flippedFaceUp: "when a card in your life is flipped face up",
  offenseStart: "at the start of the offense step",
  defenseStart: "at the start of the defense step",
  damageStart: "at the start of the damage step",
};
export const TRIGGERS = Object.keys(TRIGGER_IN_WORDS) as Trigger[];

/** The moments an [Auto] skill answers to. Empty for a skill that names a moment the engine does not know — the orphan `arena:gaps` counts. */
export function triggersOf(sk: Skill): Trigger[] {
  if (sk.kind !== "auto" && !sk.keyword) return [];
  return TRIGGERS.filter((t) => autoTriggerMatches(sk, t) || keywordTriggers(sk, t));
}

/** The WHEN line: "when this card attacks or when this card is attacked". */
export function describeTrigger(triggers: readonly string[]): string {
  return triggers.map((t) => TRIGGER_IN_WORDS[t as Trigger] ?? t).join(" or ");
}
