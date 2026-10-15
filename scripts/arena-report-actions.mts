/** Legal quick actions and playback geometry through the real dev-only board. No DB. */
import assert from 'node:assert/strict';
import { mkdirSync,writeFileSync } from 'node:fs';
import { Browser,VIEWPORTS,arg } from './lib/cdp.mts';
const base=arg('base')??'http://localhost:3000';
const out=arg('out')??'docs/arena-redesign/current/reports-after/actions';mkdirSync(out,{recursive:true});
const b=await Browser.launch();const checks:object[]=[];
try{
 for(const vp of VIEWPORTS)for(const skin of ['anime','night']){
  const p=await b.page(vp);try{
   await p.setCookie('arenaSkin',skin,base);
   await p.goto(`${base}/arena/preview?fixture=play&skin=${skin}&pace=step&staging=inplace`);await p.waitFor('.arena');await p.settle(300);
   await p.rightClick('[data-arena-card="p1#0"] button');
   await p.waitFor('[data-review-basic-actions] button');
   assert.match(await p.eval<string>('document.querySelector("[data-review-basic-actions]").textContent'),/Attack/);
   assert.ok(await p.eval('!document.querySelector("[data-review-basic-actions]").textContent.includes("Charge")'),'Main Phase never offers Charge');
   writeFileSync(`${out}/${vp.name}-${skin}-attack-review.jpg`,await p.screenshot(false));
   await p.tap('[data-review-basic-actions] button');
   assert.deepEqual(await p.eval('window.__arenaSent??[]'),[],'Attack button starts target selection rather than submitting');
   await p.tap('[data-arena-card="p2#0"] button');
   if(vp.mobile){
    await p.waitFor('[data-attack-stakes]');
    assert.deepEqual(await p.eval('window.__arenaSent??[]'),[],'phone target still needs confirmation');
    writeFileSync(`${out}/${vp.name}-${skin}-attack-confirm.jpg`,await p.screenshot(false));
    await p.eval('[...document.querySelectorAll("button")].find(b=>b.textContent==="Confirm attack").click()');
   }
   assert.deepEqual(await p.eval('window.__arenaSent'),[{type:'attack',player:'p1',attacker:'p1#0',target:'p2#0'}]);
   await p.goto(`${base}/arena/preview?fixture=attack&skin=${skin}&pace=step&staging=inplace&fx=clash-hit`);
   await p.waitFor('.arena-fx-beam',20000);
   await p.eval('document.querySelector(".arena-topbar").style.paddingBottom="87px"');await p.eval('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))))');
   const error=await p.eval<number>(`(()=>{const e=document.querySelector('.arena-fx-beam');const host=document.querySelector('.arena').getBoundingClientRect();const cards=['p1#15','p2#0'].map(id=>[...document.querySelectorAll('[data-arena-card]')].find(c=>c.dataset.arenaCard===id&&c.getBoundingClientRect().width>0).getBoundingClientRect());const start={x:parseFloat(e.style.left),y:parseFloat(e.style.top)};const len=parseFloat(e.style.width),ang=parseFloat(e.style.getPropertyValue('--ang'))*Math.PI/180;const end={x:start.x+len*Math.cos(ang),y:start.y+len*Math.sin(ang)};return Math.max(...cards.map((r,i)=>Math.hypot((i?end:start).x-(r.left+r.width/2-host.left),(i?end:start).y-(r.top+r.height/2-host.top))))})()`);
   assert.ok(error<2,`clash endpoints track their live cards: ${error}px`);
   writeFileSync(`${out}/${vp.name}-${skin}-clash.jpg`,await p.screenshot(false));checks.push({viewport:vp.name,skin,attackTargetConfirmed:true,clashEndpointError:error});
  }finally{await p.close()}
 }
 for(const [width,height]of [[390,667],[320,568]]){
  const p=await b.page({name:'short',width,height,mobile:true});try{
   await p.goto(`${base}/arena/preview?fixture=charge&skin=anime&pace=step`);await p.waitFor('.arena');await p.settle(250);
   const selector='[aria-label="Your hand"] [data-arena-card]';await p.tap(selector);await p.tap(selector);await p.waitFor('[data-arena-review]');await p.eval('document.documentElement.style.fontSize="32px"');await p.settle(250);
   const geometry=await p.eval(`(()=>{const body=document.querySelector('.arena-review-body');const r=body.querySelector('[data-review-basic-actions] button').getBoundingClientRect();const v=body.getBoundingClientRect();return {top:r.top,bottom:r.bottom,bodyTop:v.top,bodyBottom:v.bottom,vh:innerHeight}})()`);
   assert.ok(geometry.top>=geometry.bodyTop-1&&geometry.bottom<=geometry.bodyBottom+1&&geometry.bottom<=geometry.vh,`200% text keeps Charge reachable before art: ${JSON.stringify(geometry)}`);
   await p.tap('[data-review-basic-actions] button');
   assert.equal(await p.eval<string>('window.__arenaSent[0].type'),'charge');checks.push({width,height,text:'200%',charge:true,geometry});
  }finally{await p.close()}
 }
}finally{await b.close();writeFileSync(`${out}/checks.json`,JSON.stringify(checks,null,2))}
console.log(checks);
