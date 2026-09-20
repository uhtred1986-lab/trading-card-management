/**
 * What a client animates, from the events a rules game logs.
 *
 * `beats.ts` is the legacy engine's translation of the same thing, and it is a
 * translation rather than a passthrough: several events have no picture and
 * collapse to nothing. This is that translation for the events *this* engine
 * emits — a phase beginning, a card moving, a draw, a mode change, an energy
 * marker, an effect coming into force or ending, the game ending, and, since
 * #152, the battle sub-flow's own events (`vm/battle.ts`, #150) — an attack
 * declared, a guard changing, the power compare, damage, a KO, a negated
 * attack and a skill firing, each drawn to the identical `Beat` shape
 * `beats.ts` draws it to, off the same `GameEvent` union both engines log
 * into. It deliberately covers no more than the engine can produce, and an
 * empty case is how a reader tells "nothing to show" (`"stack"`, 23-2 — the
 * moved card's own `move` beat already covers its arrival, `beats.ts`'s own
 * reading) from "not built yet".
 *
 * The one thing it must do exactly as `beats.ts` does is `art`: a beat carries
 * the face of the card it names **as it was at event time**, because a card
 * that has left the board cannot be looked up afterwards. Names are read
 * through the declared attributes (`./cards.ts`), so the catalog is reached
 * through the one adapter here too.
 *
 * Pure: no database, no images. `session.ts` fills in the image URLs, which is
 * what keeps this testable in `npm test`.
 */
import type { EngineContext, GameEvent } from "../engine";
import type { Beat, BeatArt, Beats, NumberedBeat } from "../beats";
import { SKILL_LABELS } from "../beats";
import { describeEffect } from "../effects";
import { rulesetFor } from "../rulesets";
import { attrsOf } from "./cards";
import { skillsShowing } from "./triggers";
import type { VmState } from "./state";

/**
 * One batch of events, numbered from `after`.
 *
 * `after` is the seq the queue is already at, so beats keep climbing across
 * the several `apply()` calls one turn takes.
 */
export function vmToBeats(ctx: EngineContext, state: VmState, events: GameEvent[], after = 0): Beats {
  const list: NumberedBeat[] = [];
  const art: Record<string, BeatArt> = {};
  let n = after;
  const push = (b: Beat) => list.push({ ...b, n: ++n } as NumberedBeat);

  const loaded = rulesetFor(state.game);
  const game = loaded.ok ? loaded.definition : null;

  /** Remember a card as it is *now*, before it leaves the board for good. */
  const remember = (id: string) => {
    if (art[id]) return;
    const inst = state.cards[id];
    if (!inst) return;
    const def = ctx.defs[inst.cardId];
    const named = def && game ? attrsOf(def, game).attrs.name : undefined;
    art[id] = { cardId: inst.cardId, name: typeof named === "string" ? named : inst.cardId, imageUrl: null };
  };

  for (const e of events) {
    switch (e.type) {
      case "phase":
        push({ t: "phase", phase: e.phase, player: e.player, turn: e.turn });
        break;
      // A battle step is a named step like a phase is (`beats.ts`'s own
      // reading) — the same `t: "phase"` beat, narrated without a side.
      case "battleStep":
        push({ t: "phase", phase: e.step, player: state.turnPlayer, turn: state.turn });
        break;
      case "draw":
        remember(e.card);
        push({ t: "draw", player: e.player, card: e.card });
        break;
      case "move":
        remember(e.card);
        push({ t: "move", card: e.card, from: e.from, to: e.to, owner: e.owner });
        break;
      case "mode":
        push({ t: "mode", card: e.card, mode: e.mode });
        break;
      case "flip":
        // Only the awakening (`beats.ts`'s own reading) — a leader turning
        // back has no moment to show.
        if (e.flipped) {
          remember(e.card);
          push({ t: "flip", card: e.card });
        }
        break;
      case "markers":
        remember(e.card);
        if (e.from) remember(e.from);
        push({ t: "markers", card: e.card, delta: e.delta, total: e.total, ...(e.from ? { from: e.from } : {}) });
        break;
      case "token":
        remember(e.card);
        push({ t: "token", card: e.card, owner: e.owner });
        break;
      case "attack":
        remember(e.attacker);
        remember(e.target);
        push({ t: "attack", attacker: e.attacker, target: e.target });
        break;
      case "guardChanged":
        remember(e.guard);
        remember(e.by);
        push({ t: "block", guard: e.guard, by: e.by });
        break;
      case "powerCompare":
        remember(e.attacker);
        remember(e.guard);
        push({ t: "clash", attacker: e.attacker, guard: e.guard, attackPower: e.attackPower, guardPower: e.guardPower, hit: e.hit });
        break;
      case "damage":
        for (const c of e.cards) remember(c);
        push({ t: "damage", player: e.player, amount: e.amount, critical: e.critical, cards: e.cards });
        break;
      case "ko":
        remember(e.card);
        push({ t: "ko", card: e.card, owner: state.cards[e.card].owner });
        break;
      case "attackNegated":
        push({ t: "negated" });
        break;
      // A card's own skill firing (9-6), inside a battle or not — the same
      // reading `beats.ts`'s `describeSkillEvent` makes, off this engine's own
      // `skillsShowing`/`programsOf` rather than the legacy `scriptsOfInstance`.
      case "skill": {
        const inst = state.cards[e.card];
        if (inst) {
          const showing = skillsShowing(ctx, state, e.card);
          const sk = showing.skills.find((x) => x.index === e.skill);
          const compiled = showing.scripts.bySkill[e.skill];
          remember(e.card);
          push({
            t: "skill",
            card: e.card,
            label: sk?.tags[0] ?? SKILL_LABELS[sk?.kind ?? ""] ?? "Skill",
            text: e.text.replace(/\s+/g, " ").trim(),
            unread: !!compiled?.unsupported.length,
            owner: e.master,
            inBattle: e.inBattle,
          });
        }
        break;
      }
      // A rule coming into force or ending (9-1-4), drawn exactly as
      // `beats.ts` draws it: the same `describeEffect` label, and a card the
      // beat names only while it can still bring a face (contract §4).
      case "effect":
      case "effectEnded": {
        const fx = e.effect;
        const card = fx.target && state.cards[fx.target] ? fx.target : null;
        const source = fx.source && state.cards[fx.source] ? fx.source : null;
        if (card) remember(card);
        if (source) remember(source);
        const d = describeEffect(fx);
        const player = card ? null : (fx.forbid?.player ?? null);
        if (e.type === "effect") push({ t: "effect", card, player, kind: d.kind, label: d.label, until: fx.until, source, owner: fx.master });
        else push({ t: "effectEnded", card, player, kind: d.kind, label: d.label, source });
        break;
      }
      case "gameOver":
        push({ t: "over", winner: e.winner, reason: e.reason });
        break;
      // The events with no picture. `gameStart`, `action` and `energyMarker`
      // are the board's own state and are read off the view rather than
      // animated; a `note` is a line in the log. `beats.ts` drops the same
      // three for the same reason.
      case "gameStart":
      case "action":
      case "energyMarker":
      case "note":
        break;
      // Everything else is a shape this engine cannot produce yet — a battle,
      // a skill. Left to the issue that builds
      // the mechanism rather than answered with a beat drawn from nothing.
      default:
        break;
    }
  }
  return { seq: n, list, art };
}
