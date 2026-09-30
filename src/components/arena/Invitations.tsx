import { SubmitButton } from "@/components/SubmitButton";
import { cancelMatchAction, joinMatchForm } from "@/app/arena/actions";

export interface InvitationMatch {
  id: number;
  hostUser: string;
  hostDeckName: string | null;
}
export interface InvitationDeck {
  id: number;
  label: string;
  locked: boolean;
}

/**
 * Open 1 v 1 invitations as Continue-style strips (ah-05). Someone else's:
 * "Sam wants to play — Join", the deck select opening on tap. Your own:
 * "Waiting — call it off". `id="friend"` keeps the header's "Play a friend" door.
 */
export function Invitations({ matches, me, decks, defaultDeck }: { matches: InvitationMatch[]; me: string | null; decks: InvitationDeck[]; defaultDeck: number }) {
  const select = "tap w-full rounded-md border border-space-600 bg-space-900 px-2 py-2 text-sm text-space-100";
  return (
    <ul id="friend" className="space-y-2">
      {matches.map((m) => {
        const mine = m.hostUser === me;
        return (
          <li key={m.id} className="rounded-xl border border-ki-500/50 bg-ki-500/10 px-4 py-2">
            {mine ? (
              <form action={cancelMatchAction.bind(null, m.id)} className="flex min-h-12 items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-space-50">Waiting for someone to join</span>
                  <span className="block truncate text-xs text-space-300">with {m.hostDeckName ?? "a deck that is gone"}</span>
                </span>
                <SubmitButton pendingLabel="Calling it off…" className="tap rounded-lg border border-space-600 px-3 text-sm text-space-200 hover:text-loss">
                  Call it off
                </SubmitButton>
              </form>
            ) : (
              <details>
                <summary className="tap flex min-h-12 cursor-pointer list-none items-center gap-3 marker:hidden [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-space-50">{m.hostUser} wants to play</span>
                    <span className="block truncate text-xs text-space-300">with {m.hostDeckName ?? "a deck that is gone"}</span>
                  </span>
                  <span className="flex min-w-24 items-center justify-center rounded-lg bg-ki-500 px-4 py-2.5 text-sm font-semibold text-space-950">Join</span>
                </summary>
                <form action={joinMatchForm} className="mt-2 flex flex-wrap items-end gap-2 pb-1">
                  <input type="hidden" name="match" value={m.id} />
                  <label className="min-w-0 flex-1 text-sm">
                    <span className="mb-1 block text-xs uppercase tracking-wider text-space-400">Your deck</span>
                    <select name="deck" className={select} defaultValue={defaultDeck}>
                      {decks.map((d) => (
                        <option key={d.id} value={d.id} disabled={d.locked}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <SubmitButton pendingLabel="Flipping…" className="tap rounded-lg bg-ki-500 px-4 py-2.5 text-sm font-semibold text-space-950">
                    Join
                  </SubmitButton>
                </form>
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}
