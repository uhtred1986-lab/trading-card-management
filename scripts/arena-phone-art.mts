/** Grounded card evidence. Optional cached art substitutes the same printed card URL. */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { arg, Browser } from "./lib/cdp.mts";
const base = arg("base") ?? "http://localhost:3000";
const out = arg("out") ?? "docs/arena-redesign/current/m23-art";
const art = arg("art-directory");
mkdirSync(out, { recursive: true });
const browser = await Browser.launch();
try {
  for (const height of [800, 650]) {
    const page = await browser.page({ name: `art-${height}`, width: 360, height, mobile: true });
    if (art) {
      await page.interceptFetch("*/deckplanet_card_images/*");
      page.onFetchPaused(({ requestId, request }) => {
        const file = join(art, basename(new URL(request.url).pathname));
        void (existsSync(file) ? page.fulfillFetchBytes(requestId, readFileSync(file), "image/png") : page.continueFetch(requestId)).catch(() => {});
      });
    }
    for (const name of ["vegeta-empty", "vegeta-target", "strike-target"]) {
      const snap = JSON.parse(readFileSync(`contract/fixtures/phone-ux-${name}.json`, "utf8"));
      const card = snap.view.you.hand[0];
      await page.goto(`${base}/arena/preview?fixture=phone-ux-${name}&skin=anime&pace=step&admin=0`);
      await page.waitFor(".arena"); await page.settle(300);
      await page.tap(`[data-arena-card="${card.id}"]`);
      await page.waitFor("[data-arena-review]"); await page.settle(200);
      assert.ok(await page.eval("[...document.querySelectorAll('[data-arena-review] img')].some(e=>e.complete && e.naturalWidth>0)"), "printed artwork must load");
      writeFileSync(`${out}/${height}-${name}-art.jpg`, await page.screenshot(false));
      const text = await page.eval<string>("document.querySelector('[data-arena-review]').textContent");
      assert.ok(text.includes(name === "vegeta-empty" ? "Play anyway" : name === "strike-target" ? "Barrier" : "target"));
      await page.eval("document.querySelector('.arena-review-body').scrollTop = document.querySelector('.arena-review-body').scrollHeight");
      writeFileSync(`${out}/${height}-${name}-decision.jpg`, await page.screenshot(false));
      console.log(`${height}/${name}: real artwork and target guidance available`);
    }
    await page.close();
  }
} finally { await browser.close(); }
