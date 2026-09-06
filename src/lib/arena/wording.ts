/**
 * How a client puts a rule into words (`docs/arena-workflow-spec.md` §4).
 *
 * The engine answers "why can't I" with a `Requirement` — a closed vocabulary,
 * never a sentence — and this is the one place the web board turns that into
 * English. A refusal names **which requirement failed** and **what would
 * satisfy it**: one clause of fact, one of remedy, and where there is no
 * remedy this turn it says so rather than implying one.
 *
 * Pure and React-free so `npm test` can read every kind, and so the Android
 * app can carry its own copy of exactly this table in Kotlin.
 */
import type { Action, Area, Requirement } from "./engine";
import type { CardView, SideView } from "./view";

/** What the player was trying to do, for the verb in the sentence. */
export type Reaching = Action["type"];

const VERB: Partial<Record<Reaching, string>> = {
  attack: "attack",
  combo: "combo",
  play: "be played",
  playUnison: "be played",
  playZ: "be played",
  activate: "use its skill",
  charge: "be charged",
  counter: "counter",
  block: "block",
};

const AREA: Record<Area, string> = {
  deck: "your deck",
  hand: "your hand",
  drop: "your Drop Area",
  leader: "the Leader Area",
  battle: "your Battle Area",
  combo: "your Combo Area",
  energy: "your Energy Area",
  life: "your Life Area",
  warp: "your Warp",
  unison: "the Unison Area",
  zDeck: "your Z-Deck",
  zEnergy: "your Z-Energy Area",
  removed: "out of the game",
};

const WINDOW: Record<string, string> = {
  main: "Only in your Main Phase.",
  battle: "Only during a battle.",
  defense: "Only in the Defense Step of your opponent's turn.",
  nextTurn: "No attacks on the first turn — from your next turn on.",
};

export interface Refusal {
  /** Which requirement failed. */
  fact: string;
  /** What would satisfy it, or null when nothing this turn will. */
  remedy: string | null;
}

/**
 * One requirement, worded for the card it is about. `side` is the player's
 * own side of the table, so an energy shortfall can say whether next turn
 * fixes it or more charging does.
 */
export function refusal(r: Requirement, o: { name: string; reaching: Reaching; side?: SideView | null; inHand?: boolean }): Refusal {
  const name = o.name;
  const verb = VERB[o.reaching] ?? "do that";
  switch (r.kind) {
    case "energy": {
      const short = r.need - r.have;
      const fact = `${name} costs ${r.need} — ${r.have} energy active, ${short} short.`;
      if (!o.side) return { fact, remedy: null };
      const total = o.side.energy.length + o.side.energyMarkers;
      return { fact, remedy: total >= r.need ? "Playable next turn, once your rested energy stands back up." : `Charge ${r.need - total} more energy over the coming turns.` };
    }
    case "energyColour": {
      const colour = r.colour.replace("/", " or ");
      return { fact: `${name} needs ${r.need} ${colour} energy — ${r.have} active.`, remedy: `Charge a ${colour} card.` };
    }
    case "mode":
      return { fact: `${name} is in Rest Mode — it cannot ${verb}.`, remedy: "It stands back up at the start of your next turn." };
    case "timing":
      return { fact: r.window === "nextTurn" ? `${name} cannot attack yet.` : `${name} cannot ${verb} now.`, remedy: WINDOW[r.window] ?? `Only in the ${r.window}.` };
    case "oncePerTurn":
      if (r.what === "charge") return { fact: "You have already charged this turn.", remedy: "One charge per turn — again next turn." };
      if (r.what === "skill") return { fact: `${name}'s skill has already been used this turn.`, remedy: "[Once per turn] — again next turn." };
      return { fact: `${r.what} has already been used this turn.`, remedy: "Again next turn." };
    case "zone":
      return { fact: `${name} has to be in ${AREA[r.area]} for that.`, remedy: r.area === "battle" && o.inHand ? "Play it first." : null };
    case "cardType":
      return { fact: `${name} is not ${r.needs}.`, remedy: null };
    case "target":
      return { fact: `Nothing to ${o.reaching === "attack" ? "attack" : "choose"}: ${r.reason}.`, remedy: null };
    case "forbidden":
      return { fact: r.by ? `${r.by} forbids it.` : "A skill in play forbids it.", remedy: "Until that effect ends." };
    case "unread":
      return { fact: `The engine cannot read ${name}'s text yet.`, remedy: "Explain the card on the backlog page and it plays from the next game." };
    case "condition":
      return { fact: `${name} needs: ${r.text.replace(/\.$/, "")}.`, remedy: "Not met yet." };
    case "other":
      return { fact: capital(r.detail.replace(/\.$/, "")) + ".", remedy: null };
  }
}

/** The refusal as one line for the prompt bar. */
export function sentence(r: Requirement, o: Parameters<typeof refusal>[1]): string {
  const w = refusal(r, o);
  return w.remedy ? `${w.fact} ${w.remedy}` : w.fact;
}

/**
 * The two or three words a disabled row wears as its pill: the number that
 * matters for an energy shortfall, and the failed requirement's name for the
 * rest. `whyByCard` is ordered most decisive first, so the first one is it.
 */
export function pill(r: Requirement): string {
  switch (r.kind) {
    case "energy":
      return `${r.need - r.have} short`;
    case "energyColour":
      return `needs ${r.colour}`;
    case "mode":
      return "resting";
    case "timing":
      return "not now";
    case "oncePerTurn":
      return "used";
    case "zone":
      return "wrong area";
    case "cardType":
      return "wrong card";
    case "target":
      return "no target";
    case "forbidden":
      return "forbidden";
    case "unread":
      return "unread";
    case "condition":
      return "not yet";
    case "other":
      return "no";
  }
}

/**
 * What a legal move costs, worn on its row so the sheet lists every action
 * *with its price on it*. Null when the move has no price worth naming.
 */
export function priceOf(action: Action, card: CardView, label: string): string | null {
  switch (action.type) {
    case "play":
      if (action.alt) return "alternative cost";
      if (action.x != null) return `X = ${action.x}`;
      return card.cost && card.cost !== "0" ? `${card.cost} energy` : "free";
    case "playUnison":
      return `${action.x} marker${action.x === 1 ? "" : "s"}`;
    case "playZ":
      if (action.x != null) return `${action.x} marker${action.x === 1 ? "" : "s"}`;
      return card.cost ? `${card.cost} energy + Z` : "Z-Energy";
    case "combo":
      return `+${(card.comboPower ?? 0).toLocaleString("en")} · ${card.comboCost ? `${card.comboCost} energy` : "free"}`;
    case "attack":
      return "rests it";
    case "charge":
      return "+1 energy";
    case "growUnison":
      return "+1 marker";
    case "counter":
      return action.alt ? "alternative cost" : card.cost ? `${card.cost} energy` : "free";
    case "block":
      return "rests it";
    case "activate": {
      if (action.alt) return "alternative cost";
      const m = label.match(/\((\d+)\)\s*$/);
      return m ? `${m[1]} energy` : null;
    }
    default:
      return null;
  }
}

/** "step 2 of 3", or "step 2" when the chain cannot say how long it is. */
export function stepText(step: { index: number; count: number }): string {
  return step.count > 0 ? `step ${step.index} of ${step.count}` : `step ${step.index}`;
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
