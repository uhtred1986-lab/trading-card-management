/**
 * Reproduce Arena #544's before/after browser evidence from a fresh checkout.
 * Start `DATABASE_URL='' npm run dev` in another terminal first. This script
 * uses only the two local artwork files committed beside the screenshots,
 * temporarily stages preview fixtures/assets, validates the rendered result,
 * and restores every staged file in `finally`.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Browser, requireServer, VIEWPORTS } from "./lib/cdp.mts";

const root = process.cwd();
const evidence = join(root, "docs/arena-backlog/evidence/544");
const fixtures = join(root, "contract/fixtures");
const publicArt = join(root, "public/arena-design");
const base = (process.env.ARENA_PREVIEW_URL ?? "http://localhost:3000").replace(/\/$/, "");
const settle = 500;

const stagedAssets = [
  { source: join(evidence, "assets/BT1-033.webp"), target: join(publicArt, "544-BT1-033.webp") },
  { source: join(evidence, "assets/BT1-050.webp"), target: join(publicArt, "544-BT1-050.webp") },
];
const assetBackups = new Map<string, Buffer | null>();
const fixturePaths = [join(fixtures, "outcome-before.json"), join(fixtures, "outcome-after.json")];

function snapshotFor(kind: "draw" | "interrupted") {
  const snapshot = JSON.parse(readFileSync(join(fixtures, "over.json"), "utf8"));
  const reason = kind === "draw" ? "Both players lost." : "This game was interrupted before a result was reached.";
  const outcome = { kind, winner: null, reason };
  snapshot.view.you.leader.imageUrl = "/arena-design/544-BT1-033.webp";
  snapshot.view.them.leader.imageUrl = "/arena-design/544-BT1-050.webp";
  snapshot.view.over = { winner: null, reason };
  snapshot.over = outcome;
  snapshot.beats.list = [{ t: "over", winner: null, reason, kind, n: 1 }];
  return snapshot;
}

async function main() {
  await requireServer(base);
  if (fixturePaths.some(existsSync)) throw new Error("Remove stale outcome-before.json/outcome-after.json fixtures before running the evidence harness.");
  for (const { source, target } of stagedAssets) {
    if (!existsSync(source)) throw new Error(`Missing committed artwork fixture: ${source}`);
    assetBackups.set(target, existsSync(target) ? readFileSync(target) : null);
  }
  const browser = await Browser.launch();
  try {
    mkdirSync(publicArt, { recursive: true });
    stagedAssets.forEach(({ source, target }) => copyFileSync(source, target));
    writeFileSync(fixturePaths[0], JSON.stringify(snapshotFor("draw"), null, 2));
    writeFileSync(fixturePaths[1], JSON.stringify(snapshotFor("interrupted"), null, 2));

    for (const viewport of VIEWPORTS) {
      const page = await browser.page(viewport);
      await page.beforeLoad(`try { localStorage.setItem("arena.pace", "step"); } catch {}`);
      for (const skin of ["anime", "night"] as const) {
        await page.setCookie("arenaSkin", skin, base);
        for (const [fixture, expectedTitle, suffix] of [
          ["outcome-before", "DRAW", "before"],
          ["outcome-after", "GAME INTERRUPTED", "after"],
        ] as const) {
          await page.goto(`${base}/arena/preview?fixture=${fixture}&skin=${skin}&pace=step`);
          await page.waitFor(".arena-end-title");
          await page.settle(settle);
          const check = await page.eval<{ title: string; images: number; broken: number; rays: boolean }>(`(() => {
            const images = [...document.images];
            return {
              title: document.querySelector(".arena-end-title")?.textContent?.trim() ?? "",
              images: images.length,
              broken: images.filter((img) => !img.complete || img.naturalWidth === 0).length,
              rays: !!document.querySelector(".arena-end-rays"),
            };
          })()`);
          if (check.title !== expectedTitle) throw new Error(`${fixture}/${skin}/${viewport.name}: expected ${expectedTitle}, got ${check.title}`);
          if (check.images < 2 || check.broken !== 0) throw new Error(`${fixture}/${skin}/${viewport.name}: expected loaded artwork; ${JSON.stringify(check)}`);
          if (fixture === "outcome-after" && check.rays) throw new Error("Interrupted outcome rendered victory rays.");
          const name = `${viewport.name}-outcome-${suffix}-${skin}-544.jpg`;
          writeFileSync(join(evidence, name), await page.screenshot(false));
          console.log(`${name}: ${JSON.stringify(check)}`);
        }
      }
      await page.close();
    }
  } finally {
    await browser.close();
    for (const path of fixturePaths) rmSync(path, { force: true });
    for (const { target } of stagedAssets) {
      const original = assetBackups.get(target);
      if (original == null) rmSync(target, { force: true });
      else writeFileSync(target, original);
    }
  }
}

await main();
