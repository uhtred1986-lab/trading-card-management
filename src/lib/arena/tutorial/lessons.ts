import type { Snapshot } from "@/lib/arena/snapshot";
import type { Action, PlayerId } from "@/lib/arena/types";

export const CURRICULUM_VERSION = "masters-first-match:2.0.0";
export const LESSONS = [
  {
    "id": "intro.goal",
    "anchor": "Leader card and match objective; anchor the actual Leader area and match status.",
    "copy": "Welcome! You’re playing Son Goku against Frieza with real cards from Galactic Battle, the first Masters release. Each player starts with eight Life. Reduce Frieza’s Life to zero to win. I’ll guide your first turns, then you can finish on your own.",
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
    "why": "This match uses two 50-card teaching decks built from real BT1 cards, not a sealed starter product. Both players start with the usual eight Life."
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
    "copy": "Charge a card from your hand into your Energy Area. It stays there: rest it to pay a cost, then ready it again at the start of your turn. Charging does not send it to Drop.",
    "evidence": "Screen acknowledged or skipped.",
    "recovery": "Find one ready energy card. The board shows whether each energy is ready or rested.",
    "why": "The rules call these Active Mode and Rest Mode. The Charge Phase switches rested cards to active."
  },
  {
    "id": "intro.ready",
    "anchor": "The real turn/phase indicator and lesson guidance control.",
    "copy": "Goku has Double Strike: a successful Leader hit deals two damage. Both Leaders can Awaken at four Life or less; read their new side when they flip. Every printed ability is active. You make the choices, and can turn hints off anytime.",
    "evidence": "Screen acknowledged or skipped; begin the tutorial scenario.",
    "recovery": "No rush. Skip the opening now and replay it from Lessons whenever you like.",
    "why": "These are actual Masters cards and abilities. Card text can change the normal rules. Use the board’s card review and legal choices; nothing is replaced with a tutorial-only action."
  },
  {
    "id": "t1.charge",
    "anchor": "Real Charge Phase and hand-to-Energy Area action.",
    "copy": "Charge moves a hand card to Energy, where it stays to pay costs. Tap a card, then confirm Charge it; or choose not to charge this turn.",
    "evidence": "Session records a charge or the phase advances with no charge. Merely clicking a card is not completion.",
    "recovery": "Changed your mind? Before confirming, choose a different card or cancel. Keeping your hand is a real choice.",
    "why": "You may place one card from hand in your Energy Area during your Charge Phase. Charging is optional."
  },
  {
    "id": "t1.affordability",
    "anchor": "Prediction anchored to visible energy count and the real card inspector.",
    "copy": "Inspect a Battle Card’s cost and your ready energy. Can you play it right now?",
    "evidence": "Prediction answer recorded separately from gameplay; retry or skip is allowed. No action or phase change occurs.",
    "recovery": "Compare the real card cost, required colors and ready energy. The board checks the payment and any card restrictions before you commit.",
    "why": "Card cost is paid by switching the required energy to Rest Mode. The normal play flow confirms the payment before the card is played."
  },
  {
    "id": "t1.play",
    "anchor": "Actual hand card, card inspector, existing play/review and payment confirmation UI.",
    "copy": "Tap a playable Battle Card and read its ability before confirming. Its cost rests that much energy; the energy cards stay in the Energy Area.",
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
    "copy": "A combo spends the card even if its energy cost is zero. In this Defense Step, use a legal combo to boost your defender for this battle, or Pass. Combo cards leave hand and normally go to Drop after battle.",
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
    "copy": "You may move one more hand card into Energy, where it stays. Think about what you want to play before choosing which card to charge.",
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
    "copy": "A combo spends the card even if its energy cost is zero. In this Offense Step, add combo power to your attack or Pass. The boost lasts for this battle; combo cards normally go to Drop afterward.",
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
  "id": "classic.awaken",
  "anchor": "Actual card ability and current prompt.",
  "copy": "Your Leader can Awaken now: read its ability and choose whether to flip it. These Leaders draw two cards when they Awaken at four Life or less. Their new side has more power and different text.",
  "evidence": "Accepted engine action or explicit explanation acknowledgement.",
  "recovery": "Read the actual prompt, inspect the card, or skip this explanation.",
  "why": "Awakening is optional and uses the existing card ability controls."
},
  {
  "id": "classic.evolve",
  "anchor": "Legal Evolve ability on a Battle Card.",
  "copy": "Read the offered Evolve ability and its cost before choosing it. Evolve plays a Battle Card onto an eligible Battle Card; Awakening flips your Leader and is a different ability.",
  "evidence": "Accepted engine activation; explanation alone is not gameplay evidence.",
  "recovery": "Inspect the offered card and eligible target, or keep considering other legal moves.",
  "why": "Use the printed Evolve requirements and the board’s legal targets."
},
  {
  "id": "classic.response",
  "anchor": "Actual card ability and current prompt.",
  "copy": "Read the response shown on the board: a Counter can interrupt an attack, while Blocker redirects it to your Battle Card. Choose a legal response or decline it.",
  "evidence": "Accepted engine action or explicit explanation acknowledgement.",
  "recovery": "Read the actual prompt, inspect the card, or skip this explanation.",
  "why": "Counter costs and Blocker requirements come from the actual card; declining does not skip the entire battle."
},
  {
  "id": "classic.choice",
  "anchor": "Actual card ability and current prompt.",
  "copy": "A card ability needs your choice now: follow the board’s selection and confirmation. Read the card text to see how many targets you can choose.",
  "evidence": "Accepted engine action or explicit explanation acknowledgement.",
  "recovery": "Read the actual prompt, inspect the card, or skip this explanation.",
  "why": "Some choices are optional and some required; the existing controls enforce the printed ability."
},
  {
  "id": "classic.cleanup",
  "anchor": "Actual card ability and current prompt.",
  "copy": "Your combo card has been spent: it normally goes to Drop after battle. If the board offers Z-Energy, you may put one eligible combo card there instead.",
  "evidence": "Accepted engine action or explicit explanation acknowledgement.",
  "recovery": "Read the actual prompt, inspect the card, or skip this explanation.",
  "why": "Zero combo energy cost means no energy payment, not keeping the card in your hand."
},
  {
    "id": "wrapup",
    "anchor": "Match status, Life totals and lesson replay/help controls.",
    "copy": "Great practice! You played real Goku and Frieza decks starting at eight Life. Replay any lesson, or try again with different choices. A player loses when their Life or deck runs out, or through other rules or card effects.",
    "evidence": "Tutorial completion recorded after the scenario reaches its scripted end or the learner exits.",
    "recovery": "The match can end before this point if a real win or loss condition is reached. You can restart the practice match from the tutorial menu.",
    "why": "Goku’s Double Strike deals two damage on a successful Leader attack. Awakening changes the Leader’s power and text; always inspect the current side."
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
    if (!event.id.startsWith("intro.") && !["t1.first-turn", "wrapup", "classic.awaken", "classic.evolve"].includes(event.id)) return state;
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
/** Coaching follows the current prompt even when a learner takes another legal route. */
export function currentLesson(progress: LearningProgress, snapshot?: Snapshot): typeof LESSONS[number] {
  const get = (id: string) => LESSONS.find(l => l.id === id)!;
  const unseen = (id: string) => !progress.completed.includes(id) && !progress.skipped.includes(id) && !(id in progress.predictions);
  if (snapshot?.view.over) return get("wrapup");
  if (snapshot) {
    const prompt = snapshot.view.prompt.kind;
    if (snapshot.waiting === "you") {
      if (["chooseCards", "chooseMode", "payCost", "optionalCost", "orderPending", "replaceMove"].includes(prompt)) return get("classic.choice");
      if (prompt === "zEnergyFromCombo") return get("classic.cleanup");
      if (["counter", "blocker"].includes(prompt)) return get("classic.response");
      if (prompt === "charge") return get(progress.ownTurns > 1 ? "t2.charge" : "t1.charge");
      if (snapshot.view.battle && prompt === "combo") {
        if (snapshot.view.turnPlayer !== snapshot.view.you.player) return get(unseen("opp.attack-predict") ? "opp.attack-predict" : "opp.defend");
        return get("t2.offense-combo");
      }
      if (prompt === "main" && unseen("classic.evolve") && snapshot.legal.some(l => l.action.type === "activate" && l.action.onto && /evolve/i.test(l.label))) return get("classic.evolve");
      if (prompt === "main" && unseen("classic.awaken") && snapshot.legal.some(l => l.action.type === "activate" && l.action.card === snapshot.view.you.leader?.id && /awaken/i.test(l.label))) return get("classic.awaken");
      if (prompt === "main" && !snapshot.legal.some(l => l.action.type === "play")) return get(snapshot.legal.some(l => l.action.type === "attack") ? "t2.attack-target" : "t1.end");
    }
    if (snapshot.view.turnPlayer !== snapshot.view.you.player) return get(snapshot.view.battle ? "opp.tie" : "opp.observe");
    if (snapshot.view.battle) return get("t2.resolve");
  }
  const relevant = LESSONS.filter(l => progress.ownTurns > 1 ? l.id.startsWith("t2.") && !["t2.charge", "t2.offense-combo", "t2.resolve"].includes(l.id) : l.id.startsWith("t1.") && l.id !== "t1.charge");
  return relevant.find(l => unseen(l.id)) ?? get(progress.ownTurns > 1 ? "t2.attack-target" : "t1.end");
}

export function affordabilityPrompt(snapshot: Snapshot) {
  const candidate = [...(snapshot.view.you.hand ?? [])].filter(c => c.power !== null && c.cost !== null)
    .sort((a, b) => Number.parseInt(a.cost!) - Number.parseInt(b.cost!))[0];
  if (!candidate) return { question: "No Battle Card is in your hand right now; inspect your other legal choices.", feedback: "You can keep your cards and continue using the board’s legal controls." };
  const playable = snapshot.legal.some(l => l.action.type === "play" && l.action.card === candidate.id);
  const ready = snapshot.view.you.energy.filter(c => c.mode === "active").length;
  return { question: `${candidate.name}: cost ${candidate.cost}, ${candidate.colors.join("/")}. Can you play it now?`, feedback: `${ready} ready energy. ${playable ? "The board offers this play; review the payment before confirming." : "This play is not available now; inspect its cost, colors and restrictions."} Energy rests to pay and stays in Energy.` };
}
export function handoffReady(progress: LearningProgress): boolean {
  return progress.ownTurns >= 2 && (progress.defended || progress.skipped.includes("opp.defend")) && progress.ownBattleResolved;
}

/** Small phone coach: current legal choices take priority over curriculum history. */
export const BADGE_GLOSSARY = "BLK = Blocker: redirects an attack to that Battle Card. RVG = Revenge: when attacked, KO the attacking Battle Card after battle. STR marks a Strike ability; read its exact card text. These are skills, not colors. Phase markers show progress; they are not navigation buttons.";
/** How the player is operating the board right now. Detected in the browser, never inferred from width. */
export type InputMode = "touch" | "mouse" | "keyboard";
export const INPUT_MODES: InputMode[] = ["touch", "mouse", "keyboard"];
/** The ways of picking a hand card, per input mode. Without a detected mode the coach keeps the touch wording. */
const PICK: Record<InputMode, { charge: string; play: string; any: string }> = {
  touch: { charge: "Tap a hand card, then Charge it.", play: "Tap a playable hand card, review it, then choose Play and confirm its payment.", any: "Tap a card to inspect it." },
  mouse: { charge: "Click a hand card, then choose Charge in the card panel (or drag the card onto Energy).", play: "Click a playable hand card (or drag it onto the Battle Area), review it, then choose Play and confirm its payment.", any: "Click a card to inspect it." },
  keyboard: { charge: "Press Tab to reach a hand card, Enter to select it, then choose its Charge button.", play: "Press Tab to reach a playable hand card and Enter to select it, review it, then choose Play and confirm its payment.", any: "Tab to a card and press Enter to inspect it." },
};
/** One line on how this input mode operates the board; the other two stay in "Need another way?". */
export const INPUT_HELP: Record<InputMode, string> = {
  touch: "Touch: tap a card to inspect it. Nothing is spent until you tap the confirm button in its review. Long-press a card for its actions.",
  mouse: "Mouse: click a card to inspect it and use the buttons in its panel, or drag a hand card onto the Battle Area or Energy. Right-click opens a card’s actions.",
  keyboard: "Keyboard: Tab moves between cards and controls, Enter selects or confirms, and Escape closes a review. Legal choices stay on the board.",
};
export function compactCoach(lessonId: string, snapshot: Snapshot, mode: InputMode = "touch"): { instruction: string; concept: string; input: string } {
  const pick = PICK[mode];
  const say = (instruction: string, concept: string) => ({ instruction, concept, input: INPUT_HELP[mode] });
  const prompt = snapshot.view.prompt.kind;
  if (snapshot.view.over) return say("The match has ended. Review a lesson or start again.", "Life, deck and card effects determine the result. Your accepted moves are recorded in Lessons.");
  if (snapshot.waiting === "you") {
    if (prompt === "charge") return say(`${pick.charge} Pass means no charge this turn.`, "That card leaves your hand and stays in Energy. Rest energy to pay costs; it readies again next turn.");
    if (["chooseCards", "chooseMode", "payCost", "optionalCost", "orderPending", "replaceMove"].includes(prompt)) return say("Follow the current card prompt and confirm your choice.", "Read the card’s ability and the number of selections required. Only the choices offered here are legal; reviewing a card does not commit it.");
    if (prompt === "counter") return say("Choose a legal Counter response, or the offered decline option.", "A Counter interrupts at its printed timing; read whether it negates the attack. Declining this window lets the battle continue.");
    if (prompt === "blocker") return say("Choose an offered Blocker to redirect the attack, or the offered decline option.", "Blocker rests your eligible Battle Card and makes it the defender. It does not negate the attack; a Counter may do that instead.");
    if (prompt === "zEnergyFromCombo") return say("Choose one eligible combo card for Z-Energy, or decline.", "Combo cards normally go to Drop after battle. A zero energy combo cost still spends the card; it does not return to your hand.");
    if (prompt === "combo") {
      const attacking = snapshot.view.turnPlayer === snapshot.view.you.player;
      return say(`Choose Combo to boost your ${attacking ? "attacker" : "defender"}, or Pass to finish your combo step.`, "Playing a card does not add combo power. Combo uses a hand card or eligible Battle Card for this battle only; zero energy cost still spends it. The attacker wins ties.");
    }
    if (prompt === "main") {
      if (lessonId === "classic.awaken" && snapshot.legal.some(l => l.action.type === "activate" && l.action.card === snapshot.view.you.leader?.id && /awaken/i.test(l.label))) return say("Read your Leader’s Awaken ability, then choose whether to activate it.", "These BT1 Leaders Awaken at four Life or less: flip the Leader and draw two. Evolve is a separate Battle Card ability, not another name for Awakening.");
      if (lessonId === "classic.evolve" && snapshot.legal.some(l => l.action.type === "activate" && l.action.onto && /evolve/i.test(l.label))) return say("Inspect the offered Evolve ability, its cost and eligible Battle Card target.", "Evolve plays a Battle Card onto another Battle Card. Awakening instead flips a Leader. Choose Evolve only if you want to use that legal ability.");
      const play = snapshot.legal.some(l => l.action.type === "play");
      const leaderAttack = snapshot.legal.some(l => l.action.type === "attack" && l.action.attacker === snapshot.view.you.leader?.id);
      if (!play) {
        const energy = snapshot.view.you.energy.length;
        if (leaderAttack) return say("Choose your Leader, then an offered attack target. A normal Leader attack costs no energy.", `${energy === 0 ? "You have no energy after declining charge. " : "No hand card can be played now. "}The attacker wins ties. Combos are separate choices during battle.`);
        const attack = snapshot.legal.some(l => l.action.type === "attack");
        if (attack) return say("Choose an offered attacker and legal target, or End turn.", "No hand card can be played now. Playing and Combo are separate actions; combo power applies only during battle. The attacker wins ties.");
        return say(`Choose End turn. On your next Charge Phase: ${pick.charge.charAt(0).toLowerCase()}${pick.charge.slice(1)}`, `${energy === 0 ? "You have no energy to pay for cards. " : "No play or attack is legal now. "}${snapshot.view.turn === 1 ? "The first player cannot attack on their first turn. " : ""}Pass only declines a prompt; it does not end your turn.`);
      }
      if (["t2.attack-target", "changed-board.predict"].includes(lessonId) && snapshot.legal.some(l => l.action.type === "attack")) return say("Choose an Active attacker, then an offered target. Confirm the attack when prompted.", "You can attack a Leader or a rested Battle Card when legal. A normal Leader attack costs no energy. Combo power is added separately during battle; the attacker wins ties.");
      return say(pick.play, "Rest energy to pay; it stays in Energy. Playing a Battle Card uses its battle power, not its combo power. Combo is a separate battle action that spends a card.");
    }
  }
  if (snapshot.view.battle) return say("Watch the current battle resolve and follow the next response prompt.", "Compare final power after combos: the attacker wins ties. A successful Leader hit takes Life; a defeated Battle Card goes to Drop. Combo boosts last only this battle.");
  if (snapshot.view.turnPlayer !== snapshot.view.you.player) return say("Watch the opponent’s turn; respond when the board offers you a choice.", "They ready their rested cards, draw, and may charge. Energy stays in its area when rested to pay. Phase markers show progress, not navigation.");
  const lesson = LESSONS.find(l => l.id === lessonId);
  return say(lesson?.copy ?? "Read the current board prompt and choose an offered legal action.", `${pick.any} Phase markers show progress; use the board’s action controls to make a move.`);
}
