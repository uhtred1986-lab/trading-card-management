/** R514: exact original Extra permission; it does not grant a Drop skill origin. */
import type { Skill } from '../types';
import type { Op, Script } from './script';
import { emptyFilter } from '../text/filters';
import { canonicalTaxValue as canonical } from './tax-receipt';
import { zeroSkillPrice } from './skill-payment';
export type ActivateUnderPolicy = 'asHandV1' | 'asHandGreenBrolyLeaderV1';
export function activateUnderText(text: string): ActivateUnderPolicy | null {
 const m=/^if (your leader is a green <broly: br> card and )?this card is under a <broly: br> card,? you can activate this card['’]s \[activate\] skills? under the same conditions as if it were in your hand\.?$/i.exec(text.trim());
 return m ? m[1] ? 'asHandGreenBrolyLeaderV1' : 'asHandV1' : null;
}
export function activateUnderPermit(policy: ActivateUnderPolicy): Extract<Op,{op:'permit'}> {
 return {op:'permit',what:'activateFromUnder',activateUnderPolicy:policy,until:'game',target:{sel:{special:'self'}},source:{...emptyFilter(),characters:['broly: br']}};
}
export function activateUnderDescriptor(ops: unknown): ActivateUnderPolicy | null {
 return (['asHandV1','asHandGreenBrolyLeaderV1'] as const).find(p=>canonical(ops)===canonical([activateUnderPermit(p)]))??null;
}
export function activateUnderPermitProblem(op: unknown): string | null {
 return activateUnderDescriptor([op]) ? null : 'rebuild the exact original Extra under-Broly Activate permission';
}
export function activateUnderPrinted(skill: Skill): ActivateUnderPolicy | null {
 return skill.kind==='permanent'&&skill.tags.length===1&&skill.tags[0].toLowerCase()==='permanent'&&!skill.cost.trim()&&!skill.oncePerTurn&&skill.limit===null&&skill.bond===null&&skill.sparking===null&&skill.burst===null&&skill.spiritBoost===null&&skill.markerCost===null&&!Object.keys(skill.energyCost).length&&!skill.energyEither.length&&!skill.granted&&!skill.grants ? activateUnderText(skill.effect) : null;
}
export function activateUnderScript(script: Script | undefined): ActivateUnderPolicy | null {
 if(!script||script.kind!=='permanent'||!Array.isArray(script.unsupported)||script.unsupported.length||canonical(script.trigger)!=='[]'||script.combo!=null||script.paidAdmission||script.keepResolutionCondition||script.playReplacement||canonical(script.price)!==canonical(zeroSkillPrice())||canonical(script.usage)!==canonical({version:1,oncePerTurn:false,limit:null})||canonical(script.validity)!==canonical({version:1,sparking:null}))return null;
 return activateUnderDescriptor(script.ops);
}
