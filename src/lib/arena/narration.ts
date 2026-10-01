/**
 * The opponent's turn, spelled out (`docs/arena-workflow-spec.md` §7, Phase 3).
 *
 * One sentence per beat that is worth one, from the beat stream alone: the same
 * `art` the beats carry for their faces gives the names, `owner` on the `skill`
 * beat says whose ability it was, and the viewer decides who is "you". The
 * board binds it to the beat on screen, so the words and the motion tell the
 * same story in the same order, and holds the last sentence after playback
 * stops so a turn that went past too fast can still be read.
 *
 * **Decisions and outcomes only** (#463). The board already shows every phase,
 * every Rest/Active switch, every draw and every life card flying to a hand;
 * a sentence restating each one buried the few that mattered under three times
 * as many that did not (246 lines in a 5-turn game). What is said is the
 * design's `say()` (`docs/arena-redesign/prototype/arena.js`): a turn
 * beginning, a charge, a play, a combo, a skill or an Extra used, an attack and
 * a block, one result line per battle, a KO, an awakening, an effect on power
 * or keywords, the end of the game, and the opponent's table talk. Every other
 * beat narrates `null` — it still animates, and the ribbon keeps the sentence
 * before it. `{ full: true }` is every beat, for the admin drawer, the probe's
 * log and the post-game review, which read the engine rather than the table.
 *
 * **A card is named only where the viewer saw it.** `art` is already masked
 * against the board as it stands (`maskBeats`), but a card that is public *now*
 * may have been hidden at the beat — a hand card bottom-decked in a mulligan
 * and drawn and played later. So a move between two areas the viewer cannot
 * see into names its card only on the beat's own `reveal`, never because its
 * face happens to be in `art`.
 *
 * Pure and React-free — covered by `npm test`. The Android app does not
 * narrate yet (`android/contract` decodes beats only), so there is no Kotlin
 * table to keep in step.
 */
import type { Area, PlayerId } from "./types";
import type { Beat, BeatArt } from "./beats";
import { untilWords } from "./effects";
import { dbsWords, type BoardWords } from "./board-words";

export interface Narrator {
  /** Whose side of the table the sentence is read from. */
  viewer: PlayerId;
  /** The other player's name — "Claude" in a game against the model. */
  them: string;
  /** Faces for every card a beat names, keyed by instance id. */
  art: Record<string, BeatArt>;
  /** Whose card an instance is; the beats do not always say. */
  ownerOf?: (card: string) => PlayerId | null;
}

export interface NarrateOptions {
  /** Every beat gets its sentence, not only the decisions and outcomes. */
  full?: boolean;
}

/** The effect kinds the table hears about: what changes a fight's numbers or a card's keywords. */
const TOLD_EFFECTS = new Set(["power", "comboPower", "keyword"]);

/**
 * One sentence for a beat, or null for a beat with nothing to say — which,
 * by default, is most of them (see above).
 */
export function narrate(b: Beat, n: Narrator, words: BoardWords = dbsWords(), opts: NarrateOptions = {}): string | null {
  const s = sentence(b, n, words, !!opts.full);
  // "a card goes back into the deck" opens with the stand-in for a hidden name.
  return s && s.charAt(0).toUpperCase() + s.slice(1);
}

function sentence(b: Beat, n: Narrator, words: BoardWords, full: boolean): string | null {
  const PHASE = words.phase;
  const AREA = words.narrationArea;
  const name = (id: string) => n.art[id]?.name ?? "a card";
  const you = (p: PlayerId | null | undefined) => p === n.viewer;
  /** "You play" / "Claude plays". */
  const who = (p: PlayerId | null | undefined, verb: string, third: string) => (you(p) ? `You ${verb}` : `${n.them} ${third}`);
  const owner = (card: string) => n.ownerOf?.(card) ?? null;
  const poss = (p: PlayerId | null | undefined) => (you(p) ? "your" : `${n.them}'s`);
  /** An area whose cards this viewer cannot read: any deck or life, and the other player's hand or Z-Deck. */
  const unseen = (area: Area, o: PlayerId) => area === "deck" || area === "life" || ((area === "hand" || area === "zDeck") && !you(o));

  switch (b.t) {
    case "phase": {
      const label = PHASE[b.phase] ?? b.phase;
      // The Charge Phase is the first thing a turn does (7-2), so it is the
      // turn beginning — said even when it is skipped, since the turn is not.
      if (!full) {
        if (b.phase !== "charge") return null;
        const skipped = b.skipped ? ` — ${you(b.player) ? "you skip" : `${n.them} skips`} the ${label}` : "";
        return `${you(b.player) ? "Your" : `${n.them}'s`} turn begins${skipped}.`;
      }
      const whose = b.phase === "charge" || b.phase === "main" || b.phase === "end";
      // 20-13: the moment is announced and then does not happen. Said as the
      // thing that was refused rather than as the thing that occurred, because
      // a board that printed "Your Charge Phase." and then drew nothing, stood
      // nothing up and asked nothing would read as a bug.
      if (b.skipped) {
        if (whose) return `${who(b.player, "skip", "skips")} the ${label}.`;
        return `The ${label} is skipped.`;
      }
      if (whose) return `${you(b.player) ? "Your" : `${n.them}'s`} ${label}.`;
      return `${label}.`;
    }
    case "draw":
      if (!full) return null;
      return b.card ? `${who(b.player, "draw", "draws")} ${you(b.player) ? name(b.card) : "a card"}.` : `${who(b.player, "draw", "draws")} a card.`;
    case "move": {
      const o = b.owner;
      // Hidden at both ends and not revealed: nobody at the table saw which
      // card it was, whatever `art` knows about it now.
      const c = unseen(b.from, o) && unseen(b.to, o) && !b.reveal ? "a card" : name(b.card);
      if (b.to === "energy" && b.from === "hand") return `${who(o, "charge", "charges")} ${c} as energy.`;
      if (b.to === "battle" && b.from === "hand") return `${who(o, "play", "plays")} ${c}.`;
      if (b.to === "battle") return `${c} enters the Battle Area from ${AREA[b.from]}.`;
      if (b.to === "unison") return `${who(o, "play", "plays")} Unison ${c}.`;
      if (b.to === "combo") return `${who(o, "combo", "combos")} with ${c}.`;
      // #272: revealed (BT10-031/SD18-01's "you may reveal it and add it to
      // your hand instead") is the one way a life card's move to hand is
      // shown to the opponent. Said on the beat's own `reveal` (#463) — the
      // face being in `art` only means the card is public *now*.
      if (b.to === "hand" && b.from === "life") {
        if (b.reveal && n.art[b.card]) return `${who(o, "reveal", "reveals")} ${name(b.card)} and takes it into hand.`;
        return full ? `${who(o, "take", "takes")} a life card into hand.` : null;
      }
      if (!full) return null;
      if (b.to === "energy") return `${c} goes to the Energy Area.`;
      if (b.to === "hand" && b.from === "deck") return `${who(o, "add", "adds")} ${you(o) ? c : "a card"} from the deck to hand.`;
      if (b.to === "hand") return `${c} returns to ${poss(o)} hand.`;
      if (b.to === "drop" && b.from === "hand") return `${who(o, "discard", "discards")} ${c}.`;
      if (b.to === "drop" && b.from === "combo") return `${c} goes to the Drop after the battle.`;
      if (b.to === "drop") return `${c} goes to the Drop.`;
      if (b.to === "warp") return `${c} is sent to the Warp.`;
      if (b.to === "deck") return `${c} goes back into the deck.`;
      if (b.to === "life") return `${c} becomes a life card.`;
      if (b.to === "removed") return `${c} is removed from the game.`;
      return `${c} moves from ${AREA[b.from]} to ${AREA[b.to]}.`;
    }
    case "mode":
      return full ? `${name(b.card)} switches to ${words.mode[b.mode === "rest" ? "rest" : "active"]}.` : null;
    case "flip":
      return `${name(b.card)} awakens!`;
    case "markers":
      if (!full) return null;
      // [Empower], 22-45-3: named both cards, since the markers came *from*
      // the Unison that just left rather than appearing on the new one.
      if (b.from) return `${b.delta} marker${b.delta === 1 ? "" : "s"} move${b.delta === 1 ? "s" : ""} from ${name(b.from)} to ${name(b.card)}.`;
      return b.delta >= 0 ? `${name(b.card)} gains ${b.delta} marker${b.delta === 1 ? "" : "s"} (${b.total}).` : `${name(b.card)} loses ${-b.delta} marker${b.delta === -1 ? "" : "s"} (${b.total}).`;
    case "token":
      return full ? `${who(b.owner, "get", "gets")} a ${name(b.card)} token.` : null;
    case "attack":
      return `${name(b.attacker)} attacks ${name(b.target)}.`;
    case "block":
      return `${name(b.by)} blocks.`;
    case "clash": {
      const figures = `${b.attackPower.toLocaleString("en")} vs ${b.guardPower.toLocaleString("en")}`;
      // One result line per battle: a hit is told by what it did — the
      // damage (`damage.by`) or the KO that follows — and a miss here.
      if (!full) return b.hit ? null : `${name(b.attacker)}'s attack is repelled — ${figures}.`;
      // The winner is named first and the figures follow, always in
      // attack-vs-guard order. The old sentence led with two numbers and left
      // the reader to work out which card had won with them.
      const won = b.hit ? name(b.attacker) : name(b.guard);
      return `${won} wins the clash — ${figures}. ${b.hit ? "The attack hits." : "The attack is repelled."}`;
    }
    case "damage": {
      const amount = `${b.amount} damage${b.critical ? " — Critical" : ""}.`;
      if (b.by) return `${name(b.by)} hits — ${you(b.player) ? "you take" : `${n.them} takes`} ${amount}`;
      return `${who(b.player, "take", "takes")} ${amount}`;
    }
    case "ko": {
      const o = b.owner ?? owner(b.card);
      return o ? `${poss(o) === "your" ? "Your" : poss(o)} ${name(b.card)} is KO'd.` : `${name(b.card)} is KO'd.`;
    }
    case "negated":
      // 8-1-6-1 sends a negated attack straight to the Battle End Step, so
      // neither player reaches a combo window. Saying only "negated" left the
      // attacker looking for the Offense Step they never got.
      return "The attack is negated — the battle ends here, with no Offense or Defense Step.";
    case "skill": {
      // `maskBeats` blanks a skill whose card the viewer may not see (#463):
      // the moment is told, the card and its words are not.
      if (!n.art[b.card]) return `${who(b.owner, "use", "uses")} a skill.`;
      const clause = b.text.replace(/\s+/g, " ").trim().replace(/\.$/, "");
      const short = clause.length > 90 ? `${clause.slice(0, 88)}…` : clause;
      const what = b.noEffect ? "no target, so nothing happens" : short;
      const ruled = b.unread ? " (Claude ruled on this)" : "";
      // An Extra is used, not discarded (4-2, 12-2-2): its trip to the Drop
      // is the using of it, and is folded in here.
      if (b.extra) return `${who(b.owner, "use", "uses")} ${name(b.card)} (Extra) — ${what}${ruled}.`;
      return `${who(b.owner, "use", "uses")} 《${b.label}》 on ${name(b.card)} — ${what}${ruled}.`;
    }
    case "effect": {
      if (!full && !TOLD_EFFECTS.has(b.kind)) return null;
      // A rule coming into force, read from the viewer's chair: whose card,
      // what it now does, and for how long. The label is a phrase already
      // ("+5000 power", "can't attack"), so only the verb varies by kind.
      const when = untilWords(b.until, { master: b.owner, viewer: n.viewer, them: n.them, sourceName: b.source ? name(b.source) : null }, words);
      const subject = b.card ? name(b.card) : b.player ? (you(b.player) ? "You" : n.them) : "Both players";
      const verb = b.kind === "power" || b.kind === "comboPower" ? "gets" : b.kind === "keyword" ? "gains" : b.kind === "negate" ? "has its" : "";
      const from = b.source && b.source !== b.card ? ` (${name(b.source)})` : "";
      return `${subject}${verb ? ` ${verb}` : ""} ${b.label} ${when}${from}.`;
    }
    case "effectEnded": {
      if (!full) return null;
      const subject = b.card ? name(b.card) : b.player ? (you(b.player) ? "you" : n.them) : "both players";
      return `${b.label} on ${subject} wears off.`;
    }
    case "say":
      return `${n.them}: “${b.text}”`;
    case "over":
      if (!b.winner) return `A draw — ${b.reason}.`;
      return `${you(b.winner) ? "You win" : `${n.them} wins`} — ${b.reason}.`;
  }
}
