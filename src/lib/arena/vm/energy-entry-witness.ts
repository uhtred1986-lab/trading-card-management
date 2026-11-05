/** R476 original movement contract, separate from optional-effect execution. */
import type { PlayerId } from "../types";
import type { Op, ScriptFrame } from "./script";
import type { ScriptHost } from "./script-host";
import { canonicalTaxValue as canonical } from "./tax-receipt";
import { NotYet } from "./errors";
import { IllegalAction } from "./illegal-action";

type Occurrence = { card: string; epoch: number };
export interface EnergyEntryWitness {
  version: 1;
  /** Allocated by the owning movement scope, never inferred from card order. */
  owner: number;
  incoming: Occurrence & { cardId: string; area: "hand" | "deck" | "drop"; holder: PlayerId; owner: PlayerId };
  destination: { player: PlayerId; area: "energy"; mode?: "active" | "rest" };
  parent: { card: string; master: PlayerId; skillIndex?: number; ip: number; operation: Op; index: number; cards: string[] };
}
const epoch = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0;
const player = (value: unknown): value is PlayerId => value === "p1" || value === "p2";
function rebuild(detail: string): never { throw new NotYet(`rebuild this Energy entry ${detail}`, "R476"); }

export function captureEnergyEntryWitness(h: ScriptHost, owner: number, frame: ScriptFrame, incoming: string, destination: EnergyEntryWitness["destination"]): EnergyEntryWitness {
  const op = frame.ops[frame.ip], loop = frame.moveLoop, area = h.areaOf(incoming);
  if (!Number.isSafeInteger(owner) || owner <= 0 || op?.op !== "moveTo" || loop?.kind !== "moveTo" || loop.ids[loop.index] !== incoming) rebuild("movement owner");
  // Admission is deliberately narrow until the corresponding route has its own proof.
  if (loop.ids.length !== 1) throw new NotYet("owner ordering for a multi-card Energy entry", "R476");
  if (area !== "hand" && area !== "deck" && area !== "drop") throw new NotYet("this Energy entry origin", "R476");
  if (h.ownerOf(incoming) !== destination.player || h.masterOf(incoming) !== destination.player) throw new NotYet("another player's Energy entry", "R476");
  const witness: EnergyEntryWitness = {
    version: 1, owner,
    incoming: { card: incoming, cardId: h.catalogIdOf(incoming), epoch: h.zoneEpoch(incoming), area, holder: h.masterOf(incoming), owner: h.ownerOf(incoming) },
    destination: structuredClone(destination),
    parent: { card: frame.card, master: frame.master, ...(frame.skillIndex !== undefined ? { skillIndex: frame.skillIndex } : {}), ip: frame.ip, operation: structuredClone(op), index: loop.index, cards: [...loop.ids] },
  };
  requireEnergyEntryWitness(h, owner, frame, witness, destination);
  return witness;
}

/** Validate the whole serialized contract before treating any occurrence as stale. */
export function requireEnergyEntryWitness(h: ScriptHost, owner: number, frame: ScriptFrame, value: EnergyEntryWitness | undefined, destination: EnergyEntryWitness["destination"]): asserts value is EnergyEntryWitness {
  if (!value || value.version !== 1 || !Number.isSafeInteger(value.owner) || value.owner <= 0 || value.owner !== owner ||
    !value.incoming || typeof value.incoming.card !== "string" || typeof value.incoming.cardId !== "string" || !epoch(value.incoming.epoch) ||
    !["hand", "deck", "drop"].includes(value.incoming.area) || !player(value.incoming.holder) || !player(value.incoming.owner) ||
    !value.destination || value.destination.area !== "energy" || !player(value.destination.player) ||
    value.destination.mode !== undefined && value.destination.mode !== "active" && value.destination.mode !== "rest" ||
    !value.parent || typeof value.parent.card !== "string" || !player(value.parent.master) || !epoch(value.parent.ip) || !epoch(value.parent.index) ||
    value.parent.skillIndex !== undefined && !epoch(value.parent.skillIndex) ||
    !value.parent.operation || value.parent.operation.op !== "moveTo" || !Array.isArray(value.parent.cards) || value.parent.cards.length !== 1 ||
    value.parent.index !== 0 || value.parent.cards[0] !== value.incoming.card) rebuild("saved movement contract");
  const saved = value.parent, loop = frame.moveLoop;
  if (!Array.isArray(frame.ops) || frame.card !== saved.card || frame.master !== saved.master || frame.skillIndex !== saved.skillIndex || frame.ip !== saved.ip ||
    !loop || loop.kind !== "moveTo" || loop.index !== saved.index || canonical(loop.ids) !== canonical(saved.cards) ||
    canonical(frame.ops[frame.ip]) !== canonical(saved.operation) || canonical(destination) !== canonical(value.destination)) rebuild("original parent continuation");
  const source = value.incoming;
  if (!h.exists(source.card) || h.catalogIdOf(source.card) !== source.cardId || h.zoneEpoch(source.card) !== source.epoch || h.areaOf(source.card) !== source.area ||
    h.ownerOf(source.card) !== source.owner || h.masterOf(source.card) !== source.holder) throw new IllegalAction("the original incoming Energy card is no longer available");
}
