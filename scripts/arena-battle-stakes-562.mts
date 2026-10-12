/** Database-free browser proof using genuine EngineAPI snapshots and captured actions. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Browser, requireServer, sleep, type Viewport } from './lib/cdp.mts';
import { makeSenzuFixture, makeWhisFixture, applyWithEvents, restoreFixtureDefs } from './verify/ability-engine-fixture-561';
import { battleFixture, paymentFixture, snapshot562, apply562 } from './verify/battle-engine-fixture-562';
import type { VmState } from '../src/lib/arena/vm/state';
import type { Action } from '../src/lib/arena/types';
const base = process.argv.find(a => a.startsWith('--base='))?.slice(7) ?? 'http://localhost:3022';
const tag = process.argv.includes('--before') ? 'before' : 'after';
const evidence = resolve('docs/arena-backlog/evidence/562');
const fixture = resolve('contract/fixtures/u05-engine-proof.json');
const assets = resolve('docs/arena-backlog/evidence/546/assets');
const made = makeSenzuFixture('http://arena-561-art.local/BT11-053.jpg');
const views: Viewport[] = [{name:'desk',width:1440,height:900,mobile:false},{name:'phone',width:390,height:844,mobile:true},{name:'shortphone',width:390,height:650,mobile:true}];
mkdirSync(evidence,{recursive:true});
writeFileSync(fixture,JSON.stringify(made.fresh),{flag:'wx'});
await requireServer(base);
const browser = await Browser.launch();
try {
 for (const skin of ['anime','night']) for (const viewport of views) {
  const page = await browser.page(viewport);
  await page.setCookie('arenaSkin',skin,base);
  await page.interceptFetch(['http://arena-561-art.local/*','*api/v1/games/561*']);
  page.onFetchPaused(request => {
   if(request.request.url.startsWith('http://arena-561-art.local/')) {
    const whis=request.request.url.includes('BT1-055');
    void page.fulfillFetchBytes(request.requestId,readFileSync(join(assets,whis?'whis-coercion-bt1-055.webp':'senzu-bean-bt11-053.jpg')),whis?'image/webp':'image/jpeg').catch(()=>undefined);
   } else void page.fulfillFetch(request.requestId,JSON.stringify(made.fresh)).catch(()=>undefined);
  });
  await page.goto(`${base}/arena/preview?fixture=u05-engine-proof&skin=${skin}&admin=0&staging=band`);
  await page.waitFor('[data-arena-card]');
  await sleep(700);
  await page.eval("document.querySelector('nextjs-portal')?.remove()");
  writeFileSync(join(evidence,`${tag}-${viewport.name}-${skin}.jpg`),await page.screenshot(false));
  assert.equal(await page.eval<boolean>('document.documentElement.scrollWidth <= innerWidth + 1'),true,'no horizontal page overflow');
  if(tag==='after') {
   assert.equal(await page.eval<boolean>("!!document.querySelector('[data-battle-stakes]')"),true);
   assert.equal(await page.eval<boolean>("document.querySelector('[data-pass-consequence]')?.textContent.includes('advances to damage') ?? false"),true);
   const bridge=page as unknown as {call(method:string,params?:object):Promise<unknown>};
   await bridge.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
   await page.eval("document.documentElement.style.fontSize='200%'");
   if(viewport.mobile) {
    for(let n=0;n<5;n++) {
     const visible=await page.eval<boolean>("(()=>{const r=document.querySelector('[data-pass-action]').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})()");
     if(visible)break;
     await bridge.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:viewport.width/2,y:viewport.height-100}]});
     for(let k=1;k<=5;k++) {await bridge.call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:viewport.width/2,y:viewport.height-100-k*60}]});await sleep(16);}
     await bridge.call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(100);
    }
   }
   assert(await page.eval<boolean>("document.documentElement.scrollWidth <= innerWidth+1"),'200% has no horizontal overflow');
   assert(await page.eval<boolean>("(()=>{const el=document.querySelector('[data-pass-action]');const r=el.getBoundingClientRect();const top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth&&(el===top||el.contains(top));})()"),'200% primary Pass is fully visible and unobscured');
   await page.eval("document.querySelector('nextjs-portal')?.remove()");
  writeFileSync(join(evidence,`${tag}-${viewport.name}-${skin}-200text-reduced.jpg`),await page.screenshot(false));
   await page.tap('[data-decision-summary] summary');
   assert(await page.eval<boolean>("(()=>{const el=document.querySelector('[data-pass-action]');const r=el.getBoundingClientRect();const top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return r.top>=0&&r.bottom<=innerHeight&&(el===top||el.contains(top));})()"),'expanded assumptions keep Pass visible and unobscured');
   await page.tap('[data-decision-summary] summary');
   await page.eval("window.__arenaSent=[];document.activeElement?.blur()");
   let reached=false;
   for(let n=0;n<100;n++) {
    if(await page.eval<boolean>("document.activeElement?.hasAttribute('data-pass-action') ?? false")){reached=true;break;}
    await bridge.call('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
    await bridge.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
   }
   assert(reached,'real Tab traversal reaches primary Pass');
   assert.equal(await page.eval<boolean>("document.activeElement?.hasAttribute('data-pass-action') ?? false"),true,'Pass accepts keyboard focus');
   await bridge.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});
   await bridge.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
   await sleep(700);
   const sent=await page.eval<Action[]>('window.__arenaSent ?? []');
   assert.equal(sent.length,1,'keyboard sends one exact legal action');
   assert.deepEqual(sent[0],made.fresh.legal.find(l=>l.action.type==='pass')!.action);
   const applied=applyWithEvents(made.state,sent[0]!);
   assert(applied.events.some(e=>e.type==='powerCompare'),'captured defense Pass reaches real power comparison');
  }
  await page.close();
 }
 if(tag==='after') {
  for(const kind of ['double','critical','lethal','payment'] as const) for(const skin of ['anime','night']) for(const viewport of views.slice(0,2)) {
   const {state}=kind === 'payment' ? paymentFixture() : battleFixture(kind);const snapshot=snapshot562(state);
   writeFileSync(fixture,JSON.stringify(snapshot));
   const page=await browser.page(viewport);await page.setCookie('arenaSkin',skin,base);
   await page.interceptFetch(['http://arena-561-art.local/*','*api/v1/games/562*']);
   page.onFetchPaused(request=>{if(request.request.url.startsWith('http://arena-561-art.local/')){
    const whis=request.request.url.includes('BT1-055');void page.fulfillFetchBytes(request.requestId,readFileSync(join(assets,whis?'whis-coercion-bt1-055.webp':'senzu-bean-bt11-053.jpg')),whis?'image/webp':'image/jpeg').catch(()=>undefined);
   }else void page.fulfillFetch(request.requestId,JSON.stringify(snapshot)).catch(()=>undefined);});
   await page.goto(`${base}/arena/preview?fixture=u05-engine-proof&skin=${skin}&admin=0&staging=band`);await page.waitFor('[data-battle-stakes]');await sleep(200);
   const text=await page.eval<string>("document.querySelector('[data-battle-stakes]').textContent");
   if(kind === 'payment') {
    const previews=await page.eval<string[]>("[...document.querySelectorAll('[data-payment-preview]')].map(el=>el.textContent)");assert(new Set(previews).size>1,'exact payment choices show different remaining coloured energy before submission');
   }else assert(text.includes(kind==='double'?'Double Strike':kind==='critical'?'Critical':'Potential game-ending'));
   await page.eval("document.querySelector('nextjs-portal')?.remove()");
  writeFileSync(join(evidence,`after-${viewport.name}-${skin}-${kind}.jpg`),await page.screenshot(false));
   if(kind==='payment') {await sleep(700);await page.eval('window.__arenaSent=[]');await page.tap('[data-payment-option="0"]');await sleep(500);const sent=await page.eval<Action[]>('window.__arenaSent??[]');assert.equal(sent.length,1);assert.deepEqual(sent[0],snapshot.legal[0]!.action);const applied=apply562(state,sent[0]!);assert(applied.events.some(e=>e.type==='move'&&e.to==='combo'));}
   await page.close();
  }
  for(const skin of ['anime','night']) for(const viewport of views.slice(0,2)) {
   const whis=makeWhisFixture('http://arena-561-art.local/BT1-055.webp');let current=snapshot562(whis.state,3);
   const initial=current;writeFileSync(fixture,JSON.stringify(initial));
   const page=await browser.page(viewport);await page.setCookie('arenaSkin',skin,base);
   await page.interceptFetch(['http://arena-561-art.local/*','*api/v1/games/562*']);
   page.onFetchPaused(request=>{if(request.request.url.startsWith('http://arena-561-art.local/')){
     void page.fulfillFetchBytes(request.requestId,readFileSync(join(assets,'whis-coercion-bt1-055.webp')),'image/webp').catch(()=>undefined);
   }else void page.fulfillFetch(request.requestId,JSON.stringify(current)).catch(()=>undefined);});
   await page.goto(`${base}/arena/preview?fixture=u05-engine-proof&skin=${skin}&admin=0&staging=band`);await page.waitFor('[data-pass-action]');
   assert((await page.eval<string>("document.querySelector('[data-pass-consequence]').textContent")).includes('Counter: Attack'));
   await sleep(700);await page.eval("window.__arenaSent=[]");await page.tap("[data-pass-action]:not(:disabled)");await sleep(900);
   const sent=await page.eval<Action[]>('window.__arenaSent ?? []');assert.deepEqual(sent,[initial.legal.find(l=>l.action.type==='counter'&&l.action.card===null)!.action]);
   let result=apply562(whis.state,sent[0]!).state as VmState;
   assert.equal(result.prompt.kind,'combo');assert.equal(result.prompt.player,'p2');
   const offense=snapshot562(result,4,'p2');result=apply562(result,offense.legal.find(l=>l.action.type==='pass')!.action).state as VmState;
   current=snapshot562(result,5);assert.equal(current.game.you,initial.game.you);
   const end=Date.now()+7000;while(Date.now()<end && !(await page.eval<boolean>("document.querySelector('[data-pass-consequence]')?.textContent.includes('advances to damage') ?? false")))await sleep(100);
   assert(await page.eval<boolean>("document.querySelector('[data-pass-consequence]').textContent.includes('advances to damage')"),'same viewer updates from genuine Counter to Defense prompt');
   await page.eval("document.querySelector('nextjs-portal')?.remove()");
  writeFileSync(join(evidence,`after-${viewport.name}-${skin}-counter-to-defense.jpg`),await page.screenshot(false));
   current=initial;await sleep(1700);
   assert(await page.eval<boolean>("document.querySelector('[data-pass-consequence]').textContent.includes('advances to damage')"),'stale poll cannot roll the decision back');
   await page.close();
  }
 }
} finally {await browser.close();rmSync(fixture,{force:true});restoreFixtureDefs();}
console.log(`#562 ${tag} EngineAPI proof captured`);
