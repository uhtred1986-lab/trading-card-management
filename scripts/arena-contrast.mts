/**
 * WCAG 1.4.3 contrast audit of the arena board, both skins (issue #343).
 *
 *   npm run dev                              # in one terminal
 *   npm run arena:contrast                   # play, attack, ko  x  anime, night  x  phone, desk
 *   npm run arena:contrast -- --strict       # exit 1 when anything fails
 *   npm run arena:contrast -- --fixtures play --skins anime --json out.json
 *   npm run arena:contrast -- --fixtures play --tap '[aria-label="Review cards in play"]'   # phone, a state that opens on a tap (the review pager)
 *   npm run arena:contrast -- --fixtures play --hover 'section[aria-label="Your hand"] [data-arena-card]'   # desktop, pointer over a card
 *
 * axe-core cannot resolve a background through a gradient, and the anime sky is
 * built from them. This walks each visible text node's ancestors, composites
 * every translucent fill over what lies beneath it — and, for a gradient,
 * *every stop* — and keeps the worst case. A card face is dark on purpose
 * (docs/arena-skin-spec.md decision 4); it carries an opaque ground, so the walk
 * stops there and its text is judged against the card, not the sky.
 *
 * What it does not see, stated so a pass is not over-read: text over a photo
 * (a `url()` background or an <img> is judged against both black and white and
 * flagged `image`), `text-shadow`, `backdrop-filter`, and
 * pseudo-element fills. Text with a `-webkit-text-stroke` of 1px or more is
 * judged by its outline colour (the ink outline is the legibility feature). Needs a running dev server and a browser, so it is not
 * in `npm test`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { arg, Browser, requireServer, VIEWPORTS } from "./lib/cdp.mts";
import { CONTRAST_AUDIT as AUDIT, type ContrastRow as Row } from "./lib/contrast-audit.mts";

const base = (arg("base") ?? "http://localhost:3000").replace(/\/$/, "");
const skins = (arg("skins") ?? "anime,night").split(",");
const fixtures = (arg("fixtures") ?? "play,attack,ko").split(",");
const strict = process.argv.includes("--strict");
const jsonOut = arg("json") ?? join(process.cwd(), "docs", "arena-redesign", "current", "contrast.json");
const settle = Number(arg("settle") ?? 1500);
const hover = arg("hover");
const tap = arg("tap");


type Result = Row & { fixture: string; skin: string; viewport: string };

await requireServer(base);
const browser = await Browser.launch();
const all: Result[] = [];
let checked = 0;
try {
  for (const vp of VIEWPORTS) {
    const page = await browser.page(vp);
    if (tap && vp.mobile) await page.clipOverflow();
    await page.beforeLoad(`try { localStorage.setItem("arena.pace", "step"); } catch {}`);
    for (const fixture of fixtures) {
      for (const skin of skins) {
        await page.setCookie("arenaSkin", skin, base);
        await page.goto(`${base}/arena/preview?fixture=${fixture}&skin=${skin}&pace=step`);
        await page.waitFor(".arena");
        await page.settle(settle);
        // A state the board only has under the pointer (the docked inspector
        // filled): desktop only, a phone has no hover.
        if (hover && !vp.mobile) {
          await page.hover(hover);
          await page.settle(400);
        }
        // A state that opens on a tap (the phone review pager): phone only.
        if (tap && vp.mobile) {
          await page.tap(tap);
          await page.settle(600);
        }
        const rows = await page.eval<Row[]>(AUDIT);
        checked += rows.length;
        for (const r of rows) all.push({ ...r, fixture, skin, viewport: vp.name });
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
}

// One line per distinct failing (skin, selector, text, colours) — the same label repeats across viewports and fixtures.
const failing = all.filter((r) => r.ratio < r.need);
const groups = new Map<string, { row: Result; where: Set<string> }>();
for (const r of failing) {
  const key = [r.skin, r.selector, r.text, r.fg, r.bg].join("|");
  const g = groups.get(key) ?? { row: r, where: new Set<string>() };
  g.where.add(`${r.viewport}:${r.fixture}`);
  groups.set(key, g);
}
const table = [...groups.values()]
  .sort((a, b) => a.row.ratio - b.row.ratio)
  .map(({ row: r, where }) => ({
    skin: r.skin,
    ratio: r.ratio,
    need: r.need,
    text: r.text,
    element: r.selector,
    fg: `rgb(${r.fg.slice(0, 3)})`,
    bg: `rgb(${r.bg.slice(0, 3)})${r.image ? " (image?)" : ""}`,
    seen: [...where].join(" "),
  }));

mkdirSync(dirname(jsonOut), { recursive: true });
writeFileSync(jsonOut, JSON.stringify({ base, fixtures, skins, checked, failures: table, all: undefined }, null, 2));

if (table.length) console.table(table.map(({ seen, element, ...t }) => ({ ...t, element: element.slice(-60), seen: seen.length > 40 ? `${seen.slice(0, 37)}...` : seen })));
console.log(`\n${checked} text nodes checked over ${fixtures.length} fixtures x ${skins.length} skins x ${VIEWPORTS.length} viewports`);
for (const skin of skins) {
  const n = [...groups.values()].filter((g) => g.row.skin === skin).length;
  console.log(`  ${skin}: ${n} distinct failing text${n === 1 ? "" : "s"}`);
}
console.log(`full list: ${jsonOut}`);
if (strict && table.length) process.exit(1);
