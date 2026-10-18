/** #828: real responsive setup controls, independent filters and final form values. No database. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chooseLocalSetup } from "./lib/local-arena-page.mts";
import { Browser, VIEWPORTS, sleep, type Page } from "./lib/cdp.mts";
const arg = (name:string) => {const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const base=arg("--base") ?? "http://localhost:3000";
const shots=arg("--shots") ?? "/tmp/deck-setup-review/after";
mkdirSync(shots,{recursive:true});
async function until(p:Page,expr:string){for(let i=0;i<200;i++){if(await p.eval(`Boolean(${expr})`))return;await sleep(50);}throw new Error(`Timeout: ${expr}`);}
async function click(p:Page,selector:string){await p.eval(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('No element: '+${JSON.stringify(selector)});e.click()})()`);await sleep(80);}
async function textButton(p:Page,scope:string,text:string){await p.eval(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(scope+" button")})].find(b=>b.textContent.trim().startsWith(${JSON.stringify(text)}));if(!e)throw new Error('No button '+${JSON.stringify(text)});e.click()})()`);await sleep(80);}
async function input(p:Page,sel:string,value:string){await p.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});Object.getOwnPropertyDescriptor(${sel.includes('select')?'HTMLSelectElement':'HTMLInputElement'}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(${sel.includes('select')?"'change'":"'input'"},{bubbles:true}))})()`);await sleep(80);}
async function shot(p:Page,name:string){writeFileSync(`${shots}/${name}.png`,await p.screenshot(true));}
const browser=await Browser.launch();
try {
 for(const vp of VIEWPORTS){
  const p=await browser.page(vp);
  if(arg("--skin"))await p.setCookie("arenaSkin",arg("--skin")!,base);
  await p.goto(`${base}/arena/setup-preview`);
  await until(p,`document.querySelector('[data-setup-preview][data-ready=true]')`);
  const scope=vp.mobile?'dialog[open]':'[data-desktop-setup]';
  if(vp.mobile){await textButton(p,'body','Set up a match');await until(p,`document.querySelector('dialog[open]')`);assert.ok(await p.eval(`document.querySelector('dialog[open]').matches(':modal')`));}
  const own=`${scope} [data-deck-discovery="Your deck"]`;
  const other=`${scope} [data-deck-discovery="Claude's deck"]`;
  await shot(p,`${vp.name}-your-deck`);
  await click(p,`${own} > details > summary`);
  assert.equal(await p.eval(`document.querySelectorAll(${JSON.stringify(own+' [data-deck-choice]')}).length`),6);
  await textButton(p,own,'Show more decks (10 remaining)');
  assert.equal(await p.eval(`document.querySelectorAll(${JSON.stringify(own+' [data-deck-choice]')}).length`),12);
  await input(p,`${own} input[type=search]`,'no-such-strategy');
  assert.ok(await p.eval(`document.querySelector(${JSON.stringify(own)}).innerText.includes('No decks match')`));
  assert.equal(await p.eval(`document.querySelector(${JSON.stringify(scope+' input[name=deck]')}).value`),'1');
  await textButton(p,own,'Reset filters');
  await click(p,`${own} [data-deck-choice="3"]`);
  if(vp.mobile) assert.equal(await p.eval(`([...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent==='Next: opponent')).disabled`),true);
  await input(p,`${own} input[type=search]`,'red strategy');
  await click(p,`${own} [data-deck-choice="7"]`);
  if(vp.mobile) await textButton(p,scope,'Next: opponent');
  await click(p,`${other} > details > summary`);
  assert.equal(await p.eval(`document.querySelectorAll(${JSON.stringify(other+' [data-deck-choice="3"]')}).length`),0,'locked opponents hidden by ready filter');
  await click(p,`${other} input[type=checkbox]`);
  assert.equal(await p.eval(`document.querySelector(${JSON.stringify(other+' [data-deck-choice="3"]')}).disabled`),true,'locked opponents remain disabled when displayed');
  await click(p,`${other} input[type=checkbox]`);
  await input(p,`${other} input[type=search]`,'patient');
  await input(p,`${other} select:nth-of-type(1)`,'Blue');
  // Deck type is the second control in the "More filters" disclosure.
  await input(p,`${other} .ds-more-filters label:nth-child(2) select`,'Virtual');
  assert.equal(await p.eval(`document.querySelectorAll(${JSON.stringify(other+' [data-deck-choice]')}).length`),4);
  await click(p,`${other} [data-deck-choice="12"]`);
  assert.equal(await p.eval(`document.querySelector(${JSON.stringify(own+' input[type=search]')}).value`),'red strategy','opponent filter does not modify own filter');
  await shot(p,`${vp.name}-opponent`);
  if(vp.mobile){
   await textButton(p,scope,'Back');
   assert.equal(await p.eval(`document.querySelector('dialog[open] input[name=deck]').value`),'7');
   await textButton(p,scope,'Next: opponent'); await textButton(p,scope,'Review match');
   await shot(p,`${vp.name}-review`);
   assert.ok(await p.eval(`document.querySelector('dialog[open]').innerText.includes('Deck 7:') && document.querySelector('dialog[open]').innerText.includes('Deck 12:')`));
  }
  const overflow=await p.eval<{w:number;s:number;modal:number}>(`({w:innerWidth,s:document.documentElement.scrollWidth,modal:document.querySelector('dialog[open]')?.scrollWidth??0})`);
  assert.ok(overflow.s<=overflow.w && overflow.modal<=overflow.w,JSON.stringify(overflow));
  await textButton(p,scope,'Start match');
  await until(p,`document.querySelector('[data-setup-submitted]').textContent.includes('claudeDeck')`);
  assert.deepEqual(await p.eval(`JSON.parse(document.querySelector('[data-setup-submitted]').textContent)`),{deck:'7',opponent:'sparring',claudeDeck:'12'});
  if(vp.mobile){await p.cdp('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});await p.cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await until(p,`!document.querySelector('dialog[open]')`);assert.equal(await p.eval(`document.activeElement.textContent`),'Set up a match');}
  // A friend's device chooses its own deck; no opponent deck selector or lock applies.
  if(vp.mobile){await textButton(p,'body','Set up a match');await textButton(p,scope,'Next: opponent');}
  await textButton(p,scope,'A friend');
  assert.equal(await p.eval(`document.querySelectorAll(${JSON.stringify(other)}).length`),0);
  if(vp.mobile)await textButton(p,scope,'Review match');
  await textButton(p,scope,'Invite a friend');
  await until(p,`document.querySelector('[data-setup-submitted]').textContent.includes('versus')`);
  for(const view of ['library','leaders','builder','local']){
   await p.goto(`${base}/arena/setup-preview?view=${view}`);
   await sleep(500);
   if(view!=='leaders') await until(p,`document.querySelector('[data-setup-preview][data-ready=true]')`);
   if(view==='local'&&vp.mobile){await textButton(p,'body','Set up a match');await until(p,`document.querySelector('dialog[open]')`);}
   if(view==='local'){
    assert.ok(await p.eval(`!document.querySelector('[data-deck-discovery="Your deck"] > [data-deck-facts]').innerText.includes('No leader yet')`),'local pack resolves leader names');
    assert.ok(await p.eval(`document.body.innerText.includes('does not include deck descriptions')`));
    await p.setOffline(true);
    await chooseLocalSetup(p,"B","A","p2");
    await shot(p,`${vp.name}-local-review`);
    await textButton(p,vp.mobile?'dialog[open]':'[data-desktop-setup]','Start match');
    await until(p,`document.querySelector('[data-setup-submitted]').textContent.includes('mine')`);
    assert.deepEqual(await p.eval(`JSON.parse(document.querySelector('[data-setup-submitted]').textContent)`),{mine:'B',theirs:'A',seat:'p2'});
    await p.setOffline(false);
   }
   await shot(p,`${vp.name}-${view}`);
   assert.ok(await p.eval(`document.documentElement.scrollWidth<=innerWidth`),`${vp.name} ${view} has no horizontal overflow`);
  }
  console.log(`PASS ${vp.name}: bounded choices, filters, locks, wizard/back, final payload, friend mode, local metadata and layout`);
  await p.close();
 }
}finally{await browser.close();}
console.log(`Screenshots: ${shots}`);
