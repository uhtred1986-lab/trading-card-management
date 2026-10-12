/**
 * Local browser proof for a synthetic 9-6-3-1-1 priced secret [Auto].
 * Builds snapshots from actual rules-engine orderPending / payment actions,
 * then uses the dev-only preview with a mocked game API poll. No live game
 * API, database, or printed-card claim.
 * Run with DATABASE_URL='' npm run dev, then this script via npx tsx.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Browser, requireServer, sleep, VIEWPORTS } from "../lib/cdp.mts";
import { CTX, DEFS, card, fifty, rulesFromCompiler } from "./harness.ts";
import { buildSnapshot, type Snapshot } from "../../src/lib/arena/snapshot.ts";
import { engineFor } from "../../src/lib/arena/engines.ts";
import { rulesetFor } from "../../src/lib/arena/rulesets/index.ts";
import { vmToBeats } from "../../src/lib/arena/vm/beats.ts";
import { run } from "../../src/lib/arena/vm/flow.ts";
import { moveCard } from "../../src/lib/arena/vm/zones.ts";
import type { VmState } from "../../src/lib/arena/vm/state.ts";
import type { EngineContext, PlayerId } from "../../src/lib/arena/types.ts";

const root = process.cwd();
const fixtureRoot = process.env.ARENA_PREVIEW_ROOT ?? root;
const base = (process.env.ARENA_BASE ?? "http://localhost:3000").replace(/\/$/, "");
const baseline = process.env.ARENA_CAPTURE_BASELINE === "1";
const fixtureDir = join(fixtureRoot, "contract", "fixtures");
const evidenceDir = join(root, "docs", "arena-backlog", "evidence", "549-priced-secret");
const artPath = join(root, "docs", "arena-backlog", "evidence", "566", "BT1-053.webp");
const artUrl = "http://arena-549-priced-art.local/BT1-053.webp";
if (!existsSync(artPath)) throw new Error(`Missing portable artwork fixture: ${artPath}`);
const initialFixtureName = "arena-549-priced-before-poll";
const fixtureNames = ["arena-549-priced-declared", "arena-549-priced-activated", "arena-549-priced-concealed"];
const fixturePaths = [initialFixtureName, ...fixtureNames].map((name) => join(fixtureDir, `${name}.json`));
for (const path of fixturePaths) if (existsSync(path)) throw new Error(`Refusing to overwrite ${path}`);

const rules = engineFor("rules");
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const defs = { ...DEFS,
  SECRET549: card("SECRET549", { energyCost: 0, skill: "[Auto] {r}: When you play this card, draw 1 card." }),
  ENERGY549: card("ENERGY549", { colors: ["Red"], energyCost: 0, skill: null }),
};
const scripts = rulesFromCompiler(defs);
const original = scripts.SECRET549.bySkill[0];
assert.ok(original);
scripts.SECRET549.bySkill[0] = { ...original, trigger: ["played"], unsupported: [], ops: [{ op: "draw", n: 1 }], price: { ...original.price, condition: null, ops: null } };
const ctx: EngineContext = { ...CTX, defs, scripts };
let state = rules.createGame(ctx, { seed: 5495, p1: { name: "Alice", leader: "L-RED", main: fifty("V1") }, p2: { name: "Bob", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
state = rules.apply(ctx, state, { type: "chooseFirst", player: state.chooser, first: "p1" }).state as VmState;
for (let i = 0; i < 24 && state.prompt.kind !== "main"; i++) state = rules.apply(ctx, state, { type: "pass", player: (state.prompt as { player: PlayerId }).player }).state as VmState;
assert.equal(state.prompt.kind, "main");
const [source, energy] = state.sides.p1.zones.hand.slice(0, 2);
assert.ok(source && energy);
state.cards[source].cardId = "SECRET549";
state.cards[energy].cardId = "ENERGY549";
assert.ok(moveCard(state, loaded.definition, energy, "energy", { owner: "p1" }).ok);
state.pending.push({ card: source, master: "p1", skillIndex: 0, trigger: "played" });
run(ctx, loaded.definition, state, []);
assert.equal(state.prompt.kind, "orderPending");
const declared = rules.apply(ctx, state, { type: "orderPending", player: "p1", index: 0 });
assert.equal(declared.state.prompt.kind, "chooseMode");
assert.ok(declared.events.some((event) => event.type === "autoDeclared"));
assert.ok(!declared.events.some((event) => event.type === "skill"));
const declarationBeat = vmToBeats(ctx, declared.state as VmState, declared.events);
const paid = rules.apply(ctx, JSON.parse(JSON.stringify(declared.state)), { type: "chooseMode", player: "p1", index: 0 });
assert.ok(paid.events.some((event) => event.type === "skill" && event.card === source));
const activationBeat = vmToBeats(ctx, paid.state as VmState, paid.events);
const combined = { seq: declarationBeat.seq + activationBeat.seq, list: [
  ...declarationBeat.list, ...activationBeat.list.map((beat) => ({ ...beat, n: beat.n + declarationBeat.seq })),
], art: { ...declarationBeat.art, ...activationBeat.art } };
const later = rules.apply(ctx, JSON.parse(JSON.stringify(paid.state)), { type: "pass", player: "p1" });
const images = { SECRET549: { front: artUrl, back: null } };
const snapshot = (s: VmState, beats: Snapshot["beats"]): Snapshot => {
  return buildSnapshot({ id: 5495, engine: "rules", mode: "versus", status: "playing", p1Name: "Alice", p2Name: "Bob", ctx, state: s,
    legal: rules.legalActions(ctx, s), log: [], beats, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer: "p2", images });
};
const initial = snapshot(state, { seq: 0, list: [], art: {} });
const fixtures = [snapshot(declared.state as VmState, declarationBeat), snapshot(paid.state as VmState, activationBeat), snapshot(later.state as VmState, combined)];
assert.equal(initial.game.revision, fixtures[0].game.revision);
assert.equal(fixtures[0].beats?.art[source]?.imageUrl, artUrl);
assert.equal(fixtures[1].beats?.art[source]?.imageUrl, artUrl);
assert.equal(fixtures[2].beats?.art[source], undefined);

mkdirSync(evidenceDir, { recursive: true });
fixturePaths.forEach((path, index) => writeFileSync(path, `${JSON.stringify(index === 0 ? initial : fixtures[index - 1], null, 2)}\n`, { flag: "wx" }));
let browser: Browser | null = null;
let captures = 0;
type Paused = { requestId: string; request: { url: string } };
type PageSession = { sid: string };
try {
  await requireServer(base);
  browser = await Browser.launch();
  for (const viewport of VIEWPORTS) for (const skin of ["anime", "night"] as const) for (let phase = 0; phase < fixtureNames.length; phase++) {
    const page = await browser.page(viewport);
    const sid = (page as unknown as PageSession).sid;
    await browser.send("Fetch.enable", { patterns: [
      { urlPattern: "http://arena-549-priced-art.local/*", requestStage: "Request" },
      { urlPattern: "*/api/v1/games/5495*", requestStage: "Request" },
    ] }, sid);
    let closing = false;
    let delivered = 0;
    const pollErrors: string[] = [];
    let firstReleased = false;
    let targetSeen = false;
    const firstRequest: { current: { id: string; body: string } | null } = { current: null };
    const fulfill = (id: string, body: string) => browser!.send("Fetch.fulfillRequest", { requestId: id, responseCode: 200,
      responseHeaders: [{ name: "content-type", value: "application/json" }], body }, sid).catch((error: unknown) => { pollErrors.push(String(error)); });
    const unchanged = (id: string) => browser!.send("Fetch.fulfillRequest", { requestId: id, responseCode: 204 }, sid)
      .catch((error: unknown) => { pollErrors.push(String(error)); });
    browser.on((method, params: Paused, eventSid) => {
      if (closing || eventSid !== sid || method !== "Fetch.requestPaused") return;
      if (params.request.url === artUrl) {
        void browser!.send("Fetch.fulfillRequest", { requestId: params.requestId, responseCode: 200,
          responseHeaders: [{ name: "content-type", value: "image/webp" }], body: readFileSync(artPath).toString("base64") }, sid).catch(() => {});
      } else if (params.request.url.includes("/api/v1/games/5495")) {
        delivered++;
        const next = fixtures[phase];
        const response = { ...next, game: { ...next.game, revision: next.game.revision + 1 } };
        const body = Buffer.from(JSON.stringify(response)).toString("base64");
        if (!firstReleased) { firstRequest.current = { id: params.requestId, body }; return; }
        const timer = setTimeout(() => { if (!closing) void (targetSeen ? unchanged(params.requestId) : fulfill(params.requestId, body)); }, targetSeen ? 1000 : 100);
        timer.unref();
      }
    });
    await page.setCookie("arenaSkin", skin, base);
      await page.goto(`${base}/arena/preview?fixture=${initialFixtureName}&skin=${skin}&replay=1&pace=step&admin=0`);
      await page.waitFor(".arena");
      assert.ok(!(await page.eval<boolean>("document.body.innerText.toUpperCase().includes('DECLARED · AUTO') || document.body.innerText.toUpperCase().includes('ACTIVATED · AUTO')")), `${viewport.name}/${skin}: declaration appeared before the polled revision`);
      firstReleased = true;
      if (firstRequest.current) await fulfill(firstRequest.current.id, firstRequest.current.body);
      await sleep(100);
      if (phase < 2) {
        const label = phase === 0 ? "Declared · Auto" : "Activated · Auto";
        if (phase === 1) {
          const playbackUntil = Date.now() + 5000;
          while (Date.now() < playbackUntil && !(await page.eval<boolean>("document.body.innerText.includes('Skip')"))) await sleep(50);
          const skillBeat = activationBeat.list.findIndex((beat) => beat.t === "skill" && beat.card === source);
          assert.ok(skillBeat >= 0);
          for (let i = 0; i < skillBeat; i++) {
            await page.eval("[...document.querySelectorAll('button')].find((button) => button.innerText.includes('Next'))?.click()");
            await sleep(100);
          }
        }
        if (!baseline) {
          const until = Date.now() + 5000;
          while (Date.now() < until && !(await page.eval<boolean>(`document.body.innerText.toUpperCase().includes(${JSON.stringify(label.toUpperCase())})`))) await sleep(50);
          assert.ok(await page.eval<boolean>(`document.body.innerText.toUpperCase().includes(${JSON.stringify(label.toUpperCase())})`), `${viewport.name}/${skin}: ${label} banner missing; requests=${delivered}, errors=${pollErrors.join(" | ")}, body=${await page.eval<string>("document.body.innerText.slice(0, 400)")}`);
          targetSeen = true;
          assert.ok(!(await page.eval<boolean>("document.body.innerText.includes('Reconnecting')")), `${viewport.name}/${skin}: mocked poll did not settle`);
          assert.ok(await page.eval<boolean>(`[...document.querySelectorAll('img')].some((el) => el.src === ${JSON.stringify(artUrl)} && el.complete && el.naturalWidth > 0)`), `${viewport.name}/${skin}: declaration art did not load`);
        } else {
          assert.ok(!(await page.eval<boolean>(`document.body.innerText.toUpperCase().includes(${JSON.stringify(label.toUpperCase())})`)), `${viewport.name}/${skin}: base unexpectedly has new label`);
          const playbackUntil = Date.now() + 5000;
          while (Date.now() < playbackUntil && !(await page.eval<boolean>("document.body.innerText.includes('Skip')"))) await sleep(50);
          assert.ok(await page.eval<boolean>("document.body.innerText.includes('Skip')"), `${viewport.name}/${skin}: base did not receive the polled beat`);
          targetSeen = true;
        }
      } else {
        if (!baseline) {
          const playbackUntil = Date.now() + 5000;
          while (Date.now() < playbackUntil && !(await page.eval<boolean>("document.body.innerText.includes('Skip')"))) await sleep(50);
          assert.ok(await page.eval<boolean>("document.body.innerText.includes('Skip')"), `${viewport.name}/${skin}: concealed beat was not replayed`);
        }
        assert.ok(!(await page.eval<boolean>(`document.body.innerText.includes('SECRET549')`)), `${viewport.name}/${skin}: concealed history named source`);
        targetSeen = true;
      }
      if (phase === 0) {
        await page.settle(250);
        const connectedUntil = Date.now() + 5000;
        while (Date.now() < connectedUntil && await page.eval<boolean>("document.body.innerText.includes('Reconnecting')")) await sleep(100);
        assert.ok(!(await page.eval<boolean>("document.body.innerText.includes('Reconnecting')")), `${viewport.name}/${skin}: polling disconnected before capture after ${delivered} intercepted requests, errors ${pollErrors.join(" | ")}`);
        const name = `${viewport.name}-${skin}-${baseline ? "before" : "after"}.jpg`;
        const picture = await page.screenshot(false);
        assert.ok(!(await page.eval<boolean>("document.body.innerText.includes('Reconnecting')")), `${viewport.name}/${skin}: polling disconnected during capture`);
        writeFileSync(join(evidenceDir, name), picture);
        captures++;
      }
    closing = true;
    await page.close();
  }
} finally {
  await browser?.close();
  for (const path of fixturePaths) rmSync(path, { force: true });
}
console.log(`#549 synthetic priced secret Auto ${baseline ? "before" : "after"}: ${captures} browser captures at ${evidenceDir}`);
