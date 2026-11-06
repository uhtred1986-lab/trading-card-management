/** R476 ordinary-effect chooser occurrences, independent of cost-host bookkeeping. */
import type { ScriptFrame } from "./script";
import type { ScriptHost } from "./script-host";
import { validateMovementResult } from "./movement-result";
import { NotYet } from "./errors";
import { IllegalAction } from "./illegal-action";
import { ENERGY_ENTRY_SLOTS } from "./energy-entry-effect";
import { canonicalTaxValue as canonical } from "./tax-receipt";

type Payer = { card: string; cardId: string; epoch: number; owner: string; holder: string };
export type EnergyEntryPayers = Record<string, { offered: Payer[]; selected?: Payer; attempted?: true }>;
const fail = (): never => { throw new NotYet("rebuild Energy entry payer occurrence history", "R476"); };
// R491: native Drop holder is a physical fact; masterOf falls back to ownership.
const read = (h: ScriptHost, card: string): Payer => ({ card, cardId: h.catalogIdOf(card), epoch: h.zoneEpoch(card), owner: h.ownerOf(card), holder: h.energyEntryLocation?.(card)?.holder ?? "" });
const inDrop = (h: ScriptHost, card: string): boolean => h.areaOf(card) === "drop" && h.energyEntryLocation?.(card)?.area === "drop";
const current = (h: ScriptHost, payer: Payer): boolean => h.exists(payer.card) && inDrop(h,payer.card) && canonical(read(h,payer.card)) === canonical(payer);

export function requireEnergyEntryPayers(h: ScriptHost, frame: ScriptFrame, payers: EnergyEntryPayers): void {
  if (!h.energyEntryLocation || !payers || typeof payers !== "object" || Array.isArray(payers)) fail();
  for(const [name,choice] of Object.entries(payers)) {
    if (!(ENERGY_ENTRY_SLOTS as readonly string[]).includes(name) || !choice || !Array.isArray(choice.offered) || choice.attempted !== undefined && choice.attempted !== true) fail();
    for(const payer of choice.offered) if (!payer || typeof payer.card !== "string" || typeof payer.cardId !== "string" || !Number.isSafeInteger(payer.epoch) || payer.epoch < 0 || payer.owner !== frame.master || payer.holder !== frame.master) fail();
    if(new Set(choice.offered.map(p=>p.card)).size !== choice.offered.length)fail();
    if(choice.selected) {
      if(!choice.offered.some(p=>canonical(p)===canonical(choice.selected)) || canonical(frame.vars[name])!==canonical([choice.selected.card]) || canonical(frame.vars[`${name}@epoch`])!==canonical([`${choice.selected.card}@${choice.selected.epoch}`])) fail();
      const moveIndex=frame.ops.findIndex(op=>op.op==="moveTo"&&op.completedAs===name);
      const processed=moveIndex>=0&&frame.ip>moveIndex;
      const recorded=frame.movementResults?.[name];
      if(choice.attempted || processed || recorded!==undefined) {
        validateMovementResult(frame,name);
        const result=frame.movementResults![name];
        if(result.selected.length!==1 || result.selected[0].card!==choice.selected.card || result.selected[0].epoch!==choice.selected.epoch || result.outcomes.length>1 || choice.attempted&&result.outcomes.length!==1) fail();
        const outcome=result.outcomes[0];
        if(outcome && (outcome.from!=="drop" || outcome.completed && (outcome.to!=="warp" || outcome.toEpoch<=outcome.fromEpoch))) fail();
      }
      if(!choice.attempted && !processed && !current(h,choice.selected)) throw new IllegalAction("a chosen Energy-entry payer is no longer the original Drop card");
    } else if(choice.attempted) fail();
  }
  for(const name of ENERGY_ENTRY_SLOTS)if(frame.vars[name]?.length&&!payers[name]?.selected)fail();
  if (frame.awaiting && (ENERGY_ENTRY_SLOTS as readonly string[]).includes(frame.awaiting) && h.lastChoice() !== null) {
    const offered=payers[frame.awaiting]?.offered;if(!offered)fail();
    for(const id of h.lastChoice() ?? []) {
      const payer=offered.find(p=>p.card===id);
      if(!payer||!current(h,payer))throw new IllegalAction("the offered Energy-entry payer is no longer available");
    }
  }
}

/** Snapshot only the active chooser's offer; re-reading cannot replace its original pool. */
export function offerEnergyEntryPayers(h: ScriptHost, frame: ScriptFrame, payers: EnergyEntryPayers, candidates: string[]): void {
  const op=frame.ops[frame.ip];
  if(op?.op!=="choose" || !(ENERGY_ENTRY_SLOTS as readonly string[]).includes(op.as) || payers[op.as]) return;
  if(!h.energyEntryLocation||candidates.some(id=>!inDrop(h,id)||h.ownerOf(id)!==frame.master||read(h,id).holder!==frame.master)) fail();
  payers[op.as]={offered:candidates.map(id=>read(h,id))};
}

/** Bind selections before another chooser, replacement or payer movement can suspend. */
export function bindEnergyEntryPayers(h: ScriptHost, frame: ScriptFrame, payers: EnergyEntryPayers): void {
  for(const name of ENERGY_ENTRY_SLOTS) {
    const ids=frame.vars[name];if(!ids?.length)continue;
    const choice=payers[name];if(ids.length!==1||!choice)fail();
    if(!choice.selected) {
      const selected=choice.offered.find(p=>p.card===ids[0]);
      if(!selected||!current(h,selected))throw new IllegalAction("the offered Energy-entry payer is no longer available");
      choice.selected={...selected};frame.vars[`${name}@epoch`]=[`${selected.card}@${selected.epoch}`];
    }
  }
  requireEnergyEntryPayers(h,frame,payers);
}
