/** Milestone 23: capture actual stage cues under both motion preferences. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { arg, Browser } from "./lib/cdp.mts";
const base = arg("base") ?? "http://localhost:3000";
const out = arg("out") ?? "docs/arena-redesign/current/m23-feedback";
mkdirSync(out, { recursive: true });
const browser = await Browser.launch();
try {
  for (const reduced of [false, true]) for (const skin of ["anime", "night"]) {
    const page = await browser.page({ name: `${skin}-${reduced}`, width: 360, height: 650, mobile: true });
    await page.cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" }] });
    for (const fx of ["clash-hit", "clash-held", "damage-you", "ko"]) {
      await page.goto(`${base}/arena/preview?fixture=${fx === "ko" ? "ko" : "phone-ux-combo"}&skin=${skin}&pace=step&admin=0&fx=${fx}`);
      const selector = fx === "damage-you" ? ".arena-feedback-life-label" : `[data-feedback-subject].arena-feedback-${fx === "ko" ? "ko" : fx === "clash-hit" ? "hit" : "held"}`;
      await page.waitFor(selector);
      const text = await page.eval<string>(`document.querySelector(${JSON.stringify(selector)}).textContent`);
      assert.ok(text.includes(fx === "ko" ? "KO" : fx === "damage-you" ? "−1 LIFE" : fx === "clash-hit" ? "Hit" : "Held"));
      if (reduced) assert.equal(await page.eval(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).animationName`), "none");
      writeFileSync(`${out}/${skin}-${reduced ? "reduced" : "normal"}-${fx}.jpg`, await page.screenshot(false));
      console.log(`${skin}/${reduced ? "reduced" : "normal"}/${fx}: subject cue visible`);
    }
    await page.close();
  }
} finally { await browser.close(); }
