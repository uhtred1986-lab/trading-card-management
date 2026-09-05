/**
 * The effect language and its interpreter.
 *
 * A card's skill text is turned into a small program of `Op`s — by the
 * deterministic compiler in `compile.ts`, or, when that fails, by Claude at
 * runtime (the referee, which answers in this same language). The interpreter
 * executes a program step by step inside the engine's flow, so an effect that
 * needs a choice can stop, ask, and resume.
 *
 * Nothing here reads card text. Section numbers refer to the Rule Manual.
 */
import type { CardFilter } from "./filters";
import {
  addEffect,
  amount,
  condHolds,
  resolveRef,
  resolveSelector,
  sideOf,
  areaOf,
  draw as drawCards,
  face,
  forbids,
  has,
  move,
  note,
  placeUnder,
  schedule,
  setMode,
  tokenCardId,
  type GameContext,
} from "./state";
import { koCard, masterOf, pendTriggers } from "./triggers";
import type { Color, DelayScope, DelayTiming, FlowStep, ForbiddenAction, GameEvent, GameState, KeywordSkill, PlayerId, SkillKindPrefix, Trigger } from "./types";

// ── the language ───────────────────────────────────────────────────────────

/** Areas a selector can read. "under" is the cards beneath the source card (23-2). */
export type ScriptArea = "hand" | "deck" | "drop" | "life" | "battle" | "combo" | "energy" | "unison" | "leader" | "warp" | "zDeck" | "zEnergy" | "under" | "play" | "removed";

export type Side = "you" | "opponent" | "both";

/**
 * `afterNextCharge` outlives `nextTurn` by one step: "the chosen card will not
 * switch to Active Mode during your next Charge Phase" (7-2-7) has to still be
 * there when the Active Step runs, and `nextTurn` ends just before it.
 */
export type Duration = "battle" | "turn" | "opponentTurn" | "nextTurn" | "afterNextCharge" | "game";

/**
 * Cards the source skill can point at without choosing: itself, the battle
 * roles, the trigger's subject, and `resolving` — the card whose play a
 * [Counter: Play] is answering ("if the Battle Card being played has an energy
 * cost of 7 or less").
 */
export type SpecialTarget = "self" | "attacker" | "guard" | "subject" | "leader" | "opponentLeader" | "resolving";

export interface Selector {
  side?: Side;
  area?: ScriptArea;
  /**
   * More than one area, for the wordings that name two: "your opponent's
   * Battle Cards or Unisons". One area is the common case and stays in
   * `area`; this is read instead of it when present.
   */
  areas?: ScriptArea[];
  filter?: CardFilter;
  special?: SpecialTarget;
  /** Only cards in this mode (1-10). */
  mode?: "active" | "rest";
  /** Draw the candidates from a bound variable instead of an area. */
  fromVar?: string;
  /** How many to take. `upTo` allows zero (5-2-4). */
  count?: number;
  upTo?: boolean;
  /**
   * "The top card of your deck": the first `take` cards of the area in its own
   * order, not a choice among them. `count` never means this — a count is
   * always a choice (5-2) — so the two must not be confused.
   */
  take?: number;
  /** With `take`, count from the far end: "the bottom card of your deck". */
  fromEnd?: boolean;
  /** Card text may say "ignoring [Barrier]", which lifts 22-16 for this choice. */
  ignoreBarrier?: boolean;
}

/**
 * A number an effect needs. `count` is read off the board — "for each of your
 * ≪Saiyan≫ cards" — and `times` multiplies it, because cards say "+5000 power
 * for each" far more often than they say "1 for each".
 */
export type Amount =
  | number
  | { var: string }
  | { count: Selector; times?: number }
  /** The total power of the cards bound to a name — "the cards switched to Rest Mode by this skill" ([Alliance], 22-32). */
  | { sumPower: { var: string } }
  /** "Draw cards until you have 4 cards in your hand": however many that takes, never fewer than none. */
  | { handUpTo: number };

/**
 * `minus` is "the rest": the cards bound to `var` that a later choice did not
 * take — "look at the top 3 cards of your deck, add 1 of them to your hand and
 * place the rest at the bottom of your deck".
 */
export type Ref = { var: string; minus?: string } | { sel: Selector };

export type Cond =
  | { kind: "count"; sel: Selector; atLeast?: number; atMost?: number }
  | { kind: "life"; side: Side; atLeast?: number; atMost?: number }
  /** "When your life is less than or equal to your opponent's life" — the two counts against each other. */
  | { kind: "lifeVsOpponent"; atMost?: boolean; atLeast?: boolean }
  | { kind: "leaderColor"; color: Color }
  /** "If your Leader is a <Baby> card" — colour, character name and traits alike. */
  | { kind: "leaderMatches"; filter: CardFilter; side?: Side; back?: boolean }
  /** "If this card has 3 or more markers on it" (13-2): the markers on the selected cards, added up. */
  | { kind: "markers"; sel: Selector; atLeast?: number; atMost?: number }
  /** "If this card is in a battle" (8-1): any of the selected cards is the attacker or the guard. */
  | { kind: "inBattle"; sel: Selector; not?: boolean }
  /** "When your life is at 4 or less, or you have 5 or more energy" — one of several; "all" is every one of them. */
  | { kind: "any"; conds: Cond[] }
  | { kind: "all"; conds: Cond[] }
  /** "If your opponent's Leader Card's back is facing up" — the Leader has awakened (22-2). */
  | { kind: "leaderFlipped"; side?: Side; flipped?: boolean }
  /** "If this card's power is 30000 or more" — any of the selected cards, as it stands now. */
  | { kind: "power"; sel: Selector; atLeast?: number; atMost?: number }
  /** "If you added a card to your hand", "if you played a card" — whether an earlier step of this same skill did that. */
  | { kind: "did"; what: "addToHand" | "play" | "negateAttack" | "negateLeaderAttack" | "ko" | "draw" }
  /** "If you don't" (20-16): the opposite of a condition. */
  | { kind: "not"; cond: Cond }
  | { kind: "chose"; var: string }
  /** "If that card is a Battle Card": what a reveal or a look turned up (20-11). */
  | { kind: "varMatches"; var: string; filter: CardFilter }
  /** Whose turn it is (7-1). "opponent" is "during your opponent's turn". */
  | { kind: "isTurnPlayer"; who?: "you" | "opponent" };

export type Op =
  | { op: "draw"; n: Amount; side?: Side }
  /** Cards leave a hand, chosen by its owner (20-7); `to: "warp"` for "sends 1 card from their hand to their Warp". */
  | { op: "discard"; n: Amount; side?: Side; to?: "warp" }
  | { op: "damage"; n: Amount; side?: Side }
  | { op: "mill"; n: Amount; side?: Side }
  | { op: "addLife"; n: Amount; side?: Side }
  /** "Add cards from your life to your hand until you have N life" (21-3-2 wording, without damage). */
  | { op: "lifeDownTo"; n: number; side?: Side }
  | { op: "shuffle"; side?: Side }
  | { op: "energyMarker"; n: Amount; side?: Side }
  /**
   * `chooser` is who answers, when that is not the player whose skill this is:
   * "your opponent sends 1 Battle Card from their Drop Area to their Warp"
   * (20-7) is their choice to make, not yours.
   */
  | { op: "choose"; sel: Selector; as: string; reason?: string; chooser?: Side }
  /** `from` is the top of the deck unless the card says the bottom. */
  /** `area` is the deck unless it says otherwise — "look at your opponent's hand" (20-11). */
  | { op: "look"; n: Amount; as: string; side?: Side; from?: "top" | "bottom"; area?: ScriptArea }
  /**
   * "Reveal the top card of your opponent's deck" (20-11-2): both players see
   * it, so the name is logged, and the cards stay where they are — bound to
   * `as` for the clauses that act on what was seen.
   */
  | { op: "reveal"; sel: Selector; as: string }
  | { op: "ko"; target: Ref }
  /** `to: "under"` puts the card under `under`, or under the source card (23-2). */
  /**
   * `owner` overrides whose area the card lands in — "place it in your
   * opponent's energy in Rest Mode" (3-8) puts a card the opponent owns into
   * the *other* player's energy. Left out, a card goes to its own owner's
   * area, which is what nearly every move means.
   */
  | { op: "moveTo"; target: Ref; to: ScriptArea; position?: "top" | "bottom"; mode?: "active" | "rest"; reveal?: boolean; under?: Ref; owner?: Side }
  /**
   * `onto` plays the card on top of another, which is how [Union-Absorb]
   * resolves (22-13-6-3) and how the "play … on top of this card" wordings
   * read. Without it the card is played beside the host instead of onto it.
   */
  /** `negated` is "played … with its skills negated" (9-1-5), for the turn or for as long as it is in play. */
  | { op: "play"; target: Ref; mode?: "active" | "rest"; onto?: Ref; negated?: "turn" | "game" }
  | { op: "switchMode"; target: Ref; mode: "active" | "rest" }
  | { op: "power"; target: Ref; amount: Amount; until: Duration }
  | { op: "comboPower"; target: Ref; amount: Amount; until: Duration }
  | { op: "grant"; target: Ref; keyword: KeywordSkill; until: Duration }
  | { op: "negateSkills"; target: Ref; until: Duration }
  /**
   * "Negate that card's [Auto] skill for the turn" (9-1-5): one kind of skill
   * rather than all of them. The printed tag is a prefix of `SkillKind`, so a
   * bare "[Counter]" covers every counter kind.
   */
  | { op: "negateSkillsOfKind"; target: Ref; kind: SkillKindPrefix; until: Duration }
  /** 23-5: "switch it to Hidden Mode" / "switch it to Revealed Mode" — Battle Cards in the Battle Area only. */
  | { op: "hidden"; target: Ref; hidden: boolean }
  /** "Switch the target of the attack to it" — the card becomes the guard, as a [Blocker] would (22-4-2). */
  | { op: "redirectAttack"; target: Ref }
  /**
   * "Use up to 1 card with 5000 combo power from your Drop in a combo (with
   * its skills negated)" — into your Combo Area during a battle, for no combo
   * cost (5-7); it leaves with the other combo cards at the end of the battle.
   */
  | { op: "comboFrom"; target: Ref; negated?: boolean }
  /** "You may flip this card over" — a Leader awakens by a skill other than its [Awaken] (22-2-4). */
  | { op: "flip"; target: Ref }
  | { op: "addMarker"; target: Ref; n: Amount }
  | { op: "removeMarker"; target: Ref; n: Amount }
  | { op: "token"; name: string; power: number; comboCost: number | null; comboPower: number | null; colors: Color[]; n: Amount; side?: Side }
  /**
   * A [Permanent] cost reducer, applied while the card sits where the skill
   * says (9-1-3-3). `what` says which cost: the energy cost by default, or the
   * combo cost (5-7-3).
   */
  | { op: "costReduction"; target: Ref; amount: Amount; what?: "energy" | "combo" }
  /**
   * Take a keyword skill away from a card (9-1-5). Unlike `negateSkills`, which
   * silences everything, this names one — "negate this card's
   * [Energy-Exhaust] skill in all areas".
   */
  | { op: "negateKeyword"; keyword: KeywordSkill["name"]; target?: Ref }
  /**
   * 20-1: the card counts as having these too, wherever it is — "this card
   * gains ≪Saiyan≫ in all areas", "this card is also treated as red". It is
   * read by every rule that looks at what a card *is*, not by the ones that
   * look at what it does.
   */
  | { op: "gains"; traits?: string[]; characters?: string[]; colors?: Color[]; target?: Ref }
  /**
   * 9-10: where this card goes instead, when it would leave the Battle Area.
   * `by: "skill"` narrows it to departures a skill caused.
   */
  | { op: "replaceLeave"; to: ScriptArea; by?: "skill" | "ko" | "skillOrKo"; mode?: "active" | "rest"; target?: Ref }
  /**
   * Another way to pay for this card's own [Counter] skill (5-3): for nothing,
   * or by adding cards from your life to your hand. Read from the hand, like
   * a cost reducer, because that is where the skill says it applies.
   */
  | { op: "altCost"; pay: "none" | "life"; n?: number; for?: "counter" | "play" }
  /**
   * What a [Counter: Play] does to the card it is answering (9-6). `instead`
   * stops the play outright and sends the card there rather than into play;
   * `mode` and `negated` let the play happen but change how the card arrives.
   */
  | { op: "resolvingPlay"; instead?: ScriptArea; position?: "top" | "bottom"; mode?: "rest"; negated?: boolean }
  | { op: "negateAttack" }
  /**
   * 9-7: negate the counter this one is answering. The counter being answered
   * is the step waiting under this one in the flow, so there is nothing to
   * name — "the [Counter]" is always that one.
   */
  | { op: "negateCounter" }
  /**
   * 9-1-5: this skill switches itself off for the rest of the game. Cards use
   * it for effects meant to happen once — the skill is still printed, and
   * still negatable by anything else, it simply never triggers again.
   */
  | { op: "negateOwnSkill"; until?: "turn" | "battle" }
  /** Kept for programs written before `forbid` existed; the same thing. */
  | { op: "cannotAttack"; target: Ref; until: Duration }
  /**
   * Forbid an action (20-14). Name a `target` for a rule about particular
   * cards, or a `side` for one about a player ("your opponent can't attack
   * with Battle Cards"), optionally narrowed by a filter.
   */
  | { op: "forbid"; what: ForbiddenAction; until: Duration; target?: Ref; side?: Side; filter?: CardFilter; sameNameAsSelf?: boolean }
  | { op: "if"; cond: Cond; then: Op[]; else?: Op[] }
  /** "Choose one— ・A ・B" (20-2): the master picks one printed option. */
  | { op: "chooseMode"; modes: { label: string; ops: Op[] }[]; reason?: string }
  /**
   * Write an effect down now and carry it out later (1-7-2-1-1): "at the end
   * of the turn, KO it". The inner program keeps this frame's variables, so it
   * still knows which card "it" was.
   */
  | { op: "delay"; at: DelayTiming; scope?: DelayScope; ops: Op[]; label?: string }
  | { op: "note"; text: string };

export interface Script {
  ops: Op[];
  /** Clauses the compiler could not read; non-empty means the referee handles the skill. */
  unsupported: string[];
}

/** One running program. Stored in the flow, so a game can be saved mid-effect. */
export interface ScriptFrame {
  ops: Op[];
  ip: number;
  vars: Record<string, string[]>;
  card: string;
  master: PlayerId;
  trigger?: Trigger;
  subject?: string;
  /** Which skill of the card this is, so a skill can switch itself off (9-1-5). */
  skillIndex?: number;
  /** Set while a `choose` is waiting for an answer. */
  awaiting?: string;
  /** What this program has done so far, for "if you added a card to your hand" (20-16). */
  did?: { addToHand?: boolean; play?: boolean; negateAttack?: boolean; negateLeaderAttack?: boolean; ko?: boolean; draw?: boolean };
}

/** How each timing reads in the log when the card text does not say it better. */
export const DELAY_LABELS: Record<DelayTiming, string> = {
  turnStart: "at the start of the turn",
  mainStart: "at the start of the Main Phase",
  turnEnd: "at the end of the turn",
  turnCleanup: "as the turn ends",
  battleEnd: "at the end of the battle",
};

// ── the interpreter ────────────────────────────────────────────────────────

export { resolveSelector };

/**
 * Run a program until it finishes or needs a decision. Returns "wait" with a
 * prompt set and the frame pushed back onto the flow; "done" when the program
 * ended or a sub-flow (playing a card) took over.
 */
export function stepScript(ctx: GameContext, s: GameState, ev: GameEvent[], frame: ScriptFrame): "done" | "wait" {
  const master = frame.master;

  for (let guard = 0; guard < 200; guard++) {
    if (frame.ip >= frame.ops.length) return "done";
    const op = frame.ops[frame.ip];

    switch (op.op) {
      case "note":
        note(ev, op.text);
        break;

      case "draw":
        for (const p of sideOf(master, op.side)) {
          const before = s.players[p].hand.length;
          drawCards(ctx, s, ev, p, amount(ctx, s, frame, op.n));
          // "If you did not draw a card with this skill" (20-16).
          if (p === master && s.players[p].hand.length > before) (frame.did ??= {}).draw = true;
        }
        break;

      case "discard": {
        // 20-7: the *owner* of the hand chooses which cards leave it. The
        // comment here has said so from the beginning while the code took
        // whatever was last in hand, which is not a choice at all — and for
        // the opponent's hand it was not even the right player's.
        //
        // Rather than teach this op to prompt, it is rewritten into the ops
        // that already know how: a `choose` the owner answers, then the move.
        // `chooseMode` splices its option in the same way.
        const n = amount(ctx, s, frame, op.n);
        const spliced: Op[] = [];
        for (const p of sideOf(master, op.side)) {
          const who: Side = p === master ? "you" : "opponent";
          const v = `discarded${frame.ip}${p}`;
          spliced.push(
            { op: "choose", sel: { side: who, area: "hand", count: n }, as: v, chooser: who, reason: `discard ${n} card${n === 1 ? "" : "s"}` },
            { op: "moveTo", target: { var: v }, to: op.to ?? "drop", reveal: true },
          );
        }
        frame.ops = [...frame.ops.slice(0, frame.ip), ...spliced, ...frame.ops.slice(frame.ip + 1)];
        continue;
      }

      case "damage": {
        // 5-10 / 21-3: life cards go to the hand; damage from an effect is never Critical.
        for (const p of sideOf(master, op.side ?? "opponent")) {
          const n = amount(ctx, s, frame, op.n);
          const taken: string[] = [];
          for (let i = 0; i < n; i++) {
            const life = s.players[p].life[0];
            if (!life) break;
            move(ctx, s, ev, life, "hand", p, { reason: "damage" });
            taken.push(life);
          }
          if (taken.length) {
            s.players[p].damageTaken += taken.length;
            ev.push({ type: "damage", player: p, amount: taken.length, critical: false, cards: taken });
            pendTriggers(ctx, s, "dealtDamage", frame.card);
          }
        }
        break;
      }

      case "mill":
        for (const p of sideOf(master, op.side)) {
          const n = amount(ctx, s, frame, op.n);
          for (let i = 0; i < n && s.players[p].deck.length; i++) move(ctx, s, ev, s.players[p].deck[0], "drop", p, { reason: "effect", reveal: true });
        }
        break;

      case "addLife":
        for (const p of sideOf(master, op.side)) {
          const n = amount(ctx, s, frame, op.n);
          for (let i = 0; i < n && s.players[p].deck.length; i++) move(ctx, s, ev, s.players[p].deck[0], "life", p, { reason: "effect" });
        }
        break;

      case "lifeDownTo":
        // Losing life this way is not damage (1-13-2), so nothing triggers on it.
        for (const p of sideOf(master, op.side)) {
          while (s.players[p].life.length > op.n) move(ctx, s, ev, s.players[p].life[0], "hand", p, { reason: "effect" });
        }
        break;

      case "shuffle":
        // 5-11: the engine reshuffles at the next draw; record it so the log reads right.
        for (const p of sideOf(master, op.side)) ev.push({ type: "note", text: `${s.players[p].name} shuffles their deck` });
        shuffleDeck(s, sideOf(master, op.side));
        break;

      case "energyMarker":
        for (const p of sideOf(master, op.side)) {
          const n = amount(ctx, s, frame, op.n);
          s.players[p].energyMarkers = Math.max(0, s.players[p].energyMarkers + n);
          ev.push({ type: "energyMarker", player: p, delta: n });
        }
        break;

      case "look": {
        // 20-11: looking is not revealing — only the player looking sees them,
        // which is why the cards are bound to a name rather than moved.
        const p = sideOf(master, op.side)[0];
        // "Look at your opponent's hand": a whole area rather than an end of
        // the deck, so the count says nothing.
        if (op.area && op.area !== "deck") {
          frame.vars[op.as] = resolveSelector(ctx, s, frame, { side: op.side, area: op.area });
          break;
        }
        const n = amount(ctx, s, frame, op.n);
        const deck = s.players[p].deck;
        frame.vars[op.as] = op.from === "bottom" ? deck.slice(Math.max(0, deck.length - n)) : deck.slice(0, n);
        break;
      }

      case "reveal": {
        // 20-11-2: revealing shows the cards to both players and leaves them
        // where they are. The log is how the other player gets to see them.
        const shown = resolveSelector(ctx, s, frame, op.sel);
        frame.vars[op.as] = shown;
        if (shown.length) note(ev, `revealed ${shown.map((id) => face(ctx, s, id).name).join(", ")}`);
        break;
      }

      case "choose": {
        const want = op.sel.count ?? 1;
        /** Cards taken out of a pool ("choose 1 among them") leave the pool. */
        const take = (picked: string[]) => {
          frame.vars[op.as] = picked;
          if (op.sel.fromVar) frame.vars[op.sel.fromVar] = (frame.vars[op.sel.fromVar] ?? []).filter((id) => !picked.includes(id));
        };
        // Cards picked so far, while a multi-card choice is part-answered.
        const sofar = frame.awaiting === op.as ? (frame.vars[op.as] ?? []) : [];
        const cands = resolveSelector(ctx, s, frame, op.sel).filter((id) => !sofar.includes(id));

        if (s.lastChoice && frame.awaiting === op.as) {
          const picked = [...sofar, ...s.lastChoice.filter((id) => cands.includes(id))];
          s.lastChoice = null;
          // A choice is made one card at a time (the board asks by tapping),
          // so a "choose 2" comes back here for the second card. Declining a
          // card ends an "up to" choice early, as 5-2-4 allows.
          const done = picked.length >= want || picked.length === sofar.length || picked.length >= sofar.length + cands.length;
          frame.vars[op.as] = picked;
          if (done) {
            frame.awaiting = undefined;
            take(picked);
            break;
          }
          continue;
        }

        // 5-2-5: take as many as possible when fewer are available than asked for.
        const left = want - sofar.length;
        if (cands.length === 0) {
          frame.awaiting = undefined;
          take(sofar);
          break;
        }
        // Only ask when the answer can differ: a forced pick is taken silently.
        if (!op.sel.upTo && cands.length <= left) {
          frame.awaiting = undefined;
          take([...sofar, ...cands]);
          break;
        }
        frame.awaiting = op.as;
        frame.vars[op.as] = sofar;
        s.flow.unshift({ op: "script.step", frame });
        const asked = left === 1 ? "" : ` (${left} more)`;
        s.prompt = {
          kind: "chooseCards",
          // 20-7: whoever the card says chooses, chooses.
          player: op.chooser ? sideOf(master, op.chooser)[0] : master,
          choice: {
            reason: (op.reason ?? `${face(ctx, s, frame.card).name}: choose ${op.sel.upTo ? `up to ${want}` : want}`) + asked,
            candidates: cands,
            // One card per answer, so the menu is one action per card.
            min: op.sel.upTo ? 0 : 1,
            max: 1,
            continuation: op.as,
          },
        };
        return "wait";
      }

      case "ko":
        for (const id of resolveRef(ctx, s, frame, op.target)) {
          // 22-12: [Indestructible] cannot be KO'd by an opponent's skill.
          if (has(ctx, s, id, "Indestructible") && s.cards[id].owner !== master) continue;
          // 20-14: the same thing spelled out on the card rather than keyworded.
          if (forbids(ctx, s, "beKOdBySkill", { player: master, card: id })) continue;
          if (areaOf(s, id) === "battle") {
            const before = s.players[s.cards[id].owner].drop.length;
            koCard(ctx, s, ev, id, frame.card);
            // "If you KO'd a card" (20-16): only a KO that happened counts.
            if (s.players[s.cards[id].owner].drop.length > before) (frame.did ??= {}).ko = true;
          }
        }
        break;

      case "moveTo": {
        // 23-2: under a card is not an area of its own, so it is its own move.
        const host = op.to === "under" ? (op.under ? resolveRef(ctx, s, frame, op.under)[0] : frame.card) : null;
        for (const id of resolveRef(ctx, s, frame, op.target)) {
          // 3-1-2: a Leader Card stays in the Leader Area. Skills may change
          // its power or negate it, but nothing puts it anywhere else — and
          // an empty Leader Area is a state the rest of the engine cannot read.
          if (areaOf(s, id) === "leader") continue;
          // 20-14: "can't be removed from a Battle Area by your opponent's
          // skills". The rule is about the opponent's skills, so a card its
          // own master moves is unaffected.
          if (s.cards[id].owner !== master && areaOf(s, id) === "battle" && forbids(ctx, s, "beMovedBySkill", { card: id })) continue;
          if (op.to === "under") {
            if (host) placeUnder(ctx, s, ev, id, host);
            continue;
          }
          const owner = op.owner ? sideOf(master, op.owner)[0] : op.to === "battle" || op.to === "unison" ? master : s.cards[id].owner;
          // "play" is not an area of its own either (3-1); it means the Battle Area.
          const dest = op.to === "play" ? "battle" : op.to;
          const leftBattle = areaOf(s, id) === "battle";
          move(ctx, s, ev, id, dest, owner, { position: op.position, reveal: op.reveal, reason: "effect" });
          // 3-1: "when this card is removed from a Battle Area by a skill",
          // and the commoner narrowing to the *opponent's* skills. A card that
          // went nowhere — a replacement sent it back — was not removed.
          if (leftBattle && areaOf(s, id) !== "battle") {
            pendTriggers(ctx, s, "removedFromBattle", id);
            if (masterOf(s, id) !== master) pendTriggers(ctx, s, "removedByOpponent", id);
          }
          if (op.mode) setMode(s, ev, id, op.mode, ctx);
          // 5-5: a card a skill *places* in a Battle Area was not played, so
          // "when this card is played" does not fire — 30 cards say only
          // "when this card is placed in a Battle Area".
          if (dest === "battle") pendTriggers(ctx, s, "placed", id);
          // 17-3: "when this card is added to your Z-Energy".
          if (dest === "zEnergy") pendTriggers(ctx, s, "addedToZEnergy", id);
          if (dest === "hand" && owner === master) (frame.did ??= {}).addToHand = true;
        }
        break;
      }

      case "switchMode":
        for (const id of resolveRef(ctx, s, frame, op.target)) setMode(s, ev, id, op.mode, ctx);
        break;

      case "hidden":
        // 23-5-1: only a Battle Card in a Battle Area can be face down.
        for (const id of resolveRef(ctx, s, frame, op.target)) {
          if (areaOf(s, id) !== "battle" || s.cards[id].hidden === op.hidden) continue;
          s.cards[id].hidden = op.hidden;
          note(ev, `${op.hidden ? "a Battle Card" : face(ctx, s, id).name} is switched to ${op.hidden ? "Hidden" : "Revealed"} Mode`);
        }
        break;

      case "flip":
        for (const id of resolveRef(ctx, s, frame, op.target)) {
          const inst = s.cards[id];
          if (inst.flipped || !ctx.defs[inst.cardId]?.back || areaOf(s, id) !== "leader") continue;
          inst.flipped = true;
          ev.push({ type: "flip", card: id, flipped: true });
        }
        break;

      case "comboFrom": {
        // 5-7-2: a combo card needs a battle to join, on the side of the
        // player whose skill this is.
        const b = s.battle;
        if (!b || (masterOf(s, b.attacker) !== master && masterOf(s, b.guard) !== master)) break;
        for (const id of resolveRef(ctx, s, frame, op.target)) {
          if (areaOf(s, id) === "combo") continue;
          move(ctx, s, ev, id, "combo", master, { reason: "combo", reveal: true });
          if (op.negated) s.cards[id].negated = "all";
        }
        break;
      }

      case "redirectAttack": {
        // 8-1: a battle in progress; the new target has to be a Leader or a
        // Battle Card of the defending player that is not already the attacker.
        const b = s.battle;
        if (!b) break;
        const defender = masterOf(s, b.guard);
        const id = resolveRef(ctx, s, frame, op.target).find((x) => x !== b.attacker && x !== b.guard && masterOf(s, x) === defender && (areaOf(s, x) === "battle" || areaOf(s, x) === "leader"));
        if (!id) break;
        b.guard = id;
        ev.push({ type: "guardChanged", guard: id, by: frame.card });
        pendTriggers(ctx, s, "attacked", id);
        break;
      }

      case "power":
      case "comboPower": {
        const n = amount(ctx, s, frame, op.amount);
        for (const id of resolveRef(ctx, s, frame, op.target)) addEffect(s, ev, { target: id, kind: op.op === "power" ? "power" : "comboPower", value: n, until: op.until });
        break;
      }

      case "grant":
        for (const id of resolveRef(ctx, s, frame, op.target)) addEffect(s, ev, { target: id, kind: "keyword", value: op.keyword, until: op.until });
        break;

      case "negateSkills":
        // 9-1-5: for a duration it is a continuous effect that ends with the
        // turn or the battle; "for the game" marks the card until it leaves play.
        for (const id of resolveRef(ctx, s, frame, op.target)) {
          // 9-1-5: "This card's skills can't be negated in any area" beats the
          // instruction, like every other prohibition (0-2-5).
          if (forbids(ctx, s, "beNegated", { card: id })) continue;
          if (op.until === "game") s.cards[id].negated = "all";
          else addEffect(s, ev, { target: id, kind: "negateSkills", value: 0, until: op.until });
        }
        break;

      case "negateSkillsOfKind":
        // 9-1-5: one kind of skill, not the card. Always an effect with a
        // duration — no card prints "for the game" on a single kind.
        for (const id of resolveRef(ctx, s, frame, op.target)) {
          if (forbids(ctx, s, "beNegated", { card: id })) continue;
          addEffect(s, ev, { target: id, kind: "negateSkillKind", value: op.kind, until: op.until === "game" ? "turn" : op.until });
        }
        break;

      case "cannotAttack":
        for (const id of resolveRef(ctx, s, frame, op.target)) addEffect(s, ev, { target: id, kind: "forbid", value: 0, until: op.until, forbid: { what: "attack" } });
        break;

      case "forbid": {
        // "both" and an absent side alike mean the rule is about neither
        // player in particular, so it holds for both.
        const players = op.side && op.side !== "both" ? sideOf(master, op.side) : [];
        if (op.target) {
          // On a card, the side says *whose* action is forbidden — "can't be
          // KO'd by your opponent's skills" is a rule about the opponent.
          for (const id of resolveRef(ctx, s, frame, op.target)) addEffect(s, ev, { target: id, kind: "forbid", value: 0, until: op.until, forbid: { what: op.what, player: players[0] } });
          break;
        }
        addEffect(s, ev, {
          target: "",
          kind: "forbid",
          value: 0,
          until: op.until,
          forbid: { what: op.what, player: players[0], filter: op.filter, name: op.sameNameAsSelf ? face(ctx, s, frame.card).name : undefined },
        });
        break;
      }

      case "addMarker":
      case "removeMarker": {
        const n = amount(ctx, s, frame, op.n) * (op.op === "addMarker" ? 1 : -1);
        for (const id of resolveRef(ctx, s, frame, op.target)) {
          s.cards[id].markers = Math.max(0, s.cards[id].markers + n);
          ev.push({ type: "markers", card: id, delta: n, total: s.cards[id].markers });
          if (n < 0) pendTriggers(ctx, s, "markerRemoved", id);
        }
        break;
      }

      case "token": {
        const n = amount(ctx, s, frame, op.n);
        const p = sideOf(master, op.side)[0];
        for (let i = 0; i < n; i++) {
          const id = `${p}#token${Object.keys(s.cards).length}`;
          s.cards[id] = {
            id,
            cardId: tokenCardId(op.name, op.power, op.comboCost, op.comboPower, op.colors),
            owner: p,
            mode: "active",
            hidden: false,
            flipped: false,
            markers: 0,
            under: [],
            isToken: true,
            enteredTurn: s.turn,
            extraAttacks: 0,
            usedThisTurn: [],
            usedMarkerSkill: false,
            negated: [],
          };
          s.players[p].battle.push(id);
          ev.push({ type: "token", card: id, owner: p });
          pendTriggers(ctx, s, "played", id);
        }
        break;
      }

      case "costReduction":
      case "negateKeyword":
      case "gains":
      case "replaceLeave":
      case "altCost":
        // Continuous by nature: read by `playCost` and by the counter window,
        // not applied here.
        break;

      case "resolvingPlay": {
        const card = s.resolving?.card;
        if (!card) break;
        if (!op.instead) {
          // The play still happens; `resolvePlay` reads these as the card enters.
          if (op.mode === "rest") s.continuations.playRest = card;
          if (op.negated) s.continuations.playNegated = card;
          break;
        }
        // 9-6: the play is negated. The card never reaches the Battle Area, so
        // the step that would have put it there is dropped and the card goes
        // where the skill says from wherever it was being played from. The
        // energy stays paid — negating a play does not undo the cost.
        s.flow = s.flow.filter((f) => !(f.op === "play.resolve" && f.card === card));
        const owner = s.cards[card].owner;
        note(ev, `${face(ctx, s, card).name} is not played`);
        // "Under" is not an area a card can simply be put in (23-2), and no
        // card says so here; the Drop is the printed default.
        const dest = op.instead === "play" ? "battle" : op.instead === "under" ? "drop" : op.instead;
        move(ctx, s, ev, card, dest, owner, { reason: "effect", position: op.position, reveal: true });
        s.resolving = null;
        break;
      }

      case "negateAttack":
        if (s.battle) {
          s.battle.negated = true;
          ev.push({ type: "attackNegated" });
          // "If you negated a Leader Card's attack with this skill" (20-16).
          const did = (frame.did ??= {});
          did.negateAttack = true;
          if (areaOf(s, s.battle.attacker) === "leader") did.negateLeaderAttack = true;
        }
        break;

      case "negateOwnSkill": {
        // 9-1-5: the skill switches itself off for the rest of the game.
        // `negated` is a list of skill indexes on the instance, so this is the
        // same mechanism another card's negation uses — and it is cleared when
        // the card leaves play, because that is a different card (3-1-4).
        const inst = s.cards[frame.card];
        if (!inst || frame.skillIndex == null || inst.negated === "all" || inst.negated.includes(frame.skillIndex)) break;
        if (op.until === "turn" || op.until === "battle") {
          // "Negate this skill for the turn / for the battle": it comes back,
          // so an effect with a duration rather than a mark on the instance.
          addEffect(s, ev, { target: frame.card, kind: "negateSkill", value: frame.skillIndex, until: op.until });
          note(ev, `${face(ctx, s, frame.card).name}: that skill will not happen again this ${op.until}`);
          break;
        }
        inst.negated.push(frame.skillIndex);
        note(ev, `${face(ctx, s, frame.card).name}: that skill will not happen again`);
        break;
      }

      case "negateCounter": {
        // The counter being answered is the first one still waiting in the
        // flow: this effect is running inside the window opened over it.
        const target = s.flow.find((f) => f.op === "counter.resolve");
        if (target && target.op === "counter.resolve") {
          target.negated = true;
          note(ev, `${face(ctx, s, target.card).name} is countered`);
        }
        break;
      }

      case "play": {
        // 5-5-3: played by a skill, so no energy cost is paid — but a card
        // that may not be played may not be played by a skill either (20-14).
        const targets = resolveRef(ctx, s, frame, op.target).filter((id) => !forbids(ctx, s, "play", { player: master, card: id }));
        if (!targets.length) break;
        const onto = op.onto ? resolveRef(ctx, s, frame, op.onto)[0] : undefined;
        const steps: FlowStep[] = [];
        for (const id of targets) steps.push({ op: "play.resolve", card: id, player: master, mode: op.mode, onto, negated: op.negated });
        (frame.did ??= {}).play = true;
        frame.ip++;
        steps.push({ op: "script.step", frame });
        s.flow.unshift(...steps);
        return "done";
      }

      case "delay":
        // The variables are copied, not shared: a later `choose` in this same
        // program must not change what the delayed part points at.
        schedule(s, ev, {
          at: op.at,
          scope: op.scope ?? "thisTurn",
          ops: op.ops,
          card: frame.card,
          master,
          vars: { ...frame.vars },
          subject: frame.subject,
          label: op.label ?? DELAY_LABELS[op.at],
        });
        break;

      case "if": {
        const branch = condHolds(ctx, s, frame, op.cond) ? op.then : (op.else ?? []);
        // Splice the branch in place of the `if`, keeping one frame.
        frame.ops = [...frame.ops.slice(0, frame.ip), ...branch, ...frame.ops.slice(frame.ip + 1)];
        continue;
      }

      case "chooseMode": {
        // 20-2: the option is chosen as the skill resolves, and only then does
        // the rest of the program exist — so it is spliced in like an `if`.
        if (s.lastMode != null && frame.awaiting === "mode") {
          const picked = op.modes[s.lastMode] ?? op.modes[0];
          s.lastMode = null;
          frame.awaiting = undefined;
          frame.ops = [...frame.ops.slice(0, frame.ip), ...(picked?.ops ?? []), ...frame.ops.slice(frame.ip + 1)];
          continue;
        }
        // A single option is not a choice, and an empty one is not asked about.
        const usable = op.modes.filter((mode) => mode.ops.length);
        if (usable.length <= 1) {
          frame.ops = [...frame.ops.slice(0, frame.ip), ...(usable[0]?.ops ?? []), ...frame.ops.slice(frame.ip + 1)];
          continue;
        }
        frame.awaiting = "mode";
        s.flow.unshift({ op: "script.step", frame });
        s.prompt = { kind: "chooseMode", player: master, reason: op.reason ?? `${face(ctx, s, frame.card).name}: choose one`, options: op.modes.map((mode) => mode.label) };
        return "wait";
      }
    }
    frame.ip++;
  }
  note(ev, "effect did not finish: too many steps");
  return "done";
}

function shuffleDeck(s: GameState, players: PlayerId[]): void {
  // Uses the game's RNG so a replay reproduces the order exactly.
  for (const p of players) {
    const deck = s.players[p].deck;
    let state = s.rngState;
    for (let i = deck.length - 1; i > 0; i--) {
      const t = (state + 0x6d2b79f5) | 0;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      state = t;
      const j = Math.floor((((r ^ (r >>> 14)) >>> 0) / 4294967296) * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    s.rngState = state;
  }
}

// ── validation, for programs that did not come from the compiler ───────────

const OP_NAMES = new Set<Op["op"]>([
  "draw",
  "discard",
  "damage",
  "mill",
  "addLife",
  "lifeDownTo",
  "shuffle",
  "energyMarker",
  "choose",
  "look",
  "reveal",
  "ko",
  "moveTo",
  "play",
  "switchMode",
  "power",
  "comboPower",
  "grant",
  "negateSkills",
  "hidden",
  "redirectAttack",
  "comboFrom",
  "flip",
  "addMarker",
  "removeMarker",
  "token",
  "negateAttack",
  "negateCounter",
  "negateOwnSkill",
  "cannotAttack",
  "forbid",
  "costReduction",
  "negateSkillsOfKind",
  "resolvingPlay",
  "negateKeyword",
  "gains",
  "replaceLeave",
  "altCost",
  "if",
  "chooseMode",
  "delay",
  "note",
]);

const DELAY_TIMINGS = new Set<DelayTiming>(["turnStart", "mainStart", "turnEnd", "turnCleanup", "battleEnd"]);
const DELAY_SCOPES = new Set<DelayScope>(["thisTurn", "nextTurn", "yourNextTurn", "opponentNextTurn"]);

/**
 * Structural check for a program supplied by the referee. It only proves the
 * shape is executable — the engine still enforces every rule while running it,
 * so a bad ruling can be wrong but never illegal.
 */
export function validateProgram(ops: unknown, depth = 0): ops is Op[] {
  if (!Array.isArray(ops) || depth > 4) return false;
  return ops.every((raw) => {
    if (!raw || typeof raw !== "object") return false;
    const o = raw as { op?: unknown; then?: unknown; else?: unknown; ops?: unknown; at?: unknown; scope?: unknown; modes?: unknown[] };
    if (typeof o.op !== "string" || !OP_NAMES.has(o.op as Op["op"])) return false;
    if (o.op === "if") return validateProgram(o.then, depth + 1) && (o.else === undefined || validateProgram(o.else, depth + 1));
    if (o.op === "chooseMode") return Array.isArray(o.modes) && o.modes.length > 0 && o.modes.every((mode) => validateProgram((mode as { ops?: unknown }).ops, depth + 1));
    // A delay with a timing the engine never drains would sit in the state for
    // the rest of the game, so the timing is checked as well as the shape.
    if (o.op === "delay") {
      if (!DELAY_TIMINGS.has(o.at as DelayTiming)) return false;
      if (o.scope !== undefined && !DELAY_SCOPES.has(o.scope as DelayScope)) return false;
      return validateProgram(o.ops, depth + 1);
    }
    return true;
  });
}
