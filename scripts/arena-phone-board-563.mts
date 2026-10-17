/** Offline browser transport; snapshots and captured actions remain genuine EngineAPI results. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Browser, requireServer, sleep, type Viewport } from './lib/cdp.mts';
import { phoneFixture, chargeFixture, snapshot563, apply563 } from './verify/phone-engine-fixture-563';
import { paymentFixture } from './verify/battle-engine-fixture-562';
import { makeWhisFixture } from './verify/ability-engine-fixture-561';
import type { Action } from '../src/lib/arena/types';
const base = process.argv.find(a => a.startsWith('--base='))?.slice(7) ?? 'http://localhost:3023';
const before = process.argv.includes('--before');
const evidence = resolve('docs/arena-backlog/evidence/563');
const fixture = resolve('contract/fixtures/u06-engine-proof.json');
const assets = resolve('docs/arena-backlog/evidence/546/assets');
const views: Viewport[] = [
 {name:'desk',width:1440,height:900,mobile:false},
 {name:'phone',width:390,height:844,mobile:true},
 {name:'short',width:390,height:667,mobile:true},
 {name:'small',width:320,height:568,mobile:true},
 {name:'landscape',width:844,height:390,mobile:true},
];
type Page = Awaited<ReturnType<Browser['page']>>;
async function hitArea(page:Page,selector:string) {
 const sample=selector.includes('[data-arena-card')?21:14;
 return page.eval<{x:number;y:number}|null>(`(() => {const el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;const r=el.getBoundingClientRect();if(r.width<43.5||r.height<43.5)return null;for(let y=Math.max(22,r.top+22);y<=Math.min(innerHeight-22,r.bottom-22);y+=8)for(let x=Math.max(22,r.left+22);x<=Math.min(innerWidth-22,r.right-22);x+=8)if([-${sample},0,${sample}].every(dx=>[-${sample},0,${sample}].every(dy=>{const hit=document.elementFromPoint(x+dx,y+dy);return el===hit||el.contains(hit);})))return{x,y};return null;})()`);
}
/** Phones open on the takeover staging since #982 (`phoneCinema` starts true); this script's phone layout checks are of the compact board, so switch to it from the settings sheet, as a player would. */
async function compactPhoneBoard(page:Page) {
 await page.eval("document.querySelector('[aria-label=\"Open arena settings and counts\"]').click()");await sleep(400);
 const switched=await page.eval<boolean>("(()=>{const el=[...document.querySelectorAll('dialog button')].find(b=>b.textContent.includes('Use compact phone board'));if(!el)return false;el.click();return true;})()");
 assert(switched,'the settings sheet offers the compact phone board');
 await page.eval("document.querySelector('dialog[open] [data-sheet-initial-focus]').click()");await sleep(400);
 assert(!(await page.eval<boolean>("!!document.querySelector('.arena-band')")),'the compact phone board has no cinematic band');
}
async function reach(page:Page,selector:string,dock=false) {
 for(let n=0;n<18;n++) {
  const area=await hitArea(page,selector);if(area)return area;
  if(dock) await page.swipe('.arena-bar',0,-100);
  else if(await page.eval<boolean>("!!document.querySelector('dialog[open] .overflow-y-auto')")) {
   const up=await page.eval<boolean>(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().top<document.querySelector('dialog[open] .overflow-y-auto').getBoundingClientRect().top`);
   await page.swipe('dialog[open] .overflow-y-auto',0,up?100:-120);
  } else {
   const bridge=page as unknown as {call(method:string,params?:object):Promise<unknown>};
   const size=await page.eval<{w:number;h:number;bar:number;top:number;target:number;above:boolean}>(`({w:innerWidth,h:innerHeight,bar:document.querySelector('.arena-bar').getBoundingClientRect().top,top:document.querySelector('.arena-topbar').getBoundingClientRect().bottom,target:document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().top,above:document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().top<document.querySelector('.arena-topbar').getBoundingClientRect().bottom})`);
   // Move just enough to clear the sticky bars. Large swipes can skip the
   // narrow visible window between them at 200% text on a short phone.
   const desired=size.above?size.top+12:size.bar-56;
   const delta=desired-size.target;
   const visibleTravel=Math.max(32,size.bar-size.top-24);
   const distance=Math.sign(delta)*Math.min(150,visibleTravel,Math.max(32,Math.abs(delta)));
   const surface=await page.eval<{x:number;y:number;name:string}|null>(`(() => {
    const min=${distance<0?20-distance:20},max=${distance>0?size.h-20-distance:size.h-20};
    const valid=(x,y)=>{const hit=document.elementFromPoint(x,y);return hit?.closest('.arena-board')&&!hit.closest('[data-arena-card],dialog,.arena-bar,[aria-hidden]')&&!['none','pan-x'].includes(getComputedStyle(hit).touchAction)};
    for(const name of ['[data-hand-toolbar]','[data-player-resources="p1"]','.arena-pstrip'])for(const el of document.querySelectorAll(name)){
     const r=el.getBoundingClientRect(),low=Math.max(r.top,${size.top}+2,min),high=Math.min(r.bottom,${size.bar}-2,max);
     if(low+5>high-5)continue;const y=(low+high)/2;
     for(const x of [Math.max(r.left+20,Math.min(r.right-20,${size.w}/2)),r.left+20])if(valid(x,y))return{x,y,name};
    }
    const ys=[];for(let y=${distance<0?size.bar-16:size.top+16};${distance<0?'y>=Math.max(min,innerHeight*.2)':'y<=Math.min(max,innerHeight*.8)'};y+=${distance<0?-16:16})ys.push(y);
    for(const y of ys)if(y>=min&&y<=max)for(const x of [${size.w}-30,${size.w}/2,30])if(valid(x,y))return{x,y,name:'visible board'};
    return null;
   })()`);
   if(!surface){writeFileSync(join(evidence,'failure.jpg'),await page.screenshot(false));throw Error(`No visible board surface for vertical touch scroll: ${selector}; ${await page.eval<string>(`JSON.stringify({scrollY,maxScroll:document.documentElement.scrollHeight-innerHeight,height:innerHeight,target:document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect().toJSON(),top:document.querySelector('.arena-topbar')?.getBoundingClientRect().toJSON(),bar:document.querySelector('.arena-bar')?.getBoundingClientRect().toJSON(),toolbar:document.querySelector('[data-hand-toolbar]')?.getBoundingClientRect().toJSON(),resources:document.querySelector('[data-player-resources="p1"]')?.getBoundingClientRect().toJSON(),at:[50,100,150,200,250,300].map(y=>[y,document.elementFromPoint(innerWidth/2,y)?.outerHTML.slice(0,120)])})`)}`);}
   const start=surface.y,finish=start+distance;
   await bridge.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:surface.x,y:start}]});
   for(let i=1;i<=8;i++){await bridge.call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:surface.x,y:start+(finish-start)*i/8}]});await sleep(25);}
   await bridge.call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }
  await sleep(180);
 }
 writeFileSync(join(evidence,'failure.jpg'),await page.screenshot(false));
 throw Error(`No unobscured 44px target: ${selector}; ${await page.eval<string>(`JSON.stringify({target:document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect().toJSON(),scrollY,maxScroll:document.documentElement.scrollHeight-innerHeight,height:innerHeight,top:document.querySelector('.arena-topbar').getBoundingClientRect().toJSON(),hand:document.querySelector('.arena-hand').getBoundingClientRect().toJSON(),bar:document.querySelector('.arena-bar').getBoundingClientRect().toJSON()})`)}`);
}
async function fingerTap(page:Page,selector:string,dock=false) {
 await reach(page,selector,dock);await sleep(500);
 const area=await reach(page,selector,dock);await page.pointer('down',area.x,area.y);await page.pointer('up',area.x,area.y);await sleep(500);
}
async function handSwipe(page:Page,_y:number,dx:number) {
 const bridge=page as unknown as {call(method:string,params?:object):Promise<unknown>};
 const box=await page.eval<{left:number;right:number;y:number}>(`(() => {const r=document.querySelector('[aria-label="Scrollable hand cards"]').getBoundingClientRect();const top=Math.max(r.top,document.querySelector('.arena-topbar').getBoundingClientRect().bottom);const bottom=Math.min(r.bottom,document.querySelector('.arena-bar').getBoundingClientRect().top);return {left:r.left,right:r.right,y:(top+bottom)/2};})()`);
 assert(box.right-box.left>=80,'hand has a visible swipe surface');
 const y=box.y;const start=dx<0?box.right-40:box.left+40;const finish=Math.max(box.left+30,Math.min(box.right-30,start+dx));
 await bridge.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:start,y}]});
 for(let n=1;n<=10;n++){await bridge.call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start+(finish-start)*n/10,y}]});await sleep(25);}
 await bridge.call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(400);
}
mkdirSync(evidence,{recursive:true}); await requireServer(base);
const browser=await Browser.launch();
try {
 for(const skin of ['anime','night']) for(const viewport of views.filter(v=>!process.argv.includes('--actions-only')&&(!process.argv.includes('--phone-only')||v.name==='phone')&&(!process.argv.includes('--small-only')||v.name==='small')&&(!process.argv.includes('--landscape-only')||v.name==='landscape'))) {
  console.log(`${before?'before':'after'} ${skin} ${viewport.name}`);
  const made=phoneFixture(viewport.name==='short'?12:20);let snapshot=made.snapshot;let state=made.state;
  writeFileSync(fixture,JSON.stringify(snapshot));
  const page=await browser.page(viewport);await page.setCookie('arenaSkin',skin,base);
  await page.interceptFetch(['http://arena-561-art.local/*','*api/v1/games/563*']);
  page.onFetchPaused(request=>{
   if(request.request.url.startsWith('http://arena-561-art.local/')) {
    const whis=request.request.url.includes('BT1-055');
    void page.fulfillFetchBytes(request.requestId,readFileSync(join(assets,whis?'whis-coercion-bt1-055.webp':'senzu-bean-bt11-053.jpg')),whis?'image/webp':'image/jpeg').catch(()=>undefined);
   }else void page.fulfillFetch(request.requestId,JSON.stringify(snapshot)).catch(()=>undefined);
  });
  await page.goto(`${base}/arena/preview?fixture=u06-engine-proof&skin=${skin}&admin=0&staging=band`);
  await page.waitFor('[data-battle-stakes]');await sleep(850);
  if(viewport.mobile)await compactPhoneBoard(page);
  await page.eval("document.querySelector('nextjs-portal')?.remove()");
  await page.eval('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  writeFileSync(join(evidence,`${before?'before':'after'}-${viewport.name}-${skin}.jpg`),await page.screenshot(false));
  if(!before) {
   assert(await page.eval<boolean>('document.documentElement.scrollWidth<=innerWidth+1'),'no horizontal page overflow');
   if(viewport.mobile) {
    const first=made.snapshot.view.you.hand![0]!.id;
    await fingerTap(page,'.arena-hand button[aria-label^="Open the whole hand"]');
    if(!(await page.eval<boolean>("!!document.querySelector('[data-arena-review]')"))) {writeFileSync(join(evidence,'failure.jpg'),await page.screenshot(false));throw Error(`${viewport.name}: real inspect touch did not open`);}
    await fingerTap(page,'[aria-label="Expand card to full screen"]');await page.waitFor('[aria-label="Full card artwork"]');
    await page.swipe('[aria-label="Full card artwork"]',-130,0);await sleep(250);
    assert.equal(await page.eval<string>("document.querySelector('[data-arena-review]').dataset.arenaReview"),made.snapshot.view.you.hand![1]!.id,'actual fullscreen flick pages by stable instance');
    writeFileSync(join(evidence,`after-${viewport.name}-${skin}-fullscreen-swipe.jpg`),await page.screenshot(false));
    await fingerTap(page,'[aria-label="Show card details"]');
    assert(await page.eval<boolean>("(()=>{const d=[...document.querySelectorAll('[data-arena-review] [data-abilities-now] details')].find(el=>el.textContent.includes('Other abilities'));return !!d&&!d.open;})()"),'wrong-timing Counter ability remains collapsed');
    await fingerTap(page,'[aria-label="Close card review"]');
    await fingerTap(page,'.arena-hand button[aria-expanded="false"]');
    assert(await page.eval<boolean>("document.querySelector('.arena-hand').dataset.handExpanded==='true'"),'Expand separates artwork');
    const handPort='[aria-label="Scrollable hand cards"]';
    const handArea=await reach(page,`${handPort} [data-arena-card="${first}"] button`);
    const beforeScroll=await page.eval<number>(`document.querySelector('${handPort}').scrollLeft`);
    await handSwipe(page,handArea.y,-300);
    assert((await page.eval<number>(`document.querySelector('${handPort}').scrollLeft`))>beforeScroll+50,'crowded hand accepts real horizontal touch swipe');
    const combo=snapshot.legal.find(row=>row.action.type==='combo'&&snapshot.view.you.hand!.some(card=>row.action.type==='combo'&&card.id===row.action.card))!;assert(combo);
    // Return the hand by a real opposite swipe, then tap its actual legal card.
    await handSwipe(page,handArea.y,350);await sleep(300);
    if(viewport.name==='phone'&&skin==='anime') {
     await fingerTap(page,'.arena-hand button[aria-expanded="true"]');
     for(let n=0;n<12&&(await page.eval<number>(`document.querySelector('${handPort}').scrollLeft`))>0;n++)await handSwipe(page,handArea.y,350);
     const covered=new Set<string>();
     for(let n=0;n<12;n++) {
      for(const card of snapshot.view.you.hand!) if(await hitArea(page,`.arena-hand [data-arena-card="${card.id}"] button`))covered.add(card.id);
      const left=await page.eval<{x:number;max:number}>(`(() => {const el=document.querySelector('${handPort}');return{x:el.scrollLeft,max:el.scrollWidth-el.clientWidth}})()`);
      if(left.x>=left.max-1)break;
      await handSwipe(page,handArea.y,-140);
     }
     assert.deepEqual([...covered].sort(),snapshot.view.you.hand!.map(card=>card.id).sort(),'real swipes expose a 44px hit square for every crowded hand card');
     for(let n=0;n<12&&(await page.eval<number>(`document.querySelector('${handPort}').scrollLeft`))>0;n++)await handSwipe(page,handArea.y,350);
    }
    await page.eval('window.__arenaSent=[]');
    if(combo.action.type!=='combo')throw Error('combo expected');
    const comboCard=combo.action.card;
    await fingerTap(page,`.arena-hand [data-arena-card="${comboCard}"] button`);
    const captured=await page.eval<Action[]>('window.__arenaSent??[]');assert.deepEqual(captured,[combo.action]);
    const applied=apply563(state,captured[0]!);assert(applied.events.some(e=>e.type==='move'&&e.to==='combo'&&e.card===comboCard));
    const old=snapshot;state=applied.state as typeof state;snapshot=snapshot563(state,3,'p1',563);
    assert.equal(snapshot.view.you.handCount,old.view.you.handCount-1);assert.equal(snapshot.view.you.activeEnergy,old.view.you.activeEnergy);
    assert(snapshot.view.battle!.guardPower>old.view.battle!.guardPower,'captured touch changes actual battle power');
    await sleep(1800);
    assert.equal(await page.eval<number>("document.querySelectorAll('.arena-hand [data-arena-card]').length"),snapshot.view.you.handCount,'new authoritative revision updates the same hand');
    // Every uncommon zone has reachable inspection; all shown cards are engine projections.
    await fingerTap(page,'[aria-label="Inspect public zones"]');await page.waitFor('[data-inspect-zone]');
    for(const zone of ['Unison','Z-Deck','Z-Energy','Drop','Warp']) {
     assert(await page.eval<boolean>(`!!document.querySelector('[data-inspect-zone="p1:${zone}"] [data-arena-card]')`),`${zone} contains actual projected fixture cards`);
    }
    assert(await page.eval<boolean>("!document.querySelector('[data-inspect-zone=\"p2:Z-Deck\"] [data-arena-card]')"),'opponent closed Z-Deck does not leak identities');
    writeFileSync(join(evidence,`after-${viewport.name}-${skin}-zones.jpg`),await page.screenshot(false));
    await page.tap('[data-sheet-initial-focus]');await sleep(300);
    const bridge=page as unknown as {call(method:string,params?:object):Promise<unknown>};
    await bridge.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await page.eval("document.documentElement.style.fontSize='200%'");
    await reach(page,'.arena-hand button[aria-label^="Open the whole hand"]');
    writeFileSync(join(evidence,`after-${viewport.name}-${skin}-200text-reduced-hand.jpg`),await page.screenshot(false));
    if(viewport.name==='landscape') {
     const details='[data-decision-summary] > div';
     assert(await page.eval<boolean>(`(()=>{const el=document.querySelector('${details}');return el.scrollHeight>el.clientHeight+10;})()`),'200% landscape stakes and consequence have a scrollable viewport');
     await page.swipe(details,0,-45);await sleep(300);
     assert(await page.eval<boolean>(`(()=>{const el=document.querySelector('${details}'),p=el.querySelector('[data-pass-consequence]'),r=el.getBoundingClientRect(),t=p.getBoundingClientRect();return el.scrollTop>0&&t.top>=r.top-1&&t.bottom<=r.bottom+1;})()`),'actual touch reveals the full Pass consequence without activating Pass');
     assert.deepEqual(await page.eval<Action[]>('window.__arenaSent??[]'),[combo.action],'stakes swipe sends no second action');
     writeFileSync(join(evidence,`after-${viewport.name}-${skin}-200text-reduced-consequence.jpg`),await page.screenshot(false));
     for(let n=0;n<5&&!(await hitArea(page,'[data-battle-assumptions] summary'));n++){await page.swipe(details,0,-45);await sleep(150);}
     assert(await hitArea(page,'[data-battle-assumptions] summary'),'real stakes swipes expose the 44px public-rules summary');
     await fingerTap(page,'[data-battle-assumptions] summary',true);
     assert(await page.eval<boolean>("document.querySelector('[data-battle-assumptions]').open"),'public-rules details expand by actual touch');
     for(let n=0;n<5&&!(await page.eval<boolean>(`(()=>{const el=document.querySelector('${details}'),p=el.querySelector('[data-battle-assumptions] p'),r=el.getBoundingClientRect(),t=p.getBoundingClientRect();return t.top>=r.top-1&&t.bottom<=r.bottom+1;})()`));n++){await page.swipe('[data-battle-assumptions] summary',0,-45);await sleep(150);}
     assert(await page.eval<boolean>(`(()=>{const el=document.querySelector('${details}'),p=el.querySelector('[data-battle-assumptions] p'),r=el.getBoundingClientRect(),t=p.getBoundingClientRect();return t.top>=r.top-1&&t.bottom<=r.bottom+1;})()`),'actual touch reveals the complete expanded assumption');
     assert.deepEqual(await page.eval<Action[]>('window.__arenaSent??[]'),[combo.action],'public-rules inspection sends no second action');
     writeFileSync(join(evidence,`after-${viewport.name}-${skin}-200text-reduced-assumptions.jpg`),await page.screenshot(false));
    }
    assert(await page.eval<boolean>('document.documentElement.scrollWidth<=innerWidth+1'),'200% has no horizontal page overflow');
    await page.eval('window.__arenaSent=[]');await fingerTap(page,'[data-pass-action]',true);
    const passed=await page.eval<Action[]>('window.__arenaSent??[]');assert.deepEqual(passed,[snapshot.legal.find(row=>row.action.type==='pass')!.action]);
    assert(apply563(state,passed[0]!).events.some(e=>e.type==='powerCompare'),'actual 200% touch Pass reaches engine battle comparison');
    writeFileSync(join(evidence,`after-${viewport.name}-${skin}-200text-reduced-pass.jpg`),await page.screenshot(false));
    if(viewport.name==='phone') {
     // Same-view stale transport cannot roll back the real combo revision.
     const fresh=snapshot;snapshot=old;await sleep(1800);
     assert.equal(await page.eval<number>("document.querySelectorAll('.arena-hand [data-arena-card]').length"),fresh.view.you.handCount,'stale poll retains fresh hand');snapshot=fresh;
     writeFileSync(fixture,JSON.stringify(snapshot));await page.goto(`${base}/arena/preview?fixture=u06-engine-proof&skin=${skin}&admin=0&staging=band`);await page.waitFor('[data-pass-action]');await sleep(700);await compactPhoneBoard(page);
     assert.equal(await page.eval<number>("document.querySelectorAll('.arena-hand [data-arena-card]').length"),snapshot.view.you.handCount,'reload reconstructs real current hand');
     // This installed Chromium predates setSafeAreaInsets. Substitute only
     // existing env() declarations in CSSOM; no layout or test-only app rules.
     await page.eval(`(()=>{const saved=[];const visit=rules=>{for(const rule of rules){if(rule.cssRules)visit(rule.cssRules);if(rule.style?.cssText.includes('env(safe-area-inset-')){saved.push([rule,rule.style.cssText]);rule.style.cssText=rule.style.cssText.replace(/env\\(safe-area-inset-(top|left|right|bottom)\\)/g,(_,edge)=>({top:'24px',left:'12px',right:'12px',bottom:'34px'})[edge]);}}};for(const sheet of document.styleSheets)visit(sheet.cssRules);window.__safeRules=saved;return saved.length;})()`);
     await sleep(200);
     await reach(page,'[data-pass-action]',true);await fingerTap(page,'.arena-hand button[aria-label^="Open the whole hand"]');await fingerTap(page,'[aria-label="Expand card to full screen"]');
     assert(await page.eval<boolean>("(()=>{const r=document.querySelector('[aria-label=\"Close card review\"]').getBoundingClientRect();return r.top>=24&&r.right<=innerWidth-12;})()"),'fullscreen controls respect emulated safe insets');
     writeFileSync(join(evidence,`after-phone-${skin}-safearea-fullscreen.jpg`),await page.screenshot(false));
     await fingerTap(page,'[aria-label="Close card review"]');
     writeFileSync(join(evidence,`after-phone-${skin}-safearea-board.jpg`),await page.screenshot(false));
     await page.eval("window.__safeRules.forEach(([rule,text])=>rule.style.cssText=text)");
     await bridge.call('Emulation.setDeviceMetricsOverride',{width:390,height:430,deviceScaleFactor:2,mobile:true});
     await reach(page,'.arena-hand button[aria-label^="Open the whole hand"]');await reach(page,'[data-pass-action]',true);
     writeFileSync(join(evidence,`after-phone-${skin}-keyboard-viewport.jpg`),await page.screenshot(false));
     await bridge.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
     await page.eval('window.__arenaSent=[];document.activeElement?.blur()');
     let focused=false;for(let n=0;n<160;n++) {
      if(await page.eval<boolean>("document.activeElement?.hasAttribute('data-pass-action')??false")){focused=true;break;}
      await bridge.call('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await bridge.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
     }
     assert(focused,'keyboard Tab reaches current Pass');await reach(page,'[data-pass-action]',true);
     writeFileSync(join(evidence,`after-phone-${skin}-keyboard-focus.jpg`),await page.screenshot(false));
     await bridge.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});await bridge.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await sleep(600);
     assert.deepEqual(await page.eval<Action[]>('window.__arenaSent??[]'),[snapshot.legal.find(row=>row.action.type==='pass')!.action],'actual keyboard activates exact Pass');
     await page.tap('[aria-label="Open arena settings and counts"]');
     await page.eval("(()=>{const el=[...document.querySelectorAll('dialog button')].find(b=>b.textContent.includes('Enable cinematic'));el.dataset.cinemaControl='';})()");
     for(let n=0;n<10&&!(await hitArea(page,'[data-cinema-control]'));n++)await page.swipe('dialog[open] .overflow-y-auto',0,-100);
     await fingerTap(page,'[data-cinema-control]');await page.tap('dialog[open] [data-sheet-initial-focus]');await sleep(400);
     assert(await page.eval<boolean>("!!document.querySelector('.arena-band')"),'cinematic staging remains explicitly available');
     assert(await page.eval<boolean>("(()=>{const b=document.querySelector('.arena-band').getBoundingClientRect();const r=[...document.querySelectorAll('[data-player-resources]')].map(x=>x.getBoundingClientRect());return b.top>=r[0].bottom-1&&b.bottom<=r[1].top+1;})()"),'cinematic band does not cover resource rows');
     await reach(page,'[data-pass-action]',true);await reach(page,'.arena-hand button[aria-label^="Open the whole hand"]');
     writeFileSync(join(evidence,`after-phone-${skin}-cinematic.jpg`),await page.screenshot(false));
    }
   }
  }
  await page.close();
 }
 if(!before&&!process.argv.includes('--layout-only')) for(const skin of ['anime','night']) for(const kind of (process.argv.includes('--charge-only')?['charge'] as const:['target','payment','counter','resource','charge'] as const)) {
  console.log(`actions ${skin} ${kind}`);
  let state=kind==='payment'?paymentFixture().state:kind==='counter'?makeWhisFixture('http://arena-561-art.local/BT1-055.webp').state:kind==='charge'?chargeFixture().state:phoneFixture().state;
  if(kind==='resource')state.cards[state.sides.p1.zones.energy[0]!]!.mode='rest';
  let snapshot=snapshot563(state,10,'p1',563);writeFileSync(fixture,JSON.stringify(snapshot));
  const page=await browser.page(views[1]!);await page.setCookie('arenaSkin',skin,base);
  await page.interceptFetch(['http://arena-561-art.local/*','*api/v1/games/563*']);
  page.onFetchPaused(request=>{if(request.request.url.startsWith('http://arena-561-art.local/')){const whis=request.request.url.includes('BT1-055');void page.fulfillFetchBytes(request.requestId,readFileSync(join(assets,whis?'whis-coercion-bt1-055.webp':'senzu-bean-bt11-053.jpg')),whis?'image/webp':'image/jpeg').catch(()=>undefined);}else void page.fulfillFetch(request.requestId,JSON.stringify(snapshot)).catch(()=>undefined);});
  await page.goto(`${base}/arena/preview?fixture=u06-engine-proof&skin=${skin}&admin=0&staging=band`);await page.waitFor(kind==='charge'?'.arena-hand [data-arena-card]':'[data-decision-summary]');await sleep(700);await compactPhoneBoard(page);
  const perform=async (selector:string,expected:Action,dock=false) => {
   await page.eval('window.__arenaSent=[]');await fingerTap(page,selector,dock);
   const sent=await page.eval<Action[]>('window.__arenaSent??[]');assert.deepEqual(sent,[expected]);
   const previous=state;const applied=apply563(state,sent[0]!);state=applied.state as typeof state;snapshot=snapshot563(state,snapshot.game.revision+1,'p1',563);await sleep(1700);
   return {previous,events:applied.events};
  };
  if(kind==='target') {
   await fingerTap(page,'.arena-hand button[aria-label^="Open the whole hand"]');await page.waitFor('[data-arena-review]');
   const activate=snapshot.legal.find(row=>row.action.type==='activate')!.action;
   const paid=await perform('[data-arena-review] [data-ability-index="0"] button',activate);
   assert(paid.events.some(e=>e.type==='mode'&&e.mode==='rest'),'actual ability pays its offered energy');assert.equal(snapshot.view.you.activeEnergy,0);
   assert.equal(snapshot.view.prompt.kind,'chooseCards');
   const leader=snapshot.view.you.leader!.id;
   const target=snapshot.legal.find(row=>row.action.type==='choose'&&row.action.cards?.includes(leader))!.action;
   const power=snapshot.view.you.leader!.power!;
   const result=await perform(`.arena-row [data-arena-card="${leader}"] button`,target);
   assert(result.events.some(e=>e.type==='effect'),'captured target emits the real effect');assert.equal(snapshot.view.you.leader!.power,power+5000);
   assert.equal(snapshot.view.prompt.kind,'chooseCards','engine offers energy targets after the power target');
   const energy=snapshot.view.you.energy[0]!.id;const ready=snapshot.legal.find(row=>row.action.type==='choose'&&row.action.cards?.includes(energy))!.action;
   await perform(`[data-player-resources="p1"] ~ div [data-arena-card="${energy}"] button`,ready);
   assert.equal(snapshot.view.you.activeEnergy,1);assert.equal(snapshot.view.prompt.kind,'combo');
  } else if(kind==='payment') {
   const previews=await page.eval<string[]>("[...document.querySelectorAll('[data-payment-preview]')].map(el=>el.textContent)");assert(new Set(previews).size>1,'server-priced alternatives retain distinct remaining colours');
   writeFileSync(join(evidence,`after-phone-${skin}-payment.jpg`),await page.screenshot(false));
   const offered=snapshot.legal.find(row=>row.action.type==='payCost')!.action;if(offered.type!=='payCost')throw Error('payment expected');
   const result=await perform(`[data-payment-option="${offered.option}"]`,offered,true);
   assert(result.events.some(e=>e.type==='move'&&e.to==='combo'));assert.equal(snapshot.view.you.activeEnergy,1,'selected payment rests one of two ready energy');
  } else if(kind==='counter') {
   const counter=snapshot.legal.find(row=>row.action.type==='counter'&&row.action.card!==null)!.action;if(counter.type!=='counter'||!counter.card)throw Error('counter expected');
   await fingerTap(page,'.arena-hand button[aria-label^="Open the whole hand"]');await page.waitFor('[data-arena-review]');
   assert(await page.eval<boolean>("document.querySelector('[data-arena-review] [data-abilities-now]').textContent.includes('Counter: Attack')"),'timely counter remains visible');
   const result=await perform('[data-arena-review] [data-ability-index="0"] button',counter);assert(result.events.some(e=>e.type==='attackNegated'),'actual captured counter negates actual attack');
   assert(state.battle?.negated,'actual attack is negated while the printed energy choice resolves');
   const energy=snapshot.view.you.energy[0]!.id;const ready=snapshot.legal.find(row=>row.action.type==='choose'&&row.action.cards?.includes(energy))!.action;
   await perform(`[data-player-resources="p1"] ~ div [data-arena-card="${energy}"] button`,ready);
   assert(!snapshot.view.battle,'negated battle ends after its actual energy choice');
  } else if(kind==='charge') {
   const bridge=page as unknown as {call(method:string,params?:object):Promise<unknown>};
   const drag=async (card:string,zone:'energy'|'battle',expected:Action) => {
    const from=await reach(page,`.arena-hand [data-arena-card="${card}"] button`);
    const to=await page.eval<{x:number;y:number}>(`(() => {const r=document.querySelector('[data-arena-zone="p1:${zone}"]').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
    assert(to.y>0&&to.y<await page.eval<number>('innerHeight'),'legal drop zone is onscreen');
    await page.eval('window.__arenaSent=[]');
    await bridge.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[from]});
    for(let n=1;n<=12;n++){await bridge.call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+(to.x-from.x)*n/12,y:from.y+(to.y-from.y)*n/12}]});await sleep(25);}
    if(!(await page.eval<boolean>(zone==='energy'?"!!document.querySelector('.arena-pstrip[data-drop=\"ok\"]')":"!!document.querySelector('.arena-field[data-drop=\"ok\"]:has([aria-label=\"Your Battle Area\"])')"))) {
     writeFileSync(join(evidence,'failure.jpg'),await page.screenshot(false));
     throw Error(`real drag must light a legal landing cue: ${await page.eval<string>(`JSON.stringify({zones:[...document.querySelectorAll('[data-drop]')].map(x=>[x.outerHTML.slice(0,130),x.getBoundingClientRect().toJSON()]),sent:window.__arenaSent,from:${JSON.stringify(from)},to:${JSON.stringify(to)}})`)}`);
    }
    if(zone==='battle')assert(await page.eval<boolean>("(()=>{const el=document.querySelector('.arena-slot-land');return !!el&&getComputedStyle(el).display!=='none';})()"),'phone play slot is visibly available during legal drag');
    await bridge.call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(600);
    assert.deepEqual(await page.eval<Action[]>('window.__arenaSent??[]'),[expected],'real vertical drag sends the exact offered action');
    const before=state;const result=apply563(state,expected);state=result.state as typeof state;snapshot=snapshot563(state,snapshot.game.revision+1,'p1',563);await sleep(1700);
    return {before,events:result.events};
   };
   const chargeCard=snapshot.view.you.hand![Math.floor(snapshot.view.you.hand!.length/2)]!.id;
   const offered=snapshot.legal.find(row=>row.action.type==='charge'&&row.action.card===chargeCard)!.action;
   if(offered.type!=='charge'||!offered.card)throw Error('charge expected');
   const charged=await drag(offered.card,'energy',offered);
   assert(charged.events.some(e=>e.type==='move'&&e.card===offered.card&&e.to==='energy'),'actual charge moves the chosen card into energy');
   assert.equal(snapshot.view.you.activeEnergy,1);assert.equal(snapshot.view.prompt.kind,'main');
   const playCard=snapshot.view.you.hand![Math.floor(snapshot.view.you.hand!.length/2)]!.id;
   const play=snapshot.legal.find(row=>row.action.type==='play'&&row.action.card===playCard)!.action;
   if(play.type!=='play'||!play.card)throw Error('play expected');
   const played=await drag(play.card,'battle',play);
   assert(played.events.some(e=>e.type==='move'&&e.card===play.card&&e.to==='battle'),'actual play moves the chosen card into battle');
  } else {
   assert(!snapshot.legal.some(row=>row.action.type==='activate'),'rested energy removes the unaffordable activation from actual offers');
   await fingerTap(page,'.arena-hand button[aria-label^="Open the whole hand"]');await page.waitFor('[data-arena-review]');
   assert(await page.eval<boolean>("(()=>{const row=document.querySelector('[data-arena-review] [data-ability-index=\"0\"]');return !!row&&row.textContent.toLowerCase().includes('energy')&&!row.querySelector('button');})()"),'timely resource-blocked remedy stays visible without a fake offer');
  }
  writeFileSync(join(evidence,`after-phone-${skin}-${kind}-resolved.jpg`),await page.screenshot(false));await page.close();
 }
} finally {await browser.close();rmSync(fixture,{force:true});}
console.log(`#563 ${before?'before':'after'} EngineAPI artwork matrix captured`);
