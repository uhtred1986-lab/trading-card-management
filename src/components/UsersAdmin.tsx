"use client";

import { useState, useTransition } from "react";
import { createUserAction, deleteUserAction, setActiveAction, setOwnerAction, setPasswordAction, type UserResult } from "@/app/settings/users/actions";

interface Row {
  id: number;
  username: string;
  owner: string;
  isActive: boolean;
  createdAt: string;
}

/** Add logins, change their password, and point each at the owner it records. */
export function UsersAdmin({ users, knownOwners }: { users: Row[]; knownOwners: string[] }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<UserResult | null>(null);
  const [newUser, setNewUser] = useState({ username: "", password: "", owner: "" });
  const [passwordFor, setPasswordFor] = useState<number | null>(null);
  const [password, setPassword] = useState("");

  const run = (fn: () => Promise<UserResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setNote(r);
      if (r.ok) after?.();
    });

  const input = "tap rounded-md border border-space-600 bg-space-900 px-2 py-1.5 text-sm text-space-100";

  return (
    <div className="space-y-4">
      {note ? (
        <p className={`rounded-xl border p-2 text-sm ${note.ok ? "border-gain/40 bg-gain/5 text-gain" : "border-loss/40 bg-loss/5 text-loss"}`}>
          {note.ok ? note.message : note.error}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-space-700/70">
        <table className="w-full text-sm">
          <thead className="bg-space-900 text-left text-xs uppercase tracking-wide text-space-300">
            <tr>
              <th className="px-3 py-2">Login</th>
              <th className="px-3 py-2">Records cards as</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-center text-space-300">
                  No logins yet — the environment login is the only way in. Add one below.
                </td>
              </tr>
            ) : null}
            {users.map((u) => (
              <tr key={u.id} className="border-t border-space-800 align-middle">
                <td className="px-3 py-2 font-medium text-space-50">{u.username}</td>
                <td className="px-3 py-2">
                  <input
                    defaultValue={u.owner}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== u.owner) run(() => setOwnerAction(u.id, v));
                    }}
                    list="known-owners"
                    className={`${input} w-40`}
                    aria-label={`Owner for ${u.username}`}
                  />
                </td>
                <td className="px-3 py-2">
                  <span className={u.isActive ? "text-gain" : "text-space-400"}>{u.isActive ? "active" : "disabled"}</span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap justify-end gap-1">
                    <button onClick={() => setPasswordFor(passwordFor === u.id ? null : u.id)} disabled={pending} className="tap rounded-md border border-space-600 px-2 py-1 text-xs text-space-100 hover:bg-space-800">
                      Password
                    </button>
                    <button onClick={() => run(() => setActiveAction(u.id, !u.isActive))} disabled={pending} className="tap rounded-md border border-space-600 px-2 py-1 text-xs text-space-200 hover:bg-space-800">
                      {u.isActive ? "Disable" : "Enable"}
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`Delete the login ${u.username}? Cards they added keep their owner name.`)) run(() => deleteUserAction(u.id));
                      }}
                      disabled={pending}
                      className="tap rounded-md border border-space-600 px-2 py-1 text-xs text-space-300 hover:bg-space-800 hover:text-loss"
                    >
                      Delete
                    </button>
                  </div>
                  {passwordFor === u.id ? (
                    <div className="mt-1 flex justify-end gap-1">
                      <input
                        autoFocus
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter")
                            run(
                              () => setPasswordAction(u.id, password),
                              () => {
                                setPassword("");
                                setPasswordFor(null);
                              },
                            );
                        }}
                        placeholder="new password"
                        className={`${input} w-40`}
                      />
                      <button
                        onClick={() =>
                          run(
                            () => setPasswordAction(u.id, password),
                            () => {
                              setPassword("");
                              setPasswordFor(null);
                            },
                          )
                        }
                        disabled={pending}
                        className="tap rounded-md bg-ki-500 px-2 py-1 text-xs font-semibold text-space-950 hover:bg-ki-400"
                      >
                        Save
                      </button>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <datalist id="known-owners">
        {[...new Set([...knownOwners, ...users.map((u) => u.owner)])].map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>

      <div className="rounded-xl border border-space-700/70 bg-space-900/50 p-3">
        <h2 className="mb-2 text-sm font-semibold text-space-50">Add a login</h2>
        <div className="grid gap-2 sm:grid-cols-4">
          <input value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} placeholder="username" className={input} autoComplete="off" />
          <input
            type="password"
            value={newUser.password}
            onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
            placeholder="password (8+ characters)"
            className={input}
            autoComplete="new-password"
          />
          <input
            value={newUser.owner}
            onChange={(e) => setNewUser({ ...newUser, owner: e.target.value })}
            placeholder="records cards as… (defaults to username)"
            list="known-owners"
            className={input}
          />
          <button
            onClick={() =>
              run(
                () => createUserAction(newUser.username, newUser.password, newUser.owner),
                () => setNewUser({ username: "", password: "", owner: "" }),
              )
            }
            disabled={pending || !newUser.username.trim() || !newUser.password}
            className="tap rounded-md bg-ki-500 px-3 py-1.5 text-sm font-semibold text-space-950 hover:bg-ki-400 disabled:opacity-50"
          >
            {pending ? "…" : "Add login"}
          </button>
        </div>
        <p className="mt-2 text-xs text-space-400">
          The browser will ask for these credentials on the next visit. Passwords are stored as a salted scrypt hash and can only be replaced, never read back.
        </p>
      </div>
    </div>
  );
}
