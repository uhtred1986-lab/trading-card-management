/** R525: the raw parenthetical is part of this complete paired source match. */
import type {Skill} from '../types';
import type {Script} from '../vm/script';
import {compileUsage} from '../vm/usage';
import {compileValidity} from '../vm/validity';
import {paidHandPrice,paidHandBody,requirePaidHandShape} from '../vm/paid-hand-contract';
export function compilePaidHand(skill:Skill):Script|null {
 if(skill.kind!=='activate:main'||!skill.oncePerTurn)return null;
 const script:Script={kind:skill.kind,trigger:[],price:paidHandPrice(),ops:paidHandBody(),usage:compileUsage(skill),validity:compileValidity(skill),unsupported:[]};
 try{requirePaidHandShape(skill,script);}catch{return null;}return script;
}
