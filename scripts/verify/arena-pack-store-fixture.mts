/**
 * #658, TEST-ONLY: images and an art server for the pack store proofs (`arena-pack-store.mts` in
 * Node, `scripts/arena-pack-store-browser.mts` in Chrome). No network: every image is a PNG made
 * here, one per art URL of the pack, distinct per URL.
 *
 *  - `pngFor(url)`: a small, valid, distinct PNG (RGB, 8 bit), encoded with `node:zlib`.
 *  - `nodeDecode(blob)`: the Node proof's stand-in for `createImageBitmap` — it really decodes the
 *    PNG (signature, chunk CRCs, IHDR, the inflated IDAT's exact length, IEND) and throws otherwise.
 *    The browser proof uses Chrome's own decoder instead.
 *  - `serveArt(pack, options)`: an HTTP server for the browser proof — `/pack.json`, `/art/<name>`
 *    (with CORS), `/plain/<name>` (no CORS: a no-cors fetch of it is opaque), `/bad/<name>` (an
 *    `image/png` that is not a PNG).
 */
import http from "node:http";
import zlib from "node:zlib";
import type { OfflinePack } from "../../src/lib/arena/local/pack.ts";
import { requiredArt } from "../../src/lib/arena/local/pack-store.ts";

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

/** A valid PNG, `w`×`h`, its colours derived from `seed`. */
export function png(seed: string, w = 24, h = 32): Buffer {
  let x = 0;
  for (const c of seed) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let i = 0; i < w; i++) {
      const o = y * (w * 3 + 1) + 1 + i * 3;
      raw[o] = (x >>> 16) & 255;
      raw[o + 1] = (x >>> 8) & 255 ^ y;
      raw[o + 2] = x & 255 ^ i;
    }
  }
  return Buffer.concat([SIG, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

export const artName = (url: string) => decodeURIComponent(new URL(url).pathname.split("/").pop()!);
export const pngFor = (url: string) => png(url);

/** Decode a PNG fully enough to know it is one; throws on anything else. */
export async function nodeDecode(blob: Blob): Promise<{ width: number; height: number }> {
  const b = Buffer.from(await blob.arrayBuffer());
  if (b.length < 8 || !b.subarray(0, 8).equals(SIG)) throw new Error("not a PNG (signature)");
  let at = 8;
  let width = 0, height = 0, ended = false;
  const idat: Buffer[] = [];
  while (at + 12 <= b.length) {
    const len = b.readUInt32BE(at);
    const type = b.subarray(at + 4, at + 8).toString("ascii");
    const data = b.subarray(at + 8, at + 8 + len);
    if (data.length !== len) throw new Error(`truncated ${type} chunk`);
    if ((zlib.crc32(b.subarray(at + 4, at + 8 + len)) >>> 0) !== b.readUInt32BE(at + 8 + len)) throw new Error(`${type}: bad CRC`);
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
    if (type === "IDAT") idat.push(data);
    if (type === "IEND") { ended = true; break; }
    at += 12 + len;
  }
  if (!ended || !width || !height) throw new Error("not a complete PNG");
  const raw = zlib.inflateSync(Buffer.concat(idat));
  if (raw.length !== (width * 3 + 1) * height) throw new Error("the image data has the wrong length");
  return { width, height };
}

export interface ArtServer { origin: string; requests: string[]; close(): Promise<void> }

/** The browser proof's art and pack server (see the header). */
export async function serveArt(pack: OfflinePack, packText: string): Promise<ArtServer> {
  const images = new Map(requiredArt(pack).map((u) => [artName(u), pngFor(u)]));
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    requests.push(url.pathname);
    const cors = { "access-control-allow-origin": "*" };
    if (url.pathname === "/pack.json") { res.writeHead(200, { "content-type": "application/json", ...cors }); res.end(packText); return; }
    const [, kind, name] = url.pathname.split("/");
    const img = images.get(decodeURIComponent(name ?? ""));
    if (!img) { res.writeHead(404, cors); res.end(); return; }
    if (kind === "art") { res.writeHead(200, { "content-type": "image/png", "content-length": img.length, ...cors }); res.end(img); return; }
    if (kind === "plain") { res.writeHead(200, { "content-type": "image/png", "content-length": img.length }); res.end(img); return; }
    if (kind === "bad") { const junk = Buffer.concat([img.subarray(0, 40), Buffer.alloc(200, 7)]); res.writeHead(200, { "content-type": "image/png", "content-length": junk.length, ...cors }); res.end(junk); return; }
    res.writeHead(404, cors);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}
