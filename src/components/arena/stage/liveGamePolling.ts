import type { Snapshot } from "@/lib/arena/snapshot";

export type LiveConnection = "connected" | "offline" | "reconnecting" | "paused";

type EventSource = {
  online: boolean;
  visible: boolean;
  addEventListener(type: "online" | "offline" | "visibilitychange", listener: () => void): void;
  removeEventListener(type: "online" | "offline" | "visibilitychange", listener: () => void): void;
};

type PollOptions = {
  gameId: number;
  revision: number;
  beat: number;
  onSnapshot(snapshot: Snapshot): void;
  onConnection(connection: LiveConnection): void;
  source?: EventSource;
  fetcher?: typeof fetch;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
  requestTimeoutMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

/** Lifecycle-aware long polling, kept independent of React for deterministic recovery tests. */
export function startLiveGamePolling(options: PollOptions): { retry(): void; stop(): void } {
  const source = options.source ?? {
    get online() { return navigator.onLine; },
    get visible() { return document.visibilityState === "visible"; },
    addEventListener: (type: "online" | "offline" | "visibilitychange", listener: () => void) => {
      if (type === "visibilitychange") document.addEventListener(type, listener);
      else window.addEventListener(type, listener);
    },
    removeEventListener: (type: "online" | "offline" | "visibilitychange", listener: () => void) => {
      if (type === "visibilitychange") document.removeEventListener(type, listener);
      else window.removeEventListener(type, listener);
    },
  };
  const fetcher = options.fetcher ?? fetch;
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  const requestTimeoutMs = options.requestTimeoutMs ?? 25_000;
  const baseDelay = options.baseDelayMs ?? 500;
  const maxDelay = options.maxDelayMs ?? 8_000;
  let revision = options.revision;
  let beat = options.beat;
  let failures = 0;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let requestDeadline: ReturnType<typeof setTimeout> | null = null;
  let request: AbortController | null = null;
  let stopped = false;
  let finished = false;

  const clearScheduled = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const clearRequestDeadline = () => {
    if (requestDeadline !== null) clearTimer(requestDeadline);
    requestDeadline = null;
  };
  const cancelRequest = () => {
    generation++;
    clearRequestDeadline();
    request?.abort();
    request = null;
  };
  const connectionForEnvironment = () => {
    if (!source.online) return "offline" as const;
    if (!source.visible) return "paused" as const;
    return null;
  };
  const schedule = (delay: number) => {
    if (stopped || finished) return;
    clearScheduled();
    timer = setTimer(() => {
      timer = null;
      void poll();
    }, delay);
  };
  const wake = () => {
    if (stopped || finished) return;
    clearScheduled();
    cancelRequest();
    const environment = connectionForEnvironment();
    if (environment) {
      options.onConnection(environment);
      return;
    }
    options.onConnection("reconnecting");
    void poll();
  };
  const poll = async () => {
    if (stopped || finished) return;
    const environment = connectionForEnvironment();
    if (environment) {
      options.onConnection(environment);
      return;
    }
    const controller = new AbortController();
    request = controller;
    const ownGeneration = ++generation;
    let deadlineExpired = false;
    let localDeadline: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_resolve, reject) => {
      localDeadline = setTimer(() => {
        localDeadline = null;
        requestDeadline = null;
        deadlineExpired = true;
        controller.abort();
        reject(new Error("Arena refresh timed out"));
      }, requestTimeoutMs);
      requestDeadline = localDeadline;
    });
    const aborted = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener("abort", () => reject(new Error("Arena refresh aborted")), { once: true });
    });
    try {
      const next = await Promise.race([
        (async () => {
          const response = await fetcher(`/api/v1/games/${options.gameId}?sinceRevision=${revision}&sinceBeat=${beat}&wait=15`, {
            cache: "no-store",
            headers: { Prefer: "return=minimal" },
            signal: controller.signal,
          });
          if (response.status === 204) return null;
          if (!response.ok) throw new Error(`Arena refresh returned ${response.status}`);
          return (await response.json()) as Snapshot;
        })(),
        timeout,
        aborted,
      ]);
      if (stopped || ownGeneration !== generation) return;
      if (next === null) {
        // The server confirmed the same revision after its long-poll window.
        // Keep both cursors and the last personalized snapshot untouched.
        failures = 0;
        options.onConnection("connected");
        schedule(0);
        return;
      }
      if (!next || next.game?.id !== options.gameId || !Number.isSafeInteger(next.game.revision) || typeof next.game.status !== "string") {
        throw new Error("Arena refresh returned an invalid snapshot");
      }
      const seq = next.beats?.seq ?? 0;
      if (!Number.isSafeInteger(seq) || seq < 0) throw new Error("Arena refresh returned an invalid beat sequence");
      failures = 0;
      options.onConnection("connected");
      if (next.game.revision < revision) {
        // A lagging read must not replace the current row or end its poll loop.
        schedule(baseDelay);
        return;
      }
      revision = Math.max(revision, next.game.revision);
      beat = Math.max(beat, seq);
      options.onSnapshot(next);
      if (next.game.status !== "playing" || (next.game.mode !== "versus" && next.waiting !== "opponent" && next.waiting !== "referee")) {
        finished = true;
        return;
      }
      schedule(0);
    } catch {
      if (stopped || ownGeneration !== generation || (controller.signal.aborted && !deadlineExpired)) return;
      failures++;
      options.onConnection(connectionForEnvironment() ?? "reconnecting");
      schedule(Math.min(maxDelay, baseDelay * 2 ** Math.min(failures - 1, 30)));
    } finally {
      if (localDeadline !== null) clearTimer(localDeadline);
      if (requestDeadline === localDeadline) requestDeadline = null;
      if (request === controller) request = null;
    }
  };
  const onOnline = () => wake();
  const onOffline = () => {
    if (stopped || finished) return;
    clearScheduled();
    cancelRequest();
    options.onConnection("offline");
  };
  const onVisibility = () => {
    if (source.visible) wake();
    else {
      clearScheduled();
      cancelRequest();
      if (!stopped && !finished && source.online) options.onConnection("paused");
    }
  };
  source.addEventListener("online", onOnline);
  source.addEventListener("offline", onOffline);
  source.addEventListener("visibilitychange", onVisibility);
  wake();

  return {
    retry: wake,
    stop() {
      if (stopped) return;
      stopped = true;
      clearScheduled();
      cancelRequest();
      source.removeEventListener("online", onOnline);
      source.removeEventListener("offline", onOffline);
      source.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
