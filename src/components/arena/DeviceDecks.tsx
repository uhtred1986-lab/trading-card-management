"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { InstallProgress, PackStore } from "@/lib/arena/local/pack-store";
import { formatBytes, friendlyError, type SavedMatch } from "@/lib/arena/local/prepare";
import { deckBytes, deviceDeckIds, fetchDeckChecks, installDeviceDecks, matchesUsing, readDevicePack, takeDeckOff, type DevicePack, type OfflineDeckCheck } from "@/lib/arena/local/device-decks";
import { DeckProgress, FailedNotice, othersProblem, type DeckRun } from "./OfflineDeck";

/**
 * The decks on this device (#793), on `/arena/offline`: the built-in starters and every deck the
 * player downloaded from its page, each with the space its card pictures take. A player's deck can
 * be taken off on its own — with no connection: the device rebuilds its pack without it — and the
 * saved matches that play it go with it, after the page says so; every other deck and saved match
 * stays. Online and signed in, a deck whose list changed since it was downloaded says so and can be
 * updated. Remove everything stays in the panel above this list, for every player.
 */

const quiet = "tap inline-flex items-center justify-center rounded-lg border border-space-600 bg-space-900 px-3 py-2 text-sm text-space-100 hover:border-space-400 disabled:opacity-40";
const primary = "tap inline-flex items-center justify-center rounded-lg bg-ki-500 px-3 py-2 text-sm font-semibold text-space-950 hover:bg-ki-400 disabled:opacity-40";
const danger = "tap inline-flex items-center justify-center rounded-lg border border-loss/60 bg-loss/10 px-3 py-2 text-sm font-medium text-space-50 hover:bg-loss/20 disabled:opacity-40";

export function DeviceDecks({ store, packHash, saves, busy, onChanged }: { store: PackStore; packHash: string; saves: SavedMatch[]; busy: boolean; onChanged: () => void }) {
  const [device, setDevice] = useState<DevicePack | null>(null);
  const [bytes, setBytes] = useState<Map<string, number>>(new Map());
  const [checks, setChecks] = useState<Map<number, OfflineDeckCheck> | null>(null);
  const [ask, setAsk] = useState<string | null>(null);
  const [run, setRun] = useState<DeckRun & { key?: string }>({ kind: "idle" });
  const [notice, setNotice] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const read = useCallback(async () => {
    try {
      const d = await readDevicePack(store);
      setDevice(d);
      if (d) {
        setBytes(await deckBytes(store, d).catch(() => new Map()));
        setChecks(await fetchDeckChecks(deviceDeckIds(d)));
      }
    } catch { setDevice(null); }
  }, [store]);
  // Re-read whenever the device's pack changes (prepared, updated, a deck added elsewhere).
  useEffect(() => { const t = setTimeout(() => void read(), 0); return () => clearTimeout(t); }, [read, packHash]);

  if (!device) return null;
  const working = run.kind === "working";
  const staleOf = (d: DevicePack["decks"][number]) => {
    if (d.deckId === null || !checks) return false;
    const c = checks.get(d.deckId);
    return !!c?.listHash && c.listHash !== d.listHash;
  };

  async function go(op: "remove" | "update", key: string) {
    setNotice(null);
    setAsk(null);
    const controller = new AbortController();
    abort.current = controller;
    const onProgress = (p: InstallProgress) => setRun({ kind: "working", op, progress: p, key });
    setRun({ kind: "working", op, progress: null, key });
    const name = device!.decks.find((d) => d.key === key)?.name ?? key;
    try {
      const current = (await readDevicePack(store)) ?? device!;
      if (op === "remove") {
        await takeDeckOff(store, current, key, { onProgress, signal: controller.signal, saves });
        setNotice(`"${name}" was taken off this device.`);
      } else {
        const ids = deviceDeckIds(current);
        const deckId = current.decks.find((d) => d.key === key)?.deckId;
        const problem = await othersProblem(ids.filter((id) => id !== deckId), current);
        if (problem) throw Object.assign(new Error(problem), { plain: problem });
        await installDeviceDecks(store, ids, { onProgress, signal: controller.signal });
        setNotice(`"${name}" on this device is up to date.`);
      }
      setRun({ kind: "idle" });
    } catch (e) {
      const plain = (e as { plain?: string }).plain;
      if (controller.signal.aborted) { setRun({ kind: "idle" }); setNotice("Stopped. Nothing on this device changed."); }
      else setRun({ kind: "failed", op, key, error: plain ? { headline: "Your other decks on this device need attention", detail: plain, technical: plain } : friendlyError(e) });
    } finally {
      abort.current = null;
      onChanged();
      void read();
    }
  }

  return (
    <div className="space-y-2 border-t border-space-700/70 pt-3" data-device-decks>
      <h3 className="text-xs uppercase tracking-widest text-space-400">Decks on this device</h3>
      <ul className="space-y-2" aria-label="Decks on this device">
        {device.decks.map((d) => {
          const stale = staleOf(d);
          const using = matchesUsing(saves, d.key);
          const size = bytes.get(d.key);
          return (
            <li key={d.key} data-device-deck={d.key} data-stale={stale ? "true" : undefined} className="space-y-2 rounded-lg border border-space-700 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block font-medium text-space-50">{d.name}</span>
                  <span className="block text-xs text-space-300">
                    {d.leader} · {d.deckId === null ? "built in" : "your deck"}{d.isTesting ? " · testing" : ""} · {d.images} card pictures{size ? `, about ${formatBytes(size)}` : ""}
                  </span>
                  {stale && <span className="block text-xs text-dbs-yellow" data-needs-update>This deck changed online since you downloaded it.</span>}
                </span>
                {d.deckId !== null && (
                  <span className="flex flex-wrap gap-2">
                    {stale && <button type="button" className={primary} disabled={busy || working} onClick={() => void go("update", d.key)}>Update</button>}
                    <button type="button" className={quiet} disabled={busy || working} aria-expanded={ask === d.key} onClick={() => setAsk(ask === d.key ? null : d.key)}>Remove</button>
                  </span>
                )}
              </div>
              {ask === d.key && (
                <div role="group" aria-label={`Remove ${d.name}`} className="space-y-2 rounded-lg border border-space-600 bg-space-950/60 p-3 text-sm text-space-200">
                  <p>This takes &ldquo;{d.name}&rdquo; off this device. The other decks stay, and so do saved matches that do not play it. No connection is needed.</p>
                  {using.length > 0
                    ? <p className="text-dbs-yellow">{using.length === 1 ? "A saved match plays" : `${using.length} saved matches play`} this deck and would be deleted with it.</p>
                    : <p>No saved match plays it.</p>}
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={danger} onClick={() => void go("remove", d.key)}>{using.length ? "Delete them and remove the deck" : "Remove it"}</button>
                    <button type="button" className={quiet} onClick={() => setAsk(null)}>Keep it</button>
                  </div>
                </div>
              )}
              {run.kind !== "idle" && run.key === d.key && (run.kind === "working" ? <DeckProgress progress={run.progress} /> : <FailedNotice error={run.error} />)}
            </li>
          );
        })}
      </ul>
      {working && <button type="button" className={quiet} onClick={() => abort.current?.abort()}>Stop</button>}
      {notice && <p role="status" className="text-sm text-space-200" data-deck-notice>{notice}</p>}
      <p className="text-xs text-space-400">To add one of your own decks, open it under Decks and choose &ldquo;Download to this device&rdquo;.</p>
    </div>
  );
}
