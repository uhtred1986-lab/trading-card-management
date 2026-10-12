/** Database-free browser proof using genuine EngineAPI snapshots and captured actions. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Browser, requireServer, sleep, type Viewport } from './lib/cdp.mts';
import { makeSenzuFixture, makeWhisFixture, applyWithEvents, restoreFixtureDefs } from './verify/ability-engine-fixture-561';
import { battleFixture, paymentFixture, snapshot562, apply562, occupiedFixture } from './verify/battle-engine-fixture-562';
import type { VmState } from '../src/lib/arena/vm/state';
import type { Action } from '../src/lib/arena/types';
import type { Snapshot } from '../src/lib/arena/snapshot';
const base = process.argv.find(a => a.startsWith('--base='))?.slice(7) ?? 'http://localhost:3022';
const tag = process.argv.includes('--before') ? 'before' : 'after';
const evidence = resolve('docs/arena-backlog/evidence/562');
const fixture = resolve('contract/fixtures/u05-engine-proof.json');
const assets = resolve('docs/arena-backlog/evidence/546/assets');
const made = makeSenzuFixture('http://arena-561-art.local/BT11-053.jpg');
const views: Viewport[] = [{name:'desk',width:1440,height:900,mobile:false},{name:'phone',width:390,height:844,mobile:true},{name:'shortphone',width:390,height:650,mobile:true}];
type BrowserPage = Awaited<ReturnType<Browser['page']>>;
type TapArea = { x: number; y: number };
async function captureReady(page: BrowserPage, filename: string, selector='[data-battle-stakes]', expected?: string) {
 for(let attempt=0;attempt<3;attempt++) {
  await page.waitFor(selector);await sleep(400);
  await page.eval("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  const ready=()=>page.eval<boolean>(`(() => {const el=document.querySelector(${JSON.stringify(selector)});return !!el${expected?`&&el.textContent.includes(${JSON.stringify(expected)})`:''};})()`);
  if(!(await ready()))continue;
  const bytes=await page.screenshot(false);
  if(await ready()){writeFileSync(join(evidence,filename),bytes);return;}
 }
 throw Error(`Capture ${filename} did not retain expected rendered decision`);
}
async function tapArea(page: BrowserPage, selector: string): Promise<TapArea | null> {
 return page.eval<TapArea | null>(`(() => {
  const el=document.querySelector(${JSON.stringify(selector)}); if(!el)return null;
  const r=el.getBoundingClientRect(), bar=document.querySelector('.arena-bar').getBoundingClientRect();
  for(let y=Math.max(22,r.top+22);y<=Math.min(innerHeight-22,bar.top-22,r.bottom-22);y+=4) {
   for(let x=Math.max(22,r.left+22);x<=Math.min(innerWidth-22,r.right-22);x+=4) {
    if([-21,0,21].every(dx=>[-21,0,21].every(dy=>{const hit=document.elementFromPoint(x+dx,y+dy);return hit===el||el.contains(hit);})))return {x,y};
   }
  }
  return null;
 })()`);
}
async function fingerScroll(page: BrowserPage, viewport: Viewport, direction: number) {
 const bridge=page as unknown as {call(method:string,params?:object):Promise<unknown>};
 const barTop=await page.eval<number>("document.querySelector('.arena-bar').getBoundingClientRect().top");
 const start=direction<0?Math.max(100,Math.min(viewport.height-100,barTop-30)):70;
 const finish=direction<0?40:Math.min(viewport.height-40,start+260);
 await bridge.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:viewport.width-12,y:start}]});
 for(let n=1;n<=12;n++){await bridge.call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:viewport.width-12,y:start+(finish-start)*n/12}]});await sleep(40);}
 await bridge.call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(650);
}
async function handComboArea(page: BrowserPage, snapshot: Snapshot, viewport: Viewport, scrolling: boolean) {
 const combos=snapshot.legal.filter(row=>row.action.type==='combo'&&snapshot.view.you.hand?.some(card=>row.action.type==='combo'&&card.id===row.action.card));
 assert(combos.length>0,'fixture has an actual legal hand combo');
 for(let n=0;n<(scrolling?14:1);n++) {
  for(const row of combos) if(row.action.type==='combo') {
   const selector=`.arena-hand [data-arena-card="${row.action.card}"] button:not(:disabled)`;
   const area=await tapArea(page,selector);if(area){await sleep(500);const settled=await tapArea(page,selector);if(settled)return {row,area:settled,card:row.action.card};}
  }
  if(scrolling) {
   const bottom=await page.eval<number>(`document.querySelector('.arena-hand').getBoundingClientRect().bottom`);
   await fingerScroll(page,viewport,bottom<150?1:-1);
  }
 }
 console.log(await page.eval(`JSON.stringify({scrollY,innerHeight,bar:document.querySelector('.arena-bar').getBoundingClientRect().toJSON(),hand:document.querySelector('.arena-hand').getBoundingClientRect().toJSON(),cards:[...document.querySelectorAll('.arena-hand [data-arena-card] button:not(:disabled)')].map(el=>({rect:el.getBoundingClientRect().toJSON(),card:el.closest('[data-arena-card]').dataset.arenaCard}))})`));
 throw Error(`${viewport.name}: no unobscured 44px hand-combo tap area outside the sticky prompt`);
}
mkdirSync(evidence,{recursive:true});
writeFileSync(fixture,JSON.stringify(made.fresh),{flag:'wx'});
await requireServer(base);
const browser = await Browser.launch();
try {
 for (const skin of ['anime','night']) for (const viewport of views) {
  let currentSnapshot=made.fresh;
  let currentState=made.state;
  writeFileSync(fixture,JSON.stringify(currentSnapshot));
  const page = await browser.page(viewport);
  await page.setCookie('arenaSkin',skin,base);
  await page.interceptFetch(['http://arena-561-art.local/*','*api/v1/games/561*']);
  page.onFetchPaused(request => {
   if(request.request.url.startsWith('http://arena-561-art.local/')) {
    const whis=request.request.url.includes('BT1-055');
    void page.fulfillFetchBytes(request.requestId,readFileSync(join(assets,whis?'whis-coercion-bt1-055.webp':'senzu-bean-bt11-053.jpg')),whis?'image/webp':'image/jpeg').catch(()=>undefined);
   } else void page.fulfillFetch(request.requestId,JSON.stringify(currentSnapshot)).catch(()=>undefined);
  });
  await page.goto(`${base}/arena/preview?fixture=u05-engine-proof&skin=${skin}&admin=0&staging=band`);
  await page.waitFor('[data-arena-card]');
  await sleep(700);
  await page.eval("document.querySelector('nextjs-portal')?.remove()");
  await captureReady(page,`${tag}-${viewport.name}-${skin}.jpg`,tag==='before'?'[data-arena-card]':'[data-battle-stakes]');
  assert.equal(await page.eval<boolean>('document.documentElement.scrollWidth <= innerWidth + 1'),true,'no horizontal page overflow');
  if(tag==='after') {
   assert.equal(await page.eval<boolean>("!!document.querySelector('[data-battle-stakes]')"),true);
   assert.equal(await page.eval<boolean>("document.querySelector('[data-pass-consequence]')?.textContent.includes('advances to damage') ?? false"),true);
   const bridge=page as unknown as {call(method:string,params?:object):Promise<unknown>};
   const sendHandCombo=async (combo: Awaited<ReturnType<typeof handComboArea>>, capture: string) => {
    await page.eval('window.__arenaSent=[]');
    await page.pointer('down',combo.area.x,combo.area.y);await page.pointer('up',combo.area.x,combo.area.y);await sleep(300);
    const sent=await page.eval<Action[]>('window.__arenaSent??[]');assert.deepEqual(sent,[combo.row.action],'real finger sends exact offered hand combo');
    const applied=applyWithEvents(currentState,sent[0]!);
    assert(applied.state.sides.p1.zones.combo.includes(combo.card),'captured hand card really enters Combo Area');
    assert(applied.events.some(event=>event.type==='move'&&event.card===combo.card&&event.to==='combo'),'combo emits its actual movement');
    const before=currentSnapshot;currentState=applied.state;currentSnapshot=snapshot562(currentState,before.game.revision+1,'p1',before.game.id);
    assert.equal(currentSnapshot.view.you.handCount,before.view.you.handCount-1);
    assert.equal(currentSnapshot.view.you.activeEnergy,before.view.you.activeEnergy,'zero-cost combo does not rest energy');
    assert.equal(currentSnapshot.view.battle!.guardPower,before.view.battle!.guardPower+before.view.you.hand!.find(card=>card.id===combo.card)!.comboPower!);
    writeFileSync(fixture,JSON.stringify(currentSnapshot));
    const power=currentSnapshot.view.battle!.guardPower.toLocaleString('en-US');
    const updated=()=>page.eval<boolean>(`document.querySelector('[data-battle-stakes]').textContent.includes(${JSON.stringify(power)})`);
    const end=Date.now()+7000;while(Date.now()<end&&!(await updated()))await sleep(100);
    assert(await updated(),'actual combo power updates in the same browser view');
    await captureReady(page,capture,'[data-battle-stakes]',power);
   };
   if(viewport.mobile) {
    const direct=await handComboArea(page,currentSnapshot,viewport,viewport.name!=='phone');
    assert(await page.eval<boolean>(`(() => {const band=document.querySelector('.arena-band').getBoundingClientRect();const rows=[...document.querySelectorAll('[data-player-resources]')].map(el=>el.getBoundingClientRect());return band.top>=rows[0].bottom-1&&band.bottom<=rows[1].top+1;})()`),'band does not obscure either resource row');
    if(viewport.name==='phone') assert.equal(await page.eval<number>('scrollY'),0,'initial normal phone hand is usable without scrolling');
    await page.tap('.arena-hand button[aria-label^="Inspect your hand"]');
    await page.waitFor('[data-arena-review]');
    assert(await page.eval<boolean>("!!document.querySelector('[data-arena-review] [aria-label=\"Close card review\"]')"),'hand inspection still opens card review');
    await page.tap('[data-arena-review] [aria-label="Expand card to full screen"]');
    assert(await page.eval<boolean>("!!document.querySelector('[aria-label=\"Full card artwork\"]')"),'hand inspection expands fullscreen');
    await captureReady(page,`after-${viewport.name}-${skin}-hand-inspection.jpg`,'[aria-label="Full card artwork"]');
    await page.tap('[data-arena-review] [aria-label="Close card review"]');
    for(let n=0;n<6 && await page.eval<number>('scrollY')>0;n++)await fingerScroll(page,viewport,1);
    const normal=await handComboArea(page,currentSnapshot,viewport,viewport.name!=='phone');
    await captureReady(page,`after-${viewport.name}-${skin}-hand-access.jpg`);
    assert(direct.card&&normal.card);
    await sendHandCombo(normal,`after-${viewport.name}-${skin}-hand-combo.jpg`);
   }
   await bridge.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
   await page.eval("document.documentElement.style.fontSize='200%'");
   if(viewport.mobile) {
    const combo=await handComboArea(page,currentSnapshot,viewport,true);
    await sendHandCombo(combo,`after-${viewport.name}-${skin}-hand-combo-200text.jpg`);
   }
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
  await captureReady(page,`${tag}-${viewport.name}-${skin}-200text-reduced.jpg`);
   await page.tap('[data-battle-assumptions] summary');
   assert(await page.eval<boolean>("(()=>{const el=document.querySelector('[data-pass-action]');const r=el.getBoundingClientRect();const top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return r.top>=0&&r.bottom<=innerHeight&&(el===top||el.contains(top));})()"),'expanded assumptions keep Pass visible and unobscured');
   await page.tap('[data-battle-assumptions] summary');
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
   const applied=applyWithEvents(currentState,sent[0]!);
   assert(applied.events.some(e=>e.type==='powerCompare'),'captured defense Pass reaches real power comparison');
  }
  await page.close();
 }
 if(tag==='after') {
  for(const skin of ['anime','night']) {
   const occupied=occupiedFixture();const snapshot=snapshot562(occupied.state);
   writeFileSync(fixture,JSON.stringify(snapshot));
   const page=await browser.page(views[1]!);await page.setCookie('arenaSkin',skin,base);
   await page.interceptFetch(['http://arena-561-art.local/*','*api/v1/games/562*']);
   page.onFetchPaused(request=>{if(request.request.url.startsWith('http://arena-561-art.local/')){
    const whis=request.request.url.includes('BT1-055');void page.fulfillFetchBytes(request.requestId,readFileSync(join(assets,whis?'whis-coercion-bt1-055.webp':'senzu-bean-bt11-053.jpg')),whis?'image/webp':'image/jpeg').catch(()=>undefined);
   }else void page.fulfillFetch(request.requestId,JSON.stringify(snapshot)).catch(()=>undefined);});
   await page.goto(`${base}/arena/preview?fixture=u05-engine-proof&skin=${skin}&admin=0&staging=band`);await page.waitFor('[data-battle-stakes]');await sleep(700);
   assert(await page.eval<boolean>(`document.querySelector('.arena-row [data-arena-card="${occupied.card}"]').closest('.arena-row').getBoundingClientRect().height>=127`),'occupied Battle row retains its full card footprint');
   await page.tap('[aria-label="Review cards in play"]');await page.waitFor('[data-arena-review]');
   await page.tap(`[data-arena-thumb="${occupied.card}"]`);await page.waitFor(`[data-arena-review="${occupied.card}"]`);
   assert(await page.eval<boolean>(`document.querySelector('[data-arena-review="${occupied.card}"]').textContent.includes(${JSON.stringify(snapshot.view.you.battle[0]!.name)})`),'occupied-row card remains available in review');
   await page.tap('[data-arena-review] [aria-label="Expand card to full screen"]');
   assert(await page.eval<boolean>("document.querySelector('[aria-label=\"Full card artwork\"]')!==null"),'occupied-row inspection can expand fullscreen');
   await page.eval("document.querySelector('nextjs-portal')?.remove()");await captureReady(page,`after-phone-${skin}-occupied-inspection.jpg`,'[aria-label="Full card artwork"]');
   await page.close();
  }
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
  await captureReady(page,`after-${viewport.name}-${skin}-${kind}.jpg`,'[data-battle-stakes]',kind==='double'?'Double Strike':kind==='critical'?'Critical':kind==='lethal'?'Potential game-ending':undefined);
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
  await captureReady(page,`after-${viewport.name}-${skin}-counter-to-defense.jpg`,'[data-pass-consequence]','advances to damage');
   current=initial;await sleep(1700);
   assert(await page.eval<boolean>("document.querySelector('[data-pass-consequence]').textContent.includes('advances to damage')"),'stale poll cannot roll the decision back');
   await page.close();
  }
 }
} finally {await browser.close();rmSync(fixture,{force:true});restoreFixtureDefs();}
console.log(`#562 ${tag} EngineAPI proof captured`);
