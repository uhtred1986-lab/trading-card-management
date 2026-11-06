/** R522: one complete printed Auto owns both its variable price and count-bound body. */
import type {Skill} from '../types';
import type {Script} from '../vm/script';
import {triggersOf} from '../gaps';
import {compileUsage} from '../vm/usage';
import {compileValidity} from '../vm/validity';
import {paidWarpPrice,paidWarpBody,requirePaidWarpShape} from '../vm/paid-warp-contract';
export function compilePaidWarp(skill:Skill):Script|null {
 if(skill.kind!=='auto'||skill.burst!==1)return null;
 const script:Script={kind:skill.kind,trigger:triggersOf(skill),price:paidWarpPrice(),ops:paidWarpBody(),usage:compileUsage(skill),validity:compileValidity(skill),unsupported:[]};
 try {requirePaidWarpShape(skill,script);} catch {return null;}
 return script;
}
