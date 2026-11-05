/**
 * How unread card text is grouped, shared by the workbench and the CLIs.
 *
 * Two groupings: the *mechanism* a clause would need (a queue of delayed
 * effects is a different problem from a missing phrase pattern, and only the
 * first is a feature), and the *shape* of a clause with its numbers and names
 * blanked, so like wordings sit together. Plus the moments an [Auto] skill can
 * answer to, in words, for the record's WHEN line.
 */
import { autoTriggerMatches, keywordTriggers, momentPartSkills, triggeredPermanent } from "./text/triggers";
import type { Skill, Trigger } from "./types";

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
  playedFromHand: "when this card is played from your hand",
  playedFromDrop: "when this card is played from your Drop",
  attacks: "when this card attacks",
  attacked: "when this card is attacked",
  koed: "when this card is KO'd",
  kos: "when this card KOs a card",
  koedByAttack: "when this card is KO'd by an attack",
  yourCardKoedByAttack: "when one of your cards is KO'd by an attack",
  koedByOpponent: "when this card is KO'd by your opponent",
  koedBySkill: "when this card is KO'd by a skill",
  koedByYourSkill: "when this card is KO'd by one of your skills",
  koedByOpponentSkill: "when this card is KO'd by an opponent's skill",
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
  comboToDrop: "when a card in your Combo Area is placed in your Drop Area",
  comboUsed: "when you combo with this card",
  opponentPlayed: "when your opponent plays a card",
  opponentPlayedBySkill: "when your opponent uses a skill to play a card",
  youPlayed: "when you play a card",
  youPlayedByThisCard: "when your card is played by this card's skill",
  opponentAttacks: "when your opponent attacks",
  battleCardAttacks: "when a Battle Card attacks",
  aPlayerPlacesInBattle: "when a player places a card in a Battle Area",
  aPlayersCardLeftBattle: "when a player's card leaves a Battle Area",
  opponentEnergyActiveBySkill: "when your opponent switches your energy to Active Mode using a non-[Awaken] skill during their turn",
  opponentOwnEnergyActiveBySkill: "when your opponent switches their energy to Active Mode using a non-[Awaken] skill during their turn",
  selfRestToActive: "when this card is switched from Rest Mode to Active Mode",
  opponentOwnEnergyActiveByCounter: "when your opponent switches their energy to Active Mode using a [Counter] skill",
  opponentAttacksRedUnison2: "when your opponent attacks your red Unison Card with a specified cost of 2",
  opponentCombos: "when your opponent combos",
  youCombo: "when you combo",
  placed: "when this card is placed in a Battle Area",
  yourCardPlaced: "when a card is placed in your Battle Area",
  removedFromBattle: "when this card is removed from a Battle Area by a skill",
  removedByOpponent: "when this card is removed from a Battle Area by an opponent's skill",
  droppedFromBattle: "when a skill sends this card from a Battle Area to the Drop",
  droppedByOpponent: "when an opponent's skill sends this card from a Battle Area to the Drop",
  leftBattleToDrop: "when this card goes from a Battle Area to the Drop",
  zEnergyToDrop: "when this card goes from your Z-Energy to the Drop",
  yourCardRemovedByOpponent: "when one of your cards is removed from your Battle Area by an opponent's skill",
  yourCardAttacks: "when one of your cards attacks",
  opponentLifeToZBySkill: "when your skill adds your opponent's life to their Z-Energy",
  droppedFromHandByYou: "when one of your skills sends this card from your hand to the Drop",
  dropToWarpBySkill: "when a skill sends this card from your Drop to the Warp",
  droppedFromHandByUnion: "when a [Union] skill sends this card from your hand to the Drop",
  droppedFromHandByFusion: "when a [Union-Fusion] skill sends this card from your hand to the Drop",
  unionFusionActivated: "when you activate a [Union-Fusion] skill",
  unionAbsorbUsed: "when you activate a [Union-Absorb] skill",
  evolveActivated: "when you activate an [Evolve] skill",
  battleCardReturnedToHand: "when a card in a Battle Area is returned to its owner's hand",
  opponentCardPlayedBySkill: "when one of your opponent's cards is played by a skill",
  yourEnergyToDeck: "when your energy is placed in its owner's deck",
  yourCardPlayedFromHand: "when one of your cards is played from your hand",
  yourCardPlayedFromDrop: "when one of your cards is played from your Drop",
  opponentCardToZEnergy: "when one of your opponent's cards is added to their Z-Energy",
  yourCardToZEnergy: "when one of your cards is added to your Z-Energy",
  removedFromGame: "when this card is removed from the game",
  eitherCardPlayed: "when a card is played by either player",
  yourCardDealtDamage: "when one of your cards deals damage",
  yourCardDealtBattleDamage: "when one of your cards deals damage by attacking",
  dealtBattleDamage: "when this card deals damage in a battle",
  youTookBattleDamage: "when you take damage from an opponent's attack",
  youTookOpponentSkillDamage: "when you take damage from an opponent's skill",
  opponentTookBoardSkillDamage: "when your opponent takes damage from a skill on your Battle or Unison Cards",
  yourCardBlockerUsed: "when one of your cards activates [Blocker]",
  yourCardKos: "when one of your cards KOs an opponent's card",
  yourCardBattleToDrop: "when one of your cards goes from your Battle Area to the Drop",
  droppedFromHandByOpponent: "when an opponent's skill sends this card from your hand to the Drop",
  activeBySkill: "when this card is switched to Active Mode by a skill",
  yourEnergyActiveBySkill: "when your energy is switched to Active Mode by a skill",
  powerRaisedBySkill: "when this card's power is increased by a skill",
  powerLoweredBySkill: "when this card's power is decreased by a skill",
  yourCardPowerRaisedByYou: "when one of your skills increases the power of one of your cards",
  yourCardPowerLowered: "when the power of one of your cards is decreased",
  opponentCardPowerLowered: "when the power of one of your opponent's cards is decreased",
  opponentCardPowerLoweredByBattleCard: "when the skill of one of your Battle Cards decreases the power of an opponent's card",
  eitherCardPowerLowered: "when the power of a card of either player is decreased",
  deckToDropBySkill: "when a skill places this card from your deck in the Drop",
  deckToDropByYou: "when one of your skills places this card from your deck in the Drop",
  revealedTopToDrop: "when this card is revealed from the top of your deck and placed in the Drop",
  underReturnedToHand: "when a card under this card is returned to its owner's hand",
  underToDropBySkill: "when a skill places this card from under a card in the Drop",
  underLeaderToDropBySkill: "when a skill places this card from under a Leader in the Drop",
  pileToDropBySkill: "when a skill places a card from under this card in the Drop",
  energyToDropBySkill: "when a skill places this card from your energy in the Drop",
  yourEnergyToDropByYourLeader: "when your Leader's skill places one of your energy in the Drop",
  yourEnergyToDropByYou: "when one of your skills places one of your energy in the Drop",
  droppedFromBattleByYou: "when one of your skills sends this card from a Battle Area to the Drop",
  toDropBySkill: "when a skill places this card in the Drop",
  toDropByYou: "when one of your skills places this card in the Drop",
  toDropByOpponent: "when an opponent's skill places this card in the Drop",
  yourCardReturnedToHand: "when a card is returned from your Battle Area to its owner's hand",
  yourUnisonLeft: "when a Unison leaves your Unison Area",
  battleOrDeckToWarp: "when this card goes from your Battle Area or deck to the Warp",
  droppedFromHand: "when a skill sends this card from your hand to the Drop",
  yourLeaderAttacked: "when your Leader is attacked",
  youTookDamage: "when you take damage from a skill",
  opponentTookDamage: "when your opponent takes damage from a skill",
  lifeLeft: "when a card leaves your life",
  evolvedInto: "when a card evolves into this card",
  evolveFromHandActivated: "when you use this card's [Evolve] from your hand",
  opponentCounter: "when your opponent activates a [Counter] skill",
  opponentCounterPlay: "when your opponent activates a [Counter: Play] skill",
  opponentCounterAttack: "when your opponent activates a [Counter: Attack] skill",
  counterFreeFromHand: "when you activate this card's [Counter] from your hand without paying its energy cost",
  opponentMainStart: "at the start of your opponent's Main Phase",
  blockerUsed: "when this card activates [Blocker]",
  restedByAlliance: "when this card is rested by an [Alliance] skill",
  addedToZEnergy: "when this card is added to your Z-Energy",
  energyToDrop: "when a card goes from your energy to the Drop",
  unisonToDrop: "when your Unison goes to the Drop",
  removedFromUnison: "when this card is removed from a Unison Area",
  markerRemoved: "when a marker is removed from this card",
  restedBySkill: "when this card is rested by one of your skills",
  restedByAnySkill: "when this card is rested by a skill",
  restedByOpponentSkill: "when this card is rested by your opponent's skill",
  placedInEnergy: "when this card is placed in your energy",
  placedInEnergyFromHand: "when this card is placed in your energy from your hand",
  restedTheirsBySkill: "when your skill rests an opponent's card",
  hiddenBySkill: "when this card is switched to Hidden Mode by one of your skills",
  hiddenToDrop: "when this card goes from a Battle Area to the Drop in Hidden Mode",
  switchedRevealed: "when this card is switched to Revealed Mode",
  switchedHidden: "when this card is switched to Hidden Mode",
  placedUnder: "when this card is placed under a card",
  deckOrHandToDrop: "when this card goes from your deck or hand to the Drop",
  deckToWarpBySkill: "when one of your skills sends this card from your deck to the Warp",
  unionActivated: "when you activate a [Union] skill",
  unionAbsorbActivated: "when this card's [Union-Absorb] is activated",
  overlordActivated: "when you activate an [Overlord] skill",
  overRealmPlayed: "when you play a card using [Over Realm]",
  selfExtraActivated: "when you activate this Extra Card",
  extraActivatedFromHand: "when you activate an Extra Card from your hand",
  extraActivated: "when you activate an Extra Card",
  playedUsingOverRealm: "when this card is played using [Over Realm]",
  playedUsingDarkOverRealm: "when this card is played using [Dark Over Realm]",
  spiritBoostPaid: "when you pay a [Spirit Boost] cost from this card",
  flippedFaceUp: "when a card in your life is flipped face up",
  offenseStart: "at the start of the offense step",
  defenseStart: "at the start of the defense step",
  damageStart: "at the start of the damage step",
  yourCardRemovedBySkill: "when one of your cards is removed from a Battle Area by a skill",
  opponentCardRemovedBySkill: "when one of your opponent's cards is removed from a Battle Area by a skill",
  yourCardKoedByOpponentSkill: "when one of your cards is KO'd by an opponent's skill",
  yourCardKoedByYourSkill: "when one of your cards is KO'd by one of your skills",
  opponentCardKoedByYourSkill: "when one of your opponent's cards is KO'd by one of your skills",
  yourCardKoedByOpponent: "when one of your cards is KO'd by your opponent",
  yourCardKosByAttack: "when one of your cards attacks and KOs an opponent's Battle Card",
  yourCardAttacked: "when one of your cards is attacked",
  yourUnisonToDrop: "when one of your Unison Cards is placed in your Drop Area from your Unison Area",
  yourCardLeftBattle: "when one of your cards leaves a Battle Area",
  yourCardPlayedFromWarp: "when one of your cards is played from your Warp",
  yourCardPlayedFromEnergy: "when one of your cards is played from your Energy Area",
  yourCardPlayedFromLife: "when one of your cards is played from your Life Area",
  yourBattleCardRestedBySkill: "when one of your Battle Cards is switched to Rest Mode by a skill",
  opponentBattleCardRestedBySkill: "when one of your opponent's Battle Cards is switched to Rest Mode by a skill",
  opponentCardRestedByYourSkill: "when one of your opponent's cards is switched to Rest Mode by one of your skills",
  yourCardExEvolveFromHand: "when one of your cards activates [EX-Evolve] from your hand",
  swapActivated: "when you activate a [Swap] skill",
  aegisActivated: "when this card activates [Aegis]",
  awakenActivated: "when your Leader uses [Awaken]",
  wishActivated: "when your Leader uses [Wish]",
  darkOverRealmActivated: "when you use [Dark Over Realm]",
  rejuvenateActivated: "when you use [Rejuvenate]",
  opponentBlockerUsed: "when your opponent uses [Blocker]",
  youCounter: "when you use a [Counter]",
  yourCardExEvolveFromZEnergy: "when you use [EX-Evolve] from your Z-Energy",
  placedUnderFromHand: "when this card goes under a card from your hand",
  placedUnderFromDrop: "when this card goes under a card from your Drop",
  placedUnderFromBattle: "when this card goes under a card from a Battle Area",
  placedUnderFromZEnergy: "when this card goes under a card from your Z-Energy",
  placedUnderFromCombo: "when this card goes under a card from your Combo Area",
  toWarp: "when this card goes to the Warp",
  battleToWarp: "when this card goes from a Battle Area to the Warp",
  toWarpBySkill: "when a skill sends this card to the Warp",
  zDeckToZEnergy: "when this card goes from your Z-Deck to your Z-Energy",
  battleToHand: "when this card returns from a Battle Area to the hand",
  faceUpLifeToDrop: "when this face-up life card goes to the Drop",
  yourLifeToHand: "when a life card goes to your hand",
  yourLifeToHandOrDrop: "when a life card goes to your hand or Drop",
  opponentLifeToHandOrDrop: "when an opponent's life card goes to their hand or Drop",
  opponentLifeToDrop: "when an opponent's life card goes to their Drop",
  yourEnergyToZEnergy: "when your energy goes to your Z-Energy",
  opponentCardToWarp: "when an opponent's card goes to the Warp",
  opponentHandToWarpByYou: "when your skill sends a card from their hand to the Warp",
  opponentDropToWarpByYou: "when your skill sends a card from their Drop to the Warp",
  yourDeckToDrop: "when a card goes from your deck to your Drop",
  eitherBattleToDrop: "when a card goes from a Battle Area to a Drop",
  opponentExtraActivated: "when your opponent activates an Extra",
  yourCardComboToDrop: "when one of your cards goes from your Combo Area to your Drop",
};
export const TRIGGERS = Object.keys(TRIGGER_IN_WORDS) as Trigger[];

/**
 * Audit triggers 1: a head that coordinates moments ("When this card attacks or is attacked") answers to each of them,
 * read one by one (`momentPartSkills`). The readers of the whole head already place some pairs ("played or attacks",
 * "attacks or activates [Blocker]"); where they place fewer moments than the head says, the moments said one by one
 * are what it answers to, and a moment no reader places alone is `unreadMoments`'. The whole head's own reading is
 * then dropped: it was made of the coordinated words, so what it adds is wrong — "When this card is played from your
 * hand or at the end of a battle in which…" (BT16-131) answered every play.
 */
function coordinated(sk: Skill, whole: Trigger[]): { each: Trigger[][]; parts: Skill[] } | null {
  const parts = momentPartSkills(sk);
  if (!parts || whole.length >= parts.length) return null;
  return { parts, each: parts.map((p) => TRIGGERS.filter((t) => autoTriggerMatches(p, t))) };
}

/** The moments an [Auto] skill answers to. Empty for a skill that names a moment the engine does not know — the orphan `arena:gaps` counts. */
export function triggersOf(sk: Skill): Trigger[] {
  if (sk.kind !== "auto" && !sk.keyword && !triggeredPermanent(sk)) return [];
  const whole = TRIGGERS.filter((t) => autoTriggerMatches(sk, t) || keywordTriggers(sk, t));
  const more = coordinated(sk, whole);
  return more ? TRIGGERS.filter((t) => more.each.some((e) => e.includes(t))) : whole;
}

/** Audit triggers 1: does this skill answer to moments the readers of its whole head do not place (read one by one)? */
export function readsMomentsOneByOne(sk: Skill): boolean {
  if (sk.kind !== "auto") return false;
  return coordinated(sk, TRIGGERS.filter((t) => autoTriggerMatches(sk, t) || keywordTriggers(sk, t))) !== null;
}

/** Audit triggers 1: the moments of a coordinated head that no reader places, as printed (lower case) — the compiler leaves such a skill unread rather than answer half of it. */
export function unreadMoments(sk: Skill): string[] {
  if (sk.kind !== "auto") return [];
  const whole = TRIGGERS.filter((t) => autoTriggerMatches(sk, t) || keywordTriggers(sk, t));
  const more = coordinated(sk, whole);
  return more ? more.parts.filter((_, i) => !more.each[i].length).map((p) => p.effect.replace(/, \.$/, "")) : [];
}

/** The WHEN line: "when this card attacks or when this card is attacked". */
export function describeTrigger(triggers: readonly string[]): string {
  return triggers.map((t) => TRIGGER_IN_WORDS[t as Trigger] ?? t).join(" or ");
}
