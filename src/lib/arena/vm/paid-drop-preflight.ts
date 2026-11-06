import {NotYet} from './errors';
/** R518: private, fixed-payer native projection before any real payment. */
import type {EngineContext} from '../types';
import type {GameDefinition} from '../rulesets';
import type {VmState} from './state';
import type {ScriptFrame,Script} from './script';
import {vmHost} from './host';
import {automaticPriceHost,canFinishAutomaticPrice} from './auto-costs';
import {findCard} from './zones';
import {startMovementResult,recordMovementResult} from './movement-result';
import {isGeneralBlue} from './paid-drop-contract';
const PROOF='paid_drop_projection';
/** This receives the exact admitted original price; it neither alters that selector nor publishes history. */
export function paidDropPayerPayable(ctx:EngineContext,game:GameDefinition,state:VmState,source:{card:string;master:ScriptFrame['master']},script:Script,id:string):boolean {
 const [choice,move]=script.price?.ops??[];
 if(choice?.op!=='choose'||move?.op!=='moveTo'||!('var' in move.target)||move.target.var!==choice.as||move.to!=='drop')return false;
 const live=vmHost(ctx,game,state,[]),frame:ScriptFrame={card:source.card,master:source.master,ops:[],ip:0,vars:{}};
 if(!live.resolveSelector(frame,choice.sel).includes(id))return false;
 const inst=state.cards[id],at=findCard(state,id);if(!inst||!at||at.owner!==source.master)return false;
 const original={id,cardId:inst.cardId,owner:inst.owner,area:at.zone,epoch:inst.zoneEpoch??0,blue:isGeneralBlue(live.cardInfo(id))};
 const price:ScriptFrame={card:source.card,master:source.master,ops:[structuredClone(move)],ip:0,vars:{[choice.as]:[id]}};
 return canFinishAutomaticPrice(ctx,game,state,price,{symmetry:false,
  hostForProof:(copy,f)=>{
   const host=automaticPriceHost(ctx,game,copy,[],f);
   return {...host,move:(moving,to,owner,opts)=>{
    startMovementResult(f,PROOF,[{card:original.id,epoch:original.epoch}]);
    return host.move(moving,to,owner,{...opts,onResult:r=>{
     recordMovementResult(f,PROOF,r);opts?.onResult?.(r);
     if(r.completed&&r.to==='drop'){
      (f.paidCardInfo??={})[PROOF]={[moving]:host.cardInfo(moving)};
      f.vars[PROOF]=[host.masterOf(moving)];
     }
    }});
   }};
  },
  complete:(copy,f)=>{
   const r=f.movementResults?.[PROOF]?.outcomes[0],info=f.paidCardInfo?.[PROOF]?.[id];
   const paid=!!r&&r.card===original.id&&r.from===original.area&&r.fromEpoch===original.epoch&&r.to==='drop'&&r.completed&&r.toEpoch===original.epoch+1
    &&copy.cards[id]?.cardId===original.cardId&&f.vars[PROOF]?.[0]===original.owner&&!!info;
   if(paid&&isGeneralBlue(info!)!==original.blue)throw new NotYet('pay this historical owner-Drop price while General Blue membership changes on departure','R518');
   return paid;
  },
 });
}
