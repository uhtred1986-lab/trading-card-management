"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { resolveSpokenAction, type SpokenCard, type SpokenResult } from "@/app/add/bulk/actions";
import { cue } from "@/lib/scan/cue";
import { speak, speechSupported, startListening, type SpeechSession } from "@/lib/scan/speech";

interface LogEntry {
  key: number;
  ok: boolean;
  heard: string;
  detail: string;
}

let logKey = 1;

/**
 * Hands-free bulk entry: say a card number and how many copies, get a chime
 * and a row. Recognition runs in the browser (no audio leaves the device);
 * only the transcript is sent, and the catalog decides which reading of the
 * digits is a real card.
 */
export function VoiceEntry({ onCard }: { onCard: (card: SpokenCard, prints: { id: string; label: string }[], counts: { foil: number; normal: number }) => void }) {
  // Whether the API exists is a client-only fact; useSyncExternalStore reads it
  // after hydration without the server and client disagreeing about the markup.
  const supported = useSyncExternalStore(
    () => () => {},
    () => speechSupported(),
    () => true,
  );
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [readBack, setReadBack] = useState(false);
  const [lang, setLang] = useState("en-US");
  const session = useRef<SpeechSession | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  /** Read by a recogniser callback that outlives the render it started in. */
  const readBackRef = useRef(false);

  useEffect(() => () => session.current?.stop(), []);

  const handle = (alternatives: string[]) => {
    // Utterances can arrive faster than the lookup; keep them in order.
    queue.current = queue.current.then(async () => {
      let result: SpokenResult;
      try {
        result = await resolveSpokenAction(alternatives);
      } catch (err) {
        result = { ok: false, heard: alternatives[0] ?? "", reason: err instanceof Error ? err.message : "Lookup failed." };
      }
      if (result.ok) {
        cue("ok");
        onCard(result.card, result.prints, { foil: result.foil, normal: result.normal });
        const parts = [result.normal ? `${result.normal} non-foil` : "", result.foil ? `${result.foil} ✦ foil` : ""].filter(Boolean).join(" + ");
        if (readBackRef.current) speak(`${parts.replace("✦ ", "")} ${result.card.name}`);
        setLog((l) => [{ key: logKey++, ok: true, heard: result.heard, detail: `${parts} · ${result.card.name} (${result.card.id})` }, ...l].slice(0, 6));
      } else {
        cue("fail");
        setLog((l) => [{ key: logKey++, ok: false, heard: result.heard, detail: result.reason }, ...l].slice(0, 6));
      }
    });
  };

  const stop = () => {
    session.current?.stop();
    session.current = null;
    setListening(false);
    setInterim("");
    cue("stop");
  };

  const start = () => {
    setError(null);
    readBackRef.current = readBack;
    const s = startListening(
      {
        onFinal: handle,
        onInterim: setInterim,
        onError: (e) => {
          setError(e === "not-allowed" || e === "service-not-allowed" ? "Microphone permission was refused — allow it in the browser and try again." : `Speech recognition error: ${e}`);
          session.current = null;
          setListening(false);
          setInterim("");
        },
        onStop: () => {
          session.current = null;
          setListening(false);
          setInterim("");
        },
      },
      lang,
    );
    if (!s) {
      setError("Could not start speech recognition.");
      return;
    }
    session.current = s;
    setListening(true);
    cue("start");
  };

  if (!supported) {
    return (
      <p className="rounded-xl border border-space-700/70 bg-space-900/40 p-2 text-xs text-space-400">
        Voice entry needs the Web Speech API — available in Chrome, Edge and Safari. This browser doesn&apos;t offer it, so type the rows instead.
      </p>
    );
  }

  return (
    <div className={`rounded-xl border p-3 transition-colors ${listening ? "border-ki-500/60 bg-ki-500/5" : "border-space-700/70 bg-space-900/50"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={listening ? stop : start}
          className={`tap rounded-md px-4 py-2 text-sm font-semibold ${listening ? "bg-loss text-white hover:bg-loss/80" : "bg-ki-500 text-space-950 hover:bg-ki-400"}`}
        >
          {listening ? "■ Stop listening" : "🎤 Voice entry"}
        </button>
        {listening ? (
          <span className="flex items-center gap-1.5 text-sm text-ki-300">
            <span className="h-2 w-2 animate-pulse rounded-full bg-ki-400" aria-hidden />
            Listening…
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-sm italic text-space-300">{interim}</span>
        <label className="flex items-center gap-1.5 text-xs text-space-300">
          <input
            type="checkbox"
            checked={readBack}
            onChange={(e) => {
              setReadBack(e.target.checked);
              readBackRef.current = e.target.checked;
            }}
            className="h-4 w-4"
          />
          Read back
        </label>
        <select
          value={lang}
          onChange={(e) => setLang(e.target.value)}
          disabled={listening}
          className="tap rounded-md border border-space-600 bg-space-900 px-2 py-1 text-xs text-space-100 disabled:opacity-50"
          aria-label="Recognition language"
        >
          <option value="en-US">English</option>
          <option value="de-DE">Deutsch</option>
        </select>
      </div>

      <p className="mt-1 text-xs text-space-400">
        Say the card number, then how many — and which finish if you like:{" "}
        <span className="text-space-200">&ldquo;BT eighteen zero twenty, one card foiled, three cards non-foil&rdquo;</span>. Plain counts (&ldquo;times four&rdquo;) are stored non-foil. A rising chime means it landed in the table; a low buzz means it didn&apos;t. Card names work too.
      </p>
      {error ? <p className="mt-1 text-xs text-loss">{error}</p> : null}

      {log.length ? (
        <ul className="mt-2 space-y-1 text-xs">
          {log.map((l) => (
            <li key={l.key} className={`flex flex-wrap items-baseline gap-2 rounded px-2 py-1 ${l.ok ? "bg-gain/10" : "bg-loss/10"}`}>
              <span className={l.ok ? "text-gain" : "text-loss"}>{l.ok ? "✓" : "✕"}</span>
              <span className={l.ok ? "font-medium text-space-100" : "text-space-300"}>{l.detail}</span>
              <span className="ml-auto italic text-space-500">heard &ldquo;{l.heard}&rdquo;</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
