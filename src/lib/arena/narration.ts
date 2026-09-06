/**
 * The opponent's turn, spelled out (`docs/arena-workflow-spec.md` §7, Phase 3).
 *
 * One sentence per beat, from the beat stream alone: the same `art` the beats
 * carry for their faces gives the names, `owner` on the `skill` beat says whose
 * ability it was, and the viewer decides who is "you". The board binds it to
 * the beat on screen, so the words and the motion tell the same story in the
 * same order, and holds the last sentence after playback stops so a turn that
 * went past too fast can still be read.
 *
 * Pure and React-free — covered by `npm test`, and the table the Android app
 * carries in Kotlin.
 */
import type { Area, PlayerId } from "./engine";
import type { Beat, BeatArt } from "./beats";

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

const PHASE: Record<string, string> = {
  charge: "Charge Phase",
  main: "Main Phase",
  mainEnd: "Main Phase ends",
  end: "End Phase",
  declared: "Attack declared",
  offense: "Offense Step",
  defense: "Defense Step",
  damage: "Damage Step",
  battleEnd: "The battle ends",
  setup: "Setting up",
  over: "The game is over",
};

const AREA: Record<Area, string> = {
  deck: "the deck",
  hand: "hand",
  drop: "the Drop",
  leader: "the Leader Area",
  battle: "the Battle Area",
  combo: "the Combo Area",
  energy: "the Energy Area",
  life: "life",
  warp: "the Warp",
  unison: "the Unison Area",
  zDeck: "the Z-Deck",
  zEnergy: "Z-Energy",
  removed: "out of the game",
};

/** One sentence for a beat, or null for a beat with nothing to say. */
export function narrate(b: Beat, n: Narrator): string | null {
  const name = (id: string) => n.art[id]?.name ?? "a card";
  const you = (p: PlayerId | null | undefined) => p === n.viewer;
  /** "You play" / "Claude plays". */
  const who = (p: PlayerId | null | undefined, verb: string, third: string) => (you(p) ? `You ${verb}` : `${n.them} ${third}`);
  const owner = (card: string) => n.ownerOf?.(card) ?? null;
  const poss = (p: PlayerId | null | undefined) => (you(p) ? "your" : `${n.them}'s`);

  switch (b.t) {
    case "phase": {
      const label = PHASE[b.phase] ?? b.phase;
      if (b.phase === "charge" || b.phase === "main" || b.phase === "end") return `${you(b.player) ? "Your" : `${n.them}'s`} ${label}.`;
      return `${label}.`;
    }
    case "draw":
      return b.card ? `${who(b.player, "draw", "draws")} ${you(b.player) ? name(b.card) : "a card"}.` : `${who(b.player, "draw", "draws")} a card.`;
    case "move": {
      const c = name(b.card);
      const o = b.owner;
      if (b.to === "energy") return `${who(o, "charge", "charges")} ${c} as energy.`;
      if (b.to === "battle" && b.from === "hand") return `${who(o, "play", "plays")} ${c}.`;
      if (b.to === "battle") return `${c} enters the Battle Area from ${AREA[b.from]}.`;
      if (b.to === "unison") return `${who(o, "play", "plays")} Unison ${c}.`;
      if (b.to === "combo") return `${who(o, "combo", "combos")} with ${c}.`;
      if (b.to === "hand" && b.from === "life") return `${who(o, "take", "takes")} a life card into hand.`;
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
      return `${name(b.card)} switches to ${b.mode === "rest" ? "Rest" : "Active"} Mode.`;
    case "flip":
      return `${name(b.card)} awakens!`;
    case "markers":
      return b.delta >= 0 ? `${name(b.card)} gains ${b.delta} marker${b.delta === 1 ? "" : "s"} (${b.total}).` : `${name(b.card)} loses ${-b.delta} marker${b.delta === -1 ? "" : "s"} (${b.total}).`;
    case "token":
      return `${who(b.owner, "get", "gets")} a ${name(b.card)} token.`;
    case "attack":
      return `${name(b.attacker)} attacks ${name(b.target)}.`;
    case "block":
      return `${name(b.by)} blocks.`;
    case "clash":
      return `${b.attackPower.toLocaleString("en")} vs ${b.guardPower.toLocaleString("en")} — ${b.hit ? "the attack hits" : `${name(b.guard)} holds`}.`;
    case "damage":
      return `${who(b.player, "take", "takes")} ${b.amount} damage${b.critical ? " — Critical" : ""}.`;
    case "ko": {
      const o = b.owner ?? owner(b.card);
      return o ? `${poss(o) === "your" ? "Your" : poss(o)} ${name(b.card)} is KO'd.` : `${name(b.card)} is KO'd.`;
    }
    case "negated":
      return "The attack is negated.";
    case "skill": {
      const clause = b.text.replace(/\s+/g, " ").trim().replace(/\.$/, "");
      const short = clause.length > 90 ? `${clause.slice(0, 88)}…` : clause;
      return `${who(b.owner, "use", "uses")} 《${b.label}》 on ${name(b.card)} — ${short}${b.unread ? " (Claude ruled on this)" : ""}.`;
    }
    case "say":
      return `${n.them}: “${b.text}”`;
    case "over":
      if (!b.winner) return `A draw — ${b.reason}.`;
      return `${you(b.winner) ? "You win" : `${n.them} wins`} — ${b.reason}.`;
  }
}
