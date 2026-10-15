import assert from 'node:assert/strict';
import {abilityPreview,readerAbilities,readerText,hasReviewedRulesArea} from '../../src/components/arena/card-reader-model';
import type {CardView} from '../../src/lib/arena/view';
const card={id:'a',cardId:'BT1-056',name:'Son Goku',hidden:false,flipped:false,text:'[Auto] Draw 1.<br>[Evolve] &lt;Gotenks&gt;',abilities:[]} as unknown as CardView;
assert.equal(readerAbilities({...card,hidden:true}).length,0);
assert.equal(readerText('[Evolve] <Gotenks><br><b>Draw</b> &amp; choose.'),'[Evolve] <Gotenks>\nDraw & choose.');
assert.equal(readerAbilities(card).length,2);
assert.ok(hasReviewedRulesArea(card));
assert.equal(hasReviewedRulesArea({...card,cardId:'UNKNOWN'}),false);
assert.equal(hasReviewedRulesArea({...card,cardId:'BT1-072',flipped:true}),false);
const ability={skillIndex:0,kind:'activate',category:'manual',text:'[Activate:Main] Draw 1.',tags:['Activate:Main'],origin:'copied',availability:'notEvaluated',costPreview:{state:'incomplete'}};
const copied=readerAbilities({...card,abilities:[ability]} as unknown as CardView)[0];
assert.equal(copied.copied,true);assert.equal(copied.offered,false);assert.equal(copied.state,'Added ability');
console.log('Card reader: concealed cards, literal selectors, unknown layouts and added-ability separation pass.');

assert.equal(abilityPreview('[Auto] When this card attacks a Leader Card, your opponent chooses 1 card from their hand and places it in the Drop Area.'), 'On attacking a Leader: Opponent discards 1 from hand.');
assert.equal(abilityPreview('[Auto] When this card attacks, draw 1 card.'), 'On attack: draw 1.');
assert.ok(abilityPreview('[Activate:Main] Choose up to 1 opponent Battle Card with an energy cost of 2 or less and KO that card.').includes('up to 1'));
assert.ok(abilityPreview('[Evolve] {g}{g}{1} <Gotenks>').includes('{g}{g}{1} <Gotenks>'));

assert.ok(abilityPreview('[Auto] [Once per turn] When this card attacks, draw 1 card.').includes('[Once per turn]'));
assert.ok(abilityPreview('[Limit 1] [Auto] Draw 1.').includes('[Limit 1]'));
