import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { notFound } from "next/navigation";
import type { Snapshot } from "@/lib/arena/snapshot";
import { skinFrom } from "@/lib/arena/skin";
import { stagingFrom } from "@/lib/arena/staging";
import type { Pace } from "@/lib/arena/pace";
import { PreviewStage } from "./PreviewStage";

export const dynamic = "force-dynamic";

const DIR = join(process.cwd(), "contract", "fixtures");

/** The fixtures that are a whole Snapshot (the others are deck lists and text). */
function snapshotFixtures(): string[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5))
    .filter((name) => {
      try {
        const j = JSON.parse(readFileSync(join(DIR, `${name}.json`), "utf8"));
        return j && typeof j === "object" && "view" in j && "game" in j;
      } catch {
        return false;
      }
    });
}

/**
 * Dev-only: the board drawn from a `contract/fixtures/*.json` snapshot, with no
 * database and no server action behind it (issue #343). `?fixture=play`,
 * `?skin=anime|night`, `?staging=` and `?pace=step` behave as on a game page.
 * It exists so a review can see the real board in a session that keeps off
 * Neon; production answers 404.
 */
export default async function ArenaPreviewPage({ searchParams }: { searchParams: Promise<{ fixture?: string; skin?: string; staging?: string; pace?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const q = await searchParams;
  const names = snapshotFixtures();
  const name = q.fixture ?? "play";
  if (!names.includes(name)) {
    return (
      <div className="mx-auto max-w-xl space-y-2 p-4 text-sm text-space-200">
        <p>Unknown fixture. Try one of:</p>
        <ul className="list-disc pl-5">
          {names.map((n) => (
            <li key={n}>
              <a className="text-ki-300" href={`?fixture=${n}`}>
                {n}
              </a>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  const snapshot = JSON.parse(readFileSync(join(DIR, `${name}.json`), "utf8")) as Snapshot;
  const pace: Pace | null = q.pace === "step" || q.pace === "normal" || q.pace === "slow" ? q.pace : null;
  return <PreviewStage snapshot={snapshot} skin={skinFrom(q.skin)} staging={stagingFrom(q.staging)} pace={pace} />;
}
