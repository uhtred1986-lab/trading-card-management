/** Real continuous touch inspection; never connects to a live game. */
import assert from 'node:assert/strict';
import { Browser, arg } from './lib/cdp.mts';
const base = arg('base') ?? 'http://localhost:3000';
const browser = await Browser.launch();
try {
  for (const skin of ['anime', 'night']) {
    const page = await browser.page({ name: `scrub-${skin}`, width: 360, height: 650, mobile: true });
    await page.goto(`${base}/arena/preview?fixture=phone-ux-hand-10&skin=${skin}&admin=0`);
    await page.waitFor('[data-hand-browse-card]'); await page.settle(250);
    const points = await page.eval<{id:string;x:number;y:number}[]>(`[...document.querySelectorAll('[data-hand-browse-card]')].slice(0,3).map(el=>{const r=el.getBoundingClientRect();return {id:el.dataset.handBrowseCard,x:r.x+10,y:r.y+r.height*.5}})`);
    await page.cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: points[0].x, y: points[0].y }] });
    await page.waitFor('[data-hand-peek]');
    for (const p of [...points.slice(1), points[0]]) {
      await page.cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y: p.y }] });
      await page.settle(50);
      assert.equal(await page.eval(`document.querySelector('[data-hand-peek]').dataset.handPeek`), p.id, 'changes during the same touch, before release');
    }
    await page.cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.settle(100);
    assert.equal(await page.eval(`(window.__arenaSent??[]).length`), 0);
    assert.equal(await page.eval(`!!document.querySelector('dialog[open]')`), false);
    await page.tap('[data-reader-ability]');
    assert.equal(await page.eval(`document.querySelector('[data-reader-ability]').getAttribute('aria-expanded')`), 'true');
    // A separately grabbed preview follows the finger and settles on release.
    const center = await page.eval<{x:number;y:number}>(`(()=>{const r=document.querySelector('[data-reader-face]').getBoundingClientRect();return {x:r.x+r.width*.5,y:r.y+r.height*.25}})()`);
    await page.cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [center] });
    await page.cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{x:center.x+24,y:center.y+12}] });
    assert.ok(await page.eval(`document.querySelector('[data-hand-peek] section').style.transform.includes('24px')`));
    await page.cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.tap('[aria-label="Close hand preview"]');
    await page.cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: points[0].x, y: points[0].y }] });
    await page.waitFor('[data-hand-peek]');
    await page.cdp('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await page.settle(80);
    assert.equal(await page.eval(`!!document.querySelector('[data-hand-peek]')`), false);
    assert.equal(await page.eval(`(window.__arenaSent??[]).length`), 0);
    console.log(`${skin}: continuous browsing, floating movement, text expansion and cancellation pass`);
    await page.close();
  }
} finally { await browser.close(); }
