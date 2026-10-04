import { LOGIN_START_PATH, PASSWORD_LOGIN_PATH, googleConfigured } from "@/lib/auth/core";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  refused: "That Google account is not on the SL list. Pick another account, or sign in with your password below.",
  state: "The sign-in took too long or was started in another tab. Please try again.",
  failed: "Google sign-in did not go through. Please try again in a moment.",
  config: "Google sign-in is not set up on this server yet. Sign in with your password below.",
};

/**
 * The sign-in page, public to the proxy. It reads no data: a signed-out
 * visitor learns nothing here but the app's name. SLs sign in with Google;
 * everyone else still uses their username and password until join codes
 * replace them (docs/architecture/auth.md). Both buttons are plain links, not
 * `next/link`, so nothing prefetches the Google redirect or the password popup.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const message = error ? (ERRORS[error] ?? ERRORS.failed) : null;
  const google = googleConfigured(process.env);

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-5 py-10">
      <div>
        <h1 className="text-2xl font-semibold text-space-50">
          <span className="text-ki-400">DBS</span> Card Companion
        </h1>
        <p className="mt-1 text-sm text-space-300">Sign in to see your collection, decks and the arena.</p>
      </div>

      {message ? (
        <p role="alert" className="rounded-lg bg-dbs-red p-3 text-sm font-medium text-white">
          {message}
        </p>
      ) : null}

      {google ? (
        <a
          href={LOGIN_START_PATH}
          className="tap flex items-center justify-center gap-2 rounded-lg bg-ki-500 px-4 py-3 text-sm font-semibold text-space-950 hover:bg-ki-400"
        >
          Sign in with Google
        </a>
      ) : null}

      <div className="rounded-lg border border-space-700/70 bg-space-900/40 p-3 text-sm">
        <p className="text-space-300">Have a username and password?</p>
        <a href={PASSWORD_LOGIN_PATH} className="tap mt-2 inline-flex items-center rounded-md border border-space-600 px-3 py-1.5 text-space-100 hover:bg-space-800">
          Sign in with password
        </a>
      </div>
    </div>
  );
}
