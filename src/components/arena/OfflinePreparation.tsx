"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { InstallProgress, PackStore } from "@/lib/arena/local/pack-store";
import { isPreparedDevice } from "@/lib/arena/local/shell";
import { devicePackUrl, deviceDeckIds, readDevicePack } from "@/lib/arena/local/device-decks";
import { DeviceDecks } from "./DeviceDecks";
import { Panel } from "@/components/ui";
import {
  PrepareError, assess, clearOfflineData, deleteSavedMatches, fetchLatest, formatBytes, friendlyError, listSavedMatches, prepareShell, readFacts,
  requestPersistence, storageUsage, updateAvailable, type DeviceFacts, type Friendly, type Latest, type Part, type SavedMatch, type Usage,
} from "@/lib/arena/local/prepare";

/**
 * Offline preparation (#660, plan O4-05): get the decks (the built-in starters, plus the player's own
 * decks they downloaded, #793), their card artwork and the game itself onto this device, see what is stored, and take it off again. Mounted by the offline page
 * (`/arena/offline`, `LocalArena`) in place of the pack-file step.
 *
 * "Ready" comes only from `assess` over what is really on the device — a complete game-files cache,
 * a finished deck pack with every card image verified, and a game that can play that pack — never
 * from the end of a download. Every removal says what it takes and what it keeps first.
 * Wording is the player's: no storage, worker or version vocabulary on the face of the page.
 */

const primary = "tap inline-flex items-center justify-center rounded-lg bg-ki-500 px-4 py-2 text-sm font-semibold text-space-950 hover:bg-ki-400 disabled:opacity-40";
const quiet = "tap inline-flex items-center justify-center rounded-lg border border-space-600 bg-space-900 px-4 py-2 text-sm text-space-100 hover:border-space-400 disabled:opacity-40";
const danger = "tap inline-flex items-center justify-center rounded-lg border border-loss/60 bg-loss/10 px-4 py-2 text-sm font-medium text-space-50 hover:bg-loss/20 disabled:opacity-40";

type Run =
  | { kind: "idle" }
  | { kind: "working"; part: Part; done: number; total: number }
  | { kind: "failed"; part: Part; error: Friendly };

type Ask = null | "pack" | "saves" | "all";

const ORDER: Part[] = ["game files", "deck pack", "card artwork"];
const LABEL: Record<Part, string> = { "game files": "The game", "deck pack": "The decks", "card artwork": "Card artwork" };

export function OfflinePreparation({ store, revision, pointerPack, onChanged, onReady, forgetPointer, deviceKey }: {
  store: PackStore;
  /** Changes whenever the page saw the device's packs change (the ready versions' hashes). */
  deviceKey?: string;
  /** The game version this page runs (null: a development build, which has no pack). */
  revision: string | null;
  /** The pack hash the page's saved-match pointer names, if any. */
  pointerPack: string | null;
  /** Something on the device changed: re-read the pack list. */
  onChanged: () => void;
  /** The device became ready, or was ready on opening: choose this pack. */
  onReady: (hash: string) => void;
  forgetPointer: () => void;
}) {
  const [facts, setFacts] = useState<DeviceFacts | null>(null);
  const [latest, setLatest] = useState<Latest | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [saves, setSaves] = useState<SavedMatch[]>([]);
  const [run, setRun] = useState<Run>({ kind: "idle" });
  const [ask, setAsk] = useState<Ask>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string; detail?: string } | null>(null);
  const [online, setOnline] = useState(true);
  const [marked, setMarked] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const announced = useRef<string | null>(null);

  const read = useCallback(async () => {
    try {
      const f = await readFacts(store);
      setFacts(f);
      setSaves(await listSavedMatches().catch(() => []));
      setMarked(isPreparedDevice());
      setUsage(await storageUsage());
      return f;
    } catch (e) {
      setNotice({ tone: "error", text: friendlyError(e).headline, detail: friendlyError(e).detail });
      return null;
    }
  }, [store]);

  // A pack installed elsewhere on the page (a file, #658) changes what is on the device: read it again.
  useEffect(() => {
    if (!deviceKey) return;
    const t = setTimeout(() => void read(), 0);
    return () => clearTimeout(t);
  }, [deviceKey, read]);

  useEffect(() => {
    let live = true;
    const first = setTimeout(() => void read(), 0);
    void fetchLatest().then((l) => { if (live) { setLatest(l); setOnline(!!l); } });
    return () => { live = false; clearTimeout(first); };
  }, [read]);

  const readiness = useMemo(() => (facts ? assess(facts) : null), [facts]);
  const newer = useMemo(() => !!facts && updateAvailable(facts, latest), [facts, latest]);
  const working = run.kind === "working";

  // The pack is chosen for the next match as soon as the device is really ready.
  useEffect(() => {
    if (readiness && !readiness.ready) announced.current = null;
    if (readiness?.ready && readiness.pack && announced.current !== readiness.pack.hash && (revision === null || revision.toLowerCase() === readiness.pack.runtimeRevision.toLowerCase())) {
      announced.current = readiness.pack.hash;
      onReady(readiness.pack.hash);
    }
  }, [readiness, revision, onReady]);

  async function prepare() {
    setNotice(null);
    setAsk(null);
    const controller = new AbortController();
    abort.current = controller;
    let part: Part = "game files";
    try {
      const l = await fetchLatest();
      setLatest(l);
      setOnline(!!l);
      if (!l) throw new PrepareError("offline", "the shell list could not be read");
      if (!l.revision) throw new PrepareError("no-pack", "this build has no interpreter revision");
      void requestPersistence();
      setRun({ kind: "working", part, done: 0, total: l.files + 2 });
      await prepareShell(l, l.files, (p) => setRun({ kind: "working", ...p }), controller.signal);
      part = "deck pack";
      setRun({ kind: "working", part, done: 0, total: 0 });
      // The device's own decks (#793) come along: the pack is rebuilt for this version with the same decks.
      const mine = deviceDeckIds(await readDevicePack(store).catch(() => null));
      await store.install({ url: devicePackUrl(mine) }, {
        signal: controller.signal,
        onProgress: (p: InstallProgress) => {
          part = p.phase === "pack" ? "deck pack" : "card artwork";
          setRun({ kind: "working", part, done: p.phase === "activate" || p.phase === "done" ? p.total : p.done, total: p.total });
        },
      });
      setRun({ kind: "idle" });
      onChanged();
      const f = await read();
      if (f && assess(f).ready) setNotice({ tone: "ok", text: "This device is ready for offline play." });
      else setNotice({ tone: "error", text: "The download finished but something is still missing", detail: "Try again. The decks are not marked ready until everything is on the device." });
    } catch (e) {
      const cancelled = controller.signal.aborted;
      setRun(cancelled ? { kind: "idle" } : { kind: "failed", part, error: friendlyError(e) });
      if (cancelled) setNotice({ tone: "ok", text: "Stopped. What was downloaded is kept; prepare again to carry on." });
      onChanged();
      void read();
    } finally {
      abort.current = null;
    }
  }

  async function act(what: () => Promise<void>, done: string) {
    setNotice(null);
    setAsk(null);
    try {
      await what();
      setNotice({ tone: "ok", text: done });
    } catch (e) {
      const f = friendlyError(e);
      setNotice({ tone: "error", text: f.headline, detail: `${f.detail} (${f.technical})` });
    }
    onChanged();
    void read();
  }

  const pack = readiness?.pack ?? null;
  const packSaves = pack ? saves.filter((s) => s.packHash === pack.hash) : [];
  const staged = facts?.staged[0] ?? null;
  const missing = readiness && !readiness.ready ? readiness.missing : [];

  const removePack = () => act(async () => {
    if (!pack) return;
    if (packSaves.length) { await deleteSavedMatches(packSaves.map((s) => s.matchId)); if (pointerPack === pack.hash) forgetPointer(); }
    await store.remove(pack.hash, { active: true });
  }, "The decks and their artwork were removed from this device.");
  const removeSaves = () => act(async () => { await deleteSavedMatches(saves.map((s) => s.matchId)); forgetPointer(); await store.prune().catch(() => undefined); }, "Saved matches were deleted from this device.");
  const removeAll = () => act(async () => {
    store.close();
    const r = await clearOfflineData({ forgetPointer });
    announced.current = null;
    if (r.failed.length) throw new PrepareError("remove", `could not remove: ${r.failed.join(", ")}`);
  }, "Everything for offline play was removed from this device.");

  const headline = !readiness ? "Checking this device…"
    : readiness.ready ? "Ready for offline play"
    : working ? "Preparing…"
    : staged || marked || readiness.pack ? "Not ready yet" : "Not prepared for offline play";

  return (
    <Panel aria-label="Offline play" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs uppercase tracking-widest text-space-400">Offline play</h2>
        <span data-offline-status={!readiness ? "checking" : readiness.ready ? "ready" : "not-ready"} className={`rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wider ${readiness?.ready ? "border-ki-500/60 text-ki-300" : "border-space-700 text-space-400"}`}>
          {readiness?.ready ? "Ready" : "Not ready"}
        </span>
      </div>

      <p className="text-base font-medium text-space-50">{headline}</p>
      <p className="text-sm text-space-300">
        Matches on this device run in your browser against the built-in computer player and are saved here. They are separate from online matches, which are played on the server and need a connection.
      </p>

      {readiness && !readiness.ready && !working && (
        <p className="text-sm text-space-200" data-missing>
          {missing.length === ORDER.length ? "Nothing is on this device yet." : `Still missing: ${missing.join(", ").replace(/, ([^,]*)$/, " and $1")}.`}
          {staged && staged.artRequired > 0 && ` An earlier download stopped after ${staged.artVerified} of ${staged.artRequired} card images; it carries on from there.`}
        </p>
      )}
      {readiness?.ready && pack && (
        <p className="text-sm text-space-200">
          The decks below and all {pack.artRequired} card images are on this device. Start a match below; no connection is needed.
        </p>
      )}
      {pack && <DeviceDecks store={store} packHash={pack.hash} saves={saves} busy={working} onChanged={() => { onChanged(); void read(); }} />}
      {newer && !working && <p role="status" className="text-sm text-dbs-yellow">A newer version of the decks and the game is available.</p>}
      {!online && !working && <p className="text-xs text-space-400">You are offline, so updates cannot be checked.</p>}

      {run.kind !== "idle" && (
        <ol className="space-y-2" aria-label="Preparation progress" aria-live="polite">
          {ORDER.map((p) => {
            const at = ORDER.indexOf(run.part);
            const i = ORDER.indexOf(p);
            const state = i < at ? "done" : i === at ? (run.kind === "failed" ? "failed" : "working") : "waiting";
            const value = run.kind === "working" && i === at && run.total ? run.done : null;
            return (
              <li key={p} className="space-y-1 text-sm" data-step={p} data-state={state}>
                <span className="flex items-center justify-between gap-2">
                  <span className={state === "waiting" ? "text-space-500" : "text-space-100"}>{LABEL[p]}</span>
                  <span className="text-xs text-space-300">
                    {state === "done" ? "Done" : state === "failed" ? "Stopped" : state === "waiting" ? "Waiting" : value !== null && run.kind === "working" ? `${Math.min(run.done, run.total)} of ${run.total}` : "Downloading…"}
                  </span>
                </span>
                {state === "working" && (
                  <progress className="h-2 w-full" aria-label={`${LABEL[p]} progress`} {...(value !== null && run.kind === "working" ? { value: Math.min(run.done, run.total), max: run.total } : {})} />
                )}
              </li>
            );
          })}
        </ol>
      )}

      {run.kind === "failed" && (
        <div role="alert" className="space-y-1 rounded-lg border border-loss/50 bg-loss/10 px-3 py-2 text-sm text-space-50">
          <p className="font-medium">{run.error.headline}</p>
          <p className="text-xs text-space-200">{run.error.detail}</p>
          <details className="text-[11px] text-space-300">
            <summary className="tap inline-flex cursor-pointer items-center">Details</summary>
            <p className="break-words font-mono">{run.error.technical}</p>
          </details>
        </div>
      )}
      {notice && (
        <p role={notice.tone === "error" ? "alert" : "status"} className={`text-sm ${notice.tone === "error" ? "text-loss" : "text-space-200"}`} data-notice>
          {notice.text}{notice.detail && <span className="block text-xs text-space-300">{notice.detail}</span>}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {working ? (
          <button type="button" className={quiet} onClick={() => abort.current?.abort()}>Stop</button>
        ) : (
          <>
            {(!readiness?.ready || newer) && (
              <button type="button" className={primary} disabled={!readiness} onClick={() => void prepare()}>
                {run.kind === "failed" ? "Try again" : newer && readiness?.ready ? "Update" : staged ? "Carry on preparing" : "Prepare for offline play"}
              </button>
            )}
            {readiness?.ready && !newer && online && <button type="button" className={quiet} onClick={() => void fetchLatest().then((l) => { setLatest(l); setOnline(!!l); setNotice({ tone: "ok", text: l ? (facts && updateAvailable(facts, l) ? "A newer version is available." : "Everything on this device is up to date.") : "You are offline, so updates cannot be checked." }); })}>Check for updates</button>}
          </>
        )}
      </div>
      {!readiness?.ready && !working && run.kind === "idle" && !staged && (
        <p className="text-xs text-space-400">Needs a connection once, and a few megabytes of space. Playing online needs no preparation.</p>
      )}

      <div className="space-y-1 border-t border-space-700/70 pt-3 text-sm text-space-200" data-storage>
        <h3 className="text-xs uppercase tracking-widest text-space-400">On this device</h3>
        <p>
          {usage?.used != null
            ? <>This app uses about <strong>{formatBytes(usage.used)}</strong>{usage.quota ? <> of the roughly {formatBytes(usage.quota)} your browser allows</> : null}.</>
            : "How much space this app uses cannot be shown in this browser."}
        </p>
        {pack && <p className="text-xs text-space-300">Decks and artwork: {formatBytes(pack.bytes)}.</p>}
        {usage?.persisted === false && readiness?.ready && <p className="text-xs text-space-400">Your browser may clear this if the device runs very low on space.</p>}
        <p className="text-xs text-space-300" data-saves>
          {saves.length === 0 ? "No saved matches." : `${saves.length} saved ${saves.length === 1 ? "match" : "matches"}, kept only on this device.`}
        </p>
      </div>

      {(pack || saves.length > 0 || marked || (facts && facts.shells.length > 0)) && (
        <div className="space-y-2 border-t border-space-700/70 pt-3">
          <h3 className="text-xs uppercase tracking-widest text-space-400">Remove from this device</h3>
          <div className="flex flex-wrap gap-2">
            {pack && <button type="button" className={quiet} disabled={working} aria-expanded={ask === "pack"} onClick={() => setAsk(ask === "pack" ? null : "pack")}>Remove the decks</button>}
            {saves.length > 0 && <button type="button" className={quiet} disabled={working} aria-expanded={ask === "saves"} onClick={() => setAsk(ask === "saves" ? null : "saves")}>Delete saved matches</button>}
            <button type="button" className={quiet} disabled={working} aria-expanded={ask === "all"} onClick={() => setAsk(ask === "all" ? null : "all")}>Remove everything</button>
          </div>
          {ask === "pack" && pack && (
            <div role="group" aria-label="Remove the decks" className="space-y-2 rounded-lg border border-space-600 bg-space-950/60 p-3 text-sm text-space-200">
              <p>This takes every deck on this device, the built-in ones and yours, and their card artwork off it ({formatBytes(pack.bytes)}). You need a connection to prepare again, and offline play stops until you do. To take off just one of your decks, use Remove next to it above.</p>
              {packSaves.length > 0
                ? <p className="text-dbs-yellow">{packSaves.length === 1 ? "A saved match uses" : `${packSaves.length} saved matches use`} these decks and would be deleted with them.</p>
                : <p>No saved match uses them.</p>}
              <div className="flex flex-wrap gap-2">
                <button type="button" className={danger} onClick={() => void removePack()}>{packSaves.length ? "Delete the saved matches and remove the decks" : "Remove the decks"}</button>
                <button type="button" className={quiet} onClick={() => setAsk(null)}>Keep them</button>
              </div>
            </div>
          )}
          {ask === "saves" && (
            <div role="group" aria-label="Delete saved matches" className="space-y-2 rounded-lg border border-space-600 bg-space-950/60 p-3 text-sm text-space-200">
              <p>This deletes {saves.length === 1 ? "the saved match" : `all ${saves.length} saved matches`} on this device. They cannot be brought back. The decks stay, and online matches are not affected.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={danger} onClick={() => void removeSaves()}>Delete {saves.length === 1 ? "it" : "them"}</button>
                <button type="button" className={quiet} onClick={() => setAsk(null)}>Keep {saves.length === 1 ? "it" : "them"}</button>
              </div>
            </div>
          )}
          {ask === "all" && (
            <div role="group" aria-label="Remove everything" className="space-y-2 rounded-lg border border-space-600 bg-space-950/60 p-3 text-sm text-space-200">
              <p>This removes everything this app keeps on the device for offline play: the game, every deck on it, the card artwork, the cached card images and {saves.length === 0 ? "any saved matches" : saves.length === 1 ? "your saved match" : `your ${saves.length} saved matches`}. Offline play stops until you prepare again. Your account, your collection and online matches are not touched, and nothing else this site stored is removed.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={danger} onClick={() => void removeAll()}>Remove everything</button>
                <button type="button" className={quiet} onClick={() => setAsk(null)}>Keep it all</button>
              </div>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

