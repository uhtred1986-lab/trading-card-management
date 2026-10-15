import type { Snapshot } from "@/lib/arena/snapshot";
import type { Action, PlayerId } from "@/lib/arena/types";

export const CURRICULUM_VERSION = "masters-first-match:1.0.0";
export const LESSONS = [
  {
    "id": "intro.goal",
    "anchor": "Leader card and match objective; anchor the actual Leader area and match status.",
    "copy": "Welcome to the World Tournament! Your Leader is the star of your team. Keep your Leader in the game and reduce your opponent’s Life to zero to win. In this match, we’ll learn one turn and one battle together.",
    "evidence": "Screen acknowledged, or opening skipped.",
    "recovery": "Want to see this again? Replay the welcome from Lessons.",
    "why": "A full game can end in different ways. We’ll practice battle damage today; other victory and loss conditions are a later lesson."
  },
  {
    "id": "intro.zones",
    "anchor": "Hand, Life, deck and discard/Drop areas on the actual board.",
    "copy": "Your hand is what you can choose from. Life is face-down protection. Your deck is where new cards come from. When a card is spent, it often goes to the Drop Area.",
    "evidence": "Screen acknowledged or skipped.",
    "recovery": "Point to your hand, Life, and deck on the board. You can replay this screen any time.",
    "why": "A regular Masters game starts with eight cards in Life. This practice match starts with three so we can finish sooner."
  },
  {
    "id": "intro.numbers",
    "anchor": "Cost, battle power and combo power shown on the actual training card face/inspector.",
    "copy": "These numbers do different jobs. Cost is what you pay to play a card. Power helps decide a battle. Combo power is extra battle power when you use a card in a combo.",
    "evidence": "Screen acknowledged or skipped; do not require opening a card.",
    "recovery": "Tap a card to inspect it. Look for the cost and the two power numbers.",
    "why": "A card’s printed power and combo power are separate values. The rules describe them separately in sections 2-7 and 2-8."
  },
  {
    "id": "intro.energy",
    "anchor": "Active and rested Energy Area cards, with their real orientation/status.",
    "copy": "Ready energy can pay a cost. Rested energy has been used for now. At the start of your turn, your rested cards become ready again.",
    "evidence": "Screen acknowledged or skipped.",
    "recovery": "Find one ready energy card. The board shows whether each energy is ready or rested.",
    "why": "The rules call these Active Mode and Rest Mode. The Charge Phase switches rested cards to active."
  },
  {
    "id": "intro.ready",
    "anchor": "The real turn/phase indicator and lesson guidance control.",
    "copy": "You’ll make the choices. I’ll point out what the board means. Use the guidance control whenever you like: turn hints off, or turn them back on. You can replay a lesson, too. Ready? Let’s play!",
    "evidence": "Screen acknowledged or skipped; begin the tutorial scenario.",
    "recovery": "No rush. Skip the opening now and replay it from Lessons whenever you like.",
    "why": "The match uses the Masters rules engine. The training cards are simplified so the lesson can focus on turns and battles."
  },
  {
    "id": "t1.charge",
    "anchor": "Real Charge Phase and hand-to-Energy Area action.",
    "copy": "You may charge one card from your hand as energy, or keep every card. Which card could you spare? You can also choose not to charge.",
    "evidence": "Session records a charge or the phase advances with no charge. Merely clicking a card is not completion.",
    "recovery": "Changed your mind? Before confirming, choose a different card or cancel. Keeping your hand is a real choice.",
    "why": "You may place one card from hand in your Energy Area during your Charge Phase. Charging is optional."
  },
  {
    "id": "t1.affordability",
    "anchor": "Prediction anchored to visible energy count and the real card inspector.",
    "copy": "Quick prediction: this red card costs 1. You have [N] ready red energy. Can you pay its cost right now?",
    "evidence": "Prediction answer recorded separately from gameplay; retry or skip is allowed. No action or phase change occurs.",
    "recovery": "Yes feedback when [N] is at least 1: You have enough ready red energy to pay this red cost of 1. No feedback when [N] is 0: You do not have a ready red energy to pay this red cost. Rested energy cannot pay right now. Retry or skip.",
    "why": "Card cost is paid by switching the required energy to Rest Mode. The normal play flow confirms the payment before the card is played."
  },
  {
    "id": "t1.play",
    "anchor": "Actual hand card, card inspector, existing play/review and payment confirmation UI.",
    "copy": "Inspect the one-cost Battle Card. Read its text, then play it through the board’s normal controls if you want to spend one energy.",
    "evidence": "Engine/session confirms the selected card entered play and its actual payment resolved; the follow-up uses that payment evidence.",
    "recovery": "Not that card? Close the inspector and choose another legal card. You can also leave it in your hand and continue.",
    "why": "A Battle Card can normally attack on the turn it is played, if it is Active and the attack is legal. There is no general wait-a-turn rule. Card text or effects can make exceptions."
  },
  {
    "id": "t1.first-turn",
    "anchor": "Turn indicator and hand/deck/attack controls.",
    "copy": "You went first. On your first turn, you do not draw a card, and you cannot attack. You can still play cards and make other legal choices.",
    "evidence": "The first player’s first turn is established by the scenario; acknowledgement does not mutate the game.",
    "recovery": "If you expected a draw or an attack, that’s okay. The first-turn rule is the reason those choices are unavailable.",
    "why": "Rules 7-2-9-1 and 7-3-4-4-1 make these two first-turn exceptions."
  },
  {
    "id": "t1.end",
    "anchor": "Existing Main Phase end control, not Pass.",
    "copy": "When you’re ready, end your Main Phase with the board’s end-phase control. Pass declines the current prompt, such as a charge choice, or ends a response window when the board offers it. It does not end your turn.",
    "evidence": "Session phase advances through its normal engine transition.",
    "recovery": "Still deciding? Inspect your hand and board. You may play any other legal card first.",
    "why": "A turn has phases and steps. Pass responds to the current prompt or response window when the engine offers it; use the actual Main Phase control to finish the phase."
  },
  {
    "id": "opp.observe",
    "anchor": "Opponent’s Charge Phase, actual Energy Area, play/payment and board.",
    "copy": "Watch the other player’s turn. Their rested cards become ready. They draw, then may charge one card. See what they choose to play and how they pay.",
    "evidence": "Session events show refresh, draw where applicable, charge choice, and card play/payment.",
    "recovery": "Missed a change? Replay the turn summary from the event log, then continue.",
    "why": "At the start of their turn, their rested cards become active. The turn player draws except on the first player’s first turn, then may charge one card."
  },
  {
    "id": "opp.attack-predict",
    "anchor": "Battle banner/attacker and defender power from actual board.",
    "copy": "The opponent is attacking! Before the battle finishes, predict: will the attack deal damage, or will it be stopped?",
    "evidence": "Answer recorded without advancing the battle. Feedback explains the result shown by the actual final totals, including that equal power favors the attacker.",
    "recovery": "Look at both power totals. You can try again or skip; your answer will not spend a card.",
    "why": "Combo power is added before the power comparison. If the attacker’s total is equal to or greater than the guard’s, the attack succeeds."
  },
  {
    "id": "opp.defend",
    "anchor": "Real Defense Step and legal combo cards in hand; standard combo UI.",
    "copy": "It’s your Defense Step. You may use a card from your hand in a combo to raise your Leader’s power. Want to try one, or defend without a combo?",
    "evidence": "Combo action is confirmed and card enters Combo Area, or the learner ends the Defense Step with no combo.",
    "recovery": "Only a card with combo cost and combo power can be used. You can inspect it, cancel before confirming, or choose to do nothing.",
    "why": "A combo card adds its combo power in this battle. The card is spent from your hand and goes to the Drop Area after the battle unless you choose the real Z-Energy option."
  },
  {
    "id": "opp.tie",
    "anchor": "Battle resolution and final power totals.",
    "copy": "Compare the final power totals. Equal power favors the attacker. The board shows whether the attack succeeded and what moved.",
    "evidence": "Engine resolves battle; if Leader is guard and damage occurs, session event records Life-to-hand. If the guard is a Battle Card, use its actual outcome instead.",
    "recovery": "Compare the final totals after combos. Equal power counts as enough for the attacker.",
    "why": "Rule 8-4-6 says the attacker succeeds when its power is greater than or equal to the guard’s power. A Battle Card guard is KO’d on a successful battle; it does not take Life damage."
  },
  {
    "id": "t2.refresh",
    "anchor": "Turn/Charge Phase indicator and actual ready energy/deck/hand.",
    "copy": "Your turn! Your rested cards become ready. Draw one card, then look at your hand. Now you can plan with what you have.",
    "evidence": "Engine turn transition, refresh and applicable draw event.",
    "recovery": "Compare the board before and after the turn change. The lesson log can show what changed.",
    "why": "The first player’s no-draw exception only applies to that player’s first turn."
  },
  {
    "id": "t2.charge",
    "anchor": "Actual hand and Charge Phase choice.",
    "copy": "You may charge one card again, or keep your hand. Think about the cards you might want to play before you choose.",
    "evidence": "Confirmed charge or phase transition without a charge.",
    "recovery": "You can decline. If you charge, pick a card you are willing to spend as energy.",
    "why": "Charging adds one card to your Energy Area; it also removes that card from your choices in hand."
  },
  {
    "id": "t2.attack-target",
    "anchor": "Active Leader/Battle Card controls and legal targets surfaced by the engine.",
    "copy": "Choose an Active attacker. You may attack the opposing Leader or Unison, or a Battle Card in Rest Mode. Choose a target the board says is legal. If your screen shows an attack confirmation, read it before confirming.",
    "evidence": "Engine accepts attack and target through the board’s normal input flow.",
    "recovery": "An Active attacker can’t attack an Active Battle Card. If a target is unavailable, choose another legal target or cancel.",
    "why": "The normal rule lets an Active Leader, Battle Card or Unison attack a Leader or Unison, or a rested Battle Card. Card text and effects can change what is legal."
  },
  {
    "id": "t2.offense-combo",
    "anchor": "Existing Offense Step controls and legal combo selection.",
    "copy": "Before you finish the Offense Step, you may add a combo card to your attack. It leaves your hand and adds its combo power. Want to use one, or continue without it?",
    "evidence": "Combo commitment is confirmed and reported by the session, or the turn player ends the Offense Step without one.",
    "recovery": "You can cancel before confirming, choose another legal combo, or continue without a combo.",
    "why": "During a battle, the real engine may offer to place one combo card in its owner’s Z-Energy at Battle End. If that choice appears, read it and choose there. Otherwise combo cards go to the Drop Area."
  },
  {
    "id": "t2.resolve",
    "anchor": "Actual Defense Step, final battle power, Damage Step and Life/Drop outcome.",
    "copy": "The defender gets a chance to respond. Then the game compares final power. If your attack succeeds against the Leader, Life moves to the defender’s hand. Watch the real board resolve it.",
    "evidence": "Engine records the response window ending, battle resolution, and any Life or Battle Card result.",
    "recovery": "The attacker must meet or beat the guard’s final power. If it does not, no battle result is applied. Check the final totals and the board’s result.",
    "why": "The battle has Offense, Defense, Damage and Battle End steps. Combos are added before comparing power; at equal power the attacker succeeds."
  },
  {
    "id": "changed-board.predict",
    "anchor": "New board state and actual session guidance control.",
    "copy": "The board has changed. Before I give a hint, what would you do next? Choose your own next move, or skip this question.",
    "evidence": "Prediction captured before any hint is displayed. The existing guidance on/off control remains available throughout the lesson.",
    "recovery": "There may be more than one good choice. Pick a legal move, or skip. Your answer does not spend an action.",
    "why": "Turn hints off to think for yourself, or turn them on if you want a pointer. You can switch either way and replay lessons later."
  },
  {
    "id": "wrapup",
    "anchor": "Match status, Life totals and lesson replay/help controls.",
    "copy": "Great battle! This short practice match began with three Life cards. A regular Masters game begins with eight. You can replay any lesson. A player also loses if their Life or deck runs out, or if a card effect says they lose. Conceding ends a game, too. Special skills and card-by-card exceptions are lessons for another day.",
    "evidence": "Tutorial completion recorded after the scenario reaches its scripted end or the learner exits.",
    "recovery": "The match can end before this point if a real win or loss condition is reached. You can restart the practice match from the tutorial menu.",
    "why": "Awakening is printed on particular Leaders and follows that card’s own text and conditions. This simplified Leader does not teach Awakening. Advanced skills and other win/loss conditions belong in later lessons."
  }
] as const;
export type LessonId = typeof LESSONS[number]["id"];
export interface LearningProgress {
  version: typeof CURRICULUM_VERSION;
  revision: number;
  completed: string[];
  skipped: string[];
  predictions: Record<string, string>;
  ownTurns: number;
  lastTurn: number;
  defended: boolean;
  attacked: boolean;
  ownBattleResolved: boolean;
  payment: string | null;
  outcome: string | null;
}
export function initialProgress(): LearningProgress {
  return { version: CURRICULUM_VERSION, revision: -1, completed: [], skipped: [], predictions: {}, ownTurns: 1, lastTurn: -1, defended: false, attacked: false, ownBattleResolved: false, payment: null, outcome: null };
}
export type LearningEvent = { type: "transition"; action: Action; actor: PlayerId; before: Snapshot; after: Snapshot } | { type: "skip"; id: string } | { type: "prediction"; id: string; answer: string } | { type: "acknowledge"; id: string };
/** Accepted engine transitions alone establish gameplay evidence. Teaching answers never mutate a match. */
export function lessonReducer(state: LearningProgress, event: LearningEvent): LearningProgress {
  if (event.type === "skip") return { ...state, skipped: [...new Set([...state.skipped, event.id])] };
  if (event.type === "prediction") return { ...state, predictions: { ...state.predictions, [event.id]: event.answer } };
  if (event.type === "acknowledge") {
    if (!event.id.startsWith("intro.") && !["t1.first-turn", "wrapup"].includes(event.id)) return state;
    return { ...state, completed: [...new Set([...state.completed, event.id])] };
  }
  const { before, after, action, actor } = event;
  if (after.game.id !== before.game.id || after.game.revision <= before.game.revision || after.game.revision <= state.revision) return state;
  const next = { ...state, revision: after.game.revision, completed: [...state.completed] };
  const done = (id: string) => { if (!next.completed.includes(id)) next.completed.push(id); };
  const own = actor === after.view.you.player;
  if (after.view.turnPlayer === after.view.you.player && before.view.turnPlayer !== after.view.turnPlayer && after.view.turn !== state.lastTurn) {
    next.ownTurns++; next.lastTurn = after.view.turn; done("t2.refresh");
  }
  if (own && action.type === "charge") done(next.ownTurns > 1 ? "t2.charge" : "t1.charge");
  if (own && action.type === "play" && after.view.you.battle.some(c => c.id === action.card) && !before.view.you.battle.some(c => c.id === action.card)) {
    done("t1.play");
    const rested = after.view.you.energy.filter(c => c.mode === "rest" && before.view.you.energy.some(b => b.id === c.id && b.mode === "active"));
    next.payment = rested.length ? `${rested.length} energy rested: ${rested.map(c => c.name).join(", ")}.` : "No energy rested for this play.";
  }
  if (own && action.type === "endMain") done("t1.end");
  if (!own && action.type === "attack") done("opp.observe");
  const defending = before.view.battle && before.view.turnPlayer !== before.view.you.player && before.view.battle.step === "defense";
  if (own && defending && (action.type === "combo" || action.type === "pass")) { next.defended = true; done("opp.defend"); }
  if (own && action.type === "attack") { next.attacked = true; done("t2.attack-target"); }
  if (own && before.view.battle?.step === "offense" && (action.type === "combo" || action.type === "pass")) done("t2.offense-combo");
  const beats = after.beats?.list.filter(b => b.n > (before.beats?.seq ?? 0)) ?? [];
  for (const beat of beats) if (beat.t === "clash") {
    next.outcome = `${beat.attackPower} attack against ${beat.guardPower} defense. ${beat.attackPower === beat.guardPower ? "The attacker wins a tie. " : ""}${beat.hit ? "The attack succeeds." : "The attack does not succeed."}`;
    if (before.view.turnPlayer === before.view.you.player && next.attacked) { next.ownBattleResolved = true; done("t2.resolve"); } else done("opp.tie");
  }
  return next;
}
export function currentLesson(progress: LearningProgress, snapshot?: Snapshot): typeof LESSONS[number] {
  const available = LESSONS.filter(l => !l.id.startsWith("intro.") && (progress.ownTurns > 1 ? !l.id.startsWith("t1.") : !l.id.startsWith("t2.") && !["changed-board.predict", "wrapup"].includes(l.id)));
  const relevant = !snapshot ? available : snapshot.view.turnPlayer !== snapshot.view.you.player
    ? available.filter(l => l.id.startsWith("opp.") && (snapshot.view.battle || l.id !== "opp.attack-predict" && l.id !== "opp.defend"))
    : available.filter(l => progress.ownTurns > 1 ? l.id.startsWith("t2.") || l.id === "changed-board.predict" : l.id.startsWith("t1."));
  return relevant.find(l => !progress.completed.includes(l.id) && !progress.skipped.includes(l.id) && !(l.id in progress.predictions)) ?? (snapshot?.view.over ? LESSONS[LESSONS.length - 1] : LESSONS.find(l => l.id === (progress.ownTurns > 1 ? "t2.attack-target" : "t1.end"))!);
}
export function handoffReady(progress: LearningProgress): boolean {
  return progress.ownTurns >= 2 && (progress.defended || progress.skipped.includes("opp.defend")) && progress.ownBattleResolved;
}
