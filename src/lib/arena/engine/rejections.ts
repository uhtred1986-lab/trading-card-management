import { skillsOf } from "./cards";
import { cardsInPlay, def, face, forbiddenBy, has, skillsNegated, skillsOfInstance } from "./state";
import type { EngineContext, LegalAction } from "./engine";
import type { Action, CounterWindow, GameState, PlayerId, RejectedAction, Requirement, Skill } from "./types";
import { other, PLAYERS } from "./types";

export interface RejectionDeps {
  whyNotCharge: (ctx: EngineContext, s: GameState, p: PlayerId) => Requirement[];
  whyNotPlayFromHand: (ctx: EngineContext, s: GameState, p: PlayerId, card: string) => Requirement[] | null;
  whyNotAttack: (ctx: EngineContext, s: GameState, p: PlayerId, card: string) => Requirement[] | null;
  whyNotCombo: (ctx: EngineContext, s: GameState, p: PlayerId, card: string) => Requirement[];
  whyNotCounter: (ctx: EngineContext, s: GameState, p: PlayerId, card: string, window: CounterWindow, candidates: string[]) => Requirement[] | null;
  whyNotActivate: (ctx: EngineContext, s: GameState, p: PlayerId, card: string, sk: Skill, timing: "main" | "battle") => Requirement[] | null;
  modeWhy: (ctx: EngineContext, s: GameState, card: string) => Requirement;
  cardOf: (a: Action) => string | null;
}

// ── rejected actions ───────────────────────────────────────────────────────
//
// `docs/arena-workflow-spec.md`. `legalActions` says what the server will
// accept and nothing else; a card the player cannot play is simply absent
// from it. This is the parallel list — the moves a player might reach for and
// every requirement that stops each one — so a tap on a dead card has an
// answer that comes from the rules rather than from a client's guess.
//
// The gates in `mainActions` are named predicates (`planPayment`, `canPlay`,
// `canCombo`, `activatable`, `forbids`), and each has a `whyNot*` twin beside
// it that runs the same tests in the same order, collecting instead of
// short-circuiting. The predicates themselves are untouched: they run on
// every enumeration, including Claude's, and threading a reason collector
// through them is the cost this duplication buys out of. Each pair is
// adjacent in the file and covered by the same test so they cannot drift.

/**
 * Every move the asked player might expect that is not on the menu, with
 * the reasons. At most one entry per card per action type, and never an
 * action that `legal` already offers for that card — the invariant
 * `scripts/verify-arena.ts` and `arena:playthrough` both assert.
 *
 * `legal` may be passed in when the caller already has it (the snapshot
 * does), so the menu is not enumerated a second time.
 */
export function rejectedActions(ctx: EngineContext, s: GameState, legal: LegalAction[], deps: RejectionDeps): RejectedAction[] {
  const pr = s.prompt;
  if (!("player" in pr) || !pr.player) return [];
  const p = pr.player;
  const out: RejectedAction[] = [];
  const name = (id: string) => face(ctx, s, id).name;
  // "play:p1#3", "activate:p1#3#20" — the entries the menu already offers.
  // Anything offered is not rejected, and a card playable by its alternative
  // price is playable.
  //
  // An activation carries its *skill index* in the key, and everything else
  // only its card. A card prints up to nine skill lines, and one of them being
  // on the menu says nothing about the others: keyed by the card alone, the
  // first line answered for all of them, and 678 of the catalog's rules were
  // refused with no reason at all because a rejection filed under skill 0
  // cannot answer a question about skill 20. An [Invoker]'s alternative price
  // is still the same skill under the same index, so it is still one entry.
  // §3.2's cap is unchanged for play, charge, attack, combo, counter and block.
  const keyOf = (a: Action) => `${a.type}:${deps.cardOf(a) ?? ""}${a.type === "activate" ? `#${a.skill}` : ""}`;
  const offered = new Set(legal.map((l) => keyOf(l.action)));
  const seen = new Set<string>();
  const push = (action: Action, label: string, why: Requirement[]) => {
    const key = keyOf(action);
    if (offered.has(key) || seen.has(key)) return;
    seen.add(key);
    // Never empty: a twin that found nothing is a drifted twin, and an `other`
    // here is what the playthrough audit counts.
    out.push({ action, label, why: why.length ? why : [{ kind: "other", detail: "not offered by the engine" }] });
  };
  /**
   * The skills to explain for a card in play. `skillsOfInstance` is what the
   * menu reads, and it empties a card whose skills a continuous effect has
   * negated (9-1-5) — so asking it here would leave that card out of *both*
   * lists and the board with no reason to give. The printed skills are the
   * ones to explain in that case; `whyNotActivate` names the negation, and
   * `offered` keeps anything actually on the menu out of the rejected list.
   */
  const skillsToExplain = (id: string) => (skillsNegated(s, id) ? skillsOf(def(ctx, s, id), s.cards[id].flipped && def(ctx, s, id).back ? "back" : "front") : skillsOfInstance(ctx, s, id));
  /**
   * A card can now carry one rejection per skill line, so the label has to say
   * *which* line, the way the menu's own label does — three greyed rows all
   * reading "Activate Piccolo" is the move nobody can identify. The keyword
   * names itself; a text skill is named by the start of its effect, which is
   * the same 40 characters `activatable` puts on the menu.
   */
  function activateLabel(id: string, sk: Skill): string {
    const what = sk.keyword ? `[${sk.keyword.name}]` : sk.effect.slice(0, 40);
    return what ? `Activate ${name(id)}: ${what}` : `Activate ${name(id)}`;
  }
  /**
   * Every skill of the card that is a real activation, with its reasons — one
   * rejection each, because one rule is one skill line and a player reaching
   * for the third one is owed an answer about the third one. A `why` that is
   * null is a skill never declared at all (an [Auto], a [Permanent], a keyword
   * with no activation of its own) and invents nothing; an empty one is a
   * skill the menu is offering, which `offered` drops.
   */
  const rejectActivate = (id: string, skills: Skill[], timing: "main" | "battle") => {
    for (const sk of skills) {
      const why = deps.whyNotActivate(ctx, s, p, id, sk, timing);
      if (!why) continue;
      push({ type: "activate", player: p, card: id, skill: sk.index }, activateLabel(id, sk), why);
    }
  };

  switch (pr.kind) {
    case "charge":
      for (const id of s.players[p].hand) push({ type: "charge", player: p, card: id }, `Charge ${name(id)}`, deps.whyNotCharge(ctx, s, p));
      return out;
    case "main": {
      const ps = s.players[p];
      for (const id of ps.hand) {
        const d = def(ctx, s, id);
        const why = deps.whyNotPlayFromHand(ctx, s, p, id);
        if (why) push({ type: "play", player: p, card: id }, `Play ${name(id)} (${d.energyCost ?? 0})`, why);
        rejectActivate(id, skillsOf(d), "main");
        push({ type: "charge", player: p, card: id }, `Charge ${name(id)}`, deps.whyNotCharge(ctx, s, p));
      }
      for (const id of cardsInPlay(s, p)) {
        rejectActivate(id, skillsToExplain(id), "main");
        const why = deps.whyNotAttack(ctx, s, p, id);
        if (why) push({ type: "attack", player: p, attacker: id, target: s.players[other(p)].leader }, `Attack with ${name(id)}`, why);
      }
      return out;
    }
    case "combo": {
      const ps = s.players[p];
      for (const id of ps.hand) {
        push({ type: "combo", player: p, card: id }, `Combo ${name(id)}`, deps.whyNotCombo(ctx, s, p, id));
        rejectActivate(id, skillsOf(def(ctx, s, id)), "battle");
      }
      for (const id of ps.battle) push({ type: "combo", player: p, card: id }, `Combo ${name(id)}`, deps.whyNotCombo(ctx, s, p, id));
      for (const id of cardsInPlay(s, p)) rejectActivate(id, skillsToExplain(id), "battle");
      return out;
    }
    case "counter": {
      // Every counter card in hand that is not on the menu: a candidate the
      // energy cannot cover, a counter for another moment, or one the compiler
      // cannot read — the same gates `counterCandidates` and the menu apply.
      for (const id of s.players[p].hand) {
        const why = deps.whyNotCounter(ctx, s, p, id, pr.window, pr.candidates);
        if (why) push({ type: "counter", player: p, card: id }, `Counter with ${name(id)}`, why);
      }
      return out;
    }
    case "blocker": {
      // A [Blocker] that is not offered: resting, or forbidden to block.
      const b = s.battle;
      for (const id of cardsInPlay(s, p)) {
        if (pr.candidates.includes(id) || !has(ctx, s, id, "Blocker")) continue;
        const why: Requirement[] = [];
        if (b && id === b.guard) why.push({ kind: "other", detail: "it is the card being attacked" });
        if (s.cards[id].mode !== "active") why.push(deps.modeWhy(ctx, s, id));
        const f = forbiddenBy(ctx, s, "block", { player: p, card: id });
        if (f) why.push({ kind: "forbidden", by: f.by, until: f.until });
        push({ type: "block", player: p, card: id }, `Block with ${name(id)}`, why);
      }
      return out;
    }
    case "chooseCards": {
      // A card on the table the prompt does not offer: [Barrier] or another
      // rule keeps it from being chosen (22-16, 20-14), or it is simply not
      // what the skill asks for — the prompt's own reason says what is.
      const offered = new Set(pr.choice.candidates);
      for (const side of PLAYERS) {
        for (const id of [...cardsInPlay(s, side), ...(side === p ? s.players[p].hand : [])]) {
          if (offered.has(id) || s.cards[id].hidden) continue;
          const f = forbiddenBy(ctx, s, "beChosen", { card: id });
          const why: Requirement[] = f
            ? [{ kind: "forbidden", by: f.by, until: f.until }]
            : has(ctx, s, id, "Barrier")
              ? [{ kind: "forbidden", by: name(id), until: "permanent" }]
              : [{ kind: "target", reason: pr.choice.reason }];
          push({ type: "choose", player: p, cards: [id] }, `Choose ${name(id)}`, why);
        }
      }
      return out;
    }
    default:
      return out;
  }
}
