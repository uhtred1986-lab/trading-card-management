"use client";

import { useState, useTransition } from "react";
import { renderSVG } from "uqr";
import {
  addSlAction,
  cancelJoinCodeAction,
  createPlayerAction,
  deletePlayerAction,
  disconnectDeviceAction,
  giveToPlayerAction,
  newJoinCodeAction,
  removeSlAction,
  setSlOwnerAction,
  updatePlayerAction,
  type AccessResult,
} from "@/app/settings/access/actions";

interface Device {
  id: number;
  label: string;
  createdAt: string;
  lastSeenAt: string | null;
}
interface PlayerRow {
  id: number;
  name: string;
  owner: string;
  createdAt: string;
  lots: number;
  decks: number;
  devices: Device[];
  openCodeExpiresAt: string | null;
}
interface SlRow {
  email: string;
  owner: string;
  isOwner: boolean;
  addedBy: string | null;
  createdAt: string | null;
}
interface Unassigned {
  owner: string | null;
  lots: number;
  decks: number;
}
interface FreshCode {
  playerId: number;
  code: string;
  url: string;
  expiresAt: string;
}

const ONLINE_MS = 10 * 60 * 1000;
const input = "tap rounded-md border border-space-600 bg-space-900 px-2 py-1.5 text-sm text-space-100";
const button = "tap rounded-md border border-space-600 px-3 py-1 text-xs text-space-100 hover:bg-space-800 disabled:opacity-50";
const primary = "tap rounded-md bg-ki-500 px-3 py-1 text-xs font-semibold text-space-950 hover:bg-ki-400 disabled:opacity-50";

function when(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("de-AT", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Vienna" });
}

/**
 * Settings → Users & access, the interactive half. Players (name, owner name,
 * join code with QR and share link, devices), SLs, and unassigned cards. The
 * plain join code lives only in this component's state: after a reload the
 * row says a code is open, without the letters, and a new one can be made.
 */
export function AccessAdmin({ isOwner, myEmail, players, sls, unassigned }: { isOwner: boolean; myEmail: string | null; players: PlayerRow[]; sls: SlRow[]; unassigned: Unassigned[] }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<AccessResult | null>(null);
  const [fresh, setFresh] = useState<FreshCode | null>(null);
  const [newPlayer, setNewPlayer] = useState({ name: "", owner: "" });
  const [newSl, setNewSl] = useState({ email: "", owner: "" });
  const [editing, setEditing] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const run = (fn: () => Promise<AccessResult>, after?: () => void) =>
    start(async () => {
      try {
        const r = await fn();
        setNote(r);
        if (r.ok) after?.();
      } catch (e) {
        setNote({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    });

  const makeCode = (playerId: number) =>
    start(async () => {
      const r = await newJoinCodeAction(playerId);
      if (r.ok) {
        setFresh({ playerId, code: r.code, url: r.url, expiresAt: r.expiresAt });
        setCopied(false);
        setNote(null);
      } else setNote(r);
    });

  const share = async (c: FreshCode, name: string) => {
    const text = `Join DBS Card Companion as ${name}: open the link (valid 24 h, one use) or type the code ${c.code}.`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "DBS Card Companion", text, url: c.url });
        return;
      } catch {
        // Cancelled or refused: fall back to copying.
      }
    }
    await navigator.clipboard?.writeText(`${text}\n${c.url}`);
    setCopied(true);
  };

  return (
    <div className="space-y-5">
      {note ? (
        <p role="status" className={`rounded-xl border p-2 text-sm ${note.ok ? "border-gain/40 bg-gain/5 text-gain" : "border-loss/40 bg-loss/5 text-loss"}`}>
          {note.ok ? note.message : note.error}
        </p>
      ) : null}

      {/* ── Players ── */}
      <section className="space-y-3 rounded-xl border border-space-700/70 bg-space-900/50 p-3">
        <h2 className="font-semibold text-space-50">Players</h2>
        {players.length === 0 ? <p className="text-sm text-space-300">No players yet. Add one below, then make a code for their phone.</p> : null}
        <ul className="space-y-3">
          {players.map((p) => {
            const code = fresh?.playerId === p.id ? fresh : null;
            const isEditing = editing === p.id;
            return (
              <li key={p.id} className="rounded-lg border border-space-700/60 bg-space-950/30 p-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  {isEditing ? (
                    <form
                      className="flex w-full flex-wrap gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        run(() => updatePlayerAction(p.id, String(f.get("name")), String(f.get("owner"))), () => setEditing(null));
                      }}
                    >
                      <input name="name" defaultValue={p.name} aria-label="Name" className={`${input} min-w-0 flex-1`} />
                      <input name="owner" defaultValue={p.owner} aria-label="Owner name" className={`${input} min-w-0 flex-1`} />
                      <button type="submit" disabled={pending} className={primary}>
                        Save
                      </button>
                      <button type="button" onClick={() => setEditing(null)} className={button}>
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <>
                      <span className="font-medium text-space-50">{p.name}</span>
                      <span className="text-xs text-space-400">
                        cards as <span className="text-space-200">{p.owner}</span> · {p.lots} cards · {p.decks} decks
                      </span>
                      <button type="button" onClick={() => setEditing(p.id)} className={`${button} ml-auto`}>
                        Edit
                      </button>
                    </>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button type="button" disabled={pending} onClick={() => makeCode(p.id)} className={primary}>
                    {p.openCodeExpiresAt || code ? "New code" : "Make join code"}
                  </button>
                  {p.openCodeExpiresAt && !code ? (
                    <>
                      <span className="text-xs text-space-400">code open until {when(p.openCodeExpiresAt)}</span>
                      <button type="button" disabled={pending} onClick={() => run(() => cancelJoinCodeAction(p.id))} className={button}>
                        Cancel code
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      if (confirm(`Remove ${p.name}? Their devices are signed out; their cards and decks stay.`)) run(() => deletePlayerAction(p.id));
                    }}
                    className={`${button} ml-auto`}
                  >
                    Remove
                  </button>
                </div>

                {code ? (
                  <div className="mt-3 flex flex-col items-center gap-2 rounded-lg bg-white p-3 text-center text-space-950 sm:flex-row sm:text-left">
                    <div className="h-40 w-40 shrink-0" aria-label={`QR code for ${code.url}`} dangerouslySetInnerHTML={{ __html: renderSVG(code.url, { border: 1 }) }} />
                    <div className="space-y-2">
                      <p className="font-mono text-3xl font-bold tracking-[0.3em]">{code.code}</p>
                      <p className="text-xs">One use, valid until {when(code.expiresAt)}. Scan the QR, open the link, or type the code at /join.</p>
                      <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
                        <button type="button" onClick={() => share(code, p.name)} className="tap rounded-md bg-space-950 px-3 py-1.5 text-xs font-semibold text-white">
                          Send invite
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await navigator.clipboard?.writeText(code.url);
                            setCopied(true);
                          }}
                          className="tap rounded-md border border-space-950 px-3 py-1.5 text-xs"
                        >
                          {copied ? "Copied" : "Copy link"}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {p.devices.length > 0 ? (
                  <ul className="mt-2 divide-y divide-space-800">
                    {p.devices.map((d) => {
                      const online = d.lastSeenAt !== null && Date.now() - new Date(d.lastSeenAt).getTime() < ONLINE_MS;
                      return (
                        <li key={d.id} className="flex flex-wrap items-center gap-2 py-1.5 text-xs">
                          <span className={`h-2 w-2 rounded-full ${online ? "bg-gain" : "bg-space-600"}`} aria-label={online ? "online" : "offline"} />
                          <span className="text-space-100">{d.label}</span>
                          <span className="text-space-400">
                            joined {when(d.createdAt)} · seen {when(d.lastSeenAt)}
                          </span>
                          <button type="button" disabled={pending} onClick={() => run(() => disconnectDeviceAction(d.id))} className={`${button} ml-auto`}>
                            Disconnect
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-space-400">No device joined yet.</p>
                )}
              </li>
            );
          })}
        </ul>

        <form
          className="flex flex-wrap gap-2 border-t border-space-800 pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => createPlayerAction(newPlayer.name, newPlayer.owner), () => setNewPlayer({ name: "", owner: "" }));
          }}
        >
          <input value={newPlayer.name} onChange={(e) => setNewPlayer({ ...newPlayer, name: e.target.value })} placeholder="Player name" aria-label="Player name" className={`${input} min-w-0 flex-1`} />
          <input
            value={newPlayer.owner}
            onChange={(e) => setNewPlayer({ ...newPlayer, owner: e.target.value })}
            placeholder="Owner name (default: the name)"
            aria-label="Owner name"
            className={`${input} min-w-0 flex-1`}
          />
          <button type="submit" disabled={pending || !newPlayer.name.trim()} className={primary}>
            Add player
          </button>
        </form>
      </section>

      {/* ── Unassigned ── */}
      {unassigned.length > 0 ? (
        <section className="space-y-2 rounded-xl border border-space-700/70 bg-space-900/50 p-3">
          <h2 className="font-semibold text-space-50">Unassigned cards</h2>
          <p className="text-xs text-space-300">Cards and decks under an owner name no player or SL uses. Only SLs see them until you give them to a player.</p>
          <ul className="divide-y divide-space-800">
            {unassigned.map((u) => (
              <li key={u.owner ?? "(none)"} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="text-space-100">{u.owner ?? "(no owner)"}</span>
                <span className="text-xs text-space-400">
                  {u.lots} cards · {u.decks} decks
                </span>
                {players.length > 0 ? (
                  <select
                    defaultValue=""
                    disabled={pending}
                    aria-label={`Give ${u.owner ?? "unowned cards"} to a player`}
                    onChange={(e) => {
                      const id = Number(e.target.value);
                      const p = players.find((x) => x.id === id);
                      if (p && confirm(`Give ${u.lots} cards and ${u.decks} decks to ${p.name}?`)) run(() => giveToPlayerAction(u.owner, id));
                      e.target.value = "";
                    }}
                    className={`${input} ml-auto text-xs`}
                  >
                    <option value="">Give to player…</option>
                    {players.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ── SLs ── */}
      <section className="space-y-2 rounded-xl border border-space-700/70 bg-space-900/50 p-3">
        <h2 className="font-semibold text-space-50">SLs</h2>
        <p className="text-xs text-space-300">
          SLs sign in with Google and can do everything, including this page. Owners come from Vercel (SL_EMAILS) and can&apos;t be removed here. Changing an owner name doesn&apos;t
          move existing cards — give them over from Unassigned.
        </p>
        <ul className="divide-y divide-space-800">
          {sls.map((s) => (
            <li key={s.email} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="min-w-0 break-all text-space-100">{s.email}</span>
              {s.isOwner ? <span className="rounded bg-ki-500/20 px-1.5 text-[11px] text-ki-300">owner</span> : null}
              {isOwner || s.email === myEmail ? (
                <input
                  defaultValue={s.owner}
                  aria-label={`Owner name for ${s.email}`}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== s.owner) run(() => setSlOwnerAction(s.email, v));
                  }}
                  className={`${input} w-36 text-xs`}
                />
              ) : (
                <span className="text-xs text-space-400">cards as {s.owner}</span>
              )}
              {isOwner && !s.isOwner ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (confirm(`Remove ${s.email} as SL? They are signed out at once.`)) run(() => removeSlAction(s.email));
                  }}
                  className={`${button} ml-auto`}
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {isOwner ? (
          <form
            className="flex flex-wrap gap-2 border-t border-space-800 pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => addSlAction(newSl.email, newSl.owner), () => setNewSl({ email: "", owner: "" }));
            }}
          >
            <input
              type="email"
              value={newSl.email}
              onChange={(e) => setNewSl({ ...newSl, email: e.target.value })}
              placeholder="Google address"
              aria-label="Google address"
              className={`${input} min-w-0 flex-1`}
            />
            <input value={newSl.owner} onChange={(e) => setNewSl({ ...newSl, owner: e.target.value })} placeholder="Owner name" aria-label="SL owner name" className={`${input} min-w-0 flex-1`} />
            <button type="submit" disabled={pending || !newSl.email.trim() || !newSl.owner.trim()} className={primary}>
              Add SL
            </button>
          </form>
        ) : null}
      </section>
    </div>
  );
}
