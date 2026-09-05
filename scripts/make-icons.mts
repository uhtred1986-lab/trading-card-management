/**
 * Rasterise the app icon for the web manifest.
 *
 * `src/app/icon.svg` is the single source — Next serves it as the favicon, and
 * this turns it into the PNGs Android wants for the home screen. `sharp` is
 * already a dependency (the scanner downscales photos with it), so no new
 * tooling, and no binary in the repo that cannot be regenerated:
 *
 *   npm run icons
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const source = path.join(root, "src", "app", "icon.svg");
const out = path.join(root, "public", "icons");

const BACKGROUND = { r: 9, g: 11, b: 21, alpha: 1 }; // space-950

async function main() {
  const svg = fs.readFileSync(source);
  fs.mkdirSync(out, { recursive: true });

  for (const size of [192, 512]) {
    await sharp(svg, { density: 384 }).resize(size, size).png().toFile(path.join(out, `icon-${size}.png`));
    console.log(`icons: icon-${size}.png`);
  }

  // Maskable: Android crops to a circle and may cut ~10% off each edge, so the
  // art is inset into the safe zone rather than trusting the platform.
  const inner = Math.round(512 * 0.72);
  const art = await sharp(svg, { density: 384 }).resize(inner, inner).png().toBuffer();
  await sharp({ create: { width: 512, height: 512, channels: 4, background: BACKGROUND } })
    .composite([{ input: art, gravity: "centre" }])
    .png()
    .toFile(path.join(out, "icon-maskable-512.png"));
  console.log("icons: icon-maskable-512.png");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
