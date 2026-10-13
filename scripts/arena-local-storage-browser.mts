#!/usr/bin/env node
/**
 * #653: local matches journalled in Chrome's real IndexedDB, by the real module Worker
 * (`src/lib/arena/local/worker-entry.ts`), driven by the real page client — the browser half of
 * `scripts/verify/arena-local-storage.mts` (whose Node half runs on a fake IndexedDB).
 *
 *   npm run arena:local-storage-browser -- [--json] [--total-timeout S]
 *
 * Headless Chrome (`scripts/lib/cdp.mts`), the repo's TypeScript served as ES modules
 * (`scripts/lib/module-server.mts`), the staged SD15/SD5 pack. In the page
 * (`scripts/verify/arena-local-storage-page.ts`), with a page reload between the steps:
 *
 *   1. a new match, played to a human choice; the worker is killed; after a reload a new worker
 *      resumes it — the same board (legal actions included);
 *   2. played to an AI turn, killed, resumed: the same board, and the next AI decision gives the
 *      Node reference's next board;
 *   3. three kills inside an open commit transaction (`arena-local-storage-worker.ts` holds it open
 *      and the page terminates the worker): AI batches and a human move — the device keeps exactly
 *      the last committed revision, and the real worker resumes there;
 *   4. an injected transaction abort: refused as `storage` (aborted), the save and board unchanged;
 *   5. the origin's quota lowered to its usage (DevTools `Storage.overrideQuotaForOrigin`, in force
 *      once a probe write fails): a resume still works (it writes nothing), the next AI batches fail
 *      as `storage` (Chrome's own QuotaExceededError) with the save unchanged; the quota restored,
 *      the same session plays to the end — the Node reference's final board (a human move under
 *      quota is the Node half's);
 *   6. every stored byte, read raw: exactly the journal's records, nothing private, the decisions
 *      the Node reference made;
 *   7. the real save damaged (tampered header and decision, truncated, newer record schema, corrupt),
 *      each resume refused by name; restored, it resumes;
 *   8. the schema path on real IndexedDB: 1 → 2 additive upgrade, a failing migration leaves version
 *      2 and the data, an older build refuses the newer database.
 *
 * Every board the page saw is compared with the in-memory Node reference at that revision. Every
 * request the page and workers made is a repo module: no server, no database. Needs Chrome; not part
 * of `npm test`. Exit 0 ok, 1 a check failed, 2 usage/no Chrome.
 */
import { Browser, findChrome } from "./lib/cdp.mts";
import { serveRepoModules } from "./lib/module-server.mts";
import { stagedPack } from "./verify/arena-local-worker-fixture.mts";
import { inProcessChannel } from "./verify/arena-local-worker-channel.ts";
import { memoryJournalStore, type MatchJournal } from "../src/lib/arena/local/worker.ts";
import { playLoop, requestIds, startLoopMatch } from "./verify/arena-local-storage-driver.ts";
import { replayHash } from "../src/lib/arena/replay-core.ts";
import { stableJson } from "../src/lib/arena/policy/contract.ts";
import { DECISION_RECORD_FIELDS, LOCAL_DB_NAME, MATCH_RECORD_FIELDS } from "../src/lib/arena/local/storage.ts";
import { strings } from "./verify/arena-policy-permute.ts";

function usage(message: string): never {
  console.error(`arena:local-storage-browser: ${message}`);
  console.error("Usage: npm run arena:local-storage-browser -- [--json] [--total-timeout S]");
  process.exit(2);
}
const argv = process.argv.slice(2);
for (const a of argv) if (a.startsWith("--") && a !== "--json" && a !== "--total-timeout") usage(`unknown flag ${a}`);
const timeoutAt = argv.indexOf("--total-timeout");
const TOTAL_MS = (timeoutAt >= 0 ? Number(argv[timeoutAt + 1]) : 600) * 1000;
if (!Number.isFinite(TOTAL_MS) || TOTAL_MS <= 0) usage("--total-timeout must be a positive number of seconds");
const JSON_OUT = argv.includes("--json");
try { findChrome(); } catch (error) { console.error(`arena:local-storage-browser: ${(error as Error).message}`); process.exit(2); }

const PAGE = `<!doctype html><meta charset="utf-8"><title>arena local storage</title>
<script type="module">
  import * as P from "/scripts/verify/arena-local-storage-page.ts";
  globalThis.__P = P;
  globalThis.__ready = true;
</script>`;
const MATCH = "local-653-proof";

const failures: string[] = [];
const notes: string[] = [];
const check = (ok: unknown, what: string) => { if (ok) notes.push(`ok   ${what}`); else { failures.push(what); notes.push(`FAIL ${what}`); } };

// The Node reference: the same loop, in memory, every board hashed by revision.
const pack = await stagedPack();
const ref = new Map<number, string>();
const refCh = inProcessChannel({ store: memoryJournalStore() });
const refSession = await startLoopMatch(refCh.port, pack, MATCH, { newRequestId: requestIds(0x653), sessionId: "ref" });
// One AI decision per advance, so the reference has a board at every revision (a board is the same however its revision was reached).
await playLoop(refSession, { nextId: requestIds(0x654), maxDecisions: 1, onBoard: async (s) => { ref.set(s.game.revision, await replayHash(s)); } });
const refFinal = await replayHash(refSession.snapshot);
const refJournal: MatchJournal = refCh.host.inspect()!.journal;
await refSession.dispose();
const decided = (entries: MatchJournal["entries"]) => entries.map((e) => (e.kind === "ai" ? e.id : stableJson(e.action)));

const server = await serveRepoModules(process.cwd(), PAGE);
const browser = await Browser.launch();
const watchdog = setTimeout(async () => {
  console.error(`FAIL arena:local-storage-browser: overall timeout of ${TOTAL_MS / 1000} s exceeded; stopping Chrome`);
  await browser.close();
  server.close();
  process.exit(1);
}, TOTAL_MS);

type Page = Awaited<ReturnType<Browser["page"]>>;
async function inPage<T>(page: Page, expr: string): Promise<T> {
  const key = `__p${Math.random().toString(36).slice(2)}`;
  await page.eval(`globalThis.${key} = null; (async () => { try { globalThis.${key} = { ok: true, v: await (${expr}) }; } catch (e) { globalThis.${key} = { ok: false, e: String(e && e.stack || e) }; } })(); 0`);
  for (;;) {
    const r = await page.eval<{ ok: boolean; v?: T; e?: string } | null>(`globalThis.${key}`);
    if (r) { if (!r.ok) throw new Error(r.e); return r.v as T; }
    await new Promise((res) => setTimeout(res, 150));
  }
}
async function load(page: Page) {
  await page.goto(`${server.origin}/`, 60000);
  for (let i = 0; i < 200 && !(await page.eval<boolean>("!!globalThis.__ready")); i++) await new Promise((r) => setTimeout(r, 100));
  await page.eval(`globalThis.__pack = JSON.parse(${JSON.stringify(JSON.stringify(pack))}); 0`);
}
const call = <T,>(page: Page, fn: string, ...args: string[]) => inPage<T>(page, `globalThis.__P.${fn}(${["globalThis.__pack", JSON.stringify(MATCH), ...args].join(", ")})`);
const callNoPack = <T,>(page: Page, fn: string, ...args: string[]) => inPage<T>(page, `globalThis.__P.${fn}(${args.join(", ")})`);
const allBoards = new Map<number, string>();
const takeBoards = (boards: Record<string, string>) => { for (const [r, h] of Object.entries(boards)) allBoards.set(Number(r), h); };
interface At { revision: number; board: string }

const report: Record<string, unknown> = {};
try {
  const page = await browser.page({ name: "desk", width: 1280, height: 800, mobile: false });
  await load(page);
  report.userAgent = await page.eval<string>("navigator.userAgent");

  // 1. New match, human choice, kill, reload, resume.
  const one = await call<{ at: At & { legal: number }; boards: Record<string, string> }>(page, "newMatch");
  takeBoards(one.boards);
  check(one.at.board === ref.get(one.at.revision) && one.at.legal > 0, `1. a human choice at revision ${one.at.revision} (${one.at.legal} legal actions) is the reference's board`);
  await load(page);
  const two = await call<{ resumedAt: At; aiTurn: At; aiResumed: At; nextBoard: At; boards: Record<string, string> }>(page, "reloadAndAiTurn");
  takeBoards(two.boards);
  check(two.resumedAt.revision === one.at.revision && two.resumedAt.board === one.at.board, "1. after the kill and a page reload, a new worker resumes the identical board (legal actions included)");
  check(two.aiTurn.board === ref.get(two.aiTurn.revision), `2. an AI turn at revision ${two.aiTurn.revision} is the reference's board`);
  check(two.aiResumed.revision === two.aiTurn.revision && two.aiResumed.board === two.aiTurn.board, "2. killed during the AI turn and resumed: the identical board");
  check(two.nextBoard.revision === two.aiTurn.revision + 1 && two.nextBoard.board === ref.get(two.nextBoard.revision), "2. the next AI decision after the resume gives the reference's next board");

  // 3. Kills inside an open transaction.
  await load(page);
  const kills = await call<{ kills: { kind: string; committed: number; added: number; onDevice: number; resumedAt: number; board: string }[]; boards: Record<string, string> }>(page, "killMidTransaction", "3");
  takeBoards(kills.boards);
  report.kills = kills.kills;
  for (const k of kills.kills) {
    check(k.added > 0 && k.onDevice === k.committed && k.resumedAt === k.committed && k.board === ref.get(k.committed),
      `3. killed inside ${k.kind === "AI batch" ? "an" : "a"} ${k.kind} commit (${k.added} decision(s) queued): the device holds revision ${k.onDevice}, the last committed ${k.committed}, and resumes there on the reference board`);
  }
  check(kills.kills.some((k) => k.kind === "human move") && kills.kills.some((k) => k.kind === "AI batch"), "3. both an AI batch and a human move were killed mid-transaction");

  // 4. Injected abort.
  await load(page);
  const aborted = await call<{ at: number; error: { code: string; text: string } | null; unchanged: boolean; boardStays: boolean }>(page, "abortInjected");
  report.abort = aborted;
  check(aborted.error?.code === "storage" && /aborted/.test(aborted.error.text) && aborted.unchanged && aborted.boardStays, `4. an aborted commit is refused as storage/aborted, the save and the board stay at ${aborted.at}`);

  // 5. Quota.
  await load(page);
  const before = await callNoPack<{ usage: number | null; quota: number | null }>(page, "usage");
  await page.cdp("Storage.overrideQuotaForOrigin", { origin: server.origin, quotaSize: before.usage ?? 0 });
  // The override reaches the quota manager asynchronously, and a running page may keep its old view:
  // load the page again, then probe with a small write until one is refused.
  let probe = "";
  for (let i = 0; i < 100 && probe !== "QuotaExceededError"; i++) {
    if (i % 20 === 0) await load(page);
    probe = await callNoPack<string>(page, "quotaProbe");
    if (probe !== "QuotaExceededError") await new Promise((r) => setTimeout(r, 100));
  }
  check(probe === "QuotaExceededError", `5. the lowered quota is in force (a probe write: ${probe})`);
  const quota = await call<{ at: number; revision: number; errors: { code: string; text: string }[]; unchanged: boolean; estimate: unknown }>(page, "underQuota");
  report.quota = { before, ...quota };
  await page.cdp("Storage.overrideQuotaForOrigin", { origin: server.origin });
  for (let i = 0; i < 100 && probe !== "ok"; i++) {
    probe = await callNoPack<string>(page, "quotaProbe");
    if (probe !== "ok") await new Promise((r) => setTimeout(r, 100));
  }
  check(probe === "ok", "5. the quota restored (a probe write succeeds)");
  check(quota.errors.length > 0 && quota.errors.every((e) => e.code === "storage" && /QuotaExceeded|storage is full/.test(e.text)), `5. with the quota at the usage (${before.usage} bytes) every write is refused as storage/quota (${quota.errors.map((e) => (e.text.startsWith("human") ? "a human move" : "an AI batch")).join(", ")}); the resume before them, which writes nothing, worked`);
  check(quota.unchanged && quota.revision === quota.at, "5. the save and the board stay where they were");
  const end = await inPage<{ at: number; final: string; status: string; revision: number; boards: Record<string, string> }>(page, "globalThis.__P.afterQuota()");
  takeBoards(end.boards);
  check(end.at === quota.at && end.status === "over" && end.final === refFinal, `5. the quota restored, the same session plays from ${end.at} to the end: the reference's final board (revision ${end.revision})`);

  // Every board the page saw.
  const wrong = [...allBoards].filter(([r, h]) => ref.get(r) !== h).map(([r]) => r);
  check(allBoards.size > 50 && wrong.length === 0, `every board the page saw (${allBoards.size} revisions) is the reference's${wrong.length ? `; differing at ${wrong.slice(0, 5).join(", ")}` : ""}`);

  // 6. What is stored.
  const dump = await callNoPack<{ version: number; stores: string[]; matches: Record<string, unknown>[]; decisions: Record<string, unknown>[]; databases: string[] | null }>(page, "dump");
  report.stored = { version: dump.version, stores: dump.stores, matches: dump.matches.length, decisions: dump.decisions.length, bytes: JSON.stringify(dump).length, databases: dump.databases };
  const head = dump.matches.find((m) => m.matchId === MATCH)!;
  check(dump.version === 2 && stableJson(dump.stores.sort()) === stableJson(["decisions", "matches", "owners"]), "6. the database is schema version 2 with the stores matches, decisions and owners (#654)");
  check(dump.matches.every((m) => stableJson(Object.keys(m).sort()) === stableJson([...MATCH_RECORD_FIELDS].sort())) && dump.decisions.every((d) => stableJson(Object.keys(d).sort()) === stableJson([...DECISION_RECORD_FIELDS].sort())), "6. every record has exactly the journal's fields");
  const mine = dump.decisions.filter((d) => d.matchId === MATCH).sort((a, b) => (a.index as number) - (b.index as number));
  check(stableJson(decided(mine.map((d) => d.entry as MatchJournal["entries"][number]))) === stableJson(decided(refJournal.entries)) && head.trace === refJournal.trace && stableJson(head.aiMemory) === stableJson(refJournal.aiMemory),
    `6. the stored decisions (${mine.length}), trace and AI memory are the Node reference's`);
  const seen = strings(dump);
  const forbidden = ["owner", "email", "user", "account", "collection", "lots", "price", "snapshot", "state", "prompt", "bundle", "defs", "library", "legal"].filter((k) => seen.keys.has(k));
  check(!forbidden.length && ![...seen.values].some((v) => /@[a-z0-9-]+\./i.test(v)), `6. nothing stored is a board, engine state, pack content, account or collection field, or an email${forbidden.length ? ` (found ${forbidden.join(", ")})` : ""}`);
  check(dump.databases === null || dump.databases.every((n) => n === LOCAL_DB_NAME || n.startsWith("proof-")), `6. the origin's IndexedDB holds ${LOCAL_DB_NAME} and the proof's own probe databases only (${dump.databases?.join(", ")})`);

  // 7. Damaged saves.
  const damaged = await call<Record<string, { code: string; text: string }>>(page, "damagedResumes");
  report.damaged = damaged;
  check(damaged.tamperedHeader.code === "journal" && /tampered/.test(damaged.tamperedHeader.text), "7. a tampered header: journal/tampered");
  check(damaged.tamperedDecision.code === "journal" && /tampered/.test(damaged.tamperedDecision.text), "7. a tampered decision: journal/tampered");
  check(damaged.truncated.code === "journal" && /truncated/.test(damaged.truncated.text), "7. a truncated save: journal/truncated");
  check(damaged.newerRecord.code === "newer", "7. a record of a newer schema: newer");
  check(damaged.corrupt.code === "journal" && /corrupt/.test(damaged.corrupt.text), "7. a corrupt header: journal/corrupt");
  check(damaged.restored.code === "ok", "7. restored, it resumes");

  // 8. Versions.
  const v = await inPage<Record<string, { ok?: boolean; code?: string | null; version?: number; stores?: string[] }>>(page, `globalThis.__P.versions(${JSON.stringify(MATCH)})`);
  report.versions = v;
  check(v.v1Write.ok && v.atV1.version === 1, "8. saved by schema 1");
  check(v.upgraded.ok && v.atV2.version === 2 && v.atV2.stores!.includes("owners"), "8. upgraded 1 → 2 additively (the owners store of #654), the save reads back identical");
  check(v.failing.code === "upgrade" && v.afterFailing.version === 2 && !v.afterFailing.stores!.includes("proof-half") && v.stillV2.ok, "8. a failing migration: upgrade error, version 2 kept without the half-made store, the save intact");
  check(v.olderBuild.code === "newer" && v.afterOlder.version === 2 && v.intact.ok, "8. an older build refuses the newer database as newer and leaves it intact");

  // No server.
  const foreign = server.requests.filter((p) => p !== "/" && p !== "/favicon.ico" && !/^\/(src|scripts)\//.test(p));
  check(!foreign.length && !server.refused.length, `no request but repo modules (${server.requests.length} requests; no /api, no database)${foreign.length ? `: ${foreign.join(", ")}` : ""}`);
} catch (error) {
  failures.push(`browser run failed: ${(error as Error).message}`);
} finally {
  clearTimeout(watchdog);
  await browser.close();
  server.close();
}
report.checks = notes;
report.failures = failures;
if (JSON_OUT) console.log(JSON.stringify(report, null, 2));
else {
  console.log(String(report.userAgent ?? "(no browser)"));
  for (const n of notes) console.log(n);
  for (const f of failures.filter((f) => f.startsWith("browser run failed"))) console.log(`FAIL ${f}`);
  console.log(failures.length ? "FAIL" : "ok");
}
process.exit(failures.length ? 1 : 0);
