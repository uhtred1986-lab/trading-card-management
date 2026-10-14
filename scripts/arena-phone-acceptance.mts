/** Supplemental M23 acceptance: real touch events and measured controls, no database. */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Browser, arg } from "./lib/cdp.mts";
import { CONTRAST_AUDIT } from "./lib/contrast-audit.mts";
import { choosePack, clickText, until } from "./lib/local-arena-page.mts";
import { auditPack } from "./verify/arena-local-worker-fixture.mts";
const base = arg("base") ?? "http://localhost:3771";
const out = arg("out") ?? ".validation/acceptance";
mkdirSync(out, {recursive:true});
const results: unknown[] = [];
const browser = await Browser.launch();
const snapshot = (name:string) => JSON.parse(readFileSync(`contract/fixtures/${name}.json`, "utf8"));
try {
 for (const height of (arg("heights") ?? "800,650").split(',').map(Number)) for (const skin of (arg("skins") ?? "anime,night").split(',')) {
  const page = await browser.page({name:`${height}-${skin}`,width:360,height,mobile:true});
  const prefix = `${height}-${skin}`;
  const shot = async (name:string) => writeFileSync(`${out}/${prefix}-${name}.jpg`,await page.screenshot(false));
  const open = async (name:string, extra="") => {
   await page.setCookie('arenaSkin',skin,base);
   await page.goto(`${base}/arena/preview?fixture=${name}&skin=${skin}&admin=0&pace=step${extra}`);
   await page.waitFor(".arena"); await page.settle(300);
  };
  const touch = async (selector:string) => {
   const point = await page.eval<{x:number;y:number}>(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
   await page.cdp("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[point]});
   await page.cdp("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
   await page.settle(120);
  };
  const byText = async (text:string) => {
   await page.eval(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Missing '+${JSON.stringify(text)});document.querySelector('[data-acceptance-button]')?.removeAttribute('data-acceptance-button');b.setAttribute('data-acceptance-button','')})()`);
   await touch('[data-acceptance-button]');
  };
  for(const count of [6,10]) {
   const name=`phone-ux-hand-${count}`; await open(name);
   await shot(`hand-${count}`);
   assert.equal(await page.eval('document.documentElement.scrollHeight>innerHeight+2'),false,`${prefix}/${count} page overflow`);
   if(count===6)assert.ok(await page.eval("document.querySelector('.arena-hand').textContent.includes('Need 3')"),'unaffordable chip names required energy');
   const hand=snapshot(name).view.you.hand;
   // Every fan card has an exposed point that hits its actual card button.
   const hits=await page.eval(`(()=>{return [...document.querySelectorAll('.arena-hand [data-arena-card]')].map(e=>{const r=e.getBoundingClientRect();let point=null;for(let x=Math.max(0,r.left)+2;x<Math.min(innerWidth,r.right);x+=3){for(let y=r.top+30;y<Math.min(r.bottom,innerHeight);y+=8){if(document.elementFromPoint(x,y)?.closest('[data-arena-card]')===e){point={x,y};break}}if(point)break}return {id:e.getAttribute('data-arena-card'),point}})})()`);
   assert.equal(hits.length,count); assert.ok(hits.every((h:{point:unknown})=>h.point),`${prefix}: all ${count} cards have exposed touch points`);
   for(const hit of hits) {
    await page.cdp('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[hit.point]});await page.cdp('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitFor('[data-arena-review]'); assert.equal(await page.eval("document.querySelector('[data-arena-review]').getAttribute('data-arena-review')"),hit.id);
    const refused=snapshot(name).rejected?.some((r:{action:{type:string;card:string};why:Array<{kind:string}>})=>r.action.type==='play'&&r.action.card===hit.id&&r.why.some(w=>w.kind==='energy'));
    if(refused){assert.equal(await page.eval("[...document.querySelectorAll('[data-arena-review] button')].some(e=>!e.disabled&&/^Play(?: |$)/.test(e.textContent.trim()))"),false);await shot(`unaffordable-${count}`);}
    await touch('[aria-label="Close card review"]');
   }
   if(count===10)await touch('[aria-label="Open the whole hand, 10 cards"]');else await touch(`[data-arena-card="${hand[0].id}"]`);
   await page.waitFor('[data-arena-review]');
   await shot(`own-${count}`);
   const sizes=await page.eval(`[...document.querySelectorAll('[aria-label="Previous card"],[aria-label="Next card"],[aria-label="Close card review"],[aria-label="Your hand, all cards"] button')].map(e=>{const r=e.getBoundingClientRect();return {label:e.getAttribute('aria-label'),width:r.width,height:r.height}})`);
   assert.ok(sizes.every((r:{width:number;height:number})=>r.width>=44&&r.height>=44));
   await byText('Top half'); assert.equal(await page.eval("document.querySelector('[aria-label=\"Card size\"] button[aria-pressed=true]').textContent"),'Top half');
   await shot(`top-${count}`); await byText('Full card');
   if(count===10) {
    for(const filter of ['Playable','Counters','All']) {await byText(filter);assert.equal(await page.eval("document.querySelector('[aria-label=\"Filter hand cards\"] button[aria-pressed=true]').textContent"),filter);await shot(`filter-${filter}`);}
   }
   // All selects the first card; normal six-card review also starts there.
   await touch('[aria-label="Next card"]'); assert.equal(await page.eval("document.querySelector('[data-arena-review]').getAttribute('data-arena-review')"),hand[1].id);
   await touch('[aria-label="Previous card"]'); assert.equal(await page.eval("document.querySelector('[data-arena-review]').getAttribute('data-arena-review')"),hand[0].id);
   await touch('[aria-label="Show card image only"]');await page.swipe('[aria-label="Full card artwork"]',-120,0);await page.settle(150);
   assert.equal(await page.eval("document.querySelector('[data-arena-review]').getAttribute('data-arena-review')"),hand[1].id);
   await touch('[aria-label="Close card review"]');assert.equal(await page.eval("!!document.querySelector('[data-arena-review]')"),false);
   results.push({prefix,count,hits,sizes});
  }
  await open('phone-ux-hand-6');
  await touch(`[data-arena-card="${snapshot('phone-ux-hand-6').view.them.leader.id}"]`);
  await page.waitFor('[data-arena-review]');
  assert.ok(await page.eval("document.querySelector('[data-arena-review]').getBoundingClientRect().height <= innerHeight*.56+1"));
  await shot('opponent-peek');await touch('[aria-label="Make opponent card bigger"]');await shot('opponent-big');await touch('[aria-label="Return to board"]');
  assert.equal(await page.eval("!!document.querySelector('[data-arena-review]')"),false);
  await open('charge');
  const hand=snapshot('charge').view.you.hand;
  await touch(`[data-arena-card="${hand[0].id}"]`);
  assert.equal(await page.eval("!!document.querySelector('[data-arena-review]')"),false);
  assert.ok(await page.eval("document.querySelector('.arena-bar').textContent.includes('Charge it')"));await shot('charge');
  await touch(`[data-arena-card="${hand[1].id}"]`);
  assert.ok((await page.eval<string>("document.querySelector('.arena-bar').textContent")).includes(hand[1].name));
  assert.equal(await page.eval('document.documentElement.scrollHeight>innerHeight+2'),false);
  for(const name of ['phone-ux-hand-6','phone-ux-counter','phone-ux-blocker','phone-ux-combo']) {
   await open(name);await shot(name);
   const audit=CONTRAST_AUDIT.replace('rows.push({ text:',`rows.push({ surface: !!el.closest('.arena-pstrip,.arena-lanepill,.arena-fight,[data-attack-summary],.arena-bar,.arena-notice,.arena-logpop'), card: !!el.closest('[data-arena-card]'), text:`);
   const rows=await page.eval<Array<{surface:boolean;card:boolean;ratio:number;text:string}>>(audit);
   const surfaces=rows.filter(r=>r.surface&&!r.card);
   results.push({prefix,name,contrast:surfaces});
   if(skin==='anime')assert.ok(surfaces.every(r=>r.ratio>=4.5),`frosted contrast: ${JSON.stringify(surfaces.filter(r=>r.ratio<4.5))}`);
  }
  await open('phone-ux-combo','&fx=clash-hit');await page.waitFor('.arena-feedback-hit');await shot('verdict');
  console.log(`${prefix}: hands, hit targets, paging, opponent peek, charge, response layouts and frosted contrast passed`);
  await page.close();
 }
 // Real local pack metadata, not a preview's deliberately absent decklist.
 const page=await browser.page({name:'zones',width:360,height:650,mobile:true});
 await page.goto(`${base}/arena/local`);await page.waitFor('input[type=file]');
 await choosePack(page,JSON.stringify(await auditPack()));await until(page,'document.body.textContent.includes("New match")',120000);
 assert.ok(await clickText(page,'Start match'));await page.waitFor('.arena-pstrip',120000);
 await page.tap('.arena-pstrip[role="button"]');await page.waitFor('[data-inspect-zone="p1:deck"]');
 const zones=await page.eval(`({decks:[...document.querySelectorAll('[data-inspect-zone$=":deck"]')].map(e=>({text:e.textContent,entries:e.querySelectorAll('li').length})),drop:!!document.querySelector('[data-inspect-zone="p1:Drop"]')})`);
 assert.ok(zones.drop&&zones.decks.length===2&&zones.decks.every((d:{entries:number})=>d.entries>0));
 writeFileSync(`${out}/zones.jpg`,await page.screenshot(false));results.push({zones});console.log('real local match: both decklists and Drop inspection passed');
 await page.close();
} finally {writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2)+'\n');await browser.close();}
