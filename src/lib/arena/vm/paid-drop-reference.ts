import type {ScriptFrame} from './script';
import type {VmState} from './state';
import {findCard} from './zones';
import {IllegalAction} from './illegal-action';
import {paidDropDeclaration,requirePaidDropCapture} from './paid-drop-contract';
function fail():never {throw new IllegalAction('rebuild the original owner-Drop source reference (R518)');}
function original(frame:ScriptFrame){const s=frame.ordinaryActivation?.cost?.source;if(!s)fail();paidDropDeclaration(s);return s;}
/** Pure play-candidate guard also runs when the interpreter re-enters after a play tax. */
export function paidDropPlayAllowed(frame:ScriptFrame,id:string,epoch:number,area:string|null,cardId:string):boolean {
 if(!frame.paidDrop)return true;const s=original(frame);requirePaidDropCapture(s,frame.paidDrop.capture);
 if(!Number.isSafeInteger(epoch)||epoch<0)fail();
 return id===s.occurrence.card&&cardId===s.occurrence.cardId&&epoch===s.occurrence.epoch&&area==='hand';
}
/** Only the exact original Hand card or this effect's actual own arrival may receive its self tail. */
export function paidDropSelfAllowed(state:VmState,frame:ScriptFrame):boolean {
 if(!frame.paidDrop)return true;const s=original(frame);requirePaidDropCapture(s,frame.paidDrop.capture);
 const c=state.cards[frame.card],at=findCard(state,frame.card);if(!c||!at)return false;
 if(!Number.isSafeInteger(c.zoneEpoch??0)||(c.zoneEpoch??0)<s.occurrence.epoch)fail();
 if(c.cardId!==s.occurrence.cardId||c.flipped!==s.flipped)return false;
 if((c.zoneEpoch??0)===s.occurrence.epoch)return at.zone==='hand'&&at.owner===s.master&&(c.hiddenCount??0)===s.occurrence.hiddenCount;
 const scope=state.skillPlayScopes?.find(x=>x.id===frame.skillEffectOrigin?.scope);
 if(!scope)return false;
 if(scope.source!==frame.card||scope.master!==frame.master||scope.skillIndex!==frame.skillIndex||scope.profile.arrivals!==1||scope.profile.tokens||scope.profile.explicitWindow||scope.played.length>1)fail();
 const arrival=scope.played[0];
 return !!arrival&&arrival.card===frame.card&&arrival.epoch===(c.zoneEpoch??0)&&at.zone==='battle';
}
