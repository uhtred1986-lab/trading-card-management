/**
 * Evidence clips of the real arena board, played from `contract/fixtures/*.json`
 * through the dev-only `/arena/preview?replay=1` route — no database (issue #447).
 * The motion twin of `arena:shots`.
 *
 *   npm run dev                       # in one terminal
 *   npm run arena:record -- --fixtures attack-life --skins anime,night --viewports phone,desk
 *   npm run arena:record -- --fixtures defend,empower --duration 8000
 *   npm run arena:record -- --fixtures play --query fx=reveal    # a different preview effect instead of the replay
 *
 * Flags: --fixtures (default attack-life), --skins (anime,night), --viewports (phone,desk),
 * --duration ms of clip after the board is up (12000: a full attack at normal pace), --pace step|normal|slow (normal),
 * --frames (also write a JPEG every 250 ms to <clip>-frames/, to look at without a decoder: Playwright's ffmpeg has no image encoder),
 * --base url (http://localhost:3000), --out dir, --query extra=params (replaces `replay=1` when
 * it names `fx=`), --fps for the encoder (30).
 *
 * Output: docs/arena-redesign/clips/<viewport>-<fixture>-<skin>.webm (git-ignored), named like
 * the shots. Drives the installed Chrome over the DevTools protocol (scripts/lib/cdp.mts):
 * `Page.startScreencast` frames, encoded with an ffmpeg found at run time — `FFMPEG_PATH`, then
 * `ffmpeg` on the PATH, then the one Playwright ships (`$PLAYWRIGHT_BROWSERS_PATH` or
 * /opt/pw-browsers, `ffmpeg-*`/ffmpeg-linux, which encodes VP8 only — that is all this asks of
 * it). No Playwright package and no npm dependency. Not in `npm test`: it needs a running dev
 * server, a browser and an ffmpeg.
 *
 * The clip starts when the board is on screen, so the load and the dev compile are not in it;
 * the fixture's beats start 500 ms later (`PreviewStage`, `?replay=1`).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { arg, Browser, requireServer, sleep, VIEWPORTS } from "./lib/cdp.mts";

const base = (arg("base") ?? "http://localhost:3000").replace(/\/$/, "");
const OUT = arg("out") ?? join(process.cwd(), "docs", "arena-redesign", "clips");
const fixtures = (arg("fixtures") ?? "attack-life").split(",");
const skins = (arg("skins") ?? "anime,night").split(",");
const wanted = arg("viewports")?.split(",");
const viewports = wanted ? VIEWPORTS.filter((v) => wanted.includes(v.name)) : VIEWPORTS;
const duration = Number(arg("duration") ?? 12000);
const pace = arg("pace") ?? "normal";
const fps = Number(arg("fps") ?? 30);
const query = arg("query");
const keepFrames = process.argv.includes("--frames");

/** An ffmpeg that can write VP8 WebM, or a plain explanation of where this script looked. */
function findFfmpeg(): string {
  const tried: string[] = [];
  const works = (bin: string) => {
    tried.push(bin);
    const r = spawnSync(bin, ["-hide_banner", "-encoders"], { encoding: "utf8" });
    return r.status === 0 && /libvpx\b/.test(r.stdout);
  };
  if (process.env.FFMPEG_PATH && works(process.env.FFMPEG_PATH)) return process.env.FFMPEG_PATH;
  if (works("ffmpeg")) return "ffmpeg";
  // Playwright's own copy: <browsers>/ffmpeg-<rev>/ffmpeg-linux (ffmpeg-mac, ffmpeg-win64.exe elsewhere).
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, "/opt/pw-browsers", join(process.env.HOME ?? "", ".cache", "ms-playwright")].filter((r): r is string => !!r && existsSync(r));
  for (const root of roots) {
    for (const dir of readdirSync(root).filter((d) => d.startsWith("ffmpeg")).sort().reverse()) {
      for (const exe of ["ffmpeg-linux", "ffmpeg-mac", "ffmpeg-win64.exe"]) {
        const p = join(root, dir, exe);
        if (existsSync(p) && works(p)) return p;
      }
    }
  }
  throw new Error(`No ffmpeg with VP8 (libvpx) found. Tried: ${tried.join(", ") || "nothing"}. Install ffmpeg, set FFMPEG_PATH, or use a machine with Playwright's browsers (PLAYWRIGHT_BROWSERS_PATH).`);
}

/**
 * Frames with timestamps become a clip at a steady rate: each tick shows the latest frame at or
 * before it, so a frame is held until the next arrives. They go to ffmpeg as one JPEG stream
 * (`image2pipe`), which even Playwright's stripped-down build reads.
 */
function encode(ffmpeg: string, frames: Array<{ data: Buffer; t: number }>, endT: number, file: string) {
  const t0 = frames[0].t;
  const ticks = Math.max(1, Math.round((endT - t0) * fps));
  const parts: Buffer[] = [];
  let at = 0;
  for (let i = 0; i < ticks; i++) {
    while (at + 1 < frames.length && frames[at + 1].t <= t0 + i / fps) at++;
    parts.push(frames[at].data);
  }
  const r = spawnSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(fps), "-i", "pipe:0", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libvpx", "-b:v", "1500k", "-crf", "12", "-pix_fmt", "yuv420p", file], { input: Buffer.concat(parts), maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
}

const ffmpeg = findFfmpeg();
console.log(`ffmpeg: ${ffmpeg}`);
mkdirSync(OUT, { recursive: true });
await requireServer(base);
const browser = await Browser.launch();
let written = 0;
try {
  for (const vp of viewports) {
    const page = await browser.page(vp);
    await page.beforeLoad(`try { localStorage.setItem("arena.pace", ${JSON.stringify(pace)}); } catch {}`);
    for (const fixture of fixtures) {
      for (const skin of skins) {
        const extra = query ? `&${query}` : "";
        const url = `${base}/arena/preview?fixture=${fixture}&skin=${skin}&pace=${pace}${query?.includes("fx=") ? "" : "&replay=1"}${extra}`;
        await page.setCookie("arenaSkin", skin, base);
        await page.goto(url);
        await page.waitFor(".arena");
        const stop = await page.startScreencast();
        await sleep(duration);
        const endT = Date.now() / 1000;
        const frames = await stop();
        if (!frames.length) throw new Error(`${fixture}/${skin}/${vp.name}: the browser sent no frames`);
        const file = join(OUT, `${vp.name}-${fixture}-${skin}.webm`);
        // Frame timestamps are the browser's clock; the end is "now" on this one. They agree to the second, which is all a tail needs.
        encode(ffmpeg, frames, Math.max(frames[frames.length - 1].t + 0.05, Math.min(endT, frames[frames.length - 1].t + 1)), file);
        if (keepFrames) {
          const dir = file.replace(/\.webm$/, "-frames");
          mkdirSync(dir, { recursive: true });
          const t0 = frames[0].t;
          let at = 0;
          for (let i = 0; t0 + i * 0.25 <= frames[frames.length - 1].t; i++) {
            while (at + 1 < frames.length && frames[at + 1].t <= t0 + i * 0.25) at++;
            writeFileSync(join(dir, `f${String(i).padStart(3, "0")}.jpg`), frames[at].data);
          }
        }
        written++;
        console.log(`${file}  (${frames.length} frames, ${(statSync(file).size / 1024).toFixed(0)} KB)`);
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`\n${written} clip${written === 1 ? "" : "s"} in ${OUT}`);
