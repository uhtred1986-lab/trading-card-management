import { headers } from "next/headers";
import { JOIN_REDEEM_PATH } from "@/lib/auth/core";
import { isWellFormedCode, normaliseCode } from "@/lib/auth/join-code";
import { joinAttemptAllowed } from "@/lib/auth/join-flow";
import { StandaloneField } from "./StandaloneField";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  bad: "That code doesn't work. It may be mistyped, already used or older than 24 hours — ask your SL for a new one.",
  limited: "Too many tries. Wait a minute and try again.",
};

/**
 * Where a player joins with the code their SL gave them (`/join?c=CODE` is the
 * QR and the invite link). Public to the proxy: it shows nothing but the name
 * the code would join as, and only after the rate limit. Nothing is created
 * until "Yes, that's me" posts to `/api/join`.
 */
export default async function JoinPage({ searchParams }: { searchParams: Promise<{ c?: string; error?: string }> }) {
  const { c, error } = await searchParams;
  const code = c ? normaliseCode(c) : "";
  let message = error ? (ERRORS[error] ?? ERRORS.bad) : null;
  let joiningAs: string | null = null;

  if (code) {
    if (!isWellFormedCode(code)) message = ERRORS.bad;
    else if (!(await joinAttemptAllowed(await headers(), new Date()))) message = ERRORS.limited;
    else {
      const { db } = await import("@/db");
      const { previewJoinCode } = await import("@/lib/auth/access");
      joiningAs = (await previewJoinCode(db, code, new Date()))?.name ?? null;
      if (!joiningAs) message = ERRORS.bad;
    }
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-5 py-10">
      <div>
        <h1 className="text-2xl font-semibold text-space-50">
          <span className="text-ki-400">DBS</span> Card Companion
        </h1>
        <p className="mt-1 text-sm text-space-300">Join with the code your SL gave you. This phone stays signed in.</p>
      </div>

      {message ? (
        <p role="alert" className="rounded-lg bg-dbs-red p-3 text-sm font-medium text-white">
          {message}
        </p>
      ) : null}

      {joiningAs ? (
        <form method="post" action={JOIN_REDEEM_PATH} className="flex flex-col gap-3 rounded-lg border border-space-700/70 bg-space-900/40 p-4">
          <p className="text-sm text-space-300">You are joining as</p>
          <p className="text-xl font-semibold text-space-50">{joiningAs}</p>
          <input type="hidden" name="code" value={code} />
          <StandaloneField />
          <button type="submit" className="tap rounded-lg bg-ki-500 px-4 py-3 text-sm font-semibold text-space-950 hover:bg-ki-400">
            Yes, that&apos;s me
          </button>
          <a href="/join" className="tap text-center text-xs text-space-300 hover:text-space-100">
            Not me — enter another code
          </a>
        </form>
      ) : (
        <form method="get" action="/join" className="flex flex-col gap-3 rounded-lg border border-space-700/70 bg-space-900/40 p-4">
          <label htmlFor="c" className="text-sm text-space-300">
            Your code
          </label>
          <input
            id="c"
            name="c"
            defaultValue={code}
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={12}
            placeholder="ABC234"
            className="tap rounded-md border border-space-600 bg-space-950/60 px-3 py-2 text-center font-mono text-2xl tracking-[0.3em] text-space-50 uppercase"
          />
          <button type="submit" className="tap rounded-lg bg-ki-500 px-4 py-3 text-sm font-semibold text-space-950 hover:bg-ki-400">
            Continue
          </button>
        </form>
      )}

      <a href="/login" className="tap text-center text-xs text-space-400 hover:text-space-200">
        SL? Sign in here
      </a>
    </div>
  );
}
