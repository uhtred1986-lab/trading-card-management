"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArenaStage } from "../stage/ArenaStage";
import type { ArenaSkin } from "@/lib/arena/skin";
import type { ArenaStaging } from "@/lib/arena/staging";
import type { TurnLighting } from "@/lib/arena/lighting";
import type { SpawnedWorker } from "../../../lib/arena/local/recovery";
import { loadLocalArt, type LocalArt } from "../../../lib/arena/local/art-urls";
import { packStore, PackStoreError, type InstalledVersion, type InstallProgress, type PackStore } from "../../../lib/arena/local/pack-store";
import { installedShells, shellRefusal, SHELL_PATH, type ShellMeta } from "../../../lib/arena/local/shell";
import { OfflinePreparation } from "../OfflinePreparation";
import { useMatchScreen } from "../../../lib/match-screen";
import { LocalBoard, LocalBoardError, POINTER_KEY, browserPointerStore, readPack, readPointer, type BoardAction, type BoardNotice, type LocalPointer, type PackFacts, type PointerStore } from "./local-board";

/**
 * Play on this device (#656, plan O3-05): the existing board over a local match. Everything here
 * runs in the browser — the match in a module Worker, its journal in IndexedDB — and nothing is
 * sent to the server: this component calls no network API and no server action.
 *
 * On `/arena/local` the player chooses the pack file. In the offline shell (`shell`, #659,
 * `/arena/offline`) the packs come from the device's pack store (`packStore`, #658): the installed
 * ones are listed, a chosen file is installed into the store first, and a pack made for another
 * interpreter revision than the shell's is refused (`shellRefusal`). A pack the audit still blocks is
 * refused with its reasons; the saved match is remembered by a pointer (match id, pack hash, seat) in
 * this browser's storage, and continued from the device's journal.
 */

type StageProps = { skin?: ArenaSkin; staging?: ArenaStaging; lighting?: TurnLighting };
/** The offline shell's build: its interpreter revision (null for an unpinned build, which plays no pack). */
export type ShellInfo = { revision: string | null };

/** A module Worker on the local match engine; the literal form is what the bundler recognises. */
const spawn = (): SpawnedWorker => new Worker(new URL("../../../lib/arena/local/worker-entry.ts", import.meta.url), { type: "module" }) as unknown as SpawnedWorker;

const changes = new Set<() => void>();
const base = browserPointerStore();
/** The browser's pointer store, telling this page when it changes (the `storage` event covers other tabs). */
const pointers: PointerStore = { get: base.get, set: (p) => { base.set(p); changes.forEach((f) => f()); }, clear: () => { base.clear(); changes.forEach((f) => f()); } };
const subscribePointer = (notify: () => void) => {
  changes.add(notify);
  window.addEventListener("storage", notify);
  return () => { changes.delete(notify); window.removeEventListener("storage", notify); };
};
const rawPointer = (): string | null => { try { return localStorage.getItem(POINTER_KEY); } catch { return null; } };
const supportedHere = () => typeof Worker !== "undefined" && typeof indexedDB !== "undefined";
const never = () => () => {};

type Phase =
  | { kind: "setup" }
  | { kind: "opening"; what: string }
  | { kind: "board"; board: LocalBoard };

const panel = "rounded-xl border border-space-700/70 bg-space-900/60 p-4";
const primary = "tap inline-flex items-center justify-center rounded-lg bg-ki-500 px-4 py-2 text-sm font-semibold text-space-950 hover:bg-ki-400 disabled:opacity-40";
const quiet = "tap inline-flex items-center justify-center rounded-lg border border-space-600 bg-space-900 px-4 py-2 text-sm text-space-100 hover:border-space-400 disabled:opacity-40";
const seatOf = (p: LocalPointer) => (p.human === "p1" ? "first" : "second");
const fileInput = "tap block w-full text-sm text-space-200 file:mr-3 file:rounded-lg file:border file:border-space-600 file:bg-space-900 file:px-3 file:py-2 file:text-space-100";

type Installed = {
  store: PackStore;
  /** The ready versions on this device; null while reading. */
  versions: InstalledVersion[] | null;
  /** The complete offline shells cached on this device (newest first). */
  shells: ShellMeta[];
  progress: InstallProgress | null;
  error: string | null;
  install(text: string): Promise<InstalledVersion>;
  /** Re-read the device (something was installed or removed elsewhere). */
  refresh(): void;
};

/** The device's pack store, for the offline shell; null on `/arena/local`. */
function useInstalledPacks(shell: ShellInfo | undefined): Installed | null {
  const revision = shell?.revision;
  const enabled = !!shell && typeof indexedDB !== "undefined";
  const store = useMemo(() => (enabled ? packStore({ interpreterRevision: revision ?? null }) : null), [enabled, revision]);
  const [versions, setVersions] = useState<InstalledVersion[] | null>(null);
  const [shells, setShells] = useState<ShellMeta[]>([]);
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reads, setReads] = useState(0);
  useEffect(() => {
    if (!store) return;
    let live = true;
    store.list().then(
      (all) => { if (live) { setVersions(all.filter((v) => v.status === "ready")); setError(null); } },
      (e: unknown) => { if (live) { setVersions([]); setError(e instanceof Error ? e.message : String(e)); } },
    );
    installedShells().then((s) => { if (live) setShells(s); }, () => {});
    return () => { live = false; };
  }, [store, reads]);
  useEffect(() => () => store?.close(), [store]);
  if (!store) return null;
  return {
    store, versions, shells, progress, error,
    refresh: () => setReads((n) => n + 1),
    async install(text) {
      setProgress({ phase: "pack", done: 0, total: 0, resumed: 0 });
      try { return await store.install({ text }, { onProgress: setProgress }); } finally { setProgress(null); setReads((n) => n + 1); }
    },
  };
}

function InstalledPacks({ installed, revision, chosen, busy, onUse, onFile }: { installed: Installed; revision: string | null; chosen: string | null; busy: boolean; onUse: (hash: string) => void; onFile: (f: File | undefined) => void }) {
  const { versions, progress, error } = installed;
  return (
    <div className="space-y-2">
      {versions === null && <p className="text-xs text-space-400">Reading the packs on this device…</p>}
      {versions?.length === 0 && <p className="text-sm text-space-300">No deck pack is installed on this device yet.</p>}
      {error && <p className="text-xs text-loss">The packs on this device could not be read: {error}</p>}
      {versions && versions.length > 0 && (
        <ul className="space-y-2" aria-label="Installed packs">
          {versions.map((v) => {
            const why = shellRefusal(revision, v.runtimeRevision);
            return (
              <li key={v.hash} data-pack-hash={v.hash} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-space-700 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-mono text-space-100">{v.id}</span>
                  {v.active && <span className="ml-2 text-[11px] uppercase tracking-wider text-space-400">current</span>}
                  {why && <span className="block text-xs text-dbs-yellow" data-refusal>{why}</span>}
                </span>
                <button type="button" className={chosen === v.hash ? primary : quiet} disabled={busy || !!why} onClick={() => onUse(v.hash)}>{chosen === v.hash ? "Chosen" : "Use"}</button>
              </li>
            );
          })}
        </ul>
      )}
      <label className="block text-sm text-space-200">
        <span className="mb-1 block">Add a deck file to this device</span>
        <input type="file" accept="application/json,.json" disabled={busy} onChange={(e) => onFile(e.target.files?.[0])} className={fileInput} />
      </label>
      {progress && <p className="text-xs text-space-300" aria-live="polite">Installing · {progress.phase}{progress.total ? ` ${progress.done}/${progress.total}` : ""}</p>}
    </div>
  );
}

/** A saved match played on another revision: the cached shell of that revision can still open it. */
function PreviousShell({ revision, shells }: { revision: string; shells: ShellMeta[] }) {
  const match = shells.find((s) => s.revision === revision);
  return match ? (
    <p className="text-xs text-dbs-yellow">It was played on an earlier version of the app, which is still on this device: <a className="underline" href={`${SHELL_PATH}?shell=${match.version}`}>continue it there</a>.</p>
  ) : (
    <p className="text-xs text-dbs-yellow">It was played on app version {revision.slice(0, 7)}, which is no longer on this device; it cannot be continued here.</p>
  );
}

/** A newer shell has downloaded and waits: it takes over only once no window of the app is open, never mid-match. */
function UpdateNotice() {
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    let live = true;
    navigator.serviceWorker?.getRegistration().then((r) => { if (live) setWaiting(!!r?.waiting); }).catch(() => {});
    return () => { live = false; };
  }, []);
  return waiting ? <p role="status" className="text-xs text-space-300">The latest version of the app is on this device. It starts the next time the app is opened with every window of it closed; a match in progress keeps the version it started on.</p> : null;
}

/**
 * The page's own skin (`data-skin` on `<html>`). The offline shell is one static page that reads no
 * cookie, so it passes no skin; its board then wears the page's, as every other surface on it does —
 * a night board on an anime page paints night classes over anime tokens and its names fade (the
 * owner's S21 shot, #783).
 */
const documentSkin = (): ArenaSkin | null => {
  const s = document.documentElement.dataset.skin;
  return s === "anime" || s === "night" ? s : null;
};

export function LocalArena({ skin: chosenSkin, staging, lighting, shell }: StageProps & { shell?: ShellInfo }) {
  const pageSkin = useSyncExternalStore(never, documentSkin, () => null);
  const skin: ArenaSkin = chosenSkin ?? pageSkin ?? "night";
  const [phase, setPhase] = useState<Phase>({ kind: "setup" });
  const [chosen, setFacts] = useState<PackFacts | null>(null);
  const [problem, setProblem] = useState<{ message: string; reasons: string[] } | null>(null);
  const [mine, setMine] = useState("");
  const [theirs, setTheirs] = useState("");
  const [seat, setSeat] = useState<"p1" | "p2">("p1");
  const boardRef = useRef<LocalBoard | null>(null);

  // Rendered as supported on the server, so the first client render matches it.
  const supported = useSyncExternalStore(never, supportedHere, () => true);
  const storedPointer = useSyncExternalStore(subscribePointer, rawPointer, () => null);
  const pointer = useMemo(() => readPointer(storedPointer), [storedPointer]);
  const artRef = useRef<LocalArt | null>(null);
  useEffect(() => () => { void boardRef.current?.dispose(); artRef.current?.revoke(); artRef.current = null; }, []);
  const installed = useInstalledPacks(shell);
  // A pack that was removed from the device is no longer the chosen one.
  const facts = chosen && installed?.versions && !installed.versions.some((v) => v.hash === chosen.hash) && !installed.progress ? null : chosen;

  /** The installed pack's images as object URLs (#780), kept while the same pack is played and freed when another is chosen. */
  async function artFor(hash: string): Promise<ReadonlyMap<string, string> | undefined> {
    if (!installed) return undefined;
    if (artRef.current?.hash !== hash) {
      artRef.current?.revoke();
      artRef.current = null;
      try { artRef.current = await loadLocalArt(installed.store, hash); } catch { return undefined; }
    }
    return artRef.current.urls;
  }
  const show = (board: LocalBoard) => { boardRef.current = board; setPhase({ kind: "board", board }); };
  const fail = (e: unknown) => {
    if (e instanceof LocalBoardError) setProblem({ message: e.message, reasons: e.reasons });
    else setProblem({ message: e instanceof Error ? e.message : String(e), reasons: [] });
    setPhase({ kind: "setup" });
  };

  function adopt(f: PackFacts) {
    setFacts(f);
    setMine(f.decks[0].key);
    setTheirs((f.decks[1] ?? f.decks[0]).key);
  }

  async function choose(file: File | undefined) {
    setProblem(null);
    setFacts(null);
    if (!file) return;
    try {
      adopt(readPack(JSON.parse(await file.text()) as unknown));
    } catch (e) {
      fail(e instanceof SyntaxError ? new LocalBoardError("pack", "That file is not an offline deck pack.") : e);
    }
  }

  async function begin(what: string, open: () => Promise<LocalBoard>) {
    setProblem(null);
    setPhase({ kind: "opening", what });
    try { show(await open()); } catch (e) { fail(e); }
  }

  /** In the shell, a pack this build cannot play is refused before a worker is spent on it. */
  const compatible = (f: PackFacts) => {
    const why = shell ? shellRefusal(shell.revision, f.runtimeRevision) : null;
    if (why) throw new LocalBoardError("unplayable", why);
    return f;
  };
  const start = () => facts && begin("Dealing…", async () => LocalBoard.start(compatible(facts).pack, { decks: seat === "p1" ? { p1: mine, p2: theirs } : { p1: theirs, p2: mine }, human: seat }, { spawn, pointers, art: await artFor(facts.hash) }));
  const resume = () => pointer && (facts || installed) && begin("Opening your saved match…", async () => {
    // In the shell the saved match's pack is read from the device, whichever pack is chosen.
    const f = installed && facts?.hash !== pointer.packHash ? readPack(await installed.store.load(pointer.packHash)) : facts!;
    return LocalBoard.resume(compatible(f).pack, pointer, { spawn, pointers, art: await artFor(f.hash) });
  });
  /** Choose an installed pack (shell). */
  async function chooseInstalled(hash: string, keepProblem = false) {
    if (!keepProblem) setProblem(null);
    setFacts(null);
    try { adopt(readPack(await installed!.store.load(hash))); } catch (e) { fail(e); }
  }
  /** Install a pack file into the device's store, then choose it (shell). */
  async function installFile(file: File | undefined) {
    setProblem(null);
    if (!file || !installed) return;
    try {
      const v = await installed.install(await file.text());
      await chooseInstalled(v.hash);
    } catch (e) {
      fail(e instanceof PackStoreError ? new LocalBoardError("pack", `The pack was not installed: ${e.message}`) : e);
    }
  }
  const discard = () => pointers.clear();

  if (!supported) {
    return (
      <Shell>
        <p role="alert" className="rounded-xl border border-dbs-yellow/40 bg-dbs-yellow/10 px-3 py-2 text-sm text-dbs-yellow">
          This browser cannot run a match on the device: it needs Web Workers and IndexedDB.
        </p>
      </Shell>
    );
  }

  if (phase.kind === "board") {
    return (
      <BoardView
        board={phase.board}
        stage={{ skin, staging, lighting }}
        onSwitch={show}
        onLeave={async (forget) => {
          const board = phase.board;
          boardRef.current = null;
          if (forget) board.forget();
          await board.dispose();
          setPhase({ kind: "setup" });
        }}
      />
    );
  }

  const busy = phase.kind === "opening" || !!installed?.progress;
  const pinned = installed && pointer ? installed.versions?.find((v) => v.hash === pointer.packHash) ?? null : null;
  const sameDeck = (facts && pointer && facts.hash === pointer.packHash) || !!pinned;
  return (
    <Shell>
      <div className="space-y-4">
        <p className="text-sm text-space-300">
          The match runs in this browser and is saved on this device after every move. Nothing is sent to a server, and no account or connection is needed once the pack is here.
        </p>

        {installed && <UpdateNotice />}

        {installed && (
          <OfflinePreparation
            store={installed.store}
            revision={shell!.revision}
            pointerPack={pointer?.packHash ?? null}
            onChanged={installed.refresh}
            onReady={(hash) => { if (!facts) void chooseInstalled(hash, true); }}
            forgetPointer={discard}
          />
        )}

        <section aria-label="Deck pack" className={`${panel} space-y-2`}>
          <h2 className="text-xs uppercase tracking-widest text-space-400">{installed ? "Decks on this device" : "Deck pack"}</h2>
          {installed ? (
            <details>
              <summary className="tap inline-flex cursor-pointer items-center text-sm text-space-200">Choose a deck pack or add one from a file</summary>
              <div className="mt-2">
                <InstalledPacks installed={installed} revision={shell!.revision} chosen={facts?.hash ?? null} busy={busy} onUse={(h) => void chooseInstalled(h)} onFile={(f) => void installFile(f)} />
              </div>
            </details>
          ) : (
            <label className="block text-sm text-space-200">
              <span className="mb-1 block">Choose the pack file</span>
              <input type="file" accept="application/json,.json" disabled={busy} onChange={(e) => void choose(e.target.files?.[0])} className={fileInput} />
            </label>
          )}
          {facts && <p className="text-xs text-space-400">Pack <span className="font-mono">{facts.id}</span> · {facts.decks.length} decks · ready</p>}
        </section>

        {problem && (
          <div role="alert" className="space-y-2 rounded-xl border border-loss/50 bg-loss/10 px-3 py-2 text-sm text-space-50">
            <p>{problem.message}</p>
            {problem.reasons.length > 0 && (
              <details className="text-xs text-space-300">
                <summary className="tap cursor-pointer">Why ({problem.reasons.length})</summary>
                <ul className="mt-1 list-disc space-y-1 pl-5">{problem.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
              </details>
            )}
          </div>
        )}

        {pointer && (
          <section aria-label="Saved match" className={`${panel} space-y-2`}>
            <h2 className="text-xs uppercase tracking-widest text-space-400">Saved match</h2>
            <p className="text-sm text-space-100">
              {pointer.names[pointer.human]} <span className="text-space-500">vs</span> {pointer.names[pointer.human === "p1" ? "p2" : "p1"]} · you play {seatOf(pointer)}
            </p>
            {!installed && facts && !sameDeck && <p className="text-xs text-dbs-yellow">It was started from pack <span className="font-mono">{pointer.packId}</span>; choose that file to continue it.</p>}
            {!installed && !facts && <p className="text-xs text-space-400">Choose the pack file <span className="font-mono">{pointer.packId}</span> to continue it.</p>}
            {installed?.versions && !pinned && <p className="text-xs text-dbs-yellow">Its pack <span className="font-mono">{pointer.packId}</span> is not installed on this device.</p>}
            {installed && pinned && shell && shellRefusal(shell.revision, pinned.runtimeRevision) && <PreviousShell revision={pinned.runtimeRevision} shells={installed.shells} />}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={primary} disabled={busy || !sameDeck} onClick={() => void resume()}>Continue</button>
              <button type="button" className={quiet} disabled={busy} onClick={discard}>Forget it</button>
            </div>
          </section>
        )}

        {facts && (
          <section aria-label="New match" className={`${panel} space-y-3`}>
            <h2 className="text-xs uppercase tracking-widest text-space-400">New match</h2>
            <label className="block text-sm text-space-200">
              <span className="mb-1 block">Your deck</span>
              <select value={mine} onChange={(e) => setMine(e.target.value)} disabled={busy} className="tap w-full rounded-lg border border-space-600 bg-space-900 px-3 py-2 text-sm text-space-50">
                {facts.decks.map((d) => <option key={d.key} value={d.key}>{d.name}{d.leader ? ` — ${d.leader}` : ""}</option>)}
              </select>
            </label>
            <label className="block text-sm text-space-200">
              <span className="mb-1 block">Opponent&rsquo;s deck</span>
              <select value={theirs} onChange={(e) => setTheirs(e.target.value)} disabled={busy} className="tap w-full rounded-lg border border-space-600 bg-space-900 px-3 py-2 text-sm text-space-50">
                {facts.decks.map((d) => <option key={d.key} value={d.key}>{d.name}{d.leader ? ` — ${d.leader}` : ""}</option>)}
              </select>
            </label>
            <fieldset className="space-y-1">
              <legend className="mb-1 text-sm text-space-200">Your seat</legend>
              <div className="grid grid-cols-2 gap-2">
                {(["p1", "p2"] as const).map((s) => (
                  <button key={s} type="button" aria-pressed={seat === s} onClick={() => setSeat(s)} disabled={busy} className={`tap rounded-lg border px-3 py-2 text-sm ${seat === s ? "border-ki-500 bg-space-800 text-space-50" : "border-space-700 bg-space-900/50 text-space-300"}`}>
                    {s === "p1" ? "First" : "Second"}
                  </button>
                ))}
              </div>
            </fieldset>
            <button type="button" className={`${primary} w-full`} disabled={busy} onClick={() => void start()}>
              {busy ? (phase.kind === "opening" ? phase.what : "") : "Start match"}
            </button>
            <p className="text-[11px] text-space-500">The opponent is the built-in computer player; it runs on this device and costs nothing.</p>
          </section>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-xl space-y-4 pb-6">
      <Link href="/arena" className="tap inline-flex items-center text-sm text-space-300 hover:text-ki-300">← Arena</Link>
      <h1 className="text-xl font-semibold text-space-50">Play on this device</h1>
      {children}
    </div>
  );
}

/** Re-render when the board's state or saving flag changes. */
function useBoardTick(board: LocalBoard): number {
  const [tick, setTick] = useState(0);
  useEffect(() => board.subscribe(() => setTick((n) => n + 1)), [board]);
  return tick;
}

function BoardView({ board, stage, onSwitch, onLeave }: { board: LocalBoard; stage: StageProps; onSwitch: (next: LocalBoard) => void; onLeave: (forget: boolean) => Promise<void> }) {
  useBoardTick(board);
  // The match takes the whole screen (#783): in the offline shell the route alone cannot say so.
  useMatchScreen();
  useEffect(() => board.onSuccessor(onSwitch), [board, onSwitch]);
  const notice = board.notice;
  const snapshot = board.snapshot;
  const act = async (a: BoardAction) => {
    if (a === "retry") await board.retry();
    else if (a === "takeOver") await board.takeOver();
    else if (a === "stop") await board.stop();
    else await onLeave(a === "discard" || !!snapshot?.over);
  };
  const menu = (
    <div className="space-y-2 text-sm">
      <p className="text-space-100">
        {board.packFacts.decks.find((d) => d.key === board.setup.decks.p1)?.name} <span className="text-space-500">vs</span> {board.packFacts.decks.find((d) => d.key === board.setup.decks.p2)?.name}
        <span className="ml-2 rounded-full border border-space-700 px-2 py-0.5 text-[11px] uppercase tracking-wider text-space-400">On this device</span>
      </p>
      <p className="text-xs text-space-300" aria-live="polite">
        {board.state.kind === "owner" ? (board.saving ? "Saving on this device…" : snapshot ? `Saved on this device · move ${snapshot.game.revision}` : "") : "Not saving: see the message above the board."}
      </p>
      <button type="button" onClick={() => void onLeave(!!snapshot?.over)} className="tap inline-flex items-center text-space-300 hover:text-ki-300">← Leave the match (it stays saved)</button>
    </div>
  );
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 lg:max-w-none">
      {notice && <Notice notice={notice} onAction={(a) => void act(a)} />}
      {snapshot ? (
        <div id="board" className="scroll-mt-2">
          <ArenaStage key={board.matchId} session={board} snapshot={snapshot} decklists={board.decklists} skin={stage.skin} staging={stage.staging} lighting={stage.lighting} menu={menu} />
        </div>
      ) : (
        !notice && <p className="text-sm text-space-300">Opening the match…</p>
      )}
    </div>
  );
}

const LABEL: Record<BoardAction, string> = { retry: "Try again", takeOver: "Play here instead", stop: "Stop", leave: "Back to start", discard: "Discard it" };
const TONE: Record<BoardNotice["tone"], string> = {
  ok: "border-space-700 bg-space-900",
  busy: "border-ki-500/50 bg-ki-500/10",
  warn: "border-dbs-yellow/50 bg-dbs-yellow/10",
  error: "border-loss/60 bg-loss/10",
};

function Notice({ notice, onAction }: { notice: BoardNotice; onAction: (a: BoardAction) => void }) {
  return (
    <div role={notice.tone === "error" ? "alert" : "status"} className={`flex flex-col gap-2 rounded-xl border px-3 py-2 text-sm text-space-50 sm:flex-row sm:items-center sm:justify-between ${TONE[notice.tone]}`}>
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium">{notice.headline}</p>
        <p className="text-xs text-space-200">{notice.detail}</p>
        {notice.technical && (
          <details className="text-[11px] text-space-300">
            <summary className="tap inline-flex cursor-pointer items-center">Details</summary>
            <p className="break-words font-mono">{notice.technical}</p>
          </details>
        )}
      </div>
      {notice.actions.length > 0 && (
        <div className="flex shrink-0 flex-wrap gap-2">
          {notice.actions.map((a, i) => (
            <button key={a} type="button" onClick={() => onAction(a)} className={i === 0 ? primary : quiet}>{LABEL[a]}</button>
          ))}
        </div>
      )}
    </div>
  );
}
