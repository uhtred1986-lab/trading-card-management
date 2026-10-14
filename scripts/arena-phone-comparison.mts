/** Before/after snapshots of identical fixtures against separate main/branch servers. */
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {Browser,arg} from './lib/cdp.mts';
const base=arg('base')??'http://localhost:3771';
const out=arg('out')??'.validation/comparison-after';mkdirSync(out,{recursive:true});
const browser=await Browser.launch();
try {for(const height of [800,650])for(const skin of (arg('skins')??'anime,night').split(',')) {
 const page=await browser.page({name:`${height}-${skin}`,width:360,height,mobile:true});
 await page.interceptFetch('*/api/v1/games/*');page.onFetchPaused(({requestId})=>{void page.fulfillFetch(requestId,'',204).catch(()=>{});});
 for(const name of ['phone-ux-hand-6','phone-ux-attack-pick','phone-ux-counter','phone-ux-combo']) {
  await page.setCookie('arenaSkin',skin,base);
  await page.goto(`${base}/arena/preview?fixture=${name}&skin=${skin}&admin=0&pace=step`);await page.waitFor('.arena');await page.settle(700);
  writeFileSync(`${out}/${height}-${skin}-${name}.jpg`,await page.screenshot(false));
  if(name==='phone-ux-hand-6') {
   const snap=JSON.parse(readFileSync(`contract/fixtures/${name}.json`,'utf8'));
   // Use the common card-inspection handler in both interaction models.
   const id=snap.view.you.hand[0].id;
   await page.cdp('Runtime.evaluate',{expression:`document.querySelector('[data-arena-card="${id}"] button').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}))`});
   await page.waitFor('[data-arena-review]');await page.settle(100);
   writeFileSync(`${out}/${height}-${skin}-card-view.jpg`,await page.screenshot(false));
  }
 }
 console.log(`${base} ${height}-${skin}: main, attack baseline, counter, combo, card view`);await page.close();
}}finally{await browser.close();}
