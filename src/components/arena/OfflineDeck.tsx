"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { packStore, type InstallProgress, type PackStore } from "@/lib/arena/local/pack-store";
import { isPreparedDevice } from "@/lib/arena/local/shell";
import { formatBytes, friendlyError, listSavedMatches, type Friendly, type SavedMatch } from "@/lib/arena/local/prepare";
import {
  deviceDeckIds, fetchDeckChecks, installDeviceDecks, matchesUsing, offlineDeckKey, readDevicePack, takeDeckOff,
  type DevicePack, type OfflineDeckCheck,
} from "@/lib/arena/local/device-decks";

/**
 * "Available offline" on a deck's page (#793). The server has already checked the deck (`check`,
 * `checkOfflineDecks`): ready, or the cards that block it, in plain words — and a blocked deck has
 * no download button at all (owner's ruling: refuse until fixed). Everything else is the device's:
 * whether the deck is on it, whether its list changed online since, downloading it (the pack, then
 * every card image through `/_next/image`, with real progress, Stop, and a "Try again" that resumes)
 * and taking it off. Nothing downloads unless the player presses the button.
 */

const card = "rounded-xl border border-space-700/70 bg-space-900/50 p-3";
const primary = "tap inline-flex items-center justify-center rounded-lg bg-ki-500 px-4 py-2 text-sm font-semibold text-space-950 hover:bg-ki-400 disabled:opacity-40";
const quiet = "tap inline-flex items-center justify-center rounded-lg border border-space-600 bg-space-900 px-4 py-2 text-sm text-space-100 hover:border-space-400 disabled:opacity-40";
const danger = "tap inline-flex items-center justify-center rounded-lg border border-loss/60 bg-loss/10 px-4 py-2 text-sm font-medium text-space-50 hover:bg-loss/20 disabled:opacity-40";

type Op = "download" | "update" | "remove";
export type DeckRun =
  | { kind: "idle" }
  | { kind: "working"; op: Op; progress: InstallProgress | null }
  | { kind: "failed"; op: Op; error: Friendly };

/** Download progress in the player's words: the deck data, then the card pictures. */
export function DeckProgress({ progress }: { progress: InstallProgress | null }) {
  const art = progress && progress.phase !== "pack";
  const label = !progress ? "Getting ready…" : progress.phase === "pack" ? "Deck data" : progress.phase === "verify" ? "Checking the card pictures" : progress.phase === "activate" || progress.phase === "done" ? "Finishing" : "Card pictures";
  const value = progress && progress.total > 0 ? Math.min(progress.done, progress.total) : null;
  return (
    <div className="space-y-1 text-sm" aria-live="polite" data-deck-progress={progress?.phase ?? "start"}>
      <span className="flex items-center justify-between gap-2">
        <span className="text-space-100">{label}</span>
        <span className="text-xs text-space-300">
          {art && value !== null ? `${value} of ${progress!.total}` : value !== null ? formatBytes(value) : "…"}
          {art && progress!.resumed > 0 ? ` (${progress!.resumed} already here)` : ""}
        </span>
      </span>
      <progress className="h-2 w-full" aria-label={`${label} progress`} {...(value !== null ? { value, max: progress!.total } : {})} />
    </div>
  );
}

export function FailedNotice({ error }: { error: Friendly }) {
  return (
    <div role="alert" className="space-y-1 rounded-lg border border-loss/50 bg-loss/10 px-3 py-2 text-sm text-space-50">
      <p className="font-medium">{error.headline}</p>
      <p className="text-xs text-space-200">{error.detail}</p>
      <details className="text-[11px] text-space-300">
        <summary className="tap inline-flex cursor-pointer items-center">Details</summary>
        <p className="break-words font-mono">{error.technical}</p>
      </details>
    </div>
  );
}

/** Blocking cards, named, with every reason. */
export function BlockingList({ check }: { check: OfflineDeckCheck }) {
  return (
    <div className="space-y-2" data-offline-blocked>
      {check.problems.map((p) => <p key={p} className="text-sm text-dbs-yellow">{p}</p>)}
      {check.blocking.length > 0 && (
        <>
          <p className="text-sm text-space-200">
            {check.blocking.length === 1 ? "One card keeps" : `${check.blocking.length} cards keep`} this deck off devices until {check.blocking.length === 1 ? "it is" : "they are"} fixed:
          </p>
          <ul className="space-y-2">
            {check.blocking.map((b) => (
              <li key={b.card} className="rounded-lg border border-space-700 px-3 py-2 text-sm" data-blocking-card={b.card}>
                <Link href={`/cards/${encodeURIComponent(b.card)}`} className="font-medium text-space-50 hover:text-ki-300">{b.name}</Link>{" "}
                <span className="font-mono text-[11px] text-space-400">{b.card}</span>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-space-300">{b.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Why the request for the device pack could not include every deck already on the device, or null. */
export async function othersProblem(ids: number[], device: DevicePack | null, doFetch?: typeof fetch): Promise<string | null> {
  const others = ids.filter((id) => deviceDeckIds(device).includes(id));
  if (!others.length) return null;
  const checks = await fetchDeckChecks(others, doFetch);
  if (!checks) return "Your decks could not be checked. Check the connection and that you are signed in, then try again.";
  const name = (id: number) => device?.decks.find((d) => d.deckId === id)?.name ?? `deck ${id}`;
  const gone = others.filter((id) => !checks.has(id));
  const blocked = others.filter((id) => checks.has(id) && !checks.get(id)!.ready);
  if (!gone.length && !blocked.length) return null;
  return [
    gone.length ? `${gone.map((id) => `"${name(id)}"`).join(", ")} ${gone.length === 1 ? "is" : "are"} no longer one of your decks.` : "",
    blocked.length ? `${blocked.map((id) => `"${name(id)}"`).join(", ")} can no longer be played offline.` : "",
    "Remove it from this device on the Play the computer page first.",
  ].filter(Boolean).join(" ");
}

export function OfflineDeck({ deckId, deckName, check, revision }: { deckId: number; deckName: string; check: OfflineDeckCheck; revision: string | null }) {
  const key = offlineDeckKey(deckId);
  const supported = typeof window === "undefined" || typeof indexedDB !== "undefined";
  const store = useMemo<PackStore | null>(() => (revision && supported && typeof indexedDB !== "undefined" ? packStore({ interpreterRevision: revision }) : null), [revision, supported]);
  useEffect(() => () => store?.close(), [store]);
  const [device, setDevice] = useState<DevicePack | null | undefined>(undefined);
  const [saves, setSaves] = useState<SavedMatch[]>([]);
  const [run, setRun] = useState<DeckRun>({ kind: "idle" });
  const [ask, setAsk] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [prepared, setPrepared] = useState(true);
  const abort = useRef<AbortController | null>(null);

  const read = useCallback(async () => {
    if (!store) return;
    try { setDevice(await readDevicePack(store)); } catch { setDevice(null); }
    setSaves(await listSavedMatches().catch(() => []));
    setPrepared(isPreparedDevice());
  }, [store]);
  useEffect(() => { const t = setTimeout(() => void read(), 0); return () => clearTimeout(t); }, [read]);

  const mine = device?.decks.find((d) => d.key === key) ?? null;
  const stale = !!mine && !!check.listHash && mine.listHash !== check.listHash;
  const using = matchesUsing(saves, key);
  const working = run.kind === "working";

  async function go(op: Op) {
    if (!store) return;
    setNotice(null);
    setAsk(false);
    const controller = new AbortController();
    abort.current = controller;
    setRun({ kind: "working", op, progress: null });
    const onProgress = (p: InstallProgress) => setRun({ kind: "working", op, progress: p });
    try {
      const current = await readDevicePack(store).catch(() => null);
      if (op === "remove") {
        if (current) await takeDeckOff(store, current, key, { onProgress, signal: controller.signal });
        setNotice(`"${deckName}" was taken off this device.`);
      } else {
        const ids = [...new Set([...deviceDeckIds(current), deckId])];
        const problem = await othersProblem(ids.filter((id) => id !== deckId), current);
        if (problem) throw Object.assign(new Error(problem), { plain: problem });
        await installDeviceDecks(store, ids, { onProgress, signal: controller.signal });
        setNotice(op === "update" ? `"${deckName}" on this device is up to date.` : `"${deckName}" is on this device.`);
      }
      setRun({ kind: "idle" });
    } catch (e) {
      const plain = (e as { plain?: string }).plain;
      if (controller.signal.aborted) { setRun({ kind: "idle" }); setNotice("Stopped. What was downloaded is kept; press the button again to carry on."); }
      else setRun({ kind: "failed", op, error: plain ? { headline: "Your other decks on this device need attention", detail: plain, technical: plain } : friendlyError(e) });
    } finally {
      abort.current = null;
      void read();
    }
  }

  const status = device === undefined ? "Checking this device…"
    : mine ? (stale ? "On this device — but the list changed since" : "On this device")
    : check.ready ? "Ready to download" : "Cannot be played offline yet";

  return (
    <section aria-label="Available offline" className={`${card} space-y-3`} data-offline-deck={mine ? (stale ? "stale" : "on-device") : check.ready ? "ready" : "blocked"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-space-100">Available offline</h2>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wider ${mine && !stale ? "border-ki-500/60 text-ki-300" : "border-space-700 text-space-400"}`}>{mine ? "On this device" : check.ready ? "Ready" : "Not yet"}</span>
      </div>
      <p className="text-base font-medium text-space-50" data-offline-deck-status>{status}</p>

      {!revision && <p className="text-sm text-space-300">Offline play needs the live app; this build cannot download decks.</p>}
      {revision && !store && device !== undefined && <p className="text-sm text-space-300">This browser cannot keep decks on the device.</p>}

      {!check.ready && !mine && <BlockingList check={check} />}
      {!check.ready && mine && (
        <>
          <p className="text-sm text-dbs-yellow">The copy on this device still plays, but the deck as it is now cannot be updated:</p>
          <BlockingList check={check} />
        </>
      )}
      {check.ready && !mine && device !== undefined && (
        <p className="text-sm text-space-300">Download it to play it on this device with no connection, against the computer or against another deck on the device.</p>
      )}
      {mine && !stale && <p className="text-sm text-space-300">You can pick it on Play the computer, as your deck or the computer&rsquo;s.</p>}
      {stale && check.ready && <p className="text-sm text-space-300">Update it to play the list as it is now. Until then the device plays the list you downloaded.</p>}
      {mine && !prepared && (
        <p className="text-sm text-space-300">
          To play with no connection, also prepare this device once on <Link className="text-ki-300 underline" href="/arena/offline">Play the computer</Link>.
        </p>
      )}

      {run.kind === "working" && <DeckProgress progress={run.progress} />}
      {run.kind === "failed" && <FailedNotice error={run.error} />}
      {notice && <p role="status" className="text-sm text-space-200" data-notice>{notice}</p>}

      {store && device !== undefined && (
        <div className="flex flex-wrap gap-2">
          {working ? (
            <button type="button" className={quiet} onClick={() => abort.current?.abort()}>Stop</button>
          ) : (
            <>
              {check.ready && !mine && <button type="button" className={primary} onClick={() => void go("download")}>{run.kind === "failed" && run.op === "download" ? "Try again" : "Download to this device"}</button>}
              {check.ready && stale && <button type="button" className={primary} onClick={() => void go("update")}>{run.kind === "failed" && run.op === "update" ? "Try again" : "Update on this device"}</button>}
              {mine && <button type="button" className={quiet} aria-expanded={ask} onClick={() => setAsk(!ask)}>Remove from this device</button>}
            </>
          )}
        </div>
      )}
      {ask && mine && (
        <div role="group" aria-label="Remove from this device" className="space-y-2 rounded-lg border border-space-600 bg-space-950/60 p-3 text-sm text-space-200">
          <p>This takes &ldquo;{deckName}&rdquo; off this device. Your other decks and the built-in decks stay. The deck itself, online, is not touched.</p>
          {using.length > 0
            ? <p className="text-dbs-yellow">{using.length === 1 ? "A saved match plays" : `${using.length} saved matches play`} this deck and would be deleted with it.</p>
            : <p>No saved match plays it.</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={danger} onClick={() => void go("remove")}>{using.length ? "Delete them and remove the deck" : "Remove it"}</button>
            <button type="button" className={quiet} onClick={() => setAsk(false)}>Keep it</button>
          </div>
        </div>
      )}
    </section>
  );
}
