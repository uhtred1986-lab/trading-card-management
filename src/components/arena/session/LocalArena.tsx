"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArenaStage } from "../stage/ArenaStage";
import type { ArenaSkin } from "@/lib/arena/skin";
import type { ArenaStaging } from "@/lib/arena/staging";
import type { TurnLighting } from "@/lib/arena/lighting";
import type { SpawnedWorker } from "../../../lib/arena/local/recovery";
import { LocalBoard, LocalBoardError, POINTER_KEY, browserPointerStore, readPack, readPointer, type BoardAction, type BoardNotice, type LocalPointer, type PackFacts, type PointerStore } from "./local-board";

/**
 * Play on this device (#656, plan O3-05): the existing board over a local match. Everything here
 * runs in the browser — the match in a module Worker, its journal in IndexedDB — and nothing is
 * sent to the server: this component calls no network API and no server action.
 *
 * Until packs are installed from the app (O4-03, #658) the player chooses the pack file. A pack the
 * audit still blocks is refused with its reasons; the saved match is remembered by a pointer (match
 * id, pack hash, seat) in this browser's storage, and continued from the device's journal.
 */

type StageProps = { skin?: ArenaSkin; staging?: ArenaStaging; lighting?: TurnLighting };

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

export function LocalArena({ skin = "night", staging, lighting }: StageProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "setup" });
  const [facts, setFacts] = useState<PackFacts | null>(null);
  const [problem, setProblem] = useState<{ message: string; reasons: string[] } | null>(null);
  const [mine, setMine] = useState("");
  const [theirs, setTheirs] = useState("");
  const [seat, setSeat] = useState<"p1" | "p2">("p1");
  const boardRef = useRef<LocalBoard | null>(null);

  // Rendered as supported on the server, so the first client render matches it.
  const supported = useSyncExternalStore(never, supportedHere, () => true);
  const storedPointer = useSyncExternalStore(subscribePointer, rawPointer, () => null);
  const pointer = useMemo(() => readPointer(storedPointer), [storedPointer]);
  useEffect(() => () => { void boardRef.current?.dispose(); }, []);

  const deps = { spawn, pointers };
  const show = (board: LocalBoard) => { boardRef.current = board; setPhase({ kind: "board", board }); };
  const fail = (e: unknown) => {
    if (e instanceof LocalBoardError) setProblem({ message: e.message, reasons: e.reasons });
    else setProblem({ message: e instanceof Error ? e.message : String(e), reasons: [] });
    setPhase({ kind: "setup" });
  };

  async function choose(file: File | undefined) {
    setProblem(null);
    setFacts(null);
    if (!file) return;
    try {
      const f = readPack(JSON.parse(await file.text()) as unknown);
      setFacts(f);
      setMine(f.decks[0].key);
      setTheirs((f.decks[1] ?? f.decks[0]).key);
    } catch (e) {
      fail(e instanceof SyntaxError ? new LocalBoardError("pack", "That file is not an offline deck pack.") : e);
    }
  }

  async function begin(what: string, open: () => Promise<LocalBoard>) {
    setProblem(null);
    setPhase({ kind: "opening", what });
    try { show(await open()); } catch (e) { fail(e); }
  }

  const start = () => facts && begin("Dealing…", () => LocalBoard.start(facts.pack, { decks: seat === "p1" ? { p1: mine, p2: theirs } : { p1: theirs, p2: mine }, human: seat }, deps));
  const resume = () => facts && pointer && begin("Opening your saved match…", () => LocalBoard.resume(facts.pack, pointer, deps));
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

  const busy = phase.kind === "opening";
  const sameDeck = facts && pointer && facts.hash === pointer.packHash;
  return (
    <Shell>
      <div className="space-y-4">
        <p className="text-sm text-space-300">
          The match runs in this browser and is saved on this device after every move. Nothing is sent to a server, and no account or connection is needed once the pack is here.
        </p>

        <section aria-label="Deck pack" className={`${panel} space-y-2`}>
          <h2 className="text-xs uppercase tracking-widest text-space-400">Deck pack</h2>
          <label className="block text-sm text-space-200">
            <span className="mb-1 block">Choose the pack file</span>
            <input type="file" accept="application/json,.json" disabled={busy} onChange={(e) => void choose(e.target.files?.[0])} className="tap block w-full text-sm text-space-200 file:mr-3 file:rounded-lg file:border file:border-space-600 file:bg-space-900 file:px-3 file:py-2 file:text-space-100" />
          </label>
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
            {facts && !sameDeck && <p className="text-xs text-dbs-yellow">It was started from pack <span className="font-mono">{pointer.packId}</span>; choose that file to continue it.</p>}
            {!facts && <p className="text-xs text-space-400">Choose the pack file <span className="font-mono">{pointer.packId}</span> to continue it.</p>}
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
          <ArenaStage key={board.matchId} session={board} snapshot={snapshot} skin={stage.skin} staging={stage.staging} lighting={stage.lighting} menu={menu} />
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
