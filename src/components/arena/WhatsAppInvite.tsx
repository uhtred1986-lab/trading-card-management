"use client";

import { useState, useTransition } from "react";
import { inviteFriendAction } from "@/app/arena/invite-actions";

/**
 * Host's "Invite a friend": name once, then the phone's share sheet (WhatsApp
 * is one tap in it). Where there is no share sheet, a wa.me link and Copy.
 * The link carries a one-time sign-in code for a new friend, so it is only ever
 * built on the server, when the host taps.
 */
export function WhatsAppInvite({ matchId }: { matchId: number }) {
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [sent, setSent] = useState<{ message: string; url: string } | null>(null);

  const share = (message: string, url: string) => {
    if (typeof navigator.share === "function") {
      navigator.share({ text: message }).catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setNote("Could not open the share sheet. Use the buttons below.");
      });
    }
    setSent({ message, url });
  };

  const create = () => {
    setNote(null);
    start(async () => {
      const result = await inviteFriendAction(matchId, name);
      if (!result.ok) {
        setNote(result.error);
        setSent(null);
        return;
      }
      share(result.message, result.url);
    });
  };

  const copy = async () => {
    if (!sent) return;
    try {
      await navigator.clipboard.writeText(sent.message);
      setNote("Message copied");
    } catch {
      setNote("Copy it from the box");
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-space-700/70 bg-space-900/50 p-3 text-left" data-whatsapp-invite>
      <p className="text-sm font-semibold text-space-50">Invite a friend</p>
      <p className="text-xs text-space-300">They get a one-tap sign-in, no password, and land on this match.</p>
      <label className="block text-xs text-space-300">
        Friend&apos;s name
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="off" className="tap mt-1 w-full rounded-md border border-space-600 bg-space-900 px-2 py-2 text-sm text-space-50" />
      </label>
      <button type="button" disabled={pending || name.trim().length === 0} onClick={create} className="tap w-full rounded-lg bg-ki-500 px-4 py-2.5 text-sm font-semibold text-space-950 disabled:opacity-40" data-whatsapp-create>
        {pending ? "Making the link…" : "Send invite"}
      </button>
      {sent ? (
        <div className="space-y-2" data-whatsapp-fallback>
          <textarea readOnly value={sent.message} rows={3} onFocus={(e) => e.currentTarget.select()} aria-label="Invite message" className="w-full rounded-md border border-space-600 bg-space-900 px-2 py-2 text-xs text-space-200" />
          <div className="flex gap-2">
            <a href={`https://wa.me/?text=${encodeURIComponent(sent.message)}`} target="_blank" rel="noreferrer" className="tap flex-1 rounded-lg border border-space-600 px-3 py-2 text-center text-sm font-semibold text-space-50" data-whatsapp-link>
              Open WhatsApp
            </a>
            <button type="button" onClick={() => void copy()} className="tap flex-1 rounded-lg border border-space-600 px-3 py-2 text-sm font-semibold text-space-50">
              Copy
            </button>
          </div>
        </div>
      ) : null}
      <p className="min-h-4 text-xs text-ki-300" role="status">
        {note}
      </p>
    </div>
  );
}
