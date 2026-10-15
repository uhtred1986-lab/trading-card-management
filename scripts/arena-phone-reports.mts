/** Browser regression evidence for the owner's seven arena reports. Dev preview, synthetic fixtures; no DB. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { arg, Browser, sleep, VIEWPORTS } from './lib/cdp.mts';
import type { Snapshot } from '../src/lib/arena/snapshot';
const base = arg('base') ?? 'http://localhost:3000';
const tag = arg('tag') ?? 'after';
const out = arg('out') ?? `docs/arena-redesign/current/reports-${tag}`;
mkdirSync(out, { recursive: true });
const fixturePaths: string[] = [];
const fixture = (name: string, snap: Snapshot) => { const path = `contract/fixtures/phone-ux-report-${name}.json`; fixturePaths.push(path); writeFileSync(path, JSON.stringify(snap)); };
const source = JSON.parse(readFileSync('contract/fixtures/play.json','utf8')) as Snapshot;
const search = structuredClone(source);
const choice = { ...search.view.you.battle[0], id: 'report-choice', name: 'Synthetic eligible search card' };
search.view.you.choices = [choice];
search.view.prompt = { kind: 'chooseCards', player: 'p1', question: 'Choose up to 1 among the top 3', hint: 'Synthetic bounded search', min: 0, max: 1 };
search.legal = [{ action: { type: 'choose', player: 'p1', cards: [choice.id] }, label: 'Choose card' },{ action: { type: 'choose', player: 'p1', cards: [] }, label: 'Choose none' }];
search.taps = { byCard: { [choice.id]: [0] }, bare: [1], attackTargets: {}, whyByCard: {} };
search.rejected = [source.view.you.leader!,source.view.them.leader!,...source.view.you.hand!].map(c=>({action:{type:'choose',player:'p1',cards:[c.id]},label:'Wrong target',why:[{kind:'target',reason:'Outside this search'}]}));
search.beats = null;
fixture('search',search);
const skill = structuredClone(source);
skill.beats = { seq: 1, list: [{ t:'skill', n:1, card:source.view.you.leader!.id, owner:'p1',label:'Auto',text:'Report passive notice: draw 1 card.',unread:false,inBattle:false }], art: { [source.view.you.leader!.id]: {cardId:'L-RED',name:'Report passive',imageUrl:null} } };
fixture('skill',skill);
const checks: {what:string;ok:boolean;detail?:unknown}[]=[];
const check=(what:string,ok:boolean,detail?:unknown)=>{checks.push({what,ok,detail});console.log(`${ok?'ok':'FAIL'} ${what}${detail===undefined?'':': '+JSON.stringify(detail)}`)};
const b=await Browser.launch();
type Page=Awaited<ReturnType<Browser['page']>>;
const go=async(p:Page,f:string,skin='anime',extra='')=>{await p.setCookie('arenaSkin',skin,base);await p.goto(`${base}/arena/preview?fixture=${f}&skin=${skin}&pace=step&admin=0${extra}`);await p.waitFor('.arena');await p.settle(350)};
try {
 for(const vp of VIEWPORTS) for(const skin of ['anime','night']) {
  const p=await b.page(vp);
  try {
   await go(p,'phone-ux-report-search',skin);await p.waitFor('[data-valid-target]');
   check(`${vp.name}/${skin} bounded search`,await p.eval('document.querySelectorAll("[data-valid-target]").length===1 && document.querySelectorAll("[data-refused-target]").length===0'));
   await sleep(4400);
   check(`${vp.name}/${skin} required search survives notice timeout`,await p.eval('!!document.querySelector("[data-valid-target]")'));
   writeFileSync(join(out,`${vp.name}-${skin}-search.jpg`),await p.screenshot(false));
   await go(p,'phone-ux-report-skill',skin,'&replay=1');
   await p.waitFor('[data-skill-spotlight], div.fixed[aria-live="polite"]');
   await p.tap('[aria-label="Open arena settings and counts"]');
   await p.tap('[data-sheet-initial-focus]'); // same beat, replacement object from parent render
   await sleep(4400);
   check(`${vp.name}/${skin} same-seq rerender dismisses passive`,!(await p.eval('!!document.querySelector("[data-skill-spotlight], div.fixed[aria-live=polite]")')));
   await go(p,'phone-ux-report-skill',skin,'&replay=1');
   await p.waitFor('[data-skill-spotlight], div.fixed[aria-live="polite"]');
   const r=await p.eval<{x:number;y:number}>('(()=>{const r=document.querySelector("[data-skill-spotlight], div.fixed[aria-live=polite]").getBoundingClientRect();return {x:r.left+70,y:r.top+30}})()');
   await p.pointer('down',r.x,r.y);await p.pointer('move',r.x+15,r.y+15);await p.pointer('up',r.x+15,r.y+15);await sleep(4400);
   check(`${vp.name}/${skin} dragging does not pin passive`,!(await p.eval('!!document.querySelector("[data-skill-spotlight], div.fixed[aria-live=polite]")')));
   await go(p,'attack',skin,'&staging=inplace');
   await p.waitFor('[data-attack-beam], svg:has(path[stroke-width="12"])');
   await p.eval('document.querySelector(".arena-topbar").style.paddingBottom="73px"; document.querySelectorAll("[data-arena-card]")[0].style.transform="translateY(31px)"');
   await p.eval('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))))');
   const error=await p.eval<number>(`(()=>{const svg=document.querySelector('[data-attack-beam]')??document.querySelector('svg:has(path[stroke-width="12"])');const path=svg?.querySelector('path');if(!path)return 9999;const host=document.querySelector('.arena').getBoundingClientRect();const ids=${JSON.stringify([JSON.parse(readFileSync('contract/fixtures/attack.json','utf8')).view.battle.attacker,JSON.parse(readFileSync('contract/fixtures/attack.json','utf8')).view.battle.guard])};const [a,b]=ids.map(id=>[...document.querySelectorAll('[data-arena-card]')].find(c=>c.dataset.arenaCard===id&&c.getBoundingClientRect().width>0).getBoundingClientRect());const n=path.getAttribute('d').match(/-?[\\d.]+/g).map(Number);return Math.max(Math.hypot(n[0]-(a.left+a.width/2-host.left),n[1]-(a.top+a.height/2-host.top)),Math.hypot(n[4]-(b.left+b.width/2-host.left),n[5]-(b.top+b.height/2-host.top)))})()`);
   check(`${vp.name}/${skin} beam follows layout without resize/scroll`,error<2,error);
   writeFileSync(join(out,`${vp.name}-${skin}-beam.jpg`),await p.screenshot(false));
   await go(p,'charge',skin);
   const id=JSON.parse(readFileSync('contract/fixtures/charge.json','utf8')).view.you.hand[0].id;
   const selector=`[aria-label="Your hand"] [data-arena-card="${id}"]`;
   if(vp.mobile){await p.tap(selector);await p.tap(selector)} else {await p.rightClick(selector)}
   await p.waitFor(vp.mobile?'[data-arena-review]':'[data-arena-inspector]');await p.settle(150);
   check(`${vp.name}/${skin} legal Charge visible before artwork`,await p.eval(`(()=>{const body=document.querySelector('.arena-review-body')??document.querySelector('[data-arena-inspector]'),button=body.querySelector('[data-review-basic-actions] button');if(!button)return false;const r=button.getBoundingClientRect(),b=body.getBoundingClientRect();return r.top>=b.top-1&&r.bottom<=b.bottom+1&&r.bottom<=innerHeight&&r.height>=43})()`));
   writeFileSync(join(out,`${vp.name}-${skin}-charge-review.jpg`),await p.screenshot(false));
  } finally {await p.close()}
 }
 for(const [width,height] of [[390,844],[390,667],[320,568],[844,390],[768,1024]]) for(const text of [1,2]) {
  const p=await b.page({name:'layout',width,height,mobile:true});try{await go(p,'phone-ux-hand-6');if(text===2){await p.eval('document.documentElement.style.fontSize="32px"');await p.settle(100)}
   const result=await p.eval(`(()=>{window.scrollTo(0,document.documentElement.scrollHeight);const board=document.querySelector('.arena').getBoundingClientRect();return {page:document.documentElement.scrollHeight,vh:innerHeight,blank:Math.max(0,innerHeight-board.bottom),wide:document.documentElement.scrollWidth>innerWidth+1,bar:!!document.querySelector('.arena-bar')}})()`);
   check(`${width}x${height}/${text*100}% text no blank tail`,result.blank<=text*9&&!result.wide&&result.bar,result);
   writeFileSync(join(out,`${width}x${height}-${text*100}-bottom.jpg`),await p.screenshot(false));
  }finally{await p.close()}
 }
 const p=await b.page(VIEWPORTS[0]);try{await go(p,'play','anime','&fx=no-target&pace=normal');await p.waitFor('[data-arena-notice]',20000);check('resolved empty skill is nonmodal',await p.eval('!document.querySelector("[data-arena-notice-scrim]") && document.querySelector("[data-arena-notice]").getAttribute("role")==="status"'));await sleep(4500);check('resolved empty skill automatically dismisses',!(await p.eval('!!document.querySelector("[data-arena-notice]")')))}finally{await p.close()}
} finally {await b.close();for(const path of fixturePaths)rmSync(path,{force:true});writeFileSync(join(out,'checks.json'),JSON.stringify(checks,null,2))}
assert.ok(tag==='before'||checks.every(c=>c.ok),`${checks.filter(c=>!c.ok).length} browser checks failed; see ${out}/checks.json`);
